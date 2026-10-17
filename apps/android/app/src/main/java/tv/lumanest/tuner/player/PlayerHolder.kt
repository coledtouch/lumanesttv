package tv.lumanest.tuner.player

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import androidx.annotation.OptIn
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.Format
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.TrackSelectionOverride
import androidx.media3.common.TrackSelectionParameters
import androidx.media3.common.Tracks
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.okhttp.OkHttpDataSource
import androidx.media3.datasource.HttpDataSource
import androidx.media3.exoplayer.DefaultLoadControl
import androidx.media3.exoplayer.DefaultRenderersFactory
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.analytics.AnalyticsListener
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.exoplayer.upstream.DefaultLoadErrorHandlingPolicy
import androidx.media3.exoplayer.upstream.LoadErrorHandlingPolicy
import androidx.media3.extractor.DefaultExtractorsFactory
import androidx.media3.extractor.ts.DefaultTsPayloadReaderFactory
import tv.lumanest.tuner.data.ExternalSubtitle
import tv.lumanest.tuner.data.Net
import tv.lumanest.tuner.data.Repo
import kotlinx.coroutines.flow.MutableStateFlow

/**
 * One ExoPlayer for the whole app. The guide preview and the full-screen player share it,
 * so pressing OK on a channel you are previewing goes full screen with no re-buffering.
 */
@OptIn(UnstableApi::class)
object PlayerHolder {
    private lateinit var appContext: Context
    private var exo: ExoPlayer? = null
    private var dataSourceUa: String? = null
    private val main = Handler(Looper.getMainLooper())
    private val deadlines by lazy { TuneDeadline(Net.client) }

    var currentUrl: String? = null
        private set
    @Volatile
    var isLive = false
        private set
    private var triedHls = false
    private var reconnects = 0
    private val playbackIntent = ForegroundPlaybackIntent()
    private val appForeground get() = playbackIntent.foreground
    private var sourceStartMs = 0L
    private var bufferingBudget: PlaybackWaitBudget? = null
    /** Progressive live request in flight: short HLS segments and finite videos bypass the guard. */
    @Volatile
    private var progressive = true

    /** Human-readable playback error, or null while things are fine. */
    val error = MutableStateFlow<String?>(null)

    /** Key of a live channel that just failed on every source. The player screen skips past it. */
    val unavailable = MutableStateFlow<String?>(null)
    /** Full-screen playback alone can enter native PiP; guide previews never opt in. */
    val fullscreenPlayback = MutableStateFlow(false)
    val pipStateChanges = MutableStateFlow(0)
    val pipSupported = MutableStateFlow(false)
    val inPictureInPicture = MutableStateFlow(false)
    val pipVideoOnly = MutableStateFlow(false)
    val pipEligible: Boolean get() {
        val p = exo ?: return false
        return !TwoChannelPlayer.active.value && fullscreenPlayback.value && currentUrl != null && error.value == null &&
            p.videoSize.width > 0 && p.videoSize.height > 0 && p.playbackState in setOf(Player.STATE_READY, Player.STATE_BUFFERING)
    }

    fun setFullscreenPlayback(fullscreen: Boolean) { fullscreenPlayback.value = fullscreen }
    fun setPictureInPictureMode(enabled: Boolean) {
        inPictureInPicture.value = enabled
        pipVideoOnly.value = enabled
    }
    fun setPipTransition(entering: Boolean) { pipVideoOnly.value = entering || inPictureInPicture.value }

    // The current channel's sources: its main URL, then the copies folded into it ([tv.lumanest.tuner.data.Channel.backups]).
    private var sources: List<String> = emptyList()
    private var sourceIndex = 0
    private var channelKey: String? = null
    private val watchIntent = LiveWatchIntent()
    /** The source that last played for each channel, so a working backup goes first next time. */
    private val goodSource = HashMap<String, String>()
    private val source: String? get() = sources.getOrNull(sourceIndex)

    fun init(context: Context) { appContext = context.applicationContext }

    val player: ExoPlayer
        get() {
            val ua = Repo.userAgent
            exo?.let { if (dataSourceUa == ua) return it; it.release() }
            dataSourceUa = ua
            val http = OkHttpDataSource.Factory(deadlines).setUserAgent(ua)
            // Non-IDR keyframes: start on the first I-frame instead of waiting for an IDR (often seconds apart
            // on live channels). Deliberately NOT FLAG_DETECT_ACCESS_UNITS: these streams carry access unit
            // delimiters, and splitting on slice headers as well cut every frame into fragments, which made the
            // decoder drop hundreds of frames a second.
            //
            // Closed captions: MPEG-TS live channels carry CEA-608 inside the H.264/H.265 SEI messages. Declaring a
            // CEA-608 track makes the extractor expose it even when the PMT has no caption_service_descriptor; a
            // descriptor (CEA-708 services included) still replaces this default. HLS streams use Media3's default
            // HLS extractor factory, which already exposes CEA-608 when the playlist declares no CLOSED-CAPTIONS.
            // MKV and MP4 files expose their own text tracks (SRT, SSA, WebVTT, tx3g), parsed during extraction.
            val extractors = DefaultExtractorsFactory()
                .setTsExtractorFlags(DefaultTsPayloadReaderFactory.FLAG_ALLOW_NON_IDR_KEYFRAMES)
                .setTsSubtitleFormats(listOf(Format.Builder().setSampleMimeType(MimeTypes.APPLICATION_CEA608).build()))
                .setConstantBitrateSeekingEnabled(true)
            // On progressive live TS, LiveSlotDataSource replaces a provider connection that goes quiet or drops while
            // the buffer keeps playing (LiveRejoin + TsSplicer), so the extractor sees one continuous stream. Media3
            // can't resume such a stream itself: it would play the buffer out, then start over from a new connection.
            val mediaSources = DefaultMediaSourceFactory(LiveSlotDataSource.Factory(http, deadlines, guard = { progressive }, live = { isLive }), extractors)
                .setLoadErrorHandlingPolicy(RetryPolicy)
            // Start once half a second is buffered (IPTV servers burst the first few seconds), then keep
            // a deep buffer so short network hiccups don't stall the picture.
            val loadControl = DefaultLoadControl.Builder()
                .setBufferDurationsMs(20_000, 50_000, 500, 2_500)
                .setPrioritizeTimeOverSizeThresholds(true)
                .build()
            val p = ExoPlayer.Builder(appContext)
                .setRenderersFactory(DefaultRenderersFactory(appContext).setEnableDecoderFallback(true))
                .setMediaSourceFactory(mediaSources)
                .setLoadControl(loadControl)
                .setAudioAttributes(
                    AudioAttributes.Builder().setUsage(C.USAGE_MEDIA).setContentType(C.AUDIO_CONTENT_TYPE_MOVIE).build(),
                    true,
                )
                .build()
            p.addListener(listener(p))
            p.addAnalyticsListener(object : AnalyticsListener {
                override fun onDroppedVideoFrames(eventTime: AnalyticsListener.EventTime, droppedFrames: Int, elapsedMs: Long) {
                    PlaybackLog.note("dropped $droppedFrames video frames over ${elapsedMs}ms")
                }
            })
            exo = p
            return p
        }

    private fun listener(p: ExoPlayer) = object : Player.Listener {
        override fun onEvents(player: Player, events: Player.Events) { pipStateChanges.value++ }
        override fun onTracksChanged(tracks: Tracks) { subtitleFallback(p, tracks) }
        override fun onPlayerError(e: PlaybackException) {
            if (currentUrl == null) return
            val url = source ?: return
            if (e.hasCause<SlotBusyException>()) {
                PlaybackLog.note("gave up, connection still in use")
                error.value = "Your provider says another device is using your connection. Your plan allows one stream at a time."
                return
            }
            if (isLive && e.errorCode == PlaybackException.ERROR_CODE_BEHIND_LIVE_WINDOW) {
                p.seekToDefaultPosition(); p.prepare(); return
            }
            // Some panels hand out HLS without a .m3u8 extension. Only worth trying when the bytes didn't parse.
            if (!triedHls && !url.contains(".m3u8") && e.errorCode in 3000..3999) {
                triedHls = true
                progressive = false
                PlaybackLog.note("retrying as HLS")
                val position = if (isLive) 0 else resumePosition(p)
                val wantsPlay = p.playWhenReady
                p.setMediaItem(item(url, forceHls = true), position); p.prepare()
                p.playWhenReady = wantsPlay && appForeground
                return
            }
            // Live streams drop now and then. Reconnect quietly a few times before showing an error.
            if (isLive && reconnects < 3 && e.errorCode in RECONNECTABLE) {
                reconnects++
                PlaybackLog.note("reconnect #$reconnects after ${e.errorCodeName}")
                main.postDelayed({ if (source == url && appForeground) restart(p) }, 400L * reconnects)
                return
            }
            // This copy of the channel is down. Its other copies come from different upstream feeds, so try those.
            if (nextSource(p, e.errorCodeName)) return
            // Every copy refused or sent garbage: the channel is dead, not the connection. Hide it and move on.
            val key = channelKey
            if (isLive && key != null && shouldRetireLive(e)) {
                PlaybackLog.note("channel unavailable on all ${sources.size} sources")
                error.value = "This channel isn't working right now, so it's been taken out of the guide."
                Repo.reportDead(key)
                unavailable.value = key
                return
            }
            error.value = describe(e)
        }

        override fun onPlaybackStateChanged(state: Int) {
            bufferingBudget = if (state == Player.STATE_BUFFERING && appForeground && p.playWhenReady) newBufferingBudget() else null
            when (state) {
                Player.STATE_READY -> {
                    error.value = null; reconnects = 0; PlaybackLog.ready()
                    watchIntent.ready()?.let { Repo.prefs.recordWatched(it) }
                    channelKey?.let { key -> source?.let { goodSource[key] = it } }
                }
                Player.STATE_BUFFERING -> if (p.isPlaying || p.playWhenReady) PlaybackLog.note("buffering, buffered=${p.totalBufferedDuration}ms")
                // A live channel never ends on purpose: the server closed the connection. Pick it back up.
                Player.STATE_ENDED -> if (isLive && appForeground && reconnects < 5) {
                    if (currentUrl == null) return
                    reconnects++
                    PlaybackLog.note("stream ended, reconnecting")
                    restart(p)
                }
            }
        }

        override fun onPlayWhenReadyChanged(playWhenReady: Boolean, reason: Int) {
            bufferingBudget = if (playWhenReady && appForeground && p.playbackState == Player.STATE_BUFFERING) newBufferingBudget() else null
        }

        override fun onRenderedFirstFrame() = PlaybackLog.firstFrame()
    }

    /** Every few seconds while something plays: buffer depth and frame counts, for `adb logcat -s TunerPlayback`. */
    private const val HEALTH_EVERY_MS = 5_000L
    private fun newBufferingBudget() = PlaybackWaitBudget(30_000, SystemClock.elapsedRealtime())
    private val health = object : Runnable {
        override fun run() {
            val p = exo ?: return
            if (currentUrl == null || !appForeground) return
            if (p.playbackState == Player.STATE_BUFFERING && p.playWhenReady) {
                val budget = bufferingBudget ?: newBufferingBudget().also { bufferingBudget = it }
                if (budget.expired(SystemClock.elapsedRealtime(), paused = false)) {
                    PlaybackLog.note("buffering deadline reached")
                    if (nextSource(p, "Stream stalled")) return
                    bufferingBudget = null
                    p.stop()
                    error.value = "This stream is taking too long to load. Press OK to retry or choose another stream."
                    return
                }
            } else bufferingBudget = null
            if (currentUrl != null && p.isPlaying) {
                val c = p.videoDecoderCounters
                PlaybackLog.note("health buffered=${p.totalBufferedDuration}ms rendered=${c?.renderedOutputBufferCount} dropped=${c?.droppedBufferCount}")
            }
            main.postDelayed(this, HEALTH_EVERY_MS)
        }
    }

    /** Reopens the current source after the server dropped it. */
    private fun restart(p: ExoPlayer) {
        val url = source ?: return
        p.setMediaItem(item(url, forceHls = triedHls)); p.prepare()
        if (appForeground) p.play()
    }

    private fun startSource(p: ExoPlayer, startMs: Long = 0, wantsPlay: Boolean = true) {
        val url = source ?: return
        sourceStartMs = startMs.coerceAtLeast(0)
        p.trackSelectionParameters = p.trackSelectionParameters.buildUpon().clearOverridesOfType(C.TRACK_TYPE_AUDIO)
            .clearOverridesOfType(C.TRACK_TYPE_TEXT).build()
        subtitleFallbackDone = false
        // The provider's small notice clip heuristic applies only to endless live streams.
        // A short movie or direct add-on video is valid regardless of its size or audio language.
        progressive = isLive && !url.contains(".m3u8")
        p.volume = 1f
        p.playWhenReady = wantsPlay && appForeground
        PlaybackLog.start(url)
        main.removeCallbacks(health)
        main.postDelayed(health, HEALTH_EVERY_MS)
        if (startMs > 0) p.setMediaItem(item(url, forceHls = false), startMs) else p.setMediaItem(item(url, forceHls = false))
        p.prepare()
        if (wantsPlay && appForeground) p.play()
    }

    /** Moves on to the channel's next copy. False when none is left. */
    private fun nextSource(p: ExoPlayer, why: String): Boolean {
        if (sourceIndex >= sources.lastIndex) return false
        val position = if (isLive) 0 else resumePosition(p)
        val wantsPlay = p.playWhenReady
        sourceIndex++
        p.stop()
        triedHls = false
        reconnects = 0
        PlaybackLog.note("$why, switching to backup $sourceIndex of ${sources.lastIndex}")
        startSource(p, position, wantsPlay)
        return true
    }

    private fun resumePosition(p: ExoPlayer) = p.currentPosition.takeIf { it > 0 } ?: sourceStartMs

    private fun item(url: String, forceHls: Boolean): MediaItem {
        val b = MediaItem.Builder().setUri(url)
        if (forceHls || url.contains(".m3u8")) b.setMimeType(MimeTypes.APPLICATION_M3U8)
        val sidecars = externalSubtitles.mapNotNull { sub ->
            val mime = subtitleMimeType(sub.url) ?: return@mapNotNull null
            MediaItem.SubtitleConfiguration.Builder(android.net.Uri.parse(sub.url))
                .setMimeType(mime)
                .setLanguage(sub.language)
                .setLabel(sub.label)
                .build()
        }
        if (sidecars.isNotEmpty()) b.setSubtitleConfigurations(sidecars)
        return b.build()
    }

    // ------------------------------------------------------------------ subtitles

    /** Sidecar subtitle files for the current movie or episode (Xtream `subtitles`). */
    private var externalSubtitles: List<ExternalSubtitle> = emptyList()
    private var subtitleFallbackDone = false

    internal fun subtitleMimeType(url: String): String? =
        when (url.substringBefore('?').substringBefore('#').substringAfterLast('.', "").lowercase()) {
            "srt" -> MimeTypes.APPLICATION_SUBRIP
            "vtt", "webvtt" -> MimeTypes.TEXT_VTT
            "ass", "ssa" -> MimeTypes.TEXT_SSA
            "ttml", "dfxp", "xml" -> MimeTypes.APPLICATION_TTML
            else -> null
        }

    /**
     * Settings > Subtitles. Off selects no text track (forced subtitles for foreign dialogue still show); On prefers
     * English, then untagged tracks such as CEA-608 captions, then (see [subtitleFallback]) the first text track.
     * The text renderer is never left disabled from an earlier "Off" choice in the player's Subtitles menu.
     */
    private fun applySubtitlePreference(b: TrackSelectionParameters.Builder): TrackSelectionParameters.Builder {
        b.clearOverridesOfType(C.TRACK_TYPE_TEXT).setTrackTypeDisabled(C.TRACK_TYPE_TEXT, false)
        return if (Repo.prefs.subtitlesOn.value) b.setPreferredTextLanguages("en", "eng").setSelectUndeterminedTextLanguage(true)
        else b.setPreferredTextLanguages().setSelectUndeterminedTextLanguage(false)
    }

    /** Subtitles On but no English or untagged track was picked: show the first playable text track instead. */
    private fun subtitleFallback(p: ExoPlayer, tracks: Tracks) {
        if (subtitleFallbackDone || !Repo.prefs.subtitlesOn.value) return
        val params = p.trackSelectionParameters
        if (C.TRACK_TYPE_TEXT in params.disabledTrackTypes) return
        val text = tracks.groups.filter { it.type == C.TRACK_TYPE_TEXT }
        if (text.isEmpty()) return
        subtitleFallbackDone = true
        if (text.any { it.isSelected } || params.overrides.keys.any { it.type == C.TRACK_TYPE_TEXT }) return
        val group = text.firstOrNull { g -> (0 until g.length).any(g::isTrackSupported) } ?: return
        val index = (0 until group.length).first(group::isTrackSupported)
        p.trackSelectionParameters = params.buildUpon().setOverrideForType(TrackSelectionOverride(group.mediaTrackGroup, index)).build()
    }

    /**
     * Plays [url]. For a live channel, [backups] are its other copies (tried in order when a copy is down)
     * and [key] identifies the channel, so a copy that worked goes first next time and a channel that fails
     * everywhere can be hidden.
     * Automatic guide restoration sets [recordWatched] false; opening the player or changing a
     * channel explicitly can promote that preview into one watch without reconnecting it.
     */
    @Suppress("UNUSED_PARAMETER") // Kept for callers from older request models; audio is never restricted.
    fun play(url: String, live: Boolean, startMs: Long = 0, backups: List<String> = emptyList(), key: String? = null, requireEnglishAudio: Boolean = false, recordWatched: Boolean = true, subtitles: List<ExternalSubtitle> = emptyList()) {
        TwoChannelPlayer.stop()
        playbackIntent.requestStart()
        val p = player
        if (url == currentUrl && isLive == live && p.playbackState != Player.STATE_IDLE && error.value == null) {
            watchIntent.request(key, live, recordWatched, sameRequest = true)
            if (p.playbackState == Player.STATE_READY) watchIntent.ready()?.let { Repo.prefs.recordWatched(it) }
            if (appForeground && !p.playWhenReady) p.play()
            return
        }
        main.removeCallbacksAndMessages(null)
        p.stop()
        p.volume = 1f
        p.playWhenReady = appForeground
        p.trackSelectionParameters = applySubtitlePreference(p.trackSelectionParameters.buildUpon()
            .clearOverridesOfType(C.TRACK_TYPE_AUDIO)
            .setPreferredAudioLanguages("en", "eng")
            .setTrackTypeDisabled(C.TRACK_TYPE_AUDIO, false)).build()
        externalSubtitles = if (live) emptyList() else subtitles
        currentUrl = url
        isLive = live
        channelKey = key
        watchIntent.request(key, live, recordWatched)
        val all = (listOf(url) + backups).distinct()
        val preferred = key?.let { goodSource[it] }?.takeIf { it in all }
        sources = if (preferred != null) listOf(preferred) + (all - preferred) else all
        sourceIndex = 0
        triedHls = false
        reconnects = 0
        error.value = null
        unavailable.value = null
        startSource(p, startMs)
    }

    /** Settings > Subtitles changed: apply it to whatever is playing now. */
    fun subtitlePreferenceChanged() {
        val p = exo ?: return
        p.trackSelectionParameters = applySubtitlePreference(p.trackSelectionParameters.buildUpon()).build()
        subtitleFallbackDone = false
        subtitleFallback(p, p.currentTracks)
    }

    /**
     * Drops the current live stream immediately when the viewer starts changing channels, so the
     * provider frees the connection while the next channel is still being picked.
     */
    fun releaseForZap() {
        val p = exo ?: return
        if (currentUrl == null) return
        main.removeCallbacksAndMessages(null)
        p.stop()
        currentUrl = null
        watchIntent.stop()
        error.value = null
    }

    /** Starts the current channel over from its first source. */
    fun retry() {
        val p = exo ?: return
        if (currentUrl == null || sources.isEmpty()) return
        val position = if (isLive) 0 else resumePosition(p)
        main.removeCallbacksAndMessages(null)
        p.stop()
        sourceIndex = 0
        triedHls = false
        reconnects = 0
        error.value = null
        unavailable.value = null
        startSource(p, position)
    }

    fun stop() {
        playbackIntent.stop()
        bufferingBudget = null
        main.removeCallbacksAndMessages(null)
        exo?.playWhenReady = false
        exo?.stop()
        exo?.clearMediaItems()
        currentUrl = null
        watchIntent.stop()
        sources = emptyList()
        error.value = null
    }

    fun onAppBackground() {
        // A native PiP activity is paused but remains visible. Closing its window clears this flag
        // before the activity's normal background cleanup runs.
        if (inPictureInPicture.value) return
        playbackIntent.background(exo?.playWhenReady == true && currentUrl != null)
        bufferingBudget = null
        val p = exo ?: return
        main.removeCallbacksAndMessages(null)
        if (isLive) { p.stop() } else p.pause()
    }

    fun onAppForeground() {
        val resumeVod = playbackIntent.foreground()
        val p = exo ?: return
        if (currentUrl != null) { main.removeCallbacks(health); main.postDelayed(health, HEALTH_EVERY_MS) }
        if (isLive && currentUrl != null && p.playbackState == Player.STATE_IDLE) { p.prepare(); p.play() }
        else if (resumeVod && currentUrl != null && error.value == null) p.play()
    }

    private fun describe(e: PlaybackException): String = when (e.errorCode) {
        PlaybackException.ERROR_CODE_IO_BAD_HTTP_STATUS -> "The provider refused the stream. You may be over your connection limit."
        PlaybackException.ERROR_CODE_IO_FILE_NOT_FOUND -> "This channel isn't available from your provider right now."
        PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_FAILED,
        PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_TIMEOUT -> "Can't reach the stream. Check your connection."
        PlaybackException.ERROR_CODE_PARSING_CONTAINER_UNSUPPORTED,
        PlaybackException.ERROR_CODE_PARSING_CONTAINER_MALFORMED -> "This stream format isn't supported. Try switching Live format in Settings."
        PlaybackException.ERROR_CODE_DECODER_INIT_FAILED,
        PlaybackException.ERROR_CODE_DECODING_FORMAT_UNSUPPORTED -> "This device can't decode the stream's video or audio."
        else -> "Playback failed (${e.errorCodeName})"
    }

    private val RECONNECTABLE = setOf(
        PlaybackException.ERROR_CODE_IO_UNSPECIFIED,
        PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_FAILED,
        PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_TIMEOUT,
    )

    /** Answers that mean the channel itself is gone (refused, missing, or not video), not that the network hiccupped. */
    private val DEAD = setOf(
        PlaybackException.ERROR_CODE_IO_FILE_NOT_FOUND,
        PlaybackException.ERROR_CODE_IO_INVALID_HTTP_CONTENT_TYPE,
        PlaybackException.ERROR_CODE_PARSING_CONTAINER_MALFORMED,
        PlaybackException.ERROR_CODE_PARSING_CONTAINER_UNSUPPORTED,
        PlaybackException.ERROR_CODE_PARSING_MANIFEST_MALFORMED,
        PlaybackException.ERROR_CODE_PARSING_MANIFEST_UNSUPPORTED,
    )

    private fun shouldRetireLive(e: PlaybackException): Boolean {
        if (e.errorCode != PlaybackException.ERROR_CODE_IO_BAD_HTTP_STATUS) return e.errorCode in DEAD
        var cause: Throwable? = e
        while (cause != null) {
            if (cause is HttpDataSource.InvalidResponseCodeException) return PlaybackFailurePolicy.isMissingHttp(cause.responseCode)
            cause = cause.cause
        }
        return false
    }

    private inline fun <reified T : Throwable> Throwable.hasCause(): Boolean {
        var t: Throwable? = this
        while (t != null) { if (t is T) return true; t = t.cause }
        return false
    }

    /**
     * Live loads retry fast (300 ms, 600 ms, 900 ms) instead of ExoPlayer's 1 s, 2 s, 3 s ladder, and the
     * provider's "connection in use" answer is final, because [LiveSlotDataSource] already waited it out.
     * A progressive live TS stream only gets here once [LiveRejoin] has given up rejoining in the data source.
     */
    private object RetryPolicy : DefaultLoadErrorHandlingPolicy() {
        override fun getRetryDelayMsFor(loadErrorInfo: LoadErrorHandlingPolicy.LoadErrorInfo): Long {
            if (loadErrorInfo.exception.hasCause<SlotBusyException>()) return C.TIME_UNSET
            if (!isLive) return super.getRetryDelayMsFor(loadErrorInfo)
            if (super.getRetryDelayMsFor(loadErrorInfo) == C.TIME_UNSET) return C.TIME_UNSET
            return if (loadErrorInfo.errorCount <= 3) 300L * loadErrorInfo.errorCount else C.TIME_UNSET
        }
    }
}

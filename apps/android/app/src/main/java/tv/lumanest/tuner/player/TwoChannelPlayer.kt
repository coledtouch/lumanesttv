package tv.lumanest.tuner.player

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import androidx.annotation.OptIn
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.okhttp.OkHttpDataSource
import androidx.media3.exoplayer.DefaultLoadControl
import androidx.media3.exoplayer.DefaultRenderersFactory
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.exoplayer.upstream.DefaultLoadErrorHandlingPolicy
import androidx.media3.exoplayer.upstream.LoadErrorHandlingPolicy
import androidx.media3.extractor.DefaultExtractorsFactory
import androidx.media3.extractor.ts.DefaultTsPayloadReaderFactory
import tv.lumanest.tuner.data.Channel
import tv.lumanest.tuner.data.Net
import tv.lumanest.tuner.data.Repo
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

/** Two independent video decoders for Split view and in-app Picture in Picture. */
@OptIn(UnstableApi::class)
object TwoChannelPlayer {
    enum class Status { IDLE, LOADING, PLAYING, PAUSED, ERROR }
    data class SlotState(
        val channel: Channel? = null,
        val status: Status = Status.IDLE,
        val error: String? = null,
        val positionMs: Long = 0,
    )

    private class Slot {
        var player: ExoPlayer? = null
        var sources = emptyList<String>()
        var sourceIndex = 0
        var forceHls = false
        @Volatile var progressive = true
        var reconnects = 0
        var generation = 0
        var bufferingSince: Long? = null
        var pendingWatch = false
    }

    private lateinit var context: Context
    private val main = Handler(Looper.getMainLooper())
    private val slots = Array(2) { Slot() }
    private val _states = MutableStateFlow(List(2) { SlotState() })
    val states: StateFlow<List<SlotState>> = _states
    private val _audioSlot = MutableStateFlow(0)
    val audioSlot: StateFlow<Int> = _audioSlot
    private val _active = MutableStateFlow(false)
    /** Viewing intent remains active during background suspension, when both players are released. */
    val active: StateFlow<Boolean> = _active
    private var foreground = true
    private val deadlines by lazy { TuneDeadline(Net.client) }
    private val audioAttributes = AudioAttributes.Builder()
        .setUsage(C.USAGE_MEDIA).setContentType(C.AUDIO_CONTENT_TYPE_MOVIE).build()

    fun init(applicationContext: Context) {
        if (!::context.isInitialized) context = applicationContext.applicationContext
    }

    /** Reading a surface never creates another decoder or starts a provider connection. */
    fun player(slot: Int): ExoPlayer? = slots.getOrNull(slot)?.player

    fun play(slot: Int, channel: Channel): Boolean = tune(slot, channel, recordWatched = true)

    private fun tune(slot: Int, channel: Channel, recordWatched: Boolean): Boolean {
        requireMainThread()
        val target = slots.getOrNull(slot) ?: return false
        val peer = _states.value[1 - slot].channel
        if (peer != null && (peer.key == channel.key || peer.url == channel.url)) return false
        val sources = (listOf(channel.url) + channel.backups).distinct()
            .filter { it.startsWith("http://", true) || it.startsWith("https://", true) }
        if (sources.isEmpty()) return false
        if (_states.value[slot].channel?.key == channel.key && _states.value[slot].channel?.url == channel.url &&
            target.player != null && _states.value[slot].error == null) return true
        check(::context.isInitialized) { "Initialize TwoChannelPlayer before starting playback" }
        if (!_active.value) {
            PlayerHolder.stop()
            PlayerHolder.setFullscreenPlayback(false)
            _active.value = true
        }
        release(slot)
        target.sources = sources
        target.sourceIndex = 0
        target.forceHls = false
        target.reconnects = 0
        target.pendingWatch = recordWatched
        update(slot, SlotState(channel, if (foreground) Status.LOADING else Status.PAUSED))
        if (foreground) {
            target.player = buildPlayer(slot)
            startSource(slot)
        }
        return true
    }

    /** The other player is muted and relinquishes audio focus before this one enables its audio. */
    fun selectAudio(slot: Int): Boolean {
        requireMainThread()
        if (slot !in slots.indices || _states.value[slot].channel == null ||
            _states.value[slot].status == Status.ERROR || (foreground && slots[slot].player == null)) return false
        _audioSlot.value = slot
        slots[1 - slot].player?.let { applyAudio(it, selected = false) }
        slots[slot].player?.let { applyAudio(it, selected = true) }
        return true
    }

    fun retry(slot: Int) {
        requireMainThread()
        _states.value.getOrNull(slot)?.channel?.let { tune(slot, it, recordWatched = false) }
    }

    fun stop() {
        requireMainThread()
        _active.value = false
        main.removeCallbacksAndMessages(null)
        slots.indices.forEach(::release)
        slots.forEach { it.pendingWatch = false }
        _states.value = List(2) { SlotState() }
        _audioSlot.value = 0
    }

    fun onAppBackground() {
        requireMainThread()
        foreground = false
        main.removeCallbacksAndMessages(null)
        slots.indices.forEach { slot ->
            release(slot)
            val state = _states.value[slot]
            if (state.channel != null && state.error == null) update(slot, state.copy(status = Status.PAUSED))
        }
    }

    fun onAppForeground() {
        requireMainThread()
        if (foreground) return
        foreground = true
        if (!_active.value) return
        PlayerHolder.stop()
        val channels = _states.value.map { state -> state.channel.takeIf { state.error == null } }
        val pendingWatch = slots.map { it.pendingWatch }
        channels.forEachIndexed { slot, channel -> if (channel != null) tune(slot, channel, pendingWatch[slot]) }
    }

    private fun requireMainThread() = check(Looper.myLooper() == Looper.getMainLooper())

    private fun update(slot: Int, state: SlotState) {
        _states.value = _states.value.toMutableList().also { it[slot] = state }
    }

    private fun release(slot: Int) {
        val target = slots[slot]
        target.generation++
        target.bufferingSince = null
        val player = target.player
        target.player = null // Ignore final callbacks from the player that is being released.
        player?.release()
    }

    private fun current(slot: Int, player: ExoPlayer) =
        foreground && _active.value && slots[slot].player === player

    private fun applyAudio(player: ExoPlayer, selected: Boolean) {
        if (!selected) player.volume = 0f
        player.setAudioAttributes(audioAttributes, selected)
        player.trackSelectionParameters = player.trackSelectionParameters.buildUpon()
            .setMaxVideoSize(1920, 1080)
            .setPreferredAudioLanguages("en", "eng")
            .setTrackTypeDisabled(C.TRACK_TYPE_AUDIO, !selected).build()
        if (selected) player.volume = 1f
    }

    private fun buildPlayer(slot: Int): ExoPlayer {
        val target = slots[slot]
        val http = OkHttpDataSource.Factory(deadlines).setUserAgent(Repo.userAgent)
        val extractors = DefaultExtractorsFactory()
            .setTsExtractorFlags(DefaultTsPayloadReaderFactory.FLAG_ALLOW_NON_IDR_KEYFRAMES)
        // The same factory as full screen: each player's live TS connection is rejoined in the data source when it goes
        // quiet or drops, one connection per player at a time (the old one is closed before the new one opens).
        val sources = DefaultMediaSourceFactory(
            LiveSlotDataSource.Factory(http, deadlines, guard = { target.progressive }, live = { true }), extractors,
        ).setLoadErrorHandlingPolicy(object : DefaultLoadErrorHandlingPolicy() {
            override fun getRetryDelayMsFor(loadErrorInfo: LoadErrorHandlingPolicy.LoadErrorInfo): Long {
                if (loadErrorInfo.exception.hasCause<SlotBusyException>()) return C.TIME_UNSET
                if (super.getRetryDelayMsFor(loadErrorInfo) == C.TIME_UNSET) return C.TIME_UNSET
                return if (loadErrorInfo.errorCount <= 3) 300L * loadErrorInfo.errorCount else C.TIME_UNSET
            }
        })
        return ExoPlayer.Builder(context)
            .setRenderersFactory(DefaultRenderersFactory(context).setEnableDecoderFallback(true))
            .setMediaSourceFactory(sources)
            .setLoadControl(DefaultLoadControl.Builder()
                .setBufferDurationsMs(12_000, 30_000, 500, 2_500)
                .setPrioritizeTimeOverSizeThresholds(true).build())
            .setAudioAttributes(audioAttributes, slot == _audioSlot.value)
            .build().also { player ->
                applyAudio(player, slot == _audioSlot.value)
                player.addListener(object : Player.Listener {
                    override fun onPlaybackStateChanged(playbackState: Int) {
                        if (!current(slot, player)) return
                        when (playbackState) {
                            Player.STATE_BUFFERING -> {
                                target.bufferingSince = SystemClock.elapsedRealtime()
                                update(slot, _states.value[slot].copy(status = Status.LOADING, error = null))
                            }
                            Player.STATE_READY -> {
                                target.bufferingSince = null
                                target.reconnects = 0
                                if (target.pendingWatch) {
                                    target.pendingWatch = false
                                    _states.value[slot].channel?.let { Repo.prefs.recordWatched(it.key) }
                                }
                                refresh(slot, player)
                            }
                            Player.STATE_ENDED -> reconnectOrFail(slot, player, "This live stream ended. Try another channel or retry.")
                        }
                    }
                    override fun onIsPlayingChanged(isPlaying: Boolean) {
                        if (current(slot, player) && player.playbackState == Player.STATE_READY) refresh(slot, player)
                    }
                    override fun onPlayerError(error: PlaybackException) {
                        if (!current(slot, player)) return
                        when {
                            error.hasCause<SlotBusyException>() -> fail(slot, "Your provider's connection limit was reached. Close another stream and retry.")
                            error.errorCode == PlaybackException.ERROR_CODE_BEHIND_LIVE_WINDOW -> {
                                player.seekToDefaultPosition(); player.prepare(); player.play()
                            }
                            !target.forceHls && target.progressive && error.errorCode in 3000..3999 -> {
                                target.forceHls = true
                                startSource(slot)
                            }
                            error.errorCode in NETWORK_ERRORS && target.reconnects < 3 -> reconnectOrFail(slot, player, "The channel lost its connection. Please retry.")
                            nextSource(slot) -> Unit
                            else -> fail(slot, when (error.errorCode) {
                                PlaybackException.ERROR_CODE_DECODER_INIT_FAILED,
                                PlaybackException.ERROR_CODE_DECODING_FORMAT_UNSUPPORTED -> "This device could not decode the channel. Try a lower quality channel."
                                else -> "This channel is unavailable right now. Try another channel or retry."
                            })
                        }
                    }
                })
            }
    }

    private fun refresh(slot: Int, player: ExoPlayer) {
        update(slot, _states.value[slot].copy(status = if (player.isPlaying) Status.PLAYING else Status.PAUSED,
            error = null, positionMs = player.currentPosition.coerceAtLeast(0)))
    }

    private fun startSource(slot: Int) {
        val target = slots[slot]
        val player = target.player ?: return
        val url = target.sources.getOrNull(target.sourceIndex) ?: return
        target.generation++
        target.progressive = !target.forceHls && !url.contains(".m3u8", true)
        target.bufferingSince = SystemClock.elapsedRealtime()
        player.stop()
        val item = MediaItem.Builder().setUri(url).setMediaId("dual:$slot:${target.generation}")
        if (!target.progressive) item.setMimeType(MimeTypes.APPLICATION_M3U8)
        player.setMediaItem(item.build())
        update(slot, _states.value[slot].copy(status = Status.LOADING, error = null, positionMs = 0))
        player.prepare(); player.play()
        main.removeCallbacks(health)
        main.postDelayed(health, 1_000)
    }

    private fun nextSource(slot: Int): Boolean {
        val target = slots[slot]
        if (target.sourceIndex >= target.sources.lastIndex) return false
        target.sourceIndex++
        target.forceHls = false
        target.reconnects = 0
        startSource(slot)
        return true
    }

    private fun reconnectOrFail(slot: Int, player: ExoPlayer, message: String) {
        val target = slots[slot]
        if (target.reconnects >= 3) {
            if (!nextSource(slot)) fail(slot, message)
            return
        }
        target.reconnects++
        val generation = target.generation
        main.postDelayed({
            if (current(slot, player) && generation == target.generation) startSource(slot)
        }, 400L * target.reconnects)
    }

    private fun fail(slot: Int, message: String) {
        release(slot)
        update(slot, _states.value[slot].copy(status = Status.ERROR, error = message))
    }

    private val health = object : Runnable {
        override fun run() {
            if (!foreground || !_active.value) return
            slots.forEachIndexed { slot, target ->
                val player = target.player ?: return@forEachIndexed
                if (_states.value[slot].error != null) return@forEachIndexed
                if (player.playbackState == Player.STATE_BUFFERING && player.playWhenReady) {
                    val since = target.bufferingSince ?: SystemClock.elapsedRealtime().also { target.bufferingSince = it }
                    if (SystemClock.elapsedRealtime() - since >= 30_000 && !nextSource(slot)) {
                        fail(slot, "This channel is taking too long to load. Choose Retry or another channel.")
                    }
                } else {
                    target.bufferingSince = null
                    if (player.playbackState == Player.STATE_READY) refresh(slot, player)
                }
            }
            main.removeCallbacks(this)
            main.postDelayed(this, 1_000)
        }
    }

    private inline fun <reified T : Throwable> Throwable.hasCause(): Boolean {
        var cause: Throwable? = this
        while (cause != null) { if (cause is T) return true; cause = cause.cause }
        return false
    }

    private val NETWORK_ERRORS = setOf(
        PlaybackException.ERROR_CODE_IO_UNSPECIFIED,
        PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_FAILED,
        PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_TIMEOUT,
    )
}

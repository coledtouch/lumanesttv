package tv.lumanest.tuner

import android.os.Looper
import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.performClick
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.common.PlaybackException
import androidx.media3.datasource.DataSourceException
import androidx.media3.exoplayer.analytics.AnalyticsListener
import androidx.media3.exoplayer.source.LoadEventInfo
import androidx.media3.exoplayer.source.MediaLoadData
import kotlinx.coroutines.CompletableDeferred
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import tv.lumanest.tuner.data.Extras
import tv.lumanest.tuner.data.ExtrasApi
import tv.lumanest.tuner.data.ExtrasClient
import tv.lumanest.tuner.data.ExtrasTitle
import tv.lumanest.tuner.data.PlayRequest
import tv.lumanest.tuner.data.Repo
import tv.lumanest.tuner.data.SubtitleQuery
import tv.lumanest.tuner.player.PlayerHolder
import tv.lumanest.tuner.player.SubtitleChoice
import tv.lumanest.tuner.ui.PlayerScreen
import tv.lumanest.tuner.ui.SUBTITLES_FAILED
import tv.lumanest.tuner.ui.Toasts
import tv.lumanest.tuner.ui.TunerTheme
import java.net.ServerSocket
import java.net.Socket
import java.time.Duration
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.Executors

/**
 * OpenSubtitles tracks in the movie and episode player (docs/extras.md, "Subtitles in the player"): looked up when the
 * title starts, listed in the subtitle menu with their credit, downloaded only when shown, and attached to the item
 * from the device's copy. The video comes from a local server that never answers, so the player keeps buffering.
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [34], qualifiers = "w960dp-h540dp-land-xhdpi")
@OptIn(ExperimentalTestApi::class)
class OpenSubtitlesPlayerTest {
    @get:Rule val rule = createAndroidComposeRule<androidx.activity.ComponentActivity>()

    private val original = Extras.client
    private var subtitlesWereOn = false
    private val requests = CopyOnWriteArrayList<String>()
    @Volatile private var lookupGate: CompletableDeferred<Unit>? = null
    // Fresh file ids every run, so no copy from an earlier test is on the device.
    private val run = java.util.UUID.randomUUID().toString().replace("-", "").take(12)
    private val good = "1-good$run"
    private val bad = "2-bad$run"
    private fun fileUrl(id: String) = "https://lumanest.tv/api/extras/subtitles/file/$id.vtt"
    private val lookupUrl = "https://lumanest.tv/api/extras/subtitles?v=1&type=movie&tmdb=603"
    private val vtt = "WEBVTT\n\n00:00:01.000 --> 00:00:02.500\nHello there\n"

    /**
     * A video server. It answers [mediaPath] with a short real MP4 (the instrumented tests' audio fixture) and [hlsPath]
     * with an HLS playlist whose one segment is that MP4 as a local file; every other request is accepted and never
     * answered.
     */
    private val server = ServerSocket(0)
    private val held = CopyOnWriteArrayList<Socket>()
    private val acceptor = Executors.newSingleThreadExecutor()
    private val workers = Executors.newCachedThreadPool()
    private val fixture = java.io.File("src/androidTest/assets/audio-fixture.mp4").absoluteFile
    private val localFixture get() = android.net.Uri.fromFile(fixture).toString()
    private val mediaPath = "/media/fixture.mp4"
    private val hlsPath = "/media/local.m3u8"

    private fun answer(socket: Socket) = runCatching {
        val target = socket.getInputStream().bufferedReader().readLine().orEmpty().split(' ').getOrNull(1)
        val (type, body) = when (target) {
            mediaPath -> "video/mp4" to fixture.readBytes()
            hlsPath -> "application/vnd.apple.mpegurl" to
                "#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:10\n#EXTINF:10.0,\n$localFixture\n#EXT-X-ENDLIST\n".toByteArray()
            else -> return@runCatching
        }
        socket.getOutputStream().run {
            write("HTTP/1.1 200 OK\r\nContent-Type: $type\r\nContent-Length: ${body.size}\r\nConnection: close\r\n\r\n".toByteArray())
            write(body)
            flush()
        }
        socket.close()
    }

    @Before fun prepare() {
        Repo.init(rule.activity.applicationContext)
        // A new player for every test: one an earlier test (of any class) left behind may never update its state here.
        rule.runOnIdle { PlayerHolder.releaseForTests() }
        subtitlesWereOn = Repo.prefs.subtitlesOn.value
        Toasts.message = null
        acceptor.submit { while (!server.isClosed) runCatching { val socket = server.accept(); held += socket; workers.submit { answer(socket) } } }
        Extras.client = ExtrasClient(fetch = { url, _, _ ->
            requests += url
            when (url) {
                lookupUrl -> {
                    lookupGate?.await()
                    """{"v":1,"status":"ok","tmdb":603,"tracks":[
                      {"id":"$good","lang":"en","label":"English (OpenSubtitles)","hi":false,"vtt":"${fileUrl(good)}"},
                      {"id":"$bad","lang":"en","label":"English (OpenSubtitles 2)","hi":false,"vtt":"${fileUrl(bad)}"}],
                      "credit":"Subtitles provided by OpenSubtitles.com"}"""
                }
                fileUrl(good) -> vtt
                else -> null
            }
        })
    }

    @After fun finish() {
        rule.runOnIdle { PlayerHolder.releaseForTests() }
        Extras.client = original
        Repo.prefs.setSubtitlesOn(subtitlesWereOn)
        server.close(); held.forEach { runCatching { it.close() } }; acceptor.shutdownNow(); workers.shutdownNow()
    }

    private val request get() = PlayRequest.Vod("m:1", "The Matrix", null, null, "http://127.0.0.1:${server.localPort}/movie/1.mp4", 0,
        extras = SubtitleQuery.movie(ExtrasTitle(tmdb = 603)))

    private fun play(subtitlesOn: Boolean, vod: PlayRequest.Vod = request) {
        Repo.prefs.setSubtitlesOn(subtitlesOn)
        rule.setContent { TunerTheme { PlayerScreen(vod) {} } }
    }

    private fun await(check: () -> Boolean) {
        rule.waitUntil(timeoutMillis = 5_000) {
            shadowOf(Looper.getMainLooper()).idle()
            check()
        }
    }

    private fun openSubtitlesMenu() {
        rule.onNode(hasClickAction() and hasText("Subtitles")).performClick()
        await { rule.onAllNodesWithText("Choose a language or turn subtitles off. Settings > Subtitles turns them on for every stream.").fetchSemanticsNodes().isNotEmpty() }
    }

    private fun extraConfig(): MediaItem.SubtitleConfiguration? =
        PlayerHolder.player.currentMediaItem?.localConfiguration?.subtitleConfigurations?.singleOrNull { it.id?.startsWith("opensubtitles:") == true }

    @Test fun withSubtitlesOffTheMenuListsTheTracksAndOnlyAPickedFileIsDownloaded() {
        play(subtitlesOn = false)
        await { PlayerHolder.openSubtitles.value.size == 2 }
        assertEquals("Nothing is downloaded before a track is shown", listOf(lookupUrl), requests.toList())
        assertNull(extraConfig())

        openSubtitlesMenu()
        rule.onNode(hasClickAction() and hasText("Off")).assertExists()
        rule.onNode(hasClickAction() and hasText("English (OpenSubtitles)")).assertExists()
        rule.onNode(hasTestTag("opensubtitles-credit") and hasText(ExtrasApi.CREDIT)).assertExists()

        // A file that can't be loaded: Off, with a short notice.
        rule.onNode(hasClickAction() and hasText("English (OpenSubtitles 2)")).performClick()
        await { Toasts.message == SUBTITLES_FAILED }
        assertTrue(C.TRACK_TYPE_TEXT in PlayerHolder.player.trackSelectionParameters.disabledTrackTypes)
        assertNull(PlayerHolder.attachedOpenSubtitlesId)

        openSubtitlesMenu()
        rule.onNode(hasClickAction() and hasText("English (OpenSubtitles)")).performClick()
        await { extraConfig() != null }
        val config = extraConfig()!!
        assertEquals("opensubtitles:$good", config.id)
        assertEquals("file", config.uri.scheme)
        assertEquals(MimeTypes.TEXT_VTT, config.mimeType)
        assertEquals("en", config.language)
        assertEquals("English (OpenSubtitles)", config.label)
        assertEquals(good, PlayerHolder.attachedOpenSubtitlesId)
        assertEquals(listOf(lookupUrl, fileUrl(bad), fileUrl(good)), requests.toList())
    }

    @Test fun withSubtitlesOnTheFirstTrackIsAttachedWhenTheTitleStarts() {
        // Every item the player is given: attached at start means one item, not a start and a reload.
        val items = CopyOnWriteArrayList<MediaItem?>()
        val listener = object : androidx.media3.common.Player.Listener {
            override fun onMediaItemTransition(mediaItem: MediaItem?, reason: Int) { items += mediaItem }
        }
        rule.runOnIdle { PlayerHolder.player.addListener(listener) }
        try {
            play(subtitlesOn = true)
            await { PlayerHolder.player.currentMediaItem != null }
            rule.waitForIdle()
            assertEquals("opensubtitles:$good", extraConfig()?.id)
            assertEquals(listOf(lookupUrl, fileUrl(good)), requests.toList())
            assertEquals(1, items.size)
        } finally { rule.runOnIdle { PlayerHolder.player.removeListener(listener) } }
    }

    @Test fun aLookupThatAnswersLateIsAttachedByReloadingAtThePosition() {
        lookupGate = CompletableDeferred()
        play(subtitlesOn = true)
        await { requests.isNotEmpty() }
        assertNull(PlayerHolder.player.currentMediaItem)
        // At most 1.5 seconds of waiting, then the title starts without subtitles.
        shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(1_600))
        await { PlayerHolder.player.currentMediaItem != null }
        assertNull(extraConfig())
        lookupGate!!.complete(Unit)
        await { extraConfig() != null }
        assertEquals("opensubtitles:$good", extraConfig()!!.id)
        assertEquals(request.url, PlayerHolder.player.currentMediaItem!!.localConfiguration!!.uri.toString())
    }

    @Test fun aProviderEnglishFileMeansNoDownloadAtStart() {
        play(subtitlesOn = true, vod = request.copy(subtitles = listOf(tv.lumanest.tuner.data.ExternalSubtitle("http://127.0.0.1:${server.localPort}/sub/en.srt", "en"))))
        await { PlayerHolder.openSubtitles.value.size == 2 }
        assertEquals(listOf(lookupUrl), requests.toList())
        assertNull(extraConfig())
        assertEquals("provider:0", PlayerHolder.player.currentMediaItem!!.localConfiguration!!.subtitleConfigurations.single().id)
    }

    /** A short real MP4 over http (the player opens no local file but the subtitle copy): Media3 prepares it and lists its tracks. */
    private val media get() = request.copy(url = "http://127.0.0.1:${server.localPort}$mediaPath")
    private fun textGroups() = PlayerHolder.player.currentTracks.groups.filter { it.type == C.TRACK_TYPE_TEXT }

    @Test fun theTrackAttachedAtStartIsShownAndListedOnceAsChosen() {
        play(subtitlesOn = true, vod = media)
        await { textGroups().any { it.isSelected } }
        val group = textGroups().single()
        // Media3 puts the source's place before the id the app gave the track.
        assertTrue(group.getTrackFormat(0).id!!.endsWith(":opensubtitles:$good"))
        assertEquals("opensubtitles:$good", PlayerHolder.sideLoadedId(group.getTrackFormat(0)))
        assertEquals(SubtitleChoice.Source.OPENSUBTITLES, PlayerHolder.textSource(group.getTrackFormat(0)))
        await { PlayerHolder.openSubtitles.value.size == 2 }
        openSubtitlesMenu()
        rule.onAllNodesWithText("English (OpenSubtitles)").assertCountEquals(1)
        rule.onNode(hasClickAction() and hasText("English (OpenSubtitles)") and hasContentDescription("Selected")).assertExists()
        rule.onNode(hasClickAction() and hasText("Off") and hasContentDescription("Selected")).assertDoesNotExist()
    }

    /** The player really reads the attached copy from the device: a file: link inside SubtitleFiles' folder. */
    @Test fun thePlayerReadsTheAttachedCopyFromTheDevice() {
        val loaded = CopyOnWriteArrayList<String>()
        val failed = CopyOnWriteArrayList<String>()
        val listener = object : AnalyticsListener {
            override fun onLoadCompleted(eventTime: AnalyticsListener.EventTime, loadEventInfo: LoadEventInfo, mediaLoadData: MediaLoadData) {
                // Media3 reports a side-loaded file's loads with no track type: the item's own loads are http.
                if (loadEventInfo.dataSpec.uri.scheme == "file") loaded += "${loadEventInfo.uri} ${loadEventInfo.bytesLoaded}"
            }
            override fun onLoadError(eventTime: AnalyticsListener.EventTime, loadEventInfo: LoadEventInfo, mediaLoadData: MediaLoadData, error: java.io.IOException, wasCanceled: Boolean) {
                failed += "${loadEventInfo.uri} $error"
            }
        }
        rule.runOnIdle { PlayerHolder.player.addAnalyticsListener(listener) }
        try {
            play(subtitlesOn = true, vod = media)
            await { loaded.isNotEmpty() || failed.isNotEmpty() }
            assertEquals(emptyList<String>(), failed.toList())
            val copy = java.io.File(extraConfig()!!.uri.path!!).canonicalFile
            assertEquals("${android.net.Uri.fromFile(copy)} ${vtt.toByteArray().size}", loaded.first())
        } finally { rule.runOnIdle { PlayerHolder.player.removeAnalyticsListener(listener) } }
    }

    @Test fun aPickedTrackIsShownOnceTheReloadedItemListsIt() {
        play(subtitlesOn = false, vod = media)
        await { PlayerHolder.openSubtitles.value.size == 2 && PlayerHolder.player.currentTracks.groups.isNotEmpty() }
        assertTrue(textGroups().isEmpty())
        openSubtitlesMenu()
        rule.onNode(hasClickAction() and hasText("English (OpenSubtitles)")).performClick()
        await { textGroups().any { it.isSelected } }
        assertEquals("opensubtitles:$good", PlayerHolder.sideLoadedId(textGroups().single { it.isSelected }.getTrackFormat(0)))
        assertTrue(C.TRACK_TYPE_TEXT !in PlayerHolder.player.trackSelectionParameters.disabledTrackTypes)
    }

    @Test fun providerFilesAndStreamTracksAreToldApartAfterTheMerge() {
        fun id(value: String?) = androidx.media3.common.Format.Builder().setId(value).build()
        assertEquals(SubtitleChoice.Source.OPENSUBTITLES, PlayerHolder.textSource(id("2:opensubtitles:1-a")))
        assertEquals(SubtitleChoice.Source.PROVIDER, PlayerHolder.textSource(id("1:provider:0")))
        assertEquals(SubtitleChoice.Source.STREAM, PlayerHolder.textSource(id("0:3")))
        assertEquals(SubtitleChoice.Source.STREAM, PlayerHolder.textSource(id(null)))
        assertEquals(SubtitleChoice.Source.STREAM, PlayerHolder.textSource(id("x:opensubtitles:1-a")))
    }

    /**
     * Security review finding 7: a playlist entry or a link inside an HLS manifest that names a local file (here the
     * same MP4 the tests above play over http) fails as an unsupported scheme instead of being read.
     */
    @Test fun aLocalFileFromAPlaylistOrAManifestIsNeverOpened() {
        for (url in listOf(localFixture, "http://127.0.0.1:${server.localPort}$hlsPath")) {
            rule.runOnIdle { PlayerHolder.play(url, live = false) }
            // Media3 retries a failed load a few times, a second or more apart, before giving up.
            rule.waitUntil(timeoutMillis = 20_000) {
                shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(500))
                PlayerHolder.player.playerError != null
            }
            val error = PlayerHolder.player.playerError!!
            assertEquals(url, PlaybackException.ERROR_CODE_FAILED_RUNTIME_CHECK, error.errorCode)
            assertTrue(url, generateSequence<Throwable>(error) { it.cause }.any { it is DataSourceException && it.message == "unsupported scheme" })
            assertTrue(url, PlayerHolder.player.currentTracks.groups.isEmpty())
        }
    }

    @Test fun liveChannelsNeverLookUp() {
        rule.runOnIdle {
            PlayerHolder.play("http://127.0.0.1:${server.localPort}/live/1.ts", live = true, extras = SubtitleQuery.movie(ExtrasTitle(tmdb = 603)))
        }
        shadowOf(Looper.getMainLooper()).idle()
        rule.waitForIdle()
        assertTrue(requests.isEmpty())
        assertTrue(PlayerHolder.openSubtitles.value.isEmpty())
    }
}

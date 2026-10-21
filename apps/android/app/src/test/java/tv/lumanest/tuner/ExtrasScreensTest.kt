package tv.lumanest.tuner

import android.content.Context
import android.os.SystemClock
import android.view.KeyEvent
import android.view.View
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.snapshots.Snapshot
import androidx.lifecycle.Lifecycle
import androidx.compose.ui.input.InputMode
import androidx.compose.ui.input.InputModeManager
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.platform.LocalInputModeManager
import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.assertIsFocused
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performKeyInput
import androidx.compose.ui.test.performSemanticsAction
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.semantics.getAllSemanticsNodes
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.test.hasAnyAncestor
import androidx.compose.ui.test.pressKey
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import org.robolectric.shadows.ShadowDialog
import org.robolectric.shadows.ShadowSystemClock
import tv.lumanest.tuner.data.CatalogRows
import tv.lumanest.tuner.data.Episode
import tv.lumanest.tuner.data.ExtrasTitle
import tv.lumanest.tuner.data.PlayRequest
import tv.lumanest.tuner.data.SeriesInfo
import tv.lumanest.tuner.data.SubtitleQuery
import tv.lumanest.tuner.data.Trailer
import tv.lumanest.tuner.data.TrailerQuery
import tv.lumanest.tuner.ui.LocalTrailerSurfaces
import tv.lumanest.tuner.ui.Screen
import tv.lumanest.tuner.ui.TrailerCommand
import tv.lumanest.tuner.ui.TrailerEvent
import tv.lumanest.tuner.ui.TrailerSurface
import tv.lumanest.tuner.ui.TrailerSurfaces
import tv.lumanest.tuner.ui.TRAILER_GONE
import tv.lumanest.tuner.ui.TrailerPage
import tv.lumanest.tuner.ui.Toasts
import tv.lumanest.tuner.ui.rememberTrailer
import tv.lumanest.tuner.data.Extras
import tv.lumanest.tuner.data.ExtrasApi
import tv.lumanest.tuner.data.ExtrasClient
import tv.lumanest.tuner.data.Movie
import tv.lumanest.tuner.data.Repo
import tv.lumanest.tuner.data.Series
import tv.lumanest.tuner.data.Source
import tv.lumanest.tuner.data.SourceType
import tv.lumanest.tuner.ui.AppState
import tv.lumanest.tuner.ui.MovieDetailScreen
import tv.lumanest.tuner.ui.SeriesDetailScreen
import tv.lumanest.tuner.ui.SettingsScreen
import tv.lumanest.tuner.ui.Tab
import tv.lumanest.tuner.ui.TunerTheme
import java.util.concurrent.CopyOnWriteArrayList

/**
 * The Trailer button on movie and series pages, its player in Tuner (a stand-in plays the WebView's part), and the
 * OpenSubtitles credit in Settings > About (docs/extras.md).
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [34], qualifiers = "w960dp-h540dp-land-xhdpi")
@OptIn(androidx.compose.ui.ExperimentalComposeUiApi::class, ExperimentalTestApi::class)
class ExtrasScreensTest {
    @get:Rule val rule = createAndroidComposeRule<androidx.activity.ComponentActivity>()

    private val sourceId = "extras-screens-" + java.util.UUID.randomUUID()
    private val original = Extras.client
    private val requests = CopyOnWriteArrayList<String>()
    @Volatile private var gate: CompletableDeferred<Unit>? = null
    private val key = "vKQi3bBA1y8"
    private val withTrailer = """{"v":1,"status":"ok","tmdb":603,"trailer":{"key":"$key","name":"Official Trailer",
        "url":"https://www.youtube.com/watch?v=$key","short":"youtu.be/$key","qr":["1"]}}"""
    private val noTrailer = """{"v":1,"status":"none","tmdb":null,"trailer":null}"""

    /** The WebView player's stand-in: records what Tuner tells it; the test plays the page's part with [emit]. */
    private class FakePlayer(context: Context, val key: String, private val onEvent: (TrailerEvent) -> Unit) : TrailerSurface {
        override val view: View = View(context)
        val commands = CopyOnWriteArrayList<TrailerCommand>()
        /** Whether the page has spoken, so its port is there: as with the WebView, only then does a pause reach it. */
        @Volatile var connected = false
        val emit: (TrailerEvent) -> Unit = { connected = true; onEvent(it) }
        @Volatile var pauses = 0
        /** The pauses the page itself got (the ones after its port was there). */
        @Volatile var pagePauses = 0
        @Volatile var released = false
        /** For each command: whether Tuner's "Loading trailer" was on the player's screen when it was sent. */
        val underLoading = CopyOnWriteArrayList<Boolean>()
        override fun send(command: TrailerCommand) {
            check(!released)
            commands += command
            underLoading += ShadowDialog.getLatestDialog()?.window?.decorView?.let(::drawnIn).orEmpty().contains("trailer-loading")
        }
        override fun pause() { pauses++; if (connected) pagePauses++ }
        override fun resume() = Unit
        override fun release() { released = true }
    }

    private class FakeSurfaces : TrailerSurfaces {
        /** False: a TV whose WebView is missing or disabled. */
        @Volatile var webView = true
        val players = CopyOnWriteArrayList<FakePlayer>()
        /** For each WebView asked for: whether the player's window was already laid out ("Loading trailer" on screen). */
        val laidOutFirst = CopyOnWriteArrayList<Boolean>()
        /** For each WebView asked for: the texts and test tags on the player's screen just then. */
        val screenFirst = CopyOnWriteArrayList<Set<String>>()
        override fun create(context: Context, key: String, onEvent: (TrailerEvent) -> Unit): TrailerSurface? {
            val window = ShadowDialog.getLatestDialog()?.window?.decorView
            laidOutFirst += window?.isLaidOut == true
            screenFirst += window?.let(::drawnIn).orEmpty()
            return if (!webView) null else FakePlayer(context, key, onEvent).also { players += it }
        }
    }

    private val surfaces = FakeSurfaces()

    @Before fun seed() {
        Repo.init(rule.activity.applicationContext)
        Repo.prefs.saveSource(Source(sourceId, "Extras test", SourceType.M3U))
        Repo.prefs.setActive(sourceId)
        Repo.prefs.guidePreview = false
        Extras.client = ExtrasClient(fetch = { url, _, _ ->
            requests += url
            gate?.await()
            if ("tmdb=603" in url || "tmdb=1399" in url) withTrailer else noTrailer
        })
    }

    @After fun reset() {
        Extras.client = original
        Repo.prefs.libraryFavorites.value.forEach { Repo.prefs.toggleLibraryFavorite(it) }
        Repo.prefs.deleteSource(sourceId)
    }

    private fun mount(content: @Composable () -> Unit) {
        rule.setContent {
            CompositionLocalProvider(LocalInputModeManager provides object : InputModeManager {
                override val inputMode = InputMode.Keyboard
                override fun requestInputMode(inputMode: InputMode) = true
            }, LocalTrailerSurfaces provides surfaces) { TunerTheme { content() } }
        }
    }

    private fun await(check: () -> Boolean) {
        rule.waitUntil(timeoutMillis = 5_000) {
            org.robolectric.shadows.ShadowLooper.idleMainLooper()
            check()
        }
    }

    private fun press(key: Key) = rule.onRoot().performKeyInput { pressKey(key) }
    private fun hasTrailer() = rule.onAllNodesWithTag("trailer").fetchSemanticsNodes().isNotEmpty()
    private fun shown(tag: String) = rule.onAllNodesWithTag(tag).fetchSemanticsNodes().isNotEmpty()
    private fun focused(tag: String) = runCatching { rule.onNodeWithTag(tag).assertIsFocused() }.isSuccess

    /** Whatever Tuner draws inside the player's screen (texts, tagged parts, a progress indicator), besides the player. */
    private fun drawnOverPlayer(): List<String> =
        rule.onAllNodes(hasAnyAncestor(hasTestTag("trailer-player")), useUnmergedTree = true).fetchSemanticsNodes().mapNotNull { node ->
            node.config.getOrNull(SemanticsProperties.TestTag)
                ?: node.config.getOrNull(SemanticsProperties.Text)?.joinToString()
                ?: node.config.getOrNull(SemanticsProperties.ProgressBarRangeInfo)?.let { "progress" }
        }

    /** Whether the player keeps the TV's screen on (a view in its window asks to). */
    private fun keepsScreenOn(): Boolean = rule.runOnIdle {
        fun on(v: View): Boolean = v.keepScreenOn || (v is android.view.ViewGroup && (0 until v.childCount).any { on(v.getChildAt(it)) })
        on(checkNotNull(ShadowDialog.getLatestDialog()).window!!.decorView)
    }

    /** Robolectric creates a dialog's window but does not deliver the OS window-focus event: this does. */
    private fun focusWindow(dialog: Boolean) = rule.runOnIdle {
        val window = if (dialog) checkNotNull(ShadowDialog.getLatestDialog()).window!! else rule.activity.window
        window.decorView.dispatchWindowFocusChanged(true)
        Snapshot.sendApplyNotifications()
    }

    /** Opens the player from the focused Trailer button: "Loading trailer" until its WebView (here a stand-in) is made. */
    private fun openPlayer(): FakePlayer {
        val count = surfaces.players.size
        rule.onNodeWithTag("trailer").performKeyInput { pressKey(Key.Enter) }
        await { surfaces.players.size == count + 1 && shown("trailer-player") }
        focusWindow(dialog = true)
        await { focused("trailer-player") }
        return surfaces.players.last()
    }

    /** A remote key pressed in the player's window, through the dialog as Android delivers it. */
    private fun remote(code: Int) {
        rule.runOnIdle {
            val dialog = checkNotNull(ShadowDialog.getLatestDialog())
            dialog.dispatchKeyEvent(KeyEvent(0L, 0L, KeyEvent.ACTION_DOWN, code, 0))
            dialog.dispatchKeyEvent(KeyEvent(0L, 50L, KeyEvent.ACTION_UP, code, 0))
        }
        rule.waitForIdle()
    }

    private fun emit(player: FakePlayer, event: TrailerEvent) {
        rule.runOnIdle { player.emit(event) }
        rule.waitForIdle()
    }

    /** Focus moves from Watch Movie to Add to Library to Trailer, the order docs/extras.md sets. */
    private fun focusTrailer() {
        rule.onNode(hasClickAction() and hasText("Watch Movie")).assertIsFocused()
        press(Key.DirectionRight)
        rule.onNode(hasClickAction() and hasText("Add to Library")).assertIsFocused()
        press(Key.DirectionRight)
        rule.onNodeWithTag("trailer").assertIsFocused()
    }

    /** After the player or the QR code closes, the focus is back on Trailer once the page's window has it. */
    private fun awaitFocusBackOnTrailer() {
        focusWindow(dialog = false)
        await { focused("trailer") }
    }
    private val matrix = Movie("m:1", "The Matrix", null, null, "1", "https://video.example/1.mp4", tmdb = "603")

    @Test fun aTrailerTunerCantPlayGoesToYouTubeAndWithoutYouTubeToAQrCode() {
        // Tuner's player can't play it (YouTube says error 150), and there is no YouTube app on this TV: every launch
        // fails, so the phone QR code shows.
        val tried = CopyOnWriteArrayList<android.content.Intent>()
        mount {
            val activity = androidx.compose.ui.platform.LocalContext.current
            val noYouTube = remember {
                object : android.content.ContextWrapper(activity) {
                    override fun startActivity(intent: android.content.Intent) { tried += intent; throw android.content.ActivityNotFoundException() }
                }
            }
            CompositionLocalProvider(androidx.compose.ui.platform.LocalContext provides noYouTube) { MovieDetailScreen(matrix, AppState(Tab.HOME)) }
        }
        await { hasTrailer() }
        assertEquals(listOf("https://lumanest.tv/api/extras/trailer?v=1&type=movie&tmdb=603"), requests.toList())
        focusTrailer()
        val player = openPlayer()
        assertEquals(key, player.key)
        assertTrue(tried.isEmpty())
        emit(player, TrailerEvent.Error(150))
        await { rule.onAllNodesWithText("Watch the trailer on your phone").fetchSemanticsNodes().isNotEmpty() }
        assertTrue(!shown("trailer-player"))
        assertTrue(player.released)
        assertEquals(6, tried.size)
        rule.onNodeWithText("youtu.be/$key").assertExists()
        rule.onNodeWithText("Scan the code with your phone's camera.").assertExists()
        rule.onNodeWithTag("trailer-qr").assertExists()
        // Robolectric creates the dialog's window but does not deliver the OS window-focus event.
        rule.runOnIdle {
            checkNotNull(org.robolectric.shadows.ShadowDialog.getLatestDialog()).window!!.decorView.dispatchWindowFocusChanged(true)
            androidx.compose.runtime.snapshots.Snapshot.sendApplyNotifications()
        }
        await { runCatching { rule.onNode(hasClickAction() and hasText("Close")).assertIsFocused() }.isSuccess }
        rule.onNode(hasClickAction() and hasText("Close")).performKeyInput { pressKey(Key.Enter) }
        rule.runOnIdle {
            rule.activity.window.decorView.dispatchWindowFocusChanged(true)
            androidx.compose.runtime.snapshots.Snapshot.sendApplyNotifications()
        }
        await { rule.onAllNodesWithText("Watch the trailer on your phone").fetchSemanticsNodes().isEmpty() }
        await { runCatching { rule.onNodeWithTag("trailer").assertIsFocused() }.isSuccess }
    }

    @Test fun aTvWithoutAWebViewOpensTheTvYouTubeApp() {
        surfaces.webView = false
        mount { MovieDetailScreen(matrix, AppState(Tab.HOME)) }
        await { hasTrailer() }
        rule.onNodeWithTag("trailer").performClick()
        rule.waitForIdle()
        val started = shadowOf(rule.activity).nextStartedActivity
        assertEquals("com.google.android.youtube.tv", started.`package`)
        assertEquals("https://www.youtube.com/watch?v=$key", started.dataString)
        assertTrue(rule.onAllNodesWithText("Watch the trailer on your phone").fetchSemanticsNodes().isEmpty())
        assertTrue(!shown("trailer-player"))
    }

    @Test fun theTrailerPlaysInTunerAndBackComesBackToTrailer() {
        mount { MovieDetailScreen(matrix, AppState(Tab.HOME)) }
        await { hasTrailer() }
        focusTrailer()
        val player = openPlayer()
        // The WebView was made once "Loading trailer" was on screen: starting the web engine doesn't freeze the page.
        assertEquals(listOf(true), surfaces.laidOutFirst.toList())
        // Until then: "Loading trailer", the trailer's name and the remote's keys.
        val loading = surfaces.screenFirst.single()
        listOf("trailer-loading", "Loading trailer", "Official Trailer", "trailer-keys", TrailerPage.KEYS).forEach { assertTrue(it, it in loading) }
        // They stay over the WebView while its page loads (a TV's web engine can take a while to paint anything: never
        // a black screen), and nothing is asked to play meanwhile...
        val overlay = listOf("trailer-loading", "progress", "Loading trailer", "Official Trailer", "trailer-keys")
        assertEquals(overlay, drawnOverPlayer())
        assertEquals(emptyList<TrailerCommand>(), player.commands.toList())
        // ...until YouTube's player is ready: then nothing of Tuner's over it (YouTube's Required Minimum Functionality,
        // "Overlays and frames"), and once a frame without "Loading trailer" has been drawn, Tuner starts the trailer
        // (the page doesn't autoplay: "Autoplay and scripted playbacks", only a player in view may start).
        emit(player, TrailerEvent.Ready)
        assertEquals(emptyList<String>(), drawnOverPlayer())
        await { player.commands.isNotEmpty() }
        assertEquals(listOf(TrailerCommand.PLAY), player.commands.toList())
        assertEquals(listOf(false), player.underLoading.toList())
        // Nothing comes back over it while it buffers, plays, after a remote key or a pause.
        emit(player, TrailerEvent.State(TrailerEvent.BUFFERING))
        assertEquals(emptyList<String>(), drawnOverPlayer())
        emit(player, TrailerEvent.State(TrailerEvent.PLAYING))
        assertEquals(emptyList<String>(), drawnOverPlayer())
        // The remote drives YouTube's player through the page; Up and Down do nothing and keep the focus.
        remote(KeyEvent.KEYCODE_DPAD_CENTER)
        remote(KeyEvent.KEYCODE_DPAD_LEFT)
        remote(KeyEvent.KEYCODE_DPAD_RIGHT)
        remote(KeyEvent.KEYCODE_DPAD_UP)
        remote(KeyEvent.KEYCODE_DPAD_DOWN)
        remote(KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE)
        remote(KeyEvent.KEYCODE_MEDIA_PAUSE)
        remote(KeyEvent.KEYCODE_MEDIA_PLAY)
        assertEquals(listOf(TrailerCommand.PLAY, TrailerCommand.TOGGLE, TrailerCommand.BACK, TrailerCommand.FORWARD, TrailerCommand.TOGGLE,
            TrailerCommand.PAUSE, TrailerCommand.PLAY), player.commands.toList())
        assertEquals(emptyList<String>(), drawnOverPlayer())
        emit(player, TrailerEvent.State(TrailerEvent.PAUSED))
        assertEquals(emptyList<String>(), drawnOverPlayer())
        assertTrue(focused("trailer-player"))
        // Back closes the player, frees its WebView and brings the focus back to Trailer: Tuner never left.
        remote(KeyEvent.KEYCODE_BACK)
        await { !shown("trailer-player") }
        assertTrue(player.released)
        awaitFocusBackOnTrailer()
        assertEquals(null, shadowOf(rule.activity).nextStartedActivity)
        assertEquals(1, requests.size)
    }

    @Test fun aTrailerYouTubeNoLongerHasClosesWithANoteAndOpensNothing() {
        Toasts.message = null
        mount { MovieDetailScreen(matrix, AppState(Tab.HOME)) }
        await { hasTrailer() }
        focusTrailer()
        val player = openPlayer()
        // The page moves its own focus meanwhile (as a series page does when its episodes arrive).
        rule.onNode(hasClickAction() and hasText("Watch Movie")).performSemanticsAction(SemanticsActions.RequestFocus) { it() }
        rule.waitForIdle()
        // Error 100: the video was removed or made private. The YouTube app couldn't play it either.
        emit(player, TrailerEvent.Error(100))
        await { !shown("trailer-player") }
        assertTrue(player.released)
        assertEquals(TRAILER_GONE, Toasts.message)
        assertEquals(null, shadowOf(rule.activity).nextStartedActivity)
        assertTrue(rule.onAllNodesWithText("Watch the trailer on your phone").fetchSemanticsNodes().isEmpty())
        awaitFocusBackOnTrailer()
        Toasts.message = null
    }

    @Test fun thePlayerClosesWhenTheTrailerEndsOrOnStop() {
        mount { MovieDetailScreen(matrix, AppState(Tab.HOME)) }
        await { hasTrailer() }
        focusTrailer()
        val first = openPlayer()
        emit(first, TrailerEvent.Ready)
        emit(first, TrailerEvent.State(TrailerEvent.PLAYING))
        emit(first, TrailerEvent.State(TrailerEvent.ENDED))
        await { !shown("trailer-player") }
        assertTrue(first.released)
        awaitFocusBackOnTrailer()
        val second = openPlayer()
        emit(second, TrailerEvent.Ready)
        remote(KeyEvent.KEYCODE_MEDIA_STOP)
        await { !shown("trailer-player") }
        assertTrue(second.released)
        awaitFocusBackOnTrailer()
        // A YouTube link in the player (its logo or title, with a mouse) opened the YouTube app: the player closes, and
        // nothing more is opened (no fallback, no QR code).
        val third = openPlayer()
        emit(third, TrailerEvent.Ready)
        emit(third, TrailerEvent.Left)
        await { !shown("trailer-player") }
        assertTrue(third.released)
        assertTrue(rule.onAllNodesWithText("Watch the trailer on your phone").fetchSemanticsNodes().isEmpty())
        awaitFocusBackOnTrailer()
        assertEquals(null, shadowOf(rule.activity).nextStartedActivity)
    }

    @Test fun aPlayerThatIsntReadyInTwelveSecondsGoesToTheYouTubeApp() {
        mount { MovieDetailScreen(matrix, AppState(Tab.HOME)) }
        await { hasTrailer() }
        focusTrailer()
        val player = openPlayer()
        rule.mainClock.advanceTimeBy(11_000)
        rule.waitForIdle()
        assertTrue(shown("trailer-player"))
        assertEquals(null, shadowOf(rule.activity).nextStartedActivity)
        rule.mainClock.advanceTimeBy(1_100)
        await { !shown("trailer-player") }
        assertTrue(player.released)
        val started = shadowOf(rule.activity).nextStartedActivity
        assertEquals("com.google.android.youtube.tv", started.`package`)
        assertEquals("https://www.youtube.com/watch?v=$key", started.dataString)
        // A late answer from the page changes nothing.
        rule.runOnIdle { player.emit(TrailerEvent.Error(150)) }
        rule.waitForIdle()
        assertEquals(null, shadowOf(rule.activity).nextStartedActivity)
    }

    @Test fun aReadyTrailerThatDoesntPlayWithinTenSecondsGoesToTheYouTubeApp() {
        mount { MovieDetailScreen(matrix, AppState(Tab.HOME)) }
        await { hasTrailer() }
        focusTrailer()
        val player = openPlayer()
        rule.mainClock.advanceTimeBy(5_000)
        emit(player, TrailerEvent.Ready)
        // Ready, in view and asked to play, but YouTube never says it plays (playback refused, a picture that never
        // comes, endless buffering): after 10 seconds the trailer goes to the YouTube app, never a black screen.
        emit(player, TrailerEvent.State(-1))
        emit(player, TrailerEvent.State(TrailerEvent.BUFFERING))
        rule.mainClock.advanceTimeBy(9_000)
        rule.waitForIdle()
        assertTrue(shown("trailer-player"))
        assertEquals(emptyList<String>(), drawnOverPlayer())
        assertEquals(listOf(TrailerCommand.PLAY), player.commands.toList())
        assertEquals(null, shadowOf(rule.activity).nextStartedActivity)
        rule.mainClock.advanceTimeBy(1_100)
        await { !shown("trailer-player") }
        assertTrue(player.released)
        val started = shadowOf(rule.activity).nextStartedActivity
        assertEquals("com.google.android.youtube.tv", started.`package`)
        assertEquals("https://www.youtube.com/watch?v=$key", started.dataString)
        // A late answer from the page changes nothing.
        rule.runOnIdle { player.emit(TrailerEvent.State(TrailerEvent.PLAYING)) }
        rule.waitForIdle()
        assertEquals(null, shadowOf(rule.activity).nextStartedActivity)
        awaitFocusBackOnTrailer()
    }

    @Test fun aTrailerThatPlaysOrThatTheViewerControlsStaysInTuner() {
        mount { MovieDetailScreen(matrix, AppState(Tab.HOME)) }
        await { hasTrailer() }
        focusTrailer()
        // It plays: the trailer stays however long it plays.
        val playing = openPlayer()
        emit(playing, TrailerEvent.Ready)
        emit(playing, TrailerEvent.State(TrailerEvent.PLAYING))
        assertTrue(!shown("trailer-loading"))
        rule.mainClock.advanceTimeBy(30_000)
        rule.waitForIdle()
        assertTrue(shown("trailer-player"))
        assertEquals(null, shadowOf(rule.activity).nextStartedActivity)
        remote(KeyEvent.KEYCODE_BACK)
        await { !shown("trailer-player") }
        awaitFocusBackOnTrailer()
        // OK before the page is ready reaches nothing: "Loading trailer" stays until the player is ready, which Tuner
        // then starts. OK once it is ready is the viewer's choice: here pausing it before it ever played, so it waits
        // for OK however long.
        val paused = openPlayer()
        remote(KeyEvent.KEYCODE_DPAD_CENTER)
        assertTrue(shown("trailer-loading"))
        emit(paused, TrailerEvent.Ready)
        await { !shown("trailer-loading") }
        await { paused.commands.size == 2 }
        remote(KeyEvent.KEYCODE_DPAD_CENTER)
        assertEquals(emptyList<String>(), drawnOverPlayer())
        emit(paused, TrailerEvent.State(TrailerEvent.PAUSED))
        assertEquals(listOf(TrailerCommand.TOGGLE, TrailerCommand.PLAY, TrailerCommand.TOGGLE), paused.commands.toList())
        rule.mainClock.advanceTimeBy(30_000)
        rule.waitForIdle()
        assertTrue(shown("trailer-player"))
        assertTrue(!paused.released)
        assertEquals(null, shadowOf(rule.activity).nextStartedActivity)
    }

    @Test fun aSeekOrOkWhileTheTrailerDoesntPlayGivesItTenSecondsMoreAndNoMore() {
        mount { MovieDetailScreen(matrix, AppState(Tab.HOME)) }
        await { hasTrailer() }
        focusTrailer()
        // An impatient viewer presses Right on a trailer that buffers and never plays: the count starts again from the
        // key, and 10 seconds later the trailer goes to the YouTube app all the same, never an endless black screen.
        val seeking = openPlayer()
        emit(seeking, TrailerEvent.Ready)
        await { seeking.commands.size == 1 }
        emit(seeking, TrailerEvent.State(TrailerEvent.BUFFERING))
        rule.mainClock.advanceTimeBy(6_000)
        rule.waitForIdle()
        remote(KeyEvent.KEYCODE_DPAD_RIGHT)
        emit(seeking, TrailerEvent.State(TrailerEvent.BUFFERING))
        rule.mainClock.advanceTimeBy(9_000)
        rule.waitForIdle()
        assertTrue(shown("trailer-player"))
        assertEquals(null, shadowOf(rule.activity).nextStartedActivity)
        rule.mainClock.advanceTimeBy(1_100)
        await { !shown("trailer-player") }
        assertTrue(seeking.released)
        assertEquals(listOf(TrailerCommand.PLAY, TrailerCommand.FORWARD), seeking.commands.toList())
        assertEquals("com.google.android.youtube.tv", shadowOf(rule.activity).nextStartedActivity.`package`)
        awaitFocusBackOnTrailer()
        // OK on a player that hasn't started (the page plays it): the same, 10 seconds from the key.
        val starting = openPlayer()
        emit(starting, TrailerEvent.Ready)
        await { starting.commands.size == 1 }
        emit(starting, TrailerEvent.State(-1))
        rule.mainClock.advanceTimeBy(6_000)
        rule.waitForIdle()
        remote(KeyEvent.KEYCODE_DPAD_CENTER)
        emit(starting, TrailerEvent.State(TrailerEvent.BUFFERING))
        rule.mainClock.advanceTimeBy(9_000)
        rule.waitForIdle()
        assertTrue(shown("trailer-player"))
        assertEquals(null, shadowOf(rule.activity).nextStartedActivity)
        rule.mainClock.advanceTimeBy(1_100)
        await { !shown("trailer-player") }
        assertTrue(starting.released)
        assertEquals("com.google.android.youtube.tv", shadowOf(rule.activity).nextStartedActivity.`package`)
        awaitFocusBackOnTrailer()
    }

    @Test fun aTrailerTheViewerControlledWaitsPausedWhenTunerIsBackAndOkGivesItTenSecondsToPlay() {
        mount { MovieDetailScreen(matrix, AppState(Tab.HOME)) }
        await { hasTrailer() }
        focusTrailer()
        val player = openPlayer()
        emit(player, TrailerEvent.Ready)
        await { player.commands.size == 1 }
        emit(player, TrailerEvent.State(TrailerEvent.BUFFERING))
        remote(KeyEvent.KEYCODE_DPAD_RIGHT)
        // A voice assistant comes over Tuner: the trailer pauses, and when Tuner is back it waits, paused, for OK (the
        // viewer had taken it over), however long.
        rule.activityRule.scenario.moveToState(Lifecycle.State.STARTED)
        rule.waitForIdle()
        emit(player, TrailerEvent.State(TrailerEvent.PAUSED))
        rule.activityRule.scenario.moveToState(Lifecycle.State.RESUMED)
        await { shown("trailer-player") }
        rule.mainClock.advanceTimeBy(30_000)
        rule.waitForIdle()
        assertTrue(shown("trailer-player"))
        assertEquals(listOf(TrailerCommand.PLAY, TrailerCommand.FORWARD), player.commands.toList())
        assertEquals(null, shadowOf(rule.activity).nextStartedActivity)
        // OK: it is the viewer's again, and if it still doesn't play, 10 seconds later the YouTube app.
        focusWindow(dialog = true)
        remote(KeyEvent.KEYCODE_DPAD_CENTER)
        emit(player, TrailerEvent.State(TrailerEvent.BUFFERING))
        rule.mainClock.advanceTimeBy(9_000)
        rule.waitForIdle()
        assertTrue(shown("trailer-player"))
        assertEquals(null, shadowOf(rule.activity).nextStartedActivity)
        rule.mainClock.advanceTimeBy(1_100)
        await { !shown("trailer-player") }
        assertEquals(listOf(TrailerCommand.PLAY, TrailerCommand.FORWARD, TrailerCommand.TOGGLE), player.commands.toList())
        assertEquals("com.google.android.youtube.tv", shadowOf(rule.activity).nextStartedActivity.`package`)
        awaitFocusBackOnTrailer()
    }

    @Test fun aTrailerWhoseTimeStandsStillWhileItSaysItPlaysGoesToTheYouTubeApp() {
        mount { MovieDetailScreen(matrix, AppState(Tab.HOME)) }
        await { hasTrailer() }
        focusTrailer()
        val player = openPlayer()
        emit(player, TrailerEvent.Ready)
        emit(player, TrailerEvent.State(TrailerEvent.PLAYING))
        // The page's snapshots (stamped by the app's clock as they arrive), as YouTube's API reads them: 0.00 with the
        // state change, then its time moves, then stands at 6 s (read as 7.00: the API adds up to a second while playing).
        val base = SystemClock.elapsedRealtime()
        fun at(time: Double, ms: Long) = emit(player, TrailerEvent.Progress(TrailerEvent.PLAYING, time, base + ms))
        at(0.0, 0); at(2.0, 2_000); at(4.0, 4_000); at(7.0, 6_000); at(7.0, 10_000); at(7.0, 15_999)
        assertTrue(shown("trailer-player"))
        assertEquals(null, shadowOf(rule.activity).nextStartedActivity)
        at(7.0, 16_000)
        await { !shown("trailer-player") }
        assertTrue(player.released)
        assertEquals("com.google.android.youtube.tv", shadowOf(rule.activity).nextStartedActivity.`package`)
        awaitFocusBackOnTrailer()
    }

    @Test fun pausingTheAppPausesTheTrailerAndStoppingItClosesThePlayer() {
        mount { MovieDetailScreen(matrix, AppState(Tab.HOME)) }
        await { hasTrailer() }
        focusTrailer()
        val player = openPlayer()
        emit(player, TrailerEvent.Ready)
        rule.activityRule.scenario.moveToState(Lifecycle.State.STARTED)
        rule.waitForIdle()
        // Paused (the test framework sees no screen of a paused activity): the player stays, its trailer paused.
        assertEquals(1, player.pauses)
        assertTrue(!player.released)
        rule.activityRule.scenario.moveToState(Lifecycle.State.CREATED)
        rule.waitForIdle()
        assertTrue(player.released)
        // Back in the app: the details page, with the focus on Trailer.
        rule.activityRule.scenario.moveToState(Lifecycle.State.RESUMED)
        await { !shown("trailer-player") }
        awaitFocusBackOnTrailer()
        assertEquals(1, player.pauses)
    }

    @Test fun aReadyTrailerTunerPausedBeforeItPlayedPlaysOnWhenTunerIsBack() {
        mount { MovieDetailScreen(matrix, AppState(Tab.HOME)) }
        await { hasTrailer() }
        focusTrailer()
        val player = openPlayer()
        emit(player, TrailerEvent.Ready)
        await { player.commands.size == 1 }
        // The settings panel comes over Tuner before the trailer plays, and goes: Tuner paused the trailer, and while
        // Tuner is paused it never goes to the YouTube app for not playing.
        rule.activityRule.scenario.moveToState(Lifecycle.State.STARTED)
        rule.waitForIdle()
        assertEquals(1, player.pagePauses)
        rule.mainClock.advanceTimeBy(30_000)
        rule.waitForIdle()
        assertTrue(!player.released)
        assertEquals(null, shadowOf(rule.activity).nextStartedActivity)
        rule.activityRule.scenario.moveToState(Lifecycle.State.RESUMED)
        await { shown("trailer-player") }
        // Tuner is back: the trailer, which Tuner had started once it was in view, plays on, with nothing over it.
        assertEquals(listOf(TrailerCommand.PLAY, TrailerCommand.PLAY), player.commands.toList())
        assertEquals(emptyList<String>(), drawnOverPlayer())
        emit(player, TrailerEvent.State(TrailerEvent.PLAYING))
        assertEquals(emptyList<String>(), drawnOverPlayer())
        rule.mainClock.advanceTimeBy(30_000)
        rule.waitForIdle()
        assertTrue(shown("trailer-player"))
        assertTrue(!player.released)
        assertEquals(null, shadowOf(rule.activity).nextStartedActivity)
    }

    @Test fun aTrailerTheViewerHasSeenWaitsPausedForOkWhenTunerIsBack() {
        mount { MovieDetailScreen(matrix, AppState(Tab.HOME)) }
        await { hasTrailer() }
        focusTrailer()
        val player = openPlayer()
        emit(player, TrailerEvent.Ready)
        await { player.commands.size == 1 }
        emit(player, TrailerEvent.State(TrailerEvent.PLAYING))
        rule.activityRule.scenario.moveToState(Lifecycle.State.STARTED)
        rule.waitForIdle()
        assertEquals(1, player.pagePauses)
        emit(player, TrailerEvent.State(TrailerEvent.PAUSED))
        rule.activityRule.scenario.moveToState(Lifecycle.State.RESUMED)
        await { shown("trailer-player") }
        // YouTube's paused player, nothing over it, and nothing sent since Tuner started it: it waits for OK, however long.
        assertEquals(listOf(TrailerCommand.PLAY), player.commands.toList())
        assertEquals(emptyList<String>(), drawnOverPlayer())
        rule.mainClock.advanceTimeBy(30_000)
        rule.waitForIdle()
        assertTrue(shown("trailer-player"))
        assertEquals(null, shadowOf(rule.activity).nextStartedActivity)
        focusWindow(dialog = true)
        remote(KeyEvent.KEYCODE_DPAD_CENTER)
        assertEquals(listOf(TrailerCommand.PLAY, TrailerCommand.TOGGLE), player.commands.toList())
    }

    @Test fun aTrailerThatGetsReadyWhileTheAppIsPausedPlaysOnWhenTunerIsBack() {
        mount { MovieDetailScreen(matrix, AppState(Tab.HOME)) }
        await { hasTrailer() }
        focusTrailer()
        val player = openPlayer()
        // A voice assistant or the settings panel comes over Tuner while the trailer still loads: the page has no port
        // yet, so that pause reaches nothing.
        rule.activityRule.scenario.moveToState(Lifecycle.State.STARTED)
        rule.waitForIdle()
        assertEquals(1, player.pauses)
        assertEquals(0, player.pagePauses)
        // The page gets ready meanwhile: it doesn't autoplay, and Tuner doesn't start it while it is paused.
        emit(player, TrailerEvent.Ready)
        rule.mainClock.advanceTimeBy(1_000)
        rule.waitForIdle()
        assertEquals(0, player.pagePauses)
        assertEquals(emptyList<TrailerCommand>(), player.commands.toList())
        assertTrue(!player.released)
        // Back in Tuner: the player is there, nothing over it, and its trailer starts.
        rule.activityRule.scenario.moveToState(Lifecycle.State.RESUMED)
        await { shown("trailer-player") }
        assertEquals(0, player.pagePauses)
        assertEquals(listOf(TrailerCommand.PLAY), player.commands.toList())
        assertTrue(!player.released)
        // It still doesn't play 10 seconds after Tuner is back: the YouTube app, never a black screen.
        rule.mainClock.advanceTimeBy(9_000)
        rule.waitForIdle()
        assertTrue(shown("trailer-player"))
        assertEquals(listOf(TrailerCommand.PLAY), player.commands.toList())
        assertEquals(emptyList<String>(), drawnOverPlayer())
        assertEquals(null, shadowOf(rule.activity).nextStartedActivity)
        rule.mainClock.advanceTimeBy(1_100)
        await { !shown("trailer-player") }
        assertTrue(player.released)
        assertEquals("com.google.android.youtube.tv", shadowOf(rule.activity).nextStartedActivity.`package`)
        awaitFocusBackOnTrailer()
    }

    @Test fun anAdOfYouTubesBeforeTheTrailerShowsWithNothingOverItAndTheTrailerFollows() {
        mount { MovieDetailScreen(matrix, AppState(Tab.HOME)) }
        await { hasTrailer() }
        focusTrailer()
        val player = openPlayer()
        // YouTube reports its own ad apart (onAdStateChange): the trailer's state stays -1 meanwhile.
        emit(player, TrailerEvent.Ready)
        emit(player, TrailerEvent.State(-1))
        emit(player, TrailerEvent.Ad(-1))
        emit(player, TrailerEvent.Ad(TrailerEvent.BUFFERING))
        assertEquals(emptyList<String>(), drawnOverPlayer())
        emit(player, TrailerEvent.Ad(TrailerEvent.PLAYING))
        // The ad plays: nothing of Tuner's over it, the screen stays on, and the trailer waits for it, however long.
        assertEquals(emptyList<String>(), drawnOverPlayer())
        assertTrue(keepsScreenOn())
        rule.mainClock.advanceTimeBy(30_000)
        rule.waitForIdle()
        assertTrue(shown("trailer-player"))
        assertEquals(null, shadowOf(rule.activity).nextStartedActivity)
        // Its end isn't the trailer's: the trailer follows, and plays on with nothing over it.
        emit(player, TrailerEvent.Ad(TrailerEvent.ENDED))
        assertTrue(shown("trailer-player"))
        emit(player, TrailerEvent.State(TrailerEvent.BUFFERING))
        emit(player, TrailerEvent.State(TrailerEvent.PLAYING))
        assertEquals(emptyList<String>(), drawnOverPlayer())
        rule.mainClock.advanceTimeBy(30_000)
        rule.waitForIdle()
        assertTrue(shown("trailer-player"))
        assertTrue(!player.released)
        assertEquals(null, shadowOf(rule.activity).nextStartedActivity)
    }

    @Test fun aTrailerThatDoesntFollowItsAdWithinTenSecondsGoesToTheYouTubeApp() {
        mount { MovieDetailScreen(matrix, AppState(Tab.HOME)) }
        await { hasTrailer() }
        focusTrailer()
        val player = openPlayer()
        emit(player, TrailerEvent.Ready)
        emit(player, TrailerEvent.Ad(TrailerEvent.PLAYING))
        rule.mainClock.advanceTimeBy(20_000)
        rule.waitForIdle()
        emit(player, TrailerEvent.Ad(TrailerEvent.ENDED))
        // YouTube's player has shown the ad: "Loading trailer" doesn't come back over it, but the trailer has 10 seconds.
        rule.mainClock.advanceTimeBy(9_000)
        rule.waitForIdle()
        assertEquals(emptyList<String>(), drawnOverPlayer())
        assertEquals(null, shadowOf(rule.activity).nextStartedActivity)
        rule.mainClock.advanceTimeBy(1_100)
        await { !shown("trailer-player") }
        assertTrue(player.released)
        assertEquals("com.google.android.youtube.tv", shadowOf(rule.activity).nextStartedActivity.`package`)
        awaitFocusBackOnTrailer()
    }

    @Test fun aTrailerWhosePageFallsSilentWhileItPlaysGoesToTheYouTubeApp() {
        mount { MovieDetailScreen(matrix, AppState(Tab.HOME)) }
        await { hasTrailer() }
        focusTrailer()
        val player = openPlayer()
        emit(player, TrailerEvent.Ready)
        emit(player, TrailerEvent.State(TrailerEvent.PLAYING))
        emit(player, TrailerEvent.Progress(TrailerEvent.PLAYING, 0.0, SystemClock.elapsedRealtime()))
        // Then nothing from the page, which sends a snapshot every 2 seconds (its renderer hung).
        ShadowSystemClock.advanceBy(java.time.Duration.ofMillis(9_000))
        rule.mainClock.advanceTimeBy(2_100)
        rule.waitForIdle()
        assertTrue(shown("trailer-player"))
        assertEquals(null, shadowOf(rule.activity).nextStartedActivity)
        ShadowSystemClock.advanceBy(java.time.Duration.ofMillis(1_000))
        rule.mainClock.advanceTimeBy(2_100)
        await { !shown("trailer-player") }
        assertTrue(player.released)
        assertEquals("com.google.android.youtube.tv", shadowOf(rule.activity).nextStartedActivity.`package`)
        awaitFocusBackOnTrailer()
    }

    @Test fun anAnswerTheSessionHasIsOnThePagesFirstFrame() {
        val query = TrailerQuery(ExtrasTitle(tmdb = 603), tv = false)
        // A card's prefetch already asked.
        kotlinx.coroutines.runBlocking { Extras.client.trailer(query) }
        assertEquals(1, requests.size)
        val firstFrame = mutableListOf<Trailer?>()
        mount {
            val trailer by rememberTrailer(query)
            if (firstFrame.isEmpty()) firstFrame += trailer
        }
        rule.waitForIdle()
        assertEquals(listOf(Trailer(key, "Official Trailer")), firstFrame)
        assertEquals(1, requests.size)
    }

    @Test fun anAnswerOnItsWayIsSharedWithThePage() {
        gate = CompletableDeferred()
        val query = TrailerQuery(ExtrasTitle(tmdb = 603), tv = false)
        val firstFrame = mutableListOf<Trailer?>()
        val latest = mutableListOf<Trailer?>()
        // A card's prefetch, still on its way when the page opens.
        CoroutineScope(Dispatchers.Default).launch { Extras.client.trailer(query) }
        await { requests.size == 1 }
        mount {
            val trailer by rememberTrailer(query)
            if (firstFrame.isEmpty()) firstFrame += trailer
            latest += trailer
        }
        rule.waitForIdle()
        assertEquals(listOf<Trailer?>(null), firstFrame)
        gate!!.complete(Unit)
        await { latest.lastOrNull() != null }
        assertEquals(Trailer(key, "Official Trailer"), latest.last())
        assertEquals(1, requests.size)
    }

    @Test fun aTrailerThatArrivesLateNeverTakesTheFocus() {
        gate = CompletableDeferred()
        mount { MovieDetailScreen(matrix, AppState(Tab.HOME)) }
        await { requests.isNotEmpty() && runCatching { rule.onNode(hasClickAction() and hasText("Watch Movie")).assertIsFocused() }.isSuccess }
        assertTrue(!hasTrailer())
        gate!!.complete(Unit)
        await { hasTrailer() }
        rule.onNode(hasClickAction() and hasText("Watch Movie")).assertIsFocused()
    }

    @Test fun noTrailerNoButtonAndATitleWithoutAnIdIsLookedUpByNameAndYear() {
        val heat = Movie("m:2", "Heat", null, null, "1", "https://video.example/2.mp4", year = "1995")
        mount { MovieDetailScreen(heat, AppState(Tab.HOME)) }
        await { requests.isNotEmpty() }
        rule.waitForIdle()
        assertEquals(listOf("https://lumanest.tv/api/extras/trailer?v=1&type=movie&name=Heat&year=1995"), requests.toList())
        assertTrue(!hasTrailer())
        rule.onNode(hasClickAction() and hasText("Add to Library")).assertExists()
    }

    @Test fun aTitleWithoutAnIdOrYearIsNotLookedUp() {
        val unknown = Movie("m:3", "Mystery", null, null, "1", "https://video.example/3.mp4")
        mount { MovieDetailScreen(unknown, AppState(Tab.HOME)) }
        await { runCatching { rule.onNode(hasClickAction() and hasText("Watch Movie")).assertIsFocused() }.isSuccess }
        rule.waitForIdle()
        assertTrue(requests.isEmpty())
    }

    @Test fun theSeriesPageOffersItsTrailerAfterAddToLibrary() {
        val show = Series("9", "Thrones", null, "Plot", null, "1", null, "2011", null, tmdb = "1399")
        mount { SeriesDetailScreen(show, AppState(Tab.HOME)) }
        // This playlist has no Xtream server: the episode list can't load, and the buttons stay.
        await { rule.onAllNodesWithText("Couldn't load episodes").fetchSemanticsNodes().isNotEmpty() && hasTrailer() }
        assertEquals(listOf("https://lumanest.tv/api/extras/trailer?v=1&type=tv&tmdb=1399"), requests.toList())
        rule.onNodeWithText("Try again").assertIsFocused()
        press(Key.DirectionRight)
        rule.onNode(hasClickAction() and hasText("Add to Library")).assertIsFocused()
        press(Key.DirectionRight)
        rule.onNodeWithTag("trailer").assertIsFocused()
    }

    @Test fun episodesThatFinishLoadingWhileTheTrailerPlaysLeaveItPlaying() {
        // A slow IPTV panel: its series info answers only when the test lets it.
        val panel = java.net.ServerSocket(0)
        val answer = java.util.concurrent.CountDownLatch(1)
        val workers = java.util.concurrent.Executors.newCachedThreadPool()
        workers.submit {
            while (!panel.isClosed) runCatching {
                val connection = panel.accept()
                workers.submit {
                    connection.use {
                        val reader = it.getInputStream().bufferedReader()
                        while (reader.readLine()?.isNotEmpty() == true) Unit
                        answer.await(20, java.util.concurrent.TimeUnit.SECONDS)
                        val body = """{"info":{"name":"Thrones"},"episodes":{"1":[{"id":"e-slow-1","episode_num":"1","title":"Pilot","container_extension":"mp4","season":"1"}]}}""".toByteArray()
                        it.getOutputStream().apply {
                            write("HTTP/1.1 200 OK\r\nContent-Length: ${body.size}\r\nConnection: close\r\n\r\n".toByteArray())
                            write(body)
                            flush()
                        }
                    }
                }
            }
        }
        val xtream = "extras-slow-panel-" + java.util.UUID.randomUUID()
        val show = Series("s-trailer-while-loading", "Thrones", null, "Plot", null, "1", null, "2011", null, tmdb = "1399")
        @Suppress("UNCHECKED_CAST")
        val infos = Repo::class.java.getDeclaredField("seriesInfoCache").apply { isAccessible = true }.get(null) as MutableMap<String, SeriesInfo>
        try {
            Repo.prefs.saveSource(Source(xtream, "Slow panel", SourceType.XTREAM, server = "http://127.0.0.1:${panel.localPort}", username = "u", password = "p"))
            Repo.prefs.setActive(xtream)
            mount { SeriesDetailScreen(show, AppState(Tab.HOME)) }
            // The trailer is known while the episodes still load: the viewer chooses it.
            await { hasTrailer() && rule.onAllNodesWithText("Loading episodes…").fetchSemanticsNodes().isNotEmpty() }
            rule.onNodeWithTag("trailer").performClick()
            await { surfaces.players.size == 1 && shown("trailer-player") }
            focusWindow(dialog = true)
            await { focused("trailer-player") }
            val player = surfaces.players.single()
            emit(player, TrailerEvent.Ready)
            emit(player, TrailerEvent.State(TrailerEvent.PLAYING))
            // The panel answers while the trailer plays: the page shows its episodes, and the trailer plays on.
            answer.countDown()
            await { rule.onAllNodesWithText("Loading episodes…").fetchSemanticsNodes().isEmpty() }
            rule.onNode(hasClickAction() and hasText("Watch Series")).assertExists()
            assertTrue("the player stays open", shown("trailer-player"))
            assertTrue("its WebView is kept", !player.released)
            assertEquals(1, surfaces.players.size)
            // Back closes it, and the focus comes back to Trailer (not to Watch Series, which the loaded page asked for).
            remote(KeyEvent.KEYCODE_BACK)
            await { !shown("trailer-player") }
            assertTrue(player.released)
            awaitFocusBackOnTrailer()
        } finally {
            answer.countDown()
            infos.remove(show.id)
            Repo.prefs.deleteSource(xtream)
            panel.close()
            workers.shutdownNow()
        }
    }

    @Test fun watchMovieLooksItsSubtitlesUpByItsTmdbId() {
        val state = AppState(Tab.HOME)
        mount { MovieDetailScreen(matrix, state) }
        await { runCatching { rule.onNode(hasClickAction() and hasText("Watch Movie")).assertIsFocused() }.isSuccess }
        rule.onNode(hasClickAction() and hasText("Watch Movie")).performClick()
        rule.runOnIdle {
            val request = (state.top as Screen.Player).request as PlayRequest.Vod
            assertEquals(SubtitleQuery(ExtrasTitle(tmdb = 603)), request.extras)
        }
    }

    @Test fun episodesLookTheirSubtitlesUpByTheSeriesIdAndTheirNumbers() {
        val show = Series("s-extras", "Thrones", null, "Plot", null, "1", null, "2011", null, tmdb = "1399")
        fun episode(id: String, season: Int, number: Int) = Episode(id, season, number, "Episode $number", null, null, 0, "https://video.example/$id.mp4")
        @Suppress("UNCHECKED_CAST")
        val infos = Repo::class.java.getDeclaredField("seriesInfoCache").apply { isAccessible = true }.get(null) as MutableMap<String, SeriesInfo>
        infos[show.id] = SeriesInfo(null, null, null, null, null, mapOf(1 to listOf(episode("e:3", 1, 3), episode("e:4", 1, 4)), 2 to listOf(episode("e:9", 2, 0))))
        try {
            val state = AppState(Tab.HOME)
            mount { SeriesDetailScreen(show, state) }
            await { rule.onAllNodes(hasClickAction() and hasText("Watch Series")).fetchSemanticsNodes().isNotEmpty() }
            rule.onNode(hasClickAction() and hasText("Watch Series")).performClick()
            rule.runOnIdle {
                val request = (state.top as Screen.Player).request as PlayRequest.Vod
                assertEquals(SubtitleQuery(ExtrasTitle(tmdb = 1399), season = 1, episode = 3), request.extras)
                // The queued episodes have their own numbers; one without an episode number gets no lookup.
                assertEquals(listOf(SubtitleQuery(ExtrasTitle(tmdb = 1399), season = 1, episode = 4), null), request.queue.map { it.extras })
            }
        } finally { infos.remove(show.id) }
    }

    /** Tall enough for every Settings row to be composed at once. */
    @Test @Config(qualifiers = "w960dp-h3000dp-mdpi")
    fun aboutShowsTheOpenSubtitlesCreditInBothEditionsWithoutTmdb() {
        Repo.catalogRows.value = CatalogRows.NONE
        val store = androidx.compose.runtime.mutableStateOf(false)
        rule.setContent { TunerTheme { SettingsScreen(AppState(Tab.SETTINGS), store = store.value) } }
        rule.waitForIdle()
        rule.onNode(hasTestTag("setting:opensubtitles") and hasText(ExtrasApi.CREDIT)).assertExists()
        rule.onNodeWithText("About").assertExists()
        rule.runOnIdle { store.value = true }
        rule.waitForIdle()
        rule.onNode(hasTestTag("setting:opensubtitles") and hasText(ExtrasApi.CREDIT)).assertExists()
        assertEquals("Subtitles provided by OpenSubtitles.com", ExtrasApi.CREDIT)
    }
}

/** The texts and test tags Compose has drawn in [view]'s window (read as the test framework does, without waiting). */
private fun drawnIn(view: View): Set<String> {
    val roots = mutableListOf<androidx.compose.ui.node.RootForTest>()
    fun walk(v: View) {
        if (v is androidx.compose.ui.node.RootForTest) roots += v
        if (v is android.view.ViewGroup) for (i in 0 until v.childCount) walk(v.getChildAt(i))
    }
    walk(view)
    return roots.flatMap { it.semanticsOwner.getAllSemanticsNodes(mergingEnabled = false, skipDeactivatedNodes = true) }.flatMap { node ->
        node.config.getOrNull(SemanticsProperties.Text).orEmpty().map { it.text } + listOfNotNull(node.config.getOrNull(SemanticsProperties.TestTag))
    }.toSet()
}

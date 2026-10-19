package tv.lumanest.tuner

import android.os.Looper
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.snapshots.Snapshot
import androidx.compose.ui.input.InputMode
import androidx.compose.ui.input.InputModeManager
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.platform.LocalInputModeManager
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import tv.lumanest.tuner.data.*
import tv.lumanest.tuner.ui.*
import org.junit.Assert.*
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/**
 * The browse index (matching and sorting every title) is built off the main thread: the remote keeps working while a
 * full library prepares, a refresh of the same playlist keeps the focused poster, and an older playlist's build can
 * never publish into a newer one.
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [34], qualifiers = "w960dp-h540dp-land-xhdpi")
@OptIn(androidx.compose.ui.ExperimentalComposeUiApi::class, ExperimentalTestApi::class)
class BrowseResponsivenessTest {
    @get:Rule val rule = createAndroidComposeRule<androidx.activity.ComponentActivity>()

    /** Holds the first build that reads it until released; a later build (of a newer playlist) reads it freely. */
    private class HeldLibrary(private val values: List<Movie>) : AbstractList<Movie>() {
        val started = CountDownLatch(1)
        val release = CountDownLatch(1)
        private val holder = java.util.concurrent.atomic.AtomicReference<Thread?>(null)
        override val size get() = values.size
        override fun get(index: Int): Movie {
            check(Looper.myLooper() != Looper.getMainLooper()) { "The full movie library was scanned on the UI thread" }
            holder.compareAndSet(null, Thread.currentThread())
            if (holder.get() === Thread.currentThread()) {
                started.countDown()
                check(release.await(10, TimeUnit.SECONDS)) { "The preparation fixture was never released" }
            }
            return values[index]
        }
        // StateFlow compares its previous value before publication; this fixture measures
        // preparation, without blocking that separate equality check during a source switch.
        override fun equals(other: Any?) = this === other
        override fun hashCode() = System.identityHashCode(this)
    }

    @Before fun seed() {
        Repo.init(rule.activity.applicationContext)
        Repo.prefs.saveSource(Source("browse-large-a", "Large fixture", SourceType.M3U))
        Repo.prefs.setActive("browse-large-a")
        Repo.prefs.guidePreview = false
        Repo.prefs.setVodUsOnly(true)
        Repo.catalogRows.value = CatalogRows.NONE
        Repo.channels.value = emptyList()
        Repo.trending.value = emptyList()
        Repo.movies.value = emptyList()
        Repo.movieCategories.value = listOf(Category("a", "First"), Category("b", "Second"), Category("c", "Third"))
        Repo.series.value = emptyList()
        Repo.seriesCategories.value = emptyList()
        Repo.liveStatus.value = LoadStatus.Ready
        Repo.vodStatus.value = LoadStatus.Ready
        Repo.seriesStatus.value = LoadStatus.Ready
        // Start from this empty library's own index, not one an earlier test left behind.
        val deadline = System.currentTimeMillis() + 5_000
        while (Repo.browse.value?.let { it.movies === Repo.movies.value && it.series === Repo.series.value && it.source?.id == "browse-large-a" } != true) {
            check(System.currentTimeMillis() < deadline) { "The browse index never caught up" }
            Thread.sleep(10)
        }
        rule.mainClock.autoAdvance = false
    }

    private fun mount(state: AppState) {
        rule.setContent {
            CompositionLocalProvider(LocalInputModeManager provides object : InputModeManager {
                override val inputMode = InputMode.Keyboard
                override fun requestInputMode(inputMode: InputMode) = true
            }) { TunerTheme { HomeScreen(state, store = false) } }
        }
    }

    private fun await(check: () -> Boolean) {
        rule.waitUntil(timeoutMillis = 5_000) {
            org.robolectric.shadows.ShadowLooper.idleMainLooper()
            rule.runOnIdle { Snapshot.sendApplyNotifications() }
            rule.mainClock.advanceTimeByFrame()
            check()
        }
    }

    /** 12,700 films; "Movie 1" is the newest upload, so a refresh moves it to the front of Recently added. */
    private fun library() = HeldLibrary((0 until 12_700).map { index ->
        Movie("m:$index", "Movie $index", null, "9.95", "a", "https://example.invalid/$index.mp4",
            added = if (index == 1) 99_999L else index + 1L, categoryIds = listOf("a", "b", "c"))
    })

    private fun smallLibrary(prefix: String = "", name: String = "Movie") = HeldLibrary((0 until 6).map { index ->
        Movie("m:$prefix$index", "$name $index", null, null, "a", "https://example.invalid/$prefix$index.mp4", added = index + 1L)
    }).apply { release.countDown() }

    private fun card(key: String) = rule.onNodeWithTag("card:home:movies:recent:movie:$key")

    @Test fun sameAccountRefreshKeepsTheFocusedPosterAndRestoresItAfterItMoves() {
        Repo.movies.value = smallLibrary()
        val state = AppState(Tab.HOME)
        val updated = library()
        try {
            mount(state)
            await { state.lastFocusedKey == "home:movies:recent:movie:m:5" && !state.restoreFocus }
            card("m:1").performSemanticsAction(SemanticsActions.RequestFocus) { it() }
            rule.runOnIdle { Repo.movies.value = updated }
            await { updated.started.count == 0L }
            card("m:1").assertIsFocused()
            rule.onNodeWithTag("browse-preparing:home").assertDoesNotExist()
            rule.runOnIdle { assertEquals("home:movies:recent:movie:m:1", state.lastFocusedKey); assertFalse(state.restoreFocus) }
            updated.release.countDown()
            // The newest upload moved from the fifth poster to the first: the same title keeps remote focus.
            await { rule.onAllNodesWithTag("card:home:movies:recent:movie:m:12699").fetchSemanticsNodes().isNotEmpty() &&
                state.lastFocusedKey == "home:movies:recent:movie:m:1" && !state.restoreFocus }
            card("m:1").assertIsFocused()
            rule.runOnIdle { assertEquals(0, state.rowState("home:movies:recent").firstVisibleItemIndex) }
            rule.runOnIdle { Repo.movies.value = smallLibrary("new", "Available replacement") }
            await { state.lastFocusedKey == "home:movies:recent:movie:m:new5" && !state.restoreFocus }
            card("m:new5").assertIsFocused()
        } finally { updated.release.countDown() }
    }

    @Test fun completedRefreshDoesNotStealFocusFromNavigation() {
        Repo.movies.value = smallLibrary()
        val state = AppState(Tab.HOME)
        val updated = library()
        try {
            mount(state)
            await { state.lastFocusedKey == "home:movies:recent:movie:m:5" }
            rule.runOnIdle { Repo.movies.value = updated }
            await { updated.started.count == 0L }
            rule.onRoot().performKeyInput { pressKey(Key.Menu) }
            await { state.navigationFocused && state.navigationRequest == state.handledNavigationRequest }
            rule.onNodeWithContentDescription("Home").assertIsFocused()
            updated.release.countDown()
            await { rule.onAllNodesWithTag("card:home:movies:recent:movie:m:12699").fetchSemanticsNodes().isNotEmpty() }
            rule.onNodeWithContentDescription("Home").assertIsFocused()
            rule.runOnIdle { assertFalse(state.restoreFocus); assertEquals(Tab.HOME, state.tab) }
        } finally { updated.release.countDown() }
    }

    @Test fun remoteNavigationRemainsUsableWhileTheFullLibraryPrepares() {
        val library = library()
        Repo.movies.value = library
        val state = AppState(Tab.HOME)
        try {
            mount(state)
            await { library.started.count == 0L }
            rule.onNodeWithTag("browse-preparing:home").assertExists()
            rule.onNodeWithContentDescription("Home").performSemanticsAction(SemanticsActions.RequestFocus) { it() }
            rule.onRoot().performKeyInput { pressKey(Key.DirectionRight) }
            rule.onNodeWithContentDescription("Live TV").assertIsFocused()
            rule.runOnIdle { assertEquals(Tab.HOME, state.tab) }
            rule.onRoot().performKeyInput { pressKey(Key.Enter) }
            await { state.tab == Tab.GUIDE }
            rule.onNodeWithContentDescription("Discover").assertExists()
            library.release.countDown()
            rule.onNodeWithContentDescription("Home").performClick()
            await { state.lastFocusedKey == "home:movies:recent:movie:m:1" && !state.restoreFocus }
            rule.onNodeWithTag("browse-content:home").assertExists()
            card("m:1").assertIsFocused()
        } finally { library.release.countDown() }
    }

    @Test fun aCancelledOldAccountPreparationCannotPublishIntoTheNewLibrary() {
        val library = library()
        Repo.movies.value = library
        val state = AppState(Tab.HOME)
        try {
            mount(state)
            await { library.started.count == 0L }
            rule.runOnIdle {
                Repo.prefs.saveSource(Source("browse-large-b", "New fixture", SourceType.M3U))
                Repo.prefs.setActive("browse-large-b")
                Repo.movies.value = smallLibrary("new", "Replacement Movie")
                Repo.movieCategories.value = listOf(Category("a", "New library"))
            }
            await { state.lastFocusedKey == "home:movies:recent:movie:m:new5" && Repo.browse.value?.source?.id == "browse-large-b" }
            rule.onNodeWithTag("browse-content:home").assertExists()
            library.release.countDown()
            // Deliver the cancelled build's completion and more frames; its titles must stay out of the new library.
            repeat(20) { rule.mainClock.advanceTimeByFrame(); org.robolectric.shadows.ShadowLooper.idleMainLooper() }
            Thread.sleep(300)
            await { rule.onAllNodesWithText("Replacement Movie 5").fetchSemanticsNodes().isNotEmpty() }
            rule.onAllNodesWithText("Movie 12699").assertCountEquals(0)
            rule.runOnIdle { assertEquals(6, Repo.browse.value!!.catalog.movies.titles.size) }
            card("m:new5").assertIsFocused()
            rule.runOnIdle { assertEquals(Screen.Home, state.top) }
        } finally { library.release.countDown() }
    }
}

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

@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [34], qualifiers = "w960dp-h540dp-land-xhdpi")
@OptIn(androidx.compose.ui.ExperimentalComposeUiApi::class, ExperimentalTestApi::class)
class BrowseResponsivenessTest {
    @get:Rule val rule = createAndroidComposeRule<androidx.activity.ComponentActivity>()

    private class HeldLibrary(private val values: List<Movie>) : AbstractList<Movie>() {
        val started = CountDownLatch(1)
        val release = CountDownLatch(1)
        override val size get() = values.size
        override fun get(index: Int): Movie {
            check(Looper.myLooper() != Looper.getMainLooper()) { "The full movie library was scanned on the UI thread" }
            started.countDown()
            check(release.await(10, TimeUnit.SECONDS)) { "The preparation fixture was never released" }
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
        Repo.channels.value = emptyList()
        Repo.trending.value = emptyList()
        Repo.movies.value = emptyList()
        Repo.movieCategories.value = listOf(Category("a", "First"), Category("b", "Second"), Category("c", "Third"))
        Repo.series.value = emptyList()
        Repo.seriesCategories.value = emptyList()
        Repo.liveStatus.value = LoadStatus.Ready
        Repo.vodStatus.value = LoadStatus.Ready
        Repo.seriesStatus.value = LoadStatus.Ready
        rule.mainClock.autoAdvance = false
    }

    private fun mount(state: AppState) {
        rule.setContent {
            CompositionLocalProvider(LocalInputModeManager provides object : InputModeManager {
                override val inputMode = InputMode.Keyboard
                override fun requestInputMode(inputMode: InputMode) = true
            }) { TunerTheme { HomeScreen(state) } }
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

    private fun library() = HeldLibrary((0 until 12_700).map { index ->
        Movie("m:$index", "Movie $index", null, "9.95", "a", "https://example.invalid/$index.mp4",
            added = index + 1L, categoryIds = listOf("a", "b", "c"))
    })

    private fun smallLibrary() = HeldLibrary((0 until 3).map { index ->
        Movie("m:$index", "Movie $index", null, "8", "a", "https://example.invalid/$index.mp4")
    }).apply { release.countDown() }

    @Test fun sameAccountRefreshKeepsTheFocusedCardAndRestoresItAfterRowsMove() {
        Repo.movies.value = smallLibrary()
        val state = AppState().apply { tab = Tab.MOVIES }
        val updated = library()
        try {
            mount(state)
            await { state.lastFocusedKey == "movies:ca:m:0" }
            rule.onNode(hasClickAction() and hasText("Movie 1")).performSemanticsAction(SemanticsActions.RequestFocus) { it() }
            rule.runOnIdle { Repo.movies.value = updated }
            await { updated.started.count == 0L }
            rule.onNode(hasClickAction() and hasText("Movie 1")).assertIsFocused()
            rule.onNodeWithTag("browse-preparing:movies").assertDoesNotExist()
            rule.runOnIdle { assertEquals("movies:ca:m:1", state.lastFocusedKey); assertFalse(state.restoreFocus) }
            updated.release.countDown()
            // Recently Added inserts a row ahead of the selected category. The same title
            // must remain reachable and focused rather than falling out of the lazy viewport.
            await { state.moviesList.firstVisibleItemIndex == 1 && state.lastFocusedKey == "movies:ca:m:1" && !state.restoreFocus }
            rule.onNode(hasClickAction() and hasText("Movie 1")).assertIsFocused()
            rule.runOnIdle {
                Repo.movies.value = listOf(Movie("m:new", "Available replacement", null, null, "a", "https://example.invalid/new.mp4"))
            }
            await { state.lastFocusedKey == "movies:ca:m:new" && !state.restoreFocus }
            rule.onNode(hasClickAction() and hasText("Available replacement")).assertIsFocused()
        } finally { updated.release.countDown() }
    }

    @Test fun completedRefreshDoesNotStealFocusFromNavigation() {
        Repo.movies.value = smallLibrary()
        val state = AppState().apply { tab = Tab.MOVIES }
        val updated = library()
        try {
            mount(state)
            await { state.lastFocusedKey == "movies:ca:m:0" }
            rule.runOnIdle { Repo.movies.value = updated }
            await { updated.started.count == 0L }
            rule.onRoot().performKeyInput { pressKey(Key.Menu) }
            await { state.navigationFocused && state.navigationRequest == state.handledNavigationRequest }
            rule.onNodeWithContentDescription("Movies").assertIsFocused()
            updated.release.countDown()
            await { rule.onAllNodesWithText("Movie 12699").fetchSemanticsNodes().isNotEmpty() }
            rule.onNodeWithContentDescription("Movies").assertIsFocused()
            rule.runOnIdle { assertFalse(state.restoreFocus); assertEquals(Tab.MOVIES, state.tab) }
        } finally { updated.release.countDown() }
    }

    @Test fun remoteNavigationRemainsUsableWhileTheFullLibraryPrepares() {
        val library = library()
        Repo.movies.value = library
        val state = AppState().apply { tab = Tab.MOVIES }
        try {
            mount(state)
            await { library.started.count == 0L }
            rule.onNodeWithTag("browse-preparing:movies").assertExists()
            rule.onNodeWithContentDescription("Movies").performSemanticsAction(SemanticsActions.RequestFocus) { it() }
            rule.onRoot().performKeyInput { pressKey(Key.DirectionRight) }
            rule.onNodeWithContentDescription("Series").assertIsFocused()
            rule.runOnIdle { assertEquals(Tab.MOVIES, state.tab) }
            rule.onRoot().performKeyInput { pressKey(Key.Enter) }
            await { state.tab == Tab.SERIES }
            rule.onNodeWithContentDescription("Live TV").assertExists()
            library.release.countDown()
            rule.onNodeWithContentDescription("Movies").performClick()
            await { state.lastFocusedKey == "movies:recent:m:12699" }
            rule.onNodeWithTag("browse-content:movies").assertExists()
            rule.onNode(hasClickAction() and hasText("Movie 12699")).assertIsFocused()
        } finally { library.release.countDown() }
    }

    @Test fun aCancelledOldAccountPreparationCannotPublishIntoTheNewLibrary() {
        val library = library()
        Repo.movies.value = library
        val state = AppState().apply { tab = Tab.MOVIES }
        try {
            mount(state)
            await { library.started.count == 0L }
            rule.runOnIdle {
                Repo.prefs.saveSource(Source("browse-large-b", "New fixture", SourceType.M3U))
                Repo.prefs.setActive("browse-large-b")
                Repo.movies.value = listOf(Movie("m:new", "Replacement Movie", null, null, "new", "https://example.invalid/new.mp4"))
                Repo.movieCategories.value = listOf(Category("new", "New library"))
            }
            await { state.lastFocusedKey == "movies:cnew:m:new" }
            rule.onNodeWithTag("browse-content:movies").assertExists()
            library.release.countDown()
            // Deliver the cancelled worker's completion and another frame; its previous
            // rows must remain absent while the new account's selected title stays focused.
            await { rule.onAllNodesWithText("Replacement Movie").fetchSemanticsNodes().isNotEmpty() }
            rule.onAllNodesWithText("Movie 12699").assertCountEquals(0)
            rule.onNode(hasClickAction() and hasText("Replacement Movie")).assertIsFocused()
            rule.runOnIdle { assertEquals(Screen.Home, state.top) }
        } finally { library.release.countDown() }
    }
}

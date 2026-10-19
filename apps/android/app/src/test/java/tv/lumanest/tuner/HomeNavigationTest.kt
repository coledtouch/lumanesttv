package tv.lumanest.tuner

import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.snapshots.Snapshot
import androidx.compose.ui.input.InputMode
import androidx.compose.ui.input.InputModeManager
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.platform.LocalInputModeManager
import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.assertIsFocused
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performKeyInput
import androidx.compose.ui.test.pressKey
import tv.lumanest.tuner.data.CatalogRows
import tv.lumanest.tuner.data.Category
import tv.lumanest.tuner.data.LoadStatus
import tv.lumanest.tuner.data.Movie
import tv.lumanest.tuner.data.Recent
import tv.lumanest.tuner.data.Repo
import tv.lumanest.tuner.data.Series
import tv.lumanest.tuner.data.Source
import tv.lumanest.tuner.data.SourceType
import tv.lumanest.tuner.ui.AppState
import tv.lumanest.tuner.ui.HomeScreen
import tv.lumanest.tuner.ui.Screen
import tv.lumanest.tuner.ui.Tab
import tv.lumanest.tuner.ui.TunerTheme
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [34], qualifiers = "w960dp-h540dp-land-xhdpi")
@OptIn(androidx.compose.ui.ExperimentalComposeUiApi::class, ExperimentalTestApi::class)
class HomeNavigationTest {
    @get:Rule val rule = createAndroidComposeRule<androidx.activity.ComponentActivity>()
    /** A playlist of its own, so its Library starts empty. */
    private val sourceId = "navigation-" + java.util.UUID.randomUUID()

    @org.junit.After fun removePlaylist() = Repo.prefs.deleteSource(sourceId)

    @Before fun seedCatalogs() {
        Repo.init(rule.activity.applicationContext)
        Repo.prefs.saveSource(Source(sourceId, "Navigation test", SourceType.M3U))
        Repo.prefs.setActive(sourceId)
        Repo.prefs.guidePreview = false
        Repo.prefs.setVodUsOnly(true)
        Repo.catalogRows.value = CatalogRows.NONE
        Repo.movieCategories.value = listOf(Category("films", "All Movies"))
        Repo.movies.value = (1..20).map { index -> Movie("m:$index", "Navigation Movie $index", null, null, "films", "https://video.example/$index.mp4", added = index.toLong()) }
        Repo.seriesCategories.value = listOf(Category("shows", "All Series"))
        Repo.series.value = (1..6).map { Series("show:$it", "Navigation Series $it", null, "Series synopsis", null, "shows", null, "2026", null, it.toLong()) }
        Repo.vodStatus.value = LoadStatus.Ready
        Repo.seriesStatus.value = LoadStatus.Ready
        Repo.liveStatus.value = LoadStatus.Ready
    }

    private fun mount(state: AppState) {
        rule.setContent {
            CompositionLocalProvider(LocalInputModeManager provides object : InputModeManager {
                override val inputMode = InputMode.Keyboard
                override fun requestInputMode(inputMode: InputMode) = true
            }) { TunerTheme { HomeScreen(state, store = false) } }
        }
        awaitFocus(state) { it.startsWith("home:") }
    }

    private fun await(check: () -> Boolean) {
        rule.waitUntil(timeoutMillis = 5_000) {
            org.robolectric.shadows.ShadowLooper.idleMainLooper()
            rule.runOnIdle { Snapshot.sendApplyNotifications() }
            rule.mainClock.advanceTimeByFrame()
            check()
        }
    }

    private fun awaitFocus(state: AppState, check: (String) -> Boolean) = await { state.lastFocusedKey?.let(check) == true && !state.restoreFocus }

    @Test fun backAndMenuReachActiveNavigationWithoutLosingTheHomeSelection() {
        val state = AppState(Tab.HOME)
        mount(state)
        rule.runOnIdle { assertEquals("home:movies:recent:movie:m:20", state.lastFocusedKey) }
        rule.onRoot().performKeyInput { repeat(4) { pressKey(Key.DirectionRight) } }
        rule.waitForIdle()
        var selectedKey: String? = null
        var scrollIndex = 0
        var scrollOffset = 0
        rule.runOnIdle {
            selectedKey = state.lastFocusedKey
            assertEquals("home:movies:recent:movie:m:16", selectedKey)
            scrollIndex = state.rowState("home:movies:recent").firstVisibleItemIndex
            scrollOffset = state.rowState("home:movies:recent").firstVisibleItemScrollOffset
            rule.activity.onBackPressedDispatcher.onBackPressed()
        }
        rule.waitForIdle()
        rule.onNodeWithContentDescription(Tab.HOME.title).assertIsFocused()
        rule.runOnIdle {
            assertEquals(Tab.HOME, state.tab)
            assertEquals(Screen.Home, state.top)
            assertEquals(selectedKey, state.lastFocusedKey)
        }
        // The remote's OK button returns to the remembered poster.
        rule.onRoot().performKeyInput { pressKey(Key.Enter) }
        rule.waitForIdle()
        rule.onNodeWithTag("card:$selectedKey").assertIsFocused()
        // Menu remains an optional shortcut for other remotes.
        rule.onRoot().performKeyInput { pressKey(Key.Menu) }
        rule.waitForIdle()
        rule.onNodeWithContentDescription(Tab.HOME.title).assertIsFocused()
        rule.runOnIdle {
            assertEquals(Tab.HOME, state.tab)
            assertEquals(selectedKey, state.lastFocusedKey)
            assertEquals(scrollIndex, state.rowState("home:movies:recent").firstVisibleItemIndex)
            assertEquals(scrollOffset, state.rowState("home:movies:recent").firstVisibleItemScrollOffset)
        }
    }

    @Test fun theTopBarListsTheDesignSectionsAndCrossingItOpensNothingUntilOk() {
        assertEquals(listOf("Home", "Live TV", "Discover", "Library", "Multi View", "Search", "Settings"), Tab.entries.map { it.title })
        val state = AppState(Tab.HOME)
        mount(state)
        rule.onRoot().performKeyInput { pressKey(Key.Menu) }
        rule.waitForIdle()
        rule.onNodeWithContentDescription(Tab.HOME.title).assertIsFocused()
        rule.onRoot().performKeyInput { pressKey(Key.DirectionRight) }
        rule.waitForIdle()
        rule.onNodeWithContentDescription(Tab.GUIDE.title).assertIsFocused()
        rule.onRoot().performKeyInput { pressKey(Key.DirectionRight) }
        rule.waitForIdle()
        rule.onNodeWithContentDescription(Tab.DISCOVER.title).assertIsFocused()
        rule.runOnIdle { assertEquals(Tab.HOME, state.tab); assertEquals(Screen.Home, state.top) }
        rule.onRoot().performKeyInput { pressKey(Key.Enter) }
        // Discover opens on the newest movies (no TMDB lists here) with the first poster focused.
        await { state.discover.focusedKey == "discover:movie:m:20" && !state.restoreFocus }
        rule.runOnIdle { assertEquals(Tab.DISCOVER, state.tab); assertEquals(null, state.discover.openedFrom) }
        rule.onNodeWithTag("card:discover:movie:m:20").assertIsFocused()
    }

    @Test fun backFromTheTopBarReturnsToTheSectionTheAppOpensOn() {
        val state = AppState(Tab.HOME)
        mount(state)
        rule.onRoot().performKeyInput { pressKey(Key.Menu) }
        rule.onRoot().performKeyInput { repeat(3) { pressKey(Key.DirectionRight) }; pressKey(Key.Enter) }
        rule.waitForIdle()
        rule.runOnIdle { assertEquals(Tab.LIBRARY, state.tab) }
        await { !state.restoreFocus }
        rule.onNodeWithTag("empty-action:Discover").assertIsFocused()
        // Library is empty here: its button to Discover takes focus. Back goes to the top bar, then to Home.
        rule.runOnIdle { rule.activity.onBackPressedDispatcher.onBackPressed() }
        rule.waitForIdle()
        rule.onNodeWithContentDescription(Tab.LIBRARY.title).assertIsFocused()
        rule.runOnIdle { rule.activity.onBackPressedDispatcher.onBackPressed() }
        rule.waitForIdle()
        rule.runOnIdle { assertEquals(Tab.HOME, state.tab) }
        rule.onNodeWithContentDescription(Tab.HOME.title).assertIsFocused()
        rule.runOnIdle { assertTrue(state.navigationFocused) }
    }

    @Test fun backFromTheTopBarFollowsTheStartOnSettingWithoutARestart() {
        val state = AppState(Tab.HOME)
        mount(state)
        try {
            rule.runOnIdle { Repo.prefs.setStartOnLiveTv(true) }
            rule.waitForIdle()
            rule.onRoot().performKeyInput { pressKey(Key.Menu) }
            rule.waitForIdle()
            rule.onNodeWithContentDescription(Tab.HOME.title).assertIsFocused()
            rule.runOnIdle { rule.activity.onBackPressedDispatcher.onBackPressed() }
            rule.waitForIdle()
            rule.runOnIdle { assertEquals(Tab.GUIDE, state.tab); assertEquals(Tab.GUIDE, state.startTab) }
            // And back to Home.
            rule.runOnIdle { Repo.prefs.setStartOnLiveTv(false) }
            rule.waitForIdle()
            rule.runOnIdle { assertEquals(Tab.HOME, state.startTab) }
        } finally {
            Repo.prefs.setStartOnLiveTv(false)
        }
    }

    @Test fun continueWatchingSeeAllOpensTheLibraryAndBackReturnsToTheTile() {
        val now = System.currentTimeMillis()
        (1..5).forEach { i ->
            Repo.prefs.saveProgress(Recent("m:$i", "Navigation Movie $i", null, null, "https://video.example/$i.mp4", 60_000, 6_000_000, now + i,
                titleKey = "movie:m:$i"))
        }
        val state = AppState(Tab.HOME)
        mount(state)
        rule.runOnIdle { assertEquals("home:continue:movie:m:5", state.lastFocusedKey) }
        rule.onRoot().performKeyInput { repeat(5) { pressKey(Key.DirectionRight) } }
        rule.waitForIdle()
        rule.onNodeWithTag("card:home:continue:see-all").assertIsFocused()
        rule.onRoot().performKeyInput { pressKey(Key.Enter) }
        await { state.tab == Tab.LIBRARY && state.rowFocus["library"] == "library:continue:movie:m:5" && !state.restoreFocus }
        rule.runOnIdle { assertEquals("home:continue:see-all", state.libraryOpenedFrom) }
        rule.runOnIdle { rule.activity.onBackPressedDispatcher.onBackPressed() }
        await { state.tab == Tab.HOME && !state.restoreFocus }
        rule.onNodeWithTag("card:home:continue:see-all").assertIsFocused()
        rule.runOnIdle { assertEquals(null, state.libraryOpenedFrom) }
        // Opened from the top bar, the Library's Back goes to the top bar as before.
        rule.onRoot().performKeyInput { pressKey(Key.Menu) }
        rule.onRoot().performKeyInput { repeat(3) { pressKey(Key.DirectionRight) }; pressKey(Key.Enter) }
        await { state.tab == Tab.LIBRARY && !state.restoreFocus }
        rule.runOnIdle { rule.activity.onBackPressedDispatcher.onBackPressed() }
        rule.waitForIdle()
        rule.runOnIdle { assertEquals(Tab.LIBRARY, state.tab); assertTrue(state.navigationFocused) }
    }
}

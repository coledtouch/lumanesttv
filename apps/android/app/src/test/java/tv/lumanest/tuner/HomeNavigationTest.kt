package tv.lumanest.tuner

import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.snapshots.Snapshot
import androidx.compose.ui.input.InputMode
import androidx.compose.ui.input.InputModeManager
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.platform.LocalInputModeManager
import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.assertIsFocused
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performKeyInput
import androidx.compose.ui.test.pressKey
import tv.lumanest.tuner.data.Category
import tv.lumanest.tuner.data.LoadStatus
import tv.lumanest.tuner.data.Movie
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

    @Before fun seedCatalogs() {
        Repo.init(rule.activity.applicationContext)
        Repo.prefs.saveSource(Source("navigation", "Navigation test", SourceType.M3U))
        Repo.prefs.setActive("navigation")
        Repo.prefs.guidePreview = false
        Repo.movieCategories.value = listOf(Category("films", "All Movies"))
        Repo.movies.value = (1..20).map { index -> Movie("m:$index", "Navigation Movie $index", null, null, "films", "https://video.example/$index.mp4") }
        Repo.seriesCategories.value = listOf(Category("shows", "All Series"))
        Repo.series.value = listOf(Series("show:1", "Navigation Series", null, "Series synopsis", null, "shows", null, "2026", null))
        Repo.vodStatus.value = LoadStatus.Ready
        Repo.seriesStatus.value = LoadStatus.Ready
        Repo.liveStatus.value = LoadStatus.Ready
    }

    private fun mount(state: AppState) {
        rule.setContent {
            CompositionLocalProvider(LocalInputModeManager provides object : InputModeManager {
                override val inputMode = InputMode.Keyboard
                override fun requestInputMode(inputMode: InputMode) = true
            }) { TunerTheme { HomeScreen(state) } }
        }
        awaitLibrary(state)
    }

    private fun awaitLibrary(state: AppState) {
        val prefix = if (state.tab == Tab.MOVIES) "movies:" else "series:"
        rule.waitUntil(timeoutMillis = 5_000) {
            org.robolectric.shadows.ShadowLooper.idleMainLooper()
            rule.runOnIdle { Snapshot.sendApplyNotifications() }
            rule.mainClock.advanceTimeByFrame()
            state.lastFocusedKey?.startsWith(prefix) == true && !state.restoreFocus
        }
    }

    @Test fun backAndMenuReachActiveNavigationWithoutLosingTheMovieSelection() {
        val state = AppState().apply { tab = Tab.MOVIES }
        mount(state)
        rule.onRoot().performKeyInput { repeat(4) { pressKey(Key.DirectionRight) } }
        rule.waitForIdle()
        var selectedKey: String? = null
        var scrollIndex = 0
        var scrollOffset = 0
        rule.runOnIdle {
            selectedKey = state.lastFocusedKey
            scrollIndex = state.rowState("movies:cfilms").firstVisibleItemIndex
            scrollOffset = state.rowState("movies:cfilms").firstVisibleItemScrollOffset
            rule.activity.onBackPressedDispatcher.onBackPressed()
        }
        rule.waitForIdle()
        rule.onNodeWithContentDescription(Tab.MOVIES.title).assertIsFocused()
        rule.runOnIdle {
            assertEquals(Tab.MOVIES, state.tab)
            assertEquals(Screen.Home, state.top)
            assertEquals(selectedKey, state.lastFocusedKey)
        }
        // The onn remote's OK button returns to the remembered card in the active library.
        val title = "Navigation Movie ${selectedKey!!.substringAfterLast("m:")}"
        rule.onRoot().performKeyInput { pressKey(Key.Enter) }
        rule.waitForIdle()
        rule.onNode(hasClickAction() and hasText(title)).assertIsFocused()
        // Menu remains an optional shortcut for other remotes.
        rule.onRoot().performKeyInput { pressKey(Key.Menu) }
        rule.waitForIdle()
        rule.onNodeWithContentDescription(Tab.MOVIES.title).assertIsFocused()
        rule.runOnIdle {
            assertEquals(Tab.MOVIES, state.tab)
            assertEquals(selectedKey, state.lastFocusedKey)
            assertEquals(scrollIndex, state.rowState("movies:cfilms").firstVisibleItemIndex)
            assertEquals(scrollOffset, state.rowState("movies:cfilms").firstVisibleItemScrollOffset)
        }
    }

    @Test fun crossingNavigationDoesNotOpenAnotherLibraryUntilOk() {
        val state = AppState().apply { tab = Tab.MOVIES }
        mount(state)
        rule.onRoot().performKeyInput { pressKey(Key.Menu) }
        rule.waitForIdle()
        rule.onNodeWithContentDescription(Tab.MOVIES.title).assertIsFocused()
        rule.onRoot().performKeyInput { pressKey(Key.DirectionRight) }
        rule.waitForIdle()
        rule.onNodeWithContentDescription(Tab.SERIES.title).assertIsFocused()
        rule.runOnIdle { assertEquals(Tab.MOVIES, state.tab); assertEquals(Screen.Home, state.top) }
        rule.onRoot().performKeyInput { pressKey(Key.Enter) }
        awaitLibrary(state)
        rule.runOnIdle { assertEquals(Tab.SERIES, state.tab); assertEquals(Screen.Home, state.top) }
        rule.onNode(hasClickAction() and hasText("Navigation Series")).assertIsFocused()
    }
}

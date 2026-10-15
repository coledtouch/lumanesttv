package tv.lumanest.tuner

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.snapshots.Snapshot
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.InputMode
import androidx.compose.ui.input.InputModeManager
import androidx.compose.ui.platform.LocalInputModeManager
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsFocused
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
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
import org.robolectric.shadows.ShadowLooper

@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [34], qualifiers = "w960dp-h540dp-land-xhdpi")
@OptIn(androidx.compose.ui.ExperimentalComposeUiApi::class)
class StreamingNavigationTest {
    @get:Rule val rule = createAndroidComposeRule<androidx.activity.ComponentActivity>()
    private val film = AddonTitle("tt123", "Test Film", "2026", description = "A long synopsis. ".repeat(80))
    private val show = AddonTitle("tt456", "Test Show", "2026")

    @Before fun initializeRepository() { Repo.init(rule.activity.applicationContext) }

    private fun state(title: AddonTitle = film, series: Boolean = false) = AppState().apply {
        stack.add(Screen.Torrentio)
        torrentioSeries = series
        torrentioBrowse.apply {
            initialized = true
            configuring = false
            catalogSeries = series
            sections = listOf(CatalogSection("test", "Test Catalog", "Catalog for this regression", listOf(CatalogCard(title)), loading = false))
        }
    }

    private fun mount(
        state: AppState,
        details: suspend (String, Boolean) -> AddonDetails = { _, _ -> AddonDetails(film, emptyList()) },
    ) {
        rule.setContent {
            CompositionLocalProvider(LocalInputModeManager provides object : InputModeManager {
                override val inputMode = InputMode.Keyboard
                override fun requestInputMode(inputMode: InputMode) = true
            }) {
                TunerTheme {
                    Box(Modifier.fillMaxSize()) {
                        if (state.top == Screen.Torrentio) TorrentioScreen(state, loadCatalog = false, detailsLoader = details,
                            streamsLoader = { _, _, _ -> AddonResults(listOf(AddonStream("Test stream", "", "https://stream.example/video.mp4")), 0) })
                        else androidx.compose.material3.Text("Player destination")
                    }
                }
            }
        }
        rule.waitForIdle()
    }

    private fun open(title: AddonTitle) {
        rule.onNode(hasClickAction() and hasText(title.name)).performClick()
        rule.waitForIdle()
    }

    @Test fun playerReturnKeepsTitleAndRestoresPlayWithoutRefetchingDetails() {
        val state = state()
        var detailCalls = 0
        mount(state) { _, _ -> detailCalls++; AddonDetails(film, emptyList()) }
        open(film)
        rule.onNodeWithText("Play movie").performClick()
        rule.runOnIdle { assertTrue(state.top is Screen.Player); assertEquals(film.id, state.torrentioBrowse.selected?.id) }
        rule.runOnIdle { state.pop(); Snapshot.sendApplyNotifications() }
        ShadowLooper.idleMainLooper()
        rule.waitForIdle()
        rule.onNodeWithText("Play movie").assertIsFocused()
        rule.runOnIdle { assertEquals(1, detailCalls); assertEquals(Screen.Torrentio, state.top) }
    }

    @Test fun visibleBackReturnsToCatalogAndRestoresTheSelectedCard() {
        val state = state()
        mount(state)
        open(film)
        rule.onNodeWithText("Back").performClick()
        rule.waitForIdle()
        rule.runOnIdle { assertEquals(Screen.Torrentio, state.top); assertNull(state.torrentioBrowse.selected) }
        rule.onNode(hasClickAction() and hasText(film.name)).assertIsFocused()
    }

    @Test fun unavailableMetadataDoesNotPreventMoviePlayback() {
        val state = state()
        mount(state) { _, _ -> throw IllegalStateException("Metadata unavailable") }
        open(film)
        rule.onNodeWithText("Retry details").assertExists()
        rule.onNodeWithText("Play movie").performClick()
        rule.runOnIdle { assertEquals("https://stream.example/video.mp4", (state.top as Screen.Player).request.let { (it as PlayRequest.Vod).url }) }
    }

    @Test fun seasonChoiceUsesNumericOrderAndPreservesEpisodeOnPlayerReturn() {
        val state = state(show, true)
        val episodes = listOf(AddonEpisode("tt456:2:1", 2, 1, "Season two premiere"), AddonEpisode("tt456:1:2", 1, 2, "Second episode"), AddonEpisode("tt456:1:1", 1, 1, "Premiere"))
        mount(state) { _, _ -> AddonDetails(show, episodes) }
        open(show)
        rule.onNodeWithText("Play S1 E1").assertExists()
        rule.onNodeWithText("Season 2").performClick()
        rule.onNodeWithText("Play S2 E1").performClick()
        rule.runOnIdle { assertEquals("tt456:2:1", state.torrentioVideoId); assertEquals(2, state.torrentioBrowse.selectedSeason) }
        rule.runOnIdle { state.pop(); Snapshot.sendApplyNotifications() }
        ShadowLooper.idleMainLooper()
        rule.waitForIdle()
        rule.onNodeWithText("Play S2 E1").assertIsFocused()
    }

    @Test fun optionsCloseReturnsFocusToTheDetailAction() {
        val state = state()
        mount(state)
        open(film)
        rule.onNodeWithText("Setup").performClick()
        rule.onNodeWithText("Done").performClick()
        rule.waitForIdle()
        rule.runOnIdle { assertEquals(film.id, state.torrentioBrowse.selected?.id); assertFalse(state.torrentioBrowse.configuring) }
        rule.onNodeWithText("Play movie").assertIsFocused()
    }

    @Config(sdk = [34], qualifiers = "w640dp-h360dp-land-xhdpi")
    @Test fun compactHeaderAndWatchActionStayReachable() {
        val state = state()
        mount(state)
        rule.onNodeWithText("Back").assertIsDisplayed()
        val right = rule.onNodeWithText("Back").fetchSemanticsNode().boundsInRoot.right
        rule.runOnIdle { assertTrue(right <= rule.activity.window.decorView.width.toFloat()) }
        open(film)
        rule.onNodeWithText("Play movie").assertIsDisplayed()
        rule.onNodeWithText("Play movie").assertIsFocused()
    }
}

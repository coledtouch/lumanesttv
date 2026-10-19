package tv.lumanest.tuner

import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.input.InputMode
import androidx.compose.ui.input.InputModeManager
import androidx.compose.ui.platform.LocalInputModeManager
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsFocused
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasScrollAction
import androidx.compose.ui.test.performKeyInput
import androidx.compose.ui.test.performScrollToNode
import androidx.compose.ui.test.pressKey
import androidx.compose.ui.test.requestFocus
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.onNodeWithTag
import tv.lumanest.tuner.data.CatalogRows
import tv.lumanest.tuner.data.Category
import tv.lumanest.tuner.data.LoadStatus
import tv.lumanest.tuner.data.Movie
import tv.lumanest.tuner.data.Repo
import tv.lumanest.tuner.data.Series
import tv.lumanest.tuner.data.Source
import tv.lumanest.tuner.data.SourceType
import tv.lumanest.tuner.data.VodType
import tv.lumanest.tuner.ui.AppState
import tv.lumanest.tuner.ui.EditSourceScreen
import tv.lumanest.tuner.ui.HomeScreen
import tv.lumanest.tuner.ui.SettingsScreen
import tv.lumanest.tuner.ui.Tab
import tv.lumanest.tuner.ui.TunerTheme
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * Settings and the add-playlist screen in both editions. The window is tall enough for every Settings row to be
 * composed at once, so a missing row really is missing rather than scrolled away.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], qualifiers = "w960dp-h3000dp-mdpi")
@OptIn(androidx.compose.ui.ExperimentalComposeUiApi::class, ExperimentalTestApi::class)
class StoreEditionScreensTest {
    @get:Rule val rule = createAndroidComposeRule<androidx.activity.ComponentActivity>()

    private fun show(content: @Composable () -> Unit) {
        Repo.init(rule.activity.applicationContext)
        rule.setContent {
            CompositionLocalProvider(LocalInputModeManager provides object : InputModeManager {
                override val inputMode = InputMode.Keyboard
                override fun requestInputMode(inputMode: InputMode) = true
            }) { TunerTheme { content() } }
        }
    }

    private fun absent(text: String) = rule.onAllNodes(hasText(text, substring = true, ignoreCase = true)).assertCountEquals(0)

    @Test fun storeSettingsHaveNoAdultUnlockAndShowThePrivacyPolicy() {
        show { SettingsScreen(AppState().apply { tab = Tab.SETTINGS }, store = true) }
        rule.onNodeWithText("Bring back hidden channels").assertExists()
        rule.onNodeWithText("Privacy policy").assertExists()
        rule.onNodeWithText("tunertv.app/privacy").assertExists()
        // Help and purchase pages (lumanest.tv/apps sells plans and offers the lumanest.tv APK) aren't linked.
        listOf("lumanest.tv/apps", "Plans", "Renew").forEach(::absent)
        rule.onNodeWithText("Remote control").assertExists()
        listOf("Adult", "XXX", "passcode", "Xtream", "onn ").forEach(::absent)
    }

    /** A TV-sized window: the privacy row is the last row, and the D-pad must still bring it into view. */
    @Test @Config(qualifiers = "w960dp-h540dp-land-mdpi")
    fun storePrivacyPolicyIsReachableWithTheRemote() {
        show { SettingsScreen(AppState().apply { tab = Tab.SETTINGS }, store = true) }
        rule.onNode(hasScrollAction()).performScrollToNode(hasText("Bring back hidden channels"))
        val last = rule.onNode(hasClickAction() and hasText("Bring back hidden channels"))
        last.requestFocus()
        last.assertIsFocused()
        // One press down from the last data row focuses the privacy row and scrolls it fully into view.
        last.performKeyInput { pressKey(Key.DirectionDown) }
        rule.waitForIdle()
        rule.onNode(hasClickAction() and hasText("Privacy policy")).assertIsFocused().assertIsDisplayed()
    }

    @Test fun directSettingsAreUnchanged() {
        show { SettingsScreen(AppState().apply { tab = Tab.SETTINGS }, store = false) }
        rule.onNodeWithText("Bring back hidden channels").assertExists()
        rule.onAllNodesWithText("Adult content").assertCountEquals(2)
        rule.onNodeWithText("XXX and adult categories", substring = true).assertExists()
        rule.onNodeWithText("onn 4K remote").assertExists()
        rule.onNodeWithText("Xtream Codes login or M3U link").assertExists()
        absent("Privacy policy")
    }

    /** A library whose series are on Netflix (TMDB's list and a provider category named after it). */
    private fun seedBrowse() {
        Repo.init(rule.activity.applicationContext)
        Repo.prefs.saveSource(Source("store-browse", "Store browse", SourceType.M3U))
        Repo.prefs.setActive("store-browse")
        Repo.prefs.setVodUsOnly(true)
        val shows = (1..8).joinToString(",", "[", "]") { """{"id":${300 + it},"title":"Show $it","year":"2024","origin":["US"]}""" }
        Repo.catalogRows.value = CatalogRows.parse("""{"v":1,"source":"tmdb","movie":{},"tv":{"popular":$shows,"services":{"netflix":$shows,"hulu":$shows}}}""")!!
        Repo.movieCategories.value = listOf(Category("nf", "NETFLIX MOVIES"))
        Repo.movies.value = (1..8).map { Movie("m:$it", "Film $it", null, "7", "nf", "https://example.invalid/$it.mp4", it.toLong()) }
        Repo.seriesCategories.value = listOf(Category("en", "EN | Series"))
        Repo.series.value = (1..8).map { Series("$it", "Show $it", null, null, "8", "en", null, "2024", null, it.toLong()) }
        Repo.vodStatus.value = LoadStatus.Ready; Repo.seriesStatus.value = LoadStatus.Ready; Repo.liveStatus.value = LoadStatus.Ready
    }

    private fun awaitHome() = rule.waitUntil(5_000) { rule.onAllNodesWithTag("browse-content:home").fetchSemanticsNodes().isNotEmpty() }

    @Test fun storeHomeAndDiscoverNameNoStreamingService() {
        seedBrowse()
        val state = AppState(Tab.HOME)
        try {
            show { HomeScreen(state, store = true) }
            awaitHome()
            listOf("Popular – Series", "Recently added – Movies", "Top rated – Series").forEach { rule.onNodeWithText(it).assertExists() }
            listOf("Netflix", "Hulu").forEach(::absent)
            rule.runOnIdle { state.openDiscover(VodType.SERIES, "netflix") }
            rule.waitUntil(5_000) { rule.onAllNodesWithTag("discover-grid").fetchSemanticsNodes().isNotEmpty() }
            // A service list (from a saved See all, say) falls back to the default list.
            rule.onNode(hasContentDescription("List: Popular")).assertExists()
            rule.onNodeWithTag("discover-filter:list").performClick()
            rule.onNode(hasClickAction() and hasText("A–Z")).assertExists()
            listOf("Netflix", "Hulu", "Disney", "Prime Video", "Peacock").forEach(::absent)
        } finally { Repo.catalogRows.value = CatalogRows.NONE; Repo.prefs.deleteSource("store-browse") }
    }

    @Test fun directHomeAndDiscoverKeepTheServices() {
        seedBrowse()
        val state = AppState(Tab.HOME)
        try {
            show { HomeScreen(state, store = false) }
            awaitHome()
            listOf("Netflix – Movies", "Netflix – Series", "Hulu – Series").forEach { rule.onNodeWithText(it).assertExists() }
            rule.runOnIdle { state.openDiscover(VodType.SERIES, "netflix") }
            rule.waitUntil(5_000) { rule.onAllNodesWithTag("discover-grid").fetchSemanticsNodes().isNotEmpty() }
            rule.onNode(hasContentDescription("List: Netflix")).assertExists()
            rule.onNodeWithTag("discover-filter:list").performClick()
            rule.onNode(hasClickAction() and hasText("Hulu")).assertExists()
            rule.onNode(hasClickAction() and hasText("Netflix") and !hasTestTag("discover-filter:list")).assertExists()
        } finally { Repo.catalogRows.value = CatalogRows.NONE; Repo.prefs.deleteSource("store-browse") }
    }

    @Test fun storeAddPlaylistUsesNeutralWording() {
        show { EditSourceScreen(null, canCancel = false, store = true) {} }
        rule.onNodeWithText("Server login").assertExists()
        rule.onNodeWithText("Playlist link").assertExists()
        listOf("Xtream", "IPTV", "M3U", "User agent", "VLC").forEach(::absent)
    }

    @Test fun directAddPlaylistIsUnchanged() {
        show { EditSourceScreen(null, canCancel = false, store = false) {} }
        rule.onNodeWithText("Xtream Codes").assertExists()
        rule.onNodeWithText("M3U URL").assertExists()
        rule.onNodeWithText("User agent · optional").assertExists()
        rule.onNodeWithText("Living room IPTV").assertExists()
    }
}

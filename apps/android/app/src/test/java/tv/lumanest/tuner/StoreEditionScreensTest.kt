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
import tv.lumanest.tuner.data.Repo
import tv.lumanest.tuner.ui.AppState
import tv.lumanest.tuner.ui.EditSourceScreen
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

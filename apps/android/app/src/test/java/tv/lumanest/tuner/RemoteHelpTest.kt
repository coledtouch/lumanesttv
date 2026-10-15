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
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performKeyInput
import androidx.compose.ui.test.hasScrollAction
import androidx.compose.ui.test.performScrollToNode
import androidx.compose.ui.test.pressKey
import tv.lumanest.tuner.data.Repo
import tv.lumanest.tuner.ui.AppState
import tv.lumanest.tuner.ui.SettingsScreen
import tv.lumanest.tuner.ui.Tab
import tv.lumanest.tuner.ui.TunerTheme
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import org.robolectric.shadows.ShadowDialog

@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [34], qualifiers = "w640dp-h360dp-land-xhdpi")
@OptIn(androidx.compose.ui.ExperimentalComposeUiApi::class, ExperimentalTestApi::class)
class RemoteHelpTest {
    @get:Rule val rule = createAndroidComposeRule<androidx.activity.ComponentActivity>()

    @Test fun helpCanBeReadAndClosedWithTheOnnArrowsAndOk() {
        Repo.init(rule.activity.applicationContext)
        val state = AppState().apply { tab = Tab.SETTINGS }
        rule.setContent {
            CompositionLocalProvider(LocalInputModeManager provides object : InputModeManager {
                override val inputMode = InputMode.Keyboard
                override fun requestInputMode(inputMode: InputMode) = true
            }) { TunerTheme { SettingsScreen(state) } }
        }
        rule.onNode(hasScrollAction()).performScrollToNode(hasText("onn 4K remote"))
        rule.onNodeWithText("onn 4K remote").performClick()
        // Robolectric creates the dialog view but does not deliver the OS window-focus event.
        rule.runOnIdle {
            val dialog = checkNotNull(ShadowDialog.getLatestDialog())
            val view = dialog.window!!.decorView
            view.dispatchWindowFocusChanged(true)
            Snapshot.sendApplyNotifications()
        }
        rule.waitForIdle()
        rule.onNodeWithText("Done").assertIsFocused()
        // Read the scrollable help without needing a touch screen or a Menu button.
        rule.onNodeWithText("Done").performKeyInput { repeat(3) { pressKey(Key.DirectionDown) }; pressKey(Key.Enter) }
        rule.runOnIdle {
            rule.activity.window.decorView.dispatchWindowFocusChanged(true)
            Snapshot.sendApplyNotifications()
        }
        rule.waitForIdle()
        rule.onNodeWithText("Done").assertDoesNotExist()
        rule.onNode(hasClickAction() and hasText("onn 4K remote")).assertIsFocused()
        rule.runOnIdle { assertEquals(Tab.SETTINGS, state.tab) }
    }
}

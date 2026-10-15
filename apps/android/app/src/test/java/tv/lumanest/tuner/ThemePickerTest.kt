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
import androidx.compose.ui.test.hasScrollAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.isFocused
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performKeyInput
import androidx.compose.ui.test.performScrollToNode
import androidx.compose.ui.test.pressKey
import tv.lumanest.tuner.data.Repo
import tv.lumanest.tuner.ui.AppState
import tv.lumanest.tuner.ui.Palette
import tv.lumanest.tuner.ui.SettingsScreen
import tv.lumanest.tuner.ui.Tab
import tv.lumanest.tuner.ui.Themes
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
@Config(sdk = [34], qualifiers = "w640dp-h360dp-land-xhdpi")
@OptIn(androidx.compose.ui.ExperimentalComposeUiApi::class, ExperimentalTestApi::class)
class ThemePickerTest {
    @get:Rule val rule = createAndroidComposeRule<androidx.activity.ComponentActivity>()

    @Before fun setup() {
        Repo.init(rule.activity.applicationContext)
        Repo.prefs.themeId = Themes.Midnight.id
        Palette.theme = Themes.Midnight
        val state = AppState().apply { tab = Tab.SETTINGS }
        rule.setContent {
            CompositionLocalProvider(LocalInputModeManager provides object : InputModeManager {
                override val inputMode = InputMode.Keyboard
                override fun requestInputMode(inputMode: InputMode) = true
            }) { TunerTheme { SettingsScreen(state) } }
        }
        rule.runOnIdle { rule.activity.window.decorView.dispatchWindowFocusChanged(true); Snapshot.sendApplyNotifications() }
        // The Theme row is beyond the initial lazy viewport, so scroll the list to compose it first.
        rule.onNode(hasScrollAction()).performScrollToNode(hasText("Theme"))
        rule.onNode(hasClickAction() and hasText("Theme")).performClick()
        rule.onNode(hasClickAction() and hasText("Midnight") and !hasText("Theme")).assertIsFocused()
    }

    @Test fun previewDoesNotPersistAndBackRestoresTheThemeRow() {
        rule.onNode(isFocused()).performKeyInput { pressKey(Key.DirectionDown) }
        rule.runOnIdle {
            assertEquals(Themes.Black.id, Palette.theme.id)
            assertEquals(Themes.Midnight.id, Repo.prefs.themeId)
            rule.activity.onBackPressedDispatcher.onBackPressed()
            Snapshot.sendApplyNotifications()
        }
        rule.onNode(hasClickAction() and hasText("Theme")).assertIsFocused()
        rule.runOnIdle {
            assertEquals(Themes.Midnight.id, Palette.theme.id)
            assertEquals(Themes.Midnight.id, Repo.prefs.themeId)
        }
    }

    @Test fun lastThemeIsReachableOnACompactScreenAndOkSavesIt() {
        repeat(Themes.all.lastIndex) {
            rule.onNode(isFocused()).performKeyInput { pressKey(Key.DirectionDown) }
        }
        rule.onNode(hasClickAction() and hasText("Daylight") and !hasText("Theme")).assertIsFocused()
            .performKeyInput { pressKey(Key.Enter) }
        rule.onNode(hasClickAction() and hasText("Theme")).assertIsFocused()
        rule.runOnIdle {
            assertEquals(Themes.Daylight.id, Palette.theme.id)
            assertEquals(Themes.Daylight.id, Repo.prefs.themeId)
        }
    }
}

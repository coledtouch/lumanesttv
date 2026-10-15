package tv.lumanest.tuner

import android.graphics.Bitmap
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.InputMode
import androidx.compose.ui.input.InputModeManager
import androidx.compose.ui.platform.LocalInputModeManager
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.core.view.drawToBitmap
import tv.lumanest.tuner.ui.AppState
import tv.lumanest.tuner.ui.TorrentioScreen
import tv.lumanest.tuner.ui.TunerTheme
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import java.io.File

@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [34], qualifiers = "w960dp-h540dp-land-xhdpi")
@OptIn(androidx.compose.ui.ExperimentalComposeUiApi::class)
class TorrentioScreenTest {
    @get:Rule val rule = createAndroidComposeRule<androidx.activity.ComponentActivity>()
    @Test fun movieEpisodeControlsAndValidation() {
        val state = AppState()
        rule.setContent {
            CompositionLocalProvider(LocalInputModeManager provides object : InputModeManager {
                override val inputMode = InputMode.Keyboard
                override fun requestInputMode(inputMode: InputMode) = true
            }) {
                TunerTheme { androidx.compose.foundation.layout.Box(Modifier.fillMaxSize()) { TorrentioScreen(state, loadCatalog = false) } }
            }
        }
        rule.onNodeWithText("Discover").assertExists()
        rule.onNodeWithText("Series", useUnmergedTree = true).performClick()
        rule.onNodeWithText("Series").assertExists()
        rule.onNodeWithText("Search by title").assertExists()
        rule.runOnIdle { assertTrue(state.torrentioSeries) }
        val view = rule.activity.window.decorView.rootView
        val bitmap = view.drawToBitmap()
        val output = File(System.getProperty("user.dir"), "build/screens/torrentio.png")
        output.parentFile?.mkdirs()
        output.outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
    }
}

package tv.lumanest.tuner

import android.graphics.Bitmap
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.core.view.drawToBitmap
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performKeyInput
import androidx.compose.ui.test.pressKey
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.isDialog
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.assertIsFocused
import androidx.compose.ui.test.performSemanticsAction
import androidx.compose.ui.semantics.SemanticsActions
import tv.lumanest.tuner.data.Category
import tv.lumanest.tuner.data.Channel
import tv.lumanest.tuner.data.Movie
import tv.lumanest.tuner.data.Program
import tv.lumanest.tuner.data.Repo
import tv.lumanest.tuner.data.Source
import tv.lumanest.tuner.data.SourceType
import tv.lumanest.tuner.data.Series
import tv.lumanest.tuner.ui.AppState
import tv.lumanest.tuner.ui.HomeScreen
import tv.lumanest.tuner.ui.Tab
import tv.lumanest.tuner.ui.TunerTheme
import tv.lumanest.tuner.ui.floor30
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import java.io.File

@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [34], qualifiers = "w960dp-h540dp-land-xhdpi")
@OptIn(ExperimentalTestApi::class)
class ScreenshotTest {
    @get:Rule val rule = createAndroidComposeRule<androidx.activity.ComponentActivity>()
    private val out = File(System.getProperty("user.dir"), "build/screens").apply { mkdirs() }

    private fun shot(name: String) {
        rule.runOnIdle { androidx.compose.runtime.snapshots.Snapshot.sendApplyNotifications() }
        repeat(3) { rule.mainClock.advanceTimeByFrame() }
        rule.waitForIdle()
        org.robolectric.shadows.ShadowLooper.idleMainLooper()
        repeat(3) { rule.mainClock.advanceTimeByFrame() }
        rule.waitForIdle()
        val dialog = org.robolectric.shadows.ShadowDialog.getLatestDialog()
        val view = if (dialog?.isShowing == true) dialog.window!!.decorView else rule.activity.window.decorView.rootView
        // Draw the active window directly; PixelCopy is unavailable in Robolectric.
        view.measure(android.view.View.MeasureSpec.makeMeasureSpec(view.width, android.view.View.MeasureSpec.EXACTLY), android.view.View.MeasureSpec.makeMeasureSpec(view.height, android.view.View.MeasureSpec.EXACTLY))
        view.layout(0, 0, view.width, view.height)
        val bmp = view.drawToBitmap()
        File(out, "$name.png").outputStream().use { bmp.compress(Bitmap.CompressFormat.PNG, 100, it) }
    }

    private fun awaitBrowse(state: AppState) {
        val prefix = if (state.tab == Tab.MOVIES) "movies" else "series"
        rule.waitUntil(timeoutMillis = 5_000) {
            org.robolectric.shadows.ShadowLooper.idleMainLooper()
            rule.runOnIdle { androidx.compose.runtime.snapshots.Snapshot.sendApplyNotifications() }
            rule.mainClock.advanceTimeByFrame()
            rule.onAllNodesWithTag("browse-content:$prefix").fetchSemanticsNodes().isNotEmpty() &&
                !state.restoreFocus && state.lastFocusedKey?.startsWith("$prefix:") == true
        }
    }

    /** TV remotes put Compose in keyboard input mode; tests start in touch mode. */
    @OptIn(androidx.compose.ui.ExperimentalComposeUiApi::class)
    @androidx.compose.runtime.Composable
    private fun KeyboardMode(content: @androidx.compose.runtime.Composable () -> Unit) {
        val im = androidx.compose.ui.platform.LocalInputModeManager.current
        androidx.compose.runtime.SideEffect { im.requestInputMode(androidx.compose.ui.input.InputMode.Keyboard) }
        androidx.compose.foundation.layout.Box(
            androidx.compose.ui.Modifier.fillMaxSize().background(tv.lumanest.tuner.ui.Palette.bg),
        ) { content() }
    }

    @Before fun seed() {
        org.robolectric.shadows.ShadowLog.stream = System.out
        Repo.prefs.saveSource(Source("s1", "Test", SourceType.XTREAM, "http://h", "u", "p"))
        Repo.prefs.setActive("s1")
        Repo.prefs.guidePreview = false
        Repo.prefs.lastChannelKey = null
        tv.lumanest.tuner.ui.Toasts.message = null
        tv.lumanest.tuner.ui.Palette.theme = tv.lumanest.tuner.ui.Themes.Midnight
        Repo.trending.value = emptyList()
        Repo.liveStatus.value = tv.lumanest.tuner.data.LoadStatus.Ready
        Repo.vodStatus.value = tv.lumanest.tuner.data.LoadStatus.Ready
        Repo.seriesStatus.value = tv.lumanest.tuner.data.LoadStatus.Ready
        val cats = listOf(Category("1", "News"), Category("2", "Sports"), Category("3", "Entertainment"), Category("4", "Kids"), Category("5", "Movies"))
        val names = listOf("CNN", "ESPN", "HBO", "NBC", "FOX", "ABC", "CBS", "AMC", "TNT", "TBS", "FX", "Nickelodeon", "Disney", "Food Network", "HGTV", "Discovery", "History", "Bravo")
        val chans = names.mapIndexed { i, n ->
            Channel("x:$i", 100 + i, n, null, cats[i % cats.size].id, "e$i", "$i", "http://h/live/u/p/$i.ts")
        }
        Repo.liveCategories.value = cats
        Repo.channels.value = chans
        val titles = listOf("Evening News", "SportsCenter", "House of the Dragon", "Jeopardy!", "The Five", "World News Tonight", "60 Minutes", "Breaking Bad", "NBA on TNT", "Seinfeld", "The Bear", "SpongeBob", "Bluey", "Chopped", "Fixer Upper", "Deadliest Catch", "Pawn Stars", "Real Housewives")
        val now = System.currentTimeMillis()
        val start = floor30(now) - 45 * 60_000L
        val data = HashMap<String, List<Program>>()
        chans.forEachIndexed { i, c ->
            if (i == 5) return@forEachIndexed // one channel with no guide data
            var t = start + (i % 3) * 15 * 60_000L
            val list = ArrayList<Program>()
            var k = 0
            while (t < now + 8 * 3600_000L) {
                val len = listOf(30, 60, 90, 30, 120)[(i + k) % 5] * 60_000L
                list += Program(t, t + len, titles[(i + k) % titles.size], "A short description for this airing of the show with a few details about tonight's episode.", if (k % 2 == 0) "Season ${k + 1}" else null)
                t += len; k++
            }
            data[c.key] = list
        }
        Repo.putPrograms(data)
        Repo.movies.value = (1..30).map { Movie("m:$it", "Movie Title $it", null, "7.${it % 10}", (it % 3 + 1).toString(), "http://h/movie/u/p/$it.mp4", it.toLong(), categoryIds = listOf("1", "2", "3")) }
        Repo.movieCategories.value = listOf(Category("1", "Action"), Category("2", "Comedy"), Category("3", "Drama"))
        val shows = listOf("The Last Horizon", "City After Dark", "Wild America", "The Long Way Home", "North Shore", "Second Chances")
        Repo.series.value = shows.mapIndexed { i, title ->
            Series("${i + 1}", title, null, "A new story unfolds with every episode. Discover the people, places and moments that bring it to life.", "8.${i % 5}", "1", "Drama", "2026", null, (i + 1).toLong())
        }
        Repo.seriesCategories.value = listOf(Category("1", "English · Drama"))
    }

    @OptIn(ExperimentalTestApi::class)
    @Test fun guide() {
        val state = AppState()
        rule.mainClock.autoAdvance = false
        rule.setContent { KeyboardMode { TunerTheme { HomeScreen(state) } } }
        rule.mainClock.advanceTimeBy(500)
        shot("01_guide")
        rule.onRoot().performKeyInput { repeat(3) { pressKey(Key.DirectionDown) } }
        rule.mainClock.advanceTimeBy(600)
        rule.runOnIdle { assertEquals(3, state.guide.row) }
        shot("02_guide_down3")
        rule.onRoot().performKeyInput { repeat(4) { pressKey(Key.DirectionRight) } }
        rule.mainClock.advanceTimeBy(600)
        shot("03_guide_right4")
        rule.onRoot().performKeyInput { pressKey(Key.Enter) }
        rule.runOnIdle { androidx.compose.runtime.snapshots.Snapshot.sendApplyNotifications() }
        rule.mainClock.advanceTimeBy(600)
        rule.waitForIdle()
        org.robolectric.shadows.ShadowLooper.idleMainLooper()
        repeat(3) { rule.mainClock.advanceTimeByFrame() }
        rule.waitForIdle()
        rule.onNodeWithText("Watch channel now").assertExists()
        rule.runOnIdle {
            // Robolectric does not deliver the window-focus event Android sends to a modal.
            val dialog = checkNotNull(org.robolectric.shadows.ShadowDialog.getLatestDialog()) { "Future program dialog was not created" }
            dialog.window!!.decorView.dispatchWindowFocusChanged(true)
            androidx.compose.runtime.snapshots.Snapshot.sendApplyNotifications()
        }
        rule.onNodeWithText("Watch channel now").performSemanticsAction(SemanticsActions.RequestFocus) { it() }
        rule.onNodeWithText("Watch channel now").assertIsFocused()
        shot("04_future_details")
        println("stackA=" + state.stack.size)
        rule.onNode(isDialog()).performKeyInput { pressKey(Key.DirectionRight); pressKey(Key.Enter) }
        rule.runOnIdle { androidx.compose.runtime.snapshots.Snapshot.sendApplyNotifications() }
        rule.mainClock.advanceTimeBy(600)
        rule.onRoot().performKeyInput { repeat(10) { pressKey(Key.DirectionDown) }; pressKey(Key.DirectionLeft) }
        rule.mainClock.advanceTimeBy(600)
        shot("05_guide_scrolled")
        println("stackB=" + state.stack.size)
    }

    @Test fun movies() {
        val state = AppState().apply { tab = Tab.MOVIES }
        rule.mainClock.autoAdvance = false
        rule.setContent { KeyboardMode { TunerTheme { HomeScreen(state) } } }
        rule.mainClock.advanceTimeBy(800)
        awaitBrowse(state)
        shot("06_movies")
    }

    @Test fun series() {
        val state = AppState().apply { tab = Tab.SERIES }
        rule.mainClock.autoAdvance = false
        rule.setContent { KeyboardMode { TunerTheme { HomeScreen(state) } } }
        rule.mainClock.advanceTimeBy(800)
        awaitBrowse(state)
        shot("15_series")
    }

    @Config(sdk = [34], qualifiers = "w720dp-h405dp-land-xhdpi")
    @Test fun compactGuideAndLibraries() {
        val state = AppState()
        rule.mainClock.autoAdvance = false
        rule.setContent { KeyboardMode { TunerTheme { HomeScreen(state) } } }
        rule.mainClock.advanceTimeBy(800)
        shot("16_compact_guide")
        rule.runOnIdle { state.tab = Tab.MOVIES; state.restoreFocus = true; androidx.compose.runtime.snapshots.Snapshot.sendApplyNotifications() }
        rule.mainClock.advanceTimeBy(800)
        awaitBrowse(state)
        shot("17_compact_movies")
        rule.runOnIdle { state.tab = Tab.SERIES; state.restoreFocus = true; androidx.compose.runtime.snapshots.Snapshot.sendApplyNotifications() }
        rule.mainClock.advanceTimeBy(800)
        awaitBrowse(state)
        shot("18_compact_series")
    }

    /** Passing across navigation must not mount each library or steal remote focus. */
    @Test fun navigationRequiresSelection() {
        val state = AppState()
        rule.mainClock.autoAdvance = false
        rule.setContent { KeyboardMode { TunerTheme { HomeScreen(state) } } }
        rule.mainClock.advanceTimeBy(800)
        rule.onNodeWithContentDescription("Movies").performSemanticsAction(SemanticsActions.RequestFocus) { it() }
        rule.onRoot().performKeyInput { pressKey(Key.DirectionRight) }
        rule.mainClock.advanceTimeBy(300)
        rule.onNodeWithContentDescription("Series").assertIsFocused()
        rule.runOnIdle { assertEquals(Tab.GUIDE, state.tab) }
        rule.onRoot().performKeyInput { pressKey(Key.Enter) }
        rule.mainClock.advanceTimeBy(800)
        rule.runOnIdle { assertEquals(Tab.SERIES, state.tab) }
        awaitBrowse(state)
        shot("19_navigation_series")
    }

    @Test fun movieReturnRestoresRemoteFocus() {
        val state = AppState().apply { tab = Tab.MOVIES }
        rule.mainClock.autoAdvance = false
        rule.setContent {
            KeyboardMode {
                TunerTheme {
                    if (state.top == tv.lumanest.tuner.ui.Screen.Home) HomeScreen(state)
                    else androidx.compose.material3.Text("Detail destination")
                }
            }
        }
        rule.mainClock.advanceTimeBy(800)
        awaitBrowse(state)
        rule.onRoot().performKeyInput { repeat(4) { pressKey(Key.DirectionRight) } }
        rule.mainClock.advanceTimeBy(500)
        var expected = ""
        rule.runOnIdle { expected = state.lastFocusedKey!! }
        rule.onRoot().performKeyInput { pressKey(Key.Enter) }
        rule.mainClock.advanceTimeBy(400)
        rule.runOnIdle {
            assertTrue(state.top is tv.lumanest.tuner.ui.Screen.MovieDetail)
            state.pop()
            androidx.compose.runtime.snapshots.Snapshot.sendApplyNotifications()
        }
        rule.mainClock.advanceTimeBy(800)
        awaitBrowse(state)
        rule.runOnIdle {
            assertEquals(expected, state.lastFocusedKey)
            assertFalse("Returning should restore an attached card's remote focus", state.restoreFocus)
        }
        awaitBrowse(state)
        shot("20_movie_focus_restored")
    }

    @Test fun guideFilterReturnsFutureWindowToNow() {
        val state = AppState()
        state.guide.windowStart = floor30(System.currentTimeMillis()) + 4 * 3600_000L
        state.guide.focusTime = state.guide.windowStart
        rule.mainClock.autoAdvance = false
        rule.setContent { KeyboardMode { TunerTheme { HomeScreen(state) } } }
        rule.mainClock.advanceTimeBy(800)
        rule.onNodeWithText("Sports").performClick()
        rule.mainClock.advanceTimeBy(500)
        rule.runOnIdle {
            assertEquals("2", state.guide.category)
            assertEquals(0, state.guide.row)
            assertEquals(0L, state.guide.focusTime)
            assertTrue(state.guide.windowStart <= floor30(System.currentTimeMillis()))
        }
    }

    @Test fun backLeavesDeepGuideWithoutLosingChannel() {
        val state = AppState()
        rule.mainClock.autoAdvance = false
        rule.setContent { KeyboardMode { TunerTheme { HomeScreen(state) } } }
        rule.mainClock.advanceTimeBy(800)
        rule.onRoot().performKeyInput { repeat(10) { pressKey(Key.DirectionDown) } }
        rule.mainClock.advanceTimeBy(700)
        rule.runOnIdle {
            assertEquals(10, state.guide.row)
            rule.activity.onBackPressedDispatcher.onBackPressed()
            androidx.compose.runtime.snapshots.Snapshot.sendApplyNotifications()
        }
        rule.mainClock.advanceTimeBy(300)
        rule.waitForIdle()
        org.robolectric.shadows.ShadowLooper.idleMainLooper()
        repeat(3) { rule.mainClock.advanceTimeByFrame() }
        rule.onNodeWithContentDescription(Tab.GUIDE.title).assertIsFocused()
        rule.onRoot().performKeyInput { pressKey(Key.DirectionRight) }
        rule.mainClock.advanceTimeBy(300)
        rule.onNodeWithContentDescription(Tab.MOVIES.title).assertIsFocused()
        rule.runOnIdle {
            assertEquals(10, state.guide.row)
            assertEquals("Remote focus should leave the schedule on Back", 0L, state.guide.focusTime)
        }
    }

    @Config(sdk = [34], qualifiers = "w640dp-h360dp-land-xhdpi")
    @Test fun smallLandscapeMovies() {
        val state = AppState().apply { tab = Tab.MOVIES }
        rule.mainClock.autoAdvance = false
        rule.setContent { KeyboardMode { TunerTheme { HomeScreen(state) } } }
        rule.mainClock.advanceTimeBy(800)
        awaitBrowse(state)
        shot("21_small_movies")
    }

    @Test fun livePlayer() {
        rule.mainClock.autoAdvance = false
        val ch = Repo.channels.value
        rule.setContent { KeyboardMode { TunerTheme { tv.lumanest.tuner.ui.PlayerScreen(tv.lumanest.tuner.data.PlayRequest.Live(ch[2], ch)) {} } } }
        rule.mainClock.advanceTimeBy(800)
        shot("07_live_banner")
        rule.onRoot().performKeyInput { pressKey(Key.DirectionLeft) }
        rule.mainClock.advanceTimeBy(800)
        shot("08_live_panel")
    }

    @Test fun addSource() {
        rule.mainClock.autoAdvance = false
        rule.setContent { KeyboardMode { TunerTheme { tv.lumanest.tuner.ui.EditSourceScreen(null, false) {} } } }
        rule.mainClock.advanceTimeBy(800)
        rule.onRoot().performKeyInput { pressKey(Key.DirectionDown) }
        rule.mainClock.advanceTimeBy(400)
        shot("09_add_source")
    }

    @Test fun themes() {
        rule.mainClock.autoAdvance = false
        val state = AppState()
        rule.setContent { KeyboardMode { TunerTheme { HomeScreen(state) } } }
        listOf(tv.lumanest.tuner.ui.Themes.Daylight, tv.lumanest.tuner.ui.Themes.Carbon, tv.lumanest.tuner.ui.Themes.Royal).forEach { t ->
            tv.lumanest.tuner.ui.Palette.theme = t
            rule.mainClock.advanceTimeBy(500); rule.waitForIdle(); rule.mainClock.advanceTimeBy(100)
            shot("10_theme_${t.id}")
        }
        tv.lumanest.tuner.ui.Palette.theme = tv.lumanest.tuner.ui.Themes.Midnight
    }

    @Test fun settings() {
        rule.mainClock.autoAdvance = false
        val state = AppState().apply { tab = Tab.SETTINGS }
        rule.setContent { KeyboardMode { TunerTheme { HomeScreen(state) } } }
        rule.mainClock.advanceTimeBy(500)
        rule.onRoot().performKeyInput { repeat(2) { pressKey(Key.DirectionDown) } }
        rule.mainClock.advanceTimeBy(500)
        shot("11_settings")
        rule.onRoot().performKeyInput { pressKey(Key.Enter) }
        rule.mainClock.advanceTimeBy(500)
        rule.onRoot().performKeyInput { pressKey(Key.DirectionDown) }
        rule.mainClock.advanceTimeBy(500)
        shot("12_theme_sheet")
        tv.lumanest.tuner.ui.Palette.theme = tv.lumanest.tuner.ui.Themes.Midnight
    }

    @Test fun phoneSetupAndNativeInput() {
        rule.mainClock.autoAdvance = false
        rule.setContent { KeyboardMode { TunerTheme { tv.lumanest.tuner.ui.EditSourceScreen(null, false) {} } } }
        rule.mainClock.advanceTimeBy(800)
        // Remote: Down to the Server URL field, OK opens the native input dialog.
        rule.onRoot().performKeyInput { pressKey(Key.DirectionDown); pressKey(Key.DirectionCenter) }
        rule.mainClock.advanceTimeBy(300)
        org.robolectric.Shadows.shadowOf(android.os.Looper.getMainLooper()).idle()
        val dlg = org.robolectric.shadows.ShadowAlertDialog.getLatestAlertDialog()
        println("DIALOG shown=" + (dlg?.isShowing) + " title=" + org.robolectric.Shadows.shadowOf(dlg).title)
        val edit = findEdit(dlg!!.window!!.decorView)
        edit!!.setText("http://typed.example:8080")
        dlg.getButton(android.app.AlertDialog.BUTTON_POSITIVE).performClick()
        org.robolectric.Shadows.shadowOf(android.os.Looper.getMainLooper()).idle()
        rule.mainClock.advanceTimeBy(300)
        shot("13_typed_server")

        // Phone page: GET the form, then POST credentials like a phone browser would.
        val port = listOf(8686, 8687, 8688, 8080).first { runCatching { java.net.Socket("127.0.0.1", it).close() }.isSuccess }
        val page = java.net.URL("http://127.0.0.1:$port/").readText()
        println("PAGE has form=" + page.contains("Send to TV"))
        val conn = java.net.URL("http://127.0.0.1:$port/").openConnection() as java.net.HttpURLConnection
        conn.requestMethod = "POST"; conn.doOutput = true
        conn.setRequestProperty("Content-Type", "application/x-www-form-urlencoded")
        conn.outputStream.use { it.write("type=xtream&server=http%3A%2F%2Fphone.example%3A80&username=viewer&password=p%40ss&name=Living+Room".toByteArray()) }
        println("POST code=" + conn.responseCode + " sent=" + conn.inputStream.bufferedReader().readText().contains("Sent to your TV"))
        org.robolectric.Shadows.shadowOf(android.os.Looper.getMainLooper()).idle()
        rule.mainClock.advanceTimeBy(500)
        shot("14_from_phone")
    }

    private fun findEdit(v: android.view.View): android.widget.EditText? = when (v) {
        is android.widget.EditText -> v
        is android.view.ViewGroup -> (0 until v.childCount).firstNotNullOfOrNull { findEdit(v.getChildAt(it)) }
        else -> null
    }
}

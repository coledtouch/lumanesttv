package tv.lumanest.tuner

import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.remember
import androidx.compose.ui.input.InputMode
import androidx.compose.ui.input.InputModeManager
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.platform.LocalInputModeManager
import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.assertIsFocused
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performKeyInput
import androidx.compose.ui.test.pressKey
import kotlinx.coroutines.CompletableDeferred
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import tv.lumanest.tuner.data.CatalogRows
import tv.lumanest.tuner.data.Episode
import tv.lumanest.tuner.data.ExtrasTitle
import tv.lumanest.tuner.data.PlayRequest
import tv.lumanest.tuner.data.SeriesInfo
import tv.lumanest.tuner.data.SubtitleQuery
import tv.lumanest.tuner.ui.Screen
import tv.lumanest.tuner.data.Extras
import tv.lumanest.tuner.data.ExtrasApi
import tv.lumanest.tuner.data.ExtrasClient
import tv.lumanest.tuner.data.Movie
import tv.lumanest.tuner.data.Repo
import tv.lumanest.tuner.data.Series
import tv.lumanest.tuner.data.Source
import tv.lumanest.tuner.data.SourceType
import tv.lumanest.tuner.ui.AppState
import tv.lumanest.tuner.ui.MovieDetailScreen
import tv.lumanest.tuner.ui.SeriesDetailScreen
import tv.lumanest.tuner.ui.SettingsScreen
import tv.lumanest.tuner.ui.Tab
import tv.lumanest.tuner.ui.TunerTheme
import java.util.concurrent.CopyOnWriteArrayList

/** The Trailer button on movie and series pages, and the OpenSubtitles credit in Settings > About (docs/extras.md). */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [34], qualifiers = "w960dp-h540dp-land-xhdpi")
@OptIn(androidx.compose.ui.ExperimentalComposeUiApi::class, ExperimentalTestApi::class)
class ExtrasScreensTest {
    @get:Rule val rule = createAndroidComposeRule<androidx.activity.ComponentActivity>()

    private val sourceId = "extras-screens-" + java.util.UUID.randomUUID()
    private val original = Extras.client
    private val requests = CopyOnWriteArrayList<String>()
    @Volatile private var gate: CompletableDeferred<Unit>? = null
    private val key = "vKQi3bBA1y8"
    private val withTrailer = """{"v":1,"status":"ok","tmdb":603,"trailer":{"key":"$key","name":"Official Trailer",
        "url":"https://www.youtube.com/watch?v=$key","short":"youtu.be/$key","qr":["1"]}}"""
    private val noTrailer = """{"v":1,"status":"none","tmdb":null,"trailer":null}"""

    @Before fun seed() {
        Repo.init(rule.activity.applicationContext)
        Repo.prefs.saveSource(Source(sourceId, "Extras test", SourceType.M3U))
        Repo.prefs.setActive(sourceId)
        Repo.prefs.guidePreview = false
        Extras.client = ExtrasClient(fetch = { url, _, _ ->
            requests += url
            gate?.await()
            if ("tmdb=603" in url || "tmdb=1399" in url) withTrailer else noTrailer
        })
    }

    @After fun reset() {
        Extras.client = original
        Repo.prefs.libraryFavorites.value.forEach { Repo.prefs.toggleLibraryFavorite(it) }
        Repo.prefs.deleteSource(sourceId)
    }

    private fun mount(content: @Composable () -> Unit) {
        rule.setContent {
            CompositionLocalProvider(LocalInputModeManager provides object : InputModeManager {
                override val inputMode = InputMode.Keyboard
                override fun requestInputMode(inputMode: InputMode) = true
            }) { TunerTheme { content() } }
        }
    }

    private fun await(check: () -> Boolean) {
        rule.waitUntil(timeoutMillis = 5_000) {
            org.robolectric.shadows.ShadowLooper.idleMainLooper()
            check()
        }
    }

    private fun press(key: Key) = rule.onRoot().performKeyInput { pressKey(key) }
    private fun hasTrailer() = rule.onAllNodesWithTag("trailer").fetchSemanticsNodes().isNotEmpty()
    private val matrix = Movie("m:1", "The Matrix", null, null, "1", "https://video.example/1.mp4", tmdb = "603")

    @Test fun trailerFollowsAddToLibraryAndShowsAQrCodeWithoutYouTube() {
        // No YouTube app on this TV: every launch fails, so the phone QR code shows.
        val tried = CopyOnWriteArrayList<android.content.Intent>()
        mount {
            val activity = androidx.compose.ui.platform.LocalContext.current
            val noYouTube = remember {
                object : android.content.ContextWrapper(activity) {
                    override fun startActivity(intent: android.content.Intent) { tried += intent; throw android.content.ActivityNotFoundException() }
                }
            }
            CompositionLocalProvider(androidx.compose.ui.platform.LocalContext provides noYouTube) { MovieDetailScreen(matrix, AppState(Tab.HOME)) }
        }
        await { hasTrailer() }
        assertEquals(listOf("https://lumanest.tv/api/extras/trailer?v=1&type=movie&tmdb=603"), requests.toList())
        rule.onNode(hasClickAction() and hasText("Watch Movie")).assertIsFocused()
        press(Key.DirectionRight)
        rule.onNode(hasClickAction() and hasText("Add to Library")).assertIsFocused()
        press(Key.DirectionRight)
        rule.onNodeWithTag("trailer").assertIsFocused()
        press(Key.Enter)
        await { rule.onAllNodesWithText("Watch the trailer on your phone").fetchSemanticsNodes().isNotEmpty() }
        assertEquals(6, tried.size)
        rule.onNodeWithText("youtu.be/$key").assertExists()
        rule.onNodeWithText("Scan the code with your phone's camera.").assertExists()
        rule.onNodeWithTag("trailer-qr").assertExists()
        // Robolectric creates the dialog's window but does not deliver the OS window-focus event.
        rule.runOnIdle {
            checkNotNull(org.robolectric.shadows.ShadowDialog.getLatestDialog()).window!!.decorView.dispatchWindowFocusChanged(true)
            androidx.compose.runtime.snapshots.Snapshot.sendApplyNotifications()
        }
        await { runCatching { rule.onNode(hasClickAction() and hasText("Close")).assertIsFocused() }.isSuccess }
        rule.onNode(hasClickAction() and hasText("Close")).performKeyInput { pressKey(Key.Enter) }
        rule.runOnIdle {
            rule.activity.window.decorView.dispatchWindowFocusChanged(true)
            androidx.compose.runtime.snapshots.Snapshot.sendApplyNotifications()
        }
        await { rule.onAllNodesWithText("Watch the trailer on your phone").fetchSemanticsNodes().isEmpty() }
        await { runCatching { rule.onNodeWithTag("trailer").assertIsFocused() }.isSuccess }
    }

    @Test fun trailerOpensTheTvYouTubeApp() {
        mount { MovieDetailScreen(matrix, AppState(Tab.HOME)) }
        await { hasTrailer() }
        rule.onNodeWithTag("trailer").performClick()
        rule.waitForIdle()
        val started = shadowOf(rule.activity).nextStartedActivity
        assertEquals("com.google.android.youtube.tv", started.`package`)
        assertEquals("https://www.youtube.com/watch?v=$key", started.dataString)
        assertTrue(rule.onAllNodesWithText("Watch the trailer on your phone").fetchSemanticsNodes().isEmpty())
    }

    @Test fun aTrailerThatArrivesLateNeverTakesTheFocus() {
        gate = CompletableDeferred()
        mount { MovieDetailScreen(matrix, AppState(Tab.HOME)) }
        await { requests.isNotEmpty() && runCatching { rule.onNode(hasClickAction() and hasText("Watch Movie")).assertIsFocused() }.isSuccess }
        assertTrue(!hasTrailer())
        gate!!.complete(Unit)
        await { hasTrailer() }
        rule.onNode(hasClickAction() and hasText("Watch Movie")).assertIsFocused()
    }

    @Test fun noTrailerNoButtonAndATitleWithoutAnIdIsLookedUpByNameAndYear() {
        val heat = Movie("m:2", "Heat", null, null, "1", "https://video.example/2.mp4", year = "1995")
        mount { MovieDetailScreen(heat, AppState(Tab.HOME)) }
        await { requests.isNotEmpty() }
        rule.waitForIdle()
        assertEquals(listOf("https://lumanest.tv/api/extras/trailer?v=1&type=movie&name=Heat&year=1995"), requests.toList())
        assertTrue(!hasTrailer())
        rule.onNode(hasClickAction() and hasText("Add to Library")).assertExists()
    }

    @Test fun aTitleWithoutAnIdOrYearIsNotLookedUp() {
        val unknown = Movie("m:3", "Mystery", null, null, "1", "https://video.example/3.mp4")
        mount { MovieDetailScreen(unknown, AppState(Tab.HOME)) }
        await { runCatching { rule.onNode(hasClickAction() and hasText("Watch Movie")).assertIsFocused() }.isSuccess }
        rule.waitForIdle()
        assertTrue(requests.isEmpty())
    }

    @Test fun theSeriesPageOffersItsTrailerAfterAddToLibrary() {
        val show = Series("9", "Thrones", null, "Plot", null, "1", null, "2011", null, tmdb = "1399")
        mount { SeriesDetailScreen(show, AppState(Tab.HOME)) }
        // This playlist has no Xtream server: the episode list can't load, and the buttons stay.
        await { rule.onAllNodesWithText("Couldn't load episodes").fetchSemanticsNodes().isNotEmpty() && hasTrailer() }
        assertEquals(listOf("https://lumanest.tv/api/extras/trailer?v=1&type=tv&tmdb=1399"), requests.toList())
        rule.onNodeWithText("Try again").assertIsFocused()
        press(Key.DirectionRight)
        rule.onNode(hasClickAction() and hasText("Add to Library")).assertIsFocused()
        press(Key.DirectionRight)
        rule.onNodeWithTag("trailer").assertIsFocused()
    }

    @Test fun watchMovieLooksItsSubtitlesUpByItsTmdbId() {
        val state = AppState(Tab.HOME)
        mount { MovieDetailScreen(matrix, state) }
        await { runCatching { rule.onNode(hasClickAction() and hasText("Watch Movie")).assertIsFocused() }.isSuccess }
        rule.onNode(hasClickAction() and hasText("Watch Movie")).performClick()
        rule.runOnIdle {
            val request = (state.top as Screen.Player).request as PlayRequest.Vod
            assertEquals(SubtitleQuery(ExtrasTitle(tmdb = 603)), request.extras)
        }
    }

    @Test fun episodesLookTheirSubtitlesUpByTheSeriesIdAndTheirNumbers() {
        val show = Series("s-extras", "Thrones", null, "Plot", null, "1", null, "2011", null, tmdb = "1399")
        fun episode(id: String, season: Int, number: Int) = Episode(id, season, number, "Episode $number", null, null, 0, "https://video.example/$id.mp4")
        @Suppress("UNCHECKED_CAST")
        val infos = Repo::class.java.getDeclaredField("seriesInfoCache").apply { isAccessible = true }.get(null) as MutableMap<String, SeriesInfo>
        infos[show.id] = SeriesInfo(null, null, null, null, null, mapOf(1 to listOf(episode("e:3", 1, 3), episode("e:4", 1, 4)), 2 to listOf(episode("e:9", 2, 0))))
        try {
            val state = AppState(Tab.HOME)
            mount { SeriesDetailScreen(show, state) }
            await { rule.onAllNodes(hasClickAction() and hasText("Watch Series")).fetchSemanticsNodes().isNotEmpty() }
            rule.onNode(hasClickAction() and hasText("Watch Series")).performClick()
            rule.runOnIdle {
                val request = (state.top as Screen.Player).request as PlayRequest.Vod
                assertEquals(SubtitleQuery(ExtrasTitle(tmdb = 1399), season = 1, episode = 3), request.extras)
                // The queued episodes have their own numbers; one without an episode number gets no lookup.
                assertEquals(listOf(SubtitleQuery(ExtrasTitle(tmdb = 1399), season = 1, episode = 4), null), request.queue.map { it.extras })
            }
        } finally { infos.remove(show.id) }
    }

    /** Tall enough for every Settings row to be composed at once. */
    @Test @Config(qualifiers = "w960dp-h3000dp-mdpi")
    fun aboutShowsTheOpenSubtitlesCreditInBothEditionsWithoutTmdb() {
        Repo.catalogRows.value = CatalogRows.NONE
        val store = androidx.compose.runtime.mutableStateOf(false)
        rule.setContent { TunerTheme { SettingsScreen(AppState(Tab.SETTINGS), store = store.value) } }
        rule.waitForIdle()
        rule.onNode(hasTestTag("setting:opensubtitles") and hasText(ExtrasApi.CREDIT)).assertExists()
        rule.onNodeWithText("About").assertExists()
        rule.runOnIdle { store.value = true }
        rule.waitForIdle()
        rule.onNode(hasTestTag("setting:opensubtitles") and hasText(ExtrasApi.CREDIT)).assertExists()
        assertEquals("Subtitles provided by OpenSubtitles.com", ExtrasApi.CREDIT)
    }
}

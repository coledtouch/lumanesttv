package tv.lumanest.tuner

import android.os.Looper
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.snapshots.Snapshot
import androidx.compose.ui.input.InputMode
import androidx.compose.ui.input.InputModeManager
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.platform.LocalInputModeManager
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.assertIsFocused
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performKeyInput
import androidx.compose.ui.test.performSemanticsAction
import androidx.compose.ui.test.pressKey
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
import tv.lumanest.tuner.data.Category
import tv.lumanest.tuner.data.Extras
import tv.lumanest.tuner.data.ExtrasApi
import tv.lumanest.tuner.data.ExtrasClient
import tv.lumanest.tuner.data.LoadStatus
import tv.lumanest.tuner.data.Movie
import tv.lumanest.tuner.data.Repo
import tv.lumanest.tuner.data.Source
import tv.lumanest.tuner.data.SourceType
import tv.lumanest.tuner.ui.AppState
import tv.lumanest.tuner.ui.HomeScreen
import tv.lumanest.tuner.ui.MovieDetailScreen
import tv.lumanest.tuner.ui.Screen
import tv.lumanest.tuner.ui.Tab
import tv.lumanest.tuner.ui.TunerTheme
import tv.lumanest.tuner.ui.trailerQueryOf
import java.time.Duration
import java.util.concurrent.CopyOnWriteArrayList

/**
 * A card that keeps the focus on Home, or is chosen, has its trailer looked up before its page opens, so the page
 * has the Trailer button at once (docs/extras.md, "The Trailer button").
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [34], qualifiers = "w960dp-h540dp-land-xhdpi")
@OptIn(androidx.compose.ui.ExperimentalComposeUiApi::class, ExperimentalTestApi::class)
class TrailerPrefetchScreensTest {
    @get:Rule val rule = createAndroidComposeRule<androidx.activity.ComponentActivity>()

    private val sourceId = "trailer-prefetch-" + java.util.UUID.randomUUID()
    private val original = Extras.client
    private val requests = CopyOnWriteArrayList<String>()

    private fun item(id: Long, title: String) =
        """{"id":$id,"title":"$title","original_title":"$title","year":"2024","origin":["US"],"genres":[28]}"""

    @Before fun seed() {
        Repo.init(rule.activity.applicationContext)
        Repo.prefs.saveSource(Source(sourceId, "Prefetch test", SourceType.M3U))
        Repo.prefs.setActive(sourceId)
        Repo.prefs.guidePreview = false
        Repo.prefs.setVodUsOnly(true)
        Repo.movieCategories.value = listOf(Category("en", "EN | Movies"))
        Repo.movies.value = (1..12).map { Movie("m:$it", "Film $it (2024)", null, null, "en", "https://video.example/$it.mp4", added = it.toLong()) }
        Repo.seriesCategories.value = emptyList()
        Repo.series.value = emptyList()
        val movies = (1..12).joinToString(",", "[", "]") { item(100L + it, "Film $it") }
        Repo.catalogRows.value = CatalogRows.parse("""{"v":1,"source":"tmdb","movie":{"popular":$movies},"tv":{},
            "genres":{"movie":[{"id":28,"name":"Action"}],"tv":[]}}""")!!
        Repo.vodStatus.value = LoadStatus.Ready
        Repo.seriesStatus.value = LoadStatus.Ready
        Repo.liveStatus.value = LoadStatus.Ready
        Extras.client = ExtrasClient(fetch = { url, _, _ ->
            requests += url
            """{"v":1,"status":"ok","tmdb":1,"trailer":{"key":"vKQi3bBA1y8","name":"Official Trailer"}}"""
        })
    }

    @After fun reset() {
        Extras.client = original
        Repo.prefs.deleteSource(sourceId)
        Repo.catalogRows.value = CatalogRows.NONE
    }

    private fun mount(state: AppState) {
        rule.setContent {
            CompositionLocalProvider(LocalInputModeManager provides object : InputModeManager {
                override val inputMode = InputMode.Keyboard
                override fun requestInputMode(inputMode: InputMode) = true
            }) {
                TunerTheme {
                    when (val top = state.top) {
                        is Screen.MovieDetail -> MovieDetailScreen(top.movie, state)
                        else -> HomeScreen(state, store = false)
                    }
                }
            }
        }
    }

    private fun await(check: () -> Boolean) {
        rule.waitUntil(timeoutMillis = 5_000) {
            org.robolectric.shadows.ShadowLooper.idleMainLooper()
            rule.runOnIdle { Snapshot.sendApplyNotifications() }
            check()
        }
    }

    private fun press(key: Key) {
        rule.onRoot().performKeyInput { pressKey(key) }
        rule.waitForIdle()
    }

    /** The main thread's clock, which runs the prefetch's focus delay. */
    private fun idle(ms: Long) {
        shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(ms))
        rule.waitForIdle()
    }

    private fun urlOf(id: String) = ExtrasApi.trailerUrl(trailerQueryOf(Repo.movies.value.first { it.id == id })!!)

    @Test fun aCardThatKeepsTheFocusOrIsChosenHasItsTrailerBeforeItsPageOpens() {
        val state = AppState(Tab.HOME)
        mount(state)
        await { state.lastFocusedKey == "home:movies:popular:movie:m:1" && !state.restoreFocus }
        // The page's own ids: the TMDB match of the popularity list, as the details page sends.
        assertTrue(urlOf("m:1"), urlOf("m:1").endsWith("&tmdb=101"))
        idle(TrailerPrefetchWait - 100)
        assertEquals(emptyList<String>(), requests.toList())
        idle(100)
        assertEquals(listOf(urlOf("m:1")), requests.toList())
        // Passing over cards asks nothing; the one the focus stays on is asked about.
        press(Key.DirectionRight)
        press(Key.DirectionRight)
        press(Key.DirectionRight)
        idle(TrailerPrefetchWait)
        assertEquals(listOf(urlOf("m:1"), urlOf("m:4")), requests.toList())
        // Chosen before its delay ends: asked at once, and its page has the Trailer button with no request of its own.
        press(Key.DirectionRight)
        press(Key.Enter)
        await { state.top is Screen.MovieDetail }
        assertEquals(listOf(urlOf("m:1"), urlOf("m:4"), urlOf("m:5")), requests.toList())
        await { rule.onAllNodesWithTag("trailer").fetchSemanticsNodes().isNotEmpty() }
        assertEquals(3, requests.size)
    }

    @Test fun aClientThatIsOffSpendsNoneOfTheFocusLookupsBudget() {
        // Off (as every test's client is unless it sets one): nothing is asked, and the minute's budget stays whole.
        val on = Extras.client
        Extras.client = ExtrasClient(enabled = false, fetch = { url, _, _ -> requests += url; null })
        val state = AppState(Tab.HOME)
        mount(state)
        await { state.lastFocusedKey == "home:movies:popular:movie:m:1" && !state.restoreFocus }
        idle(TrailerPrefetchWait)
        repeat(tv.lumanest.tuner.data.TrailerPrefetcher.MAX_PER_MINUTE) {
            press(Key.DirectionRight)
            idle(TrailerPrefetchWait)
        }
        assertEquals(emptyList<String>(), requests.toList())
        Extras.client = on
        press(Key.DirectionRight)
        idle(TrailerPrefetchWait)
        assertEquals(listOf(urlOf("m:8")), requests.toList())
    }

    @Test fun searchResultsLookTheirTrailerUpTheSameWay() {
        val state = AppState().apply { tab = Tab.SEARCH; searchQuery = "Film 1" }
        mount(state)
        fun hit(id: String) = "search-hit:$sourceId:movie:$id"
        await { rule.onAllNodesWithTag(hit("m:10")).fetchSemanticsNodes().size == 1 }
        rule.onNodeWithTag(hit("m:1")).performSemanticsAction(SemanticsActions.RequestFocus) { it() }
        rule.onNodeWithTag(hit("m:1")).assertIsFocused()
        idle(TrailerPrefetchWait)
        assertEquals(listOf(urlOf("m:1")), requests.toList())
        rule.onNodeWithTag(hit("m:10")).performSemanticsAction(SemanticsActions.RequestFocus) { it() }
        press(Key.Enter)
        await { state.top is Screen.MovieDetail }
        assertEquals(listOf(urlOf("m:1"), urlOf("m:10")), requests.toList())
        await { rule.onAllNodesWithTag("trailer").fetchSemanticsNodes().isNotEmpty() }
        assertEquals(2, requests.size)
    }

    private companion object {
        const val TrailerPrefetchWait = tv.lumanest.tuner.data.TrailerPrefetcher.DEBOUNCE_MS
    }
}

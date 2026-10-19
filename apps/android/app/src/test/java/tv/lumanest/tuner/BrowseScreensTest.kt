package tv.lumanest.tuner

import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.snapshots.Snapshot
import androidx.compose.ui.input.InputMode
import androidx.compose.ui.input.InputModeManager
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.platform.LocalInputModeManager
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertIsFocused
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasContentDescription
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
import androidx.compose.ui.test.performSemanticsAction
import androidx.compose.ui.test.pressKey
import tv.lumanest.tuner.data.BrowseList
import tv.lumanest.tuner.data.CatalogRows
import tv.lumanest.tuner.data.Category
import tv.lumanest.tuner.data.LoadStatus
import tv.lumanest.tuner.data.Movie
import tv.lumanest.tuner.data.Recent
import tv.lumanest.tuner.data.Repo
import tv.lumanest.tuner.data.Series
import tv.lumanest.tuner.data.Source
import tv.lumanest.tuner.data.SourceType
import tv.lumanest.tuner.data.VodType
import tv.lumanest.tuner.ui.AppState
import tv.lumanest.tuner.ui.HomeScreen
import tv.lumanest.tuner.ui.Screen
import tv.lumanest.tuner.ui.SeriesDetailScreen
import tv.lumanest.tuner.ui.SettingsScreen
import tv.lumanest.tuner.ui.TMDB_NOTICE
import tv.lumanest.tuner.ui.Tab
import tv.lumanest.tuner.ui.TunerTheme
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/** Home, Discover, Library and the Movies & Series switch on a TV-sized screen, driven with the remote's keys. */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [34], qualifiers = "w960dp-h540dp-land-xhdpi")
@OptIn(androidx.compose.ui.ExperimentalComposeUiApi::class, ExperimentalTestApi::class)
class BrowseScreensTest {
    @get:Rule val rule = createAndroidComposeRule<androidx.activity.ComponentActivity>()

    private fun item(id: Long, title: String, origin: String = "US", genres: String = "") =
        """{"id":$id,"title":"$title","original_title":"$title","year":"2024","origin":["$origin"],"genres":[$genres]}"""

    private val tmdbRows by lazy {
        val movies = (1..25).joinToString(",", "[", "]") { item(100L + it, "Film $it", genres = if (it % 2 == 0) "18" else "28") }
        val shows = (1..8).joinToString(",", "[", "]") { item(200L + it, "Show $it") }
        CatalogRows.parse("""{"v":1,"source":"tmdb","movie":{"popular":$movies,"top_rated":${movies.replace("Film", "Film")}},
            "tv":{"popular":$shows,"services":{"netflix":$shows}},
            "genres":{"movie":[{"id":28,"name":"Action"},{"id":18,"name":"Drama"}],"tv":[]}}""")!!
    }

    @Before fun seed() {
        Repo.init(rule.activity.applicationContext)
        // A playlist of its own per test: Library favorites, progress and history start empty.
        Repo.prefs.saveSource(Source(sourceId, "Browse test", SourceType.M3U))
        Repo.prefs.setActive(sourceId)
        Repo.prefs.guidePreview = false
        Repo.prefs.setVodUsOnly(true)
        Repo.prefs.libraryFavorites.value.forEach { Repo.prefs.toggleLibraryFavorite(it) }
        val english = Category("en", "EN | Movies")
        val french = Category("fr", "FR | Films")
        Repo.movieCategories.value = listOf(english, french)
        Repo.movies.value = (1..25).map { Movie("m:$it", "Film $it (2024)", null, "${it % 10}", "en", "https://video.example/$it.mp4", added = it.toLong()) } +
            (1..4).map { Movie("m:fr$it", "Film Français $it", null, null, "fr", "https://video.example/fr$it.mp4", added = 100L + it, genre = "Drama") }
        Repo.seriesCategories.value = listOf(Category("shows", "EN | Series"))
        Repo.series.value = (1..8).map { Series("$it", "Show $it", null, "Plot $it", "8", "shows", "Drama", "2024", null, it.toLong()) }
        Repo.catalogRows.value = tmdbRows
        Repo.vodStatus.value = LoadStatus.Ready
        Repo.seriesStatus.value = LoadStatus.Ready
        Repo.liveStatus.value = LoadStatus.Ready
    }

    private val sourceId = "browse-screens-" + java.util.UUID.randomUUID()

    @After fun reset() {
        Repo.prefs.deleteSource(sourceId)
        Repo.prefs.setVodUsOnly(true)
        Repo.catalogRows.value = CatalogRows.NONE
        Repo.prefs.libraryFavorites.value.forEach { Repo.prefs.toggleLibraryFavorite(it) }
    }

    private fun mount(state: AppState, store: Boolean = false) {
        rule.setContent {
            CompositionLocalProvider(LocalInputModeManager provides object : InputModeManager {
                override val inputMode = InputMode.Keyboard
                override fun requestInputMode(inputMode: InputMode) = true
            }) { TunerTheme { if (state.top == Screen.Home) HomeScreen(state, store) else androidx.compose.material3.Text("Detail destination") } }
        }
    }

    private fun await(check: () -> Boolean) {
        rule.waitUntil(timeoutMillis = 5_000) {
            org.robolectric.shadows.ShadowLooper.idleMainLooper()
            rule.runOnIdle { Snapshot.sendApplyNotifications() }
            rule.mainClock.advanceTimeByFrame()
            check()
        }
    }

    private fun press(key: Key, times: Int = 1) {
        rule.onRoot().performKeyInput { repeat(times) { pressKey(key) } }
        rule.waitForIdle()
    }

    @Test fun homeRowsEndWithSeeAllWhichOpensDiscoverPreFilteredAndBackReturns() {
        val state = AppState(Tab.HOME)
        mount(state)
        await { state.lastFocusedKey == "home:movies:popular:movie:m:1" && !state.restoreFocus }
        listOf("Popular – Movies", "Popular – Series").forEach { rule.onNodeWithText(it).assertExists() }
        rule.onAllNodesWithText("Featured – Movies").assertCountEquals(0)
        // USA only: the French films' category fails the filter, so Recently added starts with the newest English film.
        rule.runOnIdle {
            val rows = Repo.browse.value!!.catalog.homeRows(usOnly = true, store = false)
            assertEquals(listOf("Popular – Movies", "Popular – Series", "Netflix – Series", "Recently added – Movies", "Recently added – Series",
                "Top rated – Movies", "Top rated – Series"), rows.map { it.title })
            assertEquals("m:25", rows[3].titles.first().movie!!.id)
        }
        // Twenty posters, then See all.
        press(Key.DirectionRight, 20)
        rule.onNodeWithTag("card:home:movies:popular:see-all").assertIsFocused()
        rule.onNode(hasContentDescription("See all, Popular – Movies")).assertExists()
        press(Key.Enter)
        await { state.tab == Tab.DISCOVER && state.discover.focusedKey == "discover:movie:m:1" && !state.restoreFocus }
        rule.runOnIdle {
            assertEquals(VodType.MOVIES, state.discover.type)
            assertEquals(BrowseList.POPULAR, state.discover.list)
            assertNull(state.discover.genre)
            assertEquals("home:movies:popular:see-all", state.discover.openedFrom)
        }
        rule.onNode(hasContentDescription("Type: Movies")).assertExists()
        rule.onNode(hasContentDescription("List: Popular")).assertExists()
        rule.onNode(hasContentDescription("Genre: All")).assertExists()
        rule.onNodeWithText("25 titles").assertExists()
        rule.onNodeWithTag("card:discover:movie:m:1").assertIsFocused()
        // The grid has no 20-title limit: the last popular film is there too.
        rule.runOnIdle { rule.activity.onBackPressedDispatcher.onBackPressed() }
        await { state.tab == Tab.HOME && !state.restoreFocus }
        rule.onNodeWithTag("card:home:movies:popular:see-all").assertIsFocused()
        rule.runOnIdle { assertNull(state.discover.openedFrom) }
        // Back from Home goes to the top bar, one level up.
        rule.runOnIdle { rule.activity.onBackPressedDispatcher.onBackPressed() }
        rule.waitForIdle()
        rule.runOnIdle { assertTrue(state.navigationFocused); assertEquals(Tab.HOME, state.tab) }
    }

    @Test fun discoverFiltersWorkWithTheRemote() {
        val state = AppState(Tab.HOME).apply { openDiscover(VodType.MOVIES) }
        mount(state)
        await { state.discover.focusedKey == "discover:movie:m:1" && !state.restoreFocus }
        rule.onNode(hasContentDescription("List: Popular")).assertExists()
        // Up from the grid's first row reaches the filters.
        press(Key.DirectionUp)
        rule.runOnIdle { assertTrue(state.discover.focusedKey!!.startsWith("filter:")) }
        // Type: OK opens the choices with the current one focused; Down and OK picks Series.
        rule.onNodeWithTag("discover-filter:type").performSemanticsAction(SemanticsActions.RequestFocus) { it() }
        press(Key.Enter)
        rule.onNodeWithTag("discover-sheet").assertExists()
        rule.onNode(hasClickAction() and hasText("Movies") and !hasTestTag("discover-filter:type")).assertIsFocused()
        press(Key.DirectionDown)
        press(Key.Enter)
        await { rule.onAllNodesWithTag("discover-sheet").fetchSemanticsNodes().isEmpty() && !state.restoreFocus }
        rule.onNodeWithTag("discover-filter:type").assertIsFocused()
        rule.runOnIdle { assertEquals(VodType.SERIES, state.discover.type) }
        await { rule.onAllNodesWithText("8 titles").fetchSemanticsNodes().isNotEmpty() }
        rule.onNode(hasContentDescription("List: Popular")).assertExists()

        // List: Netflix (series), then back to Movies, Top rated.
        rule.onNodeWithTag("discover-filter:list").performClick()
        rule.onNode(hasClickAction() and hasText("Netflix")).performClick()
        await { state.discover.list == "netflix" }
        rule.onNode(hasContentDescription("List: Netflix")).assertExists()
        rule.onNodeWithTag("discover-filter:type").performClick()
        rule.onNode(hasClickAction() and hasText("Movies") and !hasTestTag("discover-filter:type")).performClick()
        // Movies have no Netflix list here: Discover falls back to Popular.
        await { rule.onAllNodesWithText("25 titles").fetchSemanticsNodes().isNotEmpty() }
        rule.onNode(hasContentDescription("List: Popular")).assertExists()
        rule.onNodeWithTag("discover-filter:list").performClick()
        listOf("Popular", "Top rated", "Recently added", "A–Z").forEach { rule.onNode(hasClickAction() and hasText(it) and !hasTestTag("discover-filter:list")).assertExists() }
        rule.onAllNodes(hasClickAction() and hasText("Featured")).assertCountEquals(0)
        rule.onNode(hasClickAction() and hasText("Recently added")).performClick()
        await { state.discover.list == BrowseList.RECENT }

        // Genre: TMDB's genres for matched films, the provider's for the rest.
        rule.onNodeWithTag("discover-filter:genre").performClick()
        rule.onNode(hasClickAction() and hasText("Drama")).performClick()
        await { rule.onAllNodesWithText("12 titles").fetchSemanticsNodes().isNotEmpty() }
        rule.onNode(hasContentDescription("Genre: Drama")).assertExists()
        // Movies & Series: All adds the four French films, all dramas.
        rule.runOnIdle { Repo.prefs.setVodUsOnly(false) }
        await { rule.onAllNodesWithText("16 titles").fetchSemanticsNodes().isNotEmpty() }
        rule.onNodeWithTag("discover-filter:genre").performClick()
        rule.onNode(hasClickAction() and hasText("All")).performClick()
        await { rule.onAllNodesWithText("29 titles").fetchSemanticsNodes().isNotEmpty() }
    }

    @Test fun discoverRestoresTheFocusedPosterAfterATitleCloses() {
        val state = AppState(Tab.HOME).apply { openDiscover(VodType.MOVIES, BrowseList.AZ) }
        mount(state)
        await { state.discover.focusedKey?.startsWith("discover:") == true && !state.restoreFocus }
        press(Key.DirectionDown)
        press(Key.DirectionRight, 2)
        val focused = state.discover.focusedKey!!
        press(Key.Enter)
        await { state.top is Screen.MovieDetail }
        rule.runOnIdle { state.pop() }
        await { !state.restoreFocus }
        rule.onNodeWithTag("card:$focused").assertIsFocused()
        rule.runOnIdle { assertEquals(focused, state.discover.focusedKey) }
    }

    @Test fun discoverKeepsItsGridAndFocusWhileTheLibraryIsRebuilt() {
        val state = AppState(Tab.HOME).apply { openDiscover(VodType.MOVIES, BrowseList.AZ) }
        mount(state)
        await { state.discover.focusedKey == "discover:movie:m:1" && !state.restoreFocus }
        // A–Z: Film 1, Film 10, Film 11, ...
        press(Key.DirectionRight, 2)
        rule.onNodeWithTag("card:discover:movie:m:11").assertIsFocused()
        // A refresh brings one more film: a new index for the same playlist. The grid stays, and so does focus.
        val before = Repo.browse.value
        rule.runOnIdle { Repo.movies.value = Repo.movies.value + Movie("m:26", "Film 26 (2024)", null, "7", "en", "https://video.example/26.mp4", added = 26) }
        await { Repo.browse.value !== before }
        await { rule.onAllNodesWithText("26 titles").fetchSemanticsNodes().isNotEmpty() }
        rule.onNodeWithTag("card:discover:movie:m:11").assertIsFocused()
        rule.onAllNodesWithText("Finding titles…").assertCountEquals(0)
        // A series-only change reuses the films' index and keeps the grid as it is.
        val withNewFilm = Repo.browse.value!!
        rule.runOnIdle { Repo.series.value = Repo.series.value.dropLast(1) }
        await { Repo.browse.value !== withNewFilm }
        rule.runOnIdle { assertSame(withNewFilm.catalog.movies, Repo.browse.value!!.catalog.movies) }
        rule.waitForIdle()
        rule.onNodeWithTag("card:discover:movie:m:11").assertIsFocused()
        // The focused film leaves the playlist: the film now at its place takes focus.
        val refreshed = Repo.browse.value
        rule.runOnIdle { Repo.movies.value = Repo.movies.value.filterNot { it.id == "m:11" } }
        await { Repo.browse.value !== refreshed }
        await { focused("card:discover:movie:m:12") && !state.restoreFocus }
        rule.onNodeWithText("25 titles").assertExists()
        rule.runOnIdle { assertEquals("discover:movie:m:12", state.discover.focusedKey) }
    }

    private fun focused(tag: String) = runCatching { rule.onNodeWithTag(tag).assertIsFocused() }.isSuccess

    @Test fun aFailedLoadSaysSoOnHomeAndDiscoverInsteadOfNoTitles() {
        val error = "Can't reach the server. Check the URL."
        Repo.movies.value = emptyList()
        Repo.series.value = emptyList()
        Repo.vodStatus.value = LoadStatus.Error(error)
        Repo.seriesStatus.value = LoadStatus.Error(error)
        try {
            val state = AppState(Tab.HOME)
            mount(state)
            await { rule.onAllNodesWithText("Couldn't load your library").fetchSemanticsNodes().isNotEmpty() && !state.restoreFocus }
            rule.onNodeWithText(error).assertExists()
            rule.onAllNodesWithText("No movies or series yet").assertCountEquals(0)
            rule.onNodeWithTag("empty-action:Live TV").assertIsFocused()
            rule.onNodeWithTag("empty-action:Settings").assertExists()
            rule.runOnIdle { state.discover.openedFrom = null; state.tab = Tab.DISCOVER; state.restoreFocus = true }
            await { rule.onAllNodesWithTag("discover").fetchSemanticsNodes().isNotEmpty() && !state.restoreFocus }
            rule.onNodeWithText("Couldn't load your library").assertExists()
            rule.onAllNodesWithText("No titles match these filters").assertCountEquals(0)
            rule.onNodeWithTag("empty-action:Live TV").assertIsFocused()
            press(Key.DirectionRight)
            press(Key.Enter)
            await { state.tab == Tab.SETTINGS }
        } finally {
            Repo.vodStatus.value = LoadStatus.Ready
            Repo.seriesStatus.value = LoadStatus.Ready
        }
    }

    @Test fun discoverOpensOnSeriesForAPlaylistWithoutFilms() {
        Repo.movies.value = emptyList()
        val state = AppState(Tab.HOME)
        mount(state)
        await { state.rowFocus["home"] != null && !state.restoreFocus }
        rule.runOnIdle { state.discover.openedFrom = null; state.tab = Tab.DISCOVER; state.restoreFocus = true }
        await { state.discover.focusedKey == "discover:series:1" && !state.restoreFocus }
        rule.runOnIdle { assertEquals(VodType.SERIES, state.discover.type) }
        rule.onNode(hasContentDescription("Type: Series")).assertExists()
        rule.onNodeWithText("8 titles").assertExists()
    }

    @Test fun removingALibraryTitleFocusesTheOneThatTakesItsPlace() {
        listOf("movie:m:3", "movie:m:4", "movie:m:5").forEach { Repo.prefs.toggleLibraryFavorite(it) }
        val state = AppState(Tab.LIBRARY)
        mount(state)
        await { state.rowFocus["library"] == "library:favorite-movies:movie:m:5" && !state.restoreFocus }
        press(Key.DirectionRight)
        rule.onNodeWithTag("card:library:favorite-movies:movie:m:4").assertIsFocused()
        // Hold OK removes it; focus moves to the next poster in the row, not back to the first row.
        rule.onNodeWithTag("card:library:favorite-movies:movie:m:4").performSemanticsAction(SemanticsActions.OnLongClick) { it() }
        await { focused("card:library:favorite-movies:movie:m:3") && !state.restoreFocus }
        rule.runOnIdle { assertEquals(listOf("movie:m:5", "movie:m:3"), Repo.prefs.libraryFavorites.value) }
    }

    @Test fun theSeriesPageOffersAddToLibraryWhenItsEpisodesFailToLoad() {
        val state = AppState(Tab.HOME)
        val show = Repo.series.value.first()
        rule.setContent {
            CompositionLocalProvider(LocalInputModeManager provides object : InputModeManager {
                override val inputMode = InputMode.Keyboard
                override fun requestInputMode(inputMode: InputMode) = true
            }) { TunerTheme { SeriesDetailScreen(show, state) } }
        }
        // This playlist has no Xtream server: the episode list can't load.
        await { rule.onAllNodesWithText("Couldn't load episodes").fetchSemanticsNodes().isNotEmpty() }
        rule.onNodeWithText("Try again").assertIsFocused()
        press(Key.DirectionRight)
        rule.onNode(hasClickAction() and hasText("Add to Library")).assertIsFocused()
        press(Key.Enter)
        await { rule.onAllNodesWithText("In Library").fetchSemanticsNodes().isNotEmpty() }
        rule.runOnIdle { assertEquals(listOf("series:${show.id}"), Repo.prefs.libraryFavorites.value) }
    }

    /** Tall enough for all four Library rows. */
    @Test @Config(qualifiers = "w960dp-h1600dp-xhdpi")
    fun libraryShowsSavedTitlesWithCheckBadgesAndProgress() {
        val now = System.currentTimeMillis()
        Repo.prefs.toggleLibraryFavorite("movie:m:3")
        Repo.prefs.toggleLibraryFavorite("series:2")
        Repo.prefs.saveProgress(Recent("m:4", "Film 4 (2024)", null, null, "https://video.example/4.mp4", 1_200_000, 4_800_000, now, titleKey = "movie:m:4"))
        try {
            val state = AppState(Tab.LIBRARY)
            mount(state)
            await { state.rowFocus["library"] != null && !state.restoreFocus }
            listOf("Continue watching", "Favorite movies", "Favorite series", "Recently watched").forEach { rule.onNodeWithText(it).assertExists() }
            rule.onNodeWithTag("card:library:continue:movie:m:4").assertIsFocused()
            rule.onAllNodesWithTag("library-badge", useUnmergedTree = true).assertCountEquals(2)
            // The film in progress has its bar in Continue watching and in Recently watched.
            rule.onAllNodesWithTag("progress-bar", useUnmergedTree = true).assertCountEquals(2)
            // Hold OK removes a title from the Library.
            rule.onNodeWithTag("card:library:favorite-movies:movie:m:3").performSemanticsAction(SemanticsActions.OnLongClick) { it() }
            await { rule.onAllNodesWithText("Favorite movies").fetchSemanticsNodes().isEmpty() }
            rule.runOnIdle { assertEquals(listOf("series:2"), Repo.prefs.libraryFavorites.value) }
            // Home marks Library titles with the same badge.
            rule.runOnIdle { state.tab = Tab.HOME; state.restoreFocus = true }
            await { state.rowFocus["home"] != null && !state.restoreFocus }
            assertTrue(rule.onAllNodesWithTag("library-badge", useUnmergedTree = true).fetchSemanticsNodes().isNotEmpty())
        } finally {
            Repo.prefs.saveProgress(Recent("m:4", "Film 4 (2024)", null, null, "https://video.example/4.mp4", 4_800_000, 4_800_000, now))
        }
    }

    @Test fun emptyLibraryOffersDiscover() {
        val state = AppState(Tab.LIBRARY)
        mount(state)
        await { !state.restoreFocus }
        rule.onNodeWithText("Your Library is empty").assertExists()
        rule.onNodeWithTag("empty-action:Discover").assertIsFocused()
        press(Key.Enter)
        await { state.tab == Tab.DISCOVER && !state.restoreFocus }
    }

    /** Tall enough for every Settings row to be composed at once. */
    @Test @Config(qualifiers = "w960dp-h3000dp-mdpi")
    fun settingsSwitchesMoviesAndSeriesAndShowsTmdbAttributionOnlyWithTmdb() {
        Repo.catalogRows.value = CatalogRows.NONE
        Repo.prefs.setStartOnLiveTv(false)
        val state = AppState(Tab.SETTINGS)
        rule.setContent { TunerTheme { SettingsScreen(state, store = false) } }
        rule.waitForIdle()
        val row = rule.onNodeWithTag("setting:vod-us-only")
        row.assertExists()
        rule.onNode(hasTestTag("setting:vod-us-only") and hasText("USA only")).assertExists()
        rule.onAllNodesWithText(TMDB_NOTICE).assertCountEquals(0)
        row.performClick()
        rule.waitForIdle()
        rule.runOnIdle { assertFalse(Repo.prefs.vodUsOnly.value); assertFalse(Repo.prefs.usOnly.value) }
        rule.onNode(hasTestTag("setting:vod-us-only") and hasText("All")).assertExists()
        rule.runOnIdle { Repo.catalogRows.value = tmdbRows }
        rule.waitForIdle()
        rule.onNodeWithText(TMDB_NOTICE).assertExists()
        assertEquals("This product uses the TMDB API but is not endorsed or certified by TMDB.", TMDB_NOTICE)
        row.performClick()
        rule.waitForIdle()
        rule.runOnIdle { assertTrue(Repo.prefs.vodUsOnly.value) }
        // Start on: Home by default, Live TV on request.
        rule.onNode(hasClickAction() and hasText("Start on") and hasText("Home")).performClick()
        rule.runOnIdle { assertTrue(Repo.prefs.startOnLiveTv.value) }
        rule.onNode(hasClickAction() and hasText("Start on") and hasText("Live TV")).performClick()
        rule.runOnIdle { assertFalse(Repo.prefs.startOnLiveTv.value) }
    }
}

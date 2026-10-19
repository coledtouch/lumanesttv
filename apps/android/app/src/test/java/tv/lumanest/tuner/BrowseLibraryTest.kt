package tv.lumanest.tuner

import tv.lumanest.tuner.data.CatalogSnapshots
import tv.lumanest.tuner.data.Category
import tv.lumanest.tuner.data.Cleanup
import tv.lumanest.tuner.data.ContentPolicy
import tv.lumanest.tuner.data.Movie
import tv.lumanest.tuner.data.Prefs
import tv.lumanest.tuner.data.Recent
import tv.lumanest.tuner.data.Series
import tv.lumanest.tuner.data.Source
import tv.lumanest.tuner.data.SourceType
import tv.lumanest.tuner.data.Xtream
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

/** What browsing keeps: provider TMDB ids, the Movies & Series switch, Library favorites, next-up episodes and history. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class BrowseLibraryTest {
    @get:Rule val temporary = TemporaryFolder()
    private lateinit var prefs: Prefs
    private val context get() = RuntimeEnvironment.getApplication()

    @Before fun setup() {
        context.getSharedPreferences("tuner", 0).edit().clear().commit()
        prefs = Prefs(context, storeBuild = false)
        prefs.saveSource(Source("a", "A", SourceType.M3U))
        prefs.saveSource(Source("b", "B", SourceType.M3U))
        prefs.setActive("a")
    }

    @Test fun xtreamListsKeepTmdbIdsYearsAndGenres() {
        val x = Xtream(Source("1", "t", SourceType.XTREAM, "http://host:8080", "user", "pass"))
        val movies = temporary.newFile("vod.json").apply { writeText("""[
            {"stream_id":1,"name":"Dune (2021)","category_id":"1","tmdb":"438631","year":"2021","genre":"Science Fiction, Adventure"},
            {"stream_id":2,"name":"Heat","category_id":"1","tmdb_id":949.0,"releaseDate":"1995-12-15"},
            {"stream_id":3,"name":"Arrival","category_id":"1","info":{"tmdb_id":"329865"}},
            {"stream_id":4,"name":"No id","category_id":"1","tmdb":"0","tmdb_id":"","year":"20"},
            {"stream_id":4,"name":"No id","category_id":"2","tmdb_id":"1234"},
            {"stream_id":5,"name":"Junk","category_id":"1","tmdb":"tt0111161"}]""") }
        val parsed = x.parseMovies(movies).associateBy { it.id }
        assertEquals("438631", parsed.getValue("m:1").tmdb)
        assertEquals("2021", parsed.getValue("m:1").year)
        assertEquals("Science Fiction, Adventure", parsed.getValue("m:1").genre)
        assertEquals("949", parsed.getValue("m:2").tmdb)
        assertEquals("1995", parsed.getValue("m:2").year)
        assertEquals("329865", parsed.getValue("m:3").tmdb)
        // "0" and blanks are no id; a later copy of the same stream can still bring one.
        assertEquals("1234", parsed.getValue("m:4").tmdb)
        assertEquals(listOf("1", "2"), parsed.getValue("m:4").categoryIds)
        assertNull(parsed.getValue("m:4").year)
        assertNull(parsed.getValue("m:5").tmdb)

        val series = temporary.newFile("series.json").apply { writeText("""[
            {"series_id":7,"name":"Severance","category_id":"3","tmdb":95396,"releaseDate":"2022-02-18","genre":"Drama"},
            {"series_id":8,"name":"Show","category_id":"3","year":"2019"}]""") }
        val shows = x.parseSeries(series).associateBy { it.id }
        assertEquals("95396", shows.getValue("7").tmdb)
        assertEquals("2022", shows.getValue("7").year)
        assertEquals("2019", shows.getValue("8").year)
        assertNull(shows.getValue("8").tmdb)
    }

    @Test fun snapshotsAndDuplicateCleanupKeepTheBrowseFields() {
        val source = Source("account", "Playlist", SourceType.XTREAM, "https://example.invalid", "user", "password")
        val identity = CatalogSnapshots.identity(source, "ts", "")
        val store = CatalogSnapshots(temporary.root)
        val now = System.currentTimeMillis()
        val movie = Movie("m:1", "Dune", null, "8", "1", "https://example.invalid/1.mkv", 5, tmdb = "438631", year = "2021", genre = "Sci-Fi",
            aliases = listOf("m:0"))
        val series = Series("7", "Severance", null, null, null, "1", "Drama", "2022", null, 9, tmdb = "95396")
        store.writeMovies(identity, ContentPolicy.Catalogue(listOf(movie), listOf(Category("1", "EN"))), now)
        store.writeSeries(identity, ContentPolicy.Catalogue(listOf(series), listOf(Category("1", "EN"))), now)
        assertEquals(movie, store.readMovies(identity, now)?.value?.items?.single())
        assertEquals(series, store.readSeries(identity, now)?.value?.items?.single())
        // Folding provider copies keeps the newest upload and whatever TMDB id any copy had.
        val copies = Cleanup.movies(listOf(movie.copy(id = "m:2", url = "https://example.invalid/2.mkv", added = 9, tmdb = null, year = null, aliases = emptyList()), movie))
        assertEquals("m:2", copies.single().id)
        assertEquals("438631", copies.single().tmdb)
        assertEquals("2021", copies.single().year)
        // ...and every older upload's id, its own aliases included, for the Library and saved positions.
        assertEquals(listOf("m:1", "m:0"), copies.single().aliases)
    }

    @Test fun moviesAndSeriesUsaOnlyIsOnByDefaultAndSeparateFromChannels() {
        assertTrue(prefs.vodUsOnly.value)
        assertFalse(prefs.usOnly.value)
        assertFalse(prefs.startOnLiveTv.value)
        prefs.setVodUsOnly(false)
        prefs.setStartOnLiveTv(true)
        val reopened = Prefs(context, storeBuild = false)
        assertFalse(reopened.vodUsOnly.value)
        assertFalse(reopened.usOnly.value)
        assertTrue(reopened.startOnLiveTv.value)
        reopened.setUsOnly(true)
        assertFalse(Prefs(context, storeBuild = false).vodUsOnly.value)
    }

    @Test fun libraryFavoritesAreNewestFirstAndPerPlaylist() {
        assertTrue(prefs.toggleLibraryFavorite("movie:m:1"))
        assertTrue(prefs.toggleLibraryFavorite("series:7"))
        assertFalse(prefs.toggleLibraryFavorite("channel:cnn"))
        assertEquals(listOf("series:7", "movie:m:1"), prefs.libraryFavorites.value)
        assertTrue(prefs.isLibraryFavorite("movie:m:1"))
        // Channel favorites are untouched.
        assertTrue(prefs.favorites.value.isEmpty())
        assertEquals(listOf("series:7", "movie:m:1"), Prefs(context, storeBuild = false).libraryFavorites.value)
        prefs.setActive("b")
        assertTrue(prefs.libraryFavorites.value.isEmpty())
        prefs.setActive("a")
        assertFalse(prefs.toggleLibraryFavorite("series:7"))
        assertEquals(listOf("movie:m:1"), prefs.libraryFavorites.value)
        // The provider re-uploaded m:1 as m:2: the film is still saved, and removing it removes the old key.
        assertTrue(prefs.isLibraryFavorite("movie:m:2", listOf("movie:m:1")))
        assertFalse(prefs.toggleLibraryFavorite("movie:m:2", listOf("movie:m:1")))
        assertTrue(prefs.libraryFavorites.value.isEmpty())
        assertTrue(prefs.toggleLibraryFavorite("movie:m:2", listOf("movie:m:1")))
        assertEquals(listOf("movie:m:2"), prefs.libraryFavorites.value)
    }

    @Test fun aFinishedEpisodeHandsContinueWatchingToTheNextOne() {
        val now = 1_000_000L
        val episode = Recent("e:1", "Severance", "S1 E1", null, "https://example.invalid/e1.mkv", 50_000, 3_000_000, now, titleKey = "series:7")
        val next = Recent("e:2", "Severance", "S1 E2", null, "https://example.invalid/e2.mkv", 0, 0, now, titleKey = "series:7")
        prefs.saveProgress(episode, next)
        assertEquals(listOf("e:1"), prefs.recents.value.map { it.id })
        assertEquals(listOf("series:7"), prefs.watchedTitles.value)
        prefs.saveProgress(episode.copy(positionMs = 2_990_000, updated = now + 1), next)
        val saved = prefs.recents.value.single()
        assertEquals("e:2", saved.id)
        assertTrue(saved.nextUp)
        assertEquals(0L, saved.positionMs)
        assertEquals("series:7", saved.titleKey)
        // Restarting keeps the title key and the next-up mark.
        val reopened = Prefs(context, storeBuild = false).recents.value.single()
        assertEquals(saved, reopened)
        // Starting the next episode replaces the mark with a real position.
        prefs.saveProgress(next.copy(positionMs = 30_000, durationMs = 3_000_000, updated = now + 2))
        assertFalse(prefs.recents.value.single().nextUp)
        // A finished movie leaves Continue watching but stays in Recently watched, newest first.
        prefs.saveProgress(Recent("m:9", "Heat", null, null, "https://example.invalid/m9.mkv", 99_000, 100_000, now + 3, titleKey = "movie:m:9"))
        assertEquals(listOf("e:2"), prefs.recents.value.map { it.id })
        assertEquals(listOf("movie:m:9", "series:7"), prefs.watchedTitles.value)
        prefs.setActive("b")
        assertTrue(prefs.watchedTitles.value.isEmpty())
    }

    @Test fun leavingTheUpNextEpisodeInItsFirstSecondsKeepsItInContinueWatching() {
        val now = 1_000_000L
        val episode = Recent("e:1", "Severance", "S1 E1", null, "https://example.invalid/e1.mkv", 2_990_000, 3_000_000, now, titleKey = "series:7")
        val next = Recent("e:2", "Severance", "S1 E2", null, "https://example.invalid/e2.mkv", 0, 0, now, titleKey = "series:7")
        prefs.saveProgress(episode, next)
        val waiting = prefs.recents.value.single()
        assertTrue(waiting.nextUp)
        // The player's 10 second save lands a few seconds into the next episode, then the viewer stops.
        prefs.saveProgress(next.copy(positionMs = 6_000, durationMs = 3_000_000, updated = now + 1))
        assertEquals(waiting, prefs.recents.value.single())
        assertEquals(waiting, Prefs(context, storeBuild = false).recents.value.single())
        assertEquals(listOf("series:7"), prefs.watchedTitles.value)
        // Past 15 seconds it is a real position.
        prefs.saveProgress(next.copy(positionMs = 16_000, durationMs = 3_000_000, updated = now + 2))
        assertEquals(16_000L, prefs.recents.value.single().positionMs)
        assertFalse(prefs.recents.value.single().nextUp)
        // An episode that isn't waiting keeps the old rule: under 15 seconds, nothing is kept (Start over from the page).
        prefs.saveProgress(next.copy(positionMs = 6_000, durationMs = 3_000_000, updated = now + 3))
        assertTrue(prefs.recents.value.isEmpty())
    }

    @Test fun olderSavedProgressStillLoads() {
        context.getSharedPreferences("tuner", 0).edit()
            .putString("recents_a", """[{"id":"m:1","title":"Old","subtitle":"","image":"","url":"https://example.invalid/1.mkv","pos":60000,"dur":120000,"updated":5}]""")
            .commit()
        val old = Prefs(context, storeBuild = false).also { it.setActive("a") }.recents.value.single()
        assertNull(old.titleKey)
        assertFalse(old.nextUp)
        assertEquals(60_000L, old.positionMs)
    }
}

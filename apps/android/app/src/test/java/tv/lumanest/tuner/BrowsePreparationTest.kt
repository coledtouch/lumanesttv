package tv.lumanest.tuner

import tv.lumanest.tuner.data.BrowseCatalog
import tv.lumanest.tuner.data.BrowseTitle
import tv.lumanest.tuner.data.CatalogRows
import tv.lumanest.tuner.data.Category
import tv.lumanest.tuner.data.ContinueItem
import tv.lumanest.tuner.data.Movie
import tv.lumanest.tuner.data.Recent
import tv.lumanest.tuner.data.Series
import tv.lumanest.tuner.data.VodType
import tv.lumanest.tuner.ui.BrowseActions
import tv.lumanest.tuner.ui.contentRating
import tv.lumanest.tuner.ui.homeBrowseRows
import tv.lumanest.tuner.ui.libraryBrowseRows
import tv.lumanest.tuner.ui.nearestPosition
import tv.lumanest.tuner.ui.prepareBrowse
import org.junit.Assert.*
import org.junit.Test
import java.util.Locale

/** Home and Library rows as the screens receive them: posters, badges, progress, See all and their actions. */
class BrowsePreparationTest {
    private val opened = ArrayList<String>()
    private val resumed = ArrayList<String>()
    private val seeAll = ArrayList<String>()
    private val saved = ArrayList<String>()
    private val actions = BrowseActions(
        open = { opened += it.key }, resume = { resumed += it.title.key }, seeAll = { type, list, row -> seeAll += "$type/$list/$row" },
        toggleLibrary = { saved += it.key },
    )

    @Test fun ratingsKeepTheirOneDecimalRounding() {
        listOf("8", "8.25", "9.95", "5.35", "0.05", "0.0001", "1000000", "1000001", Float.MAX_VALUE.toString()).forEach { value ->
            assertEquals(value, String.format(Locale.US, "%.1f", value.toFloat()).removeSuffix(".0"), contentRating(value))
        }
        listOf(null, "", "bad", "0", "-1", "NaN", "Infinity").forEach { assertNull(contentRating(it)) }
    }

    private fun library(): BrowseCatalog = BrowseCatalog.build(
        (0 until 12_700).map { index -> Movie("m:$index", "Movie $index", "https://img.example/$index.jpg", "8.25", "a", "https://example.invalid/$index.mp4", added = index + 1L) },
        listOf(Category("a", "EN | Movies")),
        (0 until 6).map { Series("$it", "Show $it", "https://img.example/s$it.jpg", "Plot $it", null, "a", "Drama", "2024", null, it + 1L) },
        listOf(Category("a", "EN | Series")),
        CatalogRows.NONE,
    )

    @Test fun homeRowsEndWithSeeAllAndCarryBadgesAndProgress() {
        val catalog = library()
        val recents = listOf(Recent("m:12699", "Movie 12699", null, null, "https://example.invalid/12699.mp4", 30_000, 120_000, 1, titleKey = "movie:m:12699"))
        val rows = homeBrowseRows(catalog, recents, setOf("movie:m:12698"), usOnly = true, store = false, actions = actions)
        assertEquals(listOf("Recently added – Movies", "Recently added – Series", "Top rated – Movies"), rows.map { it.title })
        // One poster in progress is not a Continue watching row: a row needs five.
        assertTrue(rows.none { it.key == "continue" })
        val recent = rows.first()
        assertEquals(21, recent.items.size)
        assertTrue(recent.items.last().seeAll)
        assertEquals("movie:m:12699", recent.items.first().key)
        assertEquals(0.25f, recent.items.first().progress)
        assertNull(recent.items.first().progressLabel)
        assertTrue(recent.items[1].favorite)
        assertFalse(recent.items[2].favorite)
        assertEquals("8.3", recent.items[2].badge)
        assertEquals("Plot 5", rows[1].items.first().heroPlot)
        assertEquals("2024  ·  Drama", rows[1].items.first().heroMeta)

        recent.items.first().onClick()
        recent.items.last().onClick()
        rows[1].items.last().onClick()
        recent.items[3].onLongClick!!()
        assertEquals(listOf("movie:m:12699"), opened)
        assertEquals(listOf("MOVIES/recent/movies:recent", "SERIES/recent/series:recent"), seeAll)
        assertEquals(listOf("movie:m:12696"), saved)

        // Indexing for focus: every card, with the row and position it is at.
        val prepared = prepareBrowse("home", rows)
        assertEquals(rows.sumOf { it.items.size }, prepared.itemsByKey.size)
        assertEquals(0, prepared.positions.getValue("home:movies:recent:movie:m:12699").row)
        assertEquals(20, prepared.positions.getValue("home:movies:recent:see-all").item)
        assertEquals(2, prepared.positions.getValue("home:movies:top_rated:movie:m:12699").row)
    }

    @Test fun continueWatchingNeedsFiveTitlesOnHomeAndOpensSeriesPages() {
        val catalog = library()
        val recents = (0 until 4).map { Recent("m:$it", "Movie $it", null, null, "https://example.invalid/$it.mp4", 20_000L + it, 100_000, 10L - it) } +
            Recent("e:1", "Show 2", "S1 E2 · Pilot", null, "https://example.invalid/e1.mp4", 0, 0, 1, titleKey = "series:2", nextUp = true)
        val rows = homeBrowseRows(catalog, recents, emptySet(), usOnly = true, store = false, actions = actions)
        val continuing = rows.first()
        assertEquals("Continue watching", continuing.title)
        assertEquals(listOf("movie:m:0", "movie:m:1", "movie:m:2", "movie:m:3", "series:2", "see-all"), continuing.items.map { it.key })
        assertEquals("Resume", continuing.items.first().progressLabel)
        assertEquals(0.2f, continuing.items.first().progress)
        val next = continuing.items[4]
        assertEquals("Up next", next.progressLabel)
        assertNull(next.progress)
        assertEquals("S1 E2 · Pilot", next.heroMeta)
        next.onClick()
        continuing.items.last().onClick()
        assertEquals(listOf("series:2"), resumed)
        assertEquals(listOf("MOVIES/continue/continue"), seeAll)
        // Four titles: no row on Home, but the Library always lists them.
        assertTrue(homeBrowseRows(catalog, recents.drop(1), emptySet(), true, false, actions).none { it.title == "Continue watching" })
        assertEquals(4, libraryBrowseRows(catalog, recents.drop(1), emptyList(), emptyList(), actions).single().items.size)
    }

    @Test fun libraryListsSavedTitlesInOrderWithoutTheUsaFilter() {
        val catalog = BrowseCatalog.build(
            listOf(Movie("m:1", "Film", null, null, "fr", "https://example.invalid/1.mp4"), Movie("m:2", "Other", null, null, "en", "https://example.invalid/2.mp4")),
            listOf(Category("fr", "FR | Films"), Category("en", "EN | Movies")),
            listOf(Series("7", "Show", null, null, null, "en", null, null, null)),
            listOf(Category("en", "EN | Series")),
            CatalogRows.NONE,
        )
        assertFalse(catalog["movie:m:1"]!!.us)
        val rows = libraryBrowseRows(catalog, emptyList(), listOf("series:7", "movie:m:1", "movie:m:404", "movie:m:2"),
            listOf("movie:m:2", "series:7"), actions)
        assertEquals(listOf("Favorite movies", "Favorite series", "Recently watched"), rows.map { it.title })
        assertEquals(listOf("movie:m:1", "movie:m:2"), rows[0].items.map { it.key })
        assertTrue(rows[0].items.all { it.favorite })
        assertEquals(listOf("movie:m:2", "series:7"), rows[2].items.map { it.key })
        assertTrue(rows.flatMap { it.items }.none { it.seeAll })
        assertTrue(libraryBrowseRows(catalog, emptyList(), emptyList(), emptyList(), actions).isEmpty())
    }

    @Test fun focusIndexHandlesRowKeysWithColonsAndRepeatedItems() {
        val title = BrowseCatalog.build(listOf(Movie("m:1", "Movie", null, null, "c", "https://example.invalid/1.mp4")), emptyList(),
            emptyList(), emptyList(), CatalogRows.NONE)["movie:m:1"]!!
        val item = tv.lumanest.tuner.ui.titleItem(title, emptySet(), emptyMap(), actions)
        val rows = listOf(
            tv.lumanest.tuner.ui.BrowseRow("movies:popular", "A", listOf(item, item)),
            tv.lumanest.tuner.ui.BrowseRow("movies:popular", "Repeated", listOf(item)),
            tv.lumanest.tuner.ui.BrowseRow("only-see-all", "Empty", listOf(item.copy(key = "see-all", seeAll = true))),
            tv.lumanest.tuner.ui.BrowseRow("b", "B", listOf(item)),
        )
        val prepared = prepareBrowse("home", rows)
        assertEquals(listOf("movies:popular", "b"), prepared.rows.map { it.key })
        assertEquals(1, prepared.rows.first().items.size)
        assertEquals(BrowseTitle.movieKey("m:1"), prepared.itemsByKey.getValue("home:movies:popular:movie:m:1").key)
        assertEquals(1, prepared.positions.getValue("home:b:movie:m:1").row)
        assertEquals(VodType.MOVIES, title.type)
        assertSame(title, ContinueItem(title, Recent("m:1", "Movie", null, null, "u", 1, 2, 3)).title)
    }

    @Test fun aCardThatLeftTheRowsHandsFocusToTheOneAtItsPlace() {
        val catalog = BrowseCatalog.build((1..6).map { Movie("m:$it", "Movie $it", null, null, "c", "https://example.invalid/$it.mp4") },
            emptyList(), (1..2).map { Series("$it", "Show $it", null, null, null, "c", null, null, null) }, emptyList(), CatalogRows.NONE)
        fun rows(favorites: List<String>, watched: List<String>) =
            prepareBrowse("library", libraryBrowseRows(catalog, emptyList(), favorites, watched, actions))
        val before = rows(listOf("movie:m:1", "movie:m:2", "movie:m:3", "series:1"), listOf("movie:m:5", "movie:m:6"))
        // The second favorite film is removed: the third one, now second, takes focus.
        val removed = rows(listOf("movie:m:1", "movie:m:3", "series:1"), listOf("movie:m:5", "movie:m:6"))
        assertEquals(tv.lumanest.tuner.ui.BrowsePosition(0, 1), nearestPosition(before, removed, "library:favorite-movies:movie:m:2"))
        // The last one is removed: the row's new last card.
        assertEquals(tv.lumanest.tuner.ui.BrowsePosition(0, 1), nearestPosition(before, rows(listOf("movie:m:1", "movie:m:2", "series:1"),
            listOf("movie:m:5", "movie:m:6")), "library:favorite-movies:movie:m:3"))
        // The row's only card is removed: the same place in the row that took the row's place.
        val noSeries = rows(listOf("movie:m:1", "movie:m:2", "movie:m:3"), listOf("movie:m:5", "movie:m:6"))
        assertEquals(tv.lumanest.tuner.ui.BrowsePosition(1, 0), nearestPosition(before, noSeries, "library:favorite-series:series:1"))
        // A card that is still there keeps its own place; one never seen gives no answer.
        assertEquals(tv.lumanest.tuner.ui.BrowsePosition(2, 1), nearestPosition(before, removed, "library:watched:movie:m:6"))
        assertNull(nearestPosition(before, removed, "library:watched:movie:m:4"))
        assertNull(nearestPosition(null, removed, "library:favorite-movies:movie:m:2"))
    }
}

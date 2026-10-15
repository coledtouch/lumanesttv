package tv.lumanest.tuner

import tv.lumanest.tuner.data.Category
import tv.lumanest.tuner.data.Movie
import tv.lumanest.tuner.ui.contentRating
import tv.lumanest.tuner.ui.movieBrowseRows
import tv.lumanest.tuner.ui.prepareBrowse
import org.junit.Assert.*
import org.junit.Test
import java.util.Locale

class BrowsePreparationTest {
    @Test fun ratingsKeepTheirOneDecimalRoundingWithoutFormattingEveryCategoryCopy() {
        listOf("8", "8.25", "9.95", "5.35", "0.05", "0.0001", "1000000", "1000001", Float.MAX_VALUE.toString()).forEach { value ->
            assertEquals(value, String.format(Locale.US, "%.1f", value.toFloat()).removeSuffix(".0"), contentRating(value))
        }
        listOf(null, "", "bad", "0", "-1", "NaN", "Infinity").forEach { assertNull(contentRating(it)) }
    }

    @Test fun aFullLibrarySharesPreparedItemsAcrossCategoriesAndRecentlyAdded() {
        val movies = (0 until 12_700).map { index ->
            Movie("m:$index", "Movie $index", null, "8.25", "a", "https://example.invalid/$index.mp4",
                added = index + 1L, categoryIds = listOf("a", "b", "c"))
        }
        var opened: Movie? = null
        val rows = movieBrowseRows(movies, listOf(Category("a", "First"), Category("b", "Second"), Category("c", "Third")), emptyList(), { opened = it }, {})
        val first = rows.first { it.key == "ca" }.items
        val second = rows.first { it.key == "cb" }.items
        val recent = rows.first { it.key == "recent" }.items
        assertEquals(12_700, first.size)
        assertSame(first.first(), second.first())
        assertSame(first.last(), recent.first())
        assertEquals("8.3", first.first().badge)
        val prepared = prepareBrowse("movies", rows)
        assertEquals(38_140, prepared.itemsByKey.size)
        assertEquals(1, prepared.positions.getValue("movies:ca:m:0").row)
        assertEquals(0, prepared.positions.getValue("movies:ca:m:0").item)
        prepared.itemsByKey.getValue("movies:ca:m:0").onClick()
        assertSame(movies.first(), opened)
    }

    @Test fun focusIndexHandlesProviderCategoryKeysContainingColonsAndDuplicateMemberships() {
        val movie = Movie("m:1", "Movie", null, null, "movies:g0", "https://example.invalid/1.mp4",
            categoryIds = listOf("movies:g0", "movies:g0", "unknown"))
        val rows = movieBrowseRows(listOf(movie), listOf(Category("movies:g0", "Drama")), emptyList(), {}, {})
        val prepared = prepareBrowse("movies", rows)
        assertEquals(2, prepared.itemsByKey.size)
        assertEquals(0, prepared.positions.getValue("movies:cmovies:g0:m:1").row)
        assertEquals(1, prepared.positions.getValue("movies:cother:m:1").row)
        assertSame(prepared.rows[0].items.single(), prepared.rows[1].items.single())
    }
}

package tv.lumanest.tuner

import tv.lumanest.tuner.data.*
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class StreamingCatalogTest {
    @Test fun providerOrderValidIdsAndPosterTemplatesArePreserved() {
        val text = """{"data":{"popularTitles":{"edges":[
            {"node":{"content":{"title":"First","originalReleaseYear":2026,"posterUrl":"/poster/123/{profile}/first.{format}","externalIds":{"imdbId":"tt123"},"scoring":{"imdbScore":8.2}}}},
            {"node":{"content":{"title":"Duplicate","externalIds":{"imdbId":"tt123"}}}},
            {"node":{"content":{"title":"No playable identity","externalIds":{"imdbId":null}}}},
            {"node":{"content":{"title":"Upcoming","isReleased":false,"externalIds":{"imdbId":"tt456"}}}},
            {"node":{"content":{"title":"Second","externalIds":{"imdbId":"tt789"}}}}
        ]}}}"""
        val cards = StreamingCatalog.parseTitles(text)
        assertEquals(listOf("tt123", "tt789"), cards.map { it.title.id })
        assertEquals("https://images.justwatch.com/poster/123/s332/first.jpg", cards.first().title.poster)
        assertEquals("8.2", cards.first().title.rating)
        assertThrows(IllegalArgumentException::class.java) { StreamingCatalog.parseTitles("""{"errors":[{"message":"Unavailable"}],"data":null}""") }
    }

    @Test fun newSeasonResolvesToSeriesIdentityRatherThanSeasonIdentity() {
        val cards = StreamingCatalog.parseTitles("""{"data":{"newTitles":{"edges":[{"node":{"show":{"content":{"title":"A show","externalIds":{"imdbId":"tt123"}}}}}]}}}""", "newTitles", "2026-10-12")
        assertEquals("tt123", cards.single().title.id)
        assertEquals("2026-10-12", cards.single().added)
    }

    @Test fun newEpisodesExcludeUpcomingOldMissingDatesAndInvalidIds() {
        val now = 1_791_806_400_000L // 2026-10-12 12:00 UTC
        val seeds = listOf(CatalogCard(AddonTitle("tt123", "A show", "2026")))
        val text = """{"metasDetailed":[{"imdb_id":"tt123","videos":[
            {"id":"tt123:1:1","name":"Old","released":"2025-01-01T00:00:00.000Z"},
            {"id":"tt123:1:2","name":"Recent","released":"2026-10-10T00:00:00.000Z"},
            {"id":"tt123:1:3","name":"Newest","released":"2026-10-12T00:00:00.000Z"},
            {"id":"tt123:1:4","name":"Future","released":"2026-10-20T00:00:00.000Z"},
            {"id":"tt123:1:5","name":"Undated"},
            {"id":"bad","released":"2026-10-12T00:00:00.000Z"}
        ]}]}"""
        val cards = StreamingCatalog.parseRecentEpisodes(text, seeds, now)
        assertEquals(listOf("tt123:1:3", "tt123:1:2"), cards.map { it.key })
        assertEquals("Newest", cards.first().episode!!.title)
        assertEquals("A show", cards.first().title.name)
    }

    @Test fun movieAndSeriesCatalogsHaveDifferentReleaseAndEpisodeSections() {
        val movies = StreamingCatalog.sections(false)
        val series = StreamingCatalog.sections(true)
        assertEquals("New Releases", movies.first().name)
        assertFalse(movies.any { it.id == "episodes" })
        assertTrue(series.any { it.name == "New Episodes" })
        assertTrue(movies.any { it.name == "Top Netflix" })
        assertTrue(series.any { it.name == "Top Paramount+" })
        assertTrue(series.any { it.name == "Top AMC+" })
        assertEquals(series.size, series.distinctBy { it.id }.size)
    }
}

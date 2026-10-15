package tv.lumanest.tuner

import tv.lumanest.tuner.data.Movie
import tv.lumanest.tuner.data.Recent
import tv.lumanest.tuner.data.Series
import tv.lumanest.tuner.ui.eligibleMovieRecents
import tv.lumanest.tuner.ui.eligibleSeriesRecents
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class BrowseRecentTest {
    private fun movie(id: String, url: String) = Movie(
        id = id, name = "EN: Current Movie", poster = "https://current.example/poster.jpg",
        rating = null, categoryId = "english", url = url,
    )

    private fun recent(id: String, url: String) = Recent(
        id = id, title = "Old Movie", subtitle = "2025", image = "https://old.example/poster.jpg",
        url = url, positionMs = 45_000, durationMs = 120_000, updated = 1_000,
    )

    @Test fun collidingProviderIdCannotResumeOldProviderUrl() {
        val allowed = movie("m:1", "https://english.example/movie/1.mp4")
        val foreign = recent("m:1", "https://foreign.example/movie/1.mp4")
        assertTrue(eligibleMovieRecents(listOf(foreign), listOf(allowed)).isEmpty())
    }

    @Test fun hiddenTitlesAndUnassociatedEpisodesDoNotReappear() {
        val allowed = movie("m:1", "https://english.example/movie/1.mp4")
        val hidden = recent("m:2", "https://english.example/movie/2.mp4")
        val episode = recent("e:1", "https://english.example/series/1.mp4")
        assertTrue(eligibleMovieRecents(listOf(hidden, episode), listOf(allowed)).isEmpty())
    }

    @Test fun matchingItemKeepsProgressAndUsesCurrentCatalogMetadata() {
        val allowed = movie("m:1", "https://english.example/movie/1.mp4")
        val saved = recent(allowed.id, allowed.url)
        val result = eligibleMovieRecents(listOf(saved), listOf(allowed)).single()
        assertEquals(saved.copy(title = allowed.name, image = allowed.poster, url = allowed.url), result)
        assertEquals(45_000L, result.positionMs)
    }

    @Test fun validResumeOrderIsPreservedWhileInvalidItemsAreRemoved() {
        val first = movie("m:1", "https://english.example/movie/1.mp4")
        val second = movie("m:2", "https://english.example/movie/2.mp4")
        val saved = listOf(recent(second.id, second.url), recent("m:3", "https://foreign.example/3.mp4"), recent(first.id, first.url))
        assertEquals(listOf(second.id, first.id), eligibleMovieRecents(saved, listOf(first, second)).map { it.id })
    }

    @Test fun blankUrlIsNotAnEligiblePlaybackTarget() {
        assertTrue(eligibleMovieRecents(listOf(recent("m:1", "")), listOf(movie("m:1", ""))).isEmpty())
    }

    @Test fun knownBackupKeepsProgressAndUsesTheCurrentPrimaryUrl() {
        val allowed = movie("m:1", "https://current.example/movie/1.mp4")
            .copy(backups = listOf("https://backup.example/movie/1.mp4"))
        val saved = recent(allowed.id, allowed.backups.single())
        val result = eligibleMovieRecents(listOf(saved), listOf(allowed)).single()
        assertEquals(allowed.url, result.url)
        assertEquals(saved.positionMs, result.positionMs)
    }

    @Test fun seriesHistoryIsAvailableForAnyCurrentSeriesTitle() {
        val show = Series("1", "Foreign Series", null, null, null, "category", null, null, null)
        val saved = recent("e:1", "https://provider.example/series/1.mp4").copy(title = show.name)
        val stale = saved.copy(id = "e:2", title = "Removed Series")
        assertEquals(listOf(saved), eligibleSeriesRecents(listOf(saved, stale), listOf(show)))
    }
}

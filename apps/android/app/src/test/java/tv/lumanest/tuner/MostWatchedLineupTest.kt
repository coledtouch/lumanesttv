package tv.lumanest.tuner

import tv.lumanest.tuner.data.Channel
import tv.lumanest.tuner.ui.mostWatchedLineup
import org.junit.Assert.*
import org.junit.Test

class MostWatchedLineupTest {
    private fun channel(key: String, title: String = key) = Channel(key, 1, title, null, "news", null, null, "https://example.test/live")

    @Test fun personalRankingUsesCurrentCopiesAndSkipsMissingChannels() {
        val news = channel("news", "Current News")
        val sports = channel("sports")
        val staleCopy = channel("news", "Old Provider Copy")
        val result = mostWatchedLineup(listOf(news, sports), listOf(staleCopy, channel("provider")), listOf("gone", "sports", "news", "sports"))
        assertEquals(listOf(sports, news), result)
        assertSame(news, result[1])
    }

    @Test fun providerTrendingRemainsUsefulUntilPersonalChannelsAreAvailable() {
        val featured = channel("featured")
        assertEquals(listOf(featured), mostWatchedLineup(emptyList(), listOf(featured, featured), emptyList()))
        assertEquals(listOf(featured), mostWatchedLineup(listOf(channel("news")), listOf(featured), listOf("removed")))
        assertTrue(mostWatchedLineup(emptyList(), emptyList(), listOf("removed")).isEmpty())
    }
}

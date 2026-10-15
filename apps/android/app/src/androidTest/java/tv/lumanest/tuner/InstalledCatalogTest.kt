package tv.lumanest.tuner

import android.os.Bundle
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import tv.lumanest.tuner.data.*
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith

/** Explicit opt-in: checks this TV's existing provider without printing or changing credentials. */
@RunWith(AndroidJUnit4::class)
@androidx.annotation.OptIn(androidx.media3.common.util.UnstableApi::class)
class InstalledCatalogTest {
    @Test fun savedWorcesterMarketLoadsNearbyNewsAndKeepsCable() {
        assumeTrue(InstrumentationRegistry.getArguments().getString("regionalCheck") == "true")
        assertEquals(LocalLineup.WORCESTER_ZIP, Repo.prefs.localZip.value)
        Repo.load()
        val deadline = System.currentTimeMillis() + 90_000
        while (Repo.liveStatus.value !is LoadStatus.Ready && Repo.liveStatus.value !is LoadStatus.Error && System.currentTimeMillis() < deadline) Thread.sleep(100)
        assertTrue("The local guide did not finish loading", Repo.liveStatus.value is LoadStatus.Ready)
        val channels = Repo.channels.value
        val news = channels.filter { LocalLineup.LOCAL_NEWS_ID in it.categoryIds }
        assertTrue("Nearby news category is empty", news.isNotEmpty())
        assertTrue("Manchester's WMUR is missing", news.any { "WMUR" in it.name.uppercase() })
        assertTrue("Boston's news stations are missing", news.any { Regex("WCVB|WBZ|WBTS|WFXT|WHDH").containsMatchIn(it.name.uppercase()) })
        assertTrue("National cable news was removed", channels.any { it.name.contains("CNN", ignoreCase = true) })
        assertTrue("Sports channels were removed", channels.any { it.name.contains("ESPN", ignoreCase = true) })
        val outsideAffiliates = channels.filter {
            !it.name.startsWith("NFL Teams:", ignoreCase = true) &&
                Regex("\\b(?:WNBC|WABC|WCBS|WNYW|KABC|KCAL|KTVU|WLS)\\b").containsMatchIn(it.name.uppercase())
        }
        assertTrue("Outside-market affiliates remain: ${outsideAffiliates.map { it.name }}", outsideAffiliates.isEmpty())
        InstrumentationRegistry.getInstrumentation().sendStatus(2, Bundle().apply {
            putString("stream", "Regional guide: ${channels.size} channels, ${news.size} nearby news feeds. Stations: ${news.map { it.name }.distinct().joinToString()}\n")
        })
    }

    @Test fun existingProviderLoadsLiveMoviesAndSeries() {
        assumeTrue(InstrumentationRegistry.getArguments().getString("providerCheck") == "true")
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        assertEquals(SourceType.XTREAM, Repo.activeSource?.type)
        Repo.load()
        val end = System.currentTimeMillis() + 90_000
        fun finished(s: LoadStatus) = s is LoadStatus.Ready || s is LoadStatus.Error
        while (System.currentTimeMillis() < end && !(finished(Repo.liveStatus.value) && finished(Repo.vodStatus.value) && finished(Repo.seriesStatus.value))) Thread.sleep(100)
        val summary = "Live=${Repo.liveStatus.value} (${Repo.channels.value.size}), Movies=${Repo.vodStatus.value} (${Repo.movies.value.size}), Series=${Repo.seriesStatus.value} (${Repo.series.value.size})"
        instrumentation.sendStatus(2, Bundle().apply { putString("stream", "$summary\n") })
        assertTrue("Live catalog failed: $summary", Repo.channels.value.isNotEmpty())
        assertTrue("Movie catalog failed: $summary", Repo.movies.value.isNotEmpty())
        assertTrue("Series catalog failed: $summary", Repo.series.value.isNotEmpty())
    }

    @Test fun sampleProviderMovieAndSeriesEpisodePlayOnTv() = kotlinx.coroutines.runBlocking {
        assumeTrue(InstrumentationRegistry.getArguments().getString("providerPlayback") == "true")
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        Repo.load()
        val loadEnd = System.currentTimeMillis() + 90_000
        while ((Repo.movies.value.isEmpty() || Repo.series.value.isEmpty()) && System.currentTimeMillis() < loadEnd) Thread.sleep(100)
        suspend fun plays(url: String, backups: List<String> = emptyList()): Boolean {
            instrumentation.runOnMainSync {
                tv.lumanest.tuner.player.PlayerHolder.stop()
                tv.lumanest.tuner.player.PlayerHolder.onAppForeground()
                tv.lumanest.tuner.player.PlayerHolder.play(url, live = false, backups = backups)
            }
            val end = System.currentTimeMillis() + 40_000
            while (System.currentTimeMillis() < end) {
                var playing = false
                var failed = false
                instrumentation.runOnMainSync {
                    playing = tv.lumanest.tuner.player.PlayerHolder.player.isPlaying
                    failed = tv.lumanest.tuner.player.PlayerHolder.error.value != null
                }
                if (playing) return true
                if (failed) return false
                kotlinx.coroutines.delay(100)
            }
            return false
        }
        try {
            var moviePlayed = false
            for (movie in Repo.movies.value.take(3)) {
                if (plays(movie.url, movie.backups)) { moviePlayed = true; break }
            }
            assertTrue("No sampled provider movie started playback", moviePlayed)
            instrumentation.sendStatus(2, Bundle().apply { putString("stream", "Provider movie playback passed\n") })
            var episodePlayed = false
            for (series in Repo.series.value.take(3)) {
                val episode = Repo.seriesInfo(series)?.seasons?.toSortedMap()?.values?.flatten()?.firstOrNull() ?: continue
                if (plays(episode.url)) { episodePlayed = true; break }
            }
            assertTrue("No sampled provider episode started playback", episodePlayed)
            instrumentation.sendStatus(2, Bundle().apply { putString("stream", "Provider series playback passed\n") })
        } finally { instrumentation.runOnMainSync { tv.lumanest.tuner.player.PlayerHolder.stop() } }
    }
}

package tv.lumanest.tuner

import android.os.Bundle
import android.os.SystemClock
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import tv.lumanest.tuner.data.Cleanup
import tv.lumanest.tuner.data.ContentPolicy
import tv.lumanest.tuner.data.Repo
import tv.lumanest.tuner.data.SourceType
import tv.lumanest.tuner.data.Xtream
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File

/** Read-only native profiling of already-cached catalogue files. Opt in with providerTiming=true. */
@RunWith(AndroidJUnit4::class)
class CatalogTimingTest {
    @Test fun cachedProviderCatalogueStages() {
        assumeTrue(InstrumentationRegistry.getArguments().getString("providerTiming") == "true")
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val source = Repo.activeSource
        assumeTrue("The active provider must be an existing Xtream source", source?.type == SourceType.XTREAM)
        val provider = requireNotNull(source)
        val directory = File(instrumentation.targetContext.cacheDir, "sources/${provider.id}")
        val started = SystemClock.elapsedRealtime()
        fun report(message: String) {
            instrumentation.sendStatus(2, Bundle().apply { putString("stream", "CATALOG_TIMING $message\n") })
        }
        fun cached(name: String): File = File(directory, name).also { file ->
            assertTrue("The required cached $name file is unavailable", file.isFile && file.length() > 0)
            report("cache=$name bytes=${file.length()} ageMs=${(System.currentTimeMillis() - file.lastModified()).coerceAtLeast(0)}")
        }
        fun <T> stage(label: String, action: () -> T): T {
            val begin = SystemClock.elapsedRealtime()
            val cpuBegin = SystemClock.currentThreadTimeMillis()
            report("stage=$label start elapsedMs=${begin - started}")
            return try {
                action().also {
                    report("stage=$label end elapsedMs=${SystemClock.elapsedRealtime() - started} durationMs=${SystemClock.elapsedRealtime() - begin} cpuMs=${SystemClock.currentThreadTimeMillis() - cpuBegin}")
                }
            } catch (failure: Throwable) {
                // Failure messages can include request URLs, so report only the exception type.
                report("stage=$label failed type=${failure.javaClass.simpleName} durationMs=${SystemClock.elapsedRealtime() - begin}")
                throw failure
            }
        }

        val liveFile = cached("live.json")
        val liveCategoriesFile = cached("live_cats.json")
        val moviesFile = cached("vod.json")
        val moviesCategoriesFile = cached("vod_cats.json")
        val client = Xtream(provider)
        val liveCategories = stage("parseLiveCategories") { client.parseCategories(liveCategoriesFile) }
        report("liveCategories=${liveCategories.size}")
        val live = stage("parseLive") { client.parseLive(liveFile, Repo.prefs.liveFormat) }
        report("parsedLive=${live.size}")
        val policyLive = stage("policyLive") { ContentPolicy.live(live, liveCategories) }
        report("policyLive=${policyLive.items.size} categories=${policyLive.categories.size}")
        val cleanLive = stage("cleanupLive") { Cleanup.lineup(policyLive.items, policyLive.categories, hidden = Repo.prefs.deadChannels()) }
        report("cleanLive=${cleanLive.channels.size} merged=${cleanLive.merged.size}")

        val movieCategories = stage("parseMovieCategories") { client.parseCategories(moviesCategoriesFile) }
        report("movieCategories=${movieCategories.size}")
        val movies = stage("parseMovies") { client.parseMovies(moviesFile) }
        report("parsedMovies=${movies.size}")
        val policyMovies = stage("policyMovies") { ContentPolicy.movies(movies, movieCategories) }
        report("policyMovies=${policyMovies.items.size} categories=${policyMovies.categories.size}")
        val cleanMovies = stage("cleanupMovies") { Cleanup.movies(policyMovies.items) }
        report("cleanMovies=${cleanMovies.size} alternatives=${cleanMovies.sumOf { it.backups.size }} totalMs=${SystemClock.elapsedRealtime() - started}")
        assertTrue("The cached provider has no usable movie records", cleanMovies.isNotEmpty())
    }
}

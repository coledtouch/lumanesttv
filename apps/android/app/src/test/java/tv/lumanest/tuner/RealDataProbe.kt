package tv.lumanest.tuner

import tv.lumanest.tuner.data.Cleanup
import tv.lumanest.tuner.data.ContentPolicy
import tv.lumanest.tuner.data.Source
import tv.lumanest.tuner.data.SourceType
import tv.lumanest.tuner.data.Xtream
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.io.File
import kotlin.random.Random

/**
 * Runs the real catalogue pipeline over provider JSON saved in a folder (get_live_streams.json,
 * get_live_categories.json, get_vod_streams.json, ...). Skipped unless run with -PtunerRealData=<folder>.
 * Writes a report to probe-out.txt in the same folder.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class RealDataProbe {
    @Test fun probe() {
        val dir = System.getProperty("tuner.realData")?.let(::File)
        assumeTrue(dir != null && dir.isDirectory)
        val out = StringBuilder()
        val now = System.currentTimeMillis()
        val x = Xtream(Source("p", "p", SourceType.XTREAM, "http://h", "u", "p"))
        fun f(n: String) = File(dir, "$n.json")

        var t = System.nanoTime()
        fun lap(): Long { val n = System.nanoTime(); val ms = (n - t) / 1_000_000; t = n; return ms }
        repeat(2) { // second pass shows warmed-up (JIT) timings
            ContentPolicy.live(x.parseLive(f("get_live_streams"), "ts"), x.parseCategories(f("get_live_categories"))).let { Cleanup.lineup(it.items, it.categories, now) }
        }
        lap()
        val live = x.parseLive(f("get_live_streams"), "ts")
        val liveCats = x.parseCategories(f("get_live_categories"))
        val parseMs = lap()
        val shown = ContentPolicy.live(live, liveCats)
        val policyMs = lap()
        val lineup = Cleanup.lineup(shown.items, liveCats, now)
        val cleanupMs = lap()
        out.appendLine("timing: parse=${parseMs}ms policy=${policyMs}ms cleanup=${cleanupMs}ms")
        out.appendLine("live: parsed=${live.size} policy=${shown.items.size} lineup=${lineup.channels.size} folded=${lineup.merged.size}")
        val catName = liveCats.associate { it.id to it.name }
        lineup.channels.groupBy { catName[it.categoryId] ?: it.categoryId }.toSortedMap().forEach { (c, list) ->
            out.appendLine("  [$c] ${list.size}: " + list.shuffled(Random(3)).take(14).joinToString(" || ") { it.name })
        }
        val idle = shown.items.filter { Cleanup.isIdleEvent(it.name) }
        out.appendLine("idle=${idle.size}: " + idle.shuffled(Random(1)).take(50).joinToString(" || ") { it.name })
        val finished = shown.items.filter { !Cleanup.isIdleEvent(it.name) && Cleanup.isOffAir(it.name, now) }
        out.appendLine("finished=${finished.size}: " + finished.joinToString(" || ") { it.name })
        out.appendLine("renames:")
        shown.items.shuffled(Random(5)).take(120).forEach { out.appendLine("  ${it.name}  =>  ${Cleanup.displayName(it.name)}") }
        out.appendLine("biggest merges:")
        lineup.channels.sortedByDescending { it.backups.size }.take(30).forEach { c -> out.appendLine("  [${c.backups.size + 1}] ${c.name}") }
        val leftovers = lineup.channels.filter { Regex("^\\W*USA?\\b|\\((?:[A-Z]|SP|CX|RK|PX)\\)").containsMatchIn(it.name) }
        out.appendLine("leftover tags=${leftovers.size}: " + leftovers.take(60).joinToString(" || ") { it.name })

        val movieCats = x.parseCategories(f("get_vod_categories"))
        val movies = x.parseMovies(f("get_vod_streams"))
        val keptMovies = ContentPolicy.movies(movies, movieCats)
        val uniqueMovies = Cleanup.movies(keptMovies.items)
        out.appendLine("movies: parsed=${movies.size} policy=${keptMovies.items.size} unique=${uniqueMovies.size} categories=${keptMovies.categories.size}")
        val series = x.parseSeries(f("get_series"))
        val keptSeries = ContentPolicy.series(series, x.parseCategories(f("get_series_categories")))
        out.appendLine("series: parsed=${series.size} policy=${keptSeries.items.size} categories=${keptSeries.categories.size}")
        File(dir, "probe-out.txt").writeText(out.toString())
    }
}

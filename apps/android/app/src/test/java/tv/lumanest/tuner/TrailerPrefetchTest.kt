package tv.lumanest.tuner

import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Test
import tv.lumanest.tuner.data.ExtrasTitle
import tv.lumanest.tuner.data.TrailerPrefetcher
import tv.lumanest.tuner.data.TrailerQuery

/** Trailer lookups started from a card before its details page opens (docs/extras.md, "The Trailer button"). */
@OptIn(ExperimentalCoroutinesApi::class)
class TrailerPrefetchTest {
    private fun q(id: Long, tv: Boolean = false) = TrailerQuery(ExtrasTitle(tmdb = id), tv)

    /** A fake extras client: each lookup waits until the test lets it finish, then its answer is known. */
    private class Lookups {
        val asked = mutableListOf<TrailerQuery>()
        val known = mutableSetOf<TrailerQuery>()
        val gates = mutableMapOf<TrailerQuery, CompletableDeferred<Unit>>()
        var fail = false
        /** Every lookup answers at once. */
        var instant = false
        suspend fun lookup(query: TrailerQuery) {
            asked += query
            if (!instant) gates.getOrPut(query) { CompletableDeferred() }.await()
            if (fail) throw IllegalStateException("network")
            known += query
        }
        fun finish(query: TrailerQuery) { gates.getOrPut(query) { CompletableDeferred() }.complete(Unit) }
    }

    private fun TestScope.prefetcher(lookups: Lookups) =
        TrailerPrefetcher(backgroundScope, lookups::lookup, { it in lookups.known }, now = { testScheduler.currentTime })

    private fun byName(n: Int) = TrailerQuery(ExtrasTitle(name = "Film $n", year = 2024), tv = false)

    @Test fun aCardThatKeepsTheFocusFor400msIsLookedUp() = runTest {
        val lookups = Lookups()
        val prefetch = prefetcher(lookups)
        prefetch.focused(q(1))
        advanceTimeBy(399); runCurrent()
        assertEquals(emptyList<TrailerQuery>(), lookups.asked)
        advanceTimeBy(1); runCurrent()
        assertEquals(listOf(q(1)), lookups.asked)
        assertEquals(400L, TrailerPrefetcher.DEBOUNCE_MS)
    }

    @Test fun passingOverCardsAsksNothing() = runTest {
        val lookups = Lookups()
        val prefetch = prefetcher(lookups)
        for (id in 1L..5L) {
            prefetch.focused(q(id))
            advanceTimeBy(150); runCurrent()
            prefetch.unfocused(q(id))
        }
        advanceTimeBy(5_000); runCurrent()
        assertEquals(emptyList<TrailerQuery>(), lookups.asked)
        // The next card's focus can arrive before the last card's blur: that blur doesn't cancel the new card.
        prefetch.focused(q(7))
        prefetch.unfocused(q(6))
        advanceTimeBy(400); runCurrent()
        assertEquals(listOf(q(7)), lookups.asked)
    }

    @Test fun choosingACardAsksAtOnceAndOnlyOnce() = runTest {
        val lookups = Lookups()
        val prefetch = prefetcher(lookups)
        prefetch.focused(q(1))
        advanceTimeBy(100); runCurrent()
        prefetch.chosen(q(1))
        runCurrent()
        assertEquals(listOf(q(1)), lookups.asked)
        // The focus delay that was running for it asks nothing more, nor does choosing it again while it runs.
        advanceTimeBy(1_000); runCurrent()
        prefetch.chosen(q(1))
        prefetch.focused(q(1))
        advanceTimeBy(1_000); runCurrent()
        assertEquals(listOf(q(1)), lookups.asked)
        // Once answered it is known to the session: never asked again.
        lookups.finish(q(1)); runCurrent()
        prefetch.chosen(q(1))
        prefetch.focused(q(1))
        advanceTimeBy(1_000); runCurrent()
        assertEquals(listOf(q(1)), lookups.asked)
        // A movie and a series with the same id are two lookups.
        prefetch.chosen(q(1, tv = true)); runCurrent()
        assertEquals(listOf(q(1), q(1, tv = true)), lookups.asked)
        prefetch.chosen(null)
        prefetch.focused(null)
        advanceTimeBy(1_000); runCurrent()
        assertEquals(2, lookups.asked.size)
    }

    @Test fun atMostTwoRunAndTheNewestWaitingGoesNext() = runTest {
        val lookups = Lookups()
        val prefetch = prefetcher(lookups)
        for (id in 1L..7L) prefetch.chosen(q(id))
        runCurrent()
        assertEquals(listOf(q(1), q(2)), lookups.asked)
        assertEquals(2, prefetch.active)
        // Four wait at most, newest first: 3 is dropped (the viewer has moved on).
        assertEquals(listOf(q(7), q(6), q(5), q(4)), prefetch.queued)
        lookups.finish(q(1)); runCurrent()
        assertEquals(listOf(q(1), q(2), q(7)), lookups.asked)
        assertEquals(listOf(q(6), q(5), q(4)), prefetch.queued)
        // A waiting card chosen again moves to the front.
        prefetch.chosen(q(4)); runCurrent()
        assertEquals(listOf(q(4), q(6), q(5)), prefetch.queued)
        // A waiting title answered meanwhile (its page asked) is skipped.
        lookups.known += q(4)
        lookups.finish(q(2)); runCurrent()
        assertEquals(listOf(q(1), q(2), q(7), q(6)), lookups.asked)
        listOf(q(7), q(6)).forEach { lookups.finish(it) }; runCurrent()
        lookups.finish(q(5)); runCurrent()
        assertEquals(listOf(q(1), q(2), q(7), q(6), q(5)), lookups.asked)
        assertEquals(0, prefetch.active)
        assertEquals(emptyList<TrailerQuery>(), prefetch.queued)
        assertEquals(2, TrailerPrefetcher.MAX_CONCURRENT)
    }

    @Test fun theFocusAloneAsksAtMostSixTimesAMinute() = runTest {
        val lookups = Lookups().apply { instant = true }
        val prefetch = prefetcher(lookups)
        // A new card every 450 ms for a minute (lumanest.tv allows a client 12 uncached lookups a minute, shared with
        // the pages and subtitles): only the first six are asked about.
        for (id in 1L..133L) {
            prefetch.focused(q(id))
            advanceTimeBy(450); runCurrent()
        }
        assertEquals((1L..6L).map { q(it) }, lookups.asked)
        assertEquals(6, TrailerPrefetcher.MAX_PER_MINUTE)
        // Choosing a card is never held back: its page would ask anyway.
        prefetch.chosen(q(500)); runCurrent()
        assertEquals(q(500), lookups.asked.last())
        // After a quiet minute there is room for six more, and only six.
        advanceTimeBy(60_000); runCurrent()
        val before = lookups.asked.size
        for (id in 1001L..1007L) {
            prefetch.focused(q(id))
            advanceTimeBy(450); runCurrent()
        }
        assertEquals((1001L..1006L).map { q(it) }, lookups.asked.drop(before))
    }

    @Test fun aLookupByNameCountsTwiceInTheFocusBudget() = runTest {
        val lookups = Lookups().apply { instant = true }
        val prefetch = prefetcher(lookups)
        // By name and year lumanest.tv first finds the TMDB number, then the videos: two uncached lookups.
        for (n in 1..4) {
            prefetch.focused(byName(n))
            advanceTimeBy(450); runCurrent()
        }
        prefetch.focused(q(7))
        advanceTimeBy(450); runCurrent()
        assertEquals(listOf(byName(1), byName(2), byName(3)), lookups.asked)
        // A card already known costs nothing and isn't asked about again.
        prefetch.focused(byName(1))
        advanceTimeBy(450); runCurrent()
        assertEquals(3, lookups.asked.size)
    }

    @Test fun aFailedLookupFreesItsPlace() = runTest {
        val lookups = Lookups().apply { fail = true }
        val prefetch = prefetcher(lookups)
        listOf(1L, 2L, 3L).forEach { prefetch.chosen(q(it)) }
        runCurrent()
        lookups.finish(q(1)); runCurrent()
        assertEquals(listOf(q(1), q(2), q(3)), lookups.asked)
        assertEquals(2, prefetch.active)
        // Not known (it failed): asked again when its card comes back.
        lookups.finish(q(2)); lookups.finish(q(3)); runCurrent()
        assertEquals(0, prefetch.active)
        prefetch.chosen(q(1)); runCurrent()
        assertEquals(listOf(q(1), q(2), q(3), q(1)), lookups.asked)
    }
}

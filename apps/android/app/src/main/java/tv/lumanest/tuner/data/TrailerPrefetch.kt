package tv.lumanest.tuner.data

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/**
 * Starts a title's trailer lookup before its details page opens, so the Trailer button is there on the page's first
 * frame (docs/extras.md, "The Trailer button"): a movie or series card that keeps the focus for [debounceMs], or is
 * chosen, has its lookup started. [lookup] asks the session's extras client, which keeps the answer and shares a
 * request already on its way, so a title is asked about once. Only the lookup: no subtitle file is ever fetched here.
 *
 * At most [maxConcurrent] lookups run at once. A card that gets its turn while they run waits in a short queue, newest
 * first and at most [maxQueued] long (the viewer has moved past the older ones); a card the focus left before its
 * delay ended is never asked about. Titles [known] to the session are skipped. Lookups started by the focus alone may
 * cost lumanest.tv at most [maxPerMinute] uncached lookups in any minute (by [now], in milliseconds): it allows each
 * client 12, shared with the pages' own lookups and subtitles, and one by name and year costs two (finding the TMDB
 * number, then its videos). A card the budget leaves out is asked about by its page, or when chosen: choosing a card
 * is never held back, since its page would ask anyway. Call it from one thread (the main one); [scope]'s dispatcher
 * runs the delays and the lookups' ends there.
 */
class TrailerPrefetcher(
    private val scope: CoroutineScope,
    private val lookup: suspend (TrailerQuery) -> Unit,
    private val known: (TrailerQuery) -> Boolean,
    private val debounceMs: Long = DEBOUNCE_MS,
    private val maxConcurrent: Int = MAX_CONCURRENT,
    private val maxQueued: Int = MAX_QUEUED,
    private val maxPerMinute: Int = MAX_PER_MINUTE,
    private val now: () -> Long = { System.nanoTime() / 1_000_000 },
) {
    private var waiting: Job? = null
    private var waitingFor: TrailerQuery? = null
    private val running = HashSet<TrailerQuery>()
    private val queue = ArrayDeque<TrailerQuery>()
    /** When the focus lookups of the last minute started: one entry per uncached lookup each may cost lumanest.tv. */
    private val spent = ArrayDeque<Long>()

    /** Lookups running now (tests). */
    val active: Int get() = running.size
    /** Lookups waiting for a free place, next first (tests). */
    val queued: List<TrailerQuery> get() = queue.toList()

    /** A card took the focus: its lookup starts once it has kept the focus for [debounceMs]. */
    fun focused(query: TrailerQuery?) {
        waiting?.cancel()
        waiting = null
        waitingFor = query
        if (query == null || known(query)) return
        waiting = scope.launch {
            delay(debounceMs)
            waiting = null
            waitingFor = null
            // Already running, waiting or known: no new request. Otherwise only within the minute's budget.
            if (query !in running && query !in queue && !known(query) && !spend(query)) return@launch
            start(query)
        }
    }

    /** Takes [query]'s cost from the minute's budget; false (and nothing taken) when it doesn't fit. */
    private fun spend(query: TrailerQuery): Boolean {
        val t = now()
        while (spent.isNotEmpty() && t - spent.first() >= MINUTE_MS) spent.removeFirst()
        val cost = if (query.title.tmdb > 0) 1 else 2
        if (spent.size + cost > maxPerMinute) return false
        repeat(cost) { spent.addLast(t) }
        return true
    }

    /** A card lost the focus: its lookup no longer starts, unless it already has. */
    fun unfocused(query: TrailerQuery?) {
        if (query == null || query != waitingFor) return
        waiting?.cancel()
        waiting = null
        waitingFor = null
    }

    /** A card was chosen: its lookup starts now, or first when the lookups already running are at the limit. */
    fun chosen(query: TrailerQuery?) {
        if (query == null) return
        if (query == waitingFor) unfocused(query)
        start(query)
    }

    private fun start(query: TrailerQuery) {
        if (query in running || known(query)) return
        queue.remove(query)
        if (running.size < maxConcurrent) {
            run(query)
            return
        }
        queue.addFirst(query)
        while (queue.size > maxQueued) queue.removeLast()
    }

    private fun run(query: TrailerQuery) {
        running += query
        scope.launch {
            try {
                lookup(query)
            } catch (e: CancellationException) {
                throw e
            } catch (_: Exception) {
                // Not known, so its card asks again when it comes back.
            } finally {
                running -= query
                next()
            }
        }
    }

    private fun next() {
        while (running.size < maxConcurrent) {
            val query = queue.removeFirstOrNull() ?: return
            if (query !in running && !known(query)) run(query)
        }
    }

    companion object {
        /** How long a card keeps the focus before its title is looked up: passing over a row asks nothing. */
        const val DEBOUNCE_MS = 400L
        const val MAX_CONCURRENT = 2
        const val MAX_QUEUED = 4
        /** Half of lumanest.tv's 12 uncached lookups a minute per client, so pages and subtitles keep the rest. */
        const val MAX_PER_MINUTE = 6
        private const val MINUTE_MS = 60_000L
    }
}

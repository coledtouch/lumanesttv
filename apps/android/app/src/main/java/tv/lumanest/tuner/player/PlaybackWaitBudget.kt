package tv.lumanest.tuner.player

/** A download's stalled-peer budget counts active time rather than time spent in the background. */
internal class PlaybackWaitBudget(timeoutMs: Long, startedAt: Long) {
    private var remaining = timeoutMs
    private var lastObserved = startedAt

    fun expired(now: Long, paused: Boolean): Boolean {
        val elapsed = (now - lastObserved).coerceAtLeast(0)
        lastObserved = now
        if (!paused) remaining -= elapsed
        return remaining <= 0
    }
}

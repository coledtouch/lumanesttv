package tv.lumanest.tuner.player

/** A preview can become an explicit watch without replacing its already-playing stream. */
internal class LiveWatchIntent {
    private var channelKey: String? = null
    private var explicitlyRequested = false
    private var pendingKey: String? = null

    fun request(key: String?, live: Boolean, explicit: Boolean, sameRequest: Boolean = false) {
        if (!sameRequest) {
            channelKey = key.takeIf { live }
            explicitlyRequested = false
            pendingKey = null
        }
        if (live && explicit && !explicitlyRequested) {
            val watched = key ?: channelKey ?: return
            channelKey = watched
            explicitlyRequested = true
            pendingKey = watched
        }
    }

    /** The first successful preparation counts once; retries and later READY events consume nothing. */
    fun ready(): String? = pendingKey.also { pendingKey = null }

    fun stop() {
        channelKey = null
        explicitlyRequested = false
        pendingKey = null
    }
}

package tv.lumanest.tuner.player

/** Authentication, account limits and server outages do not mean a channel has disappeared. */
internal object PlaybackFailurePolicy {
    fun isMissingHttp(status: Int): Boolean = status == 404 || status == 410
}

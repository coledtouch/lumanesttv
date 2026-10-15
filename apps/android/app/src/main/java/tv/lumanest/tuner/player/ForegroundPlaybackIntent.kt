package tv.lumanest.tuner.player

/** Returning to the app resumes playback only when the viewer had requested it. */
internal class ForegroundPlaybackIntent {
    var foreground = true
        private set
    private var resumeRequested = false

    fun background(playWhenReady: Boolean) {
        if (!foreground) return
        foreground = false
        resumeRequested = playWhenReady
    }

    fun requestStart() { if (!foreground) resumeRequested = true }

    fun foreground(): Boolean {
        val resume = !foreground && resumeRequested
        foreground = true
        resumeRequested = false
        return resume
    }

    fun stop() { resumeRequested = false }
}

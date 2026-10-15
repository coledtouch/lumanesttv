package tv.lumanest.tuner.player

import okhttp3.OkHttpClient
import okhttp3.Request
import org.junit.Assert.*
import org.junit.Test
import java.util.concurrent.TimeUnit

class PlaybackReliabilityTest {
    @Test fun returningToTheAppResumesRequestedVideoPlayback() {
        val intent = ForegroundPlaybackIntent()
        intent.background(playWhenReady = true)
        assertFalse(intent.foreground)
        assertTrue(intent.foreground())
        assertTrue(intent.foreground)
        assertFalse(intent.foreground())
    }

    @Test fun returningPreservesTheViewersManualPause() {
        val intent = ForegroundPlaybackIntent()
        intent.background(playWhenReady = false)
        assertFalse(intent.foreground())
    }

    @Test fun duplicateBackgroundEventsDoNotLoseRequestedPlayback() {
        val intent = ForegroundPlaybackIntent()
        intent.background(playWhenReady = true)
        intent.background(playWhenReady = false)
        assertTrue(intent.foreground())
    }

    @Test fun anExplicitNewRequestCanStartAfterTheAppReturns() {
        val intent = ForegroundPlaybackIntent()
        intent.background(playWhenReady = false)
        intent.requestStart()
        assertTrue(intent.foreground())
        intent.background(playWhenReady = true)
        intent.stop()
        assertFalse(intent.foreground())
    }

    @Test fun providerOutagesAndAccountFailuresDoNotRemoveChannels() {
        for (status in listOf(200, 400, 401, 403, 408, 429, 500, 502, 503, 504)) {
            assertFalse("HTTP $status should preserve the channel", PlaybackFailurePolicy.isMissingHttp(status))
        }
        assertTrue(PlaybackFailurePolicy.isMissingHttp(404))
        assertTrue(PlaybackFailurePolicy.isMissingHttp(410))
    }

    @Test fun sleepingTheAppDoesNotConsumeTheBufferingBudget() {
        val budget = PlaybackWaitBudget(120_000, 0)
        assertFalse(budget.expired(30_000, paused = false))
        assertFalse(budget.expired(600_000, paused = true))
        assertFalse(budget.expired(689_999, paused = false))
        assertTrue(budget.expired(690_000, paused = false))
    }

    @Test fun backwardsClockObservationDoesNotSpendWaitBudget() {
        val budget = PlaybackWaitBudget(100, 1000)
        assertFalse(budget.expired(990, paused = false))
        assertFalse(budget.expired(1089, paused = false))
        assertTrue(budget.expired(1090, paused = false))
    }

    @Test fun oneHeldRequestCannotMarkAnotherOpenAsExpired() {
        val factory = TuneDeadline(OkHttpClient())
        val held = TuneDeadline.Attempt(30)
        val unrelated = TuneDeadline.Attempt(0)
        val request = Request.Builder().url("http://127.0.0.1/").build()
        val heldCall = try {
            TuneDeadline.nextAttempt.set(held)
            factory.newCall(request)
        } finally { TuneDeadline.nextAttempt.remove() }
        val unrelatedCall = try {
            TuneDeadline.nextAttempt.set(unrelated)
            factory.newCall(request)
        } finally { TuneDeadline.nextAttempt.remove() }
        try {
            val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(2)
            while (!held.expired.get() && System.nanoTime() < deadline) Thread.sleep(5)
            assertTrue(held.expired.get())
            assertTrue(heldCall.isCanceled())
            assertFalse(unrelated.expired.get())
            assertFalse(unrelatedCall.isCanceled())
        } finally { heldCall.cancel(); unrelatedCall.cancel() }
    }
}

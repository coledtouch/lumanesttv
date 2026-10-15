package tv.lumanest.tuner.player

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class LiveWatchIntentTest {
    @Test fun automaticGuidePreviewDoesNotCountItsReadyOrRestoredEvents() {
        val intent = LiveWatchIntent()
        intent.request("news", live = true, explicit = false)
        repeat(3) { assertNull(intent.ready()) }
        intent.request("news", live = true, explicit = false, sameRequest = true)
        assertNull(intent.ready())
    }

    @Test fun openingTheAlreadyReadyPreviewCountsOnceWithoutANewSourceRequest() {
        val intent = LiveWatchIntent()
        intent.request("news", live = true, explicit = false)
        assertNull(intent.ready())
        intent.request("news", live = true, explicit = true, sameRequest = true)
        assertEquals("news", intent.ready())
        intent.request("news", live = true, explicit = true, sameRequest = true)
        assertNull(intent.ready())
    }

    @Test fun choosingAPreviewWhileItBuffersCountsOnlyWhenItBecomesReady() {
        val intent = LiveWatchIntent()
        intent.request("sports", live = true, explicit = false)
        intent.request("sports", live = true, explicit = true, sameRequest = true)
        intent.request("sports", live = true, explicit = true, sameRequest = true)
        assertEquals("sports", intent.ready())
        repeat(3) { assertNull(intent.ready()) }
    }

    @Test fun retriesBackupsAndForegroundRestorationDoNotCountAnExplicitTuneAgain() {
        val intent = LiveWatchIntent()
        intent.request("sports", live = true, explicit = true)
        assertEquals("sports", intent.ready())
        // Source recovery preserves the same request rather than creating a new watch intent.
        repeat(4) { assertNull(intent.ready()) }
        intent.request("sports", live = true, explicit = false, sameRequest = true)
        intent.request("sports", live = true, explicit = true, sameRequest = true)
        assertNull(intent.ready())
    }

    @Test fun supersedingAnUnreadyChannelCountsOnlyTheChannelThatWasActuallyPrepared() {
        val intent = LiveWatchIntent()
        intent.request("missing", live = true, explicit = true)
        intent.request("automatically-skipped-to", live = true, explicit = false)
        assertNull(intent.ready())
        intent.request("working", live = true, explicit = true)
        assertEquals("working", intent.ready())
        assertNull(intent.ready())
    }

    @Test fun stoppingCancelsAPendingWatchAndASeparateLaterVisitCanCountAgain() {
        val intent = LiveWatchIntent()
        intent.request("news", live = true, explicit = true)
        intent.stop()
        assertNull(intent.ready())
        intent.request("news", live = true, explicit = false)
        assertNull(intent.ready())
        intent.request("news", live = true, explicit = true, sameRequest = true)
        assertEquals("news", intent.ready())
    }

    @Test fun moviesAndLiveRequestsWithoutAChannelKeyNeverAffectChannelHistory() {
        val intent = LiveWatchIntent()
        intent.request("movie", live = false, explicit = true)
        assertNull(intent.ready())
        intent.request(null, live = true, explicit = true)
        assertNull(intent.ready())
    }
}

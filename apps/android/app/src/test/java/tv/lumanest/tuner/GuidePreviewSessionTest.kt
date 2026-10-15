package tv.lumanest.tuner

import tv.lumanest.tuner.data.Channel
import tv.lumanest.tuner.ui.GuidePreviewSession
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class GuidePreviewSessionTest {
    private val watched = Channel("watched", 100, "Watched channel", null, "news", null, null, "http://example.invalid/watched.ts", backups = listOf("http://example.invalid/backup.ts"))
    private val other = watched.copy(key = "other", number = 101, name = "Other channel", url = "http://example.invalid/other.ts", backups = emptyList())

    @Test fun browsingDifferentChannelsAndProgramsDoesNotChangePlaybackOrLastWatched() {
        val session = GuidePreviewSession()
        var currentUrl = watched.url
        var lastWatched = watched.key
        var starts = 0
        repeat(6) {
            // Recomposition, guide refresh, category selection and future selection are all read-only.
            val channel = session.update(listOf(watched, other), emptyList(), true, currentUrl, true, lastWatched) {
                starts++; currentUrl = it.url; lastWatched = it.key
            }
            assertEquals(watched.key, channel?.key)
            assertEquals(watched.url, currentUrl)
            assertEquals(watched.key, lastWatched)
        }
        assertEquals(0, starts)
    }

    @Test fun anAlreadyPlayingBackupIsPreservedEvenWhenTheChannelIsOutsideTheCategory() {
        val session = GuidePreviewSession()
        var starts = 0
        val activeBackup = watched.backups[0]
        assertEquals(watched, session.update(listOf(watched, other), emptyList(), true, activeBackup, true, other.key) { starts++ })
        // A transient empty provider refresh must not replace or stop the watched stream.
        assertEquals(watched, session.update(emptyList(), emptyList(), true, activeBackup, true, other.key) { starts++ })
        assertEquals(0, starts)
    }

    @Test fun anIdleGuideResumesOnlyTheKnownLastWatchedChannelOnce() {
        val session = GuidePreviewSession()
        val starts = mutableListOf<String>()
        assertEquals(watched, session.update(listOf(other, watched), emptyList(), true, null, false, watched.key) { starts += it.key })
        assertEquals(listOf(watched.key), starts)
        // Losing the stream or changing selection later does not initiate another tune.
        assertNull(session.update(listOf(other, watched), emptyList(), true, null, true, other.key) { starts += it.key })
        assertEquals(listOf(watched.key), starts)
    }

    @Test fun missingLastWatchedNeverFallsBackToTheFirstChannel() {
        val session = GuidePreviewSession()
        val starts = mutableListOf<String>()
        assertNull(session.update(listOf(other), emptyList(), true, null, false, null) { starts += it.key })
        assertNull(session.update(listOf(other), emptyList(), true, null, false, watched.key) { starts += it.key })
        assertEquals(emptyList<String>(), starts)
        // Wait for the existing last-watched item when catalog loading is still in progress.
        assertEquals(watched, session.update(listOf(other, watched), emptyList(), true, null, false, watched.key) { starts += it.key })
        assertEquals(listOf(watched.key), starts)
    }

    @Test fun disabledPreviewAndExistingMoviePlaybackDoNotStartLiveTv() {
        var starts = 0
        assertNull(GuidePreviewSession().update(listOf(watched), emptyList(), false, null, false, watched.key) { starts++ })
        val session = GuidePreviewSession()
        assertNull(session.update(listOf(watched), emptyList(), true, "http://example.invalid/movie.mp4", false, watched.key) { starts++ })
        assertNull(session.update(listOf(watched), emptyList(), true, null, false, watched.key) { starts++ })
        assertEquals(0, starts)
    }
}

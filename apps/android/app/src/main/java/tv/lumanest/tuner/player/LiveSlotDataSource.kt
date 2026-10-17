package tv.lumanest.tuner.player

import android.net.Uri
import android.os.SystemClock
import androidx.annotation.OptIn
import androidx.media3.common.C
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DataSource
import androidx.media3.datasource.DataSpec
import androidx.media3.datasource.HttpDataSource
import androidx.media3.datasource.TransferListener
import java.io.IOException
import java.io.InterruptedIOException

/** The provider kept answering with its "connection limit reached" clip instead of the channel. */
class SlotBusyException : IOException("Provider connection limit reached")

/**
 * Wraps the HTTP source on single-connection plans.
 *
 * When you change channels, the provider can still be counting the previous stream for a moment.
 * During that window it holds the new request for about 3.5 s and then answers with a short, finite
 * "CONNECTION LIMIT REACHED" video (a fixed Content-Length, about 680 KB) instead of the endless live
 * stream. Played as-is, that clip shows an error screen for ten seconds and then the player stops.
 *
 * So for progressive live streams:
 * - a short, finite reply is never real (live has no length): close it,
 *   wait a beat, ask again;
 * - on live, the first attempts get a short deadline for the response headers ([TuneDeadline]), so a
 *   held request is abandoned after ~1.3 s and re-asked instead of waiting the full 3.5 s.
 * The first good answer passes straight through.
 *
 * An endless live answer (progressive live with no length, not a playlist) is then read through [LiveRejoin]: when the
 * provider's connection goes quiet or drops, it is replaced in the background through this same open path, and
 * [TsSplicer] joins the new connection's TS onto the old one, so ExoPlayer keeps reading one stream and its buffer
 * bridges the gap. Media3 itself can't resume such a stream (it waits until the buffer is empty, then starts over).
 * Until a connection drops, its bytes reach ExoPlayer exactly as before; when a rejoin can't continue the stream
 * exactly, ExoPlayer gets the drop as before and starts over.
 * Everything else (VOD, HLS playlists and segments, ranged requests) passes straight through, as before. Multi View's
 * players use this factory too, so each of their connections is rejoined the same way, one connection at a time.
 */
@OptIn(UnstableApi::class)
class LiveSlotDataSource(
    private val upstream: DataSource,
    /** True while the current item is a progressive stream (TS or MP4). Off for HLS, whose segments are short by design. */
    private val guard: () -> Boolean,
    private val live: () -> Boolean,
    private val deadlines: TuneDeadline?,
    private val clock: () -> Long = SystemClock::elapsedRealtime,
    private val pacing: LiveRejoin.Pacing = LiveRejoin.Pacing(),
) : DataSource {

    /** Set while an endless live stream is open; all of it runs on ExoPlayer's loading thread. */
    private var rejoin: LiveRejoin? = null

    private class Opened(val length: Long, val canceller: LiveRejoin.Canceller)

    override fun addTransferListener(transferListener: TransferListener) = upstream.addTransferListener(transferListener)

    override fun open(dataSpec: DataSpec): Long {
        release()
        if (!guard() || isPlaylist(dataSpec.uri) || dataSpec.position > 0) return upstream.open(dataSpec)
        val opened = openGuarded(dataSpec)
        if (live() && opened.length == C.LENGTH_UNSET.toLong()) {
            rejoin = LiveRejoin(Rejoinable(dataSpec), opened.canceller, PlaybackLog::note, clock, pacing)
        }
        return opened.length
    }

    /** Opens past held requests and the provider's busy clip. Returns the length and a way to cancel this connection. */
    private fun openGuarded(dataSpec: DataSpec): Opened {
        val giveUpAt = clock() + BUDGET_MS
        var attempt = 0
        while (true) {
            val remaining = giveUpAt - clock()
            if (remaining <= 0) throw SlotBusyException()
            val headerDeadline = if (live() && deadlines != null) minOf(HEADER_DEADLINES_MS.getOrElse(attempt) { remaining }, remaining) else 0L
            val deadlineAttempt = TuneDeadline.Attempt(headerDeadline)
            TuneDeadline.nextAttempt.set(deadlineAttempt)
            val length = try {
                upstream.open(dataSpec)
            } catch (e: IOException) {
                closeQuietly()
                val heldByServer = deadlineAttempt.expired.get()
                if (!heldByServer || Thread.currentThread().isInterrupted) throw e
                attempt++
                PlaybackLog.note("server held the request ${headerDeadline}ms, asking again")
                if (clock() >= giveUpAt) throw SlotBusyException()
                continue
            } finally {
                TuneDeadline.nextAttempt.remove()
            }
            if (length == C.LENGTH_UNSET.toLong() || length > CLIP_MAX_BYTES) {
                PlaybackLog.opened(attempt)
                return Opened(length) { deadlineAttempt.cancel() }
            }
            closeQuietly()
            attempt++
            PlaybackLog.slotBusy(attempt, length)
            val wait = BACKOFF_MS[(attempt - 1).coerceAtMost(BACKOFF_MS.lastIndex)]
            if (clock() + wait >= giveUpAt) throw SlotBusyException()
            try {
                Thread.sleep(wait)
            } catch (e: InterruptedException) {
                // The interrupt becomes this exception and the flag stays cleared, as in Media3's OkHttpDataSource:
                // Loader runs the next load on this thread, and a flag left set would fail its open at once.
                throw InterruptedIOException("Canceled while waiting for the provider").apply { initCause(e) }
            }
        }
    }

    /** How [LiveRejoin] reaches the provider: the same request, through [openGuarded], on the loading thread. */
    private inner class Rejoinable(private val dataSpec: DataSpec) : LiveRejoin.Upstream {
        override fun reopen(): LiveRejoin.Canceller {
            closeQuietly()
            val opened = openGuarded(dataSpec)
            if (opened.length != C.LENGTH_UNSET.toLong()) {
                closeQuietly()
                throw IOException("The provider answered with ${opened.length} bytes instead of the live stream")
            }
            return opened.canceller
        }

        override fun read(buffer: ByteArray, offset: Int, length: Int): Int = upstream.read(buffer, offset, length)

        override fun close() = closeQuietly()

        // These end the rejoins at once. LiveRejoin then hands ExoPlayer the drop itself, never this answer: right after a
        // drop the provider may still count the connection that dropped (the Cast receiver allows RELEASE_MS for that),
        // so ExoPlayer's own retry, once the buffer has played out, opens with a fresh BUDGET_MS and only then shows
        // "another device is using your connection" if the line is still busy, as in 1.6.2.
        override fun isFinal(e: IOException): Boolean = e is SlotBusyException || httpStatus(e)?.let { it in FINAL_STATUS } == true
    }

    private fun closeQuietly() {
        try { upstream.close() } catch (_: IOException) {}
    }

    override fun read(buffer: ByteArray, offset: Int, length: Int): Int =
        rejoin?.read(buffer, offset, length) ?: upstream.read(buffer, offset, length)

    override fun getUri(): Uri? = upstream.uri

    override fun getResponseHeaders(): Map<String, List<String>> = upstream.responseHeaders

    override fun close() {
        release()
        upstream.close()
    }

    private fun release() {
        rejoin?.release()
        rejoin = null
    }

    private fun isPlaylist(uri: Uri): Boolean {
        val path = uri.path?.lowercase() ?: return false
        return path.endsWith(".m3u8") || path.endsWith(".m3u")
    }

    private fun httpStatus(e: Throwable): Int? {
        var t: Throwable? = e
        while (t != null) {
            if (t is HttpDataSource.InvalidResponseCodeException) return t.responseCode
            t = t.cause
        }
        return null
    }

    class Factory(
        private val upstream: DataSource.Factory,
        private val deadlines: TuneDeadline?,
        private val guard: () -> Boolean,
        private val live: () -> Boolean,
    ) : DataSource.Factory {
        override fun createDataSource(): DataSource = LiveSlotDataSource(upstream.createDataSource(), guard, live, deadlines)
    }

    companion object {
        /** Anything finite and smaller than this is the provider's notice clip, not a channel or a movie. */
        private const val CLIP_MAX_BYTES = 4L * 1024 * 1024
        /** How long to keep asking before showing "another device is using your connection". */
        private const val BUDGET_MS = 9_000L
        /** Header deadlines for the first live attempts; later attempts use the remaining total budget. */
        private val HEADER_DEADLINES_MS = longArrayOf(1_300, 2_200)
        private val BACKOFF_MS = longArrayOf(150, 250, 400, 600, 900, 1200)
        /** Answers a rejoin doesn't retry (as the Cast receiver): the request itself is refused or gone. */
        private val FINAL_STATUS = setOf(400, 401, 403, 404, 410)
    }
}

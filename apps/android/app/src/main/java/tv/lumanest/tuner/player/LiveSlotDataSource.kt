package tv.lumanest.tuner.player

import android.net.Uri
import android.os.SystemClock
import androidx.annotation.OptIn
import androidx.media3.common.C
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DataSource
import androidx.media3.datasource.DataSpec
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
 */
@OptIn(UnstableApi::class)
class LiveSlotDataSource(
    private val upstream: DataSource,
    /** True while the current item is a progressive stream (TS or MP4). Off for HLS, whose segments are short by design. */
    private val guard: () -> Boolean,
    private val live: () -> Boolean,
    private val deadlines: TuneDeadline?,
) : DataSource {

    override fun addTransferListener(transferListener: TransferListener) = upstream.addTransferListener(transferListener)

    override fun open(dataSpec: DataSpec): Long {
        if (!guard() || isPlaylist(dataSpec.uri) || dataSpec.position > 0) return upstream.open(dataSpec)
        val giveUpAt = SystemClock.elapsedRealtime() + BUDGET_MS
        var attempt = 0
        while (true) {
            val remaining = giveUpAt - SystemClock.elapsedRealtime()
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
                if (SystemClock.elapsedRealtime() >= giveUpAt) throw SlotBusyException()
                continue
            } finally {
                TuneDeadline.nextAttempt.remove()
            }
            if (length == C.LENGTH_UNSET.toLong() || length > CLIP_MAX_BYTES) {
                PlaybackLog.opened(attempt)
                return length
            }
            closeQuietly()
            attempt++
            PlaybackLog.slotBusy(attempt, length)
            val wait = BACKOFF_MS[(attempt - 1).coerceAtMost(BACKOFF_MS.lastIndex)]
            if (SystemClock.elapsedRealtime() + wait >= giveUpAt) throw SlotBusyException()
            try {
                Thread.sleep(wait)
            } catch (e: InterruptedException) {
                Thread.currentThread().interrupt()
                throw InterruptedIOException("Canceled while waiting for the provider")
            }
        }
    }

    private fun closeQuietly() {
        try { upstream.close() } catch (_: IOException) {}
    }

    override fun read(buffer: ByteArray, offset: Int, length: Int): Int = upstream.read(buffer, offset, length)

    override fun getUri(): Uri? = upstream.uri

    override fun getResponseHeaders(): Map<String, List<String>> = upstream.responseHeaders

    override fun close() = upstream.close()

    private fun isPlaylist(uri: Uri): Boolean {
        val path = uri.path?.lowercase() ?: return false
        return path.endsWith(".m3u8") || path.endsWith(".m3u")
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
    }
}

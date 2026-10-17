package tv.lumanest.tuner.player

import java.io.IOException
import java.io.InterruptedIOException
import java.net.SocketTimeoutException
import java.util.concurrent.ScheduledExecutorService
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.ScheduledThreadPoolExecutor
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicReference

/**
 * A new connection can't continue the extractor's timeline exactly (another program map, a restarted clock, a
 * different encode, no keyframe in time, a resend that didn't catch up): ExoPlayer's own retry takes over, as before.
 * Deliberately a plain IOException: RetryPolicy defers the retry until the buffer has played out, as in 1.6.2.
 */
class SpliceException(message: String) : IOException(message)

/**
 * Keeps an endless live MPEG-TS stream flowing across provider connections, inside the data source, so ExoPlayer never
 * sees the drop.
 *
 * Why here and not in ExoPlayer: provider connections go quiet (open, but no bytes) for 10 s and more. For a stream of
 * unknown length that can't seek, Media3 1.11.1's ProgressiveMediaPeriod can't resume after a load error: it defers the
 * retry, plays out what is buffered, then resets every sample queue and loads again from position 0 (a new connection,
 * then a wait for a keyframe). So the 10 to 15 s buffered never bridges the outage; the picture freezes for the
 * reconnect on top of it. This class rejoins while the buffer still plays, the way the LumaNest Cast receiver does
 * (CastStreamLoader in site/public/cast/receiver.js):
 * - a connection with no bytes for [Pacing.quietMs] while it is being read is dead even if its socket is still open;
 *   an IOException or the end of the stream is a drop too;
 * - a watchdog thread ends the stuck read by cancelling that connection's OkHttp call ([Canceller]), which is
 *   thread-safe, unlike Media3's OkHttpDataSource; the loading thread catches the failure and reopens the same request
 *   through [Upstream.reopen] (the provider's busy-line handling and header deadlines included);
 * - [TsSplicer] joins the new connection's TS onto the old one, so the extractor sees one continuous stream;
 * - pacing as the receiver: [Pacing.delaysMs] for the 1st, 2nd and 3rd failure within [Pacing.windowMs], at most
 *   [Pacing.limit] rejoins within [Pacing.spanMs].
 *
 * Never worse than without it (1.6.2):
 * - the quiet watchdog only cancels a connection a rejoin will replace at once: the stream is MPEG-TS the splicer can
 *   continue, the connection has sent bytes, and the pacing allows another rejoin. Any other connection, and any
 *   connection (first or rejoined) that hasn't sent its first byte, keeps OkHttp's 10 s readTimeout. The decision and
 *   the read returning are one atomic hand-off: bytes that arrive while the cancel lands are dropped, so the splicer
 *   stays as the watchdog saw it and the rejoin follows;
 * - when no rejoin may follow, or the reopen gets a final answer (the provider's busy clip, 403, 404), the connection's
 *   own failure is thrown, or its end returned, exactly as ExoPlayer got it before, so its deferred retry runs as it did
 *   (and meets the busy line itself, with a fresh wait). The final answer itself is never thrown from here;
 * - a new connection the splicer can't place exactly, or that isn't placed within [Pacing.placeMs] of its first byte,
 *   ends the load with a [SpliceException], which ExoPlayer retries the same way.
 *
 * Threads: [read] and [release] run on ExoPlayer's loading thread only. The watchdog touches nothing but volatiles,
 * atomics, the pacing record (under a lock) and [Canceller.cancel]. ExoPlayer cancels a load by interrupting the loading
 * thread (and closing the data source once the load returns): a cancelled load never starts or continues a rejoin, a
 * wait before a rejoin ends at once, and a socket read, which ignores interrupts, is cancelled by the watchdog as soon as
 * it sees the interrupt.
 */
class LiveRejoin(
    private val upstream: Upstream,
    firstConnection: Canceller,
    private val log: (String) -> Unit,
    private val clock: () -> Long,
    private val pacing: Pacing = Pacing(),
    private val sleeper: (Long) -> Unit = { Thread.sleep(it) },
    private val watchdog: ScheduledExecutorService = WATCHDOG,
) {
    /** The connection being read; the loading thread opens, reads and closes it. */
    interface Upstream {
        /** Closes whatever is open and opens the same stream again, the way the first connection was opened. */
        @Throws(IOException::class)
        fun reopen(): Canceller

        @Throws(IOException::class)
        fun read(buffer: ByteArray, offset: Int, length: Int): Int

        /** Closes the current connection without throwing. */
        fun close()

        /** An answer a new connection right now won't change: a refused or busy line, a missing channel. */
        fun isFinal(e: IOException): Boolean
    }

    /** Fails the current connection's blocked read from any thread (OkHttp's thread-safe Call.cancel). */
    fun interface Canceller {
        fun cancel()
    }

    class Pacing(
        val quietMs: Long = QUIET_MS,
        /** How long after its first byte a new connection may take to find its place and catch up. */
        val placeMs: Long = PLACE_MS,
        val delaysMs: List<Long> = listOf(0L, 500L, 1_500L),
        val windowMs: Long = 20_000,
        val spanMs: Long = 120_000,
        val limit: Int = 6,
        val checkEveryMs: Long = 250,
    )

    private enum class Reason { QUIET, END, ERROR }

    private class Loss(val reason: Reason, val cause: IOException?, val quietMs: Long) {
        fun describe(): String = when (reason) {
            Reason.QUIET -> "${quietMs}ms quiet"
            Reason.END -> "end of stream"
            Reason.ERROR -> "read error ${brief(cause)}"
        }
    }

    /** A read of the connection, blocked since [since], or ([cancel]) the watchdog's decision to end it. */
    private class Read(val since: Long, val cancel: Cancel? = null)

    /** Why the watchdog cancelled a connection: not placed in time ([late]), or [quietMs] without bytes. */
    private class Cancel(val late: Boolean, val quietMs: Long)

    private inner class Connection(val canceller: Canceller) : Runnable {
        @Volatile var gotBytes = false
        @Volatile var firstByteAt = 0L
        @Volatile private var task: ScheduledFuture<*>? = null

        fun start() {
            task = watchdog.scheduleWithFixedDelay(this, pacing.checkEveryMs, pacing.checkEveryMs, TimeUnit.MILLISECONDS)
        }

        fun stop() { task?.cancel(false) }

        override fun run() {
            try { check() } catch (_: Throwable) { /* keep the shared watchdog thread alive */ }
        }

        private fun check() {
            if (released || current !== this) { stop(); return }
            val read = reading.get()
            val thread = reader
            if (read == null || thread == null) return
            if (thread.isInterrupted) {
                // ExoPlayer cancelled the load. A socket read doesn't notice an interrupt, so end it here.
                canceled.set(true)
                canceller.cancel()
                return
            }
            // A connection that hasn't sent anything yet, first or rejoined, keeps OkHttp's readTimeout for its first
            // byte (10 s), as ExoPlayer's own retry did: some providers answer at once but start the body seconds later.
            if (read.cancel != null || !gotBytes) return
            val now = clock()
            val waited = now - read.since
            val cancel = when {
                placing && now - firstByteAt >= pacing.placeMs -> Cancel(late = true, quietMs = waited)
                // Only a connection that a rejoin replaces at once; any other keeps OkHttp's readTimeout, as before.
                spliceable && waited >= pacing.quietMs && budgetLeft(now) -> Cancel(late = false, quietMs = waited)
                else -> return
            }
            // Decided on the splicer as it was when this read began (the loading thread pushes nothing while it is
            // blocked), and only if the same read is still blocked: bytes that came in meanwhile took it back. Bytes
            // arriving from here until the cancel lands are dropped by the loading thread, so what was decided holds.
            if (reading.compareAndSet(read, Read(read.since, cancel))) canceller.cancel()
        }
    }

    private val splicer = TsSplicer(log)
    private val buffer = ByteArray(READ_SIZE)
    @Volatile private var current: Connection? = null
    /**
     * The read the loading thread is blocked in, or null. The watchdog swaps it for its decision to cancel; the loading
     * thread takes it back when the read returns, and finds that decision if it came first.
     */
    private val reading = AtomicReference<Read?>(null)
    @Volatile private var reader: Thread? = null
    @Volatile private var released = false
    /** The splicer could continue the stream on a new connection (mirrored for the watchdog). */
    @Volatile private var spliceable = false
    /** A new connection is still being placed (mirrored for the watchdog). */
    @Volatile private var placing = false
    private val canceled = AtomicBoolean(false)
    private var loss: Loss? = null
    private var ended = false
    /** What ended this session; thrown again if read once more. */
    private var over: IOException? = null
    private val pace = Any()
    private val failures = ArrayDeque<Long>()
    private val rejoins = ArrayDeque<Long>()
    private var total = 0
    private var lastByteAt = clock()

    init {
        current = Connection(firstConnection).also { it.start() }
    }

    /** Bytes the extractor got, over all connections. */
    val delivered: Long get() = splicer.delivered

    /**
     * Reads whole bytes the splicer has finished: fewer than asked for when that is all there is, blocking until there
     * are some, the end, or an error. Never 0 for a length above 0.
     */
    @Throws(IOException::class)
    fun read(target: ByteArray, offset: Int, length: Int): Int {
        if (released) throw InterruptedIOException("Load canceled")
        over?.let { throw it }
        if (length == 0) return 0
        try {
            while (true) {
                val n = splicer.read(target, offset, length)
                if (n > 0) return n
                if (ended) return END_OF_INPUT
                throwIfCanceled()
                val connection = current
                if (connection == null) rejoin() else pull(connection)
            }
        } catch (e: IOException) {
            if (e !is InterruptedIOException || e is SocketTimeoutException) over = e
            throw e
        }
    }

    /** The load is over (ExoPlayer closed the data source). Stops this session's watchdog. */
    fun release() {
        released = true
        current?.stop()
        current = null
    }

    private fun pull(connection: Connection) {
        var count = 0
        var error: IOException? = null
        val read = Read(clock())
        var cancel: Cancel? = null
        reader = Thread.currentThread()
        reading.set(read)
        try {
            count = upstream.read(buffer, 0, buffer.size)
        } catch (e: IOException) {
            error = e
        } finally {
            reader = null
            if (!reading.compareAndSet(read, null)) cancel = reading.getAndSet(null)?.cancel
        }
        if (error != null && isCancel(error)) throw canceled(error)
        if (cancel != null) {
            // The watchdog cancelled this connection. Bytes this read got before the cancel landed are dropped: the
            // splicer stays as the watchdog saw it, so the rejoin it counted on follows.
            if (cancel.late) fail(connection, "not placed within ${pacing.placeMs}ms of its first byte")
            drop(connection, Reason.QUIET, error, cancel.quietMs)
            return
        }
        if (error != null) {
            drop(connection, Reason.ERROR, error)
            return
        }
        if (count < 0) {
            drop(connection, Reason.END, null)
            return
        }
        if (count == 0) return
        val now = clock()
        if (!connection.gotBytes) {
            connection.firstByteAt = now
            connection.gotBytes = true
        }
        lastByteAt = now
        splicer.push(buffer, 0, count)
        mirror()
        (splicer.changed ?: splicer.lost)?.let { fail(connection, it) }
        if (splicer.placing && now - connection.firstByteAt >= pacing.placeMs) {
            fail(connection, "not placed within ${pacing.placeMs}ms of its first byte")
        }
    }

    private fun mirror() {
        spliceable = splicer.canSplice
        placing = splicer.placing
    }

    private fun drop(connection: Connection, reason: Reason, cause: IOException?, quietMs: Long = 0) {
        connection.stop()
        current = null
        upstream.close()
        loss = Loss(reason, cause, quietMs)
    }

    /** The new connection can't continue the stream: ExoPlayer's own retry takes over. */
    private fun fail(connection: Connection, why: String): Nothing {
        connection.stop()
        current = null
        upstream.close()
        log("rejoin gave up: $why")
        throw SpliceException("Can't continue the live stream on a new connection: $why")
    }

    /** Opens a new connection after a drop, or gives up as ExoPlayer would have without this class. */
    private fun rejoin() {
        val lost = loss ?: Loss(Reason.ERROR, null, 0)
        while (true) {
            throwIfCanceled()
            val now = clock()
            val refusal = if (!splicer.canSplice) {
                if (splicer.raw) "the stream doesn't start as 188-byte MPEG-TS" else "nothing the splicer can continue"
            } else admit(now)
            if (refusal != null) return giveUp(lost, refusal)
            total++
            log("rejoin #$total after ${lost.describe()}")
            pause(pacing.delaysMs[(tries(now) - 1).coerceIn(0, pacing.delaysMs.lastIndex)])
            throwIfCanceled()
            try {
                val canceller = upstream.reopen()
                throwIfCanceled()
                splicer.connect(clock() - lastByteAt)
                mirror()
                current = Connection(canceller).also { it.start() }
                return
            } catch (e: IOException) {
                upstream.close()
                if (isCancel(e)) throw canceled(e)
                if (upstream.isFinal(e)) {
                    // The provider refused the line (its busy clip included: it may still count the connection that
                    // just dropped) or the channel is gone. The drop goes to ExoPlayer as before; its own retry gets
                    // a fresh wait for the line and, if still refused, ends as it did.
                    return giveUp(lost, "reopen refused ${brief(e)}")
                }
                log("rejoin #$total failed: ${brief(e)}")
            }
        }
    }

    /** Counts this failure; why no rejoin may start now, or null (and the rejoin is counted). */
    private fun admit(now: Long): String? = synchronized(pace) {
        prune(now)
        failures.addLast(now)
        when {
            failures.size > pacing.delaysMs.size -> "${failures.size} failures within ${pacing.windowMs / 1000}s"
            rejoins.size >= pacing.limit -> "${rejoins.size} rejoins within ${pacing.spanMs / 1000}s"
            else -> {
                rejoins.addLast(now)
                null
            }
        }
    }

    private fun tries(now: Long): Int = synchronized(pace) {
        prune(now)
        failures.size
    }

    /** A failure now would rejoin (for the watchdog: otherwise the connection is left to OkHttp's readTimeout). */
    private fun budgetLeft(now: Long): Boolean = synchronized(pace) {
        prune(now)
        failures.size < pacing.delaysMs.size && rejoins.size < pacing.limit
    }

    private fun prune(now: Long) {
        while (failures.isNotEmpty() && now - failures.first() >= pacing.windowMs) failures.removeFirst()
        while (rejoins.isNotEmpty() && now - rejoins.first() >= pacing.spanMs) rejoins.removeFirst()
    }

    /** The connection's own failure (or end) goes to ExoPlayer, exactly as without this class. */
    private fun giveUp(lost: Loss, why: String) {
        log("rejoin gave up after ${lost.describe()}: $why")
        when (lost.reason) {
            // A clean end goes to ExoPlayer as an end, as before (the player's own reconnect picks it up).
            Reason.END -> {
                splicer.finish()
                ended = true
            }
            Reason.QUIET -> throw IOException("No data from the provider for ${lost.quietMs}ms", lost.cause)
            Reason.ERROR -> throw lost.cause ?: IOException("Live stream lost")
        }
    }

    private fun pause(ms: Long) {
        if (ms <= 0) return
        try {
            sleeper(ms)
        } catch (e: InterruptedException) {
            // The interrupt is spent on this cancellation (see takeInterrupt), so it isn't set again.
            canceled.set(true)
            throw InterruptedIOException("Canceled while rejoining").apply { initCause(e) }
        }
    }

    private fun throwIfCanceled() {
        if (takeInterrupt() || released || canceled.get()) throw InterruptedIOException("Load canceled")
    }

    /**
     * An interrupt is ExoPlayer cancelling the load; it becomes this session's cancellation and the thread's flag is
     * cleared, as Media3 does where it turns an interrupt into an InterruptedIOException. Media3 1.11.1's Loader clears
     * the flag only after a load that returns normally, and runs the next load on the same thread: a flag left set
     * would fail that load's open at once (OkHttpDataSource's wait for headers).
     */
    private fun takeInterrupt(): Boolean {
        if (!Thread.interrupted()) return false
        canceled.set(true)
        return true
    }

    /**
     * ExoPlayer cancelled the load. Media3's own classification: an InterruptedIOException that isn't a timeout is a
     * cancellation (OkHttpDataSource turns an interrupted wait for headers into one, clearing the interrupt flag).
     */
    private fun isCancel(e: IOException): Boolean {
        if (takeInterrupt() || released || canceled.get()) return true
        var t: Throwable? = e
        while (t != null) {
            if (t is InterruptedIOException && t !is SocketTimeoutException) return true
            t = t.cause
        }
        return false
    }

    private fun canceled(cause: IOException) = InterruptedIOException("Load canceled").apply { initCause(cause) }

    companion object {
        /**
         * No bytes for this long while the extractor waits for them: the connection is dead even if its socket is open.
         *
         * Only connections a rejoin replaces at once are cancelled; everything else keeps OkHttp's 10 s readTimeout,
         * as in 1.6.2. The logs show dead provider connections silent for 10 s and more, while the buffer holds 10 to
         * 15 s. 8 s (the Cast receiver's QUIET_MS on the same provider) still leaves 2 to 7 s of buffer for the new
         * connection to answer (0.3 to 0.9 s normally, about 3.5 s when the provider holds the request) and be placed,
         * where waiting for the 10 s timeout would often leave none, while staying clear of pauses that end on their
         * own: Wi-Fi hiccups and TCP's retransmission backoff (1 + 2 + 4 s). 5 s would replace connections 1.6.2 rode
         * through, each replacement costing a reconnect on a line that allows one connection.
         */
        const val QUIET_MS = 8_000L
        /**
         * A new connection that hasn't found its place this long after its first byte isn't a provider's start-up
         * burst (which comes at line speed): it is a feed behind the old one, in real time. The splice is refused.
         */
        const val PLACE_MS = 5_000L
        const val END_OF_INPUT = -1
        private const val READ_SIZE = 64 * 1024

        /** One daemon thread for every session; each connection's check is cancelled when the connection ends. */
        private val WATCHDOG: ScheduledExecutorService by lazy {
            ScheduledThreadPoolExecutor(1) { r -> Thread(r, "live-rejoin-watchdog").apply { isDaemon = true } }
                .apply { removeOnCancelPolicy = true }
        }

        private fun brief(e: Throwable?): String {
            if (e == null) return ""
            var root: Throwable = e
            while (true) root = root.cause?.takeIf { it !== root } ?: break
            return "(${root.javaClass.simpleName}${root.message?.let { ": $it" } ?: ""})"
        }
    }
}

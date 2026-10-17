package tv.lumanest.tuner.player

import org.junit.After
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.io.InterruptedIOException
import java.util.Collections
import java.util.concurrent.CountDownLatch
import java.util.concurrent.ScheduledThreadPoolExecutor
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicLong
import java.util.concurrent.atomic.AtomicReference
import java.util.concurrent.locks.LockSupport
import kotlin.random.Random

class LiveRejoinTest {
    private val logs: MutableList<String> = Collections.synchronizedList(ArrayList())
    private val watchdog = ScheduledThreadPoolExecutor(1).apply { removeOnCancelPolicy = true }

    @After fun stopWatchdog() { watchdog.shutdownNow() }

    /**
     * A provider connection: [leadMs] before its first byte, some bytes, a pause of [pauseMs] (both in real time, ended
     * early only by a cancel) and [more] bytes, then quiet (until cancelled), an error or the end. With [bytesPerMs] the
     * fake clock moves with the bytes read, as a feed delivered in real time.
     */
    class Script(
        val data: ByteArray,
        val ending: Ending,
        val failOpen: IOException? = null,
        val advanceClockMs: Long = 0,
        val leadMs: Long = 0,
        val pauseMs: Long = 0,
        val more: ByteArray = ByteArray(0),
        val bytesPerMs: Double = 0.0,
    )
    enum class Ending { QUIET, ERROR, END }

    /** The provider's busy answer, as LiveSlotDataSource reports it: final for a rejoin. */
    class Busy : IOException("final")

    /** Stands in for LiveSlotDataSource + OkHttp: one connection at a time; cancel() fails a blocked read like a closed socket. */
    class FakeUpstream(first: Script, vararg next: Script, private val clock: AtomicLong? = null) : LiveRejoin.Upstream {
        inner class Connection(val script: Script) {
            @Volatile var cancelled = false
            var position = 0
            var morePosition = 0
            var led = false
            var paused = false
            var owed = 0.0
            val canceller = LiveRejoin.Canceller { cancelled = true; cancels.incrementAndGet() }
        }
        private val pending = ArrayDeque(next.toList())
        @Volatile var current: Connection? = Connection(first)
        val firstConnection: Connection = current!!
        val reopens = AtomicInteger()
        val cancels = AtomicInteger()
        val blocked = CountDownLatch(1)
        val reopening = CountDownLatch(1)
        @Volatile var blockReopen = false
        val reopenedAt = ArrayList<Long>()

        override fun reopen(): LiveRejoin.Canceller {
            check(current == null) { "the previous connection is still open" }
            reopens.incrementAndGet()
            reopenedAt += System.nanoTime()
            if (blockReopen) {
                reopening.countDown()
                // OkHttpDataSource waits for headers in future.get(): an interrupt ends it, clears the flag and
                // surfaces as a bare InterruptedIOException.
                try { CountDownLatch(1).await() } catch (e: InterruptedException) { throw InterruptedIOException() }
            }
            val script = pending.removeFirstOrNull() ?: throw IOException("final")
            script.failOpen?.let { throw it }
            return Connection(script).also { current = it }.canceller
        }

        /** Blocks like a socket read with nothing to read (interrupts don't end it), until [ms] pass or a cancel. */
        private fun hold(c: Connection, ms: Long) {
            val until = System.nanoTime() + ms * 1_000_000
            while (!c.cancelled && System.nanoTime() < until) {
                if (Thread.currentThread().isInterrupted) Thread.onSpinWait() else LockSupport.parkNanos(5_000_000)
            }
            if (c.cancelled) throw IOException("Socket closed")
        }

        private fun serve(c: Connection, data: ByteArray, at: Int, buffer: ByteArray, offset: Int, length: Int): Int {
            val n = minOf(length, data.size - at, 1 + Random.nextInt(9000))
            System.arraycopy(data, at, buffer, offset, n)
            if (c.script.bytesPerMs > 0 && clock != null) {
                c.owed += n / c.script.bytesPerMs
                val ms = c.owed.toLong()
                c.owed -= ms
                clock.addAndGet(ms)
            }
            return n
        }

        override fun read(buffer: ByteArray, offset: Int, length: Int): Int {
            val c = current ?: throw IOException("closed")
            if (c.cancelled) throw IOException("Socket closed")
            if (!c.led && c.script.leadMs > 0) { c.led = true; hold(c, c.script.leadMs) }
            val data = c.script.data
            if (c.position < data.size) {
                val n = serve(c, data, c.position, buffer, offset, length)
                c.position += n
                return n
            }
            if (!c.paused && c.script.pauseMs > 0) { c.paused = true; hold(c, c.script.pauseMs) }
            val more = c.script.more
            if (c.morePosition < more.size) {
                val n = serve(c, more, c.morePosition, buffer, offset, length)
                c.morePosition += n
                return n
            }
            clock?.addAndGet(c.script.advanceClockMs)
            when (c.script.ending) {
                Ending.END -> return -1
                Ending.ERROR -> throw IOException("Connection reset")
                Ending.QUIET -> {
                    blocked.countDown()
                    // A socket read: it ignores interrupts (the flag stays set) until the socket is closed.
                    while (!c.cancelled) {
                        if (Thread.currentThread().isInterrupted) Thread.onSpinWait() else LockSupport.parkNanos(10_000_000)
                    }
                    throw IOException("Socket closed")
                }
            }
        }

        override fun close() { current = null }

        override fun isFinal(e: IOException) = e.message == "final"
    }

    private fun session(
        upstream: FakeUpstream,
        clock: () -> Long = { System.nanoTime() / 1_000_000 },
        pacing: LiveRejoin.Pacing = LiveRejoin.Pacing(quietMs = 300, checkEveryMs = 20),
        sleeper: (Long) -> Unit = { Thread.sleep(it) },
    ) = LiveRejoin(upstream, upstream.firstConnection.canceller, { logs += it }, clock, pacing, sleeper, watchdog)

    /** Reads like ExoPlayer's extractor (any length, never expecting 0) until the end or an error. */
    private fun readAll(rejoin: LiveRejoin, out: ByteArrayOutputStream): Throwable? {
        val buffer = ByteArray(20_000)
        val random = Random(1)
        while (true) {
            val n = try {
                rejoin.read(buffer, 0, 1 + random.nextInt(buffer.size))
            } catch (e: IOException) {
                return e
            }
            if (n == -1) return null
            assertTrue("read returned $n", n > 0)
            out.write(buffer, 0, n)
        }
    }

    private fun inThread(block: () -> Unit): Pair<Thread, AtomicReference<Throwable?>> {
        val failure = AtomicReference<Throwable?>()
        val thread = Thread { try { block() } catch (t: Throwable) { failure.set(t) } }
        thread.start()
        return thread to failure
    }

    /**
     * Reads on a loading thread of its own, the way ExoPlayer's Loader runs a load, and records whether the thread is
     * still interrupted once the read failed: Loader clears the flag only after a load that returns normally and runs
     * the next load on the same thread, so a flag left set would fail that load's open at once.
     */
    private fun loadInThread(rejoin: LiveRejoin, interruptedAfter: AtomicReference<Boolean>) = inThread {
        val error = readAll(rejoin, ByteArrayOutputStream())
        interruptedAfter.set(Thread.currentThread().isInterrupted)
        error?.let { throw it }
    }

    private fun assertStream(bytes: ByteArray, stream: TsTestStream, frames: List<Int>) {
        val a = TsAnalysis(bytes, stream)
        TsSplicerTest.assertContinuous(a, frames)
        assertEquals((0 until a.audio.size).toList(), a.audioFrames())
    }

    @Test fun quietConnectionIsReplacedAndSplicedSeamlessly() {
        val stream = TsTestStream()
        val upstream = FakeUpstream(
            Script(stream.frames(0, 60), Ending.QUIET),
            Script(TsTestStream(ccStart = 5).frames(40, 130), Ending.END),
        )
        val rejoin = session(upstream)
        val out = ByteArrayOutputStream()
        val started = System.nanoTime()
        val error = readAll(rejoin, out)
        rejoin.release()
        // The third connection was refused: the second one's end goes to ExoPlayer as an end, as without rejoins.
        assertEquals(null, error)
        assertEquals(2, upstream.reopens.get())
        assertTrue("the quiet connection was cancelled", upstream.firstConnection.cancelled)
        val waitedMs = (upstream.reopenedAt[0] - started) / 1_000_000
        assertTrue("rejoined after ${waitedMs}ms", waitedMs in 300..3_000)
        assertStream(out.toByteArray(), stream, (0..129).toList())
        assertTrue(logs.toString(), logs.any { Regex("rejoin #1 after \\d+ms quiet").matches(it) })
        assertTrue(logs.toString(), logs.any { it.startsWith("spliced: dropped") })
        assertTrue(logs.toString(), logs.any { it.startsWith("rejoin #2 after end of stream") })
    }

    @Test fun readErrorsAndEndsRejoinWithoutAGap() {
        val stream = TsTestStream()
        val a = stream.frames(0, 40)
        val upstream = FakeUpstream(
            Script(a.copyOf(a.size - 1000), Ending.ERROR),
            Script(TsTestStream(ccStart = 9).frames(30, 70), Ending.END),
            Script(TsTestStream(ccStart = 2).frames(65, 100), Ending.QUIET),
        )
        val rejoin = session(upstream, pacing = LiveRejoin.Pacing(quietMs = 200, checkEveryMs = 20, delaysMs = listOf(0, 10, 20)))
        val out = ByteArrayOutputStream()
        val error = readAll(rejoin, out)
        rejoin.release()
        // The fourth connection was refused: the third one's quiet goes to ExoPlayer, as without rejoins.
        assertTrue(error.toString(), error?.message?.startsWith("No data from the provider") == true)
        assertStream(out.toByteArray(), stream, (0..99).toList())
    }

    @Test fun threeQuickFailuresThenTheErrorSurfacesAsBefore() {
        val clock = AtomicLong(1_000_000)
        val delays = ArrayList<Long>()
        val upstream = FakeUpstream(
            Script(TsTestStream().frames(0, 30), Ending.ERROR),
            Script(ByteArray(0), Ending.ERROR), Script(ByteArray(0), Ending.ERROR), Script(ByteArray(0), Ending.ERROR),
            Script(ByteArray(0), Ending.ERROR),
            clock = clock,
        )
        val rejoin = session(upstream, clock = { clock.get() }, pacing = LiveRejoin.Pacing(),
            sleeper = { delays += it; clock.addAndGet(it) })
        val error = readAll(rejoin, ByteArrayOutputStream())
        rejoin.release()
        assertEquals("Connection reset", error?.message)
        assertEquals("the first rejoin is immediate", listOf(500L, 1_500L), delays)
        assertEquals(3, upstream.reopens.get())
        assertTrue(logs.toString(), logs.any { it.contains("gave up") && it.contains("4 failures within 20s") })
    }

    @Test fun atMostSixRejoinsInTwoMinutes() {
        val clock = AtomicLong(1_000_000)
        val delays = ArrayList<Long>()
        val stream = TsTestStream()
        val scripts = (0 until 8).map { i -> Script(if (i == 0) stream.frames(0, 30) else ByteArray(0), Ending.END, advanceClockMs = 19_000) }
        val upstream = FakeUpstream(scripts[0], *scripts.drop(1).toTypedArray(), clock = clock)
        val rejoin = session(upstream, clock = { clock.get() }, pacing = LiveRejoin.Pacing(),
            sleeper = { delays += it; clock.addAndGet(it) })
        val out = ByteArrayOutputStream()
        val error = readAll(rejoin, out)
        rejoin.release()
        assertEquals("a clean end still reaches ExoPlayer as the end", null, error)
        assertEquals(6, upstream.reopens.get())
        assertEquals(List(5) { 500L }, delays) // each failure is the 2nd within 20 s
        assertTrue(logs.toString(), logs.any { it.contains("6 rejoins within 120s") })
        assertStream(out.toByteArray(), stream, (0..29).toList())
    }

    @Test fun nothingPlayedYetLeavesTheFailureToExoPlayer() {
        val upstream = FakeUpstream(Script(ByteArray(0), Ending.ERROR), Script(ByteArray(0), Ending.END))
        val rejoin = session(upstream)
        val error = readAll(rejoin, ByteArrayOutputStream())
        rejoin.release()
        assertEquals("Connection reset", error?.message)
        assertEquals(0, upstream.reopens.get())
    }

    @Test fun otherProgramOnTheNewConnectionIsASpliceException() {
        val upstream = FakeUpstream(
            Script(TsTestStream().frames(0, 30), Ending.ERROR),
            Script(TsTestStream(videoPid = 0x300, audioPid = 0x301).frames(0, 30), Ending.END),
        )
        val rejoin = session(upstream)
        val error = readAll(rejoin, ByteArrayOutputStream())
        rejoin.release()
        assertTrue(error.toString(), error is SpliceException)
        assertEquals(null, upstream.current)
    }

    @Test fun cancelledLoadStopsABlockedSocketReadAndNeverRejoins() {
        val upstream = FakeUpstream(Script(TsTestStream().frames(0, 30), Ending.QUIET), Script(TsTestStream().frames(20, 40), Ending.END))
        // Quiet detection far away: only the cancel can end this read.
        val rejoin = session(upstream, pacing = LiveRejoin.Pacing(quietMs = 60_000, checkEveryMs = 20))
        val interruptedAfter = AtomicReference<Boolean>()
        val (thread, failure) = loadInThread(rejoin, interruptedAfter)
        assertTrue(upstream.blocked.await(5, TimeUnit.SECONDS))
        val interruptedAt = System.nanoTime()
        thread.interrupt() // what ExoPlayer's Loader does on cancel or release
        thread.join(3_000)
        assertFalse("the loading thread returned", thread.isAlive)
        assertTrue("returned in ${(System.nanoTime() - interruptedAt) / 1_000_000}ms", System.nanoTime() - interruptedAt < 1_000_000_000L)
        assertTrue(failure.get().toString(), failure.get() is InterruptedIOException)
        assertTrue("the stuck call was cancelled", upstream.firstConnection.cancelled)
        assertEquals("the interrupt is spent on the cancellation", false, interruptedAfter.get())
        assertEquals(0, upstream.reopens.get())
        rejoin.release()
        assertTrue("no watchdog task left", watchdog.queue.isEmpty())
    }

    @Test fun cancelledLoadDoesNotSleepThroughTheRejoinWait() {
        val upstream = FakeUpstream(Script(TsTestStream().frames(0, 30), Ending.ERROR), Script(TsTestStream().frames(20, 40), Ending.END))
        val waiting = CountDownLatch(1)
        val rejoin = LiveRejoin(upstream, upstream.firstConnection.canceller,
            { logs += it; if (it.startsWith("rejoin #1")) waiting.countDown() },
            { System.nanoTime() / 1_000_000 }, LiveRejoin.Pacing(delaysMs = listOf(5_000, 5_000, 5_000)), watchdog = watchdog)
        val interruptedAfter = AtomicReference<Boolean>()
        val (thread, failure) = loadInThread(rejoin, interruptedAfter)
        assertTrue(waiting.await(5, TimeUnit.SECONDS))
        val interruptedAt = System.nanoTime()
        thread.interrupt()
        thread.join(3_000)
        assertFalse(thread.isAlive)
        assertTrue(System.nanoTime() - interruptedAt < 1_000_000_000L)
        assertTrue(failure.get().toString(), failure.get() is InterruptedIOException)
        assertEquals("the interrupt is spent on the cancellation", false, interruptedAfter.get())
        assertEquals(0, upstream.reopens.get())
        rejoin.release()
        assertTrue(watchdog.queue.isEmpty())
    }

    @Test fun cancelledLoadWhileReopeningIsNotRetried() {
        val upstream = FakeUpstream(Script(TsTestStream().frames(0, 30), Ending.ERROR), Script(TsTestStream().frames(20, 40), Ending.END))
        upstream.blockReopen = true
        val rejoin = session(upstream)
        val interruptedAfter = AtomicReference<Boolean>()
        val (thread, failure) = loadInThread(rejoin, interruptedAfter)
        assertTrue(upstream.reopening.await(5, TimeUnit.SECONDS))
        thread.interrupt()
        thread.join(3_000)
        assertFalse(thread.isAlive)
        val error = failure.get()
        assertNotNull(error)
        assertTrue(error.toString(), error is InterruptedIOException)
        assertEquals("one reopen, not a retry after the cancel", 1, upstream.reopens.get())
        assertEquals("the interrupt is spent on the cancellation", false, interruptedAfter.get())
        rejoin.release()
    }

    @Test fun watchdogStopsWithTheSession() {
        val upstream = FakeUpstream(Script(TsTestStream().frames(0, 10), Ending.END))
        val rejoin = session(upstream)
        assertEquals(1, watchdog.queue.size)
        val buffer = ByteArray(100)
        assertTrue(rejoin.read(buffer, 0, 1) == 1)
        rejoin.release()
        assertTrue(watchdog.queue.isEmpty())
        try {
            rejoin.read(buffer, 0, 100)
            fail("read after release")
        } catch (_: InterruptedIOException) {
        }
    }

    // ------------------------------------------------------------------ never worse than without rejoins

    @Test fun aStreamThatCantBeSplicedKeepsItsConnectionThroughAPause() {
        // Not TS (live radio, MP4), or TS whose program map hasn't come yet: no rejoin could follow, so a pause longer
        // than the quiet time is left to OkHttp's readTimeout and the connection carries on, as in 1.6.2.
        val radio = Random(3).nextBytes(20_000).map { if (it.toInt() == 0x47) 0 else it }.toByteArray()
        val stream = TsTestStream()
        val tablesOnly = stream.pat() + stream.pmt()
        for ((first, more) in listOf(radio.copyOf(10_000) to radio.copyOfRange(10_000, 20_000), tablesOnly to stream.frames(0, 30))) {
            val upstream = FakeUpstream(Script(first, Ending.END, pauseMs = 900, more = more))
            val rejoin = session(upstream, pacing = LiveRejoin.Pacing(quietMs = 200, checkEveryMs = 20))
            val out = ByteArrayOutputStream()
            val error = readAll(rejoin, out)
            rejoin.release()
            assertEquals(null, error)
            assertEquals("never cancelled", 0, upstream.cancels.get())
            assertArrayEquals(first + more, out.toByteArray())
        }
    }

    @Test fun noRejoinLeftMeansNoCancel() {
        val stream = TsTestStream()
        val upstream = FakeUpstream(Script(stream.frames(0, 30), Ending.END, pauseMs = 900, more = TsTestStream(ccStart = 2).frames(30, 40)))
        // The pacing allows no rejoin: a quiet cancel would only turn a pause 1.6.2 rode through into an error.
        val rejoin = session(upstream, pacing = LiveRejoin.Pacing(quietMs = 200, checkEveryMs = 20, limit = 0))
        val error = readAll(rejoin, ByteArrayOutputStream())
        rejoin.release()
        assertEquals(null, error)
        assertEquals(0, upstream.cancels.get())
        assertEquals(0, upstream.reopens.get())
    }

    @Test fun aStreamResetJustBeforeAPauseIsLeftToTheReadTimeoutAndItsDropToExoPlayer() {
        // A video packet lost just before the provider paused: TsExtractor reset the video reader and the next frame
        // never came, so no rejoin could continue the stream exactly. The pause is left to OkHttp's readTimeout (no quiet
        // cancel), and the drop that follows goes to ExoPlayer as it was, with no reopen, as in 1.6.2.
        val stream = TsTestStream()
        val a = stream.frames(0, 60)
        val at = stream.videoStart(a, 45)
        val head = a.copyOfRange(0, at + 2 * 188) + a.copyOfRange(at + 3 * 188, at + 5 * 188)
        val upstream = FakeUpstream(Script(head, Ending.ERROR, pauseMs = 900), Script(TsTestStream(ccStart = 5).frames(38, 100), Ending.END))
        val rejoin = session(upstream, pacing = LiveRejoin.Pacing(quietMs = 200, checkEveryMs = 20))
        val out = ByteArrayOutputStream()
        val error = readAll(rejoin, out)
        rejoin.release()
        assertEquals("Connection reset", error?.message)
        assertEquals("never cancelled", 0, upstream.cancels.get())
        assertEquals("never reopened", 0, upstream.reopens.get())
        assertArrayEquals(head, out.toByteArray())
        assertTrue(logs.toString(), logs.any { it.startsWith("rejoin gave up after read error") })
    }

    /**
     * The watchdog decides to cancel a quiet connection the splicer could continue, and the provider's bytes arrive in
     * the instant before the cancel closes the socket: here a relay resuming with a video packet lost, after which the
     * splicer could continue nothing until the next frame. The rejoin the cancel counted on must still follow (an
     * earlier version pushed those bytes, then found nothing to continue and ended the load with the quiet error).
     */
    @Test fun bytesArrivingAsTheQuietCancelLandsDoNotStopTheRejoin() {
        val clock = AtomicLong(1_000_000)
        val stream = TsTestStream()
        val first = stream.frames(0, 60)
        val more = stream.frames(60, 70)
        val video = (0 until more.size step 188).filter { TsTestStream.pidAt(more, it) == stream.videoPid }
        val lost = video.first { (more[it + 1].toInt() and 0x40) == 0 }
        val next = video.first { it > lost && (more[it + 1].toInt() and 0x40) != 0 }
        val resumed = more.copyOf(lost) + more.copyOfRange(lost + 188, next)

        val blocked = CountDownLatch(1)
        val resume = CountDownLatch(1)
        val returned = CountDownLatch(1)
        val reopens = AtomicInteger()
        val second = TsTestStream(ccStart = 5).frames(40, 120)
        val upstream = object : LiveRejoin.Upstream {
            @Volatile var cancelled = false
            var connection = 0
            var position = 0
            override fun reopen(): LiveRejoin.Canceller {
                if (reopens.incrementAndGet() > 1) throw IOException("final")
                connection = 1
                position = 0
                return LiveRejoin.Canceller {}
            }
            override fun read(buffer: ByteArray, offset: Int, length: Int): Int {
                val data = if (connection == 0) first else second
                if (position < data.size) {
                    val n = minOf(length, data.size - position, 9000)
                    System.arraycopy(data, position, buffer, offset, n)
                    position += n
                    return n
                }
                if (connection == 1) return -1
                if (!cancelled && returned.count > 0) {
                    // Quiet until the watchdog decides; then the provider resumes, just before the socket closes.
                    blocked.countDown()
                    resume.await()
                    System.arraycopy(resumed, 0, buffer, offset, resumed.size)
                    returned.countDown()
                    return resumed.size
                }
                while (!cancelled) LockSupport.parkNanos(1_000_000)
                throw IOException("Socket closed")
            }
            override fun close() {}
            override fun isFinal(e: IOException) = e.message == "final"
        }
        val canceller = LiveRejoin.Canceller {
            resume.countDown()
            returned.await(5, TimeUnit.SECONDS)
            upstream.cancelled = true
        }
        val rejoin = LiveRejoin(upstream, canceller, { logs += it }, { clock.get() },
            LiveRejoin.Pacing(checkEveryMs = 5), sleeper = {}, watchdog = watchdog)
        val out = ByteArrayOutputStream()
        val (thread, failure) = inThread { readAll(rejoin, out)?.let { throw it } }
        assertTrue(blocked.await(5, TimeUnit.SECONDS))
        clock.addAndGet(LiveRejoin.QUIET_MS) // the player waits for bytes that long
        thread.join(10_000)
        rejoin.release()
        assertFalse(thread.isAlive)
        assertEquals(logs.toString(), null, failure.get())
        assertEquals("the rejoin followed, then the refused one after its end: $logs", 2, reopens.get())
        assertStream(out.toByteArray(), stream, (0..119).toList())
    }

    @Test fun aRejoinedConnectionGetsTheReadTimeoutForItsFirstByte() {
        // A provider that answers at once but starts the body later: the rejoined connection isn't cut at the quiet
        // time before its first byte (OkHttp's 10 s readTimeout applies, as for ExoPlayer's own retry).
        val stream = TsTestStream()
        val upstream = FakeUpstream(
            Script(stream.frames(0, 60), Ending.QUIET),
            Script(TsTestStream(ccStart = 5).frames(40, 130), Ending.END, leadMs = 900),
        )
        val rejoin = session(upstream, pacing = LiveRejoin.Pacing(quietMs = 200, checkEveryMs = 20))
        val out = ByteArrayOutputStream()
        val error = readAll(rejoin, out)
        rejoin.release()
        assertEquals(null, error)
        assertEquals("one rejoin, then the refused one after the end", 2, upstream.reopens.get())
        assertEquals("only the quiet first connection was cancelled", 1, upstream.cancels.get())
        assertStream(out.toByteArray(), stream, (0..129).toList())
    }

    @Test fun aBusyLineWhileRejoiningHandsTheDropToExoPlayer() {
        // Right after a drop the provider may still count the old connection. Its busy answer must not end playback
        // (SlotBusyException is final for the player): ExoPlayer gets the drop itself, as in 1.6.2, and retries later.
        val upstream = FakeUpstream(Script(TsTestStream().frames(0, 60), Ending.QUIET), Script(ByteArray(0), Ending.END, failOpen = Busy()))
        val rejoin = session(upstream)
        val error = readAll(rejoin, ByteArrayOutputStream())
        rejoin.release()
        assertNotNull(error)
        assertTrue(error.toString(), error!!.message!!.startsWith("No data from the provider"))
        assertTrue("no busy answer in the cause chain", generateSequence<Throwable>(error) { it.cause }.none { it is Busy })
        assertEquals(1, upstream.reopens.get())
        assertTrue(logs.toString(), logs.any { it.contains("reopen refused") })
    }

    @Test fun aResendThatDoesNotCatchUpInTimeIsRefused() {
        // A connection on the same clock 15 s behind, delivered in real time (a lagging edge, or a restart that landed
        // within the resend window): it would drop for 15 s while the picture freezes. It is refused within
        // placeMs, and ExoPlayer starts over as before. The same resend arriving as a burst splices.
        for (burst in listOf(false, true)) {
            logs.clear()
            val clock = AtomicLong(1_000_000)
            val first = TsTestStream()
            val a = first.frames(0, 400)
            val upstream = FakeUpstream(
                Script(a.copyOf(first.videoStart(a, 390) + 300), Ending.ERROR),
                Script(TsTestStream(ccStart = 4).frames(15, 500), Ending.END, bytesPerMs = if (burst) 100_000.0 else 40.0),
                clock = clock,
            )
            val rejoin = session(upstream, clock = { clock.get() }, pacing = LiveRejoin.Pacing(delaysMs = listOf(0L)),
                sleeper = { clock.addAndGet(it) })
            val out = ByteArrayOutputStream()
            val error = readAll(rejoin, out)
            rejoin.release()
            if (burst) {
                assertEquals(logs.toString(), null, error)
                assertStream(out.toByteArray(), first, (0..499).toList())
            } else {
                assertTrue(error.toString(), error is SpliceException)
                assertTrue(error!!.message!!, error.message!!.contains("not placed within"))
                assertEquals("nothing of it went out", a.copyOf(first.videoStart(a, 390) + 300).size / 188 * 188, out.size())
            }
        }
    }

    @Test fun aRestartedClockIsRefusedAtOnce() {
        val clock = AtomicLong(1_000_000)
        val first = TsTestStream(base = 126_000L + 30 * TsSplicer.TICKS)
        val a = first.frames(0, 40)
        val upstream = FakeUpstream(
            Script(a.copyOf(first.videoStart(a, 30) + 300), Ending.ERROR),
            Script(TsTestStream(base = 126_000L, ccStart = 4).frames(0, 800), Ending.END, bytesPerMs = 40.0),
            clock = clock,
        )
        val rejoin = session(upstream, clock = { clock.get() }, pacing = LiveRejoin.Pacing(delaysMs = listOf(0L)),
            sleeper = { clock.addAndGet(it) })
        val started = clock.get()
        val error = readAll(rejoin, ByteArrayOutputStream())
        rejoin.release()
        assertTrue(error.toString(), error is SpliceException)
        assertTrue("refused after ${clock.get() - started}ms of it", clock.get() - started < 1_000)
    }
}

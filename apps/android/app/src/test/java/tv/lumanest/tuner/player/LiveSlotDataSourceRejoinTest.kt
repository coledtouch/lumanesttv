package tv.lumanest.tuner.player

import android.net.Uri
import androidx.annotation.OptIn
import androidx.media3.common.C
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DataSpec
import androidx.media3.datasource.okhttp.OkHttpDataSource
import okhttp3.OkHttpClient
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.shadows.ShadowLog
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.net.ServerSocket
import java.net.Socket
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicLongArray
import kotlin.concurrent.thread

/**
 * The whole path on a real socket: OkHttpDataSource through TuneDeadline, a provider connection that stays open but goes
 * quiet, the watchdog cancelling that OkHttp call, the rejoin through LiveSlotDataSource's own open, and the splice.
 */
@OptIn(UnstableApi::class)
@RunWith(RobolectricTestRunner::class)
class LiveSlotDataSourceRejoinTest {
    @Test fun quietProviderConnectionIsCancelledAndRejoined() {
        val first = TsTestStream().frames(0, 60)
        val second = TsTestStream(ccStart = 6).frames(40, 120)
        val expected = ByteArrayOutputStream().also { o ->
            val splicer = TsSplicer()
            val buffer = ByteArray(1 shl 20)
            splicer.push(first, 0, first.size)
            splicer.connect()
            o.write(buffer, 0, splicer.read(buffer, 0, buffer.size))
            splicer.push(second, 0, second.size)
            o.write(buffer, 0, splicer.read(buffer, 0, buffer.size))
        }.toByteArray()

        val server = ServerSocket(0)
        val accepted = AtomicLongArray(3)
        val closed = AtomicLongArray(3)
        val bothClosed = CountDownLatch(2)
        val sockets = ArrayList<Socket>()
        val serving = thread(isDaemon = true) {
            try {
                for (i in 0 until 3) {
                    val socket = server.accept()
                    synchronized(sockets) { sockets += socket }
                    accepted.set(i, System.nanoTime())
                    thread(isDaemon = true) {
                        socket.use {
                            val input = it.getInputStream()
                            val headers = StringBuilder()
                            while (!headers.endsWith("\r\n\r\n")) headers.append(input.read().toChar())
                            it.getOutputStream().apply {
                                write("HTTP/1.1 200 OK\r\nContent-Type: video/mp2t\r\nConnection: close\r\n\r\n".toByteArray())
                                write(if (i == 0) first else second)
                                flush()
                            }
                            // Then the provider goes quiet with the connection open, until the player closes it.
                            try { while (input.read() >= 0) Unit } catch (_: Exception) {}
                            closed.set(i, System.nanoTime())
                            bothClosed.countDown()
                        }
                    }
                }
            } catch (_: Exception) {
            }
        }

        val deadlines = TuneDeadline(OkHttpClient())
        val source = LiveSlotDataSource(
            OkHttpDataSource.Factory(deadlines).createDataSource(), guard = { true }, live = { true }, deadlines = deadlines,
            clock = { System.nanoTime() / 1_000_000 }, pacing = LiveRejoin.Pacing(quietMs = 500, checkEveryMs = 25),
        )
        val out = ByteArrayOutputStream()
        try {
            val length = source.open(DataSpec(Uri.parse("http://127.0.0.1:${server.localPort}/live/user/pass/27193.ts")))
            assertEquals(C.LENGTH_UNSET.toLong(), length)
            val buffer = ByteArray(16 * 1024)
            while (out.size() < expected.size) {
                val n = source.read(buffer, 0, minOf(buffer.size, expected.size - out.size()))
                assertTrue("read returned $n", n > 0)
                out.write(buffer, 0, n)
            }
        } finally {
            source.close()
        }
        assertTrue("the player closed both provider connections", bothClosed.await(5, TimeUnit.SECONDS))
        server.close()
        serving.join(2_000)

        assertArrayEquals(expected, out.toByteArray())
        assertEquals("exactly one rejoin", 0L, accepted.get(2))
        val quietMs = (closed.get(0) - accepted.get(0)) / 1_000_000
        assertTrue("first connection cancelled after ${quietMs}ms", quietMs in 500..5_000)
        assertTrue("one connection at a time", closed.get(0) <= accepted.get(1) + 100_000_000L)
        val logs = ShadowLog.getLogsForTag("TunerPlayback").map { it.msg }
        assertTrue(logs.toString(), logs.any { Regex("rejoin #1 after \\d+ms quiet.*").matches(it) })
        assertTrue(logs.toString(), logs.any { it.startsWith("spliced: dropped") })
        synchronized(sockets) { sockets.forEach { runCatching { it.close() } } }
    }

    /**
     * The provider still counts the connection that just dropped and answers the rejoin with its busy clip until the
     * whole wait runs out. That must not end playback ("another device is using your connection"): ExoPlayer gets the
     * drop itself, with no SlotBusyException in it, so RetryPolicy defers its retry as in 1.6.2; that retry's own open
     * waits for the line afresh, and only if it is still busy does the player show the busy error.
     */
    @Test fun busyLineWhileRejoiningIsNotTheFinalAnswer() {
        val first = TsTestStream().frames(0, 60)
        val server = ServerSocket(0)
        val accepted = AtomicInteger()
        val serving = thread(isDaemon = true) {
            try {
                while (true) {
                    val socket = server.accept()
                    val i = accepted.getAndIncrement()
                    thread(isDaemon = true) {
                        socket.use {
                            val input = it.getInputStream()
                            val headers = StringBuilder()
                            while (!headers.endsWith("\r\n\r\n")) headers.append(input.read().toChar())
                            val output = it.getOutputStream()
                            if (i == 0) {
                                output.write("HTTP/1.1 200 OK\r\nContent-Type: video/mp2t\r\nConnection: close\r\n\r\n".toByteArray())
                                output.write(first)
                                output.flush()
                                try { while (input.read() >= 0) Unit } catch (_: Exception) {}
                            } else {
                                // The provider's "connection limit reached" clip: short and finite.
                                output.write("HTTP/1.1 200 OK\r\nContent-Type: video/mp2t\r\nContent-Length: 1000\r\nConnection: close\r\n\r\n".toByteArray())
                                output.write(ByteArray(1000))
                                output.flush()
                            }
                        }
                    }
                }
            } catch (_: Exception) {
            }
        }
        val deadlines = TuneDeadline(OkHttpClient())
        // A clock ten times faster than real time, so the provider's 9 s busy wait takes about a second here.
        val source = LiveSlotDataSource(
            OkHttpDataSource.Factory(deadlines).createDataSource(), guard = { true }, live = { true }, deadlines = deadlines,
            clock = { System.nanoTime() / 100_000 }, pacing = LiveRejoin.Pacing(quietMs = 2_000, checkEveryMs = 25),
        )
        val spec = DataSpec(Uri.parse("http://127.0.0.1:${server.localPort}/live/user/pass/27193.ts"))
        try {
            assertEquals(C.LENGTH_UNSET.toLong(), source.open(spec))
            val buffer = ByteArray(16 * 1024)
            var read = 0
            var error: IOException? = null
            while (error == null) {
                try {
                    val n = source.read(buffer, 0, buffer.size)
                    assertTrue("read returned $n", n > 0)
                    read += n
                } catch (e: IOException) {
                    error = e
                }
            }
            assertEquals("the first connection reached the extractor whole", first.size, read)
            val failure = error
            assertTrue(failure.toString(), failure.message!!.startsWith("No data from the provider"))
            assertTrue("no SlotBusyException in $failure", generateSequence<Throwable>(failure) { it.cause }.none { it is SlotBusyException })
            assertTrue("the rejoin met the busy line", accepted.get() >= 2)
            source.close()
            // ExoPlayer's own retry: a fresh open, and the line still busy, ends as it did in 1.6.2.
            val retry = try { source.open(spec); null } catch (e: IOException) { e }
            assertTrue(retry.toString(), retry is SlotBusyException)
        } finally {
            source.close()
            server.close()
            serving.join(2_000)
        }
    }
}

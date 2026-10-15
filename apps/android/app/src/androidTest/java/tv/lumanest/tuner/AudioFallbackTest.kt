package tv.lumanest.tuner

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import tv.lumanest.tuner.player.PlayerHolder
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.net.ServerSocket
import java.util.concurrent.Executors

@RunWith(AndroidJUnit4::class)
@androidx.annotation.OptIn(androidx.media3.common.util.UnstableApi::class)
class AudioFallbackTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()

    @Test fun unknownAndForeignAudioPlayAndBackgroundDoesNotRestartPlayback() {
        val movie = instrumentation.context.assets.open("audio-fixture.mp4").use { it.readBytes() }
        // Change only ISO-639 fields in our self-authored MP4, leaving the encoded video/audio intact.
        fun tagged(language: String): ByteArray = movie.copyOf().apply {
            val code = ((language[0].code - 96) shl 10) or ((language[1].code - 96) shl 5) or (language[2].code - 96)
            for (i in 0 until size - 32) if (this[i] == 'm'.code.toByte() && this[i+1] == 'd'.code.toByte() && this[i+2] == 'h'.code.toByte() && this[i+3] == 'd'.code.toByte()) {
                val offset = i + if (this[i+4].toInt() == 1) 36 else 24
                this[offset] = (code shr 8).toByte(); this[offset+1] = code.toByte()
            }
        }
        val server = ServerSocket(0)
        val executor = Executors.newCachedThreadPool()
        executor.submit {
            while (!server.isClosed) runCatching {
                val socket = server.accept()
                executor.submit {
                    socket.use {
                        val input = it.getInputStream().bufferedReader()
                        val request = input.readLine().orEmpty()
                        var range: String? = null
                        while (true) {
                            val header = input.readLine() ?: break
                            if (header.isEmpty()) break
                            if (header.startsWith("Range:", true)) range = header.substringAfter(':').trim()
                        }
                        if (request.contains("/missing")) {
                            it.getOutputStream().apply { write("HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".toByteArray()); flush() }
                            return@use
                        }
                        val data = tagged(if (request.contains("/foreign")) "fra" else "und")
                        val start = range?.substringAfter("bytes=")?.substringBefore('-')?.toIntOrNull() ?: 0
                        val end = (range?.substringAfter('-')?.toIntOrNull() ?: data.lastIndex).coerceAtMost(data.lastIndex)
                        val partial = range != null
                        val headers = "HTTP/1.1 ${if (partial) "206 Partial Content" else "200 OK"}\r\nContent-Type: video/mp4\r\nContent-Length: ${end-start+1}\r\nAccept-Ranges: bytes\r\n" +
                            (if (partial) "Content-Range: bytes $start-$end/${data.size}\r\n" else "") + "Connection: close\r\n\r\n"
                        it.getOutputStream().apply { write(headers.toByteArray()); write(data, start, end-start+1); flush() }
                    }
                }
            }
        }
        fun waitFor(condition: () -> Boolean): Boolean {
            val deadline = System.currentTimeMillis() + 20_000
            while (System.currentTimeMillis() < deadline) {
                var done = false
                instrumentation.runOnMainSync { done = condition() }
                if (done) return true
                Thread.sleep(50)
            }
            return false
        }
        val url = "http://127.0.0.1:${server.localPort}/untagged.mp4"
        try {
            instrumentation.runOnMainSync { PlayerHolder.onAppForeground(); PlayerHolder.play(url, live = false) }
            assertTrue("Untagged audio did not start", waitFor { PlayerHolder.player.isPlaying })
            instrumentation.runOnMainSync { assertNull(PlayerHolder.error.value); PlayerHolder.stop(); PlayerHolder.play("http://127.0.0.1:${server.localPort}/foreign.mp4", live = false) }
            assertTrue("Foreign audio did not start", waitFor { PlayerHolder.player.isPlaying })
            instrumentation.runOnMainSync { assertNull(PlayerHolder.error.value); PlayerHolder.onAppBackground() }
            Thread.sleep(500)
            instrumentation.runOnMainSync { assertFalse(PlayerHolder.player.isPlaying); PlayerHolder.onAppForeground() }
            assertTrue("Playback did not resume on return", waitFor { PlayerHolder.player.isPlaying })
            instrumentation.runOnMainSync { PlayerHolder.player.pause(); PlayerHolder.onAppBackground(); PlayerHolder.onAppForeground() }
            Thread.sleep(500)
            instrumentation.runOnMainSync { assertFalse("User-paused playback must stay paused", PlayerHolder.player.isPlaying); PlayerHolder.stop() }
            instrumentation.runOnMainSync { PlayerHolder.play("http://127.0.0.1:${server.localPort}/missing.mp4", live = false, startMs = 2_000, backups = listOf(url)) }
            assertTrue("Missing primary upload did not fall back", waitFor { PlayerHolder.player.isPlaying })
            instrumentation.runOnMainSync { assertNull(PlayerHolder.error.value); assertTrue("Fallback lost requested seek", PlayerHolder.player.currentPosition >= 1_900) }
        } finally {
            instrumentation.runOnMainSync { PlayerHolder.stop(); PlayerHolder.onAppForeground() }
            server.close(); executor.shutdownNow()
        }
    }
}

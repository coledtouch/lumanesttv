package tv.lumanest.tuner

import android.content.Intent
import android.os.Bundle
import android.os.SystemClock
import android.view.WindowManager
import android.view.LayoutInflater
import android.view.TextureView
import android.widget.LinearLayout
import androidx.activity.ComponentActivity
import androidx.media3.common.C
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.ui.PlayerView
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import tv.lumanest.tuner.data.Channel
import tv.lumanest.tuner.player.PlayerHolder
import tv.lumanest.tuner.player.TwoChannelPlayer
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.io.Closeable
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors

/** Opt in with -e twoChannelCheck true on the debug APK. Uses only local, self-authored video. */
@RunWith(AndroidJUnit4::class)
@androidx.annotation.OptIn(androidx.media3.common.util.UnstableApi::class)
class TwoChannelPlaybackTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()

    @Test fun twoNativeVideosRenderSwitchAudioRecoverAndReleaseTheirConnections() {
        assumeTrue("Native two-channel checks require explicit opt-in",
            InstrumentationRegistry.getArguments().getString("twoChannelCheck") == "true")
        assumeTrue("Do not interrupt the user's existing playback", onMain {
            PlayerHolder.currentUrl == null && !TwoChannelPlayer.active.value
        })
        val fixture = instrumentation.context.assets.open("audio-fixture.mp4").use { it.readBytes() }
        FixtureServer(fixture).use { server ->
            // ComponentActivity is declared by the debug compose manifest and never loads playlists.
            val scenario = ActivityScenario.launch<ComponentActivity>(Intent(instrumentation.targetContext, ComponentActivity::class.java))
            val views = ArrayList<PlayerView>()
            try {
                scenario.onActivity { activity ->
                    activity.window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
                    val layout = LinearLayout(activity).apply { orientation = LinearLayout.HORIZONTAL }
                    repeat(2) {
                        val view = (LayoutInflater.from(activity).inflate(R.layout.player_texture, null, false) as PlayerView)
                            .apply { useController = false }
                        views += view
                        layout.addView(view, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.MATCH_PARENT, 1f))
                    }
                    activity.setContentView(layout)
                }
                val channels = listOf(
                    Channel("native-dual-one", 1, "Local game one", null, "fixture", null, null,
                        "${server.base}/missing.mp4", backups = listOf("${server.base}/one.mp4")),
                    Channel("native-dual-two", 2, "Local game two", null, "fixture", null, null, "${server.base}/two.mp4"),
                )
                onMain {
                    TwoChannelPlayer.init(instrumentation.targetContext)
                    PlayerHolder.onAppForeground()
                    PlayerHolder.play("${server.base}/single.mp4", live = false)
                    views[0].player = PlayerHolder.player
                    PlayerHolder.player.repeatMode = Player.REPEAT_MODE_ONE
                }
                waitFor("The ordinary local video did not start") { PlayerHolder.player.isPlaying }
                onMain {
                    PlayerHolder.setFullscreenPlayback(true)
                    // Configure the fixture while suspended, then retry before the first prepare.
                    // Retry intentionally does not count visits, so this test changes no viewing history.
                    TwoChannelPlayer.onAppBackground()
                    assertTrue(TwoChannelPlayer.play(0, channels[0]))
                    assertTrue(TwoChannelPlayer.play(1, channels[1]))
                    assertNull("Dual playback left a third stream active", PlayerHolder.currentUrl)
                    assertFalse(PlayerHolder.pipEligible)
                    TwoChannelPlayer.retry(0); TwoChannelPlayer.retry(1)
                    TwoChannelPlayer.onAppForeground()
                    attach(views)
                }
                waitFor("Both native videos did not render after the primary-source fallback") { bothRender() && views.all(::hasVisibleTextureFrame) }
                status("both-rendered")
                val players = onMain { listOf(requireNotNull(TwoChannelPlayer.player(0)), requireNotNull(TwoChannelPlayer.player(1))) }
                val initialPositions = onMain { players.map { it.currentPosition } }
                waitFor("Both independent clocks did not advance") {
                    players.indices.all { advanced(players[it], initialPositions[it]) >= 500 }
                }
                for (selected in listOf(1, 0, 1)) {
                    val itemIds = onMain { players.map { it.currentMediaItem?.mediaId } }
                    onMain { assertTrue(TwoChannelPlayer.selectAudio(selected)) }
                    waitFor("The selected soundtrack did not become the only enabled audio track") {
                        players[selected].volume == 1f && players[1 - selected].volume == 0f &&
                            !players[selected].trackSelectionParameters.disabledTrackTypes.contains(C.TRACK_TYPE_AUDIO) &&
                            players[1 - selected].trackSelectionParameters.disabledTrackTypes.contains(C.TRACK_TYPE_AUDIO) && bothRender()
                    }
                    onMain {
                        assertSame(players[0], TwoChannelPlayer.player(0)); assertSame(players[1], TwoChannelPlayer.player(1))
                        assertEquals("Audio switching reopened a media item", itemIds, players.map { it.currentMediaItem?.mediaId })
                    }
                }
                onMain {
                    assertFalse(TwoChannelPlayer.play(1, channels[0]))
                    assertSame(players[1], TwoChannelPlayer.player(1))
                    TwoChannelPlayer.onAppBackground()
                    assertNull(TwoChannelPlayer.player(0)); assertNull(TwoChannelPlayer.player(1))
                    assertTrue(TwoChannelPlayer.states.value.all { it.status == TwoChannelPlayer.Status.PAUSED })
                    assertTrue(TwoChannelPlayer.active.value)
                    views.forEach { it.player = null }
                }
                status("background-released")
                Thread.sleep(500)
                onMain { TwoChannelPlayer.onAppForeground(); attach(views) }
                waitFor("Both channels did not resume after background release") { bothRender() }
                onMain {
                    assertNotSame(players[0], TwoChannelPlayer.player(0)); assertNotSame(players[1], TwoChannelPlayer.player(1))
                    assertEquals(1, TwoChannelPlayer.audioSlot.value)
                    assertEquals(0f, requireNotNull(TwoChannelPlayer.player(0)).volume)
                    assertEquals(1f, requireNotNull(TwoChannelPlayer.player(1)).volume)
                    assertTrue(TwoChannelPlayer.play(1, channels[1].copy(key = "native-dual-failed",
                        url = "${server.base}/missing.mp4?slot=failed")))
                }
                waitFor("The missing channel did not release its failed player") {
                    TwoChannelPlayer.states.value[1].status == TwoChannelPlayer.Status.ERROR && TwoChannelPlayer.player(1) == null
                }
                onMain {
                    assertTrue(TwoChannelPlayer.selectAudio(0))
                    assertFalse("Choosing an unavailable channel muted the healthy channel", TwoChannelPlayer.selectAudio(1))
                    assertEquals(0, TwoChannelPlayer.audioSlot.value)
                    assertEquals(1f, requireNotNull(TwoChannelPlayer.player(0)).volume)
                }
                waitFor("The failed channel interrupted the healthy channel") { requireNotNull(TwoChannelPlayer.player(0)).isPlaying }
                status("failed-slot-isolated")
                onMain {
                    PlayerHolder.play("${server.base}/return.mp4", live = false)
                    assertFalse(TwoChannelPlayer.active.value)
                    assertNull(TwoChannelPlayer.player(0)); assertNull(TwoChannelPlayer.player(1))
                    views[1].player = null
                    views[0].player = PlayerHolder.player
                    PlayerHolder.player.repeatMode = Player.REPEAT_MODE_ONE
                }
                waitFor("Ordinary playback could not reclaim the player after dual view") { PlayerHolder.player.isPlaying }
                status("single-restored")
            } finally {
                onMain {
                    views.forEach { it.player = null }
                    TwoChannelPlayer.stop()
                    TwoChannelPlayer.onAppForeground()
                    PlayerHolder.player.repeatMode = Player.REPEAT_MODE_OFF
                    PlayerHolder.setFullscreenPlayback(false)
                    PlayerHolder.stop()
                }
                scenario.close()
            }
        }
    }

    private fun attach(views: List<PlayerView>) {
        views.forEachIndexed { slot, view ->
            view.player = TwoChannelPlayer.player(slot)
            view.player?.repeatMode = Player.REPEAT_MODE_ONE
        }
    }

    private fun bothRender() = (0..1).all { slot ->
        val player = TwoChannelPlayer.player(slot)
        player != null && player.isPlaying && (player.videoDecoderCounters?.renderedOutputBufferCount ?: 0) > 0 &&
            TwoChannelPlayer.states.value[slot].error == null
    }

    /** Production Multi View uses texture surfaces so a second picture can overlap the first. */
    private fun hasVisibleTextureFrame(view: PlayerView): Boolean {
        val texture = view.videoSurfaceView as? TextureView ?: return false
        if (!texture.isAvailable) return false
        val frame = texture.getBitmap(32, 18) ?: return false
        return try {
            (0 until frame.width step 4).any { x ->
                (0 until frame.height step 3).any { y -> (frame.getPixel(x, y) and 0x00ffffff) != 0 }
            }
        } finally { frame.recycle() }
    }

    private fun advanced(player: ExoPlayer, previous: Long): Long =
        if (player.currentPosition >= previous) player.currentPosition - previous else player.duration - previous + player.currentPosition

    private fun waitFor(message: String, condition: () -> Boolean) {
        val deadline = SystemClock.elapsedRealtime() + 30_000
        while (SystemClock.elapsedRealtime() < deadline) {
            if (onMain(condition)) return
            Thread.sleep(50)
        }
        fail(message + ": " + TwoChannelPlayer.states.value.joinToString { "${it.status}/${it.error.orEmpty()}" })
    }

    private fun status(stage: String) {
        instrumentation.sendStatus(0, Bundle().apply { putString("twoChannelStage", stage) })
    }

    private fun <T> onMain(block: () -> T): T {
        var result: T? = null
        instrumentation.runOnMainSync { result = block() }
        @Suppress("UNCHECKED_CAST") return result as T
    }

    private class FixtureServer(private val data: ByteArray) : Closeable {
        private val server = ServerSocket(0, 8, InetAddress.getByName("127.0.0.1"))
        private val executor = Executors.newCachedThreadPool()
        private val sockets = ConcurrentHashMap.newKeySet<Socket>()
        val base = "http://127.0.0.1:${server.localPort}"

        init {
            executor.submit {
                while (!server.isClosed) runCatching {
                    val socket = server.accept()
                    sockets += socket
                    executor.submit {
                        try {
                            socket.use { client ->
                                client.soTimeout = 5_000
                                val input = client.getInputStream().bufferedReader()
                                val request = input.readLine().orEmpty()
                                var range: String? = null
                                while (true) {
                                    val header = input.readLine() ?: break
                                    if (header.isEmpty()) break
                                    if (header.startsWith("Range:", true)) range = header.substringAfter(':').trim()
                                }
                                val output = client.getOutputStream()
                                if (request.contains("/missing.mp4")) {
                                    output.write("HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".toByteArray())
                                } else {
                                    val start = range?.substringAfter("bytes=")?.substringBefore('-')?.toIntOrNull() ?: 0
                                    val end = (range?.substringAfter('-')?.toIntOrNull() ?: data.lastIndex).coerceAtMost(data.lastIndex)
                                    if (start !in data.indices || end < start) {
                                        output.write("HTTP/1.1 416 Range Not Satisfiable\r\nContent-Range: bytes */${data.size}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".toByteArray())
                                    } else {
                                        val partial = start > 0
                                        // Close-delimited live data bypasses the finite provider-notice guard.
                                        val headers = "HTTP/1.1 ${if (partial) "206 Partial Content" else "200 OK"}\r\nContent-Type: video/mp4\r\nAccept-Ranges: bytes\r\n" +
                                            (if (partial) "Content-Length: ${end - start + 1}\r\nContent-Range: bytes $start-$end/${data.size}\r\n" else "") + "Connection: close\r\n\r\n"
                                        output.write(headers.toByteArray())
                                        if (!request.startsWith("HEAD ")) output.write(data, start, end - start + 1)
                                    }
                                }
                                output.flush()
                            }
                        } finally { sockets -= socket }
                    }
                }
            }
        }

        override fun close() {
            server.close()
            sockets.forEach { runCatching { it.close() } }
            executor.shutdownNow()
        }
    }
}

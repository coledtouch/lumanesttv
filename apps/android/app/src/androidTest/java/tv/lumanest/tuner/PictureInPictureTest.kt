package tv.lumanest.tuner

import android.accessibilityservice.AccessibilityServiceInfo
import android.annotation.SuppressLint
import android.app.PendingIntent
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.SystemClock
import android.view.View
import android.view.ViewGroup
import android.view.accessibility.AccessibilityNodeInfo
import androidx.activity.compose.setContent
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.ui.PlayerView
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import tv.lumanest.tuner.data.PlayRequest
import tv.lumanest.tuner.player.PlayerHolder
import tv.lumanest.tuner.ui.PlayerScreen
import tv.lumanest.tuner.ui.TunerTheme
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.io.Closeable
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors

/** Opt in with -e pictureInPictureCheck true on a device with native PiP support. */
@RunWith(AndroidJUnit4::class)
@androidx.annotation.OptIn(androidx.media3.common.util.UnstableApi::class)
class PictureInPictureTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()

    @Test
    @SuppressLint("NewApi") // The assumptions below gate all native PiP APIs.
    fun nativePictureInPictureKeepsVideoAndRestoresPlayerControls() {
        assumeTrue("Native PiP checks require explicit opt-in",
            InstrumentationRegistry.getArguments().getString("pictureInPictureCheck") == "true")
        assumeTrue("Picture-in-picture requires Android 8 or later", Build.VERSION.SDK_INT >= Build.VERSION_CODES.O)
        assumeTrue("This device does not support native picture-in-picture",
            instrumentation.targetContext.packageManager.hasSystemFeature(PackageManager.FEATURE_PICTURE_IN_PICTURE))

        val fixture = instrumentation.context.assets.open("audio-fixture.mp4").use { it.readBytes() }
        val automation = instrumentation.uiAutomation
        val previousAccessibilityFlags = automation.serviceInfo.flags
        automation.serviceInfo = automation.serviceInfo.apply {
            flags = flags or AccessibilityServiceInfo.FLAG_RETRIEVE_INTERACTIVE_WINDOWS
        }
        var scenario: ActivityScenario<MainActivity>? = null
        var fixturePlayer: ExoPlayer? = null
        var previousRepeatMode = Player.REPEAT_MODE_OFF
        FixtureServer(fixture).use { server ->
            try {
                val title = "Native PiP fixture"
                val request = PlayRequest.Vod(
                    resumeId = "native-pip-fixture", title = title, subtitle = "Local playback check",
                    image = null, url = server.url, startMs = 0,
                )
                val launched = ActivityScenario.launch<MainActivity>(
                    Intent(instrumentation.targetContext, MainActivity::class.java),
                )
                scenario = launched
                var fixtureActivity: MainActivity? = null
                launched.onActivity { activity ->
                    fixtureActivity = activity
                    PlayerHolder.stop()
                    PlayerHolder.onAppForeground()
                    fixturePlayer = PlayerHolder.player.also { player ->
                        previousRepeatMode = player.repeatMode
                        // This self-authored fixture lasts 12 seconds. Looping avoids end-of-video
                        // navigation and keeps its position below the saved-progress threshold.
                        player.repeatMode = Player.REPEAT_MODE_ONE
                    }
                    activity.setContent {
                        TunerTheme {
                            PlayerScreen(request) { PlayerHolder.stop(); activity.finish() }
                        }
                    }
                }
                val activity = requireNotNull(fixtureActivity)
                val player = requireNotNull(fixturePlayer)
                waitUntil("The local video did not start rendering") {
                    onMain {
                        player.isPlaying && (player.videoDecoderCounters?.renderedOutputBufferCount ?: 0) > 0 &&
                            findPlayerView(activity.window.decorView)?.videoSurfaceView?.isAttachedToWindow == true
                    }
                }
                waitUntil("The full-screen player did not enable native PiP") { PlayerHolder.pipSupported.value }
                waitUntil("The full-screen player controls were not shown") { hasVisibleText(title) }
                val playerView = onMain { requireNotNull(findPlayerView(activity.window.decorView)) }
                val videoSurface = onMain { requireNotNull(playerView.videoSurfaceView) }
                val beforePiP = onMain { player.currentPosition }

                onMain {
                    assertTrue("The native PiP request was rejected", activity.enterTunerPictureInPicture())
                    assertTrue("Player overlays were not hidden for the PiP transition", PlayerHolder.pipVideoOnly.value)
                }
                waitUntil("The activity never entered the native PiP window") {
                    onMain { activity.isInPictureInPictureMode && PlayerHolder.inPictureInPicture.value }
                }
                waitUntil("Video stopped advancing in the native PiP window") {
                    onMain { player.isPlaying && advancedPosition(player, beforePiP) >= 750 }
                }
                onMain {
                    assertTrue("PiP should contain only the video", PlayerHolder.pipVideoOnly.value)
                    assertSame("PiP replaced the shared player", player, PlayerHolder.player)
                    assertSame("PiP recreated the PlayerView", playerView, findPlayerView(activity.window.decorView))
                    assertSame("PiP recreated the video surface", videoSurface, playerView.videoSurfaceView)
                    assertSame("The video surface lost its player", player, playerView.player)
                    assertTrue("The video surface was detached in PiP", videoSurface.isAttachedToWindow)
                    assertNull("Native PiP produced a playback error", PlayerHolder.error.value)
                }
                waitUntil("The player title stayed visible inside PiP") { !hasVisibleText(title) }

                // Reuse the same PendingIntent that Android's native PiP action sends.
                // FLAG_NO_CREATE proves production registered it rather than creating a test action.
                val nativeAction = requireNotNull(PendingIntent.getBroadcast(
                    instrumentation.targetContext, 1,
                    Intent("tv.lumanest.tuner.PIP_PLAY_PAUSE").setPackage(instrumentation.targetContext.packageName),
                    PendingIntent.FLAG_NO_CREATE or PendingIntent.FLAG_IMMUTABLE,
                ))
                nativeAction.send()
                waitUntil("The native PiP Pause action did not pause video") { onMain { !player.isPlaying && !player.playWhenReady } }
                val pausedPosition = onMain { player.currentPosition }
                Thread.sleep(750)
                onMain {
                    assertTrue("Paused PiP video kept advancing", kotlin.math.abs(player.currentPosition - pausedPosition) < 150)
                    assertTrue(activity.isInPictureInPictureMode)
                }
                nativeAction.send()
                waitUntil("The native PiP Play action did not resume video") {
                    onMain { player.isPlaying && advancedPosition(player, pausedPosition) >= 500 }
                }
                nativeAction.send()
                waitUntil("The second PiP Pause action did not pause before expansion") { onMain { !player.isPlaying && !player.playWhenReady } }

                val beforeReturn = onMain { player.currentPosition }
                instrumentation.targetContext.startActivity(
                    Intent(instrumentation.targetContext, MainActivity::class.java)
                        .addFlags(Intent.FLAG_ACTIVITY_REORDER_TO_FRONT or Intent.FLAG_ACTIVITY_NEW_TASK),
                )
                waitUntil("Returning to Tuner did not leave native PiP") {
                    onMain {
                        !activity.isInPictureInPictureMode && !PlayerHolder.inPictureInPicture.value &&
                            !PlayerHolder.pipVideoOnly.value
                    }
                }
                waitUntil("The title and playback options did not return after PiP") {
                    hasVisibleText(title) && hasVisibleText("Audio") && hasVisibleText("Subtitles")
                }
                onMain {
                    assertFalse("Expanding paused PiP restarted video", player.isPlaying)
                    assertFalse("Expanding paused PiP lost the viewer's pause", player.playWhenReady)
                    assertTrue("Expanding paused PiP changed playback position", kotlin.math.abs(player.currentPosition - beforeReturn) < 150)
                    assertSame("Returning from PiP replaced the shared player", player, PlayerHolder.player)
                    assertSame("Returning from PiP recreated the PlayerView", playerView, findPlayerView(activity.window.decorView))
                    assertSame("Returning from PiP recreated the video surface", videoSurface, playerView.videoSurfaceView)
                    assertSame("The restored video surface lost its player", player, playerView.player)
                    assertTrue("The restored video surface was detached", videoSurface.isAttachedToWindow)
                    assertNull("Returning from PiP produced a playback error", PlayerHolder.error.value)
                    player.play()
                }
                waitUntil("Video could not resume after expanding paused PiP") { onMain { player.isPlaying && advancedPosition(player, beforeReturn) >= 500 } }

                launched.close()
                scenario = null
                waitUntil("Closing Tuner left playback running") { onMain { !player.isPlaying && !player.playWhenReady } }
                onMain {
                    assertFalse("Closing Tuner retained native PiP state", PlayerHolder.inPictureInPicture.value)
                    assertFalse("Closing Tuner retained the video-only transition", PlayerHolder.pipVideoOnly.value)
                }
            } finally {
                scenario?.close()
                onMain {
                    fixturePlayer?.repeatMode = previousRepeatMode
                    PlayerHolder.stop()
                }
                automation.serviceInfo = automation.serviceInfo.apply { flags = previousAccessibilityFlags }
            }
        }
    }

    private fun findPlayerView(root: View): PlayerView? {
        if (root is PlayerView) return root
        if (root is ViewGroup) {
            for (index in 0 until root.childCount) findPlayerView(root.getChildAt(index))?.let { return it }
        }
        return null
    }

    private fun advancedPosition(player: ExoPlayer, previous: Long): Long {
        val position = player.currentPosition
        // The short fixture may loop during an OS window animation.
        return if (position >= previous) position - previous else player.duration - previous + position
    }

    private fun hasVisibleText(text: String): Boolean {
        fun matches(node: AccessibilityNodeInfo?): Boolean {
            if (node == null) return false
            try {
                if (node.isVisibleToUser && node.text?.toString() == text) return true
                for (index in 0 until node.childCount) if (matches(node.getChild(index))) return true
                return false
            } finally {
                @Suppress("DEPRECATION")
                node.recycle()
            }
        }
        // PiP can coexist with a focused launcher window, so inspect every interactive window.
        return instrumentation.uiAutomation.windows.any { window -> matches(window.root) }
    }

    private fun <T> onMain(action: () -> T): T {
        var result: Result<T>? = null
        instrumentation.runOnMainSync { result = runCatching(action) }
        return requireNotNull(result).getOrThrow()
    }

    private fun waitUntil(message: String, timeoutMs: Long = 20_000, condition: () -> Boolean) {
        val deadline = SystemClock.elapsedRealtime() + timeoutMs
        while (SystemClock.elapsedRealtime() < deadline) {
            if (condition()) return
            Thread.sleep(50)
        }
        assertTrue(message, condition())
    }

    private class FixtureServer(private val data: ByteArray) : Closeable {
        private val server = ServerSocket(0, 8, InetAddress.getByName("127.0.0.1"))
        private val executor = Executors.newCachedThreadPool()
        private val sockets = ConcurrentHashMap.newKeySet<Socket>()
        val url = "http://127.0.0.1:${server.localPort}/audio-fixture.mp4"

        init {
            executor.submit {
                while (!server.isClosed) {
                    val socket = runCatching { server.accept() }.getOrNull() ?: break
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
                                    if (header.startsWith("Range:", ignoreCase = true)) range = header.substringAfter(':').trim()
                                }
                                val start = range?.substringAfter("bytes=")?.substringBefore('-')?.toIntOrNull() ?: 0
                                val end = (range?.substringAfter('-')?.toIntOrNull() ?: data.lastIndex).coerceAtMost(data.lastIndex)
                                val output = client.getOutputStream()
                                if (start !in data.indices || end < start) {
                                    output.write("HTTP/1.1 416 Range Not Satisfiable\r\nContent-Range: bytes */${data.size}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".toByteArray())
                                } else {
                                    val partial = range != null
                                    val headers = "HTTP/1.1 ${if (partial) "206 Partial Content" else "200 OK"}\r\n" +
                                        "Content-Type: video/mp4\r\nContent-Length: ${end - start + 1}\r\nAccept-Ranges: bytes\r\n" +
                                        (if (partial) "Content-Range: bytes $start-$end/${data.size}\r\n" else "") + "Connection: close\r\n\r\n"
                                    output.write(headers.toByteArray())
                                    if (!request.startsWith("HEAD ")) output.write(data, start, end - start + 1)
                                }
                                output.flush()
                            }
                        } finally {
                            sockets -= socket
                        }
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

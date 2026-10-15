package tv.lumanest.tuner

import android.accessibilityservice.AccessibilityServiceInfo
import android.content.Context
import android.content.Intent
import android.os.PowerManager
import android.os.SystemClock
import android.view.KeyEvent
import android.view.WindowManager
import android.view.accessibility.AccessibilityNodeInfo
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.SideEffect
import androidx.compose.ui.ExperimentalComposeUiApi
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.InputMode
import androidx.compose.ui.platform.LocalInputModeManager
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.testTagsAsResourceId
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import tv.lumanest.tuner.data.Category
import tv.lumanest.tuner.data.Channel
import tv.lumanest.tuner.data.LoadStatus
import tv.lumanest.tuner.data.PlayRequest
import tv.lumanest.tuner.data.Program
import tv.lumanest.tuner.data.Repo
import tv.lumanest.tuner.player.PlayerHolder
import tv.lumanest.tuner.ui.AppState
import tv.lumanest.tuner.ui.GuideScreen
import tv.lumanest.tuner.ui.Palette
import tv.lumanest.tuner.ui.PlayerScreen
import tv.lumanest.tuner.ui.Screen
import tv.lumanest.tuner.ui.TunerTheme
import org.junit.Assert.assertEquals
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
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors

/** Opt in on the debug APK with -e guideRemoteCheck true. No provider requests or playlist edits. */
@RunWith(AndroidJUnit4::class)
@OptIn(ExperimentalComposeUiApi::class)
@androidx.annotation.OptIn(androidx.media3.common.util.UnstableApi::class)
class GuideRemoteTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private var failureDetails: () -> String = { "Fixture diagnostics were not initialized" }

    @Test fun remoteBrowsingKeepsTheWatchedStreamUntilExplicitOk() {
        assumeTrue("Native guide checks require explicit opt-in",
            InstrumentationRegistry.getArguments().getString("guideRemoteCheck") == "true")
        assumeTrue("Do not interrupt an existing stream or catalog load", onMain {
            PlayerHolder.currentUrl == null &&
                listOf(Repo.liveStatus.value, Repo.vodStatus.value, Repo.seriesStatus.value, Repo.epgStatus.value)
                    .none { it is LoadStatus.Loading }
        })
        val saved = onMain { SavedState() }
        val fixture = instrumentation.context.assets.open("audio-fixture.mp4").use { it.readBytes() }
        val fixtureKey = "native-guide-${UUID.randomUUID()}"
        var scenario: ActivityScenario<ComponentActivity>? = null
        var fixturePlayer: ExoPlayer? = null
        var previousRepeatMode = Player.REPEAT_MODE_OFF
        val fixtureKeys = ArrayList<String>()
        FixtureServer(fixture).use { server ->
            try {
                val channels = (0 until 12).map { index ->
                    Channel("$fixtureKey:$index", 100 + index, "Local guide channel $index", null,
                        "fixture", null, null, "${server.url}?channel=$index")
                }
                fixtureKeys += channels.map { it.key }
                val watched = channels[0]
                val state = AppState().apply { guide.initialized = true }
                onMain {
                    val automation = instrumentation.uiAutomation
                    automation.serviceInfo = automation.serviceInfo.apply {
                        flags = flags or AccessibilityServiceInfo.FLAG_REPORT_VIEW_IDS
                    }
                    Repo.channels.value = channels
                    Repo.liveCategories.value = listOf(Category("fixture", "Local fixture"))
                    Repo.trending.value = emptyList()
                    Repo.liveStatus.value = LoadStatus.Ready
                    Repo.prefs.guidePreview = true
                    Repo.prefs.lastChannelKey = watched.key
                    val now = System.currentTimeMillis()
                    Repo.putPrograms(channels.mapIndexed { index, channel -> channel.key to listOf(
                        Program(now - 30 * 60_000, now + 30 * 60_000, "Device current program $index"),
                        Program(now + 30 * 60_000, now + 90 * 60_000, "Device next program $index"),
                    ) }.toMap())
                    PlayerHolder.onAppForeground()
                    fixturePlayer = PlayerHolder.player.also { player ->
                        previousRepeatMode = player.repeatMode
                        player.repeatMode = Player.REPEAT_MODE_ONE
                    }
                    PlayerHolder.play(watched.url, live = true, key = watched.key)
                }

                // The debug compose manifest already declares this activity. Unlike MainActivity,
                // it never runs App's playlist loader or changes the user's navigation state.
                val launched = ActivityScenario.launch<ComponentActivity>(
                    Intent(instrumentation.targetContext, ComponentActivity::class.java),
                )
                scenario = launched
                var fixtureActivity: ComponentActivity? = null
                launched.onActivity { activity ->
                    fixtureActivity = activity
                    activity.window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
                    activity.setContent {
                        val input = LocalInputModeManager.current
                        SideEffect { input.requestInputMode(InputMode.Keyboard) }
                        TunerTheme {
                            Box(Modifier.fillMaxSize().background(Palette.bg).semantics { testTagsAsResourceId = true }) {
                                when (val screen = state.top) {
                                    Screen.Home -> GuideScreen(state)
                                    is Screen.Player -> PlayerScreen(screen.request) { last ->
                                        last?.let(state.guide::focusChannel)
                                        state.pop()
                                    }
                                    else -> error("Unexpected fixture destination")
                                }
                            }
                        }
                    }
                }
                val player = requireNotNull(fixturePlayer)
                val activity = requireNotNull(fixtureActivity)
                failureDetails = { diagnostics(activity, player, state) }
                waitUntil("The local stream did not play and render video frames") {
                    onMain { player.isPlaying && (player.videoDecoderCounters?.renderedOutputBufferCount ?: 0) > 0 }
                }
                waitUntil("The preview did not identify the watched channel") { hasText("Watching  ${watched.number}  ${watched.name}") }
                waitUntil("The guide grid did not receive remote focus") { tagIsFocused("guide-grid") }
                assertWatching(player, watched)
                repeat(3) { press(KeyEvent.KEYCODE_DPAD_DOWN) }
                waitUntil("Down did not update the selected channel and its header") {
                    onMain { state.guide.row == 3 } && headerShows("Device current program 3")
                }
                press(KeyEvent.KEYCODE_DPAD_RIGHT)
                waitUntil("Right did not select the future program") { headerShows("Device next program 3") }
                // Rest longer than the old 650 ms preview delay to catch accidental auto-tuning.
                Thread.sleep(1_100)
                assertWatching(player, watched)

                press(KeyEvent.KEYCODE_CHANNEL_DOWN)
                waitUntil("Channel Down did not page through the guide") {
                    onMain { state.guide.row == 9 } && headerShows("Device next program 9")
                }
                Thread.sleep(1_100)
                assertWatching(player, watched)
                press(KeyEvent.KEYCODE_CHANNEL_UP)
                waitUntil("Channel Up did not return to the previous guide page") {
                    onMain { state.guide.row == 3 } && headerShows("Device next program 3")
                }
                press(KeyEvent.KEYCODE_BACK)
                waitUntil("Back did not return the selected row to its current program") {
                    onMain { state.guide.focusTime == 0L && state.guide.row == 3 } && headerShows("Device current program 3")
                }
                assertWatching(player, watched)

                press(KeyEvent.KEYCODE_DPAD_DOWN)
                waitUntil("The next channel did not become selected") {
                    onMain { state.guide.row == 4 } && headerShows("Device current program 4")
                }
                assertWatching(player, watched)
                press(KeyEvent.KEYCODE_DPAD_CENTER)
                waitUntil("Explicit OK did not tune the selected channel") {
                    onMain {
                        (state.top as? Screen.Player)?.request.let { it is PlayRequest.Live && it.channel.key == channels[4].key } &&
                            PlayerHolder.currentUrl == channels[4].url && player.isPlaying &&
                            (player.videoDecoderCounters?.renderedOutputBufferCount ?: 0) > 0
                    }
                }
                assertWatching(player, channels[4])
                press(KeyEvent.KEYCODE_BACK)
                waitUntil("Back from full screen did not preserve the watched channel in the guide") {
                    onMain { state.top == Screen.Home && state.guide.selectedChannelKey == channels[4].key } &&
                        hasText("Watching  ${channels[4].number}  ${channels[4].name}") && tagIsFocused("guide-grid")
                }
                assertWatching(player, channels[4])
                val navigationBefore = onMain { state.navigationRequest }
                press(KeyEvent.KEYCODE_BACK)
                waitUntil("Back from the current guide did not request top navigation") {
                    onMain { state.navigationRequest == navigationBefore + 1 }
                }
                assertWatching(player, channels[4])
            } finally {
                // Remove the fixture before restoring data so its live effects cannot overwrite it.
                try { scenario?.onActivity { it.setContent {} } }
                finally {
                    try {
                        onMain {
                            PlayerHolder.stop()
                            fixturePlayer?.repeatMode = previousRepeatMode
                            PlayerHolder.onAppForeground()
                        }
                    } finally {
                        try { scenario?.close() }
                        finally { onMain { saved.restore(fixtureKeys) } }
                    }
                }
            }
        }
    }

    private fun assertWatching(player: ExoPlayer, channel: Channel) = onMain {
        assertSame("Guide browsing replaced the shared player", player, PlayerHolder.player)
        assertEquals("Guide browsing changed the watched stream", channel.url, PlayerHolder.currentUrl)
        assertEquals("Guide browsing rewrote the last-watched preference", channel.key, Repo.prefs.lastChannelKey)
        assertTrue("The watched stream stopped during guide browsing", player.isPlaying)
        assertNull("Guide browsing produced a playback error", PlayerHolder.error.value)
    }

    private fun press(code: Int) { instrumentation.sendKeyDownUpSync(code) }

    private fun headerShows(title: String) = matchingNode {
        it.viewIdResourceName?.substringAfterLast('/') == "guide-program-info" && subtreeHasText(it, title)
    }

    private fun hasText(text: String) = matchingNode { it.isVisibleToUser && it.text?.toString() == text }
    private fun tagIsFocused(tag: String) = matchingNode { it.viewIdResourceName?.substringAfterLast('/') == tag && it.isFocused }

    private fun subtreeHasText(node: AccessibilityNodeInfo, text: String): Boolean {
        if (node.isVisibleToUser && node.text?.toString() == text) return true
        for (index in 0 until node.childCount) {
            val child = node.getChild(index) ?: continue
            try { if (subtreeHasText(child, text)) return true }
            finally { @Suppress("DEPRECATION") child.recycle() }
        }
        return false
    }

    private fun matchingNode(predicate: (AccessibilityNodeInfo) -> Boolean): Boolean {
        fun visit(node: AccessibilityNodeInfo?): Boolean {
            if (node == null) return false
            try {
                if (predicate(node)) return true
                for (index in 0 until node.childCount) if (visit(node.getChild(index))) return true
                return false
            } finally { @Suppress("DEPRECATION") node.recycle() }
        }
        return visit(instrumentation.uiAutomation.rootInActiveWindow)
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
        if (condition()) return
        val details = runCatching(failureDetails).getOrElse { "Diagnostics failed: ${it.javaClass.simpleName}: ${it.message}" }
        println("GuideRemoteTest: $message\n$details")
        throw AssertionError("$message\n$details")
    }

    private fun diagnostics(activity: ComponentActivity, player: ExoPlayer, state: AppState): String {
        val playback = onMain {
            val window = activity.window.decorView
            val power = activity.getSystemService(PowerManager::class.java)
            "interactive=${power?.isInteractive}, lifecycle=${activity.lifecycle.currentState}, " +
                "windowFocus=${window.hasWindowFocus()}, attached=${window.isAttachedToWindow}, size=${window.width}x${window.height}; " +
                "playerState=${player.playbackState}, playing=${player.isPlaying}, playWhenReady=${player.playWhenReady}, " +
                "renderedFrames=${player.videoDecoderCounters?.renderedOutputBufferCount}, videoSize=${player.videoSize.width}x${player.videoSize.height}, " +
                "position=${player.currentPosition}, currentUrl=${PlayerHolder.currentUrl}, error=${PlayerHolder.error.value}; " +
                "screen=${state.top.javaClass.simpleName}, row=${state.guide.row}, focusTime=${state.guide.focusTime}, " +
                "restoreFocus=${state.restoreFocus}, lastWatched=${Repo.prefs.lastChannelKey}"
        }
        var activePackage = "none"
        val nodes = ArrayList<String>()
        matchingNode { node ->
            if (activePackage == "none") activePackage = node.packageName?.toString() ?: "unknown"
            val text = node.text?.toString().orEmpty()
            if (nodes.size < 20 && (node.viewIdResourceName != null || node.isFocused ||
                    text.startsWith("Watching") || text.startsWith("Device "))) {
                // Include fixture text only; an unexpected launcher or lock screen can contain personal text.
                val fixtureText = text.takeIf { it.startsWith("Watching") || it.startsWith("Device ") }.orEmpty()
                nodes += "id=${node.viewIdResourceName}, focused=${node.isFocused}, visible=${node.isVisibleToUser}, text=$fixtureText"
            }
            false
        }
        return "$playback\nactivePackage=$activePackage, accessibilityFlags=${instrumentation.uiAutomation.serviceInfo.flags}; nodes=${nodes.joinToString(" | ")}"
    }

    private inner class SavedState {
        private val channels = Repo.channels.value
        private val categories = Repo.liveCategories.value
        private val trending = Repo.trending.value
        private val liveStatus = Repo.liveStatus.value
        private val sp = instrumentation.targetContext.getSharedPreferences("tuner", Context.MODE_PRIVATE)
        private val activeId = Repo.prefs.activeId.value
        private val lastKey = "lastChannel_$activeId"
        private val hadLast = sp.contains(lastKey)
        private val lastWatched = Repo.prefs.lastChannelKey
        private val historyKey = "watched_$activeId"
        private val hadHistory = sp.contains(historyKey)
        private val watchHistory = sp.getString(historyKey, null)
        private val hadPreview = sp.contains("guidePreview")
        private val preview = Repo.prefs.guidePreview
        private val accessibilityFlags = instrumentation.uiAutomation.serviceInfo.flags

        fun restore(fixtureKeys: List<String>) {
            // Restore persistent values first even if an in-memory fixture cleanup fails.
            Repo.prefs.lastChannelKey = lastWatched
            Repo.prefs.guidePreview = preview
            val edit = sp.edit()
            if (!hadLast) edit.remove(lastKey)
            if (!hadPreview) edit.remove("guidePreview")
            if (hadHistory) edit.putString(historyKey, watchHistory) else edit.remove(historyKey)
            assertTrue("Temporary guide preferences were not restored", edit.commit())
            // Reload the restored history for the same source without changing provider settings.
            Repo.prefs.setActive(activeId)
            val automation = instrumentation.uiAutomation
            automation.serviceInfo = automation.serviceInfo.apply { flags = accessibilityFlags }
            Repo.channels.value = channels
            Repo.liveCategories.value = categories
            Repo.trending.value = trending
            Repo.liveStatus.value = liveStatus
            // Repo's debug injection hook has no removal API. Remove only this test's unique keys;
            // existing program metadata, sources, favorite lists and caches are never modified.
            val field = Repo.javaClass.getDeclaredField("epg").apply { isAccessible = true }
            @Suppress("UNCHECKED_CAST")
            val guide = field.get(null) as MutableMap<String, List<Program>>
            fixtureKeys.forEach { guide.remove(it) }
            Repo.putPrograms(emptyMap())
        }
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
                                    val partial = range != null && start > 0
                                    // A real progressive live response has unknown length. A tiny finite
                                    // 200 response would correctly trigger the provider notice-clip guard.
                                    val headers = "HTTP/1.1 ${if (partial) "206 Partial Content" else "200 OK"}\r\n" +
                                        "Content-Type: video/mp4\r\nAccept-Ranges: bytes\r\n" +
                                        (if (partial) "Content-Length: ${end - start + 1}\r\nContent-Range: bytes $start-$end/${data.size}\r\n" else "") + "Connection: close\r\n\r\n"
                                    output.write(headers.toByteArray())
                                    if (!request.startsWith("HEAD ")) {
                                        if (partial) output.write(data, start, end - start + 1) else output.write(data)
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

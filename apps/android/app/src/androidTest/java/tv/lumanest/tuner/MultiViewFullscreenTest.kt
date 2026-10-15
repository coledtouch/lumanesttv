package tv.lumanest.tuner

import android.accessibilityservice.AccessibilityServiceInfo
import android.content.Context
import android.content.Intent
import android.graphics.Rect
import android.graphics.Bitmap
import android.graphics.SurfaceTexture
import android.os.Build
import android.os.Bundle
import android.os.SystemClock
import android.view.KeyEvent
import android.view.TextureView
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.view.accessibility.AccessibilityNodeInfo
import android.view.accessibility.AccessibilityWindowInfo
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
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
import androidx.media3.ui.PlayerView
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import tv.lumanest.tuner.data.Category
import tv.lumanest.tuner.data.Channel
import tv.lumanest.tuner.data.LoadStatus
import tv.lumanest.tuner.data.Repo
import tv.lumanest.tuner.player.PlayerHolder
import tv.lumanest.tuner.player.TwoChannelPlayer
import tv.lumanest.tuner.ui.AppState
import tv.lumanest.tuner.ui.HomeScreen
import tv.lumanest.tuner.ui.Tab
import tv.lumanest.tuner.ui.TunerTheme
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.io.Closeable
import java.io.File
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors

/** Opt in on the debug APK with -e multiViewFullscreenCheck true. All video is local. */
@RunWith(AndroidJUnit4::class)
@OptIn(ExperimentalComposeUiApi::class)
@androidx.annotation.OptIn(androidx.media3.common.util.UnstableApi::class)
class MultiViewFullscreenTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()

    @Test fun productionFullscreenKeepsBothTexturesWhileChromeAudioAndLayoutChange() {
        assumeTrue(InstrumentationRegistry.getArguments().getString("multiViewFullscreenCheck") == "true")
        assumeTrue("Do not interrupt existing playback or a provider refresh", onMain {
            PlayerHolder.currentUrl == null && !TwoChannelPlayer.active.value &&
                listOf(Repo.liveStatus.value, Repo.vodStatus.value, Repo.seriesStatus.value, Repo.epgStatus.value)
                    .none { it is LoadStatus.Loading }
        })
        val saved = onMain { SavedState() }
        val data = instrumentation.context.assets.open("audio-fixture.mp4").use { it.readBytes() }
        var scenario: ActivityScenario<ComponentActivity>? = null
        var activity: ComponentActivity? = null
        FixtureServer(data).use { server ->
            try {
                val prefix = "fullscreen-fixture-${UUID.randomUUID()}"
                val channels = (0..1).map { slot -> Channel("$prefix:$slot", slot + 1, "Local game ${slot + 1}",
                    null, "fixture", null, null, "${server.base}/game-$slot.mp4") }
                val state = onMain {
                    val automation = instrumentation.uiAutomation
                    automation.serviceInfo = automation.serviceInfo.apply {
                        flags = flags or AccessibilityServiceInfo.FLAG_REPORT_VIEW_IDS or AccessibilityServiceInfo.FLAG_RETRIEVE_INTERACTIVE_WINDOWS
                    }
                    Repo.channels.value = channels
                    Repo.liveCategories.value = listOf(Category("fixture", "Local fixture"))
                    Repo.trending.value = emptyList()
                    Repo.liveStatus.value = LoadStatus.Ready
                    Repo.prefs.guidePreview = false
                    AppState().apply {
                        tab = Tab.MULTIVIEW
                        multiView.firstKey = channels[0].key
                        multiView.secondKey = channels[1].key
                        multiView.pictureInPicture = true
                    }
                }
                val launched = ActivityScenario.launch<ComponentActivity>(Intent(instrumentation.targetContext, ComponentActivity::class.java))
                scenario = launched
                launched.onActivity { current ->
                    activity = current
                    current.window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON or WindowManager.LayoutParams.FLAG_FULLSCREEN)
                    @Suppress("DEPRECATION")
                    current.window.decorView.systemUiVisibility = View.SYSTEM_UI_FLAG_FULLSCREEN or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION or
                        View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY or View.SYSTEM_UI_FLAG_LAYOUT_STABLE or View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                    current.setContent {
                        val input = LocalInputModeManager.current
                        SideEffect { input.requestInputMode(InputMode.Keyboard) }
                        TunerTheme { Box(Modifier.fillMaxSize().semantics { testTagsAsResourceId = true }) { HomeScreen(state) } }
                    }
                }
                val window = requireNotNull(activity)
                waitUntil("The inactive production navigation did not mount") { hasNavigation("Live TV") }
                assertFalse(onMain { TwoChannelPlayer.active.value })
                // Starting after mounting Home catches any disposal as the navigation bar disappears.
                val players = onMain {
                    TwoChannelPlayer.init(window)
                    TwoChannelPlayer.onAppBackground()
                    assertTrue(TwoChannelPlayer.play(0, channels[0]))
                    assertTrue(TwoChannelPlayer.play(1, channels[1]))
                    // Retry before preparing removes the pending visit, preserving personal history.
                    TwoChannelPlayer.retry(0); TwoChannelPlayer.retry(1)
                    TwoChannelPlayer.onAppForeground()
                    (0..1).map { slot -> requireNotNull(TwoChannelPlayer.player(slot)).also { it.repeatMode = Player.REPEAT_MODE_ONE } }
                }
                waitUntil("The idle-to-fullscreen transition stopped or obscured one player") {
                    onMain { bothRender(players) && nativeViews(window).size == 2 && nativeViews(window).all(::hasFrame) } && !hasNavigation("Live TV")
                }
                val views = onMain { (0..1).map { slot -> nativeViews(window).single { it.tag == "dual-native-video-$slot" } } }
                val textures = onMain { views.map { requireNotNull(it.videoSurfaceView as? TextureView) } }
                val surfaceTextures = onMain { textures.map { requireNotNull(it.surfaceTexture) } }
                val mediaIds = onMain { players.map { it.currentMediaItem?.mediaId } }
                val viewport = onMain { bounds(window.window.decorView) }
                assertTrue("The activity viewport must be landscape", viewport.width() > viewport.height())
                waitUntil("Picture in Picture did not use the complete activity viewport") { onMain { bounds(views[0]) == viewport } }
                status("pip-full-viewport", viewport, onMain { views.map(::bounds) })

                waitUntil("The active controls did not hide automatically", 8_000) { !visibleTag("dual-layout") }
                // Accessibility reports only the uncovered part of the stage while the tray overlays it.
                waitUntil("The unobscured accessible stage did not cover the complete viewport") {
                    (taggedBounds("dual-stage") ?: describedBounds("Multi View video stage")) == viewport
                }
                assertStable(window, players, views, textures, surfaceTextures, mediaIds)
                assertFalse("The hidden tray brought navigation back", hasNavigation("Live TV"))
                key(KeyEvent.KEYCODE_DPAD_CENTER)
                waitUntil("OK did not reveal the fullscreen controls") { visibleTag("dual-layout") }
                clickTag("dual-watch")
                waitUntil("The soundtrack did not switch without reconnecting") { onMain {
                    TwoChannelPlayer.audioSlot.value == 1 && players[1].volume == 1f && players[0].volume == 0f
                } }
                assertStable(window, players, views, textures, surfaceTextures, mediaIds)

                revealControls()
                clickTag("dual-layout")
                val width = viewport.width() / 2
                val height = width * 9 / 16
                val top = viewport.top + (viewport.height() - height) / 2
                val split = listOf(Rect(viewport.left, top, viewport.left + width, top + height),
                    Rect(viewport.left + width, top, viewport.right, top + height))
                waitUntil("Split video did not use the full width with a 16:9 picture") { onMain {
                    (0..1).all { bounds(views[it]) == split[it] }
                } }
                assertStable(window, players, views, textures, surfaceTextures, mediaIds)
                status("split-full-width", viewport, onMain { views.map(::bounds) })
                revealControls()
                clickTag("dual-layout")
                waitUntil("Returning to Picture in Picture did not restore the full viewport") { onMain { bounds(views[0]) == viewport } }
                assertStable(window, players, views, textures, surfaceTextures, mediaIds)

                revealControls()
                key(KeyEvent.KEYCODE_BACK)
                waitUntil("The first Back did not hide the tray") { !visibleTag("dual-layout") }
                assertEquals(Tab.MULTIVIEW, onMain { state.tab })
                assertStable(window, players, views, textures, surfaceTextures, mediaIds)
                key(KeyEvent.KEYCODE_DPAD_RIGHT)
                waitUntil("An arrow did not reveal the hidden tray") { visibleTag("dual-layout") }
                assertStable(window, players, views, textures, surfaceTextures, mediaIds)
                key(KeyEvent.KEYCODE_BACK)
                waitUntil("Back did not hide the revealed tray") { !visibleTag("dual-layout") }
                key(KeyEvent.KEYCODE_BACK)
                waitUntil("The second Back did not release dual playback and return to Live TV") { onMain {
                    state.tab == Tab.GUIDE && !TwoChannelPlayer.active.value && (0..1).all { TwoChannelPlayer.player(it) == null }
                } }
                assertNull("Returning to the fixture guide opened an ordinary stream", onMain { PlayerHolder.currentUrl })
                onMain { saved.assertUnchanged() }
                status("back-released", viewport, emptyList())
            } catch (failure: Throwable) {
                captureFailure()
                throw failure
            } finally {
                try {
                    onMain {
                        TwoChannelPlayer.stop(); TwoChannelPlayer.onAppForeground(); PlayerHolder.stop()
                        activity?.setContent { }
                    }
                    // Close the production composition before restoring preview or the real catalogue.
                    instrumentation.waitForIdleSync()
                } finally {
                    try { scenario?.close() } finally { onMain { saved.restore() } }
                }
            }
        }
    }

    private fun bothRender(players: List<ExoPlayer>) = players.indices.all { slot ->
        TwoChannelPlayer.player(slot) === players[slot] && players[slot].isPlaying &&
            (players[slot].videoDecoderCounters?.renderedOutputBufferCount ?: 0) > 0
    }
    private fun assertStable(activity: ComponentActivity, players: List<ExoPlayer>, views: List<PlayerView>, textures: List<TextureView>, surfaceTextures: List<SurfaceTexture>, mediaIds: List<String?>) {
        val previousFrames = onMain { players.map { it.videoDecoderCounters?.renderedOutputBufferCount ?: 0 } }
        waitUntil("A layout or control change detached or froze a video frame") { onMain {
            bothRender(players) && views.all(::hasFrame) && players.indices.all {
                (players[it].videoDecoderCounters?.renderedOutputBufferCount ?: 0) > previousFrames[it]
            }
        } }
        onMain {
            assertEquals(2, nativeViews(activity).size)
            views.forEachIndexed { slot, view ->
                assertSame("A layout change recreated a PlayerView", view, nativeViews(activity).single { it.tag == "dual-native-video-$slot" })
                assertSame("A layout change recreated a texture surface", textures[slot], view.videoSurfaceView)
                assertSame("A layout change recreated the texture buffer", surfaceTextures[slot], textures[slot].surfaceTexture)
                assertSame("A control change recreated a player", players[slot], TwoChannelPlayer.player(slot))
                assertSame(players[slot], view.player)
            }
            assertEquals("A control change reopened the media items", mediaIds, players.map { it.currentMediaItem?.mediaId })
        }
    }
    private fun nativeViews(activity: ComponentActivity): List<PlayerView> {
        val result = ArrayList<PlayerView>()
        fun visit(view: View) {
            if (view is PlayerView && view.tag?.toString()?.startsWith("dual-native-video-") == true) result += view
            if (view is ViewGroup) for (index in 0 until view.childCount) visit(view.getChildAt(index))
        }
        visit(activity.window.decorView)
        return result
    }
    private fun bounds(view: View): Rect {
        val location = IntArray(2); view.getLocationOnScreen(location)
        return Rect(location[0], location[1], location[0] + view.width, location[1] + view.height)
    }
    private fun hasFrame(view: PlayerView): Boolean {
        val texture = view.videoSurfaceView as? TextureView ?: return false
        if (!texture.isAvailable) return false
        val frame = texture.getBitmap(32, 18) ?: return false
        return try { (0 until 32 step 4).any { x -> (0 until 18 step 3).any { y -> (frame.getPixel(x, y) and 0x00ffffff) != 0 } } }
        finally { frame.recycle() }
    }
    private fun visitNodes(action: (AccessibilityNodeInfo) -> Boolean): Boolean {
        fun visit(node: AccessibilityNodeInfo?): Boolean {
            if (node == null) return false
            try {
                if (action(node)) return true
                for (index in 0 until node.childCount) if (visit(node.getChild(index))) return true
                return false
            } finally { @Suppress("DEPRECATION") node.recycle() }
        }
        val automation = instrumentation.uiAutomation
        val required = AccessibilityServiceInfo.FLAG_REPORT_VIEW_IDS or AccessibilityServiceInfo.FLAG_RETRIEVE_INTERACTIVE_WINDOWS
        val service = automation.serviceInfo
        if ((service.flags and required) != required) {
            service.flags = service.flags or required
            automation.serviceInfo = service
        }
        // Public UiAutomation.clearCache was added in API 34; the onn test target is API 34.
        if (Build.VERSION.SDK_INT >= 34) automation.clearCache()
        val targetPackage = instrumentation.targetContext.packageName
        val windows = automation.windows.sortedWith(compareByDescending<AccessibilityWindowInfo> { it.isFocused }
            .thenByDescending { it.isActive }.thenByDescending { it.layer })
        try {
            for (window in windows) {
                if (window.type != AccessibilityWindowInfo.TYPE_APPLICATION) continue
                val root = window.root ?: continue
                if (root.packageName?.toString() == targetPackage) return visit(root)
                @Suppress("DEPRECATION") root.recycle()
            }
        } finally { windows.forEach { @Suppress("DEPRECATION") it.recycle() } }
        val root = automation.rootInActiveWindow ?: return false
        if (root.packageName?.toString() == targetPackage) return visit(root)
        @Suppress("DEPRECATION") root.recycle()
        return false
    }
    private fun visibleTag(tag: String) = visitNodes { it.isVisibleToUser && it.viewIdResourceName?.substringAfterLast('/') == tag }
    private fun hasNavigation(title: String) = visitNodes { it.isVisibleToUser &&
        (it.contentDescription?.toString() == title || it.text?.toString() == title) }
    private fun taggedBounds(tag: String): Rect? {
        var value: Rect? = null
        visitNodes { if (it.isVisibleToUser && it.viewIdResourceName?.substringAfterLast('/') == tag) { value = Rect().also(it::getBoundsInScreen); true } else false }
        return value
    }
    private fun describedBounds(description: String): Rect? {
        var value: Rect? = null
        visitNodes { if (it.isVisibleToUser && it.contentDescription?.toString() == description) { value = Rect().also(it::getBoundsInScreen); true } else false }
        return value
    }
    private fun clickTag(tag: String) {
        assertTrue("The fullscreen control was not clickable: $tag", visitNodes {
            it.isVisibleToUser && it.viewIdResourceName?.substringAfterLast('/') == tag && it.performAction(AccessibilityNodeInfo.ACTION_CLICK)
        })
    }
    private fun key(code: Int) { instrumentation.sendKeyDownUpSync(code) }
    private fun revealControls() {
        if (!visibleTag("dual-layout")) key(KeyEvent.KEYCODE_DPAD_CENTER)
        waitUntil("The controls could not be revealed") { visibleTag("dual-layout") }
    }
    private fun waitUntil(message: String, timeoutMs: Long = 25_000, condition: () -> Boolean) {
        val deadline = SystemClock.elapsedRealtime() + timeoutMs
        while (SystemClock.elapsedRealtime() < deadline) { if (condition()) return; SystemClock.sleep(50) }
        val root = instrumentation.uiAutomation.rootInActiveWindow
        val activePackage = root?.packageName?.toString()
        @Suppress("DEPRECATION") root?.recycle()
        throw AssertionError(message + "; slots=" + onMain { TwoChannelPlayer.states.value.joinToString { it.status.name } } +
            "; activePackage=$activePackage, accessibilityFlags=${instrumentation.uiAutomation.serviceInfo.flags}")
    }
    private fun <T> onMain(action: () -> T): T {
        var value: Result<T>? = null
        instrumentation.runOnMainSync { value = runCatching(action) }
        return requireNotNull(value).getOrThrow()
    }
    private fun status(stage: String, viewport: Rect, videos: List<Rect>) {
        instrumentation.sendStatus(2, Bundle().apply { putString("stream", "MULTIVIEW_FULLSCREEN stage=$stage viewport=$viewport videos=$videos\n") })
    }
    private fun captureFailure() {
        runCatching {
            val frame = requireNotNull(instrumentation.uiAutomation.takeScreenshot()) { "Screenshot unavailable" }
            try {
                val directory = instrumentation.context.getExternalFilesDir(null) ?: instrumentation.context.filesDir
                directory.mkdirs()
                val destination = File(directory, "fullscreen-failure.png")
                destination.outputStream().use { output -> check(frame.compress(Bitmap.CompressFormat.PNG, 100, output)) }
                println("MultiViewFullscreenTest failure screenshot=${destination.absolutePath}")
                instrumentation.sendStatus(2, Bundle().apply { putString("stream", "MULTIVIEW_FULLSCREEN failureScreenshot=${destination.absolutePath}\n") })
            } finally { frame.recycle() }
        }.onFailure { println("MultiViewFullscreenTest failure screenshot unavailable: ${it.javaClass.simpleName}") }
    }
    private inner class SavedState {
        private val channels = Repo.channels.value
        private val categories = Repo.liveCategories.value
        private val trending = Repo.trending.value
        private val status = Repo.liveStatus.value
        private val sp = instrumentation.targetContext.getSharedPreferences("tuner", Context.MODE_PRIVATE)
        private val activeId = Repo.prefs.activeId.value
        private val lastKey = "lastChannel_$activeId"
        private val historyKey = "watched_$activeId"
        private val hadLast = sp.contains(lastKey)
        private val last = Repo.prefs.lastChannelKey
        private val hadHistory = sp.contains(historyKey)
        private val history = sp.getString(historyKey, null)
        private val historyState = Repo.prefs.watchHistory.value
        private val favorites = Repo.prefs.favorites.value
        private val hadPreview = sp.contains("guidePreview")
        private val preview = Repo.prefs.guidePreview
        private val accessibilityFlags = instrumentation.uiAutomation.serviceInfo.flags
        fun assertUnchanged() {
            assertTrue("The fixture changed personal watch counts", Repo.prefs.watchHistory.value == historyState)
            assertTrue("The fixture changed Favorites", Repo.prefs.favorites.value == favorites)
            assertTrue("The fixture changed the last watched channel", Repo.prefs.lastChannelKey == last)
            assertTrue("The fixture changed the selected playlist", Repo.prefs.activeId.value == activeId)
        }
        fun restore() {
            Repo.prefs.guidePreview = preview
            Repo.prefs.lastChannelKey = last
            val edit = sp.edit()
            if (!hadPreview) edit.remove("guidePreview")
            if (!hadLast) edit.remove(lastKey)
            if (hadHistory) edit.putString(historyKey, history) else edit.remove(historyKey)
            assertTrue("Temporary preferences were not restored", edit.commit())
            Repo.prefs.setActive(activeId)
            Repo.channels.value = channels; Repo.liveCategories.value = categories; Repo.trending.value = trending; Repo.liveStatus.value = status
            val automation = instrumentation.uiAutomation
            automation.serviceInfo = automation.serviceInfo.apply { flags = accessibilityFlags }
        }
    }
    private class FixtureServer(private val data: ByteArray) : Closeable {
        private val server = ServerSocket(0, 8, InetAddress.getByName("127.0.0.1"))
        private val workers = Executors.newCachedThreadPool()
        private val sockets = ConcurrentHashMap.newKeySet<Socket>()
        val base = "http://127.0.0.1:${server.localPort}"
        init { workers.submit {
            while (!server.isClosed) runCatching {
                val socket = server.accept(); sockets += socket
                workers.submit { try { socket.use { client ->
                    client.soTimeout = 5_000
                    val input = client.getInputStream().bufferedReader()
                    val request = input.readLine().orEmpty()
                    var range: String? = null
                    while (true) { val header = input.readLine() ?: break; if (header.isEmpty()) break
                        if (header.startsWith("Range:", true)) range = header.substringAfter(':').trim() }
                    val start = range?.substringAfter("bytes=")?.substringBefore('-')?.toIntOrNull() ?: 0
                    val end = (range?.substringAfter('-')?.toIntOrNull() ?: data.lastIndex).coerceAtMost(data.lastIndex)
                    val output = client.getOutputStream()
                    if (start !in data.indices || end < start) output.write("HTTP/1.1 416 Range Not Satisfiable\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".toByteArray())
                    else {
                        val partial = start > 0
                        output.write(("HTTP/1.1 ${if (partial) "206 Partial Content" else "200 OK"}\r\nContent-Type: video/mp4\r\nAccept-Ranges: bytes\r\n" +
                            (if (partial) "Content-Length: ${end - start + 1}\r\nContent-Range: bytes $start-$end/${data.size}\r\n" else "") + "Connection: close\r\n\r\n").toByteArray())
                        if (!request.startsWith("HEAD ")) output.write(data, start, end - start + 1)
                    }
                    output.flush()
                } } finally { sockets -= socket } }
            }
        } }
        override fun close() { server.close(); sockets.forEach { runCatching { it.close() } }; workers.shutdownNow() }
    }
}

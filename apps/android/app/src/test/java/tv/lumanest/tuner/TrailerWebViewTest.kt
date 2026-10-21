package tv.lumanest.tuner

import android.app.Activity
import android.content.pm.PackageInfo
import android.net.Uri
import android.os.Looper
import android.os.SystemClock
import android.view.ViewGroup
import android.webkit.ConsoleMessage
import android.webkit.CookieManager
import android.webkit.PermissionRequest
import android.webkit.WebMessage
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.widget.FrameLayout
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.fakes.RoboWebMessagePort
import org.robolectric.shadows.ShadowLog
import org.robolectric.shadows.ShadowWebView
import tv.lumanest.tuner.ui.TrailerCommand
import tv.lumanest.tuner.ui.TrailerEvent
import tv.lumanest.tuner.ui.TrailerLog
import tv.lumanest.tuner.ui.TrailerPage
import tv.lumanest.tuner.ui.WebTrailerSurfaces

/** The WebView behind Tuner's trailer player: how it is set up, what it loads, how it talks and how it goes. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class TrailerWebViewTest {
    private val context get() = RuntimeEnvironment.getApplication()
    private val key = "L0fw0WzFaBM"
    private val events = mutableListOf<TrailerEvent>()

    /** The cookie store's calls (Robolectric's own cookie manager keeps nothing). */
    private val cookieCalls = mutableListOf<String>()
    private val cookies = object : CookieManager() {
        override fun setAcceptCookie(accept: Boolean) { cookieCalls += "acceptCookie=$accept" }
        override fun acceptCookie() = true
        override fun setAcceptThirdPartyCookies(webview: WebView?, accept: Boolean) { cookieCalls += "thirdParty=$accept" }
        override fun acceptThirdPartyCookies(webview: WebView?) = false
        override fun setCookie(url: String?, value: String?) { cookieCalls += "set" }
        override fun setCookie(url: String?, value: String?, callback: android.webkit.ValueCallback<Boolean>?) { cookieCalls += "set" }
        override fun getCookie(url: String?): String? = null
        @Deprecated("Deprecated in Java") override fun removeSessionCookie() = Unit
        override fun removeSessionCookies(callback: android.webkit.ValueCallback<Boolean>?) = Unit
        @Deprecated("Deprecated in Java") override fun removeAllCookie() = Unit
        override fun removeAllCookies(callback: android.webkit.ValueCallback<Boolean>?) { cookieCalls += "removeAll" }
        override fun hasCookies() = false
        @Deprecated("Deprecated in Java") override fun removeExpiredCookie() = Unit
        override fun flush() = Unit
    }
    private val surfaces = WebTrailerSurfaces { cookies }

    @Before fun webViewInstalled() {
        ShadowWebView.setCurrentWebViewPackage(PackageInfo().apply { packageName = "com.google.android.webview" })
    }

    @After fun reset() = ShadowWebView.setCurrentWebViewPackage(null)

    private fun open(): Pair<tv.lumanest.tuner.ui.TrailerSurface, WebView> {
        val surface = checkNotNull(surfaces.create(context, key) { events += it })
        return surface to surface.view as WebView
    }

    /** The WebView reports the page loaded (its load event has run). */
    private fun pageFinished(web: WebView) = checkNotNull(shadowOf(web).webViewClient).onPageFinished(web, TrailerPage.BASE_URL)

    /** The player's window: an activity on screen. */
    private fun window(): FrameLayout {
        val activity = Robolectric.buildActivity(Activity::class.java).setup().get()
        return FrameLayout(activity).also { activity.setContentView(it) }
    }

    /** The WebView put in its window, and the main thread's queue run (where the page's load waits for the attach). */
    private fun attach(web: WebView, window: FrameLayout = window()): FrameLayout {
        window.addView(web)
        shadowOf(Looper.getMainLooper()).idle()
        return window
    }

    /** The trailer log's lines since the test began, without their times. */
    private fun log(): List<String> = ShadowLog.getLogsForTag(TrailerLog.TAG).map { it.msg.substringAfter("ms ") }

    private class Request(url: String, private val main: Boolean) : WebResourceRequest {
        private val uri = Uri.parse(url)
        override fun getUrl(): Uri = uri
        override fun isForMainFrame() = main
        override fun isRedirect() = false
        override fun hasGesture() = true
        override fun getMethod() = "GET"
        override fun getRequestHeaders(): Map<String, String> = emptyMap()
    }

    @Test fun thePageLoadsOnceItsWebViewIsInItsWindowAndOnlyOnce() {
        val (_, web) = open()
        // Made, set up, but nothing loaded yet: the WebView isn't in a window.
        assertNull(shadowOf(web).lastLoadDataWithBaseURL)
        shadowOf(Looper.getMainLooper()).idle()
        assertNull(shadowOf(web).lastLoadDataWithBaseURL)
        // In its window: the page loads once that attach is done (posted), not during it.
        val window = window()
        window.addView(web)
        assertTrue(web.isAttachedToWindow)
        assertNull(shadowOf(web).lastLoadDataWithBaseURL)
        shadowOf(Looper.getMainLooper()).idle()
        val first = checkNotNull(shadowOf(web).lastLoadDataWithBaseURL)
        assertEquals(TrailerPage.html(key), first.data)
        // Taken out and put back (the dialog's window rebuilt): never loaded again.
        window.removeView(web)
        assertFalse(web.isAttachedToWindow)
        window.addView(web)
        shadowOf(Looper.getMainLooper()).idle()
        assertSame(first, shadowOf(web).lastLoadDataWithBaseURL)
        assertEquals(1, log().count { it.startsWith("load ") })
        assertEquals(2, log().count { it.startsWith("attached ") })
        assertEquals(1, log().count { it.startsWith("detached ") })
    }

    @Test fun aPlayerClosedBeforeItsWebViewIsInAWindowLoadsNothing() {
        val (surface, web) = open()
        val window = window()
        window.addView(web)
        surface.release()
        shadowOf(Looper.getMainLooper()).idle()
        assertEquals("about:blank", shadowOf(web).lastLoadedUrl)
        assertNull(shadowOf(web).lastLoadDataWithBaseURL)
    }

    @Test fun thePageLoadsWithTheAppsIdAsItsOriginAndOnlyTheCheckedKey() {
        val (_, web) = open()
        attach(web)
        val load = checkNotNull(shadowOf(web).lastLoadDataWithBaseURL)
        // YouTube's Required Minimum Functionality: a WebView app names itself by its app id (Referer and origin).
        assertEquals("https://" + BuildConfig.APPLICATION_ID + "/", load.baseUrl)
        assertEquals(TrailerPage.html(key), load.data)
        assertEquals("text/html", load.mimeType)
        assertEquals("utf-8", load.encoding)
        assertNull(load.historyUrl)
        // Nothing else is loaded, and no JavaScript interface is exposed to YouTube's frames.
        assertNull(shadowOf(web).lastLoadedUrl)
        assertNull(shadowOf(web).getJavascriptInterface("TunerTrailer"))
    }

    @Test fun theWebViewIsSetUpForThePlayerAndNothingElse() {
        val (_, web) = open()
        with(web.settings) {
            assertTrue(javaScriptEnabled)
            assertFalse(mediaPlaybackRequiresUserGesture)
            assertTrue(domStorageEnabled)
            assertFalse(allowFileAccess)
            assertFalse(allowContentAccess)
            @Suppress("DEPRECATION") assertFalse(allowFileAccessFromFileURLs)
            assertFalse(getGeolocationEnabled())
            assertEquals(WebSettings.MIXED_CONTENT_NEVER_ALLOW, mixedContentMode)
            assertFalse(javaScriptCanOpenWindowsAutomatically)
            assertFalse(supportMultipleWindows())
            // Laid out at the screen's own width (the page's device-width viewport): no wide viewport or overview,
            // which made YouTube's player 4K on a 1080p TV at density 2.
            assertFalse(useWideViewPort)
            assertFalse(loadWithOverviewMode)
        }
        // Third-party cookies off: YouTube's frame (another site than the page's) keeps none.
        assertEquals(listOf("thirdParty=false"), cookieCalls)
        // It fills its parent: a WRAP_CONTENT height (what a view added without layout params gets) makes WebView lay
        // its page out at zero height, so the player played unseen (the 1.8.2 black screen).
        assertEquals(ViewGroup.LayoutParams.MATCH_PARENT, web.layoutParams.width)
        assertEquals(ViewGroup.LayoutParams.MATCH_PARENT, web.layoutParams.height)
        // The remote's keys go to the player screen, never into YouTube's frame.
        assertFalse(web.isFocusable)
        assertFalse(web.isFocusableInTouchMode)
    }

    /** WebSettings has no getter for it; Robolectric's settings keep the value. */
    private fun WebSettings.getGeolocationEnabled() = (this as org.robolectric.fakes.RoboWebSettings).geolocationEnabled

    @Test fun thePageNeverNavigatesAndThePlayerLoadsWhatItAsksForOverHttps() {
        val (_, web) = open()
        val client = checkNotNull(shadowOf(web).webViewClient)
        // Any other page, or a link to anything but YouTube: blocked, and nothing is started instead (no browser).
        assertTrue(client.shouldOverrideUrlLoading(web, Request("https://lumanest.tv/", main = true)))
        assertTrue(client.shouldOverrideUrlLoading(web, Request("https://example.com/", main = true)))
        assertTrue(client.shouldOverrideUrlLoading(web, Request("https://www.google.com/url?q=https://example.com/", main = true)))
        assertTrue(client.shouldOverrideUrlLoading(web, Request("http://www.youtube.com/watch?v=$key", main = true)))
        assertTrue(client.shouldOverrideUrlLoading(web, Request("intent://www.youtube.com/watch#Intent;scheme=https;end", main = true)))
        // WebView asks about a frame only when it goes to another scheme than http(s): refused. It never asks about an
        // https frame (those load from any host); were it to, the player's would load.
        assertTrue(client.shouldOverrideUrlLoading(web, Request("intent://x#Intent;scheme=https;end", main = false)))
        assertFalse(client.shouldOverrideUrlLoading(web, Request("https://www.youtube-nocookie.com/embed/$key", main = false)))
        assertTrue(client.shouldOverrideUrlLoading(web, Request("https://ads.example/x", main = false)))
        // Android 6's WebView calls the older overload, which can't tell the page's navigations from a frame's: it refuses
        // every one it is asked about, YouTube's own links included (YouTube's frames load without asking).
        @Suppress("DEPRECATION")
        run {
            listOf(
                "https://www.youtube-nocookie.com/embed/$key?autoplay=1&enablejsapi=1", "https://www.youtube.com/watch?v=$key",
                "https://youtu.be/$key", "https://www.google.com/url?q=https://example.com/", "https://lumanest.tv/",
                "intent://x#Intent;scheme=https;end", "vnd.youtube:$key", "about:blank", null,
            ).forEach { assertTrue("$it", client.shouldOverrideUrlLoading(web, it)) }
        }
        assertNull(shadowOf(RuntimeEnvironment.getApplication()).nextStartedActivity)
        assertTrue(events.isEmpty())
        // Subresources: anything the player asks for over https, its ads included (YouTube's API policies forbid
        // blocking them); nothing unencrypted and no local files.
        listOf(
            "https://www.youtube.com/iframe_api", "https://rr2---sn-x.googlevideo.com/videoplayback",
            "blob:https://www.youtube-nocookie.com/1", "https://googleads.g.doubleclick.net/pagead/id",
            "https://static.doubleclick.net/instream/ad_status.js", "https://pixel.adsafeprotected.com/x",
        ).forEach { assertNull(it, client.shouldInterceptRequest(web, Request(it, main = false))) }
        listOf("http://www.youtube.com/x", "http://googleads.g.doubleclick.net/x", "file:///data/x", "content://x/y").forEach {
            val blocked = client.shouldInterceptRequest(web, Request(it, main = false))
            assertNotNull(it, blocked)
            assertEquals(it, 403, blocked!!.statusCode)
            assertEquals(it, 0, blocked.data.available())
        }
    }

    @Test fun aYouTubeLinkInThePlayerOpensTheYouTubeAppAndClosesThePlayer() {
        val (surface, web) = open()
        val client = checkNotNull(shadowOf(web).webViewClient)
        val app = shadowOf(RuntimeEnvironment.getApplication())
        // The player's YouTube logo or title, clicked with a mouse: YouTube's policies forbid disabling its links.
        assertTrue(client.shouldOverrideUrlLoading(web, Request("https://www.youtube.com/watch?v=$key", main = true)))
        val started = checkNotNull(app.nextStartedActivity)
        assertEquals("com.google.android.youtube.tv", started.`package`)
        assertEquals(android.content.Intent.ACTION_VIEW, started.action)
        assertEquals("https://www.youtube.com/watch?v=$key", started.dataString)
        assertEquals(listOf<TrailerEvent>(TrailerEvent.Left), events)
        // A short link too; the page itself stays (the player closes).
        assertTrue(client.shouldOverrideUrlLoading(web, Request("https://youtu.be/$key", main = true)))
        assertEquals("com.google.android.youtube.tv", checkNotNull(app.nextStartedActivity).`package`)
        assertNull(shadowOf(web).lastLoadedUrl)
        // Inside the player's own frame, YouTube's pages load there and nothing is started.
        assertFalse(client.shouldOverrideUrlLoading(web, Request("https://www.youtube.com/embed/$key", main = false)))
        assertNull(app.nextStartedActivity)
        // Once the player is closed, a late link starts nothing.
        surface.release()
        events.clear()
        assertTrue(client.shouldOverrideUrlLoading(web, Request("https://www.youtube.com/watch?v=$key", main = true)))
        assertNull(app.nextStartedActivity)
        assertTrue(events.isEmpty())
    }

    @Test fun thePageAndTheAppTalkOverAMessagePort() {
        val (surface, web) = open()
        // Before the page has loaded there is no port: commands go nowhere.
        surface.send(TrailerCommand.TOGGLE)
        assertTrue(shadowOf(web).createdPorts.isEmpty())
        pageFinished(web)
        val ports = shadowOf(web).createdPorts.single()
        val app = ports[0] as RoboWebMessagePort
        val page = ports[1] as RoboWebMessagePort
        // A second page-finished (the WebView may report more than one) makes no second port.
        pageFinished(web)
        assertEquals(1, shadowOf(web).createdPorts.size)
        listOf("ready", "state:1", "nonsense", "error:150").forEach { page.postMessage(WebMessage(it)) }
        shadowOf(Looper.getMainLooper()).idle()
        assertEquals(listOf(TrailerEvent.Ready, TrailerEvent.State(1), TrailerEvent.Error(150)), events)
        TrailerCommand.entries.forEach { surface.send(it) }
        assertEquals(listOf("toggle", "play", "pause", "back", "forward"), page.receivedMessages)
        // Pausing the app pauses the trailer.
        surface.pause()
        assertEquals("pause", page.receivedMessages.last())
        assertTrue(shadowOf(web).wasOnPauseCalled())
        surface.release()
        assertTrue(app.isClosed)
    }

    @Test fun thePagesDiagnosticsAreLoggedAndOnlyItsSnapshotsReachThePlayerStampedWithTheAppsClock() {
        val (_, web) = open()
        attach(web)
        pageFinished(web)
        val page = shadowOf(web).createdPorts.single()[1] as RoboWebMessagePort
        val tick = "diag:tick raf=48 vis=visible w=960 h=540 dpr=2 rect=0,0,960,540 st=1 t=3.50 lf=0.120 q=hd1080 levels=hd1080,hd720,auto"
        listOf(
            "diag:ua Mozilla/5.0 (Linux; Android 12; onn 4K Pro) Chrome/131.0", "diag:media vp9=true av1=false", tick, "state:1", "ad:1",
            "diag:ad st=1 t=3.50 ad=1", "diag:p st=1 t=40.00 ad=",
        ).forEach { page.postMessage(WebMessage(it)) }
        shadowOf(Looper.getMainLooper()).idle()
        val now = SystemClock.elapsedRealtime()
        assertEquals(listOf(
            TrailerEvent.Progress(1, 3.5, now, sized = true), TrailerEvent.State(1), TrailerEvent.Ad(1), TrailerEvent.Progress(1, 3.5, now, ad = true),
            TrailerEvent.Progress(1, 40.0, now),
        ), events)
        // Every message the page sent is in the log, as sent.
        listOf(
            "page diag:ua Mozilla/5.0 (Linux; Android 12; onn 4K Pro) Chrome/131.0", "page diag:media vp9=true av1=false", "page $tick",
            "page state:1", "page ad:1", "page diag:ad st=1 t=3.50 ad=1", "page diag:p st=1 t=40.00 ad=", "port sent",
        ).forEach { assertTrue(it, it in log()) }
    }

    @Test fun aRepeatedShortSnapshotIsLoggedOnceUntilItChangesAndTheStallCheckGetsEveryOne() {
        val (_, web) = open()
        attach(web)
        pageFinished(web)
        val page = shadowOf(web).createdPorts.single()[1] as RoboWebMessagePort
        // A trailer waiting, paused, for OK: its page says the same every 2 seconds for as long as it lives.
        val paused = "diag:p st=2 t=40.00 ad="
        listOf(paused, paused, "state:2", "state:2", paused, "diag:p st=1 t=41.00 ad=", "diag:p st=1 t=43.00 ad=", paused).forEach {
            page.postMessage(WebMessage(it))
        }
        shadowOf(Looper.getMainLooper()).idle()
        // Logged once until it changes (a playing trailer's differ, and are all logged); every other message as sent.
        assertEquals(
            listOf("page $paused", "page state:2", "page state:2", "page diag:p st=1 t=41.00 ad=", "page diag:p st=1 t=43.00 ad=", "page $paused"),
            log().filter { it.startsWith("page diag:") || it.startsWith("page state:") },
        )
        // The stall check still gets every snapshot.
        assertEquals(6, events.count { it is TrailerEvent.Progress })
        // The page's short snapshot is "diag:p" and then " st=...", as the log check reads it.
        val html = checkNotNull(TrailerPage.html(key))
        assertTrue(html.contains("else send(\"diag:p\"+now())"))
        assertTrue(html.contains("function now(){return \" st=\"+"))
        assertEquals("diag:p ", TrailerEvent.SHORT_SNAPSHOT)
    }

    @Test fun theTrailerLogSaysWhatTheWebViewDidAndNoAddressesQueries() {
        val (surface, web) = open()
        val client = checkNotNull(shadowOf(web).webViewClient)
        val chrome = checkNotNull(shadowOf(web).webChromeClient)
        assertTrue(log().any { it.startsWith("device sdk=34 model=") && " webview=com.google.android.webview " in it && " screen=" in it && " density=" in it })
        attach(web)
        assertTrue(log().any { it.startsWith("attached hw=") && " layer=" in it && " size=" in it })
        assertTrue(log().any { it.startsWith("load hw=") })
        client.onPageStarted(web, TrailerPage.BASE_URL, null)
        pageFinished(web)
        // A request the player may not make: its scheme and host only.
        client.shouldInterceptRequest(web, Request("http://ads.example/pixel?id=viewer-1234&v=$key", main = false))
        // An HTTP error: its status and host only.
        client.onReceivedHttpError(web, Request("https://www.youtube-nocookie.com/embed/$key?autoplay=1", main = false),
            WebResourceResponse("text/html", "utf-8", 404, "Not Found", emptyMap(), null))
        // The page's console and YouTube's frames: level, host and line, the message cut to 300 characters and any
        // address in it without its query.
        chrome.onConsoleMessage(ConsoleMessage("Failed to load https://www.youtube.com/api/stats?docid=$key&cpn=x\nnext line " + "x".repeat(400),
            "https://www.youtube-nocookie.com/s/player/abc/base.js?v=$key", 1234, ConsoleMessage.MessageLevel.ERROR))
        surface.send(TrailerCommand.TOGGLE)
        surface.pause()
        surface.resume()
        checkNotNull(shadowOf(web).webViewClient).onRenderProcessGone(web, null)
        surface.release()
        val lines = log()
        listOf("page started " + BuildConfig.APPLICATION_ID, "blocked http://ads.example", "http 404 host=www.youtube-nocookie.com main=false", "port sent", "send toggle",
            "pause", "send pause", "resume", "renderer gone", "release",
        ).forEach { assertTrue("$it in $lines", it in lines) }
        assertTrue(lines.any { it.startsWith("page finished ") })
        val console = lines.single { it.startsWith("console ") }
        assertTrue(console, console.startsWith("console ERROR www.youtube-nocookie.com:1234 Failed to load https://www.youtube.com/api/stats?... next line xxx"))
        assertEquals("console ERROR www.youtube-nocookie.com:1234 ".length + TrailerLog.CONSOLE_MAX, console.length)
        // Nothing after an address's host and path: no query, no fragment, no key.
        lines.forEach { line ->
            assertFalse(line, "viewer-1234" in line)
            assertFalse(line, "docid=" in line)
            assertFalse(line, "?v=" in line)
            assertFalse(line, "/pixel" in line)
            assertFalse(line, "\n" in line)
        }
        // The player's own key is logged once, by the player screen when it opens; the WebView never logs it.
        assertTrue(lines.none { key in it })
    }

    @Test fun theLogsTextHelpersKeepHostsAndCutQueries() {
        assertEquals("www.youtube.com", TrailerLog.hostOf("https://www.youtube.com/watch?v=$key"))
        assertEquals("www.youtube.com", TrailerLog.hostOf("https://user:pw@www.youtube.com:443/x#y"))
        assertEquals("tv.lumanest.tuner", TrailerLog.hostOf("https://tv.lumanest.tuner/"))
        assertEquals("example.com", TrailerLog.hostOf("https://example.com?q=1"))
        listOf(null, "", "about:blank", "data:text/html,x", "https://", "https:///x").forEach { assertEquals("$it", "-", TrailerLog.hostOf(it)) }
        assertEquals("https://www.youtube.com", TrailerLog.origin("https", "www.youtube.com"))
        assertEquals("file://", TrailerLog.origin("file", null))
        assertEquals("a b c", TrailerLog.clean("a\nb\tc", 100))
        assertEquals("a b c", TrailerLog.clean("a\u2028b\u0085c", 100))
        assertEquals("see https://x.example/a/b?... now", TrailerLog.clean("see https://x.example/a/b?token=1&v=2 now", 100))
        assertEquals("'https://x.example/a?...' (x)", TrailerLog.clean("'https://x.example/a#frag?x=1' (x)", 100))
        assertEquals("what? yes#1", TrailerLog.clean("what? yes#1", 100))
        assertEquals("abc", TrailerLog.clean("abcdef", 3))
        assertEquals("ab", TrailerLog.clean("ab\uD83D\uDE00", 3))
        assertEquals("", TrailerLog.clean(null, 3))
        assertEquals("console LOG -:0 hi", TrailerLog.console(null, "hi", null, 0))
        assertEquals(300, TrailerLog.CONSOLE_MAX)
        assertEquals("TunerTrailer", TrailerLog.TAG)
    }

    @Test fun closingThePlayerFreesTheWebView() {
        val (surface, web) = open()
        val parent = FrameLayout(context).apply { addView(web) }
        pageFinished(web)
        surface.release()
        assertNull(web.parent)
        assertEquals(0, parent.childCount)
        assertEquals("about:blank", shadowOf(web).lastLoadedUrl)
        assertTrue(shadowOf(web).wasDestroyCalled())
        assertNull(shadowOf(web).webChromeClient)
        // Nothing of YouTube's stays: its cookies and its HTTP cache (the trailer's preview images, named by its key)
        // go with the player.
        assertTrue("removeAll" in cookieCalls)
        assertTrue(shadowOf(web).wasClearCacheCalled())
        assertTrue(shadowOf(web).didClearCacheIncludeDiskFiles())
        // Released once: a late event or command does nothing.
        surface.release()
        surface.send(TrailerCommand.TOGGLE)
        (shadowOf(web).createdPorts.single()[1] as RoboWebMessagePort).postMessage(WebMessage("ready"))
        shadowOf(Looper.getMainLooper()).idle()
        assertTrue(events.isEmpty())
    }

    @Test fun aRendererThatGoesFallsBackWithoutTakingTheAppAlong() {
        val (surface, web) = open()
        val gone = checkNotNull(shadowOf(web).webViewClient).onRenderProcessGone(web, null)
        assertTrue("Handled: the app keeps running", gone)
        assertEquals(listOf<TrailerEvent>(TrailerEvent.Error(TrailerEvent.RENDERER_GONE)), events)
        surface.release()
        assertTrue(shadowOf(web).wasDestroyCalled())
        // A dead renderer is not asked to load anything more.
        assertNull(shadowOf(web).lastLoadedUrl)
    }

    @Test fun thePlayerDeniesPermissionsAndWindows() {
        val (_, web) = open()
        val chrome = checkNotNull(shadowOf(web).webChromeClient)
        var denied = false
        chrome.onPermissionRequest(object : PermissionRequest() {
            override fun getOrigin(): Uri = Uri.parse("https://www.youtube-nocookie.com")
            override fun getResources() = arrayOf(PermissionRequest.RESOURCE_VIDEO_CAPTURE)
            override fun grant(resources: Array<out String>?) = error("granted")
            override fun deny() { denied = true }
        })
        assertTrue(denied)
        var geolocation: Boolean? = null
        chrome.onGeolocationPermissionsShowPrompt("https://www.youtube.com") { _, allow, retain -> geolocation = allow || retain }
        assertEquals(false, geolocation)
        assertFalse(chrome.onCreateWindow(web, false, true, null))
        // WebView's grey play button never shows before the first frame.
        assertNotNull(chrome.defaultVideoPoster)
    }

    @Test fun noWebViewOrABadKeyMeansNoPlayer() {
        ShadowWebView.setCurrentWebViewPackage(null)
        assertNull(surfaces.create(context, key) { events += it })
        ShadowWebView.setCurrentWebViewPackage(PackageInfo().apply { packageName = "com.google.android.webview" })
        assertNull(surfaces.create(context, "L0fw0WzFa\"M") { events += it })
        assertNotNull(surfaces.create(context, key) { events += it })
    }
}

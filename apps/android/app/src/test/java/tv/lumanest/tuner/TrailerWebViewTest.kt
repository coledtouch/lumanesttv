package tv.lumanest.tuner

import android.content.pm.PackageInfo
import android.net.Uri
import android.os.Looper
import android.webkit.CookieManager
import android.webkit.PermissionRequest
import android.webkit.WebMessage
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.widget.FrameLayout
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.fakes.RoboWebMessagePort
import org.robolectric.shadows.ShadowWebView
import tv.lumanest.tuner.ui.TrailerCommand
import tv.lumanest.tuner.ui.TrailerEvent
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

    private class Request(url: String, private val main: Boolean) : WebResourceRequest {
        private val uri = Uri.parse(url)
        override fun getUrl(): Uri = uri
        override fun isForMainFrame() = main
        override fun isRedirect() = false
        override fun hasGesture() = true
        override fun getMethod() = "GET"
        override fun getRequestHeaders(): Map<String, String> = emptyMap()
    }

    @Test fun thePageLoadsWithTheAppsIdAsItsOriginAndOnlyTheCheckedKey() {
        val (_, web) = open()
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
            // A 1920 pixel wide layout, so YouTube starts in 1080p.
            assertTrue(useWideViewPort)
            assertTrue(loadWithOverviewMode)
        }
        // Third-party cookies off: YouTube's frame (another site than the page's) keeps none.
        assertEquals(listOf("thirdParty=false"), cookieCalls)
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

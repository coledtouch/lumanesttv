package tv.lumanest.tuner.ui

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Bitmap
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.view.View
import android.view.ViewGroup
import android.webkit.ConsoleMessage
import android.webkit.CookieManager
import android.webkit.GeolocationPermissions
import android.webkit.JsPromptResult
import android.webkit.JsResult
import android.webkit.PermissionRequest
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebChromeClient
import android.webkit.WebMessage
import android.webkit.WebMessagePort
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebStorage
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.foundation.background
import androidx.compose.foundation.focusable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.InputMode
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.onKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalInputModeManager
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.platform.LocalWindowInfo
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.core.graphics.createBitmap
import androidx.core.net.toUri
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import kotlinx.coroutines.delay
import tv.lumanest.tuner.data.Trailer
import java.io.ByteArrayInputStream

/** One trailer page and its player: a WebView on a TV, a stand-in in tests. Main thread only. */
internal interface TrailerSurface {
    /** What the player screen shows. */
    val view: View
    /** Tells the page's player to do something; nothing happens before the page is connected. */
    fun send(command: TrailerCommand)
    /** The activity paused, or the player got ready while it was: playback pauses. */
    fun pause()
    /** The activity is back: the WebView runs again (the player decides whether the trailer plays on: [TrailerPolicy.playsOnReturn]). */
    fun resume()
    /** Stops playback and frees the WebView. Called once the player closes, for whatever reason; then nothing works. */
    fun release()
}

/** Makes [TrailerSurface]s. A null surface means the device has no working WebView: the trailer goes to YouTube. */
internal fun interface TrailerSurfaces {
    fun create(context: Context, key: String, onEvent: (TrailerEvent) -> Unit): TrailerSurface?
}

/** The app's trailer surfaces (WebViews); tests provide stand-ins. */
internal val LocalTrailerSurfaces = staticCompositionLocalOf<TrailerSurfaces> { WebTrailerSurfaces() }

/**
 * The trailer in a WebView playing [TrailerPage]. Hardened for one job: JavaScript on (the player needs it) and
 * autoplay without a tap, but no file or content access, no geolocation, no mixed content, no new windows, no
 * permissions, and third-party cookies off. Requests and frames load from any https host ([TrailerPage.allowsRequest]:
 * YouTube's policies forbid blocking any part of its player or its ads, and WebView never asks the app about an https
 * frame). The page itself never navigates: WebView asks the app before the page would leave, and the app always says
 * no, so nothing opens a browser (the store edition included). From Android 7, a YouTube link the viewer follows in the
 * player opens in the YouTube app and closes the player ([TrailerEvent.Left]); any other link, and on Android 6 every
 * link, opens nothing. The page is laid out at the screen's own width (no wide viewport: [TrailerPage.VIEWPORT]) and
 * loaded once, only after the WebView is attached to its window. What it does goes to the log ([TrailerLog]).
 * [cookies] is the WebView's cookie store (tests check what it is told).
 */
internal class WebTrailerSurfaces(private val cookies: () -> CookieManager = CookieManager::getInstance) : TrailerSurfaces {
    // WebViewCompat (androidx.webkit, not a dependency) would also answer before Android 8; there the constructor's
    // exception says the same.
    @SuppressLint("WebViewApiAvailability")
    override fun create(context: Context, key: String, onEvent: (TrailerEvent) -> Unit): TrailerSurface? {
        val html = TrailerPage.html(key) ?: return null
        val provider = if (Build.VERSION.SDK_INT >= 26) runCatching { WebView.getCurrentWebViewPackage() }.getOrNull() else null
        TrailerLog.i(TrailerLog.device(context, provider))
        // No WebView provider (missing, disabled, or being updated): WebView's constructor would throw.
        if (Build.VERSION.SDK_INT >= 26 && provider == null) {
            TrailerLog.i("no WebView provider")
            return null
        }
        val web = try {
            // MATCH_PARENT, set before Compose adds it: a view added without layout params gets WRAP_CONTENT, and a
            // WebView whose height wraps its content lays its page out at zero height, so the player's 100% height
            // was 0 and the trailer played unseen on a black screen (1.8.2 on an onn 4K Pro).
            WebView(context).apply { layoutParams = ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT) }
        } catch (e: Exception) {
            TrailerLog.i("no WebView: " + e.javaClass.simpleName)
            return null // MissingWebViewPackageException, wrapped in an AndroidRuntimeException
        } catch (e: LinkageError) {
            TrailerLog.i("no WebView: " + e.javaClass.simpleName)
            return null // a WebView update half installed
        }
        return try {
            WebTrailerSurface(web, html, cookies, onEvent)
        } catch (e: Exception) {
            TrailerLog.i("WebView setup failed: " + e.javaClass.simpleName)
            runCatching { web.destroy() }
            null
        }
    }
}

@SuppressLint("SetJavaScriptEnabled") // the YouTube player is JavaScript; the page has only the checked key in it
private class WebTrailerSurface(
    private val web: WebView,
    private val html: String,
    private val cookies: () -> CookieManager,
    private val onEvent: (TrailerEvent) -> Unit,
) : TrailerSurface {
    private var port: WebMessagePort? = null
    private var released = false
    private var rendererGone = false
    /** The page is asked for once, after the WebView's first attach to its window. */
    private var loadAsked = false
    /**
     * The last short snapshot ("diag:p") logged: the page sends one every 2 seconds for as long as it lives, and a
     * paused trailer's are all the same, so one is logged until it changes (the stall check still gets every one).
     */
    private var lastShort: String? = null
    override val view: View get() = web

    init {
        web.settings.apply {
            javaScriptEnabled = true
            mediaPlaybackRequiresUserGesture = false
            // YouTube's player keeps its settings in local storage; it is cleared when the player closes.
            domStorageEnabled = true
            allowFileAccess = false
            allowContentAccess = false
            noFileUrlAccess()
            setGeolocationEnabled(false)
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            javaScriptCanOpenWindowsAutomatically = false
            setSupportMultipleWindows(false)
            setSupportZoom(false)
            builtInZoomControls = false
            displayZoomControls = false
            // The page is laid out at the screen's own width (TrailerPage.VIEWPORT): no wide viewport or overview,
            // which made a 1080p TV's page 1920 CSS pixels wide and YouTube's player 4K at density 2.
            useWideViewPort = false
            loadWithOverviewMode = false
        }
        cookies().setAcceptThirdPartyCookies(web, false)
        // The remote talks to the player screen, never to the page: keys can't move a focus inside YouTube's frame.
        web.isFocusable = false
        web.isFocusableInTouchMode = false
        web.descendantFocusability = ViewGroup.FOCUS_BLOCK_DESCENDANTS
        web.setBackgroundColor(android.graphics.Color.BLACK)
        web.overScrollMode = View.OVER_SCROLL_NEVER
        web.isVerticalScrollBarEnabled = false
        web.isHorizontalScrollBarEnabled = false
        web.webViewClient = Client()
        web.webChromeClient = Chrome()
        web.addOnAttachStateChangeListener(object : View.OnAttachStateChangeListener {
            override fun onViewAttachedToWindow(v: View) {
                TrailerLog.i("attached " + TrailerLog.view(web))
                if (loadAsked || released) return
                loadAsked = true
                // Once this attach is done (the window and its drawing in place), and never again.
                web.post { load() }
            }

            override fun onViewDetachedFromWindow(v: View) = TrailerLog.i("detached " + TrailerLog.view(web))
        })
        web.addOnLayoutChangeListener { _, left, top, right, bottom, oldLeft, oldTop, oldRight, oldBottom ->
            if (right - left != oldRight - oldLeft || bottom - top != oldBottom - oldTop) TrailerLog.i("size " + (right - left) + "x" + (bottom - top))
        }
    }

    /** The page, once the WebView is in its window. */
    private fun load() {
        if (released) return
        TrailerLog.i("load " + TrailerLog.view(web))
        web.loadDataWithBaseURL(TrailerPage.BASE_URL, html, "text/html", "utf-8", null)
    }

    /** Already off by default (and the page is no file), but said anyway. */
    @Suppress("DEPRECATION")
    private fun WebSettings.noFileUrlAccess() {
        allowFileAccessFromFileURLs = false
        allowUniversalAccessFromFileURLs = false
    }

    override fun send(command: TrailerCommand) {
        if (released) return
        val sent = port?.let { runCatching { it.postMessage(WebMessage(command.message)) }.isSuccess } == true
        TrailerLog.i("send " + command.message + if (sent) "" else ": no port")
    }

    override fun pause() {
        if (released || rendererGone) return
        TrailerLog.i("pause")
        send(TrailerCommand.PAUSE)
        web.onPause()
    }

    override fun resume() {
        if (released || rendererGone) return
        TrailerLog.i("resume")
        web.onResume()
    }

    override fun release() {
        if (released) return
        released = true
        TrailerLog.i("release")
        runCatching { port?.close() }
        port = null
        runCatching {
            (web.parent as? ViewGroup)?.removeView(web)
            if (!rendererGone) {
                web.stopLoading()
                web.loadUrl("about:blank")
                web.onPause()
            }
            web.webChromeClient = null
            web.removeAllViews()
            // Its HTTP cache too: the trailer's preview images are kept there under its key (the app's only WebView cache).
            runCatching { web.clearCache(true) }
            web.destroy()
        }
        // Nothing of YouTube's stays on the device between trailers (the app has no other WebView).
        runCatching { WebStorage.getInstance().deleteAllData() }
        runCatching { cookies().removeAllCookies(null) }
    }

    /** Once the page has loaded: the app's end of a message port goes to the page, the only way the two talk. */
    private fun connect() {
        if (released || rendererGone || port != null) return
        val ports = runCatching { web.createWebMessageChannel() }.getOrNull()
        if (ports == null || ports.size != 2) {
            TrailerLog.i("port failed: no channel")
            return // no events: the player falls back when it isn't ready in time
        }
        ports[0].setWebMessageCallback(object : WebMessagePort.WebMessageCallback() {
            override fun onMessage(port: WebMessagePort, message: WebMessage) {
                if (!released) received(message.data)
            }
        }, Handler(Looper.getMainLooper()))
        port = ports[0]
        runCatching { web.postWebMessage(WebMessage(TrailerPage.PORT_MESSAGE, arrayOf(ports[1])), TrailerPage.ORIGIN.toUri()) }
            .onSuccess { TrailerLog.i("port sent") }
            .onFailure { TrailerLog.i("port failed: " + it.javaClass.simpleName) }
    }

    /**
     * A message from the page: logged (a short snapshot only when it differs from the last one logged), then an event,
     * or a snapshot for the stall check stamped with the app's clock.
     */
    private fun received(message: String?) {
        val short = message != null && message.startsWith(TrailerEvent.SHORT_SNAPSHOT)
        if (!short || message != lastShort) TrailerLog.i("page " + TrailerLog.clean(message, TrailerLog.PAGE_MAX))
        if (short) lastShort = message
        (TrailerEvent.parse(message) ?: TrailerEvent.progress(message, SystemClock.elapsedRealtime()))?.let(onEvent)
    }

    private inner class Client : WebViewClient() {
        /**
         * Android 7 and later. WebView asks about the page's own navigations (a link it would follow, a redirect) and
         * about a frame's only when it goes to another scheme than http(s); an https frame loads without asking.
         */
        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
            val url = request.url
            if (TrailerPage.allowsNavigation(request.isForMainFrame, url.scheme, url.host)) return false
            // The player's YouTube logo, title or channel link (with a mouse): YouTube's policies forbid disabling it,
            // so it opens in the YouTube app, never a browser, and the player closes.
            if (request.isForMainFrame && !released && TrailerPage.opensInYouTube(url.scheme, url.host) &&
                TrailerLauncher.openLink(view.context, url.toString())
            ) onEvent(TrailerEvent.Left)
            return true
        }

        /**
         * Android 6 only (later versions call the one above). It is asked about the same navigations but can't tell the
         * page's from a frame's, so it refuses every one: the page never leaves, and a link in the player opens nothing.
         * YouTube's frames still load (https frames are never asked about).
         */
        @Deprecated("Android 6 only")
        @Suppress("OVERRIDE_DEPRECATION")
        override fun shouldOverrideUrlLoading(view: WebView, url: String?): Boolean = true

        override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? {
            if (TrailerPage.allowsRequest(request.url.scheme, request.url.host)) return null
            TrailerLog.i("blocked " + TrailerLog.origin(request.url.scheme, request.url.host))
            return WebResourceResponse("text/plain", "utf-8", 403, "Blocked", emptyMap(), ByteArrayInputStream(ByteArray(0)))
        }

        override fun onPageStarted(view: WebView, url: String?, favicon: Bitmap?) = TrailerLog.i("page started " + TrailerLog.hostOf(url))

        override fun onPageFinished(view: WebView, url: String?) {
            TrailerLog.i("page finished " + TrailerLog.hostOf(url) + " " + TrailerLog.view(view))
            connect()
        }

        /** A request that failed (no network, a name that didn't resolve...): its code, description and host. */
        override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) = TrailerLog.i(
            "load error " + error.errorCode + " " + TrailerLog.clean(error.description?.toString(), 120) + " host=" +
                TrailerLog.clean(request.url.host ?: "-", 100) + " main=" + request.isForMainFrame,
        )

        /** A request answered with an HTTP error: its status and host. */
        override fun onReceivedHttpError(view: WebView, request: WebResourceRequest, errorResponse: WebResourceResponse) = TrailerLog.i(
            "http " + errorResponse.statusCode + " host=" + TrailerLog.clean(request.url.host ?: "-", 100) + " main=" + request.isForMainFrame,
        )

        /** The page's renderer crashed or was killed: the app must not go with it. The trailer goes to YouTube. */
        override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail?): Boolean {
            TrailerLog.i(
                "renderer gone" + if (detail != null && Build.VERSION.SDK_INT >= 26) {
                    " crashed=" + detail.didCrash() + " priority=" + detail.rendererPriorityAtExit()
                } else "",
            )
            rendererGone = true
            if (!released) onEvent(TrailerEvent.Error(TrailerEvent.RENDERER_GONE))
            return true
        }
    }

    private class Chrome : WebChromeClient() {
        /** Black instead of WebView's grey play button before the first frame. */
        override fun getDefaultVideoPoster(): Bitmap = createBitmap(1, 1)
        override fun onPermissionRequest(request: PermissionRequest) = request.deny()
        override fun onGeolocationPermissionsShowPrompt(origin: String?, callback: GeolocationPermissions.Callback) = callback.invoke(origin, false, false)
        // The page fills the screen and its player has no full-screen button (fs=0): anything asking for one is refused.
        override fun onShowCustomView(view: View?, callback: WebChromeClient.CustomViewCallback) = callback.onCustomViewHidden()
        override fun onJsAlert(view: WebView?, url: String?, message: String?, result: JsResult): Boolean { result.cancel(); return true }
        override fun onJsConfirm(view: WebView?, url: String?, message: String?, result: JsResult): Boolean { result.cancel(); return true }
        override fun onJsPrompt(view: WebView?, url: String?, message: String?, defaultValue: String?, result: JsPromptResult): Boolean { result.cancel(); return true }
        override fun onJsBeforeUnload(view: WebView?, url: String?, message: String?, result: JsResult): Boolean { result.confirm(); return true }
        /** To the trailer log (level, host and line, the message cut to 300 characters), not WebView's own. */
        override fun onConsoleMessage(consoleMessage: ConsoleMessage?): Boolean {
            if (consoleMessage != null) {
                TrailerLog.i(TrailerLog.console(consoleMessage.messageLevel()?.name, consoleMessage.message(), consoleMessage.sourceId(), consoleMessage.lineNumber()))
            }
            return true
        }
    }
}

/**
 * The trailer, full screen over the details page (docs/extras.md, "Per platform", Android): "Loading trailer" with the
 * trailer's name and the remote's keys drawn over the WebView while its page loads, until YouTube's player is ready
 * ([TrailerPolicy.showsLoading]), so a cold web engine never shows as a black screen; then YouTube's player, with
 * nothing of Tuner's drawn over it (YouTube's Required Minimum Functionality, "Overlays and frames"). The page doesn't
 * autoplay: once a frame without "Loading trailer" has been drawn, the player is in view and the app starts the trailer
 * ([TrailerPolicy.startsOnceShown]; the Required Minimum Functionality's "Autoplay and scripted playbacks"). OK and
 * Play/Pause pause or play, Left and Right go back or forward 10 seconds, Back and Stop close it, and it closes by
 * itself when the trailer ends or a link in it opens the YouTube app ([onClose]; the caller gives the focus back to
 * Trailer). When this TV can't play it here ([TrailerPolicy]: an error, no ready player after 12 seconds, a ready one
 * that hasn't played 10 seconds after it got ready or after the viewer's last command, unless the viewer paused it, or
 * one whose time stands still while it says it plays, that buffers for 30 seconds after it played, or whose page stops
 * talking: [TrailerStall]), [onFallBack]: the YouTube app, then the QR code; when YouTube no longer has the video,
 * [onUnavailable]. The screen stays on while it (or an ad) plays. The WebView is made once "Loading trailer" is on
 * screen (the app's first one starts the TV's web engine, which takes a moment). The page and its WebView go when the
 * player closes, when the app stops, or when the page leaves; playback pauses while the app is paused. When the app is
 * back, a trailer that hadn't played and that the viewer hadn't touched plays on; one the viewer has seen play or has
 * controlled waits, paused, for OK ([TrailerPolicy.playsOnReturn]). Each step goes to the trailer log ([TrailerLog]).
 */
@Composable
@OptIn(androidx.compose.ui.ExperimentalComposeUiApi::class)
internal fun TrailerPlayerDialog(trailer: Trailer, onClose: () -> Unit, onFallBack: () -> Unit, onUnavailable: () -> Unit) {
    val surfaces = LocalTrailerSurfaces.current
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    val close by rememberUpdatedState(onClose)
    val fallBack by rememberUpdatedState(onFallBack)
    val unavailable by rememberUpdatedState(onUnavailable)
    var finished by remember { mutableStateOf(false) }
    fun finish(step: TrailerStep, why: String) {
        if (finished || step == TrailerStep.WAIT || step == TrailerStep.SHOW) return
        finished = true
        TrailerLog.i("finish " + step + ": " + why)
        when (step) {
            TrailerStep.CLOSE -> close()
            TrailerStep.UNAVAILABLE -> unavailable()
            else -> fallBack()
        }
    }
    Dialog(
        onDismissRequest = { finish(TrailerStep.CLOSE, "Back") },
        properties = DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false, dismissOnClickOutside = false),
    ) {
        val context = LocalContext.current
        var ready by remember { mutableStateOf(false) }
        var state by remember { mutableIntStateOf(-1) }
        // YouTube has said the trailer plays (state 1): it no longer has to start.
        var played by remember { mutableStateOf(false) }
        // The state of the ad YouTube's player shows now, null when none: while one plays, the trailer can't.
        var adState by remember { mutableStateOf<Int?>(null) }
        // An ad has played: YouTube's player has shown something, so it no longer has to be started.
        var adPlayed by remember { mutableStateOf(false) }
        // The viewer sent the ready page a command (OK, play, pause, seek): the app no longer starts it by itself.
        var commanded by remember { mutableStateOf(false) }
        // How many commands the viewer has sent the ready page: each one gives a trailer that doesn't play 10 seconds more.
        var commands by remember { mutableIntStateOf(0) }
        // The app paused the ready trailer (Tuner was paused, or the trailer got ready while it was): when Tuner is back
        // it plays on if it hadn't played and the viewer hadn't touched it, else it waits for OK
        // (TrailerPolicy.playsOnReturn). A command from the viewer ends the hold: it is theirs again.
        var held by remember { mutableStateOf(false) }
        // The app has asked the page to play by itself (once the player was in view, or when Tuner came back): the start
        // once in view happens only once.
        var started by remember { mutableStateOf(false) }
        val stall = remember { TrailerStall() }
        // Made after the first frame, so "Loading trailer" shows while the WebView starts; freed whenever the player goes.
        var surface by remember { mutableStateOf<TrailerSurface?>(null) }
        fun appPaused() = !lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED)
        // An ad of YouTube's plays now: the trailer can't, and needn't start yet.
        fun adPlaying() = adState == TrailerEvent.PLAYING
        // The viewer's last command left it paused (the trailer, or the ad showing): it waits for OK, however long.
        fun viewerPaused() = commanded && (adState ?: state) == TrailerEvent.PAUSED
        val onEvent: (TrailerEvent) -> Unit = { event ->
            if (event is TrailerEvent.Progress) {
                // Logged by the surface as the page's message; only a stall decides anything.
                finish(stall.on(event, appPaused()), "its time stood still, or its player had no size, while it played or buffered")
            } else {
                if (event is TrailerEvent.State) {
                    state = event.code
                    // YouTube reports the trailer's states only while no ad of its own shows.
                    adState = null
                    if (TrailerPolicy.plays(event) && !played) played = true
                }
                if (event is TrailerEvent.Ad) {
                    adState = if (event.code == TrailerEvent.ENDED) null else event.code
                    if (TrailerPolicy.plays(event) && !adPlayed) adPlayed = true
                }
                val step = TrailerPolicy.on(event, ready)
                TrailerLog.i("event " + event + ": " + step)
                when (step) {
                    TrailerStep.SHOW -> {
                        ready = true
                        // Tuner was paused while the trailer loaded (a voice assistant or the settings panel over it):
                        // the page doesn't autoplay, so the trailer waits until Tuner is back, then plays on.
                        if (appPaused()) held = true
                    }
                    else -> finish(step, event.toString())
                }
            }
        }
        DisposableEffect(Unit) { onDispose { surface?.release() } }
        LaunchedEffect(Unit) {
            TrailerLog.begin()
            TrailerLog.i("open " + trailer.key)
            withFrameNanos { }
            if (finished) return@LaunchedEffect
            val made = surfaces.create(context, trailer.key, onEvent)
            if (made == null) finish(TrailerPolicy.withoutWebView(), "no WebView") else surface = made
        }
        LaunchedEffect(surface) {
            if (surface == null) return@LaunchedEffect
            delay(TrailerPolicy.READY_TIMEOUT_MS)
            val step = TrailerPolicy.onTimer(ready, TrailerPolicy.READY_TIMEOUT_MS)
            TrailerLog.i("ready timer: " + step)
            finish(step, "not ready after " + TrailerPolicy.READY_TIMEOUT_MS + " ms")
        }
        // The page has said nothing for a while although its last snapshot said it plays (its renderer hung).
        LaunchedEffect(surface) {
            if (surface == null) return@LaunchedEffect
            while (true) {
                delay(TrailerPage.DIAG_EVERY_MS.toLong())
                finish(stall.onClock(SystemClock.elapsedRealtime(), appPaused()), "its page said nothing for " + TrailerPolicy.STALL_TIMEOUT_MS + " ms while playing")
            }
        }
        // Ready, not playing yet (nor an ad before it), and neither the viewer nor the app paused it: it has
        // PLAYING_TIMEOUT_MS to start. An ad that ends or stops playing, and every command from the viewer (a seek, OK
        // while it buffers), start the count again.
        val toPlay = ready && !played && !adPlaying() && !viewerPaused() && !held
        LaunchedEffect(toPlay, commands) {
            if (!toPlay) return@LaunchedEffect
            TrailerLog.i("playing timer: " + TrailerPolicy.PLAYING_TIMEOUT_MS + " ms")
            delay(TrailerPolicy.PLAYING_TIMEOUT_MS)
            val step = TrailerPolicy.onPlayingTimer(TrailerPolicy.PLAYING_TIMEOUT_MS, played || adPlaying(), viewerPaused(), held || appPaused())
            TrailerLog.i("playing timer: " + step + " (state " + state + ", ad " + adState + ")")
            finish(step, "not playing " + TrailerPolicy.PLAYING_TIMEOUT_MS + " ms after it got ready or the last command")
        }
        val loading = surface == null || TrailerPolicy.showsLoading(ready)
        LaunchedEffect(loading) {
            if (!loading) TrailerLog.i("loading screen off: ready")
        }
        // The page doesn't autoplay: the app starts the trailer once the player is in view, after a frame without
        // "Loading trailer" has been drawn (YouTube's Required Minimum Functionality, "Autoplay and scripted playbacks").
        // Ready while Tuner was paused (held): it starts when Tuner is back instead.
        LaunchedEffect(ready) {
            if (!ready || held) return@LaunchedEffect
            withFrameNanos { }
            withFrameNanos { }
            val start = TrailerPolicy.startsOnceShown(held, appPaused(), started, played || adPlayed, commanded)
            TrailerLog.i("in view: " + if (start) "play" else "wait")
            if (start) {
                started = true
                surface?.send(TrailerCommand.PLAY)
            }
        }
        DisposableEffect(lifecycle, surface) {
            val observer = LifecycleEventObserver { _, event ->
                when (event) {
                    Lifecycle.Event.ON_PAUSE -> {
                        surface?.pause()
                        if (ready) held = true
                    }
                    Lifecycle.Event.ON_RESUME -> {
                        surface?.resume()
                        // Paused before it played or the viewer touched it: it carries on (it plays, or falls back).
                        if (TrailerPolicy.playsOnReturn(held, played || adPlayed, commanded)) {
                            held = false
                            started = true
                            TrailerLog.i("plays on")
                            surface?.send(TrailerCommand.PLAY)
                        }
                    }
                    Lifecycle.Event.ON_STOP -> finish(TrailerStep.CLOSE, "the app stopped")
                    else -> Unit
                }
            }
            lifecycle.addObserver(observer)
            onDispose { lifecycle.removeObserver(observer) }
        }
        // Awake while loading and playing (an ad too); a paused trailer lets the TV's screensaver come.
        val awake = !ready || state == TrailerEvent.PLAYING || state == TrailerEvent.BUFFERING ||
            adState == TrailerEvent.PLAYING || adState == TrailerEvent.BUFFERING
        val window = LocalView.current
        DisposableEffect(window, awake) {
            window.keepScreenOn = awake
            onDispose { window.keepScreenOn = false }
        }
        // The player screen holds the remote's focus once its window has it, in keyboard mode (as the QR dialog does).
        val focus = remember { FocusRequester() }
        val windowFocused = LocalWindowInfo.current.isWindowFocused
        val inputManager = LocalInputModeManager.current
        LaunchedEffect(windowFocused) {
            if (!windowFocused) return@LaunchedEffect
            inputManager.requestInputMode(InputMode.Keyboard)
            requestAttachedFocus(focus)
        }
        Box(
            Modifier.fillMaxSize().background(Color.Black).testTag("trailer-player")
                .focusRequester(focus)
                .onKeyEvent { event ->
                    val action = TrailerKey.of(event.nativeKeyEvent.keyCode) ?: return@onKeyEvent false
                    if (event.type != KeyEventType.KeyDown) return@onKeyEvent true
                    val first = event.nativeKeyEvent.repeatCount == 0
                    when (action) {
                        is TrailerKey.Send -> if (first || action.command == TrailerCommand.BACK || action.command == TrailerCommand.FORWARD) {
                            val made = surface
                            made?.send(action.command)
                            // Only a ready page hears it (its port is there by then). The trailer is the viewer's again
                            // (no hold of the app's), and if it doesn't play it has 10 seconds from now.
                            if (made != null && ready) {
                                commanded = true
                                commands++
                                held = false
                            }
                        }
                        TrailerKey.Close -> if (first) finish(TrailerStep.CLOSE, "Stop")
                        TrailerKey.Ignore -> Unit
                    }
                    true
                }
                .focusable(),
        ) {
            // Composed from when it is made, so its page loads while "Loading trailer" covers it.
            surface?.let { made ->
                AndroidView(
                    factory = { made.view.also { (it.parent as? ViewGroup)?.removeView(it) } },
                    modifier = Modifier.fillMaxSize(),
                )
            }
            // Drawn after the WebView, so over it, until YouTube's player is ready: a page that is still starting (a cold
            // web engine paints nothing for a while) never shows as a black screen, and nothing plays under it.
            if (loading) TrailerLoading(trailer)
        }
    }
}

/** "Loading trailer", the trailer's name and the remote's keys, over black (and the WebView), until the player is ready. */
@Composable
private fun TrailerLoading(trailer: Trailer) {
    Box(Modifier.fillMaxSize().background(Color.Black).testTag("trailer-loading"), contentAlignment = Alignment.Center) {
        Column(Modifier.widthIn(max = 560.dp).padding(horizontal = 32.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            CircularProgressIndicator(color = Palette.accent, strokeWidth = 3.dp, modifier = Modifier.size(36.dp))
            Text(TrailerPage.LOADING, color = Color.White, fontSize = 20.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(top = 16.dp))
            Text(
                trailer.name, color = Color.White.copy(alpha = 0.7f), fontSize = 14.sp, maxLines = 2, overflow = TextOverflow.Ellipsis,
                textAlign = TextAlign.Center, modifier = Modifier.padding(top = 6.dp),
            )
            Text(
                TrailerPage.KEYS, color = Color.White.copy(alpha = 0.7f), fontSize = 13.sp, textAlign = TextAlign.Center,
                modifier = Modifier.padding(top = 14.dp).testTag("trailer-keys"),
            )
        }
    }
}

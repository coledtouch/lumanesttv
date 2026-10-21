package tv.lumanest.tuner.ui

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Bitmap
import android.os.Build
import android.os.Handler
import android.os.Looper
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
    /** The activity is back: the WebView runs again (playback stays paused until the viewer presses OK). */
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
 * link, opens nothing. [cookies] is the WebView's cookie store (tests check what it is told).
 */
internal class WebTrailerSurfaces(private val cookies: () -> CookieManager = CookieManager::getInstance) : TrailerSurfaces {
    // WebViewCompat (androidx.webkit, not a dependency) would also answer before Android 8; there the constructor's
    // exception says the same.
    @SuppressLint("WebViewApiAvailability")
    override fun create(context: Context, key: String, onEvent: (TrailerEvent) -> Unit): TrailerSurface? {
        val html = TrailerPage.html(key) ?: return null
        // No WebView provider (missing, disabled, or being updated): WebView's constructor would throw.
        if (Build.VERSION.SDK_INT >= 26 && runCatching { WebView.getCurrentWebViewPackage() }.getOrNull() == null) return null
        val web = try {
            WebView(context)
        } catch (_: Exception) {
            return null // MissingWebViewPackageException, wrapped in an AndroidRuntimeException
        } catch (_: LinkageError) {
            return null // a WebView update half installed
        }
        return try {
            WebTrailerSurface(web, html, cookies, onEvent)
        } catch (_: Exception) {
            runCatching { web.destroy() }
            null
        }
    }
}

@SuppressLint("SetJavaScriptEnabled") // the YouTube player is JavaScript; the page has only the checked key in it
private class WebTrailerSurface(
    private val web: WebView,
    html: String,
    private val cookies: () -> CookieManager,
    private val onEvent: (TrailerEvent) -> Unit,
) : TrailerSurface {
    private var port: WebMessagePort? = null
    private var released = false
    private var rendererGone = false
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
            // The page asks for a 1920 pixel wide layout (TrailerPage): YouTube then starts in 1080p.
            useWideViewPort = true
            loadWithOverviewMode = true
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
        web.loadDataWithBaseURL(TrailerPage.BASE_URL, html, "text/html", "utf-8", null)
    }

    /** Already off by default (and the page is no file), but said anyway. */
    @Suppress("DEPRECATION")
    private fun WebSettings.noFileUrlAccess() {
        allowFileAccessFromFileURLs = false
        allowUniversalAccessFromFileURLs = false
    }

    override fun send(command: TrailerCommand) {
        if (!released) runCatching { port?.postMessage(WebMessage(command.message)) }
    }

    override fun pause() {
        if (released || rendererGone) return
        send(TrailerCommand.PAUSE)
        web.onPause()
    }

    override fun resume() {
        if (!released && !rendererGone) web.onResume()
    }

    override fun release() {
        if (released) return
        released = true
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
        if (ports == null || ports.size != 2) return // no events: the player falls back when it isn't ready in time
        ports[0].setWebMessageCallback(object : WebMessagePort.WebMessageCallback() {
            override fun onMessage(port: WebMessagePort, message: WebMessage) {
                if (!released) TrailerEvent.parse(message.data)?.let(onEvent)
            }
        }, Handler(Looper.getMainLooper()))
        port = ports[0]
        runCatching { web.postWebMessage(WebMessage(TrailerPage.PORT_MESSAGE, arrayOf(ports[1])), TrailerPage.ORIGIN.toUri()) }
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

        override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? =
            if (TrailerPage.allowsRequest(request.url.scheme, request.url.host)) null
            else WebResourceResponse("text/plain", "utf-8", 403, "Blocked", emptyMap(), ByteArrayInputStream(ByteArray(0)))

        override fun onPageFinished(view: WebView, url: String?) = connect()

        /** The page's renderer crashed or was killed: the app must not go with it. The trailer goes to YouTube. */
        override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail?): Boolean {
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
        override fun onConsoleMessage(consoleMessage: ConsoleMessage?): Boolean = true
    }
}

/**
 * The trailer, full screen over the details page (docs/extras.md, "Per platform", Android): "Loading trailer" with the
 * trailer's name and the remote's keys until the WebView is in place, then YouTube's player, with nothing of Tuner's
 * drawn over it (YouTube's Required Minimum Functionality, "Overlays and frames"; it autoplays only once it is in
 * view). OK and Play/Pause pause or play, Left and Right go back or forward 10 seconds, Back and Stop close it, and it
 * closes by itself when the trailer ends or a link in it opens the YouTube app ([onClose]; the caller gives the focus
 * back to Trailer). When this TV can't play it here ([TrailerPolicy]), [onFallBack]: the YouTube
 * app, then the QR code; when YouTube no longer has the video, [onUnavailable]. The screen stays on while it plays. The
 * WebView is made once "Loading trailer" is on screen (the app's first one starts the TV's web engine, which takes a
 * moment). The page and its WebView go when the player closes, when the app stops, or when the page leaves; playback
 * pauses while the app is paused, and a trailer that gets ready meanwhile waits, paused.
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
    fun finish(step: TrailerStep) {
        if (finished || step == TrailerStep.WAIT || step == TrailerStep.SHOW) return
        finished = true
        when (step) {
            TrailerStep.CLOSE -> close()
            TrailerStep.UNAVAILABLE -> unavailable()
            else -> fallBack()
        }
    }
    Dialog(
        onDismissRequest = { finish(TrailerStep.CLOSE) },
        properties = DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false, dismissOnClickOutside = false),
    ) {
        val context = LocalContext.current
        var ready by remember { mutableStateOf(false) }
        var state by remember { mutableIntStateOf(-1) }
        // Made after the first frame, so "Loading trailer" shows while the WebView starts; freed whenever the player goes.
        var surface by remember { mutableStateOf<TrailerSurface?>(null) }
        val onEvent: (TrailerEvent) -> Unit = { event ->
            if (event is TrailerEvent.State) state = event.code
            when (val step = TrailerPolicy.on(event, ready)) {
                TrailerStep.SHOW -> {
                    ready = true
                    // Tuner was paused while the trailer loaded (a voice assistant or the settings panel over it): the
                    // pause then reached no page (no port yet, or no WebView at all), and the page autoplays once ready.
                    // Its port is there now: the trailer waits behind the overlay, paused, until the viewer presses OK.
                    if (!lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED)) surface?.pause()
                }
                else -> finish(step)
            }
        }
        DisposableEffect(Unit) { onDispose { surface?.release() } }
        LaunchedEffect(Unit) {
            withFrameNanos { }
            if (finished) return@LaunchedEffect
            val made = surfaces.create(context, trailer.key, onEvent)
            if (made == null) finish(TrailerPolicy.withoutWebView()) else surface = made
        }
        LaunchedEffect(surface) {
            if (surface == null) return@LaunchedEffect
            delay(TrailerPolicy.READY_TIMEOUT_MS)
            finish(TrailerPolicy.onTimer(ready, TrailerPolicy.READY_TIMEOUT_MS))
        }
        DisposableEffect(lifecycle, surface) {
            val observer = LifecycleEventObserver { _, event ->
                when (event) {
                    Lifecycle.Event.ON_PAUSE -> surface?.pause()
                    Lifecycle.Event.ON_RESUME -> surface?.resume()
                    Lifecycle.Event.ON_STOP -> finish(TrailerStep.CLOSE)
                    else -> Unit
                }
            }
            lifecycle.addObserver(observer)
            onDispose { lifecycle.removeObserver(observer) }
        }
        // Awake while loading and playing; a paused trailer lets the TV's screensaver come.
        val awake = !ready || state == TrailerEvent.PLAYING || state == TrailerEvent.BUFFERING
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
                            surface?.send(action.command)
                        }
                        TrailerKey.Close -> if (first) finish(TrailerStep.CLOSE)
                        TrailerKey.Ignore -> Unit
                    }
                    true
                }
                .focusable(),
        ) {
            surface?.let { made ->
                AndroidView(
                    factory = { made.view.also { (it.parent as? ViewGroup)?.removeView(it) } },
                    modifier = Modifier.fillMaxSize(),
                )
            }
            // Only until the WebView is in place: its page says the same under YouTube's player until that paints, and
            // the player then loads and plays in full view.
            if (surface == null) TrailerLoading(trailer)
        }
    }
}

/** "Loading trailer", the trailer's name and the remote's keys, over black, until the player's WebView is in place. */
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

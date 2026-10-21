package tv.lumanest.tuner.ui

import android.view.KeyEvent
import tv.lumanest.tuner.BuildConfig
import tv.lumanest.tuner.data.ExtrasApi

/**
 * The page Tuner's trailer player shows in its WebView (docs/extras.md, "Per platform", Android): YouTube's IFrame
 * Player API with the trailer's key, the only variable part, checked with [ExtrasApi.isYouTubeKey] before it is
 * written into the page. Plain Kotlin, so unit tests run it without Android.
 *
 * The page is loaded with `loadDataWithBaseURL(BASE_URL, ...)`, so its origin is the app's id (`https://tv.lumanest.tuner`,
 * or `https://app.tunertv` in the store edition): YouTube refuses an embed without an origin or referrer (errors 152 and
 * 153), its `origin` parameter must match, and YouTube's Required Minimum Functionality asks an app that sets the
 * Referer through a WebView to name itself there by the app id its store knows. It is laid out 1920 CSS
 * pixels wide (with the WebView's wide viewport), the size at which YouTube starts a full-screen player in 1080p; at a
 * TV's own 960 by 540 it starts in 720p. YouTube ignores quality requests from the API.
 *
 * The page and the app talk over a message port the app sends once the page has loaded ([PORT_MESSAGE]): the page sends
 * [TrailerEvent]s (queued until the port arrives) and takes [TrailerCommand]s. The page takes the port only from the
 * app (a message without a source window), never from the YouTube frame, and only once. Until YouTube's frame paints,
 * the page itself shows [LOADING] and the remote's [KEYS], under the player's element: YouTube's frame takes that
 * element's place and paints over them, so nothing of Tuner's is ever in front of YouTube's player (its Required
 * Minimum Functionality, "Overlays and frames"), and the screen isn't blank meanwhile. The page adds YouTube's API
 * script only after its own load event: a script or frame added while the page loads would hold that event (the
 * WebView's onPageFinished, when the port is sent) until YouTube's whole embed had loaded, its images and fonts too.
 */
object TrailerPage {
    /** The page's origin, the only one the app's port is posted to: the app's id (both ids are lowercase). */
    const val ORIGIN = "https://" + BuildConfig.APPLICATION_ID
    const val BASE_URL = "$ORIGIN/"
    const val EMBED_HOST = "https://www.youtube-nocookie.com"
    const val API_URL = "https://www.youtube.com/iframe_api"
    const val PORT_MESSAGE = "tuner:port"
    /** Shown while the trailer loads: by the player screen until its WebView is in place, then by the page. */
    const val LOADING = "Loading trailer"
    /** The remote's keys in the player, shown only while it loads (plain ASCII; the page keeps the spaces). */
    const val KEYS = "OK  Pause or play    Left  Right  10 seconds    Back  Close"

    /** The page for [key]; null when it isn't a YouTube video key, so nothing else can end up in the page. */
    fun html(key: String): String? {
        if (!ExtrasApi.isYouTubeKey(key)) return null
        return "<!DOCTYPE html>\n" +
            "<html lang=\"en\"><head><meta charset=\"utf-8\">" +
            "<meta name=\"viewport\" content=\"width=1920\">" +
            "<meta name=\"referrer\" content=\"strict-origin-when-cross-origin\">" +
            "<style>html,body{margin:0;width:100%;height:100%;background:#000;overflow:hidden}" +
            "#wait{position:absolute;left:0;top:50%;width:100%;margin-top:-50px;text-align:center;color:#fff;font:600 40px/56px sans-serif}" +
            "#wait div{font-weight:400;font-size:26px;line-height:44px;color:#b3b3b3;white-space:pre}" +
            "#player{position:absolute;left:0;top:0;width:100%;height:100%;border:0}</style>" +
            "</head><body><div id=\"wait\">" + LOADING + "<div>" + KEYS + "</div></div><div id=\"player\"></div><script>\n" +
            "(function(){\n" +
            "var key=\"" + key + "\",port=null,queue=[],player=null;\n" +
            "function send(m){if(port)port.postMessage(m);else queue.push(m)}\n" +
            "function command(c){\n" +
            " if(!player||!player.getPlayerState)return;\n" +
            " var s=player.getPlayerState();\n" +
            " if(c===\"toggle\"){if(s===1||s===3)player.pauseVideo();else player.playVideo()}\n" +
            " else if(c===\"play\")player.playVideo();\n" +
            " else if(c===\"pause\")player.pauseVideo();\n" +
            " else if(c===\"back\"||c===\"forward\"){\n" +
            "  var t=player.getCurrentTime()+(c===\"back\"?-10:10),d=player.getDuration();\n" +
            "  if(d>0&&t>d-1)t=d-1;\n" +
            "  player.seekTo(t<0?0:t,true)}\n" +
            "}\n" +
            "window.addEventListener(\"message\",function(e){\n" +
            " if(port||e.data!==\"" + PORT_MESSAGE + "\"||!e.ports||e.ports.length!==1||(e.source!==null&&e.source!==window))return;\n" +
            " port=e.ports[0];\n" +
            " port.onmessage=function(m){command(m.data)};\n" +
            " for(var i=0;i<queue.length;i++)port.postMessage(queue[i]);\n" +
            " queue=[];\n" +
            "});\n" +
            "window.onYouTubeIframeAPIReady=function(){\n" +
            " player=new YT.Player(\"player\",{host:\"" + EMBED_HOST + "\",videoId:key,width:\"100%\",height:\"100%\",\n" +
            "  playerVars:{autoplay:1,playsinline:1,rel:0,controls:1,enablejsapi:1,fs:0,iv_load_policy:3,disablekb:1,origin:\"" + ORIGIN + "\"},\n" +
            "  events:{\n" +
            "   onReady:function(e){send(\"ready\");e.target.playVideo()},\n" +
            "   onStateChange:function(e){send(\"state:\"+e.data)},\n" +
            "   onError:function(e){send(\"error:\"+e.data)}}});\n" +
            "};\n" +
            "var s=document.createElement(\"script\");\n" +
            "s.src=\"" + API_URL + "\";\n" +
            "s.onerror=function(){send(\"error:-1\")};\n" +
            "window.addEventListener(\"load\",function(){document.head.appendChild(s)});\n" +
            "})();\n" +
            "</script></body></html>\n"
    }

    /**
     * The player's hosts (YouTube, its video and image servers, the Google hosts its scripts, fonts and playback checks
     * come from, and Google's ad servers, whose ads YouTube may show), each with its subdomains: the only ones a frame
     * may navigate to when WebView asks ([allowsNavigation]). It asks only about a frame going to another scheme than
     * http(s), which is refused anyway, so in practice frames, like requests ([allowsRequest]), load from any https host.
     */
    val HOSTS = listOf(
        "youtube.com", "youtube-nocookie.com", "googlevideo.com", "ytimg.com", "ggpht.com", "google.com", "gstatic.com", "googleapis.com",
        "doubleclick.net", "googlesyndication.com", "googleadservices.com", "googletagservices.com", "2mdn.net",
    )

    /**
     * Whether the page may load a resource at [scheme]://[host]: `data:` and `blob:` (made by the page itself, nothing
     * leaves the device) and anything over https. The player's own requests are never blocked: YouTube's API policies
     * forbid blocking any part of its player or the ads it shows (and the measurement they carry).
     */
    fun allowsRequest(scheme: String?, host: String?): Boolean =
        scheme.equals("data", ignoreCase = true) || scheme.equals("blob", ignoreCase = true) ||
            (scheme.equals("https", ignoreCase = true) && !host.isNullOrEmpty())

    /** Whether [scheme]://[host] is one of the player's servers: https on one of [HOSTS] only. */
    fun allows(scheme: String?, host: String?): Boolean {
        if (scheme == null || !scheme.equals("https", ignoreCase = true) || host.isNullOrEmpty()) return false
        val h = host.lowercase(java.util.Locale.ROOT).removeSuffix(".")
        return HOSTS.any { h == it || h.endsWith(".$it") }
    }

    /**
     * Whether a navigation WebView asks about may go ahead. The page itself never navigates (Tuner never opens a browser,
     * and a YouTube link the viewer follows in the player goes to the YouTube app instead: [opensInYouTube]); a frame
     * only over https to one of [HOSTS]. WebView asks about a frame only when it goes to another scheme than http(s), so
     * every navigation it asks about is refused; https frames load without asking.
     */
    fun allowsNavigation(mainFrame: Boolean, scheme: String?, host: String?): Boolean = !mainFrame && allows(scheme, host)

    /**
     * Whether a link the viewer follows in the player (its YouTube logo, the title or the channel, with a mouse) is
     * YouTube's own: https on youtube.com, youtube-nocookie.com or youtu.be. YouTube's Developer Policies forbid disabling
     * the player's links, so these open in the YouTube app ([TrailerLauncher.openLink]); any other link opens nothing.
     */
    fun opensInYouTube(scheme: String?, host: String?): Boolean {
        if (scheme == null || !scheme.equals("https", ignoreCase = true) || host.isNullOrEmpty()) return false
        val h = host.lowercase(java.util.Locale.ROOT).removeSuffix(".")
        return h == "youtu.be" || h == "www.youtu.be" || listOf("youtube.com", "youtube-nocookie.com").any { h == it || h.endsWith(".$it") }
    }
}

/** What the trailer page tells the app. */
sealed interface TrailerEvent {
    /** The player is ready (it starts playing next). */
    data object Ready : TrailerEvent
    /** YouTube's player state: -1 unstarted, 0 ended, 1 playing, 2 paused, 3 buffering, 5 cued. */
    data class State(val code: Int) : TrailerEvent
    /** YouTube's error code, or the app's own: [API_FAILED], [RENDERER_GONE]. */
    data class Error(val code: Int) : TrailerEvent
    /** The app's own (the page never sends it): the viewer followed a YouTube link in the player and the YouTube app opened it. */
    data object Left : TrailerEvent

    companion object {
        const val ENDED = 0
        const val PLAYING = 1
        const val PAUSED = 2
        const val BUFFERING = 3
        /** The page couldn't load YouTube's API (offline, or blocked). */
        const val API_FAILED = -1
        /** The WebView's renderer crashed or was killed. */
        const val RENDERER_GONE = -2

        /** A message from the page, or null for anything else. */
        fun parse(message: String?): TrailerEvent? = when {
            message == null -> null
            message == "ready" -> Ready
            message.startsWith("state:") -> code(message.substring(6))?.let(::State)
            message.startsWith("error:") -> code(message.substring(6))?.let(::Error)
            else -> null
        }

        /** An optional minus and one to six ASCII digits. */
        private fun code(text: String): Int? {
            val digits = text.removePrefix("-")
            if (digits.isEmpty() || digits.length > 6 || digits.any { it !in '0'..'9' }) return null
            return text.toInt()
        }
    }
}

/** What the app tells the trailer page. [message] is the page's word for it: fixed text, never built from input. */
enum class TrailerCommand(val message: String) {
    TOGGLE("toggle"), PLAY("play"), PAUSE("pause"), BACK("back"), FORWARD("forward"),
}

/** What the player does next. */
enum class TrailerStep {
    /** Nothing changes. */
    WAIT,
    /** The player is ready: "Loading trailer" goes. */
    SHOW,
    /** The trailer ended, or the viewer followed a link to the YouTube app: the player closes. */
    CLOSE,
    /** The player can't play this trailer here: it closes and the trailer goes to the YouTube app, then the QR code. */
    FALL_BACK,
    /** YouTube no longer has this video (removed or private): the player closes and says so; no YouTube app could play it. */
    UNAVAILABLE,
}

/**
 * The trailer player's decisions (docs/extras.md, "Per platform", Android), apart from the screen so tests run them.
 * Error [NOT_FOUND] (100: the video was removed or made private) means YouTube has no such video: the YouTube app
 * couldn't play it either, so the player closes and says so. Any other error falls back: 2 (a bad request), 5 (the
 * HTML5 player failed), 101 and 150 (its owner doesn't allow embedding), 152 and 153 (YouTube couldn't check the
 * embedding page), the app's own -1 (the API didn't load) and -2 (the WebView's renderer went), and any code YouTube
 * adds later. So does a player that isn't ready after [READY_TIMEOUT_MS], and a TV without a working WebView.
 */
object TrailerPolicy {
    const val READY_TIMEOUT_MS = 12_000L
    /** YouTube's error for a video it doesn't have (removed, or private). */
    const val NOT_FOUND = 100
    /** The codes YouTube documents, and the app's own. */
    val KNOWN_ERRORS = setOf(TrailerEvent.API_FAILED, TrailerEvent.RENDERER_GONE, 2, 5, NOT_FOUND, 101, 150, 152, 153)

    fun on(event: TrailerEvent, ready: Boolean): TrailerStep = when (event) {
        TrailerEvent.Ready -> if (ready) TrailerStep.WAIT else TrailerStep.SHOW
        is TrailerEvent.State -> if (event.code == TrailerEvent.ENDED && ready) TrailerStep.CLOSE else TrailerStep.WAIT
        is TrailerEvent.Error -> if (event.code == NOT_FOUND) TrailerStep.UNAVAILABLE else TrailerStep.FALL_BACK
        TrailerEvent.Left -> TrailerStep.CLOSE
    }

    /** [elapsedMs] after the player opened: a player that still isn't ready falls back. */
    fun onTimer(ready: Boolean, elapsedMs: Long): TrailerStep =
        if (!ready && elapsedMs >= READY_TIMEOUT_MS) TrailerStep.FALL_BACK else TrailerStep.WAIT

    /** No WebView could be made (none installed, disabled or updating). */
    fun withoutWebView(): TrailerStep = TrailerStep.FALL_BACK
}

/** What a remote key does in the trailer player. */
sealed interface TrailerKey {
    data class Send(val command: TrailerCommand) : TrailerKey
    /** The player closes and the focus goes back to Trailer. */
    data object Close : TrailerKey
    /** Taken, so the focus stays in the player, but does nothing. */
    data object Ignore : TrailerKey

    companion object {
        /**
         * The action for a key press with [keyCode] (a `KeyEvent.KEYCODE_*`), or null for keys the player leaves to the
         * system (volume, Home, and Back, which closes the player as its dialog's dismiss).
         */
        fun of(keyCode: Int): TrailerKey? = when (keyCode) {
            KeyEvent.KEYCODE_DPAD_CENTER, KeyEvent.KEYCODE_ENTER, KeyEvent.KEYCODE_NUMPAD_ENTER,
            KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE, KeyEvent.KEYCODE_SPACE, KeyEvent.KEYCODE_HEADSETHOOK -> Send(TrailerCommand.TOGGLE)
            KeyEvent.KEYCODE_MEDIA_PLAY -> Send(TrailerCommand.PLAY)
            KeyEvent.KEYCODE_MEDIA_PAUSE -> Send(TrailerCommand.PAUSE)
            KeyEvent.KEYCODE_DPAD_LEFT, KeyEvent.KEYCODE_MEDIA_REWIND, KeyEvent.KEYCODE_MEDIA_SKIP_BACKWARD -> Send(TrailerCommand.BACK)
            KeyEvent.KEYCODE_DPAD_RIGHT, KeyEvent.KEYCODE_MEDIA_FAST_FORWARD, KeyEvent.KEYCODE_MEDIA_SKIP_FORWARD -> Send(TrailerCommand.FORWARD)
            KeyEvent.KEYCODE_MEDIA_STOP, KeyEvent.KEYCODE_ESCAPE -> Close
            KeyEvent.KEYCODE_DPAD_UP, KeyEvent.KEYCODE_DPAD_DOWN, KeyEvent.KEYCODE_TAB -> Ignore
            else -> null
        }
    }
}

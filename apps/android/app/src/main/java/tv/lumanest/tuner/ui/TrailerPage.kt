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
 * Referer through a WebView to name itself there by the app id its store knows. It is laid out at the screen's own
 * width (`width=device-width`, no wide viewport): on a TV whose interface is 1080p (960 by 540 dp at density 2, a 4K
 * onn 4K Pro too) YouTube's full-screen player is 960 by 540 CSS pixels at a device pixel ratio of 2, so YouTube sees a
 * 1920 by 1080 pixel player and picks up to 1080p. 1.8.1 laid the page out 1920 CSS pixels wide, which at density 2
 * made YouTube see a 3840 by 2160 player and pick 4K, whose frames a TV's WebView may never show (a black screen on
 * an onn 4K Pro). YouTube ignores quality requests from the API.
 *
 * The page and the app talk over a message port the app sends once the page has loaded ([PORT_MESSAGE]): the page sends
 * [TrailerEvent]s (queued until the port arrives) and takes [TrailerCommand]s. The page takes the port only from the
 * app (a message without a source window), never from the YouTube frame, and only once. The page's own copy of
 * [LOADING] and the remote's [KEYS] sits under the player's element, which YouTube's frame replaces and paints over: a
 * backstop, since the player screen draws its own "Loading trailer" over the whole WebView only while the page loads,
 * until YouTube's player is ready ([TrailerPolicy.showsLoading]). From then on nothing of Tuner's is in front of
 * YouTube's player (its Required Minimum Functionality, "Overlays and frames"). The page doesn't autoplay (`autoplay:0`,
 * and nothing plays at ready): the app sends it [TrailerCommand.PLAY] once a frame without "Loading trailer" has been
 * drawn, since YouTube's Required Minimum Functionality ("Autoplay and scripted playbacks") forbids starting a playback
 * before more than half of the player is visible ([TrailerPolicy.startsOnceShown]). The page adds YouTube's API script
 * only after its own load event: a script or frame added while the page loads would hold that event (the WebView's
 * onPageFinished, when the port is sent) until YouTube's whole embed had loaded, its images and fonts too.
 *
 * YouTube's player reports an ad it shows (one it doesn't stitch into the video) apart from the trailer: its states
 * come as "onAdStateChange", not "onStateChange" (which YouTube doesn't document; its embed passes any event name a
 * page listens for). The page sends them as "ad:" messages ([TrailerEvent.Ad]), so an ad that plays counts as
 * playing, and while one shows, OK pauses or plays the ad and Left and Right do nothing.
 *
 * The page also reports on itself for the log ([TrailerLog], "diag:" messages, which [TrailerEvent.parse] ignores):
 * at its load event the WebView's user agent and which codecs its MediaSource takes, then a snapshot at load, on
 * ready, on every state change (the trailer's or an ad's) and error, and every 2 seconds for 30 seconds: frames painted
 * (`requestAnimationFrame` calls, counted only those 30 seconds), `visibilityState`, the window's size and pixel ratio,
 * the player frame's rectangle, and YouTube's state, current time, the ad's state, loaded fraction, quality and
 * quality levels. After those 30 seconds a short one ("diag:p": state, time and the ad's state) every 2 seconds for
 * as long as the page lives. The state, time and ad of a snapshot are the stall check's ([TrailerEvent.progress],
 * [TrailerStall]). Nothing in them is the viewer's.
 */
object TrailerPage {
    /** The page's origin, the only one the app's port is posted to: the app's id (both ids are lowercase). */
    const val ORIGIN = "https://" + BuildConfig.APPLICATION_ID
    const val BASE_URL = "$ORIGIN/"
    const val EMBED_HOST = "https://www.youtube-nocookie.com"
    const val API_URL = "https://www.youtube.com/iframe_api"
    const val PORT_MESSAGE = "tuner:port"
    /**
     * Shown by the player screen over its WebView while the page loads, until YouTube's player is ready
     * ([TrailerPolicy.showsLoading]); the page's own copy under YouTube's frame is a backstop.
     */
    const val LOADING = "Loading trailer"
    /** The remote's keys in the player, shown only while it loads (plain ASCII; the page keeps the spaces). */
    const val KEYS = "OK  Pause or play    Left  Right  10 seconds    Back  Close"
    /** The page's layout: the screen's own width, so YouTube sees the screen's pixels (a 1080p player on a 1080p TV). */
    const val VIEWPORT = "width=device-width,initial-scale=1"
    /**
     * The page's periodic snapshots for the log and the stall check: every 2 seconds, in full 15 times (its first 30
     * seconds), then short ("diag:p") for as long as the page lives.
     */
    const val DIAG_EVERY_MS = 2_000
    const val DIAG_TICKS = 15

    /** The page for [key]; null when it isn't a YouTube video key, so nothing else can end up in the page. */
    fun html(key: String): String? {
        if (!ExtrasApi.isYouTubeKey(key)) return null
        return "<!DOCTYPE html>\n" +
            "<html lang=\"en\"><head><meta charset=\"utf-8\">" +
            "<meta name=\"viewport\" content=\"" + VIEWPORT + "\">" +
            "<meta name=\"referrer\" content=\"strict-origin-when-cross-origin\">" +
            "<style>html,body{margin:0;width:100%;height:100%;background:#000;overflow:hidden}" +
            "#wait{position:absolute;left:0;top:50%;width:100%;margin-top:-50px;text-align:center;color:#fff;font:600 40px/56px sans-serif}" +
            "#wait div{font-weight:400;font-size:26px;line-height:44px;color:#b3b3b3;white-space:pre}" +
            "#player{position:absolute;left:0;top:0;width:100%;height:100%;border:0}</style>" +
            "</head><body><div id=\"wait\">" + LOADING + "<div>" + KEYS + "</div></div><div id=\"player\"></div><script>\n" +
            "(function(){\n" +
            "var key=\"" + key + "\",port=null,queue=[],player=null,frames=0,counting=true,ad=null;\n" +
            "function send(m){if(port)port.postMessage(m);else queue.push(m)}\n" +
            "function call(n){try{return player&&player[n]?player[n]():\"\"}catch(x){return \"x\"}}\n" +
            "function num(v,d){return typeof v===\"number\"&&isFinite(v)?v.toFixed(d):\"\"}\n" +
            "function now(){return \" st=\"+call(\"getPlayerState\")+\" t=\"+num(call(\"getCurrentTime\"),2)+\" ad=\"+(ad===null?\"\":ad)}\n" +
            "function snap(why){\n" +
            " var f=call(\"getIframe\"),r=f&&f.getBoundingClientRect?f.getBoundingClientRect():null,l=call(\"getAvailableQualityLevels\");\n" +
            " send(\"diag:\"+why+\" raf=\"+frames+\" vis=\"+document.visibilityState+\" w=\"+window.innerWidth+\" h=\"+window.innerHeight+\n" +
            "  \" dpr=\"+window.devicePixelRatio+\" rect=\"+(r?Math.round(r.left)+\",\"+Math.round(r.top)+\",\"+Math.round(r.width)+\",\"+Math.round(r.height):\"none\")+\n" +
            "  now()+\" lf=\"+num(call(\"getVideoLoadedFraction\"),3)+\n" +
            "  \" q=\"+call(\"getPlaybackQuality\")+\" levels=\"+(l&&l.join?l.join(\",\"):\"\"))}\n" +
            "function media(){\n" +
            " var m=window.MediaSource,o=\"diag:media\",c=[[\"vp9\",'video/webm; codecs=\"vp9\"'],[\"vp9.2\",'video/webm; codecs=\"vp09.02.51.10.01.09.16.09.00\"'],\n" +
            "  [\"av1\",'video/mp4; codecs=\"av01.0.08M.08\"'],[\"h264\",'video/mp4; codecs=\"avc1.640028\"'],[\"opus\",'audio/webm; codecs=\"opus\"'],[\"aac\",'audio/mp4; codecs=\"mp4a.40.2\"']];\n" +
            " for(var i=0;i<c.length;i++){var y;try{y=m&&m.isTypeSupported?m.isTypeSupported(c[i][1]):\"none\"}catch(x){y=\"x\"}o+=\" \"+c[i][0]+\"=\"+y}\n" +
            " return o+\" hdr=\"+(window.matchMedia?window.matchMedia(\"(dynamic-range: high)\").matches:\"none\")+\" screen=\"+screen.width+\"x\"+screen.height}\n" +
            "function count(){frames++;if(counting)window.requestAnimationFrame(count)}\n" +
            "window.requestAnimationFrame(count);\n" +
            "function fit(){var e=document.getElementById(\"player\"),w=window.innerWidth,h=window.innerHeight;if(e&&w>0&&h>0){e.style.width=w+\"px\";e.style.height=h+\"px\"}}\n" +
            "window.addEventListener(\"resize\",fit);\n" +
            "function command(c){\n" +
            " if(!player||!player.getPlayerState)return;\n" +
            " var s=ad!==null?ad:player.getPlayerState();\n" +
            " if(c===\"toggle\"){if(s===1||s===3)player.pauseVideo();else player.playVideo()}\n" +
            " else if(c===\"play\")player.playVideo();\n" +
            " else if(c===\"pause\")player.pauseVideo();\n" +
            " else if(ad===null&&(c===\"back\"||c===\"forward\")){\n" +
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
            "  playerVars:{autoplay:0,playsinline:1,rel:0,controls:1,enablejsapi:1,fs:0,iv_load_policy:3,disablekb:1,origin:\"" + ORIGIN + "\"},\n" +
            "  events:{\n" +
            "   onReady:function(e){fit();send(\"ready\");snap(\"ready\")},\n" +
            "   onStateChange:function(e){ad=null;send(\"state:\"+e.data);snap(\"state\")},\n" +
            "   onAdStateChange:function(e){ad=typeof e.data===\"number\"&&e.data!==0?e.data:null;send(\"ad:\"+e.data);snap(\"ad\")},\n" +
            "   onError:function(e){send(\"error:\"+e.data);snap(\"error\")}}});\n" +
            " fit();\n" +
            "};\n" +
            "var s=document.createElement(\"script\");\n" +
            "s.src=\"" + API_URL + "\";\n" +
            "s.onerror=function(){send(\"error:-1\")};\n" +
            "window.addEventListener(\"load\",function(){\n" +
            " document.head.appendChild(s);\n" +
            " fit();\n" +
            " send(\"diag:ua \"+navigator.userAgent);\n" +
            " send(media());\n" +
            " snap(\"load\");\n" +
            " var n=0;setInterval(function(){if(n<" + DIAG_TICKS + "){snap(\"tick\");if(++n>=" + DIAG_TICKS + ")counting=false}else send(\"diag:p\"+now())}," + DIAG_EVERY_MS + ")});\n" +
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
    /** The player is ready: "Loading trailer" goes, and the app starts it once the player is in view. */
    data object Ready : TrailerEvent
    /** YouTube's player state: -1 unstarted, 0 ended, 1 playing, 2 paused, 3 buffering, 5 cued. */
    data class State(val code: Int) : TrailerEvent
    /**
     * The state of an ad YouTube's player shows, before the trailer or in it, in [State]'s codes ("onAdStateChange",
     * which YouTube doesn't document). While its own ad plays, YouTube reports no [State] for it, so an ad that plays
     * counts as playing ([TrailerPolicy.plays]). An ad YouTube stitches into the video comes as [State] instead.
     */
    data class Ad(val code: Int) : TrailerEvent
    /** YouTube's error code, or the app's own: [API_FAILED], [RENDERER_GONE]. */
    data class Error(val code: Int) : TrailerEvent
    /** The app's own (the page never sends it): the viewer followed a YouTube link in the player and the YouTube app opened it. */
    data object Left : TrailerEvent
    /**
     * A snapshot from the page's diagnostics ("diag:"): YouTube's [state] and the video's [time] in seconds, whether an
     * [ad] of YouTube's own was showing (its state is then the ad's, and the trailer's time stands still), stamped [atMs]
     * by the app's clock when it arrived. Only the stall check reads it ([TrailerStall]); [TrailerPolicy.on] waits.
     */
    data class Progress(val state: Int, val time: Double, val atMs: Long, val ad: Boolean = false, val sized: Boolean? = null) : TrailerEvent

    companion object {
        const val ENDED = 0
        const val PLAYING = 1
        const val PAUSED = 2
        const val BUFFERING = 3
        /** The page couldn't load YouTube's API (offline, or blocked). */
        const val API_FAILED = -1
        /** The WebView's renderer crashed or was killed. */
        const val RENDERER_GONE = -2

        /** The page's diagnostics start with this; [parse] ignores them (they are logged, and [progress] reads them). */
        const val DIAG = "diag:"
        /**
         * The page's snapshots ("diag:<kind> ... st=<state> t=<seconds> ad=<ad state, or nothing> ..."), the only
         * diagnostics [progress] reads: "p" is the short one the page sends every 2 seconds after its first 30.
         */
        val SNAPSHOTS = setOf("load", "ready", "state", "ad", "error", "tick", "p")
        /** How the short snapshot starts ("diag:p st=..."), the one the page sends every 2 seconds for as long as it lives. */
        const val SHORT_SNAPSHOT = DIAG + "p "

        /** A message from the page, or null for anything else (its "diag:" messages too: they never decide anything here). */
        fun parse(message: String?): TrailerEvent? = when {
            message == null -> null
            message == "ready" -> Ready
            message.startsWith("state:") -> code(message.substring(6))?.let(::State)
            message.startsWith("ad:") -> code(message.substring(3))?.let(::Ad)
            message.startsWith("error:") -> code(message.substring(6))?.let(::Error)
            else -> null
        }

        /**
         * A snapshot among the page's diagnostics as [Progress] stamped [atMs], or null for anything else: another kind of
         * "diag:" message, or one without both a state (`st=`, as [parse] reads codes) and a time (`t=`, digits with at
         * most one point, as the page writes it: `toFixed(2)`; empty before YouTube's player can say). An ad's state
         * (`ad=`, a code) means an ad was showing; empty or missing, none was; anything else isn't a snapshot.
         */
        fun progress(message: String?, atMs: Long): Progress? {
            if (message == null || !message.startsWith(DIAG) || message.length > 2_000) return null
            val parts = message.substring(DIAG.length).split(' ')
            if (parts.first() !in SNAPSHOTS) return null
            var state: Int? = null
            var time: Double? = null
            var ad = false
            var sized: Boolean? = null
            for (part in parts.drop(1)) {
                if (part.startsWith("rect=")) sized = sized(part.substring(5))
                else if (part.startsWith("st=")) state = code(part.substring(3))
                else if (part.startsWith("t=")) time = seconds(part.substring(2))
                else if (part.startsWith("ad=") && part.length > 3) {
                    code(part.substring(3)) ?: return null
                    ad = true
                }
            }
            return if (state != null && time != null) Progress(state, time, atMs, ad, sized) else null
        }

        /**
         * Whether the player's frame has a size, from the page's `rect=left,top,width,height` (whole CSS pixels): false
         * when its width or height is 0 (it plays unseen), null when the page couldn't say ("none", or anything else).
         */
        private fun sized(text: String): Boolean? {
            val sides = text.split(',')
            if (sides.size != 4) return null
            val width = code(sides[2]) ?: return null
            val height = code(sides[3]) ?: return null
            return width > 0 && height > 0
        }

        /** An optional minus and one to six ASCII digits. */
        private fun code(text: String): Int? {
            val digits = text.removePrefix("-")
            if (digits.isEmpty() || digits.length > 6 || digits.any { it !in '0'..'9' }) return null
            return text.toInt()
        }

        /** ASCII digits with at most one point between them (no sign, exponent, NaN or Infinity), 12 characters at most. */
        private fun seconds(text: String): Double? {
            if (text.isEmpty() || text.length > 12 || text.first() == '.' || text.last() == '.') return null
            if (text.any { it != '.' && it !in '0'..'9' } || text.count { it == '.' } > 1) return null
            return text.toDouble()
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
    /**
     * The player is ready: Tuner's "Loading trailer" goes ([TrailerPolicy.showsLoading]), and once a frame without it
     * is drawn the app starts the trailer ([TrailerPolicy.startsOnceShown]).
     */
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
 *
 * The viewer is never left on a black screen: once ready, a trailer that hasn't played (state 1, its own or an ad's:
 * [plays]) after [PLAYING_TIMEOUT_MS] falls back the same way ([onPlayingTimer]), unless the viewer paused it or the
 * app did; each command from the viewer starts that count again. One whose time stands still while it says it plays,
 * or buffers for long after it played, or whose page stops talking while it plays, falls back too ([TrailerStall]).
 * Tuner's "Loading trailer" covers the page only while it loads, until YouTube's player is ready ([showsLoading]); the
 * app then starts the trailer once a frame without it is drawn ([startsOnceShown]), so it never plays out of view, and
 * a trailer the app paused before it played or the viewer touched it plays on when the app is back ([playsOnReturn]).
 */
object TrailerPolicy {
    const val READY_TIMEOUT_MS = 12_000L
    /**
     * After ready, or the viewer's last command, how long a trailer may take to play (YouTube's state 1) before it goes
     * to the YouTube app.
     */
    const val PLAYING_TIMEOUT_MS = 10_000L
    /**
     * How long a playing trailer's time may stand still, or its page say nothing, before it goes to the YouTube app
     * ([TrailerStall]).
     */
    const val STALL_TIMEOUT_MS = 10_000L
    /**
     * How long YouTube's player may play or buffer in a frame with no size (the page's snapshots say its width or
     * height is 0, so nothing of it shows) before the trailer goes to the YouTube app ([TrailerStall]).
     */
    const val UNSEEN_TIMEOUT_MS = 4_000L
    /** How long a trailer that played may buffer with its time standing still before it goes to the YouTube app ([TrailerStall]). */
    const val BUFFERING_TIMEOUT_MS = 30_000L
    /** YouTube's error for a video it doesn't have (removed, or private). */
    const val NOT_FOUND = 100
    /** The codes YouTube documents, and the app's own. */
    val KNOWN_ERRORS = setOf(TrailerEvent.API_FAILED, TrailerEvent.RENDERER_GONE, 2, 5, NOT_FOUND, 101, 150, 152, 153)

    fun on(event: TrailerEvent, ready: Boolean): TrailerStep = when (event) {
        TrailerEvent.Ready -> if (ready) TrailerStep.WAIT else TrailerStep.SHOW
        is TrailerEvent.State -> if (event.code == TrailerEvent.ENDED && ready) TrailerStep.CLOSE else TrailerStep.WAIT
        // An ad ending is not the trailer ending: the trailer follows it.
        is TrailerEvent.Ad -> TrailerStep.WAIT
        is TrailerEvent.Error -> if (event.code == NOT_FOUND) TrailerStep.UNAVAILABLE else TrailerStep.FALL_BACK
        TrailerEvent.Left -> TrailerStep.CLOSE
        is TrailerEvent.Progress -> TrailerStep.WAIT
    }

    /**
     * Whether [event] says YouTube's player plays: the trailer (state 1), or an ad of YouTube's before or in it, which
     * YouTube reports apart ([TrailerEvent.Ad]). Either way YouTube's player is showing something: the trailer needn't
     * start yet.
     */
    fun plays(event: TrailerEvent): Boolean =
        (event is TrailerEvent.State && event.code == TrailerEvent.PLAYING) || (event is TrailerEvent.Ad && event.code == TrailerEvent.PLAYING)

    /** [elapsedMs] after the player opened: a player that still isn't ready falls back. */
    fun onTimer(ready: Boolean, elapsedMs: Long): TrailerStep =
        if (!ready && elapsedMs >= READY_TIMEOUT_MS) TrailerStep.FALL_BACK else TrailerStep.WAIT

    /**
     * [sinceMs] after the player got ready, or after the viewer's last command (each one starts the count again), an
     * ad of YouTube's stopped playing, or the app came back and the trailer played on ([playsOnReturn]): a trailer that
     * hasn't [played] and isn't playing an ad (YouTube never said state 1: a picture that never came, playback refused,
     * endless buffering) falls back, unless the viewer paused it ([viewerPaused]: a command of theirs left it paused, and
     * it waits for OK) or the app did ([appPaused]: it paused it, or is paused). A seek, or OK while it buffers, never
     * keeps a trailer that doesn't play from falling back.
     */
    fun onPlayingTimer(sinceMs: Long, played: Boolean, viewerPaused: Boolean, appPaused: Boolean): TrailerStep =
        if (!played && !viewerPaused && !appPaused && sinceMs >= PLAYING_TIMEOUT_MS) TrailerStep.FALL_BACK else TrailerStep.WAIT

    /**
     * Whether Tuner's "Loading trailer" (the name and the remote's keys) is drawn over the player's WebView: while the
     * page loads, until YouTube's player is [ready]. A cold web engine that paints nothing for a while never shows as a
     * black screen, and once the player is ready nothing of Tuner's is in front of it (YouTube's Required Minimum
     * Functionality, "Overlays and frames"): the trailer starts only once it is in view ([startsOnceShown]).
     */
    fun showsLoading(ready: Boolean): Boolean = !ready

    /**
     * Once the ready player is in view (a frame without "Loading trailer" has been drawn): whether the app starts the
     * trailer ([TrailerCommand.PLAY]; the page doesn't autoplay). Not when the app [held] it or is [appPaused] (it
     * starts when the app is back: [playsOnReturn]), when the app has [started] it already (it came back meanwhile), nor
     * when it has already [played] (or an ad has) or the viewer has [commanded] it (the viewer's choice stands).
     * YouTube's Required Minimum Functionality ("Autoplay and scripted playbacks") forbids starting a playback before
     * more than half of the player is visible.
     */
    fun startsOnceShown(held: Boolean, appPaused: Boolean, started: Boolean, played: Boolean, commanded: Boolean): Boolean =
        !held && !appPaused && !started && !played && !commanded

    /**
     * When the app is back after it [held] (paused) the ready trailer (a voice assistant or the settings panel came over
     * it): whether the trailer plays on. One that hasn't [played] (nor an ad) and that the viewer hasn't [commanded]
     * does, as it would have started ([startsOnceShown]), so it plays or falls back ([onPlayingTimer]) instead of
     * waiting, paused, for nothing; one the viewer has seen play or has controlled waits, paused, for OK.
     */
    fun playsOnReturn(held: Boolean, played: Boolean, commanded: Boolean): Boolean = held && !played && !commanded

    /** No WebView could be made (none installed, disabled or updating). */
    fun withoutWebView(): TrailerStep = TrailerStep.FALL_BACK
}

/**
 * The stall check ([TrailerPolicy]), from the page's snapshots ([TrailerEvent.Progress], every 2 seconds for as long
 * as the page lives, and on every state change), stamped by the app's clock ([TrailerEvent.Progress.atMs]). The trailer
 * goes to the YouTube app when
 * - YouTube says it plays (state 1) and every snapshot for [TrailerPolicy.STALL_TIMEOUT_MS] has the same time. While
 *   it plays, YouTube's API adds up to a second to the time its player last reported, so a time that stands still
 *   reads the same at every snapshot (that time plus 1; at 0 that is 1.00): only the snapshot taken with a state change
 *   reads the reported time itself;
 * - once it has played, it buffers (state 3) with the same time for [TrailerPolicy.BUFFERING_TIMEOUT_MS] (a short wait
 *   for data is normal; this long, the picture has stopped);
 * - the last snapshot said it plays or buffers as above and the page has sent none for [TrailerPolicy.STALL_TIMEOUT_MS]
 *   ([onClock]: its renderer hung);
 * - YouTube's player (the trailer or an ad) plays or buffers in a frame with no size for
 *   [TrailerPolicy.UNSEEN_TIMEOUT_MS]: it plays where nothing shows. A snapshot that can't say (the short one) changes
 *   nothing; one with a size starts the count again.
 * Any other snapshot, a different state or time (a seek too), an ad of YouTube's (its time is the trailer's, standing
 * still meanwhile) or the app being paused starts the count again. Main thread only.
 */
class TrailerStall {
    private var state = NONE
    private var time = -1.0
    private var since = 0L
    /** A snapshot has said the trailer itself plays. */
    private var played = false
    /** When the last snapshot that counts arrived, or -1 when the last one didn't count. */
    private var lastAt = -1L
    /** Since when the player has played or buffered in a frame with no size, or -1. */
    private var unseenSince = -1L

    fun on(sample: TrailerEvent.Progress, appPaused: Boolean): TrailerStep {
        if (!sample.ad && sample.state == TrailerEvent.PLAYING) played = true
        val active = sample.ad || sample.state == TrailerEvent.PLAYING || sample.state == TrailerEvent.BUFFERING
        if (appPaused || !active || sample.sized == true) unseenSince = -1L
        else if (sample.sized == false) {
            if (unseenSince < 0L) unseenSince = sample.atMs
            else if (sample.atMs - unseenSince >= TrailerPolicy.UNSEEN_TIMEOUT_MS) return TrailerStep.FALL_BACK
        }
        val counts = !appPaused && !sample.ad &&
            (sample.state == TrailerEvent.PLAYING || (sample.state == TrailerEvent.BUFFERING && played))
        if (!counts) {
            state = NONE
            lastAt = -1L
            return TrailerStep.WAIT
        }
        lastAt = sample.atMs
        if (sample.state != state || sample.time != time) {
            state = sample.state
            time = sample.time
            since = sample.atMs
            return TrailerStep.WAIT
        }
        val limit = if (state == TrailerEvent.PLAYING) TrailerPolicy.STALL_TIMEOUT_MS else TrailerPolicy.BUFFERING_TIMEOUT_MS
        return if (sample.atMs - since >= limit) TrailerStep.FALL_BACK else TrailerStep.WAIT
    }

    /**
     * The app's clock at [nowMs] (the snapshots' clock), every couple of seconds: a trailer whose last snapshot counted
     * (it plays, or buffers after it played) and whose page has sent none since for [TrailerPolicy.STALL_TIMEOUT_MS]
     * falls back. While [appPaused] nothing counts (the page may be paused too), and the count starts again.
     */
    fun onClock(nowMs: Long, appPaused: Boolean): TrailerStep {
        if (appPaused) {
            state = NONE
            lastAt = -1L
            return TrailerStep.WAIT
        }
        return if (lastAt >= 0L && nowMs - lastAt >= TrailerPolicy.STALL_TIMEOUT_MS) TrailerStep.FALL_BACK else TrailerStep.WAIT
    }

    private companion object {
        const val NONE = Int.MIN_VALUE
    }
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

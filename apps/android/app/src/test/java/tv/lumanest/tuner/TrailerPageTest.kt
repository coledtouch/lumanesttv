package tv.lumanest.tuner

import android.view.KeyEvent
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import tv.lumanest.tuner.data.ExtrasApi
import tv.lumanest.tuner.ui.TrailerCommand
import tv.lumanest.tuner.ui.TrailerEvent
import tv.lumanest.tuner.ui.TrailerKey
import tv.lumanest.tuner.ui.TrailerPage
import tv.lumanest.tuner.ui.TrailerPolicy
import tv.lumanest.tuner.ui.TrailerStall
import tv.lumanest.tuner.ui.TrailerStep

/** The in-app trailer player's page, the WebView's rules, and the player's decisions (docs/extras.md, Android). */
class TrailerPageTest {
    private val key = "L0fw0WzFaBM"
    private val page = TrailerPage.html(key)!!

    // ------------------------------------------------------------------ the page

    @Test fun theKeyIsThePagesOnlyVariablePart() {
        assertEquals(1, page.split(key).size - 1)
        assertTrue(page.contains("var key=\"$key\","))
        // Any two keys give the same page apart from the key.
        val other = "vKQi3bBA1y8"
        assertEquals(TrailerPage.html(other), page.replace(key, other))
        assertEquals(TrailerPage.html("-_aZ09-_aZ0"), page.replace(key, "-_aZ09-_aZ0"))
    }

    @Test fun anythingButAYouTubeKeyMakesNoPage() {
        listOf(
            "", "L0fw0WzFaB", "L0fw0WzFaBMx", "L0fw0WzFa\"M", "L0fw0WzF\\\"M", "</script>x", "L0fw0WzFa'M", "L0fw0WzFa M",
            "L0fw0WzFa+M", "L0fw0WzFa;M", "L0fw0WzFa<M", "L0fw0WzFa\nM", "L0fw0WzFa\u0000M", "L0fw0WzFa\u0661M",
            "L0fw0WzFa\u2028M", "\u0130L0fw0WzFaB", "\"+alert(1)+\"",
        ).forEach { bad -> assertNull(bad, TrailerPage.html(bad)) }
        // The same check as every other link to the trailer.
        assertTrue(ExtrasApi.isYouTubeKey(key))
    }

    @Test fun thePageAsksYouTubeForAnEmbedFromTheAppThatPlaysOnlyWhenTheAppSaysSo() {
        val origin = "https://" + BuildConfig.APPLICATION_ID
        listOf(
            "host:\"https://www.youtube-nocookie.com\"", "videoId:key",
            "autoplay:0", "playsinline:1", "rel:0", "controls:1", "enablejsapi:1", "fs:0",
            "origin:\"$origin\"", "s.src=\"https://www.youtube.com/iframe_api\"",
            "<meta name=\"referrer\" content=\"strict-origin-when-cross-origin\">",
            "onReady:function(e){send(\"ready\");snap(\"ready\")}",
            "onStateChange:function(e){ad=null;send(\"state:\"+e.data);snap(\"state\")}", "onError:function(e){send(\"error:\"+e.data);snap(\"error\")}",
            "s.onerror=function(){send(\"error:-1\")}",
        ).forEach { assertTrue(it, page.contains(it)) }
        // Nothing plays by itself: not at ready (no autoplay, no playVideo), only the app's "play" or "toggle" once the
        // player is in view (YouTube's Required Minimum Functionality, "Autoplay and scripted playbacks").
        assertFalse(page.contains("autoplay:1"))
        assertFalse(page.contains("e.target.playVideo"))
        assertEquals(2, page.split("playVideo()").size - 1)
        // The page's origin is the app's id, as YouTube asks of a WebView app: the origin YouTube is told and the only
        // one the app's port goes to. The direct edition is tv.lumanest.tuner, the store edition app.tunertv.
        assertTrue(BuildConfig.APPLICATION_ID, BuildConfig.APPLICATION_ID in setOf("tv.lumanest.tuner", "app.tunertv"))
        assertEquals(if (BuildConfig.STORE_BUILD) "https://app.tunertv" else "https://tv.lumanest.tuner", TrailerPage.ORIGIN)
        assertEquals("$origin/", TrailerPage.BASE_URL)
        assertEquals(TrailerPage.BASE_URL, TrailerPage.ORIGIN + "/")
        // No other address is in the page: not lumanest.tv's.
        val urls = Regex("https?://[A-Za-z0-9.\\-]+(/[A-Za-z_]*)?").findAll(page).map { it.value }.toSet()
        assertEquals(setOf("https://www.youtube-nocookie.com", "https://www.youtube.com/iframe_api", origin), urls)
    }

    @Test fun thePageIsLaidOutAtTheScreensOwnWidthSoYouTubeSeesTheScreensPixels() {
        // On a TV whose interface is 1080p at density 2 (an onn 4K Pro), the player is 960 by 540 CSS pixels at a pixel
        // ratio of 2: YouTube sees 1920 by 1080 and picks up to 1080p. 1.8.1's width=1920 made it 3840 by 2160 (4K),
        // whose frames that TV's WebView never showed: a black screen.
        assertEquals("width=device-width,initial-scale=1", TrailerPage.VIEWPORT)
        assertTrue(page.contains("<head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">"))
        assertEquals(1, page.split("name=\"viewport\"").size - 1)
        assertFalse(page.contains("1920"))
        // The player fills the page, so it is the screen's size.
        assertTrue(page.contains("#player{position:absolute;left:0;top:0;width:100%;height:100%;border:0}"))
        assertTrue(page.contains("width:\"100%\",height:\"100%\""))
    }

    @Test fun youTubesApiLoadsOnlyAfterThePagesOwnLoadSoThePortComesAtOnce() {
        // The app sends its port when the page has loaded (onPageFinished). A script added while the page loads, and the
        // embed frame it makes, would hold that until YouTube's whole embed had loaded: its images and fonts too.
        assertTrue(page.contains("window.addEventListener(\"load\",function(){\n document.head.appendChild(s);\n"))
        assertEquals(1, page.split("appendChild(").size - 1)
        // Nothing else in the page loads anything: no other script, frame, image, style sheet or font.
        listOf("<script src", "<iframe", "<img", "<link", "@import", "url(").forEach { assertFalse(it, page.contains(it)) }
        assertEquals(1, page.split("<script").size - 1)
    }

    @Test fun thePageSaysLoadingTrailerUnderThePlayerUntilYouTubePaintsOverIt() {
        // Under the player's element, which YouTube's frame replaces and paints over (later in the page, and nothing
        // raised): nothing of Tuner's is in front of YouTube's player, and the screen isn't blank until it paints.
        assertTrue(page.contains("<body><div id=\"wait\">Loading trailer<div>${TrailerPage.KEYS}</div></div><div id=\"player\"></div><script>"))
        assertFalse(page.contains("z-index"))
        assertTrue(page.contains("#wait div{font-weight:400;font-size:26px;line-height:44px;color:#b3b3b3;white-space:pre}"))
        assertEquals("Loading trailer", TrailerPage.LOADING)
        // The keys' text is plain: nothing to escape in the page.
        assertTrue(TrailerPage.KEYS.all { it in 'A'..'Z' || it in 'a'..'z' || it in '0'..'9' || it == ' ' })
    }

    @Test fun thePageTakesThePortOnlyFromTheAppAndOnlyOnce() {
        assertTrue(page.contains(
            "if(port||e.data!==\"tuner:port\"||!e.ports||e.ports.length!==1||(e.source!==null&&e.source!==window))return;"))
        assertEquals("tuner:port", TrailerPage.PORT_MESSAGE)
        // Events wait for the port.
        assertTrue(page.contains("function send(m){if(port)port.postMessage(m);else queue.push(m)}"))
    }

    @Test fun everyCommandIsOneThePageKnows() {
        TrailerCommand.entries.forEach { assertTrue(it.name, page.contains("c===\"${it.message}\"")) }
        assertEquals(listOf("toggle", "play", "pause", "back", "forward"), TrailerCommand.entries.map { it.message })
        // Back and forward are 10 seconds, never before the start or past the last second.
        assertTrue(page.contains("var t=player.getCurrentTime()+(c===\"back\"?-10:10),d=player.getDuration();"))
        assertTrue(page.contains("if(d>0&&t>d-1)t=d-1;"))
        assertTrue(page.contains("player.seekTo(t<0?0:t,true)"))
    }

    @Test fun anAdOfYouTubesIsReportedApartAndTheRemoteDrivesItWithoutSeeking() {
        // YouTube's embed publishes the states of an ad it shows (one not stitched into the video) as onAdStateChange,
        // never onStateChange: the page passes them on as "ad:" and keeps the ad's state while it shows (0, ended, or
        // any state of the trailer's means none shows).
        assertTrue(page.contains(
            "onAdStateChange:function(e){ad=typeof e.data===\"number\"&&e.data!==0?e.data:null;send(\"ad:\"+e.data);snap(\"ad\")},"))
        assertTrue(page.contains("onStateChange:function(e){ad=null;"))
        assertTrue(page.contains(",counting=true,ad=null;\n"))
        // OK pauses or plays the ad while it shows (YouTube's state for the trailer is then its own, not the ad's), and
        // Left and Right never seek past it.
        assertTrue(page.contains(" var s=ad!==null?ad:player.getPlayerState();\n if(c===\"toggle\"){if(s===1||s===3)player.pauseVideo();else player.playVideo()}"))
        assertTrue(page.contains(" else if(ad===null&&(c===\"back\"||c===\"forward\")){"))
        assertEquals(1, page.split("seekTo(").size - 1)
    }

    @Test fun thePageReportsOnItselfForTheLog() {
        // At its load event: the WebView's user agent, the codecs its MediaSource takes, HDR and the screen.
        listOf(
            "send(\"diag:ua \"+navigator.userAgent);", "send(media());", "o=\"diag:media\"", "m.isTypeSupported(c[i][1])",
            "[\"vp9\",'video/webm; codecs=\"vp9\"']", "[\"av1\",'video/mp4; codecs=\"av01.0.08M.08\"']",
            "[\"h264\",'video/mp4; codecs=\"avc1.640028\"']", "window.matchMedia(\"(dynamic-range: high)\")",
            "\" screen=\"+screen.width+\"x\"+screen.height",
        ).forEach { assertTrue(it, page.contains(it)) }
        // A snapshot at load, ready, every state change (an ad's too) and error, then every 2 seconds for 30 seconds,
        // then a short one (state, time and ad: the stall check's) every 2 seconds for as long as the page lives.
        assertTrue(page.contains(
            " snap(\"load\");\n var n=0;setInterval(function(){if(n<15){snap(\"tick\");if(++n>=15)counting=false}else send(\"diag:p\"+now())},2000)});"))
        assertTrue(page.contains(
            "function now(){return \" st=\"+call(\"getPlayerState\")+\" t=\"+num(call(\"getCurrentTime\"),2)+\" ad=\"+(ad===null?\"\":ad)}"))
        assertTrue(page.contains("+\n  now()+\" lf=\"+"))
        assertFalse(page.contains("clearInterval"))
        assertEquals(2_000, TrailerPage.DIAG_EVERY_MS)
        assertEquals(30_000, TrailerPage.DIAG_EVERY_MS * TrailerPage.DIAG_TICKS)
        // Frames painted (counted only those 30 seconds: a frame request every frame for the whole trailer would keep the
        // WebView drawing), visibility, the window, the player's frame and what YouTube says it plays.
        assertTrue(page.contains("function count(){frames++;if(counting)window.requestAnimationFrame(count)}\nwindow.requestAnimationFrame(count);"))
        assertTrue(page.contains(",frames=0,counting=true,ad=null;\n"))
        listOf(
            "\" raf=\"+frames", "\" vis=\"+document.visibilityState", "\" w=\"+window.innerWidth", "\" h=\"+window.innerHeight",
            "\" dpr=\"+window.devicePixelRatio", "call(\"getIframe\")", "\" rect=\"+(r?Math.round(r.left)", "\" st=\"+call(\"getPlayerState\")",
            "\" t=\"+num(call(\"getCurrentTime\"),2)", "\" lf=\"+num(call(\"getVideoLoadedFraction\"),3)",
            "\" q=\"+call(\"getPlaybackQuality\")", "\" levels=\"+(l&&l.join?l.join(\",\"):\"\")",
        ).forEach { assertTrue(it, page.contains(it)) }
        // A player method that is missing or throws never stops the page.
        assertTrue(page.contains("function call(n){try{return player&&player[n]?player[n]():\"\"}catch(x){return \"x\"}}"))
        // Nothing of the viewer's: the key is still the page's only variable part, written once.
        assertEquals(1, page.split(key).size - 1)
    }

    @Test fun thePagesDiagnosticsDecideNothingButTheStallCheckReadsItsSnapshots() {
        val tick = "diag:tick raf=120 vis=visible w=960 h=540 dpr=2 rect=0,0,960,540 st=1 t=12.50 ad= lf=0.250 q=hd1080 levels=hd1080,hd720,auto"
        listOf(tick, "diag:ua Mozilla/5.0 (Linux; Android 12) Chrome/131.0 st=1 t=3", "diag:media vp9=true av1=false", "diag:",
            "diag:p st=1 t=40.00 ad=", "diag:ad st=-1 t=0.00 ad=1").forEach {
            assertNull(it, TrailerEvent.parse(it))
        }
        assertEquals(TrailerEvent.Progress(1, 12.5, 77L), TrailerEvent.progress(tick, 77L))
        // The short one after 30 seconds, and one while an ad of YouTube's shows (the state is then the trailer's).
        assertEquals(TrailerEvent.Progress(1, 40.0, 9L), TrailerEvent.progress("diag:p st=1 t=40.00 ad=", 9L))
        assertEquals(TrailerEvent.Progress(-1, 0.0, 9L, ad = true), TrailerEvent.progress("diag:ad raf=3 st=-1 t=0.00 ad=1 lf=0.000", 9L))
        assertEquals(TrailerEvent.Progress(1, 8.0, 9L, ad = true), TrailerEvent.progress("diag:p st=1 t=8.00 ad=2", 9L))
        assertEquals(TrailerEvent.Progress(1, 8.0, 9L, ad = true), TrailerEvent.progress("diag:p st=1 t=8.00 ad=-1", 9L))
        assertEquals(TrailerEvent.Progress(3, 0.0, 5L), TrailerEvent.progress("diag:ready raf=1 st=3 t=0.00 lf=0.000", 5L))
        assertEquals(TrailerEvent.Progress(-1, 0.0, 5L), TrailerEvent.progress("diag:load raf=1 st=-1 t=0", 5L))
        listOf("state", "error").forEach { assertEquals(it, TrailerEvent.Progress(2, 4.0, 1L), TrailerEvent.progress("diag:$it st=2 t=4.00", 1L)) }
        // Only snapshots with both a state and a time, written as the page writes them.
        listOf(
            null, "", "tick st=1 t=1.00", "diag:ua st=1 t=1.00", "diag:media st=1 t=1.00", "diag:tick st=1", "diag:tick t=1.00",
            "diag:tick st= t=", "diag:tick st=1 t=", "diag:tick st=x t=1.00", "diag:tick st=1 t=-1.00", "diag:tick st=1 t=1e3",
            "diag:tick st=1 t=NaN", "diag:tick st=1 t=Infinity", "diag:tick st=1 t=1..0", "diag:tick st=1 t=.5", "diag:tick st=1 t=5.",
            "diag:tick st=1 t=1.0.0", "diag:tick st=1 t=+1.00", "diag:tick st=1 t=1234567890123", "diag:tick st=1234567 t=1.00",
            "diag:TICK st=1 t=1.00", "diag:tick  st=1 t=\u0661", "ready", "state:1", "diag:tick st=1 t=1.00" + " ".repeat(2_000),
            "diag:p st=1 t=1.00 ad=x", "diag:p st=1 t=1.00 ad=1.0", "diag:p st=1 t=1.00 ad=undefined", "diag:P st=1 t=1.00", "ad:1",
        ).forEach { assertNull("$it", TrailerEvent.progress(it, 0L)) }
        assertEquals("diag:", TrailerEvent.DIAG)
        assertEquals(setOf("load", "ready", "state", "ad", "error", "tick", "p"), TrailerEvent.SNAPSHOTS)
        // A snapshot never decides anything by itself.
        assertEquals(TrailerStep.WAIT, TrailerPolicy.on(TrailerEvent.Progress(1, 1.0, 0L), ready = true))
        assertEquals(TrailerStep.WAIT, TrailerPolicy.on(TrailerEvent.Progress(-1, 0.0, 99_000L), ready = false))
    }

    // ------------------------------------------------------------------ what the WebView loads

    @Test fun thePlayersFramesComeFromYouTubeAndGoogleOnly() {
        listOf(
            "www.youtube.com", "youtube.com", "www.youtube-nocookie.com", "i.ytimg.com", "rr2---sn-2oaig5-5m.googlevideo.com",
            "yt3.ggpht.com", "www.google.com", "www.gstatic.com", "fonts.gstatic.com", "ssl.gstatic.com", "jnn-pa.googleapis.com",
            "WWW.YouTube.COM", "www.youtube.com.",
            // Google's ad servers: YouTube may show an ad before the trailer, and its ads must not be blocked.
            "googleads.g.doubleclick.net", "static.doubleclick.net", "pagead2.googlesyndication.com", "www.googleadservices.com",
            "www.googletagservices.com", "s0.2mdn.net",
        ).forEach { assertTrue(it, TrailerPage.allows("https", it)) }
        listOf(
            "lumanest.tv", "youtube.com.evil.example", "evilyoutube.com", "notgoogle.com", "google.com.example",
            "doubleclick.net.example", "example.com", "", "youtube", "com",
        ).forEach { assertFalse(it, TrailerPage.allows("https", it)) }
        assertFalse(TrailerPage.allows("http", "www.youtube.com"))
        assertFalse(TrailerPage.allows("HTTP", "www.youtube.com"))
        assertTrue(TrailerPage.allows("HTTPS", "www.youtube.com"))
        assertFalse(TrailerPage.allows(null, "www.youtube.com"))
        assertFalse(TrailerPage.allows("https", null))
        listOf("file", "content", "javascript", "intent", "market", "vnd.youtube", "about").forEach {
            assertFalse(it, TrailerPage.allows(it, "www.youtube.com"))
            assertFalse(it, TrailerPage.allowsRequest(it, "www.youtube.com"))
        }
        // The page's own data: and blob: (video buffers) never leave the device.
        assertTrue(TrailerPage.allowsRequest("data", null))
        assertTrue(TrailerPage.allowsRequest("blob", "www.youtube-nocookie.com"))
        // Nothing the player asks for over https is blocked (YouTube's API policies forbid blocking any part of its
        // player or its ads, including an ad's measurement); nothing goes out unencrypted.
        listOf("i.ytimg.com", "googleads.g.doubleclick.net", "pixel.adsafeprotected.com", "example.com").forEach {
            assertTrue(it, TrailerPage.allowsRequest("https", it))
            assertTrue(it, TrailerPage.allowsRequest("HTTPS", it))
            assertFalse(it, TrailerPage.allowsRequest("http", it))
        }
        assertFalse(TrailerPage.allowsRequest("https", null))
        assertFalse(TrailerPage.allowsRequest("https", ""))
        assertFalse(TrailerPage.allowsRequest(null, "www.youtube.com"))
    }

    @Test fun thePageNeverNavigatesAndAFrameWebViewAsksAboutMustGoToThePlayersHosts() {
        // WebView asks about a frame only when it goes to another scheme than http(s) (refused here whatever the host):
        // https frames load from any host without asking, as requests do.
        // The player's YouTube logo or title link: the page would leave the trailer (and could open a browser).
        assertFalse(TrailerPage.allowsNavigation(mainFrame = true, "https", "www.youtube.com"))
        assertFalse(TrailerPage.allowsNavigation(mainFrame = true, "https", "lumanest.tv"))
        assertTrue(TrailerPage.allowsNavigation(mainFrame = false, "https", "www.youtube-nocookie.com"))
        assertFalse(TrailerPage.allowsNavigation(mainFrame = false, "https", "example.com"))
        assertFalse(TrailerPage.allowsNavigation(mainFrame = false, "intent", "www.youtube.com"))
        assertFalse(TrailerPage.allowsNavigation(mainFrame = false, "http", "www.youtube.com"))
        // An ad's frame from Google's ad servers may load inside the player.
        assertTrue(TrailerPage.allowsNavigation(mainFrame = false, "https", "googleads.g.doubleclick.net"))
        assertFalse(TrailerPage.allowsNavigation(mainFrame = true, "https", "googleads.g.doubleclick.net"))
    }

    @Test fun onlyYouTubesOwnLinksInThePlayerOpenTheYouTubeApp() {
        listOf(
            "www.youtube.com", "youtube.com", "m.youtube.com", "WWW.YouTube.COM", "www.youtube.com.", "www.youtube-nocookie.com",
            "youtu.be", "www.youtu.be", "YOUTU.BE",
        ).forEach { assertTrue(it, TrailerPage.opensInYouTube("https", it)) }
        assertTrue(TrailerPage.opensInYouTube("HTTPS", "www.youtube.com"))
        // Google's other hosts (ads, sign-in, redirects) and look-alikes open nothing.
        listOf(
            "www.google.com", "accounts.google.com", "googleads.g.doubleclick.net", "i.ytimg.com", "youtube.com.evil.example",
            "evilyoutube.com", "notyoutu.be", "youtu.be.example", "lumanest.tv", "", "youtube",
        ).forEach { assertFalse(it, TrailerPage.opensInYouTube("https", it)) }
        assertFalse(TrailerPage.opensInYouTube("https", null))
        listOf(null, "http", "intent", "vnd.youtube", "javascript", "market").forEach {
            assertFalse("$it", TrailerPage.opensInYouTube(it, "www.youtube.com"))
        }
    }

    // ------------------------------------------------------------------ events and decisions

    @Test fun thePagesMessagesAreReadStrictly() {
        assertEquals(TrailerEvent.Ready, TrailerEvent.parse("ready"))
        assertEquals(TrailerEvent.State(1), TrailerEvent.parse("state:1"))
        assertEquals(TrailerEvent.State(-1), TrailerEvent.parse("state:-1"))
        assertEquals(TrailerEvent.Error(150), TrailerEvent.parse("error:150"))
        assertEquals(TrailerEvent.Error(-1), TrailerEvent.parse("error:-1"))
        assertEquals(TrailerEvent.Ad(1), TrailerEvent.parse("ad:1"))
        assertEquals(TrailerEvent.Ad(-1), TrailerEvent.parse("ad:-1"))
        assertEquals(TrailerEvent.Ad(0), TrailerEvent.parse("ad:0"))
        listOf(null, "", "Ready", "ready ", "state:", "state:-", "state:1.0", "state: 1", "state:+1", "error:1e3", "error:9999999",
            "error:\u0661", "tuner:port", "{\"event\":\"onReady\"}", "ad:", "ad:undefined", "ad: 1", "Ad:1", "ad:1.0").forEach {
            assertNull("$it", TrailerEvent.parse(it))
        }
    }

    @Test fun anyOtherErrorAWaitTooLongOrNoWebViewFallsBackToTheYouTubeApp() {
        assertEquals(setOf(-1, -2, 2, 5, 100, 101, 150, 152, 153), TrailerPolicy.KNOWN_ERRORS)
        // 100: YouTube has no such video (removed, or private). The YouTube app couldn't play it either.
        assertEquals(100, TrailerPolicy.NOT_FOUND)
        assertEquals(TrailerStep.UNAVAILABLE, TrailerPolicy.on(TrailerEvent.Error(100), ready = false))
        assertEquals(TrailerStep.UNAVAILABLE, TrailerPolicy.on(TrailerEvent.Error(100), ready = true))
        (TrailerPolicy.KNOWN_ERRORS - 100 + listOf(0, 1, 154, 999_999)).forEach { code ->
            assertEquals("$code", TrailerStep.FALL_BACK, TrailerPolicy.on(TrailerEvent.Error(code), ready = false))
            assertEquals("$code", TrailerStep.FALL_BACK, TrailerPolicy.on(TrailerEvent.Error(code), ready = true))
        }
        assertEquals(TrailerStep.WAIT, TrailerPolicy.onTimer(ready = false, elapsedMs = 11_999))
        assertEquals(TrailerStep.FALL_BACK, TrailerPolicy.onTimer(ready = false, elapsedMs = 12_000))
        assertEquals(TrailerStep.WAIT, TrailerPolicy.onTimer(ready = true, elapsedMs = 60_000))
        assertEquals(12_000L, TrailerPolicy.READY_TIMEOUT_MS)
        assertEquals(TrailerStep.FALL_BACK, TrailerPolicy.withoutWebView())
    }

    @Test fun readyShowsThePlayerAndTheEndClosesIt() {
        assertEquals(TrailerStep.SHOW, TrailerPolicy.on(TrailerEvent.Ready, ready = false))
        assertEquals(TrailerStep.WAIT, TrailerPolicy.on(TrailerEvent.Ready, ready = true))
        assertEquals(TrailerStep.CLOSE, TrailerPolicy.on(TrailerEvent.State(TrailerEvent.ENDED), ready = true))
        listOf(-1, 1, 2, 3, 5).forEach { assertEquals("$it", TrailerStep.WAIT, TrailerPolicy.on(TrailerEvent.State(it), ready = true)) }
        // An ad's end isn't the trailer's: the trailer follows it.
        listOf(-1, 0, 1, 2, 3, 5).forEach {
            assertEquals("$it", TrailerStep.WAIT, TrailerPolicy.on(TrailerEvent.Ad(it), ready = true))
            assertEquals("$it", TrailerStep.WAIT, TrailerPolicy.on(TrailerEvent.Ad(it), ready = false))
        }
        // A link the viewer followed opened the YouTube app: the player closes, ready or not. The page can't say so.
        assertEquals(TrailerStep.CLOSE, TrailerPolicy.on(TrailerEvent.Left, ready = true))
        assertEquals(TrailerStep.CLOSE, TrailerPolicy.on(TrailerEvent.Left, ready = false))
        listOf("left", "Left").forEach { assertNull(it, TrailerEvent.parse(it)) }
    }

    @Test fun aReadyTrailerThatDoesntPlayWithinTenSecondsGoesToTheYouTubeAppUnlessTheViewerOrTheAppPausedIt() {
        assertEquals(10_000L, TrailerPolicy.PLAYING_TIMEOUT_MS)
        fun timer(ms: Long, played: Boolean = false, viewerPaused: Boolean = false, appPaused: Boolean = false) =
            TrailerPolicy.onPlayingTimer(ms, played, viewerPaused, appPaused)
        // Never playing (playback refused, a picture that never comes, endless buffering), 10 seconds after it got ready
        // or after the viewer's last command (a seek, OK while it buffers): never a black screen.
        assertEquals(TrailerStep.WAIT, timer(9_999))
        assertEquals(TrailerStep.FALL_BACK, timer(10_000))
        assertEquals(TrailerStep.FALL_BACK, timer(60_000))
        // It played, the viewer paused it, or the app did: it waits (for OK).
        assertEquals(TrailerStep.WAIT, timer(10_000, played = true))
        assertEquals(TrailerStep.WAIT, timer(10_000, viewerPaused = true))
        assertEquals(TrailerStep.WAIT, timer(10_000, appPaused = true))
        assertEquals(TrailerStep.WAIT, timer(60_000, played = true, viewerPaused = true, appPaused = true))
    }

    @Test fun tunersLoadingScreenCoversThePageOnlyUntilYouTubesPlayerIsReady() {
        assertTrue(TrailerPolicy.showsLoading(ready = false))
        assertFalse(TrailerPolicy.showsLoading(ready = true))
    }

    @Test fun theAppStartsTheTrailerOnceThePlayerIsInViewAndOnlyThen() {
        fun starts(held: Boolean = false, appPaused: Boolean = false, started: Boolean = false, played: Boolean = false, commanded: Boolean = false) =
            TrailerPolicy.startsOnceShown(held, appPaused, started, played, commanded)
        // Ready, "Loading trailer" gone and a frame drawn without it: the app starts the trailer (the page doesn't).
        assertTrue(starts())
        // Not while Tuner is paused or holds it (it starts when Tuner is back), not twice, and not when it already plays
        // (or an ad does) or the viewer has asked for something: their choice stands.
        assertFalse(starts(held = true))
        assertFalse(starts(appPaused = true))
        assertFalse(starts(started = true))
        assertFalse(starts(played = true))
        assertFalse(starts(commanded = true))
    }

    @Test fun anAdOfYouTubesThatPlaysCountsAsPlaying() {
        // YouTube reports its own ad apart: while it plays, nothing of Tuner's may cover it, and the trailer waits.
        assertTrue(TrailerPolicy.plays(TrailerEvent.State(TrailerEvent.PLAYING)))
        assertTrue(TrailerPolicy.plays(TrailerEvent.Ad(TrailerEvent.PLAYING)))
        listOf(-1, 0, 2, 3, 5).forEach {
            assertFalse("$it", TrailerPolicy.plays(TrailerEvent.State(it)))
            assertFalse("$it", TrailerPolicy.plays(TrailerEvent.Ad(it)))
        }
        listOf(TrailerEvent.Ready, TrailerEvent.Left, TrailerEvent.Error(1), TrailerEvent.Progress(1, 5.0, 0L)).forEach {
            assertFalse("$it", TrailerPolicy.plays(it))
        }
    }

    @Test fun aTrailerTheAppPausedBeforeTheViewerSawItPlaysOnWhenTheAppIsBack() {
        // It hadn't played and the viewer hadn't touched it: it plays on (then plays, or falls back), as it would have
        // started, never waiting, paused, for nothing.
        assertTrue(TrailerPolicy.playsOnReturn(held = true, played = false, commanded = false))
        // The viewer has seen it play, or has controlled it: it waits, paused, for OK.
        assertFalse(TrailerPolicy.playsOnReturn(held = true, played = true, commanded = false))
        assertFalse(TrailerPolicy.playsOnReturn(held = true, played = false, commanded = true))
        // The app didn't pause it: nothing to do.
        assertFalse(TrailerPolicy.playsOnReturn(held = false, played = false, commanded = false))
        assertFalse(TrailerPolicy.playsOnReturn(held = false, played = true, commanded = true))
    }

    @Test fun aTrailerThatSaysItPlaysButStandsStillForTenSecondsGoesToTheYouTubeApp() {
        assertEquals(10_000L, TrailerPolicy.STALL_TIMEOUT_MS)
        fun playing(time: Double, at: Long) = TrailerEvent.Progress(TrailerEvent.PLAYING, time, at)
        val stall = TrailerStall()
        // Moving: never.
        listOf(0L to 1.0, 2_000L to 3.0, 4_000L to 5.0, 6_000L to 7.0, 20_000L to 9.0).forEach { (at, time) ->
            assertEquals(TrailerStep.WAIT, stall.on(playing(time, at), appPaused = false))
        }
        // Standing still since 20 s (the clock is the snapshots' own): 9.99 s is not enough, 10 s is.
        assertEquals(TrailerStep.WAIT, stall.on(playing(9.0, 22_000L), appPaused = false))
        assertEquals(TrailerStep.WAIT, stall.on(playing(9.0, 29_999L), appPaused = false))
        assertEquals(TrailerStep.FALL_BACK, stall.on(playing(9.0, 30_000L), appPaused = false))

        // Any snapshot that isn't playing, a moved time (a seek, back too) or the app being paused counts again from there.
        fun fresh(vararg samples: Pair<TrailerEvent.Progress, Boolean>): List<TrailerStep> = TrailerStall().let { s -> samples.map { s.on(it.first, it.second) } }
        assertEquals(List(3) { TrailerStep.WAIT }, fresh(
            playing(4.0, 0L) to false, TrailerEvent.Progress(TrailerEvent.PAUSED, 4.0, 6_000L) to false, playing(4.0, 12_000L) to false))
        assertEquals(List(3) { TrailerStep.WAIT }, fresh(
            playing(4.0, 0L) to false, TrailerEvent.Progress(TrailerEvent.BUFFERING, 4.0, 6_000L) to false, playing(4.0, 12_000L) to false))
        assertEquals(List(3) { TrailerStep.WAIT }, fresh(playing(4.0, 0L) to false, playing(4.0, 6_000L) to true, playing(4.0, 12_000L) to false))
        assertEquals(List(3) { TrailerStep.WAIT }, fresh(playing(14.0, 0L) to false, playing(4.0, 6_000L) to false, playing(4.0, 12_000L) to false))
        assertEquals(listOf(TrailerStep.WAIT, TrailerStep.WAIT, TrailerStep.WAIT, TrailerStep.FALL_BACK), fresh(
            playing(14.0, 0L) to false, playing(4.0, 6_000L) to false, playing(4.0, 12_000L) to false, playing(4.0, 16_000L) to false))
        // A paused trailer, or one the app paused, never falls back, however long it stands.
        assertEquals(List(3) { TrailerStep.WAIT }, fresh(
            TrailerEvent.Progress(TrailerEvent.PAUSED, 4.0, 0L) to false, TrailerEvent.Progress(TrailerEvent.PAUSED, 4.0, 60_000L) to false,
            playing(4.0, 120_000L) to true))
    }

    @Test fun aTrailerStuckAtItsStartWhileItSaysItPlaysIsCaughtAsYouTubesApiReportsIt() {
        // While it plays, YouTube's API adds up to a second to the time its player last reported: a trailer that says it
        // plays but never leaves 0 reads 0.00 only in the snapshot taken with the state change, then 1.00 every time.
        fun playing(time: Double, at: Long) = TrailerEvent.Progress(TrailerEvent.PLAYING, time, at)
        val stuck = TrailerStall()
        assertEquals(TrailerStep.WAIT, stuck.on(playing(0.0, 0L), appPaused = false))
        // 10 seconds from the first 1.00.
        (1..5).forEach { assertEquals("$it", TrailerStep.WAIT, stuck.on(playing(1.0, 2_000L * it), appPaused = false)) }
        assertEquals(TrailerStep.WAIT, stuck.on(playing(1.0, 11_999L), appPaused = false))
        assertEquals(TrailerStep.FALL_BACK, stuck.on(playing(1.0, 12_000L), appPaused = false))
        // One frozen later reads its time plus 1 the same way.
        val frozen = TrailerStall()
        listOf(0L to 5.31, 2_000L to 7.0, 4_000L to 7.0, 6_000L to 7.0, 8_000L to 7.0, 10_000L to 7.0).forEach { (at, time) ->
            assertEquals("$at", TrailerStep.WAIT, frozen.on(playing(time, at), appPaused = false))
        }
        assertEquals(TrailerStep.FALL_BACK, frozen.on(playing(7.0, 12_000L), appPaused = false))
    }

    @Test fun anAdOfYouTubesNeverCountsAsAStall() {
        // While YouTube shows its own ad, the trailer's time stands still (at its start, or where an ad breaks in): the
        // snapshots say an ad shows, and the count starts again after it.
        val stall = TrailerStall()
        listOf(0L, 10_000L, 20_000L, 40_000L).forEach {
            assertEquals("$it", TrailerStep.WAIT, stall.on(TrailerEvent.Progress(TrailerEvent.PLAYING, 6.0, it, ad = true), appPaused = false))
            assertEquals("$it", TrailerStep.WAIT, stall.onClock(it + 30_000L, appPaused = false))
        }
        assertEquals(TrailerStep.WAIT, stall.on(TrailerEvent.Progress(TrailerEvent.PLAYING, 6.0, 42_000L), appPaused = false))
        assertEquals(TrailerStep.WAIT, stall.on(TrailerEvent.Progress(TrailerEvent.PLAYING, 6.0, 51_999L), appPaused = false))
        assertEquals(TrailerStep.FALL_BACK, stall.on(TrailerEvent.Progress(TrailerEvent.PLAYING, 6.0, 52_000L), appPaused = false))
    }

    @Test fun aTrailerThatBuffersForThirtySecondsAfterItPlayedGoesToTheYouTubeApp() {
        assertEquals(30_000L, TrailerPolicy.BUFFERING_TIMEOUT_MS)
        fun at(state: Int, time: Double, ms: Long, ad: Boolean = false) = TrailerEvent.Progress(state, time, ms, ad)
        val stall = TrailerStall()
        assertEquals(TrailerStep.WAIT, stall.on(at(TrailerEvent.PLAYING, 10.0, 0L), appPaused = false))
        // Buffering at 12 s from 2 s on: 29.99 s is a slow network, 30 s is a picture that stopped.
        assertEquals(TrailerStep.WAIT, stall.on(at(TrailerEvent.BUFFERING, 12.0, 2_000L), appPaused = false))
        assertEquals(TrailerStep.WAIT, stall.on(at(TrailerEvent.BUFFERING, 12.0, 20_000L), appPaused = false))
        assertEquals(TrailerStep.WAIT, stall.on(at(TrailerEvent.BUFFERING, 12.0, 31_999L), appPaused = false))
        assertEquals(TrailerStep.FALL_BACK, stall.on(at(TrailerEvent.BUFFERING, 12.0, 32_000L), appPaused = false))
        fun fresh(vararg samples: TrailerEvent.Progress): List<TrailerStep> = TrailerStall().let { s -> samples.map { s.on(it, appPaused = false) } }
        // Before the trailer has played, buffering is the playing timer's (TrailerPolicy.onPlayingTimer), however long.
        assertEquals(List(3) { TrailerStep.WAIT }, fresh(
            at(TrailerEvent.BUFFERING, 0.0, 0L), at(TrailerEvent.BUFFERING, 0.0, 40_000L), at(TrailerEvent.BUFFERING, 0.0, 80_000L)))
        // An ad that played isn't the trailer.
        assertEquals(List(3) { TrailerStep.WAIT }, fresh(
            at(TrailerEvent.PLAYING, 0.0, 0L, ad = true), at(TrailerEvent.BUFFERING, 0.0, 2_000L), at(TrailerEvent.BUFFERING, 0.0, 40_000L)))
        // A time that moves, playing in between, or a pause starts the count again.
        assertEquals(List(5) { TrailerStep.WAIT }, fresh(
            at(TrailerEvent.PLAYING, 1.0, 0L), at(TrailerEvent.BUFFERING, 2.0, 2_000L), at(TrailerEvent.BUFFERING, 2.5, 30_000L),
            at(TrailerEvent.PLAYING, 3.5, 31_000L), at(TrailerEvent.BUFFERING, 3.5, 60_000L)))
        assertEquals(List(4) { TrailerStep.WAIT }, fresh(
            at(TrailerEvent.PLAYING, 1.0, 0L), at(TrailerEvent.BUFFERING, 2.0, 2_000L), at(TrailerEvent.PAUSED, 2.0, 20_000L),
            at(TrailerEvent.BUFFERING, 2.0, 40_000L)))
    }

    @Test fun aTrailerWhosePageFallsSilentWhileItPlaysGoesToTheYouTubeApp() {
        // The page sends a snapshot every 2 seconds for as long as it lives: none for 10 seconds while the last said it
        // plays is a renderer that hung (WebView reports a hung renderer only after an input event or a navigation,
        // and this one gets neither).
        val stall = TrailerStall()
        assertEquals(TrailerStep.WAIT, stall.onClock(60_000L, appPaused = false))
        assertEquals(TrailerStep.WAIT, stall.on(TrailerEvent.Progress(TrailerEvent.PLAYING, 3.0, 1_000L), appPaused = false))
        assertEquals(TrailerStep.WAIT, stall.onClock(10_999L, appPaused = false))
        assertEquals(TrailerStep.FALL_BACK, stall.onClock(11_000L, appPaused = false))
        // A snapshot that doesn't count (paused, an ad, before it played) never arms it.
        listOf(
            TrailerEvent.Progress(TrailerEvent.PAUSED, 3.0, 1_000L), TrailerEvent.Progress(TrailerEvent.PLAYING, 3.0, 1_000L, ad = true),
            TrailerEvent.Progress(TrailerEvent.BUFFERING, 0.0, 1_000L), TrailerEvent.Progress(-1, 0.0, 1_000L),
        ).forEach { sample ->
            val other = TrailerStall()
            assertEquals("$sample", TrailerStep.WAIT, other.on(sample, appPaused = false))
            assertEquals("$sample", TrailerStep.WAIT, other.onClock(60_000L, appPaused = false))
        }
        // Each snapshot that arrives counts from there; the app being paused (its page may be too) starts again.
        val talking = TrailerStall()
        listOf(0L to 1.0, 2_000L to 3.0, 4_000L to 5.0).forEach { (at, time) ->
            assertEquals(TrailerStep.WAIT, talking.on(TrailerEvent.Progress(TrailerEvent.PLAYING, time, at), appPaused = false))
            assertEquals(TrailerStep.WAIT, talking.onClock(at + 9_999L, appPaused = false))
        }
        assertEquals(TrailerStep.WAIT, talking.onClock(20_000L, appPaused = true))
        assertEquals(TrailerStep.WAIT, talking.onClock(60_000L, appPaused = false))
        // After it played, buffering arms it too.
        val buffering = TrailerStall()
        buffering.on(TrailerEvent.Progress(TrailerEvent.PLAYING, 1.0, 0L), appPaused = false)
        buffering.on(TrailerEvent.Progress(TrailerEvent.BUFFERING, 2.0, 2_000L), appPaused = false)
        assertEquals(TrailerStep.FALL_BACK, buffering.onClock(12_000L, appPaused = false))
    }

    // ------------------------------------------------------------------ the remote

    @Test fun theRemotesKeysPlayPauseSeekAndClose() {
        fun of(code: Int) = TrailerKey.of(code)
        val toggle = TrailerKey.Send(TrailerCommand.TOGGLE)
        listOf(KeyEvent.KEYCODE_DPAD_CENTER, KeyEvent.KEYCODE_ENTER, KeyEvent.KEYCODE_NUMPAD_ENTER, KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE,
            KeyEvent.KEYCODE_SPACE, KeyEvent.KEYCODE_HEADSETHOOK).forEach { assertEquals("$it", toggle, of(it)) }
        assertEquals(TrailerKey.Send(TrailerCommand.PLAY), of(KeyEvent.KEYCODE_MEDIA_PLAY))
        assertEquals(TrailerKey.Send(TrailerCommand.PAUSE), of(KeyEvent.KEYCODE_MEDIA_PAUSE))
        listOf(KeyEvent.KEYCODE_DPAD_LEFT, KeyEvent.KEYCODE_MEDIA_REWIND, KeyEvent.KEYCODE_MEDIA_SKIP_BACKWARD)
            .forEach { assertEquals("$it", TrailerKey.Send(TrailerCommand.BACK), of(it)) }
        listOf(KeyEvent.KEYCODE_DPAD_RIGHT, KeyEvent.KEYCODE_MEDIA_FAST_FORWARD, KeyEvent.KEYCODE_MEDIA_SKIP_FORWARD)
            .forEach { assertEquals("$it", TrailerKey.Send(TrailerCommand.FORWARD), of(it)) }
        assertEquals(TrailerKey.Close, of(KeyEvent.KEYCODE_MEDIA_STOP))
        assertEquals(TrailerKey.Close, of(KeyEvent.KEYCODE_ESCAPE))
        // Up and Down do nothing, and keep the focus in the player.
        assertEquals(TrailerKey.Ignore, of(KeyEvent.KEYCODE_DPAD_UP))
        assertEquals(TrailerKey.Ignore, of(KeyEvent.KEYCODE_DPAD_DOWN))
        // Back closes the player as its dialog's dismiss; volume, mute and Home stay the system's.
        listOf(KeyEvent.KEYCODE_BACK, KeyEvent.KEYCODE_VOLUME_UP, KeyEvent.KEYCODE_VOLUME_DOWN, KeyEvent.KEYCODE_VOLUME_MUTE,
            KeyEvent.KEYCODE_HOME).forEach { assertNull("$it", of(it)) }
        assertNotNull(of(KeyEvent.KEYCODE_DPAD_CENTER))
    }
}

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

    @Test fun thePageAsksYouTubeForAnAutoplayingEmbedFromTheApp() {
        val origin = "https://" + BuildConfig.APPLICATION_ID
        listOf(
            "host:\"https://www.youtube-nocookie.com\"", "videoId:key",
            "autoplay:1", "playsinline:1", "rel:0", "controls:1", "enablejsapi:1", "fs:0",
            "origin:\"$origin\"", "s.src=\"https://www.youtube.com/iframe_api\"",
            // A 1920 pixel wide layout: YouTube starts a full-screen player in 1080p (at 960 by 540, in 720p).
            "<meta name=\"viewport\" content=\"width=1920\">",
            "<meta name=\"referrer\" content=\"strict-origin-when-cross-origin\">",
            "onReady:function(e){send(\"ready\");e.target.playVideo()}",
            "onStateChange:function(e){send(\"state:\"+e.data)}", "onError:function(e){send(\"error:\"+e.data)}",
            "s.onerror=function(){send(\"error:-1\")}",
        ).forEach { assertTrue(it, page.contains(it)) }
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

    @Test fun youTubesApiLoadsOnlyAfterThePagesOwnLoadSoThePortComesAtOnce() {
        // The app sends its port when the page has loaded (onPageFinished). A script added while the page loads, and the
        // embed frame it makes, would hold that until YouTube's whole embed had loaded: its images and fonts too.
        assertTrue(page.contains("window.addEventListener(\"load\",function(){document.head.appendChild(s)});"))
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
        listOf(null, "", "Ready", "ready ", "state:", "state:-", "state:1.0", "state: 1", "state:+1", "error:1e3", "error:9999999",
            "error:\u0661", "tuner:port", "{\"event\":\"onReady\"}").forEach { assertNull("$it", TrailerEvent.parse(it)) }
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
        // A link the viewer followed opened the YouTube app: the player closes, ready or not. The page can't say so.
        assertEquals(TrailerStep.CLOSE, TrailerPolicy.on(TrailerEvent.Left, ready = true))
        assertEquals(TrailerStep.CLOSE, TrailerPolicy.on(TrailerEvent.Left, ready = false))
        listOf("left", "Left").forEach { assertNull(it, TrailerEvent.parse(it)) }
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

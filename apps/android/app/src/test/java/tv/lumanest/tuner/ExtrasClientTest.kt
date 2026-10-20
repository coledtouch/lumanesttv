package tv.lumanest.tuner

import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import tv.lumanest.tuner.data.ExtrasApi
import tv.lumanest.tuner.data.ExtrasClient
import tv.lumanest.tuner.data.ExtrasTitle
import tv.lumanest.tuner.data.ExtrasTrack
import tv.lumanest.tuner.data.Movie
import tv.lumanest.tuner.data.Series
import tv.lumanest.tuner.data.SubtitleFiles
import tv.lumanest.tuner.data.SubtitleQuery
import tv.lumanest.tuner.data.TrailerQuery
import tv.lumanest.tuner.player.SubtitleChoice
import tv.lumanest.tuner.player.SubtitleChoice.Source
import java.io.File

/** The lumanest.tv extras client (docs/extras.md): requests, answers, the session cache and the device's subtitle files. */
class ExtrasClientTest {
    @get:Rule val temporary = TemporaryFolder()

    private fun movie(name: String, tmdb: String? = null, year: String? = null) =
        Movie("m:1", name, null, null, "1", "https://video.example/1.mp4", tmdb = tmdb, year = year)

    // ------------------------------------------------------------------ which ids an app sends

    @Test fun aMovieIsLookedUpByItsProviderIdThenItsMatchThenItsNameAndYear() {
        assertEquals(ExtrasTitle(tmdb = 603), ExtrasTitle.movie(movie("The Matrix", tmdb = "603"), matchedTmdb = 604))
        assertEquals(ExtrasTitle(tmdb = 604), ExtrasTitle.movie(movie("The Matrix"), matchedTmdb = 604))
        assertEquals(ExtrasTitle(name = "EN | The Matrix", year = 1999), ExtrasTitle.movie(movie(" EN | The Matrix ", year = "1999-03-31"), 0))
        // The year in the name, as Movies & Series reads it (docs/browse.md, Matching step 3).
        assertEquals(ExtrasTitle(name = "The Matrix (1999)", year = 1999), ExtrasTitle.movie(movie("The Matrix (1999)"), 0))
        // Without an id or a year there is no request; nor with a name lumanest.tv doesn't take.
        assertNull(ExtrasTitle.movie(movie("The Matrix"), 0))
        assertNull(ExtrasTitle.movie(movie("x".repeat(301), year = "1999"), 0))
        assertNull(ExtrasTitle.of("0603", 0, "", 0))
        assertEquals(ExtrasTitle(tmdb = 999_999_999_999), ExtrasTitle.of("999999999999", 0, "", 0))
        assertNull(ExtrasTitle.of("1000000000000", 0, "", 0))
        assertEquals(ExtrasTitle(tmdb = 1399), ExtrasTitle.series(Series("9", "Thrones", null, null, null, "1", null, "2011", null, tmdb = "1399"), 0))
    }

    @Test fun requestsSendTheParametersInTheSpecifiedOrder() {
        val matrix = ExtrasTitle(tmdb = 603)
        assertEquals("https://lumanest.tv/api/extras/subtitles?v=1&type=movie&tmdb=603", ExtrasApi.subtitlesUrl(SubtitleQuery.movie(matrix)!!))
        assertEquals("https://lumanest.tv/api/extras/subtitles?v=1&type=episode&tmdb=1399&season=1&episode=3",
            ExtrasApi.subtitlesUrl(SubtitleQuery.episode(ExtrasTitle(tmdb = 1399), 1, 3)!!))
        assertEquals("https://lumanest.tv/api/extras/subtitles?v=1&type=movie&name=EN%20%7C%20The%20Matrix&year=1999",
            ExtrasApi.subtitlesUrl(SubtitleQuery.movie(ExtrasTitle(name = "EN | The Matrix", year = 1999))!!))
        assertEquals("https://lumanest.tv/api/extras/subtitles?v=1&type=episode&season=0&episode=12&name=Caf%C3%A9%20%26%20Co%2B&year=2020",
            ExtrasApi.subtitlesUrl(SubtitleQuery.episode(ExtrasTitle(name = "Caf\u00e9 & Co+", year = 2020), 0, 12)!!))
        assertEquals("https://lumanest.tv/api/extras/trailer?v=1&type=tv&tmdb=1399", ExtrasApi.trailerUrl(TrailerQuery(ExtrasTitle(tmdb = 1399), tv = true)))
        assertEquals("https://lumanest.tv/api/extras/trailer?v=1&type=movie&name=Heat&year=1995", ExtrasApi.trailerUrl(TrailerQuery(ExtrasTitle(name = "Heat", year = 1995), tv = false)))
        // Specials are season 0; an episode needs a number from 1.
        assertNull(SubtitleQuery.episode(matrix, 1, 0))
        assertNull(SubtitleQuery.episode(matrix, -1, 1))
        assertNull(SubtitleQuery.episode(matrix, 10_000, 1))
        assertNull(SubtitleQuery.episode(null, 1, 1))
        assertNull(SubtitleQuery.movie(null))
    }

    // ------------------------------------------------------------------ answers

    private val okAnswer = """{"v":1,"status":"ok","tmdb":603,"tracks":[
        {"id":"4486640-kZ0n3x6m1Gm2v5PqLr8sTw","lang":"en","label":"English (OpenSubtitles)","hi":false,
         "vtt":"https://lumanest.tv/api/extras/subtitles/file/4486640-kZ0n3x6m1Gm2v5PqLr8sTw.vtt","srt":"https://lumanest.tv/x.srt"},
        {"id":"77-aaaaaaaaaaaaaaaaaaaaaa","lang":"en","label":"English SDH (OpenSubtitles 2)","hi":true,
         "vtt":"https://lumanest.tv/api/extras/subtitles/file/77-aaaaaaaaaaaaaaaaaaaaaa.vtt"}],
        "credit":"Subtitles provided by OpenSubtitles.com","future":{"ignored":true}}"""

    @Test fun subtitleAnswersGiveTheirTracksBestFirst() {
        val lookup = ExtrasApi.parseSubtitles(okAnswer)!!
        assertEquals(listOf(
            ExtrasTrack("4486640-kZ0n3x6m1Gm2v5PqLr8sTw", "English (OpenSubtitles)", false, "https://lumanest.tv/api/extras/subtitles/file/4486640-kZ0n3x6m1Gm2v5PqLr8sTw.vtt"),
            ExtrasTrack("77-aaaaaaaaaaaaaaaaaaaaaa", "English SDH (OpenSubtitles 2)", true, "https://lumanest.tv/api/extras/subtitles/file/77-aaaaaaaaaaaaaaaaaaaaaa.vtt"),
        ), lookup.tracks)
        assertEquals(ExtrasApi.CREDIT, lookup.credit)
        // Every other status has no tracks; apps treat them alike.
        listOf("none", "unmatched", "not_configured", "unavailable").forEach { status ->
            assertEquals(emptyList<ExtrasTrack>(), ExtrasApi.parseSubtitles("""{"v":1,"status":"$status","tmdb":null,"tracks":[],"credit":"x"}""")!!.tracks)
        }
    }

    @Test fun onlyTracksOnLumanestWithUsableIdsAreKeptAndLabelsArePlainText() {
        fun track(id: String, vtt: String, label: String = "English (OpenSubtitles)") =
            """{"id":"$id","label":"$label","hi":false,"vtt":"$vtt"}"""
        val body = """{"v":1,"status":"ok","tracks":[
            ${track("1-a", "https://evil.example/api/extras/subtitles/file/1-a.vtt")},
            ${track("2-b", "http://lumanest.tv/api/extras/subtitles/file/2-b.vtt")},
            ${track("3-c", "https://lumanest.tv.evil.example/x.vtt")},
            ${track("../4", "https://lumanest.tv/api/extras/subtitles/file/4.vtt")},
            ${track("5-e", "https://lumanest.tv/api/extras/subtitles/file/5-e.vtt", label = "\\u0007  <b>English</b>\\u0085 ")},
            ${track("5-e", "https://lumanest.tv/api/extras/subtitles/file/5-e-copy.vtt")},
            ${track("6-f", "https://lumanest.tv/api/extras/subtitles/file/6 f.vtt")},
            {"id":"7-g","vtt":"https://lumanest.tv/api/extras/subtitles/file/7-g.vtt"},
            ${track("8-h", "https://lumanest.tv/api/extras/subtitles/file/8-h.vtt")},
            ${track("9-i", "https://lumanest.tv/api/extras/subtitles/file/9-i.vtt")}],"credit":"  "}"""
        val lookup = ExtrasApi.parseSubtitles(body)!!
        assertEquals(listOf("5-e", "7-g", "8-h"), lookup.tracks.map { it.id })
        // Controls and spaces at the ends go; markup stays text, never read as HTML.
        assertEquals("<b>English</b>", lookup.tracks[0].label)
        assertEquals(ExtrasApi.DEFAULT_LABEL, lookup.tracks[1].label)
        assertEquals(ExtrasApi.CREDIT, lookup.credit)
    }

    @Test fun anythingButAVersionOneAnswerIsUnusable() {
        assertNull(ExtrasApi.parseSubtitles("""{"v":2,"tracks":[]}"""))
        assertNull(ExtrasApi.parseSubtitles("""{"tracks":[]}"""))
        assertNull(ExtrasApi.parseSubtitles("""{"v":"1","tracks":[]}"""))
        assertNull(ExtrasApi.parseSubtitles("<html>"))
        assertNull(ExtrasApi.parseTrailer("""{"v":1"""))
        assertNull(ExtrasApi.parseTrailer("[]"))
    }

    @Test fun aTrailerNeedsAValidYouTubeKey() {
        val trailer = ExtrasApi.parseTrailer("""{"v":1,"status":"ok","tmdb":603,"trailer":{"key":"vKQi3bBA1y8","name":"Official Trailer",
            "url":"https://www.youtube.com/watch?v=vKQi3bBA1y8","short":"youtu.be/vKQi3bBA1y8","qr":["1"]}}""")!!.trailer!!
        assertEquals("vKQi3bBA1y8", trailer.key)
        assertEquals("Official Trailer", trailer.name)
        assertEquals("youtu.be/vKQi3bBA1y8", trailer.short)
        assertEquals("https://youtu.be/vKQi3bBA1y8", trailer.phoneUrl)
        listOf("vKQi3bBA1y", "vKQi3bBA1y8x", "vKQi3bBA1y!", "vKQi3bBA1/8", "vKQi3bBA1y\u0661").forEach { key ->
            assertNull(key, ExtrasApi.parseTrailer("""{"v":1,"status":"ok","trailer":{"key":"$key","name":"T"}}""")!!.trailer)
        }
        assertNull(ExtrasApi.parseTrailer("""{"v":1,"status":"none","tmdb":603,"trailer":null}""")!!.trailer)
        assertEquals("Trailer", ExtrasApi.parseTrailer("""{"v":1,"status":"ok","trailer":{"key":"vKQi3bBA1y8"}}""")!!.trailer!!.name)
    }

    // ------------------------------------------------------------------ the session cache

    private class FakeNetwork(var answer: (String) -> String?) {
        val requests = mutableListOf<Triple<String, Long, Long>>()
        suspend fun fetch(url: String, timeout: Long, max: Long): String? { requests += Triple(url, timeout, max); return answer(url) }
    }

    @Test fun everyAnswerIsKeptForTheSessionButAFailureIsNot() = runBlocking {
        val net = FakeNetwork { null }
        val client = ExtrasClient(fetch = net::fetch)
        val query = SubtitleQuery.movie(ExtrasTitle(tmdb = 603))!!
        assertNull(client.subtitles(query))
        net.answer = { "not json" }
        assertNull(client.subtitles(query))
        net.answer = { """{"v":1,"status":"not_configured","tmdb":null,"tracks":[],"credit":"Subtitles provided by OpenSubtitles.com"}""" }
        assertEquals(emptyList<ExtrasTrack>(), client.subtitles(query)!!.tracks)
        net.answer = { okAnswer }
        // The not_configured answer is kept: no fourth request.
        assertEquals(emptyList<ExtrasTrack>(), client.subtitles(query)!!.tracks)
        assertEquals(3, net.requests.size)
        assertTrue(net.requests.all { it.second == ExtrasApi.LOOKUP_TIMEOUT_MS })
        assertEquals(2, client.subtitles(SubtitleQuery.episode(ExtrasTitle(tmdb = 603), 1, 1)!!)!!.tracks.size)
        assertEquals(4, net.requests.size)
    }

    @Test fun theSessionKeepsAtMostTwoHundredAnswers() = runBlocking {
        val net = FakeNetwork { """{"v":1,"status":"none","trailer":null}""" }
        val client = ExtrasClient(fetch = net::fetch)
        for (id in 1L..201L) client.trailer(TrailerQuery(ExtrasTitle(tmdb = id), tv = false))
        assertEquals(201, net.requests.size)
        client.trailer(TrailerQuery(ExtrasTitle(tmdb = 201), tv = false))
        assertEquals(201, net.requests.size)
        client.trailer(TrailerQuery(ExtrasTitle(tmdb = 1), tv = false))
        assertEquals("The oldest answer made room for the 201st", 202, net.requests.size)
    }

    @Test fun aDisabledClientNeverCalls() = runBlocking {
        val net = FakeNetwork { okAnswer }
        val client = ExtrasClient(enabled = false, fetch = net::fetch)
        assertNull(client.subtitles(SubtitleQuery.movie(ExtrasTitle(tmdb = 603))!!))
        assertNull(client.trailer(TrailerQuery(ExtrasTitle(tmdb = 603), tv = false)))
        assertNull(client.file("https://lumanest.tv/api/extras/subtitles/file/1-a.vtt"))
        assertEquals(0, net.requests.size)
    }

    @Test fun filesComeOnlyFromLumanestWithTheirOwnTimeout() = runBlocking {
        val net = FakeNetwork { "WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nHi\n" }
        val client = ExtrasClient(fetch = net::fetch)
        assertNull(client.file("https://evil.example/a.vtt"))
        assertNotNull(client.file("https://lumanest.tv/api/extras/subtitles/file/1-a.vtt"))
        assertEquals(listOf(Triple("https://lumanest.tv/api/extras/subtitles/file/1-a.vtt", ExtrasApi.FILE_TIMEOUT_MS, ExtrasApi.MAX_FILE_BYTES)), net.requests)
    }

    // ------------------------------------------------------------------ the device's subtitle files

    private val vtt = "WEBVTT\n\n00:00:01.000 --> 00:00:02.500\nHello\n"
    private fun track(n: Int) = ExtrasTrack("$n-x", "English (OpenSubtitles)", false, "https://lumanest.tv/api/extras/subtitles/file/$n-x.vtt")

    @Test fun aFileIsDownloadedOnceAndKeptForSevenDays() = runBlocking {
        var now = 1_700_000_000_000L
        val fetched = mutableListOf<String>()
        val dir = temporary.newFolder("subtitles")
        val files = SubtitleFiles(dir, fetch = { fetched += it; vtt }, now = { now })
        val first = files.get(track(1))!!
        assertEquals(vtt, first.readText())
        assertEquals(first, files.get(track(1)))
        assertEquals(1, fetched.size)
        now += SubtitleFiles.MAX_AGE_MS - 1
        files.get(track(1))
        assertEquals(1, fetched.size)
        now += 1
        files.get(track(1))
        assertEquals("A week-old copy is downloaded again", 2, fetched.size)
        // The name comes from the URL alone.
        assertTrue(first.name.matches(Regex("[0-9a-f]{32}\\.vtt")))
    }

    @Test fun atMostTwentyFilesAreKept() = runBlocking {
        var now = 1_700_000_000_000L
        val dir = temporary.newFolder("subtitles")
        val files = SubtitleFiles(dir, fetch = { vtt }, now = { now })
        for (n in 1..25) { now += 60_000; files.get(track(n)) }
        val kept = dir.listFiles()!!.toList()
        assertEquals(SubtitleFiles.MAX_FILES, kept.size)
        assertTrue(kept.all { it.name.endsWith(".vtt") })
        assertFalse(File(dir, SubtitleFiles.fileName(track(5).vtt)).exists())
        assertTrue(File(dir, SubtitleFiles.fileName(track(6).vtt)).exists())
    }

    @Test fun aFailedOrUnreadableDownloadKeepsNothing() = runBlocking {
        val dir = temporary.newFolder("subtitles")
        listOf<String?>(null, "", "<html>WEBVTT", "WEBVTTX\n\n00:00:01.000 --> 00:00:02.000\nHi", "WEBVTT\n\nno cue").forEach { body ->
            assertNull(body, SubtitleFiles(dir, fetch = { body }).get(track(1)))
        }
        assertNull(SubtitleFiles(dir, fetch = { throw java.io.IOException("reset") }).get(track(1)))
        assertEquals(0, dir.listFiles()!!.size)
        val bom = 0xFEFF.toChar() + "WEBVTT - from lumanest.tv\r\n\r\n00:00:01.000 --> 00:00:02.000\r\nHi\r\n"
        assertNotNull(SubtitleFiles(dir, fetch = { bom }).get(track(2)))
    }

    // ------------------------------------------------------------------ the automatic choice

    @Test fun subtitlesOnShowsTheStreamsEnglishThenTheProvidersThenOpenSubtitles() {
        val stream = SubtitleChoice.Track(Source.STREAM, "en")
        val untagged = SubtitleChoice.Track(Source.STREAM, null)
        val spanish = SubtitleChoice.Track(Source.STREAM, "es")
        val provider = SubtitleChoice.Track(Source.PROVIDER, "English")
        val opensubtitles = SubtitleChoice.Track(Source.OPENSUBTITLES, "en")
        assertEquals(3, SubtitleChoice.automatic(listOf(opensubtitles, provider, untagged, stream)))
        assertEquals(1, SubtitleChoice.automatic(listOf(opensubtitles, provider, untagged, spanish)))
        assertEquals(0, SubtitleChoice.automatic(listOf(opensubtitles, untagged, spanish)))
        // OpenSubtitles comes before untagged captions and other languages; without any of the three, the old fallback.
        assertEquals(2, SubtitleChoice.automatic(listOf(untagged, spanish, opensubtitles)))
        assertNull(SubtitleChoice.automatic(listOf(untagged, spanish, SubtitleChoice.Track(Source.PROVIDER, "fr"))))
        assertNull(SubtitleChoice.automatic(listOf(stream.copy(supported = false), opensubtitles.copy(supported = false))))
        // A forced English track only translates foreign dialogue: OpenSubtitles comes first.
        assertEquals(1, SubtitleChoice.automatic(listOf(stream.copy(forced = true), opensubtitles)))
        assertFalse(SubtitleChoice.hasOwnEnglish(listOf(stream.copy(forced = true))))
        // Media3's own pick stays when it is of the chosen kind: another English track of the stream, not untagged captions.
        assertTrue(SubtitleChoice.sameKind(stream.copy(language = "en-US"), stream))
        assertFalse(SubtitleChoice.sameKind(untagged, stream))
        assertFalse(SubtitleChoice.sameKind(provider, stream))
        assertTrue(SubtitleChoice.sameKind(opensubtitles, opensubtitles))
        assertTrue(SubtitleChoice.hasOwnEnglish(listOf(provider)))
        assertFalse(SubtitleChoice.hasOwnEnglish(listOf(opensubtitles, untagged, spanish)))
        listOf("en", "EN", "eng", "English", "en-US", "en_GB").forEach { assertTrue(it, SubtitleChoice.isEnglish(it)) }
        listOf(null, "", "e", "enx", "fr", "und", "ENGL").forEach { assertFalse("$it", SubtitleChoice.isEnglish(it)) }
    }
}

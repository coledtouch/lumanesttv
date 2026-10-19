package tv.lumanest.tuner

import tv.lumanest.tuner.data.JMap
import tv.lumanest.tuner.data.M3u
import tv.lumanest.tuner.data.MiniJson
import tv.lumanest.tuner.data.Source
import tv.lumanest.tuner.data.SourceType
import tv.lumanest.tuner.data.TitleMatch
import tv.lumanest.tuner.data.Xmltv
import tv.lumanest.tuner.data.Xtream
import tv.lumanest.tuner.data.parseJson
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.io.File
import java.util.zip.GZIPOutputStream

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class ParserTest {
    private fun tmp(text: String, gzip: Boolean = false): File {
        val f = File.createTempFile("tuner", if (gzip) ".gz" else ".txt")
        if (gzip) GZIPOutputStream(f.outputStream()).use { it.write(text.toByteArray()) } else f.writeText(text)
        return f
    }

    private val src = Source("1", "t", SourceType.XTREAM, "http://host:8080", "user", "pa ss")

    @Test fun xtreamLiveHandlesMixedTypesAndObjectRoot() {
        val x = Xtream(src)
        val arr = tmp("""[{"num":1,"name":"CNN","stream_id":101,"stream_icon":"http://l/cnn.png","epg_channel_id":"cnn.us","category_id":"5"},
            {"num":"2","name":"ESPN","stream_id":"102","stream_icon":null,"epg_channel_id":"","category_id":5}]""")
        val ch = x.parseLive(arr, "ts")
        assertEquals(2, ch.size)
        assertEquals("http://host:8080/live/user/pa ss/101.ts", ch[0].url)
        assertEquals("cnn.us", ch[0].epgId)
        assertEquals(null, ch[1].epgId)
        assertEquals(null, ch[1].logo)
        val obj = tmp("""{"a":{"category_id":"1","category_name":"News"},"b":{"category_id":2,"category_name":"Sports"}}""")
        assertEquals(listOf("News", "Sports"), x.parseCategories(obj).map { it.name })
    }

    /**
     * docs/browse.md "Trimming": provider fields lose spaces, tab to carriage return and the Unicode spaces at their ends,
     * nothing else. Kotlin's trim() also removed U+001C to U+001F, so "\u001F - 1999" read as "- 1999" (title "1999", no
     * year) and a year field "\u001F2021" as 2021.
     */
    @Test fun providerFieldsLoseOnlySpacesAndUnicodeSpacesAtTheirEnds() {
        val x = Xtream(src)
        // JSON escapes, so the test holds no invisible characters.
        val movies = x.parseMovies(tmp("""[
            {"stream_id":1,"name":"\u001F - 1999\u3000","category_id":" 7\u00A0","year":"\u001F2021"},
            {"stream_id":2,"name":"\u3000\uFEFF - 1999 \t","category_id":"7","year":"\u3000\u00852021"},
            {"stream_id":3,"name":" \u001C | EN\u000B","category_id":"7","releaseDate":"\u20282021-05-01\u2029"}]"""))
        assertEquals(listOf("\u001F - 1999", "- 1999", "\u001C | EN"), movies.map { it.name })
        assertEquals(listOf("7", "7", "7"), movies.map { it.categoryId })
        assertEquals(listOf(null, "2021", "2021"), movies.map { it.year })
        assertEquals(listOf("", "1999", ""), movies.map { TitleMatch.normalize(it.name) })
        assertEquals(listOf(1999, 0, 0), movies.map { TitleMatch.yearInTitle(it.name) })
        val categories = x.parseCategories(tmp("""[{"category_id":"\u30001","category_name":"\u001E EN | Movies\u2003"},{"category_id":["\u3000","2"],"category_name":"\u0085"}]"""))
        assertEquals(listOf("1", "2"), categories.map { it.id })
        assertEquals(listOf("\u001E EN | Movies", "Other"), categories.map { it.name })

        val m3u = M3u.parse(tmp("#EXTM3U\n#EXTINF:-1 group-title=\"Movies\",\u001F - 1999\u3000\n\uFEFFhttp://h/movie/u/p/1.mp4\u00A0\n"))
        assertEquals("\u001F - 1999", m3u.movies.single().name)
        assertEquals("http://h/movie/u/p/1.mp4", m3u.movies.single().url)
    }

    /**
     * An M3U entry's name is the title after the comma, else tvg-name trimmed as a provider field, else "Channel n".
     * Kotlin's isBlank() takes U+001C to U+001F for spaces, so a title "\u001F" read as "Channel 1" and its tvg-name
     * was never tried. Escapes, so the test holds no invisible characters.
     */
    @Test fun m3uNamesKeepControlCharactersAndFallBackToATrimmedTvgName() {
        val r = M3u.parse(tmp(
            "#EXTM3U\n" +
                "#EXTINF:-1 tvg-name=\"Not used\",\u001F\nhttp://h/live/1.ts\n" +
                "#EXTINF:-1 tvg-name=\"\u001F\",\nhttp://h/live/2.ts\n" +
                "#EXTINF:-1 tvg-name=\"\u3000BBC One\u00A0\", \u2003\nhttp://h/live/3.ts\n" +
                "#EXTINF:-1 tvg-name=\" \u3000\",\nhttp://h/live/4.ts\n" +
                "#EXTINF:-1 tvg-name=\"\u001F - 1999\",\nhttp://h/movie/u/p/5.mp4\n",
        ))
        assertEquals(listOf("\u001F", "\u001F", "BBC One", "Channel 4"), r.channels.map { it.name })
        assertEquals("\u001F - 1999", r.movies.single().name)
    }

    /**
     * Every "tmdb" case of docs/browse-cases.json (docs/browse.md, Matching step 1). The row is read by the reader the
     * catalogue goes through (the Android framework's JsonReader, hence Robolectric), then its id by [Xtream.tmdbOf], and
     * by the movie and series parsers, which read only the fields they need: `{"tmdb":1e3}` is a number (1000) and
     * `{"tmdb":"1e3"}` a string (none). BrowseCasesTest runs the other kinds.
     */
    @Test fun everySharedTmdbCaseGivesTheDocumentedId() {
        val x = Xtream(src)
        val cases = (MiniJson.parse(BrowseCasesTest.casesFile().readText(Charsets.UTF_8)) as List<*>)
            .map { it as Map<*, *> }.filter { it["kind"] == "tmdb" }
        assertTrue("No tmdb cases in ${BrowseCasesTest.casesFile()}", cases.isNotEmpty())
        val failures = cases.mapNotNull { case ->
            val json = case["json"] as String
            val expected = case["expect"] as String?
            assertTrue("Not one JSON object: $json", json.startsWith("{") && json.endsWith("}"))
            @Suppress("UNCHECKED_CAST")
            val direct = Xtream.tmdbOf(parseJson(json) as JMap)
            // The parsers skip a row without its id; a case's own stream_id or series_id comes later and wins.
            val inner = json.substring(1, json.length - 1)
            val file = tmp("[{\"stream_id\":\"1\",\"series_id\":\"1\"" + (if (inner.isBlank()) "" else ",$inner") + "}]")
            val got = try {
                listOf(direct, x.parseMovies(file).single().tmdb, x.parseSeries(file).single().tmdb)
            } finally { file.delete() }
            if (got.all { it == expected }) null else "$json: $got (tmdbOf, movie, series), expected $expected"
        }
        assertTrue(failures.joinToString("\n", "TMDB id cases that fail (${failures.size} of ${cases.size}):\n"), failures.isEmpty())
    }

    @Test fun seriesInfoAcceptsMapOrListEpisodes() {
        val x = Xtream(src)
        val map = x.parseSeriesInfo("""{"info":{"plot":"P"},"episodes":{"1":[{"id":"9","episode_num":2,"title":"B","container_extension":"mkv"},{"id":"8","episode_num":1,"title":"A","container_extension":"mp4","info":{"duration_secs":"1500"}}],"2":[{"id":"10","episode_num":1,"title":"C"}]}}""")
        assertNotNull(map)
        assertEquals(listOf(1, 2), map!!.seasons.keys.toList())
        assertEquals("A", map.seasons[1]!!.first().title)
        assertEquals(1500, map.seasons[1]!!.first().durationSecs)
        assertEquals("http://host:8080/series/user/pa ss/9.mkv", map.seasons[1]!![1].url)
        val list = x.parseSeriesInfo("""{"episodes":[[{"id":"1","season":3,"episode_num":1,"title":"X"}]]}""")
        assertEquals(listOf(3), list!!.seasons.keys.toList())
    }

    @Test fun shortEpgDecodesBase64() {
        val x = Xtream(src)
        val list = x.parseShortEpg("""{"epg_listings":[{"title":"TmV3cyBOaWdodA==","description":"","start_timestamp":"1760000000","stop_timestamp":"1760003600"}]}""")
        assertEquals("News Night", list.single().title)
        assertEquals(3_600_000L, list.single().end - list.single().start)
    }

    @Test fun getPhpLinkIsRecognised() {
        val t = Xtream.fromGetPhp("http://iptv.example.com:8080/get.php?username=bob&password=s3cret&type=m3u_plus&output=ts")
        assertEquals(Triple("http://iptv.example.com:8080", "bob", "s3cret"), t)
        assertEquals("http://h.com:80", Xtream.normalizeServer(" h.com:80/player_api.php "))
    }

    @Test fun m3uParsesAttributesCommasAndVod() {
        val f = tmp(
            """#EXTM3U url-tvg="http://epg.example/guide.xml.gz"
#EXTINF:-1 tvg-id="bbc1.uk" tvg-name="BBC One" tvg-logo="http://l/bbc.png" group-title="UK, Entertainment",BBC One HD
http://s/live/1.ts
#EXTINF:-1 tvg-chno="7" group-title="News",Sky News
#EXTVLCOPT:http-user-agent=foo
http://s/live/2.m3u8
#EXTINF:-1 tvg-logo="http://p/x.jpg" group-title="Movies 2024",Dune Part Two (2024)
http://s/movie/u/p/55.mkv
""",
            gzip = true,
        )
        val r = M3u.parse(f)
        assertEquals("http://epg.example/guide.xml.gz", r.epgUrl)
        assertEquals(2, r.channels.size)
        assertEquals("BBC One HD", r.channels[0].name)
        assertEquals("UK, Entertainment", r.liveCategories[0].name)
        assertEquals("bbc1.uk", r.channels[0].epgId)
        assertEquals(1, r.movies.size)
        assertEquals("Dune Part Two (2024)", r.movies[0].name)
    }

    @Test fun xmltvMatchesByIdAndDisplayNameWithOffsets() {
        val f = tmp(
            """<?xml version="1.0" encoding="UTF-8"?>
<tv>
  <channel id="CNN.us"><display-name lang="en">CNN</display-name></channel>
  <channel id="other"><display-name>Sky News</display-name></channel>
  <programme start="20261012180000 -0400" stop="20261012190000 -0400" channel="CNN.us"><title lang="en">The Situation Room</title><sub-title>Ep 4</sub-title><desc>Politics.</desc></programme>
  <programme start="20261012190000 -0400" stop="20261012200000 -0400" channel="CNN.us"><title>Erin Burnett</title></programme>
  <programme start="20261012220000 +0000" stop="20261012230000 +0000" channel="other"><title>Sky Late</title></programme>
  <programme start="20261012220000 +0000" stop="20261012230000 +0000" channel="ignored"><title>Nope</title></programme>
</tv>""",
            gzip = true,
        )
        val start = Xmltv.parseTime("20261012180000 -0400")
        assertEquals(Xmltv.parseTime("20261012220000 +0000"), start)
        val res = Xmltv.parse(f, mutableSetOf("cnn.us"), setOf("skynews"), start - 3_600_000, start + 86_400_000)
        assertEquals(2, res.programs["cnn.us"]!!.size)
        assertEquals("Ep 4", res.programs["cnn.us"]!![0].subtitle)
        assertEquals("other", res.nameToId["skynews"])
        assertTrue(res.programs.containsKey("other"))
        assertTrue(!res.programs.containsKey("ignored"))
    }

    @Test fun xtreamDuplicatesMergeIntoOneItemWithAllCategories() {
        val x = Xtream(src)
        val f = tmp("""[
          {"stream_id":900047121,"name":"Ninja Wars","category_id":"1","category_ids":[1,2,14],"container_extension":"mp4","direct_source":"http://cdn.example/movie/u/p/abc"},
          {"stream_id":900047121,"name":"Ninja Wars","category_id":"2","category_ids":[1,2,14],"container_extension":"mp4"},
          {"stream_id":900047121,"name":"Ninja Wars","category_id":"14","category_ids":[1,2,14],"container_extension":"mp4"},
          {"stream_id":5,"name":"Other","category_id":"2"}]""")
        val m = x.parseMovies(f)
        assertEquals(2, m.size)
        assertEquals(listOf("1", "2", "14"), m[0].categoryIds)
        assertEquals("http://cdn.example/movie/u/p/abc", m[0].url)
        val s = x.parseSeries(tmp("""[{"series_id":331033,"name":"Collision","category_id":"1","category_ids":[1,8,18]},{"series_id":331033,"name":"Collision","category_id":"8"}]"""))
        assertEquals(1, s.size)
        assertEquals(listOf("1", "8", "18"), s[0].categoryIds)
        val live = x.parseLive(tmp("""[{"stream_id":7,"name":"FS1","category_id":"1","direct_source":"http://cdn.example/live/u/p/7.ts"},{"stream_id":7,"name":"FS1","category_id":"3"}]"""), "m3u8")
        assertEquals(1, live.size)
        assertEquals("http://cdn.example/live/u/p/7.m3u8", live[0].url)
        assertEquals(listOf("1", "3"), live[0].categoryIds)
    }
}

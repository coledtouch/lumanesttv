package tv.lumanest.tuner

import tv.lumanest.tuner.data.Torrentio
import tv.lumanest.tuner.player.EnglishAudio
import androidx.media3.common.C
import androidx.media3.common.Format
import androidx.media3.common.TrackGroup
import androidx.media3.common.Tracks
import com.google.common.collect.ImmutableList
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class TorrentioTest {
    @Test fun configuredPathSurvivesMovieAndEpisodeLookups() {
        val manifest = "stremio://torrentio.strem.fun/sort=seeders%7Climit=3/manifest.json"
        val movie = Torrentio.endpoint(manifest, "tt1234567", false)
        assertEquals("sort=seeders|limit=3", movie.pathSegments[0])
        assertEquals(listOf("stream", "movie", "tt1234567.json"), movie.pathSegments.takeLast(3))
        assertEquals("tt1234567:2:3.json", Torrentio.endpoint(manifest, "tt1234567:2:3", true).pathSegments.last())
    }

    @Test fun rejectsWrongHostsSchemesAndMalformedIds() {
        for (manifest in listOf("http://torrentio.strem.fun/manifest.json", "https://example.com/manifest.json", "https://torrentio.strem.fun/configure")) {
            assertThrows(IllegalArgumentException::class.java) { Torrentio.endpoint(manifest, "tt123", false) }
        }
        assertThrows(IllegalArgumentException::class.java) { Torrentio.endpoint("https://torrentio.strem.fun/manifest.json", "tt123:1:2", false) }
        assertThrows(IllegalArgumentException::class.java) { Torrentio.endpoint("https://torrentio.strem.fun/manifest.json", "tt123", true) }
    }

    @Test fun directStreamsAreDeduplicatedAndUnsupportedResultsExcluded() {
        val result = Torrentio.parse("""{"streams":[
            {"name":"HTTP","title":"ENG release","url":"https://media.example/video.mp4"},
            {"url":"https://media.example/video.mp4"},
            {"infoHash":"abcdef","fileIdx":1},
            {"externalUrl":"https://example.com"},
            {"url":"magnet:?xt=urn:btih:abcdef"},
            {"url":"https://media.example/other.mp4","behaviorHints":{"proxyHeaders":{"request":{"Authorization":"token"}}}}
        ]}""")
        assertEquals(1, result.streams.size)
        assertEquals("ENG release", result.streams.first().description)
        assertEquals(4, result.unsupported)
        assertTrue(Torrentio.parse("""{"streams":[]}""").streams.isEmpty())
        assertThrows(IllegalStateException::class.java) { Torrentio.parse("{}") }
    }

    @Test fun torrentResultsPreserveExactFileIndexAndTrackers() {
        val hash = "0123456789abcdef0123456789abcdef01234567"
        val result = Torrentio.parse("""{"streams":[{"name":"Torrent","infoHash":"$hash","fileIdx":4,"sources":["tracker:udp://tracker.example:80/announce","dht:$hash"]}]}""")
        assertTrue(result.streams.single().isTorrent)
        val spec = tv.lumanest.tuner.data.TorrentSpec.parse(result.streams.single().url)
        assertEquals(4, spec.fileIndex)
        assertEquals(listOf("udp://tracker.example:80/announce"), spec.trackers)
    }

    @Test fun magnetAndVideoFileSelectionAreValidated() {
        val hash = "0123456789abcdef0123456789abcdef01234567"
        val spec = tv.lumanest.tuner.data.TorrentSpec.fromMagnet("magnet:?xt=urn:btih:$hash&tr=udp%3A%2F%2Ftracker.example%3A80%2Fannounce")
        assertEquals(hash, spec.hash)
        assertEquals(spec, tv.lumanest.tuner.data.TorrentSpec.parse(spec.uri()))
        assertEquals(1, tv.lumanest.tuner.data.TorrentSpec.chooseFile(listOf("notes.txt", "episode.mkv", "sample.mp4"), listOf(2000, 9000, 1000), null))
        assertEquals(2, tv.lumanest.tuner.data.TorrentSpec.chooseFile(listOf("notes.txt", "episode.mkv", "sample.mp4"), listOf(2000, 9000, 1000), 2))
        assertThrows(IllegalArgumentException::class.java) { tv.lumanest.tuner.data.TorrentSpec.chooseFile(listOf("notes.txt"), listOf(2000), 0) }
    }

    @Test fun titleAndEpisodeMetadataProvideIdsWithoutManualEntry() {
        val titles = Torrentio.parseTitles("""{"metas":[{"id":"tt123","name":"A movie","releaseInfo":"2026"},{"id":"tt123","name":"Duplicate"},{"id":"bad"}]}""")
        assertEquals(1, titles.size)
        assertEquals("tt123", titles.single().id)
        assertEquals("A movie", titles.single().name)
        val episodes = Torrentio.parseEpisodes("""{"meta":{"videos":[{"id":"tt123:2:1","title":"Second season"},{"id":"tt123:1:2","title":"Earlier"},{"id":"bad"}]}}""")
        assertEquals(listOf("tt123:1:2", "tt123:2:1"), episodes.map { it.id })
        assertEquals(2, episodes.first().episode)
    }

    @Test fun richMetadataRetainsArtworkPlotAndEpisodesAndHandlesMissingFields() {
        val details = Torrentio.parseDetails("""{"meta":{"id":"tt123","name":"A series","releaseInfo":"2026","poster":"https://images.example/poster.jpg","description":"A detailed plot.","imdbRating":"8.2","runtime":"45 min","genres":["Drama"],"cast":["An Actor"],"videos":[{"id":"tt123:1:1","title":"Pilot"}]}}""")
        assertEquals("https://images.example/poster.jpg", details.title.poster)
        assertEquals("A detailed plot.", details.title.description)
        assertEquals("8.2", details.title.rating)
        assertEquals(listOf("Drama"), details.title.genres)
        assertEquals("Pilot", details.episodes.single().title)
        val missing = Torrentio.parseDetails("""{"meta":{"id":"tt456","name":"Movie","poster":null,"cast":null,"description":null}}""")
        assertNull(missing.title.poster)
        assertEquals("", missing.title.description)
        assertTrue(missing.episodes.isEmpty())
    }

    @Test fun debridStatusVideosAreExplainedWithoutRejectingActualMovies() {
        fun notice(url: String) = tv.lumanest.tuner.player.DebridNotice.message(okhttp3.HttpUrl.Builder().scheme("https").host("torrentio.strem.fun").encodedPath(url).build())
        assertTrue(notice("/videos/blocked_access_v2.mp4")!!.contains("approve"))
        assertTrue(notice("/videos/downloading.mp4")!!.contains("downloading"))
        assertNull(notice("/alldebrid/movie.mkv"))
        assertNull(tv.lumanest.tuner.player.DebridNotice.message(okhttp3.HttpUrl.Builder().scheme("https").host("cdn.example").encodedPath("/videos/blocked_access_v2.mp4").build()))
    }

    private fun group(language: String?, selected: Boolean, supported: Boolean = true, mime: String = "audio/aac"): Tracks.Group {
        val format = Format.Builder().setSampleMimeType(mime).setLanguage(language).setLabel("English").build()
        return Tracks.Group(TrackGroup(format), false, intArrayOf(if (supported) C.FORMAT_HANDLED else C.FORMAT_UNSUPPORTED_TYPE), booleanArrayOf(selected))
    }
    private fun tracks(vararg groups: Tracks.Group) = Tracks(ImmutableList.copyOf(groups))

    @Test fun verifiesAudioTagsInsteadOfLabelsOrSubtitleLanguage() {
        assertTrue(EnglishAudio.isEnglish("eng"))
        assertTrue(EnglishAudio.isEnglish("en-US"))
        assertTrue(EnglishAudio.isEnglish("EN_gb"))
        for (language in listOf(null, "und", "fr", "multi", "English")) assertFalse(EnglishAudio.isEnglish(language))
        assertNull(EnglishAudio.find(tracks(group(null, true), group("en", true, mime = "text/vtt"))))
        assertNull(EnglishAudio.find(tracks(group("en", false, supported = false))))
        assertFalse(EnglishAudio.selectedEnglish(tracks()))
    }

    @Test fun foreignDefaultRequiresAnEnglishTrackOverride() {
        val foreign = group("fr", true)
        val english = group("en", false)
        assertNotNull(EnglishAudio.find(tracks(foreign, english)))
        assertFalse(EnglishAudio.selectedEnglish(tracks(foreign, english)))
        assertTrue(EnglishAudio.selectedEnglish(tracks(group("fr", false), group("en", true))))
        assertFalse(EnglishAudio.selectedEnglish(tracks(group("fr", true), group("en", true))))
    }

    @Test fun untaggedFallbackPrefersEnglishAndNeverAcceptsKnownForeignAudio() {
        val unknown = group(null, true)
        val french = group("fr", true)
        val english = group("en", false)
        assertNull(EnglishAudio.preferred(tracks(unknown), false))
        assertEquals(unknown, EnglishAudio.preferred(tracks(unknown), true)!!.first)
        assertEquals(english, EnglishAudio.preferred(tracks(unknown, english), true)!!.first)
        assertFalse(EnglishAudio.selectedAllowed(tracks(unknown, english), true))
        assertTrue(EnglishAudio.selectedAllowed(tracks(unknown), true))
        assertFalse(EnglishAudio.selectedAllowed(tracks(unknown), false))
        assertNull(EnglishAudio.preferred(tracks(french), true))
        assertFalse(EnglishAudio.selectedAllowed(tracks(french), true))
        assertFalse(EnglishAudio.selectedAllowed(tracks(unknown, french), true))
        assertNull(EnglishAudio.preferred(tracks(group("und", false, supported = false)), true))
        assertFalse(EnglishAudio.selectedAllowed(tracks(), true))
        assertTrue(EnglishAudio.selectedAllowed(tracks(group("en", false), group("en", true)), false))
    }
}

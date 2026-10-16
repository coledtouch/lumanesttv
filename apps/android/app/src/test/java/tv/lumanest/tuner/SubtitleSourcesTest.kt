package tv.lumanest.tuner

import androidx.media3.common.MimeTypes
import tv.lumanest.tuner.data.ExternalSubtitle
import tv.lumanest.tuner.data.Source
import tv.lumanest.tuner.data.SourceType
import tv.lumanest.tuner.data.Xtream
import tv.lumanest.tuner.player.PlayerHolder
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class SubtitleSourcesTest {
    private val x = Xtream(Source("s", "S", SourceType.XTREAM, "http://example", "u", "p"))

    @Test fun vodInfoSubtitlesAreRead() {
        val info = x.parseMovieInfo(
            """{"info":{"plot":"P","subtitles":["http://example/sub/en.srt",{"url":"http://example/sub/es.vtt","language":"es","label":"Spanish"},{"lang":"fr"},"not a url"]},
               "movie_data":{"subtitles":[{"file":"http://example/sub/de.ass","language":"de"}]}}""",
        )!!
        assertEquals(
            listOf(ExternalSubtitle("http://example/sub/en.srt"), ExternalSubtitle("http://example/sub/es.vtt", "es", "Spanish"),
                ExternalSubtitle("http://example/sub/de.ass", "de")),
            info.subtitles,
        )
    }

    @Test fun episodeSubtitlesAreRead() {
        val info = x.parseSeriesInfo(
            """{"info":{},"episodes":{"1":[{"id":"9","episode_num":1,"title":"Pilot","container_extension":"mkv","subtitles":["http://example/sub/9.srt"]}]}}""",
        )!!
        assertEquals(listOf(ExternalSubtitle("http://example/sub/9.srt")), info.seasons.getValue(1).single().subtitles)
    }

    @Test fun sidecarMimeTypesComeFromTheExtension() {
        assertEquals(MimeTypes.APPLICATION_SUBRIP, PlayerHolder.subtitleMimeType("http://example/a.SRT?token=1"))
        assertEquals(MimeTypes.TEXT_VTT, PlayerHolder.subtitleMimeType("http://example/a.vtt"))
        assertEquals(MimeTypes.TEXT_SSA, PlayerHolder.subtitleMimeType("http://example/a.ass"))
        assertEquals(MimeTypes.APPLICATION_TTML, PlayerHolder.subtitleMimeType("http://example/a.dfxp"))
        assertNull(PlayerHolder.subtitleMimeType("http://example/subtitle"))
    }
}

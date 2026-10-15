package tv.lumanest.tuner

import tv.lumanest.tuner.data.JMap
import tv.lumanest.tuner.data.Source
import tv.lumanest.tuner.data.SourceType
import tv.lumanest.tuner.data.Xtream
import tv.lumanest.tuner.data.forEachJsonObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.io.File
import java.util.zip.GZIPOutputStream

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class ProjectedCatalogTest {
    private val xtream = Xtream(Source("fixture", "Fixture", SourceType.XTREAM, "https://example.invalid", "user", "password"))

    private fun <T> withFile(json: String, gzip: Boolean = false, action: (File) -> T): T {
        val file = File.createTempFile("projected-catalog", ".json")
        try {
            if (gzip) GZIPOutputStream(file.outputStream()).use { it.write(json.toByteArray()) } else file.writeText(json)
            return action(file)
        } finally { file.delete() }
    }

    @Test fun projectedRowsMatchTheGenericReaderForAllRequestedTypesAndRootShapes() {
        val record = """{"id":7,"nested":{"useful":[true,null,42]},"discard":{"deep":[{"name":"unused","values":[1,2,3]}]},"name":"After the skipped tree","categories":[1,"2"],"missing":null}"""
        val fields = setOf("id", "nested", "name", "categories", "missing")
        for (root in listOf("[$record,null,false,3]", "{\"entry\":$record,\"ignored\":false}")) {
            withFile(root, gzip = true) { file ->
                val complete = ArrayList<JMap>()
                val projected = ArrayList<JMap>()
                forEachJsonObject(file) { complete += it }
                forEachJsonObject(file, fields) { projected += it }
                assertEquals(complete.map { it.filterKeys(fields::contains) }, projected)
                assertEquals("After the skipped tree", projected.single()["name"])
                assertFalse(projected.single().containsKey("discard"))
            }
        }
    }

    @Test fun liveProjectionPreservesMetadataListsDirectSourcesAndDuplicateCategoryMerges() {
        withFile("""[
            {"unused":{"recording":[{"metadata":"ignore"}]},"stream_id":7,"num":10,"name":"ESPN","category_id":1,"category_ids":[1,2],"stream_icon":"https://example.invalid/logo.png","epg_channel_id":"espn.us","direct_source":"https://cdn.invalid/channel.ts?token=fixture","country":["US","US"],"country_code":"USA","language":["en","eng"],"audio_language":"en"},
            {"stream_id":7,"name":"ESPN","category_id":3,"country":"US","language":"en"}
        ]""") { file ->
            val channels = xtream.parseLive(file, "m3u8")
            assertEquals(1, channels.size)
            val channel = channels.single()
            assertEquals(listOf("1", "2", "3"), channel.categoryIds)
            assertEquals("https://cdn.invalid/channel.m3u8?token=fixture", channel.url)
            assertEquals("US;USA;US", channel.country)
            assertEquals("en;eng;en", channel.language)
            assertEquals("espn.us", channel.epgId)
            assertEquals("https://example.invalid/logo.png", channel.logo)
        }
    }

    @Test fun movieAndSeriesProjectionPreservesAllDisplayedAndPlaybackFields() {
        withFile("""[{"movie_data":{"deep":{"ignored":[1,2,3]}},"stream_id":"9","name":"Movie","category_id":"4","category_ids":[4,5],"stream_icon":"https://example.invalid/movie.png","rating":"8.5","container_extension":"mkv","added":"123","country_name":"United States","original_language":"fr"}]""") { file ->
            val movie = xtream.parseMovies(file).single()
            assertEquals("https://example.invalid/movie/user/password/9.mkv", movie.url)
            assertEquals("Movie", movie.name)
            assertEquals("https://example.invalid/movie.png", movie.poster)
            assertEquals("8.5", movie.rating)
            assertEquals(123L, movie.added)
            assertEquals(listOf("4", "5"), movie.categoryIds)
            assertEquals("United States", movie.country)
            assertEquals("fr", movie.language)
        }
        withFile("""{"entry":{"extra":{"episodes":[{"ignored":true}]},"series_id":10,"name":"Series","category_id":"6","cover":"https://example.invalid/series.png","plot":"Plot","rating":"9","genre":"Comedy","release_date":"2024-02-03","backdrop_path":["","https://example.invalid/background.png"],"last_modified":"456","tvg-country":"US","tvg-language":["en","en"]}}""") { file ->
            val series = xtream.parseSeries(file).single()
            assertEquals("10", series.id)
            assertEquals("Series", series.name)
            assertEquals("https://example.invalid/series.png", series.cover)
            assertEquals("Plot", series.plot)
            assertEquals("Comedy", series.genre)
            assertEquals("2024", series.year)
            assertEquals("9", series.rating)
            assertEquals("https://example.invalid/background.png", series.backdrop)
            assertEquals(456L, series.added)
            assertEquals("US", series.country)
            assertEquals("en", series.language)
        }
    }

    @Test fun absentMetadataStaysAbsentAndCategoryProjectionSkipsProviderExtras() {
        withFile("""[{"stream_id":1,"name":"No tags","category_id":"2","country":[],"language":[null," "]}]""") { file ->
            val channel = xtream.parseLive(file, "ts").single()
            assertNull(channel.country); assertNull(channel.language)
        }
        withFile("""{"one":{"unknown":{"items":[1,2,3]},"category_id":2,"category_name":"News"},"repeat":{"category_id":"2","category_name":"News again"}}""") { file ->
            val categories = xtream.parseCategories(file)
            assertEquals(1, categories.size)
            assertEquals("2", categories.single().id)
            assertEquals("News", categories.single().name)
        }
    }
}

package tv.lumanest.tuner

import tv.lumanest.tuner.data.LoadStatus
import tv.lumanest.tuner.data.Recent
import tv.lumanest.tuner.data.Repo
import tv.lumanest.tuner.data.Source
import tv.lumanest.tuner.data.SourceType
import tv.lumanest.tuner.ui.eligibleMovieRecents
import tv.lumanest.tuner.ui.eligibleSeriesRecents
import tv.lumanest.tuner.ui.mostWatchedLineup
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import java.io.File
import java.net.ServerSocket
import java.util.UUID
import java.util.concurrent.Executors

/**
 * The store edition filters the library when it loads, so nothing adult reaches the guide, search, Favorites,
 * Most Watched or Continue Watching, even when the lumanest.tv APK it replaced saved those channels and titles.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class StoreEditionLibraryTest {
    private val responses = mapOf(
        "get_live_categories" to """[{"category_id":"1","category_name":"USA | News"},{"category_id":"2","category_name":"ADULTOS"},
            {"category_id":"3","category_name":"USA | Entertainment"}]""",
        "get_live_streams" to """[{"stream_id":11,"name":"CNN","category_id":"1"},{"stream_id":12,"name":"Canal Rojo","category_id":"2"},
            {"stream_id":13,"name":"Playboy TV","category_id":"3"},{"stream_id":14,"name":"Comedy Central","category_id":"3"}]""",
        "get_vod_categories" to """[{"category_id":"1","category_name":"Action"},{"category_id":"2","category_name":"+18 Movies"}]""",
        "get_vod_streams" to """[{"stream_id":21,"name":"Heat","category_id":"1","container_extension":"mp4"},
            {"stream_id":22,"name":"Night Shift","category_id":"2","container_extension":"mp4"},
            {"stream_id":23,"name":"XXX Parody","category_id":"1","container_extension":"mp4"}]""",
        "get_series_categories" to """[{"category_id":"1","category_name":"Drama"},{"category_id":"2","category_name":"Erotica"}]""",
        "get_series" to """[{"series_id":31,"name":"Drama Show","category_id":"1"},{"series_id":32,"name":"After Dark","category_id":"2"}]""",
    )

    /**
     * A Trending playlist (Settings > Trending channels URL) that repeats the lineup's channels under a neutral group
     * and neutral names, plus an event feed that isn't in the lineup. Streams 12 and 13 are the adult channels.
     */
    private fun trending(port: Int) = listOf(14 to "Comedy Central", 13 to "Late Night 1", 12 to "Late Night 2", 99 to "USA Big Game")
        .joinToString("\n", "#EXTM3U\n") { (id, name) -> "#EXTINF:-1 group-title=\"USA | Featured\",$name\nhttp://127.0.0.1:$port/live/test/test/$id.ts" }

    private suspend fun waitForTrending() = withTimeout(10_000) { while (Repo.trending.value.isEmpty()) delay(20) }

    private suspend fun loadAndWait() {
        Repo.load()
        withTimeout(10_000) {
            while (Repo.liveStatus.value !is LoadStatus.Ready || Repo.vodStatus.value !is LoadStatus.Ready ||
                Repo.seriesStatus.value !is LoadStatus.Ready || Repo.channels.value.isEmpty() || Repo.movies.value.isEmpty() ||
                Repo.series.value.isEmpty()) delay(20)
        }
    }

    /** What the guide's Favorites category lists (see GuideScreen). */
    private fun favoritesLineup() = (Repo.channels.value + Repo.trending.value).filter { it.key in Repo.prefs.favorites.value }.distinctBy { it.key }

    @Test fun storeEditionKeepsAdultItemsOutOfEverySavedList() = runBlocking {
        val context = RuntimeEnvironment.getApplication()
        File(context.cacheDir, "sources/logos/logos.json").apply { parentFile!!.mkdirs(); writeText("[]") }
        Repo.init(context)
        Repo.prefs.freeEpgRegions = emptyList()
        val server = ServerSocket(0)
        val executor = Executors.newCachedThreadPool()
        executor.submit {
            while (!server.isClosed) runCatching {
                val socket = server.accept()
                executor.submit {
                    socket.use {
                        val reader = it.getInputStream().bufferedReader()
                        val request = reader.readLine().orEmpty()
                        while (reader.readLine()?.isNotEmpty() == true) Unit
                        val body = if (" /trending.m3u " in request) trending(server.localPort)
                            else Regex("action=([^& ]+)").find(request)?.groupValues?.get(1)?.let(responses::get)
                        val bytes = body.orEmpty().toByteArray()
                        val headers = "HTTP/1.1 ${if (body == null) "503 Unavailable" else "200 OK"}\r\nContent-Type: application/json\r\nContent-Length: ${bytes.size}\r\nConnection: close\r\n\r\n"
                        it.getOutputStream().apply { write(headers.toByteArray()); write(bytes); flush() }
                    }
                }
            }
        }
        try {
            // The lumanest.tv APK (adult content locked, as it ships): only the categories its rules recognise are hidden.
            Repo.storeEdition = false
            val source = Source(UUID.randomUUID().toString(), "Local test", SourceType.XTREAM, "http://127.0.0.1:${server.localPort}", "test", "test",
                hotUrl = "http://127.0.0.1:${server.localPort}/trending.m3u")
            Repo.prefs.saveSource(source); Repo.prefs.setActive(source.id)
            loadAndWait()
            assertEquals(listOf("CNN", "Canal Rojo", "Playboy TV", "Comedy Central"), Repo.channels.value.map { it.name })
            assertEquals(setOf("Heat", "Night Shift", "XXX Parody"), Repo.movies.value.map { it.name }.toSet())
            assertEquals(setOf("Drama Show", "After Dark"), Repo.series.value.map { it.name }.toSet())
            // Trending maps entries onto lineup channels and appends the event feed that isn't in the lineup.
            waitForTrending()
            val lineupKeys = Repo.channels.value.associate { it.name to it.key }
            assertEquals(setOf(lineupKeys["Comedy Central"], lineupKeys["Playboy TV"], lineupKeys["Canal Rojo"], "h:99"),
                Repo.trending.value.map { it.key }.toSet())

            // That install saved adult channels and titles as Favorites, Most Watched and Continue Watching.
            val channels = Repo.channels.value.associateBy { it.name }
            listOf("Canal Rojo", "Playboy TV", "CNN").forEach { Repo.prefs.toggleFavorite(channels.getValue(it).key) }
            listOf("Playboy TV", "Playboy TV", "Canal Rojo", "CNN").forEachIndexed { i, name ->
                Repo.prefs.recordWatched(channels.getValue(name).key, now = 1_000L * (i + 1))
            }
            val parody = Repo.movies.value.single { it.name == "XXX Parody" }
            val now = System.currentTimeMillis()
            Repo.prefs.saveProgress(Recent(parody.id, parody.name, null, null, parody.url, 60_000, 3_600_000, now))
            Repo.prefs.saveProgress(Recent("e:9", "After Dark", "S1 E1", null, "http://127.0.0.1/series/e9.mp4", 60_000, 3_600_000, now))
            assertEquals(listOf("Playboy TV", "CNN", "Canal Rojo"),
                mostWatchedLineup(Repo.channels.value, Repo.trending.value, Repo.prefs.watchedChannelKeys.value).map { it.name })
            assertEquals(3, favoritesLineup().size)
            assertEquals(listOf("XXX Parody"), eligibleMovieRecents(Repo.prefs.recents.value, Repo.movies.value).map { it.title })
            assertEquals(listOf("After Dark"), eligibleSeriesRecents(Repo.prefs.recents.value, Repo.series.value).map { it.title })

            // The same TV updated to the store edition (same package and key, same saved data).
            Repo.storeEdition = true
            loadAndWait()
            assertEquals(listOf("CNN", "Comedy Central"), Repo.channels.value.map { it.name })
            assertEquals(listOf("Heat"), Repo.movies.value.map { it.name })
            assertEquals(listOf("Drama Show"), Repo.series.value.map { it.name })
            assertEquals(setOf("1", "3"), Repo.liveCategories.value.map { it.id }.toSet())
            assertEquals(setOf("1"), Repo.movieCategories.value.map { it.id }.toSet())
            assertEquals(setOf("1"), Repo.seriesCategories.value.map { it.id }.toSet())
            // Trending only highlights lineup channels: the hidden adult streams, renamed in the Trending playlist,
            // don't come back as extra channels (and so the event feed isn't added either).
            waitForTrending()
            assertEquals(listOf("Comedy Central"), Repo.trending.value.map { it.name })
            assertEquals(Repo.channels.value.single { it.name == "Comedy Central" }.key, Repo.trending.value.single().key)
            // Search, the guide and Multi View all read these same lists.
            val names = (Repo.channels.value.map { it.name } + Repo.movies.value.map { it.name } + Repo.series.value.map { it.name })
            listOf("Playboy", "Rojo", "XXX", "Night Shift", "After Dark").forEach { hidden -> assertTrue(hidden, names.none { hidden in it }) }
            assertEquals(listOf("CNN"), favoritesLineup().map { it.name })
            assertEquals(listOf("CNN"), mostWatchedLineup(Repo.channels.value, Repo.trending.value, Repo.prefs.watchedChannelKeys.value).map { it.name })
            assertTrue(eligibleMovieRecents(Repo.prefs.recents.value, Repo.movies.value).isEmpty())
            assertTrue(eligibleSeriesRecents(Repo.prefs.recents.value, Repo.series.value).isEmpty())
        } finally {
            Repo.storeEdition = Edition.STORE
            server.close(); executor.shutdownNow()
        }
    }
}

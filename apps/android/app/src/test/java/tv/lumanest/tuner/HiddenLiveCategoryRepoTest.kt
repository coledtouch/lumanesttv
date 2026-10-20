package tv.lumanest.tuner

import kotlinx.coroutines.Job
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import tv.lumanest.tuner.data.CatalogSnapshots
import tv.lumanest.tuner.data.Category
import tv.lumanest.tuner.data.Channel
import tv.lumanest.tuner.data.Repo
import tv.lumanest.tuner.data.Source
import tv.lumanest.tuner.data.SourceType
import java.io.File
import java.net.ServerSocket
import java.util.UUID
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.Executors

/**
 * The provider's "Most watched now" live category is hidden when a lineup is loaded and when a saved one is restored,
 * while the playlist's trending list keeps its channels (docs/extras.md, "Hidden live category").
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class HiddenLiveCategoryRepoTest {
    @get:Rule val temporary = TemporaryFolder()
    private lateinit var cacheRoot: File
    private lateinit var store: CatalogSnapshots
    private var usOnlyWas = false
    /** Playlists this test saved: Repo.prefs outlives the test, so they are deleted again. */
    private val saved = mutableListOf<String>()
    private fun use(source: Source) { saved += source.id; Repo.prefs.saveSource(source); Repo.prefs.setActive(source.id) }

    @Before fun prepare() {
        Repo.init(RuntimeEnvironment.getApplication())
        Repo.prefs.setActive(null); Repo.load()
        usOnlyWas = Repo.prefs.usOnly.value
        Repo.prefs.setUsOnly(false)
        cacheRoot = temporary.newFolder("sources")
        val snapshotRoot = temporary.newFolder("catalogues")
        store = CatalogSnapshots(snapshotRoot)
        fun field(name: String) = Repo::class.java.getDeclaredField(name).apply { isAccessible = true }
        (field("logoJob").get(null) as? Job)?.cancel()
        field("logoJob").set(null, null)
        field("cacheRoot").set(null, cacheRoot)
        field("snapshotRoot").set(null, snapshotRoot)
        field("snapshots").set(null, store)
        File(cacheRoot, "logos/logos.json").apply { parentFile!!.mkdirs(); writeText("[]") }
        Repo.prefs.freeEpgRegions = emptyList()
        Repo.prefs.setLocalZip("")
    }

    @After fun finish() {
        Repo.prefs.setActive(null); Repo.load()
        saved.forEach(Repo.prefs::deleteSource)
        Repo.prefs.setUsOnly(usOnlyWas)
        val logo = Repo::class.java.getDeclaredField("logoJob").apply { isAccessible = true }
        (logo.get(null) as? Job)?.cancel(); logo.set(null, null)
    }

    private suspend fun await(check: () -> Boolean) {
        try { withTimeout(5_000) { while (!check()) delay(10) } }
        catch (e: TimeoutCancellationException) {
            throw AssertionError("channels=${Repo.channels.value.map { it.key }}, categories=${Repo.liveCategories.value}, trending=${Repo.trending.value.map { it.key }}", e)
        }
    }

    @Test fun aLoadedLineupHidesTheCategoryAndTheTrendingListKeepsItsChannels() = runBlocking {
        Provider().use { server ->
            val source = Source(UUID.randomUUID().toString(), "Hidden category", SourceType.XTREAM, server.url, "fixture", "fixture",
                epgUrl = server.url + "/guide.xml", hotUrl = server.url + "/featured.m3u")
            use(source)
            Repo.load()
            await { Repo.channels.value.isNotEmpty() && Repo.trending.value.isNotEmpty() }
            assertEquals(listOf("US News"), Repo.liveCategories.value.map { it.name })
            // ESPN was only in the hidden category; Fox News was in both and keeps US News.
            assertEquals(listOf("x:1", "x:3"), Repo.channels.value.map { it.key })
            assertEquals(listOf("1"), Repo.channels.value.single { it.key == "x:3" }.categoryIds)
            // Tuner's trending list is not a provider category: its ESPN stays.
            assertEquals(listOf("h:2"), Repo.trending.value.map { it.key })
            assertTrue(server.requests.any { "get_live_streams" in it })
        }
    }

    @Test fun aLineupSavedBeforeTheChangeIsRestoredWithoutTheCategory() = runBlocking {
        Provider().use { server ->
            val source = Source(UUID.randomUUID().toString(), "Saved lineup", SourceType.XTREAM, server.url, "fixture", "fixture")
            use(source)
            val id = CatalogSnapshots.identity(source, Repo.prefs.liveFormat, Repo.prefs.localZip.value)
            val categories = listOf(Category("1", "US News"), Category("7", "Most Watched Now (US)"))
            fun channel(key: String, name: String, vararg ids: String) = Channel(key, key.removePrefix("x:").toInt(), name, null, ids.first(), null, key.removePrefix("x:"),
                "https://example.invalid/$key.ts", categoryIds = ids.toList())
            store.writeLive(id, CatalogSnapshots.Live(listOf(channel("x:1", "CNN", "1"), channel("x:2", "ESPN", "7"), channel("x:3", "Fox News", "7", "1")),
                categories, emptyMap()), System.currentTimeMillis())
            Repo.load()
            await { Repo.channels.value.isNotEmpty() }
            assertEquals(listOf("x:1", "x:3"), Repo.channels.value.map { it.key })
            assertEquals("1", Repo.channels.value.last().categoryId)
            assertEquals(listOf("US News"), Repo.liveCategories.value.map { it.name })
            // The saved lineup was fresh: restored without asking the provider.
            assertTrue(server.requests.none { "get_live_streams" in it })
        }
    }

    /** An Xtream provider with a "|USA| MOST WATCHED NOW" category, and a trending playlist that lists ESPN. */
    private class Provider : AutoCloseable {
        private val socket = ServerSocket(0)
        private val workers = Executors.newCachedThreadPool()
        val url = "http://127.0.0.1:${socket.localPort}"
        val requests = CopyOnWriteArrayList<String>()

        private fun body(request: String): String? = when {
            "get_live_categories" in request ->
                """[{"category_id":"1","category_name":"US News"},{"category_id":"7","category_name":"|USA| MOST WATCHED NOW"}]"""
            "get_live_streams" in request -> """[
                {"stream_id":"1","num":1,"name":"CNN","category_id":"1","epg_channel_id":"CNN.us"},
                {"stream_id":"2","num":2,"name":"ESPN","category_id":"7"},
                {"stream_id":"3","num":3,"name":"Fox News","category_id":"7"},
                {"stream_id":"3","num":3,"name":"Fox News","category_id":"1"}]"""
            "/guide.xml" in request -> "<tv></tv>"
            "/featured.m3u" in request -> "#EXTM3U\n#EXTINF:-1 group-title=\"Most watched now\",ESPN\n$url/live/fixture/fixture/2.ts\n"
            else -> null
        }

        init {
            workers.submit {
                while (!socket.isClosed) runCatching {
                    val client = socket.accept()
                    workers.submit {
                        client.use {
                            val reader = it.getInputStream().bufferedReader()
                            val request = reader.readLine().orEmpty()
                            while (reader.readLine()?.isNotEmpty() == true) Unit
                            requests += request
                            val body = body(request)
                            val bytes = (body ?: "unavailable").toByteArray()
                            it.getOutputStream().apply {
                                write("HTTP/1.1 ${if (body != null) "200 OK" else "503 Unavailable"}\r\nContent-Length: ${bytes.size}\r\nConnection: close\r\n\r\n".toByteArray())
                                write(bytes); flush()
                            }
                        }
                    }
                }
            }
        }

        override fun close() { socket.close(); workers.shutdownNow() }
    }
}

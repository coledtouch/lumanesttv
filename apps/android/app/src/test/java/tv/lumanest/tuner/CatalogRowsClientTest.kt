package tv.lumanest.tuner

import tv.lumanest.tuner.data.CatalogRows
import tv.lumanest.tuner.data.CatalogRowsClient
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import java.io.IOException
import java.net.ServerSocket
import java.util.Collections
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/** The popularity lists endpoint (docs/browse.md): tolerant parsing, a 12 hour disk cache and a stale copy on failure. */
class CatalogRowsClientTest {
    private val folder = kotlin.io.path.createTempDirectory("tuner-rows").toFile()
    private val cache = File(folder, "catalog/rows-v1.json")
    @After fun clean() { folder.deleteRecursively() }

    private val tmdbBody = """{"v":1,"source":"tmdb","generated":"2026-10-19T00:00:00Z",
        "movie":{"popular":[{"id":438631,"title":"Dune","original_title":"Dune","year":"2021","origin":["us"],"lang":"EN","genres":[878,12],"popularity":123.4},
            {"id":"12","title":"String id"},{"id":0,"title":"Bad id"},{"title":"No id"},{"id":5}],
          "services":{"netflix":[{"id":7,"title":"Seven","year":2019}],"unknown":[{"id":8,"title":"Ignored"}]}},
        "tv":{"featured":[{"id":1399,"title":"Game of Thrones","original_title":"Game of Thrones","year":"2011","origin":["US"]}]},
        "genres":{"movie":[{"id":878,"name":"Science Fiction"},{"id":"x","name":"Bad"}],"tv":[]},
        "extra":{"future":"field"}}"""
    private val noneBody = """{"v":1,"source":"none","movie":{},"tv":{},"genres":{}}"""

    @Test fun parsingToleratesMissingAndMalformedLists() {
        val rows = CatalogRows.parse(tmdbBody)!!
        assertTrue(rows.usesTmdb)
        assertEquals(listOf(438631L, 12L), rows.movie.popular.map { it.id })
        val dune = rows.movie.popular.first()
        assertEquals(listOf("US"), dune.origin)
        assertEquals(2021, dune.year)
        assertEquals("en", dune.lang)
        assertEquals(listOf(878, 12), dune.genres)
        assertEquals(listOf(7L), rows.movie.service("netflix").map { it.id })
        assertEquals(2019, rows.movie.service("netflix").single().year)
        assertTrue(rows.movie.featured.isEmpty() && rows.movie.topRated.isEmpty() && rows.movie.service("hulu").isEmpty())
        assertEquals(listOf("Game of Thrones"), rows.tv.featured.map { it.title })
        assertTrue(rows.tv.popular.isEmpty())
        assertEquals(listOf(878), rows.movieGenres.map { it.id })

        val none = CatalogRows.parse(noneBody)!!
        assertFalse(none.usesTmdb)
        assertTrue(none.movie.all.none() && none.tv.all.none() && none.movieGenres.isEmpty())
        // Only version 1 is understood; anything unreadable is not a payload.
        listOf("""{"v":2,"source":"tmdb"}""", """{"source":"tmdb"}""", "<html>", "", "[1,2]", """{"v":1""").forEach { assertNull(it, CatalogRows.parse(it)) }
        // A version 1 payload without "source" counts as no TMDB.
        assertFalse(CatalogRows.parse("""{"v":1}""")!!.usesTmdb)
    }

    private class Clock(var now: Long = 1_800_000_000_000L)

    @Test fun freshCopyIsUsedForTwelveHoursThenRefreshed() = runBlocking {
        val clock = Clock()
        val fetches = Collections.synchronizedList(ArrayList<String>())
        var body = tmdbBody
        val client = CatalogRowsClient(cache, "https://rows.test/api/catalog/rows?v=1", fetch = { fetches += it; body }, now = { clock.now })
        assertTrue(client.load().usesTmdb)
        assertEquals(1, fetches.size)
        assertTrue(cache.isFile)
        clock.now += 11 * 3600_000L
        assertTrue(client.load().usesTmdb)
        assertEquals("A fresh disk copy needs no request", 1, fetches.size)
        clock.now += 2 * 3600_000L
        body = tmdbBody.replace("Seven", "Seven Updated")
        assertEquals("Seven Updated", client.load().movie.service("netflix").single().title)
        assertEquals(2, fetches.size)
        // Forced refreshes (Settings > Refresh) ask again.
        client.load(force = true)
        assertEquals(3, fetches.size)
        assertEquals(listOf("https://rows.test/api/catalog/rows?v=1"), fetches.distinct())
    }

    @Test fun failedOrUnusableResponsesKeepTheStaleCopy() = runBlocking {
        val clock = Clock()
        var fail = false
        var body = tmdbBody
        val client = CatalogRowsClient(cache, fetch = { if (fail) throw IOException("offline") else body }, now = { clock.now })
        client.load()
        val saved = cache.readText()
        clock.now += 13 * 3600_000L
        fail = true
        val stale = client.load()
        assertTrue("A stale copy beats no lists", stale.usesTmdb)
        assertEquals(listOf(438631L, 12L), stale.movie.popular.map { it.id })
        fail = false
        body = "<html>Bad gateway</html>"
        assertTrue(client.load().usesTmdb)
        assertEquals("An unusable answer never replaces the saved copy", saved, cache.readText())
        // The copy on disk survives a new client (an app restart), whatever its age.
        assertTrue(CatalogRowsClient(cache, fetch = { throw IOException() }, now = { clock.now }).cached()!!.rows.usesTmdb)
    }

    @Test fun refreshSaysWhetherTheListsAreCurrentSoFailuresAreRetried() = runBlocking {
        val clock = Clock()
        var fail = true
        val client = CatalogRowsClient(cache, fetch = { if (fail) throw IOException("offline") else tmdbBody }, now = { clock.now })
        // No copy and no answer: no TMDB, and not current.
        assertEquals(CatalogRowsClient.Loaded(CatalogRows.NONE, ok = false), client.refresh())
        fail = false
        val fetched = client.refresh()
        assertTrue(fetched.ok && fetched.rows.usesTmdb)
        // A fresh copy is current, and the same object each time: nothing downstream rebuilds for it.
        assertSame(fetched.rows, client.refresh().rows)
        assertSame(fetched.rows, client.cached()!!.rows)
        clock.now += 13 * 3600_000L
        fail = true
        val stale = client.refresh()
        assertFalse("A failed request is reported, so it is tried again", stale.ok)
        assertSame(fetched.rows, stale.rows)
        // An answer equal to the saved copy keeps the saved object too.
        fail = false
        assertSame(fetched.rows, client.refresh(force = true).rows)
        // Retries back off from 5 minutes to an hour.
        assertEquals(listOf(5L, 10, 20, 40, 60, 60, 60), (0..6).map { CatalogRowsClient.retryDelay(it) / 60_000 })
    }

    @Test fun withoutAnyCopyAFailureMeansNoTmdb() = runBlocking {
        val client = CatalogRowsClient(cache, fetch = { throw IOException("offline") })
        assertSame(CatalogRows.NONE, client.load())
        assertFalse(cache.exists())
        assertNull(client.cached())
    }

    @Test fun aNoneAnswerIsKeptLikeAnyOtherAndReplacedWhenTmdbArrives() = runBlocking {
        val clock = Clock()
        var count = 0
        var body = noneBody
        val client = CatalogRowsClient(cache, fetch = { count++; body }, now = { clock.now })
        assertFalse(client.load().usesTmdb)
        clock.now += 11 * 3600_000L
        assertFalse(client.load().usesTmdb)
        assertEquals(1, count)
        clock.now += 2 * 3600_000L
        body = tmdbBody
        assertTrue(client.load().usesTmdb)
        assertEquals(2, count)
    }

    @Test fun downloadsThroughTheAppClientAndFallsBackWhenTheServerFails() = runBlocking {
        val server = ServerSocket(0)
        val executor = Executors.newCachedThreadPool()
        val requests = Collections.synchronizedList(ArrayList<String>())
        var status = "200 OK"
        executor.submit {
            while (!server.isClosed) runCatching {
                server.accept().use { socket ->
                    val reader = socket.getInputStream().bufferedReader()
                    val head = generateSequence { reader.readLine()?.takeIf { it.isNotEmpty() } }.toList()
                    requests += head.joinToString("\n")
                    val bytes = (if (status.startsWith("200")) tmdbBody else noneBody).toByteArray() // the server's 503 carries a "none" body
                    socket.getOutputStream().apply {
                        write("HTTP/1.1 $status\r\nContent-Type: application/json\r\nContent-Length: ${bytes.size}\r\nConnection: close\r\n\r\n".toByteArray())
                        write(bytes); flush()
                    }
                }
            }
        }
        try {
            val clock = Clock()
            val client = CatalogRowsClient(cache, "http://127.0.0.1:${server.localPort}/api/catalog/rows?v=1", now = { clock.now })
            assertTrue(client.load().usesTmdb)
            assertTrue(requests.single().startsWith("GET /api/catalog/rows?v=1 HTTP/1.1"))
            assertTrue(requests.single().lines().any { it.equals("User-Agent: ${CatalogRowsClient.USER_AGENT}", ignoreCase = true) })
            val saved = cache.readText()
            // TMDB failing on the server is a 503 (no-store): a failed request, never saved.
            status = "503 Service Unavailable"
            clock.now += 13 * 3600_000L
            assertTrue("Served from the stale copy", client.load().usesTmdb)
            assertEquals(2, requests.size)
            assertEquals(saved, cache.readText())
        } finally {
            server.close(); executor.shutdownNow(); executor.awaitTermination(2, TimeUnit.SECONDS)
        }
    }
}

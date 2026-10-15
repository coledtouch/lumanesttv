package tv.lumanest.tuner

import tv.lumanest.tuner.data.*
import kotlinx.coroutines.*
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import java.io.File
import java.net.ServerSocket
import java.util.UUID
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class RepositorySnapshotTest {
    @get:Rule val temporary = TemporaryFolder()
    private val context get() = RuntimeEnvironment.getApplication()
    private lateinit var cacheRoot: File
    private lateinit var snapshotRoot: File
    private lateinit var store: CatalogSnapshots
    private val now get() = System.currentTimeMillis()
    private val categories = listOf(Category("1", "US News"))
    private val channel = Channel("x:1", 1, "CNN", null, "1", "CNN.us", "1", "https://example.invalid/live.ts")
    private fun identity(source: Source) = CatalogSnapshots.identity(source, Repo.prefs.liveFormat, Repo.prefs.localZip.value)

    @Before fun prepare() {
        Repo.init(context)
        Repo.prefs.setActive(null); Repo.load()
        // Robolectric replaces Application per method while Kotlin's Repo singleton survives.
        // Isolate disk roots explicitly; short paths also avoid host-specific path limits.
        cacheRoot = temporary.newFolder("sources")
        snapshotRoot = temporary.newFolder("catalogues")
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
        File(cacheRoot, "logos/logos.json").apply { parentFile!!.mkdirs(); writeText("[]") }
        Repo.prefs.setActive(null); Repo.load()
        val logo = Repo::class.java.getDeclaredField("logoJob").apply { isAccessible = true }
        (logo.get(null) as? Job)?.cancel(); logo.set(null, null)
    }

    private fun source(server: Fixture) = Source(UUID.randomUUID().toString(), "Snapshot fixture", SourceType.XTREAM,
        server.url, "fixture", "fixture", epgUrl = server.url + "/guide.xml", hotUrl = server.url + "/featured.m3u")

    private fun seed(source: Source, at: Long = now, selected: Channel = channel) {
        val id = identity(source)
        store.writeLive(id, CatalogSnapshots.Live(listOf(selected), categories, mapOf("x:folded" to selected.key)), at)
        store.writeMovies(id, ContentPolicy.Catalogue(listOf(Movie("m:2", "Saved film", null, null, "1", "https://example.invalid/film.mp4")), categories), now)
        store.writeSeries(id, ContentPolicy.Catalogue(listOf(Series("3", "Saved show", null, null, null, "1", null, null, null)), categories), now)
        store.writeTrending(id, listOf(selected), now)
        store.writeGuide(id, CatalogSnapshots.Guide(mapOf(selected.key to listOf(Program(now - 1000, now + 3_600_000, "Current show"))), emptyMap()), now)
        assertEquals("Seed snapshot must decode before loading", selected, store.readLive(id)?.value?.channels?.single())
    }
    private suspend fun await(check: () -> Boolean) {
        try { withTimeout(5_000) { while (!check()) delay(10) } }
        catch (e: TimeoutCancellationException) {
            val job = Repo::class.java.getDeclaredField("job").apply { isAccessible = true }.get(null) as? Job
            throw AssertionError("Repository wait failed: live=${Repo.liveStatus.value.javaClass.simpleName}, movies=${Repo.vodStatus.value.javaClass.simpleName}, " +
                "channels=${Repo.channels.value.size}, films=${Repo.movies.value.size}, shows=${Repo.series.value.size}, " +
                "jobActive=${job?.isActive}, jobCancelled=${job?.isCancelled}, jobCompleted=${job?.isCompleted}", e)
        }
    }

    @Test fun freshCleanedCataloguesAndMostWatchedRestoreWithoutProviderCatalogueRequests() = runBlocking {
        Fixture().use { server ->
            val source = source(server)
            Repo.prefs.saveSource(source); Repo.prefs.setActive(source.id)
            seed(source)
            // Invalid raw files prove the warm path uses decoded snapshots rather than provider parsing.
            File(cacheRoot, "${identity(source).source}/live.json").apply { parentFile!!.mkdirs(); writeText("invalid") }
            Repo.load()
            await { Repo.channels.value.isNotEmpty() && Repo.movies.value.isNotEmpty() && Repo.series.value.isNotEmpty() && Repo.trending.value.isNotEmpty() && Repo.programsFor(channel) != null }
            delay(100)
            assertEquals("CNN", Repo.channels.value.single().name)
            assertEquals("Saved film", Repo.movies.value.single().name)
            assertEquals("Saved show", Repo.series.value.single().name)
            assertEquals(channel.key, Repo.trending.value.single().key)
            assertFalse(server.requests.any { "action=" in it || "/featured.m3u" in it })
        }
    }

    @Test fun staleLiveSnapshotRestoresGuideBeforeDelayedLiveRefreshCompletes() = runBlocking {
        Fixture(block = true).use { server ->
            val source = source(server)
            Repo.prefs.saveSource(source); Repo.prefs.setActive(source.id)
            seed(source, now - 3 * 3_600_000L)
            Repo.load()
            await { server.requests.any { "get_live_streams" in it } }
            await { Repo.programsFor(channel)?.firstOrNull()?.title == "Current show" }
            assertEquals(listOf(channel), Repo.channels.value)
            assertTrue(Repo.liveStatus.value is LoadStatus.Loading)
            assertEquals(1L, server.release.count)
        }
    }

    @Test fun forcedRefreshKeepsVisibleCataloguesAndCurrentGuide() = runBlocking {
        Fixture(block = true).use { server ->
            val source = source(server)
            Repo.prefs.saveSource(source); Repo.prefs.setActive(source.id)
            seed(source)
            Repo.load()
            await { Repo.channels.value == listOf(channel) && Repo.movies.value.isNotEmpty() && Repo.programsFor(channel) != null }
            Repo.putPrograms(mapOf("past" to listOf(Program(now - 3000, now - 1000, "Expired"))))
            Repo.load(force = true)
            await { Repo.liveStatus.value is LoadStatus.Loading && server.requests.any { "get_live_streams" in it } }
            assertEquals(listOf(channel), Repo.channels.value)
            assertEquals("Saved film", Repo.movies.value.single().name)
            assertEquals("Current show", Repo.programsFor(channel)?.first()?.title)
            assertNull(Repo.programsFor(channel.copy(key = "past")))
        }
    }

    @Test fun credentialChangeClearsOldAccountAndItsLateRefreshCannotPublish() = runBlocking {
        Fixture(block = true).use { server ->
            val first = source(server)
            Repo.prefs.saveSource(first); Repo.prefs.setActive(first.id)
            seed(first)
            Repo.load()
            await { Repo.channels.value == listOf(channel) }
            Repo.load(force = true)
            await { server.requests.any { "get_live_streams" in it } }
            val changed = first.copy(password = "another-account")
            val other = channel.copy(key = "x:9", name = "ESPN")
            seed(changed, selected = other)
            Repo.prefs.saveSource(changed)
            Repo.load()
            assertFalse(Repo.channels.value.any { it.key == channel.key })
            await { Repo.channels.value == listOf(other) }
            server.release.countDown()
            delay(200)
            assertEquals(listOf(other), Repo.channels.value)
        }
    }

    @Test fun restoreHiddenChannelsRebuildsCleanedCacheFromValidRawData() = runBlocking {
        Fixture().use { server ->
            val source = source(server)
            Repo.prefs.saveSource(source); Repo.prefs.setActive(source.id)
            seed(source)
            val dir = File(cacheRoot, identity(source).source).apply { mkdirs() }
            File(dir, "live_cats.json").writeText("""[{"category_id":"1","category_name":"US News"}]""")
            File(dir, "live.json").writeText("""[{"stream_id":1,"name":"[US] CNN","category_id":"1"},{"stream_id":2,"name":"[US] MSNBC","category_id":"1"}]""")
            Repo.prefs.markDead(setOf("x:2"))
            Repo.load()
            await { Repo.channels.value == listOf(channel) }
            Repo.restoreHiddenChannels()
            await { Repo.channels.value.any { it.key == "x:2" } }
            await { store.readLive(identity(source))?.value?.channels?.size == 2 }
            assertEquals(2, store.readLive(identity(source))!!.value.channels.size)
            assertFalse("Restoring hidden channels must use the valid raw catalogue", server.requests.any { "get_live_streams" in it })
            Repo.clearCache()
            assertFalse("Clear Cache must remove the finished catalogue directory", snapshotRoot.exists())
        }
    }

    @Test fun clearingCacheCannotBeUndoneByAnAlreadyQueuedGuideWrite() = runBlocking {
        Fixture(block = true).use { server ->
            val source = source(server)
            Repo.prefs.saveSource(source); Repo.prefs.setActive(source.id)
            seed(source)
            val dir = File(cacheRoot, identity(source).source).apply { mkdirs() }
            File(dir, "live_cats.json").writeText("""[{"category_id":"1","category_name":"US News"}]""")
            File(dir, "live.json").writeText("""[{"stream_id":1,"name":"[US] CNN","category_id":"1"},{"stream_id":2,"name":"[US] MSNBC","category_id":"1"}]""")
            val rawGuide = File(dir, "epg.xml").apply { writeText("<tv></tv>") }
            Repo.load()
            fun loadJob() = Repo::class.java.getDeclaredField("job").apply { isAccessible = true }.get(null) as Job
            withTimeout(5_000) { loadJob().join() }
            assertEquals(listOf(channel), Repo.channels.value)
            assertTrue("The next guide refresh needs the held fixture response", rawGuide.delete())
            Repo.restoreHiddenChannels()
            val loading = loadJob()
            await { Repo.channels.value.any { it.key == "x:2" } }
            // The provider request starts only after the cached guide read completes.
            // Hold its response while acquiring the write monitor, so a reader
            // cannot accidentally satisfy the writer barrier below.
            await { server.requests.any { "/guide.xml" in it } }

            // Hold the actual file-write monitor after the restored guide is decoded.
            // This makes cancellation race with a synchronous writer, without sleeps
            // or production hooks, and covers the cache directory recreated in CI.
            @Suppress("UNCHECKED_CAST")
            val locks = CatalogSnapshots::class.java.getDeclaredField("locks").apply { isAccessible = true }.get(null) as Map<String, Any>
            val writeLock = checkNotNull(locks[File(snapshotRoot, "${identity(source).live}-guide.bin").absolutePath])
            val held = CountDownLatch(1)
            val release = CountDownLatch(1)
            val writerGate = Executors.newSingleThreadExecutor()
            val clearing = Executors.newSingleThreadExecutor()
            try {
                writerGate.submit { synchronized(writeLock) { held.countDown(); release.await(5, TimeUnit.SECONDS) } }
                assertTrue("The guide-write gate did not start", held.await(1, TimeUnit.SECONDS))
                server.release.countDown()
                await {
                    Thread.getAllStackTraces().any { (thread, trace) ->
                        thread.state == Thread.State.BLOCKED && trace.firstOrNull()?.let {
                            it.className == CatalogSnapshots::class.java.name && it.methodName == "write"
                        } == true
                    }
                }
                val generation = Repo::class.java.getDeclaredField("generation").apply { isAccessible = true }
                val beforeClear = generation.getLong(null)
                val clear = clearing.submit { Repo.clearCache() }
                await { generation.getLong(null) != beforeClear }
                release.countDown()
                withContext(Dispatchers.IO) { clear.get(5, TimeUnit.SECONDS) }
                withTimeout(5_000) { loading.join() }
                assertFalse("A cancelled guide writer recreated the cleared catalogue directory", snapshotRoot.exists())
                assertEquals("Clearing cache must retain the usable restored lineup", 2, Repo.channels.value.size)
            } finally {
                release.countDown(); writerGate.shutdownNow(); clearing.shutdownNow()
            }
        }
    }

    @Test fun legacyRawCacheIsBoundOnceAndNeverMigratesToEditedCredentials() = runBlocking {
        Fixture().use { server ->
            val source = source(server)
            Repo.prefs.saveSource(source); Repo.prefs.setActive(source.id)
            val legacy = File(cacheRoot, source.id).apply { mkdirs() }
            File(legacy, "live_cats.json").writeText("""[{"category_id":"1","category_name":"US News"}]""")
            File(legacy, "live.json").writeText("""[{"stream_id":1,"name":"[US] CNN","category_id":"1"}]""")
            seed(source)
            store.invalidateLive(identity(source))
            Repo.load()
            await { Repo.channels.value.any { it.name == "CNN" } }
            assertTrue(File(legacy, "catalogue-identity").isFile)
            val changed = source.copy(password = "changed")
            Repo.prefs.saveSource(changed); Repo.load()
            await { Repo.liveStatus.value is LoadStatus.Error }
            assertTrue(Repo.channels.value.isEmpty())
            assertFalse(File(cacheRoot, "${identity(changed).source}/live.json").exists())
        }
    }

    @Test fun refreshedStreamListPublishesWhenOlderCategoriesFallBackUnchanged() = runBlocking {
        Fixture(liveBody = """[{"stream_id":2,"name":"[US] MSNBC","category_id":"1"}]""").use { server ->
            val source = source(server)
            Repo.prefs.saveSource(source); Repo.prefs.setActive(source.id)
            val old = now - 3 * 3_600_000L
            seed(source, old)
            val dir = File(cacheRoot, identity(source).source).apply { mkdirs() }
            File(dir, "live_cats.json").apply {
                writeText("""[{"category_id":"1","category_name":"US News"}]"""); setLastModified(old)
            }
            File(dir, "live.json").apply {
                writeText("""[{"stream_id":1,"name":"[US] CNN","category_id":"1"}]"""); setLastModified(old)
            }
            Repo.load()
            await { Repo.channels.value.any { it.key == "x:2" } }
            assertEquals("MSNBC", Repo.channels.value.single().name)
            assertEquals(old, File(dir, "live_cats.json").lastModified())
        }
    }

    @Test fun cachedLivePublicationGetsPriorityOverLargeLibraryDecoding() = runBlocking {
        Fixture().use { server ->
            val source = source(server)
            Repo.prefs.saveSource(source); Repo.prefs.setActive(source.id)
            seed(source)
            val held = CountDownLatch(1)
            val release = CountDownLatch(1)
            val executor = Executors.newSingleThreadExecutor()
            try {
                // A held preference lock models an outstanding alias commit without slowing file I/O.
                executor.submit { synchronized(Repo.prefs) { held.countDown(); release.await(5, TimeUnit.SECONDS) } }
                assertTrue(held.await(1, TimeUnit.SECONDS))
                Repo.load()
                await { Repo.snapshotDiagnostics().contains("livePublish=remapping") }
                val diagnostics = Repo.snapshotDiagnostics()
                assertFalse("Movies must not compete with the first live publication", diagnostics.contains("movies="))
                assertFalse("Series must not compete with the first live publication", diagnostics.contains("series="))
            } finally { release.countDown(); executor.shutdownNow() }
            await { Repo.channels.value.isNotEmpty() && Repo.movies.value.isNotEmpty() && Repo.series.value.isNotEmpty() }
        }
    }

    @Test fun clearingCacheCancelsLoadingStatusesWhileKeepingUsableCatalogues() = runBlocking {
        Fixture(block = true).use { server ->
            val source = source(server)
            Repo.prefs.saveSource(source); Repo.prefs.setActive(source.id)
            seed(source)
            Repo.load()
            await { Repo.channels.value.isNotEmpty() && Repo.movies.value.isNotEmpty() && Repo.series.value.isNotEmpty() && Repo.programsFor(channel) != null }
            Repo.load(force = true)
            await { Repo.liveStatus.value is LoadStatus.Loading && Repo.vodStatus.value is LoadStatus.Error && Repo.seriesStatus.value is LoadStatus.Error }
            val error = Repo.seriesStatus.value
            Repo.vodStatus.value = LoadStatus.Ready
            Repo.seriesStatus.value = error
            Repo.epgStatus.value = LoadStatus.Loading("Refreshing fixture guide")
            Repo.clearCache()
            assertEquals(LoadStatus.Idle, Repo.liveStatus.value)
            assertEquals(LoadStatus.Idle, Repo.epgStatus.value)
            assertEquals(LoadStatus.Ready, Repo.vodStatus.value)
            assertEquals(error, Repo.seriesStatus.value)
            assertEquals(listOf(channel), Repo.channels.value)
            assertEquals("Saved film", Repo.movies.value.single().name)
            assertEquals("Saved show", Repo.series.value.single().name)
            assertEquals("Current show", Repo.programsFor(channel)?.first()?.title)
            val statuses = listOf(Repo.liveStatus, Repo.vodStatus, Repo.seriesStatus, Repo.epgStatus)
            statuses.forEach { it.value = LoadStatus.Loading("Refreshing fixture") }
            Repo.clearCache()
            statuses.forEach { assertEquals(LoadStatus.Idle, it.value) }
        }
    }

    @Test fun sourceSwitchDuringBlockedAliasCommitCannotAlterNewSourcePreferences() = runBlocking {
        Fixture().use { server ->
            val first = source(server)
            val second = source(server)
            val other = channel.copy(key = "x:9", name = "ESPN")
            Repo.prefs.saveSource(first); Repo.prefs.saveSource(second)
            seed(first); seed(second, selected = other)
            // The second account has no folded aliases, so its same-named keys must stay independent.
            store.invalidateLive(identity(second))
            store.writeLive(identity(second), CatalogSnapshots.Live(listOf(other), categories, emptyMap()), now)
            Repo.prefs.setActive(second.id)
            Repo.prefs.toggleFavorite("x:folded")
            Repo.prefs.lastChannelKey = "x:folded"
            Repo.prefs.recordWatched("x:folded", 10)
            val favorites = Repo.prefs.favorites.value
            val history = Repo.prefs.watchHistory.value
            val prefsField = Repo.prefs.javaClass.getDeclaredField("sp").apply { isAccessible = true }
            val storage = prefsField.get(Repo.prefs) as android.content.SharedPreferences
            val aliasKey = "watchAliases_${second.id}"
            val aliases = storage.getString(aliasKey, null)
            Repo.prefs.setActive(first.id)

            val held = CountDownLatch(1)
            val switchNow = CountDownLatch(1)
            val switched = CountDownLatch(1)
            val release = CountDownLatch(1)
            val executor = Executors.newSingleThreadExecutor()
            try {
                executor.submit { synchronized(Repo.prefs) {
                    held.countDown()
                    check(switchNow.await(5, TimeUnit.SECONDS))
                    Repo.prefs.setActive(second.id)
                    switched.countDown()
                    release.await(5, TimeUnit.SECONDS)
                } }
                assertTrue(held.await(1, TimeUnit.SECONDS))
                Repo.load()
                val oldJob = Repo::class.java.getDeclaredField("job").apply { isAccessible = true }.get(null) as Job
                await { Repo.snapshotDiagnostics().contains("livePublish=remapping") }
                switchNow.countDown()
                assertTrue(switched.await(1, TimeUnit.SECONDS))
                // Release Prefs before starting another Repo.load: the old commit owns the Repo lock.
                release.countDown()
                await { oldJob.isCompleted }
                assertEquals(second.id, Repo.prefs.activeId.value)
                assertEquals(favorites, Repo.prefs.favorites.value)
                assertEquals(history, Repo.prefs.watchHistory.value)
                assertEquals("x:folded", Repo.prefs.lastChannelKey)
                assertEquals(aliases, storage.getString(aliasKey, null))
                assertTrue("The old account must not publish rows after selection changed", Repo.channels.value.isEmpty())
                Repo.load()
                await { Repo.channels.value == listOf(other) }
                assertEquals(favorites, Repo.prefs.favorites.value)
                assertEquals(history, Repo.prefs.watchHistory.value)
                assertEquals(aliases, storage.getString(aliasKey, null))
            } finally { switchNow.countDown(); release.countDown(); executor.shutdownNow() }
        }
    }

    private class Fixture(block: Boolean = false, private val liveBody: String? = null) : AutoCloseable {
        private val socket = ServerSocket(0)
        private val workers = Executors.newCachedThreadPool()
        val url = "http://127.0.0.1:${socket.localPort}"
        val requests = CopyOnWriteArrayList<String>()
        val release = CountDownLatch(if (block) 1 else 0)
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
                            // Hold both live inputs/guide without saturating all five host slots.
                            if ("get_live_streams" in request || "get_live_categories" in request || "/guide.xml" in request) release.await(5, TimeUnit.SECONDS)
                            val body = if ("/guide.xml" in request) "<tv></tv>" else if ("get_live_streams" in request && liveBody != null) liveBody else "unavailable"
                            val bytes = body.toByteArray()
                            val status = if ("/guide.xml" in request || ("get_live_streams" in request && liveBody != null)) "200 OK" else "503 Unavailable"
                            it.getOutputStream().apply {
                                write("HTTP/1.1 $status\r\nContent-Length: ${bytes.size}\r\nConnection: close\r\n\r\n".toByteArray())
                                write(bytes); flush()
                            }
                        }
                    }
                }
            }
        }
        override fun close() { release.countDown(); socket.close(); workers.shutdownNow() }
    }
}

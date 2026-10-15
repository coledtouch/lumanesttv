package tv.lumanest.tuner

import tv.lumanest.tuner.data.*
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.io.File
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.nio.ByteBuffer
import java.util.zip.CRC32
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class CatalogSnapshotsTest {
    @get:Rule val temporary = TemporaryFolder()
    private val source = Source("account", "Playlist", SourceType.XTREAM, "https://example.invalid", "user", "password")
    private val now = System.currentTimeMillis()
    private val identity = CatalogSnapshots.identity(source, "ts", "01608")
    private val categories = listOf(Category("news", "US News"), Category("local", "Local News"))
    private val channel = Channel("x:1", 7, "CNN", "https://example.invalid/logo.png", "news", "CNN.us", "1",
        "HTTPS://example.invalid/live.ts", listOf("news", "local"), "US", "en", listOf("https://example.invalid/backup.ts"))
    private fun store() = CatalogSnapshots(temporary.root)
    private fun liveFile() = File(temporary.root, identity.live + "-live.bin")

    @Test fun channelAndTrendingRoundTripsRetainPlaybackCategoriesAndAliases() {
        val value = CatalogSnapshots.Live(listOf(channel), categories, mapOf("x:copy" to channel.key))
        store().writeLive(identity, value, now)
        store().writeTrending(identity, listOf(channel), now)
        assertEquals(value, store().readLive(identity, now)?.value)
        assertEquals(listOf(channel), store().readTrending(identity, now)?.value?.channels)
        assertTrue(store().readLive(identity, now)!!.fresh(7_200_000L, now))
        assertFalse(store().readLive(identity, now)!!.fresh(7_200_000L, now + 7_200_000L))
    }

    @Test fun unrestrictedMovieAndSeriesMetadataSurvivesRestart() {
        val movie = Movie("m:1", "Film", "https://example.invalid/poster", "8.5", "news", "https://example.invalid/movie.mkv",
            123, listOf("news", "local"), "FR", "fr", listOf("https://example.invalid/movie-copy.mkv"))
        val series = Series("1", "Show", "cover", "plot", "9", "news", "Drama", "2026", "backdrop", 456, listOf("news", "local"), "JP", "ja")
        store().writeMovies(identity, ContentPolicy.Catalogue(listOf(movie), categories), now)
        store().writeSeries(identity, ContentPolicy.Catalogue(listOf(series), categories), now)
        assertEquals(movie, store().readMovies(identity, now)?.value?.items?.single())
        assertEquals(series, store().readSeries(identity, now)?.value?.items?.single())
    }

    @Test fun accountConfigurationAndRegionalPolicyCannotShareLiveSnapshot() {
        store().writeLive(identity, CatalogSnapshots.Live(listOf(channel), categories, emptyMap()), now)
        listOf(source.copy(password = "changed"), source.copy(username = "changed"), source.copy(server = "https://other.invalid"),
            source.copy(m3uUrl = "https://other.invalid/list"), source.copy(epgUrl = "https://other.invalid/guide"),
            source.copy(userAgent = "changed"), source.copy(hotUrl = "https://other.invalid/trending"), source.copy(id = "other")).forEach {
            assertNull(store().readLive(CatalogSnapshots.identity(it, "ts", "01608"), now))
        }
        assertNull(store().readLive(CatalogSnapshots.identity(source, "m3u8", "01608"), now))
        assertNull(store().readLive(CatalogSnapshots.identity(source, "ts", ""), now))
        assertEquals(identity, CatalogSnapshots.identity(source.copy(name = "Renamed"), "ts", "01608"))
        assertNotEquals(identity.catalogue, identity.source)
        assertEquals(identity.catalogue, CatalogSnapshots.identity(source, "m3u8", "").catalogue)
    }

    @Test fun truncationChecksumAndSchemaCorruptionAreRejected() {
        store().writeLive(identity, CatalogSnapshots.Live(listOf(channel), categories, emptyMap()), now)
        val valid = liveFile().readBytes()
        liveFile().writeBytes(valid.copyOf(valid.size - 1))
        assertNull(store().readLive(identity, now))
        val damaged = valid.copyOf().apply { this[size - 9] = (this[size - 9].toInt() xor 1).toByte() }
        liveFile().writeBytes(damaged)
        assertNull(store().readLive(identity, now))
        val wrongSchema = valid.copyOf()
        ByteBuffer.wrap(wrongSchema).putInt(4, 99)
        val crc = CRC32().apply { update(wrongSchema, 0, wrongSchema.size - 8) }.value
        ByteBuffer.wrap(wrongSchema).putLong(wrongSchema.size - 8, crc)
        liveFile().writeBytes(wrongSchema)
        assertNull(store().readLive(identity, now))
    }

    @Test fun expiredOrFutureSnapshotAndInvalidStreamsAreRejected() {
        val value = CatalogSnapshots.Live(listOf(channel), categories, emptyMap())
        store().writeLive(identity, value, now - 8 * 86_400_000L)
        assertNull(store().readLive(identity, now))
        store().invalidateLive(identity)
        store().writeLive(identity, value, now + 600_000L)
        assertNull(store().readLive(identity, now))
        store().invalidateLive(identity)
        store().writeLive(identity, value.copy(channels = listOf(channel.copy(url = "file:///private"))), now)
        assertNull(store().readLive(identity, now))
    }

    @Test fun failedAtomicReplacementKeepsLastUsableCatalogue() {
        val value = CatalogSnapshots.Live(listOf(channel), categories, emptyMap())
        store().writeLive(identity, value, now)
        assertTrue(runCatching { store().writeLive(identity, value.copy(channels = listOf(channel.copy(name = "x".repeat(1_048_577)))), now) }.isFailure)
        assertEquals(value, store().readLive(identity, now)?.value)
        // Modern Android leaves the last committed base alongside an interrupted .new file.
        val interrupted = File(liveFile().path + ".new").apply { writeText("incomplete") }
        assertEquals(value, store().readLive(identity, now)?.value)
        assertFalse(interrupted.exists())
        // Legacy Android can recover a backup when an interrupted replacement has no base.
        // File.renameTo cannot replace an existing destination on Windows as it does on Android.
        liveFile().copyTo(File(liveFile().path + ".bak"))
        assertTrue(liveFile().delete())
        assertEquals(value, store().readLive(identity, now)?.value)
        store().invalidateLive(identity)
        assertNull(store().readLive(identity, now))
    }

    @Test fun guideRetainsEightHoursAndDropsPastListingsAtRestore() {
        val halfHour = 1_800_000L
        val programs = (0 until 24).map { Program(now + it * halfHour, now + (it + 1) * halfHour, "Show $it", "Description", "Episode", false) }
        store().writeGuide(identity, CatalogSnapshots.Guide(mapOf(channel.key to programs), mapOf(channel.key to "icon")), now)
        val restored = store().readGuide(identity, now + 5 * 3_600_000L)!!.value
        assertEquals(6, restored.programs[channel.key]!!.size)
        assertEquals("Show 10", restored.programs[channel.key]!!.first().title)
        assertEquals("Episode", restored.programs[channel.key]!!.first().subtitle)
        assertEquals("icon", restored.icons[channel.key])
        assertTrue(store().readGuide(identity, now + 8 * 3_600_000L)!!.value.programs.isEmpty())
    }

    @Test fun concurrentAtomicUpdatesCannotInvalidateReadersOfTheSameCatalogue() {
        val shared = store()
        val value = CatalogSnapshots.Live(listOf(channel), categories, emptyMap())
        shared.writeLive(identity, value, now)
        val executor = Executors.newFixedThreadPool(4)
        try {
            val work = (0 until 4).map { worker -> executor.submit {
                repeat(20) {
                    if (worker % 2 == 0) shared.writeLive(identity, value, now)
                    else assertEquals(value, shared.readLive(identity, now)?.value)
                }
            } }
            work.forEach { it.get(10, TimeUnit.SECONDS) }
            assertEquals(value, shared.readLive(identity, now)?.value)
        } finally { executor.shutdownNow() }
    }

    @Test fun oversizedCollectionsRollBackToLastUsableSnapshot() {
        val value = CatalogSnapshots.Live(listOf(channel), categories, emptyMap())
        val shared = store()
        shared.writeLive(identity, value, now)
        val original = liveFile().readBytes()
        val tooManyChannels = value.copy(channels = java.util.Collections.nCopies(50_001, channel))
        assertTrue(runCatching { shared.writeLive(identity, tooManyChannels, now) }.exceptionOrNull() is IOException)
        assertArrayEquals(original, liveFile().readBytes())
        val tooManyCategoriesPerChannel = value.copy(channels = listOf(channel.copy(categoryIds = java.util.Collections.nCopies(1_001, "news"))))
        assertTrue(runCatching { shared.writeLive(identity, tooManyCategoriesPerChannel, now) }.exceptionOrNull() is IOException)
        assertArrayEquals(original, liveFile().readBytes())
        assertEquals(value, shared.readLive(identity, now)?.value)
        assertFalse(File(liveFile().path + ".new").exists())
    }

    @Test fun byteBudgetRejectsOverflowBeforeChangingDestination() {
        val destination = ByteArrayOutputStream()
        val bounded = CatalogSnapshots.BoundedOutput(destination, 4)
        bounded.write(byteArrayOf(1, 2, 3))
        assertTrue(runCatching { bounded.write(byteArrayOf(4, 5)) }.exceptionOrNull() is IOException)
        assertArrayEquals(byteArrayOf(1, 2, 3), destination.toByteArray())
        bounded.write(4)
        assertTrue(runCatching { bounded.write(5) }.exceptionOrNull() is IOException)
        assertArrayEquals(byteArrayOf(1, 2, 3, 4), destination.toByteArray())
    }
}

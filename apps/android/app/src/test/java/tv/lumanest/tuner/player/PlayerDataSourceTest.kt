package tv.lumanest.tuner.player

import android.net.Uri
import androidx.annotation.OptIn
import androidx.media3.common.C
import androidx.media3.common.PlaybackException
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DataSource
import androidx.media3.datasource.DataSourceException
import androidx.media3.datasource.DataSpec
import androidx.media3.datasource.TransferListener
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import java.io.File

/**
 * [PlayerDataSource] with real android.net.Uri parsing (Robolectric): http(s) reaches the stream source untouched, the
 * subtitle copy is read from disk, and every other link fails before anything is opened.
 */
@OptIn(UnstableApi::class)
@RunWith(RobolectricTestRunner::class)
class PlayerDataSourceTest {
    @get:Rule val tmp = TemporaryFolder()

    private lateinit var subtitles: File
    private lateinit var vtt: File
    private val body = "WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nHello\n"

    /** A stream source that records what it was asked to open. */
    private class Streams : DataSource {
        val opened = ArrayList<DataSpec>()
        val listeners = ArrayList<TransferListener>()
        var closed = 0
        var failOpen = false
        private val bytes = "#EXTM3U\n".toByteArray()
        private var at = 0
        private var uri: Uri? = null
        override fun addTransferListener(transferListener: TransferListener) { listeners += transferListener }
        override fun open(dataSpec: DataSpec): Long {
            opened += dataSpec; uri = dataSpec.uri; at = 0
            if (failOpen) throw java.io.IOException("refused by the provider")
            return bytes.size.toLong()
        }
        override fun read(buffer: ByteArray, offset: Int, length: Int): Int {
            if (at == bytes.size) return C.RESULT_END_OF_INPUT
            val n = minOf(length, bytes.size - at)
            System.arraycopy(bytes, at, buffer, offset, n); at += n
            return n
        }
        override fun getUri(): Uri? = uri
        override fun getResponseHeaders(): Map<String, List<String>> = mapOf("Content-Type" to listOf("application/vnd.apple.mpegurl"))
        override fun close() { closed++; uri = null }
    }

    private class Transfers : TransferListener {
        var started = 0
        var bytes = 0
        override fun onTransferInitializing(source: DataSource, dataSpec: DataSpec, isNetwork: Boolean) = Unit
        override fun onTransferStart(source: DataSource, dataSpec: DataSpec, isNetwork: Boolean) { started++ }
        override fun onBytesTransferred(source: DataSource, dataSpec: DataSpec, isNetwork: Boolean, bytesTransferred: Int) { bytes += bytesTransferred }
        override fun onTransferEnd(source: DataSource, dataSpec: DataSpec, isNetwork: Boolean) = Unit
    }

    private val streams = Streams()
    private lateinit var source: PlayerDataSource

    @Before fun folders() {
        subtitles = File(tmp.newFolder("cache"), "subtitles").apply { mkdirs() }
        vtt = File(subtitles, "0123456789abcdef0123456789abcdef.vtt").apply { writeText(body) }
        File(subtitles.parentFile, "secret.txt").writeText("token")
        source = PlayerDataSource(streams) { subtitles }
    }

    private fun readAll(s: DataSource): ByteArray {
        val out = java.io.ByteArrayOutputStream()
        val buffer = ByteArray(7)
        while (true) {
            val n = s.read(buffer, 0, buffer.size)
            if (n == C.RESULT_END_OF_INPUT) return out.toByteArray()
            out.write(buffer, 0, n)
        }
    }

    private fun assertRefused(link: String) {
        try {
            source.open(DataSpec(Uri.parse(link)))
            fail("opened $link")
        } catch (e: DataSourceException) {
            assertEquals(link, "unsupported scheme", e.message)
            assertEquals(link, PlaybackException.ERROR_CODE_FAILED_RUNTIME_CHECK, e.reason)
        }
        assertNull(link, source.uri)
        source.close()
        assertTrue(link, streams.opened.isEmpty())
    }

    @Test fun httpAndHttpsGoToTheStreamSourceUntouched() {
        for (link in listOf("http://provider.example:8080/live/u/p/1.ts", "https://lumanest.tv/x.m3u8", "HTTPS://Provider.Example/Movie/1.mkv")) {
            val spec = DataSpec(Uri.parse(link))
            assertEquals(8L, source.open(spec))
            assertTrue(streams.opened.last() === spec)
            assertEquals(Uri.parse(link), source.uri)
            assertEquals(listOf("application/vnd.apple.mpegurl"), source.responseHeaders["Content-Type"])
            assertArrayEquals("#EXTM3U\n".toByteArray(), readAll(source))
            source.close()
            assertNull(source.uri)
        }
        assertEquals(3, streams.closed)
    }

    /** Media3 closes a source whose open failed; that close must reach the stream source (an OkHttp response). */
    @Test fun aFailedOpenIsStillClosedThrough() {
        streams.failOpen = true
        try { source.open(DataSpec(Uri.parse("http://provider.example/live/1.ts"))); fail() } catch (_: java.io.IOException) {}
        assertEquals(Uri.parse("http://provider.example/live/1.ts"), source.uri)
        source.close()
        assertEquals(1, streams.closed)
        assertNull(source.uri)
        // A subtitle copy that is gone fails as missing, not as refused.
        try {
            source.open(DataSpec(Uri.fromFile(File(subtitles, "fedcba9876543210fedcba9876543210.vtt")))); fail()
        } catch (e: java.io.IOException) {
            assertTrue(e.toString(), e !is DataSourceException || e.message != "unsupported scheme")
        }
        source.close()
    }

    @Test fun theSubtitleCopyIsReadFromDisk() {
        val listener = Transfers()
        source.addTransferListener(listener)
        assertEquals(listOf(listener), streams.listeners)
        for (link in listOf(Uri.fromFile(vtt), Uri.parse("FILE://" + vtt.path), Uri.parse("file://" + subtitles.path + "/x/%2E%2E/" + vtt.name))) {
            assertEquals(body.length.toLong(), source.open(DataSpec(link)))
            assertEquals(Uri.fromFile(vtt.canonicalFile), source.uri)
            assertEquals(body, String(readAll(source)))
            source.close()
        }
        assertTrue(streams.opened.isEmpty())
        assertEquals(3, listener.started)
        assertEquals(3 * body.length, listener.bytes)
    }

    @Test fun aListenerAddedAfterTheFileSourceExistsHearsItToo() {
        source.open(DataSpec(Uri.fromFile(vtt))); readAll(source); source.close()
        val listener = Transfers()
        source.addTransferListener(listener)
        source.open(DataSpec(Uri.fromFile(vtt))); readAll(source); source.close()
        assertEquals(1, listener.started)
    }

    @Test fun localFilesOutsideTheSubtitleFolderAreRefused() {
        assertRefused(Uri.fromFile(File(subtitles.parentFile, "secret.txt")).toString())
        assertRefused("file://" + subtitles.path + "/../secret.txt")
        assertRefused("file://" + subtitles.path + "/%2E%2E/secret.txt")
        assertRefused("file://" + subtitles.path + "%2F..%2Fsecret.txt")
        assertRefused("file:///data/data/tv.lumanest.tuner/shared_prefs/tuner.xml")
        // DefaultDataSource reads this one from the APK's assets.
        assertRefused("file:///android_asset/fonts/x.ttf")
        // No scheme: DefaultDataSource reads it as a local file.
        assertRefused(vtt.path)
        // An opaque file: link has no path.
        assertRefused("file:" + vtt.name)
    }

    @Test fun otherSchemesAreRefusedBeforeAnythingOpens() {
        for (link in listOf(
            "content://com.android.providers.media.documents/document/1",
            "asset:///index.html",
            "android.resource://tv.lumanest.tuner/raw/1",
            "rawresource:///1",
            "data:text/vtt;base64,V0VCVlRUCg==",
            "udp://239.0.0.1:1234",
            "rtmp://provider.example/live/1",
            "ftp://provider.example/1.ts",
            "Content://x/1",
            "DATA:,x",
        )) assertRefused(link)
    }

    @Test fun noSubtitleFolderMeansNoFiles() {
        source = PlayerDataSource(streams) { null }
        assertRefused(Uri.fromFile(vtt).toString())
    }

    @Test fun theFactoryMakesOneStreamSourcePerPlayerSource() {
        var made = 0
        val factory = PlayerDataSource.Factory({ made++; Streams() }) { subtitles }
        factory.createDataSource(); factory.createDataSource()
        assertEquals(2, made)
    }
}

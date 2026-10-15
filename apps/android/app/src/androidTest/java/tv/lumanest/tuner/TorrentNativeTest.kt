package tv.lumanest.tuner

import android.net.Uri
import android.os.Bundle
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.media3.datasource.DataSpec
import tv.lumanest.tuner.data.AddonSettings
import tv.lumanest.tuner.data.TorrentSpec
import tv.lumanest.tuner.player.EnglishAudio
import tv.lumanest.tuner.player.PlayerHolder
import tv.lumanest.tuner.player.TorrentDataSource
import tv.lumanest.tuner.player.TorrentEngine
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.security.MessageDigest
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

@RunWith(AndroidJUnit4::class)
@androidx.annotation.OptIn(androidx.media3.common.util.UnstableApi::class)
class TorrentNativeTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    @Test fun nativeEngineStartsAndCancelsMetadataWithoutLeakingCache() {
        val fixture = JSONObject(instrumentation.context.assets.open("torrent-fixture.json").bufferedReader().use { it.readText() })
        val uri = TorrentSpec(fixture.getString("hash"), 1).uri()
        val executor = Executors.newSingleThreadExecutor()
        try {
            instrumentation.runOnMainSync { PlayerHolder.stop(); TorrentEngine.resume() }
            val download = TorrentEngine.acquire(uri)
            val preparing = executor.submit<TorrentEngine.Video> { download.metadata { false } }
            port(download)
            TorrentEngine.pause()
            TorrentEngine.resume()
            TorrentEngine.stop()
            assertTrue(download.cancelled)
            try { preparing.get(5, TimeUnit.SECONDS); fail("Cancelled metadata unexpectedly completed") }
            catch (e: java.util.concurrent.ExecutionException) { assertTrue(e.cause is java.io.InterruptedIOException) }
            val root = java.io.File(instrumentation.targetContext.cacheDir, "torrent-playback")
            val end = System.currentTimeMillis() + 5_000
            while (root.listFiles().orEmpty().isNotEmpty() && System.currentTimeMillis() < end) Thread.sleep(50)
            assertTrue("Cancelled torrent retained temporary files", root.listFiles().orEmpty().isEmpty())
        } finally { TorrentEngine.stop(); executor.shutdownNow() }
    }
    @Test fun diagnoseConfiguredPlayback() = kotlinx.coroutines.runBlocking {
        val id = InstrumentationRegistry.getArguments().getString("movieId") ?: return@runBlocking
        val result = tv.lumanest.tuner.data.Torrentio.lookup(AddonSettings(instrumentation.targetContext).manifest, id, false)
        fun report(text: String) { instrumentation.sendStatus(2, Bundle().apply { putString("stream", "$text\n") }) }
        report("DIAG streams=${result.streams.size}")
        for (stream in result.streams.take(3)) {
            report("DIAG name=${stream.name.replace('\n', ' ')}")
            var url = stream.url
            repeat(5) {
                if (!url.startsWith("http")) return@repeat
                val client = tv.lumanest.tuner.data.Net.client.newBuilder().followRedirects(false).build()
                client.newCall(okhttp3.Request.Builder().url(url).header("Range", "bytes=0-1023").build()).execute().use { response ->
                    val location = response.header("Location")
                    if (location != null) {
                        url = response.request.url.resolve(location)?.toString().orEmpty()
                        val path = Uri.parse(url).lastPathSegment.orEmpty()
                        report("DIAG redirect=${response.code} placeholder=${path.takeIf { it.endsWith(".mp4") && !it.contains(Regex("[0-9]{8}")) } ?: "media"}")
                    } else {
                        report("DIAG response=${response.code} type=${response.header("Content-Type")} length=${response.header("Content-Length")}")
                        url = ""
                    }
                }
            }
        }
    }
    @Test fun diagnoseAudioTracks() = kotlinx.coroutines.runBlocking {
        val id = InstrumentationRegistry.getArguments().getString("movieId") ?: return@runBlocking
        val result = tv.lumanest.tuner.data.Torrentio.lookup(AddonSettings(instrumentation.targetContext).manifest, id, false)
        for (stream in result.streams.take(3)) {
            instrumentation.runOnMainSync { PlayerHolder.play(stream.url, live = false, requireEnglishAudio = true) }
            val end = System.currentTimeMillis() + 35_000
            var done = false
            var reported = false
            while (!done && System.currentTimeMillis() < end) {
                instrumentation.runOnMainSync {
                    val p = PlayerHolder.player
                    if (p.currentTracks.groups.isNotEmpty() && !reported) {
                        val tracks = p.currentTracks.groups.joinToString("; ") { g ->
                            (0 until g.length).joinToString { i -> "type=${g.type} lang=${g.getTrackFormat(i).language} mime=${g.getTrackFormat(i).sampleMimeType} supported=${g.isTrackSupported(i)} selected=${g.isTrackSelected(i)}" }
                        }
                        instrumentation.sendStatus(2, Bundle().apply { putString("stream", "AUDIO $tracks duration=${p.duration} playing=${p.isPlaying}\n") })
                        reported = true
                    }
                    if (p.isPlaying) {
                        instrumentation.sendStatus(2, Bundle().apply { putString("stream", "AUDIO verifiedEnglishPlaying=${EnglishAudio.selectedEnglish(p.currentTracks)}\n") })
                        done = true
                    } else if (PlayerHolder.error.value != null) {
                        instrumentation.sendStatus(2, Bundle().apply { putString("stream", "AUDIO error=${PlayerHolder.error.value}\n") })
                        done = true
                    }
                }
                Thread.sleep(100)
            }
            instrumentation.runOnMainSync { PlayerHolder.stop() }
        }
    }
    @Test fun saveConfiguredManifest() {
        val manifest = InstrumentationRegistry.getArguments().getString("configuredManifest") ?: return
        tv.lumanest.tuner.data.Torrentio.endpoint(manifest, "tt1234567", false)
        val settings = AddonSettings(instrumentation.targetContext)
        settings.manifest = manifest
        assertEquals(manifest, AddonSettings(instrumentation.targetContext).manifest)
        instrumentation.sendStatus(2, Bundle().apply { putString("stream", "Configuration saved\n") })
    }
    @Test fun saveConfiguredLiveSource() {
        val input = InstrumentationRegistry.getArguments().getString("configuredLive") ?: return
        val payload = JSONObject(input)
        val server = tv.lumanest.tuner.data.Xtream.normalizeServer(payload.getString("server"))
        val prefs = tv.lumanest.tuner.data.Repo.prefs
        val existing = prefs.sources.value.firstOrNull { it.type == tv.lumanest.tuner.data.SourceType.XTREAM && tv.lumanest.tuner.data.Xtream.normalizeServer(it.server) == server }
        val source = existing?.copy(server = server, username = payload.getString("username"), password = payload.getString("password"))
            ?: tv.lumanest.tuner.data.Source(java.util.UUID.randomUUID().toString(), "Live TV", tv.lumanest.tuner.data.SourceType.XTREAM, server, payload.getString("username"), payload.getString("password"))
        prefs.saveSource(source)
        prefs.setActive(source.id)
        assertEquals(1, prefs.sources.value.count { it.id == source.id })
        instrumentation.sendStatus(2, Bundle().apply { putString("stream", "Live TV configured\n") })
    }
    private fun port(download: TorrentEngine.Download) {
        val end = System.currentTimeMillis() + 20_000
        var value = 0
        while (value == 0 && System.currentTimeMillis() < end) { value = download.listeningPort(); Thread.sleep(100) }
        assertTrue("Native torrent listener did not start", value > 0)
        instrumentation.sendStatus(2, Bundle().apply { putString("stream", "\nTORRENT_TEST_PORT=$value\n") })
    }
    @Test fun verifiedPiecesSeekingEnglishPlaybackAndEncryptedSettings() {
        val fixture = JSONObject(instrumentation.context.assets.open("torrent-fixture.json").bufferedReader().use { it.readText() })
        val uri = TorrentSpec(fixture.getString("hash"), 1).uri()
        val executor = Executors.newSingleThreadExecutor()
        try {
            val download = TorrentEngine.acquire(uri)
            val read = executor.submit<ByteArray> {
                val source = TorrentDataSource()
                try {
                    assertEquals(fixture.getLong("size"), source.open(DataSpec(Uri.parse(uri))))
                    val bytes = ByteArray(fixture.getInt("size"))
                    var n = 0
                    while (n < bytes.size) { val count = source.read(bytes, n, minOf(32768, bytes.size - n)); assertTrue(count > 0); n += count }
                    assertEquals(-1, source.read(ByteArray(1), 0, 1))
                    source.close()
                    // Seek to a non-piece-aligned offset within a file that also has a nonzero torrent offset.
                    source.open(DataSpec.Builder().setUri(uri).setPosition(31_337).build())
                    val seek = ByteArray(40_000)
                    var offset = 0
                    while (offset < seek.size) offset += source.read(seek, offset, seek.size - offset)
                    assertArrayEquals(bytes.copyOfRange(31_337, 71_337), seek)
                    bytes
                } finally { source.close() }
            }
            port(download)
            val transferDeadline = System.currentTimeMillis() + 100_000
            while (!read.isDone && System.currentTimeMillis() < transferDeadline) {
                instrumentation.sendStatus(2, Bundle().apply { putString("stream", "\nTRANSFER_STATUS=${TorrentEngine.status.value}\n") })
                Thread.sleep(5000)
            }
            val bytes = read.get(100, TimeUnit.SECONDS)
            val digest = MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }
            assertEquals(fixture.getString("sha256"), digest)

            instrumentation.runOnMainSync { PlayerHolder.play(uri, live = false, requireEnglishAudio = true) }
            // ExoPlayer's loader creates a new session for playback after the source-read test.
            val playable = TorrentEngine.acquire(uri)
            port(playable)
            val deadline = System.currentTimeMillis() + 100_000
            var playing = false
            var reportAt = 0L
            while (!playing && System.currentTimeMillis() < deadline) {
                instrumentation.runOnMainSync {
                    val p = PlayerHolder.player
                    playing = p.isPlaying && EnglishAudio.selectedEnglish(p.currentTracks)
                    if (System.currentTimeMillis() - reportAt > 5_000) {
                        reportAt = System.currentTimeMillis()
                        android.util.Log.i("TunerTorrentTest", "state=${p.playbackState} play=${p.playWhenReady} suppressed=${p.playbackSuppressionReason} tracks=${p.currentTracks.groups.size} status=${TorrentEngine.status.value} error=${PlayerHolder.error.value}")
                    }
                }
                Thread.sleep(100)
            }
            assertTrue("ExoPlayer did not play verified English audio: ${PlayerHolder.error.value}", playing)
            instrumentation.runOnMainSync { PlayerHolder.stop() }
            assertTrue(playable.cancelled)

            val settings = AddonSettings(instrumentation.targetContext)
            val original = settings.manifest
            try {
                val value = "https://torrentio.strem.fun/alldebrid=test-only/manifest.json"
                settings.manifest = value
                assertEquals(value, AddonSettings(instrumentation.targetContext).manifest)
                val raw = instrumentation.targetContext.getSharedPreferences("torrentio", 0).getString("manifest", "")!!
                assertFalse(raw.contains("test-only"))
            } finally { settings.manifest = original }
        } finally {
            instrumentation.runOnMainSync { PlayerHolder.stop() }
            executor.shutdownNow()
        }
    }
}

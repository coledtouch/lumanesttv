package tv.lumanest.tuner.player

import android.content.Context
import android.os.SystemClock
import tv.lumanest.tuner.data.TorrentSpec
import com.frostwire.jlibtorrent.Priority
import com.frostwire.jlibtorrent.SessionManager
import com.frostwire.jlibtorrent.SessionParams
import com.frostwire.jlibtorrent.SettingsPack
import com.frostwire.jlibtorrent.Sha1Hash
import com.frostwire.jlibtorrent.TorrentFlags
import com.frostwire.jlibtorrent.TorrentHandle
import kotlinx.coroutines.flow.MutableStateFlow
import java.io.File
import java.io.IOException
import java.io.InterruptedIOException
import java.util.UUID
import java.util.concurrent.Executors

/** One torrent at a time. No local HTTP port and no service or downloads after leaving playback. */
object TorrentEngine {
    private val cleanup = Executors.newSingleThreadExecutor { r -> Thread(r, "torrent-cleanup").apply { isDaemon = true } }
    private lateinit var root: File
    private var active: Download? = null
    private var paused = false
    val status = MutableStateFlow<String?>(null)

    fun init(context: Context) {
        root = File(context.cacheDir, "torrent-playback")
        val stale = root.listFiles()?.toList().orEmpty()
        cleanup.execute { stale.forEach { it.deleteRecursively() } }
    }

    @Synchronized fun acquire(uri: String): Download {
        active?.takeIf { it.uri == uri && !it.cancelled }?.let { return it }
        stop()
        root.mkdirs()
        return Download(uri, File(root, UUID.randomUUID().toString()), paused).also { active = it }
    }

    @Synchronized fun stop() {
        val previous = active
        active = null
        status.value = null
        previous?.cancel()
    }

    @Synchronized fun pause() { paused = true; active?.setPaused(true) }
    @Synchronized fun resume() { paused = false; active?.setPaused(false) }

    data class Video(val file: File, val size: Long, val offset: Long, val pieceLength: Int, val pieceCount: Int)

    class Download internal constructor(val uri: String, private val directory: File, initiallyPaused: Boolean = false) {
        @Volatile var cancelled = false
            private set
        private val lock = Any()
        @Volatile private var paused = initiallyPaused
        private val spec = TorrentSpec.parse(uri)
        private var manager: SessionManager? = null
        private var handle: TorrentHandle? = null
        private var video: Video? = null
        private var lastStatus = 0L
        private var window = emptySet<Int>()
        internal fun listeningPort(): Int = synchronized(lock) { manager?.swig()?.listen_port() ?: 0 }

        private fun ensureSession() = synchronized(lock) {
            checkCancelled()
            if (manager != null) return@synchronized
            directory.mkdirs()
            try {
                val settings = SettingsPack().connectionsLimit(80).uploadRateLimit(256 * 1024)
                    .listenInterfaces("0.0.0.0:0,[::]:0")
                settings.setEnableDht(true)
                settings.setDhtBootstrapNodes("router.bittorrent.com:6881,router.utorrent.com:6881,dht.transmissionbt.com:6881")
                val session = SessionManager()
                manager = session
                session.start(SessionParams(settings))
                if (paused) session.pause()
                // Fetch metadata, then pause before downloading payload until the requested file is selected.
                session.download(spec.magnet(), directory, TorrentFlags.STOP_WHEN_READY)
            } catch (e: LinkageError) {
                throw IOException("The torrent engine is unavailable on this device.", e)
            } catch (e: RuntimeException) {
                throw IOException("Could not start the torrent engine.", e)
            }
        }

        fun metadata(isClosed: () -> Boolean): Video {
            ensureSession()
            val deadline = PlaybackWaitBudget(120_000, SystemClock.elapsedRealtime())
            while (true) {
                checkCancelled(isClosed)
                if (deadline.expired(SystemClock.elapsedRealtime(), paused)) throw IOException("No peers supplied torrent metadata. Try another stream.")
                if (paused) { sleep(); continue }
                val result = synchronized(lock) {
                    checkCancelled(isClosed)
                    video ?: run {
                        val h = handle ?: manager?.find(Sha1Hash(spec.hash))?.takeIf { it.isValid }?.also {
                            // Playback owns this torrent's lifecycle; don't let libtorrent's queue pause metadata fetching.
                            it.unsetFlags(TorrentFlags.AUTO_MANAGED)
                            if (paused) it.pause() else it.resume()
                            handle = it
                        }
                        val info = h?.torrentFile()
                        if (info == null) null else {
                            val files = info.files()
                            val paths = (0 until files.numFiles()).map { files.filePath(it) }
                            val sizes = paths.indices.map { files.fileSize(it) }
                            val index = try { TorrentSpec.chooseFile(paths, sizes, spec.fileIndex) }
                                catch (e: IllegalArgumentException) { throw IOException(e.message, e) }
                                catch (e: IllegalStateException) { throw IOException(e.message, e) }
                            val file = File(directory, paths[index]).canonicalFile
                            if (!file.path.startsWith(directory.canonicalPath + File.separator)) throw IOException("Invalid torrent file path.")
                            // Keep a reserve for Android, guide data and player buffers.
                            if (sizes[index] > directory.usableSpace - 512L * 1024 * 1024) throw IOException("Not enough free space for this video. Choose a smaller stream.")
                            h.prioritizeFiles(Array(paths.size) { if (it == index) Priority.NORMAL else Priority.IGNORE })
                            h.setFlags(TorrentFlags.SEQUENTIAL_DOWNLOAD)
                            h.unsetFlags(TorrentFlags.STOP_WHEN_READY)
                            if (paused) h.pause() else h.resume()
                            Video(file, sizes[index], files.fileOffset(index), info.pieceLength(), info.numPieces()).also { video = it }
                        }
                    }
                }
                if (result != null) return result
                updateStatus("Finding torrent metadata")
                sleep()
            }
        }

        /** Prioritize the read position plus a bounded lookahead; seek jumps do not download intervening bytes first. */
        fun awaitPiece(piece: Int, isClosed: () -> Boolean) {
            val deadline = PlaybackWaitBudget(120_000, SystemClock.elapsedRealtime())
            synchronized(lock) {
                checkCancelled(isClosed)
                val v = video ?: throw IOException("Torrent is not prepared.")
                val last = ((v.offset + v.size - 1) / v.pieceLength).toInt()
                val lookahead = (8 * 1024 * 1024 / v.pieceLength).coerceIn(2, 32)
                val next = (piece..minOf(last, piece + lookahead)).toSet()
                val h = handle ?: throw IOException("Torrent is not prepared.")
                (window - next).forEach { h.resetPieceDeadline(it) }
                next.forEach { h.setPieceDeadline(it, (it - piece) * 150) }
                window = next
            }
            while (true) {
                checkCancelled(isClosed)
                if (deadline.expired(SystemClock.elapsedRealtime(), paused)) throw IOException("Torrent peers are too slow or unavailable. Choose another stream.")
                if (paused) { sleep(); continue }
                val ready = synchronized(lock) { checkCancelled(isClosed); handle?.havePiece(piece) == true }
                if (ready) return
                updateStatus("Buffering torrent")
                sleep()
            }
        }

        private fun updateStatus(label: String) {
            val now = SystemClock.elapsedRealtime()
            if (now - lastStatus < 1000) return
            lastStatus = now
            val text = synchronized(lock) {
                if (cancelled) return
                val s = handle?.status()
                if (s == null) "$label..." else "$label: ${s.numPeers()} peers, ${s.downloadPayloadRate() / 1024} KB/s"
            }
            synchronized(TorrentEngine) { if (active === this && !cancelled) status.value = text }
        }

        private fun checkCancelled(isClosed: () -> Boolean = { false }) {
            if (cancelled || isClosed() || Thread.currentThread().isInterrupted) throw InterruptedIOException("Torrent playback stopped.")
        }
        private fun sleep() {
            try { Thread.sleep(100) } catch (e: InterruptedException) { Thread.currentThread().interrupt(); throw InterruptedIOException("Torrent playback stopped.") }
        }
        fun setPaused(paused: Boolean) {
            this.paused = paused
            cleanup.execute {
                synchronized(lock) {
                    if (!cancelled) {
                        // Pause the session even before magnet metadata has produced a handle.
                        if (this.paused) { manager?.pause(); handle?.pause() }
                        else { manager?.resume(); handle?.resume() }
                    }
                }
            }
        }
        @Synchronized fun cancel() {
            if (cancelled) return
            cancelled = true
            cleanup.execute {
                try { synchronized(lock) { try { manager?.stop() } finally { manager = null; handle = null } } }
                finally { directory.deleteRecursively() }
            }
        }
    }
}

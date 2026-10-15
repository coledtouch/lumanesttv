package tv.lumanest.tuner.player

import android.net.Uri
import androidx.annotation.OptIn
import androidx.media3.common.C
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.BaseDataSource
import androidx.media3.datasource.DataSource
import androidx.media3.datasource.DataSpec
import java.io.IOException
import java.io.RandomAccessFile

/** Reads only hash-verified pieces. A sparse file's holes must never be passed to the extractor. */
@OptIn(UnstableApi::class)
class TorrentDataSource : BaseDataSource(true) {
    @Volatile private var closed = true
    private var opened = false
    private var uri: Uri? = null
    private var download: TorrentEngine.Download? = null
    private var video: TorrentEngine.Video? = null
    private var file: RandomAccessFile? = null
    private var position = 0L
    private var remaining = 0L

    override fun open(dataSpec: DataSpec): Long {
        closed = false
        uri = dataSpec.uri
        transferInitializing(dataSpec)
        val source = TorrentEngine.acquire(dataSpec.uri.toString())
        download = source
        val v = source.metadata { closed }
        video = v
        if (dataSpec.position > v.size) throw IOException("Seek position is outside the video.")
        position = dataSpec.position
        remaining = v.size - position
        if (dataSpec.length != C.LENGTH_UNSET.toLong()) remaining = minOf(remaining, dataSpec.length)
        opened = true
        transferStarted(dataSpec)
        return remaining
    }

    override fun read(buffer: ByteArray, offset: Int, length: Int): Int {
        if (length == 0) return 0
        if (remaining == 0L) return C.RESULT_END_OF_INPUT
        val v = video ?: throw IOException("Torrent is not prepared.")
        val absolute = v.offset + position
        val piece = (absolute / v.pieceLength).toInt()
        download?.awaitPiece(piece) { closed } ?: throw IOException("Torrent playback stopped.")
        val count = minOf(length.toLong(), remaining, v.pieceLength - absolute % v.pieceLength).toInt()
        val input = file ?: RandomAccessFile(v.file, "r").also { file = it }
        input.seek(position)
        input.readFully(buffer, offset, count)
        position += count
        remaining -= count
        bytesTransferred(count)
        return count
    }

    override fun getUri(): Uri? = uri
    override fun close() {
        closed = true
        try { file?.close() } finally {
            file = null
            download = null; video = null; uri = null
            if (opened) { opened = false; transferEnded() }
        }
        // Extractors close/reopen on seeks. The player owns the torrent's lifetime, not this reader.
    }

    class Factory(private val fallback: DataSource.Factory) : DataSource.Factory {
        override fun createDataSource(): DataSource = Routing(fallback)
    }
    private class Routing(private val fallback: DataSource.Factory) : DataSource {
        private var delegate: DataSource? = null
        private val listeners = mutableListOf<androidx.media3.datasource.TransferListener>()
        override fun addTransferListener(transferListener: androidx.media3.datasource.TransferListener) { listeners += transferListener; delegate?.addTransferListener(transferListener) }
        override fun open(dataSpec: DataSpec): Long {
            val next = if (dataSpec.uri.scheme == "torrent") TorrentDataSource() else fallback.createDataSource()
            delegate = next
            listeners.forEach(next::addTransferListener)
            return next.open(dataSpec)
        }
        override fun read(buffer: ByteArray, offset: Int, length: Int) = delegate!!.read(buffer, offset, length)
        override fun getUri() = delegate?.uri
        override fun getResponseHeaders() = delegate?.responseHeaders ?: emptyMap()
        override fun close() { try { delegate?.close() } finally { delegate = null } }
    }
}

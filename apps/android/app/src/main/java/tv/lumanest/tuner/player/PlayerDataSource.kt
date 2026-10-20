package tv.lumanest.tuner.player

import android.net.Uri
import androidx.annotation.OptIn
import androidx.media3.common.PlaybackException
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DataSource
import androidx.media3.datasource.DataSourceException
import androidx.media3.datasource.DataSpec
import androidx.media3.datasource.FileDataSource
import androidx.media3.datasource.TransferListener
import java.io.File
import java.io.IOException

/**
 * Everything the main player opens: the item, HLS manifests, segments and keys, and side-loaded subtitle files.
 *
 * Playlist entries and the links inside HLS manifests come from the provider, often over plain HTTP that anyone on the
 * network can alter, so only two kinds of link are opened:
 * - http and https go to [streams] (LiveSlotDataSource over OkHttp), exactly as before OpenSubtitles came;
 * - file: only for a file inside the folder [subtitleDir] names, the device's OpenSubtitles copies
 *   ([tv.lumanest.tuner.data.SubtitleFiles]). The check is on the canonical path, so neither `../` nor a symbolic link
 *   leads out, and the file is opened by that canonical path.
 *
 * Anything else (content:, asset:, android.resource:, rawresource:, data:, udp:, rtmp:, a file anywhere else, a link
 * without a scheme) fails with "unsupported scheme" and the code OkHttp gave such links before, so a playlist or an
 * altered manifest can't make the player read app-private files or other apps' content (Media3's DefaultDataSource
 * would open all of them).
 */
@OptIn(UnstableApi::class)
class PlayerDataSource(
    private val streams: DataSource,
    /** The OpenSubtitles copies' folder, asked on every file: link; null allows no file. */
    private val subtitleDir: () -> File?,
) : DataSource {

    /** Where [route] sends a link. */
    sealed interface Route {
        /** http or https. */
        data object Stream : Route
        /** A subtitle copy on the device, by its canonical path. */
        data class SubtitleFile(val file: File) : Route
        /** Never opened. */
        data object Refused : Route
    }

    private val listeners = ArrayList<TransferListener>()
    private var files: FileDataSource? = null
    private var opened: DataSource? = null

    override fun addTransferListener(transferListener: TransferListener) {
        streams.addTransferListener(transferListener)
        listeners += transferListener
        files?.addTransferListener(transferListener)
    }

    override fun open(dataSpec: DataSpec): Long {
        check(opened == null) { "already open" }
        val (source, spec) = when (val route = route(dataSpec.uri.scheme, dataSpec.uri.path, subtitleDir())) {
            Route.Stream -> streams to dataSpec
            is Route.SubtitleFile -> fileSource() to dataSpec.withUri(Uri.fromFile(route.file))
            Route.Refused -> throw DataSourceException("unsupported scheme", null, PlaybackException.ERROR_CODE_FAILED_RUNTIME_CHECK)
        }
        // Set before opening: Media3 closes a source whose open failed.
        opened = source
        return source.open(spec)
    }

    private fun fileSource(): FileDataSource = files ?: FileDataSource().also { source ->
        listeners.forEach(source::addTransferListener)
        files = source
    }

    override fun read(buffer: ByteArray, offset: Int, length: Int): Int = checkNotNull(opened).read(buffer, offset, length)

    override fun getUri(): Uri? = opened?.uri

    override fun getResponseHeaders(): Map<String, List<String>> = opened?.responseHeaders ?: emptyMap()

    override fun close() {
        val source = opened ?: return
        try { source.close() } finally { opened = null }
    }

    class Factory(
        private val streams: DataSource.Factory,
        private val subtitleDir: () -> File?,
    ) : DataSource.Factory {
        override fun createDataSource(): DataSource = PlayerDataSource(streams.createDataSource(), subtitleDir)
    }

    companion object {
        /**
         * Where a link with [scheme] and (decoded) [path], as android.net.Uri gives them, goes. Schemes are compared
         * ignoring letter case (RFC 3986). A file: link goes to a file only when its canonical path is inside
         * [subtitleDir]'s canonical path; a path that can't be made canonical is refused.
         */
        fun route(scheme: String?, path: String?, subtitleDir: File?): Route {
            when (scheme?.lowercase()) {
                "http", "https" -> return Route.Stream
                "file" -> Unit
                else -> return Route.Refused
            }
            if (path.isNullOrEmpty() || subtitleDir == null) return Route.Refused
            return try {
                val inside = subtitleDir.canonicalPath + File.separator
                val file = File(path).canonicalFile
                if (file.path.startsWith(inside)) Route.SubtitleFile(file) else Route.Refused
            } catch (_: IOException) {
                Route.Refused
            } catch (_: SecurityException) {
                Route.Refused
            }
        }
    }
}

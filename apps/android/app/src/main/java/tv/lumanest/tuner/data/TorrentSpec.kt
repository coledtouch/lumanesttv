package tv.lumanest.tuner.data

import android.net.Uri

/** The file index is the original torrent index, including skipped and padding files. */
data class TorrentSpec(val hash: String, val fileIndex: Int?, val trackers: List<String> = emptyList(), val peers: List<String> = emptyList()) {
    init {
        require(Regex("[a-fA-F0-9]{40}").matches(hash)) { "A valid torrent info hash is required." }
        require(fileIndex == null || fileIndex >= 0) { "Invalid torrent file index." }
    }
    fun uri(): String = Uri.Builder().scheme("torrent").authority(hash.lowercase())
        .appendPath(fileIndex?.toString() ?: "largest").apply {
            trackers.distinct().take(20).forEach { appendQueryParameter("tr", it) }
            peers.distinct().take(10).forEach { appendQueryParameter("x.pe", it) }
        }.build().toString()
    fun magnet(): String = Uri.Builder().scheme("magnet").appendQueryParameter("xt", "urn:btih:${hash.lowercase()}")
        .apply {
            trackers.distinct().take(20).forEach { appendQueryParameter("tr", it) }
            peers.distinct().take(10).forEach { appendQueryParameter("x.pe", it) }
        }.build().toString()

    companion object {
        private fun trackers(uri: Uri) = uri.getQueryParameters("tr").filter { Uri.parse(it).scheme in setOf("http", "https", "udp") }
        fun parse(value: String): TorrentSpec {
            val uri = Uri.parse(value)
            require(uri.scheme == "torrent" && uri.pathSegments.size == 1) { "Invalid torrent stream." }
            val selector = uri.pathSegments.single()
            val index = if (selector == "largest") null else selector.toIntOrNull() ?: error("Invalid torrent file index.")
            return TorrentSpec(uri.host ?: "", index, trackers(uri), uri.getQueryParameters("x.pe"))
        }
        fun fromMagnet(value: String): TorrentSpec {
            // Android treats magnet:? as opaque; normalize it for query parsing.
            require(value.startsWith("magnet:?")) { "Enter a magnet link beginning magnet:?." }
            val query = Uri.parse("https://magnet.invalid/" + value.removePrefix("magnet:"))
            val hash = query.getQueryParameters("xt").firstOrNull { it.startsWith("urn:btih:", true) }?.substringAfterLast(':') ?: ""
            return TorrentSpec(hash, null, trackers(query), query.getQueryParameters("x.pe"))
        }
        fun chooseFile(paths: List<String>, sizes: List<Long>, requested: Int?): Int {
            require(paths.size == sizes.size)
            val video = paths.indices.filter { paths[it].substringAfterLast('.').lowercase() in setOf("mkv", "mp4", "avi", "webm", "mov", "m4v", "ts") && sizes[it] > 0 }
            if (requested != null) {
                require(requested in video) { "The requested torrent file is not a supported video." }
                return requested
            }
            return video.maxByOrNull { sizes[it] } ?: error("No video file found in this torrent.")
        }
    }
}

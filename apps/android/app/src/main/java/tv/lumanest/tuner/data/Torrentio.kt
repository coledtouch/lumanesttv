package tv.lumanest.tuner.data

import kotlinx.coroutines.suspendCancellableCoroutine
import okhttp3.Call
import okhttp3.Callback
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.Request
import okhttp3.Response
import org.json.JSONObject
import java.io.IOException
import java.util.concurrent.TimeUnit
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

data class AddonStream(val name: String, val description: String, val url: String) {
    val isTorrent: Boolean get() = url.startsWith("torrent://")
}
data class AddonResults(val streams: List<AddonStream>, val unsupported: Int)
data class AddonTitle(
    val id: String, val name: String, val year: String,
    val poster: String? = null, val background: String? = null,
    val description: String = "", val rating: String = "", val runtime: String = "",
    val genres: List<String> = emptyList(), val cast: List<String> = emptyList(),
)
data class AddonDetails(val title: AddonTitle, val episodes: List<AddonEpisode>)
data class AddonEpisode(val id: String, val season: Int, val episode: Int, val title: String, val released: String = "")

/** Cache credentials and signed URLs in memory, never in catalog/resume files. */
object Torrentio {
    private val client = Net.client.newBuilder().callTimeout(25, TimeUnit.SECONDS).build()
    private val cache = LinkedHashMap<String, Pair<Long, AddonResults>>()
    private const val TTL = 5 * 60 * 1000L

    private fun title(row: JSONObject): AddonTitle? {
        val id = row.optString("id")
        if (!Regex("tt[0-9]+").matches(id)) return null
        fun strings(key: String): List<String> {
            val values = row.optJSONArray(key) ?: return emptyList()
            return (0 until values.length()).mapNotNull { values.optString(it).takeIf { s -> s.isNotBlank() && s != "null" } }
        }
        fun image(key: String) = row.optString(key).toHttpUrlOrNull()?.toString()
        fun text(key: String) = row.optString(key).takeUnless { it == "null" }.orEmpty()
        return AddonTitle(id, text("name"), text("releaseInfo"), image("poster"), image("background"),
            text("description"), text("imdbRating"), text("runtime"), strings("genres"), strings("cast"))
    }

    fun parseDetails(text: String): AddonDetails {
        val meta = JSONObject(text).optJSONObject("meta") ?: error("Title details are unavailable.")
        return AddonDetails(title(meta) ?: error("Invalid title details."),
            if (meta.has("videos")) parseEpisodes(text) else emptyList())
    }

    suspend fun details(id: String, series: Boolean): AddonDetails {
        require(Regex("tt[0-9]+").matches(id))
        val type = if (series) "series" else "movie"
        return parseDetails(fetch(Request.Builder().url("https://v3-cinemeta.strem.io/meta/$type/$id.json").build()))
    }

    fun parseTitles(text: String): List<AddonTitle> {
        val rows = JSONObject(text).optJSONArray("metas") ?: error("The title catalog returned no results.")
        return (0 until rows.length()).mapNotNull { i ->
            val row = rows.optJSONObject(i) ?: return@mapNotNull null
            title(row)
        }.distinctBy { it.id }.take(50)
    }
    suspend fun searchTitles(query: String, series: Boolean): List<AddonTitle> {
        val type = if (series) "series" else "movie"
        val url = "https://v3-cinemeta.strem.io".toHttpUrlOrNull()!!.newBuilder()
            .addPathSegment("catalog").addPathSegment(type)
            .apply { if (query.isBlank()) addPathSegment("top.json") else addPathSegment("top").addPathSegment("search=${query.trim()}.json") }.build()
        return parseTitles(fetch(Request.Builder().url(url).build()))
    }
    fun parseEpisodes(text: String): List<AddonEpisode> {
        val rows = JSONObject(text).optJSONObject("meta")?.optJSONArray("videos") ?: error("No episode list is available for this series.")
        return (0 until rows.length()).mapNotNull { i ->
            val row = rows.optJSONObject(i) ?: return@mapNotNull null
            val id = row.optString("id")
            if (!Regex("tt[0-9]+:[1-9][0-9]*:[1-9][0-9]*").matches(id)) null
            else AddonEpisode(id, id.split(':')[1].toInt(), id.split(':')[2].toInt(), row.optString("title").ifBlank { row.optString("name") }, row.optString("released"))
        }.distinctBy { it.id }.sortedWith(compareBy<AddonEpisode> { it.season }.thenBy { it.episode })
    }
    suspend fun episodes(id: String): List<AddonEpisode> {
        require(Regex("tt[0-9]+").matches(id))
        return parseEpisodes(fetch(Request.Builder().url("https://v3-cinemeta.strem.io/meta/series/$id.json").build()))
    }

    fun endpoint(manifest: String, videoId: String, series: Boolean): HttpUrl {
        val input = manifest.trim().replaceFirst(Regex("^stremio://"), "https://")
        val base = input.toHttpUrlOrNull() ?: error("Enter a valid Torrentio manifest link.")
        require(base.isHttps && base.host == "torrentio.strem.fun" && base.username.isEmpty() && base.password.isEmpty() && base.query == null && base.fragment == null) {
            "Use the HTTPS manifest link copied from Torrentio."
        }
        require(base.pathSegments.last() == "manifest.json") { "The link must end with /manifest.json." }
        val id = videoId.trim()
        require(Regex(if (series) "tt[0-9]+:[1-9][0-9]*:[1-9][0-9]*" else "tt[0-9]+").matches(id)) {
            if (series) "Enter an episode ID like tt1234567:1:2." else "Enter an IMDb ID like tt1234567."
        }
        return base.newBuilder().removePathSegment(base.pathSegments.lastIndex)
            .addPathSegment("stream").addPathSegment(if (series) "series" else "movie")
            .addPathSegment("$id.json").build()
    }

    fun parse(text: String): AddonResults {
        val root = JSONObject(text)
        val rows = root.optJSONArray("streams") ?: error("The addon did not return a stream list.")
        val playable = mutableListOf<AddonStream>()
        var unsupported = 0
        for (i in 0 until rows.length()) {
            val row = rows.optJSONObject(i) ?: continue
            val url = row.optString("url").toHttpUrlOrNull()
            val headers = row.optJSONObject("behaviorHints")?.optJSONObject("proxyHeaders")
            val hash = row.optString("infoHash")
            val torrent = if (Regex("[a-fA-F0-9]{40}").matches(hash)) runCatching {
                val sources = row.optJSONArray("sources")
                val trackers = (0 until (sources?.length() ?: 0)).mapNotNull { n ->
                    sources?.optString(n)?.takeIf { it.startsWith("tracker:") }?.removePrefix("tracker:")
                }
                val index = if (row.has("fileIdx") && !row.isNull("fileIdx")) row.optInt("fileIdx", -1) else null
                TorrentSpec(hash, index, trackers).uri()
            }.getOrNull() else null
            if (headers != null || (url == null && torrent == null) || (url != null && (url.username.isNotEmpty() || url.password.isNotEmpty()))) {
                unsupported++; continue
            }
            playable += AddonStream(row.optString("name").ifBlank { "Stream ${i + 1}" },
                row.optString("description").ifBlank { row.optString("title") }, url?.toString() ?: torrent!!)
        }
        return AddonResults(playable.distinctBy { it.url }, unsupported)
    }

    suspend fun lookup(manifest: String, videoId: String, series: Boolean): AddonResults {
        val endpoint = endpoint(manifest, videoId, series)
        val key = endpoint.toString()
        synchronized(cache) { cache[key]?.takeIf { System.currentTimeMillis() - it.first < TTL }?.let { return it.second } }
        val text = fetch(Request.Builder().url(endpoint).build())
        val result = parse(text)
        synchronized(cache) {
            cache[key] = System.currentTimeMillis() to result
            while (cache.size > 20) cache.remove(cache.keys.first())
        }
        return result
    }

    internal suspend fun fetch(request: Request): String = suspendCancellableCoroutine { continuation ->
        val call = client.newCall(request)
        continuation.invokeOnCancellation { call.cancel() }
        call.enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) {
                if (continuation.isActive) continuation.resumeWithException(IOException("Cannot reach Torrentio. Try again."))
            }
            override fun onResponse(call: Call, response: Response) {
                response.use {
                    try {
                        if (!it.isSuccessful) throw IOException("Torrentio returned HTTP ${it.code}.")
                        val body = it.body?.string() ?: throw IOException("Torrentio returned an empty response.")
                        if (continuation.isActive) continuation.resume(body)
                    } catch (e: Exception) {
                        if (continuation.isActive) continuation.resumeWithException(IOException("Could not read Torrentio's response."))
                    }
                }
            }
        })
    }
}

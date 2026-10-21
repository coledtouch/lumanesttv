package tv.lumanest.tuner.data

import android.content.Context
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Deferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import okhttp3.Call
import okhttp3.Callback
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.IOException
import java.io.InputStream
import java.security.MessageDigest
import java.util.concurrent.TimeUnit
import kotlin.coroutines.resume

/**
 * The title a lumanest.tv extras lookup is about (docs/extras.md, "Which ids an app sends"): its TMDB id ([tmdb]: the
 * provider's, else the one its popularity-list match found), else its provider [name] and [year]. For an episode it is
 * the series.
 */
data class ExtrasTitle(val tmdb: Long = 0, val name: String = "", val year: Int = 0) {
    companion object {
        private const val MAX_TMDB = 999_999_999_999L
        private const val MAX_NAME = 300

        /** Null when the title has neither a TMDB id nor a name with a known year: then nothing is looked up. */
        fun of(providerTmdb: String?, matchedTmdb: Long, name: String, year: Int): ExtrasTitle? {
            val id = providerTmdb?.let(::tmdbId) ?: matchedTmdb.takeIf { it in 1..MAX_TMDB }
            if (id != null) return ExtrasTitle(tmdb = id)
            // Trimmed as a provider field (docs/browse.md, Trimming); lumanest.tv takes 1 to 300 UTF-16 code units.
            val trimmed = BrowseText.trimField(name)
            if (trimmed.isEmpty() || trimmed.length > MAX_NAME || year !in 1800..2099) return null
            return ExtrasTitle(name = trimmed, year = year)
        }

        fun movie(movie: Movie, matchedTmdb: Long): ExtrasTitle? = of(movie.tmdb, matchedTmdb, movie.name, yearOf(movie.year, movie.name))
        fun series(series: Series, matchedTmdb: Long): ExtrasTitle? = of(series.tmdb, matchedTmdb, series.name, yearOf(series.year, series.name))

        /** The year docs/browse.md (Matching step 3) reads: the provider's field, else one in the name. */
        private fun yearOf(field: String?, name: String) = TitleMatch.yearOf(field).takeIf { it > 0 } ?: TitleMatch.yearInTitle(name)

        /** 1 to 12 ASCII digits without a leading zero, as [Xtream.tmdbOf] keeps them. */
        private fun tmdbId(text: String): Long? {
            if (text.isEmpty() || text.length > 12 || text[0] == '0' || text.any { it !in '0'..'9' }) return null
            return text.toLong()
        }
    }
}

/** A subtitles lookup: a movie, or an episode ([season] 0 to 9999, [episode] 1 to 9999) of the series [title]. */
data class SubtitleQuery(val title: ExtrasTitle, val season: Int = -1, val episode: Int = -1) {
    val isEpisode: Boolean get() = episode > 0

    companion object {
        fun movie(title: ExtrasTitle?): SubtitleQuery? = title?.let { SubtitleQuery(it) }

        /** An episode without a season or episode number gets no lookup. */
        fun episode(series: ExtrasTitle?, season: Int, episode: Int): SubtitleQuery? =
            if (series == null || season !in 0..9999 || episode !in 1..9999) null else SubtitleQuery(series, season, episode)
    }
}

/** A trailer lookup for a movie, or a series ([tv]). */
data class TrailerQuery(val title: ExtrasTitle, val tv: Boolean) {
    companion object {
        /** A film's lookup, by the same ids as its subtitles ([ExtrasTitle.movie]); null when nothing can be asked. */
        fun movie(movie: Movie, matchedTmdb: Long): TrailerQuery? = ExtrasTitle.movie(movie, matchedTmdb)?.let { TrailerQuery(it, tv = false) }

        fun series(series: Series, matchedTmdb: Long): TrailerQuery? = ExtrasTitle.series(series, matchedTmdb)?.let { TrailerQuery(it, tv = true) }
    }
}

/** One OpenSubtitles track lumanest.tv offers. [label] is shown as it is, as plain text; [vtt] is its WebVTT file. */
data class ExtrasTrack(val id: String, val label: String, val hearingImpaired: Boolean, val vtt: String)

/** A subtitles answer: up to three tracks, best first (none for every status but `ok`), and the credit to show. */
data class SubtitleLookup(val tracks: List<ExtrasTrack>, val credit: String)

/** A title's YouTube trailer. [key] is a checked YouTube video key. */
data class Trailer(val key: String, val name: String) {
    /** What a phone opens: the QR code's text. */
    val phoneUrl: String get() = "https://youtu.be/$key"
    /** The text under the QR code. */
    val short: String get() = "youtu.be/$key"
}

/** A trailer answer: [trailer] is null for every status but `ok`. Kept apart from a failed request, which isn't kept. */
data class TrailerLookup(val trailer: Trailer?)

/**
 * The lumanest.tv extras endpoints (docs/extras.md, "Endpoints"): request URLs and the answers' rules. Plain Kotlin, so
 * unit tests run it without Android.
 */
object ExtrasApi {
    const val ORIGIN = "https://lumanest.tv/"
    const val CREDIT = "Subtitles provided by OpenSubtitles.com"
    const val DEFAULT_LABEL = "English (OpenSubtitles)"
    /** The same client name the app's other lumanest.tv calls send. */
    const val USER_AGENT = "LumaNestTuner/Android"
    const val MAX_TRACKS = 3
    const val LOOKUP_TIMEOUT_MS = 10_000L
    const val FILE_TIMEOUT_MS = 20_000L
    const val MAX_LOOKUP_BYTES = 256L * 1024
    const val MAX_FILE_BYTES = 8L * 1024 * 1024
    private const val HEX = "0123456789ABCDEF"

    /** `/api/extras/subtitles`, parameters in the order docs/extras.md lists them. */
    fun subtitlesUrl(query: SubtitleQuery): String = buildString {
        append(ORIGIN).append("api/extras/subtitles?v=1&type=").append(if (query.isEpisode) "episode" else "movie")
        val title = query.title
        if (title.tmdb > 0) append("&tmdb=").append(title.tmdb)
        if (query.isEpisode) append("&season=").append(query.season).append("&episode=").append(query.episode)
        if (title.tmdb <= 0) append("&name=").append(encode(title.name)).append("&year=").append(title.year)
    }

    /** `/api/extras/trailer`. */
    fun trailerUrl(query: TrailerQuery): String = buildString {
        append(ORIGIN).append("api/extras/trailer?v=1&type=").append(if (query.tv) "tv" else "movie")
        val title = query.title
        if (title.tmdb > 0) append("&tmdb=").append(title.tmdb)
        else append("&name=").append(encode(title.name)).append("&year=").append(title.year)
    }

    /** UTF-8, every byte but the unreserved ASCII characters percent-encoded (a space is `%20`). */
    fun encode(value: String): String {
        val bytes = value.toByteArray(Charsets.UTF_8)
        val out = StringBuilder(bytes.size * 3)
        for (b in bytes) {
            val c = b.toInt() and 0xFF
            if (c in 'A'.code..'Z'.code || c in 'a'.code..'z'.code || c in '0'.code..'9'.code || c == '-'.code || c == '.'.code || c == '_'.code || c == '~'.code) {
                out.append(c.toChar())
            } else out.append('%').append(HEX[c shr 4]).append(HEX[c and 15])
        }
        return out.toString()
    }

    /**
     * A version 1 subtitles answer; null when the body isn't one. Only `tracks` and `credit` are read: a track needs an
     * id, and a `vtt` URL on lumanest.tv itself (the origin the app called).
     */
    fun parseSubtitles(body: String): SubtitleLookup? {
        val root = versioned(body) ?: return null
        val tracks = (root["tracks"] as? List<*>).orEmpty().mapNotNull(::track).distinctBy { it.id }.take(MAX_TRACKS)
        return SubtitleLookup(tracks, plain(root["credit"], 120) ?: CREDIT)
    }

    /** A version 1 trailer answer; null when the body isn't one. A trailer needs a valid YouTube key. */
    fun parseTrailer(body: String): TrailerLookup? {
        val root = versioned(body) ?: return null
        val trailer = root["trailer"] as? Map<*, *> ?: return TrailerLookup(null)
        val key = (trailer["key"] as? String)?.takeIf(::isYouTubeKey) ?: return TrailerLookup(null)
        return TrailerLookup(Trailer(key, plain(trailer["name"], 100) ?: "Trailer"))
    }

    /** `^[A-Za-z0-9_-]{11}$`, checked again before any link is built. */
    fun isYouTubeKey(key: String): Boolean =
        key.length == 11 && key.all { it in 'A'..'Z' || it in 'a'..'z' || it in '0'..'9' || it == '_' || it == '-' }

    /**
     * Whether a downloaded file is WebVTT with at least one timing line: `WEBVTT` (after an optional byte order mark)
     * alone or followed by a space, tab or line end, and a `-->` somewhere after it.
     */
    fun isWebVtt(text: String): Boolean {
        val start = if (text.isNotEmpty() && text[0].code == 0xFEFF) 1 else 0
        if (!text.startsWith("WEBVTT", start)) return false
        val after = text.getOrNull(start + 6)
        if (after != null && after != ' ' && after != '\t' && after != '\n' && after != '\r') return false
        return text.indexOf("-->", start + 6) >= 0
    }

    private fun versioned(body: String): Map<*, *>? {
        val root = runCatching { MiniJson.parse(body) }.getOrNull() as? Map<*, *> ?: return null
        return root.takeIf { it["v"] is Double && it["v"] == 1.0 }
    }

    private fun track(value: Any?): ExtrasTrack? {
        val m = value as? Map<*, *> ?: return null
        val id = (m["id"] as? String)?.takeIf { id ->
            id.length in 1..64 && id.all { it in 'A'..'Z' || it in 'a'..'z' || it in '0'..'9' || it == '_' || it == '-' }
        } ?: return null
        val vtt = (m["vtt"] as? String)?.takeIf { url ->
            url.length in ORIGIN.length + 1..1024 && url.startsWith(ORIGIN) && url.none { it <= ' ' || it.code >= 0x7F }
        } ?: return null
        return ExtrasTrack(id, plain(m["label"], 100) ?: DEFAULT_LABEL, m["hi"] == true, vtt)
    }

    /**
     * Text from the server for a plain text view: controls taken out, ends trimmed as a provider field, at most [max]
     * UTF-16 code units (never half a surrogate pair). Null when nothing is left.
     */
    private fun plain(value: Any?, max: Int): String? {
        val text = value as? String ?: return null
        val kept = StringBuilder(minOf(text.length, max + 1))
        for (c in text) {
            if (c.code < 0x20 || c.code in 0x7F..0x9F) continue
            kept.append(c)
            if (kept.length > max * 2) break
        }
        var out = BrowseText.trimField(kept.toString())
        if (out.length > max) {
            out = out.substring(0, if (Character.isHighSurrogate(out[max - 1])) max - 1 else max)
            out = BrowseText.trimField(out)
        }
        return out.ifEmpty { null }
    }
}

/**
 * Lookups at lumanest.tv (docs/extras.md): subtitles for a movie or an episode, and a title's trailer. Each answer
 * (any status) is kept in memory for the app's session, at most [MAX_ANSWERS]; a failed request (an error status, a
 * timeout or unreadable JSON) is "nothing" and not kept, so the next title or the viewer's next choice asks again.
 * Callers asking the same thing at once share one request ([TrailerPrefetcher] and a details page often do), which
 * runs to its end even when the caller that started it stops waiting, so its answer is kept for the next one.
 * Never throws; [enabled] is off in Robolectric tests, so screens never call the live site.
 *
 * [fetch] returns a 200 answer's body, or null; the default goes through the app's shared OkHttp client.
 */
class ExtrasClient(
    val enabled: Boolean = true,
    private val fetch: suspend (url: String, timeoutMs: Long, maxBytes: Long) -> String? = ::httpGet,
) {
    private val answers = object : LinkedHashMap<String, Any>(32, 0.75f, true) {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, Any>?) = size > MAX_ANSWERS
    }
    /** Requests on their way, by URL; guarded by [answers]' lock. */
    private val inFlight = HashMap<String, Deferred<Any?>>()
    /** Runs shared requests, so a caller that stops waiting (a page that closed) doesn't cancel them for the others. */
    private val requests = CoroutineScope(SupervisorJob() + Dispatchers.Unconfined)

    suspend fun subtitles(query: SubtitleQuery): SubtitleLookup? = lookup(ExtrasApi.subtitlesUrl(query), ExtrasApi::parseSubtitles)

    suspend fun trailer(query: TrailerQuery): Trailer? = lookup(ExtrasApi.trailerUrl(query), ExtrasApi::parseTrailer)?.trailer

    /**
     * The session's answer for [query] without asking: null when there is none yet (then [trailer] asks), else the
     * kept answer, whose [TrailerLookup.trailer] is null when the title has no trailer. A details page reads it while it
     * composes, so an answer a prefetch already has shows the button on the page's first frame.
     */
    fun cachedTrailer(query: TrailerQuery): TrailerLookup? =
        if (!enabled) null else synchronized(answers) { answers[ExtrasApi.trailerUrl(query)] as? TrailerLookup }

    /** One subtitle file's text (a lumanest.tv `vtt` URL), or null when it can't be had. Not kept here: see [SubtitleFiles]. */
    suspend fun file(url: String): String? {
        if (!enabled || !url.startsWith(ExtrasApi.ORIGIN)) return null
        return safely { fetch(url, ExtrasApi.FILE_TIMEOUT_MS, ExtrasApi.MAX_FILE_BYTES) }
    }

    private suspend inline fun <reified T : Any> lookup(url: String, crossinline parse: (String) -> T?): T? {
        if (!enabled) return null
        val request = synchronized(answers) {
            answers[url]?.let { return it as? T }
            // Started outside the lock (LAZY): with the unconfined dispatcher it would otherwise run in it.
            inFlight.getOrPut(url) {
                requests.async(start = CoroutineStart.LAZY) {
                    var answer: T? = null
                    try {
                        answer = safely { fetch(url, ExtrasApi.LOOKUP_TIMEOUT_MS, ExtrasApi.MAX_LOOKUP_BYTES) }?.let { parse(it) }
                    } finally {
                        synchronized(answers) {
                            answer?.let { answers[url] = it }
                            inFlight.remove(url)
                        }
                    }
                    answer
                }
            }
        }
        request.start()
        return request.await() as? T
    }

    private suspend inline fun safely(block: () -> String?): String? = try {
        block()
    } catch (e: CancellationException) {
        throw e
    } catch (_: Exception) {
        null
    }

    companion object {
        const val MAX_ANSWERS = 200

        private val clients = HashMap<Long, OkHttpClient>()

        /**
         * The app's shared client with [timeoutMs] for the whole call. Built from [Net.client], so it shares its
         * connection pool: a lumanest.tv connection the Movies & Series lists or an earlier lookup opened is reused.
         */
        internal fun client(timeoutMs: Long) = synchronized(clients) {
            clients.getOrPut(timeoutMs) { Net.client.newBuilder().callTimeout(timeoutMs, TimeUnit.MILLISECONDS).build() }
        }

        /** GET [url] from lumanest.tv: the body of a 200 answer up to [maxBytes] (UTF-8, bad bytes replaced), else null. */
        suspend fun httpGet(url: String, timeoutMs: Long, maxBytes: Long): String? = withContext(Dispatchers.IO) {
            val request = Request.Builder().url(url).header("User-Agent", ExtrasApi.USER_AGENT).build()
            suspendCancellableCoroutine { continuation ->
                val call = client(timeoutMs).newCall(request)
                continuation.invokeOnCancellation { call.cancel() }
                call.enqueue(object : Callback {
                    override fun onFailure(call: Call, e: IOException) {
                        if (continuation.isActive) continuation.resume(null)
                    }

                    override fun onResponse(call: Call, response: Response) {
                        val text = try {
                            response.use { if (it.code == 200) readLimited(it.body.byteStream(), maxBytes) else null }
                        } catch (_: IOException) {
                            null
                        }
                        if (continuation.isActive) continuation.resume(text)
                    }
                })
            }
        }

        private fun readLimited(input: InputStream, maxBytes: Long): String? {
            val out = ByteArrayOutputStream()
            val buffer = ByteArray(16 * 1024)
            while (true) {
                val read = input.read(buffer)
                if (read < 0) break
                if (out.size() + read > maxBytes) return null
                out.write(buffer, 0, read)
            }
            return String(out.toByteArray(), Charsets.UTF_8)
        }
    }
}

/**
 * The device's copies of OpenSubtitles files (docs/extras.md, "Device cache"): a file is downloaded only when its track
 * is about to be shown, kept in [dir] (the app's cache folder) for [MAX_AGE_MS] so a replay or resume needs no new
 * download, and at most [MAX_FILES] are kept. lumanest.tv keeps no copy, so each download counts against its plan.
 */
class SubtitleFiles(
    /** The only folder the player opens file: links in ([tv.lumanest.tuner.player.PlayerDataSource]). */
    val dir: File,
    private val fetch: suspend (String) -> String?,
    private val now: () -> Long = System::currentTimeMillis,
) {
    private val lock = Any()

    /** The track's WebVTT file on the device, downloading it if needed; null when it can't be had or isn't WebVTT. */
    suspend fun get(track: ExtrasTrack): File? = withContext(Dispatchers.IO) {
        val file = File(dir, fileName(track.vtt))
        synchronized(lock) { if (fresh(file)) return@withContext file }
        val body = try { fetch(track.vtt) } catch (e: CancellationException) { throw e } catch (_: Exception) { null }
        if (body == null || !ExtrasApi.isWebVtt(body)) return@withContext null
        synchronized(lock) {
            try {
                dir.mkdirs()
                val tmp = File.createTempFile("subtitle", ".part", dir)
                try {
                    tmp.writeText(body, Charsets.UTF_8)
                    if (!tmp.renameTo(file)) { tmp.copyTo(file, overwrite = true) }
                } finally { tmp.delete() }
                file.setLastModified(now())
                prune()
            } catch (_: IOException) {
                return@withContext null
            }
        }
        file.takeIf { it.isFile }
    }

    private fun fresh(file: File) = file.isFile && file.length() > 0 && now() - file.lastModified() in 0 until MAX_AGE_MS

    /** Old copies and anything beyond the newest [MAX_FILES] go. */
    private fun prune() {
        val files = dir.listFiles().orEmpty().filter { it.isFile }
        val (kept, stale) = files.partition { it.name.endsWith(".vtt") && fresh(it) }
        stale.forEach { it.delete() }
        kept.sortedByDescending { it.lastModified() }.drop(MAX_FILES).forEach { it.delete() }
    }

    companion object {
        const val MAX_FILES = 20
        const val MAX_AGE_MS = 7 * 24 * 3600_000L

        /** A name from the file's URL alone, so nothing the server sent ends up in a path. */
        internal fun fileName(url: String): String =
            MessageDigest.getInstance("SHA-256").digest(url.toByteArray(Charsets.UTF_8))
                .take(16).joinToString("") { "%02x".format(it) } + ".vtt"
    }
}

/** The app's lumanest.tv extras client, its trailer prefetches and its device copies of subtitle files. */
object Extras {
    /** Off in Robolectric tests, so screens never call the live site; tests put a client with a fake network here. */
    @Volatile var client = ExtrasClient(enabled = android.os.Build.FINGERPRINT != "robolectric")
    @Volatile var files: SubtitleFiles? = null
        private set

    /**
     * Trailer lookups started from Home, Library, Discover and Search before a details page opens. Always asks the
     * current [client] (tests replace it); used on the main thread only. A client that is off asks nothing, so it has
     * nothing to start (and spends none of the focus lookups' budget).
     */
    val prefetch: TrailerPrefetcher by lazy {
        TrailerPrefetcher(
            CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate),
            lookup = { client.trailer(it) },
            known = { !client.enabled || client.cachedTrailer(it) != null },
        )
    }

    fun init(context: Context) {
        if (files == null) files = SubtitleFiles(File(context.cacheDir, "subtitles"), fetch = { client.file(it) })
    }
}

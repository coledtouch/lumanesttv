package tv.lumanest.tuner.data

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File

/**
 * Fetches the popularity lists (docs/browse.md) and keeps the JSON on disk for [MAX_AGE_MS]. A failed or unusable
 * response never replaces a good copy: the stale copy keeps working, and with no copy at all the result is
 * [CatalogRows.NONE], which the browse screens treat as "no TMDB" (their category fallbacks).
 *
 * [fetch] returns the response body or throws; the default goes through the app's shared OkHttp client.
 */
class CatalogRowsClient(
    private val cacheFile: File,
    private val url: String = URL,
    private val fetch: suspend (String) -> String = { Net.getString(it, USER_AGENT) },
    private val now: () -> Long = System::currentTimeMillis,
) {
    data class Cached(val rows: CatalogRows, val storedAt: Long)

    /** What [refresh] has: [ok] is false when the request failed and [rows] is the stale copy or [CatalogRows.NONE]. */
    data class Loaded(val rows: CatalogRows, val ok: Boolean)

    /** The last copy read or written, so an unchanged file gives the same [CatalogRows] object (and no rebuild). */
    @Volatile private var memo: Pair<Long, Cached>? = null

    /** The saved copy, whatever its age, or null when there is none or it is damaged. */
    fun cached(): Cached? = runCatching {
        if (!cacheFile.isFile || cacheFile.length() <= 0 || cacheFile.length() > MAX_BYTES) return null
        val stamp = stamp()
        memo?.takeIf { it.first == stamp }?.let { return it.second }
        CatalogRows.parse(cacheFile.readText())?.let { Cached(it, cacheFile.lastModified()) }?.also { memo = stamp to it }
    }.getOrNull()

    /**
     * Any version 1 answer is kept for [MAX_AGE_MS], "none" included: the server sends that only when it has no TMDB
     * key. When TMDB fails it answers 503, which [load] treats as a failed request (the saved copy stays).
     */
    fun isFresh(cached: Cached?): Boolean = cached != null && now() - cached.storedAt in 0 until MAX_AGE_MS

    /** Fresh copy from disk, else the server, else the stale copy, else [CatalogRows.NONE]. Non-2xx answers are failures. */
    suspend fun load(force: Boolean = false): CatalogRows = refresh(force).rows

    /** [load], also saying whether the lists are current (a fresh copy, or a successful request). */
    suspend fun refresh(force: Boolean = false): Loaded = withContext(Dispatchers.IO) {
        val cached = cached()
        if (!force && isFresh(cached)) return@withContext Loaded(cached!!.rows, ok = true)
        val body = try {
            fetch(url)
        } catch (e: CancellationException) {
            throw e
        } catch (_: Exception) {
            null
        }
        val rows = body?.takeIf { it.length <= MAX_BYTES }?.let(CatalogRows::parse)
        if (body != null && rows != null) {
            // An answer equal to the saved copy keeps that object: nothing downstream rebuilds for it.
            val kept = cached?.rows?.takeIf { it == rows } ?: rows
            if (save(body).isSuccess) memo = stamp() to Cached(kept, cacheFile.lastModified())
            Loaded(kept, ok = true)
        } else Loaded(cached?.rows ?: CatalogRows.NONE, ok = false)
    }

    private fun stamp() = cacheFile.lastModified() xor (cacheFile.length() shl 40)

    /** Writes beside the cache and renames it into place, so a crash mid-write never leaves half a file. */
    private fun save(body: String) = runCatching {
        cacheFile.parentFile?.mkdirs()
        val tmp = File(cacheFile.parentFile, cacheFile.name + ".part")
        tmp.writeText(body)
        tmp.setLastModified(now())
        if (!tmp.renameTo(cacheFile)) { tmp.copyTo(cacheFile, overwrite = true); tmp.delete() }
        cacheFile.setLastModified(now())
    }

    companion object {
        const val URL = "https://lumanest.tv/api/catalog/rows?v=1"
        /** The same client name the app's other lumanest.tv calls send (see [Pairing]). */
        const val USER_AGENT = "LumaNestTuner/Android"
        const val MAX_AGE_MS = 12 * 3600_000L

        /** How long to wait before trying a failed request again: 5, 10, 20 and 40 minutes, then hourly. */
        fun retryDelay(attempt: Int): Long = minOf(5 * 60_000L shl attempt.coerceIn(0, 4), 3600_000L)
        private const val MAX_BYTES = 8L * 1024 * 1024
    }
}

package tv.lumanest.tuner.data

import android.util.JsonReader
import android.util.JsonToken
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import okhttp3.Call
import okhttp3.Callback
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import java.io.BufferedInputStream
import java.io.File
import java.io.IOException
import java.io.InputStream
import java.io.InputStreamReader
import java.util.concurrent.TimeUnit
import java.util.zip.GZIPInputStream
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

const val DEFAULT_UA = "VLC/3.0.21 LibVLC/3.0.21"

object Net {
    val client: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(60, TimeUnit.SECONDS)
        .followRedirects(true)
        .followSslRedirects(true)
        .retryOnConnectionFailure(true)
        .build()

    fun request(url: String, ua: String) = Request.Builder().url(url).header("User-Agent", ua.ifBlank { DEFAULT_UA }).build()

    /** Cancelling a screen/reload also closes its socket and interrupts response-body reads. */
    private suspend fun <T> read(url: String, ua: String, body: (Response, Call) -> T): T = suspendCancellableCoroutine { continuation ->
        val call = client.newCall(request(url, ua))
        continuation.invokeOnCancellation { call.cancel() }
        call.enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) {
                if (continuation.isActive) continuation.resumeWithException(e)
            }
            override fun onResponse(call: Call, response: Response) {
                response.use {
                    try {
                        if (!it.isSuccessful) throw IOException("Server returned ${it.code}")
                        val result = body(it, call)
                        if (continuation.isActive) continuation.resume(result)
                    } catch (e: Exception) {
                        if (continuation.isActive) continuation.resumeWithException(e)
                    }
                }
            }
        })
    }

    suspend fun getString(url: String, ua: String): String = read(url, ua) { r, _ -> r.body?.string() ?: "" }

    /**
     * Downloads [url] into [file], reusing the existing copy when it is younger than [maxAgeMs].
     * Writes to a temp file first so a failed download never clobbers a good cache.
     */
    suspend fun download(url: String, ua: String, file: File, maxAgeMs: Long, force: Boolean): File =
        withContext(Dispatchers.IO) {
            if (!force && file.exists() && file.length() > 0 &&
                System.currentTimeMillis() - file.lastModified() < maxAgeMs
            ) return@withContext file
            file.parentFile?.mkdirs()
            // Cancelled requests can finish unwinding while a replacement starts. Each owns its temp file.
            val tmp = File.createTempFile(file.name.padEnd(3, '_'), ".part", file.parentFile)
            try {
                read(url, ua) { r, call ->
                    val body = r.body ?: throw IOException("Empty response")
                    try {
                        tmp.outputStream().use { out -> body.byteStream().copyTo(out, 64 * 1024) }
                        if (call.isCanceled()) throw CancellationException("Download cancelled")
                        if (!tmp.renameTo(file)) { tmp.copyTo(file, overwrite = true); tmp.delete() }
                        file
                    } finally { tmp.delete() }
                }
            } catch (e: CancellationException) {
                tmp.delete()
                throw e
            } catch (e: Exception) {
                tmp.delete()
                // A stale cache beats nothing when the provider is flaky.
                if (file.exists() && file.length() > 0) file else throw e
            }
        }

    /** Opens a file, transparently gunzipping it when it starts with the gzip magic bytes. */
    fun openMaybeGzip(file: File): InputStream {
        val raw = BufferedInputStream(file.inputStream(), 64 * 1024)
        raw.mark(2)
        val b1 = raw.read(); val b2 = raw.read()
        raw.reset()
        return if (b1 == 0x1f && b2 == 0x8b) BufferedInputStream(GZIPInputStream(raw, 64 * 1024), 64 * 1024) else raw
    }
}

// ---------------- lenient streaming JSON helpers ----------------

typealias JMap = Map<String, Any?>

/**
 * A JSON number, as the provider wrote it. [readAny] keeps numbers apart from strings so a provider TMDB id
 * (docs/browse.md, Matching step 1) can tell the number `1e3` (id 1000) from the string `"1e3"` (no id). [toString] is
 * [text], so [str] and every other field read a number as the text they always did.
 */
data class JsonNumber(val text: String) {
    override fun toString(): String = text
}

fun JsonReader.readAny(): Any? = when (peek()) {
    JsonToken.STRING -> nextString()
    JsonToken.NUMBER -> JsonNumber(nextString())
    JsonToken.BOOLEAN -> nextBoolean().toString()
    JsonToken.NULL -> { nextNull(); null }
    JsonToken.BEGIN_ARRAY -> {
        val l = ArrayList<Any?>(); beginArray(); while (hasNext()) l.add(readAny()); endArray(); l
    }
    JsonToken.BEGIN_OBJECT -> {
        val m = LinkedHashMap<String, Any?>(); beginObject(); while (hasNext()) m[nextName()] = readAny(); endObject(); m
    }
    else -> { skipValue(); null }
}

/**
 * Streams a JSON file whose top level is either an array of objects or an object of objects
 * (some panels return the latter) and hands each object to [fn] without holding the whole list.
 */
fun forEachJsonObject(file: File, fn: (JMap) -> Unit) = forEachJsonObject(file, null, fn)

/** Catalogues need a small subset of fields; skip provider extras without allocating their trees. */
fun forEachJsonObject(file: File, fields: Set<String>?, fn: (JMap) -> Unit) {
    JsonReader(InputStreamReader(Net.openMaybeGzip(file), Charsets.UTF_8)).use { r ->
        r.isLenient = true
        when (r.peek()) {
            JsonToken.BEGIN_ARRAY -> {
                r.beginArray()
                while (r.hasNext()) {
                    if (r.peek() == JsonToken.BEGIN_OBJECT) fn(r.readFields(fields)) else r.skipValue()
                }
                r.endArray()
            }
            JsonToken.BEGIN_OBJECT -> {
                r.beginObject()
                while (r.hasNext()) {
                    r.nextName()
                    if (r.peek() == JsonToken.BEGIN_OBJECT) fn(r.readFields(fields)) else r.skipValue()
                }
                r.endObject()
            }
            else -> Unit
        }
    }
}

private fun JsonReader.readFields(fields: Set<String>?): JMap {
    if (fields == null) {
        @Suppress("UNCHECKED_CAST")
        return readAny() as JMap
    }
    val result = LinkedHashMap<String, Any?>()
    beginObject()
    while (hasNext()) {
        val key = nextName()
        if (key in fields) result[key] = readAny() else skipValue()
    }
    endObject()
    return result
}

fun parseJson(text: String): Any? = JsonReader(text.reader()).use { it.isLenient = true; it.readAny() }

/**
 * A field as text, its ends trimmed of spaces and the Unicode spaces only ([BrowseText.trimField], docs/browse.md
 * "Trimming"): Kotlin's `trim()` also removes U+001C to U+001F, which would change how a name or year field reads.
 */
fun JMap.str(key: String): String? {
    val v = this[key]
    val s = when (v) {
        is String -> BrowseText.trimField(v)
        is List<*> -> v.firstNotNullOfOrNull { item -> textOf(item)?.let(BrowseText::trimField)?.ifEmpty { null } }
        null -> null
        else -> BrowseText.trimField(v.toString())
    }
    return if (s.isNullOrEmpty() || s == "null") null else s
}

@Suppress("UNCHECKED_CAST")
fun JMap.obj(key: String): JMap? = this[key] as? JMap

/** A string, or a number's text ([JsonNumber]); null for anything else. */
internal fun textOf(value: Any?): String? = when (value) {
    is String -> value
    is JsonNumber -> value.text
    else -> null
}

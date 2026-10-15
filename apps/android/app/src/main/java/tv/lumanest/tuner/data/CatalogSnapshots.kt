package tv.lumanest.tuner.data

import android.util.AtomicFile
import java.io.BufferedInputStream
import java.io.BufferedOutputStream
import java.io.DataInputStream
import java.io.DataOutputStream
import java.io.File
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream
import java.security.MessageDigest
import java.util.concurrent.ConcurrentHashMap
import java.util.zip.CRC32
import java.util.zip.CheckedInputStream
import java.util.zip.CheckedOutputStream

/** Private, prevalidated catalogues. Change POLICY_VERSION when eligibility or cleanup rules change. */
internal class CatalogSnapshots(private val root: File) {
    /** Safe benchmark diagnostics: state names and durations only, never identities or stream data. */
    val readDiagnostics = ConcurrentHashMap<String, String>()
    private fun lock(identity: String, kind: String) = locks.getOrPut(file(identity, kind).absolutePath) { Any() }
    data class Identity(val source: String, val catalogue: String, val live: String)
    data class Cached<T>(val value: T, val storedAt: Long) {
        fun fresh(maxAge: Long, now: Long = System.currentTimeMillis()) = now - storedAt < maxAge
    }
    data class Live(val channels: List<Channel>, val categories: List<Category>, val merged: Map<String, String>)
    data class Guide(val programs: Map<String, List<Program>>, val icons: Map<String, String>)

    fun readLive(id: Identity, now: Long = System.currentTimeMillis()) = readLineup(id, "live", now)
    fun readTrending(id: Identity, now: Long = System.currentTimeMillis()) = readLineup(id, "trending", now)
    private fun readLineup(id: Identity, kind: String, now: Long) = read(id.live, kind, now) { input ->
        val categories = input.categories()
        val channels = input.rows(50_000) {
            val key = text(); val number = readInt(); val name = text(); val logo = optional(); val category = text()
            val epg = optional(); val stream = optional(); val url = text(); val ids = strings()
            val country = optional(); val language = optional(); val backups = strings()
            if (key.isBlank() || name.isBlank() || !http(url) || backups.any { !http(it) }) throw IOException("Invalid channel snapshot")
            Channel(key, number, name, logo, category, epg, stream, url, ids, country, language, backups)
        }
        val merged = input.rows(100_000) { text() to text() }.toMap()
        if (channels.map { it.key }.toSet().size != channels.size) throw IOException("Duplicate channel snapshot keys")
        Live(channels, categories, merged)
    }

    fun writeLive(id: Identity, value: Live, storedAt: Long) = writeLineup(id, "live", value, storedAt)
    fun writeTrending(id: Identity, channels: List<Channel>, storedAt: Long) = writeLineup(id, "trending", Live(channels, emptyList(), emptyMap()), storedAt)
    private fun writeLineup(id: Identity, kind: String, value: Live, storedAt: Long) = write(id.live, kind, storedAt) { output ->
        output.categories(value.categories)
        output.rows(value.channels, 50_000) {
            text(it.key); writeInt(it.number); text(it.name); optional(it.logo); text(it.categoryId)
            optional(it.epgId); optional(it.streamId); text(it.url); strings(it.categoryIds)
            optional(it.country); optional(it.language); strings(it.backups)
        }
        output.rows(value.merged.entries, 100_000) { text(it.key); text(it.value) }
    }

    fun readMovies(id: Identity, now: Long = System.currentTimeMillis()) = read(id.catalogue, "movies", now) { input ->
        val categories = input.categories()
        val movies = input.rows(100_000) {
            val item = Movie(text(), text(), optional(), optional(), text(), text(), readLong(), strings(), optional(), optional(), strings())
            if (item.id.isBlank() || !http(item.url) || item.backups.any { !http(it) }) throw IOException("Invalid movie snapshot")
            item
        }
        ContentPolicy.Catalogue(movies, categories)
    }
    fun writeMovies(id: Identity, value: ContentPolicy.Catalogue<Movie>, storedAt: Long) = write(id.catalogue, "movies", storedAt) { output ->
        output.categories(value.categories)
        output.rows(value.items, 100_000) {
            text(it.id); text(it.name); optional(it.poster); optional(it.rating); text(it.categoryId); text(it.url)
            writeLong(it.added); strings(it.categoryIds); optional(it.country); optional(it.language); strings(it.backups)
        }
    }

    fun readSeries(id: Identity, now: Long = System.currentTimeMillis()) = read(id.catalogue, "series", now) { input ->
        val categories = input.categories()
        val series = input.rows(50_000) {
            Series(text(), text(), optional(), optional(), optional(), text(), optional(), optional(), optional(), readLong(), strings(), optional(), optional())
        }
        ContentPolicy.Catalogue(series, categories)
    }
    fun writeSeries(id: Identity, value: ContentPolicy.Catalogue<Series>, storedAt: Long) = write(id.catalogue, "series", storedAt) { output ->
        output.categories(value.categories)
        output.rows(value.items, 50_000) {
            text(it.id); text(it.name); optional(it.cover); optional(it.plot); optional(it.rating); text(it.categoryId)
            optional(it.genre); optional(it.year); optional(it.backdrop); writeLong(it.added); strings(it.categoryIds)
            optional(it.country); optional(it.language)
        }
    }

    fun readGuide(id: Identity, now: Long = System.currentTimeMillis()) = read(id.live, "guide", now) { input ->
        val programs = input.rows(50_000) {
            val key = text()
            key to rows(32) { Program(readLong(), readLong(), text(), optional(), optional(), readBoolean()) }
                .filter { it.end > now && it.start < now + GUIDE_HORIZON }
        }.filter { it.second.isNotEmpty() }.toMap()
        Guide(programs, input.rows(50_000) { text() to text() }.toMap())
    }
    fun writeGuide(id: Identity, value: Guide, storedAt: Long) = write(id.live, "guide", storedAt) { output ->
        output.rows(value.programs.entries, 50_000) { entry ->
            text(entry.key)
            rows(entry.value.filter { it.end > storedAt && it.start < storedAt + GUIDE_HORIZON }.take(32), 32) {
                writeLong(it.start); writeLong(it.end); text(it.title); optional(it.desc); optional(it.subtitle); writeBoolean(it.placeholder)
            }
        }
        output.rows(value.icons.entries, 50_000) { text(it.key); text(it.value) }
    }

    private fun file(identity: String, kind: String) = File(root, "$identity-$kind.bin")

    fun invalidateLive(id: Identity) = synchronized(lock(id.live, "live")) { AtomicFile(file(id.live, "live")).delete() }

    private inline fun <T> timedRead(kind: String, action: () -> T): T {
        val started = System.nanoTime()
        readDiagnostics[kind] = "reading"
        try { return action() } finally { readDiagnostics[kind + "Ms"] = ((System.nanoTime() - started) / 1_000_000).toString() }
    }
    private fun reject(kind: String, reason: String): Nothing? { readDiagnostics[kind] = reason; return null }

    private fun <T> read(identity: String, kind: String, now: Long, decode: (DataInputStream) -> T): Cached<T>? = timedRead(kind) { synchronized(lock(identity, kind)) { runCatching {
        val file = file(identity, kind)
        if (!file.isFile && !File(file.path + ".bak").isFile) return reject(kind, "missing")
        AtomicFile(file).openRead().use { raw ->
            val size = raw.channel.size()
            if (size !in 32..MAX_BYTES) return reject(kind, "size")
            val checked = CheckedInputStream(BoundedInput(raw, size - 8), CRC32())
            val input = DataInputStream(BufferedInputStream(checked, 64 * 1024))
            if (input.readInt() != MAGIC || input.readInt() != FORMAT || input.text() != identity || input.text() != kind) return reject(kind, "header")
            val storedAt = input.readLong()
            if (storedAt <= 0 || storedAt > now + 5 * 60_000 || now - storedAt > MAX_AGE) return reject(kind, "date")
            val value = decode(input)
            if (input.read() != -1 || checked.checksum.value != DataInputStream(raw).readLong()) return reject(kind, "checksum")
            readDiagnostics[kind] = "hit"
            Cached(value, storedAt)
        }
    }.onFailure { readDiagnostics[kind] = it.javaClass.simpleName }.getOrNull() } }

    private fun write(identity: String, kind: String, storedAt: Long, encode: (DataOutputStream) -> Unit) = synchronized(lock(identity, kind)) {
        root.mkdirs()
        val destination = file(identity, kind)
        val atomic = AtomicFile(destination)
        val raw = atomic.startWrite()
        try {
                val checked = CheckedOutputStream(BoundedOutput(raw, MAX_BYTES - 8), CRC32())
                val output = DataOutputStream(BufferedOutputStream(checked, 64 * 1024))
                output.writeInt(MAGIC); output.writeInt(FORMAT); output.text(identity); output.text(kind); output.writeLong(storedAt)
                encode(output); output.flush()
                DataOutputStream(raw).writeLong(checked.checksum.value)
                atomic.finishWrite(raw)
        } catch (e: Exception) { atomic.failWrite(raw); throw e }
    }

    private class BoundedInput(private val source: InputStream, private var remaining: Long) : InputStream() {
        override fun read(): Int = if (remaining <= 0) -1 else source.read().also { if (it >= 0) remaining-- }
        override fun read(bytes: ByteArray, offset: Int, length: Int): Int {
            if (remaining <= 0) return -1
            return source.read(bytes, offset, minOf(length.toLong(), remaining).toInt()).also { if (it > 0) remaining -= it }
        }
    }

    /** Reject over-budget writes before touching the stream; the enclosing AtomicFile rolls back. */
    internal class BoundedOutput(private val destination: OutputStream, private var remaining: Long) : OutputStream() {
        override fun write(value: Int) {
            if (remaining < 1) throw IOException("Snapshot byte limit exceeded")
            destination.write(value); remaining--
        }
        override fun write(bytes: ByteArray, offset: Int, length: Int) {
            if (offset < 0 || length < 0 || offset > bytes.size - length) throw IndexOutOfBoundsException()
            if (length > remaining) throw IOException("Snapshot byte limit exceeded")
            destination.write(bytes, offset, length); remaining -= length
        }
        override fun flush() { destination.flush() }
    }

    companion object {
        private val locks = ConcurrentHashMap<String, Any>()
        private const val MAGIC = 0x54554E52
        private const val FORMAT = 1
        private const val POLICY_VERSION = 1
        private const val MAX_BYTES = 128L * 1024 * 1024
        private const val MAX_AGE = 7 * 24 * 3600_000L
        private const val GUIDE_HORIZON = 8 * 3600_000L

        fun identity(source: Source, liveFormat: String, localZip: String): Identity {
            val raw = digest(listOf(source.id, source.type.name, source.server, source.username, source.password,
                source.m3uUrl, source.epgUrl, source.userAgent, source.hotUrl))
            val catalogue = digest(listOf(raw, "policy:$POLICY_VERSION"))
            return Identity(raw, catalogue, digest(listOf(catalogue, liveFormat, localZip)))
        }
        private fun digest(values: List<String>): String {
            val digest = MessageDigest.getInstance("SHA-256")
            values.forEach { value ->
                val bytes = value.toByteArray(Charsets.UTF_8)
                digest.update(byteArrayOf((bytes.size ushr 24).toByte(), (bytes.size ushr 16).toByte(), (bytes.size ushr 8).toByte(), bytes.size.toByte()))
                digest.update(bytes)
            }
            return digest.digest().joinToString("") { "%02x".format(it) }
        }
        private fun http(value: String) = value.startsWith("http://", ignoreCase = true) || value.startsWith("https://", ignoreCase = true)
        private fun DataInputStream.text(): String {
            val size = readInt()
            if (size !in 0..1_048_576) throw IOException("Invalid snapshot string")
            return String(ByteArray(size).also(::readFully), Charsets.UTF_8)
        }
        private fun DataOutputStream.text(value: String) {
            val bytes = value.toByteArray(Charsets.UTF_8)
            if (bytes.size > 1_048_576) throw IOException("Snapshot string too large")
            writeInt(bytes.size); write(bytes)
        }
        private fun DataInputStream.optional() = if (readBoolean()) text() else null
        private fun DataOutputStream.optional(value: String?) { writeBoolean(value != null); if (value != null) text(value) }
        private fun <T> DataInputStream.rows(limit: Int, decode: DataInputStream.() -> T): List<T> {
            val size = readInt()
            if (size !in 0..limit) throw IOException("Invalid snapshot collection")
            return List(size) { decode() }
        }
        private fun <T> DataOutputStream.rows(values: Collection<T>, limit: Int, encode: DataOutputStream.(T) -> Unit) {
            if (values.size !in 0..limit) throw IOException("Snapshot collection too large")
            writeInt(values.size); values.forEach { encode(it) }
        }
        private fun DataInputStream.strings() = rows(1_000) { text() }
        private fun DataOutputStream.strings(values: List<String>) = rows(values, 1_000) { text(it) }
        private fun DataInputStream.categories() = rows(10_000) { Category(text(), text()) }
        private fun DataOutputStream.categories(values: List<Category>) = rows(values, 10_000) { text(it.id); text(it.name) }
    }
}

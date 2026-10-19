package tv.lumanest.tuner.data

import java.util.Locale

/**
 * The popularity lists from `GET https://lumanest.tv/api/catalog/rows?v=1` (docs/browse.md). They only order and pick
 * titles from the customer's own catalogue: a TMDB title that isn't in the catalogue is never shown. Any list the
 * server leaves out is empty, and a server without TMDB answers with [source] "none".
 */
data class CatalogRows(
    val source: String,
    val generated: String,
    val movie: TmdbLists,
    val tv: TmdbLists,
    val movieGenres: List<TmdbGenre>,
    val tvGenres: List<TmdbGenre>,
) {
    /** TMDB data is in use: Popular and Featured exist, and Settings shows the TMDB attribution. */
    val usesTmdb: Boolean get() = source == "tmdb"

    fun lists(type: VodType) = if (type == VodType.MOVIES) movie else tv
    fun genres(type: VodType) = if (type == VodType.MOVIES) movieGenres else tvGenres

    companion object {
        val NONE = CatalogRows("none", "", TmdbLists.EMPTY, TmdbLists.EMPTY, emptyList(), emptyList())

        /** The response body, or null when it isn't a version 1 payload. Missing or malformed lists are empty. */
        fun parse(text: String): CatalogRows? {
            val root = runCatching { MiniJson.parse(text) }.getOrNull() as? Map<*, *> ?: return null
            if (MiniJson.long(root["v"]) != 1L) return null
            val genres = root["genres"] as? Map<*, *>
            return CatalogRows(
                source = (root["source"] as? String)?.trim()?.lowercase(Locale.ROOT)?.ifEmpty { null } ?: "none",
                generated = root["generated"] as? String ?: "",
                movie = TmdbLists.parse(root["movie"]),
                tv = TmdbLists.parse(root["tv"]),
                movieGenres = TmdbGenre.parseList(genres?.get("movie")),
                tvGenres = TmdbGenre.parseList(genres?.get("tv")),
            )
        }
    }
}

/**
 * One TMDB title from the rows payload. [year] is the first four digits of its `year` (docs/browse.md), 0 when unknown;
 * [origin] holds its usable countries, upper case ([VodRegion.country]); empty when unknown.
 */
data class TmdbTitle(
    val id: Long,
    val title: String,
    val originalTitle: String,
    val year: Int,
    val origin: List<String>,
    val lang: String,
    val genres: List<Int>,
) {
    companion object {
        fun parse(raw: Any?): TmdbTitle? {
            val m = raw as? Map<*, *> ?: return null
            val id = MiniJson.long(m["id"])?.takeIf { it > 0 } ?: return null
            val title = (m["title"] as? String)?.trim().orEmpty()
            val original = (m["original_title"] as? String)?.trim().orEmpty()
            if (title.isEmpty() && original.isEmpty()) return null
            val year = (m["year"]?.let { if (it is String) it else MiniJson.long(it)?.toString() })?.trim()
                ?.take(4)?.takeIf { it.length == 4 && it.all { c -> c in '0'..'9' } }?.toInt() ?: 0
            // docs/browse.md "Origin countries": "US", " us" count; "USA", "U.S." and non-strings are ignored.
            val origin = (m["origin"] as? List<*>).orEmpty().mapNotNull { (it as? String)?.let(VodRegion::country) }
            val genres = (m["genres"] as? List<*>).orEmpty().mapNotNull { MiniJson.long(it)?.takeIf { g -> g in 1..Int.MAX_VALUE }?.toInt() }
            return TmdbTitle(id, title.ifEmpty { original }, original.ifEmpty { title }, year, origin,
                (m["lang"] as? String)?.trim()?.lowercase(Locale.ROOT).orEmpty(), genres)
        }
    }
}

data class TmdbGenre(val id: Int, val name: String) {
    companion object {
        fun parseList(raw: Any?): List<TmdbGenre> = (raw as? List<*>).orEmpty().mapNotNull { entry ->
            val m = entry as? Map<*, *> ?: return@mapNotNull null
            val id = MiniJson.long(m["id"])?.takeIf { it in 1..Int.MAX_VALUE }?.toInt() ?: return@mapNotNull null
            val name = (m["name"] as? String)?.trim()?.takeIf { it.isNotEmpty() } ?: return@mapNotNull null
            TmdbGenre(id, name)
        }.distinctBy { it.id }
    }
}

/** The lists for one type ("movie" or "tv"). [services] is keyed by [StreamingServices] keys. */
data class TmdbLists(
    val popular: List<TmdbTitle>,
    val featured: List<TmdbTitle>,
    val topRated: List<TmdbTitle>,
    val services: Map<String, List<TmdbTitle>>,
) {
    fun service(key: String): List<TmdbTitle> = services[key].orEmpty()
    val all: Sequence<TmdbTitle> get() = sequenceOf(popular, featured, topRated).flatten() + services.values.asSequence().flatten()

    companion object {
        val EMPTY = TmdbLists(emptyList(), emptyList(), emptyList(), emptyMap())

        fun parse(raw: Any?): TmdbLists {
            val m = raw as? Map<*, *> ?: return EMPTY
            fun list(value: Any?) = (value as? List<*>).orEmpty().mapNotNull(TmdbTitle::parse).distinctBy { it.id }
            val services = m["services"] as? Map<*, *>
            return TmdbLists(
                popular = list(m["popular"]),
                featured = list(m["featured"]),
                topRated = list(m["top_rated"]),
                services = StreamingServices.ALL.associate { it.key to list(services?.get(it.key)) },
            )
        }
    }
}

/**
 * A small, strict JSON reader in plain Kotlin, so the rows payload (and its tests) need no Android classes.
 * Objects become maps, arrays lists, numbers [Double], and nesting is limited so a hostile body can't overflow the stack.
 */
internal object MiniJson {
    private const val MAX_DEPTH = 64

    fun parse(text: String): Any? {
        val reader = Reader(text)
        reader.skipSpace()
        val value = reader.value(0)
        reader.skipSpace()
        if (!reader.done) throw IllegalArgumentException("Trailing data at ${reader.at}")
        return value
    }

    /** A whole number from a JSON number or a numeric string, or null. */
    fun long(value: Any?): Long? = when (value) {
        is Double -> value.takeIf { it.isFinite() && it == Math.rint(it) && kotlin.math.abs(it) < 9.0E15 }?.toLong()
        is Number -> value.toLong()
        is String -> value.trim().removeSuffix(".0").toLongOrNull()
        else -> null
    }

    private class Reader(private val s: String) {
        var at = 0
            private set
        val done get() = at >= s.length

        fun skipSpace() { while (at < s.length && s[at].let { it == ' ' || it == '\n' || it == '\r' || it == '\t' }) at++ }

        private fun fail(what: String): Nothing = throw IllegalArgumentException("$what at $at")

        fun value(depth: Int): Any? {
            if (depth > MAX_DEPTH) fail("Too deep")
            if (done) fail("Unexpected end")
            return when (s[at]) {
                '{' -> obj(depth)
                '[' -> array(depth)
                '"' -> string()
                't' -> literal("true", true)
                'f' -> literal("false", false)
                'n' -> literal("null", null)
                else -> number()
            }
        }

        private fun obj(depth: Int): Map<String, Any?> {
            val out = LinkedHashMap<String, Any?>()
            at++
            skipSpace()
            if (!done && s[at] == '}') { at++; return out }
            while (true) {
                skipSpace()
                if (done || s[at] != '"') fail("Expected a key")
                val key = string()
                skipSpace()
                if (done || s[at] != ':') fail("Expected ':'")
                at++
                skipSpace()
                out[key] = value(depth + 1)
                skipSpace()
                if (done) fail("Unclosed object")
                when (s[at++]) {
                    ',' -> continue
                    '}' -> return out
                    else -> fail("Expected ',' or '}'")
                }
            }
        }

        private fun array(depth: Int): List<Any?> {
            val out = ArrayList<Any?>()
            at++
            skipSpace()
            if (!done && s[at] == ']') { at++; return out }
            while (true) {
                skipSpace()
                out += value(depth + 1)
                skipSpace()
                if (done) fail("Unclosed array")
                when (s[at++]) {
                    ',' -> continue
                    ']' -> return out
                    else -> fail("Expected ',' or ']'")
                }
            }
        }

        private fun string(): String {
            at++
            val out = StringBuilder()
            while (true) {
                if (done) fail("Unclosed string")
                val c = s[at++]
                when {
                    c == '"' -> return out.toString()
                    c == '\\' -> {
                        if (done) fail("Bad escape")
                        when (val e = s[at++]) {
                            '"', '\\', '/' -> out.append(e)
                            'b' -> out.append('\b')
                            'f' -> out.append('\u000C')
                            'n' -> out.append('\n')
                            'r' -> out.append('\r')
                            't' -> out.append('\t')
                            'u' -> {
                                if (at + 4 > s.length) fail("Bad unicode escape")
                                out.append(s.substring(at, at + 4).toIntOrNull(16)?.toChar() ?: fail("Bad unicode escape"))
                                at += 4
                            }
                            else -> fail("Bad escape")
                        }
                    }
                    c < ' ' -> fail("Control character in string")
                    else -> out.append(c)
                }
            }
        }

        private fun literal(word: String, value: Any?): Any? {
            if (!s.startsWith(word, at)) fail("Unexpected token")
            at += word.length
            return value
        }

        private fun number(): Double {
            val start = at
            if (at < s.length && s[at] == '-') at++
            while (at < s.length && (s[at].isDigit() || s[at] == '.' || s[at] == 'e' || s[at] == 'E' || s[at] == '+' || s[at] == '-')) at++
            return s.substring(start, at).toDoubleOrNull() ?: fail("Bad number")
        }
    }
}

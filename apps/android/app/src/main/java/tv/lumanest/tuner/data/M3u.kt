package tv.lumanest.tuner.data

import java.io.File

/** Result of parsing a plain M3U playlist. VOD entries are split out by their URL shape. */
class M3uResult(
    val epgUrl: String?,
    val liveCategories: List<Category>,
    val channels: List<Channel>,
    val movieCategories: List<Category>,
    val movies: List<Movie>,
)

/**
 * Plain M3U playlists, read as docs/browse.md "M3U playlists" says, so every app names and groups an entry alike:
 * lines split at CR LF, CR and LF (BufferedReader's lines) and trimmed as provider fields, tags compared ignoring the
 * case of ASCII letters only, and each `#EXTINF` line read in one pass by [readExtinf].
 */
object M3u {
    fun parse(file: File): M3uResult {
        var epgUrl: String? = null
        val channels = ArrayList<Channel>(4096)
        val movies = ArrayList<Movie>()
        val liveCats = LinkedHashMap<String, Category>()
        val movieCats = LinkedHashMap<String, Category>()

        // The pending #EXTINF line and #EXTGRP: line; a URL line makes an entry of them and clears both.
        var info: ExtInf? = null
        var groupLine = ""
        // Every URL line counts as an entry ("Channel N"), movies too; index numbers the live channels for their keys.
        var entry = 0
        var index = 0

        Net.openMaybeGzip(file).bufferedReader(Charsets.UTF_8).useLines { lines ->
            lines.forEach { raw ->
                // Spaces and the Unicode spaces only (docs/browse.md "Trimming"), which takes a byte order mark off the
                // first line too; Kotlin's trim() and isBlank() also take U+001C to U+001F.
                val line = BrowseText.trimField(raw)
                when {
                    line.isEmpty() -> Unit
                    startsWithTag(line, "#EXTM3U") -> {
                        val a = readExtinf(line, title = false).values
                        epgUrl = (a["url-tvg"] ?: a["x-tvg-url"])?.split(',')?.firstOrNull()?.trim()?.ifBlank { null }
                    }
                    startsWithTag(line, "#EXTINF") -> {
                        info = readExtinf(line, title = true)
                        groupLine = ""
                    }
                    startsWithTag(line, "#EXTGRP:") -> groupLine = BrowseText.trimField(line.substring(GROUP_TAG.length))
                    line[0] == '#' -> Unit
                    else -> {
                        val url = line
                        entry++
                        val attrs = info?.values.orEmpty()
                        val name = info?.title.orEmpty().ifEmpty { field(attrs, "tvg-name") }.ifEmpty { "Channel $entry" }
                        val group = field(attrs, "group-title").ifEmpty { groupLine }.ifEmpty { "Uncategorized" }
                        val logo = attrs["tvg-logo"]?.ifBlank { null }
                        val isVod = url.contains("/movie/") || url.contains("/series/") ||
                            url.endsWith(".mp4", true) || url.endsWith(".mkv", true) || url.endsWith(".avi", true)
                        if (isVod) {
                            val cat = movieCats.getOrPut(group) { Category("g${movieCats.size}", group) }
                            movies += Movie(
                                id = "mu:" + url.hashCode().toUInt().toString(36),
                                name = name, poster = logo, rating = null, categoryId = cat.id, url = url,
                                country = attrs["tvg-country"]?.ifBlank { null } ?: attrs["country"]?.ifBlank { null },
                                language = attrs["tvg-language"]?.ifBlank { null } ?: attrs["language"]?.ifBlank { null },
                            )
                        } else {
                            val cat = liveCats.getOrPut(group) { Category("g${liveCats.size}", group) }
                            index++
                            channels += Channel(
                                key = "u:" + url.hashCode().toUInt().toString(36) + ":" + index,
                                number = attrs["tvg-chno"]?.toIntOrNull() ?: 0,
                                name = name,
                                logo = logo,
                                categoryId = cat.id,
                                epgId = attrs["tvg-id"]?.ifBlank { null } ?: attrs["tvg-name"]?.ifBlank { null },
                                streamId = null,
                                url = url,
                                country = attrs["tvg-country"]?.ifBlank { null } ?: attrs["country"]?.ifBlank { null },
                                language = attrs["tvg-language"]?.ifBlank { null } ?: attrs["language"]?.ifBlank { null },
                            )
                        }
                        info = null
                        groupLine = ""
                    }
                }
            }
        }
        return M3uResult(
            epgUrl = epgUrl,
            liveCategories = liveCats.values.toList(),
            channels = Xtream.renumber(channels),
            movieCategories = movieCats.values.toList(),
            movies = movies,
        )
    }

    private const val GROUP_TAG = "#EXTGRP:"

    /** An `#EXTINF` (or `#EXTM3U`) line: its values, keys ASCII-lower-cased, and its title (`""`: none). */
    internal class ExtInf(val values: Map<String, String>, val title: String)

    /**
     * Whether [line] starts with [tag] (upper case), ignoring the case of ASCII letters only: Kotlin's `ignoreCase` would
     * also take a dotless i (U+0131) for `I`, so `#EXT`, that letter and `NF` would read as `#EXTINF`.
     */
    private fun startsWithTag(line: String, tag: String): Boolean {
        if (line.length < tag.length) return false
        for (i in tag.indices) {
            val c = line[i]
            if ((if (c in 'a'..'z') c - 32 else c) != tag[i]) return false
        }
        return true
    }

    private fun isKeyChar(c: Char): Boolean = c in 'A'..'Z' || c in 'a'..'z' || c in '0'..'9' || c == '_' || c == '-'

    /** The value of [key] trimmed as a provider field, `""` when the line gave none. */
    private fun field(values: Map<String, String>, key: String): String = values[key]?.let(BrowseText::trimField).orEmpty()

    /**
     * Reads [line] from its start, one character at a time (docs/browse.md, "M3U playlists", Values and title):
     * - a key is a whole run of ASCII letters, digits, `_` and `-`; when it is followed by `=` (spaces, U+0020 only,
     *   around it), then by `"` or `'`, and the same quote comes again later on the line, the text between the quotes
     *   is its value and reading goes on after the closing quote; otherwise reading goes on after the key;
     * - with [title], the first `,` reached ends the reading, and the rest of the line trimmed as a provider field is
     *   the title; without it (the `#EXTM3U` header, which has no title) a comma is passed over;
     * - any other character is passed over, a quote that starts no value too.
     * A key given twice keeps its first value. Time grows in proportion to the line: a value's text is passed over once,
     * and a search for a closing quote that fails finds no quote of that kind later on the line, so it happens at most
     * once for each kind.
     */
    internal fun readExtinf(line: String, title: Boolean): ExtInf {
        val values = HashMap<String, String>()
        val n = line.length
        var i = 0
        while (i < n) {
            val c = line[i]
            if (c == ',' && title) return ExtInf(values, BrowseText.trimField(line.substring(i + 1)))
            if (!isKeyChar(c)) { i++; continue }
            var j = i
            while (j < n && isKeyChar(line[j])) j++
            var k = j
            while (k < n && line[k] == ' ') k++
            if (k < n && line[k] == '=') {
                k++
                while (k < n && line[k] == ' ') k++
                val q = if (k < n) line[k] else ' '
                val close = if (q == '"' || q == '\'') line.indexOf(q, k + 1) else -1
                if (close > k) {
                    val key = BrowseText.asciiLower(line.substring(i, j))
                    // Not putIfAbsent, which needs API 24.
                    if (key !in values) values[key] = line.substring(k + 1, close)
                    i = close + 1
                    continue
                }
            }
            i = j
        }
        return ExtInf(values, "")
    }
}

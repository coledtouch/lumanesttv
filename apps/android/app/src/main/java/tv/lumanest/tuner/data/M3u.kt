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

object M3u {
    private val attrRe = Regex("""([A-Za-z0-9_-]+)="([^"]*)"""")

    fun parse(file: File): M3uResult {
        var epgUrl: String? = null
        val channels = ArrayList<Channel>(4096)
        val movies = ArrayList<Movie>()
        val liveCats = LinkedHashMap<String, Category>()
        val movieCats = LinkedHashMap<String, Category>()

        var attrs: Map<String, String> = emptyMap()
        var title: String? = null
        var groupOverride: String? = null
        var index = 0

        Net.openMaybeGzip(file).bufferedReader(Charsets.UTF_8).useLines { lines ->
            lines.forEach { raw ->
                val line = raw.trim()
                when {
                    line.isEmpty() -> Unit
                    line.startsWith("#EXTM3U", true) -> {
                        val a = attrRe.findAll(line).associate { it.groupValues[1].lowercase() to it.groupValues[2] }
                        epgUrl = (a["url-tvg"] ?: a["x-tvg-url"])?.split(',')?.firstOrNull()?.trim()?.ifBlank { null }
                    }
                    line.startsWith("#EXTINF", true) -> {
                        attrs = attrRe.findAll(line).associate { it.groupValues[1].lowercase() to it.groupValues[2] }
                        title = nameAfterComma(line)
                        groupOverride = null
                    }
                    line.startsWith("#EXTGRP:", true) -> groupOverride = line.substringAfter(':').trim()
                    line.startsWith("#") -> Unit
                    else -> {
                        val url = line
                        val name = (title ?: attrs["tvg-name"])?.ifBlank { null } ?: "Channel ${index + 1}"
                        val group = (attrs["group-title"] ?: groupOverride)?.ifBlank { null } ?: "Uncategorized"
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
                        attrs = emptyMap(); title = null; groupOverride = null
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

    /** The display name is whatever follows the first comma that is not inside a quoted attribute. */
    private fun nameAfterComma(line: String): String? {
        var inQuote = false
        for (i in line.indices) {
            val c = line[i]
            if (c == '"') inQuote = !inQuote
            else if (c == ',' && !inQuote) return line.substring(i + 1).trim().ifBlank { null }
        }
        return null
    }
}

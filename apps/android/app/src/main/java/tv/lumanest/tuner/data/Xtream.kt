package tv.lumanest.tuner.data

import android.net.Uri
import android.util.Base64
import java.io.File
import java.net.URLEncoder

/** Xtream Codes "player_api.php" client: URL building plus parsers for each list endpoint. */
class Xtream(private val src: Source) {
    private val base = normalizeServer(src.server)
    private val u = src.username
    private val p = src.password
    private fun enc(s: String) = URLEncoder.encode(s, "UTF-8")

    fun api(action: String? = null, extra: String = ""): String =
        "$base/player_api.php?username=${enc(u)}&password=${enc(p)}" +
            (action?.let { "&action=$it" } ?: "") + extra

    fun xmltv() = "$base/xmltv.php?username=${enc(u)}&password=${enc(p)}"
    fun live(id: String, ext: String) = "$base/live/$u/$p/$id.$ext"
    fun movie(id: String, ext: String) = "$base/movie/$u/$p/$id.$ext"
    fun episode(id: String, ext: String) = "$base/series/$u/$p/$id.$ext"

    fun parseCategories(file: File): List<Category> {
        val out = ArrayList<Category>()
        forEachJsonObject(file, CATEGORY_FIELDS) { o ->
            val id = o.str("category_id") ?: return@forEachJsonObject
            out += Category(id, o.str("category_name") ?: "Other", AdultFilter.isAdultFlag(o.str("is_adult")))
        }
        return out.distinctBy { it.id }
    }

    fun parseLive(file: File, ext: String): List<Channel> {
        val byId = LinkedHashMap<String, Channel>(8192)
        forEachJsonObject(file, LIVE_FIELDS) { o ->
            val id = o.str("stream_id") ?: return@forEachJsonObject
            val cats = categoriesOf(o)
            val prev = byId[id]
            if (prev != null) {
                byId[id] = prev.copy(categoryIds = (prev.categoryIds + cats).distinct(),
                    country = mergeMetadata(prev.country, countryOf(o)), language = mergeMetadata(prev.language, languageOf(o)),
                    adult = prev.adult || adultOf(o))
                return@forEachJsonObject
            }
            val direct = o.str("direct_source")?.takeIf { it.startsWith("http") }
            byId[id] = Channel(
                key = "x:$id",
                number = o.str("num")?.toIntOrNull() ?: 0,
                name = o.str("name") ?: "Channel $id",
                logo = o.str("stream_icon"),
                categoryId = cats.firstOrNull() ?: "",
                epgId = o.str("epg_channel_id"),
                streamId = id,
                url = direct?.let { withExt(it, ext) } ?: live(id, ext),
                categoryIds = cats,
                country = countryOf(o),
                language = languageOf(o),
                adult = adultOf(o),
            )
        }
        return renumber(ArrayList(byId.values))
    }

    /** category_id plus any extra category_ids, as strings. */
    private fun categoriesOf(o: JMap): List<String> {
        val list = ArrayList<String>(2)
        o.str("category_id")?.let { list += it }
        (o["category_ids"] as? List<*>)?.forEach { v -> v?.toString()?.substringBefore('.')?.takeIf { it.isNotBlank() }?.let { if (it !in list) list += it } }
        return list
    }

    private fun metadata(o: JMap, keys: List<String>): String? {
        var values: LinkedHashSet<String>? = null
        for (key in keys) {
            val value = o[key] ?: continue
            if (value is List<*>) {
                for (item in value) {
                    val text = item?.toString()?.trim()?.takeIf(String::isNotBlank) ?: continue
                    if (values == null) values = LinkedHashSet()
                    values.add(text)
                }
            } else {
                val text = value.toString().trim().takeIf(String::isNotBlank) ?: continue
                if (values == null) values = LinkedHashSet()
                values.add(text)
            }
        }
        return values?.joinToString(";")
    }

    private fun adultOf(o: JMap) = AdultFilter.isAdultFlag(o.str("is_adult"))

    /** A TMDB id in `tmdb`, `tmdb_id` or `info.tmdb_id` (docs/browse.md), digits only; "0" and blanks are no id. */
    private fun tmdbOf(o: JMap): String? {
        val info = o.obj("info")
        return sequenceOf(o.str("tmdb"), o.str("tmdb_id"), info?.str("tmdb_id"), info?.str("tmdb"))
            .mapNotNull { it?.removeSuffix(".0")?.trim()?.takeIf { v -> v.length in 1..12 && v.all(Char::isDigit) && v.trimStart('0').isNotEmpty() } }
            .firstOrNull()
    }

    /** The release year from `year` or a release date, as four digits. */
    private fun yearOf(o: JMap): String? = sequenceOf("year", "releaseDate", "release_date", "releasedate")
        .mapNotNull { key -> o.str(key)?.trim()?.take(4)?.takeIf { it.length == 4 && it.all(Char::isDigit) && it.toInt() in 1870..2200 } }
        .firstOrNull()
    private fun countryOf(o: JMap) = metadata(o, COUNTRY_FIELDS)
    private fun languageOf(o: JMap) = metadata(o, LANGUAGE_FIELDS)
    private fun mergeMetadata(first: String?, second: String?): String? = when {
        first == null -> second
        second == null || first == second -> first
        else -> "$first;$second"
    }

    /** Swaps a live direct_source's extension to the chosen format (ts or m3u8). */
    private fun withExt(url: String, ext: String): String {
        val path = url.substringBefore('?')
        val last = path.substringAfterLast('/')
        return if (last.endsWith(".ts") || last.endsWith(".m3u8")) path.substringBeforeLast('.') + "." + ext + url.removePrefix(path) else url
    }

    fun parseMovies(file: File): List<Movie> {
        val byId = LinkedHashMap<String, Movie>(16384)
        forEachJsonObject(file, MOVIE_FIELDS) { o ->
            val id = o.str("stream_id") ?: return@forEachJsonObject
            val cats = categoriesOf(o)
            val prev = byId[id]
            if (prev != null) {
                byId[id] = prev.copy(categoryIds = (prev.categoryIds + cats).distinct(),
                    country = mergeMetadata(prev.country, countryOf(o)), language = mergeMetadata(prev.language, languageOf(o)),
                    adult = prev.adult || adultOf(o), tmdb = prev.tmdb ?: tmdbOf(o), year = prev.year ?: yearOf(o), genre = prev.genre ?: o.str("genre"))
                return@forEachJsonObject
            }
            byId[id] = Movie(
                id = "m:$id",
                name = o.str("name") ?: "Movie",
                poster = o.str("stream_icon"),
                rating = o.str("rating")?.takeIf { it != "0" && it != "0.0" },
                categoryId = cats.firstOrNull() ?: "",
                url = o.str("direct_source")?.takeIf { it.startsWith("http") } ?: movie(id, o.str("container_extension") ?: "mp4"),
                added = o.str("added")?.toLongOrNull() ?: 0,
                categoryIds = cats,
                country = countryOf(o),
                language = languageOf(o),
                adult = adultOf(o),
                tmdb = tmdbOf(o),
                year = yearOf(o),
                genre = o.str("genre"),
            )
        }
        return ArrayList(byId.values)
    }

    fun parseSeries(file: File): List<Series> {
        val byId = LinkedHashMap<String, Series>(8192)
        forEachJsonObject(file, SERIES_FIELDS) { o ->
            val id = o.str("series_id") ?: return@forEachJsonObject
            val cats = categoriesOf(o)
            val prev = byId[id]
            if (prev != null) {
                byId[id] = prev.copy(categoryIds = (prev.categoryIds + cats).distinct(),
                    country = mergeMetadata(prev.country, countryOf(o)), language = mergeMetadata(prev.language, languageOf(o)),
                    adult = prev.adult || adultOf(o), tmdb = prev.tmdb ?: tmdbOf(o))
                return@forEachJsonObject
            }
            byId[id] = Series(
                id = id,
                name = o.str("name") ?: "Series",
                cover = o.str("cover"),
                plot = o.str("plot"),
                rating = o.str("rating")?.takeIf { it != "0" && it != "0.0" },
                categoryId = cats.firstOrNull() ?: "",
                genre = o.str("genre"),
                year = (o.str("releaseDate") ?: o.str("release_date"))?.take(4) ?: yearOf(o),
                backdrop = o.str("backdrop_path"),
                added = o.str("last_modified")?.toLongOrNull() ?: 0,
                categoryIds = cats,
                country = countryOf(o),
                language = languageOf(o),
                adult = adultOf(o),
                tmdb = tmdbOf(o),
            )
        }
        return ArrayList(byId.values)
    }

    fun parseMovieInfo(text: String): MovieInfo? {
        @Suppress("UNCHECKED_CAST")
        val root = parseJson(text) as? JMap ?: return null
        val i = root.obj("info") ?: return null
        return MovieInfo(
            plot = i.str("plot") ?: i.str("description"),
            cast = i.str("cast") ?: i.str("actors"),
            director = i.str("director"),
            genre = i.str("genre"),
            year = (i.str("releasedate") ?: i.str("release_date") ?: i.str("year"))?.take(4),
            duration = i.str("duration"),
            rating = i.str("rating")?.takeIf { it != "0" },
            backdrop = i.str("backdrop_path"),
            poster = i.str("movie_image") ?: i.str("cover_big"),
            subtitles = (subtitlesOf(i["subtitles"]) + subtitlesOf(root.obj("movie_data")?.get("subtitles"))).distinctBy { it.url },
        )
    }

    fun parseSeriesInfo(text: String): SeriesInfo? {
        @Suppress("UNCHECKED_CAST")
        val root = parseJson(text) as? JMap ?: return null
        val info = root.obj("info") ?: emptyMap()
        val seasons = sortedMapOf<Int, MutableList<Episode>>()
        fun addEpisode(e: JMap, seasonHint: Int?) {
            val id = e.str("id") ?: return
            val ei = e.obj("info") ?: emptyMap()
            val season = e.str("season")?.toIntOrNull() ?: seasonHint ?: 1
            val num = e.str("episode_num")?.toIntOrNull() ?: 0
            seasons.getOrPut(season) { mutableListOf() } += Episode(
                id = "e:$id",
                season = season,
                number = num,
                title = e.str("title") ?: "Episode $num",
                plot = ei.str("plot"),
                image = ei.str("movie_image"),
                durationSecs = ei.str("duration_secs")?.toIntOrNull() ?: 0,
                url = e.str("direct_source")?.takeIf { it.startsWith("http") } ?: episode(id, e.str("container_extension") ?: "mp4"),
                subtitles = (subtitlesOf(e["subtitles"]) + subtitlesOf(ei["subtitles"])).distinctBy { it.url },
            )
        }
        when (val eps = root["episodes"]) {
            is Map<*, *> -> eps.forEach { (k, v) ->
                @Suppress("UNCHECKED_CAST")
                (v as? List<Any?>)?.forEach { (it as? JMap)?.let { e -> addEpisode(e, k.toString().toIntOrNull()) } }
            }
            is List<*> -> eps.forEach { item ->
                @Suppress("UNCHECKED_CAST")
                when (item) {
                    is List<*> -> item.forEach { (it as? JMap)?.let { e -> addEpisode(e, null) } }
                    is Map<*, *> -> addEpisode(item as JMap, null)
                }
            }
        }
        return SeriesInfo(
            plot = info.str("plot"),
            cast = info.str("cast"),
            genre = info.str("genre"),
            year = (info.str("releaseDate") ?: info.str("release_date"))?.take(4),
            backdrop = info.str("backdrop_path"),
            seasons = seasons.mapValues { (_, v) -> v.distinctBy { it.id }.sortedBy { it.number } },
        )
    }

    /**
     * Some panels list sidecar subtitles in get_vod_info / get_series_info as plain URLs or as objects with a
     * url (or file/path/src) and an optional language and label. Anything else is ignored.
     */
    private fun subtitlesOf(value: Any?): List<ExternalSubtitle> {
        val list = value as? List<*> ?: return emptyList()
        return list.mapNotNull { entry ->
            when (entry) {
                is String -> entry.trim().takeIf { it.startsWith("http", ignoreCase = true) }?.let { ExternalSubtitle(it) }
                is Map<*, *> -> {
                    @Suppress("UNCHECKED_CAST")
                    val m = entry as JMap
                    val url = SUBTITLE_URL_FIELDS.firstNotNullOfOrNull { m.str(it) }?.takeIf { it.startsWith("http", ignoreCase = true) }
                    url?.let { ExternalSubtitle(it, m.str("language") ?: m.str("lang") ?: m.str("srclang"), m.str("label") ?: m.str("name") ?: m.str("title")) }
                }
                else -> null
            }
        }
    }

    /** get_short_epg: titles and descriptions come back base64 encoded. */
    fun parseShortEpg(text: String): List<Program> {
        @Suppress("UNCHECKED_CAST")
        val root = parseJson(text) as? JMap ?: return emptyList()
        val list = root["epg_listings"] as? List<*> ?: return emptyList()
        return list.mapNotNull { item ->
            @Suppress("UNCHECKED_CAST")
            val o = item as? JMap ?: return@mapNotNull null
            val start = o.str("start_timestamp")?.toLongOrNull()?.times(1000) ?: return@mapNotNull null
            val end = o.str("stop_timestamp")?.toLongOrNull()?.times(1000) ?: return@mapNotNull null
            Program(start, end, b64(o.str("title")) ?: "", b64(o.str("description")))
        }.filter { it.end > it.start }.sortedBy { it.start }
    }

    private fun b64(s: String?): String? = s?.let {
        runCatching { String(Base64.decode(it, Base64.DEFAULT), Charsets.UTF_8) }.getOrDefault(it)
    }?.trim()?.ifBlank { null }

    companion object {
        private val SUBTITLE_URL_FIELDS = listOf("url", "file", "path", "src", "link")
        private val COUNTRY_FIELDS = listOf("country", "country_code", "country_name", "stream_country", "tvg-country")
        private val LANGUAGE_FIELDS = listOf("language", "lang", "original_language", "audio_language", "stream_language", "tvg-language")
        private val COMMON_FIELDS = (COUNTRY_FIELDS + LANGUAGE_FIELDS + listOf("name", "category_id", "category_ids", "is_adult")).toSet()
        private val CATEGORY_FIELDS = setOf("category_id", "category_name", "is_adult")
        private val LIVE_FIELDS = COMMON_FIELDS + setOf("stream_id", "num", "stream_icon", "epg_channel_id", "direct_source")
        /** TMDB ids and years for matching titles to the popularity lists (docs/browse.md). */
        private val TMDB_FIELDS = setOf("tmdb", "tmdb_id", "info", "year", "releaseDate", "release_date", "releasedate")
        private val MOVIE_FIELDS = COMMON_FIELDS + TMDB_FIELDS + setOf("stream_id", "stream_icon", "rating", "direct_source", "container_extension", "added", "genre")
        private val SERIES_FIELDS = COMMON_FIELDS + TMDB_FIELDS + setOf("series_id", "cover", "plot", "rating", "genre", "backdrop_path", "last_modified")

        fun normalizeServer(raw: String): String {
            var s = raw.trim()
            if (!s.startsWith("http://", true) && !s.startsWith("https://", true)) s = "http://$s"
            s = s.substringBefore("/player_api.php").substringBefore("/get.php").substringBefore("/xmltv.php")
            return s.trimEnd('/')
        }

        /** Recognises "http://host:port/get.php?username=..&password=.." playlist links. */
        fun fromGetPhp(url: String): Triple<String, String, String>? {
            if (!url.contains("get.php", true)) return null
            val uri = runCatching { Uri.parse(url.trim()) }.getOrNull() ?: return null
            val user = uri.getQueryParameter("username") ?: return null
            val pass = uri.getQueryParameter("password") ?: return null
            val server = "${uri.scheme}://${uri.encodedAuthority}"
            return Triple(server, user, pass)
        }

        fun renumber(list: MutableList<Channel>): List<Channel> {
            // Keep provider numbers when they look sane, otherwise number sequentially.
            val useProvider = list.isNotEmpty() && list.count { it.number > 0 } > list.size * 0.9 &&
                list.map { it.number }.toSet().size > list.size * 0.9
            return if (useProvider) list.sortedBy { it.number }
            else list.mapIndexed { i, c -> c.copy(number = i + 1) }
        }
    }
}

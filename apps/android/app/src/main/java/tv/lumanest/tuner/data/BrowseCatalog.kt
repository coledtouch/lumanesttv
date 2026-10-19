package tv.lumanest.tuner.data

import tv.lumanest.tuner.Edition
import java.text.Normalizer
import java.util.Locale

/**
 * Movies & Series browsing (docs/browse.md) as plain Kotlin: TMDB matching, the "USA only" rule, genres, and the
 * ordered lists behind Home, Discover and Library. [BrowseCatalog.build] does the expensive work once per catalogue
 * (normalising and matching every title, sorting every list); screens then only walk precomputed index arrays, so
 * tens of thousands of titles stay quick. Nothing here touches Android, the network or the UI.
 */
enum class VodType(val label: String) { MOVIES("Movies"), SERIES("Series") }

/** The US subscription services, in the order Home shows them. */
object StreamingServices {
    class Service(val key: String, val name: String, private val category: Regex) {
        fun matchesCategory(name: String) = category.containsMatchIn(name)
    }

    private fun rx(pattern: String) = Regex(pattern, RegexOption.IGNORE_CASE)

    val ALL = listOf(
        Service("netflix", "Netflix", rx("netflix")),
        Service("disney", "Disney+", rx("disney")),
        Service("max", "Max", rx("hbo|(?<![a-z0-9])max(?![a-z0-9])")),
        Service("prime", "Prime Video", rx("amazon|(?<![a-z0-9])prime(?![a-z0-9])")),
        Service("apple", "Apple TV+", rx("(?<![a-z0-9])apple(?![a-z0-9])")),
        Service("hulu", "Hulu", rx("hulu")),
        Service("paramount", "Paramount+", rx("paramount")),
        Service("peacock", "Peacock", rx("peacock")),
    )

    /**
     * The services the screens may name. The store edition shows none: rows and lists named after a streaming
     * service could read as an affiliation in Google Play and Amazon review.
     */
    fun shown(store: Boolean = Edition.STORE): List<Service> = if (store) emptyList() else ALL

    fun byKey(key: String) = ALL.firstOrNull { it.key == key }
}

/** Discover's List choices and the matching Home rows. */
object BrowseList {
    const val POPULAR = "popular"
    const val FEATURED = "featured"
    const val TOP_RATED = "top_rated"
    const val RECENT = "recent"
    const val AZ = "az"

    data class Option(val key: String, val name: String)

    /** Popular and Featured need TMDB; the services are left out of the store edition. */
    fun options(tmdb: Boolean, store: Boolean = Edition.STORE): List<Option> = buildList {
        if (tmdb) { add(Option(POPULAR, "Popular")); add(Option(FEATURED, "Featured")) }
        add(Option(TOP_RATED, "Top rated"))
        add(Option(RECENT, "Recently added"))
        add(Option(AZ, "A–Z"))
        StreamingServices.shown(store).forEach { add(Option(it.key, it.name)) }
    }

    fun defaultList(tmdb: Boolean) = if (tmdb) POPULAR else RECENT

    fun name(key: String): String = when (key) {
        POPULAR -> "Popular"; FEATURED -> "Featured"; TOP_RATED -> "Top rated"; RECENT -> "Recently added"; AZ -> "A–Z"
        else -> StreamingServices.byKey(key)?.name ?: key
    }
}

/** Title normalisation for matching provider titles to TMDB (docs/browse.md, "Matching catalogue titles to TMDB"). */
object TitleMatch {
    /**
     * Bracketed and braced tags, short upper-case tags between pipes or in parentheses, and a (YYYY): [4K], |US|, (EN).
     * Only a short code counts between pipes: "EN | Stranger Things | 4K" keeps its title (the prefix and suffix
     * rules take the "EN |" and "| 4K").
     */
    private val tags = Regex("""\[[^\]]*]|\{[^}]*}|\|\s*[A-Z0-9+]{1,6}\s*\||\(\s*(?:18|19|20)\d\d\s*\)|\([A-Z0-9 +.]{1,6}\)""")
    /** A short upper-case tag in front of the title: "US - ", "EN| ", "NF: ", "4K-EN - ". */
    private val prefix = Regex("""^\s*[A-Z0-9+]{2,4}(?:\s*[-_]\s*[A-Z0-9+]{2,4})?\s*(?:\|\s*|[:\-–]\s+)""")
    /** The same kind of tag after the title: " | EN", " - US". */
    private val suffix = Regex("""\s(?:\||-|–)\s*[A-Z0-9+]{2,4}\s*$""")
    private val apostrophes = Regex("['`´’]")
    private val marks = Regex("\\p{M}+")
    private val nonWord = Regex("[^a-z0-9]+")
    private val quality = setOf("4k", "uhd", "hd", "fhd", "hdr", "hdr10", "1080p", "720p", "2160p")
    private val bracketYear = Regex("""[(\[]\s*((?:18|19|20)\d\d)\s*[)\]]""")
    private val leadingYear = Regex("""^\s*((?:18|19|20)\d\d)(?!\d)""")

    /** Lower case; no trailing (YYYY), tags or "US -" prefix; no quality words; & as "and"; no punctuation; no leading "the". */
    fun normalize(name: String): String = clean(name, stripAffixes = true)

    /**
     * The keys a provider title can match under: [normalize] first, then the same without removing the leading and
     * trailing tags, for titles such as "CSI: Miami" or "NCIS: Los Angeles" whose real name looks like a tag.
     */
    fun keys(name: String): List<String> {
        val main = clean(name, stripAffixes = true)
        val whole = clean(name, stripAffixes = false)
        return when {
            whole.isEmpty() || whole == main -> listOfNotNull(main.ifEmpty { null })
            main.isEmpty() -> listOf(whole)
            else -> listOf(main, whole)
        }
    }

    private fun clean(name: String, stripAffixes: Boolean): String {
        var s = name.replace('\u00A0', ' ')
        if (s.indexOfAny(charArrayOf('[', '{', '|', '(')) >= 0) s = tags.replace(s, " ")
        if (stripAffixes && s.indexOfAny(charArrayOf('|', ':', '-', '–')) >= 0) {
            repeat(3) { val next = prefix.replaceFirst(s, ""); if (next == s) return@repeat; s = next }
            s = suffix.replace(s, "")
        }
        s = s.lowercase(Locale.ROOT)
        if ('&' in s) s = s.replace("&", " and ")
        s = apostrophes.replace(s, "")
        if (s.any { it.code > 0x7F }) s = marks.replace(Normalizer.normalize(s, Normalizer.Form.NFD), "")
            .replace("æ", "ae").replace("œ", "oe").replace("ß", "ss").replace("ø", "o")
        val words = nonWord.replace(s, " ").trim().split(' ').filter { it.isNotEmpty() && it !in quality }
        return (if (words.size > 1 && words[0] == "the") words.drop(1) else words).joinToString(" ")
    }

    /** "Dune (2021)" or "Dune [2021]": 2021; otherwise 0. */
    fun yearInTitle(name: String): Int = bracketYear.find(name)?.groupValues?.get(1)?.toInt() ?: 0

    /** "2021-05-01", "2021" or "2021.0": 2021; otherwise 0. */
    fun yearOf(value: String?): Int = value?.let { leadingYear.find(it)?.groupValues?.get(1)?.toInt() } ?: 0
}

/** TMDB titles of one type by id and by normalised title (and original title). */
class TmdbIndex(lists: TmdbLists) {
    private val byId = HashMap<Long, TmdbTitle>()
    private val byTitle = HashMap<String, MutableList<TmdbTitle>>()
    val size get() = byId.size

    init {
        lists.all.forEach { title ->
            if (title.id in byId) return@forEach
            byId[title.id] = title
            listOf(TitleMatch.normalize(title.title), TitleMatch.normalize(title.originalTitle)).distinct().forEach { key ->
                if (key.isNotEmpty()) byTitle.getOrPut(key) { ArrayList(1) }.add(title)
            }
        }
    }

    /**
     * 1. A provider TMDB id ([hint]) matches on the id alone. 2. Otherwise a normalised title must match and the years
     * may differ by 1; a title without a year matches only when exactly one TMDB title has that name.
     */
    fun match(hint: Long, keys: List<String>, year: Int): TmdbTitle? {
        if (hint > 0) return byId[hint]
        for (key in keys) {
            val candidates = byTitle[key] ?: continue
            if (year <= 0) {
                if (candidates.size == 1) return candidates[0]
                continue
            }
            candidates.firstOrNull { it.year == year }?.let { return it }
            candidates.firstOrNull { it.year > 0 && kotlin.math.abs(it.year - year) <= 1 }?.let { return it }
        }
        return null
    }
}

/**
 * "Movies & Series: USA only". A title is kept when its provider category passes (names carrying a non-US country or
 * language tag are excluded, everything else is kept) and, when it is matched to TMDB, its origin countries include
 * US. TMDB movie lists usually carry no countries; such a match is judged by its category alone. Requiring both, as
 * the Roku app does, also hides a dubbed copy of a US film that the provider files under "FR | Films".
 */
object VodRegion {
    private const val CODES = "FR|DE|IT|ES|LAT|MX|BR|PT|TR|AR|IN|HINDI|PK|NL|PL|RO|RU|UK|CA"
    /** Upper case only: "in", "it" and "es" are ordinary words. */
    private val code = Regex("(?<![A-Za-z0-9])(?:$CODES)(?![A-Za-z0-9])")
    /**
     * "IN" and "IT" are English words in all-caps names ("MOVIES IN 4K", "EN | IN THEATERS"), so they count only as a
     * tag: followed by a separator or at the end ("IN | Movies", "IT: Drama", "Movies | IN", "Films (IN)").
     */
    private val wordLike = setOf("IN", "IT")
    private const val SEPARATORS = "|:[]()-–/"
    private val written = Regex(
        "(?<![a-z])(?:french|france|german|germany|deutsch|italian|italiano|italia|italy|spanish|espanol|español|spain|castellano|" +
            "latino|latina|latam|mexico|mexican|brazil|brasil|brazilian|portuguese|portugal|turkish|turkey|arabic|india|indian|hindi|" +
            "bollywood|tamil|telugu|malayalam|punjabi|pakistan|pakistani|urdu|dutch|netherlands|polish|poland|polska|romanian|romania|" +
            "russian|russia|british|canada|canadian|quebec)(?![a-z])",
        RegexOption.IGNORE_CASE,
    )

    fun isForeignCategory(name: String?): Boolean {
        if (name.isNullOrBlank()) return false
        if (written.containsMatchIn(name)) return true
        return code.findAll(name).any { match ->
            if (match.value !in wordLike) return@any true
            val after = name.substring(match.range.last + 1).trimStart()
            after.isEmpty() || after.first() in SEPARATORS
        }
    }

    fun isUsTitle(categoryForeign: Boolean, tmdb: TmdbTitle?): Boolean =
        !categoryForeign && (tmdb == null || tmdb.origin.isEmpty() || "US" in tmdb.origin)
}

/** A Discover genre: a TMDB genre id, or a provider genre word when the server has no TMDB genres. */
data class GenreOption(val key: String, val name: String)

/**
 * Genres for one type. With TMDB genres, provider genre words and category names map onto them ("Sci-Fi" onto
 * Science Fiction). Without, the table is open: provider genre words become genres, and category names count only
 * when they are a common genre.
 */
internal class GenreTable(tmdb: List<TmdbGenre>) {
    private val open = tmdb.isEmpty()
    private val names = LinkedHashMap<String, String>()
    private val lookup = HashMap<String, String>()

    init {
        if (!open) tmdb.forEach { genre ->
            val key = genre.id.toString()
            names[key] = genre.name
            token(genre.name).takeIf { it.isNotEmpty() }?.let { lookup[it] = key }
            genre.name.split('&', '/', ',').forEach { part -> token(part).takeIf { it.isNotEmpty() && it !in lookup }?.let { lookup[it] = key } }
        }
    }

    fun tmdbKeys(ids: List<Int>): List<String> = ids.map { it.toString() }.filter { it in names }

    /** Provider genre text such as "Action, Drama / Sci-Fi". */
    fun providerKeys(text: String?): List<String> {
        if (text.isNullOrBlank()) return emptyList()
        val out = ArrayList<String>(3)
        text.split(',', '/', '|', '&', ';').forEach { part ->
            val token = token(part)
            if (token.isEmpty() || token.length > 30 || token.all { it.isDigit() || it == ' ' }) return@forEach
            val key = lookup[token] ?: if (open) {
                val name = VOCABULARY[token] ?: token.split(' ').joinToString(" ") { w -> w.replaceFirstChar { it.titlecase(Locale.ROOT) } }
                if (token !in names) names[token] = name
                lookup[token] = token
                token
            } else null
            if (key != null && key !in out) out += key
        }
        return out
    }

    /** A provider category named after a genre ("EN | Action Movies", "Kids & Family"). Unknown words are ignored. */
    fun categoryKeys(name: String?): List<String> {
        if (name.isNullOrBlank()) return emptyList()
        val out = ArrayList<String>(2)
        name.split(',', '/', '|', '&', ';', ':', '-', '–', '(', ')', '[', ']').forEach { part ->
            val token = token(part).split(' ').filter { it !in CATEGORY_NOISE }.joinToString(" ").let(::alias)
            if (token.isEmpty()) return@forEach
            val key = lookup[token] ?: if (open && token in VOCABULARY) {
                if (token !in names) names[token] = VOCABULARY.getValue(token)
                lookup[token] = token
                token
            } else null
            if (key != null && key !in out) out += key
        }
        return out
    }

    /** The genres at least one title has, TMDB's order (or by name for provider genres). */
    fun options(used: Set<String>): List<GenreOption> {
        val list = names.filterKeys { it in used }.map { (key, name) -> GenreOption(key, name) }
        return if (open) list.sortedBy { it.name.lowercase(Locale.ROOT) } else list
    }

    private fun token(text: String): String = alias(
        text.lowercase(Locale.ROOT).replace("&", " and ").replace(NON_WORD, " ").trim().replace(SPACES, " "),
    )

    private fun alias(token: String) = ALIASES[token] ?: token

    companion object {
        // Compiled once: token() runs for every genre word of every title without TMDB genres.
        private val NON_WORD = Regex("[^a-z0-9]+")
        private val SPACES = Regex(" +")
        private val ALIASES = mapOf(
            "sci fi" to "science fiction", "scifi" to "science fiction", "science fiction" to "science fiction",
            "documentaries" to "documentary", "docs" to "documentary", "docu" to "documentary", "comedies" to "comedy",
            "dramas" to "drama", "thrillers" to "thriller", "westerns" to "western", "animated" to "animation",
            "anime" to "animation", "cartoon" to "animation", "cartoons" to "animation", "children" to "kids",
            "childrens" to "kids", "kid" to "kids", "romantic" to "romance", "musical" to "music", "musicals" to "music",
            "suspense" to "thriller", "horrors" to "horror", "historical" to "history", "crimes" to "crime",
        )
        /** Common genres, for category names when there are no TMDB genres. */
        private val VOCABULARY = linkedMapOf(
            "action" to "Action", "adventure" to "Adventure", "animation" to "Animation", "comedy" to "Comedy",
            "crime" to "Crime", "documentary" to "Documentary", "drama" to "Drama", "family" to "Family",
            "fantasy" to "Fantasy", "history" to "History", "horror" to "Horror", "music" to "Music",
            "mystery" to "Mystery", "romance" to "Romance", "science fiction" to "Science Fiction", "thriller" to "Thriller",
            "war" to "War", "western" to "Western", "kids" to "Kids", "reality" to "Reality", "sports" to "Sports",
        )
        private val CATEGORY_NOISE = setOf(
            "movies", "movie", "films", "film", "series", "shows", "show", "tv", "vod", "4k", "uhd", "hd", "fhd", "en", "us",
            "usa", "english", "new", "top", "best", "all", "and",
        )
    }
}

/** One catalogue title with what browsing needs to know about it. [key] is "movie:<id>" or "series:<id>". */
class BrowseTitle internal constructor(
    val type: VodType,
    val key: String,
    val movie: Movie?,
    val series: Series?,
    /** The matched TMDB id, or 0. */
    val tmdbId: Long,
    /** Passes "Movies & Series: USA only". */
    val us: Boolean,
    private val genreKeys: Array<String>,
    val rating: Double,
) {
    val name: String get() = movie?.name ?: series?.name.orEmpty()
    val image: String? get() = movie?.poster ?: series?.cover
    val added: Long get() = movie?.added ?: series?.added ?: 0L
    val genres: List<String> get() = genreKeys.asList()
    fun hasGenre(key: String) = genreKeys.contains(key)

    /**
     * The keys of older uploads folded into this movie ([Movie.aliases]): Library favorites, Recently watched and saved
     * positions recorded under them still belong to this title.
     */
    val aliasKeys: List<String> get() = movie?.aliases?.map(::movieKey).orEmpty()

    /** In [saved] (Library favorites) under its own key or an older upload's. */
    fun savedIn(saved: Set<String>): Boolean = key in saved || (movie != null && movie.aliases.isNotEmpty() && aliasKeys.any { it in saved })

    companion object {
        fun movieKey(id: String) = "movie:$id"
        fun seriesKey(id: String) = "series:$id"
        fun typeOf(key: String) = if (key.startsWith("series:")) VodType.SERIES else VodType.MOVIES
    }
}

/** Everything one type (movies or series) browses, with every list as an ordered array of title indices. */
class BrowseSection internal constructor(
    val type: VodType,
    val titles: List<BrowseTitle>,
    private val lists: Map<String, IntArray>,
    val genres: List<GenreOption>,
    private val byKey: Map<String, Int>,
    private val byName: Map<String, Int>,
    /** Titles matched to TMDB. */
    val matched: Int,
    /** The copies of each TMDB title with more than one, best first: those that pass the USA filter, then the newest. */
    private val copies: Map<Long, IntArray> = emptyMap(),
) {
    operator fun get(key: String): BrowseTitle? = byKey[key]?.let(titles::get)
    internal fun byName(name: String): BrowseTitle? = byName[name]?.let(titles::get)
    fun hasList(list: String) = lists[list]?.isNotEmpty() == true

    /**
     * The visible titles of [list] in order, one per TMDB title, up to [limit]. A TMDB title takes the place of its
     * first visible copy in the list and shows its best visible copy (the US one, then the newest upload), whatever
     * the list's own order of copies is. [genre] is a [GenreOption.key] or null for all.
     */
    fun titles(list: String, usOnly: Boolean, genre: String? = null, limit: Int = Int.MAX_VALUE): List<BrowseTitle> {
        val order = lists[list] ?: return emptyList()
        val seen = HashSet<Any>()
        val out = ArrayList<BrowseTitle>(minOf(limit, order.size, 256))
        fun visible(title: BrowseTitle) = (!usOnly || title.us) && (genre == null || title.hasGenre(genre))
        for (index in order) {
            if (out.size >= limit) break
            val title = titles[index]
            if (!visible(title)) continue
            if (title.tmdbId <= 0) { if (seen.add(title.key)) out += title; continue }
            if (!seen.add(title.tmdbId)) continue
            out += copies[title.tmdbId]?.firstOrNull { visible(titles[it]) }?.let(titles::get) ?: title
        }
        return out
    }
}

data class HomeRow(val id: String, val title: String, val type: VodType, val list: String, val titles: List<BrowseTitle>)

/** A Continue watching entry: the title, and the saved position (a movie, or the episode to resume or play next). */
data class ContinueItem(val title: BrowseTitle, val recent: Recent) {
    val progress: Float get() = if (recent.durationMs > 0) (recent.positionMs.toFloat() / recent.durationMs).coerceIn(0f, 1f) else 0f
}

class BrowseCatalog internal constructor(val movies: BrowseSection, val series: BrowseSection, val tmdb: Boolean) {
    fun section(type: VodType) = if (type == VodType.MOVIES) movies else series
    operator fun get(key: String): BrowseTitle? = section(BrowseTitle.typeOf(key))[key]
    val isEmpty get() = movies.titles.isEmpty() && series.titles.isEmpty()

    fun listOptions(store: Boolean = Edition.STORE) = BrowseList.options(tmdb, store)

    /** Discover's List entries for [type], the ones without titles left out. */
    fun listOptions(type: VodType, store: Boolean = Edition.STORE): List<BrowseList.Option> =
        BrowseList.options(tmdb, store).filter { section(type).hasList(it.key) }

    /** The list Discover opens with: Popular with TMDB, else Recently added, else A–Z. */
    fun defaultList(type: VodType): String {
        val section = section(type)
        return listOf(BrowseList.POPULAR, BrowseList.RECENT, BrowseList.TOP_RATED).firstOrNull { (tmdb || it != BrowseList.POPULAR) && section.hasList(it) }
            ?: BrowseList.AZ
    }

    /** [list] when Discover may show it for [type] in this edition, else [defaultList]. */
    fun validList(type: VodType, list: String?, store: Boolean = Edition.STORE): String =
        list?.takeIf { key -> listOptions(type, store).any { it.key == key } } ?: defaultList(type)

    /** Home's rows after Continue watching, in the order of docs/browse.md. A row needs [minimum] titles. */
    fun homeRows(usOnly: Boolean, store: Boolean = Edition.STORE, limit: Int = ROW_LIMIT, minimum: Int = ROW_MINIMUM): List<HomeRow> =
        homeRowSpecs(tmdb, store).mapNotNull { (type, list) ->
            val titles = section(type).titles(list, usOnly, limit = limit)
            if (titles.size < minimum) null else HomeRow("${type.name.lowercase(Locale.ROOT)}:$list", rowTitle(type, list), type, list, titles)
        }

    /**
     * Movies in progress and the next episode of series in progress, newest first, one entry per title. A saved
     * movie position counts only for the same upload (or one of its backups); provider ids can collide. An episode
     * belongs to the series its entry names; entries saved before 1.7 carry only the series name.
     */
    fun continueWatching(recents: List<Recent>): List<ContinueItem> {
        val seen = HashSet<String>()
        return recents.mapNotNull { recent ->
            if (recent.url.isBlank()) return@mapNotNull null
            val title = if (recent.id.startsWith("e:")) {
                val key = recent.titleKey
                if (key != null) series[key]?.takeIf { BrowseTitle.typeOf(key) == VodType.SERIES } else series.byName(recent.title)
            } else {
                movies[BrowseTitle.movieKey(recent.id)]?.takeIf { title ->
                    val movie = title.movie!!
                    movie.url.isNotBlank() && (movie.url == recent.url || recent.url in movie.backups)
                }
            } ?: return@mapNotNull null
            if (!seen.add(title.key)) return@mapNotNull null
            ContinueItem(title, if (title.movie != null) recent.copy(title = title.name, image = title.image ?: recent.image, url = title.movie.url) else recent)
        }
    }

    /** Progress bar fractions by title key: a movie's position, or a series' latest episode in progress. */
    fun progressByKey(recents: List<Recent>): Map<String, Float> =
        continueWatching(recents).filter { !it.recent.nextUp && it.progress > 0f }.associate { it.title.key to it.progress }

    /** Library keys ("movie:…", "series:…") that are still in the catalogue, in the given order. */
    fun titlesFor(keys: List<String>, type: VodType? = null): List<BrowseTitle> =
        keys.asSequence().filter { type == null || BrowseTitle.typeOf(it) == type }.mapNotNull { this[it] }.distinctBy { it.key }.toList()

    companion object {
        const val ROW_LIMIT = 20
        const val ROW_MINIMUM = 5
        val EMPTY = build(emptyList(), emptyList(), emptyList(), emptyList(), CatalogRows.NONE)

        fun rowTitle(type: VodType, list: String) = "${BrowseList.name(list)} – ${type.label}"

        /** Home's list rows: Popular, Featured, each service (not in the store edition), Recently added, Top rated. */
        fun homeRowSpecs(tmdb: Boolean, store: Boolean = Edition.STORE): List<Pair<VodType, String>> = buildList {
            fun pair(list: String) { add(VodType.MOVIES to list); add(VodType.SERIES to list) }
            if (tmdb) { pair(BrowseList.POPULAR); pair(BrowseList.FEATURED) }
            StreamingServices.shown(store).forEach { pair(it.key) }
            pair(BrowseList.RECENT)
            pair(BrowseList.TOP_RATED)
        }

        /**
         * Builds every index once. Runs off the main thread: it normalises and matches every title. [cancelled] is
         * checked as it goes; when it turns true the build stops with a CancellationException.
         */
        fun build(movies: List<Movie>, movieCategories: List<Category>, series: List<Series>, seriesCategories: List<Category>,
                  rows: CatalogRows, cancelled: () -> Boolean = { false }): BrowseCatalog = BrowseCatalog(
            movieSection(movies, movieCategories, rows, cancelled),
            seriesSection(series, seriesCategories, rows, cancelled),
            rows.usesTmdb,
        )

        internal fun movieSection(movies: List<Movie>, categories: List<Category>, rows: CatalogRows, cancelled: () -> Boolean): BrowseSection =
            buildSection(VodType.MOVIES, movies.map { m ->
                Raw(BrowseTitle.movieKey(m.id), m, null, m.name, hint(m.tmdb), TitleMatch.yearOf(m.year).takeIf { it > 0 } ?: TitleMatch.yearInTitle(m.name),
                    m.genre, m.categoryIds, rating(m.rating), m.added)
            }, categories, rows.movie, rows.movieGenres, cancelled)

        internal fun seriesSection(series: List<Series>, categories: List<Category>, rows: CatalogRows, cancelled: () -> Boolean): BrowseSection =
            buildSection(VodType.SERIES, series.map { s ->
                Raw(BrowseTitle.seriesKey(s.id), null, s, s.name, hint(s.tmdb), TitleMatch.yearOf(s.year).takeIf { it > 0 } ?: TitleMatch.yearInTitle(s.name),
                    s.genre, s.categoryIds, rating(s.rating), s.added)
            }, categories, rows.tv, rows.tvGenres, cancelled)

        private fun hint(value: String?) = value?.trim()?.toLongOrNull()?.takeIf { it > 0 } ?: 0L
        private fun rating(value: String?): Double {
            val r = value?.trim()?.toDoubleOrNull()?.takeIf { it.isFinite() && it > 0 } ?: return 0.0
            // Some panels rate out of 100.
            return if (r > 10) r / 10 else r
        }

        private class Raw(val key: String, val movie: Movie?, val series: Series?, val name: String, val hint: Long, val year: Int,
                          val genre: String?, val categoryIds: List<String>, val rating: Double, val added: Long)
        private class CategoryFacts(val foreign: Boolean, val services: List<String>, val genres: List<String>)

        private fun buildSection(type: VodType, raws: List<Raw>, categories: List<Category>, lists: TmdbLists, tmdbGenres: List<TmdbGenre>,
                                 cancelled: () -> Boolean): BrowseSection {
            fun check() { if (cancelled()) throw java.util.concurrent.CancellationException("A newer library replaced this one") }
            check()
            val index = TmdbIndex(lists)
            val genreTable = GenreTable(tmdbGenres)
            val facts = HashMap<String, CategoryFacts>(categories.size * 2)
            categories.forEach { c ->
                facts[c.id] = CategoryFacts(VodRegion.isForeignCategory(c.name),
                    StreamingServices.ALL.filter { it.matchesCategory(c.name) }.map { it.key }, genreTable.categoryKeys(c.name))
            }
            val titles = ArrayList<BrowseTitle>(raws.size)
            val sortKeys = arrayOfNulls<String>(raws.size)
            val byKey = HashMap<String, Int>(raws.size * 2)
            val byName = HashMap<String, Int>()
            val byTmdb = HashMap<Long, MutableList<Int>>()
            val byService = StreamingServices.ALL.associate { it.key to ArrayList<Int>() }
            val usedGenres = HashSet<String>()
            var matched = 0
            raws.forEachIndexed { i, raw ->
                if (i % 1024 == 1023) check()
                val keys = TitleMatch.keys(raw.name)
                val tmdb = if (index.size > 0) index.match(raw.hint, keys, raw.year) else null
                val known = raw.categoryIds.mapNotNull { facts[it] }
                // A title offered in at least one category that passes is not foreign; one without categories passes.
                val foreign = known.isNotEmpty() && known.all { it.foreign }
                var genres = tmdb?.let { genreTable.tmdbKeys(it.genres) }.orEmpty()
                if (genres.isEmpty()) genres = genreTable.providerKeys(raw.genre)
                if (genres.isEmpty()) genres = known.flatMap { it.genres }.distinct()
                usedGenres += genres
                if (tmdb != null) {
                    matched++
                    byTmdb.getOrPut(tmdb.id) { ArrayList(1) } += i
                }
                known.flatMap { it.services }.distinct().forEach { byService.getValue(it) += i }
                titles += BrowseTitle(type, raw.key, raw.movie, raw.series, tmdb?.id ?: 0L, VodRegion.isUsTitle(foreign, tmdb), genres.toTypedArray(), raw.rating)
                // HashMap.putIfAbsent needs API 24; the first copy of a key or name wins.
                if (raw.key !in byKey) byKey[raw.key] = i
                if (raw.name !in byName) byName[raw.name] = i
                sortKeys[i] = keys.firstOrNull() ?: raw.name.lowercase(Locale.ROOT)
            }
            // Older uploads folded into a movie (Cleanup.movies) still answer to their keys, unless another title has one.
            raws.forEachIndexed { i, raw ->
                raw.movie?.aliases?.forEach { alias -> val key = BrowseTitle.movieKey(alias); if (key !in byKey) byKey[key] = i }
            }
            check()
            // Copies of one TMDB title: those that pass the USA filter first, then the newest upload.
            byTmdb.values.forEach { group -> if (group.size > 1) group.sortWith(compareByDescending<Int> { titles[it].us }.thenByDescending { titles[it].added }) }
            fun tmdbOrder(list: List<TmdbTitle>): List<Int> = list.flatMap { byTmdb[it.id].orEmpty() }
            fun sorted(indices: Iterable<Int>, comparator: Comparator<Int>) = indices.sortedWith(comparator)
            val newest = compareByDescending<Int> { titles[it].added }.thenBy { it }
            val recent = sorted(titles.indices.filter { titles[it].added > 0 }, newest)
            val rated = sorted(titles.indices.filter { titles[it].rating > 0 }, compareByDescending<Int> { titles[it].rating }.thenByDescending { titles[it].added }.thenBy { it })
            val az = sorted(titles.indices, compareBy<Int> { sortKeys[it] }.thenBy { titles[it].name.lowercase(Locale.ROOT) }.thenBy { it })
            val result = HashMap<String, IntArray>()
            fun put(key: String, vararg parts: List<Int>) {
                val seen = HashSet<Int>()
                result[key] = parts.asSequence().flatten().filter { seen.add(it) }.toList().toIntArray()
            }
            put(BrowseList.POPULAR, tmdbOrder(lists.popular))
            put(BrowseList.FEATURED, tmdbOrder(lists.featured))
            // Without TMDB (or after its list), the provider's rating; recently added uses the provider's timestamps.
            put(BrowseList.TOP_RATED, tmdbOrder(lists.topRated), rated)
            put(BrowseList.RECENT, recent)
            put(BrowseList.AZ, az)
            // A service list is TMDB's (when the server has one), then the provider categories named after the service.
            StreamingServices.ALL.forEach { service ->
                put(service.key, tmdbOrder(lists.service(service.key)), sorted(byService.getValue(service.key), newest))
            }
            val copies = byTmdb.filterValues { it.size > 1 }.mapValues { it.value.toIntArray() }
            return BrowseSection(type, titles, result, genreTable.options(usedGenres), byKey, byName, matched, copies)
        }
    }
}

/**
 * Builds [BrowseCatalog]s for [tv.lumanest.tuner.data.Repo.browse], reusing a section whose inputs are the same
 * objects as last time: the movie and series snapshots, the network lists and a stale-list refresh each change only
 * some inputs, and a series-only change then leaves tens of thousands of movies alone. Thread-safe enough for one
 * builder at a time plus a cancelled one finishing: each memo is replaced whole, and only describes its own inputs.
 */
class BrowseBuilder {
    private class Memo(val items: List<*>, val categories: List<Category>, val lists: TmdbLists, val genres: List<TmdbGenre>, val section: BrowseSection) {
        fun matches(items: List<*>, categories: List<Category>, lists: TmdbLists, genres: List<TmdbGenre>) =
            this.items === items && this.categories === categories && this.lists === lists && this.genres === genres
    }

    @Volatile private var movies: Memo? = null
    @Volatile private var series: Memo? = null

    fun build(movies: List<Movie>, movieCategories: List<Category>, series: List<Series>, seriesCategories: List<Category>,
              rows: CatalogRows, cancelled: () -> Boolean = { false }): BrowseCatalog {
        val movieSection = this.movies?.takeIf { it.matches(movies, movieCategories, rows.movie, rows.movieGenres) }?.section
            ?: BrowseCatalog.movieSection(movies, movieCategories, rows, cancelled)
                .also { this.movies = Memo(movies, movieCategories, rows.movie, rows.movieGenres, it) }
        val seriesSection = this.series?.takeIf { it.matches(series, seriesCategories, rows.tv, rows.tvGenres) }?.section
            ?: BrowseCatalog.seriesSection(series, seriesCategories, rows, cancelled)
                .also { this.series = Memo(series, seriesCategories, rows.tv, rows.tvGenres, it) }
        return BrowseCatalog(movieSection, seriesSection, rows.usesTmdb)
    }

    /**
     * [build], except that a failure other than cancellation gives an empty catalogue (after [onError]): the screens
     * then show their empty or error state instead of "Preparing your library" forever.
     */
    fun buildOrEmpty(movies: List<Movie>, movieCategories: List<Category>, series: List<Series>, seriesCategories: List<Category>,
                     rows: CatalogRows, cancelled: () -> Boolean = { false }, onError: (Exception) -> Unit = {}): BrowseCatalog = try {
        build(movies, movieCategories, series, seriesCategories, rows, cancelled)
    } catch (e: java.util.concurrent.CancellationException) {
        throw e
    } catch (e: Exception) {
        onError(e)
        BrowseCatalog.EMPTY
    }
}

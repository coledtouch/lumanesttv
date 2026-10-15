package tv.lumanest.tuner.data

import android.content.Context
import kotlinx.coroutines.*
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withPermit
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.text.SimpleDateFormat
import java.util.*

data class CatalogCard(val title: AddonTitle, val episode: AddonEpisode? = null, val added: String = "") {
    val key: String get() = episode?.id ?: title.id
}
data class CatalogSection(val id: String, val name: String, val caption: String, val cards: List<CatalogCard> = emptyList(),
    val updated: Long = 0, val error: String? = null, val loading: Boolean = true, val stale: Boolean = false)

/** Discovery only. Playback URLs and addon credentials never reach these requests or this cache. */
object StreamingCatalog {
    const val TTL = 6 * 60 * 60 * 1000L
    private var cacheRoot: File? = null
    private val gate = Semaphore(4)
    private data class Provider(val id: String, val name: String, val names: Set<String>)
    private val providers = listOf(
        Provider("netflix", "Netflix", setOf("Netflix")),
        Provider("paramount", "Paramount+", setOf("Paramount Plus Premium", "Paramount Plus Essential", "Paramount Plus", "Paramount+")),
        Provider("amc", "AMC+", setOf("AMC+", "AMC Plus")),
        Provider("prime", "Prime Video", setOf("Amazon Prime Video")),
        Provider("disney", "Disney+", setOf("Disney Plus")),
        Provider("hbo", "HBO Max", setOf("HBO Max", "Max")),
        Provider("hulu", "Hulu", setOf("Hulu")),
        Provider("apple", "Apple TV+", setOf("Apple TV", "Apple TV Plus")),
        Provider("peacock", "Peacock", setOf("Peacock Premium", "Peacock Premium Plus")),
    )
    fun init(context: Context) { cacheRoot = File(context.cacheDir, "streaming-catalogs").apply { mkdirs() } }
    fun sections(series: Boolean): List<CatalogSection> = buildList {
        add(CatalogSection("new", if (series) "New Series" else "New Releases", if (series) "Recent series available to stream in the US" else "Recent films newly added to US streaming in the last 7 days"))
        if (series) add(CatalogSection("episodes", "New Episodes", "Episodes aired in the last 14 days, from recently added and popular US series"))
        add(CatalogSection("popular", "Popular Now", "US popularity on JustWatch"))
        providers.forEach { add(CatalogSection(it.id, "Top ${it.name}", "US subscription catalog, ordered by JustWatch popularity")) }
    }

    private const val CONTENT = "title originalReleaseYear shortDescription posterUrl runtime isReleased externalIds { imdbId } scoring { imdbScore }"
    private suspend fun query(query: String): JSONObject = gate.withPermit {
        val body = JSONObject().put("query", query).toString().toRequestBody("application/json".toMediaType())
        val root = JSONObject(Torrentio.fetch(Request.Builder().url("https://apis.justwatch.com/graphql").post(body).build()))
        require(root.optJSONArray("errors") == null && !root.isNull("data")) { "Catalog source returned an error." }
        root.getJSONObject("data")
    }

    fun parseTitles(text: String, field: String = "popularTitles", added: String = ""): List<CatalogCard> {
        val root = JSONObject(text)
        require(root.optJSONArray("errors") == null) { "Catalog source returned an error." }
        val data = root.optJSONObject("data") ?: root
        val rows = data.optJSONObject(field)?.optJSONArray("edges") ?: error("Catalog source returned no list.")
        return (0 until rows.length()).mapNotNull { i ->
            val node = rows.optJSONObject(i)?.optJSONObject("node") ?: return@mapNotNull null
            val content = node.optJSONObject("show")?.optJSONObject("content") ?: node.optJSONObject("content") ?: return@mapNotNull null
            if (content.has("isReleased") && !content.isNull("isReleased") && !content.optBoolean("isReleased")) return@mapNotNull null
            val id = content.optJSONObject("externalIds")?.optString("imdbId").orEmpty()
            if (!Regex("tt[0-9]+").matches(id)) return@mapNotNull null
            val path = content.optString("posterUrl")
            val poster = path.takeIf { it.startsWith("/poster/") }?.let { "https://images.justwatch.com${it.replace("{profile}", "s332").replace("{format}", "jpg")}" }
            fun text(key: String) = content.optString(key).takeUnless { it == "null" }.orEmpty()
            val rating = content.optJSONObject("scoring")?.optString("imdbScore")?.takeUnless { it == "null" }.orEmpty()
            CatalogCard(AddonTitle(id, text("title"), text("originalReleaseYear"), poster = poster, description = text("shortDescription"),
                rating = rating, runtime = content.optInt("runtime").takeIf { it > 0 }?.let { "$it min" }.orEmpty()), added = added)
        }.distinctBy { it.key }
    }

    private suspend fun popular(series: Boolean, packages: List<String> = emptyList(), recent: Boolean = false): List<CatalogCard> {
        val year = Calendar.getInstance().get(Calendar.YEAR)
        val filter = JSONObject().put("objectTypes", JSONArray(listOf(if (series) "SHOW" else "MOVIE")))
            .put("monetizationTypes", JSONArray(listOf("FLATRATE")))
        if (packages.isNotEmpty()) filter.put("packages", JSONArray(packages))
        if (recent) filter.put("releaseYear", JSONObject().put("min", year - 1).put("max", year))
        // GraphQL input uses enum object/monetization types; variables preserve their JSON encoding.
        val q = "query(\$filter: TitleFilter) { popularTitles(country: US, first: 50, sortBy: ${if (recent) "RELEASE_YEAR" else "POPULAR"}, filter: \$filter) { edges { node { content(country: US, language: en) { $CONTENT } } } } }"
        val body = JSONObject().put("query", q).put("variables", JSONObject().put("filter", filter)).toString().toRequestBody("application/json".toMediaType())
        return gate.withPermit { parseTitles(Torrentio.fetch(Request.Builder().url("https://apis.justwatch.com/graphql").post(body).build())).take(30) }
    }

    private fun date(value: Date) = SimpleDateFormat("yyyy-MM-dd", Locale.US).apply { timeZone = TimeZone.getTimeZone("America/New_York") }.format(value)
    private suspend fun additions(series: Boolean): List<CatalogCard> = coroutineScope {
        val year = Calendar.getInstance().get(Calendar.YEAR)
        (0..6).map { day -> async {
            val whenAdded = date(Date(System.currentTimeMillis() - day * 86_400_000L))
            val content = if (series) "... on Season { show { content(country: US, language: en) { $CONTENT } } }" else "... on Movie { content(country: US, language: en) { $CONTENT } }"
            val filter = "objectTypes: [${if (series) "SHOW" else "MOVIE"}], monetizationTypes: [FLATRATE]" + if (series) "" else ", releaseYear: { min: ${year-1}, max: $year }"
            parseTitles(query("query { newTitles(country: US, date: \"$whenAdded\", first: 60, filter: { $filter }) { edges { node { $content } } } }").toString(), "newTitles", whenAdded)
        } }.awaitAll().flatten().distinctBy { it.key }
    }

    fun parseRecentEpisodes(text: String, seeds: List<CatalogCard>, now: Long): List<CatalogCard> {
        val byId = seeds.associateBy { it.title.id }
        val root = JSONObject(text)
        val rows = root.optJSONArray("metasDetailed") ?: error("Episode source returned no list.")
        val cards = mutableListOf<Pair<Long, CatalogCard>>()
        for (i in 0 until rows.length()) {
            val meta = rows.optJSONObject(i) ?: continue
            val seed = byId[meta.optString("imdb_id")] ?: continue
            val videos = meta.optJSONArray("videos") ?: continue
            val episodes = Torrentio.parseEpisodes(JSONObject().put("meta", JSONObject().put("videos", videos)).toString())
            for (episode in episodes) {
                val released = parseDate(episode.released) ?: continue
                if (released <= now && released >= now - 14 * 86_400_000L) cards += released to CatalogCard(seed.title, episode, episode.released.take(10))
            }
        }
        return cards.sortedByDescending { it.first }.map { it.second }.distinctBy { it.key }.take(40)
    }
    private fun parseDate(value: String): Long? {
        for (pattern in listOf("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", "yyyy-MM-dd'T'HH:mm:ss'Z'", "yyyy-MM-dd")) {
            if (value.isBlank() || value == "null") return null
            runCatching { SimpleDateFormat(pattern, Locale.US).apply { isLenient = false; timeZone = TimeZone.getTimeZone("UTC") }.parse(value)?.time }.getOrNull()?.let { return it }
        }
        return null
    }
    private suspend fun recentEpisodes(seeds: List<CatalogCard>): List<CatalogCard> = coroutineScope {
        seeds.distinctBy { it.title.id }.take(200).chunked(100).map { chunk -> async {
            val ids = chunk.joinToString(",") { it.title.id }
            val text = gate.withPermit { Torrentio.fetch(Request.Builder().url("https://v3-cinemeta.strem.io/catalog/series/last-videos/lastVideosIds=$ids.json").build()) }
            parseRecentEpisodes(text, chunk, System.currentTimeMillis())
        } }.awaitAll().flatten().distinctBy { it.key }.sortedByDescending { it.episode?.released }.take(40)
    }

    private fun file(series: Boolean, id: String) = cacheRoot?.let { File(it, "${if (series) "series" else "movie"}-$id.json") }
    private fun decode(section: CatalogSection, text: String): CatalogSection {
        val root = JSONObject(text)
        val list = root.getJSONArray("cards")
        val cards = (0 until list.length()).mapNotNull { i ->
            val row = list.getJSONObject(i)
            val title = Torrentio.parseTitles(JSONObject().put("metas", JSONArray().put(row.getJSONObject("title"))).toString()).firstOrNull() ?: return@mapNotNull null
            val ep = row.optJSONObject("episode")?.let { AddonEpisode(it.getString("id"), it.getInt("season"), it.getInt("episode"), it.getString("title"), it.optString("released")) }
            CatalogCard(title, ep, row.optString("added"))
        }
        return section.copy(cards = cards, updated = root.getLong("updated"), loading = false)
    }
    private fun save(series: Boolean, section: CatalogSection) {
        val target = file(series, section.id) ?: return
        val cards = JSONArray(section.cards.map { card ->
            val title = card.title
            JSONObject().put("title", JSONObject().put("id", title.id).put("name", title.name).put("releaseInfo", title.year)
                .put("poster", title.poster).put("description", title.description).put("imdbRating", title.rating).put("runtime", title.runtime))
                .put("added", card.added).apply { card.episode?.let { ep -> put("episode", JSONObject().put("id", ep.id).put("title", ep.title).put("season", ep.season).put("episode", ep.episode).put("released", ep.released)) } }
        })
        val temporary = File(target.parentFile, "${target.name}.tmp")
        temporary.writeText(JSONObject().put("updated", section.updated).put("cards", cards).toString())
        if (!temporary.renameTo(target)) temporary.delete()
    }

    suspend fun load(series: Boolean, force: Boolean = false, onSection: (CatalogSection) -> Unit) = withContext(Dispatchers.IO) {
        val definitions = sections(series)
        suspend fun publish(section: CatalogSection) = withContext(Dispatchers.Main) { onSection(section) }
        val saved = definitions.associate { section -> section.id to runCatching { file(series, section.id)?.takeIf(File::isFile)?.readText()?.let { decode(section, it) } }.getOrNull() }
        saved.values.filterNotNull().forEach { publish(it.copy(stale = System.currentTimeMillis() - it.updated >= TTL, loading = false)) }
        if (!force && saved.values.all { it != null && System.currentTimeMillis() - it.updated in 0 until TTL }) return@withContext
        val packageRows = try { query("query { packages(country: US, platform: WEB) { shortName clearName } }").getJSONArray("packages") }
            catch (e: CancellationException) { throw e }
            catch (e: Exception) { null }
        suspend fun section(id: String, work: suspend () -> List<CatalogCard>): CatalogSection {
            val def = definitions.first { it.id == id }
            val old = saved[id]
            if (!force && old != null && System.currentTimeMillis() - old.updated < TTL) return old
            return try {
                def.copy(cards = work(), updated = System.currentTimeMillis(), loading = false).also { runCatching { save(series, it) }; publish(it) }
            } catch (e: CancellationException) { throw e }
            catch (e: Exception) { (old ?: def).copy(loading = false, stale = old != null, error = "Could not refresh this catalog. Select Refresh to retry.").also { publish(it) } }
        }
        coroutineScope {
            val popular = async { section("popular") { popular(series) } }
            val recent = async { section("new") { if (series) popular(true, recent = true) else additions(false).take(40) } }
            val providerTasks = providers.map { provider -> async {
                section(provider.id) {
                    require(packageRows != null) { "Provider list unavailable." }
                    val codes = (0 until packageRows.length()).mapNotNull { i -> packageRows.getJSONObject(i).takeIf { it.optString("clearName") in provider.names }?.getString("shortName") }
                    require(codes.isNotEmpty()) { "Provider unavailable in US." }
                    popular(series, codes)
                }
            } }
            if (series) section("episodes") {
                val added = additions(true)
                val ranked = providerTasks.awaitAll().flatMap { it.cards.take(12) } + popular.await().cards
                recentEpisodes(added + ranked)
            }
            popular.await(); recent.await(); providerTasks.awaitAll()
        }
    }
}

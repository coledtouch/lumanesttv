package tv.lumanest.tuner.data

import android.content.Context
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withPermit
import kotlinx.coroutines.supervisorScope
import kotlinx.coroutines.withContext
import kotlinx.coroutines.ensureActive
import kotlin.coroutines.coroutineContext
import java.io.File
import java.text.SimpleDateFormat
import java.util.Collections
import java.util.Date
import java.util.Locale
import java.util.concurrent.ConcurrentHashMap

sealed interface LoadStatus {
    data object Idle : LoadStatus
    data class Loading(val message: String) : LoadStatus
    data object Ready : LoadStatus
    data class Error(val message: String) : LoadStatus
}

/** Single source of truth for the active playlist: channels, VOD, series and guide data. */
object Repo {
    lateinit var prefs: Prefs
        private set
    private lateinit var cacheRoot: File
    private lateinit var snapshots: CatalogSnapshots
    private lateinit var snapshotRoot: File
    // Local disk writes and explicit removal share this lock; UI publication uses the Repo monitor.
    private val snapshotWriteLock = Any()
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private var job: Job? = null
    @Volatile private var generation = 0L
    @Volatile private var catalogueIdentity: CatalogSnapshots.Identity? = null
    private val startupPhases = ConcurrentHashMap<String, String>()
    /** Native benchmark output contains no account identifiers, names, URLs or credentials. */
    fun snapshotDiagnostics(): String = (snapshots.readDiagnostics + startupPhases).toSortedMap().entries.joinToString { "${it.key}=${it.value}" }
    private data class LoadRequest(val source: Source, val identity: CatalogSnapshots.Identity,
        val format: String, val zip: String, val generation: Long, val force: Boolean, val usOnly: Boolean = false)

    val liveCategories = MutableStateFlow<List<Category>>(emptyList())
    val channels = MutableStateFlow<List<Channel>>(emptyList())
    val movieCategories = MutableStateFlow<List<Category>>(emptyList())
    val movies = MutableStateFlow<List<Movie>>(emptyList())
    val seriesCategories = MutableStateFlow<List<Category>>(emptyList())
    val series = MutableStateFlow<List<Series>>(emptyList())

    /** Channels from the source's optional "trending" playlist, in the provider's order. */
    val trending = MutableStateFlow<List<Channel>>(emptyList())

    val liveStatus = MutableStateFlow<LoadStatus>(LoadStatus.Idle)
    val vodStatus = MutableStateFlow<LoadStatus>(LoadStatus.Idle)
    val seriesStatus = MutableStateFlow<LoadStatus>(LoadStatus.Idle)
    val epgStatus = MutableStateFlow<LoadStatus>(LoadStatus.Idle)

    /** Guide data keyed by [Channel.key]. Bump [epgVersion] whenever it changes so the UI redraws. */
    private val epg = ConcurrentHashMap<String, List<Program>>()
    private val _epgVersion = MutableStateFlow(0)
    val epgVersion: StateFlow<Int> = _epgVersion
    private val shortEpgTried: MutableSet<String> = Collections.newSetFromMap(ConcurrentHashMap())
    private val shortEpgGate = Semaphore(4)

    private val movieInfoCache = ConcurrentHashMap<String, MovieInfo>()
    private val seriesInfoCache = ConcurrentHashMap<String, SeriesInfo>()

    val activeSource: Source?
        get() = prefs.sources.value.firstOrNull { it.id == prefs.activeId.value }
    val userAgent: String get() = activeSource?.userAgent?.ifBlank { null } ?: DEFAULT_UA

    fun init(context: Context) {
        if (::prefs.isInitialized) return
        prefs = Prefs(context)
        cacheRoot = File(context.cacheDir, "sources")
        snapshotRoot = File(context.filesDir, "catalogues")
        snapshots = CatalogSnapshots(snapshotRoot)
        // Older versions had a torrent player: drop its saved addon link (it may hold a debrid key) and caches.
        context.getSharedPreferences("torrentio", Context.MODE_PRIVATE).takeIf { it.all.isNotEmpty() }?.edit()?.clear()?.apply()
        val stale = listOf("torrent-playback", "streaming-catalogs").map { File(context.cacheDir, it) }.filter { it.exists() }
        if (stale.isNotEmpty()) scope.launch(Dispatchers.IO) { stale.forEach { it.deleteRecursively() } }
        if (prefs.activeId.value == null) prefs.sources.value.firstOrNull()?.let { prefs.setActive(it.id) }
    }

    fun programsFor(c: Channel): List<Program>? = epg[c.key]

    /** Test hook: inject guide data without a network round trip. */
    fun putPrograms(data: Map<String, List<Program>>) { epg.putAll(data); _epgVersion.value++ }

    // ------------------------------------------------------------------ loading

    @Synchronized fun load(force: Boolean = false) {
        val previous = job
        previous?.cancel()
        val src = activeSource
        val format = prefs.liveFormat
        val zip = prefs.localZip.value
        val usOnly = prefs.usOnly.value
        val identity = src?.let { CatalogSnapshots.identity(it, format, zip, usOnly) }
        generation++
        startupPhases.clear(); snapshots.readDiagnostics.clear()
        // A refresh keeps the usable lineup. An account/format/market change cannot expose it.
        if (identity != catalogueIdentity || src == null) clear()
        else {
            shortEpgTried.clear(); movieInfoCache.clear(); seriesInfoCache.clear()
            val now = System.currentTimeMillis()
            epg.entries.removeAll { (_, programs) -> programs.none { it.end > now } }
            _epgVersion.value++
        }
        catalogueIdentity = identity
        if (src == null || identity == null) { job = null; return }
        val request = LoadRequest(src, identity, format, zip, generation, force, usOnly)
        job = scope.launch {
            if (!current(request)) return@launch
            val dir = withContext(Dispatchers.IO) {
                runCatching { sourceCacheDirectory(request) }.getOrElse { File(cacheRoot, request.identity.source).apply { mkdirs() } }
            }
            when (src.type) {
                SourceType.XTREAM -> loadXtream(request, dir)
                SourceType.M3U -> loadM3u(request, dir)
            }
        }
    }

    private fun clear() {
        liveCategories.value = emptyList(); channels.value = emptyList(); trending.value = emptyList(); merged = emptyMap()
        movieCategories.value = emptyList(); movies.value = emptyList()
        seriesCategories.value = emptyList(); series.value = emptyList()
        epg.clear(); epgIcons.clear(); shortEpgTried.clear(); movieInfoCache.clear(); seriesInfoCache.clear()
        deadNow.clear()
        _epgVersion.value++
        liveStatus.value = LoadStatus.Idle; vodStatus.value = LoadStatus.Idle
        seriesStatus.value = LoadStatus.Idle; epgStatus.value = LoadStatus.Idle
    }

    private const val LIST_AGE = 12 * 3600_000L
    // Event channels are renamed through the day as games get scheduled, so the live list is refreshed more often.
    private const val LIVE_AGE = 2 * 3600_000L
    private const val EPG_AGE = 6 * 3600_000L
    private const val FREE_EPG_AGE = 12 * 3600_000L
    private const val TRENDING_AGE = 20 * 60_000L
    private const val LOGOS_URL = "https://iptv-org.github.io/api/logos.json"

    private fun current(request: LoadRequest) = generation == request.generation && activeSource == request.source &&
        prefs.liveFormat == request.format && prefs.localZip.value == request.zip && prefs.usOnly.value == request.usOnly

    private inline fun commit(request: LoadRequest, action: () -> Unit) = synchronized(this) {
        if (current(request)) action()
    }

    /** Bind an upgrade's old cache once; normal credential edits already forced its deletion. */
    private fun sourceCacheDirectory(request: LoadRequest): File {
        val dir = File(cacheRoot, request.identity.source).apply { mkdirs() }
        val legacy = File(cacheRoot, request.source.id)
        if (legacy.canonicalFile.parentFile != cacheRoot.canonicalFile || !legacy.isDirectory) return dir
        val binding = File(legacy, "catalogue-identity")
        if (request.force) {
            legacy.listFiles()?.filter { it.isFile }?.forEach { it.delete() }
            return dir
        }
        val bound = binding.takeIf { it.isFile }?.readText()?.trim()
        if (bound != null && bound != request.identity.source) return dir
        binding.writeText(request.identity.source)
        listOf("live.json", "live_cats.json", "vod.json", "vod_cats.json", "series.json", "series_cats.json", "playlist.m3u", "trending.m3u", "epg.xml").forEach { name ->
            val old = File(legacy, name); val target = File(dir, name)
            if (old.isFile && old.length() > 0 && !target.exists()) {
                old.copyTo(target); target.setLastModified(old.lastModified())
            }
        }
        return dir
    }

    private fun cachedFile(file: File) = file.takeIf { it.isFile && it.length() > 0 }
    private fun storedAt(vararg files: File) = files.minOf { it.lastModified() }.coerceAtLeast(1)
    private fun fresh(at: Long, age: Long) = System.currentTimeMillis() - at < age
    private fun saveSnapshot(request: LoadRequest, write: () -> Unit) {
        synchronized(snapshotWriteLock) {
            // A writer may have waited for another file operation after its coroutine was cancelled.
            if (current(request)) runCatching(write) // Disk exhaustion must not hide a usable catalogue.
        }
    }

    private fun restoreLive(request: LoadRequest, live: CatalogSnapshots.Live) {
        startupPhases["livePublish"] = "preparing"
        val hidden = prefs.deadChannels()
        val visible = live.channels.filterNot { it.key in hidden }
        val used = visible.flatMapTo(HashSet()) { it.categoryIds }
        commit(request) {
            startupPhases["livePublish"] = "remapping"
            val started = System.nanoTime()
            prefs.remapChannelKeys(live.merged, request.source.id)
            if (!current(request)) { startupPhases["livePublish"] = "discarded"; return@commit }
            deadNow.clear(); deadNow.addAll(hidden)
            merged = live.merged
            startupPhases["liveRemapMs"] = ((System.nanoTime() - started) / 1_000_000).toString()
            liveCategories.value = live.categories.filter { it.id in used }
            channels.value = visible
            liveStatus.value = LoadStatus.Ready
            startupPhases["livePublish"] = "ready"
        }
    }

    /** Current/next listings restore after channels, without delaying the usable guide lineup. */
    private fun restoreGuide(request: LoadRequest): Long? {
        val cached = snapshots.readGuide(request.identity) ?: return null
        val wanted = channels.value.mapTo(HashSet()) { it.key }
        commit(request) {
            epg.putAll(cached.value.programs.filterKeys { it in wanted && !hasGuide(it) })
            epgIcons.putAll(cached.value.icons.filterKeys { it in wanted })
            if (epg.isNotEmpty()) { _epgVersion.value++; _logoVersion.value++; epgStatus.value = LoadStatus.Ready }
        }
        return cached.storedAt
    }

    private suspend fun loadXtream(request: LoadRequest, dir: File) = withContext(Dispatchers.IO) { supervisorScope {
        val src = request.source
        val x = Xtream(src)
        val ua = src.userAgent
        val liveAvailable = CompletableDeferred<Unit>()
        val liveCacheAttempted = CompletableDeferred<Unit>()
        val live = launch {
            try {
                // Decode the interactive lineup first. Large library allocations can delay it by seconds.
                val cached = try {
                    snapshots.readLive(request.identity).also { value ->
                        value?.let { restoreLive(request, it.value); liveAvailable.complete(Unit) }
                    }
                } finally { liveCacheAttempted.complete(Unit) }
                if (cached != null && cached.fresh(LIVE_AGE) && !request.force) return@launch
                commit(request) { liveStatus.value = LoadStatus.Loading(if (channels.value.isEmpty()) "Loading channels…" else "Refreshing channels…") }
                val listFile = File(dir, "live.json"); val categoriesFile = File(dir, "live_cats.json")
                var availableAt = cached?.storedAt
                if (cached == null && !request.force && cachedFile(listFile) != null && cachedFile(categoriesFile) != null) {
                    publishLive(ContentPolicy.live(x.parseLive(listFile, request.format), x.parseCategories(categoriesFile), request.usOnly), request, storedAt(listFile, categoriesFile))
                    liveAvailable.complete(Unit)
                    availableAt = storedAt(listFile, categoriesFile)
                    if (fresh(storedAt(listFile, categoriesFile), LIVE_AGE)) return@launch
                }
                supervisorScope {
                    val before = listFile.lastModified() to categoriesFile.lastModified()
                    val catsF = async { Net.download(x.api("get_live_categories"), ua, categoriesFile, LIVE_AGE, request.force) }
                    val listF = async { Net.download(x.api("get_live_streams"), ua, listFile, LIVE_AGE, request.force) }
                    val cats = catsF.await(); val list = listF.await()
                    coroutineContext.ensureActive()
                    if (storedAt(list, cats) != availableAt || before != (list.lastModified() to cats.lastModified()))
                        publishLive(ContentPolicy.live(x.parseLive(list, request.format), x.parseCategories(cats), request.usOnly), request, storedAt(list, cats))
                    liveAvailable.complete(Unit)
                }
                commit(request) { liveStatus.value = LoadStatus.Ready }
            } catch (e: kotlinx.coroutines.CancellationException) { throw e }
            catch (e: Exception) { commit(request) { liveStatus.value = LoadStatus.Error(friendly(e)) } }
            finally { liveCacheAttempted.complete(Unit); liveAvailable.complete(Unit) }
        }

        launch { liveAvailable.await(); if (current(request)) loadLogoIndex() }
        launch { liveAvailable.await(); if (current(request)) loadTrending(request, dir) }
        launch { liveAvailable.await(); if (current(request) && channels.value.isNotEmpty()) {
            restoreGuide(request)
            live.join()
            if (!current(request)) return@launch
            // The bounded startup guide is immediately useful; hydrate the full three-day guide separately.
            loadGuides(src.epgUrl.ifBlank { x.xmltv() }, ua, dir, request)
        } }

        launch {
            liveCacheAttempted.await()
            try {
                val cached = snapshots.readMovies(request.identity)
                cached?.let {
                    startupPhases["moviePublish"] = "waiting"
                    commit(request) { movieCategories.value = it.value.categories; movies.value = it.value.items; vodStatus.value = LoadStatus.Ready; startupPhases["moviePublish"] = "ready" }
                }
                if (cached != null && cached.fresh(LIST_AGE) && !request.force) return@launch
                commit(request) { vodStatus.value = LoadStatus.Loading(if (movies.value.isEmpty()) "Loading movies…" else "Refreshing movies…") }
                val listFile = File(dir, "vod.json"); val categoriesFile = File(dir, "vod_cats.json")
                fun publish(list: File, categories: File) {
                    if (!current(request)) return
                    val catalogue = ContentPolicy.movies(x.parseMovies(list), x.parseCategories(categories))
                    val cleaned = Cleanup.movies(catalogue.items)
                    commit(request) { movieCategories.value = catalogue.categories; movies.value = cleaned; vodStatus.value = LoadStatus.Ready }
                    saveSnapshot(request) { snapshots.writeMovies(request.identity, ContentPolicy.Catalogue(cleaned, catalogue.categories), storedAt(list, categories)) }
                }
                var availableAt = cached?.storedAt
                if (cached == null && !request.force && cachedFile(listFile) != null && cachedFile(categoriesFile) != null) {
                    publish(listFile, categoriesFile)
                    availableAt = storedAt(listFile, categoriesFile)
                    if (fresh(storedAt(listFile, categoriesFile), LIST_AGE)) return@launch
                }
                supervisorScope {
                    val before = listFile.lastModified() to categoriesFile.lastModified()
                    val c = async { Net.download(x.api("get_vod_categories"), ua, categoriesFile, LIST_AGE, request.force) }
                    val l = async { Net.download(x.api("get_vod_streams"), ua, listFile, LIST_AGE, request.force) }
                    val list = l.await(); val categories = c.await()
                    coroutineContext.ensureActive()
                    if (storedAt(list, categories) != availableAt || before != (list.lastModified() to categories.lastModified())) publish(list, categories)
                }
                commit(request) { vodStatus.value = LoadStatus.Ready }
            } catch (e: kotlinx.coroutines.CancellationException) { throw e }
            catch (e: Exception) { commit(request) { vodStatus.value = LoadStatus.Error(friendly(e)) } }
        }

        launch {
            liveCacheAttempted.await()
            try {
                val cached = snapshots.readSeries(request.identity)
                cached?.let { commit(request) { seriesCategories.value = it.value.categories; series.value = it.value.items; seriesStatus.value = LoadStatus.Ready } }
                if (cached != null && cached.fresh(LIST_AGE) && !request.force) return@launch
                commit(request) { seriesStatus.value = LoadStatus.Loading(if (series.value.isEmpty()) "Loading series…" else "Refreshing series…") }
                val listFile = File(dir, "series.json"); val categoriesFile = File(dir, "series_cats.json")
                fun publish(list: File, categories: File) {
                    if (!current(request)) return
                    val catalogue = ContentPolicy.series(x.parseSeries(list), x.parseCategories(categories))
                    commit(request) { seriesCategories.value = catalogue.categories; series.value = catalogue.items; seriesStatus.value = LoadStatus.Ready }
                    saveSnapshot(request) { snapshots.writeSeries(request.identity, catalogue, storedAt(list, categories)) }
                }
                var availableAt = cached?.storedAt
                if (cached == null && !request.force && cachedFile(listFile) != null && cachedFile(categoriesFile) != null) {
                    publish(listFile, categoriesFile)
                    availableAt = storedAt(listFile, categoriesFile)
                    if (fresh(storedAt(listFile, categoriesFile), LIST_AGE)) return@launch
                }
                supervisorScope {
                    val before = listFile.lastModified() to categoriesFile.lastModified()
                    val c = async { Net.download(x.api("get_series_categories"), ua, categoriesFile, LIST_AGE, request.force) }
                    val l = async { Net.download(x.api("get_series"), ua, listFile, LIST_AGE, request.force) }
                    val list = l.await(); val categories = c.await()
                    coroutineContext.ensureActive()
                    if (storedAt(list, categories) != availableAt || before != (list.lastModified() to categories.lastModified())) publish(list, categories)
                }
                commit(request) { seriesStatus.value = LoadStatus.Ready }
            } catch (e: kotlinx.coroutines.CancellationException) { throw e }
            catch (e: Exception) { commit(request) { seriesStatus.value = LoadStatus.Error(friendly(e)) } }
        }
    } }

    private suspend fun loadM3u(request: LoadRequest, dir: File) = withContext(Dispatchers.IO) { supervisorScope {
        val src = request.source
        commit(request) { seriesStatus.value = LoadStatus.Ready }
        val liveAvailable = CompletableDeferred<Unit>()
        val discoveredGuide = File(dir, "playlist-epg-url")
        var epgUrl = src.epgUrl.ifBlank { runCatching { discoveredGuide.readText() }.getOrDefault("") }
        val live = launch {
            try {
                val cachedLive = snapshots.readLive(request.identity)
                cachedLive?.let { restoreLive(request, it.value); liveAvailable.complete(Unit) }
                val cachedMovies = snapshots.readMovies(request.identity)
                cachedMovies?.let { commit(request) { movieCategories.value = it.value.categories; movies.value = it.value.items; vodStatus.value = LoadStatus.Ready } }
                if (cachedLive != null && cachedLive.fresh(LIVE_AGE) && cachedMovies != null && cachedMovies.fresh(LIST_AGE) && !request.force) return@launch
                val playlistFile = File(dir, "playlist.m3u")
                fun publish(file: File) {
                    if (!current(request)) return
                    val r = M3u.parse(file)
                    publishLive(ContentPolicy.live(r.channels, r.liveCategories, request.usOnly), request, file.lastModified())
                    liveAvailable.complete(Unit)
                    val vod = ContentPolicy.movies(r.movies, r.movieCategories)
                    val cleaned = Cleanup.movies(vod.items)
                    commit(request) { movieCategories.value = vod.categories; movies.value = cleaned; vodStatus.value = LoadStatus.Ready }
                    saveSnapshot(request) { snapshots.writeMovies(request.identity, ContentPolicy.Catalogue(cleaned, vod.categories), file.lastModified()) }
                    epgUrl = src.epgUrl.ifBlank { r.epgUrl ?: "" }
                    saveSnapshot(request) { discoveredGuide.writeText(epgUrl) }
                }
                var availableAt = if (cachedLive?.storedAt == cachedMovies?.storedAt) cachedLive?.storedAt else null
                if ((cachedLive == null || cachedMovies == null) && !request.force && cachedFile(playlistFile) != null) {
                    publish(playlistFile)
                    availableAt = playlistFile.lastModified()
                    if (fresh(playlistFile.lastModified(), LIVE_AGE)) return@launch
                }
                commit(request) {
                    liveStatus.value = LoadStatus.Loading(if (channels.value.isEmpty()) "Loading playlist…" else "Refreshing playlist…")
                    vodStatus.value = LoadStatus.Loading(if (movies.value.isEmpty()) "Loading playlist…" else "Refreshing playlist…")
                }
                val file = Net.download(src.m3uUrl, src.userAgent, playlistFile, LIVE_AGE, request.force)
                coroutineContext.ensureActive()
                if (file.lastModified() != availableAt) publish(file)
                commit(request) { liveStatus.value = LoadStatus.Ready; vodStatus.value = LoadStatus.Ready }
            } catch (e: kotlinx.coroutines.CancellationException) { throw e }
            catch (e: Exception) { commit(request) { liveStatus.value = LoadStatus.Error(friendly(e)); vodStatus.value = LoadStatus.Error(friendly(e)) } }
            finally { liveAvailable.complete(Unit) }
        }
        launch { liveAvailable.await(); if (current(request)) loadLogoIndex() }
        launch { liveAvailable.await(); if (current(request)) loadTrending(request, dir) }
        launch { liveAvailable.await(); if (current(request) && channels.value.isNotEmpty()) {
            restoreGuide(request)
            live.join()
            if (!current(request)) return@launch
            loadGuides(epgUrl, src.userAgent, dir, request)
        } }
    } }

    /** Copies folded into another channel by [Cleanup.lineup]: folded key to the key of the channel that kept it. */
    @Volatile private var merged: Map<String, String> = emptyMap()
    private val deadNow: MutableSet<String> = Collections.newSetFromMap(ConcurrentHashMap())

    /** Cleans the lineup (names, duplicates, empty event slots, channels that recently failed) and publishes it. */
    private fun publishLive(catalogue: ContentPolicy.Catalogue<Channel>, request: LoadRequest, storedAt: Long) {
        if (!current(request)) return
        val localCatalogue = LocalLineup.filterCatalogue(catalogue, request.zip)
        val hidden = prefs.deadChannels()
        val lineup = Cleanup.lineup(localCatalogue.items, localCatalogue.categories, hidden = hidden)
        if (!current(request)) return
        val used = lineup.channels.flatMapTo(HashSet()) { it.categoryIds }
        val categories = localCatalogue.categories.filter { it.id in used }
        commit(request) {
            prefs.remapChannelKeys(lineup.merged, request.source.id)
            if (!current(request)) return@commit
            deadNow.clear(); deadNow.addAll(hidden)
            merged = lineup.merged
            liveCategories.value = categories; channels.value = lineup.channels; liveStatus.value = LoadStatus.Ready
        }
        saveSnapshot(request) { snapshots.writeLive(request.identity, CatalogSnapshots.Live(lineup.channels, categories, lineup.merged), storedAt) }
    }

    /**
     * A channel failed on its main source and every backup. It leaves the guide now and stays hidden for
     * [Prefs.DEAD_FOR_MS], together with the copies that were folded into it, then gets another chance.
     */
    @Synchronized fun reportDead(key: String) {
        deadNow += key
        prefs.markDead(merged.filterValues { it == key }.keys + key)
        channels.value = channels.value.filterNot { it.key == key }
        trending.value = trending.value.filterNot { it.key == key }
    }

    fun isDead(key: String): Boolean = key in deadNow

    /** Brings back every channel hidden for failing (Settings). */
    fun restoreHiddenChannels() {
        prefs.clearDead()
        deadNow.clear()
        catalogueIdentity?.let { snapshots.invalidateLive(it) }
        load()
    }

    /**
     * Loads the optional trending M3U and maps each entry onto a channel we already have (same
     * stream id), so favorites, numbers and guide data carry over. Event feeds that are only in
     * the trending list get appended as extra channels.
     */
    private suspend fun loadTrending(request: LoadRequest, dir: File) {
        val src = request.source
        if (src.hotUrl.isBlank()) return
        try {
            val cached = snapshots.readTrending(request.identity)
            cached?.let { commit(request) { trending.value = it.value.channels.filterNot { c -> c.key in deadNow } } }
            if (cached != null && cached.fresh(TRENDING_AGE) && !request.force) return
            val f = Net.download(src.hotUrl, src.userAgent, File(dir, "trending.m3u"), TRENDING_AGE, request.force)
            if (cached?.storedAt == f.lastModified()) return
            val playlist = M3u.parse(f)
            val now = System.currentTimeMillis()
            val dead = prefs.deadChannels(now)
            val parsed = LocalLineup.filterCatalogue(ContentPolicy.live(playlist.channels, playlist.liveCategories, request.usOnly), request.zip).items
                .filterNot { Cleanup.isIdleEvent(it.name) || Cleanup.isOffAir(it.name, now) }
                .sortedBy { it.key.substringAfterLast(':').toIntOrNull() ?: 0 }
            fun sid(url: String) = url.substringBefore('?').substringAfterLast('/').substringBefore('.')
            // A trending entry may point at a copy that was folded into another channel: map it to that channel.
            val known = HashMap<String, Channel>()
            channels.value.forEach { c -> c.backups.forEach { known.getOrPut(sid(it)) { c } } }
            channels.value.forEach { c -> known[c.streamId ?: sid(c.url)] = c }
            var extra = (channels.value.maxOfOrNull { it.number } ?: 0) + 1
            if (!current(request)) return
            val result = parsed.map { t ->
                known[sid(t.url)] ?: t.copy(key = "h:" + sid(t.url), name = Cleanup.displayName(t.name), number = extra++,
                    categoryId = "__hot", categoryIds = listOf("__hot"))
            }.distinctBy { it.key }.filterNot { it.key in dead }
            commit(request) { trending.value = result }
            saveSnapshot(request) { snapshots.writeTrending(request.identity, result, f.lastModified()) }
        } catch (e: kotlinx.coroutines.CancellationException) { throw e }
        catch (_: Exception) { /* An optional provider list never removes the usable main lineup. */ }
    }

    /** Provider guide first, then free regional guides for whatever is still missing. */
    private suspend fun loadGuides(providerUrl: String?, ua: String, dir: File, request: LoadRequest) {
        if (!current(request)) return
        commit(request) { epgStatus.value = LoadStatus.Loading("Loading guide…") }
        var providerError: String? = null
        if (!providerUrl.isNullOrBlank()) {
            try {
                applyGuide(Net.download(providerUrl, ua, File(dir, "epg.xml"), EPG_AGE, request.force), onlyMissing = false, request.generation)
            } catch (e: kotlinx.coroutines.CancellationException) { throw e }
            catch (e: Exception) {
                providerError = friendly(e)
            }
        }
        if (!current(request)) return
        loadFreeGuides(request.generation)
        if (!current(request)) return
        var guide: CatalogSnapshots.Guide? = null
        commit(request) {
            val have = channels.value.count { hasGuide(it.key) }
            epgStatus.value = if (have > 0) LoadStatus.Ready else LoadStatus.Error(providerError ?: "No guide data found for these channels")
            if (have > 0) guide = CatalogSnapshots.Guide(epg.toMap(), epgIcons.toMap())
        }
        guide?.let { saveSnapshot(request) { snapshots.writeGuide(request.identity, it, System.currentTimeMillis()) } }
    }

    private fun hasGuide(key: String, now: Long = System.currentTimeMillis()) = epg[key]?.any { it.end > now && !it.placeholder } == true

    private suspend fun loadFreeGuides(expectedGeneration: Long = generation) {
        for (code in prefs.freeEpgRegions) {
            if (expectedGeneration != generation) return
            if (channels.value.all { hasGuide(it.key) }) break
            synchronized(this) { if (expectedGeneration == generation) epgStatus.value = LoadStatus.Loading("Finding free guide data…") }
            try {
                val f = Net.download(FreeEpg.url(code), DEFAULT_UA, File(cacheRoot, "free/$code.xml.gz"), FREE_EPG_AGE, false)
                applyGuide(f, onlyMissing = true, expectedGeneration)
            } catch (e: kotlinx.coroutines.CancellationException) { throw e }
            catch (_: Exception) { /* Keep available provider/region listings when another region fails. */ }
        }
    }

    /** Matches an XMLTV file against our channels by id, then by fuzzy name. Returns channels matched. */
    private fun applyGuide(f: File, onlyMissing: Boolean, expectedGeneration: Long = generation): Int {
        val chans = channels.value.filter { !onlyMissing || !hasGuide(it.key) }
        if (chans.isEmpty()) return 0
        val wanted = chans.mapNotNullTo(HashSet()) { it.epgId?.lowercase() }
        val keys = HashSet<String>()
        chans.forEach { c ->
            keys += ChannelMatch.key(c.name)
            c.epgId?.let { keys += ChannelMatch.key(it); keys += ChannelMatch.idKey(it) }
        }
        keys.removeAll { it.length < 2 }
        val now = System.currentTimeMillis()
        val res = Xmltv.parse(f, wanted, keys, now - 4 * 3600_000L, now + 3 * 24 * 3600_000L)
        return synchronized(this) {
        if (expectedGeneration != generation) return@synchronized 0
        var matched = 0
        var newIcons = false
        for (c in chans) {
            val id = c.epgId?.lowercase()
            val xid = id?.takeIf { res.programs.containsKey(it) || res.icons.containsKey(it) }
                ?: id?.let { res.nameToId[ChannelMatch.key(it)] ?: res.nameToId[ChannelMatch.idKey(it)] }
                ?: ChannelMatch.key(c.name).takeIf { it.length >= 2 }?.let { res.nameToId[it] }
                ?: continue
            res.programs[xid]?.takeIf { rows -> rows.any { it.end > now && !it.placeholder } }?.let { if (!onlyMissing || !hasGuide(c.key, now)) { epg[c.key] = it; matched++ } }
            res.icons[xid]?.let { if (epgIcons.putIfAbsent(c.key, it) == null) newIcons = true }
        }
        _epgVersion.value++
        if (newIcons) _logoVersion.value++
        matched
        }
    }

    // ------------------------------------------------------------------ logos

    private val logoIndex = ConcurrentHashMap<String, String>()
    private val epgIcons = ConcurrentHashMap<String, String>()
    private val _logoVersion = MutableStateFlow(0)
    val logoVersion: StateFlow<Int> = _logoVersion
    private var logoJob: Job? = null

    /** Extra logo URLs to try, best first, when the provider's logo is missing or broken. */
    fun fallbackLogos(c: Channel): List<String> = listOfNotNull(
        epgIcons[c.key],
        logoIndex[ChannelMatch.key(c.name)],
        c.epgId?.let { logoIndex[ChannelMatch.idKey(it)] },
    ).distinct()

    /** iptv-org's open logo database (~35k channels), refreshed weekly. */
    private fun loadLogoIndex() {
        if (logoJob != null) return
        logoJob = scope.launch(Dispatchers.IO) {
            runCatching {
                val f = Net.download(LOGOS_URL, DEFAULT_UA, File(cacheRoot, "logos/logos.json"), 7 * 24 * 3600_000L, false)
                val usKeys = HashSet<String>()
                forEachJsonObject(f) { o ->
                    val id = o.str("channel") ?: return@forEachJsonObject
                    val url = o.str("url") ?: return@forEachJsonObject
                    if (o.str("in_use") == "false") return@forEachJsonObject
                    val k = ChannelMatch.idKey(id)
                    if (k.length < 2) return@forEachJsonObject
                    val us = id.endsWith(".us", ignoreCase = true)
                    if (!logoIndex.containsKey(k) || (us && k !in usKeys)) {
                        logoIndex[k] = url
                        if (us) usKeys += k
                    }
                }
                _logoVersion.value++
            }.onFailure { logoJob = null }
        }
    }

    /** Fills gaps for visible Xtream channels that the XMLTV feed did not cover. */
    fun requestShortEpg(visible: List<Channel>) {
        val src = activeSource ?: return
        val requestedGeneration = generation
        if (src.type != SourceType.XTREAM) return
        val x = Xtream(src)
        visible.forEach { c ->
            val sid = c.streamId ?: return@forEach
            if (hasGuide(c.key) || !shortEpgTried.add(c.key)) return@forEach
            scope.launch(Dispatchers.IO) {
                shortEpgGate.withPermit {
                    runCatching {
                        val list = x.parseShortEpg(Net.getString(x.api("get_short_epg", "&stream_id=$sid&limit=24"), src.userAgent))
                        synchronized(this@Repo) { if (requestedGeneration == generation && activeSource == src && list.any { it.end > System.currentTimeMillis() } && !hasGuide(c.key)) {
                            epg[c.key] = list; _epgVersion.value++
                        } }
                    }
                }
            }
        }
    }

    // ------------------------------------------------------------------ details

    suspend fun movieInfo(m: Movie): MovieInfo? {
        movieInfoCache[m.id]?.let { return it }
        val src = activeSource ?: return null
        val requestedGeneration = generation
        if (src.type != SourceType.XTREAM || !m.id.startsWith("m:")) return null
        val x = Xtream(src)
        return runCatching {
            x.parseMovieInfo(Net.getString(x.api("get_vod_info", "&vod_id=${m.id.removePrefix("m:")}"), src.userAgent))
        }.getOrNull()?.let { result -> synchronized(this) {
            result.takeIf { requestedGeneration == generation && activeSource == src }?.also { movieInfoCache[m.id] = it }
        } }
    }

    suspend fun seriesInfo(s: Series): SeriesInfo? {
        seriesInfoCache[s.id]?.let { return it }
        val src = activeSource ?: return null
        val requestedGeneration = generation
        val x = Xtream(src)
        return runCatching {
            x.parseSeriesInfo(Net.getString(x.api("get_series_info", "&series_id=${s.id}"), src.userAgent))
        }.getOrNull()?.let { result -> synchronized(this) {
            result.takeIf { requestedGeneration == generation && activeSource == src }?.also { seriesInfoCache[s.id] = it }
        } }
    }

    /** Checks Xtream credentials and returns a one-line account summary. */
    suspend fun testXtream(src: Source): Result<String> = runCatching {
        val text = Net.getString(Xtream(src).api(), src.userAgent)
        @Suppress("UNCHECKED_CAST")
        val root = parseJson(text) as? JMap ?: error("The server did not return account info")
        val ui = root.obj("user_info") ?: error("The server did not return account info")
        if (ui.str("auth") != "1") error("Login failed. Check the username and password.")
        val parts = mutableListOf(ui.str("status") ?: "Active")
        ui.str("exp_date")?.toLongOrNull()?.let {
            parts += "expires " + SimpleDateFormat("MMM d, yyyy", Locale.US).format(Date(it * 1000))
        }
        ui.str("max_connections")?.let { parts += "$it connection" + if (it == "1") "" else "s" }
        parts.joinToString(" · ")
    }.recoverCatching { throw Exception(friendly(it)) }

    @Synchronized fun clearCache() {
        job?.cancel()
        generation++
        if (liveStatus.value is LoadStatus.Loading) liveStatus.value = LoadStatus.Idle
        if (vodStatus.value is LoadStatus.Loading) vodStatus.value = LoadStatus.Idle
        if (seriesStatus.value is LoadStatus.Loading) seriesStatus.value = LoadStatus.Idle
        if (epgStatus.value is LoadStatus.Loading) epgStatus.value = LoadStatus.Idle
        synchronized(snapshotWriteLock) {
            cacheRoot.deleteRecursively()
            snapshotRoot.deleteRecursively()
        }
        logoJob?.cancel()
        logoJob = null
    }

    /** Re-run only the free-guide pass (after changing regions in Settings). */
    fun reloadFreeGuides() {
        val expectedGeneration = generation
        scope.launch(Dispatchers.IO) {
            loadFreeGuides(expectedGeneration)
            synchronized(this@Repo) { if (expectedGeneration == generation) {
                val have = channels.value.count { hasGuide(it.key) }
                epgStatus.value = if (have > 0) LoadStatus.Ready else LoadStatus.Error("No guide data found for these channels")
            } }
        }
    }

    fun friendly(e: Throwable): String = when (e) {
        is java.net.UnknownHostException -> "Can't reach the server. Check the URL."
        is java.net.SocketTimeoutException -> "The server took too long to respond."
        is java.net.ConnectException -> "Connection refused by the server."
        else -> e.message ?: e.javaClass.simpleName
    }
}

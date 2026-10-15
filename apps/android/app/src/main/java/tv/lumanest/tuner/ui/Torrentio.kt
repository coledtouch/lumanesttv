package tv.lumanest.tuner.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.grid.*
import androidx.compose.foundation.lazy.items as rowItems
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import tv.lumanest.tuner.data.*
import tv.lumanest.tuner.player.PlayerHolder
import coil.compose.AsyncImage
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/** Keep discovery and detail context while the player is on top of this screen. */
class TorrentioBrowseState {
    var initialized = false
    var message by mutableStateOf<String?>(null)
    var messageIsError by mutableStateOf(true)
    var busy by mutableStateOf(false)
    var refreshing by mutableStateOf(false)
    var query by mutableStateOf("")
    var titles by mutableStateOf(emptyList<AddonTitle>())
    var episodes by mutableStateOf(emptyList<AddonEpisode>())
    var selected by mutableStateOf<AddonTitle?>(null)
    var selectedEpisode by mutableStateOf<AddonEpisode?>(null)
    var selectedSeason by mutableIntStateOf(-1)
    var sections by mutableStateOf(emptyList<CatalogSection>())
    var catalogSeries: Boolean? = null
    var detailsLoading by mutableStateOf(false)
    var detailsFailed by mutableStateOf(false)
    var detailAttempt by mutableIntStateOf(0)
    var loadedDetails: AddonDetails? = null
    var loadedDetailKey: String? = null
    var advanced by mutableStateOf(false)
    var magnet by mutableStateOf("")
    var configuring by mutableStateOf(false)
    var lastCatalogFocus: String? = null
    var lastDetailFocus: String? = null
    var restoreFocus by mutableStateOf(true)
    val catalogGrid = LazyGridState()
    val detailGrid = LazyGridState()
    private val rowStates = mutableMapOf<String, LazyListState>()
    fun rowState(key: String) = rowStates.getOrPut(key) { LazyListState() }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun TorrentioScreen(
    state: AppState,
    loadCatalog: Boolean = true,
    detailsLoader: suspend (String, Boolean) -> AddonDetails = { id, series -> Torrentio.details(id, series) },
    streamsLoader: suspend (String, String, Boolean) -> AddonResults = { manifest, id, series -> Torrentio.lookup(manifest, id, series) },
) {
    val browse = remember(state) {
        state.torrentioBrowse.apply {
            if (!initialized) {
                configuring = !Repo.prefs.addon.configured
                initialized = true
            }
        }
    }
    val scope = rememberCoroutineScope()
    val requesters = remember { mutableMapOf<String, FocusRequester>() }
    fun requester(key: String) = requesters.getOrPut(key) { FocusRequester() }
    fun detailKey(id: String, series: Boolean = state.torrentioSeries) = "${if (series) "series" else "movie"}:$id"

    with(browse) {
        fun notice(text: String?, error: Boolean = true) { message = text; messageIsError = error }
        fun backToCards() {
            selected = null; selectedEpisode = null; episodes = emptyList(); detailsLoading = false
            detailsFailed = false; notice(null); restoreFocus = true
        }
        fun exit() {
            if (configuring) { configuring = false; restoreFocus = true }
            else if (selected != null) backToCards()
            else if (state.top == Screen.Home) state.requestNavigation()
            else state.pop()
        }
        fun openTitle(title: AddonTitle, episode: AddonEpisode? = null) {
            if (busy) return
            val key = detailKey(title.id)
            val cached = loadedDetails.takeIf { loadedDetailKey == key }
            selected = cached?.title ?: title
            episodes = cached?.episodes.orEmpty()
            selectedEpisode = episode ?: episodes.firstOrNull { it.season > 0 } ?: episodes.firstOrNull()
            selectedSeason = selectedEpisode?.season ?: -1
            detailsLoading = cached == null; detailsFailed = false; lastDetailFocus = null
            notice(null); restoreFocus = true
        }
        suspend fun search(force: Boolean = false) {
            val searchedQuery = query.trim()
            val series = state.torrentioSeries
            notice(null)
            if (searchedQuery.isBlank()) {
                refreshing = true; titles = emptyList()
                try {
                    StreamingCatalog.load(series, force) { section ->
                        if (state.torrentioSeries == series) sections = sections.map { if (it.id == section.id) section else it }
                    }
                } catch (e: CancellationException) { throw e }
                catch (e: Exception) { notice("Could not load catalogs. Select Refresh to retry.") }
                finally { refreshing = false }
            } else {
                busy = true
                try {
                    val results = Torrentio.searchTitles(searchedQuery, series).distinctBy { it.id }
                    if (query.trim() == searchedQuery && state.torrentioSeries == series) {
                        titles = results
                        if (results.isEmpty()) notice("No matching titles found. Try another name.", false)
                    }
                } catch (e: CancellationException) { throw e }
                catch (e: Exception) { notice("Could not load titles. Check your connection and try again.") }
                finally { busy = false }
            }
        }
        fun lookup(id: String, title: String, image: String? = selected?.poster) {
            if (busy || id.isBlank()) return
            val manifest = state.torrentioManifest
            val series = state.torrentioSeries
            state.torrentioVideoId = id; state.torrentioTitle = title
            busy = true; notice(null); state.torrentioResults = null
            scope.launch {
                try {
                    val response = streamsLoader(manifest, id, series)
                    if (manifest == state.torrentioManifest && id == state.torrentioVideoId && series == state.torrentioSeries) {
                        state.torrentioResults = response
                        val stream = response.streams.firstOrNull()
                        if (stream == null) notice("No playable streams found. Try another title or check your addon settings.")
                        else state.push(Screen.Player(PlayRequest.Vod("torrentio:$id", title, null,
                            image, stream.url, 0, streamBackups = response.streams.drop(1).map { it.url }.distinct())))
                    }
                } catch (e: CancellationException) { throw e }
                catch (e: Exception) { notice("Could not find streams. Check your connection or addon settings and try again.") }
                finally { busy = false }
            }
        }
        LaunchedEffect(state.torrentioSeries) {
            if (catalogSeries != state.torrentioSeries) {
                sections = StreamingCatalog.sections(state.torrentioSeries)
                catalogSeries = state.torrentioSeries
            }
            if (loadCatalog) {
                if (query.isBlank() && selected == null) search()
                while (true) {
                    delay(StreamingCatalog.TTL)
                    if (query.isBlank() && selected == null && !busy && !refreshing) search()
                }
            }
        }
        LaunchedEffect(Unit) { PlayerHolder.stop(); restoreFocus = true }
        BackHandler(selected != null || configuring) { exit() }
        LaunchedEffect(selected?.id, state.torrentioSeries, detailAttempt) {
            val chosen = selected ?: return@LaunchedEffect
            val key = detailKey(chosen.id)
            if (loadedDetailKey == key && !detailsFailed) { detailsLoading = false; return@LaunchedEffect }
            val hadEpisode = selectedEpisode != null
            detailsLoading = true; detailsFailed = false
            try {
                val details = detailsLoader(chosen.id, state.torrentioSeries)
                if (selected?.id == chosen.id && detailKey(chosen.id) == key) {
                    val ordered = details.episodes.distinctBy { it.id }.sortedWith(compareBy<AddonEpisode> { it.season }.thenBy { it.episode })
                    loadedDetails = details.copy(episodes = ordered); loadedDetailKey = key
                    selected = details.title; episodes = ordered
                    if (selectedEpisode == null) selectedEpisode = ordered.firstOrNull { it.season > 0 } ?: ordered.firstOrNull()
                    selectedSeason = selectedEpisode?.season ?: -1
                    if (state.torrentioSeries && ordered.isEmpty()) notice("No episodes were reported for this series. Try Refresh details.")
                }
            } catch (e: CancellationException) { throw e }
            catch (e: Exception) {
                if (selected?.id == chosen.id) {
                    detailsFailed = true
                    notice(if (state.torrentioSeries && selectedEpisode == null) "Could not load episodes. Retry details or choose a recent episode from a catalog." else "Details could not be loaded. You can still try playback or retry details.")
                }
            } finally {
                if (selected?.id == chosen.id) {
                    detailsLoading = false
                    if (state.torrentioSeries && !hadEpisode) restoreFocus = true
                }
            }
        }
        LaunchedEffect(restoreFocus, configuring, selected?.id, detailsLoading) {
            if (!restoreFocus) return@LaunchedEffect
            withFrameNanos { }
            val catalogKey = lastCatalogFocus?.takeIf { key ->
                if (key.startsWith("search:")) titles.any { "search:${it.id}" == key }
                else sections.any { section -> section.cards.any { "catalog:${section.id}:${it.key}" == key } }
            }
            val detailFocus = lastDetailFocus?.takeIf { key -> key == "detail:play" || episodes.any { "episode:${it.id}" == key && (selectedSeason < 0 || it.season == selectedSeason) } }
            val key = when {
                configuring -> "config:manifest"
                selected != null -> detailFocus ?: "detail:play"
                else -> catalogKey ?: "search"
            }
            val itemKey = when {
                key == "config:manifest" -> "configuration"
                key == "search" -> "search-controls"
                key == "detail:play" -> "detail:${selected?.id}"
                key.startsWith("catalog:") -> "section:${key.removePrefix("catalog:").substringBefore(':')}"
                key.startsWith("search:") -> "title:${key.removePrefix("search:")}"
                else -> key
            }
            val itemKeys = buildList {
                if (configuring) add("configuration")
                if (selected == null) add("search-controls")
                if (message != null) add("message")
                selected?.let {
                    add("detail:${it.id}")
                    if (state.torrentioSeries && episodes.isNotEmpty()) add("seasons")
                }
                if (selected == null && query.isNotBlank()) addAll(titles.distinctBy { it.id }.map { "title:${it.id}" })
                if (selected == null && query.isBlank()) addAll(sections.map { "section:${it.id}" })
                if (selected != null) addAll(episodes.filter { selectedSeason < 0 || it.season == selectedSeason }.map { "episode:${it.id}" })
                add("advanced")
            }
            val index = itemKeys.indexOf(itemKey)
            val grid = if (selected == null) catalogGrid else detailGrid
            if (index >= 0 && grid.layoutInfo.visibleItemsInfo.none { it.key == itemKey }) grid.scrollToItem(index)
            if (requestAttachedFocus(requester(key))) {
                restoreFocus = false
                if (state.restoreFocus) state.restoreFocus = false
            }
        }

        BoxWithConstraints(Modifier.fillMaxSize()) {
            val viewportWidth = maxWidth
            val compact = maxWidth < 800.dp || maxHeight < 430.dp
            val inset = if (compact) 20.dp else 28.dp
            Column(Modifier.fillMaxSize()) {
                Row(Modifier.fillMaxWidth().padding(horizontal = inset, vertical = if (compact) 8.dp else 12.dp),
                    horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text("Discover", color = Palette.text, fontSize = if (compact) 21.sp else 26.sp, fontWeight = FontWeight.Bold, maxLines = 1)
                        if (viewportWidth >= 600.dp) Text("Arrows Move · OK Select · Back ${if (configuring) "Close" else if (selected != null) "Cards" else if (state.top == Screen.Home) "Tabs" else "Return"}", color = Palette.dim, fontSize = if (compact) 11.sp else 13.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    }
                    Row(horizontalArrangement = Arrangement.spacedBy(if (compact) 6.dp else 10.dp)) {
                        fun chooseType(series: Boolean) {
                            if (!busy && !refreshing && state.torrentioSeries != series) {
                                state.torrentioSeries = series; query = ""; titles = emptyList(); selected = null
                                selectedEpisode = null; episodes = emptyList(); state.torrentioResults = null
                                lastCatalogFocus = null; restoreFocus = true; notice(null)
                            }
                        }
                        PillButton("Movies", { chooseType(false) }, primary = !state.torrentioSeries)
                        PillButton("Series", { chooseType(true) }, primary = state.torrentioSeries)
                        PillButton("Setup", { configuring = !configuring; restoreFocus = true }, Modifier.focusRequester(requester("header:options")))
                        PillButton("Back", { exit() })
                    }
                }
                val grid = if (selected == null) catalogGrid else detailGrid
                LazyVerticalGrid(columns = GridCells.Adaptive(if (compact) 106.dp else 130.dp), state = grid, modifier = Modifier.weight(1f),
                    contentPadding = PaddingValues(horizontal = inset, vertical = if (compact) 12.dp else 20.dp),
                    horizontalArrangement = Arrangement.spacedBy(16.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
                    if (configuring) item(key = "configuration", span = { GridItemSpan(maxLineSpan) }) {
                        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            TvTextField("Configured manifest link", state.torrentioManifest, { value ->
                                try {
                                    Torrentio.endpoint(value, "tt1234567", false)
                                    Repo.prefs.addon.manifest = value.trim(); state.torrentioManifest = value.trim(); state.torrentioResults = null
                                    configuring = false; restoreFocus = true; notice("Configuration saved.", false)
                                } catch (e: Exception) { notice("Could not save that link. Paste the manifest link copied from Torrentio.") }
                            }, password = true, focusRequester = requester("config:manifest"))
                            Text("Configure once. Your link is saved securely.", color = Palette.dim, fontSize = 12.sp)
                            PillButton("Done", { configuring = false; restoreFocus = true })
                        }
                    }
                    if (selected == null) item(key = "search-controls", span = { GridItemSpan(maxLineSpan) }) {
                        Row(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
                            Box(Modifier.weight(1f)) {
                                TvTextField("Search by title", query, { query = it; titles = emptyList(); notice(null) }, placeholder = "Movie or series name", keyboardType = KeyboardType.Text, focusRequester = requester("search"))
                            }
                            PillButton(if (busy || refreshing) "Loading..." else if (query.isBlank()) "Refresh" else "Search", { if (!busy && !refreshing) scope.launch { search(force = true) } }, primary = true)
                        }
                    }
                    message?.let { text -> item(key = "message", span = { GridItemSpan(maxLineSpan) }) {
                        Text(text, color = if (messageIsError) Palette.live else Palette.good, fontSize = 13.sp, maxLines = 3, overflow = TextOverflow.Ellipsis)
                    } }
                    selected?.let { title ->
                        item(key = "detail:${title.id}", span = { GridItemSpan(maxLineSpan) }) {
                            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(if (compact) 18.dp else 24.dp)) {
                                Box(Modifier.width(if (compact) 96.dp else 150.dp).aspectRatio(2f / 3f).clip(RoundedCornerShape(12.dp)).background(Palette.surface2), contentAlignment = Alignment.Center) {
                                    Text(title.name, color = Palette.dim, modifier = Modifier.padding(12.dp), maxLines = 4, overflow = TextOverflow.Ellipsis)
                                    AsyncImage(title.poster, null, modifier = Modifier.fillMaxSize(), contentScale = ContentScale.Crop)
                                }
                                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(if (compact) 8.dp else 10.dp)) {
                                    Text(title.name, color = Palette.text, fontSize = if (compact) 22.sp else 26.sp, fontWeight = FontWeight.Bold, maxLines = 2, overflow = TextOverflow.Ellipsis)
                                    Text(listOf(title.year, title.runtime, contentRating(title.rating)?.let { "IMDb $it" }.orEmpty()).filter(String::isNotBlank).joinToString(" · "), color = Palette.accent, fontSize = 12.sp, maxLines = 2, overflow = TextOverflow.Ellipsis)
                                    FlowRow(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                                        val playable = !state.torrentioSeries || selectedEpisode != null
                                        if (playable) PillButton(if (busy) "Finding streams..." else selectedEpisode?.let { "Play S${it.season} E${it.episode}" } ?: "Play movie", {
                                            val episode = selectedEpisode
                                            lastDetailFocus = "detail:play"
                                            lookup(episode?.id ?: title.id, if (episode != null) "${title.name} · S${episode.season} E${episode.episode}" else title.name)
                                        }, Modifier.focusRequester(requester("detail:play")), primary = true)
                                        else if (detailsFailed || (!detailsLoading && episodes.isEmpty())) PillButton("Refresh details", { loadedDetailKey = null; detailAttempt++; restoreFocus = true }, Modifier.focusRequester(requester("detail:play")), primary = true)
                                        PillButton("Back to cards", { backToCards() }, if (!playable && detailsLoading) Modifier.focusRequester(requester("detail:play")) else Modifier)
                                        if (playable && detailsFailed) PillButton("Retry details", { loadedDetailKey = null; detailAttempt++ })
                                    }
                                    if (detailsLoading) Text("Loading details...", color = Palette.dim, fontSize = 12.sp)
                                    if (title.genres.isNotEmpty()) Text(title.genres.joinToString(" · "), color = Palette.dim, fontSize = 12.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                    if (title.description.isNotBlank()) Text(title.description, color = Palette.text.copy(alpha = .8f), fontSize = if (compact) 13.sp else 15.sp, lineHeight = if (compact) 18.sp else 21.sp, maxLines = if (compact) 3 else 4, overflow = TextOverflow.Ellipsis)
                                    if (title.cast.isNotEmpty() && !compact) Text("Cast: ${title.cast.take(6).joinToString(", ")}", color = Palette.dim, fontSize = 12.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                }
                            }
                        }
                        if (state.torrentioSeries && episodes.isNotEmpty()) {
                            item(key = "seasons", span = { GridItemSpan(maxLineSpan) }) {
                                LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp), contentPadding = PaddingValues(vertical = 4.dp)) {
                                    rowItems(episodes.map { it.season }.distinct(), key = { it }) { season ->
                                        PillButton(if (season == 0) "Specials" else "Season $season", {
                                            selectedSeason = season
                                            selectedEpisode = episodes.firstOrNull { it.season == season }
                                            lastDetailFocus = "detail:play"; restoreFocus = true
                                        }, primary = season == selectedSeason)
                                    }
                                }
                            }
                        }
                    }
                    if (selected == null && query.isNotBlank()) items(titles.distinctBy { it.id }, key = { "title:${it.id}" }) { title ->
                        val key = "search:${title.id}"
                        TorrentioTitleCard(title, Modifier.focusRequester(requester(key)), compact, { lastCatalogFocus = key }) { lastCatalogFocus = key; openTitle(title) }
                    }
                    if (selected == null && query.isBlank()) sections.forEach { section ->
                        item(key = "section:${section.id}", span = { GridItemSpan(maxLineSpan) }) {
                            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                                Text(section.name, color = Palette.text, fontSize = if (compact) 17.sp else 20.sp, fontWeight = FontWeight.Bold)
                                val updated = section.updated.takeIf { it > 0 }?.let { SimpleDateFormat("MMM d, h:mm a", Locale.US).format(Date(it)) }
                                Text(section.caption + (updated?.let { " · ${if (section.stale) "Cached" else "Updated"} $it" } ?: ""), color = Palette.dim, fontSize = 11.sp, maxLines = 2, overflow = TextOverflow.Ellipsis)
                                if (section.loading && section.cards.isEmpty()) Text("Loading catalog...", color = Palette.dim)
                                section.error?.let { Text(it, color = Palette.live, fontSize = 12.sp, maxLines = 2, overflow = TextOverflow.Ellipsis) }
                                if (!section.loading && section.error == null && section.cards.isEmpty()) Text("No titles reported by this source. Try Refresh.", color = Palette.dim, fontSize = 12.sp)
                                LazyRow(state = rowState("${state.torrentioSeries}:${section.id}"), contentPadding = PaddingValues(4.dp), horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                                    rowItems(section.cards.distinctBy { it.key }, key = { it.key }) { card ->
                                        val key = "catalog:${section.id}:${card.key}"
                                        Column(Modifier.width(if (compact) 94.dp else 110.dp)) {
                                            TorrentioTitleCard(card.title, Modifier.focusRequester(requester(key)), compact, { lastCatalogFocus = key }) { lastCatalogFocus = key; openTitle(card.title, card.episode) }
                                            card.episode?.let { Text("S${it.season} E${it.episode} · ${card.added}", color = Palette.accent, fontSize = 11.sp, maxLines = 1, overflow = TextOverflow.Ellipsis) }
                                        }
                                    }
                                }
                            }
                        }
                    }
                    if (selected != null) items(episodes.filter { selectedSeason < 0 || it.season == selectedSeason }, key = { "episode:${it.id}" }, span = { GridItemSpan(maxLineSpan) }) { episode ->
                        val key = "episode:${episode.id}"
                        FocusBox(onClick = {
                            selectedEpisode = episode; selectedSeason = episode.season; lastDetailFocus = key
                            lookup(episode.id, "${selected?.name.orEmpty()} · S${episode.season} E${episode.episode}")
                        }, modifier = Modifier.fillMaxWidth().focusRequester(requester(key)), focusedScale = 1.015f, onFocus = { if (it) lastDetailFocus = key }) { focused ->
                            Row(Modifier.padding(horizontal = 16.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                                Column(Modifier.weight(1f)) {
                                    Text("S${episode.season} E${episode.episode} · ${episode.title}", color = if (focused) Palette.accent else Palette.text, fontSize = 14.sp, fontWeight = FontWeight.SemiBold, maxLines = 2, overflow = TextOverflow.Ellipsis)
                                    if (episode.released.isNotBlank()) Text(episode.released.take(10), color = Palette.dim, fontSize = 11.sp, modifier = Modifier.padding(top = 4.dp))
                                }
                                Text("Play", color = Palette.dim, fontSize = 12.sp, modifier = Modifier.padding(start = 12.dp))
                            }
                        }
                    }
                    item(key = "advanced", span = { GridItemSpan(maxLineSpan) }) { PillButton(if (advanced) "Hide advanced options" else "Advanced options", { advanced = !advanced }) }
                    if (advanced) {
                        item(key = "advanced-controls", span = { GridItemSpan(maxLineSpan) }) {
                            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                                TvTextField(if (state.torrentioSeries) "IMDb ID : season : episode" else "IMDb ID", state.torrentioVideoId, { state.torrentioVideoId = it }, keyboardType = KeyboardType.Text)
                                PillButton(if (busy) "Finding streams..." else "Play by ID", { lookup(state.torrentioVideoId, state.torrentioVideoId) })
                                TvTextField("Magnet link", magnet, { magnet = it }, placeholder = "magnet:?xt=urn:btih:...")
                                PillButton("Play magnet", {
                                    if (!busy) try {
                                        val url = TorrentSpec.fromMagnet(magnet.trim()).uri()
                                        state.push(Screen.Player(PlayRequest.Vod("magnet", "Torrent video", null, null, url, 0)))
                                    } catch (e: Exception) { notice("That magnet link is invalid. Check the link and try again.") }
                                })
                            }
                        }
                        state.torrentioResults?.let { response ->
                            item(key = "manual-label", span = { GridItemSpan(maxLineSpan) }) { Text("Available streams for ${state.torrentioTitle}", color = Palette.dim, fontSize = 13.sp, maxLines = 2, overflow = TextOverflow.Ellipsis) }
                            items(response.streams.distinctBy { it.url }, key = { "stream:${it.url}" }, span = { GridItemSpan(maxLineSpan) }) { stream ->
                                PillButton("Choose manually: ${stream.name}", {
                                    if (!busy) state.push(Screen.Player(PlayRequest.Vod("torrentio:${state.torrentioVideoId}", state.torrentioTitle, stream.name, null, stream.url, 0)))
                                })
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
internal fun TorrentioTitleCard(title: AddonTitle, modifier: Modifier = Modifier, compact: Boolean = false, onFocused: () -> Unit = {}, onClick: () -> Unit) {
    FocusBox(onClick = onClick, modifier = modifier.fillMaxWidth(), focusedScale = 1.035f, onFocus = { if (it) onFocused() }) { focused ->
        Column {
            Box(Modifier.fillMaxWidth().aspectRatio(2f / 3f).background(Brush.linearGradient(listOf(Palette.accent.copy(alpha = .12f), Palette.surface2))), contentAlignment = Alignment.Center) {
                Text(title.name, color = Palette.dim, modifier = Modifier.padding(12.dp), maxLines = 4, overflow = TextOverflow.Ellipsis)
                AsyncImage(title.poster, null, modifier = Modifier.fillMaxSize(), contentScale = ContentScale.Crop)
                contentRating(title.rating)?.let { rating -> Text("★ $rating", color = Palette.text, modifier = Modifier.align(Alignment.TopEnd).background(Palette.bg.copy(alpha = .85f)).padding(6.dp), fontSize = 11.sp) }
            }
            Column(Modifier.padding(if (compact) 8.dp else 10.dp)) {
                Text(title.name, color = if (focused) Palette.accent else Palette.text, fontSize = if (compact) 12.sp else 14.sp, lineHeight = if (compact) 15.sp else 18.sp, fontWeight = FontWeight.SemiBold, minLines = 2, maxLines = 2, overflow = TextOverflow.Ellipsis)
                Text(title.year, color = Palette.dim, fontSize = 11.sp, minLines = 1, maxLines = 1)
            }
        }
    }
}

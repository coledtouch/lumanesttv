package tv.lumanest.tuner.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.ArrowForward
import androidx.compose.material.icons.rounded.Movie
import androidx.compose.material.icons.rounded.PlayArrow
import androidx.compose.material.icons.rounded.Search
import androidx.compose.material.icons.rounded.Tv
import androidx.compose.material.icons.rounded.Star
import androidx.compose.material.icons.rounded.StarBorder
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import tv.lumanest.tuner.data.BrowseTitle
import tv.lumanest.tuner.data.PlayRequest
import tv.lumanest.tuner.data.Repo
import tv.lumanest.tuner.data.VodType
import coil.compose.AsyncImage
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.util.Locale

private data class Hit(val key: String, val title: String, val subtitle: String, val image: String?, val wide: Boolean, val channel: tv.lumanest.tuner.data.Channel? = null, val open: () -> Unit)
private data class Section(val title: String, val hits: List<Hit>)
private fun favoriteFocusKey(hit: Hit) = hit.key + ":favorite"

@Composable
fun SearchScreen(state: AppState) {
    val query = state.searchQuery
    var sections by remember { mutableStateOf<List<Section>>(emptyList()) }
    var searching by remember { mutableStateOf(false) }
    var resultQuery by remember { mutableStateOf<String?>(null) }
    var resultSource by remember { mutableStateOf<String?>(null) }
    var resultsFocused by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    val channels by Repo.channels.collectAsState()
    val trending by Repo.trending.collectAsState()
    val movies by Repo.movies.collectAsState()
    val series by Repo.series.collectAsState()
    val favorites by Repo.prefs.favorites.collectAsState()
    val sourceId by Repo.prefs.activeId.collectAsState()
    val epgVersion by Repo.epgVersion.collectAsState()
    val vodUsOnly by Repo.prefs.vodUsOnly.collectAsState()
    val browse by Repo.browse.collectAsState()
    val now = rememberNow(30_000)
    val live = remember(channels, trending) { (channels + trending).distinctBy { it.key } }
    val searchList = state.rowState("search-results")
    val fieldFocus = remember { FocusRequester() }
    val normalized = query.trim()
    val ready = normalized.length >= 2 || (normalized.isNotEmpty() && normalized.all { it.isDigit() })
    val visibleSections = if (resultQuery == normalized && resultSource == sourceId) sections else emptyList()
    val focusKeys = remember(visibleSections) {
        visibleSections.flatMap { section -> section.hits.flatMap { hit ->
            if (hit.channel == null) listOf(hit.key) else listOf(hit.key, favoriteFocusKey(hit))
        } }
    }
    val requesters = remember(focusKeys) { focusKeys.associateWith { FocusRequester() } }

    fun changeQuery(value: String) {
        state.searchFocusedKey = null
        state.searchQuery = value
    }

    LaunchedEffect(state.restoreFocus, ready, visibleSections, resultQuery, resultSource) {
        if (!state.restoreFocus) return@LaunchedEffect
        // A saved result must be mounted before restoring it after a title or player closes.
        if (ready && (resultQuery != normalized || resultSource != sourceId)) return@LaunchedEffect
        val target = state.searchFocusedKey
        var listIndex = 0
        var targetIndex: Int? = null
        visibleSections.forEach { section ->
            listIndex++
            section.hits.forEach { hit ->
                if (target == hit.key || (hit.channel != null && target == favoriteFocusKey(hit))) targetIndex = listIndex
                listIndex++
            }
        }
        val requester = target?.let(requesters::get)
        suspend fun restoreIfPending(requester: FocusRequester, expectedKey: String?): Boolean {
            repeat(12) {
                withFrameNanos { }
                // A result can gain focus while the field or lazy row waits to attach. That
                // newer selection owns focus, including the interval between OK down and up.
                if (!state.restoreFocus || state.searchFocusedKey != expectedKey ||
                    state.searchQuery.trim() != normalized || Repo.prefs.activeId.value != sourceId) return false
                if (runCatching { requester.requestFocus() }.isSuccess) return true
            }
            return false
        }
        if (requester != null && targetIndex != null) {
            if (searchList.layoutInfo.visibleItemsInfo.none { it.index == targetIndex }) searchList.scrollToItem(targetIndex!!)
            if (restoreIfPending(requester, target)) state.restoreFocus = false
        } else {
            state.searchFocusedKey = null
            if (restoreIfPending(fieldFocus, null)) state.restoreFocus = false
        }
    }

    BackHandler(enabled = resultsFocused) {
        state.searchFocusedKey = null
        scope.launch { requestAttachedFocus(fieldFocus) }
    }

    LaunchedEffect(normalized, sourceId, live, movies, series, epgVersion, now, vodUsOnly, browse) {
        val catalogueSource = sourceId
        val q = query.trim().lowercase(Locale.ROOT)
        if (!ready) { sections = emptyList(); resultQuery = normalized; resultSource = sourceId; searching = false; return@LaunchedEffect }
        val changed = resultQuery != normalized
        searching = true
        // Not scrollToItem: it waits for the results list to be laid out, and the list isn't on screen while the
        // spinner is, so the first search of a session would spin forever.
        if (changed) searchList.requestScrollToItem(0)
        delay(250)
        val next = withContext(Dispatchers.Default) {
            // A channel number should land on that channel even when many names contain the
            // same digits. Match numeric values so cable-style leading zeroes also work.
            val number = q.toIntOrNull()
            val exact = number?.let { value -> live.firstOrNull { it.number == value } }
            val matches = live.asSequence().filter {
                it.key != exact?.key && (it.name.lowercase(Locale.ROOT).contains(q) || it.number.toString() == q)
            }.take(if (exact == null) 30 else 29).toList()
            val ch = (listOfNotNull(exact) + matches).map { c ->
                val nowProgram = Repo.programsFor(c)?.firstOrNull { it.isOnAt(now) }
                Hit("$catalogueSource:channel:${c.key}", c.name, "Channel ${c.number}" + (nowProgram?.title?.takeIf { it.isNotBlank() }?.let { "  ·  $it" } ?: "  ·  Live TV"), c.logo, true, c) {
                    val current = (Repo.channels.value + Repo.trending.value).distinctBy { it.key }
                    if (Repo.prefs.activeId.value != catalogueSource || current.none { it.key == c.key && it.url == c.url }) {
                        Toasts.show("This channel changed. Search again.")
                    } else {
                        state.guide.handoff = false
                        state.push(Screen.Player(PlayRequest.Live(c, current)))
                    }
                }
            }
            // Movies & Series: USA only applies here as on Home and Discover, once the browse index knows each title.
            val catalog = browse?.takeIf { vodUsOnly && it.source == Repo.activeSource && it.movies === movies && it.series === series }?.catalog
            fun shown(key: String) = catalog?.get(key)?.us != false
            val mv = movies.asSequence().filter { it.name.lowercase(Locale.ROOT).contains(q) && shown(BrowseTitle.movieKey(it.id)) }.take(40).map { m ->
                Hit("$catalogueSource:movie:${m.id}", m.name, listOfNotNull("Movie", contentRating(m.rating)?.let { "★ $it" }).joinToString(" · "), m.poster, false) {
                    if (Repo.prefs.activeId.value == catalogueSource && Repo.movies.value.any { it.id == m.id && it.url == m.url }) state.push(Screen.MovieDetail(m))
                    else Toasts.show("This movie changed. Search again.")
                }
            }.toList()
            val se = series.asSequence().filter { it.name.lowercase(Locale.ROOT).contains(q) && shown(BrowseTitle.seriesKey(it.id)) }.take(40).map { s ->
                Hit("$catalogueSource:series:${s.id}", s.name, listOfNotNull("Series", s.year).joinToString(" · "), s.cover, false) {
                    if (Repo.prefs.activeId.value == catalogueSource && Repo.series.value.any { it.id == s.id }) state.push(Screen.SeriesDetail(s))
                    else Toasts.show("This series changed. Search again.")
                }
            }.toList()
            listOf(Section("Live TV", ch), Section("Movies", mv), Section("Series", se)).filter { it.hits.isNotEmpty() }
        }
        val selected = state.searchFocusedKey
        if (!changed && selected != null && next.none { section -> section.hits.any { it.key == selected || favoriteFocusKey(it) == selected } }) {
            state.searchFocusedKey = null
            if (resultsFocused) state.restoreFocus = true
        }
        sections = next
        resultQuery = normalized
        resultSource = catalogueSource
        searching = false
    }

    BoxWithConstraints(Modifier.fillMaxSize()) {
    val compact = maxWidth < 760.dp || maxHeight < 400.dp
    Column(Modifier.fillMaxSize().padding(horizontal = if (compact) 24.dp else 48.dp)) {
        Row(Modifier.fillMaxWidth().padding(top = 12.dp, bottom = 12.dp), verticalAlignment = Alignment.CenterVertically) {
            Text("Search", color = Palette.text, fontSize = if (compact) 24.sp else 28.sp, fontWeight = FontWeight.Bold)
            Text("Find your next favorite", color = Palette.dim, fontSize = 13.sp, modifier = Modifier.padding(start = 16.dp))
        }
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            TvTextField(
                label = "", value = query, onChange = ::changeQuery, focusRequester = fieldFocus,
                placeholder = "Search titles, channels or channel numbers", keyboardType = KeyboardType.Text,
                modifier = Modifier.weight(1f).testTag("search-field"),
            )
            if (query.isNotEmpty()) PillButton("Clear", { changeQuery(""); scope.launch { requestAttachedFocus(fieldFocus) } })
        }
        Text(
            when { searching -> "Updating your results…"; !ready -> "Press OK to type  ·  Search with 2 letters or a channel number"; else -> "Showing ${visibleSections.sumOf { it.hits.size }} matches  ·  Select to watch or view details  ·  Star a channel to save it" },
            color = Palette.dim, fontSize = 11.sp, maxLines = 1, overflow = TextOverflow.Ellipsis,
            modifier = Modifier.padding(top = 10.dp, bottom = 6.dp),
        )
        Box(Modifier.weight(1f).fillMaxWidth()) {
        when {
            searching && visibleSections.isEmpty() -> Column(Modifier.align(Alignment.Center), horizontalAlignment = Alignment.CenterHorizontally) {
                CircularProgressIndicator(color = Palette.accent, strokeWidth = 3.dp, modifier = Modifier.size(30.dp))
                Text("Finding something good…", color = Palette.dim, fontSize = 14.sp, modifier = Modifier.padding(top = 12.dp))
            }
            !ready -> Column(Modifier.align(Alignment.Center), horizontalAlignment = Alignment.CenterHorizontally) {
                if (!compact) Icon(Icons.Rounded.Search, null, tint = Palette.accent,
                    modifier = Modifier.size(54.dp).clip(RoundedCornerShape(16.dp)).background(Palette.accent.copy(alpha = 0.12f)).padding(13.dp))
                Text("Everything you love, one search", color = Palette.text, fontSize = if (compact) 19.sp else 22.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(top = if (compact) 0.dp else 16.dp))
                Text("Find a channel, movie or series by name.\nKnow your channel number? Enter it to jump straight there.",
                    color = Palette.dim, fontSize = 13.sp, textAlign = TextAlign.Center, lineHeight = 19.sp, modifier = Modifier.padding(top = 8.dp))
                Row(Modifier.padding(top = 20.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    PillButton("Live TV", { state.tab = Tab.GUIDE; state.restoreFocus = true }, icon = { Icon(Icons.Rounded.Tv, null, tint = it, modifier = Modifier.size(18.dp)) })
                    PillButton("Movies", { state.openDiscover(VodType.MOVIES) }, icon = { Icon(Icons.Rounded.Movie, null, tint = it, modifier = Modifier.size(18.dp)) })
                    PillButton("Series", { state.openDiscover(VodType.SERIES) }, icon = { Icon(Icons.Rounded.Tv, null, tint = it, modifier = Modifier.size(18.dp)) })
                }
            }
            visibleSections.isEmpty() -> EmptyMessage("No matches for “${query.trim().take(45)}”", "Try a shorter title, another spelling or a channel number.")
            else -> LazyColumn(state = searchList, modifier = Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 32.dp), verticalArrangement = Arrangement.spacedBy(7.dp)) {
                visibleSections.forEach { sec ->
                    item(key = "h" + sec.title) {
                        SectionTitle(sec.title + "  ·  ${sec.hits.size}", Modifier.padding(top = 14.dp, bottom = 4.dp, start = 4.dp))
                    }
                    items(sec.hits, key = { it.key }) { h ->
                        HitRow(
                            h, requesters.getValue(h.key), h.channel?.let { requesters.getValue(favoriteFocusKey(h)) },
                            favorite = h.channel?.key in favorites,
                            onFocus = { key, focused ->
                                resultsFocused = focused
                                if (focused) {
                                    state.searchFocusedKey = key
                                    state.restoreFocus = false
                                }
                            },
                            onOpen = { state.searchFocusedKey = h.key; h.open() },
                            onFavorite = { favoriteButton ->
                                val c = h.channel
                                if (c != null && h.key == "${Repo.prefs.activeId.value}:channel:${c.key}") {
                                    state.searchFocusedKey = if (favoriteButton) favoriteFocusKey(h) else h.key
                                    val added = Repo.prefs.toggleFavorite(c.key)
                                    Toasts.show(if (added) "${c.name} added to Favorites" else "${c.name} removed from Favorites")
                                }
                            },
                        )
                    }
                }
            }
        }
        }
    }
    }
}

@Composable
private fun HitRow(
    h: Hit, requester: FocusRequester, favoriteRequester: FocusRequester?, favorite: Boolean,
    onFocus: (String, Boolean) -> Unit, onOpen: () -> Unit, onFavorite: (Boolean) -> Unit,
) {
    Row(Modifier.fillMaxWidth().height(70.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        FocusBox(
            onClick = onOpen,
            onLongClick = if (h.channel == null) null else ({ onFavorite(false) }),
            modifier = Modifier.weight(1f).fillMaxHeight().focusRequester(requester).testTag("search-hit:${h.key}"),
            shape = RoundedCornerShape(10.dp), color = Palette.surface, focusedColor = Palette.focus,
            ring = false, focusedScale = 1.02f, onFocus = { onFocus(h.key, it) },
        ) { f ->
            val fg = if (f) Palette.onFocus else Palette.text
            Row(Modifier.fillMaxSize().padding(horizontal = 10.dp), verticalAlignment = Alignment.CenterVertically) {
                Box(
                    Modifier.width(if (h.wide) 64.dp else 34.dp).fillMaxHeight().padding(vertical = 6.dp)
                        .clip(RoundedCornerShape(6.dp)).background(Palette.surface2),
                    contentAlignment = Alignment.Center,
                ) {
                    if (h.channel != null) ChannelLogo(h.channel, Modifier.fillMaxSize().padding(4.dp))
                    else if (!h.image.isNullOrBlank()) AsyncImage(
                        h.image, null, contentScale = if (h.wide) ContentScale.Fit else ContentScale.Crop,
                        modifier = Modifier.fillMaxSize(),
                    ) else Icon(if (h.subtitle.startsWith("Series")) Icons.Rounded.Tv else Icons.Rounded.Movie, null, tint = Palette.dim, modifier = Modifier.size(20.dp))
                }
                Column(Modifier.weight(1f).padding(start = 14.dp)) {
                    Text(h.title, color = fg, fontSize = 16.sp, lineHeight = 22.sp, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Text(h.subtitle, color = fg.copy(alpha = 0.72f), fontSize = 12.sp, lineHeight = 16.sp, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(top = 4.dp))
                }
                Icon(if (h.channel != null) Icons.Rounded.PlayArrow else Icons.Rounded.ArrowForward, null, tint = fg.copy(alpha = if (f) 1f else 0.42f), modifier = Modifier.padding(start = 16.dp, end = 10.dp).size(22.dp))
            }
        }
        if (h.channel != null && favoriteRequester != null) FocusBox(
            onClick = { onFavorite(true) }, onFocus = { onFocus(favoriteFocusKey(h), it) },
            modifier = Modifier.width(56.dp).fillMaxHeight().focusRequester(favoriteRequester)
                .testTag("search-favorite:${h.key}").semantics {
                    contentDescription = if (favorite) "Remove ${h.title} from Favorites" else "Add ${h.title} to Favorites"
                },
            color = Palette.surface, focusedColor = Palette.focus, shape = RoundedCornerShape(10.dp),
            focusedScale = 1.03f, ring = false,
        ) { focused ->
            val tint = if (focused) Palette.onFocus else if (favorite) Palette.accent else Palette.dim
            Column(Modifier.align(Alignment.Center), horizontalAlignment = Alignment.CenterHorizontally) {
                Icon(if (favorite) Icons.Rounded.Star else Icons.Rounded.StarBorder, null, tint = tint, modifier = Modifier.size(22.dp))
                Text(if (favorite) "Saved" else "Save", color = tint, fontSize = 10.sp, lineHeight = 14.sp, modifier = Modifier.padding(top = 3.dp))
            }
        }
    }
}

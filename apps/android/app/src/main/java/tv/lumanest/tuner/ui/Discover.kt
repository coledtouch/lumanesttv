package tv.lumanest.tuner.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.LocalBringIntoViewSpec
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.itemsIndexed
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.CheckCircle
import androidx.compose.material.icons.rounded.ExpandMore
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import tv.lumanest.tuner.Edition
import tv.lumanest.tuner.data.AdultFilter
import tv.lumanest.tuner.data.BrowseCatalog
import tv.lumanest.tuner.data.BrowseIndex
import tv.lumanest.tuner.data.BrowseList
import tv.lumanest.tuner.data.BrowseTitle
import tv.lumanest.tuner.data.LoadStatus
import tv.lumanest.tuner.data.Repo
import tv.lumanest.tuner.data.StreamingServices
import tv.lumanest.tuner.data.VodType
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.util.Locale

/** One Discover query and its titles, all of them: the grid scrolls without limit. */
internal class DiscoverResult(val index: BrowseIndex, val type: VodType, val list: String, val genre: String?, val usOnly: Boolean,
                              val titles: List<BrowseTitle>)

/**
 * Discover's filter choices for the catalogue, in this edition. Services are left out of the store edition, and so is
 * a genre named after one, or with an adult name: without TMDB genres, the provider's own genre words become genres.
 */
internal data class DiscoverChoices(val list: String, val genre: String?, val lists: List<BrowseList.Option>, val genres: List<Pair<String?, String>>)

internal fun discoverChoices(catalog: BrowseCatalog, type: VodType, list: String?, genre: String?, store: Boolean): DiscoverChoices {
    val offered = catalog.section(type).genres.filter { option ->
        !store || (StreamingServices.ALL.none { it.matchesCategory(option.name) } && !AdultFilter.isAdultName(option.name, strict = true) &&
            !AdultFilter.isAdultTitle(option.name, live = false))
    }
    return DiscoverChoices(
        list = catalog.validList(type, list, store),
        genre = genre?.takeIf { key -> offered.any { it.key == key } },
        lists = catalog.listOptions(type, store),
        genres = listOf<Pair<String?, String>>(null to "All") + offered.map { it.key to it.name },
    )
}

/**
 * The query result Discover may show for the current filters: the current one, or, while a same-playlist refresh
 * rebuilds the index, the previous index's result for the same filters, so the grid (and the focused poster) stay.
 * A result for other filters is never shown.
 */
internal fun discoverResultFor(result: DiscoverResult?, index: BrowseIndex?, type: VodType, choices: DiscoverChoices?, usOnly: Boolean): DiscoverResult? {
    if (result == null || index == null || choices == null) return null
    if (result.type != type || result.list != choices.list || result.genre != choices.genre || result.usOnly != usOnly) return null
    return result.takeIf { it.index === index || it.index.source == index.source }
}

private const val FILTER_TYPE = "filter:type"
private const val FILTER_LIST = "filter:list"
private const val FILTER_GENRE = "filter:genre"

/**
 * Discover (docs/browse.md): Type, List and Genre filters over a poster grid. Up from the grid's first row reaches the
 * filters; OK on a filter opens its choices. Home's See all opens it with Type and List set, and Back then returns
 * to that See all tile.
 */
@OptIn(ExperimentalFoundationApi::class)
@Composable
fun DiscoverScreen(state: AppState, store: Boolean = Edition.STORE) {
    val d = state.discover
    val source = browseSource()
    val index = currentBrowseIndex(source)
    val recents by Repo.prefs.recents.collectAsState()
    val favorites by Repo.prefs.libraryFavorites.collectAsState()
    val usOnly by Repo.prefs.vodUsOnly.collectAsState()
    val catalog = index?.catalog
    val choices = remember(catalog, d.type, d.list, d.genre, store) { catalog?.let { discoverChoices(it, d.type, d.list, d.genre, store) } }
    val result by produceState<DiscoverResult?>(null, index, d.type, choices?.list, choices?.genre, usOnly) {
        val query = index ?: return@produceState
        val picked = choices ?: return@produceState
        val type = d.type
        value = withContext(Dispatchers.Default) {
            DiscoverResult(query, type, picked.list, picked.genre, usOnly, query.catalog.section(type).titles(picked.list, usOnly, picked.genre))
        }
    }
    val shown = discoverResultFor(result, index, d.type, choices, usOnly)
    // This type failed to load and left nothing: say so (its buttons take focus) instead of "No titles match".
    val loadError = libraryLoadError(d.type)?.takeIf { catalog?.section(d.type)?.titles?.isEmpty() == true }
    val favoriteSet = remember(favorites) { favorites.toSet() }
    val progress = remember(catalog, recents) { catalog?.progressByKey(recents).orEmpty() }
    val actions = remember(state, source) { browseActions(state, source) }
    var sheet by remember { mutableStateOf<String?>(null) }
    val filterFocus = remember { mapOf(FILTER_TYPE to FocusRequester(), FILTER_LIST to FocusRequester(), FILTER_GENRE to FocusRequester()) }
    // One grid's cards: a new filter starts a new map, so scrolling many grids doesn't keep every card's handle.
    val cardFocus = remember(d.type, choices?.list, choices?.genre) { mutableMapOf<String, FocusRequester>() }

    // A series-only playlist (or one whose films failed to load) opens Discover on its series.
    LaunchedEffect(catalog) {
        val c = catalog ?: return@LaunchedEffect
        if (d.openedFrom != null || d.list != null || c.section(d.type).titles.isNotEmpty()) return@LaunchedEffect
        val other = if (d.type == VodType.MOVIES) VodType.SERIES else VodType.MOVIES
        val loading = (if (d.type == VodType.MOVIES) Repo.vodStatus.value else Repo.seriesStatus.value) is LoadStatus.Loading
        if (!loading && c.section(other).titles.isNotEmpty()) {
            d.type = other
            d.genre = null
            // The empty grid may have sent focus to the filters: the first poster takes it instead.
            if (!state.navigationFocused && sheet == null && d.focusedKey?.startsWith("discover:") != true) { d.focusedKey = null; state.restoreFocus = true }
        }
    }

    // The focused poster left the grid (a refresh removed its title): focus the one now at its place.
    LaunchedEffect(shown) {
        val titles = shown?.takeIf { it.index === index }?.titles ?: return@LaunchedEffect
        val focused = d.focusedKey ?: return@LaunchedEffect
        if (sheet == null && !state.navigationFocused && !state.restoreFocus && focused.startsWith("discover:") &&
            titles.none { "discover:${it.key}" == focused }) state.restoreFocus = true
    }

    // Back from a grid opened by Home's See all goes back to that tile.
    BackHandler(enabled = d.openedFrom != null && sheet == null && !state.navigationFocused) { state.returnHome(d.openedFrom!!) }

    LaunchedEffect(state.restoreFocus, shown, sheet, loadError) {
        if (!state.restoreFocus || sheet != null || choices == null) return@LaunchedEffect
        val wanted = d.focusedKey
        filterFocus[wanted]?.let { requester ->
            if (requestAttachedFocus(requester) { state.restoreFocus && d.focusedKey == wanted }) state.restoreFocus = false
            return@LaunchedEffect
        }
        val titles = shown?.takeIf { it.type == d.type && it.list == choices.list && it.genre == choices.genre }?.titles ?: return@LaunchedEffect
        val target = titles.indexOfFirst { "discover:${it.key}" == wanted }.takeIf { it >= 0 }
            ?: if (wanted?.startsWith("discover:") == true) d.focusedIndex.coerceIn(0, (titles.size - 1).coerceAtLeast(0)) else 0
        if (titles.isEmpty()) {
            if (loadError != null) return@LaunchedEffect
            if (requestAttachedFocus(filterFocus.getValue(FILTER_TYPE)) { state.restoreFocus }) state.restoreFocus = false
            return@LaunchedEffect
        }
        val key = "discover:${titles[target].key}"
        withFrameNanos { }
        if (d.grid.layoutInfo.visibleItemsInfo.none { it.index == target }) d.grid.scrollToItem(target)
        if (requestAttachedFocus(cardFocus.getOrPut(key) { FocusRequester() }) { state.restoreFocus && d.focusedKey == wanted }) state.restoreFocus = false
    }

    if (catalog == null || choices == null) {
        Box(Modifier.fillMaxSize().testTag("browse-preparing:discover")) { LoadingMessage("Preparing your library…") }
        return
    }

    fun focusFilter(key: String) { d.focusedKey = key; state.restoreFocus = true }

    BoxWithConstraints(Modifier.fillMaxSize().testTag("discover")) {
        val compact = maxHeight < 420.dp || maxWidth < 760.dp
        val inset = if (compact) 20.dp else 28.dp
        val spacing = 14.dp
        val target = if (compact) 92.dp else 112.dp
        val columns = ((maxWidth - inset * 2 + spacing) / (target + spacing)).toInt().coerceIn(3, 9)
        val posterWidth = (maxWidth - inset * 2 - spacing * (columns - 1)) / columns
        Column(Modifier.fillMaxSize()) {
            Row(Modifier.fillMaxWidth().padding(start = inset, end = inset, top = 8.dp, bottom = 10.dp), verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Text("Discover", color = Palette.text, fontSize = if (compact) 21.sp else 24.sp, fontWeight = FontWeight.Bold,
                    modifier = Modifier.padding(end = 8.dp))
                FilterButton("Type", d.type.label, FILTER_TYPE, filterFocus.getValue(FILTER_TYPE), onFocus = { d.focusedKey = FILTER_TYPE }) { sheet = FILTER_TYPE }
                FilterButton("List", BrowseList.name(choices.list), FILTER_LIST, filterFocus.getValue(FILTER_LIST), onFocus = { d.focusedKey = FILTER_LIST }) { sheet = FILTER_LIST }
                FilterButton("Genre", choices.genres.firstOrNull { it.first == choices.genre }?.second ?: "All", FILTER_GENRE, filterFocus.getValue(FILTER_GENRE),
                    onFocus = { d.focusedKey = FILTER_GENRE }) { sheet = FILTER_GENRE }
                Spacer(Modifier.weight(1f))
                val count = shown?.titles?.size
                if (count != null) Text(String.format(Locale.US, "%,d %s", count, if (count == 1) "title" else "titles"),
                    color = Palette.dim, fontSize = 12.sp, maxLines = 1, modifier = Modifier.testTag("discover-count"))
            }
            when {
                shown == null -> LoadingMessage("Finding titles…")
                shown.titles.isEmpty() && loadError != null -> Box(Modifier.weight(1f).fillMaxWidth()) {
                    LoadErrorWithActions(state, loadError)
                }
                shown.titles.isEmpty() -> EmptyMessage("No titles match these filters",
                    if (usOnly) "Try another list or genre, or choose Movies & Series: All in Settings." else "Try another list or genre.")
                else -> CompositionLocalProvider(LocalBringIntoViewSpec provides pivotSpec(0.04f)) {
                    LazyVerticalGrid(
                        columns = GridCells.Fixed(columns),
                        state = d.grid,
                        modifier = Modifier.weight(1f).fillMaxWidth().testTag("discover-grid"),
                        contentPadding = PaddingValues(start = inset, end = inset, top = 6.dp, bottom = 28.dp),
                        horizontalArrangement = Arrangement.spacedBy(spacing),
                        verticalArrangement = Arrangement.spacedBy(spacing),
                    ) {
                        itemsIndexed(shown.titles, key = { _, title -> title.key }) { i, title ->
                            val key = "discover:${title.key}"
                            val item = remember(title, favoriteSet, progress) { titleItem(title, favoriteSet, progress, actions) }
                            PosterCard(
                                item = item,
                                modifier = Modifier.focusRequester(cardFocus.getOrPut(key) { FocusRequester() }).testTag("card:$key"),
                                width = posterWidth,
                                compact = compact,
                                onFocusChanged = { focused -> if (focused) { d.focusedKey = key; d.focusedIndex = i; state.restoreFocus = false } },
                            )
                        }
                    }
                }
            }
        }

        when (sheet) {
            FILTER_TYPE -> ChoiceSheet("Type", VodType.entries.map { it.name to it.label }, d.type.name, onClose = { sheet = null; focusFilter(FILTER_TYPE) }) { picked ->
                val type = VodType.valueOf(picked!!)
                if (type != d.type) {
                    d.type = type
                    d.genre = null
                    d.grid.requestScrollToItem(0)
                }
            }
            FILTER_LIST -> ChoiceSheet("List", choices.lists.map { it.key to it.name }, choices.list, onClose = { sheet = null; focusFilter(FILTER_LIST) }) { picked ->
                if (picked != choices.list) { d.list = picked; d.grid.requestScrollToItem(0) }
            }
            FILTER_GENRE -> ChoiceSheet("Genre", choices.genres, choices.genre, onClose = { sheet = null; focusFilter(FILTER_GENRE) }) { picked ->
                if (picked != choices.genre) { d.genre = picked; d.grid.requestScrollToItem(0) }
            }
        }
    }
}

/** A dropdown-style filter: "Type  Movies ⌄". */
@Composable
private fun FilterButton(label: String, value: String, key: String, requester: FocusRequester, onFocus: () -> Unit, onClick: () -> Unit) {
    FocusBox(
        onClick = onClick,
        modifier = Modifier.focusRequester(requester).testTag("discover-$key").semantics { contentDescription = "$label: $value" },
        shape = RoundedCornerShape(50),
        color = Palette.surface2,
        focusedColor = Palette.focus,
        focusedScale = 1.03f,
        ring = false,
        onFocus = { if (it) onFocus() },
    ) { focused ->
        val fg = if (focused) Palette.onFocus else Palette.text
        Row(Modifier.padding(start = 14.dp, end = 8.dp, top = 8.dp, bottom = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(label.uppercase(), color = if (focused) Palette.onFocus.copy(alpha = 0.7f) else Palette.faint, fontSize = 10.sp,
                fontWeight = FontWeight.Bold, letterSpacing = 1.sp)
            Text(value, color = fg, fontSize = 14.sp, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis,
                modifier = Modifier.padding(start = 8.dp))
            Icon(Icons.Rounded.ExpandMore, null, tint = fg, modifier = Modifier.padding(start = 2.dp).size(20.dp))
        }
    }
}

/** The choices of one filter, as a side panel; OK picks one, Back keeps the current choice. */
@Composable
private fun ChoiceSheet(title: String, options: List<Pair<String?, String>>, selected: String?, onClose: () -> Unit, onPick: (String?) -> Unit) {
    val initial = remember { options.indexOfFirst { it.first == selected }.coerceAtLeast(0) }
    val list = rememberLazyListState(initialFirstVisibleItemIndex = (initial - 2).coerceAtLeast(0))
    val first = remember { FocusRequester() }
    var focusedIndex by remember { mutableStateOf(initial) }
    BackHandler { onClose() }
    LaunchedEffect(Unit) { requestAttachedFocus(first) }
    Box(Modifier.fillMaxSize().dimBackground(0.6f).testTag("discover-sheet"), contentAlignment = Alignment.CenterEnd) {
        Column(
            Modifier.width(360.dp).fillMaxHeight().background(Palette.surface).padding(start = 22.dp, end = 22.dp, top = 22.dp)
                .onPreviewKeyEvent {
                    // Keep the remote inside the panel.
                    if (it.type != KeyEventType.KeyDown) false else when (it.nativeKeyEvent.keyCode) {
                        android.view.KeyEvent.KEYCODE_DPAD_LEFT, android.view.KeyEvent.KEYCODE_DPAD_RIGHT -> true
                        android.view.KeyEvent.KEYCODE_DPAD_UP -> focusedIndex == 0
                        android.view.KeyEvent.KEYCODE_DPAD_DOWN -> focusedIndex == options.lastIndex
                        else -> false
                    }
                },
        ) {
            Text(title, color = Palette.text, fontSize = 22.sp, fontWeight = FontWeight.Bold)
            Text("OK Choose · Back Cancel", color = Palette.dim, fontSize = 12.sp, modifier = Modifier.padding(top = 4.dp, bottom = 12.dp))
            LazyColumn(state = list, modifier = Modifier.weight(1f).fillMaxWidth(), contentPadding = PaddingValues(bottom = 24.dp),
                verticalArrangement = Arrangement.spacedBy(6.dp)) {
                itemsIndexed(options, key = { _, option -> option.first ?: "" }) { i, (key, name) ->
                    val current = key == selected
                    FocusBox(
                        onClick = { onPick(key); onClose() },
                        modifier = Modifier.fillMaxWidth().height(48.dp).then(if (i == initial) Modifier.focusRequester(first) else Modifier),
                        shape = RoundedCornerShape(10.dp), color = Palette.surface2, focusedColor = Palette.focus,
                        ring = false, focusedScale = 1.02f, onFocus = { if (it) focusedIndex = i },
                    ) { f ->
                        Row(Modifier.fillMaxSize().padding(horizontal = 14.dp), verticalAlignment = Alignment.CenterVertically) {
                            Text(name, color = if (f) Palette.onFocus else Palette.text, fontSize = 15.sp, fontWeight = FontWeight.SemiBold,
                                maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
                            if (current) Icon(Icons.Rounded.CheckCircle, null, tint = if (f) Palette.onFocus else Palette.accent, modifier = Modifier.size(18.dp))
                        }
                    }
                }
            }
        }
    }
}

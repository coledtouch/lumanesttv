package tv.lumanest.tuner.ui

import androidx.activity.compose.BackHandler
import androidx.compose.animation.Crossfade
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.gestures.BringIntoViewSpec
import androidx.compose.foundation.gestures.LocalBringIntoViewSpec
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
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.ArrowForward
import androidx.compose.material.icons.rounded.Check
import androidx.compose.material.icons.rounded.Explore
import androidx.compose.material.icons.rounded.LiveTv
import androidx.compose.material.icons.rounded.Settings
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import tv.lumanest.tuner.Edition
import tv.lumanest.tuner.data.BrowseCatalog
import tv.lumanest.tuner.data.BrowseIndex
import tv.lumanest.tuner.data.BrowseTitle
import tv.lumanest.tuner.data.ContinueItem
import tv.lumanest.tuner.data.ExtrasTitle
import tv.lumanest.tuner.data.LoadStatus
import tv.lumanest.tuner.data.Movie
import tv.lumanest.tuner.data.PlayRequest
import tv.lumanest.tuner.data.Recent
import tv.lumanest.tuner.data.Repo
import tv.lumanest.tuner.data.Source
import tv.lumanest.tuner.data.SubtitleQuery
import tv.lumanest.tuner.data.VodType
import coil.compose.AsyncImage
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import java.math.BigDecimal
import java.math.RoundingMode
import kotlin.math.floor

data class BrowseItem(
    val key: String,
    val title: String,
    val image: String?,
    val badge: String? = null,
    /** A progress bar along the poster's bottom edge (a title in progress). */
    val progress: Float? = null,
    val onClick: () -> Unit,
    /** Optional extra info for the hero, resolved lazily when the item has focus. */
    val heroPlot: String? = null,
    val heroBackdrop: String? = null,
    val heroMeta: String? = null,
    val movie: Movie? = null,
    /** In the customer's Library: a check badge on the poster. */
    val favorite: Boolean = false,
    /** The tile that ends a Home row and opens Discover with that row's list. */
    val seeAll: Boolean = false,
    /** Text over the bottom of a Continue watching poster: "Resume", or "Up next" for a series' next episode. */
    val progressLabel: String? = null,
    /** Hold OK: add the title to the Library or remove it. */
    val onLongClick: (() -> Unit)? = null,
)

data class BrowseRow(val key: String, val title: String, val items: List<BrowseItem>)

internal fun contentRating(value: String?): String? {
    val rating = value?.trim()?.toFloatOrNull()?.takeIf { it > 0f && it.isFinite() } ?: return null
    val number = rating.toDouble()
    if (number > 1_000_000.0) return BigDecimal.valueOf(number).setScale(1, RoundingMode.HALF_UP).toPlainString().removeSuffix(".0")
    val tenths = floor(number * 10 + 0.5).toLong()
    val decimal = tenths % 10
    return (tenths / 10).toString() + if (decimal == 0L) "" else ".$decimal"
}

internal data class BrowsePosition(val row: Int, val item: Int)
internal data class PreparedBrowse(
    val rows: List<BrowseRow>, val itemsByKey: Map<String, BrowseItem>, val positions: Map<String, BrowsePosition>,
)

/** Drops empty and repeated rows and items, and indexes every card by its focus key ("<prefix>:<row>:<item>"). */
internal fun prepareBrowse(prefix: String, rows: List<BrowseRow>): PreparedBrowse {
    val display = rows.distinctBy { it.key }.map { it.copy(items = it.items.distinctBy { item -> item.key }) }
        .filter { row -> row.items.any { !it.seeAll } }
    val index = HashMap<String, BrowseItem>()
    val positions = HashMap<String, BrowsePosition>()
    display.forEachIndexed { rowIndex, row -> row.items.forEachIndexed { itemIndex, item ->
        val key = "$prefix:${row.key}:${item.key}"
        index[key] = item
        positions[key] = BrowsePosition(rowIndex, itemIndex)
    } }
    return PreparedBrowse(display, index, positions)
}

/**
 * Where focus goes when the card [key] of [previous] is gone from [current] (a title removed from the Library, a row
 * that lost it): the card now at its place in the same row, the row's last card when it was the last, or the same
 * place in the row now at that position when the whole row went. Null when [previous] never had [key].
 */
internal fun nearestPosition(previous: PreparedBrowse?, current: PreparedBrowse, key: String): BrowsePosition? {
    current.positions[key]?.let { return it }
    val old = previous?.positions?.get(key) ?: return null
    if (current.rows.isEmpty()) return null
    val rowKey = previous.rows.getOrNull(old.row)?.key
    val row = current.rows.indexOfFirst { it.key == rowKey }.takeIf { it >= 0 } ?: old.row.coerceAtMost(current.rows.lastIndex)
    return BrowsePosition(row, old.item.coerceAtMost(current.rows[row].items.lastIndex))
}

// ------------------------------------------------------------------ rows for Home and Library (no Compose, tested directly)

/** What a poster does when selected; the screens navigate, tests record. */
internal class BrowseActions(
    val open: (BrowseTitle) -> Unit,
    val resume: (ContinueItem) -> Unit,
    /** A row's See all tile: the row's type and list, and the row's key (Continue watching opens the Library). */
    val seeAll: (VodType, String, String) -> Unit,
    val toggleLibrary: (BrowseTitle) -> Unit,
)

internal const val SEE_ALL = "see-all"
internal const val CONTINUE_ROW = "continue"

private fun metaOf(title: BrowseTitle): String? =
    listOfNotNull(title.series?.year ?: title.movie?.year, title.series?.genre ?: title.movie?.genre)
        .filter { it.isNotBlank() }.joinToString("  ·  ").ifBlank { null }

internal fun titleItem(title: BrowseTitle, favorites: Set<String>, progress: Map<String, Float>, actions: BrowseActions) = BrowseItem(
    key = title.key, title = title.name, image = title.image,
    badge = contentRating(title.movie?.rating ?: title.series?.rating),
    progress = progress[title.key],
    onClick = { actions.open(title) },
    heroPlot = title.series?.plot, heroBackdrop = title.series?.backdrop, heroMeta = metaOf(title),
    movie = title.movie,
    favorite = title.savedIn(favorites),
    onLongClick = { actions.toggleLibrary(title) },
)

internal fun continueItem(item: ContinueItem, favorites: Set<String>, actions: BrowseActions): BrowseItem {
    val nextUp = item.recent.nextUp
    return BrowseItem(
        key = item.title.key, title = item.title.name, image = item.title.image ?: item.recent.image,
        progress = if (nextUp) null else item.progress,
        progressLabel = if (nextUp) "Up next" else "Resume",
        onClick = { actions.resume(item) },
        heroPlot = item.title.series?.plot, heroBackdrop = item.title.series?.backdrop,
        heroMeta = if (item.title.series != null) item.recent.subtitle else metaOf(item.title),
        movie = item.title.movie,
        favorite = item.title.savedIn(favorites),
        onLongClick = { actions.toggleLibrary(item.title) },
    )
}

private fun seeAllItem(type: VodType, list: String, rowKey: String, actions: BrowseActions) =
    BrowseItem(key = SEE_ALL, title = "See all", image = null, seeAll = true, onClick = { actions.seeAll(type, list, rowKey) })

/**
 * Home (docs/browse.md): Continue watching, then Popular, Featured, each streaming service (not in the store edition),
 * Recently added and Top rated, movies before series. A row needs [BrowseCatalog.ROW_MINIMUM] titles, shows up to
 * [BrowseCatalog.ROW_LIMIT] and ends with See all.
 */
internal fun homeBrowseRows(
    catalog: BrowseCatalog, recents: List<Recent>, favorites: Set<String>, usOnly: Boolean, store: Boolean, actions: BrowseActions,
): List<BrowseRow> {
    val progress = catalog.progressByKey(recents)
    return buildList {
        val continuing = catalog.continueWatching(recents)
        if (continuing.size >= BrowseCatalog.ROW_MINIMUM) add(BrowseRow(CONTINUE_ROW, "Continue watching",
            continuing.take(BrowseCatalog.ROW_LIMIT).map { continueItem(it, favorites, actions) } +
                seeAllItem(VodType.MOVIES, CONTINUE_ROW, CONTINUE_ROW, actions)))
        catalog.homeRows(usOnly, store).forEach { row ->
            add(BrowseRow(row.id, row.title, row.titles.map { titleItem(it, favorites, progress, actions) } + seeAllItem(row.type, row.list, row.id, actions)))
        }
    }
}

/** Library: Continue watching, Favorite movies, Favorite series and Recently watched. Saved titles ignore USA only. */
internal fun libraryBrowseRows(
    catalog: BrowseCatalog, recents: List<Recent>, favorites: List<String>, watched: List<String>, actions: BrowseActions,
): List<BrowseRow> {
    val saved = favorites.toSet()
    val progress = catalog.progressByKey(recents)
    return buildList {
        catalog.continueWatching(recents).take(LIBRARY_ROW_LIMIT).takeIf { it.isNotEmpty() }
            ?.let { add(BrowseRow(CONTINUE_ROW, "Continue watching", it.map { item -> continueItem(item, saved, actions) })) }
        catalog.titlesFor(favorites, VodType.MOVIES).takeIf { it.isNotEmpty() }
            ?.let { add(BrowseRow("favorite-movies", "Favorite movies", it.map { title -> titleItem(title, saved, progress, actions) })) }
        catalog.titlesFor(favorites, VodType.SERIES).takeIf { it.isNotEmpty() }
            ?.let { add(BrowseRow("favorite-series", "Favorite series", it.map { title -> titleItem(title, saved, progress, actions) })) }
        catalog.titlesFor(watched).take(LIBRARY_ROW_LIMIT).takeIf { it.isNotEmpty() }
            ?.let { add(BrowseRow("watched", "Recently watched", it.map { title -> titleItem(title, saved, progress, actions) })) }
    }
}

private const val LIBRARY_ROW_LIMIT = 40

// ------------------------------------------------------------------ screens

@Composable
internal fun browseSource(): Source? {
    val active by Repo.prefs.activeId.collectAsState()
    val sources by Repo.prefs.sources.collectAsState()
    return remember(active, sources) { sources.firstOrNull { it.id == active } }
}

/**
 * The browse index for the playlist on screen; null while it builds or when it belongs to another playlist. An older
 * index of the same playlist keeps the screen usable during a refresh, unless it is empty: then the library is still
 * arriving, and "Preparing" beats a moment of "No movies or series yet".
 */
@Composable
internal fun currentBrowseIndex(source: Source?): BrowseIndex? {
    val index by Repo.browse.collectAsState()
    val movies by Repo.movies.collectAsState()
    val series by Repo.series.collectAsState()
    return index?.takeIf { it.source == source && (!it.catalog.isEmpty || (it.movies === movies && it.series === series)) }
}

/** The catalogue title behind [key], if this playlist still has it. Saved screens can outlive a refresh. */
internal fun liveTitle(source: Source?, key: String): BrowseTitle? =
    Repo.browse.value?.takeIf { Repo.activeSource == source && it.source == source }?.catalog?.get(key)

/** Opening, resuming and saving titles from any poster. */
internal fun browseActions(state: AppState, source: Source?) = BrowseActions(
    open = { title ->
        val current = liveTitle(source, title.key)
        when {
            current?.movie != null -> state.push(Screen.MovieDetail(current.movie))
            current?.series != null -> state.push(Screen.SeriesDetail(current.series))
            else -> Toasts.show("This title changed. Open it again.")
        }
    },
    resume = { item ->
        val current = liveTitle(source, item.title.key)
        val movie = current?.movie
        val recent = item.recent
        when {
            // A series opens on its page, with Resume (or the next episode) focused and the episodes after it queued.
            current?.series != null -> state.push(Screen.SeriesDetail(current.series))
            movie != null && (movie.url == recent.url || recent.url in movie.backups) -> state.push(Screen.Player(PlayRequest.Vod(
                movie.id, movie.name, recent.subtitle, movie.poster ?: recent.image, movie.url, recent.positionMs,
                streamBackups = movie.backups, titleKey = current.key,
                extras = SubtitleQuery.movie(ExtrasTitle.movie(movie, current.tmdbId)),
            )))
            else -> Toasts.show("This title changed. Open it again.")
        }
    },
    seeAll = { type, list, rowKey ->
        if (list == CONTINUE_ROW) state.openLibrary(from = "home:$rowKey:$SEE_ALL")
        else state.openDiscover(type, list, from = "home:$rowKey:$SEE_ALL")
    },
    toggleLibrary = { title ->
        val added = Repo.prefs.toggleLibraryFavorite(title.key, title.aliasKeys)
        Toasts.show(if (added) "${title.name} added to your Library" else "${title.name} removed from your Library")
    },
)

private class PreparedResult(val source: Source?, val input: Any, val browse: PreparedBrowse)
private data class RefreshFocus(val key: String?, val navigationRequest: Int, val previous: PreparedBrowse?)
private class PreparedHolder { var last: PreparedBrowse? = null }

/**
 * Builds a screen's rows off the main thread. While the same playlist prepares a refresh, the previous rows (and the
 * focused card) stay usable; a result for another playlist is never shown.
 */
@Composable
private fun rememberPreparedBrowse(prefix: String, source: Source?, input: Any?, current: () -> Boolean, rows: () -> List<BrowseRow>): PreparedBrowse? {
    var completed by remember(prefix) { mutableStateOf<PreparedResult?>(null) }
    LaunchedEffect(prefix, input) {
        if (input == null) return@LaunchedEffect
        val prepared = withContext(Dispatchers.Default) { prepareBrowse(prefix, rows()) }
        if (current()) completed = PreparedResult(source, input, prepared)
    }
    return completed?.takeIf { it.input === input || it.source == source }?.browse
}

private class RowsInput(val index: BrowseIndex, val recents: List<Recent>, val favorites: List<String>, val watched: List<String>,
                        val usOnly: Boolean, val store: Boolean)

/** Home: horizontal poster rows, each ending with See all. [store] leaves out the streaming-service rows. */
@Composable
fun BrowseHomeScreen(state: AppState, store: Boolean = Edition.STORE) {
    val source = browseSource()
    val index = currentBrowseIndex(source)
    val recents by Repo.prefs.recents.collectAsState()
    val favorites by Repo.prefs.libraryFavorites.collectAsState()
    val usOnly by Repo.prefs.vodUsOnly.collectAsState()
    val input = remember(index, recents, favorites, usOnly, store) {
        index?.let { RowsInput(it, recents, favorites, emptyList(), usOnly, store) }
    }
    val prepared = rememberPreparedBrowse("home", source, input, {
        input != null && Repo.browse.value === input.index && Repo.prefs.recents.value === input.recents &&
            Repo.prefs.libraryFavorites.value === input.favorites && Repo.prefs.vodUsOnly.value == input.usOnly
    }) {
        homeBrowseRows(input!!.index.catalog, input.recents, input.favorites.toSet(), input.usOnly, input.store, browseActions(state, source))
    }
    RowsContent(state, "home", prepared, state.homeList, libraryLoading()) { HomeEmpty(state, usOnly) }
}

/** Library: what the customer saved, is watching and watched lately. */
@Composable
fun LibraryScreen(state: AppState) {
    val source = browseSource()
    val index = currentBrowseIndex(source)
    val recents by Repo.prefs.recents.collectAsState()
    val favorites by Repo.prefs.libraryFavorites.collectAsState()
    val watched by Repo.prefs.watchedTitles.collectAsState()
    val input = remember(index, recents, favorites, watched) {
        index?.let { RowsInput(it, recents, favorites, watched, usOnly = false, store = false) }
    }
    val prepared = rememberPreparedBrowse("library", source, input, {
        input != null && Repo.browse.value === input.index && Repo.prefs.recents.value === input.recents &&
            Repo.prefs.libraryFavorites.value === input.favorites && Repo.prefs.watchedTitles.value === input.watched
    }) {
        libraryBrowseRows(input!!.index.catalog, input.recents, input.favorites, input.watched, browseActions(state, source))
    }
    // Back from a Library opened by Continue watching's See all goes back to that tile, as Discover does for its rows.
    BackHandler(enabled = state.libraryOpenedFrom != null && !state.navigationFocused) { state.returnHome(state.libraryOpenedFrom!!) }
    RowsContent(state, "library", prepared, state.libraryList, libraryLoading()) {
        EmptyWithActions(state, "Your Library is empty",
            "Open a movie or series and choose Add to Library, or hold OK on its poster. What you watch appears here too.",
            listOf("Discover" to { state.discover.openedFrom = null; state.tab = Tab.DISCOVER; state.restoreFocus = true }))
    }
}

/** The first-load message while movies or series are still arriving, or null. */
@Composable
private fun libraryLoading(): String? {
    val vod by Repo.vodStatus.collectAsState()
    val series by Repo.seriesStatus.collectAsState()
    return (vod as? LoadStatus.Loading ?: series as? LoadStatus.Loading)?.message
}

/**
 * A failed movie or series load ([type] only, when given), for screens it left with nothing to browse: the message
 * to show instead of "nothing here".
 */
@Composable
internal fun libraryLoadError(type: VodType? = null): String? {
    val vod by Repo.vodStatus.collectAsState()
    val series by Repo.seriesStatus.collectAsState()
    val statuses = when (type) { VodType.MOVIES -> listOf(vod); VodType.SERIES -> listOf(series); null -> listOf(vod, series) }
    return statuses.firstNotNullOfOrNull { (it as? LoadStatus.Error)?.message }
}

/** "Couldn't load your library", with the error and buttons to Live TV and Settings (where the playlist is refreshed). */
@Composable
internal fun LoadErrorWithActions(state: AppState, message: String) {
    EmptyWithActions(state, "Couldn't load your library", message, listOf(
        "Live TV" to { state.tab = Tab.GUIDE; state.restoreFocus = true },
        "Settings" to { state.tab = Tab.SETTINGS; state.restoreFocus = true },
    ))
}

@Composable
private fun HomeEmpty(state: AppState, usOnly: Boolean) {
    val index = currentBrowseIndex(browseSource())
    val empty = index == null || index.catalog.isEmpty
    val error = libraryLoadError()
    if (empty && error != null) { LoadErrorWithActions(state, error); return }
    EmptyWithActions(
        state,
        if (empty) "No movies or series yet" else "Nothing to recommend yet",
        when {
            empty -> "Your playlist has no movies or series. Live TV is ready to watch."
            usOnly -> "Too few titles pass Movies & Series: USA only for these rows. Browse everything in Discover, or choose All in Settings."
            else -> "Browse every movie and series in Discover."
        },
        buildList {
            if (!empty) add("Discover" to { state.discover.openedFrom = null; state.tab = Tab.DISCOVER; state.restoreFocus = true })
            add("Live TV" to { state.tab = Tab.GUIDE; state.restoreFocus = true })
        },
    )
}

/** An empty section with buttons that take the remote somewhere useful; the first one gets focus. */
@Composable
internal fun EmptyWithActions(state: AppState, title: String, body: String, actions: List<Pair<String, () -> Unit>>) {
    val first = remember { FocusRequester() }
    LaunchedEffect(state.restoreFocus, actions.size) {
        if (state.restoreFocus && actions.isNotEmpty() && requestAttachedFocus(first) { state.restoreFocus }) state.restoreFocus = false
    }
    Centered {
        Column(Modifier.padding(horizontal = 32.dp, vertical = 20.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            Text(title, color = Palette.text, fontSize = 20.sp, fontWeight = FontWeight.SemiBold, textAlign = TextAlign.Center)
            Text(body, color = Palette.dim, fontSize = 14.sp, maxLines = 3, overflow = TextOverflow.Ellipsis, textAlign = TextAlign.Center,
                modifier = Modifier.padding(top = 8.dp))
            Row(Modifier.padding(top = 18.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                actions.forEachIndexed { i, (label, action) ->
                    PillButton(label, action, Modifier.testTag("empty-action:$label").then(if (i == 0) Modifier.focusRequester(first) else Modifier), primary = i == 0, icon = {
                        Icon(when (label) { "Live TV" -> Icons.Rounded.LiveTv; "Settings" -> Icons.Rounded.Settings; else -> Icons.Rounded.Explore },
                            null, tint = it, modifier = Modifier.size(18.dp))
                    })
                }
            }
        }
    }
}

/** Keep the focused card clear of the screen edge, including its focus ring. */
@OptIn(ExperimentalFoundationApi::class)
internal fun pivotSpec(fraction: Float) = object : BringIntoViewSpec {
    override fun calculateScrollDistance(offset: Float, size: Float, containerSize: Float): Float {
        val pivot = (containerSize * fraction).coerceAtMost((containerSize - size).coerceAtLeast(0f))
        return offset - pivot
    }
}

/** Lazy cards may be composed a frame after their row is scrolled back into view. */
internal suspend fun requestAttachedFocus(requester: FocusRequester, allowed: () -> Boolean = { true }): Boolean {
    repeat(12) {
        withFrameNanos { }
        if (!allowed()) return false
        if (runCatching { requester.requestFocus() }.isSuccess) return true
    }
    return false
}

/**
 * A hero for the focused title over vertical rows of 2:3 posters. Focus comes back to the last focused card of this
 * screen ([AppState.rowFocus]) after a title or the player closes, and survives a same-playlist refresh.
 */
@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun RowsContent(
    state: AppState, prefix: String, prepared: PreparedBrowse?, listState: LazyListState, loading: String?,
    empty: @Composable () -> Unit,
) {
    val displayRows = prepared?.rows.orEmpty()
    val itemsByKey = prepared?.itemsByKey.orEmpty()
    var heroKey by remember(prefix) { mutableStateOf<String?>(null) }
    var focusedCardKey by remember(prefix) { mutableStateOf<String?>(null) }
    val requesters = remember(prefix) { mutableMapOf<String, FocusRequester>() }

    fun cardKey(row: BrowseRow, item: BrowseItem) = "$prefix:${row.key}:${item.key}"

    // Capture before applying new lazy rows, while a removed card still owns focus. A new
    // navigation request or a user-selected card always takes precedence over this fallback.
    // The rows shown before these, for finding the place of a card that is gone.
    val holder = remember(prefix) { PreparedHolder() }
    val refreshFocus = remember(prepared) { RefreshFocus(focusedCardKey, state.navigationRequest, holder.last).also { holder.last = prepared } }
    LaunchedEffect(prepared) {
        val key = refreshFocus.key
        if (prepared != null && key != null && state.rowFocus[prefix] == key &&
            state.top == Screen.Home && !state.navigationFocused &&
            state.navigationRequest == refreshFocus.navigationRequest && state.navigationRequest == state.handledNavigationRequest) {
            if (prepared.rows.isEmpty()) state.requestNavigation() else state.restoreFocus = true
        }
    }

    LaunchedEffect(state.restoreFocus, displayRows) {
        if (!state.restoreFocus || displayRows.isEmpty()) return@LaunchedEffect
        val previousKey = state.rowFocus[prefix]
        // A card that is gone (removed from the Library) hands focus to the one now at its place.
        val position = previousKey?.let { key -> prepared?.let { nearestPosition(refreshFocus.previous, it, key) } }
        val rowIndex = position?.row ?: 0
        val row = displayRows[rowIndex]
        val cardIndex = position?.item ?: 0
        val key = cardKey(row, row.items[cardIndex])
        val requester = requesters.getOrPut(key) { FocusRequester() }
        // Reused list states retain their last layout info after leaving the screen. Let the new
        // lazy column attach before inspecting it, then let its nested row attach before scrolling.
        withFrameNanos { }
        // Keep the existing scroll positions when the returning card is already visible.
        if (listState.layoutInfo.visibleItemsInfo.none { it.index == rowIndex }) listState.scrollToItem(rowIndex)
        withFrameNanos { }
        val rowState = state.rowState("$prefix:${row.key}")
        if (rowState.layoutInfo.visibleItemsInfo.none { it.index == cardIndex }) rowState.scrollToItem(cardIndex)
        if (requestAttachedFocus(requester) { state.restoreFocus && state.rowFocus[prefix] == previousKey }) state.restoreFocus = false
    }

    if (prepared == null) {
        Box(Modifier.fillMaxSize().testTag("browse-preparing:$prefix")) { LoadingMessage(loading ?: "Preparing your library…") }
        return
    }
    if (displayRows.isEmpty()) {
        Box(Modifier.fillMaxSize().testTag("browse-empty:$prefix")) { if (loading != null) LoadingMessage(loading) else empty() }
        return
    }

    BoxWithConstraints(Modifier.fillMaxSize().testTag("browse-content:$prefix")) {
        val compact = maxHeight < 420.dp || maxWidth < 760.dp
        val dense = maxHeight < 330.dp
        val inset = if (compact) 20.dp else 28.dp
        val heroHeight = if (dense) 62.dp else if (compact) 96.dp else 150.dp
        // Reserve the row heading and two-line title before assigning space to the artwork.
        val posterWidth = if (compact) ((maxHeight - heroHeight - 82.dp) / 1.5f).coerceIn(72.dp, 98.dp) else 112.dp
        val shown = heroKey?.let { itemsByKey[it] }?.let { item -> item to displayRows[prepared.positions.getValue(heroKey!!).row].title }
            ?: (displayRows.first().items.first() to displayRows.first().title)

        Column(Modifier.fillMaxSize()) {
            Hero(
                item = shown.first,
                label = shown.second.uppercase(),
                height = heroHeight,
                inset = inset,
                compact = compact,
                dense = dense,
                remoteHint = if (shown.first.progressLabel != null) "OK Resume · Hold OK Library · Back Tabs" else "OK Details · Hold OK Library · Back Tabs",
            )
            CompositionLocalProvider(LocalBringIntoViewSpec provides pivotSpec(0.02f)) {
                LazyColumn(
                    state = listState,
                    modifier = Modifier.weight(1f).fillMaxWidth(),
                    contentPadding = PaddingValues(top = 5.dp, bottom = 28.dp),
                ) {
                    itemsIndexed(displayRows, key = { _, row -> row.key }) { _, row ->
                        Column(Modifier.fillMaxWidth().padding(bottom = 16.dp)) {
                            Text(row.title, color = Palette.text, fontSize = if (compact) 15.sp else 17.sp, fontWeight = FontWeight.SemiBold,
                                modifier = Modifier.padding(start = inset, end = inset, bottom = 10.dp))
                            CompositionLocalProvider(LocalBringIntoViewSpec provides pivotSpec(0.04f)) {
                                LazyRow(
                                    state = state.rowState("$prefix:${row.key}"),
                                    contentPadding = PaddingValues(horizontal = inset, vertical = if (compact) 4.dp else 6.dp),
                                    horizontalArrangement = Arrangement.spacedBy(14.dp),
                                ) {
                                    itemsIndexed(row.items, key = { _, item -> item.key }) { _, item ->
                                        val key = cardKey(row, item)
                                        PosterCard(
                                            item = item,
                                            modifier = Modifier.focusRequester(requesters.getOrPut(key) { FocusRequester() }).testTag("card:$key")
                                                .then(if (item.seeAll) Modifier.semantics { contentDescription = "See all, ${row.title}" } else Modifier),
                                            width = posterWidth,
                                            compact = compact,
                                            onFocusChanged = { focused ->
                                                if (focused) {
                                                    focusedCardKey = key
                                                    if (!item.seeAll) heroKey = key
                                                    state.rowFocus[prefix] = key
                                                    state.lastFocusedKey = key
                                                    state.restoreFocus = false
                                                } else if (focusedCardKey == key) focusedCardKey = null
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
    }
}

/** A 2:3 poster with its title below, a check badge for Library titles and a progress bar for titles in progress. */
@Composable
internal fun PosterCard(item: BrowseItem, modifier: Modifier, width: Dp, compact: Boolean, onFocusChanged: (Boolean) -> Unit) {
    FocusBox(
        onClick = item.onClick,
        onLongClick = item.onLongClick,
        modifier = modifier.width(width),
        shape = RoundedCornerShape(10.dp),
        color = Palette.surface,
        focusedColor = Palette.surface2,
        focusedScale = 1.045f,
        onFocus = onFocusChanged,
    ) { focused ->
        Column {
            Box(Modifier.fillMaxWidth().height(width * 1.5f).clip(RoundedCornerShape(topStart = 10.dp, topEnd = 10.dp))
                .background(Brush.linearGradient(listOf(Palette.accent.copy(alpha = 0.14f), Palette.surface2, Palette.surface)))) {
                if (item.seeAll) {
                    Column(Modifier.align(Alignment.Center), horizontalAlignment = Alignment.CenterHorizontally) {
                        Box(Modifier.size(44.dp).clip(CircleShape).background(if (focused) Palette.accent else Palette.accent.copy(alpha = 0.18f)),
                            contentAlignment = Alignment.Center) {
                            Icon(Icons.Rounded.ArrowForward, null, tint = if (focused) Palette.onAccent else Palette.accent, modifier = Modifier.size(24.dp))
                        }
                        Text("SEE ALL", color = if (focused) Palette.text else Palette.dim, fontSize = 12.sp, fontWeight = FontWeight.Bold,
                            letterSpacing = 1.2.sp, modifier = Modifier.padding(top = 10.dp))
                    }
                } else PosterArt(item)
            }
            Text(
                if (item.seeAll) "See all" else item.title, color = if (focused) Palette.text else Palette.dim,
                fontSize = if (compact) 11.sp else 12.sp, fontWeight = FontWeight.Medium, maxLines = 2, minLines = 2,
                overflow = TextOverflow.Ellipsis, lineHeight = if (compact) 14.sp else 16.sp,
                modifier = Modifier.padding(horizontal = if (compact) 6.dp else 8.dp, vertical = if (compact) 6.dp else 7.dp),
            )
        }
    }
}

/** Artwork, the Library check badge, the rating, and the progress bar of a title in progress. */
@Composable
private fun androidx.compose.foundation.layout.BoxScope.PosterArt(item: BrowseItem) {
    // The fallback remains underneath the image for missing or failed artwork.
    Text(
        item.title, color = Palette.dim, fontSize = 14.sp, fontWeight = FontWeight.SemiBold,
        maxLines = 4, overflow = TextOverflow.Ellipsis, textAlign = TextAlign.Center,
        modifier = Modifier.align(Alignment.Center).padding(12.dp),
    )
    item.image?.takeIf { it.isNotBlank() }?.let { image ->
        AsyncImage(image, null, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
    }
    if (item.favorite) Box(
        Modifier.align(Alignment.TopStart).padding(6.dp).size(22.dp).clip(CircleShape).background(Palette.accent)
            .border(1.5.dp, Color.Black.copy(alpha = 0.35f), CircleShape).testTag("library-badge")
            .semantics { contentDescription = "In your Library" },
        contentAlignment = Alignment.Center,
    ) { Icon(Icons.Rounded.Check, null, tint = Palette.onAccent, modifier = Modifier.size(15.dp)) }
    item.badge?.takeIf { it.isNotBlank() && it != "0" && it != "0.0" }?.let { badge ->
        Text(
            "★ $badge", color = Color.White, fontSize = 10.sp, fontWeight = FontWeight.SemiBold,
            modifier = Modifier.align(Alignment.TopEnd).padding(6.dp).clip(RoundedCornerShape(5.dp))
                .background(Color.Black.copy(alpha = 0.78f)).padding(horizontal = 5.dp, vertical = 3.dp),
        )
    }
    item.progressLabel?.let { label ->
        Box(Modifier.align(Alignment.BottomCenter).fillMaxWidth().height(34.dp).background(Brush.verticalGradient(listOf(Color.Transparent, Color.Black.copy(alpha = 0.85f))))) {
            Text(label, color = Color.White, fontSize = 10.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(start = 8.dp, top = 9.dp))
        }
    }
    item.progress?.let { progress ->
        Box(Modifier.align(Alignment.BottomCenter).fillMaxWidth().height(3.dp).background(Color.Black.copy(alpha = 0.6f)).testTag("progress-bar")) {
            Box(Modifier.fillMaxHeight().fillMaxWidth(progress.coerceIn(0f, 1f)).background(Palette.accent))
        }
    }
}

@Composable
private fun Hero(item: BrowseItem, label: String, height: Dp, inset: Dp, compact: Boolean, dense: Boolean, remoteHint: String) {
    // Debounce focus changes. The repository also caches movie details across visits.
    var info by remember(item.key, item.movie?.id) { mutableStateOf<tv.lumanest.tuner.data.MovieInfo?>(null) }
    LaunchedEffect(item.key, item.movie?.id) {
        val movie = item.movie ?: return@LaunchedEffect
        delay(650)
        info = Repo.movieInfo(movie)
    }
    val backdrop = item.heroBackdrop ?: info?.backdrop
    val plot = item.heroPlot ?: info?.plot
    val meta = listOfNotNull(
        (item.heroMeta ?: info?.year)?.takeIf { it.isNotBlank() },
        info?.duration?.takeIf { it.isNotBlank() && it != "00:00:00" },
        info?.genre?.takeIf { it.isNotBlank() && item.heroMeta?.contains(it) != true },
        contentRating(item.badge ?: info?.rating)?.let { "★ $it" },
    ).joinToString("  ·  ")

    Box(Modifier.fillMaxWidth().height(height)) {
        Crossfade(backdrop ?: item.image, modifier = Modifier.fillMaxSize(), label = "library-artwork") { image ->
            Box(Modifier.fillMaxSize()) {
                if (image != null) AsyncImage(
                    image, null, contentScale = ContentScale.Crop, alpha = if (backdrop != null) 0.62f else 0.28f,
                    modifier = Modifier.fillMaxHeight().fillMaxWidth(0.65f).align(Alignment.CenterEnd),
                )
            }
        }
        Box(Modifier.fillMaxSize().background(Brush.horizontalGradient(0.25f to Palette.bg, 0.68f to Palette.bg.copy(alpha = 0.15f), 1f to Color.Transparent)))
        Box(Modifier.fillMaxSize().background(Brush.verticalGradient(0.45f to Color.Transparent, 1f to Palette.bg)))
        Text(remoteHint, color = Palette.dim, fontSize = 10.sp, maxLines = 1,
            modifier = Modifier.align(Alignment.TopEnd).padding(top = 9.dp, end = inset))
        Column(Modifier.fillMaxWidth(if (compact) 0.72f else 0.64f).padding(start = inset, top = 9.dp, end = 8.dp)) {
            Text(label, color = Palette.accent, fontSize = 10.sp, fontWeight = FontWeight.Bold, letterSpacing = 1.8.sp, maxLines = 1)
            Text(
                item.title, color = Palette.text, fontSize = if (compact) 23.sp else 29.sp,
                fontWeight = FontWeight.Bold, maxLines = if (compact) 1 else 2,
                overflow = TextOverflow.Ellipsis, lineHeight = if (compact) 27.sp else 32.sp,
                modifier = Modifier.padding(top = 5.dp),
            )
            if (!dense && meta.isNotBlank()) Text(meta, color = Palette.text.copy(alpha = 0.86f), fontSize = 12.sp, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(top = 5.dp))
            if (!compact && !plot.isNullOrBlank()) Text(
                plot, color = Palette.dim, fontSize = 13.sp, lineHeight = 18.sp, maxLines = 2,
                overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(top = 6.dp),
            ) else if (!dense && (!compact || meta.isBlank())) Text(
                if (item.progressLabel != null) "Select to pick up where you left off" else "Select a title to see details and watch",
                color = Palette.dim, fontSize = 12.sp, modifier = Modifier.padding(top = 7.dp),
            )
        }
    }
}

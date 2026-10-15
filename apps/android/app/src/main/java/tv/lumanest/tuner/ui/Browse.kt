package tv.lumanest.tuner.ui

import androidx.compose.animation.Crossfade
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
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
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
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
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import tv.lumanest.tuner.data.Category
import tv.lumanest.tuner.data.LoadStatus
import tv.lumanest.tuner.data.Movie
import tv.lumanest.tuner.data.PlayRequest
import tv.lumanest.tuner.data.Recent
import tv.lumanest.tuner.data.Repo
import tv.lumanest.tuner.data.Series
import tv.lumanest.tuner.data.Source
import coil.compose.AsyncImage
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.math.BigDecimal
import java.math.RoundingMode
import kotlin.math.floor

data class BrowseItem(
    val key: String,
    val title: String,
    val image: String?,
    val badge: String? = null,
    val progress: Float? = null,
    val onClick: () -> Unit,
    /** Optional extra info for the hero, resolved lazily when the item has focus. */
    val heroPlot: String? = null,
    val heroBackdrop: String? = null,
    val heroMeta: String? = null,
    val movie: Movie? = null,
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

internal fun prepareBrowse(prefix: String, rows: List<BrowseRow>): PreparedBrowse {
    val display = rows.distinctBy { it.key }.map { it.copy(items = it.items.distinctBy { item -> item.key }) }
        .filter { it.items.isNotEmpty() }
    val index = HashMap<String, BrowseItem>()
    val positions = HashMap<String, BrowsePosition>()
    display.forEachIndexed { rowIndex, row -> row.items.forEachIndexed { itemIndex, item ->
        val key = "$prefix:${row.key}:${item.key}"
        index[key] = item
        positions[key] = BrowsePosition(rowIndex, itemIndex)
    } }
    return PreparedBrowse(display, index, positions)
}

private class BrowseInput<T>(val source: Source?, val items: List<T>, val categories: List<Category>, val recents: List<Recent>)
private class PreparedResult(val source: Source?, val input: Any, val browse: PreparedBrowse)
private data class RefreshFocus(val key: String?, val navigationRequest: Int)

@Composable
private fun rememberPreparedBrowse(prefix: String, source: Source?, input: Any, current: () -> Boolean, rows: () -> List<BrowseRow>): PreparedBrowse? {
    var completed by remember(prefix) { mutableStateOf<PreparedResult?>(null) }
    LaunchedEffect(prefix, input) {
        val prepared = withContext(Dispatchers.Default) { prepareBrowse(prefix, rows()) }
        if (current()) completed = PreparedResult(source, input, prepared)
    }
    // Keep usable cards and their focus while this same account prepares a refresh. Source
    // compares the full configuration so changed credentials never expose an old library.
    return completed?.takeIf { it.input === input || it.source == source }?.browse
}

/** Keep the focused card clear of the screen edge, including its focus ring. */
@OptIn(ExperimentalFoundationApi::class)
private fun pivotSpec(fraction: Float) = object : BringIntoViewSpec {
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

@OptIn(ExperimentalFoundationApi::class)
@Composable
fun BrowseScreen(
    state: AppState,
    prefix: String,
    rows: List<BrowseRow>,
    listState: LazyListState,
    status: LoadStatus,
    emptyTitle: String,
) {
    val source = browseSource()
    val input = remember(prefix, source, rows) { Any() }
    val prepared = rememberPreparedBrowse(prefix, source, input, { Repo.activeSource == source }) { rows }
    BrowseContent(state, prefix, prepared, listState, status, emptyTitle)
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun BrowseContent(
    state: AppState, prefix: String, prepared: PreparedBrowse?, listState: LazyListState,
    status: LoadStatus, emptyTitle: String,
) {
    val displayRows = prepared?.rows.orEmpty()
    val itemsByKey = prepared?.itemsByKey.orEmpty()
    var heroKey by remember(prefix) { mutableStateOf<String?>(null) }
    var activeRow by remember(prefix) { mutableStateOf<String?>(null) }
    var focusedCardKey by remember(prefix) { mutableStateOf<String?>(null) }
    val requesters = remember(prefix) { mutableMapOf<String, FocusRequester>() }
    val scope = rememberCoroutineScope()

    fun cardKey(row: BrowseRow, item: BrowseItem) = "$prefix:${row.key}:${item.key}"

    // Capture before applying new lazy rows, while a removed card still owns focus. A new
    // navigation request or a user-selected card always takes precedence over this fallback.
    val refreshFocus = remember(prepared) { RefreshFocus(focusedCardKey, state.navigationRequest) }
    LaunchedEffect(prepared) {
        val key = refreshFocus.key
        if (prepared != null && key != null && state.lastFocusedKey == key &&
            state.top == Screen.Home && !state.navigationFocused &&
            state.navigationRequest == refreshFocus.navigationRequest && state.navigationRequest == state.handledNavigationRequest) {
            if (prepared.rows.isEmpty()) state.requestNavigation() else state.restoreFocus = true
        }
    }

    LaunchedEffect(state.restoreFocus, displayRows) {
        if (!state.restoreFocus || displayRows.isEmpty()) return@LaunchedEffect
        val previousKey = state.lastFocusedKey
        val position = previousKey?.let { prepared?.positions?.get(it) }
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
        if (requestAttachedFocus(requester) { state.restoreFocus && state.lastFocusedKey == previousKey }) state.restoreFocus = false
    }

    if (prepared == null) {
        Box(Modifier.fillMaxSize().testTag("browse-preparing:$prefix")) { LoadingMessage("Preparing your library…") }
        return
    }
    if (displayRows.isEmpty()) {
        when (status) {
            is LoadStatus.Loading -> LoadingMessage(status.message)
            is LoadStatus.Error -> EmptyMessage("Couldn't load your library", status.message)
            else -> EmptyMessage(emptyTitle, "Add or refresh your playlist in Settings to find more to watch.")
        }
        return
    }

    BoxWithConstraints(Modifier.fillMaxSize().testTag("browse-content:$prefix")) {
        val compact = maxHeight < 420.dp || maxWidth < 760.dp
        val dense = maxHeight < 330.dp
        val inset = if (compact) 20.dp else 28.dp
        val heroHeight = if (dense) 62.dp else if (compact) 96.dp else 160.dp
        val categoryHeight = if (displayRows.size > 1) 43.dp else 0.dp
        // Reserve the row heading and two-line title before assigning space to the artwork.
        val posterWidth = if (compact) ((maxHeight - heroHeight - categoryHeight - 82.dp) / 1.48f).coerceIn(72.dp, 98.dp) else 112.dp
        val shownHero = heroKey?.let { itemsByKey[it] } ?: displayRows.first().items.first()

        Column(Modifier.fillMaxSize()) {
            Hero(
                item = shownHero,
                label = if (shownHero.progress != null) "CONTINUE WATCHING" else if (prefix == "movies") "MOVIES" else "SERIES",
                height = heroHeight,
                inset = inset,
                compact = compact,
                dense = dense,
                remoteHint = if (shownHero.progress != null) "OK Resume · Back Tabs" else "OK Details · Back Tabs",
            )
            if (displayRows.size > 1) {
                LazyRow(
                    modifier = Modifier.fillMaxWidth().padding(bottom = 6.dp),
                    contentPadding = PaddingValues(horizontal = inset, vertical = 4.dp),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    itemsIndexed(displayRows, key = { _, row -> row.key }) { index, row ->
                        val selected = (activeRow ?: displayRows.first().key) == row.key
                        FocusBox(
                            onClick = {
                                scope.launch {
                                    listState.scrollToItem(index)
                                    val horizontal = state.rowState("$prefix:${row.key}")
                                    val cardIndex = horizontal.firstVisibleItemIndex.coerceIn(row.items.indices)
                                    val key = cardKey(row, row.items[cardIndex])
                                    val requester = requesters.getOrPut(key) { FocusRequester() }
                                    requestAttachedFocus(requester)
                                }
                            },
                            shape = RoundedCornerShape(50),
                            color = if (selected) Palette.accent.copy(alpha = 0.18f) else Palette.surface,
                            focusedColor = Palette.focus,
                            focusedScale = 1.02f,
                            ring = false,
                        ) { focused ->
                            Text(
                                row.title,
                                color = if (focused) Palette.onFocus else if (selected) Palette.accent else Palette.dim,
                                fontSize = 12.sp, fontWeight = FontWeight.SemiBold, maxLines = 1,
                                modifier = Modifier.padding(horizontal = 14.dp, vertical = 7.dp),
                            )
                        }
                    }
                }
            }
            CompositionLocalProvider(LocalBringIntoViewSpec provides pivotSpec(0.02f)) {
                LazyColumn(
                    state = listState,
                    modifier = Modifier.weight(1f).fillMaxWidth(),
                    contentPadding = PaddingValues(top = 5.dp, bottom = 28.dp),
                ) {
                    itemsIndexed(displayRows, key = { _, row -> row.key }) { _, row ->
                        Column(Modifier.fillMaxWidth().padding(bottom = 16.dp)) {
                            Row(
                                Modifier.fillMaxWidth().padding(start = inset, end = inset, bottom = 10.dp),
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Text(row.title, color = Palette.text, fontSize = if (compact) 15.sp else 17.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f))
                                Text("${row.items.size} " + if (row.items.size == 1) "title" else "titles", color = Palette.faint, fontSize = 11.sp)
                            }
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
                                            modifier = Modifier.focusRequester(requesters.getOrPut(key) { FocusRequester() }),
                                            width = posterWidth,
                                            compact = compact,
                                            onFocusChanged = { focused ->
                                                if (focused) focusedCardKey = key
                                                else if (focusedCardKey == key) focusedCardKey = null
                                            },
                                            onFocused = {
                                                heroKey = key
                                                activeRow = row.key
                                                state.lastFocusedKey = key
                                                state.restoreFocus = false
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

@Composable
private fun PosterCard(item: BrowseItem, modifier: Modifier, onFocused: () -> Unit, onFocusChanged: (Boolean) -> Unit, width: Dp, compact: Boolean) {
    FocusBox(
        onClick = item.onClick,
        modifier = modifier.width(width),
        shape = RoundedCornerShape(10.dp),
        color = Palette.surface,
        focusedColor = Palette.surface2,
        focusedScale = 1.045f,
        onFocus = { onFocusChanged(it); if (it) onFocused() },
    ) { focused ->
        Column {
            Box(Modifier.fillMaxWidth().height(width * 1.48f).clip(RoundedCornerShape(topStart = 10.dp, topEnd = 10.dp)).background(Brush.linearGradient(listOf(Palette.accent.copy(alpha = 0.14f), Palette.surface2, Palette.surface)))) {
                // The fallback remains underneath the image for missing or failed artwork.
                Text(
                    item.title, color = Palette.dim, fontSize = 14.sp, fontWeight = FontWeight.SemiBold,
                    maxLines = 4, overflow = TextOverflow.Ellipsis, textAlign = TextAlign.Center,
                    modifier = Modifier.align(Alignment.Center).padding(12.dp),
                )
                item.image?.takeIf { it.isNotBlank() }?.let { image ->
                    AsyncImage(image, null, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
                }
                item.badge?.takeIf { it.isNotBlank() && it != "0" && it != "0.0" }?.let { badge ->
                    Text(
                        "★ $badge", color = Color.White, fontSize = 10.sp, fontWeight = FontWeight.SemiBold,
                        modifier = Modifier.align(Alignment.TopEnd).padding(6.dp).clip(RoundedCornerShape(5.dp))
                            .background(Color.Black.copy(alpha = 0.78f)).padding(horizontal = 5.dp, vertical = 3.dp),
                    )
                }
                item.progress?.let { progress ->
                    Box(Modifier.align(Alignment.BottomCenter).fillMaxWidth().height(34.dp).background(Brush.verticalGradient(listOf(Color.Transparent, Color.Black.copy(alpha = 0.85f))))) {
                        Text("Resume", color = Color.White, fontSize = 10.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(start = 8.dp, top = 9.dp))
                    }
                    Box(Modifier.align(Alignment.BottomCenter).fillMaxWidth().height(3.dp).background(Color.Black.copy(alpha = 0.6f))) {
                        Box(Modifier.fillMaxHeight().fillMaxWidth(progress.coerceIn(0f, 1f)).background(Palette.accent))
                    }
                }
            }
            Text(
                item.title, color = if (focused) Palette.text else Palette.dim,
                fontSize = if (compact) 11.sp else 12.sp, fontWeight = FontWeight.Medium, maxLines = 2, minLines = 2,
                overflow = TextOverflow.Ellipsis, lineHeight = if (compact) 14.sp else 16.sp,
                modifier = Modifier.padding(horizontal = if (compact) 6.dp else 8.dp, vertical = if (compact) 6.dp else 7.dp),
            )
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
        info?.genre?.takeIf { it.isNotBlank() },
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
            Text(label, color = Palette.accent, fontSize = 10.sp, fontWeight = FontWeight.Bold, letterSpacing = 1.8.sp)
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
                if (item.progress != null) "Select to pick up where you left off" else "Select a title to see details and watch",
                color = Palette.dim, fontSize = 12.sp, modifier = Modifier.padding(top = 7.dp),
            )
        }
    }
}

private fun <T> groupRows(
    prefix: String,
    items: List<T>,
    categories: List<Category>,
    categoriesOf: (T) -> List<String>,
    toItem: (T) -> BrowseItem,
): List<BrowseRow> {
    val byCat = LinkedHashMap<String, MutableList<T>>()
    items.forEach { item -> categoriesOf(item).ifEmpty { listOf("") }.distinct().forEach { category -> byCat.getOrPut(category) { mutableListOf() } += item } }
    val known = categories.map { it.id }.toSet()
    val rows = categories.mapNotNull { category ->
        byCat[category.id]?.takeIf { it.isNotEmpty() }?.let { BrowseRow("$prefix${category.id}", category.name, it.map(toItem)) }
    }
    val orphans = byCat.filterKeys { it !in known }.values.flatten().distinct()
    return if (orphans.isEmpty()) rows else rows + BrowseRow("${prefix}other", if (rows.isEmpty()) "All Titles" else "More to Watch", orphans.map(toItem))
}

/** Resume only the same playable item in the currently eligible catalog. Provider ids can collide. */
internal fun eligibleMovieRecents(recents: List<Recent>, movies: List<Movie>): List<Recent> {
    val moviesById = movies.associateBy { it.id }
    return recents.mapNotNull { recent ->
        val movie = moviesById[recent.id]?.takeIf { it.url.isNotBlank() && (it.url == recent.url || recent.url in it.backups) }
            ?: return@mapNotNull null
        recent.copy(title = movie.name, image = movie.poster, url = movie.url)
    }
}

internal fun eligibleSeriesRecents(recents: List<Recent>, series: List<Series>): List<Recent> {
    val currentTitles = series.map { it.name }.toHashSet()
    return recents.filter { it.id.startsWith("e:") && it.url.isNotBlank() && it.title in currentTitles }
}

fun recentsRow(recents: List<Recent>, kindPrefix: List<String>, state: AppState): BrowseRow? {
    val current = if (kindPrefix.all { it == "e:" }) eligibleSeriesRecents(recents, Repo.series.value)
        else eligibleMovieRecents(recents, Repo.movies.value)
    val list = current
        .filter { recent -> kindPrefix.any { recent.id.startsWith(it) } }
    return resumeBrowseRow(list) { recent ->
        val movie = Repo.movies.value.firstOrNull { it.id == recent.id && it.url == recent.url }
        state.push(Screen.Player(PlayRequest.Vod(recent.id, recent.title, recent.subtitle, recent.image, recent.url, recent.positionMs, streamBackups = movie?.backups.orEmpty())))
    }
}

private fun resumeBrowseRow(list: List<Recent>, onResume: (Recent) -> Unit): BrowseRow? {
    if (list.isEmpty()) return null
    return BrowseRow("continue", "Continue Watching", list.map { recent ->
        BrowseItem(
            key = recent.id, title = recent.title, image = recent.image,
            heroMeta = recent.subtitle,
            progress = if (recent.durationMs > 0) recent.positionMs.toFloat() / recent.durationMs else 0f,
            onClick = { onResume(recent) },
        )
    })
}

internal fun movieBrowseRows(
    movies: List<Movie>, cats: List<Category>, recents: List<Recent>,
    onMovie: (Movie) -> Unit, onResume: (Recent) -> Unit,
): List<BrowseRow> {
    val items = HashMap<String, BrowseItem>()
    fun item(movie: Movie) = items.getOrPut(movie.id) {
        BrowseItem(key = movie.id, title = movie.name, image = movie.poster, badge = contentRating(movie.rating),
            movie = movie, onClick = { onMovie(movie) })
    }
    return buildList {
        resumeBrowseRow(eligibleMovieRecents(recents, movies).filter { it.id.startsWith("m:") || it.id.startsWith("mu:") }, onResume)?.let { add(it) }
        if (movies.any { it.added > 0 }) add(BrowseRow("recent", "Recently Added", movies.sortedByDescending { it.added }.take(40).map(::item)))
        addAll(groupRows("c", movies, cats, { it.categoryIds }, ::item))
    }
}

internal fun seriesBrowseRows(
    series: List<Series>, cats: List<Category>, recents: List<Recent>,
    onSeries: (Series) -> Unit, onResume: (Recent) -> Unit,
): List<BrowseRow> {
    val items = HashMap<String, BrowseItem>()
    fun item(series: Series) = items.getOrPut(series.id) {
        BrowseItem(key = series.id, title = series.name, image = series.cover, badge = contentRating(series.rating),
            heroPlot = series.plot, heroBackdrop = series.backdrop,
            heroMeta = listOfNotNull(series.year, series.genre).filter { it.isNotBlank() }.joinToString("  ·  ").ifBlank { null },
            onClick = { onSeries(series) })
    }
    return buildList {
        resumeBrowseRow(eligibleSeriesRecents(recents, series), onResume)?.let { add(it) }
        if (series.any { it.added > 0 }) add(BrowseRow("recent", "Recently Updated", series.sortedByDescending { it.added }.take(40).map(::item)))
        addAll(groupRows("c", series, cats, { it.categoryIds }, ::item))
    }
}

@Composable
private fun browseSource(): Source? {
    val active by Repo.prefs.activeId.collectAsState()
    val sources by Repo.prefs.sources.collectAsState()
    return remember(active, sources) { sources.firstOrNull { it.id == active } }
}

@Composable
fun MoviesScreen(state: AppState) {
    val movies by Repo.movies.collectAsState()
    val cats by Repo.movieCategories.collectAsState()
    val status by Repo.vodStatus.collectAsState()
    val recents by Repo.prefs.recents.collectAsState()
    val source = browseSource()
    val input = remember(source, movies, cats, recents) { BrowseInput(source, movies, cats, recents) }
    val prepared = rememberPreparedBrowse("movies", source, input, {
        Repo.activeSource == input.source && Repo.movies.value === input.items &&
            Repo.movieCategories.value === input.categories && Repo.prefs.recents.value === input.recents
    }) {
        movieBrowseRows(input.items, input.categories, input.recents, onMovie = { movie ->
            if (Repo.activeSource == input.source && Repo.movies.value.any { it.id == movie.id && it.url == movie.url }) state.push(Screen.MovieDetail(movie))
            else Toasts.show("This movie changed. Open the library again.")
        }, onResume = { recent ->
            val movie = Repo.movies.value.firstOrNull { it.id == recent.id && it.url == recent.url }
            if (Repo.activeSource == input.source && movie != null) {
                state.push(Screen.Player(PlayRequest.Vod(recent.id, recent.title, recent.subtitle, recent.image, recent.url, recent.positionMs, streamBackups = movie.backups)))
            } else Toasts.show("This movie changed. Open the library again.")
        })
    }
    BrowseContent(state, "movies", prepared, state.moviesList, status, "No movies in this playlist")
}

@Composable
fun SeriesScreen(state: AppState) {
    val series by Repo.series.collectAsState()
    val cats by Repo.seriesCategories.collectAsState()
    val status by Repo.seriesStatus.collectAsState()
    val recents by Repo.prefs.recents.collectAsState()
    val source = browseSource()
    val input = remember(source, series, cats, recents) { BrowseInput(source, series, cats, recents) }
    val prepared = rememberPreparedBrowse("series", source, input, {
        Repo.activeSource == input.source && Repo.series.value === input.items &&
            Repo.seriesCategories.value === input.categories && Repo.prefs.recents.value === input.recents
    }) {
        seriesBrowseRows(input.items, input.categories, input.recents, onSeries = { show ->
            if (Repo.activeSource == input.source && Repo.series.value.any { it.id == show.id }) state.push(Screen.SeriesDetail(show))
            else Toasts.show("This series changed. Open the library again.")
        }, onResume = { recent ->
            if (Repo.activeSource == input.source && eligibleSeriesRecents(listOf(recent), Repo.series.value).isNotEmpty()) {
                state.push(Screen.Player(PlayRequest.Vod(recent.id, recent.title, recent.subtitle, recent.image, recent.url, recent.positionMs)))
            } else Toasts.show("This series changed. Open the library again.")
        })
    }
    BrowseContent(state, "series", prepared, state.seriesList, status, "No series in this playlist")
}

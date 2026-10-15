package tv.lumanest.tuner.ui

import android.view.KeyEvent as AndroidKeyEvent
import androidx.activity.compose.BackHandler
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.focusable
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
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.KeyboardArrowLeft
import androidx.compose.material.icons.automirrored.rounded.KeyboardArrowRight
import androidx.compose.material.icons.rounded.Star
import androidx.compose.material.icons.rounded.StarBorder
import androidx.compose.material.icons.rounded.PlayArrow
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.focusProperties
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.nativeKeyCode
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalInputModeManager
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import tv.lumanest.tuner.data.Channel
import tv.lumanest.tuner.data.PlayRequest
import tv.lumanest.tuner.data.Program
import tv.lumanest.tuner.data.Repo
import tv.lumanest.tuner.player.PlayerHolder
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.flow.collectLatest

const val CAT_ALL = "__all"
const val CAT_FAV = "__fav"
const val CAT_HOT = "__hot"

private const val MIN = 60_000L
private const val SLOT = 30 * MIN
private const val HOUR = 60 * MIN
private const val WINDOW_MIN = 120          // visible guide width, in minutes
private const val HORIZON = 24 * HOUR       // how far ahead you can scroll
/** Holding OK this long toggles a favorite. */
internal const val LONG_PRESS_MS = 600L
private val ROW_H = 52.dp

/** Start from the event we receive; some remotes and test injectors supply a zero downTime. */
internal class GuideOkPress {
    private var startedAt: Long? = null

    fun heldMs(eventTime: Long, repeatCount: Int, down: Boolean): Long {
        if (down && (repeatCount == 0 || startedAt == null)) startedAt = eventTime
        val held = startedAt?.let { (eventTime - it).coerceAtLeast(0) } ?: 0L
        if (!down) reset()
        return held
    }

    fun reset() { startedAt = null }
}

/** Browsing never tunes. A new guide session may resume only a known last-watched channel. */
internal class GuidePreviewSession {
    private var initialized = false
    private var watched: Channel? = null

    fun update(
        channels: List<Channel>, trending: List<Channel>, previewOn: Boolean,
        currentUrl: String?, isLive: Boolean, lastChannelKey: String?, start: (Channel) -> Unit,
    ): Channel? {
        if (currentUrl != null) {
            initialized = true
            fun matches(c: Channel) = currentUrl == c.url || currentUrl in c.backups
            watched = if (isLive) channels.firstOrNull(::matches) ?: trending.firstOrNull(::matches)
                ?: watched?.takeIf(::matches) else null
            return watched
        }
        watched = null
        if (previewOn && !initialized && lastChannelKey != null) {
            val last = channels.firstOrNull { it.key == lastChannelKey }
                ?: trending.firstOrNull { it.key == lastChannelKey }
            if (last != null) {
                initialized = true
                watched = last
                start(last)
            }
        }
        return watched
    }
}

/** Resolve personal history against today's allowed lineup, with provider picks for a new library. */
internal fun mostWatchedLineup(channels: List<Channel>, trending: List<Channel>, watchedKeys: List<String>): List<Channel> {
    if (watchedKeys.isEmpty()) return trending.distinctBy { it.key }
    val byKey = channels.associateByTo(HashMap()) { it.key }
    trending.forEach { channel -> if (!byKey.containsKey(channel.key)) byKey[channel.key] = channel }
    val personal = watchedKeys.distinct().mapNotNull(byKey::get).take(50)
    return personal.ifEmpty { trending.distinctBy { it.key } }
}

fun floor30(t: Long) = t - t % SLOT

/** Guide position that survives leaving the guide (detail pages, full-screen player). */
class GuideState {
    var category by mutableStateOf(CAT_ALL)
    var row by mutableIntStateOf(0)
    /** Start of the focused program (clamped to the window). 0 means "whatever is on now". */
    var focusTime by mutableLongStateOf(0L)
    var windowStart by mutableLongStateOf(0L)
    val list = LazyListState()
    var pendingChannelKey by mutableStateOf<String?>(null)
    var selectedChannelKey by mutableStateOf<String?>(null)
    var initialized = false
    /** Set right before going full screen so leaving the guide doesn't stop the shared player. */
    var handoff = false

    fun reset() {
        category = CAT_ALL; row = 0; focusTime = 0; windowStart = 0
        pendingChannelKey = null; selectedChannelKey = null; initialized = false
    }

    fun focusChannel(c: Channel) { pendingChannelKey = c.key; selectedChannelKey = c.key; focusTime = 0; windowStart = 0 }
}

/** A current airing may start after the half-hour boundary; that does not make it future. */
internal fun GuideState.isBrowsingFuture(atTime: Long): Boolean = focusTime > atTime || windowStart > floor30(atTime)

/** Per-channel timelines with gaps filled by hour-long placeholder blocks, cached per guide refresh. */
private class Timelines {
    private var version = -1
    private var base = 0L
    private val map = HashMap<String, List<Program>>()

    fun get(c: Channel, from: Long, epgVersion: Int): List<Program> {
        if (version != epgVersion || base != from) { map.clear(); version = epgVersion; base = from }
        return map.getOrPut(c.key) { build(c, from, from + HORIZON) }
    }

    private fun build(c: Channel, from: Long, to: Long): List<Program> {
        val raw = Repo.programsFor(c).orEmpty()
        val out = ArrayList<Program>()
        fun fill(a: Long, b: Long) {
            var t = a
            while (t < b) {
                val next = minOf(b, t - t % HOUR + HOUR)
                out += Program(t, next, c.name, placeholder = true)
                t = next
            }
        }
        var cursor = from
        for (p in raw) {
            if (p.end <= cursor || p.start >= to) continue
            if (p.start > cursor) fill(cursor, p.start)
            out += if (p.start < cursor && out.isNotEmpty()) p.copy(start = cursor) else p
            cursor = maxOf(cursor, p.end)
        }
        if (cursor < to) fill(cursor, to)
        return out
    }
}

@Composable
fun GuideScreen(state: AppState) {
    val g = state.guide
    val all by Repo.channels.collectAsState()
    val categories by Repo.liveCategories.collectAsState()
    val favorites by Repo.prefs.favorites.collectAsState()
    val trending by Repo.trending.collectAsState()
    val watchedKeys by Repo.prefs.watchedChannelKeys.collectAsState()
    val epgVersion by Repo.epgVersion.collectAsState()
    val status by Repo.liveStatus.collectAsState()
    val now = rememberNow(30_000)
    val minTime = floor30(now)
    val scope = rememberCoroutineScope()
    val timelines = remember { Timelines() }
    val gridFocus = remember { FocusRequester() }
    var gridFocused by remember { mutableStateOf(false) }
    var digits by remember { mutableStateOf("") }
    var details by remember { mutableStateOf<Pair<Channel, Program>?>(null) }
    var longPressed by remember { mutableStateOf(false) }
    val okPress = remember { GuideOkPress() }
    val previewSession = remember { GuidePreviewSession() }
    var watchedChannel by remember { mutableStateOf<Channel?>(null) }
    val base = remember { floor30(System.currentTimeMillis()) - 6 * HOUR }

    val mostWatched = remember(all, trending, watchedKeys) { mostWatchedLineup(all, trending, watchedKeys) }
    val lineup = remember(all, g.category, favorites, trending, mostWatched) {
        when (g.category) {
            CAT_ALL -> all
            CAT_HOT -> mostWatched
            CAT_FAV -> (all + trending).filter { it.key in favorites }.distinctBy { it.key }
            else -> all.filter { g.category in it.categoryIds }
        }
    }

    if (g.windowStart < minTime) g.windowStart = minTime
    if (lineup.isNotEmpty() && g.row > lineup.lastIndex) g.row = lineup.lastIndex
    val focusAt = if (g.focusTime < minTime) now else g.focusTime

    fun timeline(c: Channel) = timelines.get(c, minTime, epgVersion)
    fun programAt(c: Channel, t: Long): Program? {
        val tl = timeline(c)
        return tl.firstOrNull { it.isOnAt(t) } ?: tl.lastOrNull { it.start <= t } ?: tl.firstOrNull()
    }

    val focusedChannel = lineup.getOrNull(g.row)
    val focusedProgram = focusedChannel?.let { programAt(it, focusAt) }
    val nextProgram = focusedChannel?.let { channel ->
        focusedProgram?.let { program -> timeline(channel).firstOrNull { it.start >= program.end && !it.placeholder } }
    }

    // Restore last-watched channel the first time the guide has channels.
    LaunchedEffect(all.isNotEmpty()) {
        if (all.isNotEmpty() && !g.initialized) {
            g.initialized = true
            if (g.pendingChannelKey == null && g.selectedChannelKey == null) g.pendingChannelKey = Repo.prefs.lastChannelKey
        }
    }
    LaunchedEffect(lineup, mostWatched, g.pendingChannelKey, g.category) {
        val pending = g.pendingChannelKey
        val key = pending ?: g.selectedChannelKey
        var idx = lineup.indexOfFirst { it.key == key }
        if (pending != null && idx < 0 && all.any { it.key == key } && g.category != CAT_ALL) { g.category = CAT_ALL; return@LaunchedEffect }
        if (pending != null && idx < 0 && mostWatched.any { it.key == key } && g.category != CAT_HOT) { g.category = CAT_HOT; return@LaunchedEffect }
        if (lineup.isEmpty()) return@LaunchedEffect
        if (idx < 0) idx = if (pending == null) g.row.coerceIn(0, lineup.lastIndex) else 0
        val moved = g.row != idx
        g.pendingChannelKey = null
        g.row = idx
        g.selectedChannelKey = lineup[idx].key
        if (pending != null || (moved && g.list.layoutInfo.visibleItemsInfo.none { it.index == idx }))
            g.list.scrollToItem((idx - 2).coerceAtLeast(0))
    }
    LaunchedEffect(state.restoreFocus, lineup.isNotEmpty()) {
        if (state.restoreFocus && requestAttachedFocus(gridFocus)) state.restoreFocus = false
    }

    // Keep the watched channel on screen while selection and program information move independently.
    val previewOn = Repo.prefs.guidePreview
    LaunchedEffect(all, trending, previewOn) {
        watchedChannel = previewSession.update(
            all, trending, previewOn, PlayerHolder.currentUrl, PlayerHolder.isLive, Repo.prefs.lastChannelKey,
        ) { c ->
            PlayerHolder.play(c.url, live = true, backups = c.backups, key = c.key, recordWatched = false)
        }
    }
    DisposableEffect(Unit) {
        onDispose {
            if (!g.handoff && PlayerHolder.isLive) PlayerHolder.stop()
            g.handoff = false
        }
    }

    // Fill guide gaps for whatever rows are on screen.
    LaunchedEffect(lineup, epgVersion) {
        snapshotFlow { g.list.firstVisibleItemIndex }.collectLatest { firstVisible ->
            delay(350)
            if (lineup.isNotEmpty()) Repo.requestShortEpg(lineup.subList(firstVisible.coerceAtMost(lineup.lastIndex), (firstVisible + 12).coerceAtMost(lineup.size)))
        }
    }

    // Number keys jump to the channel after a short pause; OK starts watching it.
    LaunchedEffect(digits) {
        if (digits.isEmpty()) return@LaunchedEffect
        delay(1400)
        val n = digits.toIntOrNull(); digits = ""
        val idx = lineup.indexOfFirst { it.number == n }
        if (idx >= 0) { g.row = idx; g.selectedChannelKey = lineup[idx].key; g.focusTime = 0; g.windowStart = minTime; g.list.scrollToItem((idx - 2).coerceAtLeast(0)) }
        else if (n != null) Toasts.show("Channel $n isn't in this list")
    }

    fun tune(c: Channel) {
        g.handoff = true
        Repo.prefs.lastChannelKey = c.key
        val playbackLineup = if (lineup.any { it.key == c.key }) lineup
            else (all + trending + c).distinctBy { it.key }
        state.push(Screen.Player(PlayRequest.Live(c, playbackLineup)))
    }

    fun toggleFavorite(c: Channel) {
        val added = Repo.prefs.toggleFavorite(c.key)
        Toasts.show(if (added) "${c.name} added to Favorites" else "${c.name} removed from Favorites")
    }

    fun returnToNow() {
        g.focusTime = 0
        g.windowStart = floor30(System.currentTimeMillis())
        runCatching { gridFocus.requestFocus() }
    }

    val density = LocalDensity.current
    fun scrollToRow(row: Int, fast: Boolean) {
        scope.launch {
            val info = g.list.layoutInfo
            val rowPx = info.visibleItemsInfo.firstOrNull()?.size?.toFloat() ?: with(density) { ROW_H.toPx() }
            val fit = (info.viewportSize.height / rowPx).toInt().coerceAtLeast(3)
            val first = g.list.firstVisibleItemIndex
            val target = when {
                row < first + 1 -> (row - 1).coerceAtLeast(0)
                row > first + fit - 2 -> row - fit + 2
                else -> return@launch
            }
            if (fast) g.list.scrollToItem(target) else g.list.animateScrollToItem(target)
        }
    }

    fun moveRow(delta: Int, fast: Boolean) {
        if (lineup.isEmpty()) return
        val r = (g.row + delta).coerceIn(0, lineup.lastIndex)
        if (r == g.row) return
        g.row = r
        g.selectedChannelKey = lineup[r].key
        scrollToRow(r, fast)
    }

    fun focusProgram(p: Program) {
        g.focusTime = maxOf(p.start, minTime)
        val winEnd = g.windowStart + WINDOW_MIN * MIN
        if (p.start >= winEnd - SLOT) g.windowStart = maxOf(minTime, floor30(p.start) - SLOT)
        else if (p.start < g.windowStart) g.windowStart = maxOf(minTime, floor30(p.start))
        g.windowStart = minOf(g.windowStart, minTime + HORIZON - WINDOW_MIN * MIN)
    }

    fun openProgram(index: Int, c: Channel, p: Program) {
        g.row = index
        g.selectedChannelKey = c.key
        focusProgram(p)
        runCatching { gridFocus.requestFocus() }
        if (p.isOnAt(now) || p.placeholder) tune(c) else details = c to p
    }

    fun onKey(code: Int, repeat: Int, longPress: Boolean, down: Boolean, heldMs: Long = 0): Boolean {
        // Read position from state, not from the last composition: several key events can land in one frame.
        val c = lineup.getOrNull(g.row)
        val cur = c?.let { programAt(it, if (g.focusTime < minTime) now else g.focusTime) }
        if (details != null) return false
        if (!down) {
            if (code == AndroidKeyEvent.KEYCODE_DPAD_CENTER || code == AndroidKeyEvent.KEYCODE_ENTER) {
                if (longPressed) { longPressed = false; return true }
                // Remotes that send no repeats while OK is held still report the hold on release.
                if (heldMs >= LONG_PRESS_MS && c != null) { toggleFavorite(c); return true }
                if (c != null && cur != null) {
                    if (cur.start <= now || cur.placeholder) tune(c) else details = c to cur
                }
                return true
            }
            return false
        }
        val fast = repeat > 0
        when (code) {
            AndroidKeyEvent.KEYCODE_DPAD_CENTER, AndroidKeyEvent.KEYCODE_ENTER -> {
                if (longPress && c != null && !longPressed) {
                    longPressed = true
                    toggleFavorite(c)
                }
                return true
            }
            AndroidKeyEvent.KEYCODE_DPAD_DOWN -> { moveRow(1, fast); return true }
            AndroidKeyEvent.KEYCODE_DPAD_UP -> {
                if (g.row == 0) return false
                moveRow(-1, fast); return true
            }
            AndroidKeyEvent.KEYCODE_CHANNEL_DOWN, AndroidKeyEvent.KEYCODE_PAGE_DOWN -> { moveRow(6, true); return true }
            AndroidKeyEvent.KEYCODE_CHANNEL_UP, AndroidKeyEvent.KEYCODE_PAGE_UP -> { moveRow(-6, true); return true }
            AndroidKeyEvent.KEYCODE_DPAD_RIGHT -> {
                val p = cur ?: return true
                val next = timeline(c!!).firstOrNull { it.start >= p.end } ?: return true
                focusProgram(next); return true
            }
            AndroidKeyEvent.KEYCODE_DPAD_LEFT -> {
                val p = cur ?: return true
                val prev = timeline(c!!).lastOrNull { it.end <= p.start && it.end > minTime } ?: return true
                focusProgram(prev); return true
            }
            AndroidKeyEvent.KEYCODE_MEDIA_FAST_FORWARD -> {
                g.windowStart = minOf(minTime + HORIZON - WINDOW_MIN * MIN, g.windowStart + 2 * HOUR)
                g.focusTime = g.windowStart; return true
            }
            AndroidKeyEvent.KEYCODE_MEDIA_REWIND -> {
                g.windowStart = maxOf(minTime, g.windowStart - 2 * HOUR)
                g.focusTime = if (g.windowStart == minTime) 0 else g.windowStart; return true
            }
            in AndroidKeyEvent.KEYCODE_0..AndroidKeyEvent.KEYCODE_9 -> {
                if (digits.length < 5) digits += (code - AndroidKeyEvent.KEYCODE_0).toString()
                return true
            }
        }
        return false
    }

    BackHandler(enabled = details == null && (gridFocused || g.isBrowsingFuture(System.currentTimeMillis()))) {
        if (g.isBrowsingFuture(System.currentTimeMillis())) returnToNow()
        else state.requestNavigation()
    }

    BoxWithConstraints(Modifier.fillMaxSize()) {
        val compact = maxWidth < 720.dp || maxHeight < 400.dp
        val edge = if (compact) 18.dp else 28.dp
        val headerHeight = if (compact) 116.dp else 144.dp
        val previewWidth = if (compact) 180.dp else 232.dp
        Column(Modifier.fillMaxSize()) {
            // ---------- preview header ----------
            Row(
                Modifier.fillMaxWidth().height(headerHeight).padding(start = edge, end = edge, top = 6.dp, bottom = 6.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                ProgramInfo(
                    focusedChannel, focusedProgram, nextProgram, now, focusedChannel?.key in favorites,
                    compact, Modifier.weight(1f).fillMaxHeight().testTag("guide-program-info"),
                    onToggleFavorite = { focusedChannel?.let(::toggleFavorite) },
                )
                Spacer(Modifier.width(if (compact) 16.dp else 28.dp))
                PreviewWindow(
                    watchedChannel, previewOn, PlayerHolder.isLive && PlayerHolder.currentUrl != null,
                    Modifier.width(previewWidth).height(previewWidth * 9f / 16f),
                    onWatch = { watchedChannel?.let(::tune) },
                )
            }
            // ---------- category chips ----------
            CategoryChips(
                categories = categories.map { it.id to it.name },
                selected = g.category,
                hasFavorites = favorites.isNotEmpty(),
                hasTrending = trending.isNotEmpty(),
                edge = edge,
                onSelect = { id ->
                    g.category = id; g.row = 0; g.selectedChannelKey = null; g.focusTime = 0; g.windowStart = minTime
                    scope.launch { g.list.scrollToItem(0) }
                    runCatching { gridFocus.requestFocus() }
                },
            )
            // ---------- grid ----------
            Box(
                Modifier
                    .weight(1f)
                    .fillMaxWidth()
                    .testTag("guide-grid")
                    .focusRequester(gridFocus)
                    .onFocusChanged {
                        gridFocused = it.isFocused
                        if (!it.isFocused) { okPress.reset(); longPressed = false }
                    }
                    .onPreviewKeyEvent { e ->
                        val ne = e.nativeKeyEvent
                        val code = e.key.nativeKeyCode
                        val down = e.type == KeyEventType.KeyDown
                        val ok = code == AndroidKeyEvent.KEYCODE_DPAD_CENTER || code == AndroidKeyEvent.KEYCODE_ENTER
                        val held = if (ok) okPress.heldMs(ne.eventTime, ne.repeatCount, down) else 0L
                        if (ok && !down && ne.isCanceled) {
                            okPress.reset(); longPressed = false; true
                        } else onKey(code, ne.repeatCount, ne.isLongPress || (down && ne.repeatCount > 0 && held >= LONG_PRESS_MS), down, held)
                    }
                    .focusable(),
            ) {
                when {
                    lineup.isEmpty() && all.isEmpty() && status is tv.lumanest.tuner.data.LoadStatus.Loading -> LoadingMessage("Loading channels…")
                    lineup.isEmpty() && all.isEmpty() && status is tv.lumanest.tuner.data.LoadStatus.Error ->
                        EmptyMessage("Couldn't load channels", (status as tv.lumanest.tuner.data.LoadStatus.Error).message)
                    lineup.isEmpty() && g.category == CAT_FAV ->
                        EmptyMessage("No favorites yet", "Hold OK on any channel in the guide to add it here.")
                    lineup.isEmpty() && g.category == CAT_HOT && all.isNotEmpty() ->
                        EmptyMessage("No Most Watched channels yet", "Watch live TV and the channels you use most will appear here.")
                    lineup.isEmpty() && all.isNotEmpty() -> EmptyMessage("No channels in this category", "Choose All Channels or try another category.")
                    lineup.isEmpty() -> EmptyMessage("No matching USA channels", "Only USA channels with provider region labels are shown. Check your playlist in Settings.")
                    else -> GuideGrid(
                        lineup = lineup, g = g, base = base, now = now,
                        gridFocused = gridFocused, focusAt = focusAt, favorites = favorites,
                        compact = compact, edge = edge, timeline = ::timeline,
                        onProgramClick = ::openProgram,
                        onChannelClick = { index, channel ->
                            g.row = index; g.selectedChannelKey = channel.key; returnToNow(); tune(channel)
                        },
                        onFavorite = ::toggleFavorite,
                    )
                }
                if (digits.isNotEmpty()) {
                    Text(
                        digits, color = Palette.text, fontSize = 40.sp, fontWeight = FontWeight.Bold,
                        modifier = Modifier.align(Alignment.TopEnd).padding(16.dp)
                            .clip(RoundedCornerShape(12.dp)).background(Palette.surface2).padding(horizontal = 18.dp, vertical = 6.dp),
                    )
                }
            }
            if (lineup.isNotEmpty()) GuideFooter(
                row = g.row, total = lineup.size, future = g.windowStart > minTime || g.focusTime > now,
                compact = compact, edge = edge, onNow = ::returnToNow,
            )
        }
        details?.let { (c, p) ->
            ProgramDetailsDialog(c, p, favorite = c.key in favorites, onFavorite = { toggleFavorite(c) },
                onWatch = { details = null; tune(c) },
                onClose = { details = null; scope.launch { requestAttachedFocus(gridFocus) } })
        }
    }
}

// ------------------------------------------------------------------ grid

@Composable
private fun GuideGrid(
    lineup: List<Channel>,
    g: GuideState,
    base: Long,
    now: Long,
    gridFocused: Boolean,
    focusAt: Long,
    favorites: Set<String>,
    compact: Boolean,
    edge: Dp,
    timeline: (Channel) -> List<Program>,
    onProgramClick: (Int, Channel, Program) -> Unit,
    onChannelClick: (Int, Channel) -> Unit,
    onFavorite: (Channel) -> Unit,
) {
    val winMin by animateFloatAsState(
        ((g.windowStart - base) / MIN).toFloat(), tween(280, easing = FastOutSlowInEasing), label = "window",
    )
    BoxWithConstraints(Modifier.fillMaxSize().padding(end = edge)) {
        val channelW = if (compact) 168.dp else 210.dp
        val areaW = (maxWidth - channelW - 8.dp).coerceAtLeast(1.dp)
        val dpPerMin = areaW / WINDOW_MIN
        val visStart = base + (winMin * MIN).toLong()

        Column(Modifier.fillMaxSize()) {
            TimeHeader(visStart, winMin, base, channelW, areaW, dpPerMin, now, edge)
            Box(Modifier.weight(1f).fillMaxWidth()) {
                LazyColumn(state = g.list, modifier = Modifier.fillMaxSize().focusProperties { canFocus = false }) {
                    itemsIndexed(lineup, key = { _, c -> c.key }) { idx, c ->
                        val isRow = idx == g.row
                        GuideRow(
                            channel = c,
                            programs = timeline(c),
                            focusedRow = isRow,
                            gridFocused = gridFocused,
                            focusAt = focusAt,
                            winMin = winMin,
                            base = base,
                            areaW = areaW,
                            dpPerMin = dpPerMin,
                            now = now,
                            favorite = c.key in favorites,
                            channelW = channelW,
                            rowHeight = if (compact) 46.dp else ROW_H,
                            compact = compact,
                            edge = edge,
                            onProgramClick = { p -> onProgramClick(idx, c, p) },
                            onChannelClick = { onChannelClick(idx, c) },
                            onFavorite = { onFavorite(c) },
                        )
                    }
                }
                // "Now" line across the grid.
                val nowOff = (now - base) / MIN.toFloat() - winMin
                if (nowOff in 0f..WINDOW_MIN.toFloat()) {
                    Box(
                        Modifier
                            .offset(x = channelW + 8.dp + dpPerMin * nowOff)
                            .width(1.dp).fillMaxHeight()
                            .background(Palette.live.copy(alpha = 0.65f)),
                    )
                }
                // Fade at the bottom edge so rows slide in rather than cut off.
                Box(
                    Modifier.align(Alignment.BottomCenter).fillMaxWidth().height(28.dp)
                        .background(Brush.verticalGradient(listOf(Color.Transparent, Palette.bg))),
                )
            }
        }
    }
}

@Composable
private fun TimeHeader(visStart: Long, winMin: Float, base: Long, channelW: Dp, areaW: Dp, dpPerMin: Dp, now: Long, edge: Dp) {
    Row(Modifier.fillMaxWidth().height(34.dp), verticalAlignment = Alignment.CenterVertically) {
        val today = fmtDay(now) == fmtDay(visStart + SLOT)
        Text(
            if (today) "Today" else fmtDay(visStart + SLOT),
            color = Palette.text, fontSize = 12.sp, fontWeight = FontWeight.SemiBold,
            modifier = Modifier.width(channelW + 8.dp).padding(start = edge),
        )
        Box(Modifier.width(areaW).fillMaxHeight().clipToBounds()) {
            var t = floor30(visStart)
            val end = visStart + WINDOW_MIN * MIN
            while (t <= end) {
                val off = (t - base) / MIN.toFloat() - winMin
                if (off > -40) {
                    Row(Modifier.offset(x = dpPerMin * off).fillMaxHeight(), verticalAlignment = Alignment.CenterVertically) {
                        Box(Modifier.width(1.dp).height(12.dp).background(Palette.line))
                        Text(fmtTime(t), color = Palette.dim, fontSize = 12.sp, fontWeight = FontWeight.Medium, modifier = Modifier.padding(start = 8.dp))
                    }
                }
                t += SLOT
            }
            val nowOff = (now - base) / MIN.toFloat() - winMin
            if (nowOff in 0f..WINDOW_MIN.toFloat()) Box(
                Modifier.offset(x = dpPerMin * nowOff - 3.dp).align(Alignment.BottomStart)
                    .size(7.dp).clip(RoundedCornerShape(50)).background(Palette.live),
            )
        }
    }
}

@Composable
@OptIn(ExperimentalFoundationApi::class)
private fun GuideRow(
    channel: Channel,
    programs: List<Program>,
    focusedRow: Boolean,
    gridFocused: Boolean,
    focusAt: Long,
    winMin: Float,
    base: Long,
    areaW: Dp,
    dpPerMin: Dp,
    now: Long,
    favorite: Boolean,
    channelW: Dp,
    rowHeight: Dp,
    compact: Boolean,
    edge: Dp,
    onProgramClick: (Program) -> Unit,
    onChannelClick: () -> Unit,
    onFavorite: () -> Unit,
) {
    Row(Modifier.fillMaxWidth().height(rowHeight).padding(vertical = 2.dp)) {
        // Channel cell
        Row(
            Modifier
                .width(channelW).fillMaxHeight()
                .padding(start = edge - 8.dp)
                .clip(RoundedCornerShape(8.dp))
                .background(if (focusedRow) Palette.surface2 else Color.Transparent)
                .focusProperties { canFocus = false }
                .combinedClickable(onClick = onChannelClick, onLongClick = onFavorite)
                .semantics { contentDescription = "Channel ${channel.number}, ${channel.name}${if (favorite) ", favorite" else ""}" },
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(Modifier.width(3.dp).fillMaxHeight().background(if (focusedRow && gridFocused) Palette.accent else Color.Transparent))
            Text(
                channel.number.toString(), color = if (focusedRow) Palette.text else Palette.dim,
                fontSize = if (compact) 12.sp else 14.sp, fontWeight = FontWeight.SemiBold, textAlign = TextAlign.End,
                modifier = Modifier.width(if (compact) 32.dp else 40.dp),
            )
            ChannelLogo(channel, Modifier.padding(start = if (compact) 7.dp else 10.dp).size(width = if (compact) 32.dp else 40.dp, height = 28.dp))
            Text(
                channel.name, color = if (focusedRow) Palette.text else Palette.text.copy(alpha = 0.82f),
                fontSize = if (compact) 11.sp else 12.sp, fontWeight = if (focusedRow) FontWeight.SemiBold else FontWeight.Medium,
                maxLines = 2, overflow = TextOverflow.Ellipsis, lineHeight = 15.sp,
                modifier = Modifier.weight(1f).padding(start = 7.dp, end = 4.dp),
            )
            if (favorite) Icon(Icons.Rounded.Star, null, tint = Color(0xFFFFC94D), modifier = Modifier.padding(end = 6.dp).size(13.dp))
        }
        Spacer(Modifier.width(8.dp))
        // Program cells
        Box(Modifier.width(areaW).fillMaxHeight().clipToBounds()) {
            for (p in programs) {
                val l = (p.start - base) / MIN.toFloat() - winMin
                val r = (p.end - base) / MIN.toFloat() - winMin
                if (r <= 0f || l >= WINDOW_MIN) continue
                val cl = l.coerceAtLeast(0f)
                val cr = r.coerceAtMost(WINDOW_MIN.toFloat())
                val w = dpPerMin * (cr - cl) - 3.dp
                if (w < 2.dp) continue
                val focused = focusedRow && p.isOnAt(focusAt)
                val airing = p.isOnAt(now)
                ProgramCell(
                    p = p, focused = focused, highlight = focused && gridFocused, airing = airing,
                    continuesLeft = l < 0f, continuesRight = r > WINDOW_MIN,
                    modifier = Modifier.offset(x = dpPerMin * cl).width(w).fillMaxHeight()
                        .focusProperties { canFocus = false }
                        .combinedClickable(onClick = { onProgramClick(p) }, onLongClick = onFavorite),
                )
            }
        }
    }
}

@Composable
private fun ProgramCell(
    p: Program,
    focused: Boolean,
    highlight: Boolean,
    airing: Boolean,
    continuesLeft: Boolean,
    continuesRight: Boolean,
    modifier: Modifier,
) {
    val bg = when {
        highlight -> Palette.focus
        focused -> Palette.line
        airing -> Palette.cellNow
        else -> Palette.cell
    }
    val fg = when {
        highlight -> Palette.onFocus
        p.placeholder -> Palette.dim
        else -> Palette.text
    }
    Row(
        modifier.clip(RoundedCornerShape(8.dp)).background(bg)
            .border(if (highlight) 1.5.dp else 0.5.dp, if (highlight) Palette.focus else Palette.line.copy(alpha = 0.5f), RoundedCornerShape(8.dp))
            .padding(horizontal = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (continuesLeft) Icon(Icons.AutoMirrored.Rounded.KeyboardArrowLeft, null, tint = fg.copy(alpha = 0.6f), modifier = Modifier.size(16.dp))
        Column(Modifier.weight(1f)) {
            Text(
                if (p.placeholder) "Schedule unavailable" else p.title.ifBlank { "Untitled program" }, color = fg, fontSize = 13.sp,
                fontWeight = if (highlight || focused) FontWeight.SemiBold else FontWeight.Medium,
                lineHeight = 18.sp, maxLines = 1, overflow = TextOverflow.Ellipsis,
            )
            val sub = if (p.placeholder) "Watch live" else p.subtitle ?: fmtRange(p.start, p.end)
            Text(
                sub, color = fg.copy(alpha = if (highlight) 0.8f else 0.72f), fontSize = 11.sp,
                lineHeight = 14.sp, maxLines = 1, overflow = TextOverflow.Ellipsis,
            )
        }
        if (continuesRight) Icon(Icons.AutoMirrored.Rounded.KeyboardArrowRight, null, tint = fg.copy(alpha = 0.6f), modifier = Modifier.size(16.dp))
    }
}

// ------------------------------------------------------------------ header pieces

@Composable
private fun ProgramInfo(
    c: Channel?, p: Program?, next: Program?, now: Long, favorite: Boolean,
    compact: Boolean, modifier: Modifier, onToggleFavorite: () -> Unit,
) {
    Column(modifier, verticalArrangement = Arrangement.Center) {
        if (c == null) {
            Text("Your live TV guide", color = Palette.text, fontSize = if (compact) 22.sp else 28.sp, fontWeight = FontWeight.Bold)
            Text("Browse channels and see what's on next.", color = Palette.dim, fontSize = 13.sp, modifier = Modifier.padding(top = 8.dp))
            return@Column
        }
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                "${c.number}  ${c.name}", color = Palette.dim, fontSize = if (compact) 12.sp else 13.sp,
                lineHeight = 16.sp, fontWeight = FontWeight.Medium, maxLines = 1, overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f),
            )
            FocusBox(
                onClick = onToggleFavorite, shape = RoundedCornerShape(50),
                color = Color.Transparent, focusedColor = Palette.focus, ring = false,
                modifier = Modifier.padding(start = 8.dp).semantics { contentDescription = if (favorite) "Remove ${c.name} from Favorites" else "Add ${c.name} to Favorites" },
            ) { focused ->
                Row(Modifier.padding(horizontal = 8.dp, vertical = 3.dp), verticalAlignment = Alignment.CenterVertically) {
                    val tint = if (focused) Palette.onFocus else if (favorite) Palette.accent else Palette.dim
                    Icon(if (favorite) Icons.Rounded.Star else Icons.Rounded.StarBorder, null, tint = tint, modifier = Modifier.size(15.dp))
                    if (!compact) Text(if (favorite) "Saved" else "Favorite", color = tint, fontSize = 11.sp, lineHeight = 14.sp, modifier = Modifier.padding(start = 5.dp))
                }
            }
        }
        Text(
            if (p == null || p.placeholder) "Watch ${c.name}" else p.title.ifBlank { c.name },
            color = Palette.text, fontSize = if (compact) 22.sp else 25.sp, fontWeight = FontWeight.Bold,
            lineHeight = if (compact) 26.sp else 30.sp, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(top = 1.dp),
        )
        if (p != null && !p.placeholder) {
            Row(Modifier.padding(top = 3.dp), verticalAlignment = Alignment.CenterVertically) {
                if (p.isOnAt(now)) {
                    Text(
                        "ON NOW", color = Color.White, fontSize = 10.sp, lineHeight = 14.sp, fontWeight = FontWeight.Bold,
                        modifier = Modifier.clip(RoundedCornerShape(4.dp)).background(Palette.live).padding(horizontal = 6.dp, vertical = 1.dp),
                    )
                    Spacer(Modifier.width(8.dp))
                } else {
                    Text("UPCOMING", color = Palette.accent, fontSize = 10.sp, lineHeight = 14.sp, fontWeight = FontWeight.Bold)
                    Spacer(Modifier.width(8.dp))
                }
                Text(
                    fmtRange(p.start, p.end) + (if (compact && p.isOnAt(now)) "  ·  ${((p.end - now + MIN - 1) / MIN).coerceAtLeast(1)} min left"
                        else if (!compact) "  ·  " + fmtDuration(p.end - p.start) else "") + (p.subtitle?.let { "  ·  $it" } ?: ""),
                    color = Palette.text.copy(alpha = 0.9f), fontSize = if (compact) 11.sp else 12.sp, maxLines = 1, overflow = TextOverflow.Ellipsis,
                    lineHeight = 16.sp,
                )
            }
            if (p.isOnAt(now) && !compact) {
                val frac = ((now - p.start).toFloat() / (p.end - p.start).coerceAtLeast(1)).coerceIn(0f, 1f)
                Row(Modifier.padding(top = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                    Box(Modifier.width(if (compact) 140.dp else 210.dp).height(3.dp).clip(RoundedCornerShape(2.dp)).background(Palette.line)) {
                        Box(Modifier.fillMaxHeight().fillMaxWidth(frac).background(Palette.accent))
                    }
                    Text(
                        "${((p.end - now + MIN - 1) / MIN).coerceAtLeast(1)} min left",
                        color = Palette.dim, fontSize = 10.sp, lineHeight = 13.sp, modifier = Modifier.padding(start = 8.dp),
                    )
                }
            }
            if (!compact && !p.desc.isNullOrBlank()) Text(
                p.desc, color = Palette.dim, fontSize = 12.sp, maxLines = 1, overflow = TextOverflow.Ellipsis,
                lineHeight = 16.sp, modifier = Modifier.padding(top = 4.dp),
            )
            if (next != null) Text(
                "Next  ${fmtTime(next.start)}  ·  ${next.title}",
                color = Palette.text.copy(alpha = 0.85f), fontSize = if (compact) 11.sp else 12.sp,
                lineHeight = 15.sp, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(top = 4.dp),
            )
        } else {
            Text("Schedule unavailable · This channel is ready to watch live.", color = Palette.dim, fontSize = 12.sp, lineHeight = 17.sp, maxLines = 2, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(top = 6.dp))
        }
    }
}

@Composable
private fun PreviewWindow(c: Channel?, previewOn: Boolean, ready: Boolean, modifier: Modifier, onWatch: () -> Unit) {
    if (c == null) {
        Box(
            modifier.clip(RoundedCornerShape(12.dp)).background(Palette.surface)
                .border(1.dp, Palette.line, RoundedCornerShape(12.dp)),
            contentAlignment = Alignment.Center,
        ) {
            Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.padding(12.dp)) {
                Icon(Icons.Rounded.PlayArrow, null, tint = Palette.dim, modifier = Modifier.size(24.dp))
                Text("Choose a channel", color = Palette.text, fontSize = 12.sp, lineHeight = 16.sp, modifier = Modifier.padding(top = 4.dp))
                Text("Press OK to watch", color = Palette.dim, fontSize = 10.sp, lineHeight = 14.sp)
            }
        }
        return
    }
    val playing = previewOn && ready
    FocusBox(
        onClick = onWatch, modifier = modifier.testTag("guide-preview").semantics {
            contentDescription = "Watching ${c.number} ${c.name}. Press OK for full screen."
        }, shape = RoundedCornerShape(12.dp),
        color = Palette.surface, focusedScale = 1.02f,
    ) { focused ->
        Box(Modifier.fillMaxSize().border(1.dp, Palette.line, RoundedCornerShape(12.dp)), contentAlignment = Alignment.Center) {
            if (playing) VideoSurface(Modifier.fillMaxSize(), texture = true)
            else ChannelLogo(c, Modifier.size(86.dp, 48.dp))
            val err by PlayerHolder.error.collectAsState()
            if (playing && err != null) Text(
                "Preview unavailable", color = Color.White, fontSize = 12.sp,
                modifier = Modifier.clip(RoundedCornerShape(6.dp)).background(Color.Black.copy(alpha = 0.75f)).padding(8.dp),
            )
            Box(Modifier.align(Alignment.TopCenter).fillMaxWidth().height(40.dp).background(Brush.verticalGradient(listOf(Color.Black.copy(alpha = 0.75f), Color.Transparent))))
            Text(
                "Watching  ${c.number}  ${c.name}", color = Color.White, fontSize = 10.sp, lineHeight = 14.sp,
                fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis,
                modifier = Modifier.align(Alignment.TopStart).padding(horizontal = 10.dp, vertical = 8.dp),
            )
            Box(Modifier.align(Alignment.BottomCenter).fillMaxWidth().height(40.dp).background(Brush.verticalGradient(listOf(Color.Transparent, Color.Black.copy(alpha = 0.8f)))))
            Row(
                Modifier.align(Alignment.BottomStart).padding(10.dp), verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(5.dp),
            ) {
                Icon(Icons.Rounded.PlayArrow, null, tint = Color.White, modifier = Modifier.size(14.dp))
                Text(if (focused) "Return to full screen" else "OK Full screen", color = Color.White, fontSize = 10.sp, lineHeight = 14.sp, fontWeight = FontWeight.Medium)
            }
        }
    }
}

@Composable
private fun CategoryChips(
    categories: List<Pair<String, String>>,
    selected: String,
    hasFavorites: Boolean,
    hasTrending: Boolean,
    edge: Dp,
    onSelect: (String) -> Unit,
) {
    val items = remember(categories, hasTrending) { guideCategoryItems(categories, hasTrending) }
    LazyRow(
        Modifier.fillMaxWidth().height(44.dp),
        contentPadding = PaddingValues(horizontal = edge),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        items(items, key = { it.first }) { (id, name) ->
            val sel = id == selected
            FocusBox(
                onClick = { onSelect(id) },
                shape = RoundedCornerShape(50),
                color = if (sel) Palette.accent.copy(alpha = 0.25f) else Palette.surface,
                focusedColor = Palette.focus,
                ring = false,
            ) { f ->
                Text(
                    name, color = if (f) Palette.onFocus else if (sel) Palette.text else Palette.dim,
                    fontSize = 13.sp, fontWeight = if (sel) FontWeight.SemiBold else FontWeight.Medium, maxLines = 1,
                    modifier = Modifier.padding(horizontal = 14.dp, vertical = 7.dp),
                )
            }
        }
    }
}

/** Keep the user's main cable categories together before the remaining provider groups. */
@Suppress("UNUSED_PARAMETER") // Retains the existing helper API; personal Most Watched is always available.
internal fun guideCategoryItems(categories: List<Pair<String, String>>, hasTrending: Boolean): List<Pair<String, String>> {
    fun rank(name: String): Int {
        val normalized = name.uppercase(java.util.Locale.ROOT).replace(Regex("[^A-Z0-9]+"), " ").trim()
            .removePrefix("USA ").removePrefix("US ")
        return when (normalized) {
            "SPORTS" -> 0
            "PREMIUM" -> 1
            "NEWS" -> 2
            "MOVIES" -> 3
            "ENTERTAINMENT" -> 4
            "DOCUMENTARIES" -> 5
            "LOCAL NEWS" -> 6
            else -> 7
        }
    }
    return buildList {
        add(CAT_ALL to "All Channels")
        add(CAT_FAV to "Favorites")
        add(CAT_HOT to "Most Watched")
        addAll(categories.filter { it.first !in setOf(CAT_ALL, CAT_HOT, CAT_FAV) }
            .distinctBy { it.first }.sortedBy { rank(it.second) })
    }
}

@Composable
private fun GuideFooter(row: Int, total: Int, future: Boolean, compact: Boolean, edge: Dp, onNow: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().height(30.dp).padding(horizontal = edge),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text("${row + 1} / $total channels", color = Palette.dim, fontSize = 10.sp, fontWeight = FontWeight.Medium)
        Spacer(Modifier.weight(1f))
        Text(
            if (compact) "OK Watch  ·  Hold OK Favorite  ·  Back Navigation"
            else "OK Watch / details  ·  Hold OK Favorite  ·  ← → Schedule  ·  CH +/− Page  ·  Back Now / navigation",
            color = Palette.dim, fontSize = 10.sp,
        )
        if (future) {
            Spacer(Modifier.width(14.dp))
            FocusBox(onClick = onNow, color = Palette.accent.copy(alpha = 0.15f), focusedColor = Palette.focus, ring = false, shape = RoundedCornerShape(50)) { focused ->
                Text("Back to now", color = if (focused) Palette.onFocus else Palette.accent, fontSize = 10.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(horizontal = 10.dp, vertical = 4.dp))
            }
        }
    }
}

@Composable
@OptIn(androidx.compose.ui.ExperimentalComposeUiApi::class)
private fun ProgramDetailsDialog(c: Channel, p: Program, favorite: Boolean, onFavorite: () -> Unit, onWatch: () -> Unit, onClose: () -> Unit) {
    val first = remember { FocusRequester() }
    val parentInput = LocalInputModeManager.current
    BackHandler { onClose() }
    Dialog(onDismissRequest = onClose, properties = DialogProperties(usePlatformDefaultWidth = false)) {
      // Keep the remote's input mode consistent when Compose creates a separate window owner.
      CompositionLocalProvider(LocalInputModeManager provides parentInput) {
      LaunchedEffect(Unit) { requestAttachedFocus(first) }
        Box(Modifier.fillMaxSize().dimBackground(0.7f), contentAlignment = Alignment.Center) {
            Column(
                Modifier.padding(24.dp).widthIn(max = 560.dp).fillMaxWidth().heightIn(max = 420.dp)
                    .clip(RoundedCornerShape(18.dp)).background(Palette.surface).border(1.dp, Palette.line, RoundedCornerShape(18.dp))
                    .verticalScroll(rememberScrollState()).padding(24.dp),
            ) {
                Text("${c.number}  ${c.name}", color = Palette.dim, fontSize = 14.sp)
                Text(p.title, color = Palette.text, fontSize = 24.sp, fontWeight = FontWeight.Bold, modifier = Modifier.padding(top = 4.dp))
                Text(
                    fmtDay(p.start) + "  ·  " + fmtRange(p.start, p.end) + (p.subtitle?.let { "  ·  $it" } ?: ""),
                    color = Palette.text.copy(alpha = 0.85f), fontSize = 14.sp, modifier = Modifier.padding(top = 6.dp),
                )
                if (!p.desc.isNullOrBlank()) Text(
                    p.desc, color = Palette.dim, fontSize = 14.sp, lineHeight = 20.sp, maxLines = 6,
                    overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(top = 12.dp),
                )
                Row(Modifier.padding(top = 22.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    PillButton("Watch channel now", onWatch, Modifier.focusRequester(first), primary = true)
                    PillButton("Close", onClose)
                }
                PillButton(
                    if (favorite) "Saved in Favorites" else "Add to Favorites", onFavorite,
                    modifier = Modifier.padding(top = 12.dp).semantics {
                        contentDescription = if (favorite) "Remove ${c.name} from Favorites" else "Add ${c.name} to Favorites"
                    },
                    icon = { tint -> Icon(if (favorite) Icons.Rounded.Star else Icons.Rounded.StarBorder, null, tint = tint, modifier = Modifier.size(17.dp)) },
                )
      }
            }
        }
    }
}

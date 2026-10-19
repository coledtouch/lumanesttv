package tv.lumanest.tuner.ui

import androidx.activity.compose.BackHandler
import android.view.KeyEvent as AndroidKeyEvent
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.type
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.background
import androidx.compose.foundation.focusGroup
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.PlayArrow
import androidx.compose.material.icons.rounded.Explore
import androidx.compose.material.icons.rounded.Home
import androidx.compose.material.icons.rounded.LiveTv
import androidx.compose.material.icons.rounded.VideoLibrary
import androidx.compose.material.icons.rounded.Search
import androidx.compose.material.icons.rounded.Settings
import androidx.compose.material.icons.rounded.ViewWeek
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusDirection
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import tv.lumanest.tuner.Edition
import tv.lumanest.tuner.data.LoadStatus
import tv.lumanest.tuner.data.Repo
import tv.lumanest.tuner.player.TwoChannelPlayer
import kotlinx.coroutines.delay

/** Lightweight toast shown at the bottom of the home screen. */
object Toasts {
    var message by mutableStateOf<String?>(null)
    private var seq = 0
    var id by mutableStateOf(0)
        private set
    fun show(text: String) { message = text; id = ++seq }
}

/** The top-level sections. [store] is the store edition (see [Edition]): no streaming-service rows or lists. */
@Composable
fun HomeScreen(state: AppState, store: Boolean = Edition.STORE) {
    val multiViewActive by TwoChannelPlayer.active.collectAsState()
    val watchingMultiView = state.tab == Tab.MULTIVIEW && multiViewActive
    HomeNavigationBackHandler(state)
    Box(Modifier.fillMaxSize().background(Brush.verticalGradient(listOf(Palette.surface, Palette.bg, Palette.bg)))
        .onPreviewKeyEvent {
            if (!watchingMultiView && it.type == KeyEventType.KeyDown && it.nativeKeyEvent.keyCode == AndroidKeyEvent.KEYCODE_MENU) {
                state.requestNavigation(); true
            } else false
        }) {
        Column(Modifier.fillMaxSize()) {
            // Keep the content call in the same composition slot as the bar disappears.
            // Moving MultiViewScreen to another branch would dispose both video surfaces.
            if (!watchingMultiView) TopBar(state)
            if (!watchingMultiView) FirstLoadBanner()
            Box(Modifier.weight(1f).fillMaxWidth()) {
                when (state.tab) {
                    Tab.HOME -> BrowseHomeScreen(state, store)
                    Tab.GUIDE -> GuideScreen(state)
                    Tab.DISCOVER -> DiscoverScreen(state, store)
                    Tab.LIBRARY -> LibraryScreen(state)
                    Tab.MULTIVIEW -> MultiViewScreen(state)
                    Tab.SEARCH -> SearchScreen(state)
                    Tab.SETTINGS -> SettingsScreen(state, store)
                }
            }
        }
    }
}

/**
 * Back moves up one level: from a section to the top bar, then from the top bar to the section the app opens on. That
 * section follows Settings > Start on as soon as it changes, not only at the next launch.
 */
@Composable
internal fun HomeNavigationBackHandler(state: AppState) {
    val startOnLiveTv by Repo.prefs.startOnLiveTv.collectAsState()
    val applied = remember { booleanArrayOf(startOnLiveTv) }
    LaunchedEffect(startOnLiveTv) {
        if (applied[0] != startOnLiveTv) { applied[0] = startOnLiveTv; state.startTab = if (startOnLiveTv) Tab.GUIDE else Tab.HOME }
    }
    BackHandler(enabled = !state.navigationFocused || state.tab != state.startTab) {
        if (state.navigationFocused) state.tab = state.startTab
        state.requestNavigation()
    }
}

/**
 * Shown only while a section loads for the first time (its list is still empty), such as right after
 * pairing. A full provider catalogue can take a minute or two, and live channels start slowly meanwhile.
 * Background refreshes of a saved library keep the small top-bar indicator instead.
 */
@Composable
private fun FirstLoadBanner() {
    val live by Repo.liveStatus.collectAsState()
    val vod by Repo.vodStatus.collectAsState()
    val seriesStatus by Repo.seriesStatus.collectAsState()
    val channels by Repo.channels.collectAsState()
    val movies by Repo.movies.collectAsState()
    val series by Repo.series.collectAsState()
    val steps = listOf(
        Triple("Channels", live, channels.isNotEmpty()),
        Triple("Movies", vod, movies.isNotEmpty()),
        Triple("Series", seriesStatus, series.isNotEmpty()),
    )
    val firstLoad = steps.any { (_, status, hasItems) -> status is LoadStatus.Loading && !hasItems }
    AnimatedVisibility(firstLoad, enter = fadeIn(), exit = fadeOut()) {
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 28.dp, vertical = 4.dp)
                .clip(RoundedCornerShape(12.dp)).background(Palette.surface)
                .padding(horizontal = 16.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            CircularProgressIndicator(color = Palette.accent, strokeWidth = 2.dp, modifier = Modifier.size(18.dp))
            Column(Modifier.weight(1f).padding(start = 12.dp, end = 12.dp)) {
                Text("Setting up your library", color = Palette.text, fontSize = 15.sp, fontWeight = FontWeight.SemiBold)
                Text(
                    "The first load can take a minute or two. Channels may be slow to start until it finishes.",
                    color = Palette.dim, fontSize = 12.sp, maxLines = 2, overflow = TextOverflow.Ellipsis,
                )
            }
            steps.forEach { (label, status, hasItems) ->
                // A section this playlist does not have (for example Series on an M3U link) stays hidden.
                if (status is LoadStatus.Idle && !hasItems) return@forEach
                val (mark, color) = when {
                    status is LoadStatus.Loading && !hasItems -> "…" to Palette.dim
                    status is LoadStatus.Error && !hasItems -> "!" to Palette.live
                    else -> "✓" to Palette.good
                }
                Text("$label $mark", color = color, fontSize = 13.sp, fontWeight = FontWeight.SemiBold, maxLines = 1, modifier = Modifier.padding(start = 14.dp))
            }
        }
    }
}

@Composable
private fun TopBar(state: AppState) {
    val requesters = remember { Tab.entries.associateWith { FocusRequester() } }
    LaunchedEffect(state.navigationRequest) {
        val request = state.navigationRequest
        if (request > state.handledNavigationRequest && requestAttachedFocus(requesters.getValue(state.tab))) {
            state.handledNavigationRequest = request
        }
    }
    val now = rememberNow(15_000)
    val live by Repo.liveStatus.collectAsState()
    val epg by Repo.epgStatus.collectAsState()
    val vod by Repo.vodStatus.collectAsState()
    val series by Repo.seriesStatus.collectAsState()
    val focusManager = LocalFocusManager.current
    val busy = listOf(live, epg, vod, series).firstOrNull { it is LoadStatus.Loading } as? LoadStatus.Loading

    BoxWithConstraints(Modifier.fillMaxWidth()) {
    val containerWidth = maxWidth
    val wide = maxWidth >= 1000.dp
    val showClock = maxWidth >= 1000.dp
    val showBrandName = maxWidth >= 850.dp
    val inset = if (maxWidth < 720.dp) 20.dp else 28.dp
    Row(
        Modifier.fillMaxWidth().height(if (wide) 64.dp else 58.dp).padding(horizontal = inset),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            Modifier.size(28.dp).clip(RoundedCornerShape(8.dp)).background(Palette.accent),
            contentAlignment = Alignment.Center,
        ) { Icon(Icons.Rounded.PlayArrow, null, tint = Palette.onAccent, modifier = Modifier.size(22.dp)) }
        if (showBrandName) Column(Modifier.padding(start = 9.dp)) {
            Text("tuner", color = Palette.text, fontSize = 21.sp, fontWeight = FontWeight.Bold, letterSpacing = (-0.5).sp)
            Text(if (state.navigationFocused) "OK  Open" else "Back  Tabs", color = Palette.dim, fontSize = 9.sp, fontWeight = FontWeight.SemiBold, letterSpacing = 0.3.sp)
        }
        Spacer(Modifier.width(if (wide) 28.dp else 16.dp))
        Row(Modifier.weight(1f).horizontalScroll(rememberScrollState()).onFocusChanged { state.navigationFocused = it.hasFocus }.focusGroup(), horizontalArrangement = Arrangement.spacedBy(5.dp)) {
            Tab.entries.forEach { t ->
                val selected = state.tab == t
                FocusBox(
                    onClick = {
                        if (state.tab == t) {
                            when (t) {
                                Tab.HOME, Tab.DISCOVER, Tab.LIBRARY -> state.restoreFocus = true
                                else -> focusManager.moveFocus(FocusDirection.Down)
                            }
                        }
                        else {
                            if (t == Tab.DISCOVER) state.discover.openedFrom = null
                            if (t == Tab.LIBRARY) state.libraryOpenedFrom = null
                            state.tab = t; state.restoreFocus = true
                        }
                    },
                    modifier = Modifier.focusRequester(requesters.getValue(t)).semantics { this.selected = selected; contentDescription = t.title },
                    shape = RoundedCornerShape(10.dp),
                    focusedScale = 1.025f,
                    color = if (selected) Palette.accent.copy(alpha = 0.15f) else Palette.bg.copy(alpha = 0f),
                    focusedColor = Palette.focus,
                    ring = false,
                ) { f ->
                    val c = when { f -> Palette.onFocus; selected -> Palette.accent; else -> Palette.dim }
                    Row(Modifier.padding(horizontal = if (wide) 13.dp else 10.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(7.dp)) {
                    Icon(when (t) {
                        Tab.HOME -> Icons.Rounded.Home
                        Tab.GUIDE -> Icons.Rounded.LiveTv
                        Tab.DISCOVER -> Icons.Rounded.Explore
                        Tab.LIBRARY -> Icons.Rounded.VideoLibrary
                        Tab.MULTIVIEW -> Icons.Rounded.ViewWeek
                        Tab.SEARCH -> Icons.Rounded.Search
                        Tab.SETTINGS -> Icons.Rounded.Settings
                    }, null, tint = c, modifier = Modifier.size(18.dp))
                    Text(
                        t.title,
                        color = c,
                        fontSize = if (wide) 15.sp else 14.sp, fontWeight = if (selected || f) FontWeight.SemiBold else FontWeight.Medium,
                        maxLines = 1,
                    )
                    }
                }
            }
        }
        if (busy != null) {
            CircularProgressIndicator(color = Palette.dim, strokeWidth = 2.dp, modifier = Modifier.size(14.dp))
            if (containerWidth >= 1120.dp) Text("Updating library", color = Palette.dim, fontSize = 12.sp, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(start = 8.dp, end = 16.dp))
            else Spacer(Modifier.width(12.dp))
        }
        if (showClock) Text(fmtTime(now), color = Palette.text, fontSize = 15.sp, fontWeight = FontWeight.Medium, maxLines = 1)
    }
    }
}

/** Shown over every screen, the player included, so "Skipping a dead channel" is seen while watching. */
@Composable
internal fun ToastHost(modifier: Modifier) {
    var visible by remember { mutableStateOf(false) }
    LaunchedEffect(Toasts.id) {
        if (Toasts.message == null) return@LaunchedEffect
        visible = true; delay(2200); visible = false
    }
    AnimatedVisibility(visible, modifier = modifier, enter = fadeIn(), exit = fadeOut()) {
        Box(
            Modifier.clip(RoundedCornerShape(50)).background(Palette.surface2).padding(horizontal = 22.dp, vertical = 11.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.size(7.dp).clip(CircleShape).background(Palette.accent))
                Text(Toasts.message ?: "", color = Palette.text, fontSize = 15.sp, modifier = Modifier.padding(start = 10.dp))
            }
        }
    }
}

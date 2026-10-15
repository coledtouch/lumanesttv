package tv.lumanest.tuner.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.scrollBy
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
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Add
import androidx.compose.material.icons.rounded.Check
import androidx.compose.material.icons.rounded.CheckCircle
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.input.InputMode
import androidx.compose.ui.platform.LocalInputModeManager
import androidx.compose.ui.platform.LocalWindowInfo
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import tv.lumanest.tuner.data.FreeEpg
import tv.lumanest.tuner.data.LoadStatus
import tv.lumanest.tuner.data.LocalLineup
import tv.lumanest.tuner.data.Repo
import tv.lumanest.tuner.data.Source
import tv.lumanest.tuner.data.SourceType
import tv.lumanest.tuner.player.PlayerHolder
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

@Composable
fun SettingsScreen(state: AppState) {
    val scope = rememberCoroutineScope()
    val windowFocused = LocalWindowInfo.current.isWindowFocused
    val sources by Repo.prefs.sources.collectAsState()
    val activeId by Repo.prefs.activeId.collectAsState()
    val channels by Repo.channels.collectAsState()
    val movies by Repo.movies.collectAsState()
    val series by Repo.series.collectAsState()
    val favorites by Repo.prefs.favorites.collectAsState()
    val epgStatus by Repo.epgStatus.collectAsState()
    val localZip by Repo.prefs.localZip.collectAsState()
    val usOnly by Repo.prefs.usOnly.collectAsState()
    val categoryOrder by Repo.prefs.categoryOrder.collectAsState()
    var sheetFor by remember { mutableStateOf<Source?>(null) }
    var confirmDelete by remember { mutableStateOf<Source?>(null) }
    var themeSheet by remember { mutableStateOf(false) }
    var restoreTheme by remember { mutableStateOf(false) }
    val themeFocus = remember { FocusRequester() }
    var regionSheet by remember { mutableStateOf(false) }
    var remoteHelp by remember { mutableStateOf(false) }
    var restoreRemoteHelp by remember { mutableStateOf(false) }
    val remoteHelpFocus = remember { FocusRequester() }
    var localMarketSheet by remember { mutableStateOf(false) }
    var restoreLocalMarket by remember { mutableStateOf(false) }
    val localMarketFocus = remember { FocusRequester() }
    // Settings values aren't flows; bump this to redraw after changing one.
    var rev by remember { mutableIntStateOf(0) }
    val first = remember { FocusRequester() }
    var clearingCache by remember { mutableStateOf(false) }

    LaunchedEffect(state.restoreFocus, windowFocused) {
        if (state.restoreFocus && windowFocused && requestAttachedFocus(first)) state.restoreFocus = false
    }
    LaunchedEffect(restoreRemoteHelp, windowFocused) {
        if (restoreRemoteHelp && windowFocused && requestAttachedFocus(remoteHelpFocus)) restoreRemoteHelp = false
    }
    LaunchedEffect(restoreLocalMarket, windowFocused) {
        if (restoreLocalMarket && windowFocused && requestAttachedFocus(localMarketFocus)) restoreLocalMarket = false
    }
    LaunchedEffect(restoreTheme, windowFocused) {
        if (restoreTheme && windowFocused && requestAttachedFocus(themeFocus)) restoreTheme = false
    }

    Box(Modifier.fillMaxSize()) {
        LazyColumn(
            Modifier.fillMaxSize(),
            contentPadding = PaddingValues(start = 120.dp, end = 120.dp, top = 12.dp, bottom = 60.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            header("Playlists")
            items(sources, key = { it.id }) { s ->
                val active = s.id == activeId
                SettingRow(
                    title = s.name,
                    subtitle = (if (s.type == SourceType.XTREAM) "Xtream Codes · " + s.server.removePrefix("http://").removePrefix("https://")
                    else "M3U · " + s.m3uUrl.take(60)),
                    trailing = if (active) "Active" else null,
                    modifier = if (s == sources.first()) Modifier.focusRequester(first) else Modifier,
                    onClick = { sheetFor = s },
                )
            }
            item {
                SettingRow("Add a playlist", "Xtream Codes login or M3U link", icon = true,
                    modifier = if (sources.isEmpty()) Modifier.focusRequester(first) else Modifier,
                    onClick = { state.push(Screen.EditSource(null)) })
            }

            header("Remote")
            item(key = "remote-help") {
                SettingRow("onn 4K remote", "Arrows, OK and Back: see all Tuner controls", modifier = Modifier.focusRequester(remoteHelpFocus),
                    onClick = { remoteHelp = true })
            }

            header("Appearance")
            item {
                SettingRow("Favorite channels", "${favorites.size} saved. Open your Favorites guide.", onClick = {
                    state.guide.category = CAT_FAV
                    state.tab = Tab.GUIDE
                    state.restoreFocus = true
                })
            }
            item {
                Column(Modifier.fillMaxWidth().padding(horizontal = 18.dp, vertical = 10.dp)) {
                    Text("Your library", color = Palette.accent, fontSize = 15.sp, fontWeight = FontWeight.SemiBold)
                    Text("U.S. channels and your full movie and series library. All audio languages are available.", color = Palette.dim, fontSize = 13.sp, lineHeight = 18.sp, modifier = Modifier.padding(top = 5.dp))
                }
            }
            item {
                SettingRow("Theme", "True Black and more colors for your guide and library", trailing = Palette.theme.name,
                    modifier = Modifier.focusRequester(themeFocus), onClick = { themeSheet = true })
            }

            header("Playback")
            item(key = "fmt$rev") {
                val ts = Repo.prefs.liveFormat == "ts"
                SettingRow(
                    "Live stream format", if (ts) "MPEG-TS (.ts) · most compatible" else "HLS (.m3u8) · try this if channels stutter",
                    trailing = if (ts) "TS" else "HLS",
                    onClick = {
                        Repo.prefs.liveFormat = if (ts) "m3u8" else "ts"; rev++
                        Repo.load(); Toasts.show("Live format changed, reloading channels")
                    },
                )
            }
            item(key = "prev$rev") {
                val on = Repo.prefs.guidePreview
                SettingRow(
                    "Guide preview", "Keep the channel you are watching visible while browsing the guide",
                    trailing = if (on) "On" else "Off",
                    onClick = {
                        Repo.prefs.guidePreview = !on; rev++
                        if (on) PlayerHolder.stop()
                    },
                )
            }

            header("Guide")
            item(key = "us-only") {
                SettingRow(
                    "Channels",
                    if (usOnly) "USA channels only. International channels are hidden. Press OK to show all channels."
                    else "All channels on your line. Press OK to show USA channels only.",
                    trailing = if (usOnly) "USA only" else "All",
                    onClick = {
                        Repo.prefs.setUsOnly(!usOnly); Repo.load()
                        Toasts.show(if (!usOnly) "Showing USA channels only" else "Showing all channels")
                    },
                )
            }
            item(key = "category-order") {
                val next = when (categoryOrder) { "featured" -> "provider"; "provider" -> "az"; else -> "featured" }
                SettingRow(
                    "Category order",
                    when (categoryOrder) {
                        "provider" -> "As in your customer hub. Press OK for A to Z."
                        "az" -> "Alphabetical. Press OK for Featured."
                        else -> "Sports, Premium and News first. Press OK for your customer hub's order."
                    },
                    trailing = when (categoryOrder) { "provider" -> "Hub order"; "az" -> "A to Z"; else -> "Featured" },
                    onClick = {
                        Repo.prefs.setCategoryOrder(next)
                        Toasts.show(when (next) { "provider" -> "Categories in your customer hub's order"; "az" -> "Categories A to Z"; else -> "Featured categories first" })
                    },
                )
            }
            item(key = "local-market") {
                val market = LocalLineup.marketForZip(localZip)
                SettingRow(
                    "Local stations",
                    if (market == null) "All U.S. markets. Choose nearby stations for a shorter guide."
                    else "${market.label} · ZIP $localZip. Cable, sports and entertainment stay available.",
                    trailing = if (market == null) "All U.S." else "Nearby",
                    modifier = Modifier.focusRequester(localMarketFocus),
                    onClick = { localMarketSheet = true },
                )
            }
            item(key = "free$rev") {
                val regions = Repo.prefs.freeEpgRegions
                val names = FreeEpg.regions.filter { it.code in regions }.map { it.name }
                SettingRow(
                    "Free guide fallback",
                    if (names.isEmpty()) "Off · only your provider's guide is used"
                    else "Fills missing channels from: " + names.joinToString(", "),
                    trailing = if (names.isEmpty()) "Off" else "${names.size} on",
                    onClick = { regionSheet = true },
                )
            }

            header("Data")
            item {
                SettingRow(
                    "Refresh channels, movies and guide", guideSummary(epgStatus, channels.size, movies.size, series.size),
                    onClick = { Repo.load(force = true); Toasts.show("Refreshing from your provider") },
                )
            }
            item {
                SettingRow(
                    if (clearingCache) "Clearing cached data…" else "Clear cached data",
                    "Frees storage. Everything downloads again on next load.",
                    onClick = {
                        if (!clearingCache) {
                            clearingCache = true
                            scope.launch {
                                try {
                                    withContext(Dispatchers.IO) { Repo.clearCache() }
                                    Toasts.show("Cache cleared")
                                } finally {
                                    clearingCache = false
                                }
                            }
                        }
                    },
                )
            }
            item {
                SettingRow(
                    "Bring back hidden channels", "Channels that failed to play are hidden for 3 days, then tried again. This shows them now.",
                    onClick = { Repo.restoreHiddenChannels(); Toasts.show("Hidden channels restored") },
                )
            }
            item {
                Text(
                    "Tuner by LumaNest TV ${tv.lumanest.tuner.BuildConfig.VERSION_NAME}  ·  Hold OK on a guide channel to favorite it  ·  Number keys tune directly",
                    color = Palette.faint, fontSize = 12.sp, modifier = Modifier.padding(top = 18.dp),
                )
            }
        }

        if (remoteHelp) OnnRemoteHelp(onClose = { remoteHelp = false; restoreRemoteHelp = true })
        if (localMarketSheet) ActionSheet(
            title = "Local stations",
            actions = listOf(
                "Boston, Worcester + New Hampshire" to {
                    Repo.prefs.setLocalZip(LocalLineup.WORCESTER_ZIP)
                    Repo.load()
                    Toasts.show("Nearby local stations selected. Cable and sports stay available.")
                },
                "All U.S. local stations" to {
                    Repo.prefs.setLocalZip("")
                    Repo.load()
                    Toasts.show("All U.S. local markets selected")
                },
            ),
            onClose = { localMarketSheet = false; restoreLocalMarket = true },
        )
        if (themeSheet) ThemeSheet(onClose = { themeSheet = false; restoreTheme = true })
        if (regionSheet) RegionSheet(onClose = { changed ->
            regionSheet = false; rev++; state.restoreFocus = true
            if (changed) { Repo.reloadFreeGuides(); Toasts.show("Looking for guide data in the new regions") }
        })

        sheetFor?.let { s ->
            ActionSheet(
                title = s.name,
                actions = buildList {
                    if (s.id != activeId) add("Use this playlist" to {
                        Repo.prefs.setActive(s.id); state.clearRowStates(); Repo.load(); state.tab = Tab.GUIDE
                    })
                    add("Edit" to { state.push(Screen.EditSource(s.id)) })
                    if (s.id == activeId) add("Refresh now" to { Repo.load(force = true) })
                    add("Delete" to { confirmDelete = s })
                },
                onClose = { sheetFor = null; state.restoreFocus = true },
            )
        }
        confirmDelete?.let { s ->
            ActionSheet(
                title = "Delete ${s.name}?",
                actions = listOf(
                    "Delete" to {
                        val wasActive = s.id == activeId
                        Repo.prefs.deleteSource(s.id)
                        if (Repo.prefs.sources.value.isEmpty()) { PlayerHolder.stop(); state.replaceAll(Screen.EditSource(null)) }
                        else if (wasActive) { state.clearRowStates(); Repo.load() }
                    },
                    "Keep it" to {},
                ),
                onClose = { confirmDelete = null; state.restoreFocus = true },
            )
        }
    }
}

@Composable
@OptIn(androidx.compose.ui.ExperimentalComposeUiApi::class)
private fun OnnRemoteHelp(onClose: () -> Unit) {
    val done = remember { FocusRequester() }
    val list = rememberLazyListState()
    val scope = rememberCoroutineScope()
    val controls = remember {
        listOf(
            "Arrows" to "Move through tabs, channels and titles.",
            "OK / Enter" to "Open the selected item. While a movie or episode plays, pause or resume.",
            "Back" to "Close details or player controls. From a library, return to the top tabs.",
            "Channel + / −" to "Change channels while watching live TV.",
            "Multi View" to "Choose two channels and Watch both. OK on a video selects its audio; Channel + / − changes the focused channel.",
            "Hold OK" to "While watching live TV, add or remove the channel from Favorites.",
            "Down" to "While watching a movie or episode, open Audio and Subtitles.",
            "Star shortcut" to "In Google TV remote settings, set the star button to launch Tuner.",
            "Home" to "Return to Google TV. Volume and app shortcut buttons keep their usual functions.",
        )
    }
    Dialog(onDismissRequest = onClose, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        val windowFocused = LocalWindowInfo.current.isWindowFocused
        val inputManager = LocalInputModeManager.current
        val inputMode = inputManager.inputMode
        LaunchedEffect(windowFocused) {
            if (windowFocused) inputManager.requestInputMode(InputMode.Keyboard)
        }
        // A dialog owns a separate window. Request remote focus after that window gains focus,
        // rather than from the underlying Settings composition before the dialog is ready.
        LaunchedEffect(windowFocused, inputMode) {
            if (windowFocused && inputMode == InputMode.Keyboard) requestAttachedFocus(done)
        }
        Box(Modifier.fillMaxSize().dimBackground(0.7f), contentAlignment = Alignment.Center) {
            Column(
                Modifier.widthIn(max = 620.dp).fillMaxWidth(0.9f).fillMaxHeight(0.86f)
                    .clip(RoundedCornerShape(16.dp)).background(Palette.surface).padding(20.dp)
                    .onPreviewKeyEvent { event ->
                        if (event.type != KeyEventType.KeyDown) false
                        else {
                            val distance = when (event.nativeKeyEvent.keyCode) {
                                android.view.KeyEvent.KEYCODE_DPAD_DOWN -> if (list.canScrollForward) 104f else 0f
                                android.view.KeyEvent.KEYCODE_DPAD_UP -> if (list.canScrollBackward) -104f else 0f
                                else -> 0f
                            }
                            if (distance == 0f) false else { scope.launch { list.scrollBy(distance) }; true }
                        }
                    },
            ) {
                Text("onn 4K remote", color = Palette.text, fontSize = 22.sp, fontWeight = FontWeight.Bold)
                Text("Use the arrows and the center OK button.", color = Palette.dim, fontSize = 13.sp, modifier = Modifier.padding(top = 5.dp, bottom = 12.dp))
                LazyColumn(state = list, modifier = Modifier.weight(1f).fillMaxWidth(), contentPadding = PaddingValues(bottom = 12.dp)) {
                    items(controls, key = { it.first }) { (key, action) ->
                        Row(Modifier.fillMaxWidth().padding(vertical = 8.dp), horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                            Text(key, color = Palette.accent, fontSize = 13.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.width(114.dp))
                            Text(action, color = Palette.text.copy(alpha = 0.85f), fontSize = 13.sp, lineHeight = 18.sp, modifier = Modifier.weight(1f))
                        }
                    }
                }
                Row(Modifier.fillMaxWidth().padding(top = 10.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text("↑ ↓ Read · OK or Back Close", color = Palette.dim, fontSize = 11.sp, modifier = Modifier.weight(1f))
                    PillButton("Done", onClose, Modifier.focusRequester(done), primary = true)
                }
            }
        }
    }
}

private fun guideSummary(epg: LoadStatus, ch: Int, mv: Int, se: Int): String {
    val guide = when (epg) {
        is LoadStatus.Ready -> "guide loaded"
        is LoadStatus.Loading -> "guide loading"
        is LoadStatus.Error -> "guide: ${epg.message}"
        LoadStatus.Idle -> "guide not loaded"
    }
    return "$ch channels · $mv movies · $se series · $guide"
}

private fun LazyListScope.header(text: String) {
    item(key = "h_$text") {
        Text(text, color = Palette.accent, fontSize = 14.sp, fontWeight = FontWeight.Bold, modifier = Modifier.padding(top = 18.dp, bottom = 4.dp, start = 4.dp))
    }
}

@Composable
private fun SettingRow(
    title: String,
    subtitle: String,
    modifier: Modifier = Modifier,
    trailing: String? = null,
    icon: Boolean = false,
    onClick: () -> Unit,
) {
    FocusBox(
        onClick = onClick, modifier = modifier.fillMaxWidth().height(64.dp),
        shape = RoundedCornerShape(10.dp), color = Palette.surface, focusedColor = Palette.focus,
        ring = false, focusedScale = 1.02f,
    ) { f ->
        val fg = if (f) Palette.onFocus else Palette.text
        Row(Modifier.fillMaxSize().padding(horizontal = 18.dp), verticalAlignment = Alignment.CenterVertically) {
            if (icon) Icon(Icons.Rounded.Add, null, tint = if (f) Palette.onFocus else Palette.accent, modifier = Modifier.padding(end = 12.dp).size(22.dp))
            Column(Modifier.weight(1f)) {
                Text(title, color = fg, fontSize = 16.sp, fontWeight = FontWeight.SemiBold, maxLines = 1)
                Text(subtitle, color = fg.copy(alpha = 0.6f), fontSize = 13.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
            trailing?.let {
                if (it == "Active") Icon(Icons.Rounded.CheckCircle, null, tint = if (f) Palette.onFocus else Palette.good, modifier = Modifier.padding(end = 6.dp).size(18.dp))
                Text(it, color = if (f) Palette.onFocus else Palette.dim, fontSize = 14.sp, fontWeight = FontWeight.SemiBold)
            }
        }
    }
}

@Composable
fun ActionSheet(title: String, actions: List<Pair<String, () -> Unit>>, onClose: () -> Unit) {
    val first = remember { FocusRequester() }
    BackHandler { onClose() }
    LaunchedEffect(Unit) { delay(40); runCatching { first.requestFocus() } }
    Box(Modifier.fillMaxSize().dimBackground(0.7f), contentAlignment = Alignment.Center) {
        Column(
            Modifier.width(420.dp).clip(RoundedCornerShape(16.dp)).background(Palette.surface).padding(24.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Text(title, color = Palette.text, fontSize = 20.sp, fontWeight = FontWeight.Bold, modifier = Modifier.padding(bottom = 8.dp))
            actions.forEachIndexed { i, (label, action) ->
                FocusBox(
                    onClick = { onClose(); action() },
                    modifier = Modifier.fillMaxWidth().height(48.dp).then(if (i == 0) Modifier.focusRequester(first) else Modifier),
                    shape = RoundedCornerShape(10.dp), color = Palette.surface2, focusedColor = Palette.focus,
                    ring = false, focusedScale = 1.02f,
                ) { f ->
                    Text(
                        label, color = if (f) Palette.onFocus else if (label.startsWith("Delete")) Palette.live else Palette.text,
                        fontSize = 15.sp, fontWeight = FontWeight.SemiBold,
                        modifier = Modifier.align(Alignment.CenterStart).padding(horizontal = 16.dp),
                    )
                }
            }
        }
    }
}

@Composable
internal fun ThemeSheet(onClose: () -> Unit) {
    val initial = remember { Palette.theme }
    val initialIndex = remember { Themes.all.indexOfFirst { it.id == initial.id }.coerceAtLeast(0) }
    val list = rememberLazyListState(initialFirstVisibleItemIndex = initialIndex)
    val first = remember { FocusRequester() }
    val windowFocused = LocalWindowInfo.current.isWindowFocused
    var focusedIndex by remember { mutableIntStateOf(initialIndex) }
    var committed by remember { mutableStateOf(false) }
    DisposableEffect(Unit) { onDispose { if (!committed) Palette.theme = initial } }
    BackHandler { Palette.theme = initial; onClose() }
    LaunchedEffect(windowFocused) { if (windowFocused) requestAttachedFocus(first) }
    BoxWithConstraints(Modifier.fillMaxSize().dimBackground(0.6f), contentAlignment = Alignment.CenterEnd) {
        val compact = maxHeight < 420.dp
        Column(
            Modifier.width(400.dp).fillMaxHeight().background(Palette.surface).padding(if (compact) 16.dp else 24.dp)
                .onPreviewKeyEvent {
                    if (it.type != KeyEventType.KeyDown) false else when (it.nativeKeyEvent.keyCode) {
                        android.view.KeyEvent.KEYCODE_DPAD_LEFT, android.view.KeyEvent.KEYCODE_DPAD_RIGHT -> true
                        android.view.KeyEvent.KEYCODE_DPAD_UP -> focusedIndex == 0
                        android.view.KeyEvent.KEYCODE_DPAD_DOWN -> focusedIndex == Themes.all.lastIndex
                        else -> false
                    }
                },
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Text("Theme", color = Palette.text, fontSize = 22.sp, fontWeight = FontWeight.Bold)
            Text("Preview a color, then press OK to keep it.", color = Palette.dim, fontSize = 13.sp)
            LazyColumn(state = list, modifier = Modifier.weight(1f).fillMaxWidth(),
                contentPadding = PaddingValues(vertical = 4.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
              items(Themes.all, key = { it.id }) { t ->
                val current = initial.id == t.id
                FocusBox(
                    onClick = { committed = true; Palette.theme = t; Repo.prefs.themeId = t.id; onClose() },
                    modifier = Modifier.fillMaxWidth().height(if (compact) 52.dp else 56.dp).then(if (current) Modifier.focusRequester(first) else Modifier),
                    shape = RoundedCornerShape(10.dp), color = Palette.surface2, focusedColor = Palette.focus,
                    ring = false, focusedScale = 1.02f,
                    onFocus = { if (it) { focusedIndex = Themes.all.indexOf(t); Palette.theme = t } },
                ) { f ->
                    Row(Modifier.fillMaxSize().padding(horizontal = 14.dp), verticalAlignment = Alignment.CenterVertically) {
                        Row(Modifier.clip(RoundedCornerShape(6.dp))) {
                            listOf(t.bg, t.surface2, t.accent, t.focus).forEach { c -> Box(Modifier.size(width = 14.dp, height = 28.dp).background(c)) }
                        }
                        Text(
                            t.name, color = if (f) Palette.onFocus else Palette.text, fontSize = 16.sp,
                            fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f).padding(start = 14.dp),
                        )
                        if (current) Icon(Icons.Rounded.CheckCircle, null, tint = if (f) Palette.onFocus else Palette.accent, modifier = Modifier.size(18.dp))
                    }
                }
              }
            }
            Text("↑ ↓ Preview · OK Save · Back Cancel", color = Palette.dim, fontSize = 12.sp)
        }
    }
}

@Composable
private fun RegionSheet(onClose: (changed: Boolean) -> Unit) {
    val initial = remember { Repo.prefs.freeEpgRegions.toSet() }
    var selected by remember { mutableStateOf(initial) }
    val first = remember { FocusRequester() }
    fun done() { Repo.prefs.freeEpgRegions = FreeEpg.regions.map { it.code }.filter { it in selected }; onClose(selected != initial) }
    BackHandler { done() }
    LaunchedEffect(Unit) { delay(40); runCatching { first.requestFocus() } }
    Box(Modifier.fillMaxSize().dimBackground(0.6f), contentAlignment = Alignment.CenterEnd) {
        Column(Modifier.width(460.dp).fillMaxHeight().background(Palette.surface).padding(start = 24.dp, end = 24.dp, top = 24.dp)) {
            Text("Free guide fallback", color = Palette.text, fontSize = 22.sp, fontWeight = FontWeight.Bold)
            Text(
                "When your provider has no listings for a channel, Tuner matches it by name against these free guides from epgshare01.",
                color = Palette.dim, fontSize = 13.sp, lineHeight = 17.sp, modifier = Modifier.padding(top = 6.dp, bottom = 12.dp),
            )
            LazyColumn(verticalArrangement = Arrangement.spacedBy(6.dp), contentPadding = PaddingValues(bottom = 24.dp)) {
                item {
                    PillButton("Done", { done() }, Modifier.focusRequester(first).padding(bottom = 6.dp), primary = true)
                }
                items(FreeEpg.regions, key = { it.code }) { r ->
                    val on = r.code in selected
                    FocusBox(
                        onClick = { selected = if (on) selected - r.code else selected + r.code },
                        modifier = Modifier.fillMaxWidth().height(52.dp),
                        shape = RoundedCornerShape(10.dp), color = Palette.surface2, focusedColor = Palette.focus,
                        ring = false, focusedScale = 1.02f,
                    ) { f ->
                        val fg = if (f) Palette.onFocus else Palette.text
                        Row(Modifier.fillMaxSize().padding(horizontal = 14.dp), verticalAlignment = Alignment.CenterVertically) {
                            Box(
                                Modifier.size(20.dp).clip(RoundedCornerShape(5.dp))
                                    .background(if (on) Palette.accent else fg.copy(alpha = 0.15f)),
                                contentAlignment = Alignment.Center,
                            ) { if (on) Icon(Icons.Rounded.Check, null, tint = Color.White, modifier = Modifier.size(16.dp)) }
                            Text(r.name, color = fg, fontSize = 15.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f).padding(start = 12.dp))
                            Text(r.size, color = fg.copy(alpha = 0.55f), fontSize = 13.sp)
                        }
                    }
                }
            }
        }
    }
}

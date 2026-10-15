package tv.lumanest.tuner.ui

import android.view.KeyEvent as AndroidKeyEvent
import android.view.LayoutInflater
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.focusGroup
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Star
import androidx.compose.material.icons.rounded.StarBorder
import androidx.compose.material.icons.rounded.VolumeUp
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusProperties
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.RectangleShape
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.media3.ui.PlayerView
import androidx.media3.ui.AspectRatioFrameLayout
import tv.lumanest.tuner.R
import tv.lumanest.tuner.data.Category
import tv.lumanest.tuner.data.Channel
import tv.lumanest.tuner.data.LoadStatus
import tv.lumanest.tuner.data.Repo
import tv.lumanest.tuner.player.TwoChannelPlayer
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.util.Locale

/** Choices and layout survive tab navigation. Stream ownership belongs to TwoChannelPlayer. */
class MultiViewUiState {
    var firstKey by mutableStateOf<String?>(null)
    var secondKey by mutableStateOf<String?>(null)
    var pictureInPicture by mutableStateOf(false)
    var focusedSlot by mutableIntStateOf(0)
    var focusedControl by mutableStateOf("pick-0")
    fun choose(slot: Int, channel: Channel) { if (slot == 0) firstKey = channel.key else secondKey = channel.key }
    fun reset() { firstKey = null; secondKey = null; focusedSlot = 0; focusedControl = "pick-0" }
}

private val sportsChannelName = Regex("\\b(?:ESPN|NESN|SPORTS|SPORTSNET|NFL|NBA|NHL|MLB|NCAA|GOLF|TENNIS|FANDUEL|BALLY|FOOTBALL|SOCCER|DAZN|UFC|PPV)\\b", RegexOption.IGNORE_CASE)

internal data class MultiViewFrame(val x: Float, val y: Float, val width: Float, val height: Float)

/** Surface rectangles change in place. PlayerView handles FIT inside each rectangle. */
internal fun multiViewFrames(width: Float, height: Float, pictureInPicture: Boolean, fullscreen: Boolean): List<MultiViewFrame> {
    if (!pictureInPicture) {
        val gap = if (fullscreen) 0f else 12f
        val paneWidth = (width - gap) / 2
        val paneHeight = minOf(height, paneWidth * 9 / 16)
        val top = (height - paneHeight) / 2
        return listOf(MultiViewFrame(0f, top, paneWidth, paneHeight), MultiViewFrame(paneWidth + gap, top, paneWidth, paneHeight))
    }
    val mainWidth = if (fullscreen) width else minOf(width, height * 16 / 9)
    val mainHeight = if (fullscreen) height else mainWidth * 9 / 16
    val left = (width - mainWidth) / 2
    val top = (height - mainHeight) / 2
    val margin = if (fullscreen) 12f else 8f
    val insetWidth = mainWidth * 0.34f
    val insetHeight = insetWidth * 9 / 16
    return listOf(MultiViewFrame(left, top, mainWidth, mainHeight),
        MultiViewFrame(left + mainWidth - insetWidth - margin, top + mainHeight - insetHeight - margin, insetWidth, insetHeight))
}

@Composable
fun MultiViewScreen(state: AppState) {
    val ui = state.multiView
    val context = LocalContext.current
    val channels by Repo.channels.collectAsState()
    val trending by Repo.trending.collectAsState()
    val slots by TwoChannelPlayer.states.collectAsState()
    val active by TwoChannelPlayer.active.collectAsState()
    val audioSlot by TwoChannelPlayer.audioSlot.collectAsState()
    val lineup = remember(channels, trending) { (channels + trending).distinctBy { it.key } }
    val selected = remember(lineup, ui.firstKey, ui.secondKey, slots) {
        listOf(ui.firstKey, ui.secondKey).mapIndexed { i, key -> lineup.firstOrNull { it.key == key } ?: slots.getOrNull(i)?.channel }
    }
    var pickerSlot by remember { mutableIntStateOf(-1) }
    var controlsVisible by remember { mutableStateOf(true) }
    var interaction by remember { mutableIntStateOf(0) }
    var wakeKey by remember { mutableIntStateOf(-1) }
    val controls = remember { listOf("pick-0", "pick-1", "watch", "layout", "stop", "pane-0", "pane-1", "retry-0", "retry-1").associateWith { FocusRequester() } }
    val scope = rememberCoroutineScope()
    fun visibleControl(requested: String): String {
        if (active && !controlsVisible) return "pane-${ui.focusedSlot}"
        return when (requested) {
            "stop" -> if (active) requested else "pick-${ui.focusedSlot}"
            "retry-0" -> if (slots[0].status == TwoChannelPlayer.Status.ERROR) requested else "pick-0"
            "retry-1" -> if (slots[1].status == TwoChannelPlayer.Status.ERROR) requested else "pick-1"
            else -> requested.takeIf { it in controls } ?: "pick-${ui.focusedSlot}"
        }
    }
    fun returnFocus() {
        val target = visibleControl(ui.focusedControl)
        ui.focusedControl = target
        scope.launch { requestAttachedFocus(controls.getValue(target)) { pickerSlot < 0 && ui.focusedControl == target } }
    }
    fun revealControls(focus: Boolean = true) {
        controlsVisible = true; interaction++
        if (focus) { ui.focusedControl = "pick-${ui.focusedSlot}"; returnFocus() }
    }
    fun hideControls() {
        controlsVisible = false; ui.focusedControl = "pane-${ui.focusedSlot}"
        returnFocus()
    }
    fun choose(slot: Int) {
        ui.focusedSlot = slot; ui.focusedControl = "pick-$slot"; pickerSlot = slot
        if (active) { controlsVisible = true; interaction++ }
    }
    fun listen(slot: Int) {
        ui.focusedSlot = slot
        if (active && slots[slot].status == TwoChannelPlayer.Status.ERROR) choose(slot)
        else if (active) { if (!TwoChannelPlayer.selectAudio(slot)) Toasts.show("This channel's audio is unavailable. Try again.") }
        else choose(slot)
    }
    fun tune(slot: Int, channel: Channel): Boolean {
        if (!TwoChannelPlayer.play(slot, channel)) return false
        ui.choose(slot, channel); Repo.prefs.lastChannelKey = channel.key
        return true
    }
    fun leave() { TwoChannelPlayer.stop(); state.tab = Tab.GUIDE; state.requestNavigation() }

    DisposableEffect(Unit) { TwoChannelPlayer.init(context); onDispose { TwoChannelPlayer.stop() } }
    LaunchedEffect(active) {
        if (active) { state.navigationFocused = false; controlsVisible = true; interaction++ }
        else controlsVisible = true
    }
    LaunchedEffect(active, controlsVisible, interaction, pickerSlot) {
        if (active && controlsVisible && pickerSlot < 0) { delay(5_000); hideControls() }
    }
    LaunchedEffect(state.restoreFocus, active, controlsVisible, slots.map { it.status }) {
        val target = visibleControl(ui.focusedControl)
        if (state.restoreFocus || (target != ui.focusedControl && (active || !state.navigationFocused) && pickerSlot < 0)) {
            ui.focusedControl = target
            if (requestAttachedFocus(controls.getValue(target)) { pickerSlot < 0 && ui.focusedControl == target }) state.restoreFocus = false
        }
    }
    BackHandler(enabled = pickerSlot < 0 && (active || !state.navigationFocused)) {
        if (active && controlsVisible) hideControls() else leave()
    }

    @Composable fun layoutButton() {
        PillButton(if (ui.pictureInPicture) "Picture in Picture" else "Side by side", {
            ui.pictureInPicture = !ui.pictureInPicture; interaction++
        }, Modifier.focusRequester(controls.getValue("layout")).testTag("dual-layout"), onFocus = { if (it) ui.focusedControl = "layout" })
    }
    @Composable fun channelButton(slot: Int, modifier: Modifier) {
        FocusBox(onClick = { choose(slot) }, modifier = modifier.height(44.dp).focusRequester(controls.getValue("pick-$slot")).testTag("dual-pick-$slot"),
            color = Palette.surface2, focusedColor = Palette.focus, focusedScale = 1.02f,
            onFocus = { if (it) { ui.focusedSlot = slot; ui.focusedControl = "pick-$slot" } }) { focused ->
            Column(Modifier.padding(horizontal = 12.dp).align(Alignment.CenterStart)) {
                Text("CHANNEL ${slot + 1}", color = if (focused) Palette.onFocus else Palette.dim, fontSize = 9.sp, lineHeight = 12.sp, fontWeight = FontWeight.Bold)
                Text(selected[slot]?.name ?: "Choose a channel", color = if (focused) Palette.onFocus else Palette.text, fontSize = 14.sp, lineHeight = 18.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
        }
    }
    @Composable fun watchButton() {
        PillButton(if (active) "Audio: Game ${audioSlot + 1}" else "Watch both", {
            if (active) { listen(1 - audioSlot); interaction++; return@PillButton }
            val first = selected[0]; val second = selected[1]
            when {
                first == null -> choose(0)
                second == null -> choose(1)
                first.key == second.key || first.url == second.url -> Toasts.show("Choose two different channels.")
                else -> {
                    if (TwoChannelPlayer.play(0, first) && TwoChannelPlayer.play(1, second)) {
                        Repo.prefs.lastChannelKey = if (audioSlot == 0) first.key else second.key
                        ui.focusedControl = "pane-${ui.focusedSlot}"; returnFocus()
                    } else Toasts.show("The selected channels could not start. Try another channel.")
                }
            }
        }, Modifier.focusRequester(controls.getValue("watch")).testTag("dual-watch"), primary = true, onFocus = { if (it) ui.focusedControl = "watch" })
    }
    @Composable fun retryButtons() {
        slots.forEachIndexed { slot, playback -> if (playback.status == TwoChannelPlayer.Status.ERROR) {
            PillButton("Retry ${slot + 1}", { TwoChannelPlayer.retry(slot); interaction++ },
                Modifier.focusRequester(controls.getValue("retry-$slot")).testTag("dual-retry-$slot"),
                onFocus = { if (it) { ui.focusedSlot = slot; ui.focusedControl = "retry-$slot" } })
        } }
    }

    BoxWithConstraints(Modifier.fillMaxSize().background(Color.Black).onPreviewKeyEvent { event ->
        val code = event.nativeKeyEvent.keyCode
        if (wakeKey == code) {
            if (event.type == KeyEventType.KeyUp) wakeKey = -1
            true
        } else if (pickerSlot < 0 && active && code in listOf(AndroidKeyEvent.KEYCODE_DPAD_CENTER, AndroidKeyEvent.KEYCODE_ENTER,
                AndroidKeyEvent.KEYCODE_DPAD_UP, AndroidKeyEvent.KEYCODE_DPAD_DOWN, AndroidKeyEvent.KEYCODE_DPAD_LEFT, AndroidKeyEvent.KEYCODE_DPAD_RIGHT, AndroidKeyEvent.KEYCODE_MENU)
            && (!controlsVisible || code == AndroidKeyEvent.KEYCODE_MENU)) {
            if (event.type == KeyEventType.KeyDown) { wakeKey = code; revealControls() }
            true
        } else if (pickerSlot < 0 && code in listOf(AndroidKeyEvent.KEYCODE_CHANNEL_UP, AndroidKeyEvent.KEYCODE_CHANNEL_DOWN, AndroidKeyEvent.KEYCODE_PAGE_UP, AndroidKeyEvent.KEYCODE_PAGE_DOWN)) {
            if (event.type == KeyEventType.KeyDown && event.nativeKeyEvent.repeatCount == 0) {
                val slot = ui.focusedSlot
                if (!active) choose(slot)
                else {
                    val current = slots.getOrNull(slot)?.channel
                    val other = slots.getOrNull(1 - slot)?.channel
                    val choices = lineup.filter { it.key != other?.key && it.url != other?.url }
                    if (choices.isNotEmpty()) {
                        val index = choices.indexOfFirst { it.key == current?.key }.coerceAtLeast(0)
                        val next = choices[Math.floorMod(index + if (code == AndroidKeyEvent.KEYCODE_CHANNEL_UP || code == AndroidKeyEvent.KEYCODE_PAGE_UP) 1 else -1, choices.size)]
                        tune(slot, next); revealControls(focus = false)
                    }
                }
            }
            true
        } else { if (active && event.type == KeyEventType.KeyDown) interaction++; false }
    }) {
        val compact = maxWidth < 720.dp
        Column(Modifier.fillMaxSize().padding(horizontal = if (active) 0.dp else if (compact) 20.dp else 28.dp,
            vertical = if (active) 0.dp else 12.dp), verticalArrangement = Arrangement.spacedBy(if (active) 0.dp else 10.dp)) {
            if (!active) {
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    Column(Modifier.weight(1f)) {
                        Text("Two games. One screen.", color = Palette.text, fontSize = if (compact) 20.sp else 23.sp, fontWeight = FontWeight.Bold)
                        Text("Choose two channels. Hear one at a time.", color = Palette.dim, fontSize = 12.sp)
                    }
                    layoutButton()
                }
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
                    repeat(2) { channelButton(it, Modifier.weight(1f)) }; watchButton()
                }
            }
            key("dual-stage") {
                BoxWithConstraints(Modifier.fillMaxWidth().weight(1f).testTag("dual-stage").semantics { contentDescription = "Multi View video stage" }) {
                    val frames = multiViewFrames(maxWidth.value, maxHeight.value, ui.pictureInPicture, active)
                    repeat(2) { slot -> key(slot) {
                        val frame = frames[slot]
                        MultiViewPane(slot, selected[slot], slots[slot], active, audioSlot == slot, ui.pictureInPicture && slot == 1,
                            Modifier.offset(frame.x.dp, frame.y.dp).size(frame.width.dp, frame.height.dp)
                                .focusRequester(controls.getValue("pane-$slot")).focusProperties {
                                    if (slot == 0) { right = controls.getValue("pane-1"); if (active && controlsVisible) down = controls.getValue("pick-0") else if (ui.pictureInPicture) down = controls.getValue("pane-1") }
                                    else { left = controls.getValue("pane-0"); if (active && controlsVisible) down = controls.getValue("pick-1") else if (ui.pictureInPicture) up = controls.getValue("pane-0") }
                                },
                            showChrome = !active, showRing = !active || controlsVisible,
                            onClick = { if (active && !controlsVisible) revealControls() else listen(slot) },
                            onFocus = { if (it) { ui.focusedSlot = slot; ui.focusedControl = "pane-$slot" } })
                    } }
                }
            }
            if (!active) Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Text("Choose channels, then Watch both", color = Palette.dim, fontSize = 11.sp, modifier = Modifier.weight(1f)); retryButtons()
                Text("Back  Live TV", color = Palette.dim, fontSize = 11.sp)
            }
        }
        if (active && controlsVisible) {
            Column(Modifier.align(Alignment.BottomCenter).fillMaxWidth().testTag("dual-controls").semantics { contentDescription = "Multi View controls" }
                .background(Brush.verticalGradient(listOf(Color.Transparent, Color.Black.copy(alpha = 0.92f))))
                .padding(horizontal = 16.dp, vertical = 12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) { repeat(2) { channelButton(it, Modifier.weight(1f)) } }
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    watchButton(); layoutButton()
                    PillButton("Stop", { TwoChannelPlayer.stop(); ui.focusedControl = "watch"; returnFocus() },
                        Modifier.focusRequester(controls.getValue("stop")).testTag("dual-stop"), onFocus = { if (it) ui.focusedControl = "stop" })
                    retryButtons()
                    Text("OK  Select  ·  CH +/−  Change channel  ·  Back  Hide", color = Palette.dim, fontSize = 10.sp, maxLines = 1, modifier = Modifier.weight(1f))
                }
            }
        }
    }
    if (pickerSlot >= 0) {
        val slot = pickerSlot
        MultiViewChannelPicker(slot, selected[slot], selected[1 - slot], onChoose = { channel ->
            if (!active) ui.choose(slot, channel) else if (!tune(slot, channel)) Toasts.show("This channel could not start. Choose another.")
            pickerSlot = -1; if (active) { controlsVisible = true; interaction++ }; returnFocus()
        }, onClose = { pickerSlot = -1; if (active) { controlsVisible = true; interaction++ }; returnFocus() })
    }
}
@Composable
private fun MultiViewPane(
    slot: Int, selected: Channel?, playback: TwoChannelPlayer.SlotState, active: Boolean, audible: Boolean, small: Boolean,
    modifier: Modifier, showChrome: Boolean, showRing: Boolean, onClick: () -> Unit, onFocus: (Boolean) -> Unit,
) {
    val channel = playback.channel ?: selected
    FocusBox(onClick = onClick, modifier = modifier.testTag("dual-pane-$slot").semantics {
        contentDescription = "Channel ${slot + 1}, ${channel?.name ?: "choose a channel"}. ${if (active && audible) "Audio selected" else if (active) "Press OK to listen" else "Press OK to choose"}"
    }, shape = if (active) RectangleShape else RoundedCornerShape(12.dp), color = Color.Black, focusedScale = 1f, ring = showRing, onFocus = onFocus) { _ ->
        Box(Modifier.fillMaxSize()) {
            if (playback.channel != null && active) MultiViewVideo(slot, Modifier.fillMaxSize())
            else Column(Modifier.align(Alignment.Center), horizontalAlignment = Alignment.CenterHorizontally) {
                if (channel != null) ChannelLogo(channel, Modifier.size(if (small) 54.dp else 96.dp, if (small) 32.dp else 56.dp))
                Text(if (channel == null) "Choose channel ${slot + 1}" else "Ready to watch", color = Color.White, fontSize = if (small) 10.sp else 15.sp)
            }
            if (playback.status == TwoChannelPlayer.Status.LOADING) CircularProgressIndicator(Modifier.size(if (small) 20.dp else 32.dp).align(Alignment.Center), color = Color.White, strokeWidth = 2.dp)
            if (playback.status == TwoChannelPlayer.Status.ERROR) Text(
                playback.error ?: "This channel is unavailable. Retry or choose another.", color = Color.White, fontSize = if (small) 10.sp else 13.sp,
                maxLines = if (small) 2 else 3, overflow = TextOverflow.Ellipsis,
                modifier = Modifier.align(Alignment.Center).background(Color.Black.copy(alpha = 0.85f)).padding(if (small) 8.dp else 16.dp),
            )
            if (showChrome) {
            Box(Modifier.align(Alignment.TopCenter).fillMaxWidth().height(42.dp).background(Brush.verticalGradient(listOf(Color.Black.copy(alpha = 0.85f), Color.Transparent))))
            Text("${slot + 1}  ${channel?.name ?: "Choose a channel"}", color = Color.White, fontSize = if (small) 10.sp else 13.sp, fontWeight = FontWeight.SemiBold,
                maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.align(Alignment.TopStart).padding(horizontal = 10.dp, vertical = 8.dp))
            Row(Modifier.align(Alignment.BottomStart).padding(8.dp).clip(RoundedCornerShape(6.dp)).background(Color.Black.copy(alpha = 0.8f)).padding(horizontal = 8.dp, vertical = 5.dp),
                verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(5.dp)) {
                if (active && audible) Icon(Icons.Rounded.VolumeUp, null, tint = Palette.accent, modifier = Modifier.size(if (small) 12.dp else 16.dp))
                Text(if (active && audible) "Audio selected" else if (active) "OK  Listen" else "OK  Choose", color = Color.White, fontSize = if (small) 9.sp else 11.sp)
            }
            }
        }
    }
}

@androidx.annotation.OptIn(androidx.media3.common.util.UnstableApi::class)
@Composable
private fun MultiViewVideo(slot: Int, modifier: Modifier) {
    val player = TwoChannelPlayer.player(slot)
    AndroidView(factory = { context ->
        (LayoutInflater.from(context).inflate(R.layout.player_texture, null, false) as PlayerView).apply {
            useController = false; isFocusable = false; isFocusableInTouchMode = false; keepScreenOn = true
            resizeMode = AspectRatioFrameLayout.RESIZE_MODE_FIT
            tag = "dual-native-video-$slot"
        }
    }, update = { view -> if (view.player !== player) view.player = player }, onRelease = { it.player = null }, modifier = modifier.testTag("dual-video-$slot"))
}

private fun sportsChannels(channels: List<Channel>, categories: List<Category>): List<Channel> {
    val sportsIds = categories.filter { sportsChannelName.containsMatchIn(it.name) }.mapTo(HashSet()) { it.id }
    return channels.filter { it.categoryIds.any(sportsIds::contains) || sportsChannelName.containsMatchIn(it.name) }
}

private data class PickerListing(val query: String, val filter: String, val favorites: Set<String>, val channels: List<Channel>)

@Composable
private fun MultiViewChannelPicker(slot: Int, selected: Channel?, other: Channel?, onChoose: (Channel) -> Unit, onClose: () -> Unit) {
    val channels by Repo.channels.collectAsState()
    val trending by Repo.trending.collectAsState()
    val categories by Repo.liveCategories.collectAsState()
    val favorites by Repo.prefs.favorites.collectAsState()
    val watchedKeys by Repo.prefs.watchedChannelKeys.collectAsState()
    val status by Repo.liveStatus.collectAsState()
    var query by remember { mutableStateOf("") }
    var filter by remember { mutableStateOf(if (favorites.isNotEmpty()) "Favorites" else "Suggested") }
    val queryFocus = remember { FocusRequester() }
    val firstFocus = remember { FocusRequester() }
    val listState = rememberLazyListState()
    val all = remember(channels, trending) { (channels + trending).distinctBy { it.key } }
    val mostWatched = remember(channels, trending, watchedKeys) { mostWatchedLineup(channels, trending, watchedKeys) }
    var focusResults by remember { mutableStateOf(false) }
    val listing by produceState(PickerListing("", "", emptySet(), emptyList()), all, mostWatched, categories, favorites, filter, query, other?.key, other?.url) {
        value = withContext(Dispatchers.Default) {
            val sports = sportsChannels(all, categories)
            val list = when (filter) {
                "Favorites" -> all.filter { it.key in favorites }
                "Most Watched" -> mostWatched
                "All channels" -> all
                else -> (all.filter { it.key in favorites } + mostWatched + sports).distinctBy { it.key }.ifEmpty { all }
            }
            val words = query.trim().lowercase(Locale.ROOT).split(Regex("\\s+")).filter { it.isNotEmpty() }
            PickerListing(query, filter, favorites, list.filter { it.key != other?.key && it.url != other?.url && words.all { word -> it.name.lowercase(Locale.ROOT).contains(word) } })
        }
    }
    val matches = listing.channels
    val filters = remember { listOf("Suggested", "Favorites", "Most Watched", "All channels") }
    LaunchedEffect(Unit) { requestAttachedFocus(queryFocus) }
    LaunchedEffect(filter, query) { listState.scrollToItem(0) }
    LaunchedEffect(listing, focusResults, query, filter, favorites) {
        if (focusResults && listing.query == query && listing.filter == filter && listing.favorites == favorites) {
            if (matches.isNotEmpty()) { listState.scrollToItem(0); requestAttachedFocus(firstFocus) }
            else requestAttachedFocus(queryFocus)
            focusResults = false
        }
    }
    fun toggleFavorite(channel: Channel) {
        Repo.prefs.toggleFavorite(channel.key)
        if (filter == "Favorites") focusResults = true
    }

    Dialog(onDismissRequest = onClose, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        BoxWithConstraints(Modifier.fillMaxSize().background(Color.Black.copy(alpha = 0.65f)), contentAlignment = Alignment.Center) {
            Column(Modifier.width(minOf(maxWidth - 48.dp, 700.dp)).height(minOf(maxHeight - 32.dp, 470.dp)).clip(RoundedCornerShape(18.dp)).background(Palette.surface).border(1.dp, Palette.line, RoundedCornerShape(18.dp)).padding(18.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text("Choose channel ${slot + 1}", color = Palette.text, fontSize = 20.sp, fontWeight = FontWeight.Bold)
                        Text("Browsing keeps both games playing.", color = Palette.dim, fontSize = 12.sp)
                    }
                    PillButton("Cancel", onClose)
                }
                TvTextField("", query, { query = it }, placeholder = "Search a channel or team", keyboardType = KeyboardType.Text, focusRequester = queryFocus,
                    onDone = { focusResults = true })
                LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp), contentPadding = PaddingValues(horizontal = 2.dp)) {
                    items(filters, key = { it }) { name ->
                        FocusBox(onClick = { filter = name; focusResults = true }, shape = RoundedCornerShape(50), color = if (filter == name) Palette.accent.copy(alpha = 0.2f) else Palette.surface2, focusedColor = Palette.focus, ring = false) { focused ->
                            Text(name, color = if (focused) Palette.onFocus else if (filter == name) Palette.text else Palette.dim, fontSize = 12.sp, modifier = Modifier.padding(horizontal = 14.dp, vertical = 8.dp))
                        }
                    }
                }
                if (matches.isEmpty()) Box(Modifier.weight(1f).fillMaxWidth(), contentAlignment = Alignment.Center) {
                    Text(when { status is LoadStatus.Loading -> "Loading channels…"; query.isNotBlank() -> "No matches. Try All channels or a shorter name."; filter == "Favorites" -> "Save channels with their star in the guide, or choose Suggested."; filter == "Most Watched" -> "Channels you watch will appear here. Choose Suggested to start."; else -> "No channels here yet. Add or refresh your playlist in Settings." }, color = Palette.dim, fontSize = 14.sp)
                } else LazyColumn(Modifier.weight(1f).fillMaxWidth(), state = listState, verticalArrangement = Arrangement.spacedBy(5.dp)) {
                    items(matches, key = { it.key }) { channel ->
                        Row(Modifier.fillMaxWidth().focusGroup(), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                            FocusBox(onClick = { onChoose(channel) }, onLongClick = { toggleFavorite(channel) },
                                modifier = Modifier.weight(1f).height(48.dp).then(if (channel.key == matches.first().key) Modifier.focusRequester(firstFocus) else Modifier).testTag("dual-channel:${channel.key}"),
                                color = if (channel.key == selected?.key) Palette.accent.copy(alpha = 0.16f) else Palette.surface2, focusedColor = Palette.focus, focusedScale = 1.01f,
                            ) { focused ->
                                Row(Modifier.fillMaxSize().padding(horizontal = 10.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                                    Text(channel.number.toString(), color = if (focused) Palette.onFocus else Palette.dim, fontSize = 11.sp, modifier = Modifier.width(32.dp))
                                    ChannelLogo(channel, Modifier.size(52.dp, 32.dp))
                                    Text(channel.name, color = if (focused) Palette.onFocus else Palette.text, fontSize = 14.sp, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
                                }
                            }
                            FocusBox(onClick = { toggleFavorite(channel) }, modifier = Modifier.size(48.dp).semantics { contentDescription = if (channel.key in favorites) "Remove ${channel.name} from Favorites" else "Add ${channel.name} to Favorites" }, color = Palette.surface2, focusedColor = Palette.focus, focusedScale = 1.01f) { focused ->
                                Icon(if (channel.key in favorites) Icons.Rounded.Star else Icons.Rounded.StarBorder, null, tint = if (focused) Palette.onFocus else Palette.accent, modifier = Modifier.align(Alignment.Center).size(20.dp))
                            }
                        }
                    }
                }
                Text("OK  Choose  ·  Hold OK  Favorite  ·  Back  Cancel", color = Palette.dim, fontSize = 11.sp)
            }
        }
    }
}

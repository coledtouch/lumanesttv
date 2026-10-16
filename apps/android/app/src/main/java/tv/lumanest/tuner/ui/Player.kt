package tv.lumanest.tuner.ui

import android.view.KeyEvent as AndroidKeyEvent
import android.view.LayoutInflater
import android.content.Context
import android.content.ContextWrapper
import android.graphics.Rect
import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.foundation.background
import androidx.compose.foundation.focusable
import androidx.compose.foundation.focusGroup
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.rememberScrollState
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
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.ClosedCaption
import androidx.compose.material.icons.rounded.Check
import androidx.compose.material.icons.rounded.GraphicEq
import androidx.compose.material.icons.rounded.Pause
import androidx.compose.material.icons.rounded.PlayArrow
import androidx.compose.material.icons.rounded.Refresh
import androidx.compose.material.icons.rounded.SkipNext
import androidx.compose.material.icons.rounded.Star
import androidx.compose.material.icons.rounded.StarBorder
import androidx.compose.material.icons.rounded.PictureInPictureAlt
import androidx.compose.material.icons.rounded.List
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.focusProperties
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.nativeKeyCode
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.media3.common.C
import androidx.media3.common.MimeTypes
import androidx.media3.common.Player
import androidx.media3.common.TrackSelectionOverride
import androidx.media3.ui.PlayerView
import tv.lumanest.tuner.R
import tv.lumanest.tuner.MainActivity
import tv.lumanest.tuner.data.Channel
import tv.lumanest.tuner.data.PlayRequest
import tv.lumanest.tuner.data.Program
import tv.lumanest.tuner.data.Recent
import tv.lumanest.tuner.data.Repo
import tv.lumanest.tuner.player.PlayerHolder
import coil.compose.AsyncImage
import kotlinx.coroutines.delay
import java.util.Locale

@Composable
fun VideoSurface(modifier: Modifier, texture: Boolean) {
    AndroidView(
        factory = { ctx ->
            (LayoutInflater.from(ctx).inflate(
                if (texture) R.layout.player_texture else R.layout.player_surface, null, false,
            ) as PlayerView).apply {
                player = PlayerHolder.player
                // Full screen draws subtitles and closed captions (PlayerView's SubtitleView, styled from the
                // device's caption settings). The small guide preview stays clean.
                subtitleView?.visibility = if (texture) android.view.View.GONE else android.view.View.VISIBLE
                if (!texture) addOnLayoutChangeListener { view, _, _, _, _, _, _, _, _ ->
                    val bounds = Rect()
                    if (view.getGlobalVisibleRect(bounds)) ctx.tunerActivity()?.updatePipSourceRect(bounds)
                }
            }
        },
        modifier = modifier,
        update = { view -> if (view.player !== PlayerHolder.player) view.player = PlayerHolder.player },
        onRelease = { it.player = null },
    )
}

/** Tracks ExoPlayer state as Compose state. */
private class PlaybackUi {
    var playing by mutableStateOf(false)
    var buffering by mutableStateOf(false)
    var ended by mutableIntStateOf(0)
    var position by mutableLongStateOf(0L)
    var duration by mutableLongStateOf(0L)
    var tracksVersion by mutableIntStateOf(0)
}

@Composable
private fun rememberPlaybackUi(): PlaybackUi {
    val ui = remember { PlaybackUi() }
    val p = PlayerHolder.player
    DisposableEffect(p) {
        val l = object : Player.Listener {
            override fun onIsPlayingChanged(isPlaying: Boolean) { ui.playing = isPlaying }
            override fun onPlaybackStateChanged(state: Int) {
                ui.buffering = state == Player.STATE_BUFFERING
                if (state == Player.STATE_ENDED) ui.ended++
            }
            override fun onTracksChanged(tracks: androidx.media3.common.Tracks) { ui.tracksVersion++ }
        }
        p.addListener(l)
        ui.playing = p.isPlaying; ui.buffering = p.playbackState == Player.STATE_BUFFERING
        onDispose { p.removeListener(l) }
    }
    LaunchedEffect(p) {
        while (true) {
            ui.position = p.currentPosition
            ui.duration = p.duration.takeIf { it != C.TIME_UNSET && it > 0 } ?: 0
            delay(500)
        }
    }
    return ui
}

@Composable
fun PlayerScreen(request: PlayRequest, onExit: (Channel?) -> Unit) {
    DisposableEffect(Unit) {
        PlayerHolder.setFullscreenPlayback(true)
        onDispose { PlayerHolder.setFullscreenPlayback(false) }
    }
    when (request) {
        is PlayRequest.Live -> LivePlayer(request, onExit)
        is PlayRequest.Vod -> VodPlayer(request) { onExit(null) }
    }
}

private fun Context.tunerActivity(): MainActivity? {
    var context = this
    while (context is ContextWrapper) {
        if (context is MainActivity) return context
        val next = context.baseContext
        if (next === context) break
        context = next
    }
    return context as? MainActivity
}

@Composable
private fun PictureInPictureButton(modifier: Modifier = Modifier) {
    val supported by PlayerHolder.pipSupported.collectAsState()
    val context = LocalContext.current
    if (supported) PillButton("Picture in picture", {
        if (context.tunerActivity()?.enterTunerPictureInPicture() != true) {
            Toasts.show("Picture in picture couldn't start. Play a video and check Tuner's PiP setting in Android.")
        }
    }, modifier, icon = { Icon(Icons.Rounded.PictureInPictureAlt, null, tint = it, modifier = Modifier.size(18.dp)) })
}

// =================================================================== live

@Composable
private fun LivePlayer(req: PlayRequest.Live, onExit: (Channel?) -> Unit) {
    val lineup = req.lineup.ifEmpty { listOf(req.channel) }
    var index by remember { mutableIntStateOf(lineup.indexOfFirst { it.key == req.channel.key }.coerceAtLeast(0)) }
    var previous by remember { mutableIntStateOf(index) }
    val channel = lineup[index]
    var bannerTick by remember { mutableIntStateOf(1) }
    var bannerVisible by remember { mutableStateOf(true) }
    var panelOpen by remember { mutableStateOf(false) }
    var digits by remember { mutableStateOf("") }
    var firstTune by remember { mutableStateOf(true) }
    // True while the viewer is flipping quickly (held key or rapid taps).
    var flipping by remember { mutableStateOf(false) }
    var lastZapAt by remember { mutableLongStateOf(0L) }
    var explicitTune by remember { mutableStateOf(true) }
    // Direction of the last up/down press, so a dead channel is skipped the way the viewer was going.
    var step by remember { mutableIntStateOf(1) }
    var skips by remember { mutableIntStateOf(0) }
    var favoriteLongPress by remember { mutableStateOf(false) }
    val okPress = remember { GuideOkPress() }
    var favoriteNotice by remember { mutableStateOf<String?>(null) }
    var favoriteNoticeTick by remember { mutableIntStateOf(0) }
    var videoFocused by remember { mutableStateOf(true) }
    var controlsFocused by remember { mutableStateOf(false) }
    var controlsRequested by remember { mutableStateOf(false) }
    var trackDialog by remember { mutableStateOf<Int?>(null) }
    val controlsFocus = remember { FocusRequester() }
    val rootFocus = remember { FocusRequester() }
    val ui = rememberPlaybackUi()
    val player = PlayerHolder.player
    val error by PlayerHolder.error.collectAsState()
    val unavailable by PlayerHolder.unavailable.collectAsState()
    val favorites by Repo.prefs.favorites.collectAsState()
    val pipVideoOnly by PlayerHolder.pipVideoOnly.collectAsState()
    val epgVersion by Repo.epgVersion.collectAsState()
    val now = rememberNow(15_000)

    fun showBanner() { bannerVisible = true; bannerTick++ }
    fun togglePlayback() {
        if (error != null) PlayerHolder.retry()
        else if (player.playWhenReady) player.pause() else player.play()
        showBanner()
    }
    fun toggleFavorite(c: Channel) {
        val added = Repo.prefs.toggleFavorite(c.key)
        favoriteNotice = if (added) "${c.name} added to Favorites" else "${c.name} removed from Favorites"
        favoriteNoticeTick++
        showBanner()
    }
    fun zap(to: Int, direction: Int = 0, recordWatched: Boolean = true) {
        val n = lineup.size
        if (direction != 0) step = direction
        var target = ((to % n) + n) % n
        // Channels that just failed are skipped, the way a cable box skips channels you don't get.
        var guard = 0
        while (target != index && Repo.isDead(lineup[target].key) && guard++ < n) target = (((target + step) % n) + n) % n
        if (target != index) {
            val t = android.os.SystemClock.uptimeMillis()
            flipping = t - lastZapAt < 450
            lastZapAt = t
            explicitTune = recordWatched
            previous = index; index = target
            // Hang up on the old channel now. Single-connection plans only accept the next stream
            // once the provider has let go of this one, so the sooner it closes the faster the zap.
            PlayerHolder.releaseForZap()
        } else if (error != null) PlayerHolder.retry()
        else if (!player.playWhenReady) player.play()
        showBanner()
    }

    // Tune. A single press tunes almost at once; while flipping quickly only the banner moves, and the
    // stream opens when the viewer lands on a channel.
    LaunchedEffect(channel.key) {
        val recordWatched = explicitTune
        if (!firstTune) delay(if (flipping) 450 else 90)
        firstTune = false
        PlayerHolder.play(channel.url, live = true, backups = channel.backups, key = channel.key, recordWatched = recordWatched)
        Repo.prefs.lastChannelKey = channel.key
    }
    // The channel failed on every copy: say so briefly, then move on in the direction the viewer was flipping.
    LaunchedEffect(unavailable) {
        if (unavailable == null || unavailable != channel.key || skips >= 5 || lineup.size < 2) return@LaunchedEffect
        Toasts.show("${channel.name} isn't working right now. Skipping it.")
        delay(1500)
        skips++
        zap(index + step, recordWatched = false)
    }
    LaunchedEffect(ui.playing) { if (ui.playing) skips = 0 }
    LaunchedEffect(favoriteNoticeTick) { if (favoriteNotice != null) { delay(2200); favoriteNotice = null } }
    LaunchedEffect(bannerTick, panelOpen, controlsFocused, trackDialog) { delay(6000); if (!panelOpen && !controlsFocused && trackDialog == null) bannerVisible = false }
    LaunchedEffect(controlsRequested, bannerVisible) {
        if (controlsRequested && bannerVisible && !panelOpen && !pipVideoOnly) {
            delay(40)
            runCatching { controlsFocus.requestFocus() }
            controlsRequested = false
        }
    }
    LaunchedEffect(pipVideoOnly) {
        panelOpen = false
        trackDialog = null
        controlsRequested = false
        if (!pipVideoOnly) { showBanner(); delay(40); runCatching { rootFocus.requestFocus() } }
    }
    LaunchedEffect(videoFocused) { if (!videoFocused) { okPress.reset(); favoriteLongPress = false } }
    LaunchedEffect(panelOpen) { if (!panelOpen) { delay(30); runCatching { rootFocus.requestFocus() } } }
    LaunchedEffect(digits) {
        if (digits.isEmpty()) return@LaunchedEffect
        delay(1400)
        val n = digits.toIntOrNull(); digits = ""
        val idx = lineup.indexOfFirst { it.number == n }
        if (idx >= 0) zap(idx)
    }

    BackHandler(enabled = !pipVideoOnly) {
        when {
            trackDialog != null -> trackDialog = null
            panelOpen -> panelOpen = false
            !videoFocused -> runCatching { rootFocus.requestFocus() }
            else -> onExit(channel)
        }
    }

    Box(
        Modifier.fillMaxSize().background(Color.Black)
            .focusRequester(rootFocus)
            .onFocusChanged { videoFocused = it.isFocused }
            .onPreviewKeyEvent { e ->
                if (!pipVideoOnly && e.type == KeyEventType.KeyDown) {
                    when (e.key.nativeKeyCode) {
                        AndroidKeyEvent.KEYCODE_MEDIA_PLAY_PAUSE, AndroidKeyEvent.KEYCODE_SPACE -> { togglePlayback(); return@onPreviewKeyEvent true }
                        AndroidKeyEvent.KEYCODE_MEDIA_PLAY -> { player.play(); showBanner(); return@onPreviewKeyEvent true }
                        AndroidKeyEvent.KEYCODE_MEDIA_PAUSE -> { player.pause(); showBanner(); return@onPreviewKeyEvent true }
                    }
                }
                if (panelOpen || !videoFocused || pipVideoOnly) return@onPreviewKeyEvent false
                if (e.key.nativeKeyCode in listOf(AndroidKeyEvent.KEYCODE_DPAD_CENTER, AndroidKeyEvent.KEYCODE_ENTER)) {
                    val held = okPress.heldMs(e.nativeKeyEvent.eventTime, e.nativeKeyEvent.repeatCount, e.type == KeyEventType.KeyDown)
                    if (e.type == KeyEventType.KeyDown) {
                        if (e.nativeKeyEvent.repeatCount == 0) favoriteLongPress = false
                        if ((e.nativeKeyEvent.isLongPress || (e.nativeKeyEvent.repeatCount > 0 && held >= LONG_PRESS_MS)) && !favoriteLongPress) {
                            favoriteLongPress = true
                            toggleFavorite(channel)
                        }
                    } else if (e.type == KeyEventType.KeyUp) {
                        if (!favoriteLongPress && held >= LONG_PRESS_MS) toggleFavorite(channel)
                        else if (!favoriteLongPress) {
                            if (error != null) PlayerHolder.retry()
                            else if (bannerVisible) panelOpen = true else showBanner()
                        }
                        favoriteLongPress = false
                    }
                    return@onPreviewKeyEvent true
                }
                if (e.type != KeyEventType.KeyDown) return@onPreviewKeyEvent false
                when (val code = e.key.nativeKeyCode) {
                    AndroidKeyEvent.KEYCODE_DPAD_UP, AndroidKeyEvent.KEYCODE_CHANNEL_UP, AndroidKeyEvent.KEYCODE_PAGE_UP -> { zap(index + 1, 1); true }
                    AndroidKeyEvent.KEYCODE_DPAD_DOWN, AndroidKeyEvent.KEYCODE_CHANNEL_DOWN, AndroidKeyEvent.KEYCODE_PAGE_DOWN -> { zap(index - 1, -1); true }
                    AndroidKeyEvent.KEYCODE_DPAD_LEFT, AndroidKeyEvent.KEYCODE_MENU -> { panelOpen = true; true }
                    AndroidKeyEvent.KEYCODE_DPAD_RIGHT -> { showBanner(); controlsRequested = true; true }
                    AndroidKeyEvent.KEYCODE_INFO -> { showBanner(); true }
                    AndroidKeyEvent.KEYCODE_LAST_CHANNEL -> { zap(previous); true }
                    AndroidKeyEvent.KEYCODE_GUIDE -> { onExit(channel); true }
                    in AndroidKeyEvent.KEYCODE_0..AndroidKeyEvent.KEYCODE_9 -> {
                        if (digits.length < 5) digits += (code - AndroidKeyEvent.KEYCODE_0).toString()
                        showBanner(); true
                    }
                    else -> false
                }
            }
            .focusable(),
    ) {
        VideoSurface(Modifier.fillMaxSize(), texture = false)
        if (!pipVideoOnly) {
        if ((ui.buffering || player.playbackState == Player.STATE_IDLE) && error == null) {
            CircularProgressIndicator(color = Color.White, strokeWidth = 3.dp, modifier = Modifier.align(Alignment.Center).size(44.dp))
        }
        if (!player.playWhenReady && player.playbackState == Player.STATE_READY) {
            Text("Paused", color = Color.White, fontSize = 13.sp,
                modifier = Modifier.align(Alignment.TopEnd).padding(24.dp).clip(RoundedCornerShape(50)).background(Color.Black.copy(alpha = 0.7f)).padding(horizontal = 14.dp, vertical = 8.dp))
        }
        error?.let { ErrorCard(it, "Press OK to retry, or change channel", Modifier.align(Alignment.Center)) }

        AnimatedVisibility(bannerVisible && !panelOpen, Modifier.align(Alignment.BottomCenter), enter = fadeIn(), exit = fadeOut()) {
            LiveBanner(channel, now, epgVersion, channel.key in favorites, onFavorite = { toggleFavorite(channel) },
                playing = player.playWhenReady, onTogglePlayback = ::togglePlayback,
                controlsFocus = controlsFocus, onControlsFocus = { controlsFocused = it }, onChannels = { panelOpen = true }, onReturnToVideo = { rootFocus.requestFocus() },
                onAudio = { trackDialog = C.TRACK_TYPE_AUDIO }, onSubtitles = { trackDialog = C.TRACK_TYPE_TEXT })
        }
        if (digits.isNotEmpty()) {
            Text(
                digits, color = Color.White, fontSize = 44.sp, fontWeight = FontWeight.Bold,
                modifier = Modifier.align(Alignment.TopEnd).padding(32.dp).clip(RoundedCornerShape(12.dp))
                    .background(Color.Black.copy(alpha = 0.6f)).padding(horizontal = 20.dp, vertical = 6.dp),
            )
        }
        AnimatedVisibility(
            panelOpen, Modifier.align(Alignment.CenterStart),
            enter = slideInHorizontally { -it } + fadeIn(), exit = slideOutHorizontally { -it } + fadeOut(),
        ) {
            ChannelPanel(lineup, index, now, epgVersion, favorites, onFavorite = ::toggleFavorite, onDismiss = { panelOpen = false }, onPick = { i -> zap(i); panelOpen = false })
        }
        favoriteNotice?.let { message ->
            Text(message, color = Color.White, fontSize = 13.sp, fontWeight = FontWeight.Medium, maxLines = 1, overflow = TextOverflow.Ellipsis,
                modifier = Modifier.align(Alignment.TopCenter).padding(top = 22.dp, start = 24.dp, end = 24.dp)
                    .clip(RoundedCornerShape(50)).background(Color(0xFF221B3A).copy(alpha = 0.95f)).padding(horizontal = 18.dp, vertical = 10.dp))
        }
        trackDialog?.let { type ->
            TrackDialog(type, ui.tracksVersion, onClose = { trackDialog = null; showBanner(); controlsRequested = true })
        }
        }
    }
    LaunchedEffect(Unit) { runCatching { rootFocus.requestFocus() } }
}

private fun nowNext(c: Channel, now: Long): Pair<Program?, Program?> {
    val list = Repo.programsFor(c).orEmpty()
    val i = list.indexOfFirst { it.isOnAt(now) }
    return if (i >= 0) list[i] to list.getOrNull(i + 1) else null to list.firstOrNull { it.start > now }
}

@Composable
private fun LiveBanner(c: Channel, now: Long, epgVersion: Int, favorite: Boolean, onFavorite: () -> Unit, playing: Boolean, onTogglePlayback: () -> Unit, controlsFocus: FocusRequester, onControlsFocus: (Boolean) -> Unit, onChannels: () -> Unit, onReturnToVideo: () -> Unit, onAudio: () -> Unit, onSubtitles: () -> Unit) {
    val (cur, next) = remember(c, now, epgVersion) { nowNext(c, now) }
    BoxWithConstraints(
        Modifier.fillMaxWidth().background(Brush.verticalGradient(listOf(Color.Transparent, Color.Black.copy(alpha = 0.92f))))
    ) {
        val compact = maxWidth < 760.dp
        val edge = if (compact) 24.dp else 40.dp
        Column(Modifier.padding(start = edge, end = edge, top = if (compact) 40.dp else 60.dp, bottom = if (compact) 20.dp else 28.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.width(if (compact) 80.dp else 96.dp)) {
                    ChannelLogo(c, Modifier.size(if (compact) 64.dp else 76.dp, 42.dp))
                    Text(c.number.toString(), color = Color.White, fontSize = if (compact) 25.sp else 30.sp, fontWeight = FontWeight.Bold, modifier = Modifier.padding(top = 4.dp))
                }
                Spacer(Modifier.width(if (compact) 16.dp else 24.dp))
                Column(Modifier.weight(1f)) {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        Text("LIVE", color = Color.White, fontSize = 10.sp, fontWeight = FontWeight.Bold,
                            modifier = Modifier.clip(RoundedCornerShape(4.dp)).background(Palette.live).padding(horizontal = 7.dp, vertical = 3.dp))
                        Text(c.name, color = Color.White.copy(alpha = 0.8f), fontSize = 14.sp, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
                        FavoriteAction(c, favorite, onFavorite, compact = compact)
                    }
                    Text(
                        cur?.title?.ifBlank { null } ?: c.name, color = Color.White, fontSize = if (compact) 22.sp else 27.sp, fontWeight = FontWeight.Bold,
                        maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(top = 5.dp),
                    )
                    if (cur != null) {
                        Row(Modifier.padding(top = 7.dp), verticalAlignment = Alignment.CenterVertically) {
                            Text(fmtRange(cur.start, cur.end), color = Color.White.copy(alpha = 0.82f), fontSize = 13.sp)
                            val frac = ((now - cur.start).toFloat() / (cur.end - cur.start).coerceAtLeast(1L)).coerceIn(0f, 1f)
                            Box(Modifier.weight(1f).padding(horizontal = 12.dp).height(4.dp).clip(RoundedCornerShape(2.dp)).background(Color.White.copy(alpha = 0.22f))) {
                                Box(Modifier.fillMaxHeight().fillMaxWidth(frac).background(Palette.accent))
                            }
                            Text("${((cur.end - now + 59_999) / 60_000).coerceAtLeast(0)} min left", color = Color.White.copy(alpha = 0.72f), fontSize = 12.sp)
                        }
                        if (!compact && !cur.desc.isNullOrBlank()) Text(
                            cur.desc, color = Color.White.copy(alpha = 0.72f), fontSize = 13.sp, maxLines = 2, overflow = TextOverflow.Ellipsis,
                            lineHeight = 18.sp, modifier = Modifier.padding(top = 7.dp),
                        )
                    } else Text("Program information unavailable", color = Color.White.copy(alpha = 0.65f), fontSize = 13.sp, modifier = Modifier.padding(top = 6.dp))
                    if (next != null) Text(
                        "Up next  ·  ${fmtTime(next.start)}  ${next.title}", color = Color.White.copy(alpha = 0.75f), fontSize = 13.sp,
                        maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(top = 9.dp),
                    )
                }
            }
            Row(
                Modifier.fillMaxWidth().padding(top = 14.dp).horizontalScroll(rememberScrollState())
                    .onFocusChanged { onControlsFocus(it.hasFocus) }.focusGroup()
                    .onPreviewKeyEvent { e ->
                        if (e.type == KeyEventType.KeyDown && e.key.nativeKeyCode in listOf(AndroidKeyEvent.KEYCODE_DPAD_UP, AndroidKeyEvent.KEYCODE_DPAD_DOWN)) {
                            onReturnToVideo(); true
                        } else false
                    },
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                PillButton("Channels", onChannels, Modifier.focusRequester(controlsFocus), icon = { Icon(Icons.Rounded.List, null, tint = it, modifier = Modifier.size(18.dp)) })
                PillButton(if (playing) "Pause" else "Play", onTogglePlayback, icon = { Icon(if (playing) Icons.Rounded.Pause else Icons.Rounded.PlayArrow, null, tint = it, modifier = Modifier.size(18.dp)) })
                PillButton(if (favorite) "Saved" else "Favorite", onFavorite, icon = { Icon(if (favorite) Icons.Rounded.Star else Icons.Rounded.StarBorder, null, tint = it, modifier = Modifier.size(18.dp)) })
                PillButton("Subtitles", onSubtitles, icon = { Icon(Icons.Rounded.ClosedCaption, null, tint = it, modifier = Modifier.size(18.dp)) })
                PillButton("Audio", onAudio, icon = { Icon(Icons.Rounded.GraphicEq, null, tint = it, modifier = Modifier.size(18.dp)) })
                PictureInPictureButton()
            }
            Text(
                "↑ ↓ / CH + −  Channel     ←  Channel list     →  Controls     Hold OK  Favorite     Back  Return", color = Color.White.copy(alpha = 0.62f), fontSize = 11.sp,
                maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(top = 16.dp).align(Alignment.End),
            )
        }
    }
}

@Composable
private fun ChannelPanel(lineup: List<Channel>, current: Int, now: Long, epgVersion: Int, favorites: Set<String>, onFavorite: (Channel) -> Unit, onDismiss: () -> Unit, onPick: (Int) -> Unit) {
    var favoritesOnly by remember { mutableStateOf(false) }
    var rowsFocused by remember { mutableStateOf(false) }
    val shown = remember(lineup, favorites, favoritesOnly) { lineup.withIndex().filter { !favoritesOnly || it.value.key in favorites } }
    val list = rememberLazyListState(initialFirstVisibleItemIndex = (current - 2).coerceAtLeast(0))
    val currentFocus = remember { FocusRequester() }
    val allFocus = remember { FocusRequester() }
    val focusIndex = shown.indexOfFirst { it.index == current }.coerceAtLeast(0)
    LaunchedEffect(favoritesOnly) {
        if (shown.isNotEmpty()) list.scrollToItem((focusIndex - 1).coerceAtLeast(0))
        delay(60)
        runCatching { if (shown.isEmpty()) allFocus.requestFocus() else currentFocus.requestFocus() }
    }
    LaunchedEffect(favorites, favoritesOnly) {
        if (favoritesOnly && shown.isEmpty()) { delay(40); runCatching { allFocus.requestFocus() } }
    }
    BoxWithConstraints(Modifier.fillMaxSize()) {
    Column(
        Modifier.width((maxWidth * 0.58f).coerceAtMost(440.dp)).fillMaxHeight()
            .background(Brush.horizontalGradient(listOf(Color(0xFF0E0C1A).copy(alpha = 0.98f), Color(0xFF171428).copy(alpha = 0.96f))))
            .onPreviewKeyEvent { e ->
                if (rowsFocused && e.type == KeyEventType.KeyDown && e.key.nativeKeyCode == AndroidKeyEvent.KEYCODE_DPAD_RIGHT) { onDismiss(); true } else false
            },
    ) {
        Column(Modifier.padding(horizontal = 24.dp, vertical = 22.dp)) {
            Text("Channels", color = Color.White, fontSize = 23.sp, fontWeight = FontWeight.Bold)
            Text("${shown.size} channels  ·  ${fmtTime(now)}", color = Color.White.copy(alpha = 0.65f), fontSize = 12.sp, modifier = Modifier.padding(top = 4.dp))
            Row(Modifier.padding(top = 14.dp).focusGroup(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                PillButton("All", { favoritesOnly = false }, Modifier.focusRequester(allFocus), primary = !favoritesOnly)
                PillButton("Favorites", { favoritesOnly = true }, primary = favoritesOnly, icon = { Icon(Icons.Rounded.Star, null, tint = it, modifier = Modifier.size(16.dp)) })
            }
        }
        if (shown.isEmpty()) {
            Column(Modifier.weight(1f).fillMaxWidth().padding(horizontal = 24.dp), verticalArrangement = Arrangement.Center) {
                Text("No favorites yet", color = Color.White, fontSize = 18.sp, fontWeight = FontWeight.SemiBold)
                Text("Choose All, then hold OK on a channel to save it here.", color = Color.White.copy(alpha = 0.72f), fontSize = 13.sp, lineHeight = 19.sp, modifier = Modifier.padding(top = 8.dp))
            }
        } else {
        LazyColumn(
            modifier = Modifier.weight(1f).onFocusChanged { rowsFocused = it.hasFocus }.focusGroup(), state = list, contentPadding = PaddingValues(horizontal = 14.dp, vertical = 4.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            itemsIndexed(shown, key = { _, row -> row.value.key }) { shownIndex, row ->
                val i = row.index
                val c = row.value
                val cur = remember(c.key, now, epgVersion) { Repo.programsFor(c)?.firstOrNull { it.isOnAt(now) } }
                FocusBox(
                    onClick = { onPick(i) },
                    onLongClick = { onFavorite(c) },
                    modifier = Modifier.fillMaxWidth().height(66.dp).then(if (shownIndex == focusIndex) Modifier.focusRequester(currentFocus) else Modifier),
                    shape = RoundedCornerShape(10.dp),
                    color = if (i == current) Color.White.copy(alpha = 0.12f) else Color.Transparent,
                    focusedColor = Palette.focus, ring = false, focusedScale = 1.0f,
                ) { f ->
                    val fg = if (f) Palette.onFocus else Color.White
                    Row(Modifier.fillMaxSize().padding(horizontal = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                        Text(c.number.toString(), color = fg.copy(alpha = 0.7f), fontSize = 14.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.width(40.dp))
                        ChannelLogo(c, Modifier.size(40.dp, 30.dp))
                        Column(Modifier.weight(1f).padding(start = 10.dp)) {
                            Text(c.name, color = fg, fontSize = 14.sp, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                            Text(cur?.title?.ifBlank { null } ?: "Live TV", color = fg.copy(alpha = 0.68f), fontSize = 12.sp, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(top = 3.dp))
                        }
                        if (i == current) Icon(Icons.Rounded.PlayArrow, "Currently watching", tint = if (f) fg else Palette.accent, modifier = Modifier.padding(start = 8.dp).size(18.dp))
                        FavoriteAction(c, c.key in favorites, onFavorite = { onFavorite(c) }, compact = true, focusedParent = f)
                    }
                }
            }
        }
        }
        Text("OK Watch  ·  Hold OK Favorite  ·  Back Close", color = Color.White.copy(alpha = 0.65f), fontSize = 11.sp,
            modifier = Modifier.padding(horizontal = 24.dp, vertical = 18.dp), maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
    }
}

@Composable
private fun FavoriteAction(c: Channel, favorite: Boolean, onFavorite: () -> Unit, compact: Boolean, focusedParent: Boolean = false) {
    FocusBox(
        onClick = onFavorite, color = Color.Transparent, focusedColor = Palette.focus, ring = false, focusedScale = 1f,
        modifier = Modifier.focusProperties { canFocus = false }.semantics {
            contentDescription = if (favorite) "Remove ${c.name} from Favorites" else "Add ${c.name} to Favorites"
        },
        shape = RoundedCornerShape(50),
    ) { focused ->
        val tint = if (focused || focusedParent) Palette.onFocus else if (favorite) Palette.accent else Color.White.copy(alpha = 0.76f)
        Row(Modifier.padding(horizontal = 8.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
            Icon(if (favorite) Icons.Rounded.Star else Icons.Rounded.StarBorder, null, tint = tint, modifier = Modifier.size(18.dp))
            if (!compact) Text(if (favorite) "Saved" else "Favorite", color = tint, fontSize = 11.sp, modifier = Modifier.padding(start = 5.dp))
        }
    }
}

// =================================================================== VOD

@Composable
private fun VodPlayer(req: PlayRequest.Vod, onExit: () -> Unit) {
    var current by remember { mutableStateOf(req) }
    var queue by remember { mutableStateOf(req.queue) }
    var controlsTick by remember { mutableIntStateOf(1) }
    var controlsVisible by remember { mutableStateOf(true) }
    var trackDialog by remember { mutableStateOf<Int?>(null) }
    var optionsFocused by remember { mutableStateOf(false) }
    var optionsRequested by remember { mutableStateOf(false) }
    val rootFocus = remember { FocusRequester() }
    val optionsFocus = remember { FocusRequester() }
    val ui = rememberPlaybackUi()
    val error by PlayerHolder.error.collectAsState()
    val player = PlayerHolder.player
    val pipVideoOnly by PlayerHolder.pipVideoOnly.collectAsState()

    fun showControls() { controlsVisible = true; controlsTick++ }
    fun save() {
        val pos = player.currentPosition
        val dur = player.duration.takeIf { it != C.TIME_UNSET } ?: 0
        if (pos > 0) {
            Repo.prefs.saveProgress(
                Recent(current.resumeId, current.title, current.subtitle, current.image, current.url, pos, dur, System.currentTimeMillis()),
            )
        }
    }
    fun seekBy(ms: Long) {
        val dur = player.duration.takeIf { it != C.TIME_UNSET } ?: Long.MAX_VALUE
        player.seekTo((player.currentPosition + ms).coerceIn(0, dur))
        ui.position = player.currentPosition
        showControls()
    }
    fun playNext() {
        val next = queue.firstOrNull()
        if (next == null) {
            if (pipVideoOnly) player.pause() else onExit()
            return
        }
        save()
        queue = queue.drop(1)
        current = next
    }

    LaunchedEffect(current.url) { PlayerHolder.play(current.url, live = false, startMs = current.startMs, backups = current.streamBackups, subtitles = current.subtitles) }
    LaunchedEffect(Unit) { while (true) { delay(10_000); save() } }
    DisposableEffect(Unit) { onDispose { save() } }
    LaunchedEffect(ui.ended) { if (ui.ended > 0) playNext() }
    LaunchedEffect(controlsTick, ui.playing, optionsFocused, trackDialog) {
        delay(4500)
        if (ui.playing && !optionsFocused && trackDialog == null) controlsVisible = false
    }
    LaunchedEffect(optionsRequested, controlsVisible) {
        if (optionsRequested && controlsVisible) {
            // The controls have to be composed before their first button can receive remote focus.
            delay(30)
            runCatching { optionsFocus.requestFocus() }
            optionsRequested = false
        }
    }
    LaunchedEffect(trackDialog) { if (trackDialog == null) { delay(30); runCatching { rootFocus.requestFocus() } } }
    LaunchedEffect(pipVideoOnly) {
        trackDialog = null
        optionsRequested = false
        if (!pipVideoOnly) { showControls(); delay(40); runCatching { rootFocus.requestFocus() } }
    }

    BackHandler(enabled = !pipVideoOnly) {
        when {
            trackDialog != null -> trackDialog = null
            optionsFocused -> runCatching { rootFocus.requestFocus() }
            else -> onExit()
        }
    }

    BoxWithConstraints(
        Modifier.fillMaxSize().background(Color.Black)
            .focusRequester(rootFocus)
            .onPreviewKeyEvent { e ->
                if (pipVideoOnly || e.type != KeyEventType.KeyDown || trackDialog != null || optionsFocused) return@onPreviewKeyEvent false
                val repeat = e.nativeKeyEvent.repeatCount
                val step = 10_000L * (1 + repeat / 4).coerceAtMost(12)
                when (e.key.nativeKeyCode) {
                    AndroidKeyEvent.KEYCODE_DPAD_CENTER, AndroidKeyEvent.KEYCODE_ENTER,
                    AndroidKeyEvent.KEYCODE_MEDIA_PLAY_PAUSE, AndroidKeyEvent.KEYCODE_SPACE -> {
                        if (error != null) PlayerHolder.retry()
                        else if (player.isPlaying) player.pause() else {
                            if (player.playbackState == Player.STATE_ENDED) player.seekTo(0)
                            player.play()
                        }
                        showControls(); true
                    }
                    AndroidKeyEvent.KEYCODE_MEDIA_PLAY -> { if (player.playbackState == Player.STATE_ENDED) player.seekTo(0); player.play(); showControls(); true }
                    AndroidKeyEvent.KEYCODE_MEDIA_PAUSE -> { player.pause(); showControls(); true }
                    AndroidKeyEvent.KEYCODE_DPAD_LEFT -> { seekBy(-step); true }
                    AndroidKeyEvent.KEYCODE_DPAD_RIGHT -> { seekBy(step); true }
                    AndroidKeyEvent.KEYCODE_MEDIA_REWIND -> { seekBy(-30_000); true }
                    AndroidKeyEvent.KEYCODE_MEDIA_FAST_FORWARD -> { seekBy(30_000); true }
                    AndroidKeyEvent.KEYCODE_MEDIA_NEXT -> { playNext(); true }
                    AndroidKeyEvent.KEYCODE_DPAD_DOWN, AndroidKeyEvent.KEYCODE_MENU -> {
                        showControls(); optionsRequested = true; true
                    }
                    AndroidKeyEvent.KEYCODE_DPAD_UP, AndroidKeyEvent.KEYCODE_INFO -> { showControls(); true }
                    else -> false
                }
            }
            .focusable(),
    ) {
        val compact = maxWidth < 760.dp || maxHeight < 440.dp
        val edge = if (compact) 24.dp else 40.dp
        VideoSurface(Modifier.fillMaxSize(), texture = false)
        if (!pipVideoOnly) {
        if (ui.buffering && error == null) {
            CircularProgressIndicator(color = Color.White, strokeWidth = 3.dp, modifier = Modifier.align(Alignment.Center).size(44.dp))
        }
        error?.let { ErrorCard(it, "Press OK to retry", Modifier.align(Alignment.Center)) }

        AnimatedVisibility(controlsVisible || !ui.playing, Modifier.fillMaxSize(), enter = fadeIn(), exit = fadeOut()) {
            Box(Modifier.fillMaxSize()) {
                Box(
                    Modifier.fillMaxWidth().height(140.dp)
                        .background(Brush.verticalGradient(listOf(Color.Black.copy(alpha = 0.8f), Color.Transparent))),
                ) {
                    Column(Modifier.padding(start = edge, end = edge, top = if (compact) 22.dp else 30.dp)) {
                        Text(current.title, color = Color.White, fontSize = if (compact) 22.sp else 27.sp, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        current.subtitle?.let { Text(it, color = Color.White.copy(alpha = 0.72f), fontSize = 14.sp, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(top = 4.dp)) }
                    }
                }
                Column(
                    Modifier.align(Alignment.BottomCenter).fillMaxWidth()
                        .background(Brush.verticalGradient(listOf(Color.Transparent, Color.Black.copy(alpha = 0.9f))))
                        .padding(start = edge, end = edge, top = if (compact) 36.dp else 60.dp, bottom = if (compact) 18.dp else 26.dp),
                ) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(
                            if (ui.playing) Icons.Rounded.Pause else Icons.Rounded.PlayArrow, null,
                            tint = Color.White, modifier = Modifier.size(30.dp),
                        )
                        Text(fmtClock(ui.position), color = Color.White, fontSize = 14.sp, modifier = Modifier.padding(start = 12.dp, end = 14.dp))
                        val frac = if (ui.duration > 0) ui.position.toFloat() / ui.duration else 0f
                        Box(Modifier.weight(1f).height(5.dp).clip(RoundedCornerShape(3.dp)).background(Color.White.copy(alpha = 0.22f))) {
                            Box(Modifier.fillMaxHeight().fillMaxWidth(frac.coerceIn(0f, 1f)).background(Palette.accent))
                        }
                        Text(
                            if (ui.duration > 0) "-" + fmtClock(ui.duration - ui.position) else "--:--",
                            color = Color.White.copy(alpha = 0.75f), fontSize = 14.sp, modifier = Modifier.padding(start = 14.dp),
                        )
                    }
                    Row(
                        Modifier.padding(top = 16.dp).horizontalScroll(rememberScrollState()).onFocusChanged { optionsFocused = it.hasFocus }.focusGroup()
                            .onPreviewKeyEvent { e ->
                                if (e.type == KeyEventType.KeyDown && e.key.nativeKeyCode == AndroidKeyEvent.KEYCODE_DPAD_UP) {
                                    rootFocus.requestFocus(); showControls(); true
                                } else false
                            },
                        horizontalArrangement = Arrangement.spacedBy(10.dp),
                    ) {
                        PillButton(
                            "Audio", { trackDialog = C.TRACK_TYPE_AUDIO }, Modifier.focusRequester(optionsFocus),
                            icon = { Icon(Icons.Rounded.GraphicEq, null, tint = it, modifier = Modifier.size(18.dp)) },
                        )
                        PillButton(
                            "Subtitles", { trackDialog = C.TRACK_TYPE_TEXT },
                            icon = { Icon(Icons.Rounded.ClosedCaption, null, tint = it, modifier = Modifier.size(18.dp)) },
                        )
                        if (queue.isNotEmpty()) PillButton(
                            "Next episode", { playNext() },
                            icon = { Icon(Icons.Rounded.SkipNext, null, tint = it, modifier = Modifier.size(18.dp)) },
                        )
                        PictureInPictureButton()
                    }
                    Text("OK  ${if (ui.playing) "Pause" else "Play"}     ← →  Seek 10s     ↓  Controls     Back  Return",
                        color = Color.White.copy(alpha = 0.65f), fontSize = 11.sp, maxLines = 1, overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.padding(top = 13.dp))
                }
            }
        }
        trackDialog?.let { type ->
            TrackDialog(type, ui.tracksVersion, onClose = { trackDialog = null })
        }
        }
    }
    LaunchedEffect(Unit) { runCatching { rootFocus.requestFocus() } }
}

@Composable
private fun TrackDialog(type: Int, version: Int, onClose: () -> Unit) {
    val player = PlayerHolder.player
    data class Option(val label: String, val selected: Boolean, val apply: () -> Unit)
    val options = remember(type, version) {
        val out = mutableListOf<Option>()
        val params = player.trackSelectionParameters
        val textDisabled = C.TRACK_TYPE_TEXT in params.disabledTrackTypes
        var n = 0
        player.currentTracks.groups.filter { it.type == type }.forEach { g ->
            for (i in 0 until g.length) {
                if (!g.isTrackSupported(i)) continue
                n++
                val f = g.getTrackFormat(i)
                val lang = f.language?.takeIf { it != "und" }?.let { Locale(it).displayLanguage.ifBlank { it } }
                val extra = if (type == C.TRACK_TYPE_AUDIO && f.channelCount > 0)
                    when (f.channelCount) { 1 -> "Mono"; 2 -> "Stereo"; 6 -> "5.1"; 8 -> "7.1"; else -> "${f.channelCount}ch" }
                    else if (type == C.TRACK_TYPE_TEXT) captionKind(f) else null
                val label = listOfNotNull(f.label ?: lang ?: if (extra != null) null else "Track $n", extra).joinToString(" · ")
                out += Option(label, g.isTrackSelected(i) && !(type == C.TRACK_TYPE_TEXT && textDisabled)) {
                    player.trackSelectionParameters = params.buildUpon()
                        .setTrackTypeDisabled(type, false)
                        .setOverrideForType(TrackSelectionOverride(g.mediaTrackGroup, i))
                        .build()
                }
            }
        }
        // "Off" only makes sense when the stream has something to turn off.
        if (type == C.TRACK_TYPE_TEXT && out.isNotEmpty()) {
            out.add(0, Option("Off", textDisabled || out.none { it.selected }) {
                player.trackSelectionParameters = params.buildUpon().setTrackTypeDisabled(C.TRACK_TYPE_TEXT, true).build()
            })
        }
        out
    }
    val selectedFocus = remember { FocusRequester() }
    val closeFocus = remember { FocusRequester() }
    val selectedIndex = options.indexOfFirst { it.selected }.coerceAtLeast(0)
    val list = rememberLazyListState(initialFirstVisibleItemIndex = selectedIndex)
    LaunchedEffect(type) { delay(40); runCatching { if (options.isEmpty()) closeFocus.requestFocus() else selectedFocus.requestFocus() } }
    Dialog(onDismissRequest = onClose, properties = DialogProperties(usePlatformDefaultWidth = false)) {
    BoxWithConstraints(Modifier.fillMaxSize().dimBackground(0.62f), contentAlignment = Alignment.CenterEnd) {
        Column(
            Modifier.width((maxWidth * 0.56f).coerceAtMost(380.dp)).fillMaxHeight().background(Palette.surface).padding(24.dp),
        ) {
            Text(
                if (type == C.TRACK_TYPE_AUDIO) "Audio" else "Subtitles", color = Palette.text, fontSize = 22.sp,
                fontWeight = FontWeight.Bold,
            )
            Text(if (type == C.TRACK_TYPE_AUDIO) "Choose your preferred audio track" else "Choose a language or turn subtitles off. Settings > Subtitles turns them on for every stream.",
                color = Palette.dim, fontSize = 12.sp, modifier = Modifier.padding(top = 5.dp, bottom = 20.dp))
            LazyColumn(state = list, modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(7.dp), contentPadding = PaddingValues(bottom = 12.dp)) {
                if (options.isEmpty()) item {
                    if (type == C.TRACK_TYPE_TEXT) Column {
                        Text(
                            if (player.currentTracks.isEmpty) "Still loading this stream" else "No subtitles in this stream",
                            color = Palette.text, fontSize = 16.sp, fontWeight = FontWeight.SemiBold,
                        )
                        Text(
                            if (player.currentTracks.isEmpty) "Subtitles and closed captions appear here once the stream starts."
                            else "This channel or video doesn't include subtitles or closed captions.",
                            color = Palette.dim, fontSize = 13.sp, lineHeight = 18.sp, modifier = Modifier.padding(top = 6.dp),
                        )
                    } else Text("No alternate tracks available for this stream.", color = Palette.dim, fontSize = 14.sp)
                }
                itemsIndexed(options) { i, o ->
                FocusBox(
                    onClick = { o.apply(); onClose() },
                    modifier = Modifier.fillMaxWidth().height(48.dp).then(if (i == selectedIndex) Modifier.focusRequester(selectedFocus) else Modifier),
                    shape = RoundedCornerShape(8.dp), color = Palette.surface2, focusedColor = Palette.focus,
                    ring = false, focusedScale = 1.0f,
                ) { f ->
                    Row(Modifier.fillMaxSize().padding(horizontal = 14.dp), verticalAlignment = Alignment.CenterVertically) {
                        val fg = if (f) Palette.onFocus else Palette.text
                        Text(o.label, color = fg, fontSize = 15.sp, modifier = Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis)
                        if (o.selected) Icon(Icons.Rounded.Check, "Selected", tint = if (f) fg else Palette.accent, modifier = Modifier.padding(start = 10.dp).size(20.dp))
                    }
                }
                }
            }
            PillButton("Done", onClose, Modifier.focusRequester(closeFocus).padding(top = 12.dp))
        }
    }
    }
}

/** Closed captions carried inside the video (CEA-608 / CEA-708) have no language tag; name them plainly. */
private fun captionKind(f: androidx.media3.common.Format): String? {
    val mime = listOfNotNull(f.sampleMimeType, f.codecs).joinToString(" ")
    return when {
        MimeTypes.APPLICATION_CEA608 in mime -> "Closed captions" + (if (f.accessibilityChannel > 1) " (CC${f.accessibilityChannel})" else "")
        MimeTypes.APPLICATION_CEA708 in mime -> "Closed captions (CEA-708)"
        else -> null
    }
}

@Composable
private fun ErrorCard(message: String, hint: String, modifier: Modifier) {
    Column(
        modifier.widthIn(max = 460.dp).fillMaxWidth(0.86f).clip(RoundedCornerShape(16.dp)).background(Color(0xFF141224).copy(alpha = 0.94f)).padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Icon(Icons.Rounded.Refresh, null, tint = Palette.accent, modifier = Modifier.size(30.dp))
        Text("Playback interrupted", color = Color.White, fontSize = 20.sp, fontWeight = FontWeight.Bold, modifier = Modifier.padding(top = 10.dp))
        Text(message, color = Color.White.copy(alpha = 0.72f), fontSize = 13.sp, textAlign = TextAlign.Center, maxLines = 3, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(top = 8.dp))
        Text(hint, color = Color.White.copy(alpha = 0.9f), fontSize = 13.sp, textAlign = TextAlign.Center, modifier = Modifier.padding(top = 16.dp))
    }
}

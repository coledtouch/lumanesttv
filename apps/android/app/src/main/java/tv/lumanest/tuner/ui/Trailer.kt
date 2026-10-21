package tv.lumanest.tuner.ui

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.ui.Alignment
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Movie
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.FilterQuality
import androidx.compose.ui.input.InputMode
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalInputModeManager
import androidx.compose.ui.platform.LocalWindowInfo
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.core.net.toUri
import com.google.zxing.BarcodeFormat
import com.google.zxing.EncodeHintType
import com.google.zxing.qrcode.QRCodeWriter
import tv.lumanest.tuner.data.ExtrasApi
import tv.lumanest.tuner.data.Trailer

/**
 * Hands a trailer to the TV's YouTube app (docs/extras.md, "Per platform", Android TV, Google TV and Fire TV) when Tuner's
 * own player can't play it ([TrailerPolicy]): the watch page with each YouTube app's package in turn, then the
 * `vnd.youtube:` link YouTube apps answer. A YouTube link followed in the player goes to those packages too ([openLink]).
 * No browser is ever opened (TV apps on Google Play must not open one), and no `<queries>` or permission is needed: the
 * app only starts activities. The same in both editions.
 */
object TrailerLauncher {
    /** Android TV and Google TV, Fire TV (two packages), Google TV's other build, then the phone app. */
    val PACKAGES = listOf(
        "com.google.android.youtube.tv",
        "com.amazon.firetv.youtube",
        "com.amazon.firetv.youtube.tv",
        "com.google.android.youtube.googletv",
        "com.google.android.youtube",
    )

    /** One way to open the trailer: a view of [uri], in [packageName] when it is set. */
    data class Attempt(val uri: String, val packageName: String?)

    /** Every way, in order; none for a key that isn't a YouTube video key. */
    fun attempts(key: String): List<Attempt> {
        if (!ExtrasApi.isYouTubeKey(key)) return emptyList()
        return PACKAGES.map { Attempt("https://www.youtube.com/watch?v=$key", it) } + Attempt("vnd.youtube:$key", null)
    }

    /** Tries each attempt with [start] until one starts; false when none could (then the QR dialog shows). */
    fun open(key: String, start: (Attempt) -> Unit): Boolean = firstThatStarts(attempts(key), start)

    fun open(context: Context, key: String): Boolean = open(key) { context.startActivity(intent(it, newTask = context !is Activity)) }

    /**
     * A YouTube link the viewer followed in Tuner's trailer player ([TrailerPage.opensInYouTube]), in each YouTube app
     * of [PACKAGES] in turn; never without a package, so no browser opens it. False when none could.
     */
    fun openLink(uri: String, start: (Attempt) -> Unit): Boolean = firstThatStarts(PACKAGES.map { Attempt(uri, it) }, start)

    fun openLink(context: Context, uri: String): Boolean = openLink(uri) { context.startActivity(intent(it, newTask = context !is Activity)) }

    private fun firstThatStarts(attempts: List<Attempt>, start: (Attempt) -> Unit): Boolean {
        for (attempt in attempts) {
            try {
                start(attempt)
                return true
            } catch (_: ActivityNotFoundException) {
                // That app isn't installed or doesn't open this link: try the next.
            } catch (_: SecurityException) {
                // That app's activity isn't open to other apps.
            }
        }
        return false
    }

    fun intent(attempt: Attempt, newTask: Boolean = false): Intent =
        Intent(Intent.ACTION_VIEW, attempt.uri.toUri()).apply {
            attempt.packageName?.let(::setPackage)
            if (newTask) addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
}

/** The QR code of [text] as rows of `0` and `1` (dark), one per module, without a quiet zone, as lumanest.tv sends its own. */
internal fun qrRows(text: String): List<String> {
    val matrix = QRCodeWriter().encode(text, BarcodeFormat.QR_CODE, 0, 0, mapOf(EncodeHintType.MARGIN to 0))
    return (0 until matrix.height).map { y -> buildString { for (x in 0 until matrix.width) append(if (matrix[x, y]) '1' else '0') } }
}

/**
 * Trailer, after Add to Library on a movie or series page (docs/extras.md, "The Trailer button"). Nothing is shown
 * without a [trailer], so the button appears in place when the lookup answers and never takes the focus. It plays the
 * trailer in Tuner, full screen ([TrailerPlayerDialog]), so Back comes back here. When Tuner can't play it, the YouTube
 * app opens on it; when no YouTube app opens, a QR code for a phone shows instead. When YouTube no longer has the
 * video (removed or private), neither could play it: a toast says so ([TRAILER_GONE]). Closing the player or the QR
 * code brings the focus back here.
 */
@Composable
internal fun TrailerButton(trailer: Trailer?, modifier: Modifier = Modifier) {
    if (trailer == null) return
    val context = LocalContext.current
    var playing by remember(trailer.key) { mutableStateOf(false) }
    var showQr by remember(trailer.key) { mutableStateOf(false) }
    var restoreFocus by remember { mutableStateOf(false) }
    val focus = remember { FocusRequester() }
    // Back on the page once its window has the focus again (the player and the QR code have their own windows).
    val windowFocused = LocalWindowInfo.current.isWindowFocused
    LaunchedEffect(restoreFocus, windowFocused) {
        if (restoreFocus && windowFocused && requestAttachedFocus(focus)) restoreFocus = false
    }
    PillButton(
        "Trailer", { playing = true },
        modifier.focusRequester(focus).testTag("trailer"),
        icon = { Icon(Icons.Rounded.Movie, null, tint = it, modifier = Modifier.size(20.dp)) },
    )
    if (playing) TrailerPlayerDialog(
        trailer,
        onClose = {
            playing = false
            restoreFocus = true
        },
        onFallBack = {
            playing = false
            restoreFocus = true
            if (!TrailerLauncher.open(context, trailer.key)) showQr = true
        },
        onUnavailable = {
            playing = false
            restoreFocus = true
            Toasts.show(TRAILER_GONE)
        },
    )
    if (showQr) TrailerQrDialog(trailer, onClose = {
        showQr = false
        restoreFocus = true
    })
}

/** Shown when YouTube says the trailer's video is gone (error 100: removed, or made private). */
internal const val TRAILER_GONE = "This trailer isn't on YouTube anymore."

/** "Watch the trailer on your phone": the QR code of the trailer's youtu.be link and the link itself. */
@Composable
@OptIn(androidx.compose.ui.ExperimentalComposeUiApi::class)
internal fun TrailerQrDialog(trailer: Trailer, onClose: () -> Unit) {
    val close = remember { FocusRequester() }
    val qr = remember(trailer.key) { qrRowsBitmap(qrRows(trailer.phoneUrl)) }
    Dialog(onDismissRequest = onClose, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        // A dialog owns a separate window: Close takes the remote's focus once that window has it (as Settings' remote
        // help does), in keyboard mode, where a button can hold the focus.
        val windowFocused = LocalWindowInfo.current.isWindowFocused
        val inputManager = LocalInputModeManager.current
        val inputMode = inputManager.inputMode
        LaunchedEffect(windowFocused) { if (windowFocused) inputManager.requestInputMode(InputMode.Keyboard) }
        LaunchedEffect(windowFocused, inputMode) { if (windowFocused && inputMode == InputMode.Keyboard) requestAttachedFocus(close) }
        Box(Modifier.fillMaxSize().dimBackground(0.72f), contentAlignment = Alignment.Center) {
            Column(
                Modifier.widthIn(max = 440.dp).clip(RoundedCornerShape(16.dp)).background(Palette.surface).padding(horizontal = 32.dp, vertical = 26.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Text("Watch the trailer on your phone", color = Palette.text, fontSize = 20.sp, fontWeight = FontWeight.Bold, textAlign = TextAlign.Center)
                Box(Modifier.padding(top = 18.dp).size(190.dp).clip(RoundedCornerShape(10.dp)).background(Color.White), contentAlignment = Alignment.Center) {
                    Image(qr, "QR code for ${trailer.short}", modifier = Modifier.fillMaxSize().padding(8.dp).testTag("trailer-qr"), filterQuality = FilterQuality.None)
                }
                Text(trailer.short, color = Palette.text, fontSize = 18.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(top = 14.dp))
                Text("Scan the code with your phone's camera.", color = Palette.dim, fontSize = 13.sp, textAlign = TextAlign.Center, modifier = Modifier.padding(top = 6.dp))
                PillButton("Close", onClose, Modifier.padding(top = 20.dp).focusRequester(close), primary = true)
            }
        }
    }
}

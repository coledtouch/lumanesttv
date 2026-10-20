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
 * Hands a trailer to the TV's YouTube app (docs/extras.md, "Per platform", Android TV, Google TV and Fire TV): the
 * watch page with each YouTube app's package in turn, then the `vnd.youtube:` link YouTube apps answer. No browser is
 * ever opened (TV apps on Google Play must not open one), and no `<queries>` or permission is needed: the app only
 * starts activities. The same in both editions.
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
    fun open(key: String, start: (Attempt) -> Unit): Boolean {
        for (attempt in attempts(key)) {
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

    fun open(context: Context, key: String): Boolean = open(key) { context.startActivity(intent(it, newTask = context !is Activity)) }

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
 * without a [trailer], so the button appears in place when the lookup answers and never takes the focus. When no
 * YouTube app opens, a QR code for a phone shows instead; closing it brings the focus back here.
 */
@Composable
internal fun TrailerButton(trailer: Trailer?, modifier: Modifier = Modifier) {
    if (trailer == null) return
    val context = LocalContext.current
    var showQr by remember(trailer.key) { mutableStateOf(false) }
    var restoreFocus by remember { mutableStateOf(false) }
    val focus = remember { FocusRequester() }
    // Back on the page once its window has the focus again (the dialog had its own window).
    val windowFocused = LocalWindowInfo.current.isWindowFocused
    LaunchedEffect(restoreFocus, windowFocused) {
        if (restoreFocus && windowFocused && requestAttachedFocus(focus)) restoreFocus = false
    }
    PillButton(
        "Trailer", { if (!TrailerLauncher.open(context, trailer.key)) showQr = true },
        modifier.focusRequester(focus).testTag("trailer"),
        icon = { Icon(Icons.Rounded.Movie, null, tint = it, modifier = Modifier.size(20.dp)) },
    )
    if (showQr) TrailerQrDialog(trailer, onClose = {
        showQr = false
        restoreFocus = true
    })
}

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

package tv.lumanest.tuner.ui

import android.view.KeyEvent as AndroidKeyEvent
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.Backspace
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.input.InputMode
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalInputModeManager
import androidx.compose.ui.platform.LocalWindowInfo
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import kotlinx.coroutines.delay
import tv.lumanest.tuner.data.Passcode
import tv.lumanest.tuner.data.Repo

/** What the passcode pad is for. [UNLOCK] creates a passcode first when none exists yet. */
enum class PasscodeMode { UNLOCK, CHANGE }

private enum class PasscodeStep { CURRENT, NEW, CONFIRM }

/**
 * Four-digit passcode pad for adult content. Works with a D-pad (focusable digit buttons), the remote's number keys
 * and touch. Only [Repo.prefs] sees the digits, and it stores a salted hash.
 */
@Composable
@OptIn(androidx.compose.ui.ExperimentalComposeUiApi::class)
fun PasscodeDialog(mode: PasscodeMode, onDone: () -> Unit, onClose: () -> Unit) {
    val creating = remember { !Repo.prefs.hasAdultPasscode }
    var step by remember { mutableStateOf(if (creating) PasscodeStep.NEW else PasscodeStep.CURRENT) }
    var entry by remember { mutableStateOf("") }
    var firstEntry by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }
    var waitMs by remember { mutableLongStateOf(Repo.prefs.adultPasscodeWaitMs()) }
    val firstDigit = remember { FocusRequester() }

    LaunchedEffect(step, error) {
        while (step == PasscodeStep.CURRENT) {
            waitMs = Repo.prefs.adultPasscodeWaitMs()
            if (waitMs <= 0) break
            delay(500)
        }
    }

    fun submit(code: String) {
        entry = ""
        when (step) {
            PasscodeStep.CURRENT -> when (val result = Repo.prefs.checkAdultPasscode(code)) {
                Passcode.Check.Ok -> {
                    error = null
                    if (mode == PasscodeMode.UNLOCK) onDone() else step = PasscodeStep.NEW
                }
                is Passcode.Check.Wrong -> error = "Wrong passcode. ${result.triesLeft} ${if (result.triesLeft == 1) "try" else "tries"} left."
                is Passcode.Check.LockedOut -> { waitMs = result.waitMs; error = "Too many wrong tries." }
            }
            PasscodeStep.NEW -> { firstEntry = code; error = null; step = PasscodeStep.CONFIRM }
            PasscodeStep.CONFIRM -> if (code == firstEntry) {
                Repo.prefs.setAdultPasscode(code)
                onDone()
            } else {
                firstEntry = ""
                error = "The passcodes didn't match. Choose a new passcode again."
                step = PasscodeStep.NEW
            }
        }
    }

    val lockedOut = step == PasscodeStep.CURRENT && waitMs > 0
    fun digit(d: Char) {
        if (lockedOut || entry.length >= Passcode.LENGTH) return
        entry += d
        if (entry.length == Passcode.LENGTH) submit(entry)
    }
    fun backspace() { entry = entry.dropLast(1) }

    val title = when {
        step == PasscodeStep.CURRENT && mode == PasscodeMode.CHANGE -> "Enter your current passcode"
        step == PasscodeStep.CURRENT -> "Enter your passcode"
        step == PasscodeStep.NEW && creating -> "Create a passcode"
        step == PasscodeStep.NEW -> "Choose a new passcode"
        else -> "Enter it again to confirm"
    }
    val body = when (step) {
        PasscodeStep.CURRENT -> if (mode == PasscodeMode.UNLOCK) "Adult categories stay hidden until this passcode is entered." else "Then choose a new 4-digit passcode."
        PasscodeStep.NEW -> "Choose 4 digits. You'll need them to show adult categories."
        PasscodeStep.CONFIRM -> "Enter the same 4 digits."
    }

    Dialog(onDismissRequest = onClose, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        val windowFocused = LocalWindowInfo.current.isWindowFocused
        val inputManager = LocalInputModeManager.current
        val inputMode = inputManager.inputMode
        val touch = LocalContext.current.packageManager.hasSystemFeature("android.hardware.touchscreen")
        // A remote-only TV has no touch mode: put the dialog's window in keyboard mode so the digits can take focus.
        LaunchedEffect(windowFocused) { if (windowFocused && !touch) inputManager.requestInputMode(InputMode.Keyboard) }
        LaunchedEffect(windowFocused, inputMode) {
            if (windowFocused && inputMode == InputMode.Keyboard) requestAttachedFocus(firstDigit)
        }
        Box(
            Modifier.fillMaxSize().dimBackground(0.7f).onPreviewKeyEvent { e ->
                if (e.type != KeyEventType.KeyDown) return@onPreviewKeyEvent false
                when (val code = e.nativeKeyEvent.keyCode) {
                    in AndroidKeyEvent.KEYCODE_0..AndroidKeyEvent.KEYCODE_9 -> { digit('0' + (code - AndroidKeyEvent.KEYCODE_0)); true }
                    in AndroidKeyEvent.KEYCODE_NUMPAD_0..AndroidKeyEvent.KEYCODE_NUMPAD_9 -> { digit('0' + (code - AndroidKeyEvent.KEYCODE_NUMPAD_0)); true }
                    AndroidKeyEvent.KEYCODE_DEL -> { backspace(); true }
                    else -> false
                }
            },
            contentAlignment = Alignment.Center,
        ) {
            Column(
                Modifier.widthIn(max = 440.dp).fillMaxWidth(0.92f).clip(RoundedCornerShape(16.dp)).background(Palette.surface)
                    .verticalScroll(rememberScrollState()).padding(24.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Text(title, color = Palette.text, fontSize = 21.sp, fontWeight = FontWeight.Bold, textAlign = TextAlign.Center)
                Text(body, color = Palette.dim, fontSize = 13.sp, lineHeight = 18.sp, textAlign = TextAlign.Center, modifier = Modifier.padding(top = 6.dp))
                Row(
                    Modifier.padding(vertical = 18.dp).semantics { contentDescription = "${entry.length} of ${Passcode.LENGTH} digits entered" },
                    horizontalArrangement = Arrangement.spacedBy(14.dp),
                ) {
                    repeat(Passcode.LENGTH) { i ->
                        val filled = i < entry.length
                        Box(Modifier.size(18.dp).clip(CircleShape).background(if (filled) Palette.accent else Palette.surface2)
                            .border(2.dp, if (filled) Palette.accent else Palette.dim.copy(alpha = 0.5f), CircleShape))
                    }
                }
                val message = if (lockedOut) "Too many wrong tries. Try again in ${(waitMs + 999) / 1000} seconds." else error
                Text(message ?: " ", color = Palette.live, fontSize = 13.sp, textAlign = TextAlign.Center, modifier = Modifier.padding(bottom = 10.dp))
                val rows = listOf(listOf("1", "2", "3"), listOf("4", "5", "6"), listOf("7", "8", "9"), listOf("Clear", "0", "Delete"))
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    rows.forEach { row ->
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            row.forEach { key ->
                                FocusBox(
                                    onClick = {
                                        when (key) {
                                            "Clear" -> entry = ""
                                            "Delete" -> backspace()
                                            else -> digit(key[0])
                                        }
                                    },
                                    modifier = Modifier.width(76.dp).height(52.dp)
                                        .then(if (key == "1") Modifier.focusRequester(firstDigit) else Modifier)
                                        .semantics { contentDescription = key },
                                    shape = RoundedCornerShape(10.dp), color = Palette.surface2, focusedColor = Palette.focus,
                                    ring = false, focusedScale = 1.06f,
                                ) { f ->
                                    val fg = if (f) Palette.onFocus else Palette.text
                                    if (key == "Delete") Icon(Icons.AutoMirrored.Rounded.Backspace, null, tint = fg, modifier = Modifier.align(Alignment.Center).size(22.dp))
                                    else Text(key, color = fg, fontSize = if (key.length == 1) 22.sp else 14.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.align(Alignment.Center))
                                }
                            }
                        }
                    }
                }
                PillButton("Cancel", onClose, Modifier.padding(top = 18.dp))
                Text(
                    "Forgot the passcode? Clear the app's data in your TV's settings.",
                    color = Palette.dim, fontSize = 12.sp, lineHeight = 16.sp, textAlign = TextAlign.Center, modifier = Modifier.padding(top = 14.dp),
                )
            }
        }
    }
}

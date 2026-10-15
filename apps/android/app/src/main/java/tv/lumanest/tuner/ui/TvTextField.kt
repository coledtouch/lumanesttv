package tv.lumanest.tuner.ui

import android.app.AlertDialog
import android.content.Context
import android.text.InputType
import android.view.KeyEvent
import android.view.WindowManager
import android.view.inputmethod.EditorInfo
import android.widget.EditText
import android.widget.FrameLayout
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/**
 * Text input that works with a TV remote. Focus lands on a read-only field; OK opens a native
 * Android input dialog. Native EditText is what the Google TV keyboard, voice typing and the
 * Google TV phone app keyboard all talk to reliably, which Compose text fields do not on every box.
 */
@Composable
fun TvTextField(
    label: String,
    value: String,
    onChange: (String) -> Unit,
    modifier: Modifier = Modifier,
    placeholder: String = "",
    password: Boolean = false,
    keyboardType: KeyboardType = KeyboardType.Uri,
    focusRequester: FocusRequester = remember { FocusRequester() },
    onDone: (() -> Unit)? = null,
) {
    val context = LocalContext.current
    Column(modifier) {
        if (label.isNotEmpty()) Text(label, color = Palette.dim, fontSize = 13.sp, modifier = Modifier.padding(bottom = 6.dp, start = 2.dp))
        FocusBox(
            onClick = {
                promptText(context, label.ifBlank { placeholder }, value, placeholder, password, keyboardType) {
                    onChange(it); onDone?.invoke()
                }
            },
            modifier = Modifier.fillMaxWidth().height(50.dp).focusRequester(focusRequester),
            shape = RoundedCornerShape(10.dp), color = Palette.surface2, focusedScale = 1.02f,
        ) { _ ->
            val shown = when {
                value.isEmpty() -> placeholder
                password -> "•".repeat(value.length.coerceAtMost(24))
                else -> value
            }
            Text(
                shown, color = if (value.isEmpty()) Palette.faint else Palette.text,
                fontSize = 16.sp, maxLines = 1, overflow = TextOverflow.Ellipsis,
                modifier = Modifier.align(Alignment.CenterStart).padding(horizontal = 16.dp),
            )
        }
    }
}

/** Shows a native input dialog with the keyboard already open. */
fun promptText(
    context: Context,
    title: String,
    initial: String,
    hint: String,
    password: Boolean,
    keyboardType: KeyboardType,
    onResult: (String) -> Unit,
) {
    val input = EditText(context).apply {
        setText(initial)
        setHint(hint)
        isSingleLine = true
        imeOptions = EditorInfo.IME_ACTION_DONE or EditorInfo.IME_FLAG_NO_FULLSCREEN
        inputType = when {
            password -> InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD
            keyboardType == KeyboardType.Uri -> InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_URI
            else -> InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS
        }
        setSelection(text.length)
        textSize = 20f
    }
    val pad = (24 * context.resources.displayMetrics.density).toInt()
    val wrap = FrameLayout(context).apply { setPadding(pad, pad / 2, pad, 0); addView(input) }
    val dialog = AlertDialog.Builder(context, android.R.style.Theme_DeviceDefault_Dialog_Alert)
        .setTitle(title)
        .setView(wrap)
        .setPositiveButton("OK") { _, _ -> onResult(input.text.toString().trim()) }
        .setNegativeButton("Cancel", null)
        .create()
    fun submit(): Boolean { onResult(input.text.toString().trim()); dialog.dismiss(); return true }
    input.setOnEditorActionListener { _, action, event ->
        if (action == EditorInfo.IME_ACTION_DONE || action == EditorInfo.IME_ACTION_GO ||
            (event?.keyCode == KeyEvent.KEYCODE_ENTER && event.action == KeyEvent.ACTION_UP)
        ) submit() else false
    }
    dialog.window?.setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_STATE_ALWAYS_VISIBLE)
    dialog.show()
    input.requestFocus()
}

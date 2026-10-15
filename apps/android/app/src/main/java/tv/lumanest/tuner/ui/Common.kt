package tv.lumanest.tuner.ui

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
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
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.delay
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

data class AppTheme(
    val id: String,
    val name: String,
    val bg: Color,
    val surface: Color,
    val surface2: Color,
    val cell: Color,
    val cellNow: Color,
    val line: Color,
    val text: Color,
    val dim: Color,
    val faint: Color,
    val accent: Color,
    val focus: Color,
    val onFocus: Color,
    val dark: Boolean = true,
)

object Themes {
    val Midnight = AppTheme(
        "midnight", "Midnight", bg = Color(0xFF080E1A), surface = Color(0xFF111C2E), surface2 = Color(0xFF1C2B42),
        cell = Color(0xFF142137), cellNow = Color(0xFF20344F), line = Color(0xFF2C3D57),
        text = Color(0xFFF1F5FC), dim = Color(0xFFAAB8CE), faint = Color(0xFF7D8EA8),
        accent = Color(0xFF70B4FF), focus = Color.White, onFocus = Color(0xFF080E1A),
    )
    val Black = AppTheme(
        "black", "True Black", bg = Color.Black, surface = Color(0xFF090909), surface2 = Color(0xFF17191D),
        cell = Color(0xFF101113), cellNow = Color(0xFF172435), line = Color(0xFF343C49),
        text = Color(0xFFF4F7FC), dim = Color(0xFFB3BECE), faint = Color(0xFF8998AD),
        accent = Color(0xFF63ABFF), focus = Color(0xFF92C5FF), onFocus = Color(0xFF04080E),
    )
    val Carbon = AppTheme(
        "carbon", "Carbon", bg = Color(0xFF0B0B0C), surface = Color(0xFF161618), surface2 = Color(0xFF202023),
        cell = Color(0xFF19191B), cellNow = Color(0xFF242427), line = Color(0xFF2E2E33),
        text = Color(0xFFF2F2F2), dim = Color(0xFF9A9A9F), faint = Color(0xFF64646A),
        accent = Color(0xFFFFB020), focus = Color(0xFFFFB020), onFocus = Color(0xFF111111),
    )
    val Ocean = AppTheme(
        "ocean", "Ocean", bg = Color(0xFF051417), surface = Color(0xFF0B2226), surface2 = Color(0xFF112D33),
        cell = Color(0xFF0D272C), cellNow = Color(0xFF13353B), line = Color(0xFF1C434A),
        text = Color(0xFFE3F4F4), dim = Color(0xFF86A9AC), faint = Color(0xFF557478),
        accent = Color(0xFF2FD3C6), focus = Color(0xFFE6FFFC), onFocus = Color(0xFF051417),
    )
    val Ember = AppTheme(
        "ember", "Ember", bg = Color(0xFF120A0B), surface = Color(0xFF1E1213), surface2 = Color(0xFF29191B),
        cell = Color(0xFF221416), cellNow = Color(0xFF2E1B1E), line = Color(0xFF3B2427),
        text = Color(0xFFF7EAEA), dim = Color(0xFFB1959A), faint = Color(0xFF7A6064),
        accent = Color(0xFFFF5A4E), focus = Color(0xFFFFF4F2), onFocus = Color(0xFF120A0B),
    )
    val Royal = AppTheme(
        "royal", "Cable Blue", bg = Color(0xFF07112B), surface = Color(0xFF0E1D45), surface2 = Color(0xFF152759),
        cell = Color(0xFF10214E), cellNow = Color(0xFF183066), line = Color(0xFF223B78),
        text = Color(0xFFEFF3FF), dim = Color(0xFF9AA9D6), faint = Color(0xFF6474A6),
        accent = Color(0xFFFFD23F), focus = Color(0xFFFFD23F), onFocus = Color(0xFF07112B),
    )
    val Daylight = AppTheme(
        "daylight", "Daylight", bg = Color(0xFFF2F4F7), surface = Color(0xFFFFFFFF), surface2 = Color(0xFFE4E8EE),
        cell = Color(0xFFFFFFFF), cellNow = Color(0xFFE8EEF8), line = Color(0xFFD3DAE4),
        text = Color(0xFF111722), dim = Color(0xFF5B6575), faint = Color(0xFF8A93A1),
        accent = Color(0xFF1F6FEB), focus = Color(0xFF111722), onFocus = Color.White, dark = false,
    )
    val all = listOf(Midnight, Black, Carbon, Ocean, Ember, Royal, Daylight)
    fun byId(id: String?) = all.firstOrNull { it.id == id } ?: Midnight
}

/** Colors for the active theme. Backed by snapshot state, so switching themes redraws everything. */
object Palette {
    var theme by mutableStateOf(Themes.Midnight)
    val bg get() = theme.bg
    val surface get() = theme.surface
    val surface2 get() = theme.surface2
    val cell get() = theme.cell
    val cellNow get() = theme.cellNow
    val line get() = theme.line
    val text get() = theme.text
    val dim get() = theme.dim
    val faint get() = theme.faint
    val accent get() = theme.accent
    val onAccent get() = if (theme.dark) Color(0xFF08111E) else Color.White
    val focus get() = theme.focus
    val onFocus get() = theme.onFocus
    val live = Color(0xFFFF4D5E)
    val good = Color(0xFF3DDC97)
}

@Composable
fun TunerTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = if (Palette.theme.dark) darkColorScheme(
            primary = Palette.accent, background = Palette.bg, surface = Palette.surface,
            onBackground = Palette.text, onSurface = Palette.text,
        ) else lightColorScheme(
            primary = Palette.accent, background = Palette.bg, surface = Palette.surface,
            onBackground = Palette.text, onSurface = Palette.text,
        ),
        content = content,
    )
}

/**
 * The basic D-pad target used everywhere: scales up a touch and gets a white ring when focused.
 * The content lambda receives the focus state so it can restyle itself.
 */
@OptIn(ExperimentalFoundationApi::class)
@Composable
fun FocusBox(
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    shape: Shape = RoundedCornerShape(10.dp),
    focusedScale: Float = 1.035f,
    color: Color = Palette.surface,
    focusedColor: Color = color,
    ring: Boolean = true,
    onLongClick: (() -> Unit)? = null,
    onFocus: ((Boolean) -> Unit)? = null,
    content: @Composable BoxScope.(focused: Boolean) -> Unit,
) {
    var focused by remember { mutableStateOf(false) }
    val scale by animateFloatAsState(if (focused) focusedScale else 1f, tween(120), label = "scale")
    val interaction = remember { MutableInteractionSource() }
    Box(
        modifier
            .graphicsLayer { scaleX = scale; scaleY = scale }
            .onFocusChanged { if (focused != it.isFocused) { focused = it.isFocused; onFocus?.invoke(it.isFocused) } }
            .clip(shape)
            .background(if (focused) focusedColor else color)
            .then(if (focused && ring) Modifier.border(2.5.dp, Palette.focus, shape) else Modifier)
            .combinedClickable(
                interactionSource = interaction, indication = null,
                role = Role.Button,
                onClick = onClick, onLongClick = onLongClick,
            ),
    ) { content(focused) }
}

/** Pill button: white with dark text when focused, the way TV remotes expect. */
@Composable
fun PillButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    icon: (@Composable (Color) -> Unit)? = null,
    primary: Boolean = false,
    onFocus: ((Boolean) -> Unit)? = null,
) {
    FocusBox(
        onClick = onClick,
        modifier = modifier,
        shape = RoundedCornerShape(50),
        color = if (primary) Palette.accent else Palette.surface2,
        focusedColor = Palette.focus,
        ring = false,
        onFocus = onFocus,
    ) { f ->
        val c = when { f -> Palette.onFocus; primary -> Palette.onAccent; else -> Palette.text }
        Row(
            Modifier.padding(horizontal = 20.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            icon?.invoke(c)
            Text(text, color = c, fontSize = 15.sp, fontWeight = FontWeight.SemiBold, maxLines = 1)
        }
    }
}

@Composable
fun Centered(content: @Composable () -> Unit) {
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { content() }
}

@Composable
fun LoadingMessage(text: String) {
    Centered {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            CircularProgressIndicator(color = Palette.accent, modifier = Modifier.size(36.dp), strokeWidth = 3.dp)
            Text(text, color = Palette.dim, fontSize = 15.sp, modifier = Modifier.padding(top = 14.dp))
        }
    }
}

@Composable
fun EmptyMessage(title: String, body: String? = null) {
    Centered {
        Column(Modifier.padding(horizontal = 32.dp, vertical = 20.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            Text(title, color = Palette.text, fontSize = 20.sp, fontWeight = FontWeight.SemiBold, textAlign = TextAlign.Center)
            if (body != null) Text(
                body, color = Palette.dim, fontSize = 14.sp, maxLines = 3, overflow = TextOverflow.Ellipsis,
                modifier = Modifier.padding(top = 8.dp), textAlign = TextAlign.Center,
            )
        }
    }
}

@Composable
fun SectionTitle(text: String, modifier: Modifier = Modifier) {
    Text(text, color = Palette.text, fontSize = 17.sp, fontWeight = FontWeight.SemiBold, modifier = modifier)
}

/** Wall-clock time that ticks every [periodMs]. */
@Composable
fun rememberNow(periodMs: Long = 15_000): Long {
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(periodMs) {
        while (true) {
            now = System.currentTimeMillis()
            delay(periodMs - now % periodMs)
        }
    }
    return now
}

private val clockFmt = SimpleDateFormat("h:mm", Locale.US)
private val clockFmtA = SimpleDateFormat("h:mm a", Locale.US)
private val dayFmt = SimpleDateFormat("EEE MMM d", Locale.US)

fun fmtTime(ms: Long): String = clockFmtA.format(Date(ms))
fun fmtTimeShort(ms: Long): String = clockFmt.format(Date(ms))
fun fmtDay(ms: Long): String = dayFmt.format(Date(ms))
fun fmtRange(start: Long, end: Long): String {
    val a = clockFmtA.format(Date(start)); val b = clockFmtA.format(Date(end))
    return if (a.takeLast(2) == b.takeLast(2)) "${a.dropLast(3)} – $b" else "$a – $b"
}

fun fmtDuration(ms: Long): String {
    val totalMin = ms / 60_000
    val h = totalMin / 60; val m = totalMin % 60
    return if (h > 0) "${h}h ${m}m" else "${m}m"
}

fun fmtClock(ms: Long): String {
    val s = (ms / 1000).coerceAtLeast(0)
    val h = s / 3600; val m = (s % 3600) / 60; val sec = s % 60
    return if (h > 0) String.format(Locale.US, "%d:%02d:%02d", h, m, sec) else String.format(Locale.US, "%d:%02d", m, sec)
}

fun Modifier.dimBackground(alpha: Float = 0.6f) = background(Color.Black.copy(alpha = alpha))

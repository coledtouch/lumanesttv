package tv.lumanest.tuner.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import tv.lumanest.tuner.data.Channel
import tv.lumanest.tuner.data.ChannelMatch
import tv.lumanest.tuner.data.Repo
import coil.compose.AsyncImage

/**
 * A channel logo that always shows something: the provider's logo, then the guide's icon,
 * then iptv-org's logo database, and finally a lettered tile in a color unique to the channel.
 */
@Composable
fun ChannelLogo(channel: Channel, modifier: Modifier) {
    val logoVersion by Repo.logoVersion.collectAsState()
    val candidates = remember(channel.key, channel.logo, logoVersion) {
        (listOfNotNull(channel.logo?.takeIf { it.startsWith("http", ignoreCase = true) }) + Repo.fallbackLogos(channel)).distinct()
    }
    var index by remember(candidates) { mutableIntStateOf(0) }
    Box(modifier, contentAlignment = Alignment.Center) {
        val url = candidates.getOrNull(index)
        if (url == null) {
            Monogram(channel.name, Modifier.fillMaxSize())
        } else {
            AsyncImage(
                model = url,
                contentDescription = channel.name,
                contentScale = ContentScale.Fit,
                onError = { index++ },
                modifier = Modifier.fillMaxSize(),
            )
        }
    }
}

private val tileColors = listOf(
    Color(0xFF3B6FD8), Color(0xFFD9534F), Color(0xFF2E9E6B), Color(0xFF8E5BD8), Color(0xFFE08A1E),
    Color(0xFF1E9CB3), Color(0xFFC2457E), Color(0xFF5D7A2E), Color(0xFF6C5CE7), Color(0xFFB0693A),
)

@Composable
fun Monogram(name: String, modifier: Modifier) {
    val clean = remember(name) { ChannelMatch.display(name) }
    val letters = remember(clean) {
        val words = clean.split(Regex("[\\s\\-_/]+")).filter { w -> w.any { it.isLetterOrDigit() } }
        when {
            words.isEmpty() -> "TV"
            words.size == 1 -> words[0].filter { it.isLetterOrDigit() }.take(4).uppercase()
            else -> words.take(3).joinToString("") { w -> w.first { it.isLetterOrDigit() }.toString() }.uppercase()
        }
    }
    val color = tileColors[(clean.lowercase().hashCode() and 0x7fffffff) % tileColors.size]
    BoxWithConstraints(modifier.clip(RoundedCornerShape(5)).background(color), contentAlignment = Alignment.Center) {
        val size = (maxHeight.value * if (letters.length > 3) 0.38f else 0.5f).coerceIn(8f, 40f)
        Text(
            letters, color = Color.White, fontSize = size.sp, fontWeight = FontWeight.Bold,
            maxLines = 1, textAlign = TextAlign.Center, modifier = Modifier.padding(horizontal = 2.dp),
        )
    }
}

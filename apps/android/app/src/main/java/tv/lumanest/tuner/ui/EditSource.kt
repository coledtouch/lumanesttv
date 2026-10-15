package tv.lumanest.tuner.ui

import android.net.Uri
import androidx.compose.foundation.Image
import androidx.compose.runtime.DisposableEffect
import androidx.compose.ui.graphics.FilterQuality
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.text.style.TextAlign
import tv.lumanest.tuner.data.PhoneSetup
import tv.lumanest.tuner.data.Pairing
import com.google.zxing.BarcodeFormat
import com.google.zxing.EncodeHintType
import com.google.zxing.qrcode.QRCodeWriter
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.PlayArrow
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import tv.lumanest.tuner.data.Repo
import tv.lumanest.tuner.data.Source
import tv.lumanest.tuner.data.SourceType
import tv.lumanest.tuner.data.Xtream
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.util.UUID

@Composable
fun EditSourceScreen(sourceId: String?, canCancel: Boolean, onDone: () -> Unit) {
    val existing = remember(sourceId) { Repo.prefs.sources.value.firstOrNull { it.id == sourceId } }
    var type by remember { mutableStateOf(existing?.type ?: SourceType.XTREAM) }
    var name by remember { mutableStateOf(existing?.name ?: "") }
    var server by remember { mutableStateOf(existing?.server ?: "") }
    var username by remember { mutableStateOf(existing?.username ?: "") }
    var password by remember { mutableStateOf(existing?.password ?: "") }
    var m3uUrl by remember { mutableStateOf(existing?.m3uUrl ?: "") }
    var epgUrl by remember { mutableStateOf(existing?.epgUrl ?: "") }
    var userAgent by remember { mutableStateOf(existing?.userAgent ?: "") }
    var hotUrl by remember { mutableStateOf(existing?.hotUrl ?: "") }
    var busy by remember { mutableStateOf<String?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    val firstFocus = remember { FocusRequester() }

    LaunchedEffect(Unit) { delay(80); runCatching { firstFocus.requestFocus() } }

    fun save() {
        error = null
        var t = type; var srv = server; var user = username; var pass = password
        // A get.php link already holds Xtream credentials; use the richer Xtream API instead.
        if (t == SourceType.M3U) Xtream.fromGetPhp(m3uUrl)?.let { (s, u, p) ->
            t = SourceType.XTREAM; srv = s; user = u; pass = p
        }
        when (t) {
            SourceType.XTREAM -> if (srv.isBlank() || user.isBlank() || pass.isBlank()) {
                error = "Server URL, username and password are all required."; return
            }
            SourceType.M3U -> if (m3uUrl.isBlank()) { error = "Enter the playlist URL."; return }
        }
        val host = runCatching {
            Uri.parse(if (t == SourceType.XTREAM) Xtream.normalizeServer(srv) else m3uUrl.trim()).host
        }.getOrNull()
        val src = Source(
            id = existing?.id ?: UUID.randomUUID().toString(),
            name = name.trim().ifBlank { host ?: "My playlist" },
            type = t,
            server = if (t == SourceType.XTREAM) Xtream.normalizeServer(srv) else "",
            username = user.trim(), password = pass.trim(),
            m3uUrl = if (t == SourceType.M3U) m3uUrl.trim() else "",
            epgUrl = epgUrl.trim(), userAgent = userAgent.trim(), hotUrl = hotUrl.trim(),
        )
        scope.launch {
            var summary: String? = null
            if (t == SourceType.XTREAM) {
                busy = "Signing in…"
                val r = Repo.testXtream(src)
                busy = null
                if (r.isFailure) { error = r.exceptionOrNull()?.message ?: "Couldn't sign in."; return@launch }
                summary = r.getOrNull()
            }
            Repo.prefs.saveSource(src)
            Repo.prefs.setActive(src.id)
            Repo.load(force = true)
            Toasts.show(if (summary != null) "Connected · $summary" else "Playlist added")
            onDone()
        }
    }

    // Phone/computer setup page served by the TV while this screen is open.
    var phoneUrl by remember { mutableStateOf<String?>(null) }
    DisposableEffect(Unit) {
        val setup = PhoneSetup { f ->
            // Only overwrite what was actually filled in, so the page also works for edits.
            fun v(k: String) = f[k]?.trim()?.takeIf { it.isNotEmpty() }
            if (f["type"] == "m3u") { type = SourceType.M3U; v("m3u")?.let { m3uUrl = it } }
            else { type = SourceType.XTREAM; v("server")?.let { server = it }; v("username")?.let { username = it }; v("password")?.let { password = it } }
            v("hot")?.let { hotUrl = it }
            f["epg"]?.takeIf { it.isNotBlank() }?.let { epgUrl = it }
            f["name"]?.takeIf { it.isNotBlank() }?.let { name = it }
            Toasts.show("Got it from your phone")
            if (busy == null) save()
        }
        if (setup.start()) PhoneSetup.localIp()?.let { phoneUrl = "http://$it:${setup.port}" }
        onDispose { setup.stop() }
    }

    Box(Modifier.fillMaxSize().background(Palette.bg), contentAlignment = Alignment.TopCenter) {
      Row(horizontalArrangement = Arrangement.spacedBy(36.dp)) {
        Column(
            Modifier.width(560.dp).verticalScroll(rememberScrollState()).padding(top = 40.dp, bottom = 60.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.size(34.dp).clip(RoundedCornerShape(9.dp)).background(Palette.accent), contentAlignment = Alignment.Center) {
                    Icon(Icons.Rounded.PlayArrow, null, tint = Palette.onFocus, modifier = Modifier.size(26.dp))
                }
                Column(Modifier.padding(start = 14.dp)) {
                    Text(if (existing == null) "Add a playlist" else "Edit playlist", color = Palette.text, fontSize = 26.sp, fontWeight = FontWeight.Bold)
                    Text(
                        "Sign in with your provider's Xtream Codes login, or paste an M3U link.",
                        color = Palette.dim, fontSize = 14.sp,
                    )
                }
            }

            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                TypeChip("Xtream Codes", type == SourceType.XTREAM, Modifier.focusRequester(firstFocus)) { type = SourceType.XTREAM }
                TypeChip("M3U URL", type == SourceType.M3U) { type = SourceType.M3U }
            }

            if (type == SourceType.XTREAM) {
                TvTextField("Server URL", server, { server = it }, placeholder = "http://provider.example:8080")
                Row(horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                    TvTextField("Username", username, { username = it }, Modifier.weight(1f), keyboardType = KeyboardType.Text)
                    TvTextField("Password", password, { password = it }, Modifier.weight(1f), password = true)
                }
            } else {
                TvTextField("Playlist URL", m3uUrl, { m3uUrl = it }, placeholder = "http://provider.example/get.php?username=…&type=m3u_plus")
                Text(
                    "Tip: if this is a get.php link with a username and password, Tuner switches to Xtream mode automatically so you also get movies and series.",
                    color = Palette.faint, fontSize = 12.sp, lineHeight = 16.sp,
                )
            }
            TvTextField("Guide (XMLTV) URL · optional", epgUrl, { epgUrl = it }, placeholder = if (type == SourceType.XTREAM) "Uses the provider's guide by default" else "Uses the playlist's url-tvg if present")
            TvTextField("Trending channels URL · optional", hotUrl, { hotUrl = it }, placeholder = "An M3U of featured channels, shown as a Trending row in the guide")
            TvTextField("Name · optional", name, { name = it }, placeholder = "Living room IPTV", keyboardType = KeyboardType.Text)
            TvTextField("User agent · optional", userAgent, { userAgent = it }, placeholder = "Default: VLC", keyboardType = KeyboardType.Text)

            error?.let { Text(it, color = Palette.live, fontSize = 14.sp) }
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
                PillButton(if (busy != null) "Working…" else "Save and connect", { if (busy == null) save() }, primary = true)
                if (canCancel) PillButton("Cancel", onDone)
                busy?.let {
                    CircularProgressIndicator(color = Palette.accent, strokeWidth = 2.dp, modifier = Modifier.size(18.dp))
                    Text(it, color = Palette.dim, fontSize = 14.sp)
                }
            }
        }
        // New playlists: LumaNest customers pair by scanning a code. Edits keep the same-Wi-Fi phone form.
        if (existing == null) LumaNestPairPanel(Modifier.padding(top = 48.dp)) { account ->
            type = account.type; name = account.name
            server = account.server; username = account.username; password = account.password; m3uUrl = account.m3uUrl
            Toasts.show("Paired with LumaNest TV")
            if (busy == null) save()
        } else phoneUrl?.let { PhonePanel(it, Modifier.padding(top = 48.dp)) }
      }
    }
}

@Composable
private fun TypeChip(text: String, selected: Boolean, modifier: Modifier = Modifier, onClick: () -> Unit) {
    FocusBox(
        onClick = onClick, modifier = modifier, shape = RoundedCornerShape(50),
        color = if (selected) Palette.accent.copy(alpha = 0.25f) else Palette.surface2,
        focusedColor = Palette.focus, ring = false,
    ) { f ->
        Text(
            text, color = if (f) Palette.onFocus else if (selected) Palette.text else Palette.dim,
            fontSize = 15.sp, fontWeight = FontWeight.SemiBold,
            modifier = Modifier.padding(horizontal = 18.dp, vertical = 9.dp),
        )
    }
}

@Composable
private fun PhonePanel(url: String, modifier: Modifier) {
    val qr = remember(url) { qrBitmap(url, 480) }
    Column(
        modifier.width(270.dp).clip(RoundedCornerShape(16.dp)).background(Palette.surface).padding(20.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text("Easier: type on your phone", color = Palette.text, fontSize = 17.sp, fontWeight = FontWeight.Bold)
        Text(
            "Scan, or open this address on any phone or computer on the same Wi-Fi.",
            color = Palette.dim, fontSize = 13.sp, lineHeight = 17.sp, textAlign = TextAlign.Center,
            modifier = Modifier.padding(top = 6.dp, bottom = 14.dp),
        )
        Image(
            qr, null, modifier = Modifier.size(170.dp).clip(RoundedCornerShape(10.dp)),
            filterQuality = FilterQuality.None,
        )
        Text(url, color = Palette.accent, fontSize = 16.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(top = 14.dp))
    }
}

@Composable
private fun LumaNestPairPanel(modifier: Modifier, onAccount: (Pairing.Account) -> Unit) {
    var code by remember { mutableStateOf<Pairing.Code?>(null) }
    var status by remember { mutableStateOf("Getting a code…") }
    LaunchedEffect(Unit) {
        if (!Pairing.enabled) { status = "Pairing is off in this build."; return@LaunchedEffect }
        // Keeps a fresh code on screen until the customer approves one; codes last 10 minutes.
        var backoff = 5_000L
        while (true) {
            val next = runCatching { Pairing.start() }.getOrElse {
                code = null; status = (it.message ?: "Pairing isn't available right now.") + " Retrying…"
                delay(backoff); backoff = (backoff * 2).coerceAtMost(60_000L); null
            } ?: continue
            backoff = 5_000L
            code = next; status = "Waiting for you to approve on your phone…"
            val until = System.currentTimeMillis() + (next.expiresInS - 20).coerceAtLeast(60) * 1000L
            var wait = next.intervalS * 1000L
            while (System.currentTimeMillis() < until) {
                delay(wait)
                when (val r = runCatching { Pairing.poll(next.deviceCode) }.getOrNull()) {
                    is Pairing.Status.Approved -> { status = "Paired. Loading your channels…"; onAccount(r.account); return@LaunchedEffect }
                    Pairing.Status.Expired -> break
                    Pairing.Status.Pending -> { wait = next.intervalS * 1000L; status = "Waiting for you to approve on your phone…" }
                    null -> { wait = (wait * 2).coerceAtMost(30_000L); status = "Can't reach LumaNest TV. Retrying…" }
                }
            }
        }
    }
    Column(
        modifier.width(300.dp).clip(RoundedCornerShape(16.dp)).background(Palette.surface).padding(20.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text("PAIR WITH YOUR PHONE", color = Palette.accent, fontSize = 12.sp, fontWeight = FontWeight.Bold, letterSpacing = 2.sp)
        Text(
            "LumaNest TV customer? Scan with your phone camera and sign in. This TV sets itself up.",
            color = Palette.dim, fontSize = 13.sp, lineHeight = 17.sp, textAlign = TextAlign.Center,
            modifier = Modifier.padding(top = 6.dp, bottom = 14.dp),
        )
        val current = code
        Box(Modifier.size(170.dp).clip(RoundedCornerShape(10.dp)).background(androidx.compose.ui.graphics.Color.White), contentAlignment = Alignment.Center) {
            if (current != null) {
                val qr = remember(current.url) { qrRowsBitmap(current.qr) }
                Image(qr, "QR code for lumanest.tv/pair", modifier = Modifier.fillMaxSize(), filterQuality = FilterQuality.None)
            } else CircularProgressIndicator(color = Palette.accent, strokeWidth = 2.dp, modifier = Modifier.size(28.dp))
        }
        Text("or go to lumanest.tv/pair and enter", color = Palette.faint, fontSize = 12.sp, modifier = Modifier.padding(top = 12.dp))
        Text(current?.userCode ?: "····-····", color = Palette.text, fontSize = 28.sp, fontWeight = FontWeight.Bold, letterSpacing = 3.sp)
        Text(status, color = Palette.dim, fontSize = 12.sp, lineHeight = 16.sp, textAlign = TextAlign.Center, modifier = Modifier.padding(top = 6.dp))
    }
}

/** Draws the server's QR rows ("0"/"1" per module) with a quiet zone, one pixel per module. */
private fun qrRowsBitmap(rows: List<String>): ImageBitmap {
    val quiet = 2; val size = rows.size + quiet * 2
    val bmp = android.graphics.Bitmap.createBitmap(size, size, android.graphics.Bitmap.Config.ARGB_8888)
    bmp.eraseColor(android.graphics.Color.WHITE)
    rows.forEachIndexed { y, row -> row.forEachIndexed { x, c -> if (c == '1') bmp.setPixel(x + quiet, y + quiet, android.graphics.Color.BLACK) } }
    return bmp.asImageBitmap()
}

private fun qrBitmap(text: String, size: Int): ImageBitmap {
    val matrix = QRCodeWriter().encode(text, BarcodeFormat.QR_CODE, size, size, mapOf(EncodeHintType.MARGIN to 2))
    val bmp = android.graphics.Bitmap.createBitmap(size, size, android.graphics.Bitmap.Config.ARGB_8888)
    for (x in 0 until size) for (y in 0 until size) {
        bmp.setPixel(x, y, if (matrix[x, y]) android.graphics.Color.BLACK else android.graphics.Color.WHITE)
    }
    return bmp.asImageBitmap()
}

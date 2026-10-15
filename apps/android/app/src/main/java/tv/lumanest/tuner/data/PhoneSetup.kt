package tv.lumanest.tuner.data

import android.os.Handler
import android.os.Looper
import java.io.BufferedInputStream
import java.io.ByteArrayOutputStream
import java.net.Inet4Address
import java.net.NetworkInterface
import java.net.ServerSocket
import java.net.Socket
import java.net.URLDecoder
import kotlin.concurrent.thread

/**
 * A tiny web page served by the TV while the add-playlist screen is open, so you can type the
 * server, username and password on your phone or computer instead of the remote.
 * Only listens on the local network and only while that screen is showing.
 */
class PhoneSetup(private val onSubmit: (Map<String, String>) -> Unit) {
    private var server: ServerSocket? = null
    private val main = Handler(Looper.getMainLooper())
    var port = 0
        private set

    fun start(): Boolean {
        for (p in listOf(8686, 8687, 8688, 8080)) {
            val s = runCatching { ServerSocket(p) }.getOrNull() ?: continue
            server = s; port = p
            thread(name = "phone-setup", isDaemon = true) {
                while (!s.isClosed) {
                    val c = runCatching { s.accept() }.getOrNull() ?: break
                    thread(isDaemon = true) { runCatching { handle(c) }; runCatching { c.close() } }
                }
            }
            return true
        }
        return false
    }

    fun stop() { runCatching { server?.close() }; server = null }

    private fun handle(sock: Socket) {
        sock.soTimeout = 15_000
        val input = BufferedInputStream(sock.getInputStream())
        val head = readHead(input) ?: return
        val lines = head.split("\r\n")
        val (method, path) = lines.first().split(" ").let { (it.getOrNull(0) ?: "") to (it.getOrNull(1) ?: "/") }
        val length = lines.firstOrNull { it.startsWith("content-length:", true) }
            ?.substringAfter(':')?.trim()?.toIntOrNull()?.coerceAtMost(64_000) ?: 0
        val out = sock.getOutputStream()
        if (method == "POST") {
            val body = ByteArray(length)
            var read = 0
            while (read < length) { val n = input.read(body, read, length - read); if (n < 0) break; read += n }
            val form = String(body, 0, read, Charsets.UTF_8).split('&').mapNotNull { pair ->
                val k = pair.substringBefore('=', "").ifEmpty { return@mapNotNull null }
                URLDecoder.decode(k, "UTF-8") to URLDecoder.decode(pair.substringAfter('=', ""), "UTF-8")
            }.toMap()
            main.post { onSubmit(form) }
            respond(out, page(done = true))
        } else if (path == "/" || path.startsWith("/?")) {
            respond(out, page(done = false))
        } else {
            out.write("HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".toByteArray())
        }
        out.flush()
    }

    private fun readHead(input: BufferedInputStream): String? {
        val buf = ByteArrayOutputStream()
        var last4 = 0
        while (buf.size() < 16_000) {
            val b = input.read()
            if (b < 0) return null
            buf.write(b)
            last4 = (last4 shl 8) or b
            if (last4 == 0x0D0A0D0A) return buf.toString("UTF-8")
        }
        return null
    }

    private fun respond(out: java.io.OutputStream, html: String) {
        val bytes = html.toByteArray(Charsets.UTF_8)
        out.write(
            ("HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: ${bytes.size}\r\n" +
                "Cache-Control: no-store\r\nConnection: close\r\n\r\n").toByteArray(),
        )
        out.write(bytes)
    }

    private fun page(done: Boolean): String = """<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Tuner setup</title>
<style>
:root{color-scheme:dark}*{box-sizing:border-box}
body{margin:0;font:16px/1.4 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#0a0d13;color:#e9edf5;display:flex;justify-content:center;padding:24px 16px}
main{width:100%;max-width:440px}h1{font-size:24px;margin:0 0 4px}p{color:#8d98ac;margin:0 0 20px}
label{display:block;font-size:13px;color:#8d98ac;margin:14px 0 6px}
input[type=text],input[type=password],input[type=url]{width:100%;padding:13px 14px;border-radius:10px;border:1px solid #263044;background:#141a24;color:#e9edf5;font-size:16px}
input:focus{outline:2px solid #4c9bff;border-color:transparent}
.tabs{display:flex;gap:8px;margin-bottom:6px}.tabs label{margin:0;flex:1}
.tabs input{display:none}.tabs span{display:block;text-align:center;padding:11px;border-radius:999px;background:#1b2230;color:#8d98ac;font-weight:600;cursor:pointer}
.tabs input:checked+span{background:#4c9bff;color:#0a0d13}
.m3u{display:none}body:has(#t-m3u:checked) .xt{display:none}body:has(#t-m3u:checked) .m3u{display:block}
button{margin-top:22px;width:100%;padding:15px;border:0;border-radius:999px;background:#4c9bff;color:#0a0d13;font-size:17px;font-weight:700}
.ok{background:#141a24;border-radius:14px;padding:22px;text-align:center}.ok b{display:block;font-size:20px;margin-bottom:6px}
</style></head><body><main>
${if (done) DONE_HTML else FORM_HTML}
</main></body></html>"""

    companion object {
        private const val DONE_HTML = """<div class="ok"><b>Sent to your TV</b>Check the TV screen. It signs in and loads your channels.</div>"""
        private const val FORM_HTML = """<h1>Tuner setup</h1><p>Fill this in and it appears on your TV. When editing, blank fields keep their current value.</p>
<form method="post" action="/" autocomplete="off">
<div class="tabs"><label><input type="radio" name="type" value="xtream" checked><span>Xtream Codes</span></label>
<label><input type="radio" id="t-m3u" name="type" value="m3u"><span>M3U URL</span></label></div>
<div class="xt"><label>Server URL</label><input type="url" name="server" placeholder="http://provider.example:8080" autocapitalize="off">
<label>Username</label><input type="text" name="username" autocapitalize="off" autocorrect="off" spellcheck="false">
<label>Password</label><input type="password" name="password"></div>
<div class="m3u"><label>Playlist URL</label><input type="url" name="m3u" placeholder="http://provider.example/get.php?username=…" autocapitalize="off"></div>
<label>Guide (XMLTV) URL · optional</label><input type="url" name="epg" autocapitalize="off">
<label>Trending channels URL · optional</label><input type="url" name="hot" placeholder="M3U of featured channels" autocapitalize="off">
<label>Name · optional</label><input type="text" name="name" placeholder="Living room IPTV">
<button type="submit">Send to TV</button></form>"""

        /** The TV's address on the local network (Wi-Fi or Ethernet). */
        fun localIp(): String? = runCatching {
            NetworkInterface.getNetworkInterfaces().toList()
                .filter { it.isUp && !it.isLoopback && !it.isVirtual }
                .sortedBy { if (it.name.startsWith("eth")) 0 else if (it.name.startsWith("wlan")) 1 else 2 }
                .flatMap { it.inetAddresses.toList() }
                .firstOrNull { it is Inet4Address && it.isSiteLocalAddress }?.hostAddress
        }.getOrNull()
    }
}

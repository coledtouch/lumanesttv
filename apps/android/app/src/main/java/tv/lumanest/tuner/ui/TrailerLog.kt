package tv.lumanest.tuner.ui

import android.content.Context
import android.content.pm.PackageInfo
import android.hardware.display.DisplayManager
import android.os.Build
import android.os.SystemClock
import android.util.Log
import android.view.Display
import android.view.View
import android.view.ViewGroup

/**
 * The trailer player's log, so a TV where a trailer doesn't show can say why (docs/extras.md, "Per platform", Android):
 * tag `TunerTrailer`, info level, each line with the milliseconds since the player opened. Read it with
 *
 *     adb logcat -s TunerTrailer:V chromium:V
 *
 * (`chromium` is the WebView's own log). It holds the device, its WebView and screen, what the WebView did (attached,
 * its size, the page loading, errors by host and status, blocked requests by scheme and host, the renderer going), every
 * message the page sent (its diagnostics included; its short snapshot, which comes every 2 seconds for as long as the
 * page lives, only when it differs from the last one logged), the port, pauses, and each of the player's decisions and
 * timers.
 * Never the viewer's playlist, lines or stream addresses (the player knows none of them), and no address's path, query
 * or fragment from the WebView: only its host. The trailer's YouTube key is logged when the player opens, so a trailer
 * that fails can be found again. WebView debugging (`setWebContentsDebuggingEnabled`) stays off.
 */
internal object TrailerLog {
    const val TAG = "TunerTrailer"
    /** The longest console message kept, as the WebView reported it (after [clean]). */
    const val CONSOLE_MAX = 300
    /** The longest page message kept: the page's own, a snapshot or the user agent. */
    const val PAGE_MAX = 600

    @Volatile private var openedAt = 0L

    /** A trailer player opened: times count from here. */
    fun begin() {
        openedAt = SystemClock.elapsedRealtime()
    }

    /** One line in the log. Any thread (the WebView asks about requests on its own). */
    fun i(text: String) {
        Log.i(TAG, "+" + (SystemClock.elapsedRealtime() - openedAt) + "ms " + text)
    }

    /** The device, its WebView and its screen, when a trailer player opens. [provider] is null before Android 8. */
    fun device(context: Context, provider: PackageInfo?): String {
        val metrics = context.resources.displayMetrics
        val mode = runCatching {
            (context.getSystemService(Context.DISPLAY_SERVICE) as? DisplayManager)?.getDisplay(Display.DEFAULT_DISPLAY)?.mode
        }.getOrNull()
        return "device sdk=" + Build.VERSION.SDK_INT + " model=" + clean(Build.MANUFACTURER + " " + Build.MODEL, 80) +
            " webview=" + (provider?.let { clean(it.packageName + " " + it.versionName, 120) } ?: "unknown") +
            " screen=" + metrics.widthPixels + "x" + metrics.heightPixels + " density=" + metrics.density +
            " dpi=" + metrics.densityDpi +
            (mode?.let { " display=" + it.physicalWidth + "x" + it.physicalHeight + "@" + it.refreshRate } ?: "")
    }

    /** A view's drawing and size, for the WebView's attach, detach and load lines. */
    fun view(view: View): String =
        "hw=" + view.isHardwareAccelerated + " layer=" + layerName(view.layerType) + " size=" + view.width + "x" + view.height +
            " lp=" + (view.layoutParams?.let { dimension(it.width) + "x" + dimension(it.height) } ?: "none")

    /** A layout params dimension: "match", "wrap" or the pixels. */
    fun dimension(value: Int): String = when (value) {
        ViewGroup.LayoutParams.MATCH_PARENT -> "match"
        ViewGroup.LayoutParams.WRAP_CONTENT -> "wrap"
        else -> value.toString()
    }

    fun layerName(type: Int): String = when (type) {
        View.LAYER_TYPE_NONE -> "none"
        View.LAYER_TYPE_SOFTWARE -> "software"
        View.LAYER_TYPE_HARDWARE -> "hardware"
        else -> type.toString()
    }

    /** A console message from the page or YouTube's frames: its level, the source's host and line, and its text. */
    fun console(level: String?, message: String?, source: String?, line: Int): String =
        "console " + (level ?: "LOG") + " " + hostOf(source) + ":" + line + " " + clean(message, CONSOLE_MAX)

    /** [scheme]://[host] of a request, nothing more (a blocked request's path or query is never logged). */
    fun origin(scheme: String?, host: String?): String = clean(scheme ?: "", 20) + "://" + clean(host ?: "", 100)

    /** The host of [url], or "-": never its path, query or fragment, and no user name or port. */
    fun hostOf(url: String?): String {
        if (url.isNullOrEmpty()) return "-"
        val scheme = url.indexOf("://")
        if (scheme < 0) return "-"
        var end = scheme + 3
        while (end < url.length && url[end] != '/' && url[end] != '?' && url[end] != '#') end++
        val host = url.substring(scheme + 3, end).substringAfterLast('@').substringBefore(':')
        return clean(host, 100).ifEmpty { "-" }
    }

    /**
     * [text] for one log line, at most [max] characters: control and line-separator characters become spaces, and a
     * web address keeps only its scheme, host and path (its query or fragment, which can carry ids, becomes `?...`).
     */
    fun clean(text: String?, max: Int): String {
        if (text == null) return ""
        val out = StringBuilder()
        var address = false
        var query = false
        var i = 0
        while (i < text.length && out.length < max) {
            val c = text[i]
            if (c < ' ' || c in '\u007f'..'\u009f' || c == '\u2028' || c == '\u2029') {
                address = false
                query = false
                out.append(' ')
            } else if (c == ' ' || c in "\"'<>()[]") {
                address = false
                query = false
                out.append(c)
            } else {
                if (!address && (text.startsWith("http://", i, ignoreCase = true) || text.startsWith("https://", i, ignoreCase = true))) address = true
                if (address && !query && (c == '?' || c == '#')) {
                    query = true
                    out.append("?...")
                }
                if (!query) out.append(c)
            }
            i++
        }
        if (out.length > max) out.setLength(max)
        if (out.isNotEmpty() && Character.isHighSurrogate(out[out.length - 1])) out.setLength(out.length - 1)
        return out.toString()
    }
}

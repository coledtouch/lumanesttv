package tv.lumanest.tuner.data

import android.util.Xml
import org.xmlpull.v1.XmlPullParser
import java.io.File
import java.util.Calendar
import java.util.TimeZone

/**
 * Streaming XMLTV parser. Provider guides can be 100MB+, so we only keep programmes for
 * channels we actually have and only inside a time window around "now".
 */
object Xmltv {
    class Result(
        /** Programmes keyed by lowercased XMLTV channel id. */
        val programs: Map<String, List<Program>>,
        /** [ChannelMatch.key] of display names (and ids) to lowercased channel id. */
        val nameToId: Map<String, String>,
        /** Lowercased channel id to its first <icon src>. */
        val icons: Map<String, String>,
    )

    /**
     * @param wanted lowercased channel ids to keep; grows as display names match [wantedKeys].
     * @param wantedKeys [ChannelMatch.key] values of our channel names.
     */
    fun parse(file: File, wanted: MutableSet<String>, wantedKeys: Set<String>, fromMs: Long, toMs: Long): Result {
        val keepAll = wanted.isEmpty() && wantedKeys.isEmpty()
        val out = HashMap<String, ArrayList<Program>>()
        val names = HashMap<String, String>()
        val regionalName = HashSet<String>()
        val icons = HashMap<String, String>()
        val parser = Xml.newPullParser()
        parser.setFeature(XmlPullParser.FEATURE_PROCESS_NAMESPACES, false)

        fun addName(key: String, id: String, regional: Boolean) {
            if (key.isEmpty()) return
            val existing = names[key]
            // Prefer the main (east/national) feed over Pacific/West variants.
            if (existing == null || (key in regionalName && !regional)) {
                names[key] = id
                if (regional) regionalName += key else regionalName -= key
            }
            if (key in wantedKeys) wanted += id
        }

        Net.openMaybeGzip(file).use { input ->
            parser.setInput(input, null)
            var event = parser.eventType
            var chId: String? = null
            var pStart = 0L; var pEnd = 0L; var pChan: String? = null
            var title: String? = null; var sub: String? = null; var desc: String? = null
            var keep = false
            while (event != XmlPullParser.END_DOCUMENT) {
                if (event == XmlPullParser.START_TAG) {
                    when (parser.name) {
                        "channel" -> {
                            val raw = parser.getAttributeValue(null, "id")
                            chId = raw?.lowercase()
                            if (raw != null) addName(ChannelMatch.idKey(raw), raw.lowercase(), ChannelMatch.isRegional(raw))
                        }
                        "display-name" -> chId?.let { id ->
                            val n = parser.nextText().trim()
                            addName(ChannelMatch.key(n), id, ChannelMatch.isRegional(n))
                        }
                        "icon" -> chId?.let { id ->
                            parser.getAttributeValue(null, "src")?.takeIf { it.startsWith("http") }?.let { icons.getOrPut(id) { it } }
                        }
                        "programme" -> {
                            pChan = parser.getAttributeValue(null, "channel")?.lowercase()
                            pStart = parseTime(parser.getAttributeValue(null, "start"))
                            pEnd = parseTime(parser.getAttributeValue(null, "stop"))
                            keep = pChan != null && (keepAll || pChan in wanted) &&
                                pEnd > fromMs && pStart < toMs && pEnd > pStart
                            title = null; sub = null; desc = null
                        }
                        "title" -> if (keep && title == null) title = parser.nextText().trim()
                        "sub-title" -> if (keep && sub == null) sub = parser.nextText().trim()
                        "desc" -> if (keep && desc == null) desc = parser.nextText().trim()
                    }
                } else if (event == XmlPullParser.END_TAG) {
                    when (parser.name) {
                        "channel" -> chId = null
                        "programme" -> {
                            val ch = pChan
                            if (keep && ch != null) out.getOrPut(ch) { ArrayList() } +=
                                Program(pStart, pEnd, title ?: "", desc?.ifBlank { null }, sub?.ifBlank { null })
                            keep = false
                        }
                    }
                }
                event = parser.next()
            }
        }
        val cleaned = out.mapValues { (_, list) -> dedupe(list.sortedBy { it.start }) }
        return Result(cleaned, names, icons)
    }

    private fun dedupe(list: List<Program>): List<Program> {
        val res = ArrayList<Program>(list.size)
        for (p in list) {
            val last = res.lastOrNull()
            if (last != null && p.start < last.end) {
                if (p.end > last.end) res += p.copy(start = last.end)
            } else res += p
        }
        return res
    }

    /** "20261012180000 +0000" (offset optional). */
    fun parseTime(s: String?): Long {
        if (s == null || s.length < 12) return 0
        return try {
            val cal = Calendar.getInstance(TimeZone.getTimeZone("UTC"))
            cal.clear()
            cal.set(
                s.substring(0, 4).toInt(), s.substring(4, 6).toInt() - 1, s.substring(6, 8).toInt(),
                s.substring(8, 10).toInt(), s.substring(10, 12).toInt(),
                if (s.length >= 14 && s[12].isDigit()) s.substring(12, 14).toInt() else 0,
            )
            var ms = cal.timeInMillis
            val tz = s.substringAfter(' ', "").trim()
            if (tz.length >= 5 && (tz[0] == '+' || tz[0] == '-')) {
                val off = (tz.substring(1, 3).toInt() * 60 + tz.substring(3, 5).toInt()) * 60_000L
                ms -= if (tz[0] == '+') off else -off
            }
            ms
        } catch (e: Exception) { 0 }
    }
}

package tv.lumanest.tuner.data

import java.text.Normalizer
import java.util.Calendar
import java.util.Locale
import java.util.TimeZone
import kotlin.math.abs

/**
 * Turns the provider's raw channel list into a cable-style lineup.
 *
 * Resellers like mybunny merge several upstream feeds, so one network arrives under several conventions:
 * "US: CNN", "(US) (SP) CNN", "US CNN (H)", "USA: CNN HD", and a local station like KDFW a dozen times.
 * The lineup gets:
 * - readable names, without country and feed tags ("US:", "(US) (RK)", "(H)"), quality markers or "(Backup)";
 * - one entry per network or local station. The other copies become [Channel.backups], which playback
 *   switches to when the first one is down;
 * - no empty event slots ("ESPN+ 78:", "NHL 07 : Offline", "Peacock | Event 20") and no events that already ended.
 */
object Cleanup {
    /** Older upload ids kept per film ([Movie.aliases]); snapshots store at most 1,000 strings per list. */
    private const val MAX_ALIASES = 100

    data class Lineup(val channels: List<Channel>, val merged: Map<String, String>)

    private val ic = setOf(RegexOption.IGNORE_CASE)

    // ---------------------------------------------------------------- names

    // Country tags at the front. Upper-case only, so "USA Network" and "Us Weekly" keep their names.
    private val leadingCountry = Regex(
        """^\s*(?:[(\[|]\s*USA?\s*[)\]|]|USA?\s*[:|]|USA?\s*[-–]\s*|USA?\s{2,}|USA\s+[A-Z]{2,6}:|US\s+(?!Open\b|Weekly\b|Marshals\b|Navy\b|Army\b)|""" +
            """USA\s+(?!Network\b|Today\b|Hockey\b|Rugby\b|Swimming\b|Gymnastics\b|Wrestling\b|Track\b|Softball\b|Baseball\b)(?=[A-Za-z0-9]))\s*""",
    )
    private val leadingService = Regex("""^\s*\(\s*(?:PLUTO|STV|SAMSUNG|ROKU|TUBI|PLEX|XUMO)\s+USA?\s*\)\s*""", ic)
    // Short upstream feed codes next to the country tag: (US) (SP), (US) (FOX1), (US) (RK), (US) (Prime), (STV) (USA).
    private const val CODE = """\(\s*(?:[A-Z0-9+]{1,5}|Prime|Tubi|Meo)\s*\)"""
    private val leadingCode = Regex("""^\s*$CODE\s*(?=\S)""")
    private val codeBeforeCountry = Regex("""^\s*$CODE\s*(?=[(\[|]\s*USA?\s*[)\]|])""")
    // A place in front, "(Yakima) PBS KTNW", reads better at the end: "PBS KTNW (Yakima)".
    private val leadingPlace = Regex("""^\s*[(\[]([^)\]]{3,30})[)\]]\s*(.+)$""")
    // Feed codes at the end, or before another tag: "TLC (East) (H)", "TBN (D) (Faith)".
    private val trailingCode = Regex("""\s*\((?:[A-Z]|HX|FEED|Feed)\)(?=\s*(?:\(|$))""")
    private val trailingCountry = Regex("""\s+USA?\s*$""")
    // Stream specs first ("(HD @ 7.2 Mbps @ 59 FPS)", "(720p59 @ 6.4Mbps)"), then plain quality words.
    private val quality = Regex(
        """\s*\([^()]*@\s*[\d.]+\s*Mbps[^()]*\)|\s*\((?:F?HD|UHD|SD)\s*@[^)]*\)|""" +
            """\s*[(\[]?\b(?:F?HD|UHD|4K|HEVC|H\.?265|1080[PI]?|720P|60\s*FPS|50\s*FPS)\b[)\]]?|\s*\(SD\)|\s+SD$|[ᴴᴰᵁᶠᴿᴬᵂʰᵈ⁶⁰ᵖˢ]{2,}""",
        ic,
    )
    private val backup = Regex("""\s*[(\[]?\bback\s*up\b[)\]]?""", ic)
    private val vip = Regex("""\s*[(\[]?\bVIP\b[)\]]?""")
    private val eventWindow = Regex("""\s*start:\s*\d{4}\s\d{2}\s\d{2}\s[\d:]{8}\s+stop:\s*\d{4}\s\d{2}\s\d{2}\s[\d:]{8}""", ic)
    private val spaces = Regex("""\s{2,}""")
    private val edges = Regex("""^[\s:|\-–]+|[\s:|\-–]+$""")

    /** "(US) (SP) MeTV (KAZA)" → "MeTV (KAZA)", "US: NATIONAL GEOGRAPHIC HD" → "NATIONAL GEOGRAPHIC", "USA Network" stays. */
    fun displayName(raw: String): String {
        var s = raw.replace(' ', ' ').trim()
        s = eventWindow.replace(s, "")
        var guard = 0
        while (guard++ < 6) {
            var next = leadingService.replace(leadingCountry.replace(s, ""), "")
            next = if (next != s) leadingCode.replace(next, "") else codeBeforeCountry.replace(next, "")
            if (next == s) break
            s = next
        }
        leadingPlace.matchEntire(s)?.let { m ->
            val place = m.groupValues[1].trim()
            if (place.any { it.isLowerCase() } && m.groupValues[2].isNotBlank()) s = "${m.groupValues[2].trim()} ($place)"
        }
        repeat(3) { s = trailingCode.replace(s, "") }
        s = trailingCountry.replace(s, "")
        s = quality.replace(s, " ")
        s = backup.replace(s, " ")
        s = vip.replace(s, " ")
        s = s.replace("()", " ").replace("[]", " ")
        s = edges.replace(spaces.replace(s, " "), "").trim()
        return s.ifBlank { raw.trim() }
    }

    fun isBackupCopy(raw: String): Boolean = backup.containsMatchIn(raw)

    // ---------------------------------------------------------------- event slots

    private val idlePhrase = Regex(
        """\b(?:no\s+(?:scheduled\s+)?(?:events?|games?|match(?:es)?|streams?)(?:\s+(?:scheduled|today|available))?|""" +
            """no\s+live\s+(?:courts?|events?|games?|match(?:es)?)|offline|off\s*air|not\s+live|coming\s+soon)\b""",
        ic,
    )
    // A separator followed only by a slot number: "NHL | 13", "Vidio Live Events | 17". Not a clock time like "14:00".
    private val slotNumberOnly = Regex("""(?:^|\s)[|:]\s*\d{1,3}\s*$""")
    private val slotEventOnly = Regex("""[|:]\s*event\s*\d{1,3}\s*$""", ic)
    // Panels park unused slots on a date far in the future: "(MAX 093) | (2098 12 31 08:00:55)".
    private val parkedSlot = Regex("""\(\s*209\d\s+\d{2}\s+\d{2}\b""")
    private val brandAndNumber = Regex(
        // Not "FS" or plain "MAX": "FS1" and "MAX 2" can be real channels.
        """^(?:PPV|UFC|EVENT|LIVE\s*EVENT|ESPN\s*\+|ESPN\s*PLUS|ESPNPLUS|PEACOCK|PARAMOUNT\s*\+?|P\+|MAX\s*US|MILB|NCAA[FB]?|NFL|NBA|WNBA|NHL|MLB|MLS|""" +
            """FLO\s*\w+|TENNIS\s*TV|WTA|ATP|FNTZ|USHTV|BIG\s*10\s*\+?)\s*(?:EVENT\s*)?\d{1,3}$""",
        ic,
    )

    /** An event channel with nothing on: "ESPN+ 78:", ":MAX US 71", "NHL | 13", "MLB 18: No event today", "Peacock | Event 20". */
    fun isIdleEvent(raw: String): Boolean {
        val n = raw.trim()
        if (n.isEmpty() || idlePhrase.containsMatchIn(n) || parkedSlot.containsMatchIn(n)) return true
        if (n.startsWith(":") || n.endsWith(":") || n.endsWith("|")) return true
        return slotNumberOnly.containsMatchIn(n) || slotEventOnly.containsMatchIn(n) || brandAndNumber.matches(n)
    }

    private val eastern = TimeZone.getTimeZone("America/New_York")
    private val utc = TimeZone.getTimeZone("UTC")
    private val shortDate = Regex("""\((\d{1,2})\.(\d{1,2})\s+(\d{1,2}):(\d{2})\s*([AP])M\s*E[SD]?T\)""", ic)
    private val monthDate = Regex("""@\s*(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})\s+(\d{1,2}):(\d{2})\s*([AP])M""", ic)
    private val stopTime = Regex("""stop:\s*(\d{4})\s(\d{2})\s(\d{2})\s(\d{2}):(\d{2}):(\d{2})""", ic)
    // "| Tuesday, 13 October 2026 20:00" and "| Fri 16th Oct 6:00PM" (European listings; close enough for a day-scale window).
    private val longDate = Regex("""\b(\d{1,2})(?:st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?(?:\s+\d{4})?\s+(\d{1,2}):(\d{2})\s*([AP]?)M?\b""", ic)
    private val months = listOf("jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec")
    private const val EVENT_LENGTH_MS = 6 * 3600_000L
    private const val EVENT_LEAD_MS = 20 * 3600_000L

    /**
     * An event channel that has nothing on right now: its event ended ("NFL 10: Commanders vs Giants (10.11 1:00PM ET)"
     * the next evening) or is still days away ("HBO 38: AEW Dynamite (10.21 8:00PM ET)").
     */
    fun isOffAir(raw: String, now: Long): Boolean {
        stopTime.find(raw)?.let { m ->
            val g = m.groupValues.drop(1).map { it.toInt() }
            if (g[1] in 1..12 && g[2] in 1..31 && g[3] in 0..23 && g[4] in 0..59) {
                val stop = Calendar.getInstance(utc, Locale.US).apply { clear(); set(g[0], g[1] - 1, g[2], g[3], g[4], g[5]) }.timeInMillis
                return stop < now
            }
        }
        val start = shortDate.find(raw)?.let { m ->
            easternTime(m.groupValues[1].toInt(), m.groupValues[2].toInt(), m.groupValues[3].toInt(), m.groupValues[4].toInt(), m.groupValues[5], now)
        } ?: monthDate.find(raw)?.let { m ->
            easternTime(months.indexOf(m.groupValues[1].lowercase(Locale.ROOT)) + 1, m.groupValues[2].toInt(), m.groupValues[3].toInt(),
                m.groupValues[4].toInt(), m.groupValues[5], now)
        } ?: longDate.find(raw)?.let { m ->
            easternTime(months.indexOf(m.groupValues[2].lowercase(Locale.ROOT).take(3)) + 1, m.groupValues[1].toInt(), m.groupValues[3].toInt(),
                m.groupValues[4].toInt(), m.groupValues[5], now)
        } ?: return false
        return start < now - EVENT_LENGTH_MS || start > now + EVENT_LEAD_MS
    }

    /** Listings carry no year, so pick the year that puts the date nearest to now ("12.31" seen on January 1st is last year). */
    private fun easternTime(month: Int, day: Int, clock: Int, minute: Int, ap: String, now: Long): Long? {
        if (month !in 1..12 || day !in 1..31 || clock !in 0..23 || minute !in 0..59) return null
        // Some panels mix clocks: "19:00 PM" is already 24-hour.
        val hour = if (clock > 12) clock else clock % 12 + if (ap.equals("P", ignoreCase = true)) 12 else 0
        val year = Calendar.getInstance(eastern, Locale.US).apply { timeInMillis = now }.get(Calendar.YEAR)
        return (year - 1..year + 1).map { y ->
            Calendar.getInstance(eastern, Locale.US).apply { clear(); set(y, month - 1, day, hour, minute, 0) }.timeInMillis
        }.minByOrNull { abs(it - now) }
    }

    // ---------------------------------------------------------------- duplicates

    // Call letters (case-sensitive), counted only next to a network name so "WWE" or "FOX Sports WEST" never match.
    private val callSign = Regex("""\b([KW][A-Z]{2,3})(?:-?(?:DT\d?|TV|CD|LD|CA))?\b""")
    private val networkWord = Regex("""\b(?:ABC|CBS|NBC|FOX|PBS|CW|MyNetwork|MyTV|MY|ION|Telemundo|Univision|UniMas)\b""", ic)
    private val notCallSigns = setOf("WEST", "WARS", "WWE", "KIDS", "WILD", "WIDE", "WAR", "WAY", "WEB", "WIN", "WOW", "KEY", "WAVE", "WALL")
    private val marks = Regex("""\p{Mn}+""")
    private val nonAlnum = Regex("""[^a-z0-9]""")
    private val eastFeed = Regex("""\b(?:east|eastern)\b""")
    private val leadingThe = Regex("""^\s*the\s+""")
    private val aliases = mapOf(
        "natgeo" to "nationalgeographic", "natgeowild" to "nationalgeographicwild", "fs1" to "foxsports1", "fs2" to "foxsports2",
        "foxnewschannel" to "foxnews", "foxbusinessnetwork" to "foxbusiness", "cnninternational" to "cnni",
    )
    private val popular = Regex("""most\s+watched|trending|popular""", ic)
    private val heavy = Regex("""\b(?:4K|UHD)\b""", ic)
    private val lowRes = Regex("""\bSD\b""")
    private val resolution = Regex("""\b(\d{3,4})p(\d{2})?\b""", ic)

    /** One local station: its call letters plus network, so KAEF's ABC channel and its FOX subchannel stay apart. */
    private fun stationKey(raw: String): String? {
        val net = networkWord.find(raw)?.value?.lowercase(Locale.ROOT)?.let { if (it.startsWith("my")) "my" else it } ?: return null
        val call = callSign.findAll(raw).map { it.groupValues[1] }.firstOrNull { it !in notCallSigns } ?: return null
        return "station:$call:$net"
    }

    /** "TruTV", "TRU TV" and "truTV East" are one channel; "HBO West" is still its own feed. */
    internal fun nameKey(display: String): String {
        var s = marks.replace(Normalizer.normalize(display, Normalizer.Form.NFKD), "").lowercase(Locale.ROOT)
        s = s.replace("&", " and ").replace("+", " plus ")
        s = leadingThe.replace(eastFeed.replace(s, " "), "")
        val k = nonAlnum.replace(s, "")
        return aliases[k] ?: k
    }

    private class Entry(val channel: Channel, val display: String, val score: Int, val order: Int)

    /**
     * Builds the lineup from channels that already passed [ContentPolicy]. [hidden] holds channels that failed to play
     * recently. [Lineup.merged] maps every folded-in copy's key to the key of the entry it joined.
     */
    fun lineup(raw: List<Channel>, categories: List<Category>, now: Long = System.currentTimeMillis(), hidden: Set<String> = emptySet()): Lineup {
        val favored = categories.filter { popular.containsMatchIn(it.name) }.mapTo(HashSet()) { it.id }
        val groups = LinkedHashMap<String, MutableList<Entry>>()
        raw.forEachIndexed { i, c ->
            if (c.key in hidden || isIdleEvent(c.name) || isOffAir(c.name, now)) return@forEachIndexed
            val display = displayName(c.name)
            var score = 0
            if (!c.epgId.isNullOrBlank()) score += 8
            if (c.categoryIds.any { it in favored }) score += 4
            if (isBackupCopy(c.name)) score -= 10
            if (display.any { it.isLowerCase() }) score += 3
            if (heavy.containsMatchIn(c.name)) score -= 2
            if (lowRes.containsMatchIn(c.name)) score -= 1
            // "NBA TV (1080p59 @ 9.4Mbps)" beats "NBA TV (360p29 @ 1.2Mbps)".
            resolution.find(c.name)?.let { m ->
                val lines = m.groupValues[1].toInt()
                score += when { lines >= 1080 -> 2; lines >= 720 -> 1; else -> -3 }
                if (m.groupValues[2] in setOf("50", "59", "60")) score += 1
            }
            val key = stationKey(c.name) ?: ("name:" + nameKey(display).ifEmpty { c.key })
            groups.getOrPut(key) { ArrayList(2) } += Entry(c, display, score, i)
        }
        val merged = HashMap<String, String>()
        val out = ArrayList<Channel>(groups.size)
        for (members in groups.values) {
            val ranked = members.sortedWith(compareByDescending<Entry> { it.score }.thenBy { it.order })
            val first = ranked.first().channel
            val rest = ranked.drop(1)
            rest.forEach { merged[it.channel.key] = first.key }
            out += first.copy(
                // Several copies are ALL CAPS; use the best-ranked properly cased name.
                name = ranked.firstOrNull { e -> e.display.any { it.isLowerCase() } }?.display ?: ranked.first().display,
                logo = first.logo?.takeIf { it.isNotBlank() } ?: rest.firstNotNullOfOrNull { it.channel.logo?.takeIf(String::isNotBlank) },
                epgId = first.epgId?.takeIf { it.isNotBlank() } ?: rest.firstNotNullOfOrNull { it.channel.epgId?.takeIf(String::isNotBlank) },
                categoryIds = ranked.flatMap { it.channel.categoryIds }.distinct(),
                backups = rest.map { it.channel.url }.filter { it != first.url }.distinct(),
            )
        }
        return Lineup(out, merged)
    }

    /**
     * Folds re-uploads of a film into one movie (docs/browse.md, "Copies of one title"): uploads whose names are equal
     * once lower-cased and stripped of everything but a-z and 0-9. Uploads listed only in foreign [categories] (every
     * one of their categories found there fails [VodRegion.isForeignCategory], usually dubbed copies) fold among
     * themselves and never into the others, so "Movies & Series: USA only" can still tell them apart. Each group keeps
     * its newest upload (largest [Movie.added]; on a tie, the first in [list]); the others become its backups, newest
     * first, and their ids its [Movie.aliases]; the group's categories are merged; a missing TMDB id, year or genre
     * comes from the newest copy that has one.
     */
    fun movies(list: List<Movie>, categories: List<Category> = emptyList()): List<Movie> {
        val foreign = HashMap<String, Boolean>(categories.size * 2)
        categories.forEach { foreign[it.id] = VodRegion.isForeignCategory(it.name) }
        return list.groupBy { movie ->
            val name = nonAlnum.replace(movie.name.lowercase(Locale.ROOT), "").ifEmpty { movie.id }
            // Ids missing from the category list are left out; a movie with no category left passes.
            val known = movie.categoryIds.mapNotNull { foreign[it] }
            if (known.isNotEmpty() && known.all { it }) "$name|foreign" else name
        }.values.map { copies ->
            if (copies.size == 1) return@map copies[0]
            // Stable: on a tie, list order.
            val newest = copies.sortedByDescending { it.added }
            val kept = newest.first()
            kept.copy(
                categoryIds = (kept.categoryIds + copies.flatMap { it.categoryIds }).distinct(),
                backups = (kept.backups + newest.flatMap { listOf(it.url) + it.backups }).filter { it != kept.url }.distinct(),
                // Browsing matches titles to TMDB (docs/browse.md): keep what the newest copy that knows it knew.
                tmdb = newest.firstNotNullOfOrNull { it.tmdb },
                year = newest.firstNotNullOfOrNull { it.year },
                genre = newest.firstNotNullOfOrNull { it.genre },
                aliases = (kept.aliases + copies.flatMap { listOf(it.id) + it.aliases }).filter { it != kept.id }.distinct().take(MAX_ALIASES),
            )
        }
    }
}

package tv.lumanest.tuner.data

import java.text.Normalizer

/**
 * Fuzzy channel-name keys so "US: CNN HD", "|US| CNN ᴴᴰ" and the XMLTV display name "CNN"
 * all land on the same key. Used for guide and logo matching.
 */
object ChannelMatch {
    // "US:", "US |", "[US]", "|US|", "UK -", "USA:", "VIP|" at the start of a name.
    private val prefix = Regex("""^\W*(?:[a-z]{2}\s*[:|\]\-–▎]+|[a-z]{3,4}\s*[:|\]▎]+)\s*""")
    private val bracketed = Regex("""[\[(][^\])]*[\])]""")
    private val noise = Regex(
        """\b(fhd|uhd|hd|sd|hq|lq|4k|8k|hevc|h\.?265|h\.?264|\d{3,4}p|\d{2}fps|raw|backup|alt|multi|vip|feed|east|eastern|channel|and)\b""",
    )
    private val regional = Regex("""\b(west|pacific|mountain|central|western)\b""")
    private val nonAlnum = Regex("[^a-z0-9]")

    fun key(raw: String): String {
        var s = Normalizer.normalize(raw, Normalizer.Form.NFKD).lowercase()
        s = s.replace('_', ' ').replace('.', ' ')
        s = prefix.replace(s, "")
        s = bracketed.replace(s, " ")
        s = s.replace("&", " ").replace("+", " plus ")
        s = noise.replace(s, " ")
        s = regional.replace(s, " ")
        s = s.replace(Regex("""^the\s+"""), "")
        val k = nonAlnum.replace(s, "")
        return aliases[k] ?: k
    }

    /** Long-form names some guides use for networks better known by their initials. */
    private val aliases = mapOf(
        "homegardentelevision" to "hgtv",
        "homegardentv" to "hgtv",
        "homeboxoffice" to "hbo",
        "turnernetworktelevision" to "tnt",
        "turnerclassicmovies" to "tcm",
        "americanmovieclassics" to "amc",
        "artsentertainment" to "ae",
        "theweather" to "weather",
        "weathernetwork" to "weather",
        "cablenewsnetwork" to "cnn",
        "musictelevision" to "mtv",
        "blackentertainmenttelevision" to "bet",
        "countrymusictelevision" to "cmt",
        "newenglandsportsnetwork" to "nesn",
        "newenglandsportsnetworkplus" to "nesnplus",
    )

    /** True for regional variants (Pacific/West feeds) that should lose to the main feed. */
    fun isRegional(raw: String): Boolean = regional.containsMatchIn(raw.lowercase()) || raw.contains("(P)")

    /** Key for an XMLTV/iptv-org id such as "Fight.Network.us2" or "FoxNews.us". */
    fun idKey(id: String): String {
        val base = id.substringBeforeLast('.', id)
        // Split CamelCase ("FoxNews") so it normalizes like "Fox News".
        return key(base.replace(Regex("([a-z])([A-Z])"), "$1 $2"))
    }

    /** Readable channel name for monogram tiles: no "US:" prefixes or quality tags. */
    fun display(raw: String): String {
        val s = raw.trim()
        val stripped = Regex("""^\W*(?:[A-Za-z]{2}\s*[:|\]\-–▎]+|[A-Za-z]{3,4}\s*[:|\]▎]+)\s*""").replace(s, "")
        return Regex("""\b(FHD|UHD|HD|SD|4K|HEVC|RAW|ᴴᴰ|ᵁᴴᴰ|ᶠᴴᴰ)\b""", RegexOption.IGNORE_CASE).replace(stripped, "")
            .replace(Regex("""[|\[\]]"""), " ").trim().ifBlank { s }
    }
}

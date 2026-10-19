package tv.lumanest.tuner.data

import java.util.Locale

/**
 * By default the provider's lineup is shown as delivered: the LumaNest customer hub decides which channels and
 * categories a line includes. Customers can switch Live TV to "USA channels only" in Settings, which keeps U.S.
 * programming and hides international channels. Movies, series and audio have no language restrictions.
 * Adult categories (see [AdultFilter]) and everything listed in them are left out of every catalogue unless the
 * viewer unlocked adult content with the Settings passcode. The store edition ([storeBuild]) never unlocks and also
 * leaves out channels and titles named as adult content.
 */
object ContentPolicy {
    data class Catalogue<T>(val items: List<T>, val categories: List<Category>)
    private data class Labels(val us: Boolean, val foreign: Boolean)
    private val noLabels = Labels(us = false, foreign = false)

    private val countryAliases = buildMap {
        Locale.getISOCountries().forEach { code ->
            put(code.lowercase(Locale.ROOT), code)
            put(Locale("", code).getDisplayCountry(Locale.ENGLISH).lowercase(Locale.ROOT), code)
            runCatching { Locale("", code).isO3Country.lowercase(Locale.ROOT) }.getOrNull()?.let { put(it, code) }
        }
        put("usa", "US"); put("u.s.", "US"); put("u.s.a.", "US"); put("u.s", "US"); put("u.s.a", "US")
        put("united states of america", "US"); put("uk", "GB"); put("britain", "GB")
        put("great britain", "GB"); put("united kingdom", "GB")
        // Tuvalu's code is "TV": "Tubi TV (USA)" and "Reality-TV" are not Tuvaluan.
        remove("tv")
    }
    /** Sports leagues and US streaming services: a category named after one of these is US programming. */
    private val usLeagues = Regex(
        "(?<![a-z])(?:nfl|nba|wnba|nhl|mlb|milb|mls|ncaa|espn|ppv|peacock|paramount|flo ?sports|flo ?college|flo ?racing)(?![a-z])",
        RegexOption.IGNORE_CASE,
    )
    /** Streaming services that put a country after their name: "(PLUTO Denmark)", "(PLUTO USA)". */
    private val services = setOf("pluto", "samsung", "stv", "roku", "tubi", "plex", "xumo", "rakuten", "prime")
    private val countryLabels = Regex(
        "(?<![a-z0-9])(?:" + countryAliases.keys.sortedByDescending { it.length }.joinToString("|") { Regex.escape(it) } + ")(?![a-z0-9])",
        RegexOption.IGNORE_CASE,
    )
    private val otherLanguageLabel = Regex(
        "(?<![a-z])(?:spanish|espa[nñ]ol|espanol|latino|latina|latam|latin|es|spa|french|fran[cç]ais|fr|fra|german|deutsch|de|deu|italian|italiano|it|ita|portuguese|portugu[eê]s|pt|por|arabic|ar|ara|hindi|hin|urdu|punjabi|bengali|tamil|telugu|malayalam|kannada|marathi|russian|rus|ru|polish|polski|pl|turkish|t[uü]rk[cç]e|tr|dutch|nederlands|nl|chinese|mandarin|cantonese|zh|japanese|ja|korean|ko|vietnamese|thai|indonesian|malay|filipino|tagalog|greek|hebrew|persian|farsi|ukrainian|romanian|hungarian|czech|slovak|serbian|croatian|bulgarian|swedish|norwegian|danish|finnish|multilingual|asian|taiwanese)(?![a-z])",
        RegexOption.IGNORE_CASE,
    )
    private val itemLabels = Regex("\\[([^]]+)\\]|\\(([^)]+)\\)|\\|([^|]+)\\|")
    private val itemPrefix = Regex("^\\s*([^:|]+?)\\s*[:|]\\s*|^\\s*([A-Za-z]{2,3})\\s*-\\s*")
    private val epgCountry = Regex("\\.([a-z]{2})$", RegexOption.IGNORE_CASE)
    private val metadataSeparators = Regex("[,;|/]+")
    private val englishMetadata = Regex("^(?:en|eng)(?:[-_][a-z0-9]{2,8})+$")
    private val englishAliases = setOf("english", "eng", "en")
    private val ambiguousCountryCodes = setOf("IN", "TO", "AS", "AT", "BE", "IS", "IT", "NO", "DO", "ME", "SO", "BY", "FI")
    private val markerSeparators = Regex("[/+|,;]+")
    private val markerWhitespace = Regex("\\s+")

    private fun countryLabel(match: MatchResult, value: String): String? {
        val code = countryAliases[match.value.lowercase(Locale.ROOT)] ?: return null
        if (match.value.length <= 3 && code != "US") {
            if (code in ambiguousCountryCodes && value.trim() != match.value && match.range.first > 0 &&
                value.getOrNull(match.range.first - 1) !in listOf('[', '(', '|', ':', '/')) return null
        }
        return code
    }

    private fun labels(value: String): Labels {
        val countries = countryLabels.findAll(value).mapNotNull { countryLabel(it, value) }.toList()
        return Labels("US" in countries || usLeagues.containsMatchIn(value), countries.any { it != "US" })
    }

    /** Resolve marked regions directly; ordinary title words never establish a region. */
    private fun nameLabels(name: String): Labels {
        var us = false
        var foreign = false
        fun include(value: String) {
            var clean = value.trim().lowercase(Locale.ROOT)
            // Remove the service before checking a whole country phrase such as United Kingdom.
            val serviceEnd = clean.indexOfFirst { it.isWhitespace() || it in "/+|,;" }
            if (serviceEnd > 0 && clean.substring(0, serviceEnd) in services)
                clean = clean.substring(serviceEnd).trim()
            val country = countryAliases[clean]
            if (country != null) {
                if (country == "US") us = true else foreign = true
                return
            }
            if (isEnglish(clean) || otherLanguageLabel.matches(clean)) return

            // Explicit separators retain country names as phrases. Whitespace-only compounds
            // use bounded longest-alias lookup, rather than scanning every country alias.
            val parts = clean.split(markerSeparators).map { it.trim() }.filter { it.isNotEmpty() }
            var markedUs = false
            var markedForeign = false
            for (part in parts) {
                val wholeCountry = countryAliases[part]
                if (wholeCountry != null) {
                    if (wholeCountry == "US") markedUs = true else markedForeign = true
                    continue
                }
                if (isEnglish(part) || otherLanguageLabel.matches(part)) continue
                val words = part.split(markerWhitespace)
                var index = 0
                while (index < words.size) {
                    var matched = false
                    for (length in minOf(4, words.size - index) downTo 1) {
                        val phrase = if (length == 1) words[index] else words.subList(index, index + length).joinToString(" ")
                        val code = countryAliases[phrase]
                        if (code != null || (length == 1 && (isEnglish(phrase) || otherLanguageLabel.matches(phrase)))) {
                            if (code == "US") markedUs = true else if (code != null) markedForeign = true
                            index += length
                            matched = true
                            break
                        }
                    }
                    // Commit no country evidence from an incomplete marker or ordinary title.
                    if (!matched) return
                }
            }
            us = us || markedUs
            foreign = foreign || markedForeign
        }

        itemLabels.findAll(name).forEach { match ->
            val value = match.groups[1]?.value ?: match.groups[2]?.value ?: match.groups[3]?.value
            if (value != null) include(value)
        }
        itemPrefix.find(name)?.let { match ->
            val value = match.groups[1]?.value ?: match.groups[2]?.value
            if (value != null) include(value)
        }
        // No large country-alias regex, normalized label string, or language scan per channel.
        return if (!us && !foreign) noLabels else Labels(us, foreign)
    }

    private fun metadataParts(value: String?) = value?.split(metadataSeparators)?.map { it.trim().lowercase(Locale.ROOT) }?.filter { it.isNotBlank() }.orEmpty()
    private fun countryIsUs(country: String?): Boolean = metadataParts(country).let { values -> values.isNotEmpty() && values.all { countryAliases[it] == "US" } }
    private fun conflictingCountry(country: String?): Boolean = metadataParts(country).any { countryAliases[it] != "US" }
    private fun isEnglish(value: String): Boolean = value in englishAliases || englishMetadata.matches(value)

    fun live(items: List<Channel>, categories: List<Category>, usOnly: Boolean = true, adultUnlocked: Boolean = false,
             storeBuild: Boolean = false): Catalogue<Channel> {
        val allowed = AdultFilter.filter(items, categories, adultUnlocked, { it.categoryIds },
            { it.adult || storeBuild && AdultFilter.isAdultTitle(it.name, live = true) }, strict = storeBuild)
        if (!usOnly) {
            val all = allowed.distinctBy { it.key }.map { channel ->
                val ids = channel.categoryIds.distinct().ifEmpty { listOf("__tuner_live") }
                channel.copy(categoryId = ids.first(), categoryIds = ids)
            }
            return Catalogue(all, usedCategories(all.flatMap { it.categoryIds }, categories, "__tuner_live", "Live TV"))
        }
        val categoriesById = categories.associate { it.id to labels(it.name) }
        val accepted = allowed.mapNotNull { channel ->
            val named = nameLabels(channel.name)
            val epgRegion = channel.epgId?.let { epgCountry.find(it)?.groupValues?.get(1)?.lowercase(Locale.ROOT) }?.let(countryAliases::get)
            if (conflictingCountry(channel.country) || named.foreign ||
                (epgRegion != null && epgRegion != "US")) return@mapNotNull null
            val memberships = channel.categoryIds.filter { id -> categoriesById[id]?.let { !it.foreign } == true }.distinct()
            val positive = countryIsUs(channel.country) || named.us || epgRegion == "US" || memberships.any { categoriesById[it]?.us == true }
            if (!positive) return@mapNotNull null
            val ids = memberships.ifEmpty { listOf("__tuner_us") }
            channel.copy(categoryId = ids.first(), categoryIds = ids)
        }.distinctBy { it.key }
        return Catalogue(accepted, usedCategories(accepted.flatMap { it.categoryIds }, categories, "__tuner_us", "USA"))
    }

    fun movies(items: List<Movie>, categories: List<Category>, adultUnlocked: Boolean = false, storeBuild: Boolean = false): Catalogue<Movie> {
        val allowed = AdultFilter.filter(items, categories, adultUnlocked, { it.categoryIds },
            { it.adult || storeBuild && AdultFilter.isAdultTitle(it.name, live = false) }, strict = storeBuild)
        val accepted = allowed.distinctBy { it.id }.map { movie ->
            val ids = movie.categoryIds.distinct().ifEmpty { listOf("__tuner_movies") }
            movie.copy(categoryId = ids.first(), categoryIds = ids)
        }
        return Catalogue(accepted, usedCategories(accepted.flatMap { it.categoryIds }, categories, "__tuner_movies", "Movies"))
    }

    fun series(items: List<Series>, categories: List<Category>, adultUnlocked: Boolean = false, storeBuild: Boolean = false): Catalogue<Series> {
        val allowed = AdultFilter.filter(items, categories, adultUnlocked, { it.categoryIds },
            { it.adult || storeBuild && AdultFilter.isAdultTitle(it.name, live = false) }, strict = storeBuild)
        val accepted = allowed.distinctBy { it.id }.map { series ->
            val ids = series.categoryIds.distinct().ifEmpty { listOf("__tuner_series") }
            series.copy(categoryId = ids.first(), categoryIds = ids)
        }
        return Catalogue(accepted, usedCategories(accepted.flatMap { it.categoryIds }, categories, "__tuner_series", "Series"))
    }

    private fun usedCategories(ids: List<String>, categories: List<Category>, fallbackId: String, fallbackName: String): List<Category> {
        val used = ids.toHashSet()
        return categories.filter { it.id in used && it.id != fallbackId }.distinctBy { it.id } + if (fallbackId in used) listOf(Category(fallbackId, fallbackName)) else emptyList()
    }
}

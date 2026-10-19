package tv.lumanest.tuner.data

/**
 * Adult ("XXX") categories stay hidden until the viewer unlocks them with the Settings passcode.
 * A category is adult when its name carries a standalone adult token (XXX, Adult, Adults, 18+, Porn,
 * "For Adults") or the provider flags it with `is_adult`. Items listed in any adult category, or flagged
 * themselves, are hidden with it everywhere: categories, guide, search, home rows, favorites and recents.
 *
 * The store edition ([strict]) never unlocks, also recognises other spellings (+18, 18 Plus, Adultos, Porno,
 * Erotic...) and hides channels, films and shows whose own name is adult, wherever they are listed.
 */
object AdultFilter {
    private val adultToken = Regex("(?<![a-z0-9])(?:xxx|adults?|18\\+|porn)(?![a-z0-9])", RegexOption.IGNORE_CASE)
    private val strictToken = Regex(
        "(?<![a-z0-9])(?:xxx|x-x-x|adults?|adult(?:e|es|i|o|os|a|as)|\\+\\s*18|18\\s*\\+|18\\s*plus|porn(?:o|os|hub)?|" +
            "erotic(?:a|o|os|as|s)?|erotik|hentai|nsfw)(?![a-z0-9])",
        RegexOption.IGNORE_CASE,
    )
    /** Item names are checked more narrowly than categories: never a bare "adult", so "Young Adult" stays. */
    private val adultTitle = Regex("(?<![a-z0-9])(?:xxx|x-x-x|\\+\\s*18|18\\s*\\+|porn(?:o|os|hub)?|hentai|nsfw)(?![a-z0-9])", RegexOption.IGNORE_CASE)
    /** Adult networks, checked on live channel names only ("The Hustler" and "The Penthouse" are also film and drama titles). */
    private val adultNetwork = Regex(
        "(?<![a-z0-9])(?:playboy|hustler|brazzers|penthouse|vivid|dorcel|babestation|red\\s*light|spice)(?![a-z0-9])",
        RegexOption.IGNORE_CASE,
    )
    /**
     * The action film "xXx" and its sequels: that spelling anywhere, and any capitalisation ("XXX (2002)",
     * "XXX: Return of Xander Cage") when a release year in brackets or a sequel subtitle says which film it is.
     */
    private val xxxFilm = Regex(
        "(?<![A-Za-z0-9])xXx(?![A-Za-z0-9])|(?i:(?<![a-z0-9])xxx(?=\\s*\\(\\s*(?:2002|2005|2017)\\s*\\)|" +
            "\\s*(?:2\\s*)?[:\\-]\\s*(?:the\\s+)?(?:return\\s+of\\s+xander\\s+cage|state\\s+of\\s+the\\s+union|next\\s+level)))",
    )
    /** Cartoon Network's evening block is family programming, not adult content. */
    private val adultSwim = Regex("(?<![a-z0-9])adult\\s*swim(?![a-z0-9])", RegexOption.IGNORE_CASE)
    private val flagValues = setOf("1", "true", "yes")

    fun isAdultName(name: String?, strict: Boolean = false): Boolean {
        if (name.isNullOrBlank()) return false
        return (if (strict) strictToken else adultToken).containsMatchIn(adultSwim.replace(name, " "))
    }

    /** Store edition only: a channel ([live]), film or show whose own name marks it as adult content. */
    fun isAdultTitle(name: String?, live: Boolean): Boolean {
        if (name.isNullOrBlank()) return false
        val text = xxxFilm.replace(name, " ")
        return adultTitle.containsMatchIn(text) || (live && adultNetwork.containsMatchIn(text))
    }

    /** Xtream `is_adult` arrives as 1, "1", true or "true" depending on the panel. */
    fun isAdultFlag(value: String?): Boolean {
        val text = value?.trim()?.lowercase() ?: return false
        return text in flagValues || text.toDoubleOrNull()?.let { it >= 1.0 } == true
    }

    fun isAdult(category: Category, strict: Boolean = false): Boolean = category.adult || isAdultName(category.name, strict)

    fun adultCategoryIds(categories: List<Category>, strict: Boolean = false): Set<String> =
        categories.filter { isAdult(it, strict) }.mapTo(HashSet()) { it.id }

    /**
     * Keeps everything when [unlocked]; otherwise drops flagged items and items in any adult category.
     * [strict] (store edition) ignores [unlocked] and uses the wider category spellings.
     */
    fun <T> filter(
        items: List<T>, categories: List<Category>, unlocked: Boolean,
        categoryIds: (T) -> List<String>, flagged: (T) -> Boolean, strict: Boolean = false,
    ): List<T> {
        if (unlocked && !strict) return items
        val adult = adultCategoryIds(categories, strict)
        if (adult.isEmpty()) return items.filterNot(flagged)
        return items.filter { item -> !flagged(item) && categoryIds(item).none { it in adult } }
    }
}

package tv.lumanest.tuner.data

/**
 * Adult ("XXX") categories stay hidden until the viewer unlocks them with the Settings passcode.
 * A category is adult when its name carries a standalone adult token (XXX, Adult, Adults, 18+, Porn,
 * "For Adults") or the provider flags it with `is_adult`. Items listed in any adult category, or flagged
 * themselves, are hidden with it everywhere: categories, guide, search, home rows, favorites and recents.
 */
object AdultFilter {
    private val adultToken = Regex("(?<![a-z0-9])(?:xxx|adults?|18\\+|porn)(?![a-z0-9])", RegexOption.IGNORE_CASE)
    /** Cartoon Network's evening block is family programming, not adult content. */
    private val adultSwim = Regex("(?<![a-z0-9])adult\\s*swim(?![a-z0-9])", RegexOption.IGNORE_CASE)
    private val flagValues = setOf("1", "true", "yes")

    fun isAdultName(name: String?): Boolean {
        if (name.isNullOrBlank()) return false
        return adultToken.containsMatchIn(adultSwim.replace(name, " "))
    }

    /** Xtream `is_adult` arrives as 1, "1", true or "true" depending on the panel. */
    fun isAdultFlag(value: String?): Boolean {
        val text = value?.trim()?.lowercase() ?: return false
        return text in flagValues || text.toDoubleOrNull()?.let { it >= 1.0 } == true
    }

    fun isAdult(category: Category): Boolean = category.adult || isAdultName(category.name)

    fun adultCategoryIds(categories: List<Category>): Set<String> = categories.filter(::isAdult).mapTo(HashSet()) { it.id }

    /** Keeps everything when [unlocked]; otherwise drops flagged items and items in any adult category. */
    fun <T> filter(
        items: List<T>, categories: List<Category>, unlocked: Boolean,
        categoryIds: (T) -> List<String>, flagged: (T) -> Boolean,
    ): List<T> {
        if (unlocked) return items
        val adult = adultCategoryIds(categories)
        if (adult.isEmpty()) return items.filterNot(flagged)
        return items.filter { item -> !flagged(item) && categoryIds(item).none { it in adult } }
    }
}

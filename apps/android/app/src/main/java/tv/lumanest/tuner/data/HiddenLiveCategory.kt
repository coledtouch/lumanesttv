package tv.lumanest.tuner.data

/**
 * The provider's own "Most watched now" live category (docs/extras.md, "Hidden live category"). It repeats channels
 * found in the provider's other categories and clashes with Tuner's own Most Watched, so every app hides it, matched by
 * name (its id differs from line to line). Tuner's Most Watched, Favorites and the trending playlist are not provider
 * categories and stay.
 */
object HiddenLiveCategory {
    private val TAGS = setOf("us", "usa", "en")
    private val MOST_WATCHED_NOW = listOf("most", "watched", "now")
    private val MOST_WATCHED = listOf("most", "watched")

    /**
     * True for a live category named like the provider's "Most watched now": each ASCII letter lower-cased, ASCII
     * letters and digits kept and every other character a separator, one leading and then one trailing `us`, `usa` or
     * `en` dropped, and the words left exactly `most watched now` or `most watched`. A loop over the characters, no
     * pattern.
     */
    fun isHidden(name: String): Boolean {
        val words = ArrayList<String>(6)
        val word = StringBuilder()
        for (c in name) {
            when (c) {
                in 'A'..'Z' -> word.append((c.code + 32).toChar())
                in 'a'..'z', in '0'..'9' -> word.append(c)
                else -> if (word.isNotEmpty()) {
                    words += word.toString()
                    word.setLength(0)
                    // A tag, three words and a tag at most: a longer name can't be one of the two.
                    if (words.size > 5) return false
                }
            }
        }
        if (word.isNotEmpty()) words += word.toString()
        if (words.isNotEmpty() && words.first() in TAGS) words.removeAt(0)
        if (words.isNotEmpty() && words.last() in TAGS) words.removeAt(words.lastIndex)
        return words == MOST_WATCHED_NOW || words == MOST_WATCHED
    }

    /** A provider's live lineup with its hidden categories taken out. */
    data class Lineup(val channels: List<Channel>, val categories: List<Category>)

    /**
     * Takes the hidden categories out of a provider's live [categories] and their ids out of each channel's, before the
     * USA filter and the folding of copies. A channel left with no category because all of its categories were hidden
     * is dropped (it is a copy of a channel listed elsewhere); a channel that had no category at all stays. Without a
     * hidden category, the same lists come back.
     */
    fun filter(channels: List<Channel>, categories: List<Category>): Lineup {
        val hidden = categories.filterTo(HashSet()) { isHidden(it.name) }.mapTo(HashSet()) { it.id }
        if (hidden.isEmpty()) return Lineup(channels, categories)
        val kept = channels.mapNotNull { channel ->
            if (channel.categoryIds.none { it in hidden }) return@mapNotNull channel
            val ids = channel.categoryIds.filter { it !in hidden }
            if (ids.isEmpty()) null else channel.copy(categoryId = ids.first(), categoryIds = ids)
        }
        return Lineup(kept, categories.filter { it.id !in hidden })
    }
}

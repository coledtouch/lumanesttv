package tv.lumanest.tuner.player

/**
 * Which subtitles Settings > Subtitles On shows by itself (docs/extras.md, "Automatic choice"): an English track the
 * stream carries, else an English file the provider lists, else the first OpenSubtitles track, else the player's
 * existing fallback (English or untagged captions, then the first text track). Plain Kotlin, so unit tests run it.
 */
object SubtitleChoice {
    enum class Source { STREAM, PROVIDER, OPENSUBTITLES }

    /**
     * One text track the player lists. A [forced] track only translates foreign dialogue, so it never counts as the
     * English subtitles of a stream (OpenSubtitles' forced-only files are left out the same way).
     */
    data class Track(val source: Source, val language: String?, val supported: Boolean = true, val forced: Boolean = false) {
        internal val usable: Boolean get() = supported && !forced
    }

    /** `en`, `eng` or `english` in any ASCII letter case, or `en` with a region (`en-US`, `en_GB`). */
    fun isEnglish(language: String?): Boolean {
        val code = language?.lowercase(java.util.Locale.ROOT) ?: return false
        return code == "en" || code == "eng" || code == "english" || code.startsWith("en-") || code.startsWith("en_")
    }

    /** The index in [tracks] to show, or null to leave the existing fallback to decide. */
    fun automatic(tracks: List<Track>): Int? {
        fun first(source: Source, english: Boolean) =
            tracks.indexOfFirst { it.usable && it.source == source && (!english || isEnglish(it.language)) }.takeIf { it >= 0 }
        return first(Source.STREAM, english = true) ?: first(Source.PROVIDER, english = true) ?: first(Source.OPENSUBTITLES, english = false)
    }

    /** An English track of the stream or the provider is there: it would win, so no OpenSubtitles file is needed. */
    fun hasOwnEnglish(tracks: List<Track>): Boolean =
        tracks.any { it.usable && it.source != Source.OPENSUBTITLES && isEnglish(it.language) }

    /** [selected] (a track Media3 picked) is as good as the [automatic] pick [chosen]: the same kind, English. */
    fun sameKind(selected: Track, chosen: Track): Boolean = selected.usable && selected.source == chosen.source &&
        (chosen.source == Source.OPENSUBTITLES || isEnglish(selected.language))
}

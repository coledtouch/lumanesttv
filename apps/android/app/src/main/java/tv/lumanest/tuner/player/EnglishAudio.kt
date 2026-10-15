package tv.lumanest.tuner.player

import androidx.media3.common.C
import androidx.media3.common.Tracks

/** Only audio language tags count, never filenames, subtitles or track labels. */
object EnglishAudio {
    fun isUntagged(language: String?): Boolean = language.isNullOrBlank() || language.trim().lowercase() in setOf("und", "unk")

    fun findUntagged(tracks: Tracks): Pair<Tracks.Group, Int>? {
        for (group in tracks.groups) {
            if (group.type != C.TRACK_TYPE_AUDIO) continue
            for (i in 0 until group.length) {
                if (group.isTrackSupported(i) && isUntagged(group.getTrackFormat(i).language)) return group to i
            }
        }
        return null
    }

    fun preferred(tracks: Tracks, allowUntagged: Boolean): Pair<Tracks.Group, Int>? =
        find(tracks) ?: if (allowUntagged) findUntagged(tracks) else null

    fun selectedAllowed(tracks: Tracks, allowUntagged: Boolean): Boolean {
        if (selectedEnglish(tracks)) return true
        if (!allowUntagged || find(tracks) != null || findUntagged(tracks) == null) return false
        if (tracks.groups.none { it.type == C.TRACK_TYPE_AUDIO && (0 until it.length).any(it::isTrackSelected) }) return false
        return tracks.groups.filter { it.type == C.TRACK_TYPE_AUDIO }.all { group ->
            (0 until group.length).all { i -> !group.isTrackSelected(i) ||
                (group.isTrackSupported(i) && (isEnglish(group.getTrackFormat(i).language) ||
                    (allowUntagged && isUntagged(group.getTrackFormat(i).language)))) }
        }
    }
    fun isEnglish(language: String?): Boolean = language?.trim()?.lowercase()
        ?.replace('_', '-')?.substringBefore('-') in setOf("en", "eng")

    fun find(tracks: Tracks): Pair<Tracks.Group, Int>? {
        for (group in tracks.groups) {
            if (group.type != C.TRACK_TYPE_AUDIO) continue
            for (i in 0 until group.length) {
                if (group.isTrackSupported(i) && isEnglish(group.getTrackFormat(i).language)) return group to i
            }
        }
        return null
    }

    fun selectedEnglish(tracks: Tracks): Boolean {
        var found = false
        for (group in tracks.groups) {
            if (group.type != C.TRACK_TYPE_AUDIO) continue
            for (i in 0 until group.length) if (group.isTrackSelected(i)) {
                if (!group.isTrackSupported(i) || !isEnglish(group.getTrackFormat(i).language)) return false
                found = true
            }
        }
        return found
    }
}

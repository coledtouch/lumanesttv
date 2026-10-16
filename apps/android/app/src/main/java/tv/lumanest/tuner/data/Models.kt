package tv.lumanest.tuner.data

enum class SourceType { XTREAM, M3U }

data class Source(
    val id: String,
    val name: String,
    val type: SourceType,
    val server: String = "",
    val username: String = "",
    val password: String = "",
    val m3uUrl: String = "",
    val epgUrl: String = "",
    val userAgent: String = "",
    /** Optional M3U of featured/"trending" channels, shown as its own guide category. */
    val hotUrl: String = "",
)

/** [adult] is the provider's own `is_adult` flag; names are checked by [AdultFilter]. */
data class Category(val id: String, val name: String, val adult: Boolean = false)

data class Channel(
    val key: String,
    val number: Int,
    val name: String,
    val logo: String?,
    val categoryId: String,
    val epgId: String?,
    val streamId: String?,
    val url: String,
    /** Every category the provider lists this channel under (Xtream can repeat items per category). */
    val categoryIds: List<String> = listOf(categoryId),
    val country: String? = null,
    val language: String? = null,
    /** Other copies of this channel from the provider, tried in order when [url] doesn't play. */
    val backups: List<String> = emptyList(),
    /** Provider `is_adult` flag. Only read by [ContentPolicy] before the catalogue is published. */
    val adult: Boolean = false,
)

data class Movie(
    val id: String,
    val name: String,
    val poster: String?,
    val rating: String?,
    val categoryId: String,
    val url: String,
    val added: Long = 0,
    val categoryIds: List<String> = listOf(categoryId),
    val country: String? = null,
    val language: String? = null,
    /** Other provider uploads of this film, tried if the primary upload cannot play. */
    val backups: List<String> = emptyList(),
    /** Provider `is_adult` flag. Only read by [ContentPolicy] before the catalogue is published. */
    val adult: Boolean = false,
)

data class Series(
    val id: String,
    val name: String,
    val cover: String?,
    val plot: String?,
    val rating: String?,
    val categoryId: String,
    val genre: String?,
    val year: String?,
    val backdrop: String?,
    val added: Long = 0,
    val categoryIds: List<String> = listOf(categoryId),
    val country: String? = null,
    val language: String? = null,
    /** Provider `is_adult` flag. Only read by [ContentPolicy] before the catalogue is published. */
    val adult: Boolean = false,
)

data class Episode(
    val id: String,
    val season: Int,
    val number: Int,
    val title: String,
    val plot: String?,
    val image: String?,
    val durationSecs: Int,
    val url: String,
    /** External subtitle files the provider lists for this episode (Xtream `subtitles`). */
    val subtitles: List<ExternalSubtitle> = emptyList(),
)

/** A sidecar subtitle file (SRT, WebVTT, SSA or TTML) offered next to a movie or episode. */
data class ExternalSubtitle(val url: String, val language: String? = null, val label: String? = null)

data class Program(
    val start: Long,
    val end: Long,
    val title: String,
    val desc: String? = null,
    val subtitle: String? = null,
    val placeholder: Boolean = false,
) {
    fun isOnAt(t: Long) = t in start until end
}

data class MovieInfo(
    val plot: String?,
    val cast: String?,
    val director: String?,
    val genre: String?,
    val year: String?,
    val duration: String?,
    val rating: String?,
    val backdrop: String?,
    val poster: String?,
    val subtitles: List<ExternalSubtitle> = emptyList(),
)

data class SeriesInfo(
    val plot: String?,
    val cast: String?,
    val genre: String?,
    val year: String?,
    val backdrop: String?,
    val seasons: Map<Int, List<Episode>>,
)

/** Something the player can play. Live requests carry the channel list so up/down can zap. */
sealed interface PlayRequest {
    data class Live(val channel: Channel, val lineup: List<Channel>) : PlayRequest
    data class Vod(
        val resumeId: String,
        val title: String,
        val subtitle: String?,
        val image: String?,
        val url: String,
        val startMs: Long,
        val queue: List<Vod> = emptyList(),
        val requireEnglishAudio: Boolean = false,
        val streamBackups: List<String> = emptyList(),
        val subtitles: List<ExternalSubtitle> = emptyList(),
    ) : PlayRequest
}

data class Recent(
    val id: String,
    val title: String,
    val subtitle: String?,
    val image: String?,
    val url: String,
    val positionMs: Long,
    val durationMs: Long,
    val updated: Long,
)

package tv.lumanest.tuner.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Add
import androidx.compose.material.icons.rounded.ArrowBack
import androidx.compose.material.icons.rounded.Check
import androidx.compose.material.icons.rounded.PlayArrow
import androidx.compose.material.icons.rounded.Replay
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import tv.lumanest.tuner.data.BrowseTitle
import tv.lumanest.tuner.data.Episode
import tv.lumanest.tuner.data.Movie
import tv.lumanest.tuner.data.MovieInfo
import tv.lumanest.tuner.data.PlayRequest
import tv.lumanest.tuner.data.Recent
import tv.lumanest.tuner.data.Repo
import tv.lumanest.tuner.data.Series
import tv.lumanest.tuner.data.SeriesInfo
import coil.compose.AsyncImage
import kotlinx.coroutines.launch

@Composable
private fun Backdrop(image: String?) {
    Box(Modifier.fillMaxSize()) {
        if (!image.isNullOrBlank()) AsyncImage(
            image, null, contentScale = ContentScale.Crop, alpha = 0.42f,
            modifier = Modifier.align(Alignment.CenterEnd).fillMaxHeight().fillMaxWidth(0.76f),
        )
        Box(Modifier.fillMaxSize().background(Brush.horizontalGradient(0.2f to Palette.bg, 0.8f to Palette.bg.copy(alpha = 0.55f))))
        Box(Modifier.fillMaxSize().background(Brush.verticalGradient(0.4f to Color.Transparent, 1f to Palette.bg)))
    }
}

@Composable
private fun DetailHeader(label: String, state: AppState, modifier: Modifier = Modifier) {
    Row(modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) {
            Text(label, color = Palette.accent, fontSize = 11.sp, fontWeight = FontWeight.Bold, letterSpacing = 1.8.sp)
            Text("Arrows Move · OK Select · Back Return", color = Palette.dim, fontSize = 10.sp, maxLines = 1, modifier = Modifier.padding(top = 4.dp))
        }
        PillButton("Back", { state.pop() }, icon = { Icon(Icons.Rounded.ArrowBack, null, tint = it, modifier = Modifier.size(18.dp)) })
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun MovieDetailScreen(movie: Movie, state: AppState) {
    var info by remember(movie.id) { mutableStateOf<MovieInfo?>(null) }
    var loading by remember(movie.id) { mutableStateOf(true) }
    LaunchedEffect(movie.id) {
        info = Repo.movieInfo(movie)
        loading = false
    }
    val recents by Repo.prefs.recents.collectAsState()
    // A position saved for an older upload of this film (Movie.aliases) resumes here too.
    val resume = recents.firstOrNull { (it.id == movie.id || it.id in movie.aliases) && (it.url == movie.url || it.url in movie.backups) && it.positionMs > 0 }
    val first = remember(movie.id) { FocusRequester() }
    LaunchedEffect(movie.id) { requestAttachedFocus(first) }

    fun play(from: Long) = state.push(
        Screen.Player(PlayRequest.Vod(movie.id, movie.name, info?.year, info?.poster ?: movie.poster, movie.url, from, streamBackups = movie.backups,
            subtitles = info?.subtitles.orEmpty(), titleKey = BrowseTitle.movieKey(movie.id))),
    )

    BoxWithConstraints(Modifier.fillMaxSize()) {
        val compact = maxHeight < 440.dp || maxWidth < 760.dp
        val inset = if (compact) 20.dp else 32.dp
        val posterWidth = (maxHeight * 0.36f).coerceIn(100.dp, 190.dp)
        val showPoster = maxWidth >= 500.dp
        Backdrop(info?.backdrop ?: movie.poster)
        Column(Modifier.fillMaxSize().padding(horizontal = inset, vertical = if (compact) 12.dp else 20.dp)) {
            DetailHeader("MOVIES", state)
            Row(
                Modifier.weight(1f).fillMaxWidth().padding(top = if (compact) 12.dp else 22.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                if (showPoster) {
                    Box(Modifier.width(posterWidth).height(posterWidth * 1.5f).clip(RoundedCornerShape(12.dp)).background(Palette.surface2)) {
                        Text(movie.name, color = Palette.dim, fontSize = 17.sp, fontWeight = FontWeight.SemiBold, maxLines = 4, overflow = TextOverflow.Ellipsis, modifier = Modifier.align(Alignment.Center).padding(16.dp))
                        (info?.poster ?: movie.poster)?.takeIf { it.isNotBlank() }?.let { poster ->
                            AsyncImage(poster, null, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
                        }
                    }
                    Spacer(Modifier.width(if (compact) 24.dp else 36.dp))
                }
                Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(vertical = 4.dp)) {
                    Text(
                        movie.name, color = Palette.text, fontSize = if (compact) 25.sp else 34.sp,
                        fontWeight = FontWeight.Bold, maxLines = 2, overflow = TextOverflow.Ellipsis,
                        lineHeight = if (compact) 29.sp else 38.sp,
                    )
                    val metadata = listOfNotNull(
                        info?.year?.takeIf { it.isNotBlank() },
                        info?.duration?.takeIf { it.isNotBlank() && it != "00:00:00" },
                        info?.genre?.takeIf { it.isNotBlank() },
                        contentRating(info?.rating ?: movie.rating)?.let { "★ $it" },
                    ).joinToString("  ·  ")
                    if (metadata.isNotBlank()) Text(metadata, color = Palette.dim, fontSize = 13.sp, maxLines = 2, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(top = 8.dp))
                    FlowRow(
                        modifier = Modifier.padding(top = if (compact) 16.dp else 22.dp),
                        horizontalArrangement = Arrangement.spacedBy(10.dp),
                        verticalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        PillButton(
                            if (resume != null) "Resume" else "Watch Movie",
                            { play(resume?.positionMs ?: 0L) }, Modifier.focusRequester(first),
                            icon = { Icon(Icons.Rounded.PlayArrow, null, tint = it) }, primary = true,
                        )
                        if (resume != null) PillButton("Start over", { play(0) }, icon = { Icon(Icons.Rounded.Replay, null, tint = it, modifier = Modifier.size(20.dp)) })
                        LibraryButton(BrowseTitle.movieKey(movie.id), movie.name, aliases = movie.aliases.map(BrowseTitle::movieKey))
                    }
                    resume?.let { recent ->
                        Text(
                            if (recent.durationMs > recent.positionMs) "${fmtDuration(recent.durationMs - recent.positionMs)} left · Resume at ${fmtClock(recent.positionMs)}" else "Resume at ${fmtClock(recent.positionMs)}",
                            color = Palette.dim, fontSize = 12.sp, modifier = Modifier.padding(top = 10.dp),
                        )
                        if (recent.durationMs > 0) WatchProgress(recent.positionMs.toFloat() / recent.durationMs, Modifier.padding(top = 7.dp).fillMaxWidth(0.72f))
                    }
                    if (!info?.plot.isNullOrBlank()) Text(
                        info?.plot.orEmpty(), color = Palette.text.copy(alpha = 0.8f), fontSize = if (compact) 13.sp else 15.sp,
                        lineHeight = if (compact) 19.sp else 22.sp, maxLines = if (compact) 3 else 5,
                        overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(top = if (compact) 14.dp else 20.dp),
                    ) else if (loading) Text("Loading details…", color = Palette.dim, fontSize = 12.sp, modifier = Modifier.padding(top = 18.dp))
                    info?.director?.takeIf { it.isNotBlank() }?.let {
                        Text("Director  $it", color = Palette.dim, fontSize = 12.sp, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(top = 12.dp))
                    }
                    info?.cast?.takeIf { it.isNotBlank() }?.let {
                        Text("Cast  $it", color = Palette.dim, fontSize = 12.sp, maxLines = 2, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(top = 5.dp))
                    }
                }
            }
        }
    }
}

@Composable
fun SeriesDetailScreen(series: Series, state: AppState) {
    var info by remember(series.id) { mutableStateOf<SeriesInfo?>(null) }
    var loading by remember(series.id) { mutableStateOf(true) }
    var loadAttempt by remember(series.id) { mutableIntStateOf(0) }
    LaunchedEffect(series.id, loadAttempt) {
        loading = true
        info = Repo.seriesInfo(series)
        loading = false
    }
    val recents by Repo.prefs.recents.collectAsState()
    var season by remember(series.id) { mutableIntStateOf(-1) }
    val playFocus = remember(series.id) { FocusRequester() }
    val requesters = remember(series.id) { mutableMapOf<String, FocusRequester>() }
    val episodeList = rememberLazyListState()
    val scope = rememberCoroutineScope()
    var initialFocusApplied by remember(series.id) { mutableStateOf(false) }

    val seasons = info?.seasons.orEmpty()
    val seasonKeys = remember(seasons) { seasons.keys.sorted() }
    val allEpisodes = remember(seasons) {
        seasons.toSortedMap().values.flatMap { episodes -> episodes.sortedWith(compareBy<Episode> { it.number }.thenBy { it.id }) }
    }
    val recentById = remember(recents, allEpisodes) {
        val episodesById = allEpisodes.associateBy { it.id }
        recents.filter { episodesById[it.id]?.url == it.url }.associateBy { it.id }
    }
    val lastWatched = remember(recents, allEpisodes) {
        recents.firstNotNullOfOrNull { recent -> allEpisodes.firstOrNull { it.id == recent.id && it.url == recent.url }?.let { it to recent } }
    }
    val returningEpisode = allEpisodes.firstOrNull { it.id == state.lastEpisodeKey }.takeIf { state.restoreFocus }
    val selectedSeason = season.takeIf { it in seasonKeys }
        ?: returningEpisode?.season
        ?: lastWatched?.first?.season
        ?: seasonKeys.firstOrNull { it > 0 }
        ?: seasonKeys.firstOrNull()
        ?: -1
    val episodes = remember(seasons, selectedSeason) {
        seasons[selectedSeason].orEmpty().sortedWith(compareBy<Episode> { it.number }.thenBy { it.id })
    }
    val firstEpisode = allEpisodes.firstOrNull { it.season > 0 } ?: allEpisodes.firstOrNull()

    LaunchedEffect(loading, selectedSeason, state.restoreFocus) {
        if (loading || (initialFocusApplied && !state.restoreFocus)) return@LaunchedEffect
        val focused = if (returningEpisode != null) {
            season = returningEpisode.season
            val index = episodes.indexOfFirst { it.id == returningEpisode.id }
            if (index >= 0) {
                val requester = requesters.getOrPut(returningEpisode.id) { FocusRequester() }
                withFrameNanos { }
                episodeList.scrollToItem(index)
                requestAttachedFocus(requester)
            } else false
        } else {
            requestAttachedFocus(playFocus)
        }
        if (focused) {
            initialFocusApplied = true
            if (state.restoreFocus) state.restoreFocus = false
        }
    }

    fun play(episode: Episode, from: Long) {
        val index = allEpisodes.indexOfFirst { it.id == episode.id }
        val queue = allEpisodes.drop(index + 1).take(30).map { it.toRequest(series, 0) }
        state.lastEpisodeKey = episode.id
        state.push(Screen.Player(episode.toRequest(series, from).copy(queue = queue)))
    }

    BoxWithConstraints(Modifier.fillMaxSize()) {
        val compact = maxHeight < 440.dp || maxWidth < 760.dp
        val inset = if (compact) 20.dp else 32.dp
        Backdrop(info?.backdrop ?: series.backdrop ?: series.cover)
        Column(Modifier.fillMaxSize().padding(horizontal = inset, vertical = if (compact) 12.dp else 20.dp)) {
            DetailHeader("SERIES", state)
            Row(Modifier.weight(1f).fillMaxWidth().padding(top = if (compact) 12.dp else 18.dp)) {
                Column(Modifier.weight(0.38f).fillMaxHeight().padding(end = if (compact) 18.dp else 28.dp)) {
                    Column(Modifier.weight(1f).fillMaxWidth().verticalScroll(rememberScrollState()).padding(bottom = 8.dp)) {
                        Text(
                            series.name, color = Palette.text, fontSize = if (compact) 24.sp else 31.sp,
                            fontWeight = FontWeight.Bold, maxLines = 2, overflow = TextOverflow.Ellipsis,
                            lineHeight = if (compact) 28.sp else 35.sp,
                        )
                        val metadata = listOfNotNull(
                            (info?.year ?: series.year)?.takeIf { it.isNotBlank() },
                            (info?.genre ?: series.genre)?.takeIf { it.isNotBlank() },
                            if (seasonKeys.isNotEmpty()) "${seasonKeys.size} " + if (seasonKeys.size == 1) "season" else "seasons" else null,
                            contentRating(series.rating)?.let { "★ $it" },
                        ).joinToString("  ·  ")
                        if (metadata.isNotBlank()) Text(metadata, color = Palette.dim, fontSize = 12.sp, maxLines = 2, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(top = 8.dp))
                        Spacer(Modifier.height(if (compact) 14.dp else 20.dp))
                        when {
                            // Add to Library is on the page whatever the episodes do: loading, failed or none.
                            loading -> {
                                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                                    CircularProgressIndicator(color = Palette.accent, strokeWidth = 2.dp, modifier = Modifier.size(18.dp))
                                    Text("Loading episodes…", color = Palette.dim, fontSize = 13.sp)
                                }
                                LibraryButton(BrowseTitle.seriesKey(series.id), series.name, Modifier.padding(top = 12.dp))
                            }
                            info == null -> {
                                Text("Couldn't load episodes", color = Palette.text, fontSize = 14.sp, fontWeight = FontWeight.SemiBold)
                                Text("Check your connection and try again.", color = Palette.dim, fontSize = 12.sp, modifier = Modifier.padding(top = 5.dp, bottom = 12.dp))
                                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                                    PillButton("Try again", { loadAttempt++ }, Modifier.focusRequester(playFocus), primary = true)
                                    LibraryButton(BrowseTitle.seriesKey(series.id), series.name)
                                }
                            }
                            allEpisodes.isEmpty() -> {
                                Text("No episodes available", color = Palette.dim, fontSize = 14.sp)
                                Row(Modifier.padding(top = 12.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                                    PillButton("Back to Series", { state.pop() }, Modifier.focusRequester(playFocus))
                                    LibraryButton(BrowseTitle.seriesKey(series.id), series.name)
                                }
                            }
                            lastWatched != null -> {
                                val nextUp = lastWatched.second.nextUp
                                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                                    PillButton(
                                        (if (nextUp) "Play" else "Resume") + " S${lastWatched.first.season} E${lastWatched.first.number}",
                                        { play(lastWatched.first, lastWatched.second.positionMs) }, Modifier.focusRequester(playFocus),
                                        icon = { Icon(Icons.Rounded.PlayArrow, null, tint = it, modifier = Modifier.size(20.dp)) }, primary = true,
                                    )
                                    LibraryButton(BrowseTitle.seriesKey(series.id), series.name)
                                }
                                Text((if (nextUp) "Up next" else "At ${fmtClock(lastWatched.second.positionMs)}") + " · ${lastWatched.first.title}", color = Palette.dim, fontSize = 11.sp, maxLines = 2, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(top = 8.dp))
                            }
                            firstEpisode != null -> Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                                PillButton(
                                    "Watch Series", { play(firstEpisode, 0) }, Modifier.focusRequester(playFocus),
                                    icon = { Icon(Icons.Rounded.PlayArrow, null, tint = it, modifier = Modifier.size(20.dp)) }, primary = true,
                                )
                                LibraryButton(BrowseTitle.seriesKey(series.id), series.name)
                            }
                        }
                        val plot = info?.plot ?: series.plot
                        if (!plot.isNullOrBlank()) Text(
                            plot, color = Palette.text.copy(alpha = 0.8f), fontSize = 13.sp, lineHeight = 19.sp,
                            maxLines = if (compact) 3 else 5, overflow = TextOverflow.Ellipsis,
                            modifier = Modifier.padding(top = if (compact) 14.dp else 20.dp),
                        )
                    }
                    if (seasonKeys.isNotEmpty()) {
                        Text("SEASONS", color = Palette.faint, fontSize = 10.sp, fontWeight = FontWeight.Bold, letterSpacing = 1.2.sp, modifier = Modifier.padding(bottom = 8.dp))
                        LazyRow(contentPadding = PaddingValues(vertical = 4.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            items(seasonKeys, key = { it }) { number ->
                                FocusBox(
                                    onClick = {
                                        season = number
                                        scope.launch {
                                            withFrameNanos { }
                                            episodeList.scrollToItem(0)
                                            val first = seasons[number].orEmpty().minWithOrNull(compareBy<Episode> { it.number }.thenBy { it.id })
                                            if (first != null) {
                                                val requester = requesters.getOrPut(first.id) { FocusRequester() }
                                                requestAttachedFocus(requester)
                                            }
                                        }
                                    },
                                    shape = RoundedCornerShape(50),
                                    color = if (number == selectedSeason) Palette.accent.copy(alpha = 0.2f) else Palette.surface2,
                                    focusedColor = Palette.focus, focusedScale = 1.02f, ring = false,
                                ) { focused ->
                                    Text(
                                        seasonName(number), color = if (focused) Palette.onFocus else if (number == selectedSeason) Palette.accent else Palette.text,
                                        fontSize = 12.sp, fontWeight = FontWeight.SemiBold,
                                        modifier = Modifier.padding(horizontal = 13.dp, vertical = 8.dp),
                                    )
                                }
                            }
                        }
                    }
                }
                Column(Modifier.weight(0.62f).fillMaxHeight()) {
                    if (selectedSeason >= 0) Row(Modifier.fillMaxWidth().padding(bottom = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                        Text(seasonName(selectedSeason), color = Palette.text, fontSize = 17.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f))
                        Text("${episodes.size} " + if (episodes.size == 1) "episode" else "episodes", color = Palette.dim, fontSize = 11.sp)
                    }
                    LazyColumn(
                        state = episodeList, modifier = Modifier.weight(1f).fillMaxWidth(),
                        contentPadding = PaddingValues(top = 3.dp, bottom = 18.dp, end = 6.dp, start = 3.dp),
                        verticalArrangement = Arrangement.spacedBy(10.dp),
                    ) {
                        items(episodes, key = { it.id }) { episode ->
                            val recent = recentById[episode.id]
                            EpisodeRow(
                                episode = episode, recent = recent, compact = compact,
                                modifier = Modifier.focusRequester(requesters.getOrPut(episode.id) { FocusRequester() }),
                                onClick = { play(episode, recent?.positionMs ?: 0) },
                            )
                        }
                    }
                }
            }
        }
    }
}

private fun seasonName(number: Int) = if (number == 0) "Specials" else "Season $number"

private fun Episode.toRequest(series: Series, from: Long) = PlayRequest.Vod(
    resumeId = id,
    title = series.name,
    subtitle = "S$season E$number · $title",
    image = image ?: series.cover,
    url = url,
    startMs = from,
    subtitles = subtitles,
    titleKey = BrowseTitle.seriesKey(series.id),
)

/**
 * Adds the movie or series to the Library (the check badge on its poster), or removes it. A film saved under an older
 * upload's key ([aliases]) shows as in the Library.
 */
@Composable
internal fun LibraryButton(titleKey: String, name: String, modifier: Modifier = Modifier, aliases: List<String> = emptyList()) {
    val saved by Repo.prefs.libraryFavorites.collectAsState()
    val inLibrary = titleKey in saved || aliases.any { it in saved }
    PillButton(
        if (inLibrary) "In Library" else "Add to Library",
        {
            val added = Repo.prefs.toggleLibraryFavorite(titleKey, aliases)
            Toasts.show(if (added) "$name added to your Library" else "$name removed from your Library")
        },
        modifier,
        icon = { Icon(if (inLibrary) Icons.Rounded.Check else Icons.Rounded.Add, null, tint = it, modifier = Modifier.size(20.dp)) },
    )
}

@Composable
private fun WatchProgress(progress: Float, modifier: Modifier = Modifier) {
    Box(modifier.height(3.dp).clip(RoundedCornerShape(50)).background(Palette.line)) {
        Box(Modifier.fillMaxHeight().fillMaxWidth(progress.coerceIn(0f, 1f)).background(Palette.accent))
    }
}

@Composable
private fun EpisodeRow(episode: Episode, recent: Recent?, compact: Boolean, modifier: Modifier, onClick: () -> Unit) {
    FocusBox(
        onClick = onClick,
        modifier = modifier.fillMaxWidth().height(if (compact) 84.dp else 104.dp),
        shape = RoundedCornerShape(12.dp),
        color = Palette.surface.copy(alpha = 0.93f),
        focusedColor = Palette.surface2,
        focusedScale = 1.015f,
    ) { focused ->
        Row(Modifier.fillMaxSize().padding(8.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.width(if (compact) 100.dp else 138.dp).fillMaxHeight().clip(RoundedCornerShape(7.dp)).background(Palette.cell)) {
                Icon(Icons.Rounded.PlayArrow, null, tint = Palette.dim, modifier = Modifier.align(Alignment.Center).size(28.dp))
                if (!episode.image.isNullOrBlank()) AsyncImage(episode.image, null, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
                Text(
                    "E${episode.number}", color = Color.White, fontSize = 10.sp, fontWeight = FontWeight.Bold,
                    modifier = Modifier.align(Alignment.TopStart).padding(5.dp).clip(RoundedCornerShape(4.dp)).background(Color.Black.copy(alpha = 0.65f)).padding(horizontal = 5.dp, vertical = 2.dp),
                )
                recent?.takeIf { it.durationMs > 0 }?.let {
                    WatchProgress(it.positionMs.toFloat() / it.durationMs, Modifier.align(Alignment.BottomCenter).fillMaxWidth())
                }
            }
            Column(Modifier.weight(1f).padding(start = if (compact) 10.dp else 14.dp, end = 8.dp)) {
                Text(episode.title, color = Palette.text, fontSize = if (compact) 13.sp else 15.sp, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                val status = if (recent != null && recent.positionMs > 0) {
                    "Resume at ${fmtClock(recent.positionMs)}" + if (recent.durationMs > recent.positionMs) " · ${fmtDuration(recent.durationMs - recent.positionMs)} left" else ""
                } else if (episode.durationSecs > 0) fmtDuration(episode.durationSecs * 1000L) else "Episode ${episode.number}"
                Text(status, color = if (recent != null) Palette.accent else Palette.dim, fontSize = 11.sp, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(top = 4.dp))
                if (!episode.plot.isNullOrBlank() && !compact) Text(episode.plot, color = Palette.dim, fontSize = 12.sp, lineHeight = 16.sp, maxLines = 2, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(top = 5.dp))
            }
            Icon(Icons.Rounded.PlayArrow, null, tint = if (focused) Palette.accent else Palette.faint, modifier = Modifier.size(if (compact) 20.dp else 24.dp))
        }
    }
}

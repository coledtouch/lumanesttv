package tv.lumanest.tuner.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.unit.dp
import tv.lumanest.tuner.data.Movie
import tv.lumanest.tuner.data.PlayRequest
import tv.lumanest.tuner.data.Repo
import tv.lumanest.tuner.data.Series
import tv.lumanest.tuner.player.PlayerHolder

sealed interface Screen {
    data object Home : Screen
    data class EditSource(val sourceId: String?) : Screen
    data class MovieDetail(val movie: Movie) : Screen
    data class SeriesDetail(val series: Series) : Screen
    data class Player(val request: PlayRequest) : Screen
}

enum class Tab(val title: String) { GUIDE("Live TV"), MOVIES("Movies"), SERIES("Series"), MULTIVIEW("Multi View"), SEARCH("Search"), SETTINGS("Settings") }

/** Screen-independent state that has to survive navigating to a detail page or the player and back. */
class AppState {
    val stack = mutableStateListOf<Screen>(Screen.Home)
    var tab by mutableStateOf(Tab.GUIDE)
    val guide = GuideState()
    val multiView = MultiViewUiState()
    val moviesList = LazyListState()
    val seriesList = LazyListState()
    private val rowStates = HashMap<String, LazyListState>()
    fun rowState(key: String): LazyListState = rowStates.getOrPut(key) { LazyListState() }
    fun clearRowStates() = rowStates.clear()
    var lastFocusedKey by mutableStateOf<String?>(null)
    var lastEpisodeKey by mutableStateOf<String?>(null)
    var searchQuery by mutableStateOf("")
    var searchFocusedKey by mutableStateOf<String?>(null)
    /** True when the current home tab should grab focus (app start, coming back from a detail page). */
    var restoreFocus by mutableStateOf(true)
    var navigationRequest by mutableIntStateOf(0)
        private set
    var navigationFocused by mutableStateOf(false)
    internal var handledNavigationRequest = 0
    fun requestNavigation() {
        restoreFocus = false
        navigationRequest++
    }

    val top: Screen get() = stack.last()
    fun push(s: Screen) { stack.add(s) }
    fun pop() {
        if (stack.size > 1) stack.removeAt(stack.lastIndex)
        restoreFocus = true
    }
    fun replaceAll(s: Screen) { stack.clear(); stack.add(s); restoreFocus = true }
}

@Composable
fun App() {
    val state = remember { AppState() }
    val sources by Repo.prefs.sources.collectAsState()
    val activeId by Repo.prefs.activeId.collectAsState()
    val pipVideoOnly by PlayerHolder.pipVideoOnly.collectAsState()

    // First run: go straight to the add-source form.
    LaunchedEffect(Unit) {
        if (sources.isEmpty()) state.replaceAll(Screen.EditSource(null))
        else Repo.load()
    }
    LaunchedEffect(activeId) { state.guide.reset(); state.multiView.reset() }

    BackHandler(enabled = state.stack.size > 1 && state.top !is Screen.Player) { state.pop() }

    Box(Modifier.fillMaxSize().background(Palette.bg).onPreviewKeyEvent { event ->
        val canOpenGuide = state.top == Screen.Home || state.top is Screen.MovieDetail || state.top is Screen.SeriesDetail
        if (!pipVideoOnly && canOpenGuide && event.nativeKeyEvent.keyCode == android.view.KeyEvent.KEYCODE_GUIDE) {
            if (event.type == KeyEventType.KeyDown && event.nativeKeyEvent.repeatCount == 0) {
                state.tab = Tab.GUIDE
                state.replaceAll(Screen.Home)
            }
            true
        } else false
    }) {
        when (val s = state.top) {
            Screen.Home -> HomeScreen(state)
            is Screen.EditSource -> key(s) {
                EditSourceScreen(
                    sourceId = s.sourceId,
                    canCancel = sources.isNotEmpty(),
                    onDone = {
                        if (state.stack.size > 1) state.pop() else state.replaceAll(Screen.Home)
                    },
                )
            }
            is Screen.MovieDetail -> key(s) { MovieDetailScreen(s.movie, state) }
            is Screen.SeriesDetail -> key(s) { SeriesDetailScreen(s.series, state) }
            is Screen.Player -> key(s) {
                PlayerScreen(s.request, onExit = { lastChannel ->
                    // Leaving live TV with guide preview on keeps the stream running in the preview window.
                    val returningToGuide = state.stack.getOrNull(state.stack.lastIndex - 1) == Screen.Home && state.tab == Tab.GUIDE
                    if (lastChannel == null || !Repo.prefs.guidePreview || !returningToGuide) PlayerHolder.stop()
                    lastChannel?.let { state.guide.focusChannel(it) }
                    state.pop()
                })
            }
        }
        if (!pipVideoOnly) ToastHost(Modifier.align(Alignment.BottomCenter).padding(bottom = 28.dp))
    }
}

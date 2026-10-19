package tv.lumanest.tuner.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.grid.LazyGridState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateMapOf
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
import tv.lumanest.tuner.data.VodType
import tv.lumanest.tuner.player.PlayerHolder

sealed interface Screen {
    data object Home : Screen
    data class EditSource(val sourceId: String?) : Screen
    data class MovieDetail(val movie: Movie) : Screen
    data class SeriesDetail(val series: Series) : Screen
    data class Player(val request: PlayRequest) : Screen
}

/**
 * The top navigation (docs/browse.md): Home, Live TV, Discover, Library, Search and Settings, with Multi View where it
 * has always been, after the movie and series sections.
 */
enum class Tab(val title: String) {
    HOME("Home"), GUIDE("Live TV"), DISCOVER("Discover"), LIBRARY("Library"), MULTIVIEW("Multi View"), SEARCH("Search"), SETTINGS("Settings"),
}

/** Discover's filters, grid position and selection, kept while a title or the player is open. */
class DiscoverState {
    var type by mutableStateOf(VodType.MOVIES)
    /** A [tv.lumanest.tuner.data.BrowseList] key, or null for the catalogue's default list. */
    var list by mutableStateOf<String?>(null)
    /** A [tv.lumanest.tuner.data.GenreOption] key, or null for All. */
    var genre by mutableStateOf<String?>(null)
    val grid = LazyGridState()
    /** The grid card or filter that had focus, restored when coming back from a title or the player. */
    var focusedKey by mutableStateOf<String?>(null)
    /** The grid position of the last focused card: focus returns there when its title leaves the grid. */
    var focusedIndex = 0
    /** The Home "See all" tile that opened Discover: Back returns to it. Null when Discover was opened from the top bar. */
    var openedFrom by mutableStateOf<String?>(null)
}

/**
 * Screen-independent state that has to survive navigating to a detail page or the player and back. [startTab] is the
 * section the app opens on (Home, or Live TV when Settings says so); Back from the top bar returns to it, and it
 * follows the Settings switch while the app runs.
 */
class AppState(startTab: Tab = Tab.GUIDE) {
    val stack = mutableStateListOf<Screen>(Screen.Home)
    var startTab by mutableStateOf(startTab)
    var tab by mutableStateOf(startTab)
    val guide = GuideState()
    val multiView = MultiViewUiState()
    val homeList = LazyListState()
    val libraryList = LazyListState()
    val discover = DiscoverState()
    private val rowStates = HashMap<String, LazyListState>()
    fun rowState(key: String): LazyListState = rowStates.getOrPut(key) { LazyListState() }
    fun clearRowStates() = rowStates.clear()
    /** The poster last focused on Home or Library ("home:<row>:<title>", "library:<row>:<title>"). */
    var lastFocusedKey by mutableStateOf<String?>(null)
    /** The poster last focused on each rows screen, by prefix ("home", "library"). */
    val rowFocus = mutableStateMapOf<String, String>()

    /** The Home "See all" tile (Continue watching's) that opened the Library: Back returns to it. */
    var libraryOpenedFrom by mutableStateOf<String?>(null)

    /** Opens the Library from Continue watching's See all tile [from]. */
    fun openLibrary(from: String?) {
        libraryOpenedFrom = from
        tab = Tab.LIBRARY
        restoreFocus = true
    }

    /** Back from a section a Home tile opened: Home, with focus on that tile ([from], a "home:" card key). */
    fun returnHome(from: String) {
        discover.openedFrom = null
        libraryOpenedFrom = null
        rowFocus["home"] = from
        lastFocusedKey = from
        tab = Tab.HOME
        restoreFocus = true
    }

    /** Opens Discover on [type] and [list] (Home's See all, Search's shortcuts). [from] is the tile to return to. */
    fun openDiscover(type: VodType, list: String? = null, from: String? = null) {
        discover.type = type
        discover.list = list
        discover.genre = null
        discover.focusedKey = null
        discover.focusedIndex = 0
        discover.openedFrom = from
        discover.grid.requestScrollToItem(0)
        tab = Tab.DISCOVER
        restoreFocus = true
    }
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
    val state = remember { AppState(if (Repo.prefs.startOnLiveTv.value) Tab.GUIDE else Tab.HOME) }
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

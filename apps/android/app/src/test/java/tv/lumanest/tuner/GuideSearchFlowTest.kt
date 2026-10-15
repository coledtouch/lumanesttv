package tv.lumanest.tuner

import android.view.KeyEvent as AndroidKeyEvent
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.snapshots.Snapshot
import androidx.compose.ui.ExperimentalComposeUiApi
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.InputMode
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.platform.LocalInputModeManager
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.assertIsFocused
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.hasAnyAncestor
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.isFocused
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performKeyInput
import androidx.compose.ui.test.performSemanticsAction
import androidx.compose.ui.test.pressKey
import tv.lumanest.tuner.data.Category
import tv.lumanest.tuner.data.Channel
import tv.lumanest.tuner.data.LoadStatus
import tv.lumanest.tuner.data.Movie
import tv.lumanest.tuner.data.PlayRequest
import tv.lumanest.tuner.data.Program
import tv.lumanest.tuner.data.Repo
import tv.lumanest.tuner.data.Source
import tv.lumanest.tuner.data.SourceType
import tv.lumanest.tuner.player.PlayerHolder
import tv.lumanest.tuner.ui.AppState
import tv.lumanest.tuner.ui.CAT_FAV
import tv.lumanest.tuner.ui.CAT_HOT
import tv.lumanest.tuner.ui.HomeScreen
import tv.lumanest.tuner.ui.Palette
import tv.lumanest.tuner.ui.Screen
import tv.lumanest.tuner.ui.Tab
import tv.lumanest.tuner.ui.Themes
import tv.lumanest.tuner.ui.Toasts
import tv.lumanest.tuner.ui.TunerTheme
import tv.lumanest.tuner.ui.floor30
import tv.lumanest.tuner.ui.isBrowsingFuture
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import org.robolectric.util.ReflectionHelpers

@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [34], qualifiers = "w960dp-h540dp-land-xhdpi")
@OptIn(ExperimentalTestApi::class)
class GuideSearchFlowTest {
    @get:Rule val rule = createAndroidComposeRule<androidx.activity.ComponentActivity>()
    private val source = "guide-search-flow"
    private lateinit var channels: List<Channel>

    @Before fun seed() {
        Repo.prefs.saveSource(Source(source, "Local UI fixture", SourceType.M3U, m3uUrl = "http://example.invalid/fixture.m3u"))
        Repo.prefs.setActive(source)
        Repo.prefs.favorites.value.toList().forEach { Repo.prefs.toggleFavorite(it) }
        Repo.prefs.lastChannelKey = null
        Repo.prefs.guidePreview = false
        Palette.theme = Themes.Midnight
        Toasts.message = null
        Repo.liveStatus.value = LoadStatus.Ready
        Repo.vodStatus.value = LoadStatus.Ready
        Repo.seriesStatus.value = LoadStatus.Ready
        channels = (0 until 12).map { index ->
            Channel("flow:$index", 100 + index, "News Channel $index", null, "news", "flow$index.us", null, "http://example.invalid/live/$index.ts")
        }
        Repo.channels.value = channels
        Repo.trending.value = emptyList()
        Repo.liveCategories.value = listOf(Category("news", "USA News"))
        Repo.movies.value = (0 until 8).map { index ->
            Movie("flow-m:$index", "Movie $index", null, "8.2", "movies", "http://example.invalid/movie/$index.mp4")
        }
        Repo.movieCategories.value = listOf(Category("movies", "Movies"))
        Repo.series.value = emptyList()
        Repo.seriesCategories.value = emptyList()
        val now = System.currentTimeMillis()
        Repo.putPrograms(channels.associate { channel ->
            channel.key to listOf(
                Program(now - 30 * 60_000, now + 30 * 60_000, "Current bulletin", "News and today's stories."),
                Program(now + 30 * 60_000, now + 90 * 60_000, "Next bulletin", "The next news hour."),
            )
        })
        rule.mainClock.autoAdvance = false
    }

    @Composable
    @OptIn(ExperimentalComposeUiApi::class)
    private fun Fixture(state: AppState) {
        val input = LocalInputModeManager.current
        SideEffect { input.requestInputMode(InputMode.Keyboard) }
        TunerTheme {
            Box(Modifier.fillMaxSize().background(Palette.bg)) {
                if (state.top == Screen.Home) HomeScreen(state) else Text("Opened destination")
            }
        }
    }

    private fun settle(ms: Long = 800) {
        rule.runOnIdle { Snapshot.sendApplyNotifications() }
        rule.mainClock.advanceTimeBy(ms)
        rule.waitForIdle()
        org.robolectric.shadows.ShadowLooper.idleMainLooper()
        rule.runOnIdle { Snapshot.sendApplyNotifications() }
        repeat(3) { rule.mainClock.advanceTimeByFrame() }
        rule.waitForIdle()
    }

    private fun movieTag(index: Int) = "search-hit:$source:movie:flow-m:$index"
    private fun channelTag(index: Int) = "search-hit:$source:channel:flow:$index"

    private fun awaitSearchResult(tag: String, focused: Boolean = false) {
        // Advancing Compose's virtual clock does not wait for Dispatchers.Default. Poll on
        // real time while delivering snapshots, posted Main work and the next Compose frame.
        rule.waitUntil(timeoutMillis = 5_000) {
            org.robolectric.shadows.ShadowLooper.idleMainLooper()
            rule.runOnIdle { Snapshot.sendApplyNotifications() }
            rule.mainClock.advanceTimeByFrame()
            val matcher = if (focused) hasTestTag(tag) and isFocused() else hasTestTag(tag)
            rule.onAllNodes(matcher).fetchSemanticsNodes().size == 1
        }
    }

    private fun awaitMovieDetail(state: AppState, id: String) {
        rule.waitUntil(timeoutMillis = 5_000) {
            org.robolectric.shadows.ShadowLooper.idleMainLooper()
            rule.runOnIdle { Snapshot.sendApplyNotifications() }
            rule.mainClock.advanceTimeByFrame()
            (state.top as? Screen.MovieDetail)?.movie?.id == id
        }
    }

    @Test fun searchReturnRestoresTheSelectedResultAndQuery() {
        val state = AppState().apply { tab = Tab.SEARCH; searchQuery = "Movie" }
        rule.setContent { Fixture(state) }
        settle()
        awaitSearchResult(movieTag(1))
        rule.onNodeWithTag(movieTag(1)).performSemanticsAction(SemanticsActions.RequestFocus) { it() }
        rule.onNodeWithTag(movieTag(1)).assertIsFocused()
        rule.onRoot().performKeyInput { pressKey(Key.Enter) }
        awaitMovieDetail(state, "flow-m:1")
        rule.runOnIdle { assertEquals("flow-m:1", (state.top as Screen.MovieDetail).movie.id); state.pop() }
        settle()
        awaitSearchResult(movieTag(1), focused = true)
        rule.onNodeWithTag(movieTag(1)).assertIsFocused()
        rule.runOnIdle { assertEquals("Movie", state.searchQuery); assertFalse(state.restoreFocus) }
    }

    @Test fun newerSearchResultFocusCancelsPendingFieldRestoreDuringOkPress() {
        val state = AppState().apply { tab = Tab.SEARCH; searchQuery = "Movie"; restoreFocus = false }
        rule.setContent { Fixture(state) }
        settle()
        awaitSearchResult(movieTag(1))
        // Start a field restoration, but keep its attachment frame pending. A new remote
        // selection must take precedence even if its OK press spans that next frame.
        rule.runOnIdle { state.searchFocusedKey = null; state.restoreFocus = true }
        rule.mainClock.advanceTimeByFrame()
        rule.waitForIdle()
        rule.runOnIdle { assertTrue("The delayed field restoration must still be pending", state.restoreFocus) }
        rule.onNodeWithTag(movieTag(1)).performSemanticsAction(SemanticsActions.RequestFocus) { it() }
        rule.onNodeWithTag(movieTag(1)).assertIsFocused()
        rule.onRoot().performKeyInput { keyDown(Key.Enter) }
        rule.mainClock.advanceTimeByFrame()
        rule.waitForIdle()
        rule.onNodeWithTag(movieTag(1)).assertIsFocused()
        rule.onRoot().performKeyInput { keyUp(Key.Enter) }
        awaitMovieDetail(state, "flow-m:1")
        rule.runOnIdle {
            assertEquals("flow-m:1", (state.top as Screen.MovieDetail).movie.id)
            assertEquals(movieTag(1).removePrefix("search-hit:"), state.searchFocusedKey)
        }
    }

    @Test fun searchFavoriteIsASeparateFocusTargetAndDoesNotStartPlayback() {
        val state = AppState().apply { tab = Tab.SEARCH; searchQuery = "100" }
        rule.setContent { Fixture(state) }
        settle()
        awaitSearchResult(channelTag(0))
        rule.onNodeWithTag(channelTag(0)).performSemanticsAction(SemanticsActions.RequestFocus) { it() }
        rule.onRoot().performKeyInput { pressKey(Key.DirectionRight) }
        rule.onNodeWithContentDescription("Add News Channel 0 to Favorites").assertIsFocused()
        rule.onRoot().performKeyInput { pressKey(Key.Enter) }
        settle(200)
        rule.onNodeWithContentDescription("Remove News Channel 0 from Favorites").assertIsFocused()
        rule.runOnIdle { assertTrue(channels[0].key in Repo.prefs.favorites.value); assertEquals(Screen.Home, state.top) }
        rule.onRoot().performKeyInput { pressKey(Key.Enter) }
        settle(200)
        rule.runOnIdle { assertFalse(channels[0].key in Repo.prefs.favorites.value); assertEquals(Screen.Home, state.top) }
    }

    @Test fun holdingASearchLiveResultSavesItWithoutOpeningPlayback() {
        val state = AppState().apply { tab = Tab.SEARCH; searchQuery = "100" }
        rule.setContent { Fixture(state) }
        settle()
        awaitSearchResult(channelTag(0))
        rule.onNodeWithTag(channelTag(0)).performSemanticsAction(SemanticsActions.RequestFocus) { it() }
        rule.onNodeWithTag(channelTag(0)).performSemanticsAction(SemanticsActions.OnLongClick) { it() }
        settle(200)
        rule.runOnIdle { assertTrue(channels[0].key in Repo.prefs.favorites.value); assertEquals(Screen.Home, state.top) }
        rule.onNodeWithTag(channelTag(0)).assertIsFocused()
    }

    @Test fun searchFindsExtraTrendingChannelsAndIncludesThemInThePlayerLineup() {
        val event = channels[0].copy(key = "event:1", number = 500, name = "Featured Event", url = "http://example.invalid/live/event.ts")
        Repo.trending.value = listOf(event)
        val state = AppState().apply { tab = Tab.SEARCH; searchQuery = "Featured" }
        rule.setContent { Fixture(state) }
        settle()
        awaitSearchResult("search-hit:$source:channel:event:1")
        rule.onNodeWithTag("search-hit:$source:channel:event:1").performClick()
        settle(200)
        rule.runOnIdle {
            val request = (state.top as Screen.Player).request as PlayRequest.Live
            assertEquals(event.key, request.channel.key)
            assertTrue(request.lineup.any { it.key == event.key })
        }
    }

    @Test fun aChannelNumberTakesPriorityOverNameMatchesAndAcceptsLeadingZeroes() {
        val exact = channels[1].copy(number = 1, name = "Exact station")
        Repo.channels.value = (0 until 50).map { index ->
            channels[0].copy(key = "mention:$index", number = 200 + index, name = "001 event $index")
        } + exact
        val state = AppState().apply { tab = Tab.SEARCH; searchQuery = "001" }
        rule.setContent { Fixture(state) }
        settle()
        awaitSearchResult(channelTag(1))
        rule.onNodeWithTag(channelTag(1)).assertExists()
        rule.onNodeWithTag(channelTag(1)).performClick()
        settle(200)
        rule.runOnIdle { assertEquals(exact.key, ((state.top as Screen.Player).request as PlayRequest.Live).channel.key) }
    }

    @Test fun refreshingGuideMetadataKeepsSearchResultFocus() {
        val state = AppState().apply { tab = Tab.SEARCH; searchQuery = "100" }
        rule.setContent { Fixture(state) }
        settle()
        awaitSearchResult(channelTag(0))
        rule.onNodeWithTag(channelTag(0)).performSemanticsAction(SemanticsActions.RequestFocus) { it() }
        val now = System.currentTimeMillis()
        rule.runOnIdle { Repo.putPrograms(mapOf(channels[0].key to listOf(Program(now - 60_000, now + 60_000, "Updated bulletin")))) }
        settle(100)
        rule.onNodeWithTag(channelTag(0)).assertIsFocused()
        settle()
        rule.onNodeWithTag(channelTag(0)).assertIsFocused()
        // Search computes off the UI thread. Wait for its result to reach a Compose frame,
        // rather than assuming that advancing the virtual clock also completes that worker.
        rule.waitUntil(timeoutMillis = 5_000) {
            org.robolectric.shadows.ShadowLooper.idleMainLooper()
            rule.runOnIdle { Snapshot.sendApplyNotifications() }
            rule.mainClock.advanceTimeByFrame()
            rule.onAllNodesWithText("Channel 100  ·  Updated bulletin").fetchSemanticsNodes().size == 1
        }
        rule.onNodeWithText("Channel 100  ·  Updated bulletin").assertExists()
    }

    @Test fun backFromResultsReturnsToSearchInput() {
        val state = AppState().apply { tab = Tab.SEARCH; searchQuery = "Movie" }
        rule.setContent { Fixture(state) }
        settle()
        awaitSearchResult(movieTag(1))
        rule.onNodeWithTag(movieTag(1)).performSemanticsAction(SemanticsActions.RequestFocus) { it() }
        settle(100)
        rule.runOnIdle { rule.activity.onBackPressedDispatcher.onBackPressed() }
        settle(300)
        rule.onNodeWithText("Movie").assertIsFocused()
        rule.runOnIdle { assertEquals(Tab.SEARCH, state.tab); assertEquals(null, state.searchFocusedKey) }
    }

    @Test fun removingAnEarlierFavoriteKeepsTheSelectedChannel() {
        channels.take(5).forEach { Repo.prefs.toggleFavorite(it.key) }
        val state = AppState().apply { guide.category = CAT_FAV; guide.row = 3; guide.initialized = true }
        rule.setContent { Fixture(state) }
        settle()
        rule.runOnIdle { assertEquals(channels[3].key, state.guide.selectedChannelKey); Repo.prefs.toggleFavorite(channels[0].key) }
        settle(300)
        rule.runOnIdle { assertEquals(2, state.guide.row); assertEquals(channels[3].key, state.guide.selectedChannelKey) }
        rule.onNodeWithTag("guide-grid").assertIsFocused()
    }

    @Test fun channelRefreshRestoresSelectionByKeyAcrossAnEmptyList() {
        val state = AppState().apply { guide.row = 4; guide.initialized = true }
        rule.setContent { Fixture(state) }
        settle()
        rule.runOnIdle { assertEquals(channels[4].key, state.guide.selectedChannelKey); Repo.channels.value = emptyList() }
        settle(200)
        rule.runOnIdle { Repo.channels.value = channels.reversed() }
        settle()
        rule.runOnIdle { assertEquals(channels[4].key, state.guide.selectedChannelKey); assertEquals(7, state.guide.row) }
    }

    @Test fun pendingChannelSelectionIsObservedWithoutAnotherStateChange() {
        val state = AppState().apply { guide.initialized = true }
        rule.setContent { Fixture(state) }
        settle()
        rule.runOnIdle { state.guide.pendingChannelKey = channels[7].key }
        settle(500)
        rule.runOnIdle { assertEquals(7, state.guide.row); assertEquals(channels[7].key, state.guide.selectedChannelKey); assertEquals(null, state.guide.pendingChannelKey) }
    }

    @Test fun personallyWatchedPendingChannelRestoresWithoutAProviderTrendingFeed() {
        Repo.prefs.recordWatched(channels[7].key, 10)
        val state = AppState().apply { guide.initialized = true; guide.category = CAT_HOT; guide.pendingChannelKey = channels[7].key }
        rule.setContent { Fixture(state) }
        settle()
        rule.runOnIdle {
            assertTrue(Repo.trending.value.isEmpty())
            assertEquals(CAT_HOT, state.guide.category)
            assertEquals(channels[7].key, state.guide.selectedChannelKey)
            assertEquals(null, state.guide.pendingChannelKey)
            Repo.prefs.recordWatched(channels[3].key, 20)
            Repo.prefs.recordWatched(channels[3].key, 30)
            state.guide.pendingChannelKey = channels[7].key
        }
        settle()
        rule.runOnIdle {
            assertEquals(CAT_HOT, state.guide.category)
            assertEquals(channels[7].key, state.guide.selectedChannelKey)
            assertEquals(1, state.guide.row)
            assertEquals(null, state.guide.pendingChannelKey)
        }
        rule.onNodeWithTag("guide-grid").assertIsFocused()
    }

    @Test fun pendingProviderPickDoesNotRedirectToAPersonalListThatCannotDisplayIt() {
        Repo.prefs.recordWatched(channels[7].key, 10)
        val providerOnly = channels[0].copy(key = "provider-only", name = "Provider event")
        Repo.trending.value = listOf(providerOnly)
        val state = AppState().apply { guide.initialized = true; guide.category = "news" }
        rule.setContent { Fixture(state) }
        settle()
        rule.runOnIdle { state.guide.pendingChannelKey = providerOnly.key }
        settle()
        rule.runOnIdle {
            assertEquals("news", state.guide.category)
            assertEquals(channels[0].key, state.guide.selectedChannelKey)
            assertEquals(null, state.guide.pendingChannelKey)
        }
        rule.onNodeWithTag("guide-grid").assertIsFocused()
    }

    @Test fun browsingGuideKeepsTheWatchedStreamAndPreviewOpensThatChannel() {
        val watched = channels[0].copy(backups = listOf("http://example.invalid/live/watched-backup.ts"))
        Repo.channels.value = listOf(watched) + channels.drop(1)
        Repo.prefs.lastChannelKey = watched.key
        channels.slice(2..3).forEach { Repo.prefs.toggleFavorite(it.key) }
        // Keep video rendering off in this local fixture; the session tests also cover preview on.
        ReflectionHelpers.setStaticField(PlayerHolder::class.java, "currentUrl", watched.backups[0])
        ReflectionHelpers.setStaticField(PlayerHolder::class.java, "isLive", true)
        try {
            val state = AppState().apply { guide.initialized = true; guide.category = CAT_FAV }
            rule.setContent { Fixture(state) }
            settle()
            rule.onNodeWithText("Watching  ${watched.number}  ${watched.name}").assertExists()
            rule.onRoot().performKeyInput { pressKey(Key.DirectionDown); pressKey(Key.DirectionRight) }
            settle(1_600)
            rule.onNode(hasText("Next bulletin") and hasAnyAncestor(hasTestTag("guide-program-info"))).assertExists()
            rule.onNodeWithText("Watching  ${watched.number}  ${watched.name}").assertExists()
            rule.runOnIdle {
                assertEquals(channels[3].key, state.guide.selectedChannelKey)
                assertEquals(watched.backups[0], PlayerHolder.currentUrl)
                assertEquals(watched.key, Repo.prefs.lastChannelKey)
                assertEquals(Screen.Home, state.top)
            }
            rule.onNodeWithTag("guide-preview").performClick()
            settle(300)
            rule.runOnIdle {
                val request = (state.top as Screen.Player).request as PlayRequest.Live
                assertEquals(watched.key, request.channel.key)
                assertTrue(request.lineup.any { it.key == watched.key })
                assertEquals(watched.backups[0], PlayerHolder.currentUrl)
            }
        } finally {
            ReflectionHelpers.setStaticField(PlayerHolder::class.java, "currentUrl", null)
            ReflectionHelpers.setStaticField(PlayerHolder::class.java, "isLive", false)
        }
    }

    @Test fun backAfterReturningToTheCurrentHalfHourRequestsNavigation() {
        val state = AppState().apply {
            guide.initialized = true
            guide.row = 6
            guide.windowStart = floor30(System.currentTimeMillis()) + 2 * 3600_000L
            guide.focusTime = guide.windowStart
        }
        rule.setContent { Fixture(state) }
        settle()
        rule.runOnIdle { rule.activity.onBackPressedDispatcher.onBackPressed() }
        settle(200)
        rule.onNodeWithTag("guide-grid").assertIsFocused()
        var navigationRequestsBefore = 0
        rule.runOnIdle {
            assertFalse(state.guide.isBrowsingFuture(System.currentTimeMillis()))
            // Current-program selection can use an absolute timestamp rather than the 0 sentinel.
            state.guide.focusTime = System.currentTimeMillis()
            navigationRequestsBefore = state.navigationRequest
        }
        settle(100)
        rule.runOnIdle { rule.activity.onBackPressedDispatcher.onBackPressed() }
        settle(300)
        rule.runOnIdle {
            assertEquals(6, state.guide.row)
            assertEquals(navigationRequestsBefore + 1, state.navigationRequest)
        }
    }

    @Test fun futureProgramDetailsCanSaveAChannelWithoutTuningIt() {
        val state = AppState().apply { guide.initialized = true }
        rule.setContent { Fixture(state) }
        settle()
        rule.onRoot().performKeyInput { pressKey(Key.DirectionRight); pressKey(Key.Enter) }
        settle(300)
        rule.onNodeWithText("Add to Favorites").performClick()
        settle(200)
        rule.onNodeWithText("Saved in Favorites").assertExists()
        rule.runOnIdle { assertTrue(channels[0].key in Repo.prefs.favorites.value); assertEquals(Screen.Home, state.top) }
        rule.onNodeWithText("Close").performClick()
        settle(300)
        rule.onNodeWithTag("guide-grid").assertIsFocused()
    }

    @Test fun aShortOkWithZeroNativeDownTimeOpensFutureDetailsInsteadOfFavoriting() {
        val state = AppState().apply { guide.initialized = true }
        rule.setContent { Fixture(state) }
        settle()
        rule.onRoot().performKeyInput { pressKey(Key.DirectionRight) }
        settle(100)
        rule.runOnIdle {
            rule.activity.dispatchKeyEvent(AndroidKeyEvent(0L, 10_000L, AndroidKeyEvent.ACTION_DOWN, AndroidKeyEvent.KEYCODE_DPAD_CENTER, 0))
            rule.activity.dispatchKeyEvent(AndroidKeyEvent(0L, 10_050L, AndroidKeyEvent.ACTION_UP, AndroidKeyEvent.KEYCODE_DPAD_CENTER, 0))
        }
        settle(300)
        rule.onNodeWithText("Watch channel now").assertExists()
        rule.runOnIdle { assertFalse(channels[0].key in Repo.prefs.favorites.value); assertEquals(Screen.Home, state.top) }
    }

    @Test fun holdingOkWithoutRepeatsAndWithZeroNativeDownTimeFavoritesWithoutTuning() {
        val state = AppState().apply { guide.initialized = true }
        rule.setContent { Fixture(state) }
        settle()
        rule.runOnIdle {
            rule.activity.dispatchKeyEvent(AndroidKeyEvent(0L, 20_000L, AndroidKeyEvent.ACTION_DOWN, AndroidKeyEvent.KEYCODE_DPAD_CENTER, 0))
            rule.activity.dispatchKeyEvent(AndroidKeyEvent(0L, 20_700L, AndroidKeyEvent.ACTION_UP, AndroidKeyEvent.KEYCODE_DPAD_CENTER, 0))
        }
        settle(200)
        rule.runOnIdle { assertTrue(channels[0].key in Repo.prefs.favorites.value); assertEquals(Screen.Home, state.top) }
        rule.onNodeWithTag("guide-grid").assertIsFocused()
    }
}

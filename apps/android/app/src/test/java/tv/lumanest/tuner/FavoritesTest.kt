package tv.lumanest.tuner

import tv.lumanest.tuner.data.Prefs
import tv.lumanest.tuner.data.Source
import tv.lumanest.tuner.data.SourceType
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class FavoritesTest {
    private lateinit var prefs: Prefs
    @Before fun setup() {
        val context = RuntimeEnvironment.getApplication()
        context.getSharedPreferences("tuner", 0).edit().clear().commit()
        prefs = Prefs(context)
        prefs.saveSource(Source("a", "A", SourceType.M3U))
        prefs.saveSource(Source("b", "B", SourceType.M3U))
        prefs.setActive("a")
    }
    @Test fun favoriteActionsShareImmediateStateAndPersistAcrossRestarts() {
        assertTrue(prefs.toggleFavorite("cnn"))
        assertEquals(setOf("cnn"), prefs.favorites.value)
        val reopened = Prefs(RuntimeEnvironment.getApplication())
        assertEquals(setOf("cnn"), reopened.favorites.value)
        assertFalse(prefs.toggleFavorite("cnn"))
        assertTrue(prefs.favorites.value.isEmpty())
        assertTrue(Prefs(RuntimeEnvironment.getApplication()).favorites.value.isEmpty())
    }
    @Test fun eachPlaylistKeepsItsOwnFavorites() {
        prefs.toggleFavorite("cnn")
        prefs.setActive("b")
        assertTrue(prefs.favorites.value.isEmpty())
        prefs.toggleFavorite("nbc")
        prefs.setActive("a")
        assertEquals(setOf("cnn"), prefs.favorites.value)
        prefs.setActive("b")
        assertEquals(setOf("nbc"), prefs.favorites.value)
    }
    @Test fun duplicateMergeKeepsFavoritesAndLastChannelOnSurvivingFeed() {
        prefs.toggleFavorite("backup")
        prefs.toggleFavorite("main")
        prefs.lastChannelKey = "backup"
        prefs.remapChannelKeys(mapOf("backup" to "main"))
        assertEquals(setOf("main"), prefs.favorites.value)
        assertEquals("main", prefs.lastChannelKey)
        assertEquals(setOf("main"), Prefs(RuntimeEnvironment.getApplication()).favorites.value)
    }
}

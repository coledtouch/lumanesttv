package tv.lumanest.tuner

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import tv.lumanest.tuner.data.Prefs
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.json.JSONObject

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class MostWatchedPrefsTest {
    private lateinit var context: Context
    private lateinit var prefs: Prefs

    @Before fun setup() {
        context = ApplicationProvider.getApplicationContext()
        context.getSharedPreferences("tuner", Context.MODE_PRIVATE).edit().clear().commit()
        prefs = Prefs(context)
        prefs.setActive("source-a")
    }

    @Test fun tuneCountWinsAndLatestUseBreaksTiesAfterRestart() {
        prefs.recordWatched("news", 10)
        prefs.recordWatched("sports", 20)
        assertEquals(listOf("sports", "news"), prefs.watchedChannelKeys.value)
        prefs.recordWatched("news", 5)
        assertEquals(listOf("news", "sports"), prefs.watchedChannelKeys.value)
        val restored = Prefs(context)
        assertEquals(prefs.watchHistory.value, restored.watchHistory.value)
        assertEquals(prefs.watchedChannelKeys.value, restored.watchedChannelKeys.value)
        assertEquals(Prefs.ChannelWatch(2, 10), restored.watchHistory.value["news"])
    }

    @Test fun switchingSourcesPublishesTheirOwnHistoryEvenWhenProviderKeysCollide() {
        prefs.recordWatched("live:1", 10)
        prefs.setActive("source-b")
        assertTrue(prefs.watchHistory.value.isEmpty())
        assertTrue(prefs.watchedChannelKeys.value.isEmpty())
        prefs.recordWatched("live:1", 30)
        prefs.recordWatched("live:1", 40)
        prefs.setActive("source-a")
        assertEquals(Prefs.ChannelWatch(1, 10), prefs.watchHistory.value["live:1"])
        prefs.setActive("source-b")
        assertEquals(Prefs.ChannelWatch(2, 40), prefs.watchHistory.value["live:1"])
    }

    @Test fun duplicateFoldingMergesCountsAndLateOldKeysAfterReload() {
        prefs.recordWatched("copy", 10)
        prefs.recordWatched("canonical", 20)
        prefs.recordWatched("copy", 30)
        prefs.toggleFavorite("copy")
        prefs.lastChannelKey = "copy"
        prefs.remapChannelKeys(mapOf("copy" to "canonical"))
        assertEquals(mapOf("canonical" to Prefs.ChannelWatch(3, 30)), prefs.watchHistory.value)
        assertEquals(setOf("canonical"), prefs.favorites.value)
        assertEquals("canonical", prefs.lastChannelKey)
        val restored = Prefs(context)
        restored.recordWatched("copy", 40)
        assertEquals(mapOf("canonical" to Prefs.ChannelWatch(4, 40)), restored.watchHistory.value)
    }

    @Test fun favoriteActionsFromAnOlderChannelCopyToggleTheCurrentChannelAfterRestart() {
        prefs.toggleFavorite("copy")
        prefs.remapChannelKeys(mapOf("copy" to "canonical"))
        val restored = Prefs(context)
        assertFalse(restored.toggleFavorite("copy"))
        assertTrue(restored.favorites.value.isEmpty())
        assertTrue(restored.toggleFavorite("copy"))
        assertEquals(setOf("canonical"), restored.favorites.value)
        assertFalse(restored.toggleFavorite("canonical"))
        assertTrue(Prefs(context).favorites.value.isEmpty())
    }

    @Test fun canonicalCopyCanChangeAgainWithoutAnAliasCycle() {
        prefs.recordWatched("a", 10)
        prefs.remapChannelKeys(mapOf("a" to "b"))
        prefs.remapChannelKeys(mapOf("b" to "a"))
        prefs.recordWatched("b", 20)
        assertEquals(mapOf("a" to Prefs.ChannelWatch(2, 20)), prefs.watchHistory.value)
        assertEquals(listOf("a"), Prefs(context).watchedChannelKeys.value)
    }

    @Test fun repeatedLargeSnapshotRemapKeepsHistoryAndNormalizesLateSavedKeys() {
        val merged = (0 until 1_700).associate { "copy:$it" to "main:$it" }
        prefs.remapChannelKeys(merged)
        val restored = Prefs(context)
        restored.recordWatched("copy:23", 10)
        restored.recordWatched("main:23", 20)
        restored.toggleFavorite("copy:23")
        restored.lastChannelKey = "copy:23"
        val history = restored.watchHistory.value
        val ranking = restored.watchedChannelKeys.value
        val saved = context.getSharedPreferences("tuner", Context.MODE_PRIVATE)
        val aliases = saved.getString("watchAliases_source-a", null)
        repeat(3) { restored.remapChannelKeys(merged) }
        assertEquals(setOf("main:23"), restored.favorites.value)
        assertEquals("main:23", restored.lastChannelKey)
        assertEquals(mapOf("main:23" to Prefs.ChannelWatch(2, 20)), restored.watchHistory.value)
        assertSame(history, restored.watchHistory.value)
        assertSame(ranking, restored.watchedChannelKeys.value)
        assertEquals(aliases, saved.getString("watchAliases_source-a", null))
        restored.setActive("source-b")
        restored.remapChannelKeys(mapOf("copy:23" to "different:23"))
        restored.recordWatched("copy:23", 30)
        restored.setActive("source-a")
        restored.remapChannelKeys(merged)
        restored.recordWatched("copy:23", 40)
        assertEquals(mapOf("main:23" to Prefs.ChannelWatch(3, 40)), restored.watchHistory.value)
        assertEquals(setOf("main:23"), restored.favorites.value)
    }

    @Test fun matchingSnapshotStillFlattensPreexistingIndirectAliases() {
        val saved = context.getSharedPreferences("tuner", Context.MODE_PRIVATE)
        saved.edit()
            .putString("watchAliases_source-a", """{"copy":"canonical","old":"middle","middle":"current"}""")
            .putStringSet("fav_source-a", setOf("old"))
            .putString("lastChannel_source-a", "middle")
            .putString("watched_source-a", """{"old":{"count":2,"updated":10},"middle":{"count":3,"updated":20}}""")
            .commit()
        val restored = Prefs(context)
        restored.remapChannelKeys(mapOf("copy" to "canonical"))
        val aliases = JSONObject(saved.getString("watchAliases_source-a", "{}"))
        assertEquals("current", aliases.getString("old"))
        assertEquals("current", aliases.getString("middle"))
        assertEquals(setOf("current"), restored.favorites.value)
        assertEquals("current", restored.lastChannelKey)
        assertEquals(mapOf("current" to Prefs.ChannelWatch(5, 20)), restored.watchHistory.value)
        restored.remapChannelKeys(mapOf("current" to "old"))
        restored.recordWatched("middle", 30)
        assertEquals(mapOf("old" to Prefs.ChannelWatch(6, 30)), restored.watchHistory.value)
    }

    @Test fun oldSourceRemapCannotAlterTheCurrentlySelectedSource() {
        prefs.setActive("source-b")
        prefs.toggleFavorite("copy")
        prefs.lastChannelKey = "copy"
        prefs.recordWatched("copy", 10)
        prefs.remapChannelKeys(mapOf("copy" to "canonical-a"), expectedSourceId = "source-a")
        assertEquals(setOf("copy"), prefs.favorites.value)
        assertEquals("copy", prefs.lastChannelKey)
        assertEquals(mapOf("copy" to Prefs.ChannelWatch(1, 10)), prefs.watchHistory.value)
        assertNull(context.getSharedPreferences("tuner", Context.MODE_PRIVATE).getString("watchAliases_source-b", null))
        prefs.remapChannelKeys(mapOf("copy" to "canonical-b"), expectedSourceId = "source-b")
        assertEquals(setOf("canonical-b"), prefs.favorites.value)
        assertEquals("canonical-b", prefs.lastChannelKey)
        assertEquals(mapOf("canonical-b" to Prefs.ChannelWatch(1, 10)), prefs.watchHistory.value)
    }

    @Test fun corruptEntriesDoNotDiscardGoodHistoryAndCountersCannotOverflow() {
        context.getSharedPreferences("tuner", Context.MODE_PRIVATE).edit().putString("watched_source-a",
            """{"good":{"count":9223372036854775807,"updated":10},"bad":4,"negative":{"count":-1}}""").commit()
        val restored = Prefs(context)
        restored.recordWatched("good", 20)
        assertEquals(mapOf("good" to Prefs.ChannelWatch(Long.MAX_VALUE, 20)), restored.watchHistory.value)
        restored.setActive(null)
        restored.recordWatched("ignored", 30)
        assertTrue(restored.watchHistory.value.isEmpty())
    }
}

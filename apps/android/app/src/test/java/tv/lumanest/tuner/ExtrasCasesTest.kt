package tv.lumanest.tuner

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test
import tv.lumanest.tuner.data.Category
import tv.lumanest.tuner.data.Channel
import tv.lumanest.tuner.data.HiddenLiveCategory
import tv.lumanest.tuner.data.MiniJson
import java.io.File

/**
 * Runs the cases of docs/extras-cases.json that apply to Android (docs/extras.md, "Test cases": `live_category`),
 * read from the repository, never copied, and checks how the hidden category leaves a provider's lineup.
 */
class ExtrasCasesTest {
    private val cases: List<Map<*, *>> by lazy {
        (MiniJson.parse(casesFile().readText(Charsets.UTF_8)) as List<*>).map { it as Map<*, *> }
    }

    @Test fun everyCaseHasAKnownKind() {
        assertEquals(setOf("srt_vtt", "cue_text", "vtt_cues", "subtitle_pick", "trailer", "live_category"), cases.map { it["kind"] }.toSet())
    }

    @Test fun liveCategoryCases() {
        val live = cases.filter { it["kind"] == "live_category" }
        assertTrue("No live_category cases in ${casesFile()}", live.size >= 30)
        val failures = live.mapNotNull { case ->
            val name = case["name"] as String
            val expected = case["hidden"] as Boolean
            val actual = HiddenLiveCategory.isHidden(name)
            if (actual == expected) null else "\"${shown(name)}\": hidden $actual, expected $expected"
        }
        assertTrue(failures.joinToString("\n", "live_category cases that fail:\n"), failures.isEmpty())
        // Both answers are covered, so a rule that always answers one way fails.
        assertTrue(live.any { it["hidden"] == true } && live.any { it["hidden"] == false })
    }

    @Test fun theRuleDropsOneTagAtEachEndAndNeverMatchesInsideWords() {
        assertTrue(HiddenLiveCategory.isHidden("USA | Most Watched Now | EN"))
        assertFalse(HiddenLiveCategory.isHidden("US USA Most Watched Now"))
        assertFalse(HiddenLiveCategory.isHidden("Most Watched Now Now"))
        assertFalse(HiddenLiveCategory.isHidden("Most Watched Now Movies Sports And More"))
        assertFalse(HiddenLiveCategory.isHidden("Most watched new"))
        // A letter beyond ASCII (here W with a circumflex) separates words; it is never folded into a match.
        assertFalse(HiddenLiveCategory.isHidden("MOST WATCHED NOW".replace('W', 0x0174.toChar())))
    }

    private val hidden = Category("7", "|USA| MOST WATCHED NOW")
    private val news = Category("1", "US News")
    private val sports = Category("2", "US Sports")
    private fun channel(key: String, vararg categories: String) =
        Channel(key, 1, key, null, categories.firstOrNull() ?: "", null, null, "https://example.invalid/$key.ts", categoryIds = categories.toList())

    @Test fun theHiddenCategoryLeavesTheLineupAndItsOnlyCopiesGo() {
        val onlyHidden = channel("x:1", "7")
        val firstHidden = channel("x:2", "7", "1")
        val elsewhere = channel("x:3", "2")
        val none = channel("x:4")
        val shown = HiddenLiveCategory.filter(listOf(onlyHidden, firstHidden, elsewhere, none), listOf(hidden, news, sports))
        assertEquals(listOf(news, sports), shown.categories)
        assertEquals(listOf("x:2", "x:3", "x:4"), shown.channels.map { it.key })
        val kept = shown.channels.first()
        assertEquals("1", kept.categoryId)
        assertEquals(listOf("1"), kept.categoryIds)
        // Channels outside the hidden category, and a channel with no category, are passed on as they are.
        assertSame(elsewhere, shown.channels[1])
        assertSame(none, shown.channels[2])
    }

    @Test fun withoutAHiddenCategoryTheSameListsComeBack() {
        val channels = listOf(channel("x:1", "1"), channel("x:2", "2"))
        val categories = listOf(news, sports, Category("3", "Most Watched Movies"))
        val shown = HiddenLiveCategory.filter(channels, categories)
        assertSame(channels, shown.channels)
        assertSame(categories, shown.categories)
    }

    /** [text] with its control characters and every character beyond ASCII as `\uXXXX`, for a failure message. */
    private fun shown(text: String): String = buildString {
        for (c in text) if (c.code < 0x20 || c.code > 0x7E) append("\\u%04x".format(c.code)) else append(c)
    }

    companion object {
        /** docs/extras-cases.json at the repository root, found as [BrowseCasesTest.casesFile] finds its file. */
        fun casesFile(): File {
            val dir = File(System.getProperty("user.dir") ?: ".").absoluteFile
            return listOf("../../../docs/extras-cases.json", "../../docs/extras-cases.json")
                .map { File(dir, it).canonicalFile }
                .firstOrNull { it.isFile }
                ?: error("docs/extras-cases.json not found from $dir")
        }
    }
}

package tv.lumanest.tuner

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import tv.lumanest.tuner.data.BrowseCatalog
import tv.lumanest.tuner.data.BrowseList
import tv.lumanest.tuner.data.CatalogRows
import tv.lumanest.tuner.data.Category
import tv.lumanest.tuner.data.MiniJson
import tv.lumanest.tuner.data.Movie
import tv.lumanest.tuner.data.Series
import tv.lumanest.tuner.data.TitleMatch
import tv.lumanest.tuner.data.VodRegion
import tv.lumanest.tuner.data.VodType
import java.io.File

/**
 * Runs every case in docs/browse-cases.json, the file all Tuner apps share (docs/browse.md, "Test cases"), through this
 * app: the category filter, title normalization with the year read from the name, and "Movies & Series: USA only" for a
 * whole catalogue title built into a [BrowseCatalog]. The file is read from the repository, never copied. The "tmdb"
 * cases need the Android framework's JSON reader, so ParserTest runs them under Robolectric.
 */
class BrowseCasesTest {
    private val cases: List<Map<*, *>> by lazy {
        val parsed = MiniJson.parse(casesFile().readText(Charsets.UTF_8)) as List<*>
        parsed.map { it as Map<*, *> }
    }

    private fun kind(kind: String) = cases.filter { it["kind"] == kind }.also { assertTrue("No $kind cases in ${casesFile()}", it.isNotEmpty()) }

    @Test fun everyCaseHasAKnownKind() {
        val kinds = cases.map { it["kind"] }.toSet()
        assertEquals(setOf("category", "normalize", "usa", "tmdb"), kinds)
    }

    @Test fun categoryCases() {
        val failures = kind("category").mapNotNull { case ->
            val name = case["name"] as String
            val expected = case["foreign"] as Boolean
            val actual = VodRegion.isForeignCategory(name)
            if (actual == expected) null else "\"$name\": foreign $actual, expected $expected"
        }
        assertTrue(failures.joinToString("\n", "Category cases that fail:\n"), failures.isEmpty())
    }

    @Test fun normalizeCases() {
        val failures = kind("normalize").mapNotNull { case ->
            val input = case["input"] as String
            val title = TitleMatch.normalize(input)
            val year = TitleMatch.yearInTitle(input).let { if (it == 0) "" else it.toString() }
            if (title == case["title"] && year == case["year"]) null
            else "\"$input\": \"$title\" ($year), expected \"${case["title"]}\" (${case["year"]})"
        }
        assertTrue(failures.joinToString("\n", "Normalize cases that fail:\n"), failures.isEmpty())
    }

    @Test fun usaCases() {
        val failures = kind("usa").flatMap { case ->
            val origin = (case["origin"] as List<*>?)?.map { it as String }
            val expected = case["expect"] as Boolean
            VodType.entries.mapNotNull { type ->
                val (shown, tmdbId) = usaOnly(type, case["category"], origin)
                when {
                    // The case's title is matched exactly when it gives an origin.
                    (tmdbId != 0L) != (origin != null) -> "$type ${case["category"]} $origin: matched to $tmdbId"
                    shown != expected -> "$type ${case["category"]} $origin: shown $shown, expected $expected"
                    else -> null
                }
            }
        }
        assertTrue(failures.joinToString("\n", "USA only cases that fail:\n"), failures.isEmpty())
    }

    /**
     * One catalogue title of [type] listed in the categories named by [category] (a name, or an array of names), matched
     * by its provider TMDB id to a title with [origin] when that is not null and unmatched otherwise. Returns whether
     * USA only shows it in A–Z, and its TMDB id.
     */
    private fun usaOnly(type: VodType, category: Any?, origin: List<String>?): Pair<Boolean, Long> {
        val names = when (category) {
            null -> emptyList()
            is String -> listOf(category)
            is List<*> -> category.map { it as String }
            else -> error("Unexpected category $category")
        }
        val categories = names.mapIndexed { i, name -> Category("c$i", name) }
        val ids = categories.map { it.id }
        val tmdb = if (origin != null) "4242" else null
        val item = """{"id":4242,"title":"Probe","original_title":"Probe","year":"2020","origin":[${origin.orEmpty().joinToString(",", transform = ::jsonString)}]}"""
        val rows = CatalogRows.parse("""{"v":1,"source":"tmdb","movie":{"popular":[$item]},"tv":{"popular":[$item]},"genres":{}}""")!!
        val name = "Unlisted Title (2020)"
        val catalog = if (type == VodType.MOVIES) {
            val movie = Movie("m:1", name, null, null, ids.firstOrNull().orEmpty(), "https://video.example/1.mp4", categoryIds = ids, tmdb = tmdb)
            BrowseCatalog.build(listOf(movie), categories, emptyList(), emptyList(), rows)
        } else {
            val series = Series("1", name, null, null, null, ids.firstOrNull().orEmpty(), null, null, null, categoryIds = ids, tmdb = tmdb)
            BrowseCatalog.build(emptyList(), emptyList(), listOf(series), categories, rows)
        }
        val section = catalog.section(type)
        val title = section.titles.single()
        val shown = section.titles(BrowseList.AZ, usOnly = true).isNotEmpty()
        assertEquals("The title's flag and its USA only lists disagree", title.us, shown)
        return shown to title.tmdbId
    }

    /** [text] as a JSON string: the cases' origins hold tabs, line feeds and other control characters. */
    private fun jsonString(text: String): String = buildString {
        append('"')
        for (c in text) when {
            c == '"' || c == '\\' -> append('\\').append(c)
            c.code < 0x20 -> append("\\u%04x".format(c.code))
            else -> append(c)
        }
        append('"')
    }

    companion object {
        /**
         * docs/browse-cases.json at the repository root. Gradle runs unit tests in the app module (apps/android/app);
         * an IDE may use the Android project (apps/android).
         */
        fun casesFile(): File {
            val dir = File(System.getProperty("user.dir") ?: ".").absoluteFile
            return listOf("../../../docs/browse-cases.json", "../../docs/browse-cases.json")
                .map { File(dir, it).canonicalFile }
                .firstOrNull { it.isFile }
                ?: error("docs/browse-cases.json not found from $dir")
        }
    }
}

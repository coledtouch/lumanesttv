package tv.lumanest.tuner

import tv.lumanest.tuner.data.BrowseCatalog
import tv.lumanest.tuner.data.BrowseList
import tv.lumanest.tuner.data.CatalogRows
import tv.lumanest.tuner.data.Category
import tv.lumanest.tuner.data.Movie
import tv.lumanest.tuner.data.Series
import tv.lumanest.tuner.data.StreamingServices
import tv.lumanest.tuner.data.VodType
import tv.lumanest.tuner.ui.BrowseActions
import tv.lumanest.tuner.ui.discoverChoices
import tv.lumanest.tuner.ui.homeBrowseRows
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The store edition (Google Play, Amazon Appstore) shows no rows or Discover lists named after a streaming service,
 * to avoid any suggestion of affiliation in store review; the direct edition shows them. Every test passes the edition
 * explicitly, because CI also runs StoreEdition* with -Pstore=true.
 */
class StoreEditionBrowseTest {
    private val serviceNames = listOf("Netflix", "Disney", "Max", "Prime Video", "Apple TV", "Hulu", "Paramount", "Peacock")

    private fun catalog(): BrowseCatalog {
        val ids = (1..10).map { 500L + it }
        fun list() = ids.joinToString(",", "[", "]") { """{"id":$it,"title":"Film ${it - 500}","year":"2024","origin":["US"]}""" }
        val rows = CatalogRows.parse("""{"v":1,"source":"tmdb","movie":{"popular":${list()},"services":{"netflix":${list()},"disney":${list()},"peacock":${list()}}},"tv":{}}""")!!
        val categories = listOf(Category("nf", "NETFLIX SERIES"), Category("en", "EN | Movies"))
        return BrowseCatalog.build(
            (1..10).map { Movie("m:$it", "Film $it (2024)", null, "7", "en", "https://example.invalid/$it.mp4", it.toLong()) },
            categories,
            (1..10).map { Series("$it", "Show $it", null, null, "8", "nf", null, "2024", null, it.toLong()) },
            categories,
            rows,
        )
    }

    private val actions = BrowseActions(open = {}, resume = {}, seeAll = { _, _, _ -> }, toggleLibrary = {})

    private fun namesAService(text: String) = serviceNames.any { text.contains(it, ignoreCase = true) }

    @Test fun storeHomeHasNoStreamingServiceRows() {
        val store = catalog().homeRows(usOnly = true, store = true)
        assertEquals(listOf("Popular – Movies", "Recently added – Movies", "Recently added – Series", "Top rated – Movies", "Top rated – Series"),
            store.map { it.title })
        assertTrue(store.none { namesAService(it.title) || StreamingServices.byKey(it.list) != null })
        assertTrue(homeBrowseRows(catalog(), emptyList(), emptySet(), usOnly = true, store = true, actions = actions)
            .none { namesAService(it.title) || it.key.substringAfter(':') in StreamingServices.ALL.map { s -> s.key } })
        assertTrue(BrowseCatalog.homeRowSpecs(tmdb = true, store = true).none { StreamingServices.byKey(it.second) != null })
    }

    @Test fun directHomeKeepsTheServiceRows() {
        val direct = catalog().homeRows(usOnly = true, store = false).map { it.title }
        assertEquals(listOf("Popular – Movies", "Netflix – Movies", "Netflix – Series", "Disney+ – Movies", "Peacock – Movies",
            "Recently added – Movies", "Recently added – Series", "Top rated – Movies", "Top rated – Series"), direct)
    }

    @Test fun storeDiscoverListsLeaveOutTheServices() {
        val catalog = catalog()
        val store = discoverChoices(catalog, VodType.MOVIES, "netflix", null, store = true)
        assertEquals(listOf("Popular", "Top rated", "Recently added", "A–Z"), store.lists.map { it.name })
        // A remembered or See all service list falls back to the default list.
        assertEquals(BrowseList.POPULAR, store.list)
        assertTrue(BrowseList.options(tmdb = true, store = true).none { namesAService(it.name) })
        assertTrue(BrowseList.options(tmdb = false, store = true).none { namesAService(it.name) })
        assertTrue(StreamingServices.shown(store = true).isEmpty())

        val direct = discoverChoices(catalog, VodType.SERIES, "netflix", null, store = false)
        assertEquals("netflix", direct.list)
        assertEquals(listOf("Top rated", "Recently added", "A–Z", "Netflix"), direct.lists.map { it.name })
        assertEquals(StreamingServices.ALL, StreamingServices.shown(store = false))
    }

    @Test fun storeDiscoverGenresNameNoServiceAndNothingAdult() {
        // Without TMDB genres (source "none", or no saved lists yet) the provider's genre words become Discover's genres.
        val genres = listOf("Netflix Originals, Drama", "Erotic, Drama", "HBO Max", "Comedy", "Adult Animation", "Disney+ Kids, Family", "XXX")
        val catalog = BrowseCatalog.build(
            genres.mapIndexed { i, genre -> Movie("m:$i", "Film $i", null, null, "en", "https://example.invalid/$i.mp4", i.toLong(), genre = genre) },
            listOf(Category("en", "EN | Movies")), emptyList(), emptyList(), CatalogRows.NONE,
        )
        val all = catalog.movies.genres.map { it.name }
        assertTrue(all.containsAll(listOf("Netflix Originals", "Erotic", "Hbo Max", "Disney Kids", "Xxx", "Adult Animation")))
        val store = discoverChoices(catalog, VodType.MOVIES, null, "netflix originals", store = true)
        assertEquals(listOf("All", "Comedy", "Drama", "Family"), store.genres.map { it.second })
        assertTrue(store.genres.none { namesAService(it.second) })
        // A remembered genre the store edition doesn't offer falls back to All.
        assertEquals(null, store.genre)
        val direct = discoverChoices(catalog, VodType.MOVIES, null, "netflix originals", store = false)
        assertEquals(listOf("All") + all, direct.genres.map { it.second })
        assertEquals("netflix originals", direct.genre)
    }

    @Test fun theBuildFlagPicksTheDefault() {
        assertEquals(if (Edition.STORE) emptyList() else StreamingServices.ALL, StreamingServices.shown())
        assertEquals(!Edition.STORE, BrowseList.options(tmdb = true).any { it.key == "netflix" })
    }
}

package tv.lumanest.tuner

import tv.lumanest.tuner.data.BrowseBuilder
import tv.lumanest.tuner.data.BrowseCatalog
import tv.lumanest.tuner.data.BrowseList
import tv.lumanest.tuner.data.BrowseText
import tv.lumanest.tuner.data.BrowseTitle
import tv.lumanest.tuner.data.CatalogRows
import tv.lumanest.tuner.data.Category
import tv.lumanest.tuner.data.Cleanup
import tv.lumanest.tuner.data.Movie
import tv.lumanest.tuner.data.Recent
import tv.lumanest.tuner.data.Series
import tv.lumanest.tuner.data.TitleMatch
import tv.lumanest.tuner.data.VodRegion
import tv.lumanest.tuner.data.VodType
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNotSame
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test

/** docs/browse.md as plain Kotlin: TMDB matching, Movies & Series: USA only, Home rows, Discover lists and fallbacks. */
class BrowseCatalogTest {
    private fun item(id: Long, title: String, year: String = "", origin: List<String> = listOf("US"), genres: List<Int> = emptyList()) =
        """{"id":$id,"title":"$title","original_title":"$title","year":"$year","origin":[${origin.joinToString(",") { "\"$it\"" }}],"lang":"en","genres":[${genres.joinToString(",")}],"popularity":1.5}"""

    private fun rows(movie: String = "{}", tv: String = "{}", genres: String = "{}", source: String = "tmdb") =
        CatalogRows.parse("""{"v":1,"source":"$source","generated":"2026-10-19T00:00:00Z","movie":$movie,"tv":$tv,"genres":$genres}""")!!

    private fun movie(id: Int, name: String, category: String = "en", added: Long = 0, rating: String? = null, tmdb: String? = null,
                      year: String? = null, genre: String? = null) =
        Movie("m:$id", name, "https://img.example/$id.jpg", rating, category, "https://video.example/$id.mp4", added, listOf(category),
            tmdb = tmdb, year = year, genre = genre)

    private fun series(id: Int, name: String, category: String = "en", added: Long = 0, rating: String? = null, tmdb: String? = null,
                       year: String? = null, genre: String? = null) =
        Series("$id", name, null, null, rating, category, genre, year, null, added, listOf(category), tmdb = tmdb)

    private val english = Category("en", "EN | Movies")

    // ------------------------------------------------------------------ normalisation and matching

    @Test fun normalizationFollowsTheDesign() {
        mapOf(
            "The Dark Knight (2008)" to "dark knight",
            "[4K] Dune |US|" to "dune",
            "US - Fast & Furious 7 HD" to "fast and furious 7",
            "EN| Spider-Man: No Way Home [FHD]" to "spider man no way home",
            "Amélie" to "amelie",
            "UHD HDR Interstellar" to "interstellar",
            "Marvel's The Avengers" to "marvels the avengers",
            "The Office" to "office",
            "The" to "the",
            "Mission: Impossible – Dead Reckoning (2023) 4K" to "mission impossible dead reckoning",
            "Dune Part Two" to "dune part two",
            // Only a short code between pipes is a tag: the title between them stays.
            "EN | Stranger Things | 4K" to "stranger things",
            "EN| The Bear |4K|" to "bear",
            "|EN| Severance" to "severance",
        ).forEach { (raw, expected) -> assertEquals(raw, expected, TitleMatch.normalize(raw)) }
        assertEquals(listOf("stranger things", "en stranger things"), TitleMatch.keys("EN | Stranger Things | 4K"))
        // A real title that looks like a "XX:" tag still matches by its whole name.
        assertEquals(listOf("miami", "csi miami"), TitleMatch.keys("CSI: Miami"))
        assertEquals(2021, TitleMatch.yearInTitle("Dune (2021)"))
        assertEquals(0, TitleMatch.yearInTitle("Blade Runner 2049"))
        assertEquals(2021, TitleMatch.yearOf("2021-10-22"))
        assertEquals(0, TitleMatch.yearOf(null))
        // Provider year fields are read with the Unicode spaces replaced, and only those (docs/browse.md).
        assertEquals(2021, TitleMatch.yearOf("\u00A02021"))
        assertEquals(2021, TitleMatch.yearOf("\u3000\uFEFF2021-05-01"))
        assertEquals(2021, TitleMatch.yearOf(" \t2021.0"))
        assertEquals(0, TitleMatch.yearOf("\u200B2021"))
        assertEquals(0, TitleMatch.yearOf("\u001F2021"))
        assertEquals(0, TitleMatch.yearOf("20211"))
    }

    /**
     * docs/browse.md "Test cases": `Movie - 1999`, then ` - 4K` 40 times, then ` - Extended` normalizes and gives its year
     * in well under 50 ms. With a TAG that matched "4K" two ways, YEAR_END tried 2^40 ways before giving up on it.
     */
    @Test fun aLongChainOfQualityTagsIsReadInTimeProportionalToTheName() {
        val chain = "Movie - 1999" + " - 4K".repeat(40)
        val name = "$chain - Extended"
        // Compiles the patterns and warms the JIT, so the timing is the matching alone.
        repeat(20) { TitleMatch.normalize("Heat - 1995 - 4K - HD - Extended"); TitleMatch.yearInTitle("Heat - 1995 - 4K - HD - Extended") }
        val started = System.nanoTime()
        val title = TitleMatch.normalize(name)
        val year = TitleMatch.yearInTitle(name)
        val ms = (System.nanoTime() - started) / 1e6
        assertEquals("movie 1999 extended", title)
        assertEquals(0, year)
        assertTrue("Normalizing \"$name\" and reading its year took $ms ms", ms < 50)
        assertEquals("movie", TitleMatch.normalize(chain))
        assertEquals(1999, TitleMatch.yearInTitle(chain))
    }

    /**
     * docs/browse.md "Test cases" and "Trimming": `A`, 16,000 spaces and `B` normalizes and gives its year in well under
     * 50 ms, and trims as a provider field as fast. A trim written as a pattern, `[ \t\n\x0B\f\r]+$`, is tried again at
     * every space of the run, so its time grows with the square of the run.
     */
    @Test fun aLongRunOfSpacesInsideANameIsReadInTimeProportionalToTheName() {
        val name = "A" + " ".repeat(16_000) + "B"
        // Compiles the patterns and warms the JIT, so the timing is the matching alone.
        repeat(20) { TitleMatch.normalize(" A  B "); TitleMatch.yearInTitle(" A  B "); BrowseText.trimField(" A  B ") }
        val started = System.nanoTime()
        val title = TitleMatch.normalize(name)
        val year = TitleMatch.yearInTitle(name)
        val field = BrowseText.trimField(" $name\u3000")
        val ms = (System.nanoTime() - started) / 1e6
        assertEquals("a b", title)
        assertEquals(0, year)
        assertEquals(name, field)
        assertTrue("Normalizing a name with 16,000 spaces inside, reading its year and trimming it took $ms ms", ms < 50)
    }

    @Test fun providerTmdbIdsMatchFirstThenTitleAndYearWithinOne() {
        val lists = rows(movie = """{"popular":[${item(438631, "Dune", "2021")},${item(841, "Dune", "1984")},${item(27205, "Inception", "2010")},${item(100, "Heat", "1995")}]}""")
        val catalog = BrowseCatalog.build(listOf(
            movie(1, "Dune: Part One", tmdb = "438631"), // provider id wins over a different name
            movie(2, "EN - Dune (2020)"), // year within 1 of 2021
            movie(3, "Dune [1984]"),
            movie(4, "Inception (2013)"), // three years off: no match
            movie(5, "Heat", tmdb = "999"), // a provider id that isn't in the lists never falls back to the name
            movie(6, "Heat (1995)"),
        ), listOf(english), emptyList(), emptyList(), lists)
        val ids = catalog.movies.titles.associate { it.name to it.tmdbId }
        assertEquals(438631L, ids["Dune: Part One"])
        assertEquals(438631L, ids["EN - Dune (2020)"])
        assertEquals(841L, ids["Dune [1984]"])
        assertEquals(0L, ids["Inception (2013)"])
        assertEquals(0L, ids["Heat"])
        assertEquals(100L, ids["Heat (1995)"])
        assertEquals(4, catalog.movies.matched)
        // Two copies of one TMDB title are one poster in a list.
        assertEquals(listOf(438631L, 841L, 100L), catalog.movies.titles(BrowseList.POPULAR, usOnly = false).map { it.tmdbId })
    }

    @Test fun aTitleWithoutAYearMatchesOnlyAnUnambiguousName() {
        val lists = rows(tv = """{"popular":[${item(1, "The Office", "2005")},${item(2, "The Office", "2001", listOf("GB"))},${item(3, "Severance", "2022")}]}""")
        val catalog = BrowseCatalog.build(emptyList(), emptyList(), listOf(series(1, "The Office"), series(2, "Severance")), listOf(english), lists)
        assertEquals(0L, catalog.series["series:1"]!!.tmdbId)
        assertEquals(3L, catalog.series["series:2"]!!.tmdbId)
    }

    // ------------------------------------------------------------------ USA only

    @Test fun categoryRuleExcludesNonUsCountryAndLanguageTags() {
        listOf("FR | Films", "|DE| Action", "IT: Drama", "ES - Comedia", "LAT Peliculas", "HINDI MOVIES", "UK | Drama", "PT|Series",
            "TR: Diziler", "Bollywood Hits", "Movies CA", "NL Kids", "IN | Movies", "Turkish Series")
            .forEach { assertTrue(it, VodRegion.isForeignCategory(it)) }
        listOf("EN | Action", "Netflix Movies", "MOVIES IN 4K", "4K UHD", "Kids & Family", "CAR CHASES", "Top Rated", "USA | Comedy",
            "Documentaries", "", "EN | IN THEATERS", "4K | IN THEATRES", "IN CINEMAS", "EN | IT FOLLOWS COLLECTION")
            .forEach { assertFalse(it, VodRegion.isForeignCategory(it)) }
        // "IN" and "IT" as tags: followed by a separator, or at the end.
        listOf("IN | Movies", "Movies | IN", "Films (IN)", "IT: Drama", "|IT| Series", "IN-Hindi Dubbed")
            .forEach { assertTrue(it, VodRegion.isForeignCategory(it)) }
    }

    @Test fun usaOnlyUsesTmdbOriginWhenMatchedAndTheCategoryOtherwise() {
        val cats = listOf(english, Category("fr", "FR | Séries"), Category("uk", "UK | Drama"))
        val lists = rows(tv = """{"popular":[${item(10, "Severance", "2022", listOf("US"))},${item(11, "Sherlock", "2010", listOf("GB"))},${item(12, "The Bear", "2022", listOf("US"))}]}""")
        val catalog = BrowseCatalog.build(emptyList(), emptyList(), listOf(
            series(1, "Severance (2022)"), // matched, US origin, English category
            series(2, "Sherlock (2010)"), // matched, GB origin: hidden
            series(3, "The Bear (2022)", category = "fr"), // a US show filed under a French category: the dubbed copy, hidden
            series(4, "Unmatched Show", category = "en"), // unmatched: English category passes
            series(5, "Autre Série", category = "fr"), // unmatched in a foreign category: hidden
            series(6, "British Show", category = "uk"),
        ), cats, lists)
        val us = catalog.series.titles.associate { it.name to it.us }
        assertEquals(mapOf("Severance (2022)" to true, "Sherlock (2010)" to false, "The Bear (2022)" to false, "Unmatched Show" to true,
            "Autre Série" to false, "British Show" to false), us)
        assertEquals(listOf("Severance (2022)"), catalog.series.titles(BrowseList.POPULAR, usOnly = true).map { it.name })
        assertEquals(listOf("Severance (2022)", "Sherlock (2010)", "The Bear (2022)"), catalog.series.titles(BrowseList.POPULAR, usOnly = false).map { it.name })
        assertEquals(listOf("Severance (2022)", "Unmatched Show"), catalog.series.titles(BrowseList.AZ, usOnly = true).map { it.name })
        // TMDB movie lists usually carry no countries: the category decides.
        val movies = BrowseCatalog.build(listOf(movie(1, "Heat (1995)"), movie(2, "Heat (1995)", category = "fr")), cats, emptyList(), emptyList(),
            rows(movie = """{"popular":[${item(100, "Heat", "1995", origin = emptyList())}]}"""))
        assertEquals(listOf(true, false), movies.movies.titles.map { it.us })
        // With All, the US copy of a title is the one shown.
        assertEquals(listOf("m:1"), movies.movies.titles(BrowseList.POPULAR, usOnly = false).map { it.movie!!.id })
    }

    @Test fun withAllTheUsCopyOfATitleIsShownInEveryList() {
        val cats = listOf(english, Category("fr", "FR | Films"))
        val catalog = BrowseCatalog.build(
            listOf(movie(1, "FR - Heat (1995)", category = "fr", added = 20), movie(2, "Heat (1995)", added = 10), movie(3, "Alien (1979)", added = 5)),
            cats, emptyList(), emptyList(),
            rows(movie = """{"popular":[${item(100, "Heat", "1995", origin = emptyList())},${item(101, "Alien", "1979")}]}"""),
        )
        // A–Z sorts both copies under "heat" with the French name first; Recently added has the dubbed copy first.
        assertEquals(listOf("m:3", "m:2"), catalog.movies.titles(BrowseList.AZ, usOnly = false).map { it.movie!!.id })
        assertEquals(listOf("m:2", "m:3"), catalog.movies.titles(BrowseList.RECENT, usOnly = false).map { it.movie!!.id })
        assertEquals(listOf("m:2", "m:3"), catalog.movies.titles(BrowseList.POPULAR, usOnly = false).map { it.movie!!.id })
        // USA only: the same copy, at its own place.
        assertEquals(listOf("m:2", "m:3"), catalog.movies.titles(BrowseList.RECENT, usOnly = true).map { it.movie!!.id })
    }

    @Test fun dubbedUploadsInForeignCategoriesStayApartFromTheUsCopy() {
        val cats = listOf(english, Category("fr", "FR | Films"), Category("de", "DE | Filme"))
        val uploads = listOf(
            movie(1, "Heat (1995)", added = 10),
            movie(2, "Heat (1995)", category = "fr", added = 30), // the newest upload is the French dub
            movie(3, "Heat (1995)", category = "de", added = 20),
            movie(4, "Heat (1995)", added = 5),
        )
        val cleaned = Cleanup.movies(uploads, cats)
        assertEquals(listOf("m:1", "m:2"), cleaned.map { it.id })
        assertEquals(listOf("m:4"), cleaned[0].aliases)
        assertEquals(listOf("en"), cleaned[0].categoryIds)
        assertEquals(listOf("https://video.example/4.mp4"), cleaned[0].backups)
        assertEquals(listOf("m:3"), cleaned[1].aliases)
        val catalog = BrowseCatalog.build(cleaned, cats, emptyList(), emptyList(), CatalogRows.NONE)
        // USA only plays the English upload; the dubs are their own (hidden) title.
        assertEquals(listOf("https://video.example/1.mp4"), catalog.movies.titles(BrowseList.AZ, usOnly = true).map { it.movie!!.url })
        assertEquals(2, catalog.movies.titles(BrowseList.AZ, usOnly = false).size)
        // Without the categories (as before), every copy is one title.
        assertEquals(1, Cleanup.movies(uploads).size)
        // A category id missing from the list is left out: an upload in "FR | Films" and an unknown id is still a dub.
        val unknown = Cleanup.movies(listOf(uploads[0], uploads[1].copy(categoryIds = listOf("fr", "gone"))), cats)
        assertEquals(listOf("m:1", "m:2"), unknown.map { it.id })
        // An upload whose only category is unknown has no category left, so it passes and folds with the English one.
        assertEquals(listOf("m:2"), Cleanup.movies(listOf(uploads[0], uploads[1].copy(categoryIds = listOf("gone"))), cats).map { it.id })
    }

    @Test fun aFoldedMovieTakesAMissingTmdbIdYearAndGenreFromTheNewestCopyThatHasOne() {
        val cleaned = Cleanup.movies(listOf(
            movie(1, "Heat", added = 10, tmdb = "100", year = "1995", genre = "Crime"),
            movie(2, "Heat", added = 30),
            movie(3, "Heat", added = 20, tmdb = "949", year = "1996", genre = "Action"),
        ), listOf(english)).single()
        assertEquals("m:2", cleaned.id)
        assertEquals(Triple("949", "1996", "Action"), Triple(cleaned.tmdb, cleaned.year, cleaned.genre))
        assertEquals(listOf("https://video.example/3.mp4", "https://video.example/1.mp4"), cleaned.backups)
    }

    @Test fun aReuploadedMovieKeepsItsLibraryEntriesAndSavedPosition() {
        val first = movie(1, "Heat (1995)", added = 10)
        val reupload = movie(2, "Heat (1995)", added = 20)
        val cleaned = Cleanup.movies(listOf(first, reupload, movie(3, "Ronin (1998)")))
        val heat = cleaned.single { it.name == "Heat (1995)" }
        assertEquals("m:2", heat.id)
        assertEquals(listOf("m:1"), heat.aliases)
        val catalog = BrowseCatalog.build(cleaned, listOf(english), emptyList(), emptyList(), CatalogRows.NONE)
        // Saved under the old upload's key: Favorite movies, Recently watched and the check badge still find it.
        val title = catalog["movie:m:1"]!!
        assertEquals("movie:m:2", title.key)
        assertEquals(listOf("movie:m:1"), title.aliasKeys)
        assertEquals(listOf("movie:m:2"), catalog.titlesFor(listOf("movie:m:1", "movie:m:2"), VodType.MOVIES).map { it.key })
        assertTrue(title.savedIn(setOf("movie:m:1")))
        assertFalse(catalog["movie:m:3"]!!.savedIn(setOf("movie:m:1")))
        // Continue watching: a position saved for the old upload, which is now a backup of the kept one.
        val recent = Recent("m:1", "Heat", null, null, first.url, 600_000, 6_000_000, 1)
        val item = catalog.continueWatching(listOf(recent)).single()
        assertEquals("movie:m:2", item.title.key)
        assertEquals(reupload.url, item.recent.url)
        assertEquals(600_000L, item.recent.positionMs)
        assertEquals(mapOf("movie:m:2" to 0.1f), catalog.progressByKey(listOf(recent)))
        // An alias never takes the key of a title that is still listed under it.
        val clash = BrowseCatalog.build(listOf(heat, movie(1, "Other film")), listOf(english), emptyList(), emptyList(), CatalogRows.NONE)
        assertEquals("Other film", clash["movie:m:1"]!!.name)
    }

    @Test fun aTitleInAnyPassingCategoryIsNotForeign() {
        val m = movie(1, "Shared").copy(categoryIds = listOf("fr", "en"))
        val catalog = BrowseCatalog.build(listOf(m), listOf(english, Category("fr", "FR | Films")), emptyList(), emptyList(), CatalogRows.NONE)
        assertTrue(catalog.movies.titles.single().us)
    }

    // ------------------------------------------------------------------ Home rows

    private fun tmdbFixture(): BrowseCatalog {
        val movieIds = (1..30).map { 1000L + it }
        val tvIds = (1..30).map { 2000L + it }
        fun list(ids: List<Long>, prefix: String) = ids.joinToString(",", "[", "]") { item(it, "$prefix ${it % 1000}", "2020") }
        val lists = rows(
            movie = """{"popular":${list(movieIds, "Film")},"featured":${list(movieIds.reversed(), "Film")},"top_rated":${list(movieIds.take(3), "Film")},
                "services":{"netflix":${list(movieIds.take(8), "Film")},"hulu":${list(movieIds.take(4), "Film")}}}""",
            tv = """{"popular":${list(tvIds, "Show")},"featured":${list(tvIds.take(5), "Show")},"services":{"netflix":${list(tvIds.take(6), "Show")}}}""",
        )
        return BrowseCatalog.build(
            (1..30).map { movie(it, "Film $it (2020)", added = it.toLong(), rating = "${(it % 9) + 1}") },
            listOf(english),
            (1..30).map { series(it, "Show $it", added = it.toLong(), rating = "7", year = "2020") },
            listOf(english),
            lists,
        )
    }

    @Test fun homeRowsFollowTheDesignOrderWithFiveToTwentyTitles() {
        val catalog = tmdbFixture()
        val home = catalog.homeRows(usOnly = true, store = false)
        assertEquals(listOf(
            "Popular – Movies", "Popular – Series", "Featured – Movies", "Featured – Series", "Netflix – Movies", "Netflix – Series",
            "Recently added – Movies", "Recently added – Series", "Top rated – Movies", "Top rated – Series",
        ), home.map { it.title })
        assertTrue(home.all { it.titles.size in 5..20 })
        assertEquals(20, home.first().titles.size)
        // Popular keeps TMDB's order; Featured – Series has exactly five; Hulu (four) and the empty services are left out.
        assertEquals((1..20).map { "Film $it (2020)" }, home.first().titles.map { it.name })
        assertEquals(5, home.single { it.id == "series:featured" }.titles.size)
        assertEquals("Film 30 (2020)", home.single { it.id == "movies:recent" }.titles.first().name)
        // Top rated: TMDB's list first, then the provider's rating.
        assertEquals(listOf("Film 1 (2020)", "Film 2 (2020)", "Film 3 (2020)"), home.single { it.id == "movies:top_rated" }.titles.take(3).map { it.name })
        assertEquals(VodType.SERIES, home[1].type)
        assertEquals(BrowseList.POPULAR, home[1].list)
    }

    @Test fun discoverListsRespectTypeGenreAndHaveNoLimit() {
        val catalog = tmdbFixture()
        assertEquals(listOf("Popular", "Featured", "Top rated", "Recently added", "A–Z", "Netflix", "Hulu"),
            catalog.listOptions(VodType.MOVIES, store = false).map { it.name })
        assertEquals(30, catalog.movies.titles(BrowseList.AZ, usOnly = true).size)
        assertEquals(BrowseList.POPULAR, catalog.defaultList(VodType.MOVIES))
        assertEquals(BrowseList.POPULAR, catalog.validList(VodType.SERIES, "nonsense", store = false))
        assertEquals("netflix", catalog.validList(VodType.SERIES, "netflix", store = false))
        // Hulu has no series: Discover doesn't offer it for Series.
        assertEquals(BrowseList.POPULAR, catalog.validList(VodType.SERIES, "hulu", store = false))
    }

    // ------------------------------------------------------------------ genres

    @Test fun genresUseTmdbWhenMatchedAndProviderGenresOtherwise() {
        val lists = rows(
            movie = """{"popular":[${item(1, "Arrival", "2016", genres = listOf(878, 18))},${item(2, "Heat", "1995", genres = listOf(80))}]}""",
            genres = """{"movie":[{"id":28,"name":"Action"},{"id":80,"name":"Crime"},{"id":18,"name":"Drama"},{"id":878,"name":"Science Fiction"}],"tv":[]}""",
        )
        val catalog = BrowseCatalog.build(listOf(
            movie(1, "Arrival (2016)", genre = "Comedy"), // matched: TMDB's genres win
            movie(2, "Heat (1995)"),
            movie(3, "Unknown Space Film", genre = "Sci-Fi, Action"), // unmatched: provider genres mapped onto TMDB's
            movie(4, "Mystery Film", genre = "Mystery"), // not a TMDB movie genre here
        ), listOf(english), emptyList(), emptyList(), lists)
        assertEquals(listOf("Action", "Crime", "Drama", "Science Fiction"), catalog.movies.genres.map { it.name })
        assertEquals(listOf("Arrival (2016)", "Unknown Space Film"), catalog.movies.titles(BrowseList.AZ, usOnly = false, genre = "878").map { it.name })
        assertEquals(listOf("Unknown Space Film"), catalog.movies.titles(BrowseList.AZ, usOnly = false, genre = "28").map { it.name })
        assertEquals(listOf("Heat (1995)"), catalog.movies.titles(BrowseList.POPULAR, usOnly = false, genre = "80").map { it.name })
    }

    // ------------------------------------------------------------------ without TMDB

    @Test fun withoutTmdbPopularAndFeaturedAreHiddenAndCategoriesFillTheServiceRows() {
        val cats = listOf(english, Category("nf", "NETFLIX MOVIES"), Category("hbo", "HBO Max Series"), Category("amz", "Amazon Prime Video"),
            Category("d", "Disney+ Originals"), Category("drama", "EN | Drama"))
        val movies = (1..12).map { movie(it, "Film $it", category = if (it <= 6) "nf" else "amz", added = it * 10L, rating = "${it % 10}.5") }
        val shows = (1..7).map { series(it, "Show $it", category = if (it <= 5) "hbo" else "drama", added = it.toLong(), genre = "Drama, Crime") }
        for (none in listOf(CatalogRows.NONE, rows(source = "none"))) {
            val catalog = BrowseCatalog.build(movies, cats, shows, cats, none)
            assertFalse(catalog.tmdb)
            val home = catalog.homeRows(usOnly = true, store = false)
            assertEquals(listOf("Netflix – Movies", "Max – Series", "Prime Video – Movies", "Recently added – Movies", "Recently added – Series",
                "Top rated – Movies"), home.map { it.title })
            // Service rows: the provider's categories, newest first.
            assertEquals((6 downTo 1).map { "Film $it" }, home.first().titles.map { it.name })
            // Recently added uses "added" (movies) and "last_modified" (series); Top rated the provider's rating.
            assertEquals("Film 12", home.single { it.id == "movies:recent" }.titles.first().name)
            assertEquals("Film 9", home.single { it.id == "movies:top_rated" }.titles.first().name)
            assertEquals(listOf("Top rated", "Recently added", "A–Z", "Netflix", "Disney+", "Max", "Prime Video", "Apple TV+", "Hulu", "Paramount+", "Peacock"),
                BrowseList.options(tmdb = false, store = false).map { it.name })
            assertEquals(listOf("Top rated", "Recently added", "A–Z", "Netflix", "Prime Video"), catalog.listOptions(VodType.MOVIES, store = false).map { it.name })
            assertEquals(BrowseList.RECENT, catalog.defaultList(VodType.MOVIES))
            assertEquals(BrowseList.RECENT, catalog.validList(VodType.MOVIES, BrowseList.POPULAR, store = false))
            // Provider genre strings become Discover's genres.
            assertEquals(listOf("Crime", "Drama"), catalog.series.genres.map { it.name })
            assertEquals(7, catalog.series.titles(BrowseList.AZ, usOnly = true, genre = "crime").size)
        }
    }

    @Test fun anM3uLibraryWithoutDatesOrRatingsStillHasAToZ() {
        val catalog = BrowseCatalog.build((1..8).map { movie(it, "Film $it") }, listOf(english), emptyList(), emptyList(), CatalogRows.NONE)
        assertTrue(catalog.homeRows(usOnly = true, store = false).isEmpty())
        assertEquals(BrowseList.AZ, catalog.defaultList(VodType.MOVIES))
        assertEquals(8, catalog.movies.titles(BrowseList.AZ, usOnly = true).size)
        assertEquals(listOf("A–Z"), catalog.listOptions(VodType.MOVIES, store = false).map { it.name })
    }

    // ------------------------------------------------------------------ Continue watching and Library

    @Test fun continueWatchingMatchesTheSameUploadAndTheSeriesItNames() {
        val films = listOf(movie(1, "Heat").copy(backups = listOf("https://backup.example/1.mp4")), movie(2, "Ronin"))
        val shows = listOf(series(7, "The Bear"), series(8, "The Bear"))
        val catalog = BrowseCatalog.build(films, listOf(english), shows, listOf(english), CatalogRows.NONE)
        val recents = listOf(
            Recent("e:70", "The Bear", "S1 E2 · Hands", null, "https://ep.example/70.mp4", 60_000, 1_800_000, 9, titleKey = "series:8"),
            Recent("m:1", "Old name", null, null, "https://backup.example/1.mp4", 30_000, 100_000, 8),
            Recent("m:2", "Ronin", null, null, "https://elsewhere.example/2.mp4", 30_000, 100_000, 7), // another provider's upload
            Recent("e:71", "The Bear", "S1 E3", null, "https://ep.example/71.mp4", 0, 0, 6, titleKey = "series:8", nextUp = true), // same series again
            Recent("e:90", "Gone Show", null, null, "https://ep.example/90.mp4", 10_000, 100_000, 5, titleKey = "series:99"),
            Recent("e:91", "The Bear", null, null, "https://ep.example/91.mp4", 10_000, 100_000, 4), // saved before 1.7: by name
        )
        val items = catalog.continueWatching(recents)
        assertEquals(listOf("series:8", "movie:m:1", "series:7"), items.map { it.title.key })
        assertEquals("Heat", items[1].recent.title)
        assertEquals("https://video.example/1.mp4", items[1].recent.url)
        assertEquals(mapOf("series:8" to 60_000f / 1_800_000, "movie:m:1" to 0.3f, "series:7" to 0.1f), catalog.progressByKey(recents))
        // An up-next episode has no progress bar.
        val next = catalog.continueWatching(listOf(recents[3]))
        assertTrue(next.single().recent.nextUp)
        assertTrue(catalog.progressByKey(listOf(recents[3])).isEmpty())
        assertEquals(listOf("movie:m:2", "series:7"), catalog.titlesFor(listOf("movie:m:2", "series:7", "movie:m:404", "movie:m:2")).map { it.key })
        assertEquals(listOf("series:7"), catalog.titlesFor(listOf("movie:m:2", "series:7"), VodType.SERIES).map { it.key })
    }

    @Test fun theBuilderReusesTheSectionWhoseInputsDidNotChange() {
        val builder = BrowseBuilder()
        val movies = (1..50).map { movie(it, "Film $it") }
        val lists = rows(movie = """{"popular":[${item(1, "Film 1")}]}""")
        val cats = listOf(english)
        val first = builder.build(movies, cats, listOf(series(1, "Show 1")), cats, lists)
        // New series (a series snapshot or refresh): the movie index is reused as it was.
        val second = builder.build(movies, cats, listOf(series(1, "Show 1"), series(2, "Show 2")), cats, lists)
        assertSame(first.movies, second.movies)
        assertNotSame(first.series, second.series)
        assertEquals(2, second.series.titles.size)
        // New movies, categories or lists rebuild the movies.
        assertNotSame(second.movies, builder.build(movies.toList(), cats, emptyList(), cats, lists).movies)
        val third = builder.build(movies, cats, emptyList(), cats, lists)
        assertNotSame(third.movies, builder.build(movies, cats, emptyList(), cats, rows(movie = """{"popular":[]}""")).movies)
        // A cancelled build stops.
        val cancelled = runCatching { builder.build((1..5_000).map { movie(it, "Film $it") }, cats, emptyList(), cats, lists) { true } }
        assertTrue(cancelled.exceptionOrNull() is java.util.concurrent.CancellationException)
    }

    @Test fun aFailedBuildGivesAnEmptyCatalogueButCancellationStillStops() {
        val builder = BrowseBuilder()
        val errors = ArrayList<Exception>()
        // A movie list that fails while it is read stands in for any unexpected failure.
        val broken = object : AbstractList<Movie>() {
            override val size = 3
            override fun get(index: Int): Movie = throw IllegalStateException("damaged")
        }
        val built = builder.buildOrEmpty(broken, listOf(english), emptyList(), emptyList(), CatalogRows.NONE, onError = { errors += it })
        assertSame(BrowseCatalog.EMPTY, built)
        assertTrue(built.isEmpty)
        assertEquals("damaged", errors.single().message)
        val cancelled = runCatching {
            builder.buildOrEmpty((1..5_000).map { movie(it, "Film $it") }, listOf(english), emptyList(), emptyList(), CatalogRows.NONE, cancelled = { true })
        }
        assertTrue(cancelled.exceptionOrNull() is java.util.concurrent.CancellationException)
        assertEquals(1, errors.size)
    }

    @Test fun aReplacedLibraryStopsBuilding() {
        var checks = 0
        val result = runCatching {
            BrowseCatalog.build((0 until 5_000).map { movie(it, "Film $it") }, listOf(english), emptyList(), emptyList(), CatalogRows.NONE) { ++checks > 2 }
        }
        assertTrue(result.exceptionOrNull() is java.util.concurrent.CancellationException)
        assertEquals(3, checks)
    }

    // ------------------------------------------------------------------ scale

    @Test fun tensOfThousandsOfTitlesIndexOnceAndQueryQuickly() {
        val genres = listOf("Action", "Drama", "Comedy, Romance", "Sci-Fi", "Horror")
        val categories = (0 until 200).map { Category("c$it", if (it % 10 == 0) "FR | Films $it" else if (it == 7) "NETFLIX" else "EN | Movies $it") }
        val movies = (0 until 25_000).map { i ->
            movie(i, "Movie Title Number $i (${1980 + i % 45})", category = "c${i % 200}", added = i.toLong(), rating = "${i % 10}.${i % 7}",
                tmdb = if (i % 3 == 0) "${i / 3 + 1}" else null, genre = genres[i % genres.size])
        }
        val shows = (0 until 5_000).map { i -> series(i, "Series Title $i", category = "c${i % 200}", added = i.toLong(), year = "${1990 + i % 30}") }
        fun list(from: Int) = (from until from + 100).joinToString(",", "[", "]") { item(it.toLong(), "Movie Title Number ${(it - 1) * 3}", "${1980 + ((it - 1) * 3) % 45}") }
        val lists = rows(movie = """{"popular":${list(1)},"featured":${list(101)},"top_rated":${list(201)},"services":{"netflix":${list(301)}}}""")
        val started = System.nanoTime()
        val catalog = BrowseCatalog.build(movies, categories, shows, categories, lists)
        val buildMs = (System.nanoTime() - started) / 1_000_000
        assertTrue("Building took $buildMs ms", buildMs < 15_000)
        assertEquals(400, catalog.movies.matched)
        val queries = System.nanoTime()
        repeat(20) {
            assertNotNull(catalog.homeRows(usOnly = it % 2 == 0, store = false))
            catalog.movies.titles(BrowseList.AZ, usOnly = true, genre = catalog.movies.genres.first().key)
            catalog.movies.titles(BrowseList.RECENT, usOnly = false)
        }
        val queryMs = (System.nanoTime() - queries) / 1_000_000
        assertTrue("Queries took $queryMs ms", queryMs < 5_000)
        assertEquals(25_000 - 2_500, catalog.movies.titles(BrowseList.AZ, usOnly = true).size)
        assertEquals(BrowseTitle.movieKey("m:24999"), catalog.movies.titles(BrowseList.RECENT, usOnly = true, limit = 1).single().key)
    }
}

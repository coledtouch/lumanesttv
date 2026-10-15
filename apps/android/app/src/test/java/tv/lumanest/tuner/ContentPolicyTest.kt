package tv.lumanest.tuner

import tv.lumanest.tuner.data.Category
import tv.lumanest.tuner.data.Channel
import tv.lumanest.tuner.data.ContentPolicy
import tv.lumanest.tuner.data.M3u
import tv.lumanest.tuner.data.Movie
import tv.lumanest.tuner.data.Series
import tv.lumanest.tuner.data.Source
import tv.lumanest.tuner.data.SourceType
import tv.lumanest.tuner.data.Xtream
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.io.File

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class ContentPolicyTest {
    private val categories = listOf(
        Category("us", "USA | Entertainment"), Category("uk", "UK | Entertainment"),
        Category("en", "English Movies"), Category("es", "USA | Spanish / Latino"),
        Category("genre", "Action"), Category("uken", "UK | English Series"),
    )
    private fun channel(name: String = "CNN", ids: List<String> = listOf("genre"), country: String? = null, language: String? = null, epg: String? = null) =
        Channel(name, 100, name, null, ids.firstOrNull().orEmpty(), epg, null, "http://example/live/1.ts", ids, country, language)
    private fun movie(name: String = "A Movie", ids: List<String> = listOf("genre"), country: String? = null, language: String? = null) =
        Movie(name, name, null, null, ids.firstOrNull().orEmpty(), "http://example/movie/1.mp4", categoryIds = ids, country = country, language = language)
    private fun series(name: String = "A Series", ids: List<String> = listOf("genre"), country: String? = null, language: String? = null) =
        Series(name, name, null, null, null, ids.firstOrNull().orEmpty(), null, null, null, categoryIds = ids, country = country, language = language)
    private fun temp(text: String): File = File.createTempFile("tuner-policy", ".txt").apply { writeText(text); deleteOnExit() }

    @Test fun unknownLiveCountryStaysHiddenButVodDoesNotNeedLanguageEvidence() {
        assertTrue(ContentPolicy.live(listOf(channel()), categories).items.isEmpty())
        assertEquals(3, ContentPolicy.movies(listOf(movie("The English Patient"), movie("Us (2019)"), movie("The Last of Us: Part One")), categories).items.size)
        assertEquals(1, ContentPolicy.series(listOf(series("English Teacher")), categories).items.size)
    }

    @Test fun liveRequiresUsRatherThanEnglishAlone() {
        val items = listOf(channel("USA CNN", listOf("us")), channel("BBC", listOf("uken")), channel("English feed", language = "en"))
        assertEquals(listOf("USA CNN"), ContentPolicy.live(items, categories).items.map { it.name })
    }

    @Test fun ordinaryWordsInsideRegionLabelsDoNotBecomeForeignCountries() {
        val categories = listOf(Category("us", "US Sports in English"))
        assertEquals(1, ContentPolicy.live(listOf(channel(ids = listOf("us"))), categories).items.size)
    }

    @Test fun markedUsPrefixesAndEpgSuffixArePositiveEvidence() {
        val items = listOf("|US| CNN", "[USA] NBC", "US: CBS", "USA - ABC").map { channel(it) } + channel("FOX", epg = "FOX.us")
        assertEquals(5, ContentPolicy.live(items, categories).items.size)
    }

    @Test fun explicitForeignMarkersVetoUsEvenAfterAnotherMarkerOrLanguage() {
        val names = listOf(
            "[US] [IN] News", "[US / India] News", "(PLUTO US / IN) News",
            "[English / IT] News", "[US] [Tuvalu] News", "[US] [ca] News",
        )
        assertTrue(ContentPolicy.live(names.map { channel(it, listOf("us")) }, categories).items.isEmpty())
    }

    @Test fun compoundAndServiceMarkersPreserveMultiwordForeignCountryVetoes() {
        val names = listOf(
            "(US / United Kingdom) News", "(PLUTO United Kingdom) News", "(PLUTO South Korea) News",
            "[US South Korea] News", "[US English United Kingdom] News", "[US] (Plex New Zealand) News",
            "USA / United Arab Emirates: News",
        )
        assertTrue(ContentPolicy.live(names.map { channel(it, listOf("us")) }, categories).items.isEmpty())
    }

    @Test fun compoundMultiwordUsAliasesAllowLanguagesButNotOrdinaryTitleWords() {
        val names = listOf(
            "(PLUTO United States) News", "(PLUTO English United States of America) News",
            "[English United States Spanish] News", "[USA / United States of America] News",
        )
        assertEquals(names, ContentPolicy.live(names.map { channel(it) }, categories).items.map { it.name })
        val ordinary = listOf("[Made in United States] News", "[US / ordinary title] News", "The Last of Us: Part One")
        assertTrue(ContentPolicy.live(ordinary.map { channel(it) }, categories).items.isEmpty())
    }

    @Test fun markedServiceAndLanguageCombinationsPreserveUsEvidenceWithoutTitleGuessing() {
        val names = listOf(
            "(PLUTO USA / English) Local news", "[English] [United States] Local news",
            "US / Spanish: Local news", "[US] News (English)",
        )
        assertEquals(names, ContentPolicy.live(names.map { channel(it) }, categories).items.map { it.name })
        val ordinary = listOf("The Last of Us: Part One", "Made in USA: Documentary", "[USA Documentary] News")
        assertTrue(ContentPolicy.live(ordinary.map { channel(it) }, categories).items.isEmpty())
    }

    @Test fun tvQualityWordsStayDistinctFromAnExplicitTuvaluMarker() {
        val cats = listOf(Category("us", "Tubi TV (USA)"))
        val result = ContentPolicy.live(listOf(channel("[TV] Local channel", listOf("us")), channel("[Tuvalu] Foreign channel", listOf("us"))), cats)
        assertEquals(listOf("[TV] Local channel"), result.items.map { it.name })
    }

    @Test fun countryAndEnglishMetadataAliasesAreSupported() {
        val countries = listOf("US", "USA", "United States", "United States of America", "U.S.A.")
        val items = countries.mapIndexed { index, country -> channel("Channel $index", country = country, language = listOf("en", "eng", "English", "en-US", "EN_gb")[index]) }
        assertEquals(5, ContentPolicy.live(items, categories).items.size)
    }

    @Test fun foreignItemMetadataOrLabelsOverrideUsCategory() {
        val items = listOf(
            channel("CNN Canada", listOf("us"), country = "CA"), channel("CNN Español", listOf("us"), language = "es"),
            channel("[UK] BBC", listOf("us")), channel("[uk] BBC lowercase", listOf("us")), channel("[ca] CNN", listOf("us")), channel("[ES] ABC", listOf("us")),
            channel("Foreign EPG", listOf("us"), epg = "bbc.uk"), channel("Conflicting language", listOf("us"), language = "en;spa"),
            channel("Conflicting country", listOf("us"), country = "US;GB"),
        )
        assertEquals(listOf("CNN Español", "Conflicting language"), ContentPolicy.live(items, categories).items.map { it.name })
    }

    @Test fun spanishUsNetworksAreAvailableWithoutLanguageRestrictions() {
        val names = listOf("Telemundo52", "Univisión", "UniMás", "Galavision", "ESPN Deportes", "FOX Deportes", "Universo", "TUDN", "Estrella TV")
        assertEquals(names, ContentPolicy.live(names.map { channel(it, listOf("us"), country = "US") }, categories).items.map { it.name })
    }

    @Test fun mixedCategoryMembershipsKeepOnlySafeCategories() {
        val result = ContentPolicy.live(listOf(channel(ids = listOf("uk", "us", "es", "genre"))), categories)
        assertEquals(listOf("us", "es", "genre"), result.items.single().categoryIds)
        assertEquals("us", result.items.single().categoryId)
        assertEquals(setOf("us", "es", "genre"), result.categories.map { it.id }.toSet())
    }

    @Test fun lowerCaseForeignCategoryMembershipCannotLeakFromMixedLists() {
        val categories = listOf(Category("us", "USA News"), Category("uk", "uk | Entertainment"))
        val result = ContentPolicy.live(listOf(channel(ids = listOf("uk", "us"))), categories)
        assertEquals(listOf("us"), result.items.single().categoryIds)
        assertEquals(listOf("us"), result.categories.map { it.id })
    }

    @Test fun safeMetadataGetsFallbackWhenEveryCategoryIsForeign() {
        val result = ContentPolicy.live(listOf(channel(ids = listOf("uk"), country = "US", language = "English")), categories)
        assertEquals("USA", result.categories.single().name)
        assertEquals(result.categories.single().id, result.items.single().categoryId)
    }

    @Test fun vodIncludesForeignAndUnknownLanguagesAndCountries() {
        val items = listOf(
            movie("English UK movie", country = "GB", language = "eng"), movie("Provider English label", listOf("uken")),
            movie("US provider movie", listOf("us")), movie("Spanish movie", listOf("en"), language = "Spanish"),
            movie("Unknown-language UK movie", listOf("uk")), movie("[ES] Dubbed movie", listOf("en")),
        )
        assertEquals(items.map { it.name }, ContentPolicy.movies(items, categories).items.map { it.name })
    }

    @Test fun markedEnglishVodLabelsWorkWithoutGuessingFromTitle() {
        val items = listOf(movie("[EN] Movie"), movie("English: Movie"), movie("Movie (English)"), movie("[US] Movie"))
        assertEquals(4, ContentPolicy.movies(items, categories).items.size)
    }

    @Test fun seriesRetainsAllLanguagesAndCategories() {
        val result = ContentPolicy.series(listOf(series(ids = listOf("es", "uk", "en", "genre")), series("Spanish series", listOf("en"), language = "es")), categories)
        assertEquals(2, result.items.size)
        assertEquals(listOf("es", "uk", "en", "genre"), result.items.first().categoryIds)
        assertEquals(setOf("es", "uk", "en", "genre"), result.categories.map { it.id }.toSet())
    }

    @Test fun unknownAudioLanguageDoesNotHideTitlesOrUsChannels() {
        assertEquals(1, ContentPolicy.movies(listOf(movie(ids = listOf("en"), language = "und")), categories).items.size)
        assertEquals(1, ContentPolicy.live(listOf(channel(ids = listOf("us"), language = "unknown")), categories).items.size)
    }

    @Test fun trendingPolicyCannotAdmitUnknownOrForeignFeeds() {
        val items = listOf(channel("Unlabelled featured event"), channel("[UK] Featured event"), channel("[US] Featured event"))
        assertEquals(listOf("[US] Featured event"), ContentPolicy.live(items, emptyList()).items.map { it.name })
    }

    @Test fun m3uCountryAndLanguageAttributesReachThePolicy() {
        val parsed = M3u.parse(temp("""#EXTM3U
#EXTINF:-1 tvg-country="US" tvg-language="en-US" group-title="News",CNN
http://example/live/1.ts
#EXTINF:-1 tvg-country="US" tvg-language="Spanish" group-title="News",Another feed
http://example/live/2.ts
#EXTINF:-1 tvg-country="GB" tvg-language="eng" group-title="Movies",An English movie
http://example/movie/3.mp4
"""))
        assertEquals("US", parsed.channels.first().country)
        assertEquals("en-US", parsed.channels.first().language)
        assertEquals(listOf("CNN", "Another feed"), ContentPolicy.live(parsed.channels, parsed.liveCategories).items.map { it.name })
        assertEquals(1, ContentPolicy.movies(parsed.movies, parsed.movieCategories).items.size)
    }

    @Test fun xtreamDuplicateMetadataConflictsArePreservedAndRejected() {
        val x = Xtream(Source("test", "Test", SourceType.XTREAM, "http://example", "user", "pass"))
        val parsed = x.parseLive(temp("""[
            {"stream_id":1,"name":"CNN","category_id":"us","country":"US","language":"en"},
            {"stream_id":1,"name":"CNN","category_id":"uk","country":"GB","language":"en"},
            {"stream_id":2,"name":"NBC","category_id":"us","country_code":"USA","audio_language":"eng"}
        ]"""), "ts")
        assertEquals("US;GB", parsed.first().country)
        assertEquals(listOf("NBC"), ContentPolicy.live(parsed, categories).items.map { it.name })
        val movies = x.parseMovies(temp("""[{"stream_id":1,"name":"A Movie","category_id":"en","original_language":"en","audio_language":"es"}]"""))
        assertEquals(1, ContentPolicy.movies(movies, categories).items.size)
    }

    @Test fun genreOnlyLibrariesShowAllTitlesIncludingMarkedForeign() {
        // mybunny-style: every movie category is a genre, so no title carries a language label.
        val genres = listOf(Category("1", "Action"), Category("2", "Sci-Fi"), Category("3", "TV Movie"), Category("4", "Reality-TV"))
        val movies = listOf(
            movie("Grafted (2024)", listOf("1")), movie("Invisibles FRENCH (2025)", listOf("2")),
            movie("Los Domingos (2025)", listOf("3")), movie("Spanish movie", listOf("4"), language = "es"),
            movie("Dune: Part Two (2024)", listOf("2")),
        )
        assertEquals(movies.map { it.name }, ContentPolicy.movies(movies, genres).items.map { it.name })
        val shows = listOf(series("NCIS: Los Angeles", listOf("1")), series("Yoroiden Samurai Troopers E17 FRENCH", listOf("1")))
        assertEquals(shows.map { it.name }, ContentPolicy.series(shows, genres).items.map { it.name })
    }

    @Test fun tvInCategoryNamesIsNotTuvalu() {
        val cats = listOf(Category("t", "Tubi TV (USA)"), Category("r", "US Roku & Free TV"))
        val result = ContentPolicy.live(listOf(channel("A", listOf("t")), channel("B", listOf("r"))), cats)
        assertEquals(listOf(listOf("t"), listOf("r")), result.items.map { it.categoryIds })
    }

    @Test fun streamingServiceLabelsCarryTheirCountry() {
        val cats = listOf(Category("us", "United States"))
        val items = listOf(
            channel("(PLUTO USA) Frasier", listOf("us")), channel("(PLUTO Denmark) Frasier", listOf("us")),
            channel("(PLUTO Latin) Novelas", listOf("us")), channel("The Walking Dead en español", listOf("us")),
        )
        assertEquals(listOf("(PLUTO USA) Frasier", "(PLUTO Latin) Novelas", "The Walking Dead en español"), ContentPolicy.live(items, cats).items.map { it.name })
    }
}

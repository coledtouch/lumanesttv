import Foundation
import XCTest
@testable import TunerCore

/// Ports of Android AdultContentTest and StoreEditionTest (the App Store build uses the store edition's strict rules).
final class AdultFilterTests: XCTestCase {
    func testStandardNamesAreStandaloneTokens() {
        for name in ["XXX | Adult", "Adults 18+", "FOR ADULTS", "xxx", "Adult", "PORN", "18+ Movies", "VOD: XXX", "[XXX] Channels", "Adult Swim | XXX"] {
            XCTAssertTrue(AdultFilter.isAdultName(name, mode: .standard), name)
        }
        for name in ["Essex", "Taxxi", "Adult Swim", "ADULT SWIM HD", "adultswim", "Sports", "Kids", "Mature Drama", "118 News", "Pornic Travel", "XXXL Shows", ""] {
            XCTAssertFalse(AdultFilter.isAdultName(name, mode: .standard), name)
        }
        XCTAssertFalse(AdultFilter.isAdultName(nil, mode: .standard))
    }

    func testStrictNamesKeepTheStandardRulesAndAdultSwim() {
        for name in ["+18", "18 +", "18 PLUS", "ADULTOS", "Adulte", "Adulti", "PORNO", "EROTIC", "Erotica", "X-X-X", "PORNHUB", "XXX", "Adults", "NSFW", "Hentai"] {
            XCTAssertTrue(AdultFilter.isAdultName(name, mode: .strict), name)
        }
        // These spellings were never hidden by the standard rules and still aren't.
        for name in ["+18", "18 PLUS", "ADULTOS", "PORNO", "EROTIC"] { XCTAssertFalse(AdultFilter.isAdultName(name, mode: .standard), name) }
        for name in ["Adult Swim", "Essex", "Taxxi", "Sports", "118 News", "Pornic Travel", "XXXL Shows", "Adultery Drama", "Xxxtra Large"] {
            XCTAssertFalse(AdultFilter.isAdultName(name, mode: .strict), name)
        }
        // Android spells the exemption with whitespace only: "Adult-Swim" stays adult (the safer result for the App Store).
        XCTAssertTrue(AdultFilter.isAdultName("Adult-Swim", mode: .strict))
        XCTAssertTrue(AdultFilter.isAdultName("Adult-Swim", mode: .standard))
    }

    func testItemTitles() {
        XCTAssertTrue(AdultFilter.isAdultTitle("US: PLAYBOY TV HD", live: true))
        XCTAssertFalse(AdultFilter.isAdultTitle("Playboy: The Story", live: false), "network names only count for live channels")
        XCTAssertFalse(AdultFilter.isAdultTitle("Adult Swim", live: true))
        XCTAssertFalse(AdultFilter.isAdultTitle("Young Adult", live: false), "titles never match a bare \"adult\"")
        XCTAssertTrue(AdultFilter.isAdultTitle("Late Show 18+", live: false))
        XCTAssertTrue(AdultFilter.isAdultTitle("Brazzers Live", live: true))
        XCTAssertFalse(AdultFilter.isAdultTitle(nil, live: true))
        XCTAssertFalse(AdultFilter.isAdultTitle("  ", live: true))
    }

    func testTheXxxFilmsStayVisibleInAnyCapitalisation() {
        for name in ["xXx", "XXX (2002)", "EN - XXX (2002)", "XXX: Return of Xander Cage (2017)", "XXX - State of the Union",
                     "XXX: STATE OF THE UNION (2005)", "XXX 2: The Next Level", "xxx: the return of xander cage"] {
            XCTAssertFalse(AdultFilter.isAdultTitle(name, live: false), name)
        }
        for name in ["XXX Parody", "XXX (2019)", "XXX 2002 Hits", "Hot XXX: Return", "xXx XXX Party", "XXX: Next Door"] {
            XCTAssertTrue(AdultFilter.isAdultTitle(name, live: false), name)
        }
    }

    func testProviderFlagCountsInEveryShape() {
        for value in ["1", "true", "TRUE", " 1 ", "1.0", "yes", "2"] { XCTAssertTrue(AdultFilter.isAdultFlag(value), value) }
        for value in ["0", "false", "", "no", "0.0", "0.5", "-1", "nan"] { XCTAssertFalse(AdultFilter.isAdultFlag(value), value) }
        XCTAssertFalse(AdultFilter.isAdultFlag(nil))
        XCTAssertTrue(AdultFilter.isAdult(Category(id: "7", name: "Late Night", adult: true), mode: .standard))
        XCTAssertFalse(AdultFilter.isAdult(Category(id: "8", name: "Late Night"), mode: .strict))
        XCTAssertEqual(AdultFilter.adultCategoryIDs([Category(id: "a", name: "XXX"), Category(id: "b", name: "News"), Category(id: "c", name: "ADULTOS")], mode: .strict), ["a", "c"])
    }

    func testFilterHasNoUnlockAndChecksNamesOnlyWhenStrict() {
        let categories = [Category(id: "news", name: "News"), Category(id: "x", name: "XXX")]
        let items = [channel("1", "CNN", category: "news"), channel("2", "Hot", category: "x"), channel("3", "XXX Live", category: "news"),
                     channel("4", "Flagged", category: "news", adult: true), channel("5", "Both", categories: ["news", "x"])]
        func names(_ mode: AdultFilter.Mode) -> [String] {
            AdultFilter.filter(items, categories: categories, mode: mode, live: true, categoryIDs: { $0.categoryIDs }, name: { $0.name },
                               flagged: { $0.adult }).map(\.name)
        }
        XCTAssertEqual(names(.standard), ["CNN", "XXX Live"])
        XCTAssertEqual(names(.strict), ["CNN"])
    }

    /// The App Store build fails closed: a title or channel listed only in categories the provider's category list
    /// doesn't have (a deleted or hidden category, maybe an adult one) can't be checked, so it isn't shown.
    func testStrictDropsItemsWhoseCategoriesAreAllUnknown() {
        let categories = [Category(id: "news", name: "News"), Category(id: "x", name: "XXX")]
        let live = [channel("1", "CNN", category: "news"), channel("2", "Orphan", category: "gone"), channel("3", "Mixed", categories: ["gone", "news"]),
                    channel("4", "Loose", category: "", categories: [""])]
        func names(_ mode: AdultFilter.Mode, _ list: [TunerCore.Category]) -> [String] {
            AdultFilter.filter(live, categories: list, mode: mode, live: true, categoryIDs: { $0.categoryIDs }, name: { $0.name },
                               flagged: { $0.adult }).map(\.name)
        }
        XCTAssertEqual(names(.strict, categories), ["CNN", "Mixed", "Loose"])
        XCTAssertEqual(names(.standard, categories), ["CNN", "Orphan", "Mixed", "Loose"])
        XCTAssertEqual(names(.strict, []), ["Loose"], "no category list: nothing categorized can be checked")

        let movies = [movie("m:1", "Heat", category: "news"), movie("m:2", "Orphan", category: "9999")]
        XCTAssertEqual(ContentPolicy.movies(movies, categories: categories, edition: .appStore).items.map(\.name), ["Heat"])
        XCTAssertEqual(ContentPolicy.movies(movies, categories: categories, edition: .direct).items.map(\.name), ["Heat", "Orphan"])
        let shows = [series("s:1", "Drama", category: "news"), series("s:2", "Orphan", category: "9999")]
        XCTAssertEqual(ContentPolicy.series(shows, categories: categories, edition: .appStore).items.map(\.name), ["Drama"])
        let channels = ContentPolicy.live(live, categories: categories, usOnly: false, edition: .appStore)
        XCTAssertEqual(channels.items.map(\.name), ["CNN", "Mixed", "Loose"])
        let parsed = CatalogService.parseLive(live, categories, guideURL: nil, edition: .appStore, date: Date(timeIntervalSince1970: 0))
        XCTAssertEqual(parsed.channels.map(\.name), ["CNN", "Mixed", "Loose"])
    }
}

/// Ports of Android ContentPolicyTest (USA-only rules) plus the store-edition policy tests.
final class ContentPolicyTests: XCTestCase {
    private let categories = [
        Category(id: "us", name: "USA | Entertainment"), Category(id: "uk", name: "UK | Entertainment"),
        Category(id: "en", name: "English Movies"), Category(id: "es", name: "USA | Spanish / Latino"),
        Category(id: "genre", name: "Action"), Category(id: "uken", name: "UK | English Series"),
    ]

    private func ch(_ name: String = "CNN", _ ids: [String] = ["genre"], country: String? = nil, language: String? = nil, epg: String? = nil) -> Channel {
        Channel(key: name, number: 100, name: name, categoryID: ids.first ?? "", categoryIDs: ids, epgID: epg,
                url: URL(string: "http://example.com/live/1.ts")!, country: country, language: language)
    }

    private func ch(ids: [String], country: String? = nil, language: String? = nil) -> Channel {
        ch("CNN", ids, country: country, language: language)
    }

    // `TunerCore.Category`: on Apple platforms Foundation also brings in the Objective-C runtime's `Category` typedef,
    // which makes a bare `Category` ambiguous in a type position outside TunerCore (initializer calls are fine).
    private func live(_ items: [Channel], _ categories: [TunerCore.Category]? = nil, usOnly: Bool = true, edition: Edition = .direct) -> Catalogue<Channel> {
        ContentPolicy.live(items, categories: categories ?? self.categories, usOnly: usOnly, edition: edition)
    }

    func testWithoutUsOnlyLiveShowsTheWholeLineupTheHubChose() {
        let items = [ch("USA CNN", ["us"]), ch("BBC", ["uken"]), ch("Unlabelled feed"), ch("[UK] Sky News", ["uk"], country: "GB"), ch("Loose feed", [])]
        let result = live(items, usOnly: false)
        XCTAssertEqual(result.items.map(\.name), items.map(\.name))
        XCTAssertEqual(Set(result.categories.map(\.id)), ["us", "uken", "genre", "uk", "__tuner_live"])
        XCTAssertEqual(result.items.last?.categoryIDs, ["__tuner_live"])
        XCTAssertEqual(result.categories.last, Category(id: "__tuner_live", name: "Live TV"))
        XCTAssertEqual(live(items).items.map(\.name), ["USA CNN"])
        XCTAssertEqual(live(items, usOnly: false, edition: .appStore).items.map(\.name), items.map(\.name))
    }

    func testUnknownLiveCountryStaysHidden() {
        XCTAssertTrue(live([ch()]).items.isEmpty)
    }

    func testLiveRequiresUsRatherThanEnglishAlone() {
        let items = [ch("USA CNN", ["us"]), ch("BBC", ["uken"]), ch("English feed", language: "en")]
        XCTAssertEqual(live(items).items.map(\.name), ["USA CNN"])
    }

    func testOrdinaryWordsInsideRegionLabelsDoNotBecomeForeignCountries() {
        XCTAssertEqual(live([ch(ids: ["us"])], [Category(id: "us", name: "US Sports in English")]).items.count, 1)
    }

    func testMarkedUsPrefixesAndEpgSuffixArePositiveEvidence() {
        let items = ["|US| CNN", "[USA] NBC", "US: CBS", "USA - ABC"].map { ch($0) } + [ch("FOX", epg: "FOX.us")]
        XCTAssertEqual(live(items).items.count, 5)
    }

    func testExplicitForeignMarkersVetoUsEvenAfterAnotherMarkerOrLanguage() {
        let names = ["[US] [IN] News", "[US / India] News", "(PLUTO US / IN) News", "[English / IT] News", "[US] [Tuvalu] News", "[US] [ca] News"]
        XCTAssertTrue(live(names.map { ch($0, ["us"]) }).items.isEmpty)
    }

    func testCompoundAndServiceMarkersPreserveMultiwordForeignCountryVetoes() {
        let names = ["(US / United Kingdom) News", "(PLUTO United Kingdom) News", "(PLUTO South Korea) News", "[US South Korea] News",
                     "[US English United Kingdom] News", "[US] (Plex New Zealand) News", "USA / United Arab Emirates: News"]
        XCTAssertTrue(live(names.map { ch($0, ["us"]) }).items.isEmpty)
    }

    func testCompoundMultiwordUsAliasesAllowLanguagesButNotOrdinaryTitleWords() {
        let names = ["(PLUTO United States) News", "(PLUTO English United States of America) News", "[English United States Spanish] News",
                     "[USA / United States of America] News"]
        XCTAssertEqual(live(names.map { ch($0) }).items.map(\.name), names)
        let ordinary = ["[Made in United States] News", "[US / ordinary title] News", "The Last of Us: Part One"]
        XCTAssertTrue(live(ordinary.map { ch($0) }).items.isEmpty)
    }

    func testMarkedServiceAndLanguageCombinationsPreserveUsEvidence() {
        let names = ["(PLUTO USA / English) Local news", "[English] [United States] Local news", "US / Spanish: Local news", "[US] News (English)"]
        XCTAssertEqual(live(names.map { ch($0) }).items.map(\.name), names)
        let ordinary = ["The Last of Us: Part One", "Made in USA: Documentary", "[USA Documentary] News"]
        XCTAssertTrue(live(ordinary.map { ch($0) }).items.isEmpty)
    }

    func testTvQualityWordsStayDistinctFromAnExplicitTuvaluMarker() {
        let result = live([ch("[TV] Local channel", ["us"]), ch("[Tuvalu] Foreign channel", ["us"])], [Category(id: "us", name: "Tubi TV (USA)")])
        XCTAssertEqual(result.items.map(\.name), ["[TV] Local channel"])
    }

    func testCountryAndEnglishMetadataAliasesAreSupported() {
        let countries = ["US", "USA", "United States", "United States of America", "U.S.A."]
        let languages = ["en", "eng", "English", "en-US", "EN_gb"]
        let items = countries.indices.map { ch("Channel \($0)", country: countries[$0], language: languages[$0]) }
        XCTAssertEqual(live(items).items.count, 5)
    }

    func testForeignItemMetadataOrLabelsOverrideUsCategory() {
        let items = [
            ch("CNN Canada", ["us"], country: "CA"), ch("CNN Español", ["us"], language: "es"), ch("[UK] BBC", ["us"]),
            ch("[uk] BBC lowercase", ["us"]), ch("[ca] CNN", ["us"]), ch("[ES] ABC", ["us"]), ch("Foreign EPG", ["us"], epg: "bbc.uk"),
            ch("Conflicting language", ["us"], language: "en;spa"), ch("Conflicting country", ["us"], country: "US;GB"),
        ]
        XCTAssertEqual(live(items).items.map(\.name), ["CNN Español", "Conflicting language"])
    }

    func testSpanishUsNetworksAreAvailable() {
        let names = ["Telemundo52", "Univisión", "UniMás", "Galavision", "ESPN Deportes", "FOX Deportes", "Universo", "TUDN", "Estrella TV"]
        XCTAssertEqual(live(names.map { ch($0, ["us"], country: "US") }).items.map(\.name), names)
    }

    func testMixedCategoryMembershipsKeepOnlySafeCategories() {
        let result = live([ch(ids: ["uk", "us", "es", "genre"])])
        XCTAssertEqual(result.items.first?.categoryIDs, ["us", "es", "genre"])
        XCTAssertEqual(result.items.first?.categoryID, "us")
        XCTAssertEqual(Set(result.categories.map(\.id)), ["us", "es", "genre"])
        let lower = live([ch(ids: ["uk", "us"])], [Category(id: "us", name: "USA News"), Category(id: "uk", name: "uk | Entertainment")])
        XCTAssertEqual(lower.items.first?.categoryIDs, ["us"])
        XCTAssertEqual(lower.categories.map(\.id), ["us"])
    }

    func testSafeMetadataGetsFallbackWhenEveryCategoryIsForeign() {
        let result = live([ch(ids: ["uk"], country: "US", language: "English")])
        XCTAssertEqual(result.categories, [Category(id: "__tuner_us", name: "USA")])
        XCTAssertEqual(result.items.first?.categoryID, "__tuner_us")
    }

    func testUnknownAudioLanguageDoesNotHideUsChannels() {
        XCTAssertEqual(live([ch(ids: ["us"], language: "unknown")]).items.count, 1)
    }

    func testTrendingPolicyCannotAdmitUnknownOrForeignFeeds() {
        let items = [ch("Unlabelled featured event"), ch("[UK] Featured event"), ch("[US] Featured event")]
        XCTAssertEqual(live(items, []).items.map(\.name), ["[US] Featured event"])
    }

    func testTvInCategoryNamesIsNotTuvalu() {
        let result = live([ch("A", ["t"]), ch("B", ["r"])], [Category(id: "t", name: "Tubi TV (USA)"), Category(id: "r", name: "US Roku & Free TV")])
        XCTAssertEqual(result.items.map(\.categoryIDs), [["t"], ["r"]])
    }

    func testStreamingServiceLabelsCarryTheirCountry() {
        let items = [ch("(PLUTO USA) Frasier", ["us"]), ch("(PLUTO Denmark) Frasier", ["us"]), ch("(PLUTO Latin) Novelas", ["us"]),
                     ch("The Walking Dead en español", ["us"])]
        XCTAssertEqual(live(items, [Category(id: "us", name: "United States")]).items.map(\.name),
                       ["(PLUTO USA) Frasier", "(PLUTO Latin) Novelas", "The Walking Dead en español"])
    }

    func testSportsLeaguesAndServicesMarkUSCategories() {
        let result = live([ch("A", ["nfl"]), ch("B", ["pea"]), ch("C", ["tv"])],
                          [Category(id: "nfl", name: "NFL Game Pass"), Category(id: "pea", name: "Peacock Events"), Category(id: "tv", name: "Kids TV")])
        XCTAssertEqual(result.items.map(\.name), ["A", "B"])
    }

    func testDuplicateKeysAppearOnce() {
        let result = live([ch("Same", ["us"]), ch("Same", ["us"])], usOnly: false)
        XCTAssertEqual(result.items.count, 1)
    }

    func testM3UCountryAndLanguageAttributesReachThePolicy() {
        let text = """
        #EXTM3U
        #EXTINF:-1 tvg-country="US" tvg-language="en-US" group-title="News",CNN
        http://example.com/live/1.ts
        #EXTINF:-1 tvg-country="US" tvg-language="Spanish" group-title="News",Another feed
        http://example.com/live/2.ts
        #EXTINF:-1 tvg-country="GB" tvg-language="eng" group-title="Movies",An English movie
        http://example.com/movie/3.mp4
        """
        let parsed = M3UParser.parse(Data(text.utf8))
        XCTAssertEqual(parsed.channels.first?.country, "US")
        XCTAssertEqual(live(parsed.channels, parsed.liveCategories).items.map(\.name), ["CNN", "Another feed"])
        XCTAssertEqual(ContentPolicy.movies(parsed.movies, categories: parsed.movieCategories).items.count, 1)
    }

    func testXtreamDuplicateMetadataConflictsArePreservedAndRejected() throws {
        let data = Data("""
        [{"stream_id":1,"name":"CNN","category_id":"us","country":"US","language":"en"},
         {"stream_id":1,"name":"CNN","category_id":"uk","country":"GB","language":"en"},
         {"stream_id":2,"name":"NBC","category_id":"us","country_code":"USA","audio_language":"eng"}]
        """.utf8)
        let parsed = try XtreamParser.live(data, login: demoLogin)
        XCTAssertEqual(parsed.first?.country, "US;GB")
        XCTAssertEqual(parsed.first?.language, "en")
        XCTAssertEqual(live(parsed).items.map(\.name), ["NBC"])
    }

    // MARK: adult content in every catalogue

    func testLockedCataloguesDropAdultCategoriesAndTheirItems() {
        let categories = [Category(id: "news", name: "USA | News"), Category(id: "xxx", name: "USA | XXX"),
                          Category(id: "flag", name: "USA | Night", adult: true), Category(id: "swim", name: "USA | Adult Swim")]
        let items = [ch("CNN", ["news"]), ch("Hot", ["xxx"]), ch("Both", ["news", "xxx"]), ch("Flagged cat", ["flag"]),
                     ch("Flagged item", ["news"]).flagged(), ch("Cartoons", ["swim"])]
        for edition in Edition.allCases {
            let all = live(items, categories, usOnly: false, edition: edition)
            XCTAssertEqual(all.items.map(\.name), ["CNN", "Cartoons"])
            XCTAssertEqual(Set(all.categories.map(\.id)), ["news", "swim"])
            XCTAssertEqual(live(items, categories, usOnly: true, edition: edition).items.map(\.name), ["CNN", "Cartoons"])
        }
    }

    func testStoreEditionHidesAdultCategoryVariantsAndChannelNames() {
        let categories = [Category(id: "ent", name: "USA | Entertainment"), Category(id: "plus", name: "+18 Movies"), Category(id: "es", name: "ADULTOS"),
                          Category(id: "ero", name: "Erotica"), Category(id: "xxx", name: "XXX"), Category(id: "swim", name: "USA | Adult Swim")]
        let items = [ch("CNN", ["ent"]), ch("Playboy TV", ["ent"]), ch("XXX Live", ["ent"]), ch("Hot Movies", ["plus"]),
                     ch("Canal Rojo", ["es"]), ch("Night", ["ero"]), ch("Late", ["xxx"]), ch("Cartoons", ["swim"])]
        XCTAssertEqual(live(items, categories, usOnly: false, edition: .direct).items.map(\.name),
                       ["CNN", "Playboy TV", "XXX Live", "Hot Movies", "Canal Rojo", "Night", "Cartoons"])
        let store = live(items, categories, usOnly: false, edition: .appStore)
        XCTAssertEqual(store.items.map(\.name), ["CNN", "Cartoons"])
        XCTAssertEqual(Set(store.categories.map(\.id)), ["ent", "swim"])
        XCTAssertEqual(live(items, categories, usOnly: true, edition: .appStore).items.map(\.name), ["CNN", "Cartoons"])
        // The default edition is the App Store one.
        XCTAssertEqual(ContentPolicy.live(items, categories: categories, usOnly: false).items.map(\.name), ["CNN", "Cartoons"])
    }

    func testStoreEditionChecksTitlesWithoutHidingOrdinaryFilms() {
        let categories = [Category(id: "a", name: "Action"), Category(id: "e", name: "Erotic")]
        let movies = [movie("m:1", "Heat", category: "a"), movie("m:2", "xXx: Return of Xander Cage", category: "a"),
                      movie("m:3", "The Hustler", category: "a"), movie("m:4", "Young Adult", category: "a"),
                      movie("m:5", "XXX Parody", category: "a"), movie("m:6", "Late Show 18+", category: "a"), movie("m:7", "Velvet", category: "e")]
        XCTAssertEqual(ContentPolicy.movies(movies, categories: categories, edition: .direct).items.map(\.name), movies.map(\.name))
        XCTAssertEqual(ContentPolicy.movies(movies, categories: categories, edition: .appStore).items.map(\.name),
                       ["Heat", "xXx: Return of Xander Cage", "The Hustler", "Young Adult"])
        let shows = [series("s:1", "The Penthouse", category: "a"), series("s:2", "Porn Stars Uncovered", category: "a"),
                     series("s:3", "After Dark", category: "e")]
        XCTAssertEqual(ContentPolicy.series(shows, categories: categories, edition: .direct).items.count, 3)
        XCTAssertEqual(ContentPolicy.series(shows, categories: categories, edition: .appStore).items.map(\.name), ["The Penthouse"])
    }

    func testMoviesAndSeriesFollowTheSameLock() {
        let categories = [Category(id: "a", name: "Action"), Category(id: "x", name: "FOR ADULTS")]
        let movies = [movie("m:1", "Heat", category: "a"), movie("m:2", "Night", category: "x"), movie("m:3", "Flagged", category: "a", adult: true)]
        XCTAssertEqual(ContentPolicy.movies(movies, categories: categories).items.map(\.name), ["Heat"])
        let shows = [series("s:1", "Drama", category: "a"), series("s:2", "After Dark", category: "x")]
        let result = ContentPolicy.series(shows, categories: categories)
        XCTAssertEqual(result.items.map(\.name), ["Drama"])
        XCTAssertEqual(result.categories.map(\.id), ["a"])
    }

    func testMoviesAppleTVCantPlayAreLeftOut() {
        let movies = [movie("m:1", "A", ext: "mp4"), movie("m:2", "B", ext: "mkv"), movie("m:3", "C", ext: "avi"), movie("m:4", "D", ext: "m4v"),
                      movie("m:5", "E", ext: "mov"), movie("m:6", "F", ext: nil)]
        XCTAssertEqual(ContentPolicy.movies(movies, categories: [Category(id: "c", name: "Movies")]).items.map(\.id), ["m:1", "m:4", "m:5", "m:6"])
    }

    func testFallbackCategoriesForUncategorizedTitles() {
        let movies = ContentPolicy.movies([movie("m:1", "A", category: "", categories: [])], categories: [])
        XCTAssertEqual(movies.items.first?.categoryIDs, ["__tuner_movies"])
        XCTAssertEqual(movies.categories, [Category(id: "__tuner_movies", name: "Movies")])
        let shows = ContentPolicy.series([series("s:1", "A", category: "", categories: [])], categories: [])
        XCTAssertEqual(shows.categories, [Category(id: "__tuner_series", name: "Series")])
    }

    func testVODIncludesForeignAndUnknownLanguagesAndCountries() {
        let items = [movie("m:1", "English UK movie", category: "genre"), movie("m:2", "Provider English label", category: "uken"), movie("m:3", "US provider movie", category: "us"),
                     movie("m:4", "Spanish movie", category: "en"), movie("m:5", "Unknown-language UK movie", category: "uk"), movie("m:6", "[ES] Dubbed movie", category: "en")]
        XCTAssertEqual(ContentPolicy.movies(items, categories: categories).items.map(\.name), items.map(\.name))
        let shows = ContentPolicy.series([series("s:1", "A", categories: ["es", "uk", "en", "genre"])], categories: categories)
        XCTAssertEqual(shows.items.first?.categoryIDs, ["es", "uk", "en", "genre"])
    }

    func testCountryAliases() {
        XCTAssertEqual(Countries.code(forAlias: "usa"), "US")
        XCTAssertEqual(Countries.code(forAlias: " United States of America "), "US")
        XCTAssertEqual(Countries.code(forAlias: "U.S.A."), "US")
        XCTAssertEqual(Countries.code(forAlias: "uk"), "GB")
        XCTAssertEqual(Countries.code(forAlias: "Great Britain"), "GB")
        XCTAssertEqual(Countries.code(forAlias: "DEU"), "DE")
        XCTAssertEqual(Countries.code(forAlias: "germany"), "DE")
        XCTAssertEqual(Countries.code(forAlias: "south korea"), "KR")
        XCTAssertNil(Countries.code(forAlias: "tv"), "Tuvalu's code is left out")
        XCTAssertEqual(Countries.code(forAlias: "tuvalu"), "TV")
        XCTAssertNil(Countries.code(forAlias: "english"))
    }
}

private extension Channel {
    func flagged() -> Channel {
        var copy = self
        copy.adult = true
        return copy
    }
}

/// Ports of Android CleanupTest and MatchTest.
final class CleanupTests: XCTestCase {
    private func ch(_ key: String, _ name: String, epg: String? = nil, cats: [String] = ["us"]) -> Channel {
        Channel(key: key, number: 0, name: name, categoryID: cats[0], categoryIDs: cats, epgID: epg, streamID: key,
                url: URL(string: "http://h/live/u/p/\(key).ts")!)
    }

    func testCountryAndFeedTagsComeOff() {
        XCTAssertEqual(Cleanup.displayName("US: ESPN"), "ESPN")
        XCTAssertEqual(Cleanup.displayName("(US) (SP) MeTV (KAZA)"), "MeTV (KAZA)")
        XCTAssertEqual(Cleanup.displayName("US TLC (East) (H)"), "TLC (East)")
        XCTAssertEqual(Cleanup.displayName("US: NATIONAL GEOGRAPHIC HD"), "NATIONAL GEOGRAPHIC")
        XCTAssertEqual(Cleanup.displayName("(STV) (USA) BYUtv"), "BYUtv")
        XCTAssertEqual(Cleanup.displayName("(PLUTO USA) Storage Wars by A&E"), "Storage Wars by A&E")
        XCTAssertEqual(Cleanup.displayName("(US) (A) (Yakima) PBS KTNW"), "PBS KTNW (Yakima)")
        XCTAssertEqual(Cleanup.displayName("NBA TV (D) (1080p59 @ 9.4Mbps)"), "NBA TV")
        XCTAssertEqual(Cleanup.displayName("US (MAX) ESPN2 (HD @ 4.7 Mbps @ 29 FPS)"), "ESPN2")
        XCTAssertEqual(Cleanup.displayName("USA  TNT"), "TNT")
        XCTAssertEqual(Cleanup.displayName("USA Showtime Next"), "Showtime Next")
        XCTAssertEqual(Cleanup.displayName("USA MOVIE: STARZ East"), "STARZ East")
        XCTAssertEqual(Cleanup.displayName("USA REG: CBS (KCBS)"), "CBS (KCBS)")
        XCTAssertEqual(Cleanup.displayName("TBN (D) (Faith)"), "TBN (Faith)")
    }

    func testOfficialNamesKeepTheirUsa() {
        XCTAssertEqual(Cleanup.displayName("US: USA Network"), "USA Network")
        XCTAssertEqual(Cleanup.displayName("USA Network (West)"), "USA Network (West)")
        XCTAssertEqual(Cleanup.displayName("US USA (S)"), "USA")
        XCTAssertEqual(Cleanup.displayName("WWE Monday Night RAW"), "WWE Monday Night RAW")
        XCTAssertEqual(Cleanup.displayName("   "), "")
    }

    func testEmptyEventSlotsAreIdle() {
        for name in ["ESPN+ 78:", ":MAX US 71", "NHL | 13", "MLB 18: No event today", "Peacock | Event 20", "PPV EVENT 14",
                     "USHTV 06: No Game Scheduled", "Tennis TV 16: No Match Scheduled", "(MAX 093) | (2098 12 31 08:00:55)", "NHL 07 : Offline"] {
            XCTAssertTrue(Cleanup.isIdleEvent(name), name)
        }
        for name in ["ESPN", "FS1", "ESPN2", "NFL Network", "NBA 03: Thunder @ Hawks (10.12 7:00PM ET)", "FOX 5 (WNYW) New York",
                     "Ligue 1: Angers vs Marseille | Sunday, 18 October 2026 14:00", "Music Choice: 80s"] {
            XCTAssertFalse(Cleanup.isIdleEvent(name), name)
        }
    }

    func testEventsThatEndedOrAreDaysAwayAreOffAir() {
        let now = eastern(2026, 10, 12, 22, 0)
        XCTAssertTrue(Cleanup.isOffAir("NFL 10: Commanders vs Giants (10.11 1:00PM ET)", now: now))
        XCTAssertFalse(Cleanup.isOffAir("NBA 03: Thunder @ Hawks (10.12 7:00PM ET)", now: now))
        XCTAssertTrue(Cleanup.isOffAir("HBO 38: AEW Dynamite (10.21 8:00PM ET)", now: now))
        XCTAssertTrue(Cleanup.isOffAir("UFC 02 : FIGHT NIGHT start:2026 10 11 01:55:00 stop:2026 10 11 06:00:00", now: now))
        XCTAssertFalse(Cleanup.isOffAir("MLB 02 : Guardians x Rays start:2026 10 13 01:00:00 stop:2026 10 13 08:13:20", now: now))
        XCTAssertTrue(Cleanup.isOffAir("NBA 04 : Knicks vs Wizards @ Oct 8 7:30 PM", now: now))
        XCTAssertFalse(Cleanup.isOffAir("CNN", now: now))
        // Listings carry no year: December 31 seen on January 1 is last night.
        XCTAssertFalse(Cleanup.isOffAir("NYE Special (12.31 11:00PM ET)", now: eastern(2027, 1, 1, 0, 30)))
    }

    func testCopiesOfOneChannelFoldIntoOneEntryWithBackups() {
        let raw = [ch("x1", "US: CNN HD"), ch("x2", "US: CNN", epg: "CNN.us"), ch("x3", "USA: CNN (Backup)"),
                   ch("x4", "FOX: DALLAS TX KDFW"), ch("x5", "US FOX 4 (KDFW) Dallas (H)"),
                   ch("x6", "US: ABC 23 Eureka (KAEF)"), ch("x7", "(US) (FOX1) FOX 28 (KAEF)"),
                   ch("x8", "HBO (East)"), ch("x9", "HBO West"), ch("x10", "ESPN+ 78:")]
        let lineup = Cleanup.lineup(raw, hidden: [], now: utc(2026, 10, 12))
        XCTAssertEqual(lineup.channels.map(\.name), ["CNN", "FOX 4 (KDFW) Dallas", "ABC 23 Eureka (KAEF)", "FOX 28 (KAEF)", "HBO (East)", "HBO West"])
        let cnn = lineup.channels[0]
        XCTAssertEqual(cnn.key, "x2", "the copy with guide data leads")
        XCTAssertEqual(cnn.backups.map(\.absoluteString), ["http://h/live/u/p/x1.ts", "http://h/live/u/p/x3.ts"], "the (Backup) copy goes last")
        XCTAssertEqual(lineup.merged["x1"], "x2")
        XCTAssertEqual(lineup.merged["x3"], "x2")
        XCTAssertEqual(lineup.merged["x4"], "x5")
        XCTAssertNil(lineup.merged["x8"])
    }

    func testFoldedChannelsUnionCategoriesAndBorrowLogoAndGuideIDs() {
        var withLogo = ch("b", "CNN HD", cats: ["2"])
        withLogo.logo = URL(string: "http://logos/cnn.png")
        let lineup = Cleanup.lineup([ch("a", "CNN", cats: ["1"]), withLogo, ch("c", "CNN 720p", epg: "  ", cats: ["1", "3"])], hidden: [], now: Date())
        XCTAssertEqual(lineup.channels.count, 1)
        let kept = lineup.channels[0]
        XCTAssertEqual(kept.logo?.absoluteString, "http://logos/cnn.png")
        XCTAssertEqual(Set(kept.categoryIDs), ["1", "2", "3"])
        XCTAssertEqual(kept.backups.count, 2)
    }

    func testHiddenChannelsStayOut() {
        let lineup = Cleanup.lineup([ch("x1", "US: CNN"), ch("x2", "US: CNN HD")], hidden: ["x1"], now: Date())
        XCTAssertEqual(lineup.channels.map(\.key), ["x2"])
        XCTAssertTrue(lineup.channels[0].backups.isEmpty)
    }

    func testReuploadedMoviesFoldIntoTheNewestCopy() {
        let movies = [movie("m:1", "Grafted (2024)", category: "1", added: 10), movie("m:2", "Grafted (2024)", category: "2", added: 30, tmdb: 7),
                      movie("m:3", "Grafted (2023)", category: "1", added: 20), movie("m:4", "Grafted (2024)", category: "3", added: 40, ext: "mkv")]
        let out = Cleanup.movies(movies)
        XCTAssertEqual(out.map(\.id), ["m:2", "m:3"], "the MKV upload is never the kept one")
        XCTAssertEqual(out[0].categoryIDs, ["2", "1"])
        XCTAssertEqual(out[0].backups.map(\.lastPathComponent), ["m_1.mp4"])
        XCTAssertEqual(out[0].tmdbID, 7)
        XCTAssertTrue(out[1].backups.isEmpty)
        // tmdb/year/genre come from the first upload that has them.
        let borrowed = Cleanup.movies([movie("m:5", "Heat", added: 50), movie("m:6", "Heat", added: 1, year: "1995", tmdb: 949, genre: "Crime")])
        XCTAssertEqual(borrowed.first?.id, "m:5")
        XCTAssertEqual(borrowed.first?.tmdbID, 949)
        XCTAssertEqual(borrowed.first?.year, "1995")
        XCTAssertEqual(borrowed.first?.genre, "Crime")
    }

    func testChannelMatchKeysNormalizeProviderNoise() {
        let cnn = ChannelMatch.key("CNN")
        XCTAssertEqual(cnn, "cnn")
        for name in ["US: CNN HD", "|US| CNN ᴴᴰ", "[US] CNN (East)", "US - CNN FHD", "CNN 1080p"] { XCTAssertEqual(ChannelMatch.key(name), cnn, name) }
        XCTAssertEqual(ChannelMatch.key("USA Network"), ChannelMatch.key("US: USA Network HD"))
        XCTAssertEqual(ChannelMatch.idKey("FoxNews.us"), "foxnews")
        XCTAssertEqual(ChannelMatch.idKey("Fight.Network.us2"), "fightnetwork")
        XCTAssertEqual(ChannelMatch.key("A&E HD"), "ae")
        XCTAssertEqual(ChannelMatch.key("A and E HD East"), "ae")
        XCTAssertEqual(ChannelMatch.key("Home and Garden Television HD"), "hgtv")
        XCTAssertEqual(ChannelMatch.key("The Weather Channel"), "weather")
        XCTAssertEqual(ChannelMatch.key("NESN+"), "nesnplus")
        XCTAssertEqual(ChannelMatch.key("HBO West"), "hbo")
        XCTAssertTrue(ChannelMatch.isRegional("HBO (West)"))
        XCTAssertTrue(ChannelMatch.isRegional("KABC (P)"))
        XCTAssertFalse(ChannelMatch.isRegional("HBO"))
    }

    func testPlaybackSupport() {
        let url = URL(string: "http://h.example.com/movie/u/p/1.mkv")!
        XCTAssertEqual(PlaybackSupport.vodContainer(url: url, containerExtension: nil), .unsupported("mkv"))
        XCTAssertEqual(PlaybackSupport.vodContainer(url: url, containerExtension: "mp4"), .mp4, "the container extension wins")
        XCTAssertEqual(PlaybackSupport.vodContainer(url: url, containerExtension: ".M4V"), .mp4)
        XCTAssertEqual(PlaybackSupport.vodContainer(url: url, containerExtension: "mov"), .quickTime)
        XCTAssertEqual(PlaybackSupport.vodContainer(url: url, containerExtension: "m3u8"), .hls)
        XCTAssertEqual(PlaybackSupport.vodContainer(url: URL(string: "http://h.example.com/stream")!, containerExtension: nil), .unknown)
        XCTAssertEqual(PlaybackSupport.vodContainer(url: url, containerExtension: "xyz"), .unknown)
        for ext in ["mkv", "avi", "flv", "wmv", "ts", "webm", "mpg", "mpeg", "divx", "vob", "ogm", "rmvb", "3gp"] {
            XCTAssertFalse(PlaybackSupport.isPlayableVOD(url: url, containerExtension: ext), ext)
        }
        XCTAssertTrue(PlaybackSupport.isPlayableVOD(url: URL(string: "http://h.example.com/a")!, containerExtension: nil))
    }
}

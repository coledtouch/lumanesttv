import Foundation
import XCTest
@testable import TunerCore

final class LiveLineupTests: XCTestCase {
    private let lineup = LiveLineup(
        channels: ["a", "b", "c", "d", "x2"].map { channel($0, $0.uppercased()) },
        categories: [],
        aliases: ["x1": "x2", "x3": "x2", "old": "x1", "loop1": "loop2", "loop2": "loop1"],
        updated: Date(timeIntervalSince1970: 0))

    func testCanonicalKeysFollowChainsAndSurviveCycles() {
        XCTAssertEqual(lineup.canonical("x1"), "x2")
        XCTAssertEqual(lineup.canonical("old"), "x2")
        XCTAssertEqual(lineup.canonical("a"), "a")
        XCTAssertNotNil(["loop1", "loop2"].first { $0 == lineup.canonical("loop1") })
        XCTAssertEqual(lineup.channel(forKey: "old")?.key, "x2")
        XCTAssertNil(lineup.channel(forKey: "zzz"))
        XCTAssertEqual(lineup.keys(foldedInto: "x3"), ["x2", "old", "x1", "x3"])
        XCTAssertEqual(lineup.keys(foldedInto: "a"), ["a"])
    }

    func testNeighborsWrapAndSkipHiddenChannels() {
        let list = lineup.channels
        XCTAssertEqual(lineup.neighbor(of: "b", offset: 1, in: list)?.key, "c")
        XCTAssertEqual(lineup.neighbor(of: "b", offset: -1, in: list)?.key, "a")
        XCTAssertEqual(lineup.neighbor(of: "x2", offset: 1, in: list)?.key, "a")
        XCTAssertEqual(lineup.neighbor(of: "a", offset: -1, in: list)?.key, "x2")
        XCTAssertEqual(lineup.neighbor(of: "x1", offset: 1, in: list)?.key, "a", "folded keys resolve first")
        XCTAssertEqual(lineup.neighbor(of: "b", offset: 1, in: list, hidden: ["c"])?.key, "d")
        XCTAssertEqual(lineup.neighbor(of: "a", offset: 2, in: list, hidden: ["b"])?.key, "d")
        XCTAssertEqual(lineup.neighbor(of: "zzz", offset: 1, in: list)?.key, "a")
        XCTAssertEqual(lineup.neighbor(of: "zzz", offset: -1, in: list)?.key, "x2")
        XCTAssertEqual(lineup.neighbor(of: "c", offset: 0, in: list)?.key, "c")
        XCTAssertNil(lineup.neighbor(of: "a", offset: 1, in: list, hidden: Set(list.map(\.key))))
        XCTAssertNil(lineup.neighbor(of: "a", offset: 1, in: []))
    }
}

final class GuideScheduleTests: XCTestCase {
    private func at(_ hour: Int, _ minute: Int = 0) -> Date { utc(2026, 10, 12, hour, minute) }

    private lazy var schedule = GuideSchedule(programs: ["k": [
        Program(start: at(10, 15), end: at(11), title: "A"),
        Program(start: at(11), end: at(12, 30), title: "B", description: "b"),
        Program(start: at(14), end: at(15), title: "C"),
    ]])

    func testCurrentAndNext() {
        XCTAssertEqual(schedule.current(forKey: "k", at: at(10, 30))?.title, "A")
        XCTAssertEqual(schedule.current(forKey: "k", at: at(11))?.title, "B", "a programme starts at its start")
        XCTAssertNil(schedule.current(forKey: "k", at: at(13)))
        XCTAssertNil(schedule.current(forKey: "k", at: at(9)))
        XCTAssertNil(schedule.current(forKey: "missing", at: at(10, 30)))
        XCTAssertEqual(schedule.next(forKey: "k", after: at(11, 30))?.title, "C")
        XCTAssertNil(schedule.next(forKey: "k", after: at(14, 30)))
        XCTAssertEqual(schedule.upcoming(forKey: "k", from: at(10, 59)).map(\.title), ["A", "B", "C"])
        XCTAssertEqual(schedule.upcoming(forKey: "k", from: at(11), limit: 1).map(\.title), ["B"])
    }

    func testFilledWindowKeepsRealTimesAndPlugsGapsWithHourAlignedPlaceholders() {
        let filled = schedule.filled(forKey: "k", channelName: "CNN", window: DateInterval(start: at(9, 30), end: at(14, 30)))
        XCTAssertEqual(filled.map(\.title), ["CNN", "CNN", "A", "B", "CNN", "CNN", "C"])
        XCTAssertEqual(filled.map(\.placeholder), [true, true, false, false, true, true, false])
        XCTAssertEqual(filled.map(\.start), [at(9, 30), at(10), at(10, 15), at(11), at(12, 30), at(13), at(14)])
        XCTAssertEqual(filled.last?.end, at(15), "programmes keep their real times (the guide clips the cell, not the times shown)")
        XCTAssertEqual(filled[4].end, at(13), "placeholders stay inside the window")
        // A film that started before the window and ends after it is shown as 7:45 – 12:00.
        let film = GuideSchedule(programs: ["k": [Program(start: at(7, 45), end: at(12), title: "Film")]])
            .filled(forKey: "k", channelName: "CNN", window: DateInterval(start: at(8), end: at(10, 30)))
        XCTAssertEqual(film.map(\.title), ["Film"])
        XCTAssertEqual(film.first?.start, at(7, 45))
        XCTAssertEqual(film.first?.end, at(12))
        // Overlapping listings: the later one starts where the earlier one ends, so cells never overlap.
        let overlapping = GuideSchedule(programs: ["k": [Program(start: at(10), end: at(11), title: "A"), Program(start: at(10, 30), end: at(12), title: "B")]])
            .filled(forKey: "k", channelName: "CNN", window: DateInterval(start: at(10), end: at(12)))
        XCTAssertEqual(overlapping.map(\.start), [at(10), at(11)])
        let empty = GuideSchedule().filled(forKey: "k", channelName: "X", window: DateInterval(start: at(10, 30), end: at(12)))
        XCTAssertEqual(empty.map(\.start), [at(10, 30), at(11)])
        XCTAssertTrue(empty.allSatisfy(\.placeholder))
    }
}

final class XMLTVTests: XCTestCase {
    private let now = Date(timeIntervalSince1970: 1_791_842_400) // 2026-10-12 22:00 UTC
    private var window: DateInterval { DateInterval(start: now.addingTimeInterval(-4 * 3600), end: now.addingTimeInterval(3 * 86400)) }
    private let lineup = [channel("x:cnn", "US: CNN HD", epg: "CNN.us"), channel("x:sky", "Sky News"), channel("x:hbo", "HBO"),
                          channel("x:sky2", "Sky 2", epg: "Sky.News.uk"), channel("x:fox", "FOX 5", epg: "WNYW.us")]

    func testTimes() {
        XCTAssertEqual(XMLTV.parseTime("20261012180000 -0400"), XMLTV.parseTime("20261012220000 +0000"))
        XCTAssertEqual(XMLTV.parseTime("20261012220000 +0000"), now)
        XCTAssertEqual(XMLTV.parseTime("202610122200"), now, "no seconds, no offset: UTC")
        XCTAssertEqual(XMLTV.parseTime("20261012180000 -04:00"), now)
        XCTAssertEqual(XMLTV.parseTime("20261012230000+0100"), now)
        XCTAssertEqual(XMLTV.parseTime("20261013033000 +0530"), now)
        XCTAssertEqual(XMLTV.parseTime("20261012220000.000 +0000"), now)
        XCTAssertEqual(XMLTV.parseTime("19700101000000 +0000"), Date(timeIntervalSince1970: 0))
        XCTAssertEqual(XMLTV.parseTime("20240229120000 +0000"), utc(2024, 2, 29, 12), "leap day")
        for bad in ["garbage", "2026101", "20261312000000", "20261012256000", ""] { XCTAssertNil(XMLTV.parseTime(bad), bad) }
    }

    func testWantedChannels() {
        let wanted = XMLTV.Wanted(channels: lineup)
        XCTAssertEqual(wanted.ids, ["cnn.us", "sky.news.uk", "wnyw.us"])
        XCTAssertTrue(wanted.keys.isSuperset(of: ["cnn", "skynews", "hbo", "wnyw"]))
        XCTAssertTrue(wanted.keys.allSatisfy { $0.count >= 2 })
    }

    func testStreamingParseKeepsTheWindowAndWantedChannels() throws {
        let result = try XMLTV.parse(fileURL: Fixture.url("guide.xml"), window: window, wanted: XMLTV.Wanted(channels: lineup))
        XCTAssertEqual(Set(result.programs.keys), ["cnn.us", "skynews.uk", "hbo.us", "hbowest.us"])
        let cnn = result.programs["cnn.us"] ?? []
        XCTAssertEqual(cnn.map(\.title), ["The Situation Room", "Erin Burnett OutFront", "Overlaps the end"])
        XCTAssertEqual(cnn[0].start, now)
        XCTAssertEqual(cnn[0].subtitle, "Ep 4")
        XCTAssertEqual(cnn[0].description, "Politics & more.", "entities decoded, the first desc kept")
        XCTAssertNil(cnn[1].description, "empty descriptions are nil")
        XCTAssertEqual(cnn[2].start, cnn[1].end, "an overlapping programme starts where the previous one ends")
        XCTAssertEqual(result.programs["skynews.uk"]?.map(\.title), ["Sky Late", "Sky Midnight (no offset is UTC)"])
        XCTAssertEqual(result.icons["cnn.us"]?.absoluteString, "http://icons.example.com/cnn.png", "the first icon wins")
        XCTAssertEqual(result.icons["hbo.us"]?.absoluteString, "https://icons.example.com/hbo.png")
        XCTAssertEqual(result.nameToID["cnn"], "cnn.us")
        XCTAssertEqual(result.nameToID["skynews"], "skynews.uk")
        XCTAssertEqual(result.nameToID["hbo"], "hbo.us", "the main feed beats the West feed")
        XCTAssertNil(result.programs["ignored.us"])
    }

    func testGzippedFilesAndDataParseTheSame() throws {
        let wanted = XMLTV.Wanted(channels: lineup)
        let plain = try XMLTV.parse(fileURL: Fixture.url("guide.xml"), window: window, wanted: wanted)
        let directory = makeTemporaryDirectory(self)
        let packed = directory.appendingPathComponent("guide.xml")
        try Fixture.data("guide.xml.gz").write(to: packed)
        XCTAssertEqual(try XMLTV.parse(fileURL: packed, window: window, wanted: wanted), plain)
        XCTAssertEqual(try FileManager.default.contentsOfDirectory(atPath: directory.path), ["guide.xml"], "the inflated copy is removed")
        XCTAssertEqual(try XMLTV.parse(data: Fixture.data("guide.xml.gz"), window: window, wanted: wanted), plain)
        // An error page instead of a guide gives nothing (it never crashes or keeps stale names).
        let page = try? XMLTV.parse(data: Data("<html><body>Error 502</body></html>".utf8), window: window, wanted: wanted)
        XCTAssertTrue(page?.programs.isEmpty ?? true)
        XCTAssertTrue(page?.nameToID.isEmpty ?? true)
        let truncated = try? XMLTV.parse(data: Data("<tv><programme".utf8), window: window, wanted: wanted)
        XCTAssertTrue(truncated?.programs.isEmpty ?? true)
    }

    func testAssignMatchesByIDThenByNames() throws {
        let result = try XMLTV.parse(fileURL: Fixture.url("guide.xml"), window: window, wanted: XMLTV.Wanted(channels: lineup))
        let schedule = XMLTV.assign(result, to: lineup, now: now)
        XCTAssertEqual(schedule.programs["x:cnn"]?.count, 3)
        XCTAssertEqual(schedule.icons["x:cnn"]?.lastPathComponent, "cnn.png")
        XCTAssertEqual(schedule.programs["x:sky"]?.first?.title, "Sky Late", "matched by display name")
        XCTAssertEqual(schedule.programs["x:sky2"]?.first?.title, "Sky Late", "matched by the guide id's name key")
        XCTAssertEqual(schedule.programs["x:hbo"]?.first?.title, "Main feed film")
        XCTAssertNil(schedule.programs["x:fox"])
        XCTAssertEqual(schedule.updated, now)
        // Nothing that ends after `now`: no programmes assigned.
        let later = XMLTV.assign(result, to: lineup, now: utc(2026, 10, 13, 2))
        XCTAssertNil(later.programs["x:cnn"])
        XCTAssertEqual(later.icons["x:cnn"]?.lastPathComponent, "cnn.png")
    }

    func testLogoIndex() throws {
        let index = try LogoIndex(json: Fixture.data("logos.json"))
        let cnn = channel("x:1", "CNN")
        XCTAssertEqual(index.logo(for: cnn, xmltvIcon: nil)?.absoluteString, "https://logos.example.com/cnn-us.png", ".us ids win")
        XCTAssertEqual(index.logo(for: channel("x:2", "Fox News Channel HD", epg: "FoxNews.us"), xmltvIcon: nil)?.lastPathComponent, "foxnews.png")
        XCTAssertNil(index.logo(for: channel("x:3", "Retired"), xmltvIcon: nil), "logos no longer in use are skipped")
        XCTAssertNil(index.logo(for: channel("x:4", "BadUrl"), xmltvIcon: nil))
        XCTAssertEqual(index.logo(for: cnn, xmltvIcon: URL(string: "http://x/icon.png"))?.absoluteString, "http://x/icon.png")
        var own = cnn
        own.logo = URL(string: "http://own/logo.png")
        XCTAssertEqual(index.logo(for: own, xmltvIcon: URL(string: "http://x/icon.png"))?.absoluteString, "http://own/logo.png")
        XCTAssertNil(LogoIndex().logo(for: cnn, xmltvIcon: nil))
        XCTAssertThrowsError(try LogoIndex(json: Data("nope".utf8)))
    }
}

/// Ports of Android GuideCategoryOrderTest plus the guide lineups.
final class GuideLineupTests: XCTestCase {
    private func ids(_ chips: [GuideChipItem]) -> [String] {
        chips.map { chip in
            switch chip.chip {
            case .all: return "__all"
            case .favorites: return "__fav"
            case .mostWatched: return "__hot"
            case .category(let id): return id
            }
        }
    }

    func testRequestedCableGroupsImmediatelyFollowMostWatched() {
        let categories = [("local", "Local news"), ("other", "US Kids"), ("d", "US Documentaries"), ("n", "US News"), ("e", "US Entertainment"),
                          ("m", "US Movies"), ("p", "USA Premium"), ("s", "US Sports")].map { Category(id: $0.0, name: $0.1) }
        let chips = GuideLineup.chips(categories, order: .featured)
        XCTAssertEqual(ids(chips), ["__all", "__fav", "__hot", "s", "p", "n", "m", "e", "d", "local", "other"])
        XCTAssertEqual(chips.prefix(3).map(\.title), ["All Channels", "Favorites", "Most Watched"])
    }

    func testPunctuationAndCountryAliasesSortWithoutChangingIDsOrLabels() {
        let categories = [("news", "US: News"), ("sport", "USA | Sports"), ("premium", "USA Premium"), ("other-a", "Kids"), ("other-b", "Music")]
            .map { Category(id: $0.0, name: $0.1) }
        let chips = GuideLineup.chips(categories, order: .featured)
        XCTAssertEqual(ids(chips), ["__all", "__fav", "__hot", "sport", "premium", "news", "other-a", "other-b"])
        XCTAssertEqual(chips.dropFirst(3).map(\.title), ["USA | Sports", "USA Premium", "US: News", "Kids", "Music"])
    }

    func testDuplicatedProviderIDsAppearOnce() {
        let chips = GuideLineup.chips([Category(id: "sports", name: "US Sports"), Category(id: "sports", name: "Duplicate")], order: .featured)
        XCTAssertEqual(ids(chips), ["__all", "__fav", "__hot", "sports"])
        XCTAssertEqual(ids(GuideLineup.chips([], order: .az)), ["__all", "__fav", "__hot"])
    }

    func testCustomersCanKeepTheHubOrderOrSortAlphabetically() {
        let categories = [("s", "US Sports"), ("k", "Kids"), ("n", "US News"), ("a", "| Action |")].map { Category(id: $0.0, name: $0.1) }
        XCTAssertEqual(ids(GuideLineup.chips(categories, order: .provider)), ["__all", "__fav", "__hot", "s", "k", "n", "a"])
        XCTAssertEqual(ids(GuideLineup.chips(categories, order: .az)), ["__all", "__fav", "__hot", "a", "k", "n", "s"])
        XCTAssertEqual(ids(GuideLineup.chips(categories, order: .featured)), ["__all", "__fav", "__hot", "s", "n", "k", "a"])
        XCTAssertEqual(CategoryOrder.featured.next, .provider)
        XCTAssertEqual(CategoryOrder.provider.next, .az)
        XCTAssertEqual(CategoryOrder.az.next, .featured)
        XCTAssertEqual(CategoryOrder.allCases.map(\.label), ["Featured", "Hub order", "A to Z"])
    }

    func testFeaturedRanks() {
        XCTAssertEqual(GuideLineup.featuredRank("USA | Sports"), 0)
        XCTAssertEqual(GuideLineup.featuredRank("usa premium"), 1)
        XCTAssertEqual(GuideLineup.featuredRank("US: News"), 2)
        XCTAssertEqual(GuideLineup.featuredRank("Movies"), 3)
        XCTAssertEqual(GuideLineup.featuredRank("ENTERTAINMENT"), 4)
        XCTAssertEqual(GuideLineup.featuredRank("US Documentaries"), 5)
        XCTAssertEqual(GuideLineup.featuredRank("Local news"), 6)
        XCTAssertEqual(GuideLineup.featuredRank("US Sports HD"), 7)
        XCTAssertEqual(GuideLineup.featuredRank(""), 7)
    }

    func testChannelsPerChip() {
        let lineup = LiveLineup(channels: [channel("a", "A", category: "news"), channel("b", "B", categories: ["news", "sports"]), channel("c", "C", category: "sports")],
                                categories: [], aliases: ["old-b": "b"], updated: Date())
        XCTAssertEqual(GuideLineup.channels(for: .all, lineup: lineup, favorites: [], mostWatched: []).map(\.key), ["a", "b", "c"])
        XCTAssertEqual(GuideLineup.channels(for: .category("sports"), lineup: lineup, favorites: [], mostWatched: []).map(\.key), ["b", "c"])
        XCTAssertEqual(GuideLineup.channels(for: .favorites, lineup: lineup, favorites: ["c", "old-b", "gone"], mostWatched: []).map(\.key), ["b", "c"],
                       "favorites follow folded keys and keep lineup order")
        XCTAssertEqual(GuideLineup.channels(for: .mostWatched, lineup: lineup, favorites: [], mostWatched: ["c", "gone", "old-b", "b"]).map(\.key), ["c", "b"])
        let many = LiveLineup(channels: (0..<80).map { channel("k\($0)", "C\($0)") }, categories: [], updated: Date())
        XCTAssertEqual(GuideLineup.channels(for: .mostWatched, lineup: many, favorites: [], mostWatched: (0..<80).map { "k\($0)" }).count, 50)
    }

    func testEmptyMessages() {
        XCTAssertEqual(GuideLineup.emptyMessage(for: .favorites, usOnly: false),
                       EmptyMessage(title: "No favorites yet", detail: "Press and hold Select on any channel to add it here."))
        XCTAssertEqual(GuideLineup.emptyMessage(for: .mostWatched, usOnly: false),
                       EmptyMessage(title: "No Most Watched channels yet", detail: "Watch live TV and the channels you use most will appear here."))
        XCTAssertEqual(GuideLineup.emptyMessage(for: .category("x"), usOnly: true).title, "No channels in this category")
        XCTAssertEqual(GuideLineup.emptyMessage(for: .all, usOnly: true).title, "No matching USA channels")
    }
}

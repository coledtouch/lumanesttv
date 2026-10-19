import Foundation
import XCTest
@testable import TunerCore

final class SourceStoreTests: XCTestCase {
    func testPasswordsLiveOnlyInTheSecretStore() throws {
        let store = InMemoryKeyValueStore()
        let secrets = InMemorySecretStore()
        let sources = SourceStore(store: store, secrets: secrets)
        XCTAssertEqual(sources.all(), [])
        XCTAssertNil(sources.active())
        sources.save(demoSource)
        let playlist = Source(id: "pl", name: "Playlist", kind: .m3u, playlistURL: "https://tv.example.com/m3u?u=a&p=b")
        sources.save(playlist)
        XCTAssertEqual(sources.all(), [demoSource, playlist])
        let stored = String(decoding: try XCTUnwrap(store.data(forKey: "sources")), as: UTF8.self)
        XCTAssertFalse(stored.contains("s3cret pass"), "the password never reaches the key-value store")
        XCTAssertEqual(secrets.secret(forAccount: "src-1"), "s3cret pass")
        XCTAssertNil(secrets.secret(forAccount: "pl"))

        XCTAssertNil(sources.activeID)
        sources.setActive(id: "pl")
        XCTAssertEqual(sources.active(), playlist)
        sources.setActive(id: "unknown")
        XCTAssertNil(sources.activeID, "an unknown id is not active")

        var renamed = demoSource
        renamed.name = "Living room"
        renamed.password = "new"
        sources.save(renamed)
        XCTAssertEqual(sources.all().map(\.name), ["Living room", "Playlist"], "saved by id, in place")
        XCTAssertEqual(secrets.secret(forAccount: "src-1"), "new")

        sources.setActive(id: "src-1")
        sources.delete(id: "src-1")
        XCTAssertNil(secrets.secret(forAccount: "src-1"))
        XCTAssertEqual(sources.activeID, "pl", "the first remaining source becomes active")
        sources.delete(id: "pl")
        XCTAssertNil(sources.activeID)
        XCTAssertEqual(sources.all(), [])
    }

    func testUserDefaultsStorePrefixesKeys() throws {
        let suite = "tuner-tests-\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        addTeardownBlock { defaults.removePersistentDomain(forName: suite) }
        let store = UserDefaultsKeyValueStore(defaults: defaults)
        store.set(Data("x".utf8), forKey: "settings")
        XCTAssertEqual(defaults.data(forKey: "tuner.settings"), Data("x".utf8))
        XCTAssertEqual(store.data(forKey: "settings"), Data("x".utf8))
        store.set(nil, forKey: "settings")
        XCTAssertNil(defaults.object(forKey: "tuner.settings"))
        let custom = UserDefaultsKeyValueStore(defaults: defaults, prefix: "p.")
        custom.set(Data("y".utf8), forKey: "k")
        XCTAssertEqual(defaults.data(forKey: "p.k"), Data("y".utf8))
    }
}

final class SettingsTests: XCTestCase {
    func testDefaults() {
        let settings = TunerSettings()
        XCTAssertFalse(settings.usOnly, "the hub-chosen lineup is the default")
        XCTAssertTrue(settings.titlesUSOnly)
        XCTAssertEqual(settings.categoryOrder, .featured)
        XCTAssertTrue(settings.guidePreview)
        XCTAssertEqual(settings.subtitles, .automatic)
        XCTAssertFalse(settings.startOnLiveTV)
        XCTAssertEqual(SubtitleMode.allCases.map(\.label), ["Automatic", "On", "Off"])
    }

    func testDecodingToleratesMissingUnknownAndBadValues() throws {
        func decode(_ text: String) throws -> TunerSettings { try JSONDecoder().decode(TunerSettings.self, from: Data(text.utf8)) }
        XCTAssertEqual(try decode("{}"), TunerSettings())
        XCTAssertEqual(try decode(#"{"usOnly":true,"categoryOrder":"az","unknown":1}"#), TunerSettings(usOnly: true, categoryOrder: .az))
        XCTAssertEqual(try decode(#"{"usOnly":"yes","subtitles":"loud","guidePreview":false,"titlesUSOnly":null}"#), TunerSettings(guidePreview: false))
        XCTAssertEqual(try decode("[]"), TunerSettings())
        let custom = TunerSettings(usOnly: true, titlesUSOnly: false, categoryOrder: .provider, guidePreview: false, subtitles: .off, startOnLiveTV: true)
        XCTAssertEqual(try JSONDecoder().decode(TunerSettings.self, from: JSONEncoder().encode(custom)), custom)
    }
}

final class UserLibraryTests: XCTestCase {
    private let store = InMemoryKeyValueStore()
    private let clock = Shared(Date(timeIntervalSince1970: 1_000_000))
    private lazy var library = UserLibrary(store: store, now: { [clock] in clock.value })

    private func at(_ seconds: Double) { clock.value = Date(timeIntervalSince1970: seconds) }

    func testSettingsPersist() {
        library.updateSettings { $0.usOnly = true; $0.subtitles = .on }
        let reopened = UserLibrary(store: store)
        XCTAssertTrue(reopened.settings.usOnly)
        XCTAssertEqual(reopened.settings.subtitles, .on)
        XCTAssertTrue(reopened.settings.titlesUSOnly)
    }

    func testFavoritesArePerSource() {
        XCTAssertTrue(library.toggleFavorite("cnn", sourceID: "a"))
        XCTAssertEqual(library.favorites(sourceID: "a"), ["cnn"])
        XCTAssertEqual(UserLibrary(store: store).favorites(sourceID: "a"), ["cnn"], "persisted")
        XCTAssertTrue(library.favorites(sourceID: "b").isEmpty)
        library.toggleFavorite("nbc", sourceID: "b")
        XCTAssertFalse(library.toggleFavorite("cnn", sourceID: "a"))
        XCTAssertTrue(library.favorites(sourceID: "a").isEmpty)
        XCTAssertEqual(library.favorites(sourceID: "b"), ["nbc"])
        XCTAssertTrue(library.toggleFavoriteTitle("m:1", sourceID: "a"))
        XCTAssertEqual(library.favoriteTitles(sourceID: "a"), ["m:1"])
        XCTAssertFalse(library.toggleFavoriteTitle("m:1", sourceID: "a"))
    }

    /// Android MostWatchedPrefsTest: tune count wins, then the latest use, then the key.
    func testMostWatchedRanking() {
        at(10); library.recordWatch("news", sourceID: "a")
        at(20); library.recordWatch("sports", sourceID: "a")
        XCTAssertEqual(library.mostWatched(sourceID: "a"), ["sports", "news"])
        at(5); library.recordWatch("news", sourceID: "a")
        XCTAssertEqual(library.mostWatched(sourceID: "a"), ["news", "sports"])
        XCTAssertEqual(UserLibrary(store: store).mostWatched(sourceID: "a"), ["news", "sports"])
        at(20); library.recordWatch("alpha", sourceID: "a")
        XCTAssertEqual(library.mostWatched(sourceID: "a"), ["news", "alpha", "sports"], "equal counts and times: key order")
        XCTAssertEqual(library.mostWatched(sourceID: "a", limit: 1), ["news"])
        XCTAssertTrue(library.mostWatched(sourceID: "b").isEmpty)
        library.recordWatch("", sourceID: "a")
        XCTAssertEqual(library.mostWatched(sourceID: "a").count, 3)
    }

    func testWatchHistoryKeepsTheTop500() {
        for index in 0..<600 {
            at(Double(index))
            library.recordWatch("k\(index)", sourceID: "a")
        }
        let ranked = library.mostWatched(sourceID: "a", limit: 1000)
        XCTAssertEqual(ranked.count, 500)
        XCTAssertEqual(ranked.first, "k599")
    }

    func testCorruptHistoryEntriesAreSkippedAndCountsSaturate() {
        let stored = #"{"good":{"count":9223372036854775807,"updated":10},"bad":4,"negative":{"count":-1,"updated":1}}"#
        store.set(Data(stored.utf8), forKey: "watched.a")
        XCTAssertEqual(library.mostWatched(sourceID: "a"), ["good"])
        at(20)
        library.recordWatch("good", sourceID: "a")
        library.recordWatch("other", sourceID: "a")
        XCTAssertEqual(library.mostWatched(sourceID: "a"), ["good", "other"])
        library.canonicalize(sourceID: "a", aliases: ["other": "good"])
        XCTAssertEqual(library.mostWatched(sourceID: "a"), ["good"])
    }

    /// Android FavoritesTest / MostWatchedPrefsTest: folded copies move to the surviving channel.
    func testCanonicalizeMergesFavoritesHistoryAndLastChannel() {
        library.toggleFavorite("copy", sourceID: "a")
        library.toggleFavorite("main", sourceID: "a")
        at(10); library.recordWatch("copy", sourceID: "a")
        at(20); library.recordWatch("main", sourceID: "a")
        at(30); library.recordWatch("copy", sourceID: "a")
        library.setLastChannel("old", sourceID: "a")
        library.canonicalize(sourceID: "a", aliases: ["copy": "main", "old": "copy"])
        XCTAssertEqual(library.favorites(sourceID: "a"), ["main"])
        XCTAssertEqual(library.lastChannel(sourceID: "a"), "main")
        XCTAssertEqual(library.mostWatched(sourceID: "a"), ["main"])
        at(40); library.recordWatch("main", sourceID: "a")
        let stored = try? JSONDecoder().decode([String: WatchCount].self, from: store.data(forKey: "watched.a") ?? Data())
        XCTAssertEqual(stored?["main"], WatchCount(count: 4, updated: Date(timeIntervalSince1970: 40)))
        // Another source is untouched; an empty or cyclic alias map is harmless.
        library.toggleFavorite("copy", sourceID: "b")
        library.canonicalize(sourceID: "a", aliases: [:])
        library.canonicalize(sourceID: "b", aliases: ["copy": "x", "x": "copy"])
        XCTAssertEqual(library.favorites(sourceID: "b").count, 1)
    }

    func testDeadChannelsExpireAfterThreeDays() {
        at(0)
        library.reportDead(["a", "b", ""], sourceID: "s")
        XCTAssertEqual(library.deadChannels(sourceID: "s"), ["a", "b"])
        at(2 * 86400)
        library.reportDead(["c"], sourceID: "s")
        XCTAssertEqual(library.deadChannels(sourceID: "s"), ["a", "b", "c"])
        at(3 * 86400 + 1)
        XCTAssertEqual(library.deadChannels(sourceID: "s"), ["c"])
        XCTAssertTrue(library.deadChannels(sourceID: "other").isEmpty)
        library.clearDead(sourceID: "s")
        XCTAssertTrue(library.deadChannels(sourceID: "s").isEmpty)
    }

    private func recent(_ id: String, _ position: Int64, _ duration: Int64 = 100_000, series: String? = nil) -> RecentItem {
        RecentItem(id: id, kind: series == nil ? .movie : .episode, title: id, seriesID: series, positionMs: position, durationMs: duration,
                   updated: clock.value)
    }

    func testRecentsFollowTheResumePolicy() {
        library.saveProgress(recent("m:1", 10_000), sourceID: "s")
        XCTAssertTrue(library.recents(sourceID: "s").isEmpty, "the first 15 s are ignored")
        library.saveProgress(recent("m:1", 30_000), sourceID: "s")
        library.saveProgress(recent("m:2", 40_000), sourceID: "s")
        XCTAssertEqual(library.recents(sourceID: "s").map(\.id), ["m:2", "m:1"])
        library.saveProgress(recent("m:1", 50_000), sourceID: "s")
        XCTAssertEqual(library.recents(sourceID: "s").map(\.id), ["m:1", "m:2"], "an update moves to the front")
        XCTAssertEqual(library.recents(sourceID: "s").first?.positionMs, 50_000)
        library.saveProgress(recent("m:1", 99_000), sourceID: "s")
        XCTAssertEqual(library.recents(sourceID: "s").map(\.id), ["m:2"], "finished titles are removed")
        library.saveProgress(recent("m:2", 5_000), sourceID: "s")
        XCTAssertEqual(library.recents(sourceID: "s").map(\.id), ["m:2"], "an ignored save keeps the old entry")
        for index in 0..<50 { library.saveProgress(recent("m:x\(index)", 20_000), sourceID: "s") }
        XCTAssertEqual(library.recents(sourceID: "s").count, 40)
    }

    func testOneRecentPerSeriesAndUpNext() {
        library.saveProgress(recent("e:1", 20_000, series: "s:1"), sourceID: "s")
        library.saveProgress(recent("m:1", 20_000), sourceID: "s")
        library.saveProgress(recent("e:2", 30_000, series: "s:1"), sourceID: "s")
        XCTAssertEqual(library.recents(sourceID: "s").map(\.id), ["e:2", "m:1"])
        library.saveProgress(recent("e:2", 99_000, series: "s:1"), sourceID: "s")
        library.saveUpNext(recent("e:3", 55_000, series: "s:1"), sourceID: "s")
        let first = library.recents(sourceID: "s").first
        XCTAssertEqual(first?.id, "e:3")
        XCTAssertEqual(first?.positionMs, 0)
        XCTAssertEqual(first?.upNext, true)
        XCTAssertNil(first?.progress)
        library.saveProgress(recent("e:3", 20_000, series: "s:1"), sourceID: "s")
        XCTAssertEqual(library.recents(sourceID: "s").first?.upNext, false, "watching it clears up next")
        library.removeRecent(id: "s:1", sourceID: "s")
        XCTAssertEqual(library.recents(sourceID: "s").map(\.id), ["m:1"], "removing a series removes its episodes")
        library.removeRecent(id: "m:1", sourceID: "s")
        XCTAssertTrue(library.recents(sourceID: "s").isEmpty)
    }

    func testHistorySnapshotAndRemoveAll() {
        for index in 0..<70 {
            at(Double(index))
            library.recordHistory(titleID: "m:\(index)", kind: .movie, sourceID: "s")
        }
        at(100)
        library.recordHistory(titleID: "m:30", kind: .movie, sourceID: "s")
        let history = library.history(sourceID: "s")
        XCTAssertEqual(history.count, 60)
        XCTAssertEqual(history.first, HistoryEntry(titleID: "m:30", kind: .movie, updated: Date(timeIntervalSince1970: 100)))
        XCTAssertEqual(history.filter { $0.titleID == "m:30" }.count, 1)

        library.toggleFavoriteTitle("s:1", sourceID: "s")
        library.saveProgress(recent("m:1", 20_000), sourceID: "s")
        library.toggleFavorite("x:1", sourceID: "s")
        library.setLastChannel("x:1", sourceID: "s")
        library.reportDead(["x:2"], sourceID: "s")
        library.recordWatch("x:1", sourceID: "s")
        let snapshot = library.snapshot(sourceID: "s")
        XCTAssertEqual(snapshot.favoriteTitles, ["s:1"])
        XCTAssertEqual(snapshot.recents.map(\.id), ["m:1"])
        XCTAssertEqual(snapshot.history.count, 60)

        library.toggleFavorite("x:9", sourceID: "other")
        library.removeAll(sourceID: "s")
        XCTAssertEqual(library.snapshot(sourceID: "s"), .empty)
        XCTAssertTrue(library.favorites(sourceID: "s").isEmpty)
        XCTAssertNil(library.lastChannel(sourceID: "s"))
        XCTAssertTrue(library.deadChannels(sourceID: "s").isEmpty)
        XCTAssertTrue(library.mostWatched(sourceID: "s").isEmpty)
        XCTAssertEqual(library.favorites(sourceID: "other"), ["x:9"])
    }
}

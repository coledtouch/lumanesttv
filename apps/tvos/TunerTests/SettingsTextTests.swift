import XCTest
import TunerCore
@testable import Tuner

final class SettingsTextTests: XCTestCase {
    func testSubtitleSettingCycles() {
        XCTAssertEqual(SettingsText.next(.automatic), .on)
        XCTAssertEqual(SettingsText.next(.on), .off)
        XCTAssertEqual(SettingsText.next(.off), .automatic)
    }

    func testWording() {
        XCTAssertEqual(SettingsText.titles(usOnly: true), "USA only")
        XCTAssertEqual(SettingsText.titles(usOnly: false), "All")
        XCTAssertEqual(SettingsText.displayAddress(URL(string: "https://tunertv.app/privacy")!), "tunertv.app/privacy")
        XCTAssertEqual(SettingsText.displayAddress(TunerLinks.privacyPolicy), "tunertv.app/privacy")
    }

    func testTheAppStoreEditionNeverUnlocksAdultContent() {
        XCTAssertEqual(Edition.current, .appStore)
        XCTAssertEqual(Edition.current.adultFilterMode, .strict)
    }

    func testSettingsDefaults() {
        let settings = TunerSettings()
        XCTAssertFalse(settings.usOnly, "Live TV shows the hub-chosen lineup by default")
        XCTAssertTrue(settings.titlesUSOnly)
        XCTAssertTrue(settings.guidePreview)
        XCTAssertEqual(settings.subtitles, .automatic)
        XCTAssertFalse(settings.startOnLiveTV)
    }
}

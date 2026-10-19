import XCTest
import TunerCore
@testable import Tuner

final class GuideWindowTests: XCTestCase {
    private let base = Date(timeIntervalSince1970: 1_800_000_000) // a half-hour boundary

    func testWindowStartsAtTheHalfHourAndLasts150Minutes() {
        let window = GuideWindow(now: base.addingTimeInterval(17 * 60 + 5))
        XCTAssertEqual(window.start, base)
        XCTAssertEqual(window.end, base.addingTimeInterval(150 * 60))
        XCTAssertEqual(window.marks.count, 5)
        XCTAssertEqual(window.totalWidth, 150 * GuideWindow.pointsPerMinute, accuracy: 0.001)
    }

    func testCellWidthsAreClippedToTheWindow() {
        let window = GuideWindow(now: base)
        let half = Program(start: base, end: base.addingTimeInterval(1800), title: "News")
        XCTAssertEqual(window.width(of: half), 30 * GuideWindow.pointsPerMinute - GuideWindow.cellSpacing, accuracy: 0.001)
        let early = Program(start: base.addingTimeInterval(-3600), end: base.addingTimeInterval(600), title: "Film")
        XCTAssertEqual(window.width(of: early), 10 * GuideWindow.pointsPerMinute - GuideWindow.cellSpacing, accuracy: 0.001)
        let tiny = Program(start: base, end: base.addingTimeInterval(30), title: "Promo")
        XCTAssertEqual(window.width(of: tiny), 8, "never narrower than 8 points")
    }

    func testOnlyProgrammesThatStartedTune() {
        let now = base.addingTimeInterval(600)
        XCTAssertTrue(GuideWindow.isLive(Program(start: base, end: base.addingTimeInterval(1800), title: "On now"), at: now))
        XCTAssertFalse(GuideWindow.isLive(Program(start: base.addingTimeInterval(1800), end: base.addingTimeInterval(3600), title: "Later"), at: now))
    }
}

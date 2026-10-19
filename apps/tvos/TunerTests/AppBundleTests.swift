import XCTest
import TunerCore
@testable import Tuner

/// The App Store settings of the built app (the test host).
final class AppBundleTests: XCTestCase {
    func testBundleIdentifierAndName() {
        XCTAssertEqual(Bundle.main.bundleIdentifier, "app.tunertv")
        XCTAssertEqual(Bundle.main.object(forInfoDictionaryKey: "CFBundleDisplayName") as? String, "Tuner")
    }

    func testTransportSecurityHasOnlyArbitraryLoads() throws {
        let ats = try XCTUnwrap(Bundle.main.object(forInfoDictionaryKey: "NSAppTransportSecurity") as? [String: Any])
        XCTAssertEqual(Set(ats.keys), ["NSAllowsArbitraryLoads"], "any other global ATS key makes ATS ignore NSAllowsArbitraryLoads")
        XCTAssertEqual(ats["NSAllowsArbitraryLoads"] as? Bool, true)
    }

    func testExportComplianceAndPrivacyManifest() {
        XCTAssertEqual(Bundle.main.object(forInfoDictionaryKey: "ITSAppUsesNonExemptEncryption") as? Bool, false)
        XCTAssertNotNil(Bundle.main.url(forResource: "PrivacyInfo", withExtension: "xcprivacy"))
    }

    func testNoBackgroundModesOrLocalNetworkKeys() {
        XCTAssertNil(Bundle.main.object(forInfoDictionaryKey: "UIBackgroundModes"))
        XCTAssertNil(Bundle.main.object(forInfoDictionaryKey: "NSLocalNetworkUsageDescription"))
    }
}

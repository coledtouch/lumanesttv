import XCTest
import TunerCore
@testable import Tuner

final class SignInFormTests: XCTestCase {
    func testServerLoginIsTrimmedAndNormalized() throws {
        let source = try SignInForm.serverLogin(server: "  example.com:8080/ ", username: " anna ", password: " secret ")
        XCTAssertEqual(source.kind, .xtream)
        XCTAssertEqual(source.server, "http://example.com:8080")
        XCTAssertEqual(source.username, "anna")
        XCTAssertEqual(source.password, "secret")
        XCTAssertEqual(source.name, "LumaNest TV")
    }

    func testAFullLinkInTheServerFieldFillsTheLogin() throws {
        let source = try SignInForm.serverLogin(server: "http://line.example.com/get.php?username=bob&password=pw1&type=m3u_plus",
                                                username: "", password: "")
        XCTAssertEqual(source.server, "http://line.example.com")
        XCTAssertEqual(source.username, "bob")
        XCTAssertEqual(source.password, "pw1")
    }

    func testMissingFieldsAreExplained() {
        XCTAssertThrowsError(try SignInForm.serverLogin(server: "example.com", username: "", password: "x")) { error in
            XCTAssertEqual(error as? TunerError, .invalidInput("Enter the server address, username and password."))
        }
        XCTAssertThrowsError(try SignInForm.serverLogin(server: "   ", username: "anna", password: "x"))
    }

    func testDescriptionsNeverShowThePassword() throws {
        let server = try SignInForm.serverLogin(server: "http://example.com", username: "anna", password: "topsecret")
        XCTAssertEqual(SignInForm.describe(server), "Server login · anna · example.com")
        XCTAssertFalse(SignInForm.describe(server).contains("topsecret"))
        // A playlist link arrives only through phone pairing.
        let playlist = Source(kind: .m3u, playlistURL: "https://tv.example.com/m3u?u=a&p=topsecret")
        XCTAssertEqual(SignInForm.describe(playlist), "Playlist link · tv.example.com")
    }

    func testWebURL() {
        XCTAssertNotNil(SignInForm.webURL("https://lumanest.tv"))
        XCTAssertNil(SignInForm.webURL("lumanest.tv"))
        XCTAssertNil(SignInForm.webURL("http://"))
    }
}

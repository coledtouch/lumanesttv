import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif
import Security
import XCTest
import TunerCore
@testable import Tuner

final class QRImageTests: XCTestCase {
    func testPairingLinkMakesAQRCode() throws {
        let image = try XCTUnwrap(QRImage.make("https://lumanest.tv/pair?code=BCDF-GHJK"))
        XCTAssertGreaterThan(image.size.width, 100)
        XCTAssertEqual(image.size.width, image.size.height)
    }
}

final class KeychainSecretStoreTests: XCTestCase {
    func testPasswordsRoundTrip() throws {
        let store = KeychainSecretStore(service: "app.tunertv.tests")
        let status = store.probe()
        if status == errSecMissingEntitlement {
            throw XCTSkip("The Keychain needs a signed build (errSecMissingEntitlement, -34018)")
        }
        XCTAssertEqual(status, errSecSuccess)
        let account = "test-" + UUID().uuidString
        store.setSecret("p@ss word", forAccount: account)
        XCTAssertEqual(store.secret(forAccount: account), "p@ss word")
        store.setSecret("changed", forAccount: account)
        XCTAssertEqual(store.secret(forAccount: account), "changed")
        store.setSecret(nil, forAccount: account)
        XCTAssertNil(store.secret(forAccount: account))
    }
}

final class LoopbackServerTests: XCTestCase {
    func testServesMediaServerOn127001() async throws {
        let media = MediaServer(transport: URLSessionUpstreamTransport())
        let server = LoopbackServer(media: media)
        defer { server.stop() }
        let origin = try await server.ensureRunning()
        XCTAssertEqual(origin.scheme, "http")
        XCTAssertEqual(origin.host, "127.0.0.1")
        XCTAssertNotNil(origin.port)
        let again = try await server.ensureRunning()
        XCTAssertEqual(again, origin, "a running server keeps its port")
        let mediaOrigin = await media.origin
        XCTAssertEqual(mediaOrigin, origin)

        let (_, missing) = try await URLSession.shared.data(from: origin.appendingPathComponent("live/unknown/index.m3u8"))
        XCTAssertEqual((missing as? HTTPURLResponse)?.statusCode, 404)
        var head = URLRequest(url: origin.appendingPathComponent("vod/unknown/media.mp4"))
        head.httpMethod = "HEAD"
        let (_, vod) = try await URLSession.shared.data(for: head)
        XCTAssertEqual((vod as? HTTPURLResponse)?.statusCode, 404)
    }

    func testRestartsAfterStop() async throws {
        let server = LoopbackServer(media: MediaServer(transport: URLSessionUpstreamTransport()))
        defer { server.stop() }
        _ = try await server.ensureRunning()
        server.stop()
        XCTAssertNil(server.currentOrigin)
        let origin = try await server.ensureRunning()
        let (_, response) = try await URLSession.shared.data(from: origin.appendingPathComponent("nothing"))
        XCTAssertEqual((response as? HTTPURLResponse)?.statusCode, 404)
    }
}

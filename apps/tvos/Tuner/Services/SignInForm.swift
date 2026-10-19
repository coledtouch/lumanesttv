import Foundation
import TunerCore

/// Turns what was typed on the Sign in screen into a login (checked by `AppModel.validate` before it is saved).
/// Only server logins can be typed; playlist links arrive only through phone pairing.
enum SignInForm {
    /// A server login: server address, username and password. A full get.php link typed as the address works too.
    static func serverLogin(server: String, username: String, password: String) throws -> Source {
        let server = server.trimmingCharacters(in: .whitespacesAndNewlines)
        var username = username.trimmingCharacters(in: .whitespacesAndNewlines)
        var password = password.trimmingCharacters(in: .whitespacesAndNewlines)
        var address = server
        if let login = Xtream.login(fromGetPhp: server) {
            address = login.server
            if username.isEmpty { username = login.username }
            if password.isEmpty { password = login.password }
        }
        guard !address.isEmpty, !username.isEmpty, !password.isEmpty else {
            throw TunerError.invalidInput("Enter the server address, username and password.")
        }
        let normalized = Xtream.normalizeServer(address)
        guard webURL(normalized) != nil else {
            throw TunerError.invalidInput("Check the server address.")
        }
        return Source(kind: .xtream, server: normalized, username: username, password: password)
    }

    /// An http(s) URL with a host, else nil.
    static func webURL(_ text: String) -> URL? {
        guard let url = URL(string: text.trimmingCharacters(in: .whitespacesAndNewlines)),
              let scheme = url.scheme?.lowercased(), scheme == "http" || scheme == "https",
              let host = url.host, !host.isEmpty else { return nil }
        return url
    }

    /// "Server login · anna · example.com" / "Playlist link · example.com" (a paired playlist) for the Settings list,
    /// never the password.
    static func describe(_ source: Source) -> String {
        switch source.kind {
        case .xtream:
            let host = webURL(source.server)?.host ?? source.server
            return "Server login · \(source.username) · \(host)"
        case .m3u:
            let host = webURL(source.playlistURL)?.host ?? "playlist"
            return "Playlist link · \(host)"
        }
    }
}

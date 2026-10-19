import Foundation
import TunerCore

/// Settings wording, kept in one place (and tested).
enum SettingsText {
    static func titles(usOnly: Bool) -> String {
        usOnly ? "USA only" : "All"
    }

    static func next(_ mode: SubtitleMode) -> SubtitleMode {
        switch mode {
        case .automatic: return .on
        case .on: return .off
        case .off: return .automatic
        }
    }

    /// "1.0.0 (1)" from the bundle.
    static var version: String {
        let info = Bundle.main.infoDictionary
        let version = info?["CFBundleShortVersionString"] as? String ?? "1.0"
        let build = info?["CFBundleVersion"] as? String ?? "1"
        return "\(version) (\(build))"
    }

    /// "tunertv.app/privacy" for https://tunertv.app/privacy.
    static func displayAddress(_ url: URL) -> String {
        var text = url.absoluteString
        for prefix in ["https://", "http://"] where text.hasPrefix(prefix) {
            text.removeFirst(prefix.count)
        }
        return text
    }
}

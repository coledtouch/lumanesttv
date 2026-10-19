import Foundation

/// A compiled ICU regular expression (`NSRegularExpression`: the Android rules need lookbehind, which Swift `Regex`
/// lacks). Matching is thread-safe; ranges are converted to and from `String` indices.
struct Pattern: @unchecked Sendable {
    let regex: NSRegularExpression

    init(_ pattern: String, caseInsensitive: Bool = false) {
        do {
            regex = try NSRegularExpression(pattern: pattern, options: caseInsensitive ? [.caseInsensitive] : [])
        } catch {
            preconditionFailure("Invalid pattern \(pattern): \(error)")
        }
    }

    private func whole(_ text: String) -> NSRange { NSRange(text.startIndex..<text.endIndex, in: text) }

    func matches(_ text: String) -> Bool { regex.firstMatch(in: text, options: [], range: whole(text)) != nil }

    /// The whole string matches (Kotlin `Regex.matches`).
    func matchesEntire(_ text: String) -> Bool {
        guard let match = regex.firstMatch(in: text, options: [.anchored], range: whole(text)) else { return false }
        return match.range.length == (text as NSString).length
    }

    func firstMatch(_ text: String) -> NSTextCheckingResult? { regex.firstMatch(in: text, options: [], range: whole(text)) }

    func allMatches(_ text: String) -> [NSTextCheckingResult] { regex.matches(in: text, options: [], range: whole(text)) }

    /// Capture groups 1...n of the first match (nil entries for groups that didn't take part), or nil without a match.
    func groups(_ text: String) -> [String?]? {
        guard let match = firstMatch(text) else { return nil }
        return Pattern.groups(of: match, in: text)
    }

    static func groups(of match: NSTextCheckingResult, in text: String) -> [String?] {
        guard match.numberOfRanges > 1 else { return [] }
        return (1..<match.numberOfRanges).map { index in
            let range = match.range(at: index)
            guard range.location != NSNotFound, let swiftRange = Range(range, in: text) else { return nil }
            return String(text[swiftRange])
        }
    }

    static func string(_ range: NSRange, in text: String) -> String? {
        guard range.location != NSNotFound, let swiftRange = Range(range, in: text) else { return nil }
        return String(text[swiftRange])
    }

    /// Replaces every match with `replacement` taken literally.
    func replace(_ text: String, with replacement: String) -> String {
        regex.stringByReplacingMatches(in: text, options: [], range: whole(text), withTemplate: NSRegularExpression.escapedTemplate(for: replacement))
    }

    /// Replaces every match with a template ("$1").
    func replace(_ text: String, template: String) -> String {
        regex.stringByReplacingMatches(in: text, options: [], range: whole(text), withTemplate: template)
    }
}

enum TextFold {
    /// Lowercased, diacritics and other combining marks removed (NFD/NFKD), for matching and sorting.
    static func fold(_ text: String, compatibility: Bool = false) -> String {
        let decomposed = compatibility ? text.decomposedStringWithCompatibilityMapping : text.decomposedStringWithCanonicalMapping
        var scalars = String.UnicodeScalarView()
        for scalar in decomposed.unicodeScalars {
            switch scalar.properties.generalCategory {
            case .nonspacingMark, .spacingMark, .enclosingMark: continue
            default: scalars.append(scalar)
            }
        }
        return String(scalars).lowercased()
    }

    /// Sort key for A–Z: folded, leading non-alphanumerics and a leading "the " removed.
    static func sortKey(_ text: String) -> String {
        var folded = fold(text)
        while let first = folded.unicodeScalars.first, !(first.properties.isAlphabetic || CharacterSet.decimalDigits.contains(first)) {
            folded.unicodeScalars.removeFirst()
        }
        if folded.hasPrefix("the ") { folded.removeFirst(4) }
        return folded
    }
}

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

/// Provider text kept apart as the other Tuner apps keep it. Swift's `String` equality, and so every `Dictionary`, `Set`
/// and `==` over strings, takes canonically equivalent text as one ("Espa\u{F1}ol" and "Espan\u{303}ol", "\u{212A}" and
/// "K"), where JavaScript, Kotlin and BrightScript compare code unit by code unit: two provider ids or groups spelled
/// that way would become one. Ids and names a provider sends are compared, or used as keys, in one of these forms.
enum ExactText {
    /// Equal only when the UTF-8 bytes are.
    static func same(_ a: String, _ b: String) -> Bool { a.utf8.elementsEqual(b.utf8) }

    /// A form of `text` that equals another text's form only when the two texts' bytes are equal: ASCII text unchanged
    /// (ASCII strings are equal in Swift only when their bytes are, so ids such as "123" stay as they are), any other text
    /// `spelled`, which never equals ASCII text.
    static func key(_ text: String) -> String {
        text.utf8.contains(where: { $0 >= 0x80 }) ? spelled(text) : text
    }

    /// "\u{A4}" followed by the UTF-8 bytes of `text` in upper-case hex: equal for equal bytes only, whatever the text.
    static func spelled(_ text: String) -> String {
        let digits = Array("0123456789ABCDEF".unicodeScalars)
        var scalars = String.UnicodeScalarView()
        scalars.append("\u{A4}")
        for byte in text.utf8 {
            scalars.append(digits[Int(byte >> 4)])
            scalars.append(digits[Int(byte & 0x0F)])
        }
        return String(scalars)
    }

    /// The text a `key` was made from.
    static func text(fromKey key: String) -> String {
        let scalars = Array(key.unicodeScalars)
        guard scalars.first == "\u{A4}", scalars.count % 2 == 1 else { return key }
        func nibble(_ scalar: Unicode.Scalar) -> UInt8? {
            switch scalar {
            case "0"..."9": return UInt8(scalar.value - 0x30)
            case "A"..."F": return UInt8(scalar.value - 0x41 + 10)
            default: return nil
            }
        }
        var bytes: [UInt8] = []
        var index = 1
        while index < scalars.count {
            guard let high = nibble(scalars[index]), let low = nibble(scalars[index + 1]) else { return key }
            bytes.append(high << 4 | low)
            index += 2
        }
        return String(decoding: bytes, as: UTF8.self)
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

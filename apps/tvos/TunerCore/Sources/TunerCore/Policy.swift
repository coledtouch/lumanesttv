import Foundation

// MARK: - Adult filter (port of Android AdultFilter.kt including the store edition's strict rules)

/// Patterns use NSRegularExpression (ICU) with explicit ASCII classes, because they need lookbehind:
/// - category token (standard): `(?<![a-z0-9])(?:xxx|adults?|18\+|porn)(?![a-z0-9])`, case-insensitive
/// - category token (strict): `(?<![a-z0-9])(?:xxx|x-x-x|adults?|adult(?:e|es|i|o|os|a|as)|\+\s*18|18\s*\+|18\s*plus|`
///   `porn(?:o|os|hub)?|erotic(?:a|o|os|as|s)?|erotik|hentai|nsfw)(?![a-z0-9])`, case-insensitive
/// - "Adult Swim" exemption (both, Android spelling; "Adult-Swim" stays adult): `(?<![a-z0-9])adult\s*swim(?![a-z0-9])`
///   replaced by " " first
/// - item names (strict only): `(?<![a-z0-9])(?:xxx|x-x-x|\+\s*18|18\s*\+|porn(?:o|os|hub)?|hentai|nsfw)(?![a-z0-9])`
///   after replacing the film title `(?<![A-Za-z0-9])xXx(?![A-Za-z0-9])` (case-sensitive) by " " (and, as Android's
///   store edition does, "XXX" in any capitalisation when a bracketed 2002/2005/2017 year or a sequel subtitle follows)
/// - live channel names (strict only) also: `(?<![a-z0-9])(?:playboy|hustler|brazzers|penthouse|vivid|dorcel|`
///   `babestation|red\s*light|spice)(?![a-z0-9])`
public enum AdultFilter {
    public enum Mode: Sendable, Equatable {
        /// Android direct-edition tokens. Not used by the App Store build.
        case standard
        /// Android store edition: wider category spellings, plus `isAdultTitle` on item names.
        case strict
    }

    private static let standardToken = Pattern(#"(?<![a-z0-9])(?:xxx|adults?|18\+|porn)(?![a-z0-9])"#, caseInsensitive: true)
    private static let strictToken = Pattern(
        #"(?<![a-z0-9])(?:xxx|x-x-x|adults?|adult(?:e|es|i|o|os|a|as)|\+\s*18|18\s*\+|18\s*plus|porn(?:o|os|hub)?|"#
            + #"erotic(?:a|o|os|as|s)?|erotik|hentai|nsfw)(?![a-z0-9])"#, caseInsensitive: true)
    private static let titleToken = Pattern(#"(?<![a-z0-9])(?:xxx|x-x-x|\+\s*18|18\s*\+|porn(?:o|os|hub)?|hentai|nsfw)(?![a-z0-9])"#,
                                            caseInsensitive: true)
    private static let network = Pattern(
        #"(?<![a-z0-9])(?:playboy|hustler|brazzers|penthouse|vivid|dorcel|babestation|red\s*light|spice)(?![a-z0-9])"#, caseInsensitive: true)
    private static let xxxFilm = Pattern(
        #"(?<![A-Za-z0-9])xXx(?![A-Za-z0-9])|(?i:(?<![a-z0-9])xxx(?=\s*\(\s*(?:2002|2005|2017)\s*\)|"#
            + #"\s*(?:2\s*)?[:\-]\s*(?:the\s+)?(?:return\s+of\s+xander\s+cage|state\s+of\s+the\s+union|next\s+level)))"#)
    private static let adultSwim = Pattern(#"(?<![a-z0-9])adult\s*swim(?![a-z0-9])"#, caseInsensitive: true)

    public static func isAdultName(_ name: String?, mode: Mode) -> Bool {
        guard let name, !name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return false }
        let text = adultSwim.replace(name, with: " ")
        return (mode == .strict ? strictToken : standardToken).matches(text)
    }

    public static func isAdultTitle(_ name: String?, live: Bool) -> Bool {
        guard let name, !name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return false }
        let text = xxxFilm.replace(name, with: " ")
        return titleToken.matches(text) || (live && network.matches(text))
    }

    /// Trimmed, lowercased: "1", "true", "yes", or a number >= 1.
    public static func isAdultFlag(_ value: String?) -> Bool {
        guard let text = value?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased(), !text.isEmpty else { return false }
        if text == "1" || text == "true" || text == "yes" { return true }
        if let number = Double(text), number.isFinite { return number >= 1 }
        return false
    }

    public static func isAdult(_ category: Category, mode: Mode) -> Bool { category.adult || isAdultName(category.name, mode: mode) }

    public static func adultCategoryIDs(_ categories: [Category], mode: Mode) -> Set<String> {
        Set(categories.filter { isAdult($0, mode: mode) }.map(\.id))
    }

    /// Drops flagged items, items listed in any adult category and (strict) items whose own name is adult.
    /// Strict also fails closed on items it can't check: an item whose category ids are all missing from the
    /// provider's category list (a deleted or hidden category, which may well have been an adult one) is dropped.
    /// Items without any category id are kept (they go to the fallback category).
    /// There is no "unlocked" parameter anywhere.
    public static func filter<T>(_ items: [T], categories: [Category], mode: Mode, live: Bool,
                                 categoryIDs: (T) -> [String], name: (T) -> String, flagged: (T) -> Bool) -> [T] {
        let adult = adultCategoryIDs(categories, mode: mode)
        let known = Set(categories.map(\.id))
        return items.filter { item in
            if flagged(item) { return false }
            let ids = categoryIDs(item).filter { !$0.isEmpty }
            if !adult.isEmpty && ids.contains(where: adult.contains) { return false }
            if mode == .strict && !ids.isEmpty && !ids.contains(where: known.contains) { return false }
            if mode == .strict && isAdultTitle(name(item), live: live) { return false }
            return true
        }
    }
}

// MARK: - Content policy (adult filter, then all-or-USA lineup for Live TV)

public struct Catalogue<Item: Sendable & Hashable>: Sendable, Hashable {
    public var items: [Item]
    public var categories: [Category]
    public init(items: [Item], categories: [Category]) { self.items = items; self.categories = categories }
}

public enum ContentPolicy {
    /// Adult filter (edition mode), then USA-only when asked (Android ContentPolicy.live rules). Items without
    /// categories go to "__tuner_live" "Live TV" (or "__tuner_us" "USA"); only used categories are kept, in order.
    public static func live(_ items: [Channel], categories: [Category], usOnly: Bool, edition: Edition = .current) -> Catalogue<Channel> {
        let allowed = AdultFilter.filter(items, categories: categories, mode: edition.adultFilterMode, live: true,
                                         categoryIDs: { $0.categoryIDs }, name: { $0.name }, flagged: { $0.adult })
        var seen = Set<String>()
        if !usOnly {
            var accepted: [Channel] = []
            for var channel in allowed where seen.insert(channel.key).inserted {
                let ids = distinct(channel.categoryIDs.filter { !$0.isEmpty })
                channel.categoryIDs = ids.isEmpty ? ["__tuner_live"] : ids
                channel.categoryID = channel.categoryIDs[0]
                accepted.append(channel)
            }
            return Catalogue(items: accepted, categories: usedCategories(accepted.flatMap(\.categoryIDs), categories, "__tuner_live", "Live TV"))
        }
        var labelsByCategory: [String: Labels] = [:]
        for category in categories where labelsByCategory[category.id] == nil { labelsByCategory[category.id] = labels(category.name) }
        var accepted: [Channel] = []
        for var channel in allowed {
            let named = nameLabels(channel.name)
            let epgRegion = channel.epgID.flatMap { epgCountry.groups($0)?.first ?? nil }.flatMap { Countries.code(forAlias: $0) }
            if conflictingCountry(channel.country) || named.foreign || (epgRegion != nil && epgRegion != "US") { continue }
            let memberships = distinct(channel.categoryIDs.filter { labelsByCategory[$0].map { !$0.foreign } ?? false })
            let positive = countryIsUS(channel.country) || named.us || epgRegion == "US" || memberships.contains { labelsByCategory[$0]?.us == true }
            guard positive, seen.insert(channel.key).inserted else { continue }
            channel.categoryIDs = memberships.isEmpty ? ["__tuner_us"] : memberships
            channel.categoryID = channel.categoryIDs[0]
            accepted.append(channel)
        }
        return Catalogue(items: accepted, categories: usedCategories(accepted.flatMap(\.categoryIDs), categories, "__tuner_us", "USA"))
    }

    /// Adult filter, drops titles Apple TV can't play (`PlaybackSupport`), fallback category "__tuner_movies" "Movies".
    public static func movies(_ items: [Movie], categories: [Category], edition: Edition = .current) -> Catalogue<Movie> {
        let allowed = AdultFilter.filter(items, categories: categories, mode: edition.adultFilterMode, live: false,
                                         categoryIDs: { $0.categoryIDs }, name: { $0.name }, flagged: { $0.adult })
        var seen = Set<String>()
        var accepted: [Movie] = []
        for var movie in allowed where PlaybackSupport.isPlayableVOD(url: movie.url, containerExtension: movie.containerExtension) {
            guard seen.insert(movie.id).inserted else { continue }
            let ids = distinct(movie.categoryIDs.filter { !$0.isEmpty })
            movie.categoryIDs = ids.isEmpty ? ["__tuner_movies"] : ids
            movie.categoryID = movie.categoryIDs[0]
            accepted.append(movie)
        }
        return Catalogue(items: accepted, categories: usedCategories(accepted.flatMap(\.categoryIDs), categories, "__tuner_movies", "Movies"))
    }

    /// Adult filter, fallback category "__tuner_series" "Series".
    public static func series(_ items: [Series], categories: [Category], edition: Edition = .current) -> Catalogue<Series> {
        let allowed = AdultFilter.filter(items, categories: categories, mode: edition.adultFilterMode, live: false,
                                         categoryIDs: { $0.categoryIDs }, name: { $0.name }, flagged: { $0.adult })
        var seen = Set<String>()
        var accepted: [Series] = []
        for var series in allowed where seen.insert(series.id).inserted {
            let ids = distinct(series.categoryIDs.filter { !$0.isEmpty })
            series.categoryIDs = ids.isEmpty ? ["__tuner_series"] : ids
            series.categoryID = series.categoryIDs[0]
            accepted.append(series)
        }
        return Catalogue(items: accepted, categories: usedCategories(accepted.flatMap(\.categoryIDs), categories, "__tuner_series", "Series"))
    }

    // MARK: USA-only rules (Android ContentPolicy.kt)

    private struct Labels {
        var us: Bool
        var foreign: Bool
    }

    private static let usLeagues = Pattern(
        #"(?<![a-z])(?:nfl|nba|wnba|nhl|mlb|milb|mls|ncaa|espn|ppv|peacock|paramount|flo ?sports|flo ?college|flo ?racing)(?![a-z])"#,
        caseInsensitive: true)
    private static let services: Set<String> = ["pluto", "samsung", "stv", "roku", "tubi", "plex", "xumo", "rakuten", "prime"]
    private static let countryLabels = Pattern(
        "(?<![a-z0-9])(?:" + Countries.aliases.keys.sorted { $0.count != $1.count ? $0.count > $1.count : $0 < $1 }
            .map { NSRegularExpression.escapedPattern(for: $0) }.joined(separator: "|") + ")(?![a-z0-9])",
        caseInsensitive: true)
    private static let otherLanguage = Pattern(
        #"(?<![a-z])(?:spanish|espa[nñ]ol|espanol|latino|latina|latam|latin|es|spa|french|fran[cç]ais|fr|fra|german|deutsch|de|deu|"#
            + #"italian|italiano|it|ita|portuguese|portugu[eê]s|pt|por|arabic|ar|ara|hindi|hin|urdu|punjabi|bengali|tamil|telugu|"#
            + #"malayalam|kannada|marathi|russian|rus|ru|polish|polski|pl|turkish|t[uü]rk[cç]e|tr|dutch|nederlands|nl|chinese|"#
            + #"mandarin|cantonese|zh|japanese|ja|korean|ko|vietnamese|thai|indonesian|malay|filipino|tagalog|greek|hebrew|persian|"#
            + #"farsi|ukrainian|romanian|hungarian|czech|slovak|serbian|croatian|bulgarian|swedish|norwegian|danish|finnish|"#
            + #"multilingual|asian|taiwanese)(?![a-z])"#,
        caseInsensitive: true)
    private static let itemLabels = Pattern(#"\[([^\]]+)\]|\(([^)]+)\)|\|([^|]+)\|"#)
    private static let itemPrefix = Pattern(#"^\s*([^:|]+?)\s*[:|]\s*|^\s*([A-Za-z]{2,3})\s*-\s*"#)
    private static let epgCountry = Pattern(#"\.([a-z]{2})$"#, caseInsensitive: true)
    private static let englishMetadata = Pattern(#"^(?:en|eng)(?:[-_][a-z0-9]{2,8})+$"#)
    private static let englishAliases: Set<String> = ["english", "eng", "en"]
    private static let ambiguousCodes: Set<String> = ["IN", "TO", "AS", "AT", "BE", "IS", "IT", "NO", "DO", "ME", "SO", "BY", "FI"]

    private static func labels(_ value: String) -> Labels {
        var us = usLeagues.matches(value)
        var foreign = false
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        let utf16 = Array(value.utf16)
        for match in countryLabels.allMatches(value) {
            guard let token = Pattern.string(match.range, in: value), let code = Countries.code(forAlias: token.lowercased()) else { continue }
            if token.count <= 3 && code != "US" && ambiguousCodes.contains(code) && trimmed != token && match.range.location > 0 {
                let previous = utf16[match.range.location - 1]
                if !["[", "(", "|", ":", "/"].contains(where: { $0.utf16.first == previous }) { continue }
            }
            if code == "US" { us = true } else { foreign = true }
        }
        return Labels(us: us, foreign: foreign)
    }

    private static func isEnglish(_ value: String) -> Bool { englishAliases.contains(value) || englishMetadata.matchesEntire(value) }

    /// Marked regions only (brackets, parentheses, pipes, a "XX:" / "XX |" / "XX -" prefix); ordinary words never count.
    private static func nameLabels(_ name: String) -> Labels {
        var result = Labels(us: false, foreign: false)
        func include(_ raw: String) {
            var clean = raw.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
            if let end = clean.firstIndex(where: { $0.isWhitespace || "/+|,;".contains($0) }), end > clean.startIndex,
               services.contains(String(clean[..<end])) {
                clean = String(clean[end...]).trimmingCharacters(in: .whitespacesAndNewlines)
            }
            if let country = Countries.code(forAlias: clean) {
                if country == "US" { result.us = true } else { result.foreign = true }
                return
            }
            if isEnglish(clean) || otherLanguage.matchesEntire(clean) { return }
            let parts = clean.split(whereSeparator: { "/+|,;".contains($0) }).map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
            var markedUS = false
            var markedForeign = false
            for part in parts {
                if let whole = Countries.code(forAlias: part) {
                    if whole == "US" { markedUS = true } else { markedForeign = true }
                    continue
                }
                if isEnglish(part) || otherLanguage.matchesEntire(part) { continue }
                let words = part.split(whereSeparator: { $0.isWhitespace }).map(String.init)
                var index = 0
                while index < words.count {
                    var matched = false
                    for length in stride(from: min(4, words.count - index), through: 1, by: -1) {
                        let phrase = words[index..<(index + length)].joined(separator: " ")
                        let code = Countries.code(forAlias: phrase)
                        if code != nil || (length == 1 && (isEnglish(phrase) || otherLanguage.matchesEntire(phrase))) {
                            if code == "US" { markedUS = true } else if code != nil { markedForeign = true }
                            index += length
                            matched = true
                            break
                        }
                    }
                    // An incomplete marker or an ordinary title commits no country evidence.
                    if !matched { return }
                }
            }
            result.us = result.us || markedUS
            result.foreign = result.foreign || markedForeign
        }
        for match in itemLabels.allMatches(name) {
            let groups = Pattern.groups(of: match, in: name)
            if let value = groups.compactMap({ $0 }).first { include(value) }
        }
        if let groups = itemPrefix.groups(name), let value = groups.compactMap({ $0 }).first { include(value) }
        return result
    }

    private static func metadataParts(_ value: String?) -> [String] {
        guard let value else { return [] }
        return value.split(whereSeparator: { ",;|/".contains($0) }).map { $0.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() }
            .filter { !$0.isEmpty }
    }

    private static func countryIsUS(_ country: String?) -> Bool {
        let parts = metadataParts(country)
        return !parts.isEmpty && parts.allSatisfy { Countries.code(forAlias: $0) == "US" }
    }

    private static func conflictingCountry(_ country: String?) -> Bool {
        metadataParts(country).contains { Countries.code(forAlias: $0) != "US" }
    }

    static func distinct(_ ids: [String]) -> [String] {
        var seen = Set<String>()
        return ids.filter { seen.insert($0).inserted }
    }

    static func usedCategories(_ ids: [String], _ categories: [Category], _ fallbackID: String, _ fallbackName: String) -> [Category] {
        let used = Set(ids)
        var seen = Set<String>()
        var result = categories.filter { used.contains($0.id) && $0.id != fallbackID && seen.insert($0.id).inserted }
        if used.contains(fallbackID) { result.append(Category(id: fallbackID, name: fallbackName)) }
        return result
    }
}

/// Country aliases (ISO alpha-2/alpha-3 and English names from Tizen's `countryRows`, plus Android's extras:
/// usa, u.s., u.s.a., united states of america → US; uk, britain, great britain → GB; "tv" removed).
public enum Countries {
    static let aliases: [String: String] = {
        var map: [String: String] = [:]
        for (alpha2, alpha3, name) in CountryTable.rows {
            map[alpha2.lowercased()] = alpha2
            map[alpha3.lowercased()] = alpha2
            map[name.lowercased()] = alpha2
        }
        for alias in ["usa", "u.s.", "u.s", "u.s.a.", "u.s.a", "united states of america", "united states"] { map[alias] = "US" }
        for alias in ["uk", "britain", "great britain", "united kingdom"] { map[alias] = "GB" }
        map["czech republic"] = "CZ"
        map["south korea"] = "KR"
        map["north korea"] = "KP"
        // Tuvalu's code is "TV": "Tubi TV (USA)" and "Reality-TV" are not Tuvaluan.
        map.removeValue(forKey: "tv")
        return map
    }()

    /// Lowercased alias → ISO alpha-2 ("usa" → "US", "uk" → "GB").
    public static func code(forAlias alias: String) -> String? { aliases[alias.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()] }
}

// MARK: - Cleanup (names, idle/off-air events, duplicate folding)

public struct LineupCleanup: Sendable, Hashable {
    public var channels: [Channel]
    /// Folded key → kept key (flattened).
    public var merged: [String: String]
    public init(channels: [Channel], merged: [String: String]) { self.channels = channels; self.merged = merged }
}

public enum Cleanup {
    // MARK: names

    private static let leadingCountry = Pattern(
        #"^\s*(?:[(\[|]\s*USA?\s*[)\]|]|USA?\s*[:|]|USA?\s*[-–]\s*|USA?\s{2,}|USA\s+[A-Z]{2,6}:|US\s+(?!Open\b|Weekly\b|Marshals\b|Navy\b|Army\b)|"#
            + #"USA\s+(?!Network\b|Today\b|Hockey\b|Rugby\b|Swimming\b|Gymnastics\b|Wrestling\b|Track\b|Softball\b|Baseball\b)(?=[A-Za-z0-9]))\s*"#)
    private static let leadingService = Pattern(#"^\s*\(\s*(?:PLUTO|STV|SAMSUNG|ROKU|TUBI|PLEX|XUMO)\s+USA?\s*\)\s*"#, caseInsensitive: true)
    private static let code = #"\(\s*(?:[A-Z0-9+]{1,5}|Prime|Tubi|Meo)\s*\)"#
    private static let leadingCode = Pattern(#"^\s*"# + code + #"\s*(?=\S)"#)
    private static let codeBeforeCountry = Pattern(#"^\s*"# + code + #"\s*(?=[(\[|]\s*USA?\s*[)\]|])"#)
    private static let leadingPlace = Pattern(#"^\s*[(\[]([^)\]]{3,30})[)\]]\s*(.+)$"#)
    private static let trailingCode = Pattern(#"\s*\((?:[A-Z]|HX|FEED|Feed)\)(?=\s*(?:\(|$))"#)
    private static let trailingCountry = Pattern(#"\s+USA?\s*$"#)
    private static let quality = Pattern(
        #"\s*\([^()]*@\s*[\d.]+\s*Mbps[^()]*\)|\s*\((?:F?HD|UHD|SD)\s*@[^)]*\)|"#
            + #"\s*[(\[]?\b(?:F?HD|UHD|4K|HEVC|H\.?265|1080[PI]?|720P|60\s*FPS|50\s*FPS)\b[)\]]?|\s*\(SD\)|\s+SD$|[ᴴᴰᵁᶠᴿᴬᵂʰᵈ⁶⁰ᵖˢ]{2,}"#,
        caseInsensitive: true)
    private static let backup = Pattern(#"\s*[(\[]?\bback\s*up\b[)\]]?"#, caseInsensitive: true)
    private static let vip = Pattern(#"\s*[(\[]?\bVIP\b[)\]]?"#)
    private static let eventWindow = Pattern(
        #"\s*start:\s*\d{4}\s\d{2}\s\d{2}\s[\d:]{8}\s+stop:\s*\d{4}\s\d{2}\s\d{2}\s[\d:]{8}"#, caseInsensitive: true)
    private static let spaces = Pattern(#"\s{2,}"#)
    private static let edges = Pattern(#"^[\s:|\-–]+|[\s:|\-–]+$"#)

    /// "(US) (SP) MeTV (KAZA)" → "MeTV (KAZA)", "US: NATIONAL GEOGRAPHIC HD" → "NATIONAL GEOGRAPHIC", "USA Network" stays.
    public static func displayName(_ raw: String) -> String {
        var s = raw.replacingOccurrences(of: "\u{00A0}", with: " ").trimmingCharacters(in: .whitespacesAndNewlines)
        s = eventWindow.replace(s, with: "")
        for _ in 0..<6 {
            var next = leadingService.replace(leadingCountry.replace(s, with: ""), with: "")
            next = next != s ? leadingCode.replace(next, with: "") : codeBeforeCountry.replace(next, with: "")
            if next == s { break }
            s = next
        }
        if let groups = leadingPlace.groups(s), groups.count == 2, let place = groups[0]?.trimmingCharacters(in: .whitespaces),
           let rest = groups[1]?.trimmingCharacters(in: .whitespaces), leadingPlace.matchesEntire(s),
           place.contains(where: { $0.isLowercase }), !rest.isEmpty {
            s = "\(rest) (\(place))"
        }
        for _ in 0..<3 { s = trailingCode.replace(s, with: "") }
        s = trailingCountry.replace(s, with: "")
        s = quality.replace(s, with: " ")
        s = backup.replace(s, with: " ")
        s = vip.replace(s, with: " ")
        s = s.replacingOccurrences(of: "()", with: " ").replacingOccurrences(of: "[]", with: " ")
        s = edges.replace(spaces.replace(s, with: " "), with: "").trimmingCharacters(in: .whitespacesAndNewlines)
        return s.isEmpty ? raw.trimmingCharacters(in: .whitespacesAndNewlines) : s
    }

    static func isBackupCopy(_ raw: String) -> Bool { backup.matches(raw) }

    // MARK: event slots

    private static let idlePhrase = Pattern(
        #"\b(?:no\s+(?:scheduled\s+)?(?:events?|games?|match(?:es)?|streams?)(?:\s+(?:scheduled|today|available))?|"#
            + #"no\s+live\s+(?:courts?|events?|games?|match(?:es)?)|offline|off\s*air|not\s+live|coming\s+soon)\b"#,
        caseInsensitive: true)
    private static let slotNumberOnly = Pattern(#"(?:^|\s)[|:]\s*\d{1,3}\s*$"#)
    private static let slotEventOnly = Pattern(#"[|:]\s*event\s*\d{1,3}\s*$"#, caseInsensitive: true)
    private static let parkedSlot = Pattern(#"\(\s*209\d\s+\d{2}\s+\d{2}\b"#)
    private static let brandAndNumber = Pattern(
        #"^(?:PPV|UFC|EVENT|LIVE\s*EVENT|ESPN\s*\+|ESPN\s*PLUS|ESPNPLUS|PEACOCK|PARAMOUNT\s*\+?|P\+|MAX\s*US|MILB|NCAA[FB]?|NFL|NBA|WNBA|NHL|MLB|MLS|"#
            + #"FLO\s*\w+|TENNIS\s*TV|WTA|ATP|FNTZ|USHTV|BIG\s*10\s*\+?)\s*(?:EVENT\s*)?\d{1,3}$"#,
        caseInsensitive: true)

    public static func isIdleEvent(_ name: String) -> Bool {
        let n = name.trimmingCharacters(in: .whitespacesAndNewlines)
        if n.isEmpty || idlePhrase.matches(n) || parkedSlot.matches(n) { return true }
        if n.hasPrefix(":") || n.hasSuffix(":") || n.hasSuffix("|") { return true }
        return slotNumberOnly.matches(n) || slotEventOnly.matches(n) || brandAndNumber.matchesEntire(n)
    }

    private static let shortDate = Pattern(#"\((\d{1,2})\.(\d{1,2})\s+(\d{1,2}):(\d{2})\s*([AP])M\s*E[SD]?T\)"#, caseInsensitive: true)
    private static let monthDate = Pattern(
        #"@\s*(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})\s+(\d{1,2}):(\d{2})\s*([AP])M"#, caseInsensitive: true)
    private static let stopTime = Pattern(#"stop:\s*(\d{4})\s(\d{2})\s(\d{2})\s(\d{2}):(\d{2}):(\d{2})"#, caseInsensitive: true)
    private static let longDate = Pattern(
        #"\b(\d{1,2})(?:st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?(?:\s+\d{4})?\s+(\d{1,2}):(\d{2})\s*([AP]?)M?\b"#,
        caseInsensitive: true)
    private static let months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"]
    private static let eventLength: TimeInterval = 6 * 3600
    private static let eventLead: TimeInterval = 20 * 3600

    /// Dated events in US Eastern time: off air when the start is > 6 h ago or > 20 h ahead.
    public static func isOffAir(_ name: String, now: Date) -> Bool {
        if let g = stopTime.groups(name)?.map({ Int($0 ?? "") ?? -1 }), g.count == 6,
           (1...12).contains(g[1]), (1...31).contains(g[2]), (0...23).contains(g[3]), (0...59).contains(g[4]) {
            var calendar = Calendar(identifier: .gregorian)
            calendar.timeZone = TimeZone(identifier: "UTC")!
            if let stop = calendar.date(from: DateComponents(year: g[0], month: g[1], day: g[2], hour: g[3], minute: g[4], second: max(0, g[5]))) {
                return stop < now
            }
        }
        var start: Date?
        if let g = shortDate.groups(name) {
            start = easternTime(month: Int(g[0] ?? ""), day: Int(g[1] ?? ""), clock: Int(g[2] ?? ""), minute: Int(g[3] ?? ""), ap: g[4] ?? "", now: now)
        } else if let g = monthDate.groups(name) {
            let month = months.firstIndex(of: (g[0] ?? "").lowercased()).map { $0 + 1 }
            start = easternTime(month: month, day: Int(g[1] ?? ""), clock: Int(g[2] ?? ""), minute: Int(g[3] ?? ""), ap: g[4] ?? "", now: now)
        } else if let g = longDate.groups(name) {
            let month = months.firstIndex(of: String((g[1] ?? "").lowercased().prefix(3))).map { $0 + 1 }
            start = easternTime(month: month, day: Int(g[0] ?? ""), clock: Int(g[2] ?? ""), minute: Int(g[3] ?? ""), ap: g[4] ?? "", now: now)
        } else {
            return false
        }
        guard let start else { return false }
        return start < now.addingTimeInterval(-eventLength) || start > now.addingTimeInterval(eventLead)
    }

    /// Listings carry no year: the year that puts the date nearest to now wins ("12.31" seen on January 1st is last year).
    private static func easternTime(month: Int?, day: Int?, clock: Int?, minute: Int?, ap: String, now: Date) -> Date? {
        guard let month, let day, let clock, let minute, (1...12).contains(month), (1...31).contains(day), (0...23).contains(clock),
              (0...59).contains(minute) else { return nil }
        // Some panels mix clocks: "19:00 PM" is already 24-hour.
        let hour = clock > 12 ? clock : clock % 12 + (ap.uppercased() == "P" ? 12 : 0)
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "America/New_York") ?? TimeZone(secondsFromGMT: -5 * 3600)!
        let year = calendar.component(.year, from: now)
        return (year - 1...year + 1).compactMap { y in
            calendar.date(from: DateComponents(year: y, month: month, day: day, hour: hour, minute: minute, second: 0))
        }.min { abs($0.timeIntervalSince(now)) < abs($1.timeIntervalSince(now)) }
    }

    // MARK: duplicates

    // Call letters (case-sensitive), counted only next to a network name so "WWE" or "FOX Sports WEST" never match.
    private static let callSign = Pattern(#"\b([KW][A-Z]{2,3})(?:-?(?:DT\d?|TV|CD|LD|CA))?\b"#)
    private static let networkWord = Pattern(#"\b(?:ABC|CBS|NBC|FOX|PBS|CW|MyNetwork|MyTV|MY|ION|Telemundo|Univision|UniMas)\b"#, caseInsensitive: true)
    private static let notCallSigns: Set<String> = ["WEST", "WARS", "WWE", "KIDS", "WILD", "WIDE", "WAR", "WAY", "WEB", "WIN", "WOW", "KEY", "WAVE", "WALL"]
    private static let eastFeed = Pattern(#"(?<![a-z0-9_])(?:east|eastern)(?![a-z0-9_])"#)
    private static let leadingThe = Pattern(#"^\s*the\s+"#)
    private static let nameAliases: [String: String] = [
        "natgeo": "nationalgeographic", "natgeowild": "nationalgeographicwild", "fs1": "foxsports1", "fs2": "foxsports2",
        "foxnewschannel": "foxnews", "foxbusinessnetwork": "foxbusiness", "cnninternational": "cnni",
    ]
    private static let heavy = Pattern(#"\b(?:4K|UHD)\b"#, caseInsensitive: true)
    private static let lowRes = Pattern(#"\bSD\b"#)
    private static let resolution = Pattern(#"\b(\d{3,4})p(\d{2})?\b"#, caseInsensitive: true)

    /// One local station: call letters plus network, so KAEF's ABC channel and its FOX subchannel stay apart.
    private static func stationKey(_ raw: String) -> String? {
        guard let network = networkWord.firstMatch(raw).flatMap({ Pattern.string($0.range, in: raw) })?.lowercased() else { return nil }
        let net = network.hasPrefix("my") ? "my" : network
        for match in callSign.allMatches(raw) {
            guard let call = Pattern.string(match.range(at: 1), in: raw), !notCallSigns.contains(call) else { continue }
            return "station:\(call):\(net)"
        }
        return nil
    }

    /// "TruTV", "TRU TV" and "truTV East" are one channel; "HBO West" is still its own feed.
    static func nameKey(_ display: String) -> String {
        var s = TextFold.fold(display, compatibility: true)
        s = s.replacingOccurrences(of: "&", with: " and ").replacingOccurrences(of: "+", with: " plus ")
        s = leadingThe.replace(eastFeed.replace(s, with: " "), with: "")
        let key = String(s.unicodeScalars.filter { ($0 >= "a" && $0 <= "z") || ($0 >= "0" && $0 <= "9") }.map(Character.init))
        return nameAliases[key] ?? key
    }

    private struct Entry {
        let channel: Channel
        let display: String
        let score: Int
        let order: Int
    }

    /// Android Cleanup.lineup: drops `hidden`, idle and off-air events; display names; folds duplicates (scores).
    /// (Android's +4 for copies listed under a "Most watched"/"Trending"/"Popular" category needs the category names,
    /// which this signature doesn't carry; that bonus is left out.)
    public static func lineup(_ channels: [Channel], hidden: Set<String>, now: Date) -> LineupCleanup {
        var groupOrder: [String] = []
        var groups: [String: [Entry]] = [:]
        for (index, channel) in channels.enumerated() {
            if hidden.contains(channel.key) || isIdleEvent(channel.name) || isOffAir(channel.name, now: now) { continue }
            let display = displayName(channel.name)
            var score = 0
            if let epg = channel.epgID, !epg.trimmingCharacters(in: .whitespaces).isEmpty { score += 8 }
            if isBackupCopy(channel.name) { score -= 10 }
            if display.contains(where: { $0.isLowercase }) { score += 3 }
            if heavy.matches(channel.name) { score -= 2 }
            if lowRes.matches(channel.name) { score -= 1 }
            if let g = resolution.groups(channel.name), let lines = Int(g[0] ?? "") {
                score += lines >= 1080 ? 2 : lines >= 720 ? 1 : -3
                if let fps = g[1], ["50", "59", "60"].contains(fps) { score += 1 }
            }
            let nameKey = nameKey(display)
            let key = stationKey(channel.name) ?? ("name:" + (nameKey.isEmpty ? channel.key : nameKey))
            if groups[key] == nil { groupOrder.append(key) }
            groups[key, default: []].append(Entry(channel: channel, display: display, score: score, order: index))
        }
        var merged: [String: String] = [:]
        var out: [Channel] = []
        out.reserveCapacity(groupOrder.count)
        for key in groupOrder {
            guard let members = groups[key] else { continue }
            let ranked = members.sorted { $0.score != $1.score ? $0.score > $1.score : $0.order < $1.order }
            var first = ranked[0].channel
            let rest = ranked.dropFirst()
            for entry in rest { merged[entry.channel.key] = first.key }
            // Several copies are ALL CAPS; use the best-ranked properly cased name.
            first.name = ranked.first(where: { $0.display.contains(where: { $0.isLowercase }) })?.display ?? ranked[0].display
            if first.logo == nil { first.logo = rest.lazy.compactMap { $0.channel.logo }.first }
            if first.epgID?.trimmingCharacters(in: .whitespaces).isEmpty ?? true {
                first.epgID = rest.lazy.compactMap { $0.channel.epgID }.first { !$0.trimmingCharacters(in: .whitespaces).isEmpty }
            }
            first.categoryIDs = ContentPolicy.distinct(ranked.flatMap { $0.channel.categoryIDs })
            var seenURLs = Set<URL>([first.url])
            first.backups = rest.map(\.channel.url).filter { seenURLs.insert($0).inserted }
            out.append(first)
        }
        return LineupCleanup(channels: out, merged: merged)
    }

    /// Groups by lowercase alphanumeric name, keeps the newest playable upload; other playable uploads become backups
    /// (newest first); categoryIDs unioned; tmdbID/year/genre taken from the first upload that has them.
    public static func movies(_ movies: [Movie]) -> [Movie] {
        var order: [String] = []
        var groups: [String: [Movie]] = [:]
        for movie in movies where PlaybackSupport.isPlayableVOD(url: movie.url, containerExtension: movie.containerExtension) {
            let alnum = String(movie.name.lowercased().unicodeScalars.filter { ($0 >= "a" && $0 <= "z") || ($0 >= "0" && $0 <= "9") }.map(Character.init))
            let key = alnum.isEmpty ? "id:" + movie.id : alnum
            if groups[key] == nil { order.append(key) }
            groups[key, default: []].append(movie)
        }
        return order.compactMap { key -> Movie? in
            guard let copies = groups[key], !copies.isEmpty else { return nil }
            if copies.count == 1 { return copies[0] }
            // Newest first; the first of equal `added` keeps its place (Kotlin maxBy).
            let newestFirst = copies.enumerated().sorted { $0.element.added != $1.element.added ? $0.element.added > $1.element.added : $0.offset < $1.offset }
                .map(\.element)
            var kept = newestFirst[0]
            kept.categoryIDs = ContentPolicy.distinct(kept.categoryIDs + copies.flatMap(\.categoryIDs))
            var seen = Set<URL>([kept.url])
            kept.backups = (kept.backups + newestFirst.flatMap { [$0.url] + $0.backups }).filter { seen.insert($0).inserted }
            if kept.tmdbID == nil { kept.tmdbID = newestFirst.lazy.compactMap(\.tmdbID).first }
            if kept.year == nil { kept.year = newestFirst.lazy.compactMap(\.year).first }
            if kept.genre == nil { kept.genre = newestFirst.lazy.compactMap(\.genre).first }
            if kept.poster == nil { kept.poster = newestFirst.lazy.compactMap(\.poster).first }
            if kept.rating == nil { kept.rating = newestFirst.lazy.compactMap(\.rating).first }
            return kept
        }
    }
}

/// Android ChannelMatch.kt (explicit ASCII classes; NSRegularExpression where lookbehind is needed).
public enum ChannelMatch {
    private static let prefix = Pattern(#"^[^A-Za-z0-9_]*(?:[a-z]{2}\s*[:|\]\-–▎]+|[a-z]{3,4}\s*[:|\]▎]+)\s*"#)
    private static let bracketed = Pattern(#"[\[(][^\])]*[\])]"#)
    private static let noise = Pattern(
        #"(?<![A-Za-z0-9_])(?:fhd|uhd|hd|sd|hq|lq|4k|8k|hevc|h\.?265|h\.?264|\d{3,4}p|\d{2}fps|raw|backup|alt|multi|vip|feed|east|eastern|channel|and)(?![A-Za-z0-9_])"#)
    private static let regional = Pattern(#"(?<![A-Za-z0-9_])(?:west|pacific|mountain|central|western)(?![A-Za-z0-9_])"#)
    private static let leadingThe = Pattern(#"^the\s+"#)
    private static let camel = Pattern(#"([a-z])([A-Z])"#)
    private static let aliases: [String: String] = [
        "homegardentelevision": "hgtv", "homegardentv": "hgtv", "homeboxoffice": "hbo", "turnernetworktelevision": "tnt",
        "turnerclassicmovies": "tcm", "americanmovieclassics": "amc", "artsentertainment": "ae", "theweather": "weather",
        "weathernetwork": "weather", "cablenewsnetwork": "cnn", "musictelevision": "mtv", "blackentertainmenttelevision": "bet",
        "countrymusictelevision": "cmt", "newenglandsportsnetwork": "nesn", "newenglandsportsnetworkplus": "nesnplus",
    ]

    public static func key(_ name: String) -> String {
        var s = name.decomposedStringWithCompatibilityMapping.lowercased()
        s = s.replacingOccurrences(of: "_", with: " ").replacingOccurrences(of: ".", with: " ")
        s = prefix.replace(s, with: "")
        s = bracketed.replace(s, with: " ")
        s = s.replacingOccurrences(of: "&", with: " ").replacingOccurrences(of: "+", with: " plus ")
        s = noise.replace(s, with: " ")
        s = regional.replace(s, with: " ")
        s = leadingThe.replace(s, with: "")
        let key = String(s.unicodeScalars.filter { ($0 >= "a" && $0 <= "z") || ($0 >= "0" && $0 <= "9") }.map(Character.init))
        return aliases[key] ?? key
    }

    public static func idKey(_ id: String) -> String {
        let base: String
        if let dot = id.lastIndex(of: ".") { base = String(id[..<dot]) } else { base = id }
        return key(camel.replace(base, template: "$1 $2"))
    }

    /// Regional variants (Pacific/West feeds) lose to the main feed.
    static func isRegional(_ raw: String) -> Bool { regional.matches(raw.lowercased()) || raw.contains("(P)") }
}

// MARK: - What Apple TV can play

public enum VODContainer: Sendable, Equatable {
    case mp4
    case quickTime
    case hls
    case unknown
    case unsupported(String)
}

public enum PlaybackSupport {
    private static let unsupported: Set<String> = ["mkv", "avi", "flv", "wmv", "ts", "webm", "mpg", "mpeg", "divx", "vob", "ogm", "rmvb", "3gp"]

    /// mp4/m4v → .mp4, mov → .quickTime, m3u8 → .hls, none → .unknown (tried),
    /// mkv/avi/flv/wmv/ts/webm/mpg/mpeg/divx/vob/ogm/rmvb/3gp → .unsupported(ext). `containerExtension` wins over the URL.
    public static func vodContainer(url: URL, containerExtension: String?) -> VODContainer {
        var ext = containerExtension?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() ?? ""
        if ext.hasPrefix(".") { ext.removeFirst() }
        if ext.isEmpty { ext = url.pathExtension.lowercased() }
        switch ext {
        case "mp4", "m4v": return .mp4
        case "mov": return .quickTime
        case "m3u8": return .hls
        case "": return .unknown
        default: return unsupported.contains(ext) ? .unsupported(ext) : .unknown
        }
    }

    /// Everything except `.unsupported`.
    public static func isPlayableVOD(url: URL, containerExtension: String?) -> Bool {
        if case .unsupported = vodContainer(url: url, containerExtension: containerExtension) { return false }
        return true
    }
}

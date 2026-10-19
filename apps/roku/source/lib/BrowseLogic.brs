' Movies & Series browsing rules shared by every Tuner app (docs/browse.md), in plain BrightScript.
' Nothing here touches m, SceneGraph nodes, the registry or the network, so the catalog task
' (ApiTask), the screen (MainScene) and the on-device tests (apps/roku/tests) all run the same code.

' ------------------------------------------------------------------ values

function asText(v as dynamic) as string
    if v = invalid then return ""
    t = type(v)
    if t = "roString" or t = "String" then return v
    if t = "roInteger" or t = "Integer" or t = "roLongInteger" or t = "LongInteger" then return v.ToStr()
    if t = "roFloat" or t = "Float" or t = "roDouble" or t = "Double"
        if v = Int(v) and Abs(v) < 2147483647 then return Int(v).ToStr()
        return Str(v).Trim()
    end if
    if t = "roBoolean" or t = "Boolean"
        if v then return "true"
        return "false"
    end if
    return ""
end function

' Xtream marks adult categories and streams with is_adult = 1, "1" or true.
function isFlagOn(v as dynamic) as boolean
    t = asText(v)
    return t = "1" or LCase(t) = "true"
end function

function isAssoc(v as dynamic) as boolean
    return type(v) = "roAssociativeArray"
end function

function isTrueValue(v as dynamic) as boolean
    t = type(v)
    if t = "Boolean" or t = "roBoolean" then return v
    return false
end function

function arrayOrEmpty(v as dynamic) as object
    if type(v) = "roArray" then return v
    return []
end function

' An associative array that tells keys apart by letter case. One made with {} or CreateObject("roAssociativeArray")
' alone ignores the case of its keys, so the groups "it | movies" and "IT | Movies", or the stream ids "ab1" and "AB1",
' would be one key there. Every array keyed by provider text (category ids, group names, stream ids) is made with this
' and read with brackets (aa[key]): the emulator (brs-cli) answers a dot lookup ignoring case even here. The screen
' gets the catalogue as a copy through a node field, which is not counted on to keep this mode, so what it looks up
' there is kept under ids made here (m3uSections, grouped) or checked against the title itself (titleIndexOf).
function exactKeys() as object
    aa = CreateObject("roAssociativeArray")
    aa.SetModeCaseSensitive()
    return aa
end function

function numberOf(v as dynamic) as float
    t = asText(v).Trim()
    if t = "" then return 0
    return Val(t)
end function

' ------------------------------------------------------------------ fixed lists

' Streaming services in the order Home shows them. words is used for the fallback by category name.
function browseServices() as object
    return [
        {key: "netflix", name: "Netflix"},
        {key: "disney", name: "Disney+"},
        {key: "max", name: "Max"},
        {key: "prime", name: "Prime Video"},
        {key: "apple", name: "Apple TV+"},
        {key: "hulu", name: "Hulu"},
        {key: "paramount", name: "Paramount+"},
        {key: "peacock", name: "Peacock"}
    ]
end function

' Compiled once per thread and passed to the functions below, so a 20,000-title catalogue is not
' recompiling the same patterns for every title.
function browseRx() as object
    services = {
        netflix: CreateObject("roRegex", "NETFLIX", ""),
        disney: CreateObject("roRegex", "DISNEY", ""),
        max: CreateObject("roRegex", "HBO|(^|[^A-Z0-9])MAX([^A-Z0-9]|$)", ""),
        prime: CreateObject("roRegex", "AMAZON|(^|[^A-Z0-9])PRIME([^A-Z0-9]|VIDEO|$)", ""),
        apple: CreateObject("roRegex", "APPLE", ""),
        hulu: CreateObject("roRegex", "HULU", ""),
        paramount: CreateObject("roRegex", "PARAMOUNT", ""),
        peacock: CreateObject("roRegex", "PEACOCK", "")
    }
    ' The category filter's codes and written-out names (docs/browse.md). The patterns below are the doc's, as written:
    ' no lookbehind, and the en dash, ñ and Ñ stay outside character classes because roRegex may match bytes.
    codes = "FR|DE|ES|LAT|MX|BR|PT|TR|AR|PK|NL|PL|RO|RU|UK|CA|AF"
    ' Rules 3 and 4 ignore the case of ASCII letters only. The "i" flag and LCase may also fold letters beyond ASCII
    ' (ſ as s, the Kelvin sign as k), so they run without it, in lower case, on a copy with only A to Z lower-cased
    ' (asciiLower).
    lowerCodes = "fr|de|es|lat|mx|br|pt|tr|ar|pk|nl|pl|ro|ru|uk|ca|af"
    words = "french|france|german|germany|deutsch|italian|italiano|italia|italy|spanish|espa(n|ñ|Ñ)ol|spain|castellano|latino|latina|latam|mexico|mexican|brazil|brasil|brazilian|portuguese|portugal|turkish|turkey|arab|arabic|india|indian|hindi|bollywood|tamil|telugu|malayalam|kannada|bengali|punjabi|pakistan|pakistani|urdu|dutch|netherlands|polish|poland|polska|romanian|romania|russian|russia|british|canada|canadian|quebec|korean|japanese|chinese|filipino|vietnamese|thai|persian|farsi|greek|albanian|kurdish"
    ' TAG: a short upper-case code, or a quality word in any ASCII letter case where no short upper-case code followed
    ' by a space or the end fits ("hd", "HDR10", "1080p"; "4K", "HD" and "UHD" are codes). Each tag then matches in one
    ' way only, so yearEnd takes time in proportion to the name: with two ways for 4K, HD, SD, UHD, FHD and HDR, each
    ' further tag doubled the time it took to give up on "Movie - 1999 - 4K - ... - 4K - Extended".
    tag = "[A-Z0-9+]{2,4}|(?![A-Z0-9+]{2,4}(\s|$))([48][Kk]|[UuFf]?[Hh][Dd]|[Ss][Dd]|[Hh][Dd][Rr](10)?|(1080|720|2160)[Pp])"
    ' The Unicode spaces every rule reads as a space (docs/browse.md, "Spaces and letter case"): replaced one by one
    ' (unicodeSpaces), never with \s, which covers a different set in every engine.
    spaceChars = [Chr(&h85), Chr(&hA0), Chr(&h1680), Chr(&h2028), Chr(&h2029), Chr(&h202F), Chr(&h205F), Chr(&h3000), Chr(&hFEFF)]
    for code = &h2000 to &h200A
        spaceChars.Push(Chr(code))
    end for
    return {
        spaceChars: spaceChars,
        ' The patterns of docs/browse.md ("Patterns for titles, years and countries"), all case-sensitive.
        ' Normalize step 2 (BRACKETS): [4K], {EN}, a year in parentheses and a short upper-case tag in parentheses
        ' ((US), (U.S.), (MULTI)).
        brackets: CreateObject("roRegex", "\[[^\]]*\]|\{[^}]*\}|\(\s*(18|19|20)[0-9]{2}\s*\)|\([A-Z0-9 +.]{1,6}\)", ""),
        ' Step 3.1 (LEADING): a short upper-case tag between pipes ("|US| "), or a short upper-case code that is not a
        ' year followed by |, : or a dash ("US - ", "EN| ", "NF: ", "4K-NF-EN | ").
        leading: CreateObject("roRegex", "^\s*(\|\s*[A-Z0-9+]{1,6}\s*\|\s*|(?!(18|19|20)[0-9]{2}([^A-Z0-9+]|$))[A-Z0-9+]{2,4}(\s*[-_]\s*[A-Z0-9+]{2,4})*\s*(\|\s*|([:-]|–)\s+))", ""),
        ' Step 3.2 (TRAILING): " | EN", " - 4K", " | 1999", " – 1080p".
        trailing: CreateObject("roRegex", "\s(\||-|–)\s*(" + tag + ")\s*$", ""),
        ' Step 3.3 (PIPES): |US|, | 4K |, not | The Matrix |.
        pipes: CreateObject("roRegex", "\|\s*[A-Z0-9+]{1,6}\s*\|", ""),
        ' Years: a provider's "2021-05-01" (YEAR_FIELD, group 1); "Dune (2021)", "Show [ 2019 ]" (YEAR_BRACKETS, group 1);
        ' the year among the trailing tags, "EN | Wonka | 2023", "Heat – 1995 - 4K", "2012 | 1999 | EN" (YEAR_END, group 2).
        yearField: CreateObject("roRegex", "^\s*((18|19|20)[0-9]{2})([^0-9]|$)", ""),
        yearBrackets: CreateObject("roRegex", "[(\[]\s*((18|19|20)[0-9]{2})\s*[)\]]", ""),
        yearEnd: CreateObject("roRegex", "\s(\||-|–)\s*((18|19|20)[0-9]{2})(\s+(\||-|–)\s*(?!(18|19|20)[0-9]{2}(\s|$))(" + tag + "))*\s*$", ""),
        ' An origin entry that is a country: two ASCII letters, spaces around them allowed (COUNTRY, group 1).
        country: CreateObject("roRegex", "^\s*([A-Za-z]{2})\s*$", ""),
        ' Matching step 1 (TMDB_ID): a provider TMDB id given as a string, once trimmed as a provider field (group 1).
        tmdbId: CreateObject("roRegex", "^([0-9]{1,12})(\.0)?$", ""),
        ' Trimming (trimEnds, trimField): the run of [ \t\n\x0B\f\r] that starts a text, and the one that ends it. The
        ' second starts only where a run starts (not after one of these characters), so a run inside the text is tried
        ' once, from its start, and each pattern takes time in proportion to the text, never to the square of a run.
        edgeLead: CreateObject("roRegex", "^[ \t\n\x0B\f\r]+", ""),
        edgeTrail: CreateObject("roRegex", "(?<![ \t\n\x0B\f\r])[ \t\n\x0B\f\r]+$", ""),
        ' An M3U key (m3uExtinf): a run of ASCII letters, digits, "_" and "-", taken whole (group 1), then spaces (U+0020)
        ' to the end of the text. A match starts only where a run starts, so each run is tried once. (?![\s\S]) is the
        ' very end of the text: $ also matches before a final line end, and which characters end a line in PCRE depends
        ' on how it was built.
        m3uKey: CreateObject("roRegex", "(?<![A-Za-z0-9_-])([A-Za-z0-9_-]+) *(?![\s\S])", ""),
        ' The M3U tags m3uEntries reads at the start of a line, in any ASCII letter case (group 1): #EXTM3U, #EXTINF
        ' (with or without its colon) and #EXTGRP:.
        m3uTag: CreateObject("roRegex", "^#[Ee][Xx][Tt]([Mm]3[Uu]|[Ii][Nn][Ff]|[Gg][Rr][Pp]:)", ""),
        nonWord: CreateObject("roRegex", "[^a-z0-9]+", ""),
        nonAscii: CreateObject("roRegex", "[^\x00-\x7F]", ""),
        upperAscii: CreateObject("roRegex", "[A-Z]", ""),
        ' foldTable(), built on first use: the screen's copy of these patterns never normalizes a title.
        fold: invalid,
        quality: {"4k": true, "8k": true, "uhd": true, "fhd": true, "hd": true, "sd": true, "hdr": true, "hdr10": true, "1080p": true, "720p": true, "2160p": true},
        genreSplit: CreateObject("roRegex", "[,/|&;]+", ""),
        ' Parts of a category name that can each name a genre: "EN | Action Movies", "Kids & Family".
        categorySplit: CreateObject("roRegex", "[,/|&;:()\[\]]+|\s+-\s+|–", ""),
        spaces: CreateObject("roRegex", "\s+", ""),
        ' Category rule 1: a country or language code in upper case, as a whole word ("FR | Films", "Movies CA").
        foreignCode: CreateObject("roRegex", "(^|[^A-Za-z0-9])(" + codes + ")([^A-Za-z0-9]|$)", ""),
        ' Rule 2: IN and IT in upper case only as a tag ("IN | Movies", "Serie IT"), never as the English word in
        ' "MOVIES IN 4K", "EN | IN THEATERS" or "IT CHAPTER TWO".
        foreignInIt: CreateObject("roRegex", "(^|[^A-Za-z0-9])(IN|IT)\s*([|:\[\]()/-]|–|$)", ""),
        ' Rule 3: a rule 1 code in any ASCII letter case, as a tag ("Fr | Films", "(Pt) Novelas", "[ru] Kino").
        foreignTag: CreateObject("roRegex", "^[^A-Za-z0-9]*(" + lowerCodes + ")\s*([|:\])/-]|–)|\|\s*(" + lowerCodes + ")\s*\||\[\s*(" + lowerCodes + ")\s*\]|\(\s*(" + lowerCodes + ")\s*\)", ""),
        ' Rule 4: a country or language written out, in any ASCII letter case ("French Cinema", "FRENCH4K").
        foreignWord: CreateObject("roRegex", "(^|[^A-Za-z])(" + words + ")([^A-Za-z]|$)", ""),
        adult: CreateObject("roRegex", "(^|[^a-z0-9])(xxx|adults?|18\+|porn)([^a-z0-9]|$)", "i"),
        adultSwim: CreateObject("roRegex", "adult\s*swim", "i"),
        services: services
    }
end function

' Normalize step 7 without Unicode normalization, which BrightScript lacks: each Latin-1, Latin Extended-A and -B,
' Latin Extended Additional letter, f/s ligature, fullwidth digit and letter, Roman numeral and circled number and
' letter as Unicode NFKD leaves it once U+0300 to U+036F are dropped and æ ae, œ oe, ø o, ß ss, đ d, ł l, ð d, þ th
' are folded (docs/browse.md). Upper-case letters are listed too, because LCase may leave non-ASCII letters alone.
' A space stands for a character that becomes one (ŀ is "l·"). Any other character is kept, so step 8 turns it
' into a space.
function foldTable() as object
    groups = [
        [" n", "ŉ"], ["1", "¹"], ["1 2", "½"], ["1 4", "¼"], ["2", "²"], ["3", "³"], ["3 4", "¾"],
        ["a", "ªÀÁÂÃÄÅàáâãäåĀāĂăĄąǍǎǞǟǠǡǺǻȀȁȂȃȦȧḀḁẠạẢảẤấẦầẨẩẪẫẬậẮắẰằẲẳẴẵẶặ"], ["a ", "ẚ"], ["ae", "ÆæǢǣǼǽ"],
        ["b", "ḂḃḄḅḆḇ"], ["c", "ÇçĆćĈĉĊċČčḈḉ"], ["d", "ÐðĎďĐđḊḋḌḍḎḏḐḑḒḓ"], ["dz", "ǄǅǆǱǲǳ"],
        ["e", "ÈÉÊËèéêëĒēĔĕĖėĘęĚěȄȅȆȇȨȩḔḕḖḗḘḙḚḛḜḝẸẹẺẻẼẽẾếỀềỂểỄễỆệ"], ["f", "Ḟḟ"], ["ff", "ﬀ"], ["ffi", "ﬃ"],
        ["ffl", "ﬄ"], ["fi", "ﬁ"], ["fl", "ﬂ"], ["g", "ĜĝĞğĠġĢģǦǧǴǵḠḡ"], ["h", "ĤĥȞȟḢḣḤḥḦḧḨḩḪḫẖ"],
        ["i", "ÌÍÎÏìíîïĨĩĪīĬĭĮįİǏǐȈȉȊȋḬḭḮḯỈỉỊị"], ["ij", "Ĳĳ"], ["j", "Ĵĵǰ"], ["k", "ĶķǨǩḰḱḲḳḴḵ"],
        ["l", "ĹĺĻļĽľŁłḶḷḸḹḺḻḼḽ"], ["l ", "Ŀŀ"], ["lj", "Ǉǈǉ"], ["m", "ḾḿṀṁṂṃ"], ["n", "ÑñŃńŅņŇňǸǹṄṅṆṇṈṉṊṋ"],
        ["nj", "Ǌǋǌ"], ["o", "ºÒÓÔÕÖØòóôõöøŌōŎŏŐőƠơǑǒǪǫǬǭǾǿȌȍȎȏȪȫȬȭȮȯȰȱṌṍṎṏṐṑṒṓỌọỎỏỐốỒồỔổỖỗỘộỚớỜờỞởỠỡỢợ"],
        ["oe", "Œœ"], ["p", "ṔṕṖṗ"], ["r", "ŔŕŖŗŘřȐȑȒȓṘṙṚṛṜṝṞṟ"], ["s", "ŚśŜŝŞşŠšſȘșṠṡṢṣṤṥṦṧṨṩẛ"], ["ss", "ßẞ"],
        ["st", "ﬅﬆ"], ["t", "ŢţŤťȚțṪṫṬṭṮṯṰṱẗ"], ["th", "Þþ"],
        ["u", "ÙÚÛÜùúûüŨũŪūŬŭŮůŰűŲųƯưǓǔǕǖǗǘǙǚǛǜȔȕȖȗṲṳṴṵṶṷṸṹṺṻỤụỦủỨứỪừỬửỮữỰự"], ["v", "ṼṽṾṿ"], ["w", "ŴŵẀẁẂẃẄẅẆẇẈẉẘ"],
        ["x", "ẊẋẌẍ"], ["y", "ÝýÿŶŷŸȲȳẎẏẙỲỳỴỵỶỷỸỹ"], ["z", "ŹźŻżŽžẐẑẒẓẔẕ"]
    ]
    fold = {}
    for each group in groups
        letters = group[1]
        for i = 1 to Len(letters)
            fold[Mid(letters, i, 1)] = group[0]
        end for
    end for
    ' Fullwidth digits (U+FF10 to U+FF19) and letters (U+FF21 to U+FF3A, U+FF41 to U+FF5A), and circled letters
    ' (U+24B6 to U+24CF, U+24D0 to U+24E9): "Ｆｕｌｌ" is "full", "Ⓐ" is "a".
    for n = 0 to 9
        fold[Chr(&hFF10 + n)] = n.ToStr()
    end for
    for n = 0 to 25
        letter = Chr(&h61 + n)
        fold[Chr(&hFF21 + n)] = letter
        fold[Chr(&hFF41 + n)] = letter
        fold[Chr(&h24B6 + n)] = letter
        fold[Chr(&h24D0 + n)] = letter
    end for
    ' Circled numbers one to twenty (U+2460 to U+2473): "⑪" is "11".
    for n = 1 to 20
        fold[Chr(&h245F + n)] = n.ToStr()
    end for
    ' Roman numerals (U+2160 to U+216F upper case, U+2170 to U+217F lower case): "Ⅸ" and "ⅸ" are "ix".
    roman = ["i", "ii", "iii", "iv", "v", "vi", "vii", "viii", "ix", "x", "xi", "xii", "l", "c", "d", "m"]
    for n = 0 to 15
        fold[Chr(&h2160 + n)] = roman[n]
        fold[Chr(&h2170 + n)] = roman[n]
    end for
    ' The Kelvin and Angstrom signs, which a Unicode LCase turns into k and å, as a Roku's may not.
    fold[Chr(&h212A)] = "k"
    fold[Chr(&h212B)] = "a"
    ' Combining marks U+0300 to U+036F, and only those, are dropped, as in a name written "Ame" + Chr(&h301) + "lie".
    ' Other marks (U+0483, U+1AB0, U+20D7, U+FE20...) are kept, so step 8 turns them into a space.
    for code = &h300 to &h36F
        fold[Chr(code)] = ""
    end for
    return fold
end function

' ------------------------------------------------------------------ titles

' Normalized title for matching (docs/browse.md, "Normalize"): "EN | The Matrix | 1999" -> "matrix".
function normalizeTitle(name as string, rx as object) as string
    return normalizeKey(name, true, rx)
end function

' Normalize steps 1 to 10. With stripTags false, steps 3.1, 3.2 and 3.4 (leading and trailing tags) are skipped:
' the second key a provider title is looked up under ("CSI: Miami" is tried as "miami", then as "csi miami").
function normalizeKey(name as string, stripTags as boolean, rx as object) as string
    ' The Instr checks skip patterns that cannot match, which keeps a 20,000-title catalogue quick.
    s = trimEnds(unicodeSpaces(name, rx), rx)
    if Instr(1, s, "[") > 0 or Instr(1, s, "{") > 0 or Instr(1, s, "(") > 0 then s = rx.brackets.ReplaceAll(s, " ")
    ' Step 3: trailing tags go before the tags between pipes, so "Dune | 4K | EN" loses " | EN", then " | 4K".
    if stripTags then s = stripEndTags(s, rx)
    if Instr(1, s, "|") > 0 then s = rx.pipes.ReplaceAll(s, " ")
    if stripTags then s = stripEndTags(s, rx)
    s = LCase(s)
    if Instr(1, s, "&") > 0 then s = s.Replace("&", " and ")
    for each apostrophe in ["'", "`", "´", "’"]
        if Instr(1, s, apostrophe) > 0 then s = s.Replace(apostrophe, "")
    end for
    if rx.nonAscii.IsMatch(s)
        if rx.fold = invalid then rx.fold = foldTable()
        s = foldAccents(s, rx.fold)
    end if
    s = rx.nonWord.ReplaceAll(s, " ")
    words = []
    for each word in s.Split(" ")
        if word <> "" and not rx.quality.DoesExist(word) then words.Push(word)
    end for
    if words.Count() > 1 and words[0] = "the" then words.Shift()
    return words.Join(" ")
end function

' Normalize steps 3.1 and 3.2: up to three leading tags, then trailing tags, the last one first, for as long as one
' ends the name ("4K | NF | Stranger Things - EN" -> "Stranger Things", "Heat - 1995 - 4K" -> "Heat").
function stripEndTags(s as string, rx as object) as string
    if not hasTagSeparator(s) then return s
    for i = 1 to 3
        stripped = rx.leading.Replace(s, "")
        if stripped = s then exit for
        s = stripped
    end for
    ' Each removal shortens the name, so this ends.
    while true
        stripped = rx.trailing.Replace(s, "")
        if stripped = s then exit while
        s = stripped
    end while
    return s
end function

' A leading or trailing tag (normalize step 3) needs one of | : - –.
function hasTagSeparator(s as string) as boolean
    return Instr(1, s, "|") > 0 or Instr(1, s, ":") > 0 or Instr(1, s, "-") > 0 or Instr(1, s, "–") > 0
end function

' docs/browse.md, "Spaces and letter case": U+0085, U+00A0, U+1680, U+2000 to U+200A, U+2028, U+2029, U+202F,
' U+205F, U+3000 and U+FEFF become a space before any rule reads a text. Names in plain ASCII are returned as they are.
function unicodeSpaces(s as string, rx as object) as string
    if not rx.nonAscii.IsMatch(s) then return s
    for each space in rx.spaceChars
        if Instr(1, s, space) > 0 then s = s.Replace(space, " ")
    end for
    return s
end function

' Normalize step 1, after unicodeSpaces: space, tab, line feed, vertical tab, form feed and carriage return off both
' ends, so " - 1999" is read as "- 1999" whether or not the provider trimmed it. Trim is not used: it may also remove
' other characters, such as U+001C to U+001F or U+180E. Nor is a pattern such as ^[ \t\n\x0B\f\r]+|[ \t\n\x0B\f\r]+$:
' it tries the second half again at every space of a run inside the name, so its time grows with the square of the
' run (docs/browse.md, "Trimming"). Nor a loop over the characters, which takes seconds for a name between two runs
' of 16,000 spaces. Most names have nothing to trim, which the first check finds.
function trimEnds(s as string, rx as object) as string
    if s = "" then return s
    if Asc(s) > 32 and Asc(Right(s, 1)) > 32 then return s
    return cutEdges(s, s, rx)
end function

' s without the characters at its ends that are [ \t\n\x0B\f\r] in measured, a text of the same length (s itself, or
' a copy of s with its Unicode spaces replaced). rx.edgeLead and rx.edgeTrail measure the two runs, each in time that
' grows in proportion to the text.
function cutEdges(s as string, measured as string, rx as object) as string
    size = Len(measured)
    first = 1
    found = rx.edgeLead.Match(measured)
    if found.Count() > 0 then first = Len(found[0]) + 1
    if first > size then return ""
    last = size
    found = rx.edgeTrail.Match(measured)
    if found.Count() > 0 then last = size - Len(found[0])
    if first = 1 and last = size then return s
    return Mid(s, first, last - first + 1)
end function

' Space, tab, line feed, vertical tab, form feed or carriage return.
function isEdgeSpace(code as integer) as boolean
    return code = 32 or (code >= 9 and code <= 13)
end function

' A provider field as the catalogue reads it (an M3U line, title and value, a TMDB id string): space, tab, line feed,
' vertical tab, form feed, carriage return and the Unicode spaces of unicodeSpaces off both ends, and nothing else.
' Trim is not used: it may also remove other characters, and a name such as U+001F followed by " - 1999" would
' change. The ends are measured on a copy with the Unicode spaces replaced (one character each, so the lengths
' agree), the same way as in trimEnds.
function trimField(s as string, rx as object) as string
    if s = "" then return s
    if not isFieldSpace(Asc(s)) and not isFieldSpace(Asc(Right(s, 1))) then return s
    return cutEdges(s, unicodeSpaces(s, rx), rx)
end function

' Space, tab, line feed, vertical tab, form feed, carriage return, or one of the Unicode spaces (docs/browse.md).
function isFieldSpace(code as integer) as boolean
    if isEdgeSpace(code) then return true
    if code < &h85 then return false
    return code = &h85 or code = &hA0 or code = &h1680 or (code >= &h2000 and code <= &h200A) or code = &h2028 or code = &h2029 or code = &h202F or code = &h205F or code = &h3000 or code = &hFEFF
end function

' s with A to Z in lower case and every other character as it is, for the rules that ignore the case of ASCII
' letters only. LCase is not used: it may lower-case letters beyond ASCII too.
function asciiLower(s as string, rx as object) as string
    if not rx.upperAscii.IsMatch(s) then return s
    out = []
    for i = 1 to Len(s)
        ch = Mid(s, i, 1)
        code = Asc(ch)
        if code >= 65 and code <= 90 then ch = Chr(code + 32)
        out.Push(ch)
    end for
    return out.Join("")
end function

' Folds each non-ASCII character found in fold (foldTable); every other character is kept.
function foldAccents(s as string, fold as object) as string
    out = []
    for i = 1 to Len(s)
        ch = Mid(s, i, 1)
        if Asc(ch) > 127
            plain = fold[ch]
            if plain <> invalid then ch = plain
        end if
        out.Push(ch)
    end for
    return out.Join("")
end function

' The year in a name, with its ends trimmed as in normalize step 1: the first (YYYY) or [YYYY] (also (YYYY] and
' [YYYY)), else the first year met taking trailing tags off the end of the name ("EN | Wonka | 2023",
' "Heat - 1995 - 4K", "2012 | 1999 | EN" -> "1999"). A bare number ending a name is part of the title
' ("Blade Runner 2049"), and so is one with no space before its dash (" - 1999" is read as "- 1999").
function titleYearOf(name as string, rx as object) as string
    s = trimEnds(unicodeSpaces(name, rx), rx)
    if Instr(1, s, "(") > 0 or Instr(1, s, "[") > 0
        found = rx.yearBrackets.Match(s)
        if found.Count() > 1 then return found[1]
    end if
    if Instr(1, s, "|") > 0 or Instr(1, s, "-") > 0 or Instr(1, s, "–") > 0
        found = rx.yearEnd.Match(s)
        if found.Count() > 2 then return found[2]
    end if
    return ""
end function

' A provider year field: "2021-05-01", "2021" or 2021 -> "2021"; "20211" or "N/A" -> "". Unicode spaces before the
' year count as spaces.
function yearOfText(v as dynamic, rx as object) as string
    if v = invalid then return ""
    found = rx.yearField.Match(unicodeSpaces(asText(v), rx))
    if found.Count() > 1 then return found[1]
    return ""
end function

' The provider's TMDB id (docs/browse.md, Matching step 1): the first of tmdb, tmdb_id, info.tmdb_id and info.tmdb
' (the last two only when info is an object) whose value gives an id (tmdbIdOf), without leading zeros; or "".
' Keys match exactly, letter case included: TMDB and Tmdb_Id are other keys. ParseJson (without the "i" flag, as
' ApiTask calls it) gives arrays that keep each key's case and look keys up case-sensitively, so the keys are read
' with brackets on the row as ParseJson gave it. Not with dot lookups (row.tmdb), which the emulator answers ignoring
' case, so that {"TMDB":"5"} would give 5 there and none on a Roku.
function providerTmdbId(row as object, rx as object) as string
    values = [row["tmdb"], row["tmdb_id"]]
    info = row["info"]
    if isAssoc(info) then values.Append([info["tmdb_id"], info["tmdb"]])
    for each v in values
        id = tmdbIdOf(v, rx)
        if id <> "" then return id
    end for
    return ""
end function

' One provider TMDB id value as ParseJson gives it, told apart by its type and never turned into text first:
' - a string, trimmed as a provider field (trimField, not Trim), that matches TMDB_ID in ASCII digits: group 1
'   without its leading zeros, "" when it is all zeros (" 0123 " and "123.0" -> "123"; "123 .0", "1e3" -> "");
' - an Integer or LongInteger from 1 to 999999999999;
' - a Float (ParseJson's number with a fraction or an exponent, single precision, exact up to 16777216) that is a
'   whole number from 1 to below 16777216 ("123.0" and "1e3" -> "123" and "1000"; "1.5" -> "");
' - anything else (an array, an object, a boolean, invalid) gives "".
function tmdbIdOf(v as dynamic, rx as object) as string
    t = type(v)
    if t = "roString" or t = "String"
        found = rx.tmdbId.Match(trimField(v, rx))
        if found.Count() < 2 then return ""
        id = found[1]
        while Len(id) > 1 and Left(id, 1) = "0"
            id = Mid(id, 2)
        end while
        if id = "0" then return ""
        return id
    end if
    if t = "roInteger" or t = "Integer" or t = "roLongInteger" or t = "LongInteger"
        if v >= 1 and v <= 999999999999& then return v.ToStr()
        return ""
    end if
    if t = "roFloat" or t = "Float" or t = "roDouble" or t = "Double"
        if v >= 1 and v < 16777216
            if v = Int(v) then return Int(v).ToStr()
        end if
        return ""
    end if
    return ""
end function

' Unix seconds from added (movies) or last_modified (series); a value above 100000000000 is in milliseconds.
function unixSeconds(v as dynamic) as integer
    t = asText(v).Trim()
    dot = Instr(1, t, ".")
    if dot > 0 then t = Left(t, dot - 1)
    if Len(t) > 12 or (Len(t) = 12 and t > "100000000000") then t = Left(t, Len(t) - 3)
    return t.ToInt()
end function

function ratingOf(row as object) as float
    rating = numberOf(row.rating)
    if rating <= 0 then rating = numberOf(row.rating_5based) * 2
    if rating > 10 then rating = rating / 10
    return rating
end function

' One Xtream get_vod_streams (kind "movie") or get_series (kind "series") row as a catalogue title,
' or invalid when it has no id. id is the stream_id or series_id; cats are its category_id and
' category_ids. Fields that only matter while the index is built (hint, genre, cats, added) are
' dropped by buildTitleSection.
function titleFromXtream(kind as string, row as object, rx as object) as dynamic
    if not isAssoc(row) then return invalid
    if kind = "movie" then id = asText(row.stream_id) else id = asText(row.series_id)
    if id = "" then return invalid
    values = [row.category_id]
    values.Append(arrayOrEmpty(row.category_ids))
    cats = []
    for each value in values
        cat = asText(value)
        if cat <> "" then cats.Push(cat)
    end for
    name = asText(row.name)
    ' The first provider field that starts with a year, else the year in the name.
    year = ""
    for each value in [row.year, row.releaseDate, row.release_date, row.releasedate]
        if year = "" then year = yearOfText(value, rx)
    end for
    if year = "" then year = titleYearOf(name, rx)
    title = {kind: kind, key: Left(kind, 1) + id, id: id, name: name, cats: cats, adult: isFlagOn(row.is_adult), year: year, rating: ratingOf(row), hint: providerTmdbId(row, rx), genre: asText(row.genre)}
    if kind = "movie"
        title.icon = asText(row.stream_icon)
        ext = asText(row.container_extension)
        if ext = "" then ext = "mp4"
        title.ext = ext
        title.added = unixSeconds(row.added)
    else
        title.icon = asText(row.cover)
        title.added = unixSeconds(row.last_modified)
    end if
    return title
end function

' One M3U entry as a catalogue title; its category is catId, the id m3uSections gave its group-title. key is a
' stable id made from the stream URL (m3uKey).
function titleFromM3u(kind as string, key as string, name as string, icon as string, catId as string, url as string, rx as object) as object
    return {kind: kind, key: key, id: "", name: name, cats: [catId], adult: false, year: titleYearOf(name, rx), rating: 0, hint: "", genre: "", icon: icon, url: url, added: 0}
end function

' ------------------------------------------------------------------ M3U playlists

' The entries of an M3U playlist (docs/browse.md, "M3U playlists") in playlist order, each {name, group, icon, url}
' with group "" when it has none, or invalid when the playlist has no #EXTM3U header. m3uSections sorts them into live
' channels, movies and episodes for the catalog task (ApiTask).
' - Lines end at CR LF, CR or LF, whichever the file uses, and nowhere else (not at U+0085, U+2028 or U+2029):
'   Tokenize splits at every CR and every LF and drops the empty pieces, such as the one inside a CR LF. Each line is
'   trimmed as a provider field, which also takes a byte order mark off the start of the file, and the lines left
'   empty are skipped. The first line left must start with #EXTM3U.
' - A line that starts with #EXTINF (colon or not) replaces the pending #EXTINF line and clears the pending group line;
'   one that starts with #EXTGRP: becomes the pending group line; any other line that starts with # is skipped. Every
'   other line is a URL: it makes an entry of the pending lines and clears them.
' - The name is the title after the name comma (m3uExtinf), else the tvg-name value, else "Channel N", where N counts
'   every URL line from 1. The group is the group-title value, else the text after #EXTGRP:.
' Tags ignore the case of A to Z only (rx.m3uTag): LCase, UCase and the "i" flag may fold other letters, and "#EXT" +
' Chr(&h131) + "NF" (a dotless i) starts no #EXTINF line.
function m3uEntries(body as string, rx as object) as dynamic
    entries = []
    header = false
    info = invalid
    groupLine = ""
    for each raw in body.Tokenize(Chr(13) + Chr(10))
        line = trimField(raw, rx)
        if line <> ""
            ' "m" for #EXTM3U, "i" for #EXTINF, "g" for #EXTGRP:, "" for any other line.
            tag = ""
            if Left(line, 1) = "#"
                found = rx.m3uTag.Match(line)
                if found.Count() > 1 then tag = LCase(Left(found[1], 1))
            end if
            if not header
                if tag <> "m" then return invalid
                header = true
            else if tag = "i"
                info = m3uExtinf(line, rx)
                groupLine = ""
            else if tag = "g"
                groupLine = trimField(Mid(line, 9), rx)
            else if Left(line, 1) <> "#"
                entry = {name: "", group: "", icon: "", url: line}
                if info <> invalid
                    entry.name = info.title
                    if entry.name = "" then entry.name = info.tvgName
                    entry.group = info.group
                    entry.icon = info.icon
                end if
                if entry.group = "" then entry.group = groupLine
                number = entries.Count() + 1
                if entry.name = "" then entry.name = "Channel " + number.ToStr()
                entries.Push(entry)
                info = invalid
                groupLine = ""
            end if
        end if
    end for
    if not header then return invalid
    return entries
end function

' One #EXTINF line, read from its start (docs/browse.md, "M3U playlists"): {title, tvgName, group, icon}, the title and
' the tvg-name, group-title and tvg-logo values, each trimmed as a provider field ("" when there is none).
' - A key is a run of ASCII letters, digits, "_" and "-", taken whole. When spaces (U+0020 only), "=", spaces and a
'   quote (" or ') follow it, and the same quote comes again later on the line, the text between the two quotes is the
'   key's value (a comma or a quote of the other kind inside it is part of it), and reading goes on after the closing
'   quote. Keys ignore ASCII letter case, and a key given twice keeps its first value.
' - The first comma reached outside a value is the name comma: the text after it is the title, and nothing after it is
'   a value. Any other character is passed over, a quote that starts no value too.
' A value needs an "=", so the reading jumps from one "=" to the next with Instr, reads the key that ends at each "="
' with rx.m3uKey in the text since the last stop, and stops at the first comma before the next "=". Each search starts
' past the text the one before it read, so the line is read once, in time that grows in proportion to it: no loop over
' all its characters (slow in BrightScript), and no pattern run over the whole line (which would also find
' group-title="..." written after the name comma).
function m3uExtinf(line as string, rx as object) as object
    values = {}
    title = ""
    size = Len(line)
    i = 1
    ' The next comma and "=" at or after i, kept until i passes them; 0 when none is left.
    comma = -1
    equals = -1
    while i <= size
        if comma <> 0 and comma < i then comma = Instr(i, line, ",")
        if equals <> 0 and equals < i then equals = Instr(i, line, "=")
        if comma > 0 and (equals = 0 or comma < equals)
            title = trimField(Mid(line, comma + 1), rx)
            exit while
        end if
        if equals = 0 then exit while
        ' The key: the run of key characters before the spaces before "=", in the text read since i (the start of the
        ' line, or just after an "=" or a closing quote, so no run goes on before i).
        key = ""
        if equals > i
            found = rx.m3uKey.Match(Mid(line, i, equals - i))
            if found.Count() > 1 then key = found[1]
        end if
        i = equals + 1
        if key <> ""
            opening = equals + 1
            while opening <= size and Mid(line, opening, 1) = " "
                opening = opening + 1
            end while
            quote = Mid(line, opening, 1)
            if quote = Chr(34) or quote = "'"
                closing = Instr(opening + 1, line, quote)
                if closing > 0
                    key = LCase(key)
                    if not values.DoesExist(key) then values[key] = Mid(line, opening + 1, closing - opening - 1)
                    i = closing + 1
                end if
            end if
        end if
    end while
    return {title: title, tvgName: m3uValue(values, "tvg-name", rx), group: m3uValue(values, "group-title", rx), icon: m3uValue(values, "tvg-logo", rx)}
end function

' A value m3uExtinf read (keys in lower case, ASCII only), trimmed as a provider field; "" when there is none.
function m3uValue(values as object, key as string, rx as object) as string
    value = values[key]
    if value = invalid then return ""
    return trimField(value, rx)
end function

' A short stable key for an M3U entry, from its URL ("m~" movies, "s~" series).
function m3uKey(prefix as string, url as string) as string
    bytes = CreateObject("roByteArray")
    bytes.FromAsciiString(url)
    digest = CreateObject("roEVPDigest")
    digest.Setup("md5")
    return prefix + "~" + Left(LCase(digest.Process(bytes)), 12)
end function

' The entries of a playlist (m3uEntries) as the catalog task lists them: {lists, cats}, each {live, movies, series},
' with the live channels, movies and episodes in playlist order and each section's categories in order of first use.
' An entry is a movie when its URL, in lower case, has /movie/ or ends in .mp4 or .mkv, else an episode (one that
' plays on its own) when it has /series/, else a live channel. Its category is its group, "Other" when it has none.
' Group names are told apart by letter case, "it | movies" (not foreign) from "IT | Movies" (foreign), so the map
' from a name to its category is made with exactKeys. Each category gets an id made here ("live:g0", "movies:g1"...),
' never the name, so the arrays the catalogue goes through next (catInfo in buildTitleSection, byCat in grouped, and
' their copies on the screen) keep the groups apart however they treat letter case.
function m3uSections(entries as object, rx as object) as object
    lists = {live: [], movies: [], series: []}
    cats = {live: [], movies: [], series: []}
    ids = {live: exactKeys(), movies: exactKeys(), series: exactKeys()}
    for each entry in entries
        url = entry.url
        lower = LCase(url)
        section = "live"
        if lower.InStr("/movie/") >= 0 or Right(lower, 4) = ".mp4" or Right(lower, 4) = ".mkv"
            section = "movies"
        else if lower.InStr("/series/") >= 0
            section = "series"
        end if
        group = entry.group
        if group = "" then group = "Other"
        id = ids[section][group]
        if id = invalid
            id = section + ":g" + cats[section].Count().ToStr()
            ids[section][group] = id
            cats[section].Push({id: id, name: group, adult: false})
        end if
        if section = "live"
            lists.live.Push({kind: "live", name: entry.name, icon: entry.icon, cat: id, adult: false, url: url})
        else if section = "movies"
            lists.movies.Push(titleFromM3u("movie", m3uKey("m", url), entry.name, entry.icon, id, url, rx))
        else
            lists.series.Push(titleFromM3u("episode", m3uKey("s", url), entry.name, entry.icon, id, url, rx))
        end if
    end for
    return {lists: lists, cats: cats}
end function

' ------------------------------------------------------------------ live channels

' Live channels by category, so the screen never filters a 17,000-item list on the render thread: {categories, byCat}.
' items are {cat, ...}, cat "" for a channel without a category. categories are those with at least one channel, in
' the provider's order, then "Other" when some channel has no category; a channel whose category is not in the list is
' left out. Category ids are provider text (Xtream's category_id), told apart by letter case with exactKeys. The lists
' are kept under keys made here ("c0", "c1"... and "other"), each one the id of its category in categories, because
' the screen reads byCat from a copy that may ignore letter case, and so that no category id ("__other", say) can
' stand for the channels without one.
function grouped(categories as object, items as object) as object
    keys = exactKeys()
    for each cat in categories
        if keys[cat.id] = invalid then keys[cat.id] = "c" + keys.Count().ToStr()
    end for
    byCat = {}
    for each item in items
        key = "other"
        if item.cat <> "" then key = keys[item.cat]
        if key <> invalid
            list = byCat[key]
            if list = invalid
                list = []
                byCat[key] = list
            end if
            list.Push(item)
        end if
    end for
    used = []
    for each cat in categories
        key = keys[cat.id]
        if byCat[key] <> invalid
            shown = {}
            shown.Append(cat)
            shown.id = key
            used.Push(shown)
        end if
    end for
    if byCat["other"] <> invalid then used.Push({id: "other", name: "Other", adult: false})
    return {categories: used, byCat: byCat}
end function

' ------------------------------------------------------------------ USA only and adult rules

' A category fails the USA filter when its name carries a non-US country or language (category rules 1 to 4, on
' the name with its Unicode spaces replaced). Rules 3 and 4 run on a copy with A to Z in lower case.
function isForeignCategory(name as string, rx as object) as boolean
    s = unicodeSpaces(name, rx)
    if s = "" then return false
    if rx.foreignCode.IsMatch(s) or rx.foreignInIt.IsMatch(s) then return true
    lower = asciiLower(s, rx)
    return rx.foreignTag.IsMatch(lower) or rx.foreignWord.IsMatch(lower)
end function

' USA only (docs/browse.md): the title's categories pass and, when it is matched to TMDB (entry from tmdbEntry)
' and TMDB gave its countries, they include US. A match with no country (origin [], or only entries such as "USA"
' that are not one) goes by its categories.
function usaAllowed(categoriesPass as boolean, entry as dynamic) as boolean
    if not categoriesPass then return false
    if entry = invalid or not entry.known then return true
    return entry.us
end function

' XXX, Adult, Adults, 18+ or Porn, but not Adult Swim.
function isAdultName(name as string, rx as object) as boolean
    if rx.adultSwim.IsMatch(name) then return false
    return rx.adult.IsMatch(name)
end function

' Streaming services a provider category belongs to by name ("NETFLIX 4K" -> ["netflix"]).
function categoryServices(name as string, rx as object) as object
    upper = UCase(name)
    found = []
    for each service in browseServices()
        if rx.services[service.key].IsMatch(upper) then found.Push(service.key)
    end for
    return found
end function

' ------------------------------------------------------------------ catalog rows endpoint

function emptyRowsSection() as object
    services = {}
    for each service in browseServices()
        services[service.key] = []
    end for
    return {popular: [], featured: [], top_rated: [], services: services}
end function

' Reads the body of GET /api/catalog/rows?v=1. Any missing or malformed list becomes an empty list;
' anything that is not version 1 counts as "no data" (source "none", valid false).
function parseRowsPayload(text as dynamic) as object
    out = {valid: false, source: "none", generated: "", movie: emptyRowsSection(), tv: emptyRowsSection(), genres: {movie: [], tv: []}}
    data = invalid
    if text <> invalid and asText(text) <> "" then data = ParseJson(text)
    if not isAssoc(data) or asText(data.v) <> "1" then return out
    out.valid = true
    if asText(data.source) <> "" then out.source = asText(data.source)
    out.generated = asText(data.generated)
    for each kind in ["movie", "tv"]
        section = data[kind]
        if isAssoc(section)
            target = out[kind]
            target.popular = arrayOrEmpty(section.popular)
            target.featured = arrayOrEmpty(section.featured)
            target.top_rated = arrayOrEmpty(section.top_rated)
            if isAssoc(section.services)
                for each service in browseServices()
                    target.services[service.key] = arrayOrEmpty(section.services[service.key])
                end for
            end if
        end if
    end for
    if isAssoc(data.genres)
        out.genres.movie = arrayOrEmpty(data.genres.movie)
        out.genres.tv = arrayOrEmpty(data.genres.tv)
    end if
    return out
end function

' The apps keep the rows for 12 hours (maxAge seconds) and use an older copy when a refresh fails.
function isFreshCache(fetchedAt as integer, now as integer, maxAge as integer) as boolean
    if fetchedAt <= 0 then return false
    age = now - fetchedAt
    return age >= 0 and age < maxAge
end function

' ------------------------------------------------------------------ matching

function tmdbEntry(raw as dynamic, rx as object) as dynamic
    if not isAssoc(raw) then return invalid
    id = asText(raw.id)
    if id = "" then return invalid
    ' docs/browse.md, "Origin countries": an entry is a country when, with its Unicode spaces replaced, it is two
    ' ASCII letters with only spaces around them (" US", "us"); every other entry ("USA", "U.S.", "", a number) is
    ' ignored. known is false when no entry is a country; USA only then goes by the category alone.
    known = false
    us = false
    for each country in arrayOrEmpty(raw.origin)
        t = type(country)
        if t = "roString" or t = "String"
            found = rx.country.Match(unicodeSpaces(country, rx))
            if found.Count() > 1
                known = true
                ' The two letters are ASCII, so lower-casing A to Z alone compares them in any ASCII letter case.
                if asciiLower(found[1], rx) = "us" then us = true
            end if
        end if
    end for
    g = ""
    for each genre in arrayOrEmpty(raw.genres)
        t = asText(genre)
        if t <> "" then g = g + "|" + t
    end for
    if g <> "" then g = g + "|"
    return {id: id, year: Int(Val(Left(asText(raw.year), 4))), us: us, known: known, g: g}
end function

' Every TMDB title in one section of the rows payload, by id and by normalized title (and original title).
function tmdbIndex(section as object, rx as object) as object
    byId = {}
    byTitle = {}
    lists = [section.popular, section.featured, section.top_rated]
    for each service in browseServices()
        lists.Push(section.services[service.key])
    end for
    for each list in lists
        for each raw in arrayOrEmpty(list)
            entry = tmdbEntry(raw, rx)
            if entry <> invalid and not byId.DoesExist(entry.id)
                byId[entry.id] = entry
                title = normalizeTitle(asText(raw.title), rx)
                original = normalizeTitle(asText(raw.original_title), rx)
                for each key in [title, original]
                    if key <> ""
                        if not byTitle.DoesExist(key) then byTitle[key] = []
                        bucket = byTitle[key]
                        if bucket.Count() = 0 or bucket[bucket.Count() - 1].id <> entry.id then bucket.Push(entry)
                    end if
                end for
            end if
        end for
    end for
    return {byId: byId, byTitle: byTitle, count: byId.Count()}
end function

' The TMDB title a catalogue title matches, or invalid. norm is normalizeTitle(title.name). A title whose
' normalized name finds no match is looked up again under its name normalized without removing tags.
function matchTitle(index as object, title as object, norm as string, rx as object) as dynamic
    entry = matchTmdb(index, title.hint, norm, title.year)
    if entry <> invalid or title.hint <> "" or not hasTagSeparator(title.name) then return entry
    whole = normalizeKey(title.name, false, rx)
    if whole = norm then return invalid
    return matchTmdb(index, "", whole, title.year)
end function

' 1. A provider TMDB id matches on the id alone. 2. Otherwise the normalized title must match and the
' years may differ by 1. A title without a year matches only when exactly one TMDB title has that name.
function matchTmdb(index as object, hint as string, norm as string, year as string) as dynamic
    if hint <> ""
        if index.byId.DoesExist(hint) then return index.byId[hint]
        return invalid
    end if
    if norm = "" or not index.byTitle.DoesExist(norm) then return invalid
    candidates = index.byTitle[norm]
    wanted = Int(Val(year))
    if wanted <= 0
        if candidates.Count() = 1 then return candidates[0]
        return invalid
    end if
    best = invalid
    for each candidate in candidates
        if candidate.year = wanted then return candidate
        if best = invalid and candidate.year > 0 and Abs(candidate.year - wanted) <= 1 then best = candidate
    end for
    return best
end function

' ------------------------------------------------------------------ genres

function genreToken(text as string) as string
    t = LCase(text).Trim()
    aliases = {"sci-fi": "science fiction", "scifi": "science fiction", "sci fi": "science fiction", "science-fiction": "science fiction", "documentaries": "documentary", "docs": "documentary", "docu": "documentary", "comedies": "comedy", "dramas": "drama", "thrillers": "thriller", "westerns": "western", "animated": "animation", "anime": "animation", "cartoon": "animation", "cartoons": "animation", "children": "kids", "childrens": "kids", "kid": "kids", "romantic": "romance", "musical": "music", "musicals": "music", "suspense": "thriller", "horrors": "horror", "historical": "history", "crimes": "crime"}
    if aliases.DoesExist(t) then return aliases[t]
    return t
end function

' TMDB genres for one type ({id, name} rows) as the Discover genre list plus a lookup from a provider
' genre word to a TMDB genre id. With no TMDB genres the table is "open": provider genre words become
' the genres themselves.
function genreTable(raw as object) as object
    list = []
    lookup = {}
    for each genre in arrayOrEmpty(raw)
        if isAssoc(genre)
            id = asText(genre.id)
            name = asText(genre.name)
            if id <> "" and name <> ""
                list.Push({key: id, name: name})
                lookup[genreToken(name)] = id
                for each part in name.Split("&")
                    token = genreToken(part)
                    if token <> "" and not lookup.DoesExist(token) then lookup[token] = id
                end for
            end if
        end if
    end for
    return {list: list, lookup: lookup, open: list.Count() = 0}
end function

' Provider genre text ("Action, Drama") as genre keys "|28|18|" ("" when none is known).
function providerGenreKeys(text as string, table as object, rx as object) as string
    if text = "" then return ""
    g = ""
    for each part in rx.genreSplit.Split(text)
        token = genreToken(rx.spaces.ReplaceAll(part, " "))
        if token <> ""
            key = ""
            if table.lookup.DoesExist(token)
                key = table.lookup[token]
            else if table.open
                key = token
                table.lookup[token] = key
                display = part.Trim()
                table.list.Push({key: key, name: UCase(Left(display, 1)) + Mid(display, 2)})
            end if
            if key <> "" and Instr(1, g + "|", "|" + key + "|") = 0 then g = g + "|" + key
        end if
    end for
    if g <> "" then g = g + "|"
    return g
end function

' A provider category named after a genre ("EN | Action Movies", "Kids & Family", "Sci-Fi") as genre keys
' "|28|" ("" when none). Each part of the name must be a genre on its own once words such as Movies, EN or 4K
' are dropped, so "Comedy Central" or "Netflix" never count. With no TMDB genres only common genres count.
function categoryGenreKeys(name as string, table as object, rx as object) as string
    if name = "" then return ""
    noise = {"movies": true, "movie": true, "films": true, "film": true, "series": true, "shows": true, "show": true, "tv": true, "vod": true, "4k": true, "uhd": true, "hd": true, "fhd": true, "en": true, "us": true, "usa": true, "english": true, "new": true, "top": true, "best": true, "all": true, "and": true}
    common = {action: "Action", adventure: "Adventure", animation: "Animation", comedy: "Comedy", crime: "Crime", documentary: "Documentary", drama: "Drama", family: "Family", fantasy: "Fantasy", history: "History", horror: "Horror", music: "Music", mystery: "Mystery", romance: "Romance", "science fiction": "Science Fiction", thriller: "Thriller", war: "War", western: "Western", kids: "Kids", reality: "Reality", sports: "Sports"}
    g = ""
    for each part in rx.categorySplit.Split(name)
        words = []
        for each word in rx.nonWord.Split(LCase(part))
            if word <> "" and not noise.DoesExist(word) then words.Push(word)
        end for
        token = genreToken(words.Join(" "))
        key = ""
        if token = ""
            key = ""
        else if table.lookup.DoesExist(token)
            key = table.lookup[token]
        else if table.open and common.DoesExist(token)
            key = token
            table.lookup[token] = key
            table.list.Push({key: key, name: common[token]})
        end if
        if key <> "" and Instr(1, g + "|", "|" + key + "|") = 0 then g = g + "|" + key
    end for
    if g <> "" then g = g + "|"
    return g
end function

' ------------------------------------------------------------------ building the browse index

' Turns one type's titles into what the screen browses: the titles with their USA, adult, TMDB and
' genre facts worked out, every list Home and Discover need as arrays of title indices, and the
' copies of each TMDB title with more than one, best first. byKey gives the first title with each key; the screen
' reads it with titleIndexOf.
'   titles: from titleFromXtream / titleFromM3u. categories: [{id, name, adult}].
'   section: parseRowsPayload(...).movie or .tv. rawGenres: parseRowsPayload(...).genres.movie or .tv.
function buildTitleSection(titles as object, categories as object, section as object, rawGenres as object, rx as object) as object
    index = tmdbIndex(section, rx)
    genres = genreTable(rawGenres)
    ' Category ids and title keys are provider text: "a" and "A" are two categories, "m1a" and "m1A" two titles.
    catInfo = exactKeys()
    for each cat in categories
        catInfo[cat.id] = {foreign: isForeignCategory(cat.name, rx), adult: isFlagOn(cat.adult) or isAdultName(cat.name, rx), services: categoryServices(cat.name, rx), g: categoryGenreKeys(cat.name, genres, rx)}
    end for
    ' USA only judges a title by the categories of every row with its id; ids missing from the category
    ' list are left out. Per id: 0 no category left, 1 only foreign ones, 2 at least one that passes.
    usaCats = exactKeys()
    for each title in titles
        state = usaCats[title.key]
        if state = invalid then state = 0
        for each id in title.cats
            info = catInfo[id]
            if info <> invalid
                if not info.foreign
                    state = 2
                else if state = 0
                    state = 1
                end if
            end if
        end for
        usaCats[title.key] = state
    end for
    usedGenres = {}
    items = []
    byKey = exactKeys()
    byTmdb = {}
    byService = {}
    for each service in browseServices()
        byService[service.key] = []
    end for
    ' The screen gets each title without the fields only needed here, so less is copied between threads.
    unused = ["hint", "genre", "cats", "added"]
    stamps = []
    recent = []
    rated = []
    az = []
    matched = 0
    for each title in titles
        info = rowCategoryFacts(title.cats, catInfo)
        norm = normalizeTitle(title.name, rx)
        entry = invalid
        if index.count > 0 then entry = matchTitle(index, title, norm, rx)
        title.tmdb = ""
        title.g = ""
        if entry <> invalid
            title.tmdb = entry.id
            title.g = entry.g
            matched = matched + 1
        end if
        ' Genres: TMDB's, else the provider's genre text, else a category named after a genre.
        if title.g = "" and title.genre <> "" then title.g = providerGenreKeys(title.genre, genres, rx)
        if title.g = "" then title.g = info.g
        if title.g <> "" then usedGenres[title.g] = true
        title.us = usaAllowed(usaCats[title.key] <> 1, entry)
        title.adult = title.adult or info.adult
        i = items.Count()
        items.Push(title)
        stamps.Push(title.added)
        if not byKey.DoesExist(title.key) then byKey[title.key] = i
        if title.tmdb <> ""
            if not byTmdb.DoesExist(title.tmdb) then byTmdb[title.tmdb] = []
            byTmdb[title.tmdb].Push(i)
        end if
        for each key in info.services
            byService[key].Push({i: i, k: title.added})
        end for
        if title.added > 0 then recent.Push({i: i, k: title.added})
        if title.rating > 0 then rated.Push({i: i, k: title.rating})
        sortName = norm
        if sortName = "" then sortName = LCase(title.name)
        ' Catalogue order breaks ties, so copies of one title always sort the same way.
        az.Push({i: i, k: sortName + Chr(1) + Right("0000000" + i.ToStr(), 8)})
        for each field in unused
            title.Delete(field)
        end for
    end for
    ' Copies of one TMDB title are one poster in every list (pickTitles), best copy first.
    copies = {}
    for each id in byTmdb
        if byTmdb[id].Count() > 1
            byTmdb[id] = rankCopies(byTmdb[id], items, stamps)
            copies[id] = byTmdb[id]
        end if
    end for
    lists = {
        popular: tmdbOrder(section.popular, byTmdb),
        featured: tmdbOrder(section.featured, byTmdb),
        recent: sortedIndices(recent, "r"),
        rated: mergeIndices(tmdbOrder(section.top_rated, byTmdb), sortedIndices(rated, "r")),
        az: sortedIndices(az, "")
    }
    for each service in browseServices()
        lists[service.key] = mergeIndices(tmdbOrder(section.services[service.key], byTmdb), sortedIndices(byService[service.key], "r"))
    end for
    genreList = genres.list
    if genres.open
        ' Provider and category genres: only those some title has, by name.
        used = {}
        for each g in usedGenres
            for each key in g.Split("|")
                if key <> "" then used[key] = true
            end for
        end for
        genreList = []
        for each genre in genres.list
            if used.DoesExist(genre.key) then genreList.Push(genre)
        end for
        genreList.SortBy("name", "i")
    end if
    return {items: items, lists: lists, byKey: byKey, copies: copies, genres: genreList, matched: matched}
end function

' The adult flag, services and genre keys of one row's known categories together.
function rowCategoryFacts(cats as object, catInfo as object) as object
    if cats.Count() = 1
        info = catInfo[cats[0]]
        if info <> invalid then return info
    end if
    facts = {adult: false, services: [], g: ""}
    for each id in cats
        info = catInfo[id]
        if info <> invalid
            if info.adult then facts.adult = true
            for each key in info.services
                if not arrayHas(facts.services, key) then facts.services.Push(key)
            end for
            for each key in info.g.Split("|")
                if key <> "" and Instr(1, facts.g + "|", "|" + key + "|") = 0 then facts.g = facts.g + "|" + key
            end for
        end if
    end for
    if facts.g <> "" then facts.g = facts.g + "|"
    return facts
end function

function arrayHas(list as object, value as string) as boolean
    for each v in list
        if v = value then return true
    end for
    return false
end function

' Copies of one TMDB title, best first: those that pass USA only, then the newest added, then catalogue order.
function rankCopies(group as object, items as object, stamps as object) as object
    rest = []
    rest.Append(group)
    ranked = []
    while rest.Count() > 0
        best = 0
        for k = 1 to rest.Count() - 1
            a = rest[k]
            b = rest[best]
            if items[a].us <> items[b].us
                if items[a].us then best = k
            else if stamps[a] <> stamps[b]
                if stamps[a] > stamps[b] then best = k
            else if a < b
                best = k
            end if
        end for
        ranked.Push(rest[best])
        rest.Delete(best)
    end while
    return ranked
end function

function tmdbOrder(list as object, byTmdb as object) as object
    out = []
    for each raw in arrayOrEmpty(list)
        if isAssoc(raw)
            group = byTmdb[asText(raw.id)]
            if group <> invalid then out.Append(group)
        end if
    end for
    return out
end function

function sortedIndices(pairs as object, flags as string) as object
    pairs.SortBy("k", flags)
    out = []
    for each pair in pairs
        out.Push(pair.i)
    end for
    return out
end function

function mergeIndices(first as object, second as object) as object
    seen = {}
    out = []
    for each list in [first, second]
        for each i in list
            key = i.ToStr()
            if not seen.DoesExist(key)
                seen[key] = true
                out.Push(i)
            end if
        end for
    end for
    return out
end function

' ------------------------------------------------------------------ picking titles for the screen

' opts: {usOnly, adultOk, genre ("" for all), seen (exactKeys(), shared by one row or one Discover grid: title keys
' that differ only in letter case are different titles)}.
function titleVisible(item as object, opts as object) as boolean
    if not opts.adultOk and item.adult then return false
    if opts.usOnly and not item.us then return false
    if opts.genre <> ""
        if item.g = invalid or Instr(1, item.g, "|" + opts.genre + "|") = 0 then return false
    end if
    return true
end function

' Walks indices from cursor and returns up to limit visible titles, one per TMDB title: copies of a
' TMDB title are one poster, where its first visible copy stands, and it opens its best visible copy
' (section.copies). section is from buildTitleSection. Returns {picked: [index], cursor: where to continue}.
function pickTitles(section as object, indices as dynamic, opts as object, cursor as integer, limit as integer) as object
    items = section.items
    picked = []
    list = arrayOrEmpty(indices)
    i = cursor
    n = list.Count()
    while i < n and picked.Count() < limit
        index = list[i]
        i = i + 1
        item = items[index]
        if titleVisible(item, opts)
            seenKey = item.key
            if item.tmdb <> "" then seenKey = "tmdb:" + item.tmdb
            if not opts.seen.DoesExist(seenKey)
                opts.seen[seenKey] = true
                group = invalid
                if item.tmdb <> "" then group = section.copies[item.tmdb]
                if group <> invalid
                    for each candidate in group
                        if titleVisible(items[candidate], opts)
                            index = candidate
                            exit for
                        end if
                    end for
                end if
                picked.Push(index)
            end if
        end if
    end while
    return {picked: picked, cursor: i}
end function

' Search: up to limit visible titles whose names contain query (lower case), names starting with it first.
function searchTitles(section as object, query as string, opts as object, limit as integer) as object
    items = section.items
    starts = []
    contains = []
    if Len(query) < 2 then return []
    for i = 0 to items.Count() - 1
        item = items[i]
        position = LCase(item.name).InStr(query)
        if position >= 0 and titleVisible(item, opts)
            if position = 0
                starts.Push(i)
                if starts.Count() >= limit then exit for
            else if contains.Count() < limit
                contains.Push(i)
            end if
        end if
    end for
    starts.Append(contains)
    return pickTitles(section, starts, opts, 0, limit).picked
end function

' Home rows after Continue watching, in the order docs/browse.md gives. Popular and Featured need TMDB.
function homeRowSpecs(withTmdb as boolean) as object
    specs = []
    if withTmdb
        specs.Push({type: "movies", list: "popular", title: "Popular – Movies"})
        specs.Push({type: "series", list: "popular", title: "Popular – Series"})
        specs.Push({type: "movies", list: "featured", title: "Featured – Movies"})
        specs.Push({type: "series", list: "featured", title: "Featured – Series"})
    end if
    for each service in browseServices()
        specs.Push({type: "movies", list: service.key, title: service.name + " – Movies"})
        specs.Push({type: "series", list: service.key, title: service.name + " – Series"})
    end for
    specs.Push({type: "movies", list: "recent", title: "Recently added – Movies"})
    specs.Push({type: "series", list: "recent", title: "Recently added – Series"})
    specs.Push({type: "movies", list: "rated", title: "Top rated – Movies"})
    specs.Push({type: "series", list: "rated", title: "Top rated – Series"})
    return specs
end function

' Discover's List choices. Popular and Featured need TMDB.
function discoverLists(withTmdb as boolean) as object
    lists = []
    if withTmdb
        lists.Push({key: "popular", name: "Popular"})
        lists.Push({key: "featured", name: "Featured"})
    end if
    lists.Push({key: "rated", name: "Top rated"})
    lists.Push({key: "recent", name: "Recently added"})
    lists.Push({key: "az", name: "A–Z"})
    for each service in browseServices()
        lists.Push({key: service.key, name: service.name})
    end for
    return lists
end function

' Home: Continue watching (refs from continueRefs) and then every row with at least 5 titles, 20 at most.
' catalog: {movies, series} from buildTitleSection. Each row is {id, title, type, list, refs: [{type, idx}]}.
function buildHomeRows(catalog as object, withTmdb as boolean, opts as object, continueRefs as object) as object
    rows = []
    if continueRefs.Count() >= 5
        refs = []
        for each ref in continueRefs
            if refs.Count() < 20 then refs.Push(ref)
        end for
        rows.Push({id: "continue", title: "Continue watching", type: "library", list: "continue", refs: refs})
    end if
    for each spec in homeRowSpecs(withTmdb)
        section = catalog[spec.type]
        rowOpts = {usOnly: opts.usOnly, adultOk: opts.adultOk, genre: "", seen: exactKeys()}
        result = pickTitles(section, section.lists[spec.list], rowOpts, 0, 20)
        if result.picked.Count() >= 5
            refs = []
            for each i in result.picked
                refs.Push({type: spec.type, idx: i})
            end for
            rows.Push({id: spec.type + ":" + spec.list, title: spec.title, type: spec.type, list: spec.list, refs: refs})
        end if
    end for
    return rows
end function

' ------------------------------------------------------------------ Library (favorites, progress, history)

' Stored as JSON in the registry, for one paired line. Keys: "m<stream_id>" movies, "s<series_id>" series.
'   fav:  [key], newest first.
'   prog: [{k, p (seconds), d (duration), t (time), e (episode id), l (episode label), n (episode index), nx}]
'         newest first; nx marks "the next episode is ready" after one finishes.
'   seen: [{k, t}], newest first.
function libraryNew(line as string) as object
    return {v: 1, line: line, fav: [], prog: [], seen: []}
end function

' A stored library for this line, or a new one when it is missing, damaged or for another line.
function libraryFor(stored as dynamic, line as string) as object
    if not isAssoc(stored) or asText(stored.line) <> line then return libraryNew(line)
    return {v: 1, line: line, fav: arrayOrEmpty(stored.fav), prog: arrayOrEmpty(stored.prog), seen: arrayOrEmpty(stored.seen)}
end function

function libraryTypeOf(key as string) as string
    if Left(key, 1) = "s" then return "series"
    return "movies"
end function

function libraryIsFavorite(store as object, key as string) as boolean
    for each k in store.fav
        if k = key then return true
    end for
    return false
end function

' Adds or removes a favorite and returns whether it is now a favorite. Keeps at most 150.
function libraryToggleFavorite(store as object, key as string) as boolean
    kept = []
    found = false
    for each k in store.fav
        if k = key then found = true else kept.Push(k)
    end for
    if not found
        kept.Unshift(key)
        while kept.Count() > 150
            kept.Pop()
        end while
    end if
    store.fav = kept
    return not found
end function

function libraryProgress(store as object, key as string) as dynamic
    for each entry in store.prog
        if entry.k = key then return entry
    end for
    return invalid
end function

sub libraryRemoveProgress(store as object, key as string)
    kept = []
    for each entry in store.prog
        if entry.k <> key then kept.Push(entry)
    end for
    store.prog = kept
end sub

' Records where playback stopped. A finished title (95% or more) leaves Continue watching; a stop in
' the first 15 seconds changes nothing; a "next episode" entry (nx) is always kept. At most 30 entries.
sub libraryRecordProgress(store as object, entry as object, now as integer)
    position = Int(numberOf(entry.p))
    duration = Int(numberOf(entry.d))
    nextUp = isTrueValue(entry.nx)
    finished = not nextUp and duration > 0 and position >= duration * 0.95
    if finished
        libraryRemoveProgress(store, entry.k)
        return
    end if
    if not nextUp and position < 15 then return
    libraryRemoveProgress(store, entry.k)
    entry.t = now
    store.prog.Unshift(entry)
    while store.prog.Count() > 30
        store.prog.Pop()
    end while
end sub

sub libraryRecordWatched(store as object, key as string, now as integer)
    kept = [{k: key, t: now}]
    for each entry in store.seen
        if entry.k <> key and kept.Count() < 30 then kept.Push(entry)
    end for
    store.seen = kept
end sub

' How far through a title is, 0 to 1, for the progress bar.
function progressFraction(entry as dynamic) as float
    if entry = invalid or isTrueValue(entry.nx) then return 0
    duration = numberOf(entry.d)
    if duration <= 0 then return 0
    fraction = numberOf(entry.p) / duration
    if fraction > 1 then fraction = 1
    if fraction < 0 then fraction = 0
    return fraction
end function

' Library keys as refs [{type, idx}] to visible titles in the catalogue (titles no longer on the line drop out).
function libraryRefs(keys as object, catalog as object, opts as object) as object
    refs = []
    for each key in keys
        kind = libraryTypeOf(key)
        section = catalog[kind]
        if section <> invalid
            i = titleIndexOf(section, key)
            if i >= 0 and titleVisible(section.items[i], opts) then refs.Push({type: kind, idx: i})
        end if
    end for
    return refs
end function

' The index of the first title whose key is key, letter case included, in a section from buildTitleSection, or -1.
' byKey finds it, and the title it gives is checked: the screen's copy of byKey may ignore letter case (see exactKeys)
' and give a title whose key differs in letter case only, and then the title is looked for in the list itself.
function titleIndexOf(section as object, key as string) as integer
    i = section.byKey[key]
    if i = invalid then return -1
    items = section.items
    if items[i].key = key then return i
    for j = 0 to items.Count() - 1
        if items[j].key = key then return j
    end for
    return -1
end function

function libraryKeys(entries as object) as object
    keys = []
    for each entry in entries
        keys.Push(entry.k)
    end for
    return keys
end function

' "1:02:03" or "12:34".
function clockText(seconds as integer) as string
    if seconds < 0 then seconds = 0
    h = seconds \ 3600
    mm = (seconds mod 3600) \ 60
    ss = seconds mod 60
    sText = ss.ToStr()
    if ss < 10 then sText = "0" + sText
    if h > 0
        mText = mm.ToStr()
        if mm < 10 then mText = "0" + mText
        return h.ToStr() + ":" + mText + ":" + sText
    end if
    return mm.ToStr() + ":" + sText
end function

// Compiles the Android app's regexes with ICU, the engine Android uses for java.util.regex on devices (the JVM that
// runs the unit tests accepts patterns ICU rejects: 1.7.0 crashed at launch on a bare `}`). On Linux,
// NSRegularExpression is ICU's uregex too. Input: build/regex-patterns/patterns.json, written by RegexPatternsTest.
// Usage: swiftc -O icu-check.swift -o icu-check && ./icu-check patterns.json [minimum count]
import Foundation

let args = CommandLine.arguments
guard args.count >= 2, let data = FileManager.default.contents(atPath: args[1]),
      let items = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]] else {
    print("usage: icu-check patterns.json [minimum count]"); exit(2)
}
let minimum = args.count >= 3 ? Int(args[2]) ?? 1 : 1
var rejected = 0
for item in items {
    guard let pattern = item["p"] as? String else { print("not a pattern: \(item)"); rejected += 1; continue }
    let options: NSRegularExpression.Options = (item["i"] as? Bool ?? false) ? [.caseInsensitive] : []
    do { _ = try NSRegularExpression(pattern: pattern, options: options) } catch {
        rejected += 1
        print("ICU rejects \(item["src"] ?? "?"): \(pattern)")
    }
}
print("\(items.count) patterns, ICU rejects \(rejected)")
if items.count < minimum { print("expected at least \(minimum) patterns"); exit(1) }
exit(rejected == 0 ? 0 : 1)

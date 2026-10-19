import Foundation
import TunerCore

/// The top tab bar, left to right.
enum AppTab: Hashable {
    case home, live, discover, library, search, settings
}

/// A detail page pushed onto a tab's NavigationStack: a movie id ("m:…", "mu:…") or a series id ("s:…", "ms:…").
enum TitleRoute: Hashable {
    case movie(String)
    case series(String)

    init(_ title: TitleRef) {
        switch title {
        case .movie(let movie): self = .movie(movie.id)
        case .series(let series): self = .series(series.id)
        }
    }
}

/// A programme picked in the guide (the details sheet for a programme that hasn't started).
struct GuideSelection: Identifiable {
    let id = UUID()
    let channel: Channel
    let program: Program
}

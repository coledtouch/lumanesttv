import SwiftUI
import TunerCore

/// The detail page for a route (pushed onto Home, Discover, Library or Search).
struct TitleDetailView: View {
    let route: TitleRoute

    var body: some View {
        switch route {
        case .movie(let id): MovieDetailView(movieID: id)
        case .series(let id): SeriesDetailView(seriesID: id)
        }
    }
}

/// The blurred backdrop behind a detail page.
struct DetailBackdrop: View {
    let url: URL?

    var body: some View {
        ZStack {
            Theme.ink
            RemoteImage(url: url) {
                Color.clear
            }
            .opacity(0.45)
            LinearGradient(colors: [Color.black.opacity(0.2), Color.black.opacity(0.85)], startPoint: .top, endPoint: .bottom)
            LinearGradient(colors: [Color.black.opacity(0.8), Color.clear], startPoint: .leading, endPoint: .trailing)
        }
        .ignoresSafeArea()
    }
}

/// The big 2:3 poster on a detail page.
struct DetailPoster: View {
    let url: URL?
    let name: String

    var body: some View {
        RemoteImage(url: url) {
            TextPlaceholder(text: name)
        }
        .frame(width: 320, height: 480)
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
        .shadow(radius: 20)
    }
}

/// "12 min left · Resume at 1:02:03" with a bar, used on Resume buttons.
struct ResumeLabel: View {
    let title: String
    let recent: RecentItem

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title).font(.headline)
            if recent.durationMs > 0 {
                let left = TimeText.left(seconds: Int(max(0, recent.durationMs - recent.positionMs) / 1000))
                Text("\(left) · Resume at \(TimeText.clock(seconds: Int(recent.positionMs / 1000)))")
                    .font(.caption)
            } else {
                Text("Resume at \(TimeText.clock(seconds: Int(recent.positionMs / 1000)))")
                    .font(.caption)
            }
            if let progress = recent.progress {
                ProgressBar(value: progress).frame(width: 360)
            }
        }
        .padding(.vertical, 6)
    }
}

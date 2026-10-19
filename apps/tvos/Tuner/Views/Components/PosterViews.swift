import SwiftUI
import TunerCore

/// A 2:3 poster with the Library check badge and the resume progress bar.
struct PosterArtwork: View {
    let item: PosterItem

    var body: some View {
        RemoteImage(url: item.title.poster) {
            TextPlaceholder(text: item.title.name)
        }
        .frame(width: Theme.posterWidth, height: Theme.posterHeight)
        .clipped()
        .overlay(alignment: .topTrailing) {
            if item.inLibrary {
                Image(systemName: "checkmark.circle.fill")
                    .font(.system(size: 34, weight: .semibold))
                    .symbolRenderingMode(.palette)
                    .foregroundStyle(Color.white, Theme.purple)
                    .padding(12)
                    .accessibilityLabel("In your Library")
            }
        }
        .overlay(alignment: .bottom) {
            if let progress = item.progress {
                ProgressBar(value: progress)
                    .padding(.horizontal, 14)
                    .padding(.bottom, 14)
            }
        }
    }
}

/// A poster button with the title and caption underneath. Select opens the detail page, or resumes playback at once
/// for Continue watching (`resumes`). Press and hold Select for Details, Library and Continue watching actions.
struct PosterButton: View {
    @Environment(AppModel.self) private var model
    let item: PosterItem
    var resumes = false

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Button {
                model.select(item, resumes: resumes)
            } label: {
                PosterArtwork(item: item)
            }
            .buttonStyle(.card)
            .contextMenu {
                Button("Details") {
                    model.open(TitleRoute(item.title))
                }
                Button(model.isInLibrary(item.id) ? "Remove from Library" : "Add to Library") {
                    model.toggleLibrary(item.title)
                }
                if let recent = item.resume {
                    Button("Remove from Continue watching") {
                        model.removeFromContinueWatching(recent)
                    }
                }
            }
            Text(item.title.name)
                .font(.caption)
                .lineLimit(1)
            if let caption = item.caption, !caption.isEmpty {
                Text(caption)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
        }
        .frame(width: Theme.posterWidth, alignment: .leading)
    }
}

/// The trailing "See all" tile of a Home row.
struct SeeAllTile: View {
    let action: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Button(action: action) {
                ZStack {
                    Theme.ink
                    VStack(spacing: 16) {
                        Image(systemName: "square.grid.2x2")
                            .font(.system(size: 48))
                        Text("See all")
                            .font(.headline)
                    }
                    .foregroundStyle(.white)
                }
                .frame(width: Theme.posterWidth, height: Theme.posterHeight)
            }
            .buttonStyle(.card)
            Text(" ").font(.caption)
        }
    }
}

/// A titled horizontal row of posters (Home, Library, Search). Each row is its own focus section.
struct PosterRow: View {
    let title: String
    let items: [PosterItem]
    var resumes = false
    var seeAll: (() -> Void)?

    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            Text(title)
                .font(.title3)
                .padding(.horizontal, Theme.sideMargin)
            ScrollView(.horizontal, showsIndicators: false) {
                LazyHStack(alignment: .top, spacing: 40) {
                    ForEach(items) { item in
                        PosterButton(item: item, resumes: resumes)
                    }
                    if let seeAll {
                        SeeAllTile(action: seeAll)
                    }
                }
                .padding(.horizontal, Theme.sideMargin)
                .padding(.vertical, 20)
            }
            .scrollClipDisabled()
        }
        .focusSection()
    }
}

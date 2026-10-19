import SwiftUI
import TunerCore

/// Search across live channels (by name or number), movies and series. There are no number keys on the Siri Remote,
/// so this is also how to find a channel number.
struct SearchView: View {
    @Environment(AppModel.self) private var model
    @State private var query = ""
    @State private var results = SearchResults()

    var body: some View {
        @Bindable var model = model
        NavigationStack(path: $model.searchPath) {
            ScrollView(.vertical) {
                LazyVStack(alignment: .leading, spacing: 50) {
                    if !results.channels.isEmpty {
                        channelSection
                    }
                    if !results.movies.isEmpty {
                        PosterRow(title: "Movies", items: results.movies)
                    }
                    if !results.series.isEmpty {
                        PosterRow(title: "Series", items: results.series)
                    }
                    if results.isEmpty && query.trimmingCharacters(in: .whitespaces).count >= 2 {
                        EmptyStateView(title: "No results for \u{201C}\(query)\u{201D}", systemImage: "magnifyingglass")
                    }
                }
                .padding(.vertical, 40)
            }
            .searchable(text: $query, prompt: "Channels, movies and series")
            .task(id: SearchKey(query: query, browse: model.browse.movies.count &+ model.browse.series.count,
                                channels: model.catalogState.live?.channels.count ?? 0)) {
                try? await Task.sleep(nanoseconds: 250_000_000)
                guard !Task.isCancelled else { return }
                results = CatalogSearch.run(query, lineup: model.catalogState.live, index: model.browse, library: model.librarySnapshot)
            }
            .navigationDestination(for: TitleRoute.self) { route in
                TitleDetailView(route: route)
            }
        }
    }

    private var channelSection: some View {
        VStack(alignment: .leading, spacing: 20) {
            Text("Live TV")
                .font(.title3)
                .padding(.horizontal, Theme.sideMargin)
            ScrollView(.horizontal, showsIndicators: false) {
                LazyHStack(spacing: 30) {
                    ForEach(results.channels) { channel in
                        Button {
                            let lineup = model.catalogState.live?.channels ?? results.channels
                            model.playback.tune(channel, in: lineup, explicit: true, fullScreen: true)
                        } label: {
                            ChannelResultCard(channel: channel)
                        }
                        .buttonStyle(.card)
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

/// Re-runs the search when the query or the catalogue changes.
private struct SearchKey: Equatable {
    let query: String
    let browse: Int
    let channels: Int
}

/// "Channel 12 · Evening News" with the logo.
private struct ChannelResultCard: View {
    @Environment(AppModel.self) private var model
    let channel: Channel

    var body: some View {
        let now = Date()
        let program = model.schedule.current(forKey: channel.key, at: now)
        HStack(spacing: 20) {
            RemoteImage(url: model.logos.logo(for: channel, xmltvIcon: model.schedule.icons[channel.key]), contentMode: .fit) {
                Image(systemName: "tv").font(.system(size: 40)).foregroundStyle(.secondary)
            }
            .frame(width: 110, height: 70)
            VStack(alignment: .leading, spacing: 6) {
                Text(channel.name)
                    .font(.headline)
                    .lineLimit(1)
                Text(program.map { "Channel \(channel.number) · \($0.title)" } ?? "Channel \(channel.number)")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
        }
        .padding(20)
        .frame(width: 520, height: 120, alignment: .leading)
        .background(Color.white.opacity(0.06))
    }
}

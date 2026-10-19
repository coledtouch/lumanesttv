import SwiftUI
import TunerCore

/// Discover: Type (Movies/Series), List and Genre above a 6-column grid of every matching title.
struct DiscoverView: View {
    @Environment(AppModel.self) private var model

    /// Six posters across the 1760-point safe area (fewer if it is narrower).
    private let columns = [GridItem(.adaptive(minimum: Theme.posterWidth, maximum: Theme.posterWidth + 30), spacing: 40, alignment: .top)]

    var body: some View {
        @Bindable var model = model
        NavigationStack(path: $model.discoverPath) {
            content
                .navigationDestination(for: TitleRoute.self) { route in
                    TitleDetailView(route: route)
                }
        }
    }

    /// The stored query, with a list or genre the catalogue doesn't offer (any more) replaced by the default.
    private var query: DiscoverQuery {
        var query = model.discoverQuery
        let lists = model.browse.lists(for: query.kind)
        if !lists.contains(query.list) {
            query.list = lists.contains(.popular) ? .popular : .recentlyAdded
        }
        if let genre = query.genreID, !model.browse.genres(for: query.kind).contains(where: { $0.id == genre }) {
            query.genreID = nil
        }
        return query
    }

    @ViewBuilder
    private var content: some View {
        let query = self.query
        let items = model.browse.discover(query, library: model.librarySnapshot)
        ScrollView(.vertical) {
            VStack(alignment: .leading, spacing: 40) {
                filterBar(query)
                    .focusSection()
                if items.isEmpty {
                    if model.catalogState.moviesPhase == .loading || model.catalogState.seriesPhase == .loading {
                        LoadingView(text: "Loading your movies and series…")
                    } else {
                        EmptyStateView(title: "No titles here", detail: "Try another list or genre.", systemImage: "film")
                    }
                } else {
                    LazyVGrid(columns: columns, alignment: .leading, spacing: 50) {
                        ForEach(items) { item in
                            PosterButton(item: item)
                        }
                    }
                    .focusSection()
                }
            }
            .padding(.horizontal, Theme.sideMargin)
            .padding(.vertical, 40)
        }
    }

    private func filterBar(_ query: DiscoverQuery) -> some View {
        @Bindable var model = model
        let lists = model.browse.lists(for: query.kind)
        let genres = model.browse.genres(for: query.kind)
        let genreName = genres.first(where: { $0.id == query.genreID })?.name ?? "All genres"
        return HStack(spacing: 30) {
            // A list or genre the new type doesn't have falls back to its default (see `query`).
            Picker("Type", selection: $model.discoverQuery.kind) {
                Text("Movies").tag(TitleKind.movie)
                Text("Series").tag(TitleKind.series)
            }
            .pickerStyle(.segmented)
            .frame(width: 460)

            Menu {
                ForEach(lists, id: \.self) { list in
                    Button(list.title) {
                        var updated = query
                        updated.list = list
                        model.discoverQuery = updated
                    }
                }
            } label: {
                Label(query.list.title, systemImage: "list.bullet")
            }

            if !genres.isEmpty {
                Menu {
                    Button("All genres") {
                        var updated = query
                        updated.genreID = nil
                        model.discoverQuery = updated
                    }
                    ForEach(genres) { genre in
                        Button(genre.name) {
                            var updated = query
                            updated.genreID = genre.id
                            model.discoverQuery = updated
                        }
                    }
                } label: {
                    Label(genreName, systemImage: "theatermasks")
                }
            }
            Spacer(minLength: 0)
        }
    }
}

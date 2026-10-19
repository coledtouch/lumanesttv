import SwiftUI
import TunerCore

/// Home: Continue watching, then the browse rows (docs/browse.md), each with a trailing See all tile.
struct HomeView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        @Bindable var model = model
        NavigationStack(path: $model.homePath) {
            content
                .navigationDestination(for: TitleRoute.self) { route in
                    TitleDetailView(route: route)
                }
        }
    }

    @ViewBuilder
    private var content: some View {
        let rows = model.browse.homeRows(library: model.librarySnapshot)
        if rows.isEmpty {
            emptyState
        } else {
            ScrollView(.vertical) {
                LazyVStack(alignment: .leading, spacing: 50) {
                    ForEach(rows) { row in
                        PosterRow(title: row.title, items: row.items, resumes: row.id == "continue") {
                            model.seeAll(row.seeAll)
                        }
                    }
                }
                .padding(.vertical, 40)
            }
        }
    }

    @ViewBuilder
    private var emptyState: some View {
        let state = model.catalogState
        if state.moviesPhase == .loading || state.seriesPhase == .loading || (state.movies == nil && state.series == nil && state.moviesPhase == .idle) {
            LoadingView(text: "Loading your movies and series…")
        } else if case .failed(let message) = state.moviesPhase {
            VStack(spacing: 30) {
                EmptyStateView(title: "Movies and series couldn't be loaded", detail: message, systemImage: "exclamationmark.triangle")
                Button("Try again") { model.loadCatalog(force: true) }
                Button("Go to Live TV") { model.selectedTab = .live }
            }
        } else {
            VStack(spacing: 30) {
                EmptyStateView(title: "Nothing to show here yet",
                               detail: "Movies and series from your LumaNest TV line appear here. Live channels are in Live TV.",
                               systemImage: "film")
                Button("Go to Live TV") { model.selectedTab = .live }
            }
        }
    }
}

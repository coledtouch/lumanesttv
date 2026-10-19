import SwiftUI
import TunerCore

/// Library: Continue watching, Favorite movies, Favorite series and Recently watched.
struct LibraryView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        @Bindable var model = model
        NavigationStack(path: $model.libraryPath) {
            content
                .navigationDestination(for: TitleRoute.self) { route in
                    TitleDetailView(route: route)
                }
        }
    }

    @ViewBuilder
    private var content: some View {
        let sections = model.browse.library(model.librarySnapshot)
        if sections.isEmpty {
            EmptyStateView(title: "Your Library is empty",
                           detail: "Choose Add to Library on a movie or series, and what you watch appears here too.",
                           systemImage: "books.vertical")
        } else {
            ScrollView(.vertical) {
                LazyVStack(alignment: .leading, spacing: 50) {
                    if !sections.continueWatching.isEmpty {
                        PosterRow(title: "Continue watching", items: sections.continueWatching, resumes: true)
                    }
                    if !sections.favoriteMovies.isEmpty {
                        PosterRow(title: "Favorite movies", items: sections.favoriteMovies)
                    }
                    if !sections.favoriteSeries.isEmpty {
                        PosterRow(title: "Favorite series", items: sections.favoriteSeries)
                    }
                    if !sections.recentlyWatched.isEmpty {
                        PosterRow(title: "Recently watched", items: sections.recentlyWatched)
                    }
                }
                .padding(.vertical, 40)
            }
        }
    }
}

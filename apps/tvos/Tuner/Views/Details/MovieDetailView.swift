import SwiftUI
import TunerCore

/// A movie: backdrop, poster, title, year · length · genre · rating, plot, director and cast. Resume (with Start over)
/// or Play, and Add to Library.
struct MovieDetailView: View {
    @Environment(AppModel.self) private var model
    let movieID: String
    @State private var info: MovieInfo?

    var body: some View {
        if let movie = model.movie(id: movieID) {
            page(movie)
                .task(id: movieID) {
                    await load(movie)
                }
        } else {
            EmptyStateView(title: "This movie isn't available any more", systemImage: "film")
        }
    }

    private func load(_ movie: Movie) async {
        guard let source = model.source else { return }
        info = try? await model.catalog.movieInfo(for: movie, source: source)
    }

    private func page(_ movie: Movie) -> some View {
        let recent = model.librarySnapshot.recents.first { $0.id == movie.id && $0.kind == .movie && !$0.upNext }
        let details = info ?? MovieInfo(year: movie.year, rating: movie.rating)
        let inLibrary = model.isInLibrary(movie.id)
        return ZStack(alignment: .topLeading) {
            DetailBackdrop(url: info?.backdrop ?? movie.poster)
            ScrollView(.vertical) {
                HStack(alignment: .top, spacing: 60) {
                    DetailPoster(url: info?.poster ?? movie.poster, name: movie.name)
                    VStack(alignment: .leading, spacing: 24) {
                        Text(movie.name)
                            .font(.largeTitle).bold()
                            .lineLimit(2)
                        let line = details.metadataLine
                        if !line.isEmpty {
                            Text(line).font(.headline).foregroundStyle(.secondary)
                        }
                        HStack(spacing: 30) {
                            if let recent {
                                Button {
                                    model.playback.playMovie(movie, info: info, from: recent.positionMs)
                                } label: {
                                    ResumeLabel(title: "Resume", recent: recent)
                                }
                                Button {
                                    model.playback.playMovie(movie, info: info, from: 0)
                                } label: {
                                    Label("Start over", systemImage: "gobackward")
                                }
                            } else {
                                Button {
                                    model.playback.playMovie(movie, info: info, from: 0)
                                } label: {
                                    Label("Play", systemImage: "play.fill")
                                }
                            }
                            Button {
                                model.toggleLibrary(.movie(movie))
                            } label: {
                                Label(inLibrary ? "In Library" : "Add to Library", systemImage: inLibrary ? "checkmark" : "plus")
                            }
                        }
                        .focusSection()
                        if let plot = details.plot, !plot.isEmpty {
                            Text(plot)
                                .font(.body)
                                .lineLimit(6)
                                .frame(maxWidth: 1100, alignment: .leading)
                        }
                        if let director = details.director, !director.isEmpty {
                            Text("Director: \(director)").font(.callout).foregroundStyle(.secondary)
                        }
                        if let cast = details.cast, !cast.isEmpty {
                            Text("Cast: \(cast)").font(.callout).foregroundStyle(.secondary).lineLimit(2)
                                .frame(maxWidth: 1100, alignment: .leading)
                        }
                    }
                    Spacer(minLength: 0)
                }
                .padding(.horizontal, Theme.sideMargin)
                .padding(.vertical, 60)
            }
        }
    }
}

import SwiftUI
import TunerCore

/// A series: Resume S E / Up next / Play, Add to Library, Trailer (when lumanest.tv found one), season chips and the
/// season's episodes. Episodes Apple TV can't play (MKV, AVI and similar uploads) are shown greyed out but stay
/// focusable, so the list scrolls past them.
struct SeriesDetailView: View {
    @Environment(AppModel.self) private var model
    let seriesID: String
    @State private var info: SeriesInfo?
    @State private var season: Int?
    @State private var loadError: String?
    @State private var trailer: Trailer?

    var body: some View {
        if let series = model.series(id: seriesID) {
            let trailerQuery = model.trailerQuery(for: series)
            page(series)
                .task(id: seriesID) {
                    await load(series)
                }
                .task(id: trailerQuery) {
                    trailer = await model.trailer(trailerQuery)
                }
        } else {
            EmptyStateView(title: "This series isn't available any more", systemImage: "tv")
        }
    }

    private func load(_ series: Series) async {
        guard let source = model.source else { return }
        do {
            let loaded = try await model.catalog.seriesInfo(for: series, source: source)
            info = loaded
            loadError = nil
            if season == nil {
                season = SeriesNavigation.defaultSeason(loaded, returningTo: nil, recents: model.librarySnapshot.recents)
            }
        } catch {
            loadError = TunerError.from(error).message
        }
    }

    private func page(_ series: Series) -> some View {
        let inLibrary = model.isInLibrary(series.id)
        return ZStack(alignment: .topLeading) {
            DetailBackdrop(url: info?.backdrop ?? series.backdrop ?? series.cover)
            ScrollView(.vertical) {
                VStack(alignment: .leading, spacing: 40) {
                    HStack(alignment: .top, spacing: 60) {
                        DetailPoster(url: series.cover, name: series.name)
                        VStack(alignment: .leading, spacing: 24) {
                            Text(series.name)
                                .font(.largeTitle).bold()
                                .lineLimit(2)
                            let line = metadataLine(series)
                            if !line.isEmpty {
                                Text(line).font(.headline).foregroundStyle(.secondary)
                            }
                            HStack(spacing: 30) {
                                mainButton(series)
                                Button {
                                    model.toggleLibrary(.series(series))
                                } label: {
                                    Label(inLibrary ? "In Library" : "Add to Library", systemImage: inLibrary ? "checkmark" : "plus")
                                }
                                if let trailer {
                                    TrailerButton(trailer: trailer)
                                }
                            }
                            .focusSection()
                            if let plot = info?.plot ?? series.plot, !plot.isEmpty {
                                Text(plot)
                                    .font(.body)
                                    .lineLimit(5)
                                    .frame(maxWidth: 1100, alignment: .leading)
                            }
                            if let cast = info?.cast, !cast.isEmpty {
                                Text("Cast: \(cast)").font(.callout).foregroundStyle(.secondary).lineLimit(2)
                                    .frame(maxWidth: 1100, alignment: .leading)
                            }
                        }
                        Spacer(minLength: 0)
                    }
                    .padding(.horizontal, Theme.sideMargin)

                    if let info {
                        seasons(info, series: series)
                    } else if let loadError {
                        VStack(alignment: .leading, spacing: 20) {
                            Text(loadError).foregroundStyle(.secondary)
                            Button("Try again") {
                                Task { await load(series) }
                            }
                        }
                        .padding(.horizontal, Theme.sideMargin)
                    } else {
                        LoadingView(text: "Loading episodes…")
                    }
                }
                .padding(.vertical, 60)
            }
        }
    }

    private func metadataLine(_ series: Series) -> String {
        var parts: [String] = []
        if let year = info?.year ?? series.year, !year.isEmpty { parts.append(year) }
        if let genre = info?.genre ?? series.genre, !genre.isEmpty { parts.append(genre) }
        if let rating = TimeText.rating(series.rating) { parts.append("★" + rating) }
        return parts.joined(separator: " · ")
    }

    @ViewBuilder
    private func mainButton(_ series: Series) -> some View {
        if let info, let point = SeriesNavigation.resumePoint(info, seriesID: series.id, recents: model.librarySnapshot.recents),
           point.episode.isPlayable {
            let episode = point.episode
            let recent = point.recent
            Button {
                model.playback.playEpisode(episode, of: series, info: info, from: recent.upNext ? 0 : recent.positionMs)
            } label: {
                VStack(alignment: .leading, spacing: 6) {
                    Text(recent.upNext ? "Up next: S\(episode.season) E\(episode.number)" : "Resume S\(episode.season) E\(episode.number)")
                        .font(.headline)
                    Text(recent.upNext ? episode.title : "At \(TimeText.clock(seconds: Int(recent.positionMs / 1000))) · \(episode.title)")
                        .font(.caption)
                        .lineLimit(1)
                    if !recent.upNext, let progress = recent.progress {
                        ProgressBar(value: progress).frame(width: 360)
                    }
                }
                .padding(.vertical, 6)
            }
        } else if let info, let first = SeriesNavigation.firstEpisode(info) {
            Button {
                model.playback.playEpisode(first, of: series, info: info, from: 0)
            } label: {
                Label("Play S\(first.season) E\(first.number)", systemImage: "play.fill")
            }
        } else if info != nil {
            Text("No episodes Apple TV can play").foregroundStyle(.secondary)
        }
    }

    @ViewBuilder
    private func seasons(_ info: SeriesInfo, series: Series) -> some View {
        let numbers = info.seasonNumbers
        let current = season.flatMap { numbers.contains($0) ? $0 : nil } ?? numbers.first
        if numbers.isEmpty {
            Text("No episodes yet")
                .foregroundStyle(.secondary)
                .padding(.horizontal, Theme.sideMargin)
        } else {
            VStack(alignment: .leading, spacing: 30) {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 20) {
                        ForEach(numbers, id: \.self) { number in
                            Button(SeriesInfo.seasonTitle(number)) {
                                season = number
                            }
                            .buttonStyle(TileButtonStyle(selected: number == current, cornerRadius: 30))
                        }
                    }
                    .padding(.horizontal, Theme.sideMargin)
                    .padding(.vertical, 16)
                }
                .scrollClipDisabled()
                .focusSection()

                LazyVStack(alignment: .leading, spacing: 24) {
                    ForEach(current.flatMap { info.seasons[$0] } ?? []) { episode in
                        EpisodeRow(episode: episode, series: series, info: info)
                    }
                }
                .padding(.horizontal, Theme.sideMargin)
                .focusSection()
            }
        }
    }
}

/// One episode: still, number and title, length and plot, and its resume bar.
private struct EpisodeRow: View {
    @Environment(AppModel.self) private var model
    let episode: Episode
    let series: Series
    let info: SeriesInfo

    var body: some View {
        let recent = model.librarySnapshot.recents.first { $0.id == episode.id && $0.kind == .episode }
        Button {
            guard episode.isPlayable else {
                model.showToast("This episode isn't available on Apple TV.")
                return
            }
            let resume = (recent?.upNext ?? true) ? 0 : (recent?.positionMs ?? 0)
            model.playback.playEpisode(episode, of: series, info: info, from: resume)
        } label: {
            HStack(alignment: .top, spacing: 30) {
                RemoteImage(url: episode.image ?? series.cover) {
                    TextPlaceholder(text: "E\(episode.number)")
                }
                .frame(width: 320, height: 180)
                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                VStack(alignment: .leading, spacing: 10) {
                    Text("\(episode.number). \(episode.title)")
                        .font(.headline)
                        .lineLimit(1)
                    Text(caption(recent))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    if let plot = episode.plot, !plot.isEmpty {
                        Text(plot)
                            .font(.caption)
                            .lineLimit(2)
                    }
                    if let progress = recent?.progress, recent?.upNext == false {
                        ProgressBar(value: progress).frame(width: 400)
                    }
                }
                Spacer(minLength: 0)
            }
            .padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .buttonStyle(TileButtonStyle(cornerRadius: 16))
        .opacity(episode.isPlayable ? 1 : 0.45)
    }

    private func caption(_ recent: RecentItem?) -> String {
        if !episode.isPlayable { return "Not available on Apple TV" }
        var parts: [String] = []
        if episode.durationSeconds > 0 { parts.append(TimeText.clock(seconds: episode.durationSeconds)) }
        if let recent, recent.upNext { parts.append("Up next") }
        return parts.isEmpty ? " " : parts.joined(separator: " · ")
    }
}

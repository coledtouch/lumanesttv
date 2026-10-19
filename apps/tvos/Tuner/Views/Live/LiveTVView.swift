import SwiftUI
import TunerCore

/// Live TV: the preview and focused programme on top, the guide's category chips, then the grid (now, floored to the
/// half hour, plus 150 minutes). Select on a channel or the current programme tunes the preview; Select again on the
/// previewed channel, or Play/Pause, goes full screen. Press and hold Select for Favorites and the full schedule.
struct LiveTVView: View {
    @Environment(AppModel.self) private var model
    @State private var now = Date()
    @State private var focus = GuideFocus()
    @State private var batcher = ShortGuideBatcher()
    @State private var selection: GuideSelection?
    @State private var scheduleChannel: Channel?
    @State private var scrolledToLast = false

    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            GuideHeader(focus: focus)
                .padding(.horizontal, Theme.sideMargin)
            GuideChips()
                .focusSection()
            content
        }
        .padding(.top, 20)
        .task {
            // The clock: the window moves on at each half hour, "now" lines up every 30 s.
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 30_000_000_000)
                now = Date()
            }
        }
        .task(id: model.catalogState.live?.updated) {
            model.playback.restorePreview()
        }
        .onDisappear {
            batcher.cancel()
        }
        .sheet(item: $selection) { picked in
            ProgramDetailsSheet(channel: picked.channel, program: picked.program) {
                watch(picked.channel, channels: currentChannels)
            }
        }
        .sheet(item: $scheduleChannel) { channel in
            ChannelScheduleSheet(channel: channel) {
                watch(channel, channels: currentChannels)
            }
        }
    }

    private var currentChannels: [Channel] {
        model.guideChannels(for: model.guideChip)
    }

    @ViewBuilder
    private var content: some View {
        let state = model.catalogState
        if let lineup = state.live {
            let channels = GuideLineup.channels(for: model.guideChip, lineup: lineup, favorites: model.favorites, mostWatched: model.mostWatched)
            if channels.isEmpty {
                let message = GuideLineup.emptyMessage(for: model.guideChip, usOnly: model.settings.usOnly)
                // The chips above keep focus; the message needs none.
                EmptyStateView(title: message.title, detail: message.detail, systemImage: "list.bullet.rectangle")
            } else {
                grid(channels)
            }
        } else if case .failed(let message) = state.livePhase {
            VStack(spacing: 30) {
                EmptyStateView(title: "Channels couldn't be loaded", detail: message, systemImage: "exclamationmark.triangle")
                Button("Try again") { model.loadCatalog(force: true) }
            }
        } else {
            LoadingView(text: "Loading your channels…")
        }
    }

    private func grid(_ channels: [Channel]) -> some View {
        let window = GuideWindow(now: now)
        let lastKey = model.lastChannelKey
        return VStack(alignment: .leading, spacing: 10) {
            TimeRuler(window: window)
            ScrollViewReader { proxy in
                ScrollView(.vertical) {
                    LazyVStack(alignment: .leading, spacing: 10) {
                        ForEach(channels) { channel in
                            GuideRow(channel: channel,
                                     programs: model.schedule.filled(forKey: channel.key, channelName: channel.name, window: window.interval),
                                     window: window,
                                     now: now,
                                     isFavorite: model.favorites.contains(channel.key),
                                     isTuned: model.playback.liveChannel?.key == channel.key,
                                     logo: model.logos.logo(for: channel, xmltvIcon: model.schedule.icons[channel.key]),
                                     focus: focus,
                                     select: { program in select(channel, program: program, channels: channels) },
                                     fullScreen: { watch(channel, channels: channels, fullScreen: true) },
                                     toggleFavorite: { model.toggleFavorite(channel) },
                                     showSchedule: { scheduleChannel = channel })
                                .id(channel.key)
                                .onAppear { batcher.add(channel, model: model) }
                        }
                    }
                    .padding(.horizontal, Theme.sideMargin)
                    .padding(.vertical, 12)
                }
                .scrollClipDisabled()
                .onAppear {
                    guard !scrolledToLast, let lastKey, channels.contains(where: { $0.key == lastKey }) else { return }
                    scrolledToLast = true
                    proxy.scrollTo(lastKey, anchor: .top)
                }
            }
            .focusSection()
        }
    }

    /// Select on a channel cell (program nil) or a programme.
    private func select(_ channel: Channel, program: Program?, channels: [Channel]) {
        if let program, !GuideWindow.isLive(program, at: Date()) {
            selection = GuideSelection(channel: channel, program: program)
            return
        }
        watch(channel, channels: channels)
    }

    /// Guide preview on: the first Select tunes the preview, Select on the previewed channel goes full screen.
    /// Guide preview off (or `fullScreen`): straight to full screen. Going full screen on the tuned channel goes through
    /// `tune` too, so a preview that was only restored counts as watched then (once per tune).
    private func watch(_ channel: Channel, channels: [Channel], fullScreen: Bool = false) {
        let playback = model.playback
        if !fullScreen && model.settings.guidePreview && !playback.isTuned(to: channel) {
            playback.tune(channel, in: channels, explicit: true, fullScreen: false)
        } else {
            playback.tune(channel, in: channels, explicit: true, fullScreen: true)
        }
    }
}

/// The preview window and the focused programme's details.
private struct GuideHeader: View {
    @Environment(AppModel.self) private var model
    let focus: GuideFocus

    var body: some View {
        let playback = model.playback
        HStack(alignment: .top, spacing: 40) {
            ZStack {
                Color.black
                if model.settings.guidePreview && playback.mode == .live && !playback.isFullScreen {
                    PlayerLayerView(player: playback.player)
                        .id(playback.previewToken)
                }
                if let status = playback.status, playback.mode == .live {
                    Text(status)
                        .font(.callout)
                        .multilineTextAlignment(.center)
                        .padding(16)
                        .background(Color.black.opacity(0.7))
                        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                        .padding(12)
                } else if !model.settings.guidePreview {
                    Image(systemName: "tv")
                        .font(.system(size: 60))
                        .foregroundStyle(.secondary)
                }
            }
            .frame(width: 480, height: 270)
            .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))

            VStack(alignment: .leading, spacing: 10) {
                if let channel = focus.channel ?? playback.liveChannel {
                    // The channel column has no programme of its own: show what's on now.
                    let program = focus.program ?? model.schedule.current(forKey: channel.key, at: Date())
                    Text("\(channel.number)  \(channel.name)")
                        .font(.headline)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                    if let program, !program.placeholder {
                        Text(program.title)
                            .font(.title3)
                            .lineLimit(2)
                        Text("\(TimeText.time(program.start)) – \(TimeText.time(program.end))")
                            .font(.callout)
                            .foregroundStyle(.secondary)
                        if let subtitle = program.subtitle, !subtitle.isEmpty {
                            Text(subtitle).font(.callout).lineLimit(1)
                        }
                        if let description = program.description, !description.isEmpty {
                            Text(description)
                                .font(.callout)
                                .foregroundStyle(.secondary)
                                .lineLimit(3)
                        }
                    } else {
                        Text("No programme information")
                            .font(.title3)
                            .foregroundStyle(.secondary)
                    }
                } else {
                    Text("Live TV").font(.title3)
                    Text("Choose a channel to watch. Press and hold Select to add it to Favorites.")
                        .font(.callout)
                        .foregroundStyle(.secondary)
                }
            }
            Spacer(minLength: 0)
        }
        .frame(height: 270)
    }
}

/// All Channels, Favorites, Most Watched, then the categories in the chosen order.
private struct GuideChips: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        let chips = GuideLineup.chips(model.catalogState.live?.categories ?? [], order: model.settings.categoryOrder)
        ScrollView(.horizontal, showsIndicators: false) {
            LazyHStack(spacing: 16) {
                ForEach(chips) { item in
                    Button {
                        model.guideChip = item.chip
                    } label: {
                        Text(item.title)
                            .font(.callout)
                            .lineLimit(1)
                            .padding(.horizontal, 26)
                            .padding(.vertical, 12)
                    }
                    .buttonStyle(TileButtonStyle(selected: model.guideChip == item.chip, cornerRadius: 30))
                }
            }
            .padding(.horizontal, Theme.sideMargin)
            .padding(.vertical, 10)
        }
        .scrollClipDisabled()
    }
}

/// The half-hour marks above the grid.
private struct TimeRuler: View {
    let window: GuideWindow

    var body: some View {
        HStack(spacing: 0) {
            Text(dayText)
                .font(.caption)
                .foregroundStyle(.secondary)
                .frame(width: GuideWindow.channelColumnWidth + GuideWindow.cellSpacing, alignment: .leading)
            ForEach(window.marks, id: \.self) { mark in
                Text(TimeText.time(mark))
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .frame(width: 30 * GuideWindow.pointsPerMinute, alignment: .leading)
            }
        }
        .padding(.horizontal, Theme.sideMargin)
    }

    private var dayText: String {
        Calendar.current.isDateInToday(window.start) ? "Today" : window.start.formatted(.dateTime.weekday(.wide))
    }
}

/// One channel: its cell (number, logo, name) and the programmes in the window.
private struct GuideRow: View {
    let channel: Channel
    let programs: [Program]
    let window: GuideWindow
    let now: Date
    let isFavorite: Bool
    let isTuned: Bool
    let logo: URL?
    let focus: GuideFocus
    let select: (Program?) -> Void
    let fullScreen: () -> Void
    let toggleFavorite: () -> Void
    let showSchedule: () -> Void

    var body: some View {
        HStack(spacing: GuideWindow.cellSpacing) {
            Button {
                select(nil)
            } label: {
                ChannelCell(channel: channel, logo: logo, isFavorite: isFavorite, focus: focus)
            }
            .buttonStyle(TileButtonStyle(selected: isTuned))
            .contextMenu { menu }
            .onPlayPauseCommand(perform: fullScreen)

            ForEach(Array(programs.enumerated()), id: \.offset) { _, program in
                Button {
                    select(program)
                } label: {
                    ProgramCell(channel: channel, program: program, isOnNow: program.start <= now && now < program.end,
                                width: window.width(of: program), focus: focus)
                }
                .buttonStyle(TileButtonStyle())
                .contextMenu { menu }
                .onPlayPauseCommand(perform: fullScreen)
            }
        }
    }

    @ViewBuilder
    private var menu: some View {
        Button(isFavorite ? "Remove from Favorites" : "Add to Favorites", action: toggleFavorite)
        Button("Watch full screen", action: fullScreen)
        Button("Full schedule", action: showSchedule)
    }
}

private struct ChannelCell: View {
    @Environment(\.isFocused) private var isFocused
    let channel: Channel
    let logo: URL?
    let isFavorite: Bool
    let focus: GuideFocus

    var body: some View {
        HStack(spacing: 14) {
            Text("\(channel.number)")
                .font(.callout.monospacedDigit())
                .frame(width: 64, alignment: .trailing)
            RemoteImage(url: logo, contentMode: .fit) {
                Color.clear
            }
            .frame(width: 70, height: 46)
            Text(channel.name)
                .font(.callout)
                .lineLimit(2)
            Spacer(minLength: 0)
            if isFavorite {
                Image(systemName: "heart.fill")
                    .font(.caption)
                    .accessibilityLabel("Favorite")
            }
        }
        .padding(.horizontal, 12)
        .frame(width: GuideWindow.channelColumnWidth, height: GuideWindow.rowHeight)
        .onChange(of: isFocused) { _, focused in
            if focused {
                focus.channel = channel
                focus.program = nil
            }
        }
    }
}

private struct ProgramCell: View {
    @Environment(\.isFocused) private var isFocused
    let channel: Channel
    let program: Program
    let isOnNow: Bool
    let width: CGFloat
    let focus: GuideFocus

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            if width > 60 {
                Text(program.title)
                    .font(.callout)
                    .lineLimit(1)
                if width > 160 && !program.placeholder {
                    Text("\(TimeText.time(program.start)) – \(TimeText.time(program.end))")
                        .font(.caption2)
                        .opacity(0.7)
                        .lineLimit(1)
                }
            }
        }
        .padding(.horizontal, width > 60 ? 14 : 0)
        .frame(width: width, height: GuideWindow.rowHeight, alignment: .leading)
        .overlay(alignment: .leading) {
            if isOnNow && !isFocused {
                Rectangle().fill(Theme.lilac).frame(width: 4)
            }
        }
        .onChange(of: isFocused) { _, focused in
            if focused {
                focus.channel = channel
                focus.program = program
            }
        }
    }
}

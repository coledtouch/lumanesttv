import SwiftUI
import TunerCore

/// A programme that hasn't started: its details, Watch live, Favorites and the channel's full schedule.
struct ProgramDetailsSheet: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    let channel: Channel
    let program: Program
    let watch: () -> Void
    @State private var showsSchedule = false

    var body: some View {
        VStack(alignment: .leading, spacing: 30) {
            Text("\(channel.number)  \(channel.name)")
                .font(.headline)
                .foregroundStyle(.secondary)
            if showsSchedule {
                Button {
                    dismissThenWatch(dismiss, watch)
                } label: {
                    Label("Watch live", systemImage: "play.fill")
                }
                .focusSection()
                ScheduleList(channel: channel)
            } else {
                Text(program.title)
                    .font(.title2)
                Text("\(dayText(program.start)) · \(TimeText.time(program.start)) – \(TimeText.time(program.end))")
                    .font(.headline)
                    .foregroundStyle(.secondary)
                if let subtitle = program.subtitle, !subtitle.isEmpty {
                    Text(subtitle).font(.headline)
                }
                if let description = program.description, !description.isEmpty {
                    Text(description)
                        .font(.body)
                        .lineLimit(8)
                        .frame(maxWidth: 1200, alignment: .leading)
                }
                HStack(spacing: 30) {
                    Button {
                        dismissThenWatch(dismiss, watch)
                    } label: {
                        Label("Watch live", systemImage: "play.fill")
                    }
                    Button {
                        model.toggleFavorite(channel)
                    } label: {
                        let isFavorite = model.favorites.contains(channel.key)
                        Label(isFavorite ? "Remove from Favorites" : "Add to Favorites", systemImage: isFavorite ? "heart.fill" : "heart")
                    }
                    Button {
                        showsSchedule = true
                    } label: {
                        Label("Full schedule", systemImage: "calendar")
                    }
                }
                .focusSection()
            }
            Spacer(minLength: 0)
        }
        .padding(80)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    private func dayText(_ date: Date) -> String {
        Calendar.current.isDateInToday(date) ? "Today" : date.formatted(.dateTime.weekday(.wide).month(.abbreviated).day())
    }
}

/// The channel's full schedule from now on (later programmes than the grid's 150 minutes).
struct ChannelScheduleSheet: View {
    @Environment(\.dismiss) private var dismiss
    let channel: Channel
    let watch: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 30) {
            HStack {
                Text("\(channel.number)  \(channel.name)")
                    .font(.title3)
                Spacer()
                Button {
                    dismissThenWatch(dismiss, watch)
                } label: {
                    Label("Watch live", systemImage: "play.fill")
                }
            }
            .focusSection()
            ScheduleList(channel: channel)
        }
        .padding(80)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
}

/// Closes the sheet first, then tunes once it is gone (the full-screen player can't open while the sheet is closing).
@MainActor
private func dismissThenWatch(_ dismiss: DismissAction, _ watch: @escaping () -> Void) {
    dismiss()
    Task { @MainActor in
        try? await Task.sleep(nanoseconds: 600_000_000)
        watch()
    }
}

/// Upcoming programmes, one focusable row each (so the list scrolls with the remote).
private struct ScheduleList: View {
    @Environment(AppModel.self) private var model
    let channel: Channel

    var body: some View {
        let programs = model.schedule.upcoming(forKey: channel.key, from: Date())
        if programs.isEmpty {
            // Both sheets keep a "Watch live" button above this, so the message needs no focus.
            EmptyStateView(title: "No schedule for this channel", systemImage: "calendar")
        } else {
            ScrollView(.vertical) {
                LazyVStack(alignment: .leading, spacing: 12) {
                    ForEach(Array(programs.enumerated()), id: \.offset) { _, program in
                        Button {} label: {
                            HStack(alignment: .top, spacing: 30) {
                                Text("\(dayPrefix(program.start))\(TimeText.time(program.start))")
                                    .font(.callout.monospacedDigit())
                                    .frame(width: 260, alignment: .leading)
                                VStack(alignment: .leading, spacing: 6) {
                                    Text(program.title).font(.headline).lineLimit(1)
                                    if let description = program.description, !description.isEmpty {
                                        Text(description).font(.caption).lineLimit(2).opacity(0.75)
                                    }
                                }
                                Spacer(minLength: 0)
                            }
                            .padding(18)
                            .frame(maxWidth: .infinity, alignment: .leading)
                        }
                        .buttonStyle(TileButtonStyle())
                    }
                }
                .padding(.vertical, 10)
            }
            .scrollClipDisabled()
        }
    }

    private func dayPrefix(_ date: Date) -> String {
        Calendar.current.isDateInToday(date) ? "" : date.formatted(.dateTime.weekday(.abbreviated)) + " "
    }
}

/// The "Channels" panel in the full-screen player's Info area: the channels around the one playing.
struct ChannelsPanel: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        let playback = model.playback
        let channels = playback.zapChannels
        let currentKey = playback.liveChannel?.key
        ScrollViewReader { proxy in
            ScrollView(.horizontal, showsIndicators: false) {
                LazyHStack(spacing: 24) {
                    ForEach(channels) { channel in
                        Button {
                            playback.zap(to: channel)
                        } label: {
                            PanelChannel(channel: channel, isCurrent: channel.key == currentKey)
                        }
                        .buttonStyle(TileButtonStyle(selected: channel.key == currentKey, cornerRadius: 14))
                        .id(channel.key)
                    }
                }
                .padding(.horizontal, 60)
                .padding(.vertical, 30)
            }
            .onAppear {
                if let currentKey { proxy.scrollTo(currentKey, anchor: .center) }
            }
        }
    }
}

private struct PanelChannel: View {
    @Environment(AppModel.self) private var model
    let channel: Channel
    let isCurrent: Bool

    var body: some View {
        let program = model.schedule.current(forKey: channel.key, at: Date())
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 12) {
                Text("\(channel.number)")
                    .font(.callout.monospacedDigit())
                RemoteImage(url: model.logos.logo(for: channel, xmltvIcon: model.schedule.icons[channel.key]), contentMode: .fit) {
                    Color.clear
                }
                .frame(width: 60, height: 40)
                Spacer(minLength: 0)
                if isCurrent {
                    Image(systemName: "play.fill").font(.caption)
                }
            }
            Text(channel.name)
                .font(.headline)
                .lineLimit(1)
            Text(program?.title ?? " ")
                .font(.caption)
                .opacity(0.75)
                .lineLimit(1)
        }
        .padding(20)
        .frame(width: 340, height: 180, alignment: .topLeading)
    }
}

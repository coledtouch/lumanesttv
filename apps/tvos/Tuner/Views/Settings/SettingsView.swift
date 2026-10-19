import SwiftUI
import TunerCore

/// Settings. Rows with several values cycle through them on Select. There is deliberately no adult content setting,
/// no stream format, no purchase or plan text and no third-party guide option in this edition.
struct SettingsView: View {
    @Environment(AppModel.self) private var model
    @State private var chosenSource: Source?
    @State private var showsSourceActions = false
    @State private var confirmsClear = false
    @State private var showsPrivacy = false

    var body: some View {
        NavigationStack {
            Form {
                accountSection
                liveSection
                Section("Movies & Series") {
                    ValueRow(title: "Show", value: SettingsText.titles(usOnly: model.settings.titlesUSOnly)) {
                        model.updateSettings { $0.titlesUSOnly.toggle() }
                    }
                }
                Section("Playback") {
                    ValueRow(title: "Subtitles", value: model.settings.subtitles.label) {
                        model.updateSettings { $0.subtitles = SettingsText.next($0.subtitles) }
                    }
                }
                Section("Start on") {
                    ValueRow(title: "Open Tuner on", value: model.settings.startOnLiveTV ? "Live TV" : "Home") {
                        model.updateSettings { $0.startOnLiveTV.toggle() }
                    }
                }
                Section("Data") {
                    Button("Refresh channels, movies and guide") {
                        model.refreshAll()
                    }
                    Button("Clear cached data") {
                        confirmsClear = true
                    }
                }
                aboutSection
            }
            .confirmationDialog(chosenSource?.name ?? "Login", isPresented: $showsSourceActions, titleVisibility: .visible) {
                if let source = chosenSource {
                    if source.id != model.source?.id {
                        Button("Use this login") { model.useSource(id: source.id) }
                    }
                    Button("Remove this login", role: .destructive) { model.removeSource(id: source.id) }
                }
                Button("Cancel", role: .cancel) {}
            } message: {
                Text("Removing a login also removes its Favorites, history and resume points from this Apple TV.")
            }
            .confirmationDialog("Clear cached data?", isPresented: $confirmsClear, titleVisibility: .visible) {
                Button("Clear", role: .destructive) {
                    Task { await model.clearCaches() }
                }
                Button("Cancel", role: .cancel) {}
            } message: {
                Text("Channels, movies, series and the guide download again. Logins, Favorites and resume points stay.")
            }
            .sheet(isPresented: $showsPrivacy) {
                PrivacySheet()
            }
        }
    }

    private var accountSection: some View {
        Section("Account") {
            ForEach(model.allSources) { source in
                Button {
                    chosenSource = source
                    showsSourceActions = true
                } label: {
                    HStack {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(source.name)
                            Text(SignInForm.describe(source))
                                .font(.caption)
                                .foregroundStyle(.secondary)
                                .lineLimit(1)
                        }
                        Spacer()
                        if source.id == model.source?.id {
                            Text("In use").foregroundStyle(.secondary)
                        }
                    }
                }
            }
            if let summary = model.accountSummary {
                // Between focusable rows, so it scrolls into view without taking focus itself.
                Text(summary)
                    .foregroundStyle(.secondary)
            }
            NavigationLink {
                PairingView()
            } label: {
                Text("Pair with your phone")
            }
            NavigationLink {
                SignInView()
            } label: {
                Text("Sign in with your login")
            }
        }
    }

    private var liveSection: some View {
        Section("Live TV") {
            ValueRow(title: "Channels", value: model.settings.usOnly ? "USA only" : "All") {
                model.updateSettings { $0.usOnly.toggle() }
            }
            ValueRow(title: "Category order", value: model.settings.categoryOrder.label) {
                model.updateSettings { $0.categoryOrder = $0.categoryOrder.next }
            }
            ValueRow(title: "Guide preview", value: model.settings.guidePreview ? "On" : "Off") {
                model.updateSettings { $0.guidePreview.toggle() }
            }
            Button("Favorite channels") {
                model.showFavoriteChannels()
            }
            Button("Bring back hidden channels") {
                model.bringBackHiddenChannels()
            }
        }
    }

    /// The text rows come before the Privacy policy button, the last row of the screen: moving focus down to the button
    /// scrolls them into view, so none of them has to take focus (a focused text row would show no focus effect).
    private var aboutSection: some View {
        Section("About") {
            Text("Tuner \(SettingsText.version)")
            Text("Tuner contains no channels or content. It plays your own LumaNest TV subscription.")
                .font(.caption)
                .foregroundStyle(.secondary)
            if model.browse.usesTMDB {
                Text(TunerLinks.tmdbAttribution)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Button {
                showsPrivacy = true
            } label: {
                VStack(alignment: .leading, spacing: 6) {
                    Text("Privacy policy")
                    Text(TunerLinks.privacyNotice)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
        }
    }
}

/// A row that shows its current value and moves to the next one on Select.
private struct ValueRow: View {
    let title: String
    let value: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack {
                Text(title)
                Spacer()
                Text(value).foregroundStyle(.secondary)
            }
        }
    }
}

/// The privacy policy address as text and a QR code to open it on a phone (from Settings, Welcome, Sign in and Pair).
/// "Done" is the one thing to focus; the QR code doesn't take focus.
struct PrivacySheet: View {
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        HStack(spacing: 80) {
            VStack(alignment: .leading, spacing: 24) {
                Text("Privacy policy").font(.title2)
                Text("Scan the code with your phone, or go to \(SettingsText.displayAddress(TunerLinks.privacyPolicy)).")
                    .font(.body)
                    .frame(maxWidth: 800, alignment: .leading)
                Text("Help: \(SettingsText.displayAddress(TunerLinks.help))")
                    .font(.body)
                    .foregroundStyle(.secondary)
                Button("Done") {
                    dismiss()
                }
                .padding(.top, 20)
            }
            QRCodeView(text: TunerLinks.privacyPolicy.absoluteString)
                .frame(width: 360, height: 360)
        }
        .padding(80)
    }
}

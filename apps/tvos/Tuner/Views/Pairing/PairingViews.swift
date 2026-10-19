import SwiftUI
import TunerCore

/// First launch (no saved login): pair with a phone, or sign in with the line login using the remote. The privacy
/// policy is reachable here, before any login is entered (guideline 5.1.1(i)).
struct WelcomeView: View {
    @State private var showsPrivacy = false

    var body: some View {
        NavigationStack {
            HStack(alignment: .center, spacing: 100) {
                VStack(alignment: .leading, spacing: 30) {
                    Text("Welcome to Tuner")
                        .font(.largeTitle).bold()
                    Text("Tuner plays your LumaNest TV subscription: live channels with a guide, movies and series.")
                        .font(.title3)
                        .foregroundStyle(.secondary)
                        .frame(maxWidth: 820, alignment: .leading)
                    VStack(alignment: .leading, spacing: 14) {
                        Text("1. Scan the code with your phone's camera.")
                        Text("2. Sign in with your LumaNest TV login.")
                        Text("3. Approve this Apple TV. Your channels load here.")
                    }
                    .font(.body)
                    // The first thing focused (the QR panel beside it doesn't take focus).
                    NavigationLink {
                        SignInView()
                    } label: {
                        Text("Sign in with your login instead")
                    }
                    .padding(.top, 20)
                    Button("Privacy policy") {
                        showsPrivacy = true
                    }
                }
                PairingPanel { }
            }
            .padding(.horizontal, 120)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(Theme.ink.ignoresSafeArea())
            .sheet(isPresented: $showsPrivacy) {
                PrivacySheet()
            }
        }
    }
}

/// Settings → Pair with your phone: adds another login and makes it the one in use.
struct PairingView: View {
    @Environment(\.dismiss) private var dismiss
    @State private var showsPrivacy = false

    var body: some View {
        HStack(spacing: 100) {
            VStack(alignment: .leading, spacing: 24) {
                Text("Pair with your phone")
                    .font(.title2)
                Text("Scan the code with your phone, sign in with your LumaNest TV login and approve this Apple TV.")
                    .font(.body)
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: 760, alignment: .leading)
                // Something with a visible focus on this screen (the QR panel doesn't take focus).
                Button("Privacy policy") {
                    showsPrivacy = true
                }
                .padding(.top, 20)
            }
            PairingPanel {
                dismiss()
            }
        }
        .padding(.horizontal, 120)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .sheet(isPresented: $showsPrivacy) {
            PrivacySheet()
        }
    }
}

/// The QR code, the short code and the pairing status. Runs the pairing loop while it is on screen. It never takes
/// focus: there is nothing to do with it on the TV, and a focused panel would show no focus effect.
private struct PairingPanel: View {
    @Environment(AppModel.self) private var model
    @State private var session = PairingSession()
    let paired: () -> Void

    var body: some View {
        VStack(spacing: 24) {
            ZStack {
                RoundedRectangle(cornerRadius: 20, style: .continuous)
                    .fill(Color.white.opacity(0.08))
                if let code = session.code {
                    QRCodeView(text: code.verificationUriComplete, fallbackRows: code.qr)
                        .padding(20)
                } else {
                    ProgressView()
                }
            }
            .frame(width: 360, height: 360)

            if let code = session.code {
                Text(code.userCode)
                    .font(.system(size: 54, weight: .bold, design: .monospaced))
                    .tracking(4)
                Text("Or go to lumanest.tv/pair")
                    .font(.headline)
                    .foregroundStyle(.secondary)
            }
            Text(session.message)
                .font(.callout)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .frame(width: 520)
        }
        .task {
            if await session.run(model: model) {
                paired()
            }
        }
    }
}

/// Manual sign-in with the Siri Remote: the LumaNest TV line's server address, username and password. There is no
/// "playlist link" option: this edition only signs in to LumaNest TV lines (phone pairing delivers the rest).
struct SignInView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var server = ""
    @State private var username = ""
    @State private var password = ""
    @State private var busy = false
    @State private var error: String?
    @State private var showsPrivacy = false

    var body: some View {
        Form {
            Section {
                TextField("Server address", text: $server)
                    .keyboardType(.URL)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                TextField("Username", text: $username)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                SecureField("Password", text: $password)
            } footer: {
                Text("Use the server address, username and password from your LumaNest TV welcome email.")
            }
            Section {
                Button(busy ? "Checking…" : "Sign In") {
                    Task { await submit() }
                }
                .disabled(busy)
                if let error {
                    // Right below the focused button, so it needs no focus of its own.
                    Text(error)
                        .foregroundStyle(.red)
                }
            }
            Section {
                Button("Privacy policy") {
                    showsPrivacy = true
                }
            }
        }
        .navigationTitle("Sign in")
        .sheet(isPresented: $showsPrivacy) {
            PrivacySheet()
        }
    }

    private func submit() async {
        error = nil
        busy = true
        defer { busy = false }
        do {
            let source = try SignInForm.serverLogin(server: server, username: username, password: password)
            let summary = try await model.validate(source)
            model.addSource(source)
            if let summary { model.showToast(summary) }
            dismiss()
        } catch {
            self.error = TunerError.from(error).message
        }
    }
}

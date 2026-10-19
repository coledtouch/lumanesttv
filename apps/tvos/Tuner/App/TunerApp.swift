import SwiftUI
import TunerCore

@main
struct TunerApp: App {
    @State private var model = AppModel()

    init() {
        // Posters and logos: a larger shared cache (Caches is purgeable on tvOS, which is fine for artwork).
        URLCache.shared = URLCache(memoryCapacity: 64 * 1024 * 1024, diskCapacity: 256 * 1024 * 1024, directory: nil)
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(model)
                .preferredColorScheme(.dark)
                .tint(Theme.accent)
                .task {
                    await model.start()
                }
        }
    }
}

/// The tab bar (Home, Live TV, Discover, Library, Search, Settings), or Welcome when there is no login yet.
/// Back at the top level is never intercepted, so it leaves the app as people expect.
struct RootView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        @Bindable var model = model
        ZStack(alignment: .top) {
            if !model.started {
                Theme.ink.ignoresSafeArea()
            } else if model.source == nil {
                WelcomeView()
            } else {
                TabView(selection: $model.selectedTab) {
                    HomeView()
                        .tabItem { Text("Home") }
                        .tag(AppTab.home)
                    LiveTVView()
                        .tabItem { Text("Live TV") }
                        .tag(AppTab.live)
                    DiscoverView()
                        .tabItem { Text("Discover") }
                        .tag(AppTab.discover)
                    LibraryView()
                        .tabItem { Text("Library") }
                        .tag(AppTab.library)
                    SearchView()
                        .tabItem { Image(systemName: "magnifyingglass").accessibilityLabel("Search") }
                        .tag(AppTab.search)
                    SettingsView()
                        .tabItem { Text("Settings") }
                        .tag(AppTab.settings)
                }
            }
            if let toast = model.toast {
                ToastView(text: toast)
                    .transition(.move(edge: .top).combined(with: .opacity))
                    .zIndex(1)
            }
        }
        .animation(.easeInOut(duration: 0.25), value: model.toast)
        .onChange(of: scenePhase) { _, phase in
            model.scenePhaseChanged(phase)
        }
        .onChange(of: model.selectedTab) { old, new in
            model.tabChanged(from: old, to: new)
        }
    }
}

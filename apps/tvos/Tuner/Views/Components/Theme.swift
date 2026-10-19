import SwiftUI

/// Brand colours from the asset catalog and the few shared sizes.
enum Theme {
    static let ink = Color("BrandInk")
    static let purple = Color("BrandPurple")
    static let lilac = Color("BrandLilac")
    static let text = Color("BrandText")
    static let accent = Color("AccentColor")

    /// Posters are 2:3.
    static let posterWidth: CGFloat = 250
    static let posterHeight: CGFloat = 375
    /// Extra space at the sides of rows and grids. SwiftUI already keeps content inside the tvOS safe area (60 pt top
    /// and bottom, 80 pt at the sides); rows scroll past it because they don't clip (`scrollClipDisabled`).
    static let sideMargin: CGFloat = 0
}

/// The guide's cells and chips: a flat tile that turns white when focused (no lift, so the grid stays aligned).
struct TileButtonStyle: ButtonStyle {
    var selected = false
    var cornerRadius: CGFloat = 10

    func makeBody(configuration: Configuration) -> some View {
        TileButtonBody(configuration: configuration, selected: selected, cornerRadius: cornerRadius)
    }
}

private struct TileButtonBody: View {
    @Environment(\.isFocused) private var isFocused
    let configuration: ButtonStyleConfiguration
    let selected: Bool
    let cornerRadius: CGFloat

    var body: some View {
        configuration.label
            .foregroundStyle(isFocused ? Color.black : Color.white)
            .background(
                RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                    .fill(fill)
            )
            .overlay(
                RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                    .strokeBorder(selected && !isFocused ? Theme.lilac : Color.clear, lineWidth: 3)
            )
            .opacity(configuration.isPressed ? 0.85 : 1)
            .animation(.easeOut(duration: 0.12), value: isFocused)
    }

    private var fill: Color {
        if isFocused { return Color.white }
        if selected { return Theme.purple.opacity(0.55) }
        return Color.white.opacity(0.08)
    }
}

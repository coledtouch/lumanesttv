import SwiftUI
import TunerCore

/// Artwork from the line (posters, logos, backdrops). Provider artwork is often plain http, which ATS allows here.
struct RemoteImage<Placeholder: View>: View {
    let url: URL?
    var contentMode: ContentMode = .fill
    @ViewBuilder var placeholder: () -> Placeholder

    var body: some View {
        if let url {
            AsyncImage(url: url) { phase in
                if let image = phase.image {
                    image.resizable().aspectRatio(contentMode: contentMode)
                } else {
                    placeholder()
                }
            }
        } else {
            placeholder()
        }
    }
}

/// A title's name on a plain tile, for posters without artwork.
struct TextPlaceholder: View {
    let text: String

    var body: some View {
        ZStack {
            LinearGradient(colors: [Theme.purple.opacity(0.45), Theme.ink], startPoint: .topLeading, endPoint: .bottomTrailing)
            Text(text)
                .font(.headline)
                .multilineTextAlignment(.center)
                .foregroundStyle(.white)
                .padding(20)
        }
    }
}

/// A centred message for empty screens.
struct EmptyStateView: View {
    let title: String
    var detail: String?
    var systemImage: String = "tv"

    var body: some View {
        VStack(spacing: 20) {
            Image(systemName: systemImage)
                .font(.system(size: 64))
                .foregroundStyle(.secondary)
            Text(title)
                .font(.title3)
                .multilineTextAlignment(.center)
            if let detail {
                Text(detail)
                    .font(.body)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: 1000)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 80)
    }
}

/// A loading message.
struct LoadingView: View {
    let text: String

    var body: some View {
        VStack(spacing: 24) {
            ProgressView()
            Text(text).foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 80)
    }
}

/// The short message at the top of the screen ("CNN added to Favorites").
struct ToastView: View {
    let text: String

    var body: some View {
        Text(text)
            .font(.headline)
            .foregroundStyle(.white)
            .padding(.horizontal, 36)
            .padding(.vertical, 18)
            .background(Capsule().fill(Color.black.opacity(0.82)))
            .overlay(Capsule().strokeBorder(Theme.purple, lineWidth: 2))
            .padding(.top, 40)
            .allowsHitTesting(false)
            .accessibilityAddTraits(.updatesFrequently)
    }
}

/// A thin progress bar (resume points).
struct ProgressBar: View {
    let value: Double

    var body: some View {
        GeometryReader { proxy in
            ZStack(alignment: .leading) {
                Capsule().fill(Color.white.opacity(0.3))
                Capsule().fill(Theme.lilac).frame(width: proxy.size.width * CGFloat(min(max(value, 0), 1)))
            }
        }
        .frame(height: 8)
    }
}

/// A QR code drawn with Core Image; the pairing screen falls back to the server's module rows if Core Image can't.
struct QRCodeView: View {
    let text: String
    var fallbackRows: [String] = []

    var body: some View {
        ZStack {
            Color.white
            if let image = QRImage.make(text) {
                Image(uiImage: image)
                    .interpolation(.none)
                    .resizable()
                    .scaledToFit()
                    .padding(12)
            } else if let matrix = QRMatrix(rows: fallbackRows) {
                QRMatrixView(matrix: matrix).padding(12)
            }
        }
        .aspectRatio(1, contentMode: .fit)
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
        .accessibilityLabel("QR code")
    }
}

/// Server-provided QR modules, dark #141224 on white.
struct QRMatrixView: View {
    let matrix: QRMatrix

    var body: some View {
        Canvas { context, size in
            let modules = matrix.size + 4
            let cell = floor(min(size.width, size.height) / CGFloat(modules))
            let side = cell * CGFloat(modules)
            let origin = CGPoint(x: (size.width - side) / 2, y: (size.height - side) / 2)
            var dark = Path()
            for row in 0..<matrix.size {
                for column in 0..<matrix.size where matrix.isDark(row: row, column: column) {
                    dark.addRect(CGRect(x: origin.x + CGFloat(column + 2) * cell, y: origin.y + CGFloat(row + 2) * cell,
                                        width: cell, height: cell))
                }
            }
            context.fill(dark, with: .color(Color(red: 20 / 255, green: 18 / 255, blue: 36 / 255)))
        }
        .aspectRatio(1, contentMode: .fit)
    }
}

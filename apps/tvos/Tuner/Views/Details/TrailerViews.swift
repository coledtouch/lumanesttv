import SwiftUI
import UIKit
import TunerCore

/// The Trailer button on movie and series pages (docs/extras.md "The Trailer button"). The page adds it after Add to
/// Library only once lumanest.tv found a trailer, so it never moves the focused button. Select opens the YouTube app
/// on the video (`youtube://watch/<key>`: `open` needs no Info.plist entry, unlike `canOpenURL`); when tvOS can't open
/// it (YouTube isn't installed), a QR code to watch the trailer on a phone.
struct TrailerButton: View {
    let trailer: Trailer
    @State private var showsCode = false

    var body: some View {
        Button {
            let url = trailer.appURL
            Task { @MainActor in
                let opened = await UIApplication.shared.open(url, options: [:])
                if !opened { showsCode = true }
            }
        } label: {
            Label("Trailer", systemImage: "film")
        }
        .sheet(isPresented: $showsCode) {
            TrailerCodeSheet(trailer: trailer)
        }
    }
}

/// "Watch the trailer on your phone": the QR code of https://youtu.be/<key> (drawn on the device; the server's modules
/// only if Core Image can't), the short link under it, and Close, which returns focus to Trailer.
struct TrailerCodeSheet: View {
    @Environment(\.dismiss) private var dismiss
    let trailer: Trailer

    var body: some View {
        HStack(spacing: 80) {
            VStack(alignment: .leading, spacing: 24) {
                Text("Watch the trailer on your phone").font(.title2)
                Text(trailer.name)
                    .font(.headline)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
                Text("Scan the code with your phone's camera.")
                    .font(.body)
                Button("Close") {
                    dismiss()
                }
                .padding(.top, 20)
            }
            .frame(maxWidth: 800, alignment: .leading)
            VStack(spacing: 20) {
                QRCodeView(text: trailer.phoneURL.absoluteString, fallbackRows: trailer.qr)
                    .frame(width: 360, height: 360)
                Text(trailer.shortLink)
                    .font(.headline)
            }
        }
        .padding(80)
    }
}

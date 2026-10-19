import Foundation
import Observation
import TunerCore

/// Drives the phone pairing loop for the Welcome and Pair screens: a code and QR on the TV, approval on the phone at
/// lumanest.tv/pair, then the login arrives here once.
@MainActor
@Observable
final class PairingSession {
    private(set) var code: PairingCode?
    private(set) var message = "Getting a code…"

    /// Runs until a login has been approved and accepted (true) or the calling task is cancelled (false). A server
    /// login that doesn't work on this Apple TV shows a message and starts again with a new code.
    func run(model: AppModel) async -> Bool {
        while !Task.isCancelled {
            code = nil
            message = "Getting a code…"
            let loop = PairingLoop(client: PairingClient(http: model.lumanestHTTP))
            var approved: Source?
            for await status in loop.run() {
                switch status {
                case .gettingCode:
                    message = "Getting a code…"
                case .waiting(let current):
                    code = current
                    message = "Waiting for you to approve on your phone…"
                case .retrying(let current):
                    if let current { code = current }
                    message = "Can't reach LumaNest TV. Retrying…"
                case .paired(let source):
                    approved = source
                }
            }
            guard let source = approved, !Task.isCancelled else { return false }
            message = "Paired. Loading your channels…"
            if await model.acceptPaired(source) { return true }
            code = nil
            message = "This Apple TV couldn't use that login. Getting a new code…"
            try? await Task.sleep(nanoseconds: 4_000_000_000)
        }
        return false
    }
}

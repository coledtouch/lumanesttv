import Foundation
import Observation
import TunerCore

/// What the guide header shows: the channel and programme that have focus. A separate observable object, so moving
/// focus redraws only the header, not the grid.
@MainActor
@Observable
final class GuideFocus {
    var channel: Channel?
    var program: Program?
}

/// Rows that came on screen; their channels get a short guide request after 350 ms without new rows (Xtream lines).
@MainActor
final class ShortGuideBatcher {
    private var pending: [String: Channel] = [:]
    private var task: Task<Void, Never>?

    func add(_ channel: Channel, model: AppModel) {
        guard model.source?.kind == .xtream else { return }
        pending[channel.key] = channel
        task?.cancel()
        task = Task { [weak self] in
            try? await Task.sleep(nanoseconds: 350_000_000)
            guard let self, !Task.isCancelled, let source = model.source else { return }
            let batch = Array(self.pending.values)
            self.pending = [:]
            await model.guide.requestShortEPG(for: batch, source: source)
        }
    }

    func cancel() {
        task?.cancel()
        pending = [:]
    }
}

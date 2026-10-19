import Foundation
import TunerCore

/// The guide's time window: now floored to the half hour, 150 minutes wide, about 7.2 points per minute.
struct GuideWindow: Equatable {
    static let minutes: Double = 150
    static let pointsPerMinute: CGFloat = 7.2
    static let channelColumnWidth: CGFloat = 340
    static let rowHeight: CGFloat = 86
    static let cellSpacing: CGFloat = 6

    let start: Date

    init(now: Date) {
        let seconds = now.timeIntervalSince1970
        start = Date(timeIntervalSince1970: (seconds / 1800).rounded(.down) * 1800)
    }

    var end: Date { start.addingTimeInterval(GuideWindow.minutes * 60) }
    var interval: DateInterval { DateInterval(start: start, end: end) }
    var totalWidth: CGFloat { CGFloat(GuideWindow.minutes) * GuideWindow.pointsPerMinute }

    /// Width of a programme cell clipped to the window, minus the gap to the next cell.
    func width(of program: Program) -> CGFloat {
        let from = max(program.start, start)
        let to = min(program.end, end)
        let minutes = max(0, to.timeIntervalSince(from) / 60)
        return max(8, CGFloat(minutes) * GuideWindow.pointsPerMinute - GuideWindow.cellSpacing)
    }

    /// The half-hour marks shown above the grid.
    var marks: [Date] {
        stride(from: 0.0, to: GuideWindow.minutes, by: 30).map { start.addingTimeInterval($0 * 60) }
    }

    /// Select on a programme that has started (or ended) tunes the channel; a later one opens its details.
    static func isLive(_ program: Program, at now: Date) -> Bool {
        program.start <= now
    }
}

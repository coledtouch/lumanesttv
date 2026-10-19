import AVKit
import UIKit

/// Presents the system player full screen with UIKit (standard Back dismissal, transport bar, Info panels, captions
/// and audio menus), sharing PlaybackController's single AVPlayer with the guide preview. Live channel up/down comes
/// through AVKit's channel-skip delegate.
@MainActor
final class PlayerPresenter: NSObject, AVPlayerViewControllerDelegate {
    /// The player on screen (UIKit holds it while presented, so this turns nil once it is gone, whatever closed it).
    private weak var controller: AVPlayerViewController?
    /// Held until UIKit has shown it (or refused to).
    private var pending: AVPlayerViewController?
    /// Status text and sidecar subtitles over the video (inside `contentOverlayView`).
    private(set) lazy var overlay = PlayerOverlayView()
    /// Set by PlaybackController: skip by +1/-1 in the current lineup; false when nothing could play.
    var skipChannel: (@MainActor (Int) async -> Bool)?
    /// Called once after the player closed (Back, or `dismiss()`), or when UIKit never showed it.
    var didDismiss: (@MainActor () -> Void)?

    /// What UIKit actually shows (or is about to show): PlaybackController checks its own flag against this.
    var isPresented: Bool { controller != nil }

    /// False when there was nothing to present from (the caller then stays in the guide). True means the player is on
    /// its way: if UIKit refuses it after all, `didDismiss` is called.
    @discardableResult
    func present(player: AVPlayer, menuItems: [UIMenuElement], infoPanels: [UIViewController]) -> Bool {
        if let controller {
            controller.player = player
            update(menuItems: menuItems, infoPanels: infoPanels)
            return true
        }
        guard PlayerPresenter.topViewController() != nil else { return false }
        let controller = AVPlayerViewController()
        controller.player = player
        controller.delegate = self
        controller.appliesPreferredDisplayCriteriaAutomatically = true
        controller.transportBarCustomMenuItems = menuItems
        controller.customInfoViewControllers = infoPanels
        self.controller = controller
        pending = controller
        show(controller, attempt: 0)
        return true
    }

    /// Presents once nothing is being dismissed above the top view controller: UIKit quietly refuses a presentation
    /// while a sheet or a long-press menu is still closing.
    private func show(_ controller: AVPlayerViewController, attempt: Int) {
        guard pending === controller else { return }
        guard let host = PlayerPresenter.topViewController() else {
            failed(controller)
            return
        }
        if host.presentedViewController != nil && attempt < 30 {
            Task { @MainActor [weak self] in
                try? await Task.sleep(nanoseconds: 100_000_000)
                self?.show(controller, attempt: attempt + 1)
            }
            return
        }
        host.present(controller, animated: true) { [weak self] in
            guard let self, self.pending === controller else { return }
            self.pending = nil
            self.attachOverlay()
        }
        attachOverlay()
        // If UIKit refused (another transition was still running) the player never appears: report it as closed.
        Task { @MainActor [weak self] in
            try? await Task.sleep(nanoseconds: 1_500_000_000)
            guard let self, self.pending === controller, controller.presentingViewController == nil else { return }
            self.failed(controller)
        }
    }

    private func failed(_ controller: AVPlayerViewController) {
        guard self.controller === controller else { return }
        pending = nil
        self.controller = nil
        overlay.removeFromSuperview()
        didDismiss?()
    }

    func update(menuItems: [UIMenuElement], infoPanels: [UIViewController]? = nil) {
        guard let controller else { return }
        controller.transportBarCustomMenuItems = menuItems
        if let infoPanels { controller.customInfoViewControllers = infoPanels }
    }

    /// "Next episode" near the end of an episode, "Try again" after a failure.
    func setContextualActions(_ actions: [UIAction]) {
        controller?.contextualActions = actions
    }

    func dismiss() {
        guard let controller else { return }
        guard controller.presentingViewController != nil else {
            // Not shown yet (waiting for a closing sheet): it never will be.
            failed(controller)
            return
        }
        controller.dismiss(animated: true) { [weak self] in
            self?.finish(controller)
        }
    }

    private func finish(_ closed: AVPlayerViewController) {
        guard controller === closed else { return }
        controller = nil
        pending = nil
        overlay.removeFromSuperview()
        didDismiss?()
    }

    private func attachOverlay() {
        guard overlay.superview == nil, let host = controller?.contentOverlayView else { return }
        overlay.translatesAutoresizingMaskIntoConstraints = false
        host.addSubview(overlay)
        NSLayoutConstraint.activate([
            overlay.leadingAnchor.constraint(equalTo: host.leadingAnchor),
            overlay.trailingAnchor.constraint(equalTo: host.trailingAnchor),
            overlay.topAnchor.constraint(equalTo: host.topAnchor),
            overlay.bottomAnchor.constraint(equalTo: host.bottomAnchor),
        ])
    }

    // MARK: AVPlayerViewControllerDelegate
    // nonisolated + a hop to the main actor: correct whether or not the SDK marks the protocol @MainActor.

    nonisolated func playerViewController(_ playerViewController: AVPlayerViewController,
                                          skipToNextChannel completion: @escaping @Sendable (Bool) -> Void) {
        Task { @MainActor in
            let skipped = await self.skipChannel?(1) ?? false
            completion(skipped)
        }
    }

    nonisolated func playerViewController(_ playerViewController: AVPlayerViewController,
                                          skipToPreviousChannel completion: @escaping @Sendable (Bool) -> Void) {
        Task { @MainActor in
            let skipped = await self.skipChannel?(-1) ?? false
            completion(skipped)
        }
    }

    nonisolated func playerViewControllerDidEndDismissalTransition(_ playerViewController: AVPlayerViewController) {
        Task { @MainActor in
            self.finish(playerViewController)
        }
    }

    static func topViewController() -> UIViewController? {
        let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        let scene = scenes.first { $0.activationState == .foregroundActive } ?? scenes.first
        let window = scene?.keyWindow ?? scene?.windows.first
        var top = window?.rootViewController
        while let presented = top?.presentedViewController, !presented.isBeingDismissed {
            top = presented
        }
        return top
    }
}

/// Text over the video: a status line at the top ("Waiting for your line…", skip notices) and sidecar subtitles at the
/// bottom. Never takes focus or touches.
final class PlayerOverlayView: UIView {
    private let messageLabel = PaddedLabel()
    private let subtitleLabel = PaddedLabel()
    private var flashToken = 0

    /// A status that stays until replaced.
    var message: String? {
        didSet { show(message, in: messageLabel) }
    }

    /// The current subtitle cue.
    var subtitle: String? {
        didSet { show(subtitle, in: subtitleLabel) }
    }

    override init(frame: CGRect) {
        super.init(frame: frame)
        isUserInteractionEnabled = false
        backgroundColor = .clear
        for label in [messageLabel, subtitleLabel] {
            label.translatesAutoresizingMaskIntoConstraints = false
            label.numberOfLines = 0
            label.textAlignment = .center
            label.textColor = .white
            label.backgroundColor = UIColor.black.withAlphaComponent(0.65)
            label.layer.cornerRadius = 12
            label.layer.masksToBounds = true
            label.isHidden = true
            addSubview(label)
        }
        messageLabel.font = UIFont.systemFont(ofSize: 34, weight: .semibold)
        subtitleLabel.font = UIFont.systemFont(ofSize: 46, weight: .medium)
        NSLayoutConstraint.activate([
            messageLabel.topAnchor.constraint(equalTo: topAnchor, constant: 70),
            messageLabel.centerXAnchor.constraint(equalTo: centerXAnchor),
            messageLabel.widthAnchor.constraint(lessThanOrEqualToConstant: 1400),
            subtitleLabel.bottomAnchor.constraint(equalTo: bottomAnchor, constant: -90),
            subtitleLabel.centerXAnchor.constraint(equalTo: centerXAnchor),
            subtitleLabel.widthAnchor.constraint(lessThanOrEqualToConstant: 1500),
        ])
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) is not used")
    }

    /// A message that disappears after a few seconds (unless a status replaces it).
    func flash(_ text: String) {
        flashToken += 1
        let token = flashToken
        show(text, in: messageLabel)
        Task { @MainActor [weak self] in
            try? await Task.sleep(nanoseconds: 4_000_000_000)
            guard let self, token == self.flashToken else { return }
            self.show(self.message, in: self.messageLabel)
        }
    }

    private func show(_ text: String?, in label: PaddedLabel) {
        let value = text?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        label.text = value
        label.isHidden = value.isEmpty
    }
}

/// A label with padding around its text (for the dark backgrounds behind captions and messages).
final class PaddedLabel: UILabel {
    var insets = UIEdgeInsets(top: 10, left: 24, bottom: 10, right: 24)

    override func textRect(forBounds bounds: CGRect, limitedToNumberOfLines numberOfLines: Int) -> CGRect {
        let inner = super.textRect(forBounds: bounds.inset(by: insets), limitedToNumberOfLines: numberOfLines)
        return inner.inset(by: UIEdgeInsets(top: -insets.top, left: -insets.left, bottom: -insets.bottom, right: -insets.right))
    }

    override func drawText(in rect: CGRect) {
        super.drawText(in: rect.inset(by: insets))
    }
}

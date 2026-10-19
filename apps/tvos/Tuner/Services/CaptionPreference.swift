import MediaAccessibility

/// The Apple TV caption setting (Settings → Accessibility → Subtitles and Captioning).
enum CaptionPreference {
    /// "Closed Captions and SDH" is on: Automatic subtitles then also turn on a title's subtitle files.
    static var systemCaptionsOn: Bool {
        MACaptionAppearanceGetDisplayType(.user) == .alwaysOn
    }
}

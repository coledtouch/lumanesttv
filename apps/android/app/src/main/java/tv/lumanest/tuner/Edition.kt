package tv.lumanest.tuner

/**
 * Which edition this build is, chosen when it is built (`-Pstore=true`, see app/build.gradle.kts).
 *
 * The **direct edition** is the APK on lumanest.tv and stays exactly as it was, except that since 1.8.1 both editions
 * show the privacy policy and YouTube's terms in Settings > About (trailers play in YouTube's embedded player). The
 * **store edition** is the Google Play and Amazon Appstore build, made for store review:
 *  - adult categories are always hidden, with no passcode or unlock in Settings, and the filter also catches adult
 *    channel and title names and more category spellings ([tv.lumanest.tuner.data.AdultFilter]);
 *  - the optional Trending list only highlights channels already in the (filtered) lineup, so it can't add back a
 *    channel the adult filter hid;
 *  - no picture-in-picture (Google Play's TV rules), and Android TV only on Google Play (manifest placeholders);
 *  - neutral wording ("Server login", "Playlist link") instead of IPTV jargon, no user-agent field, generic remote
 *    help;
 *  - the free guide fallback starts off and lists only country guides;
 *  - the LAN phone form only runs while its QR code is on screen.
 *
 * Both editions still clear the data left by the torrent player removed in 1.6.0, because a TV can update from an
 * old lumanest.tv APK straight to the store edition (same package and key).
 *
 * [STORE] is a compile-time constant, so R8 removes direct-only code and text from the store build. Screens and data
 * classes take the edition as a parameter defaulting to [STORE], so tests cover both editions in one build.
 */
object Edition {
    const val STORE: Boolean = BuildConfig.STORE_BUILD

    /** Native picture-in-picture is offered only by the direct edition. */
    fun pictureInPictureAllowed(store: Boolean = STORE): Boolean = !store

    /**
     * The privacy policy, shown as a Settings row in the store edition: Google Play requires it inside the app.
     * Deliberately not lumanest.tv/apps, which sells plans and offers the lumanest.tv APK.
     */
    const val PRIVACY_URL = "tunertv.app/privacy"
}

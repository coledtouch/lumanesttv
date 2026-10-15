# App releases

The initial source migration includes these existing installers as GitHub Release assets:

| Installer | Version | Purpose |
| --- | --- | --- |
| `Tuner-1.5.3.apk` | 1.5.3, Android version code 14 | Signed Android TV / Google TV app |
| `Tuner-1.4.8-tizen-UNSIGNED.wgt` | 1.4.8 | Samsung development widget; requires signing before TV installation |
| `tv.lumanest.tuner_1.0.1_all.ipk` | 1.0.1 | LG webOS development installer |

Later releases:

| Installer | Version | Purpose |
| --- | --- | --- |
| `Tuner-1.6.0.apk` | 1.6.0, Android version code 15 | Signed Android TV / Google TV / Fire TV app: LumaNest branding, phone pairing, Torrentio removed |
| `tuner-roku-1.0.1.zip` | 1.0.1 | Roku app ZIP for developer-mode sideloading, served from the website's public downloads directory; built with `npm run build` in `apps/roku` |

[`SHA256SUMS`](SHA256SUMS) records the installer checksums. GitHub also generates a source archive for each tagged release; it contains the website and all three app source trees.

Keep private keys, certificates and signing profiles outside the repository. Android updates must keep the existing application ID and release signing key. Unsigned Samsung packages are not ready to install on a television.

## Cutting a release

Each app has its own version, so each release has its own tag: `android-v<version>`, `tizen-v<version>` or `webos-v<version>` (for example `android-v1.6.0`). The version must match the app source: `versionName` in `apps/android/app/build.gradle.kts`, the widget version in `apps/tizen/config.xml` and `apps/tizen/package.json`, or `apps/webos/appinfo.json` and `apps/webos/package.json`.

Pushing the tag runs [`.github/workflows/release.yml`](../.github/workflows/release.yml). It runs that app's checks, builds its installer, writes a `SHA256SUMS` file for the files it built and creates a **draft** GitHub release with those files attached. Nothing is published until the owner reviews the draft and publishes it.

| Tag | CI attaches | Before publishing |
| --- | --- | --- |
| `android-v*` | `Tuner-<version>-UNSIGNED.apk` | The owner builds or signs `Tuner-<version>.apk` with the existing release key on their own machine, uploads it to the draft, and adds its SHA-256 to the release notes and to this folder's `SHA256SUMS`. |
| `tizen-v*` | `Tuner-<version>-tizen-UNSIGNED.wgt` | Optional: attach a Samsung-signed widget made with the private certificate profile. |
| `webos-v*` | `tv.lumanest.tuner_<version>_all.ipk` | Development IPK made with LG's `ares-package`; install-test it on a TV. |

Signing keys, keystore passwords and certificate profiles are never stored in GitHub secrets or given to CI, so an Android build from CI is always unsigned. Android TV will not install an unsigned APK over the signed app, so only the owner-signed APK should be offered to users. Record the checksum of every installer that is offered for download in `SHA256SUMS`; existing entries stay unchanged.

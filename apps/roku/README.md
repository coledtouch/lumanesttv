# LumaNest TV for Roku

This is the Roku channel source for LumaNest TV 1.0.0, written in BrightScript and SceneGraph. It is separate from `../android`, `../tizen` and `../webos`. The channel provides Live TV and Movies, both browsed by category, plus Settings and a full-screen player. Customers add their playlist on the Roku in one of three ways:

- **Pair with your phone.** The Roku shows a QR code and a short code from `lumanest.tv/api/pair`, which is the same flow the Samsung and LG apps use, with device `roku`. The customer approves it on their phone, and the Roku receives the line login.
- **Enter the line login.** Type the server address, username and password. A full `get.php?username=…&password=…` link is also accepted.
- **Enter an M3U playlist link.**

The login is stored only in this Roku's registry. It is never packaged, and the build fails if packaged code contains something that looks like a credential.

| Remote | Lists | Player |
| --- | --- | --- |
| Left / Right | Switch between Live TV, Movies and Settings (top row), or between categories and items | Seek in movies |
| Up / Down | Move through the list | Next or previous channel in the same category (Live TV) |
| OK | Open the category or play the item | Show channel info (Live TV) |
| ✱ Options | | Show or hide channel info |
| Back | Go up one level; exits from the top row | Return to the list |

Live channels play the panel's HLS output (`/live/<user>/<pass>/<id>.m3u8`), because Roku plays HLS natively. Movies use the provider's container extension. Not in 1.0.0: Series, Search, Favorites, the guide (EPG), Multi View, the Android app's US-lineup filtering of Live TV, and a saved catalog cache (every launch reloads the lists). Large lineups can take a while to load on entry-level Roku models. Typed logins use `StandardKeyboardDialog`, so the channel needs Roku OS 10 or later.

## Check, test and package

Use Node.js 18 or newer. From the repository root, run `cd apps/roku`, then:

```sh
npm install --no-package-lock --ignore-scripts
npm run check
npm test
npm run build
```

- `check` validates the manifest, artwork sizes and file layout, then compiles every BrightScript and SceneGraph file with [BrighterScript](https://github.com/rokucommunity/brighterscript), failing on unknown functions, syntax errors and bad component references.
- `test` runs the packaging tests and executes the parsing and login helpers (`Util.brs`, M3U and Xtream grouping, pairing accounts) in the [brs-node](https://github.com/lvcabral/brs-engine) BrightScript interpreter.
- `build` writes `LumaNestTV-1.0.0-roku.zip` and `build.json` (with its SHA-256) to the repository's ignored `output/roku` directory. Pass a folder to `node tools/build.js <folder>` to choose another location.

No Roku device or SDK is needed for these commands. They do not verify layout, remote navigation or playback on a real Roku.

## Sideload on your own Roku

1. On the Roku remote, press **Home ×3, Up ×2, Right, Left, Right, Left, Right** to open the Developer Settings screen. Enable the installer, accept the license and set a web server password. The Roku restarts.
2. Open `http://<roku-ip>` in a browser on the same network. Sign in as `rokudev` with that password.
3. Upload `output/roku/LumaNestTV-1.0.0-roku.zip` and choose **Install with zip**. The channel opens on the TV.

Test pairing, typed logins, channel changes, Back behaviour and playback on the Roku models you plan to support.

## Publish through the Roku Developer Dashboard

The Developer Dashboard needs a **signed package**. That is different from the zip above. Signing keys stay on the Roku and in your own records, never in this repository.

1. Sideload the zip as described above.
2. The first time only: telnet or SSH to the Roku on port 8080 and run `genkey`. Save the printed password and DevID somewhere private. Every later update must be signed with the same key. To reuse that key on another Roku, use the key rekey option in the device's packager.
3. Open `http://<roku-ip>/plugin_package`, enter an app name and version (for example `LumaNestTV/1.0.0`) and the `genkey` password, then choose **Package**. Download the `.pkg` file.
4. At [developer.roku.com](https://developer.roku.com), create a new SDK app (the Dashboard may call it a channel) as public or beta, and fill in the store listing: description, category, screenshots, artwork, privacy policy URL and support contact.
5. Upload the `.pkg` under **Package Upload**, then run **Static Analysis** and fix anything it reports.
6. **Beta channel.** It installs only on the devices you share its link with. It is usable without certification and expires after 120 days.
   **Public channel.** It goes to Roku certification review before it becomes searchable in the Channel Store.

Roku certification covers performance, content and policy. IPTV-style players that play customer-supplied provider playlists often get extra scrutiny under Roku's content policies. Review those policies before submitting a public channel. A beta channel is the dependable route for your own customers in the meantime.

## Layout

| Path | Contents |
| --- | --- |
| `manifest` | Title, version, artwork and FHD resolution |
| `source/main.brs` | Entry point; creates `MainScene` and listens for launch input |
| `components/MainScene.*` | Tabs, category and item lists, Settings, typed logins, player and channel banner |
| `components/PairScreen.*`, `tasks/PairTask.*` | Phone pairing; the QR code is drawn from the server's module rows |
| `components/tasks/CatalogTask.*` | Xtream and M3U loading, parsed off the render thread into ContentNodes |
| `components/common/Util.brs` | Registry, HTTP, server normalisation and stream URL helpers |
| `images/` | Channel posters and splash screens made from the LumaNest logo |
| `tools/`, `tests/` | Validation, packaging and tests (not packaged) |

# Tuner for Roku

This is the Roku app in the LumaNest TV monorepo. It is a SceneGraph app with the channel ID still to be assigned by the Roku Developer Dashboard. It pairs with a phone through `lumanest.tv/pair`, then shows Live TV, Movies, Series and Settings in three columns: section, category and item.

- **Pairing:** the first screen shows a QR code and an 8-letter code from `https://lumanest.tv/api/pair/` (device `roku`). The customer approves it on their phone, and the TV saves the line in its registry. **Settings → Pair again** forgets it.
- **Playback:** Xtream lines play live channels as HLS (`/live/…/<id>.m3u8`), movies and episodes from `/movie/` and `/series/`. An M3U line is supported too, with Live TV and whatever movies or episodes its links point to.
- **Settings:**
  - **Channels:** *All* shows every category on the line, as chosen in the customer hub. *USA only* keeps categories labelled US, USA or United States, or named after a US sports league.
  - **Category order:** Featured (Sports, Premium and News first), the customer hub's order, or A to Z.
  - **Subtitles:** *Off* or *On*, saved on the TV. When on, the app turns on Roku captions for the video (`globalCaptionMode`) and picks the subtitle track in the language chosen last time, then English, then the first track. Live channels usually carry broadcast CEA-608 captions, which Roku draws itself.
  - **Adult content:** *Locked* by default. Categories named XXX, Adult, Adults, 18+ or Porn (but not Adult Swim), and anything the Xtream server flags `is_adult`, are hidden in Live TV, Movies and Series. Unlocking asks for a 4-digit passcode; the first time, you create and confirm one. Five wrong tries mean a 60-second wait. Locking needs no passcode, and the app locks again each time it opens. **Change passcode** asks for the current one first. Only a salted SHA-256 hash of the passcode is stored. **Forgot the passcode?** Remove the app from the Roku and reinstall it. Roku deletes an app's saved data when it is removed, so the passcode is cleared and you pair again.
  - **Refresh library** and **Pair again.**
- **Subtitles while watching:** press **\*** (Options) to choose *Off* or a subtitle track by language. When a stream has no subtitle tracks, the menu says so and still offers broadcast captions (CC). **Back** closes the menu.
- **First load:** the app reads the whole catalogue once at start-up. A large line can take a minute or two, and the status line says so.

## Check and package

Use Node.js 18 or newer. From the repository root, run `cd apps/roku`, then:

```powershell
npm install --no-package-lock
npm run check
npm run build
```

`check` compiles every BrightScript and SceneGraph file with BrighterScript and fails on errors. `build` writes the sideload package to the ignored `output/roku/tuner-roku.zip`.

## Install on your Roku for testing

1. Turn on Developer Mode: on the Roku remote press **Home ×3, Up ×2, Right, Left, Right, Left, Right**, accept the agreement and set a developer password. Keep the password private.
2. Open the address the Roku shows, for example `http://192.168.1.50`, in a browser on the same network and sign in as `rokudev` with that password.
3. Upload `tuner-roku.zip` and choose **Install**. The app opens on the TV.

A sideloaded app stays installed until another one replaces it. Only one developer app can be installed at a time.

## Publish

Create the app in the Roku Developer Dashboard, upload the same zip as a package and complete the store listing. See `docs/store-listings.md`. Roku certification tests the pairing flow, playback and the Back button on every screen.

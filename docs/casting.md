# Casting from the web player

The web player at `lumanest.tv/watch` can send a channel to a TV. This page explains how that works, what the owner has to set up once, and which TVs it covers.

## Why LumaNest has its own Cast receiver

LumaNest TV's provider serves live channels only as raw MPEG-TS, even when HLS (`.m3u8`) is requested. Phones and browsers play that stream with mpegts.js. Google's Default Media Receiver, Apple TV and AirPlay TVs can't play raw MPEG-TS, so casting to them showed a black screen.

LumaNest therefore registers its own Google Cast receiver. It's a web page that Chromecast, Google TV and TVs with Chromecast built-in load when a customer casts:

- **Page:** `site/public/cast/receiver.html` and `site/public/cast/receiver.js`, served at `https://lumanest.tv/cast/receiver`.
- **Player:** it plays the channel's raw MPEG-TS with mpegts.js (`site/public/cast/mpegts.js`, a copy of `node_modules/mpegts.js/dist/mpegts.js`). Google's receiver framework still handles loading, pause, stop and status, so the phone's Cast controls keep working.

## What happens when a customer casts

1. In the web player, the customer taps **Cast to TV** and picks a TV.
2. The phone asks the site for a cast link: `POST /api/player/cast` with `receiver: 'lumanest'`.
3. For a live channel the site returns `/api/cast/live.ts?t=…`:
   - The token is sealed, cookie-free and expires within 4 hours.
   - Signing out of the web player stops it.
4. Before handing the link to the TV, the phone stops its own playback. The provider line then has only one connection: the TV's.
5. The TV loads the receiver page, which plays the link.

Movies and series, and any channel the provider serves as HLS, still use HLS links. The receiver plays those with Google's built-in player.

## Owner setup

**Done:**
- Google Cast SDK Developer Console account created.
- Custom Receiver app **LumaNest TV** registered, app ID `94EC7AD6`.

**To do:**

1. **Receiver URL.** In the console, open the app and set **Receiver Application URL** to exactly `https://lumanest.tv/cast/receiver`, with no `.html`. Cloudflare redirects `/cast/receiver.html` to `/cast/receiver`, and the registered address must not redirect.
2. **Deploy.** Deploy the site as usual (see [`deployment.md`](deployment.md)). Then open `https://lumanest.tv/cast/receiver` in a browser to confirm it loads. It shows the LumaNest logo and "Ready to cast" (it only plays inside a Cast device).
3. **Test before publishing (optional but recommended).** An unpublished app only runs on registered devices.
   - **Registering a device:** in the console, choose **Add New Device**. Enter the device's serial number, wait about 15 minutes, then unplug and replug the device.
   - **Chromecast or Vizio:** the serial is on the device or in the Google Home app.
   - **onn 4K and other Google TV boxes:** use the Cast serial under Settings → System → About → Status, or Device Preferences → Google Cast.
   - **Testing the app ID on the site:** set `CAST_RECEIVER_APP_ID` as in step 5, deploy, and cast to a registered device. Customers' TVs won't run the app until it is published, so don't leave this set while unpublished.
4. **Publish.** In the console, fill in the listing:
   - Sender details: website `https://lumanest.tv`.
   - Category.
   - A title of up to 50 characters, for example "LumaNest TV".
   - A description of up to 80 characters.
   - A 512×512 icon: [`docs/store/icon-512.png`](store/icon-512.png).

   Then choose **Publish**. Google lists no review step. Allow up to an hour for devices to pick it up.
5. **Switch the site to the receiver.** In the Cloudflare dashboard, open Workers & Pages → `lumanest-tv` → Settings → Variables and Secrets. Add `CAST_RECEIVER_APP_ID` = `94EC7AD6`. Deploys use `--keep-vars`, so the variable survives later deploys. Then redeploy or wait for the next deploy.

   Without the variable, the site uses Google's Default Media Receiver. That receiver can't play this provider's live channels, so **Cast to TV** is hidden on them; it still shows for movies, series and any HLS channel. Removing the variable is the rollback.
6. **Security challenges.** Make sure no Cloudflare WAF, Bot Fight Mode, Under Attack or Access rule challenges `lumanest.tv/cast/*` or `lumanest.tv/api/cast/*`. A TV cannot pass a challenge.

## What each TV supports

| Device | Casting from the web player | Best option |
| --- | --- | --- |
| Chromecast, Chromecast with Google TV, onn 4K and other Google TV boxes | Yes, through the LumaNest receiver once it is published and `CAST_RECEIVER_APP_ID` is set | Casting, or the Tuner Android app on Google TV |
| TVs with Chromecast built-in (Vizio, Sony, TCL, Hisense, Philips) | Yes, as above. Older Vizio models (2016–2020) need their 2025 firmware update | Casting |
| Apple TV, AirPlay 2 TVs (Samsung, LG, Vizio, Roku) | No for live channels: AirPlay needs HLS and the provider sends raw MPEG-TS. The AirPlay button is hidden on those channels | The Tuner app for that TV |
| Samsung TVs without Chromecast (for example the M70D) | No Google Cast | The Tuner Samsung app |
| Roku | No Google Cast | The Tuner Roku app |

## Limits to know about

- **Audio:**
  - Channels with MP2 (MPEG-1 Layer II) audio may be silent on Cast devices.
  - AC-3 and E-AC-3 audio depend on the TV or sound system supporting passthrough.
- **Older hardware:** 1st and 2nd-generation Chromecasts decode H.264 up to 1080p30. 1080p50/60 channels may not play on them.
- **Cast link expiry:** a cast link expires after 4 hours, and signing out of the web player ends a cast within about a minute. The TV then shows "Cast this channel again".
- **Pausing a live channel:** 5 seconds after a pause, the TV closes its connection to the provider. This frees the line and avoids overflowing the Cast device's small video buffer. The picture goes dark with a "Paused" label, and Play resumes at the live point.
- **Switching channels while casting:** pick a channel in the web player while casting and it goes to the TV; the phone doesn't start playing it too. After **Stop casting**, the phone offers **Play <channel> here**.
- **Receiver framework changes:** the receiver steers playback through Google's receiver framework in a way Google does not document. If an update to that framework stops it working, the TV shows an error instead of a black screen. Retest casting after Google releases framework updates.

## Debugging

- **Inspecting the receiver:** with the app registered and a registered test device on the same network as a computer, open `chrome://inspect` in Chrome on the computer. The receiver is listed there with its console. You can also open `http://<device-ip>:9222`.
- **Server logs:** run `npx wrangler tail` in `site`. It shows `lumanest_cast_failed` lines for cast requests the server rejected, with the path and error code only.
- **Provider check:** `https://lumanest.tv/api/player/diagnostics?profile=cast&index=0` (owner only) shows what the provider returns for a channel's HLS request. If it ever returns real HLS, AirPlay can use it too.

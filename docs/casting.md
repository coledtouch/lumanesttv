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

Setup is complete. Casting was confirmed on October 16, 2026 on an onn 4K Google TV box and a Vizio TV with Chromecast built-in.

- **Google Cast app:** Custom Receiver **LumaNest TV**, app ID `94EC7AD6`, **published**. Its Receiver Application URL is `https://lumanest.tv/cast/receiver`, with no `.html`: Cloudflare redirects `/cast/receiver.html` to that address, and the registered one must not redirect. Its sender is the Chrome website `https://lumanest.tv/watch`, and Guest Mode is off.
- **Site setting:** `CAST_RECEIVER_APP_ID` = `94EC7AD6` on the `lumanest-tv` Worker (Workers & Pages → `lumanest-tv` → Settings → Variables and Secrets). Deploys use `--keep-vars`, so it survives them. Removing the variable is the rollback: the site then uses Google's Default Media Receiver, which can't play this provider's live channels, so **Cast to TV** is hidden on them. It still shows for movies, series and any HLS channel.
- **Updating the receiver:** deploy the site as usual (see [`deployment.md`](deployment.md)). Cast devices load the current receiver page every time a cast starts, so there's nothing to resubmit to Google.
- **Test devices:** the onn 4K box is registered in the console (Cast serial from Settings → System → About). A published app doesn't need registered devices. Registration is only needed to inspect a receiver with `chrome://inspect` (see Debugging).
- **Security challenges:** no Cloudflare WAF, Bot Fight Mode, Under Attack or Access rule may challenge `lumanest.tv/cast/*` or `lumanest.tv/api/cast/*`. A TV can't pass a challenge.

## What each TV supports

| Device | Casting from the web player | Best option |
| --- | --- | --- |
| Chromecast, Chromecast with Google TV, onn 4K and other Google TV boxes | Yes, through the LumaNest receiver (confirmed on an onn 4K box) | Casting, or the Tuner Android app on Google TV |
| TVs with Chromecast built-in (Vizio, Sony, TCL, Hisense, Philips) | Yes, as above (confirmed on a Vizio). Older Vizio models (2016–2020) need their 2025 firmware update | Casting |
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
- **A few seconds behind live:** the receiver keeps about 4–5 seconds of video buffered, at the start and after any stall, so short provider delays don't show. Casting therefore runs a few seconds behind the channel, and the first picture takes a moment longer than on the phone.
- **Connection drops:** if the provider connection drops or goes quiet for about 8 seconds, the receiver reconnects in the background and joins the new stream onto the old one. You see no black screen, at most a short "Buffering…".
- **Switching channels while casting:** pick a channel in the web player while casting and it goes to the TV; the phone doesn't start playing it too. After **Stop casting**, the phone offers **Play <channel> here**.
- **Receiver framework changes:** the receiver steers playback through Google's receiver framework in a way Google does not document. If an update to that framework stops it working, the TV shows an error instead of a black screen. Retest casting after Google releases framework updates.

## Debugging

- **Inspecting the receiver:** with the app registered and a registered test device on the same network as a computer, open `chrome://inspect` in Chrome on the computer. The receiver is listed there with its console. You can also open `http://<device-ip>:9222`.
- **Server logs:** run `npx wrangler tail` in `site`. It shows `lumanest_cast_failed` lines for cast requests the server rejected, with the path and error code only.
- **Provider check:** `https://lumanest.tv/api/player/diagnostics?profile=cast&index=0` (owner only) shows what the provider returns for a channel's HLS request. If it ever returns real HLS, AirPlay can use it too.

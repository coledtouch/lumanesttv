# Tuner mod app for r/TunerTVapp

A Reddit [Devvit](https://developers.reddit.com) app (Devvit Web, app name `tunertv`) that moderates r/TunerTVapp. It started from Reddit's "Mod Tool Full" template (BSD-3-Clause, see [`LICENSE`](LICENSE)).

## What it does

All features are on by default and can be switched off, and their wording and lists changed, under the subreddit's **Mod Tools → Installed apps → tunertv → Settings**. Moderators' own posts and comments are never touched.

1. **Help replies.** A new post with a help flair (`Help`, `Support` or `Setup` by default), or a help word in its title or text ("not working", "buffering", "can't log in" and so on), gets one pinned reply. The reply links lumanest.tv/apps, lumanest.tv/pair, tunertv.app/support and support@tunertv.app, and lists the current Tuner version for every TV.
2. **Device flair reminder.** A post without a flair gets a reminder to add the TV (Android TV, Fire TV, LG, Samsung, Roku or Apple TV), in the same pinned reply.
3. **Private information filter.** Posts and comments with a playlist link (`.m3u`, `.m3u8`, `get.php?username=` and similar), a stream address with a login in its path (`/live/USER/PASS/123.ts`), a username and password together, or a MAC address are removed. The author gets a modmail explaining why, without repeating what they posted.
4. **`!version`.** A comment that starts with `!version` gets a reply with the current version for every TV.

The versions come from the app settings (Android 1.8.3, LG 1.2.1, Samsung 1.6.1, Roku 1.1.0, Apple TV "Coming soon to the App Store" by default). Update them there after each release; no new upload is needed.

For the flair reminder to be more than a nudge, also create the device flairs and turn on Reddit's own "require post flair" option in Mod Tools (under Post flair or Post requirements).

## Develop and publish

Devvit signs in to the developer's Reddit account, so these run on the developer's computer, not in CI or a cloud session. Node.js 24 is required.

```sh
cd apps/reddit
npm install
npx devvit login     # once, opens reddit.com in the browser
npm run dev          # playtest on the developer's test subreddit
npm run deploy       # checks, then uploads a new version
npx devvit install r/TunerTVapp
```

`npm test` runs the type check, lint, unit tests (`src/**/*.test.ts`) and the build without signing in.

## Layout

| Path | Contents |
| --- | --- |
| `devvit.json` | App name, triggers, settings and permissions |
| `src/index.ts`, `src/routes/triggers.ts` | Server entry and the trigger endpoints |
| `src/features/triggers.ts` | What happens on a new post or comment |
| `src/features/detect.ts` | Help post, `!version` and private information checks (pure, tested) |
| `src/features/messages.ts` | Every reply and modmail text (pure, tested) |
| `src/features/config.ts` | Settings with their defaults |
| `src/lib/reddit.ts` | Moderator check and one-time claims, so a retried trigger never replies twice |

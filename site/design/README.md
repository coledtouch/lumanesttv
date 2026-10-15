# Design sources

- `og-image.html` is the source for `public/og-image.png`, the 1200×630 link-preview image. Open it in Chromium at a 1200×630 viewport and screenshot it to regenerate the PNG after a copy or price change.
- `hero-art.html` is the source for the homepage hero illustration, the same art as the share image without text. Screenshot its `.art` element at device scale 2 with a transparent background to `public/hero-art.png`, then encode `public/hero-art.webp` (quality 88) from it.
- `app-icons.html` is the source for the app icons. Screenshot `.icon` (512×512, transparent background) and resize it to the Android `mipmap-*/ic_launcher.png` sizes (48, 72, 96, 144, 192) and to the 114×114 `assets/icon.png` in `apps/tizen` and `apps/webos`. Screenshot `.banner` (640×360) to `apps/android/app/src/main/res/drawable-xhdpi/banner.png`, the Android TV / Google TV launcher banner.

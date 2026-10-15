# Third-party notices

Retain the license notices bundled with source, dependencies and release packages.

The website includes the original MIT notice in `site/build/sites-vite-plugin.LICENSE`. Package dependencies and exact resolved versions are recorded in `site/package-lock.json`.

The website self-hosts the DM Sans (Copyright 2014 The DM Sans Project Authors) and Manrope (Copyright 2018 The Manrope Project Authors) typefaces in `site/public/fonts/`. Both are licensed under the SIL Open Font License, Version 1.1; the full license texts are in `site/public/fonts/DM-Sans-OFL.txt` and `site/public/fonts/Manrope-OFL.txt` and must accompany the font files.

The Android build uses Kotlin, AndroidX, Compose, Media3, OkHttp, Coil and jlibtorrent, among other dependencies. Exact versions are declared in the Gradle build. The Gradle wrapper includes its original notices in its JAR. FrostWire jlibtorrent is distributed under the [MIT license](https://github.com/frostwire/frostwire-jlibtorrent/blob/master/LICENSE.md); preserve its license when packaging its native libraries.

The TV web applications use hls.js and platform APIs. Preserve upstream notices and comply with the licenses of the versions bundled or loaded by each build.

This file is an index, not a replacement for the original licenses or a project-wide license grant. Review all transitive dependency notices when preparing a new distribution.

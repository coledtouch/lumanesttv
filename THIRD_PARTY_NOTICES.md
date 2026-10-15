# Third-party notices

Retain the license notices bundled with source, dependencies and release packages.

The website includes the original MIT notices in `site/build/sites-vite-plugin.LICENSE` and `site/vendor/shadcn-tailwind-4.13.0.LICENSE.md`. Package dependencies and exact resolved versions are recorded in `site/package-lock.json`.

The Android build uses Kotlin, AndroidX, Compose, Media3, OkHttp, Coil and jlibtorrent, among other dependencies. Exact versions are declared in the Gradle build. The Gradle wrapper includes its original notices in its JAR. FrostWire jlibtorrent is distributed under the [MIT license](https://github.com/frostwire/frostwire-jlibtorrent/blob/master/LICENSE.md); preserve its license when packaging its native libraries.

The TV web applications use hls.js and platform APIs. Preserve upstream notices and comply with the licenses of the versions bundled or loaded by each build.

This file is an index, not a replacement for the original licenses or a project-wide license grant. Review all transitive dependency notices when preparing a new distribution.

# LumaNest TV

Website, checkout, owner tools, web player, and TV applications for [LumaNest TV](https://lumanest.tv).

| Directory | Contents |
| --- | --- |
| [`site/`](site/) | React/Vinext website, server APIs, PayPal checkout and renewals, owner sign-in, web player, PWA assets, D1 schema and tests |
| [`site/cloudflare/`](site/cloudflare/) | Portal PWA support and authenticated stream relay Workers |
| [`apps/android/`](apps/android/) | Tuner 1.6.0 for Android TV and Google TV, Kotlin/Compose/Media3, including source and tests |
| [`apps/tizen/`](apps/tizen/) | Tuner 1.4.8 for Samsung TVs, source, tests and packaging tools |
| [`apps/webos/`](apps/webos/) | Tuner 1.0.1 for LG webOS TVs |
| [`releases/`](releases/) | Installer versions, checksums and release information |
| [`.github/workflows/`](.github/workflows/) | Website and TV app build checks |

Start with the README in the relevant directory. The website uses Node.js 24 and npm. Android requires JDK 17 and Android SDK 35. Samsung and LG packaging need their platform tools; release signing material stays outside the repository.

## Services and hosting

The website is a server application with Cloudflare Workers, D1 and R2 dependencies. GitHub stores its source and runs checks; the existing production deployment remains live. GitHub Pages cannot run this backend.

The customer hub and channel selector at `portal.lumanest.tv` and `tv.lumanest.tv` are supplied by the connected white-label TV provider. This repository includes the LumaNest integration and PWA overlay; the provider maintains its own portal code and infrastructure.

See [architecture and deployment](docs/deployment.md) for service boundaries and deployment requirements. Runtime secrets, customer records, payment agreements and private app signing keys are deliberately excluded from Git.

## App downloads

Installers are distributed through [LumaNest apps](https://lumanest.tv/apps) and the repository's [Releases page](https://github.com/coledtouch/lumanesttv/releases). The Android APK is kept as a release asset to avoid storing large generated binaries in source history. The current LG installer is also retained in the website's public downloads directory.

The Samsung widget included for development is unsigned. Samsung installation requires a valid business signing certificate and supported TV setup.

## Source and attribution

This is a clean source snapshot with a new repository history. It does not include previous repositories, local workstation state, runtime databases or private signing material. No project-wide open-source license is granted here. Existing third-party licenses remain in place; see [third-party notices](THIRD_PARTY_NOTICES.md).

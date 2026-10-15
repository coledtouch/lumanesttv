# LumaNest TV

Website, checkout, owner tools, web player, and TV applications for [LumaNest TV](https://lumanest.tv).

| Directory | Contents |
| --- | --- |
| [`site/`](site/) | React/Vinext website, server APIs, PayPal checkout and renewals, owner sign-in, web player, PWA assets, D1 schema and tests |
| [`site/cloudflare/`](site/cloudflare/) | Portal PWA support and authenticated stream relay Workers |
| [`apps/android/`](apps/android/) | Android TV and Google TV development source, Kotlin/Compose/Media3, including tests; approved download remains 1.5.3 |
| [`apps/tizen/`](apps/tizen/) | Tuner 1.4.9 for Samsung TVs, source, tests and packaging tools |
| [`apps/webos/`](apps/webos/) | Tuner 1.0.2 for LG webOS TVs |
| [`releases/`](releases/) | Installer versions, checksums and release information |
| [`.github/workflows/`](.github/workflows/) | Website and TV app build checks, nightly Android emulator tests and tag-driven draft releases |

Start with the README in the relevant directory. The website uses Node.js 24 and npm. Android requires JDK 17 and Android SDK 35. Samsung and LG packaging need their platform tools; release signing material stays outside the repository.

## Services and hosting

Production runs in the LumaNest Cloudflare account: Worker `lumanest-tv`, D1 database `lumanest-tv-production`, and R2 bucket `lumanest-tv-downloads`. The portal PWA overlay and stream relay run in the same account. The October 15, 2026 migration preserved owner/customer access, billing records, service keys and approved app downloads; live renewals, playback and channel switching were verified. The former host's APIs and service keys are retired. See the deployment guide before future production changes.

GitHub preserves the complete first-party website and app source and runs checks. A push does not deploy production automatically. GitHub Pages cannot run this backend.

The customer hub and channel selector at `portal.lumanest.tv` and `tv.lumanest.tv` are supplied by the connected white-label TV provider. This repository includes the LumaNest integration and PWA overlay; the provider maintains its own portal code and infrastructure.

See [architecture and deployment](docs/deployment.md) for service boundaries and deployment requirements. Runtime secrets, customer records, payment agreements and private app signing keys are deliberately excluded from Git.

## App downloads

Installers are distributed through [LumaNest apps](https://lumanest.tv/apps), with archives on the repository's [Releases page](https://github.com/coledtouch/lumanesttv/releases). The approved Android download remains **1.5.3**, served from R2 through `/api/tuner`; historical 1.5.2 is retained as an archive. Android source changes and draft CI artifacts do not replace the approved release. The current LG installer is retained in the website's public downloads directory. Tags such as `android-v1.6.0` build draft releases; see [releases](releases/README.md#cutting-a-release).

The Samsung widget included for development is unsigned. Samsung installation requires a valid business signing certificate and supported TV setup.

## Source and attribution

This is a clean source snapshot with a new repository history. It does not include previous repositories, local workstation state, runtime databases or private signing material. No project-wide open-source license is granted here. Existing third-party licenses remain in place; see [third-party notices](THIRD_PARTY_NOTICES.md).

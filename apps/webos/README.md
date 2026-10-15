# Tuner for LG webOS TV

This directory contains the LG webOS application source for Tuner 1.0.1, application ID `tv.lumanest.tuner`. It is separate from the Android app and Samsung Tizen widget. Provider accounts are entered on the device and are stored locally. Do not put provider exports, saved preferences, TV connection details, or private keys in this directory.

The app uses packaged ES5 JavaScript, HTML, CSS and the TV's HTML video player. `js/webos-platform.js` selects that player instead of Samsung AVPlay and disables the Samsung dual-player entry point. Native Android Picture-in-Picture and the Android torrent engine are not included. Supported streams and codecs depend on the TV model and webOS version; desktop checks do not establish physical-TV playback compatibility.

## Validate and prepare clean staging

Use Node.js 18 or newer. From the repository root, run `cd apps/webos`, then:

```powershell
npm install --no-package-lock --ignore-scripts
npm run check
npm test
npm run build
```

No external TV SDK or connection is needed for these commands. Validation checks the application identity, required assets, ES5 syntax, local script loading order, and content security policy. The build copies exactly eight runtime files to a fresh staging folder under the repository's ignored `output/webos` directory. Source tools, tests, dependencies, and account files do not enter that staging folder. To choose another output location, use `node tools/build.js <output-folder>`.

`npm run build` prepares source staging; it does not create or sign an IPK, install an SDK, connect to a TV, or install the app. The generated `build.json` contains the staging location and belongs in ignored output, not Git.

## Create a development IPK

Install the official [webOS CLI](https://webostv.developer.lge.com/develop/tools/cli-introduction) separately. The [LG CLI developer guide](https://webostv.developer.lge.com/develop/tools/cli-dev-guide) documents `ares-package` and its `-o` and `--no-minify` options. From this directory, after building:

```powershell
$build = Get-Content ../../output/webos/build.json -Raw | ConvertFrom-Json
ares-package --no-minify -o ../../output/webos $build.staging
```

The expected package name is `tv.lumanest.tuner_1.0.1_all.ipk`. Package the clean staging folder, rather than this development directory, so private files and tooling stay excluded. `--no-minify` preserves the validated runtime files for development and debugging. LG's packager generates the package metadata from `appinfo.json`; no Samsung author/distributor certificate is used by this webOS workflow.

This is a development IPK, not a store-approved or production-signed release. To test on your own TV, follow LG's [Developer Mode setup](https://webostv.developer.lge.com/develop/getting-started/developer-mode-app). Register the TV through the CLI, keep its Developer Mode session active, and use the chosen device name in the official installation and launch commands:

```powershell
ares-install --device myTV ../../output/webos/tv.lumanest.tuner_1.0.1_all.ipk
ares-launch --device myTV tv.lumanest.tuner
```

`myTV` is a placeholder for a device registered privately on your machine. Keep TV SSH keys and connection configuration outside this repository. Packaging does not grant device access, enable Developer Mode, or establish LG Content Store distribution. Validate installation, remote controls, login, channel changes, audio, and playback on the target TV before distributing a new package.

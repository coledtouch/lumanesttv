# App releases

The initial source migration includes these existing installers as GitHub Release assets:

| Installer | Version | Purpose |
| --- | --- | --- |
| `Tuner-1.5.3.apk` | 1.5.3, Android version code 14 | Signed Android TV / Google TV app |
| `Tuner-1.4.8-tizen-UNSIGNED.wgt` | 1.4.8 | Samsung development widget; requires signing before TV installation |
| `tv.lumanest.tuner_1.0.1_all.ipk` | 1.0.1 | LG webOS development installer |

[`SHA256SUMS`](SHA256SUMS) records the original installer checksums. GitHub also generates a source archive for each tagged release; it contains the website and all three app source trees.

Keep private keys, certificates and signing profiles outside the repository. Android updates must keep the existing application ID and release signing key. Unsigned Samsung packages are not ready to install on a television.

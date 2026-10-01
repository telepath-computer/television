*The ToDesktop build of the desktop app: the private workspace, the ToDesktop configuration and build target, the upload directory, the build script, candidate and test builds, desktop releases, and the download link.*

# ToDesktop build

The desktop app that users install is built, signed and notarized by ToDesktop from Television's own bundled code. This spec says what Television sends to ToDesktop, which settings fix the app's identity and version, how maintainers make and release builds, and where users download the result.

## What this owns

This module owns the desktop workspace's package status, the ToDesktop configuration committed in `packages/desktop` and the build target chosen in the ToDesktop dashboard, the upload directory, the build script, candidate and test builds, the two build workflows and dashboard release, the update runtime as a dependency, and the download link. Electron's version is [runtime.md](./runtime.md)'s, the main-process identity rules are the [desktop root's](./index.md#main-process-identity), the runtime's start is [desktop updates'](./updates.md), and license files and notices are [licensing architecture's](../licensing.md). The user-visible installation and identity promises are [product/desktop-app.md](../../product/desktop-app.md)'s, and the app's update behavior is [product/update-notifications.md](../../product/update-notifications.md#^desktop-self-update)'s.

Development runs and the desktop tests start Electron on `packages/desktop` directly under [runtime.md](./runtime.md) and [e2e-harness.md](./e2e-harness.md); they do not use the ToDesktop build.

## The desktop workspace

`packages/desktop` is a private workspace: its manifest sets `"private": true` and declares no `bin`, `files` or `engines`, so npm refuses to publish it. It carries the Television release version like every workspace ([arch/updates/index.md](../updates/index.md)). Its `dependencies` list exactly the packages the ToDesktop build installs into the app, each at an exact version. Electron is a development dependency under [runtime.md](./runtime.md#^desktop-runtime-version).

## Configuration

The ToDesktop configuration sets these values. `packages/desktop/todesktop.json` holds the fixed ones. The build script adds `buildVersion` and `nodeVersion` to the copy it writes into the upload directory, taking them from the workspace manifest and `.nvmrc`, so both follow the repository with nothing else to edit: ^desktop-dist-config

| Setting                | Value                             | What relies on it                                                                                                                                                                                                                                                                                    |
| ---------------------- | --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `schemaVersion`        | `1`                               | The version of the configuration format. ToDesktop's CLI rejects a configuration without it.                                                                                                                                                                                                         |
| `id`                   | Television's ToDesktop app ID     | Ties builds to Television's app in the ToDesktop dashboard and forms the [download link](#^desktop-dist-links).                                                                                                                                                                                      |
| `appId`                | `computer.telepath.television`    | The Mac bundle identifier, the one npm-installed apps also used. ToDesktop asks customers to contact it before changing this value after a release.                                                                                                                                                  |
| `productName`          | `Television`                      | The application name in Finder, the Dock and the application menu, and the bundle name `Television.app` ([product identity](../../product/desktop-app.md#^desktop-product-identity)).                                                                                                                |
| `icon`                 | `assets/icon.icns`                | The application icon.                                                                                                                                                                                                                                                                                |
| `buildVersion`         | the release version               | The bundle's build version, so the app carries one version with no separate build number ([metadata scope](../../product/versioning.md#^pv-os-metadata-scope)).                                                                                                                                      |
| `nodeVersion`          | the Node version `.nvmrc` selects | The Node version ToDesktop installs dependencies with, under the [repository toolchain](../node-versions.md).                                                                                                                                                                                        |
| `appBuilderLibVersion` | `26.16.1`                         | The electron-builder release that packages the app. It is the first release that places Electron's license files inside the Mac app, which [licensing](../../product/licensing.md#^licensing-electron-aggregate) requires.                                                                           |
| `fuses.runAsNode`      | `false`                           | The built app ignores `ELECTRON_RUN_AS_NODE`, so the variable cannot turn it into a plain Node.js process ([below](#^desktop-dist-run-as-node)).                                                                                                                                                     |

`ELECTRON_RUN_AS_NODE` is an environment variable that makes Electron run as a plain Node.js process, which opens no window. Electron obeys it unless the `runAsNode` fuse in its executable is off. Fuses are fixed when the app is packaged, and this configuration has ToDesktop turn that one off. [Electron's security checklist](https://www.electronjs.org/docs/latest/tutorial/security#19-check-which-fuses-you-can-change) recommends turning it off: with the variable set, another program can run its own code through the app, with rights the app has and that program may lack. With the fuse off, `child_process.fork` throws in the built app. Development runs and the desktop tests use unmodified Electron, in which it works. ^desktop-dist-run-as-node

The app uses ToDesktop's default hardened-runtime entitlements. A feature that needs a macOS permission the default file lacks adds a `mac.entitlements` file to this configuration.

**Build target.** The app's build settings in the ToDesktop dashboard select one target, the Apple Silicon DMG, because the app supports only Apple Silicon Macs ([product support](../../product/desktop-app.md#^desktop-product-support)). ^desktop-dist-targets

## The upload directory

The *upload directory* is what the build script sends to ToDesktop. It is generated for each build and never committed, and it contains: ^desktop-dist-upload

- `dist/` and `assets/` from `packages/desktop`, with the main-process bundle `dist/electron.cjs` named `dist/electron.js`, and the repository's `LICENSE`;
- a generated `package.json` with the release version from the workspace manifest, `main: dist/electron.js`, a `homepage`, an `author` with an email address, the workspace's `dependencies` at their exact versions, and `electron` at the [exact runtime version](./runtime.md#^desktop-runtime-version) under `devDependencies`, where ToDesktop reads it. It has no `type` field, so Node loads `dist/electron.js` as CommonJS, the format the bundle is built in;
- a `package-lock.json` generated for that manifest, so ToDesktop installs the dependency versions Television resolved;
- the ToDesktop configuration.

The desktop build gives its CommonJS bundle files the `.cjs` extension because the workspace manifest declares `"type": "module"`. ToDesktop's CLI refuses an upload that has no file ending in `.js` or `.ts`, which is why the upload directory holds the main-process bundle as `dist/electron.js`.

ToDesktop installs the dependencies, packages the app with Electron, signs and notarizes it, and produces the installers on its own servers. Nothing else from the repository reaches it: `dist/` already bundles every workspace package the app uses, which is why Television uploads built output rather than source.

## The build script

One npm script in `packages/desktop` builds the bundle with `build.mjs`, generates the upload directory, and runs `todesktop build` from it. It follows ToDesktop's build log and exits with a nonzero status when the build fails. It runs after the release version is set, in the order the release pipeline uses ([arch/updates/index.md](../updates/index.md#^updates-publication-order)), so the version the app reports is the version in the workspace manifest. `@todesktop/cli` is a development dependency of the workspace at an exact version. The CLI's terminal interface needs React 17, and Storybook installs React 19 at the repository root, so the repository installs the CLI with its own copy of React 17. With React 19, the CLI crashes as it loads.

**Candidate builds.** A *candidate build* is a signed build of one exact commit, made so that its code can be tested before it reaches `main`. It stays unreleased, so no user receives it, and the product spec's [real-host checks](../../product/desktop-app.md#^desktop-checks-before-main) say when one is tested. The **Build desktop candidate** GitHub Actions workflow makes it: a maintainer starts it by hand with the commit's full SHA, and it runs the build script on that commit. It builds only a commit that a branch of this repository contains, and it only builds: releasing takes the dashboard step under [Releases](#releases), and it publishes nothing to npm. The build carries the commit's version unless the maintainer gives the workflow another version for that build alone, which is never committed. It downloads from its page in the ToDesktop dashboard, as the DMG and as the Mac zip that ToDesktop builds beside it. GitHub offers a workflow started by hand only when its file is on the default branch, so the workflow stays on `main`. ^desktop-dist-candidate-builds

**Test builds.** A developer with build access can instead run the build script from their own checkout, signed in to their own ToDesktop account. A test build carries the version in the developer's checkout and stays unreleased, like a candidate build. `--code-sign=false` skips signing and notarization for a faster build, which the real-host checks cannot use. ^desktop-dist-test-builds

**Dry runs.** With `--dry-run`, the script runs ToDesktop's dry run in place of a build. The CLI checks the configuration and the generated manifest against its rules and packs the upload directory as it would for a build, but it signs in to nothing and uploads nothing, so the dry run needs no ToDesktop account. The script leaves out the option that follows the build log, which the CLI does not accept with `--dry-run`.

**Workflow access.** Both GitHub desktop build jobs run only in `telepath-computer/television`; other repositories, including forks, skip them before checking out code or accessing company credentials. External actions in these jobs are pinned to full commit SHAs. Outside these workflows, `npm run build:desktop` bundles the app without ToDesktop credentials. ^desktop-dist-workflow-origin

## Releases

A maintainer releases the desktop app when a desktop change is worth shipping, such as a fix or feature in `packages/desktop`, an Electron upgrade, or a release that raises the [required desktop version](../updates/desktop-upgrade-gate.md#^ops-bump). Other Television releases get no desktop build or release. ^desktop-dist-release

- **Tested before `main`.** Each change to the app's behavior that a release carries passed its checks on a candidate build before it reached `main` ([the product rule](../../product/desktop-app.md#^desktop-checks-before-main)).
- **Build.** Every desktop release is built by a GitHub Actions workflow, started by hand, which runs the build script on the commit at the tip of `main`. A maintainer starts it when that commit carries the Television release the desktop release is made from. Usually that is the most recent published release, with nothing merged since its publish. For a release that raises the required desktop version, [the gate's operations](../updates/desktop-upgrade-gate.md#^ops-bump) say which commit and when. The build therefore contains exactly that release's code and carries its version ([versioning](../../product/versioning.md#^pv-desktop-release-version)).
- **Release.** The maintainer releases the build from the ToDesktop dashboard as a full release. Before releasing, ToDesktop checks that the build succeeded, that its version differs from the latest release's and that the signing certificates are valid, and it runs smoke tests that launch the app and update to and from it. The smoke tests need the app to open without waiting for user input. The maintainer confirms the release with a tap of their security key. Releasing makes the build the one the [download link](#^desktop-dist-links) serves and the update that installed apps download.

The app's **Allow releases without a security token** setting in the ToDesktop dashboard stays off. The setting governs only that last step, releasing a completed build, and not whether a build can be made: the build workflows start builds with the CLI access token under [Setup](#setup) whether the setting is on or off. With the setting off, only a maintainer's security-key confirmation in the dashboard releases a build. With it on, a CLI or API call authenticated as a team member could release a completed build without that confirmation. Turning it on would not make successful builds release automatically; each release would still be an explicit call.

A desktop release reaches every running downloaded app at its next update check ([desktop app updates](../../product/update-notifications.md#^desktop-self-update)), whatever release its server runs. A desktop change therefore keeps working with servers older than the release that ships it.

For its checks, the pull request that moves the desktop app to ToDesktop released two builds in Television's own app, 1.4.0 and 1.4.1, before any published guide gave the [download link](#^desktop-dist-links). An app that installed the 1.4.1 build would treat a lower version as a downgrade, so the first desktop release for users, and the Television release it is built from ([versioning](../../product/versioning.md#^pv-desktop-release-version)), carry a version above 1.4.1. ^desktop-dist-first-release

## Updates

The update runtime, `@todesktop/runtime`, is one of the workspace's `dependencies`, which ToDesktop installs into the app. How the main process starts it, and what the app does with a downloaded update, is [desktop updates](./updates.md)'s. ^desktop-dist-updates

## Download link

ToDesktop hosts the installer. Television publishes one link, `https://dl.todesktop.com/<app id>/mac/dmg/arm64`, for the Apple Silicon DMG, where `<app id>` is the configuration's `id`. ^desktop-dist-links

The link has no version, so it serves the most recently released build. Television hosts no installer files and runs no download domain of its own. The [administrator guide](../cli/admin-guide.md) carries the link.

## Setup

- **Apple.** The app is signed by the Apple Developer Program team of Unternet PBC. The team's Account Holder creates a Developer ID Application certificate, exports it as a password-protected P12 file, and uploads it with its password under **Settings → Certificates** in the ToDesktop dashboard. ToDesktop notarizes the app through the App Store Connect API, with an API key of the same team entered in the dashboard.
- **ToDesktop.** Television's ToDesktop app and subscription belong to a ToDesktop account registered with a company email address. That account creates the app, holds the Apple credentials above, gives developers who make test builds build access, and gives maintainers who release the app release permission. Each maintainer who releases registers a security key, such as a hardware key or a Mac's Touch ID, which ToDesktop calls a *security token*. It is a physical or WebAuthn authenticator, unrelated to the CLI access token below.
- **GitHub Actions.** Two repository secrets, `TODESKTOP_EMAIL` and `TODESKTOP_ACCESS_TOKEN`, hold the owning account's email address and its CLI access token, with which the two build workflows start builds. GitHub holds no Apple credential.

## Operations

A change to `appBuilderLibVersion` can change what reaches the built app, including Electron's license files, so the product spec's [real-host checks](../../product/desktop-app.md#Testing) list it among the changes that need them. An Electron major upgrade follows [runtime operations](./runtime.md#operations).

## Testing

Coverage of the upload directory inspects a directory generated by the real build script. The build script's dry run, with the real CLI, shows that the CLI loads as the script runs it and accepts the upload directory by every rule it applies before an upload. [Desktop updates](./updates.md#testing) owns coverage of the runtime's start. No test calls ToDesktop's service. The ToDesktop build, signing, notarization and the built app's update notice and restart are left to the product spec's [real-host checks](../../product/desktop-app.md#Testing), and installing a real update to ToDesktop's smoke tests before a release.

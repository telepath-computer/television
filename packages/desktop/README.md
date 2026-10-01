# Television desktop app

`packages/desktop` holds the Television desktop app, an Electron client for a Television server. It renders URL artifacts as full embedded pages and gives Television a native application window. Users download it for Apple Silicon Macs from the link in the [administrator guide](../../docs/guides/television-admin-guide.md#desktop-client-recommended-for-url-artifacts), and the installed app updates itself.

The workspace, `@telepath-computer/television-desktop`, is private, so npm never publishes it. ToDesktop builds, signs, notarizes and hosts the app from the bundle this workspace produces, and `@todesktop/runtime` updates installed apps from ToDesktop releases.

## Development

From the repository root, `npm run start:electron` builds the bundle and opens it in Electron; its connect window asks for a server URL and, when the server uses authentication, its token. `npm run build:desktop` builds the bundle into `packages/desktop/dist/` without starting it. The desktop tests run through the [canonical test runner](../../specs/arch/test-runner/test-runner.md).

## ToDesktop builds

This command builds the bundle, generates the upload directory with its ToDesktop configuration, and runs `todesktop build` from that directory, following the build log:

```sh
npm run todesktop-build --workspace @telepath-computer/television-desktop
```

It needs a ToDesktop account with build access to Television's app. The ToDesktop CLI asks for the account's email address and access token, or reads them from `TODESKTOP_EMAIL` and `TODESKTOP_ACCESS_TOKEN`.

For a faster test build without signing and notarization, add `--code-sign=false`:

```sh
npm run todesktop-build --workspace @telepath-computer/television-desktop -- --code-sign=false
```

A test build carries the version in your checkout and stays unreleased, so no user receives it.

To check a change without a ToDesktop account, add `--dry-run`. The ToDesktop CLI then checks the configuration and the generated `package.json` and packs the upload directory as it would for a build, but signs in to nothing and uploads nothing:

```sh
npm run todesktop-build --workspace @telepath-computer/television-desktop -- --dry-run
```

To build one exact commit so that its code can be tested before it reaches `main`, a maintainer runs the **Build desktop candidate** GitHub Actions workflow with the commit's full SHA. A branch of this repository must contain the commit:

```sh
gh workflow run desktop-candidate-build.yml -f commit=<full commit SHA>
```

It makes a signed build that stays unreleased. The build carries the commit's version; adding `-f version=<x.y.z>` gives it another version for that build alone. The run's summary names the commit and version it built, and the build downloads from its page in the ToDesktop dashboard.

Desktop releases come from the **Build desktop app** GitHub Actions workflow, which a maintainer starts by hand to build the tip of `main`. The maintainer then releases the build from the ToDesktop dashboard.

## Real-host checks

[The desktop application spec's Testing section](../../specs/product/desktop-app.md#testing) says which checks a change needs, when they run and what a pull request records. They run on an unreleased build; releasing a build ships it to every installed app.

### The build

Build the code with the **Build desktop candidate** workflow ([above](#todesktop-builds)), or make a signed build in a checkout of it with no local changes, signed in to a ToDesktop account with build access:

```sh
npm ci
npm run todesktop-build --workspace @telepath-computer/television-desktop
```

Do not release it. From the build's page in the ToDesktop dashboard, download its disk image and its Mac zip, and note its build ID and version.

### Electron's license files (agent-run)

Unzip the Mac zip on any computer and list the two files:

```sh
unzip -q <Mac zip> -d candidate
ls -l candidate/Television.app/Contents/Resources/LICENSE.electron.txt candidate/Television.app/Contents/Resources/LICENSES.chromium.html
```

Both files must exist.

### Mac install (manual)

Use an Apple Silicon Mac with macOS 12 or later where an earlier desktop app has saved a server connection, and quit the earlier app. Download the disk image in a browser. A browser marks the download as coming from the internet, so macOS checks the signature and notarization when the app first opens; `curl` does not mark it, and that check is skipped. Open the disk image, drag Television to Applications, and open Television from Applications.

The app must open without a warning, show Television in the Dock and the application menu, show the release version with no build number under **Television > About Television**, and open with the saved connection. Then record:

```sh
sw_vers
spctl --assess --type execute --verbose /Applications/Television.app
/usr/libexec/PlistBuddy -c "Print :CFBundleIdentifier" /Applications/Television.app/Contents/Info.plist
/usr/libexec/PlistBuddy -c "Print :CFBundleShortVersionString" /Applications/Television.app/Contents/Info.plist
/usr/libexec/PlistBuddy -c "Print :CFBundleVersion" /Applications/Television.app/Contents/Info.plist
```

`spctl` must print `accepted` and `source=Notarized Developer ID`. The identifier must be `computer.telepath.television`, and both versions must be the release version.

### Updates (manual)

With the build installed, run a server from a checkout of the same code, as steps 1–3 of the [UX staging runbook's real-Electron gate recipe](../../specs/arch/updates/runbook-ux-staging.md#desktop-upgrade-gate--real-electron-app) do. Leave out `TV_TEST_REQUIRED_DESKTOP_VERSION` and `TV_UPDATE_CHANNEL_URL`, so the server neither gates the app nor announces a server release. Quit Television, then open it with ToDesktop's simulated update and connect it to that server:

```sh
/Applications/Television.app/Contents/MacOS/Television --runtime-simulate-updates=update-available
```

A few seconds after it opens, the update bell must light and the desktop self-update notice must present the version `<release version>-simulated`. Press **Restart to update**: the app must quit and open again. The simulated update installs nothing, so the app still runs the same build.

For a change to the upgrade gate, run the server with `TV_TEST_REQUIRED_DESKTOP_VERSION` above the build's version and repeat: the gate screen must show the downloaded update and **Restart to update**.

### Bridge and IPC (manual)

With the build installed and connected to a server run from the same code, use each part of the interface that calls a changed operation of the native bridge, or sends a changed message between the app and the page or its artifact views, and check that it does what the operation provides.

Record each run in the pull request, with the readings above.

### Local verification

The pull request that moves the app to ToDesktop also runs full local verification on a Mac, in a checkout prepared with [tvdev-setup](../../developer-skills/tvdev-setup/SKILL.md). If `~/.tvdev-use-blaxel` exists, add `--allow-extreme-inefficiency`:

```sh
npm run verify -- local
```

## Specs

[The desktop application spec](../../specs/product/desktop-app.md) owns what users install and see. [The desktop architecture](../../specs/arch/desktop/index.md) maps the modules, and [the ToDesktop build](../../specs/arch/desktop/distribution.md) owns the configuration, the build script, releases and the download links.

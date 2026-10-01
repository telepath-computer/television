*The desktop application users download: its Mac installer and download link, the platforms it supports, Television identity and saved data, and the npm package that distributed releases through 1.3.x.*

# Desktop application

Television's desktop application opens the Television interface in a native window. People download it as a Mac app and install and open it like any other Mac app, and it keeps the name, saved server connection and version identity described below.

## What this owns

This spec owns the user-visible installation, platform support, connection to a server, identity and saved data of the desktop application, and the status of the npm package that distributed desktop releases through 1.3.x. How the app is built, signed and hosted, the Electron runtime used for development and tests, and the main-process identity rules are architecture under [arch/desktop/index.md](../arch/desktop/index.md). How users learn about and receive updates, including the screen that can require a newer desktop release, is owned by [update-notifications.md](./update-notifications.md). The [desktop app explainer](../arch/explainer-desktop-app.md) walks through the whole app and links to each owning spec.

The *desktop application* is the Television app that ToDesktop builds and that users install from Television's download link.

## Installation and support

Users download and install the desktop application themselves, with no Node or npm. A signed and notarized disk image holds `Television.app`; the user drags it to Applications and opens it from Applications, the Dock or Spotlight. ^desktop-install-download

The download link stays the same across releases and serves the most recent desktop release. The [administrator guide](../arch/cli/admin-guide.md) gives the user the link and these steps; the link and its hosting belong to [the ToDesktop build](../arch/desktop/distribution.md#^desktop-dist-links).

The desktop application supports Apple Silicon Macs running macOS 12 or later. On every other computer, including Intel Macs, Linux and Windows, Television is used through the web client in a browser. ^desktop-product-support

The desktop app is a Mac app, so wording about the desktop app or updating it names the Mac where it names a platform. ^desktop-mac-wording

## Connecting to a server

The desktop application connects to one Television server with a [connect link](./cli.md#^cli-connect-link). At first launch, and whenever no connection is saved, it shows the [setup screen](../ui/setup/index.md), which offers a prompt the person gives their agent and a field for the link the agent returns. Once connected, it remembers the connection and reconnects by itself each time it opens.

The Television menu's **Disconnect from Server** forgets the saved connection and returns to the setup screen. It is available whenever a connection is saved, including while the app shows that it must be upgraded, so a person can always leave a server. What the app shows while it cannot use its server is owned by the [app shell's connection states](../ui/app/index.md#^ap-connection-states) and the [desktop connection flow](../arch/desktop/connect-flow.md#^desktop-connect-entry).

## The npm package

Desktop releases through 1.3.x were published to npm as `@telepath-computer/television-desktop` and started with the `tv-desktop` command. The package receives no release after 1.3.x. Its npm page carries a deprecation message, and its published versions stay installable. Every npm desktop release is 1.3.x or earlier, and every downloaded desktop release is 1.4.0 or later. Update notices shown to npm-installed apps are owned by [update-notifications.md](./update-notifications.md). ^desktop-npm-package

## Television identity

A running desktop application presents **Television** as its window identity, under the [main-process identity contract](../arch/desktop/index.md#main-process-identity). The application is `Television.app`, and Finder, the Dock and the application menu show Television. ^desktop-product-identity

Saved connections and local settings live under the Television application identity. A downloaded app therefore opens with the server connection that an npm-installed app saved on the same computer, and a newer release keeps them. ^desktop-saved-data

The macOS **About Television** panel identifies the installed release using the exact [release version](./versioning.md#^pv-exact-version), such as `1.4.0`, with no separate build number. Operating-system metadata inspectors expose the same release version under the [metadata scope](./versioning.md#^pv-os-metadata-scope). ^desktop-about-version

## Testing

The desktop application must have continuous acceptance evidence under [Tests are the validation mechanism](../arch/testing-policy.md#Tests are the validation mechanism). The [real-Electron desktop surface](../arch/desktop/e2e-harness.md) provides this evidence by launching the repository's desktop package and exercising the production main process, `BrowserWindow`, and webview behavior. It runs wherever the test runner runs, which in CI is Linux, and it does not prove that the Mac app installs or starts.

Television has no macOS CI environment, and only ToDesktop's build service signs and notarizes the app. This spec therefore declares the real-host checks below an exception to the testing policy. They use the real built app, with no mocks or test hooks in it, and real-Electron evidence does not replace them.

Before a change to the desktop app's behavior reaches `main`, the ToDesktop build of that code passes the checks the change needs. Merging an integration branch into `main` needs them; merging into an integration branch or a personal branch does not. The checks run on an unreleased [candidate build](../arch/desktop/distribution.md#^desktop-dist-candidate-builds), or a signed [test build](../arch/desktop/distribution.md#^desktop-dist-test-builds) of the same code. Releasing a build ships it to every installed app ([releases](../arch/desktop/distribution.md#releases)), so testing happens before release and a released build is never what is tested. A check covers the code that was built, not one commit: a later change that leaves the build unchanged, such as moving a document, needs no new run. ^desktop-checks-before-main

The pull request that takes a change to `main` runs the checks its changes need. Each check below lists the changes that need it; the lists guide judgment rather than bound it, and a check whose area a change leaves untouched is not needed. Agents run the checks marked agent-run, and a person on a [supported Mac](#^desktop-product-support) runs the ones marked manual. The pull request records who ran each check, the build and the commit it was built from, and the check's steps and output.

- **Mac install** (manual). Needed for changes to the ToDesktop configuration or build settings, the build script or upload directory, the Electron or electron-builder version, or the app's name, identity or saved-data location. The build is installed from its DMG on a Mac where an earlier desktop app has saved a connection. Opened from Applications, the app must show that:
  - macOS opens the app without a warning, which shows that it accepts the signature and notarization;
  - the Dock and the application menu show Television;
  - the About panel shows the exact release version with no separate build number;
  - the app opens with the earlier app's saved connection.
- **Electron's license files** (agent-run). Needed for changes to the Electron or electron-builder version, or to how license files reach the built app. The built app's `Contents/Resources` folder must contain Electron's `LICENSE.electron.txt` and `LICENSES.chromium.html`, the files that [licensing](./licensing.md#^licensing-electron-aggregate) requires to reach users. The agent reads them from the Mac zip that ToDesktop builds beside the DMG, which unzips on Linux.
- **Updates** (manual). Needed for changes to the update runtime or where the app starts it, the Electron or electron-builder version, the [desktop self-update notice](./update-notifications.md#^desktop-self-update) and its restart, or the upgrade gate, including its screen. The installed build is opened with ToDesktop's simulated update, `--runtime-simulate-updates=update-available`, and connected to a server run from the same code. It must present the desktop self-update notice with the simulated version, and pressing **Restart to update** must quit the app and open it again. For a change to the gate, the app connected to a server that gates it must show the downloaded update and **Restart to update** on the gate screen.
- **Bridge and IPC** (manual). Needed for changes to the native bridge, or to the messages between the app and the page or its artifact views. Connected to a server run from the same code, the installed build must do what each changed operation provides, used through the part of the interface that calls it.

The pull request that moves the app to ToDesktop must also record a run of the complete local verification gate, `npm run verify -- local`, on a supported Mac. This run provides the evidence that [preflight testing](../arch/test-runner/preflight.md#Testing) requires from a real macOS host.

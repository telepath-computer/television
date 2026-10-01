*Desktop updates: how the main process starts ToDesktop's update runtime, records a downloaded update, tells the served interface about it, and restarts the app to install it.*

# Desktop updates

The downloaded desktop app updates itself through ToDesktop's update runtime, `@todesktop/runtime`. The runtime checks for, downloads and installs updates; the served interface tells the user and offers the restart. This module is the part in between: it starts the runtime, keeps track of a downloaded update, and gives the served interface two operations on the native preload bridge. What users see is [product update notifications](../../product/update-notifications.md#^desktop-self-update)'s. The web client's notice is [the desktop self-update notice](../updates/desktop-self-update-notice.md)'s, and the upgrade gate's use of the operations is [the gate's](../updates/desktop-upgrade-gate.md#^gate-instructions).

## What this owns

This module owns the runtime's start and options, the main process's record of the downloaded update, the two update operations on the native preload bridge, and the restart that installs an update. The runtime is a dependency of the workspace under [the ToDesktop build](./distribution.md#^desktop-dist-updates), which also owns releases.

## Starting the runtime

The main process calls `init()` from `@todesktop/runtime` immediately after `app.setName("Television")`, so the [application-name rule](./index.md#^desktop-user-data-order) holds whatever the runtime does when it starts. It passes one option, `updateReadyAction: { showNotification: "never" }`, which turns off the runtime's system notification about a downloaded update. Everything else keeps the runtime's defaults, which check, download and install on quit as [desktop app updates](../../product/update-notifications.md#^desktop-self-update) describe. ^desktop-updates-start

The runtime runs its updater only in a released ToDesktop build. In development runs and the desktop tests it makes no network request, and an unreleased test build does not update itself, so the call needs no condition of its own.

## The downloaded update

The runtime emits `update-downloaded` when a check finds an update and its download has finished. It emits it again after every later check while that update waits to install, with the same version. The main process listens for the event and records the version from its `updateInfo`, replacing any earlier record. The record lasts as long as the process: an app that quits either installs the update or finds it again after its next launch check. Before the first event there is no record. ^desktop-updates-record

## The update operations

The served interface reaches the main process only through the context-isolated native preload bridge, whose other operations include [the appearance operation](./appearance.md#^desktop-appearance-ipc). The preload adds two operations to it:

```ts
onDesktopUpdateDownloaded(callback: (version: string) => void): void
restartToInstallUpdate(): void
```

- `onDesktopUpdateDownloaded` calls `callback` with the recorded version at once when there is a record, and again whenever the main process records a different version. A page that loads after the download, after a reload or after the user reconnects therefore learns about the update. The preload passes only a non-empty string.
- `restartToInstallUpdate` asks the main process to restart the app and install the update. The main process acts on it only when it holds a record, and then calls `todesktop.autoUpdater.restartAndInstall()`; otherwise it ignores the request, since the runtime refuses to restart without a downloaded update. ^desktop-updates-ops

The upgrade gate calls these operations from the served interface of a server newer than the app, so they are consumed across releases, like the [desktop connect check](../updates/desktop-upgrade-gate.md#^pre-gate-handshake). Once released, their names, their arguments and the version string passed to the callback stay as stated here. A change that would break them adds operations with new names and keeps these. The served interface uses the operations only when they are present, so an app released before them keeps working without them. ^desktop-updates-frozen

## Restarting on a Mac

`restartAndInstall()` hands the install to Electron's Mac updater, Squirrel.Mac, through electron-updater. If Squirrel.Mac has not finished unpacking and verifying the downloaded app, electron-updater waits until it has. Electron then writes an install request telling Squirrel.Mac's installer, ShipIt, to open the app after installing, and quits the app. ShipIt waits for the app to exit, replaces it with the new release and opens it, which reconnects to the saved server. ^desktop-updates-restart

A restart therefore avoids both ways that an install on quit can end with the earlier release: a quit before Squirrel.Mac has prepared the update, and opening the app again before ShipIt has replaced it. The time from the request to the quit, while Squirrel.Mac finishes, has not been measured.

## Testing

Under [Compositional coverage across clean seams](../testing-policy.md#Compositional coverage across clean seams), the product's real-Electron [desktop self-update notice acceptance](../../product/update-notifications.md#Testing) must run the app with the runtime in its simulation mode, `--runtime-simulate-updates=update-available`, in which the runtime reports a downloaded update shortly after launch. That coverage must also show that the reported version reaches a page loaded before the report and a page loaded after it, through `onDesktopUpdateDownloaded`.

Under the testing policy's [Mocking policy](../testing-policy.md#Mocking policy), when `TV_TEST_MODE` is `true` the main process records a restart request for the test instead of calling `restartAndInstall()`, as it records external opens. This forfeits coverage of the runtime's restart and of Squirrel.Mac. The product spec's [update check](../../product/desktop-app.md#Testing) presses the restart in a candidate build on a real Mac, with the runtime's simulated update, and installing a real update is left to ToDesktop's smoke tests before a release ([releases](./distribution.md#^desktop-dist-release)).

Coverage must also show that the main process calls `init()` once, after `app.setName("Television")`, with `updateReadyAction: { showNotification: "never" }` as its only option, that a restart request with no record does not reach the runtime, and that the preload passes the callback only a non-empty string.

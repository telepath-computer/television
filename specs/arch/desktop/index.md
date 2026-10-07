*The desktop architecture root: server connection, appearance, the ToDesktop build, the app's updates, the Electron runtime for development and tests, the test harness, and main-process identity.*

# Desktop architecture

Television's desktop package turns the web interface into a native application. This document maps the modules that connect it to a server, build the app users install, provide Electron for development runs and tests, and exercise the result in tests.

## What this owns

This root owns the desktop domain's module map, terms, cross-module coverage model, and the main-process identity rules below. User-visible installation, platform support, identity, and saved-data behavior is [product/desktop-app.md](../../product/desktop-app.md). Each module spec exclusively owns the contract named in the map. The [desktop app explainer](../explainer-desktop-app.md) follows the whole app across the product, update, UI, licensing and testing specs as well.

## Module map

| Module | Spec | Owns |
| --- | --- | --- |
| Desktop connection flow | [connect-flow.md](./connect-flow.md) | the local page, connection entry from a link, saved connections and their reconnection, Disconnect from Server, server-page loading and recovery, and the local-only IPC bridge |
| Desktop appearance | [appearance.md](./appearance.md) | confirmed appearance state across renderer, preload, main, app-wide native theme, disconnect, and reconnect |
| ToDesktop build | [distribution.md](./distribution.md) | the private desktop workspace, the ToDesktop configuration and build target, the upload directory, the build script, candidate and test builds, desktop releases, and the download link |
| Desktop updates | [updates.md](./updates.md) | the update runtime's start and options, the record of a downloaded update, the update operations on the native preload bridge, and the restart that installs an update |
| Electron runtime | [runtime.md](./runtime.md) | Electron's exact version and declarations, runtime validity on development and test hosts, how those hosts obtain the runtime, and major-upgrade operations |
| Electron e2e harness | [e2e-harness.md](./e2e-harness.md) | runtime preparation for desktop tests, executable handoff to Playwright, Linux environment planning, and real-Electron harness seams |

## Boundaries with other architecture

Desktop modules rely on these specs, which own the named concerns:

- [Node versions](../node-versions.md) owns the repository toolchain, including the Node version the ToDesktop build installs dependencies with. The installed app runs on the Node that Electron embeds.
- [Artifact bridge architecture](../artifact-frame/artifact-bridge.md) owns communication and input behavior across the Electron `<webview>` boundary. Desktop keeps `<webview>` as that embedded-document mechanism.
- [Desktop upgrade gate](../updates/desktop-upgrade-gate.md) owns cross-release compatibility gating between an installed desktop release and the server-served interface. [Desktop connection flow](./connect-flow.md) owns the surrounding main-process connection lifecycle.
- [Licensing architecture](../licensing.md) owns the desktop build's third-party notices, the license gate's check of the workspace's `dependencies`, the license checks on the upload directory, and where Electron's license files sit in the built app.
- [GitHub CI](../test-runner/github-ci.md), [Blaxel shards](../test-runner/blaxel-testshards.md), and [preflight](../test-runner/preflight.md) own the provider setup and checks around the desktop test harness.

## External links

The desktop app installs a window-open handler on every Electron `webContents`. The handler denies every request to open an Electron window. For external HTTP and HTTPS links, it passes the URL to the operating system through `shell.openExternal`.

## Main-process identity

### Application and data name

`app.setName("Television")` runs before any operation can resolve an Electron application path, including `app.getPath("userData")`. Electron caches resolved paths, so this order makes the default `userData` directory end in `Television` and keeps saved connections under the Television identity. ^desktop-user-data-order

### Window title, icon, and About version

Every `BrowserWindow` the production main process creates is configured with the title `Television` and the package's `assets/icon.png`. [The ToDesktop configuration](./distribution.md#^desktop-dist-config) sets the application-bundle identity around that window. ^desktop-window-identity

Before installing the macOS application menu, the main process passes `app.getVersion()` unchanged to Electron's About panel as `applicationVersion` and sets the build-version field `version` to an empty string. The native panel therefore has one exact [release version](../../product/versioning.md#^pv-exact-version) and no independent build number. ^desktop-about-version-config

## Testing

Contract tests may record the window title, icon and About-panel options that Television supplies to Electron. They do not prove what the operating system shows; the product spec's real-host [Mac install check](../../product/desktop-app.md#Testing) covers that.

Tests verify the [application-name ordering](#^desktop-user-data-order) in the real Electron application without passing `--user-data-dir` or replacing Electron's `app` or path resolution.


*How the desktop architecture root's promises are proven: main-process identity contracts and a real-Electron data-location seam, composed with the module proofs and the product's real-host checks.*

# Desktop architecture — proof

Proves [specs/arch/desktop/index.md](../../../specs/arch/desktop/index.md).

## Coverage model

The [product proof](../../product/desktop-app.md) owns platform evidence and the real-host checks. Each module proof carries its own contract:

- [connect-flow.md](./connect-flow.md) and [appearance.md](./appearance.md) cover the connection flow and native appearance;
- [distribution.md](./distribution.md) covers the desktop workspace, the ToDesktop configuration, the upload directory and the update runtime's start, and leaves everything ToDesktop does to the product's real-host checks;
- [runtime.md](./runtime.md) covers Electron's exact version and declarations, runtime validity, and a real installation;
- [e2e-harness.md](./e2e-harness.md) crosses the installed Electron executable into Playwright and the real desktop app, including the harness smoke seam.

This root proves the main-process identity rules. Contract tests record the title, icon, exact About-panel application version and empty build-version field that Television supplies to Electron. Their replacements of Electron's `app` and `BrowserWindow` forfeit native presentation, which the real-Mac [install acceptance](../../product/desktop-app.md#^desktop-ac-mac-install) carries. A real-Electron seam proves that naming the app fixes its default data directory. The bundle identity and build version the ToDesktop configuration sets around the window are proven by the [ToDesktop build's configuration contract](./distribution.md#^desktop-dist-t-config).

External links are proven in the real Electron app by [artifact navigation](../../product/artifact-navigation.md#^ac-external-electron), through the test hook below. The bridge's other Electron crossings remain with [artifact-bridge.md](../artifact-frame/artifact-bridge.md); this domain does not duplicate webview behavior assertions.

## Test hooks

When `TV_TEST_MODE=true`, tests may observe each URL that would be opened externally in `globalThis.__televisionExternalOpenLog` and through the `television:test:external-open` message broadcast to every window. In this mode the app records and broadcasts the URL instead of calling `shell.openExternal`; production leaves `TV_TEST_MODE` unset and calls `shell.openExternal`.

## Assertions

- **Contract — window identity configuration** (the production main-process module and real package asset; Electron's `app` and `BrowserWindow` are declared mocks that record the constructor boundary): starting the application sends the exact [window identity configuration](../../../specs/arch/desktop/index.md#^desktop-window-identity) to Electron and the configured asset is present and nonempty. This proves the options Television sends to Electron, not a native window manager's rendering of them. The [real-Electron smoke seam](./e2e-harness.md#^desktop-t-e2e-smoke) crosses production `BrowserWindow` creation; product-visible identity evidence remains with [the product's Mac install acceptance](../../product/desktop-app.md#^desktop-ac-mac-install). — *(covered by test: `packages/desktop/test/main.test.ts` “creates BrowserWindow with Television title and the packaged icon”)*. ^desktop-t-window-identity
- **Contract — About-panel version configuration** (the production main-process module; Electron's `app` is a declared mock returning illustrative release version `1.3.1` and recording its About-panel options, while the test process temporarily reports Darwin): before installing the macOS application menu, the main process supplies `applicationVersion: "1.3.1"` unchanged and `version: ""`, leaving no independent build number. The replacements forfeit native Darwin detection and panel rendering to the product's real-Mac [install acceptance](../../product/desktop-app.md#^desktop-ac-mac-install); *covered by `packages/desktop/test/main.test.ts` “configures the macOS About panel before installing the application menu”*. ^desktop-t-about-version
- **Seam — application name to default user-data path** (real Electron application; no `--user-data-dir`, no path or app mocks, with the host's config/home root redirected to a temporary fixture directory for isolation where the platform honors environment-based redirection — macOS resolves the home directory natively and ignores it, so there the run reads the real default location and the isolation check does not apply): launching the production desktop main process with the name hook in its real order and reading `app.getPath("userData")` reports a final component matching the [configured application name](../../../specs/arch/desktop/index.md#^desktop-user-data-order). The assertion claims the main-process ordering and Electron path resolution; it does not claim macOS Dock or LaunchServices identity, which the product acceptance path owns. — *(covered by test: `packages/desktop/test/e2e/user-data-identity.test.ts` “application name determines the default user-data directory”)*. ^desktop-t-user-data-order

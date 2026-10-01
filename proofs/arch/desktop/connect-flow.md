*How the promises in Desktop connection flow are proven.*

# Desktop connection flow — proof

Proves [specs/arch/desktop/connect-flow.md](../../../specs/arch/desktop/connect-flow.md).

## Coverage model

Coverage declarations are carried inside the migrated assertion blocks below.

## Assertions

### Test assertions

- **Contract — local entry and bridge** (saved connection, mode, form, and IPC peers authored in memory; Electron IPC is mocked, forfeiting the real bridge to the seam below): bootstrap auto-submits saved values, manual entry only pre-fills them, failed attempts keep editable values, and the packaged page and preload expose the expected local connection surface — *(covered by inherited tests: all cases under `packages/desktop/test/connect-page.test.ts` “bindConnectPage” and “initConnectPage with connect.html”)*. ^desktop-t-connect-entry
- **Contract — normalization and persistence** (authored URL strings and a real temporary filesystem; no network peer): supported inputs normalize to HTTP(S), unsupported inputs fail, and saved records round-trip through an atomic write while absent or malformed records load as no connection — *(covered by inherited tests: all cases under `packages/desktop/test/connect-url.test.ts` “normalizeConnectURL” and `packages/desktop/test/connection-store.test.ts` “connection-store”)*. ^desktop-t-connect-storage
- **Seam — authenticated page entry** (real Electron app and a really-running token-requiring Television server; isolated real user-data directory; the standing `TV_TEST_MODE` harness gate and declared `TV_TEST_DESKTOP_APP_VERSION` mock of `app.getVersion()`, forfeiting the real version path to [the unhooked shell-version seam](../updates/desktop-upgrade-gate.md#^t-shell-version-param); no other mocks): manual submission crosses the local preload and main-process IPC, runs the connect check, stores the normalized connection, loads the server root in Electron mode, consumes the page token into the live session, and leaves no token in the visible URL — *(covered by inherited tests: `packages/desktop/test/e2e/connect-screen.01.test.ts` “manual connect submits the form, checks the server, and navigates to the remote URL”)*. ^desktop-t-page-entry
- **Contract — load recovery** (Electron's `BrowserWindow` is a recording peer): a top-level remote failure returns to manual connection entry, while subframe, aborted-navigation, and local-page failures do not — *(covered by inherited tests: `packages/desktop/test/main.test.ts` “returns to the connect screen in manual mode when remote loadURL fails” and “does not return to the connect screen for subframe load failures or aborted navigations”)*. ^desktop-t-connect-load-recovery

Coverage relationship: the desktop check's [reader](../updates/desktop-upgrade-gate.md#^updates-t-connect-check-reader-contract) and [main-process](../updates/desktop-upgrade-gate.md#^updates-t-preflight-desktop-contract) assertions own identity acceptance and the success-only save/navigation boundary. The page-entry seam above crosses the surrounding local-screen-to-served-page path once without duplicating those response permutations.


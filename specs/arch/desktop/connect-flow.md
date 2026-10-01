*The desktop main-process connection flow: the local page, connection entry from a link, saved connections and their reconnection, Disconnect from Server, server-page loading and recovery, and the local-only IPC bridge.*

**Plain english:** this governs how the desktop app connects to a Television server from a link, remembers it, reconnects to it when the app starts, forgets it when the person disconnects, and opens the server's interface.

# Desktop connection flow

## What this owns

This module owns the Electron main process's connection lifecycle around the server-served application: the local page, how a person enters a connection or the app reuses a saved one, how the shell reads and stores it, what the local page shows while it connects, Disconnect from Server, the page URL the shell loads, and which navigation failures return to the local page. The cross-release identity request that precedes page loading is owned by [the desktop upgrade architecture](../updates/desktop-upgrade-gate.md#^pre-gate-handshake); the served application's live HTTP and websocket session remains code-governed under [channel-state architecture](../channel-state/index.md#^cs-connection-carve-out).

The [setup screen](../../ui/setup/index.md) owns the connect screen's interaction, markup and styling, and the [system modal](../../ui/app/system-modal/index.md) the dialogs the local page shows. How a failed connect check is classified, and the wording of the message the setup screen shows for it, remain code-governed ([^pre-gate-handshake](../updates/desktop-upgrade-gate.md#^pre-gate-handshake)). The [connection states explainer](../explainer-connection-states.md) places this flow alongside the connection states in the server's interface.

## The local page

The *local page* is the package's `connect.html`, loaded from the application's own files over `file:`. It shows the setup screen, and the system modal's states while a saved connection is starting. It is an application document ([arch/themes/delivery.md](../themes/delivery.md#^theme-delivery-app-document)) that wears the [Clouds theme](../../ui/themes/clouds/index.md) whatever theme the server uses, light or dark as the window's appearance currently is ([appearance.md](./appearance.md#^desktop-appearance-lifecycle)). Its setup screen and dialogs match the web client's design for them. How the local page achieves that, whether by using the web client's stylesheets with its own markup, by importing the web client's code for those surfaces, or otherwise, is left to the implementation. ^desktop-local-page

The connect preload exposes the connection IPC — connecting with a link, and disconnecting — only while the main frame is the local `file:` page. Server-served pages do not receive that bridge. This keeps link entry, and the token in it, in packaged code without granting the remote application access to main-process connection controls. ^desktop-connect-local-bridge

## Local connection entry

Production startup opens the local page. ^desktop-connect-entry

- **No saved connection.** The local page shows the setup screen. A submitted link is read as below and checked with the [desktop connect check](../updates/desktop-upgrade-gate.md#^pre-gate-desktop). When the check passes, the shell saves the connection and loads the server's page. When it fails for any reason, including a missing or rejected token, the setup screen shows its error state with the failure's message; no system-modal state appears on the setup screen. When the server requires a token the link lacks, or rejects the link's token, the message explains the problem in terms of the link, for example that the person needs the current link from their agent; its exact wording is code-governed.
- **A saved connection.** The local page never shows the setup screen. It shows the system modal's Connecting state and runs the desktop connect check automatically. When the check passes, the shell loads the server's page. When the server answers with `401`, the local page shows Access token required and makes no further attempts. Any other failure shows Can't connect with server, and the local page keeps repeating the check with backoff until it passes or the server answers `401`.

Neither path decides whether the desktop app must be upgraded: a server that requires a newer app is reached like any other, and the server's page then shows the upgrade gate ([^boot-barrier](../updates/desktop-upgrade-gate.md#^boot-barrier)).

## Disconnect from Server

*Disconnect from Server* forgets the saved connection: the shell stops any attempt in progress, deletes the saved record, and loads the local page, which shows the setup screen. It asks for no confirmation. ^desktop-disconnect-server

- The Television application menu always lists **Disconnect from Server**, with the accelerator `CmdOrCtrl+,` (⌘, on a Mac). The item is enabled exactly while a connection is saved: from the moment a connection is first saved until it is deleted.
- The item works whatever the window shows: the local page, the server's page, or the server's page halted at the [upgrade gate](../updates/desktop-upgrade-gate.md#^gate-screen).
- On the local page, Access token required and Can't connect with server also offer it as a button ([ui/app/system-modal/index.md](../../ui/app/system-modal/index.md#Interaction)). The server's page has no way to disconnect.

## URL normalization and persistence

Connect input is one link. Its `token` query parameter, when present, is the connection's token; the rest of the link normalizes to an HTTP or HTTPS server origin, discarding any path and other query parameters. Explicit HTTP(S) URLs are accepted; a bare host or host-and-port receives the `http:` scheme; invalid input and other schemes are rejected as a failed attempt. A link with no token makes a connection with no token. The normalized origin is the value used by the desktop connect check, persistence, and page navigation. It is never passed to an operating-system URL opener. ^desktop-connect-normalization

The saved `connection.json` record lives under Electron's `userData` directory and contains the normalized `serverURL` and token. Writes use a temporary sibling followed by rename. A missing or malformed record is treated as no saved connection. [Disconnect from Server](#^desktop-disconnect-server) deletes the record. The [desktop connect check](../updates/desktop-upgrade-gate.md#^pre-gate-desktop) owns when the record changes and navigation begins. ^desktop-connect-persistence

## Server page entry

The shell loads the normalized server origin's root. The page URL carries `mode=electron`, `desktopAppVersion`, and, for an authenticated connection, the token under the frozen `token` key. The renderer consumes the token for the live server connection and immediately removes it from the visible URL. Electron context is owned by [the upgrade gate](../updates/desktop-upgrade-gate.md#^electron-context), and the version handoff by [telemetry client architecture](../telemetry/client.md#^desktop-version-param). ^shell-page-entry

A genuine top-level remote load failure returns the window to the local page, which connects with the saved connection exactly as at startup. Aborted navigations, subframe failures, and failures while the local page is loading do not trigger that recovery. ^desktop-connect-load-recovery

## Testing

The path from the setup screen to the served page is tested once from end to end in the real Electron app against a running Television server that requires a token. The [desktop connect check](../updates/desktop-upgrade-gate.md#Desktop connect check) owns tests of which identity responses pass. It also owns proof that the app saves the connection and loads the page only after the check passes. This spec requires no additional tests for those cases.

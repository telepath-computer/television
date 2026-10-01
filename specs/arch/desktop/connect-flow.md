*The desktop main-process connection flow: local connection entry, URL normalization, saved connections, server-page loading and recovery, and the local-only IPC bridge.*

**Plain english:** this governs how the desktop app remembers a Television server, checks it before connecting, opens its interface, and returns to connection entry when that interface cannot load.

# Desktop connection flow

## What this owns

This module owns the Electron main process's connection lifecycle around the server-served application: how users enter or reuse a server connection, how the shell normalizes and stores it, the page URL the shell loads, and which navigation failures return to the connect screen. The cross-release identity request that precedes page loading is owned by [the desktop upgrade architecture](../updates/desktop-upgrade-gate.md#^pre-gate-handshake); the served application's live HTTP and websocket session remains code-governed under [channel-state architecture](../channel-state/index.md#^cs-connection-carve-out).

The connect screen's interaction, markup, and styling are the [setup screen](../../ui/setup/index.md)'s. This spec owns the architectural boundaries that let the local screen hand off safely to server-served code.

## Local connection entry

Production startup opens the package's local `connect.html` page. Without a saved connection, the page shows the [setup screen](../../ui/setup/index.md). A failed attempt from the setup screen stays on the setup screen, in its error state. On the local page, Can’t connect with server appears only while reconnecting a saved connection, and a connection is saved only after its connect check passes. With a saved connection, the page never shows the setup screen: it shows the [system modal](../../ui/app/system-modal/index.md)'s Connecting state and submits the saved connection automatically. If that attempt fails for any reason, including a token the server does not accept, the page shows the system modal's Can’t connect with server state, offering Disconnect from Server, and keeps retrying with backoff until an attempt succeeds. ^desktop-connect-entry

Disconnect from Server deletes the saved connection and returns the window to the local page, which then shows the setup screen. The Television application menu always lists Disconnect from Server, and it is available only while a connection is saved. The Can’t connect with server dialog also offers a button with that label. ^desktop-disconnect-server

The local page is an application document: its root carries the application document marker ([arch/themes/delivery.md](../themes/delivery.md#^theme-delivery-app-document)), its theme is the one the [setup screen](../../ui/setup/index.md#Markup and styling) specifies, and it follows the window's light or dark appearance ([appearance.md](./appearance.md#^desktop-appearance-lifecycle)). The desktop build includes the complete foundation, the application tokens, the font, and the sheets of the surfaces the page renders from the web client's committed production copies ([arch/ui/foundation.md](../ui/foundation.md#Distribution)), and the Clouds theme stylesheet and wallpaper from the bundled Clouds package ([arch/themes/bundled-installation.md](../themes/bundled-installation.md)). The desktop source tree maintains no separate copies of these files. ^desktop-local-page-styling

The connect preload exposes the connection IPC only while the main frame is the local `file:` page. Server-served pages do not receive that bridge. This keeps link entry, token included, in packaged code without granting the remote application access to main-process connection controls. ^desktop-connect-local-bridge

## URL normalization and persistence

Connect input is one link. Its `token` query parameter, when present, is the connection's token, and the rest of the link normalizes to an HTTP or HTTPS server origin. Explicit HTTP(S) URLs are accepted; a bare host or host-and-port receives the `http:` scheme; invalid input and other schemes are rejected. The normalized origin is the value used by the [desktop connect check](../updates/desktop-upgrade-gate.md#^pre-gate-desktop), persistence, and page navigation. It is never passed to an operating-system URL opener. ^desktop-connect-normalization

The saved `connection.json` record lives under Electron's `userData` directory and contains the normalized `serverURL` and token. Writes use a temporary sibling followed by rename. A missing or malformed record is treated as no saved connection. [Disconnect from Server](#^desktop-disconnect-server) deletes the record. The [desktop connect check](../updates/desktop-upgrade-gate.md#^pre-gate-desktop) owns when the record changes and navigation begins. ^desktop-connect-persistence

## Server page entry

The shell loads the normalized server origin's root. The page URL carries `mode=electron`, `desktopAppVersion`, and, for an authenticated connection, the token under the frozen `token` key. The renderer consumes the token for the live server connection and immediately removes it from the visible URL. Electron context is owned by [the upgrade gate](../updates/desktop-upgrade-gate.md#^electron-context), and the version handoff by [telemetry client architecture](../telemetry/client.md#^desktop-version-param). ^shell-page-entry

A genuine top-level remote load failure returns the window to the local page showing Can’t connect with server, which retries the saved connection as it does at startup. Aborted navigations, subframe failures, and failures while the local page is loading do not trigger that recovery. ^desktop-connect-load-recovery

## Testing

The path from the local connect screen to the served page is tested once from end to end in the real Electron app against a running Television server that requires a token. The [desktop connect check](../updates/desktop-upgrade-gate.md#Desktop connect check) owns tests of which identity responses pass. It also owns proof that the app saves the connection and loads the page only after the check passes. This spec requires no additional tests for those cases.


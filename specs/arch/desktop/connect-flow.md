*The desktop main-process connection flow: local connection entry, URL normalization, saved connections, server-page loading and recovery, and the local-only IPC bridge.*

**Plain english:** this governs how the desktop app remembers a Television server, checks it before connecting, opens its interface, and returns to connection entry when that interface cannot load.

# Desktop connection flow

## What this owns

This module owns the Electron main process's connection lifecycle around the server-served application: how users enter or reuse a server connection, how the shell normalizes and stores it, the page URL the shell loads, and which navigation failures return to the connect screen. The cross-release identity request that precedes page loading is owned by [the desktop upgrade architecture](../updates/desktop-upgrade-gate.md#^pre-gate-handshake); the served application's live HTTP and websocket session remains code-governed under [channel-state architecture](../channel-state/index.md#^cs-connection-carve-out).

Connection-screen copy, timing, and presentation remain code-governed. This spec owns the architectural boundaries that let the local screen hand off safely to server-served code.

## Local connection entry

Production startup opens the package's local `connect.html` page in **bootstrap** mode. A saved connection pre-fills the form and is submitted automatically. The native “Connect to server…” menu opens the same page in **manual** mode, where saved values pre-fill the form without automatic submission. A failed attempt leaves the entered values available for correction. ^desktop-connect-entry

The connect preload exposes the connection IPC only while the main frame is the local `file:` page. Server-served pages do not receive that bridge. This keeps URL and token entry in packaged code without granting the remote application access to main-process connection controls. ^desktop-connect-local-bridge

## URL normalization and persistence

Connect input normalizes to an HTTP or HTTPS server origin. Explicit HTTP(S) URLs are accepted; a bare host or host-and-port receives the `http:` scheme; invalid input and other schemes are rejected. The normalized origin is the value used by the [desktop connect check](../updates/desktop-upgrade-gate.md#^pre-gate-desktop), persistence, and page navigation. It is never passed to an operating-system URL opener. ^desktop-connect-normalization

The saved `connection.json` record lives under Electron's `userData` directory and contains the normalized `serverURL` and token. Writes use a temporary sibling followed by rename. A missing or malformed record is treated as no saved connection. The [desktop connect check](../updates/desktop-upgrade-gate.md#^pre-gate-desktop) owns when the record changes and navigation begins. ^desktop-connect-persistence

## Server page entry

The shell loads the normalized server origin's root. The page URL carries `mode=electron`, `desktopAppVersion`, and, for an authenticated connection, the token under the frozen `token` key. The renderer consumes the token for the live server connection and immediately removes it from the visible URL. Electron context is owned by [the upgrade gate](../updates/desktop-upgrade-gate.md#^electron-context), and the version handoff by [telemetry client architecture](../telemetry/client.md#^desktop-version-param). ^shell-page-entry

A genuine top-level remote load failure returns the window to the local connect screen in manual mode. Aborted navigations, subframe failures, and failures while the local page is loading do not trigger that recovery. ^desktop-connect-load-recovery

## Testing

The path from the local connect screen to the served page is tested once from end to end in the real Electron app against a running Television server that requires a token. The [desktop connect check](../updates/desktop-upgrade-gate.md#Desktop connect check) owns tests of which identity responses pass. It also owns proof that the app saves the connection and loads the page only after the check passes. This spec requires no additional tests for those cases.


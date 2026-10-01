*How the server advertises its release version to clients (health endpoint, response header, `/events` message), how the web bundle learns its own version at build time, the cache headers that make a reload effective, and the client auto-reload contract with its loop guard.*

**Plain english:** this governs how a running Television server tells connected apps which release it is, and how a browser tab (or the desktop app's built-in page) notices — at the moment it reconnects — that it was built from an older release than the server it is talking to, then reloads itself once, silently, so the user is always looking at the interface that matches their server.

# Version advertisement and client auto-reload

## What this owns

This module owns the **version advertisement surface** — every place a client can learn the server's release version — the **web bundle's build-time version stamp**, the **cache headers** on the served interface, and the **client reload contract**: when a client reloads, the guard that prevents reload loops, and the *client autoreloaded* telemetry event. The release-version model, its `0.0.0` semantics, and the comparison rules are owned by [the domain root](./index.md#^updates-dev-version).

## Server version surfaces

The server exposes its release version — resolved **stamp-only** for this domain per [arch/updates/index.md#^updates-dev-version](./index.md#^updates-dev-version): the `__TV_VERSION__` define when present, else `0.0.0`; the `package.json` fallback inside `readServerPackageVersion()` (`packages/server/src/server.ts`) belongs to telemetry's reporting and is never consulted here — in three places:

- **`GET /health`** gains a `version` field alongside the existing `status`/`bindAddresses`/`port`. `/health` is the unauthenticated liveness probe, so the version is readable without a token; a release version is not sensitive. `tv status` relays this field, which is how an agent verifies a daemon upgrade; the command is owned by [product/cli.md](../../product/cli.md). ^health-version
- **`X-TV-Version` response header** on every HTTP response, set by a global middleware registered before all routes. It is one header on responses already flowing, costs nothing, and gives any HTTP consumer (curl, the shared client, proxies under diagnosis) the version without a dedicated request. `X-TV-Version` is added to the `Access-Control-Expose-Headers` of the CORS'd API routes (`applyCorsMiddleware` in `packages/server/src/routes.ts`) so cross-origin clients can read it. ^version-header
- **The `/events` websocket** sends exactly one `server-status` message to a client when the connection is established. It sends that message immediately after the connection-level auth check in `packages/server/src/event-stream.ts` passes. Whenever the update state changes, it broadcasts a fresh `server-status` to all clients ([update-channel.md#Relay to clients](./update-channel.md#Relay to clients)). The connect-time delivery is **the first message on the connection, before any broadcast event** — a load-bearing ordering, not an incident: the Electron boot barrier ([desktop-upgrade-gate.md#^boot-barrier](./desktop-upgrade-gate.md#^boot-barrier)) must make its halt-or-boot decision from this message before the client does anything else. This is also the surface the reload contract consumes: the socket is exactly the thing a server restart drops, so version delivery rides the same channel whose reconnect marks the moment a mismatch can appear. ^events-version

```ts
// Server → client on the /events socket, alongside the ServerEvent broadcasts.
// Lockstep contract — no compat discipline (arch/updates/index.md ^updates-lockstep-contracts).
interface ServerStatusMessage {
  type: "server-status";
  /** The server's release version; "0.0.0" for development builds. */
  version: string;
  /** The desktop release this server requires; null when it advertises none. Owned by desktop-upgrade-gate.md. */
  requiredDesktopVersion: string | null;
  /** Update-channel state, null when no valid channel data applies. Owned by update-channel.md. */
  update: UpdateState | null;
}
```

`ServerStatusMessage` is a connection-lifecycle message, not a domain mutation, so it is not a member of the `ServerEvent` union in `packages/shared/src/types.ts` — it is sent point-to-point on connect (plus broadcast on update-state change), never replayed, and describes the server rather than the store.

**Unknown-message tolerance.** The client routes each `server-status` message to the handler for that message type. Malformed JSON is dropped silently. Any message with an unrecognized `type` is ignored. An unrecognized message does not affect the page or socket. It also has no effect on later messages with recognized types. Ignoring unrecognized message types lets the lockstep contracts change freely ([arch/updates/index.md#^updates-lockstep-contracts](./index.md#^updates-lockstep-contracts)). ^unknown-messages

## Web bundle version

The web bundle gets its own `__TV_VERSION__` build-time constant: a Vite `define` in `packages/web/vite.config.ts` reading the workspace `package.json` version, applied **only for `vite build`**, not the dev server. The publish workflow builds after the version is finalized (see `.github/workflows/publish.yml` and [version-before-build order](./index.md)), so a published bundle is always stamped with its true release version. Under the dev server the constant is undefined and the client resolves its *bundle version* to `0.0.0` — which per [the dev-version rule](./index.md#^updates-dev-version) exempts it from reload — so a dev-served client pointed at any production server is never reload-interrupted. ^web-version-stamp

The client publishes its resolved bundle version as a console-visible diagnostic, set synchronously at startup: a read-only global `window.__tvVersion` holding the resolved value (the stamp, or `0.0.0` for an unstamped dev bundle), alongside the same value stamped on the document root as `data-tv-bundle-version`. Both exist for humans and agents at a devtools console and for test observability; neither is an API, and nothing in the product may read them. ^version-probe

## Interface cache headers

For a reload to actually fetch the new interface, the served entry document must not be cache-served. Scope: this contract covers only the **GUI web bundle's `express.static` mount** (`staticDir` in `packages/server/src/server.ts`) — not the artifact proxy, the `/views/*` mounts, or any other HTML-serving path, which own their own cache policy. That mount sets `Cache-Control: no-cache` on its `.html`/`.htm` files: browsers may store them but must revalidate before use, so a reload always revalidates the GUI's `index.html` against the running server. Vite's content-hashed asset filenames make this sufficient — a changed bundle changes every asset URL the new `index.html` references — so the hashed assets themselves may carry long-lived caching (`Cache-Control: public, max-age=31536000, immutable`). ^cache-headers

## The reload contract

The client (`packages/web`) compares its bundle version against the server version from each `ServerStatusMessage` — string inequality, per [the comparison rules](./index.md#^updates-version-comparisons) — and reloads on mismatch:

- **Scope: the bundle-serving server only.** The web client owns one server connection. Its server can be version-matched against the bundle only when its origin served the bundle: the page origin, or in Electron mode the connected server URL the page was loaded from. A page origin that differs from the connected server (`?serverURL=`, the development affordance of `scripts/dev-server.sh` + Vite) is out of scope for update notifications: its only real occurrence is development, already neutralized by the dev exemption (unstamped bundle → `0.0.0`). ^reload-origin-rule
- **Detection points.** The comparison runs on **every** `server-status` received from the bundle-serving server. Because that message opens every connection ([#^events-version](#^events-version)), this one trigger inherently covers both detection points: initial connect (a tab loaded from cache while the server upgraded) and every reconnect (a mismatch can only arise after a server restart, which always drops the socket). ^reload-detection
- **Exemption.** If either side reports `0.0.0`, the versions are treated as matching ([dev-version rule](./index.md#^updates-dev-version)).
- **Reload before gate (Electron), while a reload is still permitted.** The reload comparison takes precedence over the boot barrier's gate check: a stale bundle reloads first, so the gate is normally evaluated by a bundle that matches its server — fresh gate code included. On loop-guard exhaustion the gate evaluates regardless, with the possibly stale bundle; consequences and rationale in [desktop-upgrade-gate.md#^gate-reload-precedence](./desktop-upgrade-gate.md#^gate-reload-precedence). **The dying-page invariant:** `location.reload()` does not stop running code, so once any sanctioned reload has been requested on a page, the page takes no further update-domain actions — no store bootstrap, no gate rendering, no telemetry emission, no loop-guard marker writes, no second reload — until the browser actually navigates. What the user sees in that instant is simply whatever is already on screen — the connecting/loading state on a fresh load, the current working interface on a live reconnect — frozen until the navigation lands; the app never proceeds into the interface on a stale bundle. ^reload-gate-precedence
- **Action.** On mismatch, record the loop-guard marker, then `location.reload()` immediately — no deferral, no UI. The reload can in principle clobber up to the markdown editor's ~500 ms save-debounce window of un-flushed keystrokes; that loss is accepted, per [product/update-notifications.md#^reload-immediate](../../product/update-notifications.md#^reload-immediate). ^reload-action

**Loop guard.** Before reloading, the client writes a marker to `sessionStorage` under `tv-reload-attempted`: `{ serverVersion, fromVersion }` — the server version it is reloading for and the pre-reload bundle version (the latter consumed by the [post-reload telemetry emission](#^autoreload-telemetry)). An absent or malformed stored value is treated as no marker. A mismatch whose server version equals the marker's `serverVersion` does not reload — at most one attempt per server version per tab session. `sessionStorage` is the right scope: it survives the reload itself (so the guard is checkable after it) but is per-tab and dropped when the tab closes, so a next-day fresh tab retries naturally, as does the next server release (a new version differs from the marker). If the reload did not clear the mismatch, the client does nothing and shows nothing — except in Electron context when the gate condition holds, where the gate still evaluates with the current bundle ([desktop-upgrade-gate.md#^gate-reload-precedence](./desktop-upgrade-gate.md#^gate-reload-precedence)). ^reload-loop-guard

## Telemetry: *client autoreloaded*

The event `client_autoreloaded` (`from_version`, `to_version`) is a member of the closed vocabulary owned by [arch/telemetry/index.md](../telemetry/index.md) and travels as a validated telemetry client signal ([client-signals.md](../telemetry/client-signals.md)). This spec owns only when it fires:

The event is emitted **after** the reload completes, not before: a signal sent immediately before `location.reload()` races navigation teardown, and post-reload emission doubles as confirmation the reload actually happened. On startup, if the loop-guard marker is present and the fresh bundle version now equals the server version, the client signals the event (`from_version` = the marker's `fromVersion`; `to_version` = the new bundle version) and clears the marker. A marker whose mismatch persists emits nothing. ^autoreload-telemetry

## Testing

Under [Compositional coverage across clean seams](../testing-policy.md#Compositional coverage across clean seams), coverage of the server-owned surfaces in this spec must use their production transports. Coverage of `/health`, the `X-TV-Version` response header, and the GUI bundle's cache headers must use real HTTP through a listening `Server`. Coverage of `server-status` must use a real `/events` websocket. `server-status` must be the first message on a new connection even when domain events are broadcast while that connection is being established. Coverage of the web version stamp must run a real `vite build` and inspect its output.

Coverage of the reload wiring must use a real websocket to deliver a mismatching `server-status` from the bundle-serving server to a real browser. That coverage must exercise both detection points: the initial connection and a reconnection.

The testing policy says to name coverage provided by other specs rather than duplicate it ([Tests are the validation mechanism](../testing-policy.md#Tests are the validation mechanism)). The [product update notifications spec](../../product/update-notifications.md#Auto-reload: stale clients self-heal) owns the complete user-visible auto-reload outcomes. The [telemetry client-signal forwarding spec](../telemetry/client-signals.md#^signal-forwarding) owns transport of `client_autoreloaded`. This spec requires no additional end-to-end test of the product outcomes and no additional test that sends `client_autoreloaded` through the telemetry transport.


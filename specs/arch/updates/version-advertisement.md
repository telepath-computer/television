*How the server advertises its release version to clients (health endpoint, response header, `/events` message), how the web bundle learns its own version at build time, the cache headers that make a reload effective, and the client auto-reload contract with its loop guard.*

# Version advertisement and client auto-reload

A running Television server tells connected clients which release it is. A browser tab, or the desktop app's served page, notices when it reconnects that it was built from a different release than its server, and reloads itself once, silently, so the user always sees the interface that matches their server.

This spec owns every place a client can learn the server's release version, the web bundle's build-time version stamp, the cache headers on the served interface, and the **client reload contract**: when a client reloads, the guard that prevents reload loops, and the *client autoreloaded* event. The release-version model, its `0.0.0` semantics and the comparison rules are [the domain root](./index.md#^updates-dev-version)'s.

## Server version surfaces

The server exposes its release version, resolved from the stamp alone as [arch/updates/index.md#^updates-dev-version](./index.md#^updates-dev-version) sets out, in three places:

- **`GET /health`** has a `version` field alongside `status`, `bindAddresses` and `port`. `/health` is the unauthenticated liveness probe, so the version is readable without a token; a release version is not sensitive. `tv status` relays this field, which is how an agent verifies a daemon upgrade; the command is [product/cli.md](../../product/cli.md)'s. ^health-version
- **The `X-TV-Version` response header** is on every HTTP response, set by a global middleware registered before all routes. It gives any HTTP consumer (curl, the shared client, proxies under diagnosis) the version without a dedicated request. The CORS-enabled API routes list `X-TV-Version` in `Access-Control-Expose-Headers` so cross-origin clients can read it. ^version-header
- **The `/events` websocket** sends exactly one `server-status` message to a client when the connection is established, immediately after the connection's authentication check passes. Whenever the update state changes, it broadcasts a fresh `server-status` to all clients ([update-channel.md#Relay to clients](./update-channel.md#Relay to clients)). The connect-time message is **the first message on the connection, before any broadcast event**. That ordering is load-bearing: the Electron boot barrier ([desktop-upgrade-gate.md#^boot-barrier](./desktop-upgrade-gate.md#^boot-barrier)) makes its halt-or-boot decision from this message before the client does anything else. The reload contract also consumes it: a server restart drops the socket, so version delivery rides the same channel whose reconnect marks the moment a mismatch can appear. ^events-version

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

`ServerStatusMessage` describes the server, not the store: it is a connection-lifecycle message, not a store event, and it is never replayed.

**Unknown-message tolerance.** The client routes each `/events` message to the handler for its type. Malformed JSON is dropped silently. A message with an unrecognized `type` is ignored: it does not affect the page, the socket or later messages with recognized types. This lets the lockstep contracts change freely ([arch/updates/index.md#^updates-lockstep-contracts](./index.md#^updates-lockstep-contracts)). ^unknown-messages

## Web bundle version

The web bundle has its own `__TV_VERSION__` build-time constant, defined from the workspace `package.json` version **only for `vite build`**, not the development server. The publish workflow builds after the version is final ([the domain root](./index.md)), so a published bundle is always stamped with its true release version. Under the development server the constant is undefined, and the client resolves its *bundle version* to `0.0.0`, which exempts it from reload ([the development-version rule](./index.md#^updates-dev-version)), so a development client pointed at any production server is never interrupted by a reload. ^web-version-stamp

The client publishes its resolved bundle version as a diagnostic, set synchronously at startup: a read-only global `window.__tvVersion`, and the same value as `data-tv-bundle-version` on the document root. Both exist for people and agents at a devtools console and for test observability. Neither is an API, and nothing in the product may read them. ^version-probe

## Interface cache headers

For a reload to fetch the new interface, the served entry document must not be served from cache. This contract covers only the static mount that serves the GUI web bundle, not the artifact proxy, the `/views/*` mounts or any other HTML-serving path, which own their own cache policy. That mount sets `Cache-Control: no-cache` on its `.html` and `.htm` files: browsers may store them but must revalidate before use, so a reload always revalidates the GUI's `index.html` against the running server. Vite's content-hashed asset filenames make this sufficient, because a changed bundle changes every asset URL the new `index.html` references, so the hashed assets may carry long-lived caching (`Cache-Control: public, max-age=31536000, immutable`). ^cache-headers

## The reload contract

The client compares its bundle version with the server version in each `ServerStatusMessage`, by string inequality ([the comparison rules](./index.md#^updates-version-comparisons)), and reloads on a mismatch:

- **Scope: the bundle-serving server only.** The web client owns one server connection. That server can be matched against the bundle only when its origin served the bundle: the page origin, or in Electron mode the connected server URL the page was loaded from. A page origin that differs from the connected server (`?serverURL=`, the development setup of `scripts/dev-server.sh` with Vite) is out of scope for update notifications. It occurs only in development, where the unstamped bundle's `0.0.0` already exempts it. ^reload-origin-rule
- **Detection points.** The comparison runs on **every** `server-status` from the bundle-serving server. Because that message opens every connection ([#^events-version](#^events-version)), this one trigger covers both detection points: the initial connection (a tab loaded from cache while the server upgraded) and every reconnection (a mismatch can arise only after a server restart, which always drops the socket). ^reload-detection
- **Exemption.** If either side reports `0.0.0`, the versions are treated as matching ([the development-version rule](./index.md#^updates-dev-version)).
- **Reload before gate.** In Electron context, the reload check runs before the boot barrier's gate check, while a reload is still permitted ([desktop-upgrade-gate.md#^gate-reload-precedence](./desktop-upgrade-gate.md#^gate-reload-precedence)). `location.reload()` does not stop running code, so once any reload has been requested on a page, the page takes no further update-domain action (no store bootstrap, no gate rendering, no telemetry emission, no loop-guard marker writes, no second reload) until the browser navigates. Until then the user sees whatever is already on screen: the connecting state on a fresh load, or the current interface on a live reconnection. The app never proceeds into the interface on a stale bundle. ^reload-gate-precedence
- **Action.** On a mismatch, record the loop-guard marker, then call `location.reload()` at once, with no deferral and no UI. The reload can lose keystrokes from the markdown editor's short save delay; that loss is accepted by [product/update-notifications.md#^reload-immediate](../../product/update-notifications.md#^reload-immediate). ^reload-action

**Loop guard.** Before reloading, the client writes a marker to `sessionStorage` under `tv-reload-attempted`: `{ serverVersion, fromVersion }`, the server version it is reloading for and the bundle version before the reload (used by the [post-reload telemetry](#^autoreload-telemetry)). An absent or malformed stored value is treated as no marker. A mismatch whose server version equals the marker's `serverVersion` does not reload: at most one attempt per server version per tab session. `sessionStorage` survives the reload, so the guard can be checked afterwards, but is per tab and dropped when the tab closes, so a fresh tab retries, as does the next server release. If the reload did not clear the mismatch, the client does nothing and shows nothing, except in Electron context when the gate condition holds, where the gate still evaluates with the current bundle ([desktop-upgrade-gate.md#^gate-reload-precedence](./desktop-upgrade-gate.md#^gate-reload-precedence)). ^reload-loop-guard

## Telemetry: *client autoreloaded*

The event `client_autoreloaded` is a member of the closed vocabulary owned by [arch/telemetry/index.md](../telemetry/index.md) and travels as a validated telemetry client signal, whose properties [client-signals.md](../telemetry/client-signals.md) declares. This spec owns when it fires and what its versions are.

The event is emitted **after** the reload completes, not before: a signal sent just before `location.reload()` races the page's teardown, and emitting after the reload confirms that it happened. On startup, if the loop-guard marker is present and the new bundle version now equals the server version, the client sends the event (`from_version` is the marker's `fromVersion`; `to_version` is the new bundle version) and clears the marker. A marker whose mismatch persists emits nothing. ^autoreload-telemetry

## Inputs to proof derivation that the spec does not otherwise show

### Directives from the designer or architect

- Under [Compositional coverage across clean seams](../testing-policy.md#Compositional coverage across clean seams), coverage of the server-owned surfaces uses their production transports: real HTTP through a listening `Server` for `/health`, the `X-TV-Version` header and the GUI bundle's cache headers, and a real `/events` websocket for `server-status`. Coverage of the web version stamp runs a real `vite build` and inspects its output.
- Coverage of the reload wiring uses a real websocket to deliver a mismatching `server-status` from the bundle-serving server to a real browser, at both detection points: the initial connection and a reconnection.

### Facts a test author would likely miss

- `server-status` must be the first message on a new connection even when domain events are broadcast while that connection is being established.

### Coverage owned by another spec

The [product update notifications spec](../../product/update-notifications.md#Auto-reload: stale clients self-heal) owns the complete user-visible auto-reload outcomes, and the [telemetry client-signal forwarding spec](../telemetry/client-signals.md#^signal-forwarding) owns transport of `client_autoreloaded`. No additional end-to-end test of those is required here.

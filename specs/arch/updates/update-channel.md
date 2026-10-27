*The public update channel: the manually-deployed JSON notice at television.run, its schema and additive evolution protocol; server-side polling with silent failure semantics; the update-state relay to clients; dismissal persistence; the notice telemetry events; and the channel-deploy procedure.*

**Plain english:** this governs the single small file we publish on television.run when a release is worth announcing, how every Television server periodically checks that file, and how the resulting update state reaches every connected client so the interface can show its update notice. If the file is missing or broken, everyone simply sees nothing.

# Update channel

## What this owns

This module owns the **update channel** end to end: the published file's schema and evolution protocol, its master copy and how the master copy is published, the server's polling of it and the failure semantics, the relay of update state to clients, dismissal persistence, and the *update toast shown* / *update prompt copy clicked* telemetry events. The notification surface itself — its interaction, markup, and styling — is owned by [ui/app/update-notification/index.md](../../ui/app/update-notification/index.md). The desktop upgrade instructions it may carry are consumed by [desktop-upgrade-gate.md](./desktop-upgrade-gate.md) (which the channel informs but does not drive). The user-facing behavior it implements is [product/update-notifications.md](../../product/update-notifications.md); version comparisons and the lockstep-contract rule come from [arch/updates/index.md](./index.md).

## The channel file

The update channel is published as a static JSON file at the channel URL — the term and the URL are owned by [product/update-notifications.md#^channel-url](../../product/update-notifications.md#^channel-url):

```
https://television.run/update-channel.json
```

It is deployed manually, and only for releases worth announcing ([product/update-notifications.md#^channel-curated](../../product/update-notifications.md#^channel-curated)). Between deploys it simply continues to name the last announced release. It is **first-party, owned, trusted content**: Television publishes it, and clients render it as published.

```ts
// The published channel document. PUBLIC contract — see Evolution protocol.
interface UpdateChannelDocument {
  schemaVersion: number;          // currently 1
  version: string;                // the announced release, ^\d+\.\d+\.\d+$
  toast: {
    markdown: string;             // toast body, markdown
    prompt?: string;              // agent upgrade prompt, offered via the copy button
    promptButtonLabel?: string;   // frozen core; not consumed (button text is UI copy)
  };
  desktop?: {
    upgradeMarkdown: string;      // desktop-upgrade-gate screen body: upgrade instructions, markdown (desktop-upgrade-gate.md)
  };
}
```

**Shape validation.** The server validates each fetched document's shape before adopting it — plumbing for the silent-failure semantics below, not a security layer: a typo'd manual deploy must degrade to "no update" (last-known-good applies) rather than push a broken payload to the fleet. A document is valid iff `schemaVersion` is a positive integer, `version` matches the release-version pattern, `toast.markdown` is a non-empty string, `toast.prompt` and `toast.promptButtonLabel` are strings when present, and `desktop`, when present, has a non-empty `upgradeMarkdown` string. Unknown fields anywhere are ignored, never rejected. ^channel-validation

## Evolution protocol

The channel's readers are, by definition, **old installs** — the whole point is telling servers that newer software exists. The contract therefore evolves under strict rules: ^evolution-protocol

1. **Tolerant reader, additive writer.** Readers read the fields they know and ignore unknown fields. The published core fields — `schemaVersion`, `version`, `toast.markdown`, `toast.prompt`, `toast.promptButtonLabel`, `desktop.upgradeMarkdown` — are **frozen forever**: never renamed, removed, or repurposed. New capabilities are new optional fields. ^evolution-frozen-core
2. **`schemaVersion` is a sanity marker, not a gate.** A reader seeing a higher `schemaVersion` than it knows still reads the core fields and ignores the rest; it never refuses the file. Gating on it would break exactly the audience the channel exists for. ^evolution-no-gate
3. **A genuinely breaking change gets a new URL** (e.g. `update-channel.v2.json`); the old URL's contract stays frozen for the old fleet. Operational consequence: a channel deploy writes **all** supported URLs (see [Operations](#operations)). ^evolution-new-url

## Server-side polling

The **server** polls the channel; clients never fetch it (no CORS exposure, one fetch per server instead of per tab, and the failure policy lives in one place). ^server-polls

`TV_UPDATE_CHANNEL_URL` is an operational override available in every build. It points the server at a staging channel instead of the production channel. A release build can use it to dry-run a channel deployment. ^channel-url-override

Setting `TV_UPDATE_CHANNEL_URL` enables polling regardless of the server's version, including `0.0.0`. A development build cannot meaningfully compare its version with the channel's announced version. Setting the variable to a URL other than the production channel URL explicitly asks the server to poll content controlled by the operator. `TV_UPDATE_CHANNEL_URL` itself has no default value. When it is unset, the server uses the production channel URL and the development-version suppression below applies. ^hook-url-implies-polling

`TV_UPDATE_CHANNEL_POLL_INTERVAL_MS` sets the poll interval in milliseconds and removes the jitter. A valid value is a positive integer; any other value is ignored. The variable applies only when `TV_UPDATE_CHANNEL_URL` is also set. When the URL override is unset, the interval and jitter follow the production schedule below. ^hook-poll-interval

Persisted daemons capture both variables at install time. `tv serve --persist` copies their values from the installing shell into the persisted daemon's environment. Empty or undefined values are omitted. This is the same install-time process used for the [telemetry-control variables](../cli/index.md#^ac-persist-telemetry-env). A staging dry-run from [the channel deployment runbook](./runbook-channel-deploy.md) can therefore use either a foreground server or a persisted daemon. Rerun `tv serve --persist` to refresh the captured values. ^hook-persist-capture

- **Schedule.** One fetch at boot, then every **5 minutes**, each cycle delayed by uniform random jitter of 0–1 minute. An important release — sometimes paired with a desktop gate the fleet should hit promptly once servers upgrade — reaches long-running servers within minutes without anyone restarting; a static-file fetch per server every few minutes is negligible load for both sides. There is no thundering herd to defend against: upgrades are user-initiated per installation, so no fleet or large group of servers ever restarts at the same moment — boot polls need no jitter, and even the interval jitter is not actually needed. It is kept purely as belt-and-suspenders against long-running timers drifting into sync, because it costs nothing. ^poll-schedule
- **Freshness.** The CDN in front of `television.run` is not under Television's control, so each fetch busts caches explicitly: a `?t=<epoch-seconds>` query parameter plus a `Cache-Control: no-cache` request header. ^poll-cache-bust
- **Bounds.** Each fetch times out after 10 seconds.
- **Lifecycle.** Disposing `Server` stops channel polling, including any scheduled cycle or in-flight request. ^poll-lifecycle
- **Failure is silent.** Any network, timeout, HTTP-status, parse, or shape-validation failure is swallowed without logging noise beyond the server's normal debug log: the server keeps the last-known-good document (held **in memory only** — never persisted, so a restart simply starts empty until the boot poll) and, with no last-known-good, behaves as "no update available." The site being down is never an error. ^poll-silent-failure
- **The developer-host marker does not gate polling.** A release-build server on a host with the `~/.tv-developer` marker ([product/telemetry.md#^developer-host-project-guard](../../product/telemetry.md#^developer-host-project-guard)) polls the channel and relays update state exactly like any other host. A developer's real, npm-installed personal server must hear about releases like anyone's; development itself is kept off the channel by the version suppression below, which keys on the build, not the host. The marker is deliberately not an input to poll gating. ^dev-marker-no-bypass
- **Dev-version suppression.** A server whose own version is `0.0.0` does not poll: it cannot meaningfully compare against the channel ([arch/updates/index.md#^updates-dev-version](./index.md#^updates-dev-version)). An explicit `TV_UPDATE_CHANNEL_URL` override supersedes this suppression ([#^hook-url-implies-polling](#^hook-url-implies-polling)). ^dev-version-no-poll

## Relay to clients

The server derives an `UpdateState` from the (valid, last-known-good) channel document and relays it on the `server-status` message ([version-advertisement.md#^events-version](./version-advertisement.md#^events-version)): delivered to each client on connect, and re-broadcast to all connected clients when the state changes (a poll yielding a different valid document, or the first valid document). The client retains the relayed state on the server's connection (`ServerConnection.updateState`, alongside its other per-server state). It keeps that state across disconnects, and only a later `server-status` replaces it. Consumers therefore read the current state whenever they mount rather than depending on having heard a broadcast. ^relay

```ts
// The `update` field of ServerStatusMessage (version-advertisement.md).
// Lockstep contract — no compat discipline (arch/updates/index.md ^updates-lockstep-contracts).
interface UpdateState {
  /** Set when the channel's version is strictly newer than the server's; null otherwise. */
  toast: UpdateToast | null;
  /** The channel's desktop upgrade instructions, relayed verbatim when present; null otherwise. */
  desktop: DesktopUpgradeInstructions | null;
}

interface UpdateToast {
  version: string;               // the announced release
  markdown: string;
  prompt?: string;
  promptButtonLabel?: string; // relayed verbatim; not consumed ([[#^copy-button]])
}

interface DesktopUpgradeInstructions {
  upgradeMarkdown: string;
}
```

The two halves play different roles. The **toast** half is decision-bearing: the comparison (channel version vs. server version, numeric triple greater-than per [arch/updates/index.md#^updates-version-comparisons](./index.md#^updates-version-comparisons)) is server-side — every client of this server gets the same answer, and the client never re-derives the newer-than-server decision (its only channel-version ordering is the dismissal comparison in [#^dismissal](#^dismissal)). The **desktop** half is content only: the desktop upgrade gate may render it as its screen's body ([desktop-upgrade-gate.md#^gate-instructions](./desktop-upgrade-gate.md#^gate-instructions)), and the gate itself is driven entirely by the server's own required desktop version, not by channel data. ^relay-split

## Consumption: the update notification

While the client holds an `UpdateState` with a non-null `toast` (and is not gated — [the gate supersedes the notice](./desktop-upgrade-gate.md#^gate-precedence)), the server-update notice applies, auto-presenting unless that `version` is dismissed. It comes first in the [shared surface's order](../../product/update-notifications.md#^notice-precedence). The surface's interaction, markup, and styling are owned by [ui/app/update-notification/index.md](../../ui/app/update-notification/index.md); the feature's promises by [product/update-notifications.md#^toast-behavior](../../product/update-notifications.md#^toast-behavior). Contracts this spec owns:

- **Body production.** The notice body is the client's standard markdown pipeline output (`renderMarkdown` in `packages/web/src/markdown.ts`), exactly as published — no rendering treatment of its own; whatever the pipeline does for the rest of the app, it does here. That pipeline already gives every link `target="_blank" rel="noopener noreferrer"`, which in Electron routes through the desktop app's window-open handler and opens external `http(s)` URLs in the system browser (`packages/desktop/src/index.ts`) — satisfying the product promise that links open outside the interface. ^toast-render
- **Prompt fields.** The `prompt` field feeds the notice's composed copy-prompt control verbatim. Its rendering, visibility, surface-owned label, and close/reopen reset are [ui/app/update-notification/index.md#^un-copy-button](../../ui/app/update-notification/index.md#^un-copy-button)'s; generic confirmation and clipboard behavior are [ui/app/copy-button/index.md](../../ui/app/copy-button/index.md)'s. `promptButtonLabel` stays valid on the wire ([#^evolution-frozen-core](#^evolution-frozen-core)) but is not consumed. ^copy-button
- **Dismissal persistence.** What dismissing *is* — closing the presented notice — is owned by [ui/app/update-notification/index.md#^un-closing](../../ui/app/update-notification/index.md#^un-closing); this spec owns the server-notice memory. Dismissing stores the dismissed channel version in `localStorage` under `tv-update-dismissed` (per browser profile / desktop app, persistent — matching the product promise of never auto-popping again). If the key is absent or does not contain a valid release version, the client treats the notice as not dismissed. Dismissal suppresses only **automatic** presentation: the notice does not auto-present when the advertised version is equal to or older than the stored version; a strictly newer advertised version auto-presents again and dismissing it overwrites the key. A single last-dismissed value suffices because the channel only ever moves forward. This key neither suppresses nor reveals the separately persisted desktop self-update notice or desktop recommendation. ^dismissal
- **Server-notice lifetime.** The server notice applies exactly while the toast state applies (non-null `toast`, not gated) — dismissal does not end it; when `toast` becomes null (the server upgraded past the announced release, or channel state is gone), that notice and its claim on the shared bell end. Its interaction — the bell's non-dismissability, presenting the active notice on click — is owned by [ui/app/update-notification/index.md#^un-bell-represents](../../ui/app/update-notification/index.md#^un-bell-represents); the product promise by [product/update-notifications.md#^toast-bell](../../product/update-notifications.md#^toast-bell). ^bell
- **Bundle-serving origin.** The client owns one server connection, to the origin that served its interface ([version-advertisement.md#^reload-origin-rule](./version-advertisement.md#^reload-origin-rule)), and the surface and its dismissal follow that connection's update state. ^one-toast

## Telemetry: toast events

Two events, members of the closed vocabulary owned by [arch/telemetry/index.md](../telemetry/index.md), traveling as validated telemetry client signals ([client-signals.md](../telemetry/client-signals.md)). Both carry exactly `server_version` (the connected server's release version) and `channel_version` — never toast text or prompt content. This spec owns only when they fire:

- `update_toast_shown` — emitted when the toast becomes visible for a channel version (once per client per channel version per page load, not per render; a bell-triggered re-presentation within the same page load does not re-emit).
- `update_prompt_copy_clicked` — emitted on each copy-button click.

## Operations

**The master copy.** The file served at the channel URL is a verbatim copy of [update-channel.json](./update-channel.json), the master copy beside this spec. Publishing copies the master copy from freshly fetched, merged Television `origin/main` to `site/public/update-channel.json` in the website repository, <https://github.com/telepath-computer/television.run>. Changing the master copy does not itself publish it. When a pull request changes wording that the master copy repeats, such as the gate's built-in fallback, or a fact that it states, such as how the desktop app is installed, the same pull request updates the master copy, so that its diff shows the change to the published text. ^channel-master-copy

**Deploying a channel notice.** A channel deploy is a deliberate manual act, per important release:

1. Author the document in the master copy: the exact release `version`, a short `toast.markdown` (links allowed; they open externally), and normally a `toast.prompt` that tells the user's agent to upgrade Television following `https://television.run/install.md`. Release details copy that exact version unchanged; a heading may use the ordinary **Television `major.minor`** release name. The `desktop` block's `upgradeMarkdown` is what the gate shows an app that reports no downloaded update ([desktop-upgrade-gate.md#^gate-instructions](./desktop-upgrade-gate.md#^gate-instructions)), and every server relays it, including servers whose own built-in fallback is out of date. Keep it current with how gated users should update: change it whenever that changes, such as when the gate's built-in fallback changes, whether or not the required desktop version changes. Start from the built-in fallback ([desktop-upgrade-gate.md#^gate-fallback-content](./desktop-upgrade-gate.md#^gate-fallback-content)), and when a release raises the required desktop version ([desktop-upgrade-gate.md#Operations](./desktop-upgrade-gate.md#Operations)), write it for the [intended sequencing](../../product/update-notifications.md#^gate-sequencing). Whether an app is gated depends only on its server's required desktop version, never on the block ([#^relay-split](#^relay-split)). The announced release, the required desktop version its servers enforce, and the version of the desktop release that meets that requirement, which is at least the requirement, are distinct versions that need not be equal ([desktop-upgrade-gate.md#^ops-bump](./desktop-upgrade-gate.md#^ops-bump)); instructions that name a desktop version give the required version or that desktop release's version, copied unchanged as its exact `x.y.z`. ^ops-author
2. CI checks the master copy against [#^channel-validation](#^channel-validation) ([Testing](#Testing)).
3. Publish the master copy ([#^channel-master-copy](#^channel-master-copy)) to `https://television.run/update-channel.json` **and to every other supported channel URL** ([#^evolution-new-url](#^evolution-new-url)); while only v1 exists, that is the one URL. When the release raises the required desktop version, publish at the point [the gate's operations](./desktop-upgrade-gate.md#^ops-bump) set.
4. Expect propagation within one poll interval (≤ ~6 min for running servers; immediately for servers booting after the CDN serves the new file). There is no push and no way to force a fleet-wide refresh.

To retract a toast, deploy a document naming the current (or any older) release: servers compare against their own version, so a not-newer version simply means no toast. Removing the `desktop` block only removes the channel's instructions — gated clients fall back to their server's built-in message; the gate itself is retracted only by a server release lowering or removing the requirement ([desktop-upgrade-gate.md](./desktop-upgrade-gate.md)). ^ops-deploy

## Testing

Under [Compositional coverage across clean seams](../testing-policy.md#Compositional coverage across clean seams), polling coverage must start a `Server` through the production composition. That coverage must use real HTTP to fetch controlled channel content and show that the fetched document becomes the current update state. Relay coverage must use a real `/events` websocket when a client connects and when a later valid document changes the state. Disposing a `Server` with live channel polling must prevent any later channel request.

Under the testing policy's [Mocking policy](../testing-policy.md#Mocking policy), coverage of a developer host with no `TV_UPDATE_CHANNEL_URL` override must show that the production channel URL is selected. That coverage must not send a request to `television.run`.

The test suite must check the master copy with the server's production shape validation ([#^channel-validation](#^channel-validation)). A pull request carrying an invalid master copy then fails CI; published, that document would be silently ignored by the entire fleet. The check must also fail when the master copy has a field, at any level, that the validator does not read, so that a misspelled key cannot silently drop what it carries.

When `UpdateState.toast` is non-null, its `markdown` must pass through the standard markdown pipeline in a real browser, including external-link behavior.

The testing policy says to name coverage provided by other specs rather than duplicate it ([Tests are the validation mechanism](../testing-policy.md#Tests are the validation mechanism)). [Product update notifications](../../product/update-notifications.md#The update toast) owns the user-visible browser and Electron outcomes. [The update-notification UI spec](../../ui/app/update-notification/index.md) owns notification interaction and markup. [The copy-button UI spec](../../ui/app/copy-button/index.md) owns generic copy behavior. This spec requires no additional end-to-end test of the same product or UI outcomes.

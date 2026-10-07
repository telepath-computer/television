*The public update channel: the manually-deployed JSON notice at television.run, its schema and additive evolution protocol; server-side polling with silent failure semantics; the update-state relay to clients; dismissal persistence; the notice telemetry events; and the channel-deploy procedure.*

# Update channel

The update channel is the single small file Television publishes on television.run when a release is worth announcing. Every Television server checks it periodically and relays the result to its connected clients, which show the server-update notice. A missing or broken file is never shown as an error.

This spec owns the channel end to end: the published file's schema and evolution, its master copy and how it is published, the server's polling and failure semantics, the relay of update state to clients, the server notice's dismissal persistence, and the *update toast shown* and *update prompt copy clicked* events. The notice surface is [ui/app/update-notification/index.md](../../ui/app/update-notification/index.md)'s. The channel's desktop upgrade instructions are shown by [the desktop upgrade gate](./desktop-upgrade-gate.md), which the channel informs but does not drive.

## The channel file

The update channel is a static JSON file at the [channel URL](../../product/update-notifications.md#^channel-url), deployed by hand and only for releases worth announcing ([product/update-notifications.md#^channel-curated](../../product/update-notifications.md#^channel-curated)). Between deploys it continues to name the last announced release. It is first-party, trusted content: Television publishes it, and clients render it as published.

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

**Shape validation.** The server validates each fetched document's shape before adopting it. This supports the silent-failure semantics below and is not a security layer: a mistyped manual deploy must degrade to "no update" (the last-known-good document applies) rather than push a broken payload to the fleet. A document is valid if and only if `schemaVersion` is a positive integer, `version` matches the release-version pattern, `toast.markdown` is a non-empty string, `toast.prompt` and `toast.promptButtonLabel` are strings when present, and `desktop`, when present, has a non-empty `upgradeMarkdown` string. Unknown fields anywhere are ignored, never rejected. ^channel-validation

## Evolution protocol

The channel's readers are, by definition, **old installs**: the channel exists to tell servers that newer software exists. The contract therefore evolves under strict rules: ^evolution-protocol

1. **Tolerant reader, additive writer.** Readers read the fields they know and ignore unknown fields. The published core fields (`schemaVersion`, `version`, `toast.markdown`, `toast.prompt`, `toast.promptButtonLabel`, `desktop.upgradeMarkdown`) are **frozen forever**: never renamed, removed or repurposed. New capabilities are new optional fields. ^evolution-frozen-core
2. **`schemaVersion` is a sanity marker, not a gate.** A reader seeing a higher `schemaVersion` than it knows still reads the core fields and ignores the rest; it never refuses the file. Gating on it would break exactly the audience the channel exists for. ^evolution-no-gate
3. **A breaking change gets a new URL** (for example `update-channel.v2.json`); the old URL's contract stays frozen for the old fleet. A channel deploy therefore writes **all** supported URLs (see [Operations](#operations)). ^evolution-new-url

## Server-side polling

The **server** polls the channel; clients never fetch it. That avoids CORS exposure, makes one fetch per server instead of per tab, and keeps the failure policy in one place. ^server-polls

`TV_UPDATE_CHANNEL_URL` is an operational override available in every build. It points the server at a staging channel instead of the production channel, so a release build can dry-run a channel deployment. ^channel-url-override

Setting `TV_UPDATE_CHANNEL_URL` enables polling regardless of the server's version, including `0.0.0`: setting it explicitly asks the server to poll content the operator controls. The variable has no default value. When it is unset, the server uses the production channel URL and the development-version suppression below applies. ^hook-url-implies-polling

`TV_UPDATE_CHANNEL_POLL_INTERVAL_MS` sets the poll interval in milliseconds and removes the jitter. A valid value is a positive integer; any other value is ignored. The variable applies only when `TV_UPDATE_CHANNEL_URL` is also set; otherwise the production schedule below applies. ^hook-poll-interval

Persisted daemons capture both variables at install time: `tv serve --persist` copies their values from the installing shell into the persisted daemon's environment, omitting empty or undefined values, by the same install-time process as the [telemetry-control variables](../cli/index.md#^ac-persist-telemetry-env). A staging dry-run from [the channel deployment runbook](./runbook-channel-deploy.md) can therefore use either a foreground server or a persisted daemon. Rerunning `tv serve --persist` refreshes the captured values. ^hook-persist-capture

- **Schedule.** One fetch at boot, then every **5 minutes**, each cycle delayed by uniform random jitter of 0–1 minute. An important release, sometimes paired with a desktop gate the fleet should hit promptly once servers upgrade, reaches long-running servers within minutes without anyone restarting them, and a static-file fetch per server every few minutes is negligible load. There is no thundering herd to defend against: upgrades are user-initiated per installation, so no large group of servers restarts at the same moment, and boot polls need no jitter. The interval jitter is not strictly needed either; it is kept because it costs nothing and stops long-running timers drifting into sync. ^poll-schedule
- **Freshness.** The CDN in front of `television.run` is not under Television's control, so each fetch busts caches explicitly: a `?t=<epoch-seconds>` query parameter plus a `Cache-Control: no-cache` request header. ^poll-cache-bust
- **Lifecycle.** Disposing `Server` stops channel polling, including any scheduled cycle or in-flight request. ^poll-lifecycle
- **Failure is silent.** Any network, timeout, HTTP-status, parse or shape-validation failure is swallowed, with nothing logged beyond the server's normal debug log. The server keeps the last-known-good document, **in memory only**, so a restart starts empty until the boot poll; with no last-known-good document it behaves as "no update available". The site being down is never an error. ^poll-silent-failure
- **The developer-host marker does not gate polling.** A release-build server on a host with the `~/.tv-developer` marker polls the channel and relays update state like any other host ([product/update-notifications.md#^toast-dev-host](../../product/update-notifications.md#^toast-dev-host)). The marker is not an input to poll gating. ^dev-marker-no-bypass
- **Development-version suppression.** A server whose own version is `0.0.0` does not poll, because it cannot meaningfully compare its version with the channel's ([arch/updates/index.md#^updates-dev-version](./index.md#^updates-dev-version)). An explicit `TV_UPDATE_CHANNEL_URL` overrides this ([#^hook-url-implies-polling](#^hook-url-implies-polling)). ^dev-version-no-poll

## Relay to clients

The server derives an `UpdateState` from the valid, last-known-good channel document and relays it on the `server-status` message ([version-advertisement.md#^events-version](./version-advertisement.md#^events-version)): to each client on connect, and to all connected clients when the state changes (a poll yielding a different valid document, or the first valid document). The client retains the relayed state on that server's connection across disconnects, and only a later `server-status` replaces it. Consumers therefore read the current state whenever they mount rather than depending on having heard a broadcast. ^relay

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
  promptButtonLabel?: string;    // relayed verbatim; not consumed (see Prompt fields)
}

interface DesktopUpgradeInstructions {
  upgradeMarkdown: string;
}
```

The two halves play different roles. The **toast** half carries a decision, made on the server: whether the channel version is newer than the server version ([arch/updates/index.md#^updates-version-comparisons](./index.md#^updates-version-comparisons)). Every client of the server gets the same answer, and the client never re-derives it; its only channel-version ordering is the dismissal comparison in [#^dismissal](#^dismissal). The **desktop** half is content only: the gate may render it as its screen's body ([desktop-upgrade-gate.md#^gate-instructions](./desktop-upgrade-gate.md#^gate-instructions)), and the gate itself is driven by the server's own required desktop version, not by channel data. ^relay-split

## Consumption: the update notification

While the client holds an `UpdateState` with a non-null `toast` and is not gated ([the gate supersedes the notice](./desktop-upgrade-gate.md#^gate-precedence)), the server-update notice applies, presenting automatically unless that `version` is dismissed. It comes first in the [shared surface's order](../../product/update-notifications.md#^notice-precedence). The feature's promises are [product/update-notifications.md#^toast-behavior](../../product/update-notifications.md#^toast-behavior)'s. Contracts this spec owns:

- **Body production.** The notice body is the client's standard markdown pipeline output, exactly as published, with no rendering treatment of its own. The pipeline already opens links in a new window, which the desktop app handles under its [external-link contract](../desktop/index.md#External links), so links open outside the interface with no notice-specific handling. ^toast-render
- **Prompt fields.** The `prompt` field feeds the notice's copy-prompt control verbatim. Its rendering, visibility, label and reset on close are [ui/app/update-notification/index.md#^un-copy-button](../../ui/app/update-notification/index.md#^un-copy-button)'s; clipboard behavior is [ui/app/copy-button/index.md](../../ui/app/copy-button/index.md)'s. `promptButtonLabel` stays valid on the wire ([#^evolution-frozen-core](#^evolution-frozen-core)) but is not consumed. ^copy-button
- **Dismissal persistence.** What dismissing is, closing the presented notice, is [ui/app/update-notification/index.md#^un-closing](../../ui/app/update-notification/index.md#^un-closing)'s; this spec owns the server notice's memory of it. Dismissing stores the dismissed channel version in `localStorage` under `tv-update-dismissed`, per browser profile or desktop app, persistently. If the key is absent or does not hold a valid release version, the notice is not dismissed. Dismissal suppresses only **automatic** presentation: the notice does not present by itself when the advertised version is equal to or older than the stored version; a strictly newer advertised version presents again, and dismissing it overwrites the key. A single last-dismissed value suffices because the channel only moves forward. This key neither suppresses nor reveals the desktop self-update notice or the desktop recommendation. ^dismissal
- **Server-notice lifetime.** The server notice applies exactly while the toast state applies (non-null `toast`, not gated); dismissal does not end it. When `toast` becomes null, because the server upgraded past the announced release or channel state is gone, the notice and its claim on the shared bell end. The bell's interaction is [ui/app/update-notification/index.md#^un-bell-represents](../../ui/app/update-notification/index.md#^un-bell-represents)'s. ^bell
- **Bundle-serving origin only.** The notice and its dismissal follow the connection's update state only when the connected server served the interface, the same scope as [the reload contract](./version-advertisement.md#^reload-origin-rule). ^one-toast

## Telemetry: toast events

Two events, members of the closed vocabulary owned by [arch/telemetry/index.md](../telemetry/index.md), travel as validated telemetry client signals, whose properties [client-signals.md](../telemetry/client-signals.md) declares. Their `server_version` is the connected server's release version and their `channel_version` the announced release; they never carry toast text or prompt content. This spec owns when they fire:

- `update_toast_shown`: when the toast becomes visible for a channel version, once per client per channel version per page load, not per render. Presenting it again from the bell within the same page load does not emit it again.
- `update_prompt_copy_clicked`: on each copy-button click.

## Operations

**The master copy.** The file served at the channel URL is a verbatim copy of [update-channel.json](./update-channel.json), the master copy beside this spec. Publishing copies the master copy from freshly fetched, merged Television `origin/main` to `site/public/update-channel.json` in the website repository, <https://github.com/telepath-computer/television.run>. Changing the master copy does not itself publish it. When a pull request changes wording that the master copy repeats, such as the gate's built-in fallback, or a fact that it states, such as how the desktop app is installed, the same pull request updates the master copy, so that its diff shows the change to the published text. ^channel-master-copy

**Deploying a channel notice.** A channel deploy is a deliberate manual act, per important release:

1. Author the document in the master copy: the exact release `version`, a short `toast.markdown` (links allowed; they open externally), and normally a `toast.prompt` that tells the user's agent to upgrade Television following `https://television.run/install.md`. Release details copy that exact version unchanged; a heading may use the ordinary **Television `major.minor`** release name ([versioning](../../product/versioning.md#^pv-release-name)).

   The `desktop.upgradeMarkdown` block is what the gate shows an app that reports no downloaded update ([desktop-upgrade-gate.md#^gate-instructions](./desktop-upgrade-gate.md#^gate-instructions)), and every server relays it, including servers whose own built-in fallback is out of date. Keep it current with how gated users should update, and change it whenever that changes, such as when the gate's built-in fallback changes, whether or not the required desktop version changes. Start from the built-in fallback ([desktop-upgrade-gate.md#^gate-fallback-content](./desktop-upgrade-gate.md#^gate-fallback-content)). When a release raises the required desktop version, write it for the [intended sequencing](../../product/update-notifications.md#^gate-sequencing). Whether an app is gated never depends on the block ([#^relay-split](#^relay-split)). The announced release, the required desktop version its servers enforce, and the version of the desktop release that meets that requirement (at least the requirement) are distinct versions that need not be equal ([desktop-upgrade-gate.md#^ops-bump](./desktop-upgrade-gate.md#^ops-bump)). Instructions that name a desktop version give the required version or that desktop release's version, copied unchanged as its exact `x.y.z`. ^ops-author
2. CI checks the master copy against [#^channel-validation](#^channel-validation).
3. Publish the master copy ([#^channel-master-copy](#^channel-master-copy)) to `https://television.run/update-channel.json` **and to every other supported channel URL** ([#^evolution-new-url](#^evolution-new-url)); while only v1 exists, that is the one URL. When the release raises the required desktop version, publish at the point [the gate's operations](./desktop-upgrade-gate.md#^ops-bump) set.
4. Expect propagation within one poll interval (about 6 minutes at most for running servers; at once for servers booting after the CDN serves the new file). There is no push and no way to force a fleet-wide refresh.

To retract a toast, deploy a document naming the current (or any older) release: servers compare against their own version, so a version that is not newer means no toast. Removing the `desktop` block only removes the channel's instructions, and gated clients fall back to their server's built-in message; the gate itself is retracted only by a server release lowering or removing the requirement ([desktop-upgrade-gate.md](./desktop-upgrade-gate.md)). ^ops-deploy

## Inputs to proof derivation that the spec does not otherwise show

### Directives from the designer or architect

- Under [Compositional coverage across clean seams](../testing-policy.md#Compositional coverage across clean seams), polling coverage starts a `Server` through the production composition and uses real HTTP to fetch controlled channel content. Relay coverage uses a real `/events` websocket, both when a client connects and when a later valid document changes the state.
- Under the [Mocking policy](../testing-policy.md#Mocking policy), coverage of a developer host with no `TV_UPDATE_CHANNEL_URL` override shows that the production channel URL is selected without sending a request to `television.run`.
- The test suite checks the master copy with the server's production shape validation, so a pull request carrying an invalid master copy fails CI; published, that document would be silently ignored by the entire fleet. The check also fails when the master copy has a field, at any level, that the validator does not read, so that a misspelled key cannot silently drop what it carries.
- A non-null `UpdateState.toast`'s `markdown` passes through the standard markdown pipeline in a real browser, including external-link behavior.

### Coverage owned by another spec

[Product update notifications](../../product/update-notifications.md#The update toast) owns the user-visible browser and Electron outcomes, [the update-notification UI spec](../../ui/app/update-notification/index.md) owns notification interaction and markup, and [the copy-button UI spec](../../ui/app/copy-button/index.md) owns generic copy behavior. No additional end-to-end test of the same outcomes is required here.

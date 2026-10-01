*Where channel and workspace state lives and how it stays consistent: the server-shared model — the channel record, pinning and pin order, the focused channel — what each browser keeps for itself, and the sync and convergence rules the client's state layer must satisfy.*

**Status:** implemented redesign authority. Connection lifecycle, wire vocabulary, and client-service internals retain the explicit code-authority carve-out below.

# Channel and client state (architecture)

Television's UI is a window onto state that mostly lives on the server: the channels, what each channel shows, which channels are pinned, and which one everyone is looking at. Every connected browser and the desktop app render from that shared state and see each other's changes live; only a little state is private to each browser. This document defines which state is which, the data shapes of the shared model, and the rules that keep every client consistent with the server — deliberately without prescribing how the client code is organized internally.

## What this owns

This spec owns:

- The **state inventory**: which channel and workspace state is server-shared, which is browser-persisted, and which is per-browser in-memory.
- The **shared-state contracts**: the channel wire shape, and the display state's channel fields — the focused channel and the pinned list — with their update semantics and invariants.
- The **synchronization rules**: the bootstrap snapshot, live updates, reconnect convergence, optimistic writes.
- The **client state layer's responsibilities** and the two migrations from the pre-redesign state: the server's display record (a boot buffer below) and the browser-persisted record.

It deliberately does not own:

- The layout model inside a channel — [arch/layout/index.md](../layout/index.md), exclusively.
- The user-facing behavior of channels and tab pages — [channels.md](../../product/channels.md) and [tab-pages.md](../../product/tab-pages.md) (product).
- Chrome surfaces — the channel sidebar, tab strip, and stage are `specs/ui/`'s.
- The connection lifecycle, the wire protocol's concrete vocabulary, and the client's internal decomposition — code-governed, stated in [#Code-governed carve-out](#Code-governed carve-out).

## The state inventory

Three tiers of **channel and workspace state**. Every channel and workspace fact a client renders comes from exactly one of them: ^cs-inventory

**Server-shared state** — authority on the server, persisted there, synced to every connected client:

| State | Owner |
|---|---|
| The channel list — each channel's id and name | this spec (shape below); user-facing behavior [channels.md](../../product/channels.md) |
| Each channel's layout — its ordered tab pages | [arch/layout/index.md](../layout/index.md) |
| Which channels are pinned, and their order | this spec ([below](#^cs-pinned\)) |
| The focused channel | this spec ([below](#^cs-focus\)); behavior [channels.md#^ch-focus-broadcast](../../product/channels.md#^ch-focus-broadcast) |
| The active theme (`activeThemeName`) | [theme architecture](../themes/index.md#selection-and-display-state) owns the field and its selection semantics; [theme delivery](../themes/delivery.md) owns application to client documents |
| ACP availability (`acpEnabled`) | the field remains code-authoritative under [spec-migration.md](../../spec-migration.md); no UI spec claims it |

**Browser-persisted state** — survives reloads, never leaves the browser:

| State | Owner |
|---|---|
| The server auth token | this spec (inventory and carry-forward only; auth behavior is code-governed) |
| The channel-sidebar width | this spec ([below](#^cs-sidebar-width-key\)); behavior [ui/app/index.md#^ap-sidebar-resize](../../ui/app/index.md#^ap-sidebar-resize) |
| The channel-sidebar collapsed state | this spec ([below](#^cs-sidebar-collapsed-key\)); behavior [ui/app/index.md#^ap-sidebar-collapse](../../ui/app/index.md#^ap-sidebar-collapse) |

**Per-browser in-memory state** — dies with the page:

| State | Owner |
|---|---|
| The selected tab page per channel | behavior [tab-pages.md#^tp-selection-local](../../product/tab-pages.md#^tp-selection-local); placement [below](#^cs-selection-memory\) |
| Connection status | code-governed ([#Code-governed carve-out](#Code-governed carve-out)) |

Two things are deliberately outside this inventory. **Artifact records** (titles, kinds, content pointers) are server state owned by the artifact domain, not workspace state; how the client fetches, caches, and hands them to the frame and tab surfaces is code-governed ([#Code-governed carve-out](#Code-governed carve-out)), and their user-visible freshness promises belong to the product specs (e.g. a retitle updating its tab — [tab-pages.md#^tp-label](../../product/tab-pages.md#^tp-label)). The **artifact-focus signal** is not state at all: it is a transient server nudge, not persisted and not replayed on connect, whose effect on tab selection is [tab-pages.md#^tp-focus-selects](../../product/tab-pages.md#^tp-focus-selects)'s. ^cs-outside-inventory

### The channel-sidebar width

The channel sidebar's width ([ui/app/index.md#^ap-sidebar-resize](../../ui/app/index.md#^ap-sidebar-resize)) persists under `tv-channel-sidebar-width`, following the client-storage convention ([arch/ui/index.md#^ui-client-prefs](../ui/index.md#^ui-client-prefs)): the committed width in whole pixels as its base-10 integer string, rounded to the nearest pixel on commit (ties round up). An absent key or any other stored content means no committed width; a stored integer outside the bounds applies clamped. The width is written when a commit lands, never during the drag; a failed write degrades silently to non-persistence. ^cs-sidebar-width-key

Whether the channel sidebar is collapsed ([ui/app/index.md#^ap-sidebar-collapse](../../ui/app/index.md#^ap-sidebar-collapse)) persists under `tv-channel-sidebar-collapsed`, following the same convention: the literal string `true` while collapsed. The key is removed when the sidebar opens, so an absent key — or any other content — means open, and the default needs no record. The memory is separate from the width: collapsing keeps the committed width for the reopening. A failed write degrades silently, as above. ^cs-sidebar-collapsed-key

## The shared model

The client connects to exactly one server ([channels.md#^ch-single-server](../../product/channels.md#^ch-single-server)), so nothing in these shapes is keyed by server.

```ts
type ChannelID = string; // a ULID; sorting by id is sorting by creation
                         // (identity semantics, including the caller-supplied-id
                         // gap: channels.md ^ch-identity)

// The channel fields this spec owns:
type ChannelStateFields = {
  id: ChannelID;
  name: string;
};

// The DTO clients receive intersects the owners' fields:
type Channel = ChannelStateFields & {
  layout: TabPage[];                   // owned by arch/layout
  onboarding?: OnboardingChannelMarker; // arch/onboarding/installer.md
};
```

`Channel` is the composed wire shape; this spec owns only `ChannelStateFields`, and each intersected field keeps its owner's authority ([arch/layout/index.md#^ly-model](../layout/index.md#^ly-model); [installer.md](../onboarding/installer.md), Onboarding channel marker). The stored record additionally carries the layout version ([arch/layout/index.md#^ly-stored-record](../layout/index.md#^ly-stored-record)); the version is a storage concern and does not travel to clients. ^cs-channel-shape

The model deliberately carries **no creation-time field**: creation order derives from the ULID id itself, and the unpinned channel-sidebar ordering sorts by id ([channels.md#^ch-identity](../../product/channels.md#^ch-identity), [channels.md#^ch-unpinned-order](../../product/channels.md#^ch-unpinned-order)). ^cs-no-created-field

The workspace-level **display state** carries the two channel fields this spec owns; other workspace fields — the active theme, and the ACP availability flag — ride the display state clients receive and are owned elsewhere:

```ts
// The channel-state-owned fields of the server's display state.
type ChannelDisplayState = {
  focusedChannelId: ChannelID | null;
  pinnedChannelIds: ChannelID[];
};
```

The two fields update independently: a display-state write may carry either or both, and each field's validation applies on its own. ^cs-display-partial

### Pinning

Pin state is **one ordered list of channel ids**: membership in the list is what "pinned" means, and list position is the pin order — the first entry is the beginning of the pinned group. Pinning and pin order are one user-visible fact (the pinned group as the user arranged it — [channels.md#^ch-pin-shared](../../product/channels.md#^ch-pin-shared), [channels.md#^ch-pin-order](../../product/channels.md#^ch-pin-order)), so they are one field that cannot disagree with itself. ^cs-pinned

- **Updates replace the whole list.** Pinning, unpinning, and reordering are all expressed by submitting the new list, mirroring layout updates ([arch/layout/index.md#^ly-update-replace](../layout/index.md#^ly-update-replace)). The product's placement rules — a drag lands at the dropped position, a simple pin affordance lands at the end ([channels.md#^ch-pin-placement](../../product/channels.md#^ch-pin-placement)) — are expressed by *where the gesturing client inserts the id*; the server stores and validates, and has no placement rules of its own. A remote update may land while a client's drag is in flight; the gesture-side rule is [ui/app/sidebar/index.md#^sb-drag-remote](../../ui/app/sidebar/index.md#^sb-drag-remote). ^cs-pinned-update
- **Validation:** every entry must name an existing channel, with no duplicates; a submission violating either is rejected and the stored list is unchanged. ^cs-pinned-validate
- **Deleting a channel prunes it** from the pinned list as part of the same deletion. ^cs-pinned-prune
- The list persists across server restarts, like the rest of the display state. ^cs-pinned-persist

### Focus

`focusedChannelId` is the one channel every client shows ([channels.md#^ch-focus-broadcast](../../product/channels.md#^ch-focus-broadcast)). It is `null` exactly when the server has no channels, and that is a valid state whenever it arises — for example after the user deletes the last channel (the no-channels landing, [channels.md#^ch-delete-selection](../../product/channels.md#^ch-delete-selection)). Boot-time behavior, including the default-screen invariant, is the onboarding installer's ([installer.md#^default-screen](../onboarding/installer.md#^default-screen)). ^cs-focus

The server maintains that invariant:

- **Validation:** a focus update naming an unknown channel, or setting `null` while channels exist, is rejected and the stored state is unchanged — `null` is only ever produced by the server itself when the last channel is deleted. ^cs-focus-validate
- **First channel:** creating a channel while `focusedChannelId` is `null` focuses the new channel. (Boot-time initialization is different and stays with its owners: the onboarding installer's focus rule and, for pre-redesign records, the migration buffer below.) ^cs-first-focus
- **Deletion:** when the focused channel is deleted, **the server refocuses** as part of the deletion: the successor is the first channel in the channel sidebar's order — the first pinned channel in pin order, otherwise the newest unpinned channel — or `null` when none remain, per the product rule ([channels.md#^ch-delete-selection](../../product/channels.md#^ch-delete-selection)). Computing this server-side means one writer, no multi-client race, and a correct outcome even when the deletion comes from the CLI with no clients connected. ^cs-focus-successor
- **Ordering:** a deletion that changes the pinned list or the focus announces the channel removal on the event stream first, then the resulting pin and focus changes — one deterministic order, so a connected client applying the burst ends consistent. (Artifact removals precede the channel removal — [channels.md#^ch-delete-semantics](../../product/channels.md#^ch-delete-semantics).) ^cs-delete-ordering

### Server buffer: display-state migration on boot

Server internals are outside spec authority, but this model imposes one boot behavior on the server, recorded as a buffer. It executes as a step of **the one server migration** ([arch/layout/migration.md#^one-migration](../layout/migration.md#^one-migration)); this buffer binds the semantic mapping only. The pre-redesign record's active-channel field (`activeChannelID` — the earlier name-rename step of the same migration has already run by this point) becomes `focusedChannelId` — a value naming no existing channel resolves to the channel-sidebar-first successor ([#^cs-focus-successor](#^cs-focus-successor) semantics) — the pinned list defaults to empty, and fields owned elsewhere (the active theme) are preserved. The step is idempotent: a record already in the current shape loads as-is. The record's on-disk naming and location follow the storage layout, which remains code-governed until that area migrates ([spec-migration.md](../../spec-migration.md)). ^cs-display-migration

## How state syncs

These rules bind any client implementation; the transport's concrete vocabulary is code-governed ([#Code-governed carve-out](#Code-governed carve-out)).

- **Every connection starts from a full snapshot.** On every successful connection — first connect and every reconnect — the client fetches the complete channel and workspace state (the channel list and the display state) before rendering from it, and converges on that snapshot rather than patching across the gap. Rationale: events broadcast while a client is unconnected are lost, so an event stream alone can never be trusted from cold; refetching is the only honest convergence. ^cs-converge
- **Fetches lose nothing to the stream.** This binds every fetch the client applies over live state — the bootstrap snapshot and the recovery refetch ([#^cs-optimistic](#^cs-optimistic)) alike. Events can arrive while the fetch is in flight; the response must never overwrite a newer change announced on the stream, and no such event may be dropped. The state after applying the fetch reflects every change the server delivered, whether it arrived in the response, on the stream, or both — by buffering and replaying stream events over the response, or an equivalently simple mechanism. ^cs-bootstrap-race
- **Live changes push to every client.** While connected, every change to shared state reaches every connected client through the server's event stream, without polling or reloading. ^cs-live-sync
- **Writes are optimistic but the server is the authority.** A client may apply its own write locally before the server confirms. When the server **definitively rejects** a write, the client must converge to the server's state — by rollback or refetch. An **outcome-ambiguous** failure — either the transport drops before a response or the server returns a 5xx after receiving the write, so the write may or may not have committed — must not be left to passive healing: an HTTP write can lose only its own response while the event socket stays healthy, and a server error does not guarantee an authoritative event, so no reconnect or event can be assumed. The client actively re-establishes truth by **refetching the affected state** — applied under the same no-lost-event rule as any fetch ([#^cs-bootstrap-race](#^cs-bootstrap-race)) — and converging on the result, whichever outcome the server actually took. A successful refetch settles the ambiguity. If that one read also fails, the client keeps its current projection and reports the originating write failure rather than replacing it with the secondary read failure or retrying independently. A recovery response started before a disconnect or newer complete refresh cannot overwrite the resulting full snapshot, and starting a scoped recovery during a complete refresh does not supersede or cancel that refresh. Deliberately no transaction or versioning machinery. Optimism is an allowance, not a requirement. ^cs-optimistic
- **Channel focus flows one way.** The focused channel broadcasts from the server to all clients; a client changes it only by writing the shared state, and the per-browser tab selection never broadcasts ([tab-pages.md#^tp-selection-local](../../product/tab-pages.md#^tp-selection-local)). Artifact focus is not shared state ([#^cs-outside-inventory](#^cs-outside-inventory)). The server sends this transient signal only to clients that are connected at that time. [The tab-pages selection rule](../../product/tab-pages.md#^tp-focus-selects) owns how the signal changes tab selection.
- **Focusing an artifact on another channel focuses that channel.** When an artifact-focus request names an artifact on a channel other than the focused one, the server writes the artifact's channel id to `focusedChannelId`. It persists this shared focus before sending any events. The server then announces the channel change on the event stream before it sends the artifact-focus signal. A client that applies both events in order therefore selects the artifact's page after it is already showing that channel. Focusing an artifact on the focused channel announces only the artifact-focus signal. ^cs-artifact-focus-write

## The client state layer

The client keeps one state layer between the server connection and the views. Its responsibilities:

- Hold the bootstrapped shared-state snapshot and patch it from live events ([#^cs-converge](#^cs-converge), [#^cs-live-sync](#^cs-live-sync)). Views read from this layer and never talk to the transport.
- Expose the channel list, the display state, and the focused channel's layout to the chrome surfaces.
- Hold the **selection memory**: an in-memory map of channel id → selected tab page, never persisted anywhere — not even browser-local storage. Its behavior (per-channel memory within a session, first-page landing on reload, fallback on removal) is [tab-pages.md](../../product/tab-pages.md)'s ([selection](../../product/tab-pages.md#^tp-selection-local), [tab-pages.md#^tp-selection-fallback](../../product/tab-pages.md#^tp-selection-fallback)); this spec places the state and forbids persisting it. ^cs-selection-memory
- Forward user mutations to the server API under the optimistic-write rule ([#^cs-optimistic](#^cs-optimistic)).
- Deliver the artifact records the frame and tab surfaces render. How it fetches and caches them is code-governed ([#^cs-outside-inventory](#^cs-outside-inventory), and the carve-out below); the freshness the user sees is the product specs' promise.

How the layer decomposes into services, models, and views — its class structure, caching, and rollback mechanics — is deliberately the implementer's, below.

## Migration from the pre-redesign client state

The pre-redesign client persisted a browser-local record holding a configured-server list with per-origin keying, a browser-local active-server and active-screen pointer, a per-server tab-membership list, an onboarding promotion record, per-screen scroll positions and last-activated stamps, and per-origin auth tokens. The redesign retires all of it except the auth token: ^cs-retired-state

- The configured-server list, the active-server pointer, and all per-origin keying go with the multi-server capability's removal — the client connects to exactly one server ([channels.md#^ch-single-server](../../product/channels.md#^ch-single-server)), and no server-switching UI exists.
- The browser-local active pointer goes because focus is purely shared state ([#^cs-focus](#^cs-focus)).
- The tab-membership list goes because every channel is listed in the channel sidebar and a channel's tabs are its server-owned layout ([arch/layout/index.md#^ly-server-state](../layout/index.md#^ly-server-state)); no browser chooses its own subset.
- The promotion record goes with tab promotion itself: onboarding channels appear in the channel sidebar like any other channel ([onboarding-channels.md#^no-promotion](../../product/onboarding/onboarding-channels.md#^no-promotion)). Promotion-specific behavior belongs to [arch/onboarding/index.md](../onboarding/index.md); browser-persisted state carries no promotion record.
- Scroll positions and recency stamps go with the card canvas and recency ordering.

**The upgrade is silent and keeps the user signed in:** a browser holding a pre-redesign record boots the redesigned client cleanly, its stored auth token for the server still honored; the retired fields are ignored and may be dropped. ^cs-token-carry

## Code-governed carve-out

**The connection lifecycle is deliberately code-governed.** Socket management, auto-reconnect and backoff, visibility/network wake signals, auth-rejection routing to the token screen, and disposal are carried from the shipping implementation, whose suites hold them. Slices of the connection already under other specs' authority stay theirs: the `server-status` message and unknown-message routing ([version-advertisement.md#^events-version](../updates/version-advertisement.md#^events-version), [version-advertisement.md#^unknown-messages](../updates/version-advertisement.md#^unknown-messages)), the Electron boot barrier ([desktop-upgrade-gate.md#^boot-barrier](../updates/desktop-upgrade-gate.md#^boot-barrier)), and the telemetry signals riding the socket ([client-signals.md](../telemetry/client-signals.md)). The outcomes that must hold regardless of mechanism: losing the server is a shell-wide transition ([channels.md#^ch-disconnect](../../product/channels.md#^ch-disconnect)), and reconnection converges on server truth ([#^cs-converge](#^cs-converge)). ^cs-connection-carve-out

**The transport vocabulary is deliberately code-governed — the model it carries is not.** Route names, event discriminants, and transport envelopes shared only by the server and its served web bundle are lockstep contracts, so they may change freely between releases and are not worth authority; they live in the server and shared-client code, described by the legacy network API documentation until that area migrates ([spec-migration.md](../../spec-migration.md)). Cross-release desktop identity transport, including its bounded output exception, is owned by [arch/updates/desktop-upgrade-gate.md#^pre-gate-handshake](../updates/desktop-upgrade-gate.md#^pre-gate-handshake), so no identity contract is defined by channel state. `ChannelStateFields`, `ChannelDisplayState`, and their semantics remain this spec's authority **wherever they are transported**: renaming any other route or event type is a code change, but changing these fields or their rules requires a spec change first. ^cs-wire-carve-out

**Client service internals are deliberately the implementer's.** View decomposition, the state layer's internal structure below the contracts above, and the fetching and caching of artifact records ([#^cs-outside-inventory](#^cs-outside-inventory)) are not specified, per the approved authority boundary — the same boundary the artifact frame draws ([arch/artifact-frame/index.md#^frame-core-carve-out](../artifact-frame/index.md#^frame-core-carve-out)). ^cs-internals-carve-out


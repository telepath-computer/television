*The onboarding installer: the per-data-directory onboarding state file at `state/onboarding.json` (v3 schema, migration from screen-named v2 state and the legacy sentinel), the boot-time per-channel install loop with generated artifact IDs, declared starting values for artifacts' stores, and its retry after a crash, initial one-artifact tab pages, the onboarding channel marker on the `Channel` DTO, the focus rule, and the default-channel invariant.*

**Status:** adopted installer and migration authority; implementation conforms.

# Onboarding installer

On startup, Television copies each bundled starter channel into a server's storage exactly once and leaves it under the user's control afterward. This document defines how that installation survives retries, upgrades, deletion, and missing or damaged data.

## What this owns

The server-side machinery that turns the bundled content tree ([arch/onboarding/content.md](./content.md)) into installed channels, artifacts, and initial tab pages, exactly once per channel slug per data directory ([onboarding-channels.md](../../product/onboarding/onboarding-channels.md)). When `tv` serves, the data directory is the [Television home](../../product/cli.md#^cli-home), passed to `ServerStore` as its `storagePath`; paths below are written relative to `<home>`. This spec owns the *onboarding state file*, the migrations from its v1 and screen-named v2 shapes, the install algorithm and its retry behavior, including writing the starting values artifacts declare for their stores, the *onboarding channel marker* on the `Channel` DTO, the focus rule, and the invariant that a serving boot ends with at least one channel.

## Onboarding state file

The *onboarding state file* records which onboarding channels a data directory has received. The authoritative file is `<home>/state/onboarding.json`; once it exists, the installer reads and writes only this file.

The installer **writes** only the version 3 shape (`ChannelSlug` is defined in [arch/onboarding/content.md](./content.md)):

```ts
interface OnboardingStateV3 {
  version: 3;
  channels: Record<ChannelSlug, OnboardingChannelInstallRecord>;
}

interface OnboardingChannelInstallRecord {
  installedAt: string;  // ISO 8601, when this slug's install completed
}
```

The immediately preceding release wrote this screen-named version 2 shape. It is a migration input only; current code never writes it:

```ts
interface OnboardingStateV2 {
  version: 2;
  screens: Record<ScreenSlug, OnboardingScreenInstallRecord>;
}

interface OnboardingScreenInstallRecord {
  installedAt: string;  // ISO 8601, when this slug's install completed
}
```

**Legacy sentinel.** Releases that shipped a single welcome artifact recorded their install at `<home>/state/onboarding-artifact.json`, as a version 1 payload:

```ts
interface OnboardingStateV1 {
  version: 1;
  artifactID: string;   // always "television-onboarding"
  installedAt: string;  // ISO 8601
}
```

The authoritative `onboarding.json` may initially hold version 2 and is migrated in place as described below. Only when `onboarding.json` is absent does the installer read the legacy path — it may hold the v1 payload, or a valid v2 payload — and migrate what it finds into `onboarding.json` ([Migration](#Migration)). After migration the legacy file is **left in place, untouched, indefinitely**: old server binaries gate their single-artifact install on a bare `existsSync` of that exact path, so its continued existence is what keeps a downgraded binary from reinstalling the welcome artifact. Once `onboarding.json` exists, the legacy file is never read again. ^legacy-file-kept

Both paths appear in the spec'd telemetry data-directory marker list ([server-telemetry-buffer.md](../telemetry/server-telemetry-buffer.md)) that feeds `dataDirCreated` and the install/upgrade derivation ([identity.md](../telemetry/identity.md)): the authoritative path because it is now a Television data marker in its own right, and the legacy path because existing directories may contain only it.

A slug present in `channels` whose configuration later disappears from the bundle is inert: records are never garbage-collected. An unparseable or schema-invalid state file — `onboarding.json`, or the legacy file when it is the only one present — disables installation for that boot (with a warning) rather than risking a duplicate install: the file is evidence that *something* was installed. ^invalid-state-conservative

The state file is the one place onboarding demands write rigor: it records which channels this data directory has received — including channels the user has since **deleted** — and a torn write that destroyed it would re-create deleted channels on the next boot. Every rewrite therefore goes through a temporary file in the same directory renamed into place, so the file on disk is always either the previous or the new complete version, never a truncation. ^state-file-atomic

## Migration

Migration runs inside the installer before the install loop whenever installation is enabled — **including boots where no content root resolved or the [onboarding config](./content.md#Onboarding config), `onboarding-channels.json`, is unusable**. It resolves the authoritative path before consulting the legacy sentinel: ^migration-decoupled

1. **`onboarding.json` holds a valid v3 payload** → load it and write nothing.
2. **`onboarding.json` holds a valid v2 payload** → atomically rewrite it as v3, changing only `screens` to `channels` and `version` to `3`. Every slug, record, and `installedAt` string is preserved exactly. ^migrate-v2-field
3. **`onboarding.json` exists but is invalid for both versions** → disable installation for this boot with a warning and write nothing; never fall back to the legacy sentinel. A payload mixing `screens` and `channels` is invalid rather than a merge invitation.
4. **The authoritative path is absent and the legacy file holds a v1 payload** → write `onboarding.json` as v3 with `tv-guide` marked installed, preserving the v1 `installedAt` when it is present and syntactically usable, otherwise recording migration time. The v1 payload recorded the welcome artifact that the bundle re-keyed under the `tv-guide` slug, so this is the same fact re-keyed — a fixed mapping, independent of what any later bundle ships. ^migrate-v1
5. **The authoritative path is absent and the legacy file holds a valid v2 payload** → write its `screens` records as v3 `channels`, preserving every slug, record, and timestamp. ^migrate-legacy-v2
6. **Neither state file exists, but the store contains an artifact with the legacy ID `television-onboarding`** → write `onboarding.json` as v3 with `tv-guide` marked installed (`installedAt` = migration time; no better record exists). This covers a data directory where the artifact was installed but the sentinel write was lost. ^migrate-legacy-artifact
7. **Otherwise** → nothing is pre-marked; no file simply means no channels have been received.

Every migration write uses the atomic state-file writer. Interruption before its rename leaves the complete prior v1/v2 input for retry; interruption after rename leaves complete v3 state. Loading v3 a second time is a byte-stable no-op. In every case the legacy file is left untouched ([legacy sentinel](#^legacy-file-kept)). Migration never touches the legacy artifact, its copied content under `<home>/artifacts/television-onboarding/`, or the screen it sits on.

## Install loop

The installer runs on every boot when installation is enabled. The install loop additionally requires a resolved content root and a usable onboarding config — one that parses and passes schema validation at runtime (migration runs regardless — [migration is decoupled](#^migration-decoupled)). Runtime validation stops at the onboarding config: the installer does **not** verify artifact source files up front. Sources are resolved lazily as each channel installs, so a missing source fails only its own channel ([failure containment](#^failure-containment)) and never renders the whole config unusable. Build validation makes missing sources unreachable in shipped bundles ([build validation](./content.md#^build-validation)); the lazy rule governs what actually happens when a bundle is broken anyway. ^lazy-source-resolution

For each channel in config order whose slug is **not** marked in the state file:

1. **Resolve the target channel.** If a channel with an *onboarding channel marker* ([below](#onboarding-channel-marker)) matching this slug already exists, reuse it — this is the crash-retry path. Otherwise create a new channel with the config display name, a normally generated channel ID, and the marker carrying the slug. ^channel-reuse
2. **Copy content.** For each configured artifact, copy its source into the agent artifacts directory under its [copy name](#^artifact-ids): `<home>/artifacts/<copy-name>.html` or `<home>/artifacts/<copy-name>.md` for a file artifact — the destination extension follows the source file's — and `<home>/artifacts/<copy-name>/` for a directory artifact. The copy **overwrites** whatever already exists at the destination, including an occupant of the wrong kind (a directory squatting at a file destination, or a file at a directory destination) — content for an unmarked slug is always copied fresh. This is safe because an unmarked slug's content has, with one narrow exception, never been visible to any user: the installer completes during store construction, before the server accepts connections ([bootstrap sequence](#^bootstrap-sequence)), and a slug is marked in the same boot its channel installs — so there is nothing of the user's at the destination to protect, and a file truncated by a crash mid-copy is self-healing (the slug stayed unmarked; the next boot copies it fresh). The exception is a channel whose install failed partway ([failure containment](#^failure-containment)): it is visible while unmarked, and the retry deliberately treats it as still being installed — edits made to its copied content before the retry completes are overwritten. Protection of installed content comes from the **mark**, not from skip-if-exists: once a slug is marked, its content is never touched again ([never revisited](#^marked-not-inspected)). ^copy-overwrite-unmarked
3. **Create artifacts.** For each configured artifact, in config order, create a path artifact on the target channel with a generated ID, the configured title, and its copied content's path. The installer never reuses or repairs an artifact: a retry after an interrupted attempt creates the channel's artifacts again, and the artifacts that attempt created stay where they are, without pages ([no artifact recovery](#^artifact-ids)). ^artifact-create
4. **Write declared starting values.** For each artifact that declares a store ([content.md#^onboarding-store-config](./content.md#^onboarding-store-config)), in config order, write the declared starting value to the artifact's store, as a `set` of the whole value through the resource layer, which is [the store's first write](../resources/index.md#^rs-first-write). When the declaration carries `shiftDatesFrom`, the starting value is first shifted to the installation day: every string in it, at any depth, that is a calendar date in `YYYY-MM-DD` form moves by the whole number of calendar days from `shiftDatesFrom` to the server's local calendar day when the channel installs, so the gaps between the dates stay the same. Other strings and values are unchanged. ^onboarding-store-dates

   When the write fails, log a warning naming the artifact. The store holds what the resource layer leaves after a failed first write: no value, or the starting value when the write failed after saving it ([an uncertain save](../resources/index.md#^rs-arch-uncertain-save)); the installer neither retries nor undoes the write. A declared starting value never fails its channel: the channel still installs ([onboarding-channels.md#^onboarding-store-failed](../../product/onboarding/onboarding-channels.md#^onboarding-store-failed)). Failing the channel would only make each later boot create its artifacts again. ^onboarding-store-install
5. **Set the initial pages.** Rewrite the channel's layout to one tab page per configured artifact, in artifact-list order, with each page containing that artifact's ID from step 3. The page uses the artifact entry's authored `size` and `geometry` when present and clones the corresponding shared default when absent ([initial tab pages](./content.md#^layout-config)). An unmarked slug's layout is always written **whole**: a crash that persisted artifact metadata before the layout, or left a partial page list, is healed by the full configured list and configured-or-default layout on retry. Edits made to a failed channel's pages before retry completes are overwritten, the same narrow exception the content overwrite documents ([overwrite rule](#^copy-overwrite-unmarked)). ^layout-write-unmarked
6. **Mark the slug.** Rewrite the state file ([atomically](#^state-file-atomic)) with this slug's install record added, `installedAt` = now. A slug is marked only after its channel metadata, artifact metadata, copied sources and layout are all durably written, and each declared starting value has been written or has failed as step 4 says — mark-last ordering is what lets steps 2 and 5 overwrite freely.

State is persisted after **each completed channel**, not once at the end, so a crash between channels loses at most the in-progress channel — which the next boot retries from step 1. ^per-channel-persistence

**Generated artifact IDs, copy names and no artifact recovery.** The installer gives artifacts ordinary generated IDs ([artifacts.md#^af-artifact-id](../../product/artifacts.md#^af-artifact-id)), so no artifact it installs, and no store, has an ID that can be guessed. Their copied content is named deterministically instead: its *copy name* is `television-onboarding--<channel-slug>--<artifact-slug>`, which makes installed content recognizable in storage listings and makes a retry copy over the earlier attempt's content rather than beside it. The slug rules ban `--` inside slugs so that copy names are unique ([slug rules](./content.md#^slug-rules)). Artifacts installed by earlier releases keep the IDs they were installed with.

Installing a channel does not recover its artifacts. A retry after a crash or a failure partway can leave a duplicate artifact, from the interrupted attempt, on the channel without a page, with whatever its store was given; this is accepted. The installer never looks for an earlier attempt's artifacts, so it never writes to one's store, including an artifact with a predictable ID left by an earlier release's interrupted install, which has no store ([onboarding-channels.md#^onboarding-artifact-ids](../../product/onboarding/onboarding-channels.md#^onboarding-artifact-ids)). ^artifact-ids

**Failure containment.** Any error installing a channel is logged and leaves that slug unmarked; the installer moves on and startup continues. The failed channel retries on the next boot. A missing artifact source file fails its channel (build validation makes this unreachable in shipped bundles — [build validation](./content.md#^build-validation)). Onboarding must never prevent a server from starting. ^failure-containment

**Once marked, never revisited.** A marked slug is final: after ordinary store loading, the onboarding installer does not look up, validate, repair, or rewrite any channel, artifact, layout, copied content, or store for that slug. Content changes in later releases, deletion of the channel or artifacts, and edits to copied content are all invisible to it ([onboarding-channels.md#^fire-and-forget](../../product/onboarding/onboarding-channels.md#^fire-and-forget)). ^marked-not-inspected

## Onboarding channel marker

> **Buffer note** ([arch/onboarding/index.md](./index.md)): the `Channel` type extension imposes on the un-specced shared types module; fold into the shared-client spec when it exists.

The shared `Channel` DTO carries an optional field (`ChannelSlug` is defined in [arch/onboarding/content.md](./content.md)):

```ts
interface Channel {
  id: string;
  name: string;
  layout: TabPage[];
  onboarding?: OnboardingChannelMarker; // present iff created by the onboarding installer
}

interface OnboardingChannelMarker {
  slug: ChannelSlug;
}
```

- The *onboarding channel marker* is written by the installer at channel creation ([channel reuse](#^channel-reuse)), persisted in the channel's JSON metadata file, and delivered wherever `Channel` travels (REST responses and `/events` payloads).
- **Only the installer writes the marker.** Public channel-create and channel-update requests do not accept the field: an `onboarding` property in a request body is **ignored** — the request succeeds and the channel's marker state is unchanged (absent stays absent; present stays exactly as installed, including against an attempt to remove it). Ignoring rather than rejecting keeps the API lenient — a stray field must not fail an otherwise-valid rename — while still closing the door: without this rule any client could stamp arbitrary channels as onboarding channels, colliding with the installer's crash-retry channel lookup. ^marker-api-readonly
- Version-1 stored channel records may carry an `order` number beside the slug. The one server migration drops it before serving ([arch/layout/migration.md#^ly-migration](../layout/migration.md#^ly-migration)); current storage writes, HTTP responses, and events carry only `{ slug }`. ^order-retired
- The marker is **inert metadata** everywhere except the installer's crash-retry channel reuse. Renaming, re-laying-out, and deleting a marked channel behave exactly as for any ordinary channel, and no client or other server behavior branches on it. In particular, no client consumes it to promote a channel into browser-local state. ^marker-inert
- The marker survives rename because reinstall-suppression must key on identity, not display name — the user renaming "TV Guide" must not cause a reinstall.

## Focus rule

Immediately before the install loop, the installer snapshots the *no-content-yet* condition: the store has **zero artifacts** and **every channel loaded from disk has an empty layout**. After the loop, iff that snapshot was true and the onboarding config's `focusChannel` channel exists (installed this boot or reused), the installer sets the display-active channel to it. In every other case focus is untouched. ^onboarding-focus-rule

The condition is content-based rather than "was the data directory just created" because directory creation is not a reliable fresh-install signal: a token-only store construction ([token-only construction](#^token-only-boot)) may have created the directory structure and auth token before the first real serve. That directory is pre-existing on the real first boot, but the user has never seen content — so content, not directory age, is the test. The empty-channels half of the condition covers channels a user created but never filled, and any empty "Default" left by an earlier missing-bundle boot. ^no-content-rationale

## Default-channel invariant

Television maintains the invariant that a **serving boot** ends with at least one channel (at runtime, zero channels is a valid state — a user may delete them all). With onboarding, the rule is: on a serving boot, after the install phase runs (or is skipped because the content root is missing or the config is unusable), **if zero channels exist, create an empty channel named "Default"**. The invariant does not run on token-only constructions ([token-only construction](#^token-only-boot)) — the invariant is the *only* code path that creates "Default", so a data directory that has never served contains no channels at all. ^default-screen

The fallback channel is always plain "Default", while onboarding channels are created only by the install loop with their configured names. The invariant never creates "Default" on a boot where the install loop created channels. An existing empty "Default" — left by an earlier missing-bundle serving boot or created by a user — is a channel like any other: neither removed nor renamed.

## Bootstrap ordering and telemetry silence

> **Buffer note** ([arch/onboarding/index.md](./index.md)): this section imposes on the un-specced `ServerStore` bootstrap and storage `state/` directory; fold into the server architecture spec when it exists.

`ServerStore` construction options replace the single-artifact options:

```ts
interface ServerStoreOptions {
  // ...existing options...
  onboardingContentPath?: string;     // root of the bundled onboarding-channels tree, when one resolved
  installOnboardingChannels?: boolean; // default false = non-serving construction; `tv serve` always passes true
}
```

`storagePath` is resolved to an absolute path at construction — every path the store derives from it (copy destinations, persisted artifact metadata, state files, watchers) is independent of the process working directory. The CLI resolves a relative `--home` to an absolute path before it constructs the store ([home selection](../../product/cli.md#^cli-home-selection)), so a relative `storagePath` reaches the store only from a direct caller. ^storage-path-absolute

The bootstrap sequence for a **serving** boot is: ^bootstrap-sequence

1. Capture `dataDirCreated`, which is true when the home holds no prior serving evidence as [identity.md](../telemetry/identity.md) defines it, before anything below writes state — required by telemetry boot derivation. Empty storage directories, an auth token, or a config file created before this boot are not serving evidence.
2. Run the one ordered server migration ([arch/layout/migration.md#^one-migration](../layout/migration.md#^one-migration)) before ordinary bootstrap creates or loads current storage, then ensure storage directories, load or create the auth token, load channel and artifact metadata, rebuild the artifact-to-channel index, and load the [resource layer](../resources/index.md#^rs-bootstrap).
3. Snapshot the no-content condition for the focus rule.
4. Run onboarding state migration, then the install loop (when a content root resolved and the onboarding config is usable).
5. Apply the default-channel invariant.
6. Apply [bundled-theme handling](../themes/bundled-installation.md#serving-boot-installation), then scan the theme registry.
7. Load or initialize display state. If the bundled-theme state says the one-time default-theme decision is pending and Clouds has been handled, assign valid installed Clouds only when `activeThemeName` is null, preserve any non-null value for the decision, and record completion. Then persist `activeThemeName: null` when a non-null value is absent from the registry, and apply the focus rule.
8. Start the ordinary content and theme watchers.

A **token-only (non-serving) construction** — the path `tv serve --persist` uses to read or create the auth token before installing the daemon, and any other store construction that will not serve — captures step 1 and performs only step 2's ordinary directory, token, and metadata setup; it does not run the pre-serve migration. It creates the directory structure and token but **no channels, no display state, and no onboarding install**. Default-channel setup belongs exclusively to the [default-channel invariant](#^default-screen) on serving boots; a token-only construction must not leave a phantom channel behind for the first real serve to find. ^token-only-boot

The installer runs **inside the constructor, before telemetry hooks attach**, so onboarding channel/artifact creation emits no CRUD telemetry — intentional: installs are server-generated, not user actions ([no install telemetry](../../product/onboarding/onboarding-channels.md#^no-install-telemetry)). The `dataDirCreated` capture (step 1) and install/upgrade derivation ([identity.md](../telemetry/identity.md)) are untouched: the state-file path stays on the marker list, and the installer runs after that capture. ^telemetry-silence

## Testing

Installer behavior during `ServerStore` construction is proven with a real `ServerStore` and a real temporary filesystem. Marker delivery is proven against a running server with real HTTP and websocket clients. Only the product spec's acceptance proves the path from the CLI into `ServerStore` with a real CLI and a real `ServerStore` ([onboarding-channels.md](../../product/onboarding/onboarding-channels.md)). Checks that begin with `ServerStore` construction include no real or mocked CLI.

The atomic state-file writer is proven on the real filesystem when a rewrite succeeds and when a failed rewrite leaves the prior authoritative file intact. The exact moment between writing the temporary file and renaming it is not tested. This is an explicit exception under [the spec policy](../../spec-policy.md#Specific specs may state exceptions).


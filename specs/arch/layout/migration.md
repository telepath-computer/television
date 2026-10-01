*The server migration: the one boot-time migration that carries a stored data directory across everything the redesign changes on disk — the screen-to-channel names, the version-1 card-tree layouts flattened into version-2 tab pages, the onboarding marker slimmed to its slug, the redesigned display record, the page-size backfill, and the required appearance preference.*

**Status:** adopted redesign migration authority; the server migration and its suites conform.

# The server migration

Television's first layout model stored each channel's arrangement as a tree of cards; the redesign replaces it with an ordered list of tab pages, and changes the display record and channel metadata alongside it. This spec pins exactly what the old formats are, how they convert, and whose job the conversion is — the server's, at boot — so upgrading never strands or corrupts anyone's stored channels.

## One migration

**There is exactly one server-side migration for the redesign.** Every change the redesign makes to what the server stores on disk happens inside it, as ordered steps of a single boot-time pass — never as independent migrations whose relative timing could interact:

1. The storage names: `state/screens/` becomes `state/channels/`, and the display record's `activeScreenID` field becomes `activeChannelID` ([below](#screen-to-channel-storage-name-migration)).
2. Each channel record: the version-1 card-tree layout flattens to version-2 tab pages ([The mapping](#the-mapping)), the version field is written, and the onboarding marker slims to its slug.
3. The display record: the redesign's fields arrive — the pinned list initialized empty, and `activeChannelID` becomes `focusedChannelId` with the dangling case resolved — with the field semantics owned by [arch/channel-state/index.md#^cs-display-migration](../channel-state/index.md#^cs-display-migration).
4. The size backfill: any version-2 page without `size` — a record stored before pages carried sizes, or one step 2 just produced — gets the shared default size ([arch/layout/index.md#^ly-page-size](./index.md#^ly-page-size)); a page already carrying one is untouched. No version bump is spent on the field: the step keys off the missing field, not the version. ^mig-size-backfill
5. The appearance backfill: an otherwise-valid current display record without `appearanceMode` gains `appearanceMode: "system"`. The atomic rewrite preserves focus, pins, active theme, and every other sibling. A record that already carries a valid appearance mode is current and remains byte-for-byte unchanged. A present invalid mode is not migration input; the strict display loader treats that complete record as invalid and initializes fresh display state. ^mig-appearance-backfill

The pass leaves artifact registry records, artifact content, and theme files byte-for-byte unchanged.

The steps run in this order, each is individually idempotent and skips work already done — a directory at any intermediate state (for example one where only the name step has run) passes through the completed steps — and the whole pass completes before the server serves. The one-time initial Clouds selection is not a migration step: it requires the installed-theme registry and runs later in the [serving bootstrap sequence](../onboarding/installer.md#^bootstrap-sequence), under the [bundled-theme state](../themes/bundled-installation.md#default-theme-selection). The migration may be organized as functions per step; what is singular is the entry point, the ordering, and the completion. The browser's own persisted-record migration is deliberately separate and independent — it runs in the client and cannot be sequenced with a server boot ([arch/channel-state/index.md](../channel-state/index.md)). ^one-migration

Every channel or display record rewrite is atomic at the file boundary. At any interruption, each record is either the complete input or the complete output; records completed earlier in the pass remain valid, untouched records remain retryable inputs, and no partial JSON becomes authoritative. Any migration failure stops boot before serving. A later boot resumes from the mixed completed/input state and converges without rolling completed records back. ^mig-record-atomic

## What this owns

This spec owns the **one server migration** — its steps, their order, and the boot obligation — including the **version-1 stored format** and the **version-1-to-2 mapping**. The current model and stored shape — version 2 — are [arch/layout/index.md](./index.md)'s; the display record's field semantics are [arch/channel-state/index.md](../channel-state/index.md)'s.

The shipped onboarding bundle is not a stored-data migration input. Its use of the `artifacts` array as page order arrives with the built bundle and is owned by [arch/onboarding/content.md#^layout-config](../onboarding/content.md#^layout-config) and [arch/onboarding/installer.md#^layout-write-unmarked](../onboarding/installer.md#^layout-write-unmarked). This migration owns only the old channel record it encounters on disk, including removal of `order` from that record's onboarding marker. The onboarding state file's screen-named version-2-to-3 migration remains [arch/onboarding/installer.md#^migrate-v2-field](../onboarding/installer.md#^migrate-v2-field)'s.

## Version 1: the card-tree format

Version 1 arranges a channel's artifacts as a strip of **cards** — each card spanning units of a 4-wide-by-6-high grid — optionally composed into rows and stacks. The stored tree, exactly as the shipping code persists it: ^ly-legacy-format

```ts
type LegacyCardNode = { type: "card"; artifactID: string; width: number | "auto"; height: number | "auto" };
type LegacyRowNode = { id: string; type: "row"; height: number | "auto"; children: LegacyCardNode[] };
type LegacyStackNode = { id: string; type: "stack"; children: Array<LegacyCardNode | LegacyRowNode> };
type LegacyLayoutNode = LegacyCardNode | LegacyRowNode | LegacyStackNode; // a channel stores LegacyLayoutNode[]
```

The top-level list and a row's children read left to right; a stack is the vertical container, its children reading top to bottom.

Version 1 never stored a version field, so a stored channel record without `layoutVersion` is a version-1 record ([arch/layout/index.md#^ly-stored-record](./index.md#^ly-stored-record)).

## The mapping

The migration flattens the tree: ^ly-migration

- **One one-artifact tab page per artifact.** Every artifact in the version-1 layout becomes its own page with `geometry: { kind: "single", full_screen: false }`.
- **Only spatial traversal order is preserved:** left to right, with vertical containers read top to bottom. No old sizes, composition, or scroll positions carry over — the migration is allowed to lose information, deliberately.
- **No channel creation-time field is introduced or backfilled.** Ordering derives from the channel id itself ([channels.md](../../product/channels.md)). (The migration does write the versioned record — that is the format change itself, not a backfill.)
- **The onboarding marker slims to its slug.** A record carrying an onboarding channel marker keeps it, but the marker's `order` field is dropped in the same rewrite: nothing reads it because the redesign has no browser tab-promotion pass, and the version-2 record stores the marker as slug only ([arch/onboarding/installer.md](../onboarding/installer.md), Onboarding channel marker).
- **The change is silent in-product.** No migration notice or announcement surface exists; the redesign is described in the Discord announcement instead.

## The server runs the migration, at boot

Server internals are outside spec authority, but the migration imposes one obligation on the server, recorded here as a buffer (the pattern telemetry and onboarding use). The obligation is explicit: **the server performs the one migration ([#^one-migration](#^one-migration)), during boot, as part of loading stored state — before it serves.** A server that loads a version-1 channel record migrates it to version 2 and persists the result; a record already at version 2 loads as-is. The migration is idempotent, and no other component performs it — clients never see a version-1 layout. Downgrade is not supported ([arch/layout/index.md#^ly-stored-record](./index.md#^ly-stored-record)). ^ly-boot-migration

## Testing

The complete migration is verified in two ways. The first starts a built `tv serve` process and drives it with real HTTP and WebSocket clients that authenticate to the server. The second uses a real browser to load the production web bundle from that server. Both start from authored pre-redesign stored records and do not replace any production mechanism.

Atomic record writes and retry after failure are verified by making file replacement fail through real filesystem state. The record writers are not replaced.

## Screen-to-channel storage-name migration

This section is the name step — step 1 of the one migration ([#^one-migration](#^one-migration)): the server metadata directory and the display-active field. The step changes names only — no record value, layout, ordering, focus behavior, or generated identity. The old spellings below name migration inputs; current writes use only channel spellings. (The browser's local-state field spellings changed alongside this step historically, but the finished client does not need that transformation: it reads the auth token — whose key never changed — and ignores every retired field under either spelling; the client's migration is [arch/channel-state/index.md](../channel-state/index.md)'s.) ^rn-storage-scope

### Server metadata directory

The server migrates `<home>/state/screens/` to `<home>/state/channels/` in the [Television home](../../product/cli.md#^cli-home) it serves before it creates current storage directories, loads metadata, initializes display state, installs onboarding content, or starts watchers. Detection therefore observes the directory state left by the previous process rather than a newly-created empty `channels/` directory. ^rn-directory-order

The cases are exhaustive:

1. **Neither directory exists:** create `state/channels/` through ordinary current bootstrap.
2. **Only `state/screens/` exists:** atomically rename that directory to `state/channels/` on the same filesystem, whether it is empty or populated.
3. **Only `state/channels/` exists:** use it and write nothing for migration.
4. **Both exist, legacy non-empty and current empty:** atomically replace the empty current directory with the legacy directory, preserving every legacy entry and byte.
5. **Both are non-empty:** stop boot with a conflict error naming both paths and write nothing. Records are never merged or selected by guesswork.
6. **Both exist and the legacy directory is empty:** atomically remove the empty legacy directory and use the current directory. This includes the both-empty case.

A directory is non-empty when it contains any entry, including an unrecognized or dot-prefixed entry; migration never interprets entries to decide whether one may be discarded. Same-filesystem rename is the commit point for a directory move. In case 6, removal of the confirmed-empty legacy directory is the commit point; if removal fails, boot stops before any current-state write. A process interrupted before the applicable commit point leaves the legacy path for the next boot to retry; one interrupted after it leaves only the current path, which is already complete. No copy/delete fallback for a populated directory is permitted. ^rn-directory-cases

Channel metadata filenames, file bytes, opaque IDs, names, onboarding markers, and card-tree layouts are unchanged by the directory move. In particular, this migration does not add `layoutVersion`, flatten a tree, or perform any part of the version-1-to-2 mapping. `dataDirCreated` detection treats a populated legacy directory as prior serving evidence before the move, so an upgrade is never misclassified as a fresh installation. After migration, every metadata read and write selects `state/channels/`; `state/screens/` is recognized only by this boot migration. ^rn-directory-preservation

### Display state field

The shipping display record remains at `state/display.json`. Its current persisted shape names the active workspace with `activeChannelID`; the value remains the same opaque ID or `null`, and every sibling field — including `activeThemeName` — retains its value.

On boot, before display state is loaded or initialized:

- a valid record carrying only `activeScreenID` is rewritten with that key replaced by `activeChannelID`;
- a valid record carrying only `activeChannelID` is current and is not rewritten;
- a record carrying both keys with equal values is normalized to the current key only;
- a record carrying both keys with different values is a conflict: boot stops and the file is unchanged rather than guessing which focus value wins.

The rewrite constructs the complete next JSON value first, writes it to a temporary file beside `display.json`, and atomically renames the temporary file into place. A failure before rename leaves the previous complete file authoritative and retryable; a failure after rename leaves the complete current file. A stale migration temporary file is never treated as display state and may be replaced on retry. Applying migration to current state is a byte-stable no-op. Current code never writes `activeScreenID`. ^rn-display-field

This is a field-name migration, not focus repair. A string value is preserved even when it does not name loaded metadata, because the shipping loader already owns how such a value behaves; the rename does not introduce channel-existence validation or a new successor rule. Invalid JSON and invalid sibling-field shapes retain the shipping loader's existing handling rather than becoming a new migration format. ^rn-display-behavior


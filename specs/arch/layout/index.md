*The layout architecture: the data model for what a channel shows — its ordered tab pages — plus the stored format's versioning and the semantics of layout updates; the migration from version 1 is [arch/layout/migration.md](./migration.md)'s.*

**Status:** implemented redesign authority.

# Layout (architecture)

Every channel remembers what it is showing: which artifacts are open and how they are arranged. This document defines the data that carries that memory — the shape it takes in server state, how it changes when artifacts come and go, and how existing installations' stored arrangements are converted when a server with this model first boots. It is the durable core the redesigned UI renders from.

## What this owns

This spec owns the **layout data model** — the `TabPage` list and its types — its **stored-format versioning**, and the **semantics of layout updates**. It deliberately does not own:

- The version-1 format and the migration from it — its companion, [arch/layout/migration.md](./migration.md).

- How pages look and move — sizing, full-screen, selection, reordering gestures — which is the stage's ([ui/app/stage/index.md](../../ui/app/stage/index.md)).
- The user-facing promises of channels (identity, creation, deletion, pinning, focus) — [channels.md](../../product/channels.md) (product) — or of tab pages — [tab-pages.md](../../product/tab-pages.md) (product).
- Frame lifecycle — what survives moving around the app — [arch/artifact-frame/index.md](../artifact-frame/index.md).
- Server internals beyond the migration buffer its companion states ([arch/layout/migration.md#^ly-boot-migration](./migration.md#^ly-boot-migration); per the authority boundary, [spec-migration.md](../../spec-migration.md)).

## The model

A channel's layout is an ordered list of tab pages: ^ly-model

```ts
type TabPage = {
  artifactIds: ArtifactID[];
  geometry: PageGeometry;
  size: PageSize; // reference pixels; every page carries one
};

type PageGeometry = SinglePageGeometry; // later milestones add other `kind`s

type SinglePageGeometry = {
  kind: "single";
  full_screen: boolean;
};

type PageSize = {
  width: number;  // reference CSS pixels; fractional permitted, finite, positive
  height: number;
};
```

(`ArtifactID` is an artifact's id string.)

`size` is the page's size in **reference pixels** — the size the page renders at when the stage's page box equals the reference page box ([ui/app/stage/index.md](../../ui/app/stage/index.md), The size). One client-independent pair is sufficient: what renders from it on any stage is that spec's formula. Every page carries a size — the model has no sizeless page — and the **shared default size** is the stage's authored initial, [ui/app/stage/measures.yml#page.initial_width_px](../../ui/app/stage/measures.yml#page.initial_width_px) by [ui/app/stage/measures.yml#page.initial_height_px](../../ui/app/stage/measures.yml#page.initial_height_px). `size` sits on `TabPage`, not inside geometry, because the page's box outlives arrangement kinds. ^ly-page-size

`artifactIds` is the ordered artifact membership of the page. Stage 1 creates one-artifact pages and `single` uses `artifactIds[0]`; it does not repeat that id inside geometry. A later milestone may add geometry kinds that arrange more entries by their positions in `artifactIds`. Geometry evolves; the `TabPage` container and artifact-membership field do not. ^ly-membership

The one-artifact-per-page limit is a stage-1 UI-layer constraint, not a property of this model: the container already holds multiple artifacts so that later milestones extend `PageGeometry` without touching stored membership. ^ly-not-narrowed

`full_screen` is a mode over the page's size, not a size of its own: `true` shows the page at the stage's complete page box, and leaving the mode returns to what `size` renders ([ui/app/stage/index.md](../../ui/app/stage/index.md), Full-screen). Entering and leaving the mode never changes `size`. ^ly-fullscreen-mode

There is no stage-1 pane tree, stored split ratio, page-splitting operation, or unnamed multi-artifact placeholder. Later layout kinds and their interactions are stage-2 work; they extend `PageGeometry` when their actual requirements exist. ^ly-no-splits

## Where layout lives

Layout is server state, synced to all clients — the redesign changes the semantics of layout, not the location of authority. Page order, membership, geometry, and size are shared; what is *selected* in a given browser is deliberately not stored here (per-browser and ephemeral — [tab-pages.md](../../product/tab-pages.md)). ^ly-server-state

## Layout updates

- **A layout update replaces the channel's whole page list.** Reordering pages and changing `full_screen` or `size` are expressed by submitting the new list; there are no finer-grained layout operations in stage 1. ^ly-update-replace
- **A layout update rearranges pages; it never regroups them.** The submitted list must contain exactly the current pages — each page's ordered `artifactIds` preserved as a unit — in any order, in either `full_screen` state, and at any valid size. Every artifact in the current layout therefore appears exactly once across the list; a submission that splits or merges pages, duplicates or drops an artifact id, or names an unknown one is rejected. Membership changes only through artifact creation and deletion — this keeps the layout API unable to orphan, invent, or silently group artifacts. ^ly-update-membership
- **Creating an artifact appends a page.** A new artifact creates a new tab page at the end of the list whose `artifactIds` contains only that artifact, whose geometry is the shared default, and whose `size` is the shared default size ([#^ly-page-size](#^ly-page-size)). ^ly-create-appends
- **Deleting an artifact removes it from its page**; a page left with no artifacts is removed from the list. (Stage-1 pages hold one artifact, so deletion removes the page.) ^ly-delete-removes
- **Validation:** a submitted layout must parse against the versioned shape — a well-formed page list, each page with non-empty `artifactIds`, a known geometry `kind`, and a `size` with both axes finite and positive. There is no ceiling on a size: an oversized value clamps at render, never at the API. There is no split-page validation because there are no split pages. ^ly-validation

## Stored format and versioning

This spec owns two fields of a channel's stored record — the layout and a **layout version** migrations key off. Every other stored channel field (the id, the name, the onboarding marker) belongs to its own owning spec and composes alongside, untouched by layout evolution. Pin state is not a channel-record field at all: it lives in the separate display record ([arch/channel-state/index.md#^cs-pinned](../channel-state/index.md#^cs-pinned)), outside layout migration entirely: ^ly-version

```ts
// The layout-owned fields of a channel's stored record.
type StoredChannelLayout = {
  layoutVersion: 2; // this spec's model is the second major layout iteration
  layout: TabPage[];
};
```

A version-2 record stored before pages carried sizes may lack `size`; the one server migration backfills such pages to the shared default size at boot ([arch/layout/migration.md#^mig-size-backfill](./migration.md#^mig-size-backfill)). The live model and the wire always carry `size`. ^ly-size-normalize

A stored channel record **without** the `layoutVersion` field is assumed to be **version 1**: this model is the second major product iteration on layout, and version 1 — the card/row/stack tree — simply never stored a version field. Version-1 records are migrated on load; the version-1 format and the migration are [arch/layout/migration.md](./migration.md)'s. Downgrade is not supported: an older server reading versioned records is out of scope, with no promised behavior. A new server must be able to migrate old versions of the state file. ^ly-stored-record

## Migration from version 1

The version-1 card-tree format, the mapping that flattens it into this model, and the server's obligation to run that migration during boot are [arch/layout/migration.md](./migration.md)'s.

## Testing

Tests run a server with a real temporary data directory. They send layout updates through a real HTTP client and observe channel events through a real WebSocket client. They do not replace any production mechanism or use a test hook. Tests verify membership preservation from an authored, valid version-2 channel record that contains a page with multiple artifacts. They use an authored record because the stage-1 API cannot create such a page.


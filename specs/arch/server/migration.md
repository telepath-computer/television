*How a serving boot upgrades screen directories, card layouts and display records without losing a workspace after an interrupted upgrade.*

# Workspace storage migration

Before opening the workspace, a serving server brings older homes to the current [channel layout](../layout/index.md) and [display model](../channel-state/index.md). It applies the conversions below in order, in one pass. They change channel and display metadata only. Artifacts, their files and installed themes survive byte-for-byte. The upgrade is silent in the app. ^one-migration

Each record replacement is atomic. A migration failure stops boot before service. On the next boot, resume from the complete records already on disk, leaving completed steps alone. An already-current record is byte-stable. ^mig-record-atomic

## Screen-to-channel storage-name migration

Inspect `state/screens/` before ordinary bootstrap can create `state/channels/`. If only the current directory exists, use it. If neither exists, ordinary bootstrap creates it. ^rn-directory-order

When only the legacy directory exists, atomically rename it to the current name. A populated legacy directory can also replace an empty current directory by same-filesystem rename. If both are populated, refuse to start and name both paths. If both exist and the legacy directory is empty, remove it and use the current directory. Any entry counts, including a hidden or unrecognized file. A failure to rename or remove stops boot. These rules preserve the directory as a unit even across an interrupted boot. ^rn-directory-cases

In `state/display.json`, rename `activeScreenID` to the intermediate name `activeChannelID`, preserving the ID or null and the other fields. When both keys exist and agree, retain just the latter. When they disagree, stop with the conflicting file intact. Leave an absent legacy key alone. Temporary files from interrupted rewrites never count as display state. Channel existence is checked in the later focus conversion. ^rn-display-field

## Version 1 channel layouts

A channel record without `layoutVersion` holds a version 1 layout, an array of these nodes. ^ly-legacy-format

```ts
type LegacyCardNode = { type: "card"; artifactID: string; width: number | "auto"; height: number | "auto" };
type LegacyRowNode = { id: string; type: "row"; height: number | "auto"; children: LegacyCardNode[] };
type LegacyStackNode = { id: string; type: "stack"; children: Array<LegacyCardNode | LegacyRowNode> };
type LegacyLayoutNode = LegacyCardNode | LegacyRowNode | LegacyStackNode; // a channel stores LegacyLayoutNode[]
```

Flatten the layout in reading order, left to right in each list or row, top to bottom in a stack. Write version 2 with one page per artifact, `geometry: { kind: "single", full_screen: false }`. Preserve artifact order and IDs. Old sizes, groupings and scroll positions do not carry over. Retain an onboarding marker’s slug and drop its `order`, including on version 2 records that still carry it. Channel creation order still derives from the ID. ^ly-migration

## Display and page defaults

1. Convert `activeChannelID` to `focusedChannelId`, resolving a null or dangling ID by the [focus successor rule](../channel-state/index.md#^cs-focus-successor). Initialize the pinned list to empty and preserve the active theme. A display record already in the current shape skips this conversion. ^cs-display-migration
2. Give any version 2 page missing `size` the [shared default size](../layout/index.md#^ly-page-size), including pages just converted from version 1. This field backfill keeps the layout version. ^mig-size-backfill
3. An otherwise-valid display record missing `appearanceMode` gains `"system"`, preserving its other fields. A present invalid mode goes to ordinary invalid-display handling. [Default theme selection](../themes/bundled-installation.md#default-theme-selection) needs the installed registry and takes place later during serving bootstrap. ^mig-appearance-backfill

## Testing guidance

Start from authored pre-redesign records. Exercise the built `tv serve` with authenticated HTTP and WebSocket clients, and load its production interface in a real browser. Use real filesystem replacement failures to verify atomic rewrites and retry after interruption.

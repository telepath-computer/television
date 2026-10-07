# Markdown table editor fork

This directory contains a narrow fork of the ESM distribution and declarations from `codemirror-markdown-tables` 1.0.0. Television retains its interactive table UI while preventing autonomous source edits during loading, rendering, selection, navigation, remote updates, and rollback. Undo and redo apply editing history without additional formatting. Ordinary cell edits replace changed raw spans; explicit structural edits may serialize the table canonically. Both preserve surrounding text.

Upstream: https://github.com/ckant/codemirror-markdown-tables

The npm registry's `gitHead` for version `1.0.0` is [`f883be3bfb93f6ceec36901f46cb0feabb1b1c47`](https://github.com/ckant/codemirror-markdown-tables/commit/f883be3bfb93f6ceec36901f46cb0feabb1b1c47). This is the published release's recorded source revision. The fork copies the npm distribution rather than rebuilding that revision; the archive integrity and distribution hash below identify the bytes used.

The original npm archive is `https://registry.npmjs.org/codemirror-markdown-tables/-/codemirror-markdown-tables-1.0.0.tgz`, with integrity `sha512-G4AbevRxeVRCOXQ3aNbSNpTuh1+5e9DoBCQ4WGhwYQwlVrUp/BkPDSjCgbUir1I7XQ0v6iJsEC4DTPQD+qXXDw==`. Its unmodified `dist/codemirror-markdown-tables.js` has SHA-256 `945abf04fa56ddecb2457fb063df361beeadd0ef1ad31081d2c3095a4ee83158`. `index.d.ts` is copied unchanged.

The upstream distribution embeds Svelte and Runed implementations. Their exact patch versions are not recorded in the distribution; its package manifest declares development ranges beginning with Svelte 5.48.2 and Runed 0.37.1. The corresponding upstream MIT notices are retained beside the editor's original `LICENSE`, and all three components are registered in `scripts/licenses/assets.json` for shipped notices.

## Behavioral changes

- Loading, rendering, cursor movement, and cell selection no longer format the table or repair blank lines around it. Remote updates and rejected-save rollback do not trigger a replacement save.
- Tab, Shift-Tab, and Enter at table edges leave the table rather than inserting rows. Row insertion remains an explicit editing operation.
- Ordinary cell edits replace only changed source spans, preserving other cells, whitespace, overflow cells, and edge `<br>` content. Alignment edits replace the separator; structural operations and full-table paste retain upstream canonical serialization and may normalize or discard that extra content.
- Cursor positions and undo/redo use original cell spans, including escaped pipes and ragged rows, rather than offsets into a reformatted table.
- Newly parsed tables render without requiring canonical formatting or a caret move. Incremental parsing can still briefly delay rendering in long documents; nested blockquote/list table support is unchanged.

The display adapter in `../../table-links.ts` renders clickable links while retaining the fork's source DOM and source offsets. The ordered-list transaction filter in `../../markers.ts` preserves remote-update/save-suppression annotations. These integration changes live outside the copied distribution.

The durable behavior contract is the [Markdown table buffer](../../../../../specs/arch/artifact-frame/markdown-tables-buffer.md).

## Localized distribution changes

The localized changes in `index.js` are:

- Import the readable, typed raw-source position mapper in `../../source-table.ts`.
- Omit seven upstream lint suppression comments that are obsolete or refer to rules unavailable in Television; this does not change runtime behavior.
- `pi` (table description): retain raw cell spans alongside the normalized display model, use them for source selections, preserve explicit active-cell identity when missing cells share a source offset, and reset structural history dimensions before rebuilding mapping/selection, and reset synchronization to the normalized in-memory baseline after undo. Explicit cell intent takes precedence over the hidden-selection sentinel.
- `Ti` (widget): map coordinates and selection-only synchronization through raw spans; write only actual model changes into the exact table span. Cell edits with unchanged dimensions replace changed raw cell spans, retaining overflow cells, edge breaks and other cells; alignment edits replace the separator. Structural changes retain upstream canonical serialization.
- `as` (table discovery): render noncanonical source directly. The automatic `If` formatter and `Pf` boundary-correction filter are no longer installed.
- `mo` (cell navigation): leave the table at its edges instead of creating rows. Explicit row menus remain available.
- `Lf`/`Of` (root selection navigation): use raw source cell spans. Boundary exits and `Hf` mixed selections clamp to document bounds.

The remaining UI and embedded runtime code is upstream distribution code. Keeping that distribution avoids adding a Svelte build pipeline for this limited correction. To update it, obtain the exact new upstream archive, compare these regions against its implementation, apply only the still-needed changes, and run the source-preservation, table, link, and marker browser suites. Refresh provenance and notices when the upstream payload changes. A broader UI rewrite should use upstream source rather than extending the bundled runtime here.

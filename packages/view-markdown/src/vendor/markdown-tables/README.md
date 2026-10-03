# Markdown table editor fork

This directory contains a narrow fork of the ESM distribution and declarations from `codemirror-markdown-tables` 1.0.0. Television retains its interactive table UI while keeping source unchanged during loading, rendering, selection, navigation, remote updates, undo, and rollback. Actual cell and structural edits may serialize the table itself; surrounding text is preserved.

Upstream: https://github.com/ckant/codemirror-markdown-tables

The original npm archive is `https://registry.npmjs.org/codemirror-markdown-tables/-/codemirror-markdown-tables-1.0.0.tgz`, with integrity `sha512-G4AbevRxeVRCOXQ3aNbSNpTuh1+5e9DoBCQ4WGhwYQwlVrUp/BkPDSjCgbUir1I7XQ0v6iJsEC4DTPQD+qXXDw==`. Its unmodified `dist/codemirror-markdown-tables.js` has SHA-256 `945abf04fa56ddecb2457fb063df361beeadd0ef1ad31081d2c3095a4ee83158`. `index.d.ts` is copied unchanged.

The upstream distribution embeds Svelte and Runed implementations. Their exact patch versions are not recorded in the distribution; its package manifest declares development ranges beginning with Svelte 5.48.2 and Runed 0.37.1. The corresponding upstream MIT notices are retained beside the editor's original `LICENSE`, and all three components are registered in `scripts/licenses/assets.json` for shipped notices.

The localized changes in `index.js` are:

- Import the readable, typed raw-source position mapper in `../../source-table.ts`.
- Omit seven upstream lint suppression comments that are obsolete or refer to rules unavailable in Television; this does not change runtime behavior.
- `pi` (table description): retain raw cell spans alongside the normalized display model, use them for source selections, preserve explicit active-cell identity when missing cells share a source offset, and reset structural history dimensions before rebuilding mapping/selection, and reset synchronization to the normalized in-memory baseline after undo. Explicit cell intent takes precedence over the hidden-selection sentinel.
- `Ti` (widget): map coordinates and selection-only synchronization through raw spans; write only actual model changes into the exact table span. Cell edits with unchanged dimensions replace changed raw cell spans, retaining overflow cells, edge breaks and other cells; alignment edits replace the separator. Structural changes retain upstream canonical serialization.
- `as` (table discovery): render noncanonical source directly. The automatic `If` formatter and `Pf` boundary-correction filter are no longer installed.
- `mo` (cell navigation): leave the table at its edges instead of creating rows. Explicit row menus remain available.
- `Lf`/`Of` (root selection navigation): use raw source cell spans. Boundary exits and `Hf` mixed selections clamp to document bounds.

The remaining UI and embedded runtime code is upstream distribution code. Keeping that distribution avoids adding a Svelte build pipeline for this limited correction. To update it, obtain the exact new upstream archive, compare these regions against its implementation, apply only the still-needed changes, and run the source-preservation, table, link, and marker browser suites. Refresh provenance and notices when the upstream payload changes. A broader UI rewrite should use upstream source rather than extending the bundled runtime here.

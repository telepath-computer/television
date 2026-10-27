# Bundled Table plan

Table is being brought into the bundled artifact-template inventory from the installed Table and the MozFest demo copy. The architecture and UI specs in this change are drafts for Rupert to decide. The implementation remains read-only and preserves the current Table behaviour.

## Decisions not settled by the existing sources

- Use the bundled-template package shape: separate `index.html`, `styles.css`, `page.js`, and a small `model.js` with declarations. This makes the data rules independently testable without changing the page behaviour.
- Subscribe to the whole store rather than only `rows`. This lets the page distinguish an unreadable whole value, recover when it is repaired, and follow the standard bundled-template error and reconnection behaviour.
- Use the standard unreadable-data alert and copy used by the other bundled templates: “This table can't be shown” and “Its saved data isn't in the form this page reads. Ask your agent to check it.” A `no-store` error after access is revoked retains the last table. Saved-data unavailability shows the alert. A connection loss retains the last table without a message, and the page listens again after reconnection.
- Declare the narrowest schema that matches the current store: the root requires an object-valued `rows`; every row requires numeric `order`; other row fields remain unconstrained cells, and extra root fields remain allowed. The page still performs its full runtime check because later writes are not schema-validated.
- Keep the shared default artifact display by omitting `display`, matching the current Table manifest and the bundled Calendar convention.
- Normalize the icon manifest entry to `{ "src": "icon.svg", "type": "image/svg+xml" }`, omitting the redundant `sizes: "any"` from the installed copy, as the other bundled templates do.
- Keep the existing first-party Table Toolbox icon. Use Television canonical `tv-icon` elements for page controls and states instead of copying SVG glyph bytes. Table therefore introduces no third-party asset and needs no licensing inventory or notice change.
- Do not package the old thumbnail. Bundled artifact templates do not use thumbnails.
- Keep columns implicit in row cells. Do not add persisted column definitions, labels, widths, or types.
- Specify these independent visual states in Storybook: rows, new/empty, filtered, no results, ascending sort, selected row with table focus, many rows, narrow horizontal scrolling, loading, unreadable data, dark appearance, and unreadable data in dark appearance. Conformance must reach each state through the installed page and real store or real input.
- Adapt the original private colours, type, spacing, focus treatment, and dark palette to Television foundation tokens. Preserve the existing layout and interaction: toolbar, sticky headers, alternating rows, selected rows, wrapped long cells, scrolling, edge fades, placeholders, and the narrow breakpoint.
- Keep local selection when a filter hides the selected row, as the current page does. Clear it only when that row is removed from the store.
- Keep the total row count independent of filtering, and derive columns from all rows in stored order before filtering or page sorting.
- Treat cell names that also exist on JavaScript object prototypes, such as `constructor`, as ordinary stored names. A row that does not store that cell still has an empty cell rather than inheriting a JavaScript value.
- Treat story fixtures as specification data rather than packaging sample content. A new Table still starts from exactly `{ "rows": {} }`.
- Keep the Television template skill reference generic. It intentionally does not name the bundled inventory, and this change does not alter one of its hashed application-shell authorities.

## Open questions for Rupert

- Rupert has said a Table “just needs editability” so a person can fill it by hand. The current page is read-only. This change does not implement editing. Adding it would require decisions about creating and deleting rows and columns, editing cell values and types, naming and ordering columns, generating row keys and `order` values, validating empty and partial rows, read-only presentation, offline and failed saves, concurrent edits, accessibility and keyboard interaction, and the corresponding store contract, README guidance, stories, proofs, and browser tests.
- Does the drafted foundation-token treatment preserve the right visual character for Table, including the accent selection, neutral alternating rows, toolbar proportions, and edge fades?
- Is the drafted Storybook state set the right review surface, or should any state be combined or split before the UI spec is accepted?
- Should a future store contract add persisted column definitions? The current behaviour deliberately derives columns from cell keys, so search, sort, and this bundling change do not add them.

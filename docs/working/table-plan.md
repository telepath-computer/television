# Editable Table spec plan

The architecture and UI changes in this branch are drafts for Rupert to decide. This round changes only specs, independent spec-story markup, and this working document. Proofs, tests, packaged assets, and production code wait until the spec delta passes independent review.

## Draft decisions

- Seed a new Table with `{"columns":{},"rows":{}}`, with no `showHeader`. The explicit value gives agents the complete root shape and works with starting-data validation. No value or a partial root object still draws the empty grid, following the product template rule; drawing it makes no write.
- Keep `columns` and `rows` required in starting data while reading later writes tolerantly. The page ignores row or column entries without a valid `order`, so a late cell or name write after deletion cannot hide the whole table. That late edit is lost.
- Let agents store string, number, or boolean cells. The page shows each as text, treats `""` as empty, treats a row without `cells` as empty, and writes human edits as strings. Column names remain strings.
- Show the error page only when the root is not an object or a present `columns` or `rows` value is not an object map. Ignore unusable entries and cells inside an otherwise readable table. Missing data remains an empty Table and is never repaired on load.
- Treat row and column keys as opaque IDs. The page generates them with `push` without a value. README guidance tells agents to use `push`, never reuse a deleted key, and never write a cell or name below an entry that does not exist.
- Sort by numeric `order`, then by the JSON store key order. README guidance tells agents to give each row and column a distinct finite order.
- Insert one entry with an order between its neighbours when possible. When no number fits, use the same narrow exception as Checklist: a transaction adds the entry and gives every displayed entry on that axis a distinct integer order, preserving other fields, ignored entries, and concurrent changes. README guidance says those orders can change.
- Draw each empty axis independently with four virtual entries. A stored row axis can therefore appear with four drawn columns, and the reverse can appear with four drawn rows.
- Follow the experiment for actions on a drawn axis. A cell or header commit stores entries through the edited position. Plus stores all four drawn entries and adds a fifth. Insert and structural delete store all four before applying the command. Clear and Show/Hide header do not materialize an axis. Exact generated order values remain code-governed.
- Write an edit only on commit. Escape, unchanged text, or empty text in a drawn position writes nothing. Clearing stored text removes only that cell or name.
- Keep ordinary writes at the changed cell, name, row, column, or `showHeader` path. Multi-selection actions use one atomic path update. The no-gap transaction is the only exception that rewrites other entries.
- Keep stale cell values after column deletion. A column selection clears body cells only, not the column name; selecting and clearing the header cell clears the name.
- Preserve a selected range when its context menu opens from an item inside it. Insert adds one entry before or after the range; delete removes the selected entries.
- Remove search and sorting. The visible order is always the stored order, so editing and insertion use one position model.
- Make the grid one Tab stop. Arrow keys move cell selection, Up and Down cross between the header and body, Shift-Space selects a row, and Ctrl-Space selects a column. Tab leaves when no editor is open; from an editor it moves horizontally, leaving the grid at an outer column. Return at the last row does not add an entry.
- Separate pointer-selection and keyboard-focus stories. Pointer selection has the accent treatment; the keyboard-focus story adds the inner focus ring. Add selected-header, column-menu, and multi-row-menu stories.
- Follow selected row and column keys through inserts and reordering. Removing any selected entry clears the selection, including an active editor on that entry.
- Keep local text when the same field changes elsewhere. A changed commit uses the normal last-write-wins rule; an unchanged commit writes nothing and reveals the current stored value.
- Keep an active editor usable through a disconnection and commit its latest draft after reconnection. Other write affordances become read-only. Losing write access discards the draft and closes the editor.
- Preserve stored and pasted line breaks in the editor while showing them as spaces in the one-line grid. Native copying, pasting, selection, and undo work inside the editor. Whole-cell or range clipboard operations and undo after commit are accepted limitations.
- Accept the blank-table race: two people can materialize separate rows or columns before either sees the other write, leaving extra blank entries. The result remains valid; avoiding it would replace the path-level concurrency model with a larger coordination mechanism.
- Keep version `1.0.0` because Table has not been released. A development host with the earlier read-only `1.0.0` copy keeps it until that installed copy is removed.
- Keep the existing icon, shared display defaults, bundled ID order, and standard loading, access, save-failure, and dark treatments.

## Open questions for Rupert

1. **Should “Show header row” and “Hide header row” stay in the row and column menus, or should only an agent set `showHeader`?** The draft keeps the menu item. Recommendation: keep it so a person can expose and name headers without an agent.
2. **Should search and sorting return on an editable Table?** The draft removes both. Recommendation: leave them out. A temporary view order makes structural insertion surprising because the stored result can move or disappear immediately.
3. **Should the page accept number and boolean cells as well as strings?** The draft accepts all three, displays them as text, and writes human edits as strings. Recommendation: keep this tolerant reading because agents commonly fill tables from typed data, while the editor still has one simple text model.
4. **Should inserting beside a multi-row or multi-column selection add one entry or as many as are selected?** The draft adds one, matching the approved experiment. Recommendation: keep one; adding a batch introduces another ordering and focus rule without serving the basic hand-edited Table.
5. **What should happen when an agent changes the field a person is actively editing?** The draft protects local text until commit or cancel, then uses last-write-wins for a changed commit. Recommendation: keep this behavior; live replacement would discard typing or move the caret.
6. **Should a read-only Table retain selection and keyboard navigation?** The draft does, while removing write affordances. Recommendation: keep selection so access changes do not also remove the reading and navigation model.

*The bundled Table artifact template: its store contract, packaged page, and adapting-agent guidance.*

# Table artifact template

Table is a bundled [artifact template](../../product/templates.md#^artifact-template-bundled). The [inventory](./bundled-templates.md#^bundled-artifact-template-inventory) owns its ID, name, description, and versions. The [Table UI spec](../../ui/templates/table.mdx) owns the page appearance and interaction.

The bundled manifest declares no `display`, so the shared defaults apply.

## Store

The template `data.json` seeds the artifact [own JSON store](../../product/resources/resources.md#^rs-own-store) with `{"columns":{},"rows":{}}`. This explicit empty value gives agents the two containers they need to fill, works with the template starting-data contract, and leaves `showHeader` absent so a new Table has no header row. Drawing the empty grid makes no store write.

Agents and the page write the value, so it has a contract: the manifest `dataSchema`, which is this schema. ^bundled-artifact-template-table-store

```json
{
  "type": "object",
  "required": ["columns", "rows"],
  "properties": {
    "showHeader": { "type": "boolean" },
    "columns": {
      "type": "object",
      "additionalProperties": {
        "type": "object",
        "required": ["order"],
        "properties": {
          "order": { "type": "number" },
          "name": { "type": "string" }
        }
      }
    },
    "rows": {
      "type": "object",
      "additionalProperties": {
        "type": "object",
        "required": ["order"],
        "properties": {
          "order": { "type": "number" },
          "cells": {
            "type": "object",
            "additionalProperties": { "type": ["string", "number", "boolean"] }
          }
        }
      }
    }
  }
}
```

Keys below `columns` and `rows` are opaque [JSON store keys](../resources/json-store.md#^js-arch-paths). An agent writing a whole table may choose any valid keys. The page generates a new key with `push` without a value, which makes no write.

A column has a numeric `order` and may have a string `name`. A row has a numeric `order` and may have a `cells` object. A cell key is a column key; its value may be a string, number, or boolean. The page writes cell values as strings. It removes an empty cell instead of storing `""`, and removes an empty column name instead of storing it. `showHeader: true` shows the header row. `false` or an absent `showHeader` hides it.

The page displays columns and rows by ascending `order`, then by key in the [JSON store key order](../../product/resources/json-store.md#^js-child-events). It normally inserts between two neighbours with an `order` strictly between theirs, or beyond the outer entry. Exact order values are code-governed.

When the page cannot represent an order strictly in the needed position, the page follows the [Checklist fallback](./checklist.md#store): a [transaction](../../product/resources/json-store.md#^js-transactions) on `rows` or `columns` adds one entry and gives every displayed entry a distinct integer order in the resulting display order. It preserves other fields and ignored entries. If the selected entry has gone, it writes nothing. This fallback is the only human action that may rewrite other entries.

### Runtime reading

The page reads later writes tolerantly because the manifest schema does not validate them. No store value, `{}`, or a root object missing `columns` or `rows` is an empty or partial Table. A root value that is not an object, or a present `columns` or `rows` value that is not an object map, is unreadable.

Within a readable Table, the page:

- ignores a column or row entry that is not an object or has no finite numeric `order`;
- treats a non-string column name as absent;
- treats a missing or non-object `cells` value as an empty row;
- shows string, number, and boolean cells as text, with `""` as an empty cell, and treats other cell values as empty;
- ignores a cell whose key has no displayed column; and
- shows the header only when `showHeader` is `true`.

Extra fields at the root, in columns, and in rows are ignored. [Creating an artifact](./index.md#^artifact-template-schema) from the template rejects starting data that breaks the schema; writes after creation are not checked against it. An unreadable value is shown as the [Table UI spec](../../ui/templates/table.mdx#data-the-page-cannot-read) describes. ^bundled-artifact-template-table-behaviour

### Drawn rows and columns

Each axis is independent. When no valid columns are stored, the page draws four columns. When no valid rows are stored, it draws four rows. Stored entries on the other axis remain as they are. Drawn entries are not stored until an action needs them.

Committing non-empty text in a drawn body cell stores the drawn columns through that position and the drawn rows through that position, then stores the cell. Naming a drawn header stores the drawn columns through it. A plus control stores all four drawn entries on its axis and adds a fifth. Insert or structural delete first stores all four drawn entries on that axis, then applies the command. Each stored row has an empty `cells` object; each stored entry has a generated key and an order distinct from the other entries materialized by that action.

Showing or hiding the header does not store drawn columns. Clearing a drawn cell, header, row, or column has nothing to clear and makes no write. Materialization and the action that caused it are one atomic update. Exact order values for materialized entries are code-governed.

Editing writes only on commit. Escape, unchanged text, and empty text in a drawn cell or header make no write. If two people materialize the same empty axis before either sees the other write, both sets of entries can remain, producing extra blank rows or columns. The data stays valid; preventing that rare race would require replacing the path-level write model.

### Page writes

The page subscribes to the whole store through the [resource SDK](../resources/sdk.md). Except for drawn-entry materialization and the no-gap transaction, a human action writes only the path it changes:

- A body edit sets `rows/<row-key>/cells/<column-key>`. Clearing it removes that path.
- A header edit sets `columns/<column-key>/name`. Clearing it removes that path.
- Showing or hiding the header sets `showHeader` to `true` or `false`.
- Adding or inserting a row sets `rows/<new-row-key>` to `{ "order": <number>, "cells": {} }`. Adding or inserting a column sets `columns/<new-column-key>` to `{ "order": <number> }`.
- Deleting a row removes `rows/<row-key>`. Deleting a column removes `columns/<column-key>` and does not visit any row.
- Clearing selected rows or columns removes only their non-empty body-cell paths. Clearing columns does not remove their names.

An action that affects several selected entries or cells uses one atomic update of the distinct paths. The page does not otherwise replace `rows`, `columns`, or the store root. Writes to unrelated paths do not replace each other. An ancestor removal or replacement can race with a descendant cell or name write; store ordering then decides the result. A late descendant write can recreate an entry without `order`, which the page ignores, so that edit is lost without making the Table unreadable.

## Packaged page and guidance

The page loads Television canonical stylesheet, components and resource SDK, and includes its other page dependencies inside the template folder so copied artifacts work independently. Its stylesheet is `styles.css` in the template folder; [conformance](../../spec-ui.md#conformance) holds the page to the UI spec stories. The manifest `icons` lists one entry, `icon.svg`, which is a square SVG. [Icon delivery](./index.md#icon-delivery) selects it, and [Toolbox](../../ui/app/toolbox.mdx#icons) draws it as supplied. ^bundled-artifact-template-table-page

The bundled `README.md` explains `showHeader`, `columns`, `rows`, opaque keys, ordering, names, cells, and the tolerant reading rules. It tells agents to give every row and column a distinct finite `order`, while warning that the page may renumber an axis when insertion has no numeric gap. It tells agents to use `push` for new keys, never reuse a deleted key, and never write a cell or name below an entry that does not exist. It explains that deleting a column need not clean up rows because those values are ignored.

The README gives `tv resource json` commands to write a whole table; add, name, reorder, and remove a column; add, reorder, and remove a row; change and clear one cell; show and hide the header; and clear the table. It says that people may be editing the same table through the page and recommends path-level updates unless the agent intends to replace the whole table. It says that unreadable data is not repaired and that copied artifacts are independent. It points an adapting agent to the local modules and foundation-token stylesheet. ^bundled-artifact-template-table-readme

*The bundled Table artifact template: its store contract, packaged page, and adapting-agent guidance.*

# Table artifact template

Table is a bundled [artifact template](../../product/templates.md#^artifact-template-bundled). The [inventory](./bundled-templates.md#^bundled-artifact-template-inventory) owns its ID, name, description, and versions. The [Table UI spec](../../ui/templates/table.mdx) owns the page appearance and interaction.

The bundled manifest declares no `display`, so the shared defaults apply.

## Store

The template `data.json` seeds the artifact [own JSON store](../../product/resources/resources.md#^rs-own-store) with `{"columns":{},"rows":{}}`. This explicit empty value gives agents the two containers they need to fill, works with the template starting-data contract, and leaves `showHeader` absent so a new Table has no header row. The four-by-four grid drawn by the empty page is only an editing surface; drawing it makes no store write.

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
          "name": { "type": "string", "minLength": 1 }
        }
      }
    },
    "rows": {
      "type": "object",
      "additionalProperties": {
        "type": "object",
        "required": ["order", "cells"],
        "properties": {
          "order": { "type": "number" },
          "cells": {
            "type": "object",
            "additionalProperties": { "type": "string", "minLength": 1 }
          }
        }
      }
    }
  }
}
```

Each key below `columns` and `rows` is an opaque [JSON store key](../resources/json-store.md#^js-arch-paths), never a name or another value converted into a key. An agent writing a whole table may choose any valid keys. The page uses the store `push` operation without a value to generate each new key, which does not itself write.

A column has a numeric `order` and may have a non-empty string `name`. A row has a numeric `order` and a `cells` object. Each cell key is a column key and each cell value is a non-empty string. An empty cell has no entry in `cells`; an unnamed column has no `name`. `showHeader: true` shows the header row. `false` or an absent `showHeader` hides it.

Columns and rows display by ascending `order`, then by key when two orders match. The page inserts between two neighbours with an `order` between theirs. Inserting at either end uses an order below the first or above the last. It does not rewrite another entry. A cell whose column key is absent from `columns` is ignored, so deleting a column removes only its column entry and leaves any values for that key in rows.

Extra fields at the root, in columns, and in rows are allowed and ignored. [Creating an artifact](./index.md#^artifact-template-schema) from the template rejects starting data that breaks the schema; writes after creation are not checked against it. At runtime, no store value or a value that breaks the contract is shown as the [Table UI spec](../../ui/templates/table.mdx#data-the-page-cannot-read) describes. ^bundled-artifact-template-table-behaviour

### Page writes

The page subscribes to the whole store through the [resource SDK](../resources/sdk.md). A person and an agent can change different parts of the same table without replacing each other because the page writes only the paths named by the action:

- Editing a body cell sets `rows/<row-key>/cells/<column-key>`. Clearing it removes that path.
- Editing a header cell sets `columns/<column-key>/name`. Clearing it removes that path.
- Showing or hiding the header sets `showHeader` to `true` or `false`.
- Adding or inserting a row sets `rows/<new-row-key>` to `{ "order": <number>, "cells": {} }`. Adding or inserting a column sets `columns/<new-column-key>` to `{ "order": <number> }`.
- Deleting a row removes `rows/<row-key>`. Deleting a column removes `columns/<column-key>` and does not visit any row.
- Clearing a row or column selection removes only the non-empty cell paths in that selection. It does not remove row or column entries.

When a person first types in a drawn blank cell, the page creates that row and column, every drawn column to its left, and every drawn row above it. It generates all required keys before writing, then uses one atomic multi-path update containing one path for each new row or column entry. The target row entry contains the new cell. No drawn entry beyond that position is stored.

An action that affects several selected rows, columns, or cells likewise uses one atomic update of their distinct entry or cell paths. The page never replaces `rows`, `columns`, or the store root in response to a person. The store applies concurrent writes to different paths independently; ordinary JSON store ordering governs two writes to the same path.

## Packaged page and guidance

The page loads Television canonical stylesheet, components and resource SDK, and includes its other page dependencies inside the template folder so copied artifacts work independently. Its stylesheet is `styles.css` in the template folder; [conformance](../../spec-ui.md#conformance) holds the page to the UI spec stories. The manifest `icons` lists one entry, `icon.svg`, which is a square SVG. [Icon delivery](./index.md#icon-delivery) selects it, and [Toolbox](../../ui/app/toolbox.mdx#icons) draws it as supplied. ^bundled-artifact-template-table-page

The bundled `README.md` explains `showHeader`, `columns`, `rows`, opaque keys, ordering, names, and cells. It tells agents to omit empty cells and unused names, and that deleting a column need not clean up rows. It gives `tv resource json` commands to write a whole table; add, name, reorder, and remove a column; add, reorder, and remove a row; change and clear one cell; show and hide the header; and clear the table. It warns agents not to derive keys from column names, says that people may be editing the same table through the page, and recommends path-level updates unless the agent intends to replace the whole table. It says that invalid data is not repaired and that copied artifacts are independent. It points an adapting agent to the local modules and foundation-token stylesheet. ^bundled-artifact-template-table-readme

*The bundled Table artifact template: its store contract, packaged page, and adapting-agent guidance.*

# Table artifact template

Table is a bundled [artifact template](../../product/templates.md#^artifact-template-bundled). The [inventory](./bundled-templates.md#^bundled-artifact-template-inventory) owns its ID, name, description, and versions. The [Table UI spec](../../ui/templates/table.mdx) owns the page appearance and interaction.

The bundled manifest declares no `display`, so the shared defaults apply.

## Store

The template `data.json` seeds the artifact [own JSON store](../../product/resources/resources.md#^rs-own-store) with `{"columns":{},"rows":{}}`. This explicit empty value gives agents the two containers they need to fill, satisfies the schema that requires both containers, and leaves `showHeader` absent so a new Table has no header row. Drawing the empty grid makes no store write.

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
        "required": ["order", "cells"],
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

Keys below `columns` and `rows` are opaque [JSON store keys](../resources/json-store.md#^js-arch-paths). Never derive a key from a name or reuse a deleted key. `push` is the normal way to add one row or column. An agent writing a whole table in one `set` instead generates a fresh random key, such as a UUID, for every row and column. The page can call `push` without a value to generate a key without making a write.

A column has a numeric `order` and may have a string `name`. A row has a numeric `order` and a `cells` object. A cell key is a column key; its value may be a string, number, or boolean. The page writes edited cell values as strings. `showHeader: true` shows the header row. `false` or an absent `showHeader` hides it.

The page displays columns and rows by ascending `order`, then by key in the [JSON store key order](../../product/resources/json-store.md#^js-child-events). It normally inserts between two neighbours with an `order` strictly between theirs, or beyond the outer entry. Exact order values are code-governed.

When the page cannot represent an order strictly in the needed position, it runs a [transaction](../../product/resources/json-store.md#^js-transactions) on `rows` or `columns`. Each attempt reads the current axis. For an insert beside a selection, it aborts without writing if that value is not a JSON object, if a selected key is gone, or if the selected keys no longer form one contiguous range. It gives the displayed stored entries consecutive integer orders from 0. It preserves every other field and every ignored entry. This transaction is the only human action that may rewrite other entries.

### Runtime reading

The page reads later writes tolerantly because the manifest schema does not validate them. No store value, `{}`, or a root object missing `columns` or `rows` is an empty or partial Table. A root value that is not a JSON object, or a present `columns` or `rows` value that is not a JSON object, is unreadable.

Within a readable Table, the page:

- ignores a column or row entry that is not a JSON object or has no finite numeric `order`;
- treats a non-string column name as absent;
- treats a missing `cells` value, or one that is not a JSON object, as an empty row;
- treats strings as their own cell text, numbers and booleans as their JSON text, and `""` and other cell values as empty;
- ignores a cell whose key has no displayed column; and
- treats the header as enabled only when `showHeader` is `true`.

Extra fields at the root, in columns, and in rows are ignored. [Creating an artifact](./index.md#^artifact-template-schema) from the template rejects starting data that breaks the schema; writes after creation are not checked against it. An unreadable value is shown as the [Table UI spec](../../ui/templates/table.mdx#data-the-page-cannot-read) describes.

Once the page has read an unreadable value, or the server reports the saved value unavailable, it starts no write until it reads a readable value again. A write already sent follows the ordinary store rules. Saved data reported unavailable follows the [resource recovery rules](../resources/index.md#^rs-storage).

### Drawn rows and columns

Rows and columns are separate axes. The page draws stored entries followed by enough blank positions to show at least four columns and four rows. An axis with four or more displayed stored entries has no drawn positions. A *drawn position* is one of these blank rows or columns; it has no store key or order and is not stored until an action needs it.

Committing non-empty text in a body cell in a drawn row or column stores the drawn columns and rows through that position. The resulting row entry includes the cell. If the row is already stored, the update does not replace it and writes only the cell path within that row. Naming a drawn header stores the drawn columns through it, with the resulting column entry carrying the name. Adding at the end stores every drawn position on that axis and adds one entry after them.

Inserting a row or column stores the drawn positions before the new entry on that axis, followed by the new entry. It does not store drawn positions after the new entry. Deleting rows or columns removes the selected stored entries; selected drawn positions need no write. A new row that does not receive an edited cell has an empty `cells` object. Each action in these two paragraphs uses one atomic update of distinct entry and cell paths. Exact order values for these entries are code-governed.

Showing or hiding the header does not store drawn columns. Clearing a drawn cell, header, row, or column has nothing to clear and makes no write.

Drawn positions on an axis keep their identity across another writer's changes while the number of displayed stored entries on that axis stays the same. If another writer's change alters that number, those drawn positions change identity, and the page makes no write for an action aimed at a drawn position from before that change. Another writer changing a cell or name, or changing one finite `order` to another, leaves drawn positions as they are. ^bundled-artifact-template-table-drawn-identity

Another writer can store the same drawn positions before either update is observed, whether the axis is empty or partly filled. Both sets of entries can remain and produce extra rows or columns that need not be blank. An insert whose order was chosen before another writer renumbered the axis can also appear in a different position. These races are accepted rather than adding coordination between writers.

### Page writes

The page subscribes to the whole store through the [resource SDK](../resources/sdk.md). Except when storing drawn positions and running the renumbering transaction, a human action writes only the path it changes:

- A body edit sets `rows/<row-key>/cells/<column-key>`. Clearing it removes that path.
- A header edit sets `columns/<column-key>/name`. Clearing it removes that path.
- Showing or hiding the header sets `showHeader` to `true` or `false`.
- Adding or inserting a row sets `rows/<new-row-key>` to `{ "order": <number>, "cells": {} }`. Adding or inserting a column sets `columns/<new-column-key>` to `{ "order": <number> }`.
- Deleting a row removes `rows/<row-key>`. Deleting a column removes `columns/<column-key>` and does not visit any row.
- Clearing selected rows or columns removes only their non-empty body-cell paths. Clearing columns does not remove their names.

An edit writes only when it is committed and differs from the stored text shown when the editor opened. Text containing only whitespace counts as empty. Committing an empty body cell or column name removes that path; an empty edit on a drawn position makes no write. Other text is stored as typed, including whitespace and line breaks. Cancelling an edit makes no write.

An action that affects several selected entries or cells uses one atomic update of the distinct paths. The page does not otherwise replace `rows`, `columns`, or the store root. Writes to unrelated paths do not replace each other. An ancestor removal or replacement can race with a descendant cell or name write; store ordering then decides the result. A late descendant write can recreate an entry without `order`, which the page ignores, so that edit is lost without making the Table unreadable.

## Packaged page and guidance

The page loads Television's canonical stylesheet, components and resource SDK, and includes its other page dependencies inside the template folder so copied artifacts work independently. Its stylesheet is `styles.css` in the template folder; [conformance](../../spec-ui.md#conformance) holds the page to the UI spec stories. The manifest `icons` lists one entry, `icon.svg`, which is a square SVG. [Icon delivery](./index.md#icon-delivery) selects it, and [Toolbox](../../ui/app/toolbox.mdx#icons) draws it as supplied. ^bundled-artifact-template-table-page

The bundled `README.md` explains `showHeader`, `columns`, `rows`, opaque keys, ordering, names, cells, and the tolerant reading rules. It says that `cells` is an object keyed by column key, never an array, and empty cells are left out. It says that display letters and numbers are positions after ignored entries have been dropped and the remaining entries ordered. It explains that drawn positions have no stored entry: writing B3 in an empty Table requires new entries for columns A and B and rows 1 through 3, each with an `order`. It says that a cell written as a number or boolean is written back as a string if a person edits it.

The README tells agents to give every row and column a distinct finite `order`, while warning that the page may renumber an axis when insertion has no numeric gap. It repeats the key guidance above and says never to write a cell or name below an entry that does not exist. It warns agents not to repair an entry without an `order`, because it can be a late write below a deleted entry. It explains that deleting a column need not clean up rows because those values are ignored.

The README gives `tv resource json` commands to write a whole table; add, name, reorder, and remove a column; add, reorder, and remove a row; change and clear one cell; show and hide the header; and clear the table. It says that people may be editing the same table through the page and recommends path-level updates unless the agent intends to replace the whole table. It says that unreadable data is not repaired and that copied artifacts are independent. It points an adapting agent to the local modules and foundation-token stylesheet. ^bundled-artifact-template-table-readme

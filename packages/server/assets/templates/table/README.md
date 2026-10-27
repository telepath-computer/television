# Table template

This template makes an editable table that a person and an agent can change at the same time. Its JSON store has separate column and row objects:

```json
{
  "showHeader": true,
  "columns": {
    "b57c9dd8-00d4-49c2-a382-e5cd6e45d935": { "order": 1, "name": "Park" },
    "9caebdb4-b15f-45ca-8ea9-0ea730a7e4c4": { "order": 2, "name": "State" }
  },
  "rows": {
    "514c6a2b-1324-4d21-9810-595750df8493": {
      "order": 1,
      "cells": {
        "b57c9dd8-00d4-49c2-a382-e5cd6e45d935": "Yosemite",
        "9caebdb4-b15f-45ca-8ea9-0ea730a7e4c4": "CA"
      }
    }
  }
}
```

`showHeader` is optional. Only `true` shows the header row. Each entry in `columns` has a finite numeric `order` and may have a string `name`. Each entry in `rows` has its own finite numeric `order` and a `cells` object. `cells` is an object keyed by column key, never an array. Empty cells are left out.
Cell values may be strings, finite numbers, or booleans; other values appear blank.

Column and row keys are opaque IDs. Never derive a key from a column name, and never reuse a deleted key. `push` is the normal way to add one row or column. When writing a whole table in one `set`, generate a fresh random key, such as a UUID, for every row and column.

The page orders rows and columns by `order`, then by key when orders match. Give every row and column a distinct finite `order`. To insert between two entries, use a value between their orders. The page may renumber one axis when no numeric value fits.

The displayed letters and numbers are positions after ignored entries have been left out and the remaining entries have been ordered. Blank positions after stored entries are drawn positions; these drawn positions are not stored. For example, B3 in an empty table means creating columns A and B and rows 1 through 3, each with an `order`.

## Change the table

Set the artifact ID once:

```sh
export ARTIFACT_ID=<id>
```

To replace the whole table deliberately, use fresh random keys in one command:

```sh
tv resource json set --artifact "$ARTIFACT_ID" '{"showHeader":true,"columns":{"b57c9dd8-00d4-49c2-a382-e5cd6e45d935":{"order":1,"name":"Park"}},"rows":{"514c6a2b-1324-4d21-9810-595750df8493":{"order":1,"cells":{"b57c9dd8-00d4-49c2-a382-e5cd6e45d935":"Yosemite"}}}}'
```

For ordinary changes, update only the path you mean to change. Add a column with `push`, keep the returned key as `COLUMN_KEY`, then name, reorder, or remove it:

```sh
tv resource json push --artifact "$ARTIFACT_ID" columns '{"order":1}'
tv resource json set --artifact "$ARTIFACT_ID" "columns/$COLUMN_KEY/name" '"Park"'
tv resource json set --artifact "$ARTIFACT_ID" "columns/$COLUMN_KEY/order" '2'
tv resource json remove --artifact "$ARTIFACT_ID" "columns/$COLUMN_KEY"
```

Add a row with `push`, keep its returned key as `ROW_KEY`, then reorder or remove it:

```sh
tv resource json push --artifact "$ARTIFACT_ID" rows '{"order":1,"cells":{}}'
tv resource json set --artifact "$ARTIFACT_ID" "rows/$ROW_KEY/order" '2'
tv resource json remove --artifact "$ARTIFACT_ID" "rows/$ROW_KEY"
```

Write or clear one cell, and show or hide the header row, with:

```sh
tv resource json set --artifact "$ARTIFACT_ID" "rows/$ROW_KEY/cells/$COLUMN_KEY" '"Yosemite"'
tv resource json remove --artifact "$ARTIFACT_ID" "rows/$ROW_KEY/cells/$COLUMN_KEY"
tv resource json set --artifact "$ARTIFACT_ID" showHeader 'true'
tv resource json set --artifact "$ARTIFACT_ID" showHeader 'false'
```

Clear the table while keeping its required containers with:

```sh
tv resource json set --artifact "$ARTIFACT_ID" '{"columns":{},"rows":{}}'
```

Do not write a cell below a row that does not exist, or a name below a column that does not exist. Deleting a column does not require removing its old cell values from rows; the page ignores cells whose column is absent. A person may be editing the same table while you work, so prefer path-level changes unless you intend to replace the whole table.

A stored number or boolean appears as text. If a person edits that cell, the page writes the edited value back as a string.

## Data the page can read

The page tolerates a missing root value, missing `columns` or `rows`, malformed entries, non-string names, and rows without a usable `cells` object. It ignores an entry without a finite numeric `order`. Do not repair an entry without an order: it may be a late cell or name write below an entry that another writer deleted.

A root value that is not an object, or a present `columns` or `rows` value that is not an object, shows an error page. The Table does not repair unreadable data. Supply a readable root object to recover it.

## Adapt the template

Page markup is in `index.html`, behaviour is split between `page.js`, `model.js`, and `selection-model.js`, and presentation is in `styles.css`. The stylesheet uses Television foundation tokens and follows the active theme. Keep the store contract, tolerant reader, write plans, selection rules, and unreadable-data state aligned when changing the page.

Copied artifacts are independent. Changing this bundled template affects only artifacts created after the updated template is installed.

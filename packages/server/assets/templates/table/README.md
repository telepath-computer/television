# Table template

This template makes a read-only page for records that an agent keeps in the artifact JSON store. The root object has one required field, `rows`, whose value is an object keyed by stable row IDs:

```json
{
  "rows": {
    "<key>": { "order": 1, "Park": "Yosemite", "Open": true }
  }
}
```

Each row is an object with a numeric `order`. The page never shows the row key or `order`; every other field becomes a column. Rows sort by `order`, then by key when orders match. Columns follow the order in which their names first appear across those stored rows. A missing, null or empty cell shows an em dash. Booleans, numbers, objects, lists and long text each get their current Table presentation.

`data.json` starts as `{"rows":{}}`, so a new Table has no sample rows.

## Change the table

Set the artifact ID once, then add a row. `push` generates its stable key:

```sh
export ARTIFACT_ID=<id>
tv resource json push --artifact "$ARTIFACT_ID" rows '{"order":1,"Park":"Yosemite"}'
```

Keep the returned key as `ROW_KEY`. Change one cell, remove that row, or clear every row with:

```sh
tv resource json set --artifact "$ARTIFACT_ID" "rows/$ROW_KEY/Park" '"Yosemite Valley"'
tv resource json remove --artifact "$ARTIFACT_ID" "rows/$ROW_KEY"
tv resource json set --artifact "$ARTIFACT_ID" rows '{}'
```

To append, use an `order` greater than the largest current value. To insert between two rows, use a number between their order values. Search and column sorting affect the page only. Row selection also stays in the page. The page follows valid store changes live and never writes to the store.

Invalid or missing data shows an error page. The Table does not repair it. Restore a root object with a valid `rows` object and a finite numeric `order` in every row; the page follows the repair live. A read-only share looks the same as the original. If access is revoked or the connection drops, an open page keeps the last table it received.

## Adapt the template

Page markup is in `index.html`, behaviour is in `page.js` and `model.js`, and presentation is in `styles.css`. The stylesheet uses Television foundation tokens and follows the active theme. Keep the store contract and the unreadable-data state aligned when changing the page.

Copied artifacts are independent. Changing this bundled template affects only artifacts created after the updated template is installed.

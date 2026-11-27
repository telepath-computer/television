# Checklist

The page and your agent share this artifact's own JSON store. Changes appear live.
Set `ARTIFACT_ID` to the artifact ID and `ITEM_KEY` to the key of the item to change.

The root has a `title` string and an `items` map. Each item has three fields:

- `order`: a finite number. Smaller `order` values appear first; give each item its own `order`.
- `text`: a string containing the item text.
- `done`: a boolean indicating whether the item is ticked.

Equal `order` values fall back to the store's key order: whole-number keys without leading
zeros first, numerically, then other keys in UTF-16 order. Adding an item can renumber
every item, so `order` values are not stable. Read the current items before choosing
an order. When the page saves item text or done state, it drops extra fields from that item
and keeps only `order`, `text`, and `done`.

If any part of the value breaks this shape, such as an item missing `done`, the page
shows an error instead of the checklist. Repair the data before editing from the page.

Change the title at `title`:

```sh
tv resource json set --artifact "$ARTIFACT_ID" title '"Groceries"'
```

Add under `items` with an order. The command returns the new key:

```sh
tv resource json push --artifact "$ARTIFACT_ID" items '{"order":0,"text":"Oat milk","done":false}'
```

Change one item by writing its complete three-field object at its key:

```sh
tv resource json set --artifact "$ARTIFACT_ID" "items/$ITEM_KEY" '{"order":0,"text":"Oat milk","done":true}'
```

Remove one item at its key:

```sh
tv resource json remove --artifact "$ARTIFACT_ID" "items/$ITEM_KEY"
```

These scoped writes leave other items alone.

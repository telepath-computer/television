*The bundled Checklist artifact template: its display size, store contract, packaged page, and adapting-agent guidance.*

# Checklist artifact template

Checklist is a bundled [artifact template](../../product/templates.md#^artifact-template-bundled). The [inventory](./bundled-templates.md#^bundled-artifact-template-inventory) owns its ID, name, description, and versions. The [Checklist UI spec](../../ui/templates/checklist.mdx) owns the page's appearance and interaction.

The bundled manifest declares `display: { "width": 640, "height": 800 }` in reference pixels. `fullScreen` uses the shared default.

## Store

The template's `data.json` seeds the artifact's [own JSON store](../../product/resources/resources.md#^rs-own-store) with `{"title":"Checklist","items":{}}`. The value has this contract because agents write it:

```ts
interface ChecklistData {
  title: string;
  items: Record<string, {
    order: number;
    text: string;
    done: boolean;
  }>;
}
```

The value is valid when it is a JSON object, not an array, whose `title` is a string and whose `items` is an object; each value in `items` must be an object whose `text` is a string, `done` a boolean and `order` a finite number. Any key is accepted for an item, though the page and the README create them with [JSON store `push`](../resources/json-store.md#^js-arch-push-keys). Fields this contract does not name are ignored. A value that breaks this contract is shown as the pilot's [Data the page cannot read](../../ui/templates/checklist.mdx#data-the-page-cannot-read) section describes. ^bundled-artifact-template-checklist-store

The page displays items by ascending `order`, breaking ties by key in the [JSON store's key order](../../product/resources/json-store.md#^js-child-events). It gives the first item in an empty list `order` 0, an item added at the top one less than the smallest, one added at the end one more than the largest, and one added below an item the midpoint between that item and the next. When that number would not lie strictly beyond or between its neighbours, as when two items share an `order` or a gap has been halved until no number fits, the page renumbers instead: a [transaction](../../product/resources/json-store.md#^js-transactions) on `items` adds the new item, with a key from `push`, and sets every item's `order` to its position from 0, leaving each item's other fields as they are. Each attempt works from the current items, so a change another writer made meanwhile is kept; if the item the new one was to follow has been removed, the new item goes at the end. If an attempt finds `items` missing or breaking this contract, it writes nothing and the item is not added.

The page subscribes to the store through the [resource SDK](../resources/sdk.md). It writes title changes only at `title`. Each save of an item's text or done state sets the complete `{ order, text, done }` object at `items/<key>`, which drops fields this contract does not name from that item; adding an item uses `push` under `items` with the same complete object, or the renumbering transaction; deleting one removes only its key. Concurrent editing follows the [Checklist pilot's Changes from elsewhere section](../../ui/templates/checklist.mdx#changes-from-elsewhere).

Once the page has read a value that breaks the contract, it starts no write until it reads a valid value again, so it never rewrites a part it cannot read; an ordinary write already sent follows the store's last-write-wins rule. The page uses the SDK's [`getAccess` and `onAccessChanged`](../resources/sdk.md#^sdk-access) to follow changes in write access.

## Packaged page and guidance

The page loads Television's canonical stylesheet and the resource SDK, and includes its other page dependencies inside the template folder so copied artifacts work independently. Its stylesheet is `styles.css` in the template folder; [conformance](../../spec-ui.md#conformance) holds the page to the UI spec's stories. Its manifest's `icons` lists one entry, `icon.svg`: a square SVG of a page with a ticked box and an empty one. [Icon delivery](./index.md#icon-delivery) selects it, and [Toolbox](../../ui/app/toolbox.mdx#icons) draws it as supplied. ^bundled-artifact-template-checklist-page

The bundled `README.md` explains the `title` string and the `items` map, including each item's numeric `order`, `text` string and `done` boolean. It says that smaller `order` values appear first and that each item should have its own `order`, and that `order` must be a finite number. It explains that equal `order` values fall back to the store's key order, that adding an item can renumber every item, so `order` values are not stable, and that the page keeps only the three named fields of an item whose text or done state it saves. It tells an adapting agent to change the title at `title`, add items with `tv resource json push` under `items` while supplying an `order`, change an item by writing its complete object at its key, and remove an item at that key. These writes leave other items alone. It warns that if any part of the value breaks this shape, such as an item missing a field, the page shows an error instead of the checklist. It explains that the page and agent share the artifact's own store and that changes appear live. ^bundled-artifact-template-checklist-readme

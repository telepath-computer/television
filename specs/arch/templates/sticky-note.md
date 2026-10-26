*The bundled Sticky note artifact template: its display size, store contract, packaged page, and adapting-agent guidance.*

# Sticky note artifact template

Sticky note is a bundled [artifact template](../../product/templates.md#^artifact-template-bundled). The [inventory](./bundled-templates.md#^bundled-artifact-template-inventory) owns its ID, name, description, and versions. The [Sticky note UI spec](../../ui/templates/sticky-note.mdx) owns appearance and interaction.

The bundled manifest declares `display: { "width": 360, "height": 360, "transparent": true }` in reference pixels. `fullScreen` uses the shared default. These values use the [creation display-options contract](../layout/index.md#^ly-creation-display); the [artifact frame](../../ui/app/artifact-frame/index.md) owns the surrounding transparent presentation.

## Store

The template `data.json` seeds the [artifact's own JSON store](../../product/resources/resources.md#^rs-own-store) with `{"text":""}`. The typing hint is a placeholder, never stored text; an agent reading a new note sees an empty string. The value has this contract because agents write it:

```ts
interface StickyNoteData {
  text: string;
}
```

The value is valid when it is a JSON object, not an array or `null`, with a `text` string. The string may be empty and may contain whitespace and line breaks. Other fields are ignored and left unchanged by page writes. A missing value, missing `text`, or any other type breaks the contract and is shown as [Data the page cannot read](../../ui/templates/sticky-note.mdx#data-the-page-cannot-read) describes. ^bundled-artifact-template-sticky-note-store

The page subscribes to the whole store through the [resource SDK](../resources/sdk.md), so it can validate the root as well as the text. Each save uses `set` at `text` with the complete current string, leaving other root fields alone. Clearing the note writes `""`; it does not remove the field. Opening, reading and displaying the note write nothing.

Once the page has read a value that breaks the contract, it starts no write until it reads a valid value again; what happens to an unsent edit is in [Data the page cannot read](../../ui/templates/sticky-note.mdx#data-the-page-cannot-read). A write already sent follows the ordinary store rules. Saved data reported unavailable uses the same alert and follows the [resource recovery rules](../resources/index.md#^rs-storage), including repair and server restart.

## Saving and concurrent changes

Each input restarts a 400 ms delay; leaving the field saves an unsent change immediately. The page retains the latest locally edited text until its save is confirmed. A confirmation clears only the draft it saved, leaving newer typing pending. While text is waiting to be sent, incoming valid text does not replace it or disturb selection or scrolling. After sending, the field follows SDK values again unless there is newer unsent typing. An unchanged value leaves selection alone. Concurrent writes replace the whole string under the [store's last-write-wins rule](../../product/resources/json-store.md#^js-write-order); text is not merged and earlier incoming values are not replayed after a local save.

The page uses [`getAccess` and `onAccessChanged`](../resources/sdk.md#^sdk-access) and the SDK [connection status](../resources/sdk.md#^sdk-connection-status). Editing requires previously established write access and readable data. A disconnect alone does not remove that access. Confirmed loss of write access clears the retained draft and follows the [read-only behaviour](../../ui/templates/sticky-note.mdx#read-only).

The SDK has [no offline queue](../resources/sdk.md#^sdk-reconnect). The page keeps one current draft in memory while disconnected, including locally edited text whose in-flight save rejects with `disconnected`. It keeps that draft on screen through SDK rollback and reconnection, and makes no write calls while disconnected. This is a replacement text to save, not a queue of SDK requests; closing or reloading the page loses it.

On reconnection, the page checks current access and reads the whole store with `get` before sending a retained draft. With write access and valid data, it saves the latest draft once the normal pause or leaving-field condition is met; if that condition was met while disconnected, it saves immediately. The arriving stored text does not overwrite the draft first. Loss of access or unreadable data follows the rules above. With no draft, the page simply displays the current stored text. These saves use ordinary last-write-wins ordering, including the [uncertain outcome of a write sent before disconnection](../../product/resources/json-store.md#^js-disconnect).

A rejection other than `disconnected` clears the retained draft, including any newer unsent typing, and displays the value after SDK rollback, with the [save-failure message](../../ui/templates/sticky-note.mdx#saving). The displayed value may include a write whose durability the server [could not confirm](../../product/resources/json-store.md#^js-uncertain-write).

## Packaged page and guidance

The page loads Television's canonical stylesheet and the resource SDK, and includes its other page dependencies inside the template folder so copied artifacts work independently. Its stylesheet is `styles.css` in the template folder, loaded after the canonical stylesheet; [conformance](../../spec-ui.md#conformance) holds the packaged page to the UI stories.

The template carries its own `Caveat-Medium.woff2`, byte-identical to the [story font](../../../storybook/spec/templates/sticky-note/Caveat-Medium.woff2), and loads it through `@font-face` at weight 500. Production imports no spec files and fetches no external font. Conformance captures wait for the bundled font to load. The source is [Google Fonts' Caveat](https://github.com/google/fonts/tree/5571d84c0d8c70ec1af4f64072d8c5cf1e4e9643/ofl/caveat), under SIL Open Font License 1.1. The [font provenance](../../../storybook/spec/templates/sticky-note/font-source.md) records the fixed source, weight extraction and checksums.

Following [folder notices](../licensing.md#^licensing-folder-notices), the packaged font is registered in `scripts/licenses/assets.json` for `cli` and `source`, and for `desktop` if that package ships it. The template folder carries a generated `THIRD-PARTY-NOTICES.txt` with Caveat's complete upstream copyright notice and OFL terms, as Checklist carries its icon notice. The story copy has its own source-surface inventory entry and folder notice. The font remains under OFL when the template is copied or adapted.

The manifest's `icons` lists one entry, `icon.svg`, which is a square SVG. [Icon delivery](./index.md#icon-delivery) selects it, and [Toolbox](../../ui/app/toolbox.mdx#icons) draws it as supplied. ^bundled-artifact-template-sticky-note-icon

The bundled `README.md` explains the root object and `text` string, that a new note starts with empty text, that the typing hint is never saved, that spaces and line breaks are kept, and that other root fields are ignored and preserved. It explains that the page and agent share the artifact's own store and that changes appear live. It shows `tv resource json set --artifact <id> /text '"…"'` to replace the text and `tv resource json set --artifact <id> /text '""'` to clear it, leaving other fields alone.

The README explains [saving and concurrent changes](#saving-and-concurrent-changes), including retention of typing while disconnected and the need to keep the page open until it saves. It warns that invalid or missing data shows an error and is not repaired by the page. It identifies `styles.css` as the place to adapt the look and explains that the transparent document background works with the manifest display setting, which is applied at creation. It names the bundled Caveat font, links its upstream licence at the fixed revision above, and tells an adapting agent to retain the font's notice. Copied artifacts are independent of the installed template.

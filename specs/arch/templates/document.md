*The bundled Document artifact template: its packaged Markdown editor, store contract, page, and adapting-agent guidance.*

# Document artifact template

Document is a bundled [artifact template](../../product/templates.md#^artifact-template-bundled). The [inventory](./bundled-templates.md#^bundled-artifact-template-inventory) owns its ID, name, description, and versions. Its page uses Television's existing Markdown editor. The editor colour and table-interaction requirements belong to the [Markdown editor UI spec](../../ui/markdown-editor/index.md); the remaining editor UI is code-authoritative under the [frame-core carve-out](../artifact-frame/index.md#^frame-core-carve-out), while the template loading, status, and unreadable-data presentation remain code-authoritative under [spec migration](../../spec-migration.md).

The bundled manifest declares no `display`, so the shared defaults apply.

## Store

The template `data.json` seeds the [artifact's own JSON store](../../product/resources/resources.md#^rs-own-store) with `{"markdown":""}`. The empty string is the document, not placeholder text; a newly created document is blank and an agent can address its field immediately. Agents write the value, so it has a contract: the manifest's `dataSchema`, which is this schema. ^bundled-artifact-template-document-store

```json
{
  "type": "object",
  "required": ["markdown"],
  "properties": {
    "markdown": { "type": "string" }
  }
}
```

The string may be empty and may contain whitespace and line breaks. Other root fields are ignored and left unchanged by page writes. [Creating an artifact](./index.md#^artifact-template-schema) from the template rejects starting data that breaks the schema; writes after creation are not checked against it.

The page subscribes to the whole store through the [resource SDK](../resources/sdk.md), so it can validate the root as well as the Markdown string. Each save uses `set` at `markdown` with the complete current string, leaving other root fields alone. Clearing the editor writes `""`; it does not remove the field. Opening, reading and displaying the document write nothing.

A missing value, a value that breaks the schema, or saved data reported unavailable prevents editing and starts no write. The page never repairs the value. A later valid value resumes the ordinary binding; unavailable saved data otherwise follows the [resource recovery rules](../resources/index.md#^rs-storage). ^bundled-artifact-template-document-errors

## Editor binding and saving

The page mounts a packaged build of the same editor implementation and extensions as the Markdown file view, including tables, task lists, Markdown gestures, undo history, and Markdown punctuation hidden until the caret reaches it. Link handling follows the [HTML-artifact rules](../artifact-frame/artifact-bridge.md#^ab-link-handling): relative links resolve against the copied template folder and, in Chromium, application links have the sandboxed HTML-artifact limitation described by [artifact isolation](../artifact-frame/isolation.md#^iso-limitations). ^bundled-artifact-template-document-editor

While handling a store snapshot, the page passes a value to the editor only when no page write is pending and its `markdown` string differs from the value it last passed; a change elsewhere in the store, or the SDK's optimistic copy of a page write, leaves the editor alone. An empty string is valid. Editing is allowed only while the page is connected, has read-write access, and holds valid data.

The editor sends the complete current string after its ordinary save pause. A local edit is written only while editing is allowed. The page passes stored Markdown strings through `setValue` under the snapshot rule above; the internal mount meanings below govern what the editor does with those values and with the `onSave` result. ^bundled-artifact-template-document-binding

A refused store save rejects the editor's `onSave` promise. A write whose outcome became uncertain follows the [store's uncertain-write rule](../../product/resources/json-store.md#^js-uncertain-write). ^bundled-artifact-template-document-refused-save

Unsent typing is discarded when the connection drops, when read-write access is lost, when the data becomes unreadable, when a different stored Markdown string arrives, or when the page closes. On disconnection the page stops editing and restores the latest known stored string; the SDK may also roll back an unconfirmed write. Editing resumes once the page is connected, has read-write access, and still holds valid data. A value that changed while the page was disconnected arrives through the ordinary subscription binding. The page has no offline queue. ^bundled-artifact-template-document-discard

The page follows [`onAccessChanged`](../resources/sdk.md#^sdk-access). A move from read-write to read stops editing and restores the latest known stored string. Changing the share link the page was opened through to read-write allows editing when the other editing conditions hold. Revocation retains the latest value already delivered but supplies no newer value. No discarded edit is replayed. Concurrent person and agent saves replace the whole string under the [store's last-write-wins rule](../../product/resources/json-store.md#^js-write-order); this version does not merge their text. ^bundled-artifact-template-document-access

## Packaged editor

The bundled template folder contains committed `editor.js`, `editor.css`, and `THIRD-PARTY-NOTICES.txt` files. The JavaScript and stylesheet are built from the same editor source as the Markdown file view. `editor.js` is a self-contained classic script for the editor alone: it does not contain the Markdown file view start-up code or module-preload polyfill. `editor.css` contains the editor layout and the Markdown editor colour stylesheet, scopes every rule beneath the page element whose ID is `editor`, and sets no layout or presentation elsewhere on the page. These files are the editor and licensing material the template packages with its page. ^bundled-artifact-template-document-editor-package

Within the template package, `page.js` mounts the editor as a direct child of the page element whose ID is `editor`, with an authoritative string named `value`, an editing state named `editable`, and an asynchronous save callback named `onSave`. The returned handle can supply a later authoritative string, change the editing state, move focus to the editor, and dispose of the editor. The operations have these meanings: ^bundled-artifact-template-document-editor-interface

- `onSave` receives the complete local string after the ordinary save pause. If its promise resolves, the editor retains that string as stored unless a newer stored value arrived while the save was pending, or an earlier save was refused while it was pending. If the promise rejects, the editor restores the string it last recorded as stored—the last value supplied through `value` or `setValue`, or a later save whose promise resolved—unless a newer stored value, including one confirming that save, arrived while it was pending, or an earlier save was refused while it was pending.
- `setValue` supplies a later authoritative string, cancels any unsent local change, and never calls `onSave`. Supplying a string equal to the editor's current text records it as stored without replacing the editor state. A value that confirms a save still in progress also records that saved string without replacing a newer local edit or cancelling its pending save. A value equal to the most recently completed save, when no newer authoritative value has arrived since that save began, is recorded in the same way.
- `setEditable` controls whether the editor accepts changes and, when changed to `false`, cancels any local change waiting to be passed to `onSave`. It does not cancel an `onSave` call already in progress. While editing is disabled, `setValue` always replaces the document.
- Disposing ends callbacks and releases the editor.

This is an internal boundary between files copied together in one template package, not a route or compatibility promise for another page. A template revision may change both sides together. Editor behaviour and appearance outside these meanings follow the editor source included in that revision.

The editor build is committed rather than generated while building the server or CLI. The [packaged Markdown editor check](../licensing.md#^licensing-document-template-editor-check) rebuilds the editor and its licensing record into temporary output and compares them with the committed files, including byte-for-byte JavaScript and stylesheet comparisons. The server and CLI builds copy the committed template folder and do not rebuild it. A source change cannot pass while the committed editor or its licensing record is stale. The Markdown file view remains a separate build from the same source; packaging this editor does not change its page, start-up path, or behaviour.

The Markdown file view build remains the one writer of the `view:markdown` [license inventory](../licensing.md#^licensing-declared-surfaces). The template editor build uses the existing Vite license plugin without writing another surface inventory. [Licensing architecture](../licensing.md#^licensing-document-template-editor-record) owns the editor licensing record, its inputs, the notices rendered from it, and the checks that keep them current.

The copied artifact page remains the top-level sandboxed artifact document. It owns the resource SDK subscription and adapts the store's `markdown` string to the internal editor interface. Its `index.html` loads `editor.js` and `editor.css` from the copied folder. Because artifact creation copies the complete folder, every artifact carries the editor version it was created with. Updating Television or the installed template does not replace those copied editor files; a later template revision affects only later copies. Like other templates, the page still loads Television's versioned canonical resources and resource SDK.

## Packaged page and guidance

The page loads Television's canonical stylesheet before its packaged editor stylesheet, loads its own `styles.css` after that, and loads the resource SDK. `styles.css` owns the template page layout and the loading, status, and unreadable-data presentation around the editor. The page adds no editing controls or Markdown treatment of its own. The manifest's `icons` lists one first-party entry, `icon.svg`, which is a square SVG depicting a page with a folded corner and a few text lines in the style and stroke weight of the other first-party template icons. [Icon delivery](./index.md#icon-delivery) selects it, and [Toolbox](../../ui/app/toolbox.mdx#icons) draws it as supplied. ^bundled-artifact-template-document-page

The bundled `README.md` says plainly that the document is Markdown text. It explains the root object and `markdown` string, the exact blank start, preserved whitespace, line breaks and extra root fields, complete-string saves, live page and agent updates, last-write-wins replacement, and the lack of offline merging. It tells an agent that its read and replace commands require `jq`, tells it to read the current string again immediately before replacing it, shows how to read the raw Markdown into a file without adding a line break, and says that an absent field produces `null` instead. It shows how to replace the string from a file and the empty-string form to clear it, and warns that a full-string write replaces anything the person saved since the agent last read as well as typing not yet saved when the write arrives. It warns that invalid or missing data is not repaired. It tells an adapting agent to retain the `#editor` mount element and to update `page.js`, `editor.js`, `editor.css`, and `THIRD-PARTY-NOTICES.txt` together unless it deliberately replaces the editor and its licensing material; visual adaptations belong in `styles.css`. It explains that each copied artifact contains its own editor and notices, and that neither a Television update nor a later installed template replaces those copied editor files. ^bundled-artifact-template-document-readme

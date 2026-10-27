*The bundled Markdown artifact template: its shared editor, store contract, packaged page, and adapting-agent guidance.*

# Markdown artifact template

Markdown is a bundled [artifact template](../../product/templates.md#^artifact-template-bundled). The [inventory](./bundled-templates.md#^bundled-artifact-template-inventory) owns its ID, name, description, and versions. Its page is Television's existing Markdown editor: the editor's colour and table-interaction requirements belong to the [Markdown editor UI spec](../../ui/markdown-editor/index.md), and the rest of its visible editing behaviour remains code-authoritative under the [frame-core carve-out](../artifact-frame/index.md#^frame-core-carve-out).

The bundled manifest declares no `display`, so the shared defaults apply.

## Store

The template `data.json` seeds the [artifact's own JSON store](../../product/resources/resources.md#^rs-own-store) with `{"markdown":""}`. The empty string is the document, not placeholder text; a newly created document is blank and an agent can address its field immediately. Agents write the value, so it has a contract: the manifest's `dataSchema`, which is this schema. ^bundled-artifact-template-markdown-store

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

A missing value, a value that breaks the schema, or saved data reported unavailable shows an alert that the document cannot be shown and that an agent should check its saved data. The editor is absent and the page starts no write until it receives a valid value again. It never repairs the value. The alert recovers live after the store is repaired; unavailable saved data otherwise follows the [resource recovery rules](../resources/index.md#^rs-storage). ^bundled-artifact-template-markdown-errors

## Editor binding and saving

The page mounts the same editor implementation and extensions as a Markdown file artifact, including its tables, links, task lists, Markdown gestures, undo history, and source treatment. The editor is delivered as a versioned shared asset below; the template does not carry a second editor implementation. ^bundled-artifact-template-markdown-editor

On the first valid store value, the page puts `markdown` in the editor. A valid empty string presents a blank editor. Once write access is established, a new blank document receives keyboard focus so the person can start typing. Loading presents no editable document. Read access presents the current document in the editor without editing.

The editor sends the complete current string after its ordinary 500 ms save pause. A local edit is written only while the connection is available and the page has read-write access and valid data. The resource SDK publishes that page write optimistically; when its store update carries the same string the editor just sent, the editor treats it as a save echo and does not replace its document, selection, scroll position, or undo history. A different incoming string is an agent or other viewer's edit and replaces the open document without generating another save. An unchanged incoming string does nothing. ^bundled-artifact-template-markdown-binding

If a save is refused, the editor returns to its latest known stored string and the page reports that the change could not be saved. The message clears after a short interval. A write whose outcome became uncertain follows the [store's uncertain-write rule](../../product/resources/json-store.md#^js-uncertain-write).

When the SDK reports disconnection, the page makes the editor read-only, keeps the latest known stored document visible, discards an edit that had not started a write, and says `Reconnecting…`. The SDK may roll back an unconfirmed write. After reconnection its subscription supplies the current stored string before editing resumes. The page has no offline queue.

The page follows [`onAccessChanged`](../resources/sdk.md#^sdk-access). A move from read-write to read makes the editor read-only and restores the latest stored string. Revoking access retains that string visibly and read-only. If access later returns, a current valid store value makes the editor editable again. No unsaved edit is replayed after access returns. Concurrent person and agent saves replace the whole string under the [store's last-write-wins rule](../../product/resources/json-store.md#^js-write-order); this version does not merge their text. ^bundled-artifact-template-markdown-access

## Shared editor asset

The Markdown view build emits a classic script and stylesheet at `/views/markdown/v1/editor.js` and `/views/markdown/v1/editor.css` from the same editor source that it inlines into `/views/markdown/index.html` for Markdown file artifacts. The script exposes only the editor-mount interface the template page needs. Because it is a classic script, a sandboxed artifact page can load it without widening the cross-origin rules for JavaScript modules. The versioned path is stable for copied artifacts; a future incompatible mount interface uses a new path rather than changing `v1`. ^bundled-artifact-template-markdown-shared-asset

The copied artifact page remains the top-level artifact document. It owns the resource SDK subscription and adapts the store's `markdown` string to the editor's existing content-update interface. It does not embed the Markdown view as another frame, install another artifact bridge, or proxy artifact lifecycle and navigation messages. The existing unauthenticated Markdown-view route serves the nested shared assets, and existing recursive view packaging includes them in the CLI distribution.

The editor and its shared assets remain the existing `view:markdown` [licensing surface](../licensing.md#^licensing-declared-surfaces). Referring to them from a template does not copy their third-party files into the template or create another licensing surface.

## Packaged page and guidance

The page loads Television's canonical stylesheet, the versioned shared editor stylesheet and script, and the resource SDK. Its local `styles.css` owns only the loading, status, and unreadable-data presentation around the editor. The page adds no editing controls or Markdown treatment of its own. The manifest's `icons` lists one first-party entry, `icon.svg`, which is a square SVG. [Icon delivery](./index.md#icon-delivery) selects it, and [Toolbox](../../ui/app/toolbox.mdx#icons) draws it as supplied. ^bundled-artifact-template-markdown-page

The bundled `README.md` explains the root object and `markdown` string, the exact blank start, preserved whitespace, line breaks and extra root fields, complete-string saves, live page and agent updates, last-write-wins replacement, and the lack of offline merging. It shows `tv resource json set --artifact <id> markdown '"…"'` to replace the document and the empty-string form to clear it. It warns that invalid or missing data is not repaired. It explains that the editor implementation is shared from Television rather than copied into the artifact, identifies the local files that adapt the store and states that copied artifacts are independent. ^bundled-artifact-template-markdown-readme

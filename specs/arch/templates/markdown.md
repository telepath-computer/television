*The bundled Markdown artifact template: its shared editor, store contract, packaged page, and adapting-agent guidance.*

# Markdown artifact template

Markdown is a bundled [artifact template](../../product/templates.md#^artifact-template-bundled). The [inventory](./bundled-templates.md#^bundled-artifact-template-inventory) owns its ID, name, description, and versions. Its page uses Television's existing Markdown editor. The editor colour and table-interaction requirements belong to the [Markdown editor UI spec](../../ui/markdown-editor/index.md); the remaining editor UI and the template loading, status, and unreadable-data presentation remain code-authoritative under [spec migration](../../spec-migration.md).

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

A missing value, a value that breaks the schema, or saved data reported unavailable prevents editing and starts no write. The page never repairs the value. A later valid value resumes the ordinary binding; unavailable saved data otherwise follows the [resource recovery rules](../resources/index.md#^rs-storage). ^bundled-artifact-template-markdown-errors

## Editor binding and saving

The page mounts the same editor implementation and extensions as a Markdown file artifact, including tables, task lists, Markdown gestures, undo history, and source treatment. Link handling follows the [HTML-artifact rules](../artifact-frame/artifact-bridge.md#^ab-link-handling): relative links resolve against the copied template folder and, in Chromium, application links have the sandboxed HTML-artifact limitation described by [artifact isolation](../artifact-frame/isolation.md#^iso-limitations). The editor is delivered as a versioned shared asset below; the template does not carry a second editor implementation. ^bundled-artifact-template-markdown-editor

While handling a store snapshot, the page passes a value to the editor only when no page write is pending and its `markdown` string differs from the value it last passed; a change elsewhere in the store, or the SDK's optimistic copy of a page write, leaves the editor alone. An empty string is valid. Editing is allowed only while the page is connected, has read-write access, and holds valid data.

The editor sends the complete current string after its ordinary save pause. A local edit is written only while editing is allowed. The resource SDK publishes that page write optimistically; when the confirmed store value carries the same string the editor just sent, the editor records it as the latest stored value without replacing its document. Any other stored string replaces the open document without generating another save. A string equal to the editor's current text does not replace the editor state. ^bundled-artifact-template-markdown-binding

A refused save returns the editor to the latest known stored string unless a newer stored value arrived while the save was pending. A write whose outcome became uncertain follows the [store's uncertain-write rule](../../product/resources/json-store.md#^js-uncertain-write).

Unsent typing is discarded when the connection drops, when read-write access is lost, when the data becomes unreadable, or when a different stored Markdown string arrives. On disconnection the page stops editing and restores the latest known stored string; the SDK may also roll back an unconfirmed write. Editing resumes once the page is connected, has read-write access, and still holds valid data. A value that changed while the page was disconnected arrives through the ordinary subscription binding. The page has no offline queue.

The page follows [`onAccessChanged`](../resources/sdk.md#^sdk-access). A move from read-write to read stops editing and restores the latest known stored string. Changing that share link to read-write allows editing when the other editing conditions hold. Revocation retains the latest value already delivered but supplies no newer value. No discarded edit is replayed. Concurrent person and agent saves replace the whole string under the [store's last-write-wins rule](../../product/resources/json-store.md#^js-write-order); this version does not merge their text. ^bundled-artifact-template-markdown-access

## Shared editor asset

The Markdown view build emits a classic script and stylesheet at `/views/markdown/v1/editor.js` and `/views/markdown/v1/editor.css` from the same editor source that it inlines into `/views/markdown/index.html` for Markdown file artifacts. The classic script assigns this interface to `window.TelevisionMarkdownEditor`: ^bundled-artifact-template-markdown-shared-asset

```ts
type MarkdownEditorV1MountOptions = {
  parent: HTMLElement;
  value: string;
  editable: boolean;
  onSave(value: string): Promise<void>;
};

type MarkdownEditorV1Handle = {
  setValue(value: string): void;
  setEditable(editable: boolean): void;
  focus(): void;
  dispose(): void;
};

type MarkdownEditorV1 = {
  mount(options: MarkdownEditorV1MountOptions): MarkdownEditorV1Handle;
};
```

`parent` is the page element whose ID is `editor`. The calls have these meanings:

- `mount` creates the editor as a direct child of `parent`, using `value` as the initial authoritative string and `editable` as its initial editing state.
- `onSave` receives the complete local string after the ordinary save pause. Its promise tells the editor whether to retain that string as stored or, unless a newer stored value arrived while the save was pending, restore the last value supplied through `value` or `setValue`.
- `setValue` supplies a later authoritative string, cancels any unsent local change, and never calls `onSave`. Supplying a string equal to the editor's current text records it as stored without replacing the editor state. A value that confirms a save still in progress also records that saved string without replacing a newer local edit or cancelling its pending save.
- `setEditable` controls whether the editor accepts changes and, when changed to `false`, cancels any local change waiting to be passed to `onSave`. It does not cancel an `onSave` call already in progress. The page uses `setValue` to discard the local change itself.
- `focus` moves keyboard focus to the editor.
- `dispose` ends callbacks and releases the editor.

The v1 contract comprises the interface names and meanings, a handle with no editor-library object, a script that does nothing on load except define `window.TelevisionMarkdownEditor`, and a stylesheet that styles only the editor inside `parent` while remaining compatible with canonical v2. Breaking any part of that contract requires a new versioned path. Editor behavior and appearance outside the contract follow the current Television Markdown editor and may change under `v1`.

Television keeps the v1 files served after a later version ships, with the later version beside them at its own path, and may freeze v1 at that point to preserve its contract. [Artifact isolation](../artifact-frame/isolation.md#^iso-routes) owns their cross-origin delivery.

The copied artifact page remains the top-level artifact document. It owns the resource SDK subscription and adapts the store's `markdown` string to the v1 interface. The existing unauthenticated Markdown-view route serves the shared assets, and existing recursive view packaging includes them in the CLI distribution.

The editor and its shared assets remain the existing `view:markdown` [licensing surface](../licensing.md#^licensing-declared-surfaces). The file-view build writes that surface's one licence inventory; the v1 build verifies that every package it emits is covered by that inventory and writes no second inventory or notices file. Referring to the assets from a template does not copy their third-party files into the template or create another licensing surface.

## Packaged page and guidance

The page loads Television's canonical stylesheet, the versioned shared editor stylesheet and script, and the resource SDK. Its local `styles.css` owns the template page layout and the loading, status, and unreadable-data presentation around the editor. The page adds no editing controls or Markdown treatment of its own. The manifest's `icons` lists one first-party entry, `icon.svg`, which is a square SVG. [Icon delivery](./index.md#icon-delivery) selects it, and [Toolbox](../../ui/app/toolbox.mdx#icons) draws it as supplied. ^bundled-artifact-template-markdown-page

The bundled `README.md` explains the root object and `markdown` string, the exact blank start, preserved whitespace, line breaks and extra root fields, complete-string saves, live page and agent updates, last-write-wins replacement, and the lack of offline merging. It tells an agent to read the current string again immediately before replacing it, shows a file-based replacement command and the empty-string form to clear it, and warns that a full-string write replaces anything the person saved since the agent last read as well as typing not yet saved when the write arrives. It warns that invalid or missing data is not repaired. It tells an adapting agent to retain the `#editor` mount element. It explains that copied page files are independent and that each copy loads the compatible v1 editor served by Television, receiving compatible updates while v1 remains live. ^bundled-artifact-template-markdown-readme

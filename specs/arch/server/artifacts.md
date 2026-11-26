*The artifact record on disk and on the wire, and how its ID or share ID becomes a document address.*

# Artifact registry and serving

A registered artifact points to content. Its record survives changes to that content, including the disappearance of a file. The artifact ID identifies the record for its lifetime. An HTTP address containing that ID can grant a page access to the artifact and its store, so the distinction between an artifact ID and a share ID matters even on an error page.

## Record

The unversioned JSON at `state/artifacts/<id>.json` has the same shape clients receive in reads and change notifications. ^rs-artifact-record

```ts
type Artifact =
  | { id: string; kind: "url"; title: string; url: string }
  | {
      id: string; kind: "path"; title: string; path: string;
      store?: string;
      share?: { id: string; access: AccessLevel };
    };
```

`store` is the resource ID of the artifact's own store after its first write. `share` is its current share link, with the resource layer's [access level](../resources/index.md#^rs-records). Their absence is valid, including in records written by older releases. [Resources](../resources/index.md#^rs-share-ids) owns allocation across the common artifact/share ID namespace, link changes and access decisions. Product owns [title and ID semantics](../../product/artifacts.md).

Creation takes a title, kind, the corresponding content pointer, and the channel in which to place the page. The server assigns the ID. Editing changes the title or the pointer of the same kind. A URL must be absolute HTTP or HTTPS. A path must be absolute and readable when registered or retargeted. It names an HTML or Markdown file (`.htm`, `.html`, `.md`, `.markdown`, case-insensitive) or a directory containing `index.html` or `index.htm`. Check the [real location](../../product/artifacts.md#^af-real-location) while retaining the supplied path as the pointer. Persist a trailing separator for a folder and omit it for a file. This lets every client identify a folder even when its source is offline.

Apply each record change to the current record, including when a title edit races a store or share update. All rewrites and deletions use the [resource storage durability rule](../resources/index.md#^rs-storage). If persistence is uncertain, reconcile with the disk and report the unknown outcome. An uncertain deletion that finds the record gone takes effect as a deletion. [Layout](../layout/index.md#^ly-move) governs placement and the consequences of a partially completed move. A layout edit or a move cannot change a record's ID, pointer, store or link.

## Reading a document

`GET` and `HEAD /artifact/<id>/…` serve path artifacts. Other methods receive 405 with `Allow: GET, HEAD`. Unknown IDs, revoked share IDs and URL-artifact IDs resolve to no local document. For a registered artifact whose entry is missing, serve the bundled missing-artifact page with status 404 when available. A missing subresource receives 404.

| Source | Entry under its artifact ID | Entry under its share ID |
|---|---|---|
| Single file | Redirect the shorthand address to the encoded filename. Serve only that file. | Serve the file at the slash-terminated root. Its filename and other child paths answer as missing. |
| Folder | Serve the directory index at the slash-terminated path and allow its [visible descendants](../../product/artifacts.md#^af-folder-files). | The same directory addressing under the share ID. |

A share address grants only the [access its link carries](../resources/index.md#^rs-resolve-id). Keep redirects, headers and error documents within the address the caller supplied. They must not disclose the artifact's own ID or filesystem path, including through a file-serving library's redirect or diagnostic when the target changes during the request. Unknown share IDs are indistinguishable from unknown artifact IDs. ^rs-share-serving

Folder and share shorthand redirects use 301 and add the needed slash. HTML and Markdown rendered as read-only HTML receive the [artifact bridge](../artifact-frame/artifact-bridge.md) and [appearance resolver](../themes/delivery.md). Other folder assets retain their file representation. The browser's access to these responses follows [artifact isolation](../artifact-frame/isolation.md#^iso-routes).

The Markdown editor reads and replaces a registered Markdown file through the authenticated control interface. An unknown ID, an ineligible target or a missing file receives 404. This distinction keeps an artifact page or a read-only share link from acquiring the ability to edit source text. The editor's rendering and internal protocol follow the [frame boundary](../artifact-frame/index.md#^frame-core-carve-out).

## Revalidation

Proxied HTML and rendered Markdown carry `Cache-Control: no-cache, must-revalidate` and an `ETag` for the complete served representation, including injected inputs. A matching validator can receive 304. Other successful file responses carry `Cache-Control: no-cache` and an `ETag`, so changing a nested asset takes effect on its next load. Shorthand redirects and unsuccessful responses, including the missing-artifact page, carry no cache-control header.

## Testing

Check validators against a listening server using real document transformation and bridge injection, including conditional HTTP requests. ^apx-testing

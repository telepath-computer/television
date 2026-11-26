*The artifact proxy: the addresses at which the server serves a path artifact's files, what it adds to them, how it serves an artifact under a share ID without revealing the artifact's own ID, and its cache contract.*

# Artifact proxy

A path artifact reaches its frame, and anyone holding a link to it, through the server: the *artifact proxy* serves the artifact's files at an address built from its ID. Artifact documents are written against these addresses, with relative links between their files, and the addresses are handed out in share links, so they are a contract with documents and people the server never sees again. This document defines the addresses, the share-link form of them, and how responses are cached.

The proxy serves path artifacts only. A URL artifact's document is loaded by the client from its own address.

## Addresses

The proxy answers `GET` and `HEAD` under `/artifact/<id>/`, where `<id>` is an artifact ID or a share ID. The ID is the whole authorization ([capability routes](./http.md#^srv-route-classes)); [resources](../resources/index.md#^rs-resolve-id) owns what each kind of ID reaches. An ID that reaches no path artifact is answered as not found. ^srv-proxy-addresses

- **A folder artifact** is served as a directory. `/artifact/<id>/` is its index page, and every other file is at its path relative to the folder, so the relative links an author wrote between the folder's files work unchanged. Which files a folder serves is the product's rule ([folder files](../../product/artifacts.md#^af-folder-files)).
- **A single-file artifact**, HTML or Markdown, is served at `/artifact/<id>/<file name>`, and `/artifact/<id>/` redirects there. It serves that one file: files beside it on disk are not part of the artifact, and an artifact that needs them is a folder artifact.
- **A Markdown file** is served rendered, as a read-only HTML page. The Markdown editor reads and saves the file's text through a token route instead, because the proxy's addresses carry no authority to write.

`/artifact/<id>` without the trailing slash redirects to the address with it.

Every request checks again that the artifact's path still leads to something a path artifact can be made from ([real location](../../product/artifacts.md#^af-real-location)). When it does not, the artifact's own address answers with the artifact-missing page, and any other path under it as a missing file.

## What the proxy adds

The proxy serves an author's files as they are, with these additions:

- Into every HTML response, including rendered Markdown, it inserts Television's two scripts, which [the artifact bridge](../artifact-frame/artifact-bridge.md) owns. A file that is not HTML is served untouched.
- Every response carries the [sandbox header](../artifact-frame/isolation.md#^iso-sandbox-header) and the [cross-origin headers](../artifact-frame/isolation.md#^iso-routes) isolation defines.
- Every response carries `Referrer-Policy: no-referrer`. The document's address holds the ID that grants access to the artifact, so the address must not travel to other sites as a referrer. ^srv-proxy-referrer

## Serving under a share ID

The proxy serves `/artifact/<share-id>/…` as it serves the artifact's own address, with one difference: nothing in a response may reveal the artifact's own ID ([the product promise](../../product/resources/resources.md#^rs-share-hides-id)). Every redirect it sends, every error document and every response header is built from the ID and the path in the request, never from the artifact's own ID or from the names of its files and folders on disk, which can contain that ID. A single-file artifact is therefore served at `/artifact/<share-id>/` itself, where under its own ID that address redirects to its file's name; and every other path under the share ID, the file's name included, answers as a missing file. This holds for the redirects and errors of the library that streams the files, and while the files change during a request: a single file that has become a folder is answered as missing. An error response carries its status and fixed text for it, never the server's own text for the failure, such as a file's path. A share ID that reaches nothing, such as a revoked one, is served as an ID that names no artifact. ^rs-share-serving

## Caching

An artifact's files can change at any time, so a browser may keep their bytes but checks with the server before using them on a new load. An unchanged file is not transferred again, and an edit is visible at once. Successful proxy responses follow the revalidating class of the [canonical cache policy](../canonical.md#^cn-cache-policy):

- **HTML documents and rendered Markdown** carry `Cache-Control: no-cache, must-revalidate` and an `ETag`. The validator represents the complete response, including the rendering and the inserted scripts, so a matching `If-None-Match` may be answered `304`, and a change to any of those inputs changes the validator.
- **Every other file** carries `Cache-Control: no-cache` and an `ETag`, whether another document fetches it or the frame navigates to it directly.
- **Redirects and unsuccessful responses** carry no `Cache-Control` header: the redirects above, a plain `404`, the artifact-missing page, and the `405` for a method other than `GET` and `HEAD`.

How a client forces a reload is [reload and navigation's](../artifact-frame/reload-navigation.md#Reload).

## Testing guidance

Cache coverage sends real HTTP requests to a running server with the real rendering and script insertion in place. The document validator covers both, so a test that replaces either is not testing this contract. ^apx-testing

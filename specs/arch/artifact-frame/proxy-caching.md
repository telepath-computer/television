*The artifact proxy's complete cache contract: validators keep live artifact documents and their local assets current without forbidding browser storage.*

# Artifact proxy caching

A path artifact reaches its frame through Television's HTTP server. Its source files can change at any time, so a browser may retain their bytes but checks with the server before using them on a new load; unchanged files avoid another transfer, while an edit is visible immediately.

## Authority

This spec owns the cache behavior of every response produced by the artifact proxy: successful document and file responses, redirects from shorthand routes, and unsuccessful responses including the built artifact-missing document and method rejection. Its authority is limited to caching. HTML transformation, rendered-markdown transformation, and bridge injection remain [artifact-bridge.md](./artifact-bridge.md)'s; client-side reload and the `tv-reload` cache-buster remain [reload-navigation.md](./reload-navigation.md)'s.

## Cache policy

The GUI bundle's cache contract explicitly leaves the artifact proxy to its own owner ([updates/version-advertisement.md#^cache-headers](../updates/version-advertisement.md#^cache-headers)). Successful proxy resources follow the non-content-addressed class stated by the [canonical cache policy](../canonical.md#^cn-cache-policy): they are stored only with mandatory revalidation and an `ETag`.

Proxied HTML documents and markdown rendered as HTML carry `Cache-Control: no-cache, must-revalidate` and an `ETag`. The document validator represents the complete served response, including transformation and injected bridge inputs, so a matching `If-None-Match` may return `304` and any changed input produces a changed validator and response.

Every other successful artifact-file response carries `Cache-Control: no-cache` and an `ETag`. This class covers both a document subresource and a raw document — a non-HTML file navigated to as the frame's document rather than fetched by another document. Revalidation happens before reuse, so an edit to an artifact-local stylesheet, script, image, or other file is observable on the next load rather than after a stale response has been used.

A shorthand-route `301` redirect carries no `Cache-Control` header. Every unsuccessful response also carries no `Cache-Control` header, including a plain `404`, the built artifact-missing `404`, and a `405` method rejection. These responses do not participate in the proxy's validator-based reusable-resource policy.

## Testing

Tests must send real HTTP requests to a running Television server, with no mock or test hook anywhere on that path. The validator covers the transformed document and the injected bridge, so a test that replaces the HTML or markdown transformation or the bridge injection is not testing this contract. ^apx-testing


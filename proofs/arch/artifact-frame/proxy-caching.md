*How the promises in Artifact proxy caching are proven.*

# Artifact proxy caching — proof

Proves [specs/arch/artifact-frame/proxy-caching.md](../../../specs/arch/artifact-frame/proxy-caching.md).

## Coverage model

Coverage declarations are carried inside the migrated assertion blocks below.

## Assertions

### Test assertions

- **Seam** (artifact-proxy response assembly → HTTP cache behavior, crossed over real HTTP against a running production server; temporary HTML and markdown sources are fixtures; real transformation and bridge injection run with no mocks or test hooks): proxied HTML and rendered markdown each carry `Cache-Control: no-cache, must-revalidate` and an `ETag`, a matching `If-None-Match` returns `304`, and changing the source changes both the validator and the next response body — *(covered by inherited tests in `packages/server/test/artifact-proxy.test.ts`: “supports HEAD, method rejection, and injected-HTML validators” for HTML headers and conditional reuse, and “renders markdown artifacts through the proxy as injected HTML with validators” for markdown headers, conditional reuse, and source changes)* *(covered by test: `packages/server/test/artifact-proxy.test.ts` “revalidates proxied HTML after source edits” for HTML source edits completing the document-cache seam)*. ^apx-t-document-cache
- **Seam** (artifact-proxy file serving → HTTP cache behavior, crossed over real HTTP against a running production server; a temporary artifact-local stylesheet is the fixture; no mocks or test hooks): the response carries `Cache-Control: no-cache` and an `ETag`, a matching `If-None-Match` returns `304`, and an edit is returned with a changed validator on the next request — *(covered by test: `packages/server/test/artifact-proxy.test.ts` “revalidates artifact-local stylesheets before reuse”)*. ^apx-t-asset-cache
- **Seam** (artifact-proxy non-resource responses → HTTP cache behavior, crossed over real HTTP against a running production server; shorthand directory routing, an unknown artifact, a missing canonical artifact entry resolved through the artifact-missing view path over an authored views root, and method rejection are fixtures; no mocks or test hooks): the `301` shorthand redirect, plain `404`, artifact-missing `404`, and `405` each omit `Cache-Control` — *(covered by test: `packages/server/test/artifact-proxy.test.ts` “leaves redirects and unsuccessful responses without cache directives”)*. ^apx-t-nonresource-cache

Coverage relationship: [artifact-bridge.md#^ab-ac-proxy-injection](./artifact-bridge.md#^ab-ac-proxy-injection) proves which response kinds receive bridge injection and that bridge-source changes participate in document validators; [#^apx-t-document-cache](#^apx-t-document-cache) owns how those validators and cache headers behave over HTTP. [reload-navigation.md#^rn-ac-cache-buster](./reload-navigation.md#^rn-ac-cache-buster) owns the client's explicit reload URL, not subresource freshness.


*How source changes reach an embedded artifact, how the artifact reloads and reports in-frame navigation, and how it keeps per-artifact back/forward history and bridge readiness truthful.*

**Status:** adopted redesign authority. Local folder artifacts and active themes conform to the shared content-watcher contract. The remaining navigation-recording carve-out is deliberately code-authoritative.

# Reload and navigation

A navigable artifact remembers where its user has been inside it, like a small browser: each artifact keeps its own back/forward history, and the app can reload the artifact's document without losing that place. A folder-backed artifact also stays current while its source tree changes. This spec pins down the server-to-client path for those local source updates and the client-side machinery for reloads and history; apart from the main-frame requirement below, how a reported move is recorded into history is code-governed ([#^nav-recording-carve-out](#^nav-recording-carve-out)).

## Authority

This spec owns the server-to-client **local path-content update** contract, the shared server filesystem-watcher mechanics used by local path artifacts and active installed themes, the client-side mechanics of **reloading** an embedded artifact, the per-artifact **navigation history** engine (the back/forward stack, URL conversion, and persistence), and the retained **navigation outcomes** under "Navigation events." After the main-frame filter, the recording pipeline between a reported move and the history engine is code-governed ([#^nav-recording-carve-out](#^nav-recording-carve-out)). It also owns consumption of the remote content-change notification; the poll that produces that notification is [artifact-bridge.md](./artifact-bridge.md)'s. It owns the navigation-state contract and the URL-conversion rules.

The local update section is a narrow integration buffer for the shared content watcher, `ServerStore`'s path-artifact consumer, and the `/events` event stream while server architecture remains outside spec authority ([spec-migration.md](../../spec-migration.md)). [Theme architecture](../themes/index.md#active-package-observation) owns the active-package consumer and its domain event. These buffers do not migrate surrounding server behavior.

This spec shares the bridge message protocol and readiness tracking with [artifact-bridge.md](./artifact-bridge.md); the wire types `navigation-request` and `proxy-content-changed` are owned there and consumed here. User-facing behavior is [artifact-navigation.md](../../product/artifact-navigation.md) and [product/artifacts.md](../../product/artifacts.md) (product); history-control rendering and interaction are [ui/app/artifact-frame/index.md](../../ui/app/artifact-frame/index.md)'s. The artifact kinds and `isTvArtifact` predicate live in code not yet under spec authority (see [spec-migration.md](../../spec-migration.md)).

## Reload

`reloadProxyFrame` is the single writer that reloads the embedded frame. It targets only the content frame (not a side markdown frame), and for a *remote artifact* reloads the **current navigation URL** (preserving where the user navigated to), otherwise the frame's `src`. It stamps a monotonic cache-buster query param `tv-reload` (`PROXY_RELOAD_PARAM`), records the busted URL in `_activeReloadFrameSrc`, drops the load flag, resets readiness — retiring the trusted document, before the reload URL is committed ([artifact-bridge.md#^ab-reset-before-assign](./artifact-bridge.md#^ab-reset-before-assign)) — and renders through one `frameSrcOverride` write path. There is no second `setAttribute`/re-render race.

`tv-reload` is a **client-only** cache-buster. It is added only in `reloadProxyFrame` and stripped client-side in three helpers (`convertURL`, `convertURLForInternalOrigin`, `sameLogicalDocumentURL`); the server never strips it. Stripping keeps it out of recorded history and out of "same document" comparisons. Reloading leaves the history stack and cursor unchanged. If the user reloads after going Back, the entries available through Forward remain in place.

The busted URL survives ordinary re-renders via `_activeReloadFrameSrc`, kept only while it still refers to the same logical document and cleared otherwise. `sameLogicalDocumentURL` compares origin+pathname+search after deleting `tv-reload` from both sides. It is also cleared on document change and in `forceCurrentFrameSrc`.

Reload triggers:

- **Theme change** — reloads local HTML, artifact-missing, and url-unsupported documents. A ready markdown view instead receives `styles-changed` and refreshes its canonical stylesheet link in place; a not-yet-ready markdown view queues nothing because its initial load already receives current CSS. A remote artifact stays loaded because the remote host owns its own theme.
- **Appearance change** — reloads no document and sends no `styles-changed` message; each document's resolver changes its root marker in place.
- **Content change** — the local `artifact-content-changed` event refreshes only its matching path artifact; `proxy-content-changed` reloads only a remote artifact.

## Local path-content updates

`ServerStore` owns filesystem observation for path artifacts. It selects one of two modes from the artifact's canonical stored path: a file path watches that file, while a folder path watches the complete directory tree rooted there. Folder watching is recursive, with no filename, extension, or depth filter; creating, editing, renaming, or deleting any descendant file is relevant whether or not the loaded document currently uses it. URL artifacts have no filesystem watcher. ^rn-local-content-change

`packages/server/src/file-watcher.ts` is the one server filesystem-watcher module used by path artifacts and the active installed-theme package. Its file mode watches a file through its parent directory and exact basename. Its folder mode uses one native recursive primary watch rooted at the selected folder, without enumerating descendants or allocating a watcher per directory. Both modes use the same ancestor observation, missing-root detection, polling re-arm, runtime-error delivery, and idempotent close mechanics. A missing root notifies its domain owner, polls only while absent, then reattaches and notifies the owner again when the same path returns. A runtime watcher error while the root remains present is delivered to the domain owner, which reports the error and closes the failed watcher. ^rn-shared-content-watcher

The shared watcher exposes content-change, watcher-dead, watcher-rearmed, error, and close handoffs without emitting a product-domain event itself. The artifact and theme owners apply their own debounce and stale-target guards: path artifacts emit `artifact-content-changed` with an artifact ID, while active themes emit `theme-changed` with the selected theme ID. Neither event substitutes for the other.

A relevant artifact filesystem change schedules this per-artifact debounced server event:

```ts
{
  type: "artifact-content-changed";
  artifactID: string;
}
```

The `/events` stream broadcasts that event to connected clients. A client reacts only when `artifactID` names its loaded path artifact: the document host refetches a markdown artifact, while an HTML file or folder artifact calls `reloadProxyFrame`. Other artifact IDs and URL artifacts are unaffected. Filesystem observation remains entirely on the server; clients add no filesystem watcher.

The reloaded document and its resources follow the artifact proxy's mandatory-revalidation policy ([proxy-caching.md](./proxy-caching.md)), so a changed nested asset is fetched rather than satisfied from stale browser storage.

## Content-change poll (consumed here)

The bridge owns the remote-content poll — its loop, cadence, test cadence hook, and the `proxy-content-changed` emission ([artifact-bridge.md](./artifact-bridge.md), "The remote-content poll"). This spec owns what the host does with the notification: `handleProxyContentChanged` reloads only a remote artifact; a local artifact ignores it, because the parallel local path handles local content changes.

The poll's scope is independent of readiness. A document can prove readiness without participating in the poll; Electron external URL webviews and the bundled views outside artifact routes do this through the consumer preload. (A local artifact-route webview participates in the poll like any artifact-route document; its notifications are simply ignored here.)

## Navigation events

When the main document inside the artifact frame navigates, the host learns of it — browser moves as `navigation-request` messages from the injected bridge, Electron moves as webview navigation events — and records it into artifact history through a pipeline that is code-governed below.

Four outcomes are authoritative:

- **Web-document navigation stays under the app's control.** The bridge may cancel an HTTP(S) move in the guest so the host commits it through its own path; where the platform allows cancellation, a cross-origin web destination is never followed as the frame's own uncontrolled navigation, except through a form that posts, which the browser bridge leaves to the browser ([artifact-bridge.md#^ab-fallback-recorder](./artifact-bridge.md#^ab-fallback-recorder)). A user-activated application-scheme handoff is not document navigation and remains native to the originating context or the Electron preload handoff owned by [artifact-bridge.md](./artifact-bridge.md); the browser bridge only cancels an application link's request for another context or a download before performing the same handoff.
- **Web modifier-clicks (meta, ctrl, shift, alt) are never intercepted** and follow browser defaults — the mechanism behind [artifact-navigation.md](../../product/artifact-navigation.md)'s open-outside promise. An application link's new-context or download disposition is the separate same-context handoff owned by [artifact-bridge.md](./artifact-bridge.md).
- **Host-driven navigation resets readiness before the frame is assigned its target URL** ([artifact-bridge.md#^ab-reset-before-assign](./artifact-bridge.md#^ab-reset-before-assign)).
- **Only main-frame moves are artifact navigation.** For Electron `did-navigate-in-page`, the host ignores an event with `isMainFrame === false`; `ArtifactNavigationState.currentURL` and history stay unchanged. ^rn-main-frame-navigation

Only values that resolve to HTTP(S), using the outer Television document as the explicit parsing base, may enter artifact history from a browser `navigation-request` or Electron `did-navigate` / `did-navigate-in-page` event. Classification happens before internal-origin conversion, so an opaque URL cannot first be reduced to an apparently web-relative value. Current producers report absolute URLs; the explicit base defines defensive relative-input behavior without changing producer semantics. Stored navigation is trusted after hydration and is not reclassified on render or Back/Forward. ^web-navigation-ingress

**Everything else about how a reported main-frame move becomes history is deliberately code-governed.** The routing between guest-committed and host-committed moves, commit timing and de-duplication, the fallback recorder's details beyond [its stated rules](./artifact-bridge.md#^ab-fallback-recorder), which main-frame webview events are recorded, and `forceCurrentFrameSrc` assignment mechanics are carried over from the shipping implementation unchanged, and the shipping suites hold them — the same boundary the frame core draws ([arch/artifact-frame/index.md#^frame-core-carve-out](./index.md#^frame-core-carve-out)). The remaining pre-existing hazards — recording a move that never commits, committing a target the user or page declined, and a startup report racing its own load — are tracked in [TV-542](https://linear.app/telepath-computer/issue/TV-542). The append-versus-replace history hazard remains open in [TV-765](https://linear.app/telepath-computer/issue/TV-765). ^nav-recording-carve-out

**Navigation state** is `ArtifactNavigationState`, one per artifact, rebuilt when the artifact id or canonical URL changes. `currentURL` is `null` when the user is on the artifact's canonical/home document (canonical is not stored as an entry). `routeForCurrentNavigation` maps `currentURL` to a render route.

**URL conversion** normalizes reported URLs before they enter history (verbatim contracts):

```ts
// artifact-navigation-state.ts — same-origin → root-relative; cross-origin → kept,
// re-serialized only if it carried tv-reload.
export function convertURL(url: string): string

// views/artifact-view.ts — same as convertURL but treats `internalURL`'s origin as internal;
// an opaque `"null"` origin never equals another opaque origin.
function convertURLForInternalOrigin(url: string, internalURL: string | null): string

// views/artifact-view.ts — picks the right converter for the artifact kind and uses
// the artifact's canonical URL, never the mutable frame `src`, as its internal origin.
private convertIframeNavigationURL(url: string): string
```

`convertURL` resolves a relative URL against the app's location. When it removes `tv-reload`, it preserves the path, every other query parameter, and the fragment.

## History (back/forward)

`ArtifactNavigationState` is a per-artifact history stack persisted to `localStorage` under `tv-nav:<artifactId>`. Its record contract:

```ts
interface ArtifactNavigationEntry { url: string }

interface ArtifactNavigationRecord {
  v: 1;
  entries: ArtifactNavigationEntry[];
  cursor: number;       // -1 = on canonical/home (no entry); else index into entries
  lastWritten: number;
}
```

Rules:

- `navigate(url)` — If `url` is canonical, set the cursor to `-1`. For any other URL, remove every entry after the cursor, append the URL, and move the cursor to the new entry. If the history grows beyond 100 entries, remove the oldest entry.
- `replace(url)` — At canonical/home, behave like `navigate(url)`. Otherwise, change only the current entry and preserve every entry after it. If the replacement URL is canonical, remove the current entry.
- `back()` — When `canGoBack` is true, decrement the cursor by one; moving back from entry zero returns to `-1`, which is home. At home, do nothing.
- `forward()` — When `canGoForward` is true, increment the cursor by one. At the tail, do nothing.
- `canGoBack` = cursor > −1; `canGoForward` = cursor < entries.length − 1.
- A mutation that changes state refreshes `lastWritten`, persists the record, and dispatches one `change` event. The event causes the host to render again. A no-op does none of these.
- Hydration restores a valid version-1 record. If the history exceeds the cap, hydration trims it and adjusts the cursor. Malformed JSON or any structurally invalid record produces empty in-memory state without throwing.
- `pruneStaleNavigationHistory` always deletes malformed `tv-nav:` records. It also deletes a valid record when its artifact is absent from the live set and its `lastWritten` is older than 30 days.

## Intersection with readiness tracking

Reload and navigation are where this spec meets [artifact-bridge.md](./artifact-bridge.md)'s readiness tracking. Readiness is lifecycle knowledge only — it never suspends interaction with the frame — but reload and navigation must keep it truthful:

- **Reload** commits a fresh `tv-reload` URL and resets readiness before the reload URL is rendered. The reloaded document proves readiness again with `bridge-ready` when it runs the bridge or preload.
- **Host-driven navigation** through `forceCurrentFrameSrc` resets readiness before the frame is assigned its target URL. This covers Back/forward and external-to-placeholder transitions.
- **Browser native full-document navigation** (`navigation-request` with `native: true`) lets the iframe navigate itself without a host `src` assignment. Trust is retired by the departing document's GUID-matched `leaving`, never by the request itself ([artifact-bridge.md](./artifact-bridge.md), "Retiring trust"). This covers shared artifacts and local folder pages that navigate to raw non-HTML resources, whose new documents never prove readiness. How and when the request is recorded into history is the navigation-recording carve-out's ([#^nav-recording-carve-out](#^nav-recording-carve-out)).
- **Same-document navigation** (hash/`pushState`) does not reset readiness.
- **Electron full-document navigation** resets readiness on `did-start-navigation` when `isMainFrame === true` and `isInPlace !== true`; `did-navigate-in-page` does not reset readiness. The [main-frame rule](#^rn-main-frame-navigation) and remaining [recording carve-out](#^nav-recording-carve-out) govern whether and how it reaches history.
- **Electron main-frame load failure** resets readiness on `did-fail-load`; a Chromium error document can prove readiness by sending preload `bridge-ready`.
- A move that reloads the frame resets readiness; a state-preserving move that keeps the same document loaded does not (owned by [artifact-bridge.md](./artifact-bridge.md)).
- A `navigation-request` never affects trust: readiness comes only from `bridge-ready` with its GUID, and retirement only from the departing document's GUID-matched `leaving` ([artifact-bridge.md](./artifact-bridge.md), "Retiring trust"). The browser bridge may post its initial `navigation-request` before `bridge-ready` lands.

The fields used for cache-busted reload URLs are separate from readiness. `_activeReloadFrameSrc` preserves a reload URL, and `sameLogicalDocumentURL` compares reload URLs. [artifact-bridge.md](./artifact-bridge.md) owns the trust state: `currentGuid` and `lifecycleWindow`. Readiness is derived from those fields. The artifact bridge also owns the reset rules.

## Testing

Shared content-watcher coverage must exercise both file and recursive-folder modes through the production watcher over real temporary trees. It must prove the common missing-root, re-arm, runtime-error delivery, and close contracts at the lowest honest boundary; consumer coverage then proves that path artifacts and active themes select that same module and translate its handoffs into their separate domain events.

Local folder-artifact coverage must show that changing a nested, non-index asset produces `artifact-content-changed` for the owning artifact. The [product artifact spec](../../product/artifacts.md#^af-folder-live-update) owns full-path acceptance through a running server, the real `/events` transport, and the real browser and Electron clients; this spec requires no duplicate end-to-end cases. [Theme architecture](../themes/index.md#^themes-active-package-watch) owns active-package consumption and `theme-changed` coverage.

# @telepath-computer/television-artifact

Artifact data model and host ↔ view `postMessage` protocol for Television.

The package has two subpath exports:

- **`.`** — cross-runtime. The artifact model (`Artifact`, `ArtifactKind`, `PathArtifact`, `ArtifactSchema`, `createArtifact`), its path predicates (`artifactBasename`, `isAllowedArtifactFilePath`, `isExternalArtifactURL`, `isHtmlPath`, `isMarkdownPath`, `isTvArtifact`, `hasTrailingSeparator`, `stripTrailingSeparators`), and the missing-artifact page. No DOM references; safe for Node consumers (server, CLI). The artifact-view protocol types and guards are internal to the package: the browser runtime classes below speak the protocol, and nothing outside imports its shapes.
- **`./browser`** — browser-only runtime. Host/view protocol classes plus the shared root appearance resolver used by Television-owned and proxied artifact documents.

## Runtime classes

Both live in `src/browser/artifact-view-client.ts` and are re-exported from `@telepath-computer/television-artifact/browser`.

- **`ArtifactView`** — the host's handle to a view. Constructed in the parent window, bound to one iframe. Emits `ReadyEvent` when the view posts `ready`. Exposes a latched `content: string | null` property — assigning a string stores it and posts `content-updated` to the view (or queues for the next `ready` if the view hasn't mounted yet). Every `ready` arrival redelivers the current latched value, so iframe reloads push content again automatically. Registers a single `handleUpdateContent(handler)` to respond to view-initiated content saves. `notifyStylesChanged()` sends a theme-only refresh after readiness and drops earlier calls.
- **`ArtifactContext`** — the view's handle to its host. Constructed inside the iframe. Posts `ready` synchronously on construction, emits `ContentUpdatedEvent` when the host pushes content, returns a promise from `updateContent(content)` that resolves when the host confirms the save, and exposes `onStylesChanged()` for theme-only stylesheet refreshes.
- **Appearance resolver** — `installAppearanceResolver(preference)` installs or updates an idempotent controller at `window.__televisionAppearanceResolver`; `appearanceResolverScriptSource(preference)` produces the synchronous classic script used before appearance-dependent styles. It writes only the root `data-theme` marker. Television's HTML proxy places that script after authored CSP metadata, so a policy that rejects it remains authoritative.

Both classes filter incoming `MessageEvent`s by `event.source` identity (iframe's `contentWindow` on the host, `window.parent` on the view) before any event dispatch or promise resolution. Unknown payloads are silently dropped. Electron's `WebviewArtifactViewRuntime` and `WebviewArtifactContext` carry the same content and `styles-changed` protocol over the webview IPC bridge.

Neither class takes an `origin` option; outbound messages use `"*"` as `targetOrigin`, and the `source` identity check is the load-bearing filter.

See [content messages](src/artifact-view-protocol.ts) and the [browser view client](src/browser/artifact-view-client.ts) for the implementation. The [artifact-bridge spec](../../specs/arch/artifact-frame/artifact-bridge.md) governs the bridge behavior it defines.

## Tests

- `packages/artifact/test/unit/` — vitest. Type guards and disposal / error-path behavior.
- `packages/artifact/test/e2e/` — Playwright. Two Vite harness apps on ports `5174` (host) and `5175` (view) prove the classes work across real origins.

Run through the root canonical runner:

```bash
npm run test:run -- run --provider local --package @telepath-computer/television-artifact
npm run test:run -- run --provider local --surface e2e:artifact
```

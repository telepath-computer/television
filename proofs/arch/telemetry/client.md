*How the promises in Telemetry client agent are proven.*

# Telemetry client agent — proof

Proves [specs/arch/telemetry/client.md](../../../specs/arch/telemetry/client.md).

## Coverage model

Coverage declarations are carried inside the migrated assertion blocks below.

The `desktopAppVersion` page parameter is shared with update behavior. Its unhooked real-Electron source is crossed by [the shell-version seam](../updates/desktop-upgrade-gate.md#^t-shell-version-param); hard-gate parsing, decision breadth, and real consumption are covered by [the parameter contract](../updates/desktop-upgrade-gate.md#^t-electron-detection), [gate-decision contract](../updates/desktop-upgrade-gate.md#^t-gate-decision), and [boot-barrier seam](../updates/desktop-upgrade-gate.md#^t-gate-boot-barrier). Recommendation eligibility and presentation are covered by [the recommendation decision](../updates/desktop-upgrade-recommendation.md#^desktop-rec-t-decision) and [presentation contract](../updates/desktop-upgrade-recommendation.md#^desktop-rec-t-presentation), with the production Electron outcome in [product acceptance](../../product/update-notifications.md#^ac-desktop-rec). The metadata seam below covers telemetry's use of the same value; this proof orders no duplicate update tests.

## Test hooks


`ClientIdFactory` is a test hook accepted by `getOrCreateTelemetryClientId` and `BuildClientTelemetryMetaOptions.idFactory`. A supplied factory controls only the value minted when storage lacks a client id; it does not replace storage access, reuse and remint decisions, metadata construction, or transport.

## Assertions

### Test assertions

The client contract harness runs the real metadata/id/activity module with in-memory storage, authored user-agent and app values, fake DOM event targets, and a fake clock. Storage and event targets are contract inputs; the clock replaces browser time only to exercise debounce breadth. This forfeits real `localStorage`, DOM delivery, websocket transport, and Electron persistence, crossed by the browser and Electron seams below. Those seams run the real app against a listening `Server` with temporary browser profiles, Electron user-data, storage, and web bundles. Their recording server sink mocks PostHog delivery, owned by [sink.md#^t-posthog-lands](./sink.md#^t-posthog-lands); it does not replace client metadata, activity detection, browser/Electron storage, HTTP, or websocket mechanisms.

- **Contract** (client-id helper): absent storage mints and persists a GUID, repeated reads reuse it, and clearing storage causes a fresh GUID — *(covered by inherited test: `packages/web/test/telemetry-client.test.ts` “mints, persists, reloads, and re-mints the client id when storage is absent”)*. ^t-clientid-stable
- **Seam** (real browser storage/profile → client-id helper): reload, a second tab, and closing and reopening the persistent browser profile retain the same id — *(covered by inherited tests: both cases in `packages/web/test/e2e/telemetry-session.test.ts`; the activity paths use the standing CSS-motion override because they claim no motion)*. ^tel-t-clientid-browser
- **Contract** (metadata builder and shared HTTP client): one helper builds client id, user agent, app, and optional desktop version; its websocket parameters carry the same fields; and a configured shared client attaches the identical metadata header to every HTTP verb while a CLI-style client omits it — *(covered by inherited tests: `packages/web/test/telemetry-client.test.ts` “builds the standard metadata and websocket query params from one helper” and the first two cases in `test/repo/shared-client-telemetry.test.ts`)*. ^t-meta-transport
- **Seam** (real browser/Electron client → listening server): the browser's metadata reaches the websocket and API paths under one id, the real Electron client reports its app and real package version, Electron retains its id across app restart, and browser and Electron ids differ — *(covered by inherited tests: `packages/web/test/e2e/telemetry-session.test.ts` “persists client id across reload, sends session activity, and stamps API actions with the same session” and `packages/desktop/test/e2e/telemetry-client.test.ts` “desktop telemetry uses a persistent desktop client id with app version and differs from browser”; both use the standing CSS-motion override because they claim no motion)*. ^t-clientid-scope
- **Contract** (activity agent): visibility, focus, pointer, scroll, and key engagement each produce the fixed activity signal while visible; sends are limited to one per five minutes; stopping the agent removes the listeners; and a backgrounded document stays silent — *(covered by inherited tests: the two activity cases in `packages/web/test/telemetry-client.test.ts`, with the engagement case minimally table-driven so each trigger independently proves a send)*. ^t-activity-fires
- **Contract** (activity-agent output): every emitted activity object has exactly the fixed message type and client id, with no URL, channel, artifact, or input field — *(covered by inherited tests: `packages/web/test/telemetry-client.test.ts` “sends content-free activity on visibility engagement”, “sends content-free activity on focus engagement”, “sends content-free activity on pointer engagement”, “sends content-free activity on scroll engagement”, “sends content-free activity on key engagement”, and “debounces activity to five minutes and removes listeners when stopped”)*. ^t-activity-content-free
- **Contract** (client module boundary): metadata and activity construction accept no telemetry-setting input and read no server telemetry state, so server enable/disable cannot alter what the client sends — *(covered by inherited test: `packages/web/test/telemetry-client.test.ts` “stays silent while backgrounded and does not read any server telemetry setting”)*. ^t-client-unaware

Product outcomes are [product/telemetry.md#^ac-session-client](../../product/telemetry.md#^ac-session-client) and [product/telemetry.md#^ac-session-no-content](../../product/telemetry.md#^ac-session-no-content).


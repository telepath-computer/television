*The telemetry sink: the PostHog transport, its bounded in-memory buffer, fire-and-forget delivery that never blocks or crashes the server, and the platform operations (region, key, agent access).*

# Telemetry sink

## What this owns

This module — the *telemetry sink* — owns delivery: how a constructed telemetry event reaches PostHog, the buffering posture, and the platform operations. What events exist and how they are built is owned by [arch/telemetry/index.md](./index.md) (chokepoint) and [emitters.md](./emitters.md); this module is purely the outbound boundary.

## Contract

```ts
interface TelemetryTransport {
  send(event: BuiltTelemetryEvent): Promise<void>
  shutdown?(): Promise<void>
}

interface TelemetrySink {
  enqueue(event: BuiltTelemetryEvent): void
  flush(): Promise<void>
  shutdown(): Promise<void>
  pendingCount(): number
}

interface PostHogProjectConfig {
  projectId: number
  projectToken: string
  ingestionHost: string
  apiHost: string
}

const POSTHOG_PRODUCTION_PROJECT_ID = 482022
const POSTHOG_TEST_PROJECT_ID = 484904

```

`enqueue` is fire-and-forget and never throws to the caller. A `BuiltTelemetryEvent` is a fully-formed event+properties produced by the chokepoint (name, `distinct_id` = telemetry user GUID, optional `$session_id`, classified properties). The sink adds only the fixed privacy controls described below and reads no user content — it is a transport, so it has no path by which UGC could enter.

## Behavior and operations

- **Television-owned buffer.** Events are held in Television's own `BufferedTelemetrySink`, not in a PostHog SDK queue. The buffer is bounded (default 1,000 events); on overflow it **drops** oldest events rather than growing without limit or blocking. Its purpose is the laptop case: a Television server on a laptop that goes offline holds events in memory and flushes on reconnect.
- **Direct PostHog HTTP transport.** Television sends events with `fetch` to PostHog's `/capture/` endpoint. The transport uses `AbortController` to bound a send attempt (default timeout 10s). No PostHog SDK is linked into the server or CLI. The runtime supplies the project selected by the [product rules](../../product/telemetry.md#^telemetry-rules); delivery-path construction uses the environment, build and marker at startup, independently of stored opt-out. Stored opt-out gates capture, so enabling telemetry after an opted-out boot requires no restart. Low-level transport contract tests intercept requests.
- **Never crashes the server.** Network errors, PostHog outages, and timeouts do not escape `enqueue` or `flush`, and transport shutdown failures do not escape `TelemetrySink.shutdown()`. Telemetry runtime shutdown also absorbs a sink shutdown failure. Lost events are an accepted cost; durable/disk queuing is out of scope for v1 (platform outages are rare).
- **CLI skill-install delivery is additionally bounded.** The skill-install emitter uses the same sink contract but a short 500ms PostHog transport timeout and a 500ms best-effort shutdown/flush bound inside the server telemetry runtime; the CLI also bounds its call to the emitter at 1s. A telemetry failure or slow delivery cannot fail or hang a successful `tv skills install`.
- **Platform:** PostHog Cloud, **US** region. Public write tokens (designed to be publishable, `phc_`) ship with the server/CLI; they can collect events but cannot read analytics data. Secret read keys (`phx_`) grant analytics access and must never ship in the published bundle. Enablement and project selection follow only the [product cascade](../../product/telemetry.md#^telemetry-rules). Marker lookup uses the resolved developer home described there. The chokepoint applies the decision before enqueue; the sink delivers already-captured events using its normal buffering and retry behavior, including across opt-out.
- **Release build configuration.** `packages/cli/build.mjs` bakes `__TV_TELEMETRY_BUILD__="production"` only when its build-time environment has `TV_NPM_RELEASE=1`; otherwise it bakes `"development"`, including in `--outfile` mode. The npm publish workflow sets this flag on its build command after version finalization. Other builds, including CI validation builds, do not set it, except that tests may explicitly build a release-configured bundle only at an isolated `--outfile` path, never in the shared `packages/cli/dist` output. This is an explicit release-pipeline choice, not an authenticity or anti-tampering check. The bake supplies the production-build input to the [product cascade](../../product/telemetry.md#^telemetry-rules). Tests exercise both compiled outputs with an intercepted transport that cannot reach either collector, and check that neither contains `phx_` read secrets. The publish workflow checks that the final publishable bundle carries the production marker before `npm publish`, so an ordinary or subsequently rebuilt bundle cannot silently ship with telemetry suppressed.
- **IP and location privacy.** Every `/capture/` request sets event properties `$ip: "0.0.0.0"` and `$geoip_disable: true`, after the built event properties, for both projects. Television sends no client IP or forwarding headers. The fixed non-user IP placeholder prevents PostHog from falling back to the connection IP when the property is empty, and the GeoIP flag disables enrichment; the receiving service still sees the network peer at the transport layer. PostHog project configuration also disables IP collection and IP geolocation transformation. Both projects have these settings disabled and must keep them disabled. These settings complement the request-level protections. Deletion or scrubbing of historical IP and geographic properties remains a separate operator action. ^telemetry-transport-privacy
- **Agent access (operational, not implementation).** Company agents query metrics via PostHog's MCP server with a read key. Provisioning is rollout, not server code.

## Real PostHog integration test surface

`telemetry-posthog-roundtrip:integration` is the central-runner surface for live PostHog validation. It belongs to the `telemetry-posthog-roundtrip` suite, is excluded from `all`, and is run with:

```bash
npm test -- local --suite telemetry-posthog-roundtrip
```

The surface declares the `posthog-test-key` preflight ([../test-runner/preflight.md](../test-runner/preflight.md)), which requires the PostHog test project read key before Vitest starts. The key is the secret `phx_` value and must be supplied as `TV_POSTHOG_TEST_READ_KEY` in the environment or in the repository-root `.env` file. `.env` is gitignored, auto-loaded by the test, and must never be committed. There is no in-test silent skip for this surface: selecting the suite without the read key is a preflight failure.

The suite enables delivery through `TV_TELEMETRY_TEST` and refuses to run under enabled `CI` or `DO_NOT_TRACK`. This suite is excluded from CI and ordinary developer `verify` runs, and Blaxel workers do not receive the read key. It is run manually by an operator who knows that its persisted-daemon cases register and remove real, uniquely named user services through the host service manager. After each persisted telemetry assertion, the fixture invokes `tv stop` against that test-named service; this is suite hygiene, not CLI acceptance coverage. Direct `Daemon.uninstall()` remains failure cleanup if the normal stop path does not complete.

The surface uses no sink or transport mock. Events cross the real HTTP transport into the PostHog test project and are read back through the PostHog read API. One case drives production CLI actions and real HTTP and websocket clients against a listening `Server`.

The public write project token and project ids are committed in `packages/server/src/telemetry/posthog-config.ts` because they are write-only collectors. The live tests use the PostHog **test** project (`POSTHOG_TEST_PROJECT_ID = 484904`), and `assertPostHogIntegrationProjectIsSafe` refuses the production project. This surface validates that stored events have `$ip` absent, empty, or `"0.0.0.0"` and no GeoIP enrichment properties (`$geoip_*` other than `$geoip_disable`, plus `$initial_geoip_*` when person properties are read) and land with enumerated properties intact, `$set` person properties round-trip, `$session_id` events form native PostHog sessions, and the focused real-server saga covers install/start, opt-out suppression, opt-back-in, CLI mutations, same-GUID restart, browser activity, and a browser-attributed page reorder.

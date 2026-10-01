*How the promises in Telemetry sessions are proven.*

# Telemetry sessions — proof

Proves [specs/arch/telemetry/sessions.md](../../../specs/arch/telemetry/sessions.md).

## Coverage model

Coverage declarations are carried inside the migrated assertion blocks below.

## Test hooks


Tests may use the exported `SESSION_IDLE_TIMEOUT_MS` and `MAX_SESSION_DURATION_MS` constants, the `createUUIDv7`, `isUUIDv7`, and `getUUIDv7TimestampMs` helpers, and `TelemetrySessionManager.get`. These hooks expose the production thresholds, create or inspect compliant session ids, and read current in-memory session state. They do not replace session rotation or event attribution.

## Assertions

### Test assertions

The session contract harness calls the real in-memory session manager with authored client ids and timestamps; it has no mocks or external fixtures. These breadth cases compose with [emitters.md#^t-session-stamp](./emitters.md#^t-session-stamp), which proves the returned id reaches built events. The PostHog seam harness uses the real HTTP transport and sandbox project with unique GUID and UUIDv7 fixtures; it has no transport mock and is excluded from ordinary verification as described in [sink.md#Real PostHog integration test surface](../../../specs/arch/telemetry/sink.md#Real PostHog integration test surface).

- **Contract** (session manager): a first client activity mints a valid UUIDv7 whose embedded timestamp equals `sessionStartMs` — *(covered by inherited test: `packages/server/src/telemetry/sessions.test.ts` “mints a UUIDv7 session id whose embedded timestamp equals the first activity”)*. ^t-mint-uuidv7
- **Contract** (session manager): activity at or inside the idle threshold returns the same id — *(covered by inherited test: `packages/server/src/telemetry/sessions.test.ts` “reuses a client's session inside the idle threshold”)*. ^t-reuse
- **Contract** (session manager): activity after a gap greater than 30 minutes returns a new id — *(covered by inherited test: `packages/server/src/telemetry/sessions.test.ts` “rotates after the idle threshold is exceeded”)*. ^t-rotate-idle
- **Contract** (session manager): continuous activity reaching the 24-hour cap rotates before the span can exceed PostHog's limit — *(covered by inherited test: `packages/server/src/telemetry/sessions.test.ts` “rotates before a session span reaches PostHog's 24h cap”)*. ^t-rotate-24h
- **Contract** (session manager): activity from one client before and after a simulated sub-threshold disconnect and reconnect returns the same session id — *(covered by inherited test: `packages/server/src/telemetry/sessions.test.ts` “keeps the same client session across reconnect-shaped activity”)*. ^t-reconnect
- **Contract** (session manager): `sessionIdFor(null, …)` and an empty client id return `null` — *(covered by inherited test: `packages/server/src/telemetry/sessions.test.ts` “returns null for session-less requests without a client id”)*. ^t-gating
- **Seam** (built event → PostHog native session report over real HTTPS): events carrying a minted `$session_id` appear grouped as one session with positive duration — *(covered by inherited test: `packages/server/test/telemetry-posthog.integration.test.ts` “groups $session_id-stamped events in a PostHog native session”)*. ^t-posthog-session

Real client engagement and client-id scope are owned by [product/telemetry.md#^ac-session](../../product/telemetry.md#^ac-session), [product/telemetry.md#^ac-session-client](../../product/telemetry.md#^ac-session-client), and [product/telemetry.md#^ac-session-engagement](../../product/telemetry.md#^ac-session-engagement).


*The telemetry session module: server-side per-client session state, the content-free client activity signal, server-managed UUIDv7 `$session_id` minting and lazy rotation, and how every event is attributed to a session so PostHog derives sessions natively.*

# Telemetry sessions

## What this owns

This module owns how Television produces *sessions* for telemetry: the server-side session state keyed per *client*, the `$session_id` it mints and rotates, and the attribution of events to a session. The user-facing meaning of a *session*, *client*, *client id*, and *activity signal* is owned by [product/telemetry.md](../../product/telemetry.md) and not restated. The client-side detection and persistence (engagement events, `localStorage` client id, transport attachment) are owned by [client.md](./client.md). The chokepoint and the `session_activity` event are defined in [arch/telemetry/index.md](./index.md).

Sessions use **PostHog's native session tracking**, fed by a server-managed `$session_id`. Television does not embed posthog-js; the server attaches a compliant `$session_id` to events the way PostHog expects, and PostHog derives session count and `$session_duration` itself. The server's job is only to mint and rotate the id; PostHog does the session math.

## Contract

```ts
// Client → server over the existing websocket. Content-free (see client.md).
interface TelemetryActivitySignal {
  type: "telemetry-activity"
  clientId: string
}

// Server-side session state, one entry per client id.
interface ClientSession {
  clientId: string
  sessionId: string      // UUIDv7; its embedded timestamp == sessionStartMs
  sessionStartMs: number // epoch ms of the first activity in this session
  lastActivityMs: number // epoch ms of the most recent activity
}

// The single seam other modules use. Returns the $session_id to stamp on events
// emitted for this client right now (minting or rotating as the rules require),
// or null when the request carries no client id (session-less; see gating).
function sessionIdFor(clientId: string | null, nowMs: number): string | null
```

`sessionIdFor` is the one handoff the rest of the system depends on: [emitters.md](./emitters.md) calls it to stamp the current `$session_id` on every event it emits for a client. Keeping it a single function is what makes the "every event carries the right session id" property provable by composition rather than per-event ([testing-policy.md#Compositional coverage across clean seams](../testing-policy.md#Compositional coverage across clean seams)).

## Behavior

- **Boundary detection needs a client signal.** An open websocket or ongoing API traffic does not mean a human is present (a backgrounded tab keeps its socket open; API calls can be agent-driven). Genuine engagement is only observable at the client, so the client emits a content-free activity signal; the server derives sessions from it plus other client-attributed API requests.
- **Any client-attributed request bumps `lastActivityMs`** — a websocket `TelemetryActivitySignal` or any API call carrying the client id.
- **Lazy rotation.** On a client-attributed request: if there is no current session, or the gap since `lastActivityMs` exceeds the **30-minute** idle threshold, or the current session has reached **24h**, mint a fresh `$session_id` (a new `ClientSession`); otherwise reuse the current one. Rotation is decided only on the next request — no timer or sweep, and a vanished client needs no cleanup (its last emitted event already stands as the session end). The 24h cap exists because a UUIDv7 `$session_id` whose span exceeds 24h is dropped by PostHog (see compliance).
- **Attribution.** The server stamps the current `$session_id` on **every** telemetry event it emits for that client — action events (artifact/channel/layout/theme) and `session_activity` alike — all keyed to the telemetry user GUID as `distinct_id`. PostHog groups by `$session_id`: session start = first event, end = last event, duration = the span. There is **no** session-end event; PostHog reads the end off the last event, and does **not** auto-split an id on inactivity (that is a posthog-js behavior), so rotation is the server's only lever.
- **`session_activity` covers passive engagement.** Action events already carry the id, so an active user *doing* things keeps the session bounded for free. `session_activity` exists for engagement that emits no other event — reading, scrolling, regaining focus — so a 25-minute read is one continuous session. A bare read (a GET emitting no telemetry event) bumps `lastActivityMs` for rotation but is not itself visible to PostHog.
- **Client-id gating separates humans from agents.** `sessionIdFor(null, …)` returns `null`: requests with no client id (agent/CLI/HTTP, including `skill_installed`) are **session-less** — still counted for DAU/MAU and retention via the server GUID, never folded into a human session.
- **`$session_id` compliance (load-bearing).** The id must be a valid **UUIDv7** whose embedded timestamp is at or before the session's first event and within 24h of its last, never reused — else PostHog **silently drops** those events from session aggregations. The server generates the UUIDv7 at mint time (timestamp = `sessionStartMs`) and rotates before 24h.

Resolved tunables: activity cadence **5 min**; idle threshold **30 min**; **24h** hard cap. Client-side detection/persistence is [client.md](./client.md).

## Testing

`$session_id` compliance and PostHog's native session grouping are proven against the PostHog test project through the real HTTP transport. This proof is governed by the sink's [real PostHog integration test surface](./sink.md#Real PostHog integration test surface).


*The client telemetry signal: the generic, content-free client→server envelope over the `/events` websocket by which a client reports a telemetry-worthy moment it alone can observe, the light per-event validation that backstops the no-UGC call-site policy, and the forwarding rule into the chokepoint.*

**Plain english:** this governs the one sanctioned way the app in your browser (or the desktop app) reports a usage event back to its own Television server for anonymous statistics — for example "the update notice was shown." What keeps user content out of these reports is that the reporting call sites are designed to carry none in the first place; the server additionally checks each report against a fixed allow-list of events and value patterns as a light backstop.

# Telemetry client signals

## What this owns

This module owns the **client→server telemetry signal mechanic**: the generic signal envelope, the registry of client-signalable events with their per-property validation patterns, the server-side validation rules, and the forwarding of accepted signals into the telemetry chokepoint. Which events exist at all is owned by the closed vocabulary in [arch/telemetry/index.md](./index.md); **when and why** a given signal fires (its cardinality and triggering moment) is owned by the feature spec that defines the event — the updates domain ([arch/updates/index.md](../updates/index.md)) or the artifact-skill selector ([ui/app/skill-selector/index.md](../../ui/app/skill-selector/index.md)). The client id and metadata the signal rides on are owned by [client.md](./client.md).

Some telemetry-worthy moments are observable only in the client — a page that just auto-reloaded itself, a toast that became visible, or a fixed artifact-skill prompt button that was clicked. The server cannot infer them, so the client must report them; this module is the single sanctioned way it does. Every signal is *content-free* in the sense the telemetry guarantees define ([product/telemetry.md#^no-ugc](../../product/telemetry.md#^no-ugc)): free of **user** content — nothing typed or authored, no titles, paths, URLs, or prompt text. A signal does carry data, but only enumerated event names and pattern-constrained values.

**Boundary with the activity signal.** A client signal **is** an actual discrete telemetry event, reported by the client for recording. The activity signal (`TelemetryActivitySignal`) is **not** a client signal: it is merely an *input* that helps the server decide when to fire certain telemetry events from the backend (the session lifecycle) — it names no event and records nothing by itself. Its authority stays where it is (emission in [client.md](./client.md), consumption in [sessions.md](./sessions.md)); this mechanic generalizes only its transport pattern — content-free messages on the established `/events` connection, with the server alone deciding what reaches the analytics platform. ^activity-boundary

## Contract

```ts
// Client → server over the /events websocket, alongside the activity signal.
// Internal contract shipping in lockstep with the web bundle — no compat
// discipline; unknown or malformed messages are dropped, never answered
// (see arch/updates/index.md ^updates-lockstep-contracts for the lockstep rule).
interface TelemetryClientSignal {
  type: "telemetry-signal";
  clientId: string;                    // must equal the connection's client id (as the activity signal does)
  event: ClientSignalEventName;
  properties: Record<string, string>;  // declared keys and value patterns per the registry below; omission allowed
}

// The subset of the closed vocabulary (arch/telemetry/index.md) that clients may signal.
type ClientSignalEventName =
  | "client_autoreloaded"
  | "update_toast_shown"
  | "update_prompt_copy_clicked"
  | "desktop_upgrade_gate_shown"
  | "artifact_skill_prompt_copy_clicked"

// Per-event validation registry: the ALLOWED property keys (each optional to
// the validator), each present value validated by pattern. Growing the
// registry is a vocabulary change, reviewed as such (arch/telemetry/index.md).
const RELEASE_VERSION = /^\d+\.\d+\.\d+$/
const ARTIFACT_SKILL = /^(calendar|table|tasks|markdown)$/

const CLIENT_SIGNAL_REGISTRY: Record<ClientSignalEventName, Record<string, RegExp>> = {
  client_autoreloaded:                 { from_version: RELEASE_VERSION, to_version: RELEASE_VERSION },
  update_toast_shown:                  { server_version: RELEASE_VERSION, channel_version: RELEASE_VERSION },
  update_prompt_copy_clicked:          { server_version: RELEASE_VERSION, channel_version: RELEASE_VERSION },
  desktop_upgrade_gate_shown:          { desktop_app_version: RELEASE_VERSION, required_desktop_version: RELEASE_VERSION },
  artifact_skill_prompt_copy_clicked:  { artifact_skill: ARTIFACT_SKILL },
}
```

One generic envelope with a per-event registry, rather than a bespoke message type per event: the acceptance logic (identity check, registry lookup, key-set and pattern validation, forwarding) is identical for every event, so the registry is the only thing a new client-signaled event adds — one reviewable row instead of a new wire type and handler. ^one-envelope

**Emission timing.** A signal's *logical* moment is the one its owning feature spec describes (the toast became visible, the page finished auto-reloading); its *physical* send is deferred until the `/events` connection can carry it — several of these moments are triggered by the `server-status` message, which arrives before the client considers the connection fully established. The mechanism is an in-memory queue at the emitter: signals emitted before the connection can carry them are queued and flushed once it can — normally when it reports connected, with one deliberate exception: a boot halted at the desktop upgrade gate never reaches connected, and its gate signal sends from the halted state over the open socket ([arch/updates/desktop-upgrade-gate.md#^gate-telemetry](../updates/desktop-upgrade-gate.md#^gate-telemetry)). Nothing is persisted — a queued signal is simply lost if the page dies first, which is accepted. Deduplication rules ("once per page load" etc.) are evaluated at the logical moment, not at send time. ^signal-deferral

## Validation

A signal is accepted iff **all** of: the `type` is the fixed signal type; `clientId` equals the client id of the websocket connection's telemetry metadata; `event` is in the registry; every key in `properties` is declared in the registry for that event; and every present value matches its key's pattern. A declared key may be **absent** — omission never carries content, so the no-UGC guarantee is unaffected, and it lets an event have optional properties without registry ceremony (all keys are optional to the validator; what an event actually carries is stated by its firing semantics in the owning feature spec). There is deliberately no required-key marking: rejecting an event for an omitted property is also data loss, just a different failure shape — a buggy client corrupts analytics either way — and the validator exists solely as belt-and-suspenders against unexpected UGC, not as an analytics-quality gate. Anything else — unknown event, undeclared key, non-matching value, mismatched client id — is dropped silently, without response or logging noise. ^signal-validation

The load-bearing no-UGC protection is not this validator — it is **call-site design**: the tracking call sites are designed to carry no user content in the first place ([product/telemetry.md#^no-ugc](../../product/telemetry.md#^no-ugc)), and that is a policy, upheld by review of each call site and each registry row, not by enforcement code. The pattern validation here is lightweight belt-and-suspenders on top of that policy: every value must match a closed pattern (release-version triples or the fixed artifact-skill enumeration), which leaves free text no channel — but it is not a security layer and does not exist to defend against hostile clients, so no adversarial-input coverage is warranted beyond proving the mechanism works. A registry entry whose pattern would admit free text is still a vocabulary-guarantee change, not a routine addition. ^signal-no-ugc

## Forwarding

An accepted signal is forwarded to the ordinary chokepoint — `capture()` with the event name and validated properties — with completely normal handling: `$session_id` attribution via `sessionIdFor` ([sessions.md](./sessions.md); a signal is a client-attributed request and bumps activity like any other), the telemetry user GUID as `distinct_id` ([identity.md](./identity.md)), and the suppression gate deciding whether anything is emitted at all. The client remains unaware of the telemetry setting ([client.md](./client.md)) — it always sends signals; the server alone gates. No code path forwards a signal around the chokepoint. ^signal-forwarding

## Why the split lives this way

The closed vocabulary is a privacy guarantee, and its value is being **one complete reviewable list** — so event names, properties, and their types live in [arch/telemetry/index.md](./index.md), never scattered per-feature. What a feature owns is *meaning*: when its event fires and how often. What this module owns is *transport*: shared plumbing any feature's client-observed events ride. Adding a client-signaled event therefore touches exactly three places, each owning its slice: the vocabulary (index), the registry row (here), and the firing semantics (the feature spec). ^authority-split

## Testing

Server forwarding is proven by sending a signal over a real `/events` websocket to a listening `Server` and observing the resulting `capture()` call. Delivery from `capture()` to PostHog is proven by the sink's [real PostHog integration](./sink.md#Real PostHog integration test surface).


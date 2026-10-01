*How the promises in Telemetry client signals are proven.*

# Telemetry client signals — proof

Proves [specs/arch/telemetry/client-signals.md](../../../specs/arch/telemetry/client-signals.md).

## Coverage model

Coverage declarations are carried inside the migrated assertion blocks below.

## Test hooks


Tests may inject the production in-memory [session manager](../../../specs/arch/telemetry/sessions.md) through `ServerTelemetryOptions.sessions` and a controlled clock through `ServerTelemetryOptions.nowMs` to observe `lastActivityMs` during a real crossing of the `/events` websocket. These hooks do not replace signal validation, websocket routing, session mutation, `capture()`, or event construction.

## Assertions

### Test assertions

The validator contract uses authored message objects and the real registry with no mocks. The sender contract runs the real `ServerConnection` against a fake websocket and fake client; those peers replace browser websocket delivery and server receipt, which the forwarding seam crosses. The forwarding seam uses a real websocket client against a listening `Server`; a recording sink replaces PostHog delivery, covered by [sink.md#^t-posthog-lands](./sink.md#^t-posthog-lands). Its injected session manager and clock are sanctioned observation/control hooks for `lastActivityMs`; they do not replace signal validation, websocket routing, session mutation, capture, or event construction.

- **Contract** (pure signal validator): every registry event with matching declared properties is accepted, including omission of any declared key; unknown or prototype-chain event names, undeclared or prototype-chain property keys, nonmatching or non-string values, malformed envelopes, and a mismatched client id are dropped without side effects. Representative junk values suffice because this is the belt-and-suspenders mechanism described at [#^signal-no-ugc](../../../specs/arch/telemetry/client-signals.md#^signal-no-ugc), not an adversarial-input boundary — *covered by `packages/server/src/telemetry/client-signals.test.ts`, all twelve cases*. ^t-signal-validation
- **Contract** (client sender side of the websocket seam): with telemetry metadata, a connected or upgrade-gate-halted connection sends the fixed envelope carrying its own client id, event, and properties; without metadata or a send-capable socket state it sends nothing — *covered by `packages/web/test/server-connection.test.ts` “ServerConnection telemetry signal sender”, all three cases, and `packages/web/test/desktop-gate-runtime.test.ts` “sendTelemetrySignal works from the halted state over the open socket” (the halted-state case is owned by [arch/updates/desktop-upgrade-gate.md](../../../specs/arch/updates/desktop-upgrade-gate.md))*. ^tel-t-signal-sender
- **Seam** (accepted signal → `capture()`, crossed over the real `/events` websocket): one accepted signal reaches the chokepoint exactly once with its validated name and properties and the current `$session_id`; a rejected signal and a socket without metadata produce no crossing. Suppression composes from [arch/telemetry/index.md#^t-capture-gate](./index.md#^t-capture-gate) — *covered by `packages/server/test/telemetry-event-stream.test.ts` “forwards an accepted signal through capture() exactly once, session-stamped”, “drops a rejected signal silently — no capture, no session, no response”, and “ignores signals from sockets without client telemetry metadata”*. ^t-signal-forwarding
- **Seam** (accepted websocket signal → session manager): the same accepted crossing updates the client's `lastActivityMs` like any client-attributed request — *covered by `packages/server/test/telemetry-event-stream.test.ts` “bumps the client's session activity on the same crossing”*. ^t-signal-activity

Feature emitters own their firing semantics and any deferral until the socket can carry a signal: auto-reload is [version-advertisement.md#^t-autoreload-signal](../updates/version-advertisement.md#^t-autoreload-signal), update toast and copy events are [update-channel.md#^t-toast-telemetry](../updates/update-channel.md#^t-toast-telemetry), the halted gate exception is [desktop-upgrade-gate.md#^t-gate-telemetry](../updates/desktop-upgrade-gate.md#^t-gate-telemetry), and artifact-skill prompt copy is [ui/app/skill-selector/index.md#^ss-ac-telemetry](../../ui/app/skill-selector/index.md#^ss-ac-telemetry). Those assertions own their producer-case dispositions; this spec owns the generic sender, validator, and server forwarding cases. Product outcomes are [product/update-notifications.md#^ac-telemetry](../../product/update-notifications.md#^ac-telemetry) and [product/telemetry.md#^ac-artifact-skill](../../product/telemetry.md#^ac-artifact-skill).


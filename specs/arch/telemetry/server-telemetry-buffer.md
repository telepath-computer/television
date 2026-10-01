*Buffer for the contracts telemetry imposes on existing, un-specced server modules — event-stream, server-store, bootstrap, and the data directory — held here until a server architecture spec exists to absorb them.*

**Status:** temporary authoritative buffer for telemetry's impositions on unmigrated server modules. Its implemented decisions remain binding until server architecture absorbs them.

This remains a temporary buffer because the destination server architecture spec does not exist yet. Its telemetry decisions are implemented and reviewed; remaining migration work is to move these server-integration contracts into the server specs when they are migrated.

# Server telemetry integration (buffer)

## Why this is a buffer

The telemetry modules ([arch/telemetry/index.md](./index.md), [sessions.md](./sessions.md), [identity.md](./identity.md), [emitters.md](./emitters.md), [sink.md](./sink.md), [derivation.md](./derivation.md)) are real spec authority for telemetry code. But telemetry also requires **changes to existing server modules that have no spec yet** — `event-stream`, `server-store`, the server bootstrap, and the data directory. Those changes belong to the future server architecture spec; per [spec-policy.md](../../spec-policy.md), authority is exclusive, so they are not owned by the telemetry specs. They are collected here as explicit buffer authority until a server spec absorbs them. This buffer holds **only** the impositions on existing modules — not the telemetry logic itself.

## event-stream (`packages/server/src/event-stream.ts`)

- The websocket connection must carry the standard client telemetry metadata as query parameters, so the server can validate the client id and metadata for later activity messages.
- `TelemetryActivitySignal` ([client.md](./client.md)) is the activity message sent from a client to the server. It is accepted only when it contains exactly two fields: `type`, set to the fixed activity message type, and `clientId`, set to the id carried by the websocket metadata. An accepted message is routed to the session module ([sessions.md](./sessions.md)).
- The **generic telemetry client signal** (`TelemetryClientSignal`, [client-signals.md](./client-signals.md)) is accepted only when it passes that module's validation (matching client id, registry event, declared keys only — omission allowed — and pattern-matching values); accepted signals are forwarded to the telemetry runtime for chokepoint emission, and everything else is dropped.
- Websocket open/close alone does not create or end a session. No session-end emission is required; sessions are derived from stamped events in PostHog ([sessions.md](./sessions.md)).

## server-store (`packages/server/src/server-store.ts`)

- The CRUD, layout, pin-list, page-presentation, theme, and appearance operations (`createArtifact`/`updateArtifact`/`deleteArtifact`, `createChannel`/`updateChannel`/`removeChannel`, `patchDisplay`) must invoke the telemetry **emit hooks** ([emitters.md](./emitters.md)) at their commit points. Hooks receive the state needed for pure classification — including prior/committed layouts or pin lists, artifact deletion cause, and internal selection/fallback origin — plus the originating request's client metadata. Same-value metadata/display patches and automatic pin pruning during channel deletion do not invoke action telemetry hooks.
- Committed selection, registry, consent, and appearance are readable together for the telemetry runtime's current-settings snapshot. A combined display patch commits all fields before emitting either action. Registry-refresh fallback supplies `fallback`; explicit selection supplies `selection`. Same-selection consent, registry, and package-content changes produce no telemetry switch; the next emitted event reads the current settings. These hooks do not subscribe to rendering's `theme-changed` domain event. ^store-theme-telemetry

## routes (`packages/server/src/routes.ts`)

- `GET /telemetry` follows the server's standard route auth policy and returns the shared `TelemetryStatus` shape: `{ state, reason, guidPresent, region: "us" }`.
- `POST /telemetry/disable` follows the server's standard route auth policy, asks the telemetry runtime to record exactly one *telemetry opted out* event when needed, persist `optedOut: true`, and return the resulting `TelemetryStatus`.
- `POST /telemetry/enable` follows the server's standard route auth policy, clears the stored opt-out flag, emits no standalone re-enable event, and returns the resulting `TelemetryStatus`.
- If telemetry is unavailable because runtime initialization failed, the routes return `{ state: "unavailable", reason: null, guidPresent: false, region: "us" }` rather than failing the product path.

## server bootstrap (`packages/server/src/server.ts`)

- Before serving bootstrap writes state, the server captures whether the Television data directory lacks prior serving evidence: display or onboarding state, populated channel or artifact metadata, theme content, or agent-authored artifact content. It passes that `dataDirCreated` boolean into telemetry boot derivation. The signal is about serving evidence in the server data directory, not the telemetry state file, so creating `state/telemetry.json` cannot by itself prevent *server installed*.
- On startup the server initializes telemetry: load-or-mint identity and read the suppression/opt-out state ([identity.md](./identity.md)), construct the sink ([sink.md](./sink.md)), and emit *server installed* / *server started* / *server upgraded* per the derivation.
- The server start options and resolved bind addresses are the source for the config/version properties ([derivation.md](./derivation.md)): version, auth mode, bind classifications, port default/custom, home default/custom, launch mode, and optional installed-by agent.
- Startup telemetry lifecycle derivation is emission-only: *server installed*, *server started*, and *server upgraded* are analytics events, not user-facing disclosure notices returned to the CLI.
- The runtime receives a reader for current committed theme and appearance settings from the real store. Boot events use the normalized state after registry validation and fallback; activity and subsequent events use the same live reader. Bootstrap does not replay pre-initialization theme changes as action events. [Telemetry emitters](./emitters.md#theme-and-appearance-snapshots) own the payload attachment. ^bootstrap-theme-telemetry

## data directory

- The data directory — the [Television home](../../product/cli.md#^cli-home) the server serves — hosts the telemetry state file at `state/telemetry.json` ([identity.md](./identity.md)). A directory counts as an existing Television data directory when persisted data shows that it has already served. Examples include `state/display.json`; populated `state/channels/`, legacy `state/screens/`, or `state/artifacts/`; theme or artifact content; the onboarding state file `state/onboarding.json`; and the legacy onboarding sentinel `state/onboarding-artifact.json`. Older directories may use only the legacy onboarding path instead of `state/onboarding.json`. The home's `config.json` is not evidence of a serving boot. For a fresh authenticated `tv serve --persist`, the parent CLI may create the token and empty storage directories before the daemon's store exists. Those files and directories are not evidence of a serving boot either, so the first serving boot remains an install. Bootstrap must preserve this distinction for telemetry's install signal ([identity.md](./identity.md), [server-installed product behavior](../../product/telemetry.md#What we measure)). If no evidence of an earlier serving boot exists, telemetry receives the install signal when bootstrap creates or completes the directory's initial structure.

## Testing

Under the testing policy's [compositional coverage rule](../testing-policy.md#Compositional coverage across clean seams), each telemetry module's proof covers the handoffs that module consumes. This buffer's proof covers the obligations imposed directly on server modules. Those obligations are proven through a real `ServerStore` or a listening `Server`. The filesystem, websocket, HTTP routes, and authentication remain real.

## Note

When the server architecture spec is created, fold each section above into it and retire this buffer. CLI telemetry controls, status output, persisted environment, and skill-install emission wiring are owned by [product/cli.md](../../product/cli.md) and [arch/cli/index.md](../cli/index.md).

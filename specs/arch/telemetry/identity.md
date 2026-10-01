*Telemetry identity and control: the per-server telemetry user GUID, the telemetry state file that stores it with the opt-out flag and last-seen version, install/start/upgrade detection, and the suppression gate.*

# Telemetry identity and control

## What this owns

This module owns the *telemetry user* identity and the control/suppression state that decides whether anything is sent: the GUID, the on-disk telemetry state, the derivation of install vs. start vs. upgrade, and the suppression gate. The user-facing identity model and the opt-out/disclosure behavior are owned by [product/telemetry.md](../../product/telemetry.md). The CLI commands that toggle opt-out are owned by [product/cli.md#Telemetry controls](../../product/cli.md#Telemetry controls).

## Contract

```ts
interface TelemetryState {
  schemaVersion: 1      // state-file schema discriminator
  userId: string        // the telemetry user GUID, minted on first existence
  optedOut: boolean     // absent/false ⇒ active
  lastVersion: string   // last server version observed (for upgrade detection)
}

interface DeriveBootTelemetryOptions {
  dataDirCreated: boolean // true iff the served home holds no prior serving evidence (derivation below)
  userIdFactory?: () => string
}

type TelemetrySuppressionReason = "do-not-track" | "ci" | "development" | "developer-host"
type TelemetryStatusState = "active" | "opted-out" | "suppressed" | "unavailable"

interface TelemetryStatus {
  state: TelemetryStatusState
  reason: TelemetrySuppressionReason | null
  guidPresent: boolean
  region: "us"
}

interface TelemetryEnv {
  DO_NOT_TRACK?: string
  CI?: string
  TV_TELEMETRY_TEST?: string
  TELEVISION_DEVELOPER_HOME?: string // persisted daemon install-time os.homedir() output for marker detection
}

// Capture and project selection use the product cascade; status follows ^status-visible.
function telemetryDestination(env: TelemetryEnv, state: Pick<TelemetryState, "optedOut">, developerHost: boolean): "production" | "test" | null

// The single gate every emit passes through (see the telemetry chokepoint).
function telemetryEnabled(env: TelemetryEnv, state: Pick<TelemetryState, "optedOut">, developerHost: boolean): boolean
```

`TelemetryStatus` is defined once in the shared client/server types and re-exported by the server telemetry module; the server routes and CLI use that shared shape.

The telemetry user GUID is the PostHog `distinct_id` for every event. It lives in the [Television home](../../product/cli.md#^cli-home) the server serves, which is its data directory. Because the identity lives in the home, **the telemetry user is the home**: two instances pointed at different homes are different telemetry users, and one home is one telemetry user. A skill install records under the identity of the home its command selects, so installing skills against one home and serving another yields two telemetry users. This relies on Television running a single active server process per home — it has no multi-writer strategy; concurrent servers sharing one home are out of scope for telemetry and tracked separately as a server-side bug.

## Behavior

- **State file.** A dedicated telemetry state file at `<home>/state/telemetry.json` holds `TelemetryState`. The file contains only the schema version, GUID, opt-out flag, and last server version; it does not store an install timestamp. Install time is the timestamp of the `server_installed` event in PostHog. The existing `state/display.json` is *display* state and is the wrong home. The **server is the sole writer of the opt-out flag** — `tv telemetry enable|disable` mutate it through the running server, avoiding write races. The CLI's skill-install emitter reads the selected home's file for the GUID and opt-out flag, and **mints the GUID if it is absent** (a pre-first-boot skill install, before any server has run) — a one-time creation with no concurrent writer, so it does not race the sole-writer rule, which governs the mutable opt-out flag.
- **Mint once.** When no valid telemetry GUID is present, the server mints the GUID and persists it; it is then stable for the life of that data. A missing, syntactically invalid, or schema-invalid telemetry state file is treated as absent and mints fresh state; unexpected state I/O disables telemetry for that process rather than failing server startup. After such a failure, telemetry status is `{ state: "unavailable", reason: null, guidPresent: false, region: "us" }`.
- **Install / start / upgrade derivation.** Before serving bootstrap writes state, the server captures `dataDirCreated` from the absence of prior serving evidence: display or onboarding state, populated channel or artifact metadata, theme content, or agent-authored artifact content. `dataDirCreated === true` ⇒ emit *server installed* and *server started* (the GUID exists for both). The `server_installed` event sets person property `pre_telemetry: false`, marking a full-journey telemetry user. The install decision is **not** derived from the telemetry state file: a missing telemetry state file on an existing Television data directory mints the GUID if needed but is not an install. Before the first serving boot, the home may hold a config file, and the parent process for a fresh authenticated `tv serve --persist` may create the auth token and empty storage directories. This still counts as fresh server data. Its first serving boot emits *server installed* regardless of whether the parent process or daemon created those markers first ([server-installed product behavior](../../product/telemetry.md#What we measure)). Server bootstrap must preserve enough information to distinguish that shape from data that has already served. On an existing, previously served data directory (`dataDirCreated === false`), a missing/empty `lastVersion` means pre-telemetry adoption: emit *server upgraded* with event properties `new_version` and `pre_telemetry: true`, set person property `pre_telemetry: true`, then emit *server started*. A `lastVersion` older than the running version ⇒ emit *server upgraded* with `old_version` and `new_version`, then *server started*; version-bump upgrades do not touch `pre_telemetry` because the cohort flag is a one-time historical fact. The version comparison is SemVer-style over `major.minor.patch` numeric core and prerelease identifiers, ignoring build metadata; if either version is not parseable as a semantic version, only exact equality is same-version and non-equal unparseable values are treated as not older. A same-version restart emits only *server started*. A downgrade (`lastVersion` newer than the running version) is not an upgrade and emits only *server started*. Every successful derivation writes `lastVersion` to the running version so the once-per-dir lifecycle state advances even on same-version boots and downgrades.
- **Control decision.** Implement the single [enablement and destination cascade](../../product/telemetry.md#^telemetry-rules); do not derive additional policy here. Marker detection is performed once at telemetry startup and supplied to this decision by the runtime. [Sink operations](./sink.md#Behavior and operations) own build wiring and delivery mechanics.
- **Opt-out event.** Disabling records exactly one *telemetry opted out* event with `$set: { telemetry_opted_out: true }` and then goes silent; re-enabling preserves the same GUID, clears the stored opt-out flag, and emits no standalone re-enable event. The single opt-out event is what lets retention distinguish opt-out from abandonment ([product/telemetry.md#^opt-out-event](../../product/telemetry.md#^opt-out-event)).

## Testing

Contract tests exercise every outcome of the [four-rule cascade](../../product/telemetry.md#^telemetry-rules), including test mode under each suppression input, marker suppression, and inert retired runtime overrides. Status tests cover environment suppression before stored opt-out, including opted-out state under DNT, CI, development builds, and marked production hosts. Reading, writing, and recovering telemetry identity state are proven on the real filesystem. Boot derivation for the same state is also proven on the real filesystem. Enabling and disabling telemetry are proven over HTTP through a real `Server` and `ServerStore`. An unexpected telemetry state I/O failure resulting in an `unavailable` status is proven over HTTP through the same real server and store. The sink's [real PostHog integration](./sink.md#Real PostHog integration test surface) proves delivery from the telemetry chokepoint to PostHog. Product acceptance through a persisted daemon is governed by the [telemetry product spec](../../product/telemetry.md).


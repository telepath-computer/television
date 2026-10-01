*The telemetry architecture root: the single typed event chokepoint and the closed event/property vocabulary that structurally enforce "no user-generated content", with a map to the module specs that own each part.*

# Telemetry architecture

## What this owns

This is the root of Television's telemetry architecture. It owns the **event chokepoint** — the single typed module every event passes through — and the **closed vocabulary** of event names and property types. The user-facing behavior and privacy guarantees are owned by [product/telemetry.md](../../product/telemetry.md); the per-area implementation is owned by the module specs in the [Module map](#module-map). This is real spec authority for telemetry code.

## The event chokepoint

All telemetry passes through one module — the *telemetry chokepoint*. Events are a closed discriminated union; properties are enumerated unions, numeric version triples, booleans, and integers, with one documented exception — `installed_by_agent`, a free string ([product/telemetry.md#^installed-by-agent](../../product/telemetry.md#^installed-by-agent)). No other code builds event properties or enqueues events for delivery; the transport adds only [fixed privacy controls](./sink.md#^telemetry-transport-privacy). This is the mechanism that enforces [the closed vocabulary](../../product/telemetry.md#^closed-vocabulary) and [no user-generated content](../../product/telemetry.md#^no-ugc) **structurally** — a path, URL, title, or name has no typed channel through which to reach the platform. The same module is used by both the server (the primary emitter) and the CLI (for *skill installed*); see [emitters.md](./emitters.md).

Channel CRUD and aggregate concepts retain six screen-named raw keys solely at this typed PostHog boundary, as owned by [the analytics-history exception](../../product/telemetry.md#^telemetry-channel-key-exception). The union below therefore deliberately keeps those literals while internal hooks, variables, and prose use channel names.

```ts
type TelemetryEventName =
  | "server_installed"
  | "server_started"
  | "server_upgraded"
  | "session_activity"   // carries a server-managed UUIDv7 $session_id (see sessions.md)
  | "artifact_created" | "artifact_updated" | "artifact_deleted"
  | "screen_created" | "screen_updated" | "screen_deleted"
  | "layout_changed"
  | "channel_pins_changed"
  | "tab_page_full_screen_changed"
  | "artifact_skill_prompt_copy_clicked"
  | "theme_changed"
  | "appearance_mode_changed"
  | "skill_installed"
  | "telemetry_opted_out"
  // Update-notification events, client-signaled (client-signals.md); firing
  // semantics owned by the updates domain (arch/updates/index.md):
  | "client_autoreloaded"          // version-advertisement.md
  | "update_toast_shown"           // update-channel.md
  | "update_prompt_copy_clicked"   // update-channel.md
  | "desktop_upgrade_gate_shown"   // desktop-upgrade-gate.md

interface TelemetryEvent {
  name: TelemetryEventName
  properties?: TelemetryEventProperties
  personProperties?: TelemetryPersonProperties
}

// Property value sets (mirroring product/telemetry.md). Derivation logic: derivation.md.
type AuthMode = "auth" | "no-auth"
type DefaultOrCustom = "default" | "custom"
type LaunchMode = "daemon" | "cli"
// Host binding is a set of independent booleans (a server may bind several at once):
//   bindsLoopback, bindsAllInterfaces, bindsTailnet, bindsOtherSpecific.
type ClientApp = "browser" | "desktop"
type ClientPlatform = "windows" | "macos" | "linux" | "ios" | "android" | "other"
type BrowserVendor = "chrome" | "safari" | "firefox" | "edge" | "other" // browser major version is an integer
type ArtifactKind = "path" | "url"
type PathKind = "folder" | "file"
type PathFileType = "html" | "markdown" | "other"
type UrlHost = "localhost" | "tailnet" | "third-party"  // isArtifactProxy is a separate boolean (function of path)
type LayoutChangeType = "tab_reorder"
type ChannelPinsChangeType = "pin" | "unpin" | "reorder" | "replace"
type ArtifactDeletionCause = "direct" | "channel_deleted"
type ArtifactSkill = "calendar" | "table" | "tasks" | "markdown"
type BundledThemeID = (typeof BUNDLED_THEME_IDS)[number] // generated from specs/ui/themes/bundled.yml
type ThemeState = "none" | BundledThemeID | "custom"
type ThemeChangeReason = "selection" | "fallback"
type AppearanceMode = "light" | "dark" | "system"
type AgentType = "pi" | "opencode" | "claude" | "codex" | "hermes" | "openclaw" | "cursor" | "dot-agents" | "interactive-install" | "other"
type TelemetryVersion = string // branded version input; outgoing values are classified below

interface TelemetryEventProperties {
  telemetry_opted_out?: boolean
  pre_telemetry?: boolean
  server_version?: TelemetryVersion
  old_version?: TelemetryVersion
  new_version?: TelemetryVersion
  auth_mode?: AuthMode
  binds_loopback?: boolean
  binds_all_interfaces?: boolean
  binds_tailnet?: boolean
  binds_other_specific?: boolean
  port?: DefaultOrCustom
  storage_path?: DefaultOrCustom // classifies the served Television home
  launch_mode?: LaunchMode
  installed_by_agent?: string // the only free string property
  client_app?: ClientApp
  client_platform?: ClientPlatform
  browser_vendor?: BrowserVendor
  browser_major_version?: number
  desktop_app_version?: TelemetryVersion
  // Update-notification versions (client-signaled; pattern-validated release
  // triples per client-signals.md — free text cannot ride these fields):
  from_version?: TelemetryVersion          // client_autoreloaded: pre-reload bundle version
  to_version?: TelemetryVersion            // client_autoreloaded: post-reload bundle version
  channel_version?: TelemetryVersion       // update_toast_shown / update_prompt_copy_clicked
  required_desktop_version?: TelemetryVersion  // desktop_upgrade_gate_shown
  total_screens?: number
  total_artifacts?: number
  median_artifacts_per_screen?: number
  average_artifacts_per_screen?: number
  artifact_kind?: ArtifactKind
  path_kind?: PathKind
  path_file_type?: PathFileType
  url_host?: UrlHost
  url_is_artifact_proxy?: boolean
  deletion_cause?: ArtifactDeletionCause
  change_type?: LayoutChangeType
  pin_change_type?: ChannelPinsChangeType
  pinned_channel_count?: number
  full_screen?: boolean
  artifact_skill?: ArtifactSkill
  theme_state?: ThemeState
  theme_count?: number
  theme_change_reason?: ThemeChangeReason
  theme_main_js_declared?: boolean
  theme_main_js_enabled?: boolean
  theme_iframe_background_enabled?: boolean
  theme_iframe_overlay_enabled?: boolean
  appearance_mode?: AppearanceMode
  agent_type?: AgentType
}
type TelemetryPersonProperties = TelemetryEventProperties

interface BuiltTelemetryEvent {
  name: TelemetryEventName
  distinctId: string
  properties: TelemetryEventProperties & {
    distinct_id: string
    $session_id?: string
    $set?: TelemetryPersonProperties
  }
}

interface TelemetryCaptureSink {
  enqueue(event: BuiltTelemetryEvent): void
}

interface CaptureContext {
  state: TelemetryState          // identity.md
  env: TelemetryEnv              // product telemetry control inputs
  developerHost: boolean        // detected at telemetry startup
  sink: TelemetryCaptureSink     // sink.md, injected behind the chokepoint
  sessionId?: string | null      // sessions.md; absent for server/CLI events without client attribution
}

// The single entry point. Applies the suppression gate (identity.md) and, if enabled,
// builds the payload (distinct_id = telemetry user GUID, optional $session_id, event
// properties, and optional person-property $set for per-server state — see
// emitters.md) and hands it to the sink (sink.md). Never throws to the caller.
function capture(event: TelemetryEvent, context: CaptureContext): void
```

`capture` is the only path to the sink: the suppression gate, the GUID/`$session_id` stamping, and delivery all sit behind it. That single handoff is what lets coverage compose (a contract test that the gate/sink are reached, plus per-module contract tests) rather than re-proving routing per event — see [testing-policy.md#Compositional coverage across clean seams](../testing-policy.md#Compositional coverage across clean seams).

Before enqueueing, the chokepoint classifies every `TelemetryVersion`-typed field in event and person properties under [property derivation](./derivation.md#Behavior). Local lifecycle state and version comparison retain the full version; only outbound analytics are reduced.

The six settings `theme_state`, `theme_main_js_declared`, `theme_main_js_enabled`, `theme_iframe_background_enabled`, `theme_iframe_overlay_enabled`, and `appearance_mode` form a complete snapshot: none is omitted when the snapshot is attached. `theme_changed` requires `theme_state`, the four JavaScript booleans, `theme_count`, and `theme_change_reason`; `appearance_mode_changed` requires `appearance_mode`. Their person properties and the six event properties on `session_activity` follow [emitters.md](./emitters.md#theme-and-appearance-snapshots). The property types admit no custom theme ID or consent list. ^theme-settings-vocabulary

## Module map

| Spec | Owns |
|---|---|
| [identity.md](./identity.md) | telemetry user GUID, the telemetry state file, install/start/upgrade derivation, the suppression gate, opt-out |
| [sessions.md](./sessions.md) | server-side session state, `$session_id` mint/rotation, attribution, session-less gating |
| [derivation.md](./derivation.md) | pure functions deriving enumerated/integer properties (config, binding, UA, artifact, layout, pins, page presentation, theme, agent type, versions) |
| [emitters.md](./emitters.md) | the server/CLI hook points that build events, and which properties ride on which events |
| [sink.md](./sink.md) | the PostHog transport: bounded in-memory buffer, fire-and-forget, region/key, operations |
| [client.md](./client.md) | the browser + Electron client agent: client id, engagement detection, activity signal, transport attachment |
| [client-signals.md](./client-signals.md) | the generic client→server telemetry signal: envelope, per-event validation registry, forwarding into the chokepoint |
| [server-telemetry-buffer.md](./server-telemetry-buffer.md) | *(buffer)* contracts telemetry imposes on existing server modules (event-stream, server-store, bootstrap, data dir) |
| [product/cli.md](../../product/cli.md) and [arch/cli/index.md](../cli/index.md) | `tv` telemetry controls, status output, persisted environment, and skill-install emission wiring |

## Testing

Module behavior and product outcomes are proven in the proofs for the specs that own them. The proof for this root spec covers the closed vocabulary and the single telemetry chokepoint. The closed vocabulary is proven at compile time against the exported production event and property types. That `capture` is the only path to the sink is proven from the checked-out production TypeScript tree and package exports. The sink's [real PostHog integration](./sink.md#Real PostHog integration test surface) proves delivery from the telemetry chokepoint to PostHog.

*The client telemetry agent (browser + Electron): the anonymous client id, a single standard client metadata payload attached to all communications, engagement detection and the content-free activity signal, and the fact that the client is unaware of the telemetry setting.*

# Telemetry client agent

## What this owns

This module owns the client-side telemetry agent in the browser and Electron clients: the client id, the standard client metadata payload, engagement detection, and the content-free activity signal. The activity signal is not a telemetry event — it is an input that helps the server decide when to fire session-lifecycle telemetry from the backend; clients report actual discrete telemetry events through the separate client-signal mechanic ([client-signals.md#^activity-boundary](./client-signals.md#^activity-boundary)). It deliberately contains **no PostHog code and no analytics keys** — the client only describes itself and signals engagement to its own server, which does all emission. Server-side consumption is owned by [sessions.md](./sessions.md) (boundary detection) and [derivation.md](./derivation.md) (parsing the metadata into the client property bundle). The meaning of *client*, *client id*, and *activity signal* is owned by [product/telemetry.md](../../product/telemetry.md).

## Contract

```ts
const CLIENT_ID_KEY = "tv.telemetry.clientId"   // anonymous random GUID, in localStorage

// The standard client telemetry metadata. Built in ONE place and attached to every
// client→server communication (the websocket connection and API calls).
interface ClientTelemetryMeta {
  clientId: string                  // the localStorage GUID
  userAgent: string                 // navigator.userAgent (present in browser and Electron renderer)
  clientApp: "browser" | "desktop"
  desktopAppVersion?: string        // Electron only
}

// Content-free engagement ping, debounced, sent while the user is active.
interface TelemetryActivitySignal {
  type: "telemetry-activity"
  clientId: string
}
```

## Behavior

- **One client id, one code path.** A random GUID is minted on first run, persisted in `localStorage`, read back on every load, and **re-minted if absent** (e.g. the user cleared storage). The browser and the Electron renderer (Chromium, persistent `localStorage` with a persistent session partition) use the **same** module. A browser profile's tabs share `localStorage` for the server origin and therefore share one client id (one session); the Electron app uses its own persistent storage partition, so it has a distinct client id from the user's browser even when both connect to the same server origin.
- **Standard client metadata, built in one place.** A single `ClientTelemetryMeta` is constructed in one place and attached to **every** client→server communication — as query parameters on the websocket connection and as the `X-Television-Client-Meta` header on API calls — so the server can identify and describe the client uniformly. It carries the client id, `userAgent` (this is where the browser user-agent travels — `navigator.userAgent`, present in both the browser and the Electron renderer), `clientApp`, and, for Electron, `desktopAppVersion`. The server derives platform / browser vendor / browser major version from `userAgent` and reads `clientApp` / `desktopAppVersion` directly ([derivation.md](./derivation.md)). The raw `userAgent` is consumed server-side only — it is **never forwarded to PostHog**; only its parsed enumerations are.
- **The `?desktopAppVersion=` page-URL parameter.** The Electron shell hands its version to the renderer as the `?desktopAppVersion=` query parameter on the page URL it loads (`buildRemoteURL()` in `packages/desktop/src/connect-url.ts`, populated from `app.getVersion()`, read by `resolveDesktopAppVersion()` in `packages/web/src/config.ts`); that is where the meta's `desktopAppVersion` originates. This page parameter is **load-bearing for three domains**: besides telemetry, the desktop upgrade gate compares it against the server's required desktop version ([desktop-upgrade-gate.md#^gate-condition](../updates/desktop-upgrade-gate.md#^gate-condition)), and the desktop upgrade recommendation compares a valid release value against the web bundle's recommended desktop version ([desktop-upgrade-recommendation.md#^desktop-rec-condition](../updates/desktop-upgrade-recommendation.md#^desktop-rec-condition)). Its **absence** is itself meaningful to the gate ([desktop-upgrade-gate.md#^gate-unknown-version](../updates/desktop-upgrade-gate.md#^gate-unknown-version)) and recommendation (which fails open). It must not be renamed, dropped, or repurposed without updating all three domains. The shell resolves its version once per connect attempt and also sends that value under the same `desktopAppVersion` key on the [desktop connect check](../updates/desktop-upgrade-gate.md#^pre-gate-handshake); that copy is frozen but informational, and the server does not use it as a gate input. ^desktop-version-param
- **Engagement detection.** The client treats as "active": the window/tab becoming active (Page Visibility becoming visible, and focus) and pointer/scroll/key interaction. While active it emits the `TelemetryActivitySignal`, **debounced to at most one per 5 minutes**, and stays silent while idle or backgrounded. The shipped client does not send a separate page-hide or session-end signal; session ends are derived server-side from the last event PostHog sees for the `$session_id`.
- **Content-free activity signal.** The activity ping carries only the fixed message type and client id — never a URL, channel/artifact identifier, or input. This is load-bearing for [product/telemetry.md#^no-ugc](../../product/telemetry.md#^no-ugc); the client must not be the place UGC leaks in. (The metadata's `userAgent` is a standard client descriptor, not user content, and never reaches PostHog raw — see above.)
- **The client is unaware of the telemetry setting.** All telemetry is emitted by the server. The client **always** sends its metadata and activity signals, regardless of opt-out or any suppression; the server's suppression gate ([identity.md](./identity.md)) alone decides whether anything is emitted to PostHog. The client holds no telemetry on/off state, so enabling or disabling telemetry requires no client change and no client awareness.

## Testing

Client identity, metadata, and activity are proven in both a real browser and the real Electron app against a listening `Server`. Both cases use real storage, HTTP, and websockets. The browser case proves that the client id survives a reload and a restart of a persistent browser profile. The Electron case proves that the client id survives an app restart with the same user-data directory. The sink's [real PostHog integration](./sink.md#Real PostHog integration test surface) proves delivery from `capture()` to PostHog.


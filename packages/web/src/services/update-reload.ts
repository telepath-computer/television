import { isStaleBundle, type ClientSignalEventName } from "@telepath-computer/television-shared";
import type { ChangeEvent } from "@telepath-computer/television-shared";
import type { ServerStatusEvent } from "../events.ts";
import { resolveBundleVersion } from "../version.ts";
import { createNavigationLatch, type NavigationLatch } from "./navigation-latch.ts";

// The client reload contract
// (specs/arch/updates/version-advertisement.md ^reload-action,
// ^reload-loop-guard, ^reload-origin-rule, ^autoreload-telemetry):
// `decideOnServerStatus` is the PURE decision — string-inequality staleness
// with the 0.0.0 exemption (via the single shared comparison,
// arch/updates/index.md ^updates-version-comparisons), the sessionStorage
// loop guard, and primary-origin scoping. All side effects (marker writes,
// `location.reload()`, the client_autoreloaded signal) live in the one thin
// agent below — nothing else in the client may call `location.reload()` for
// version reasons.

/** sessionStorage key of the loop-guard marker (^reload-loop-guard). */
export const RELOAD_MARKER_KEY = "tv-reload-attempted";

export interface ReloadMarker {
  /** The server version the client reloaded for. */
  serverVersion: string;
  /** The pre-reload bundle version, consumed by the post-reload telemetry emission. */
  fromVersion: string;
}

export type ReloadDecision =
  | { action: "reload"; marker: ReloadMarker }
  | { action: "signal-autoreloaded"; fromVersion: string; toVersion: string }
  | { action: "none" };

/**
 * The reload decision (^t-reload-decision): given the bundle version, the
 * server version from a `server-status` message, whether that message came
 * from the bundle-serving origin's connection, and the current loop-guard
 * marker — reload, emit the post-reload telemetry, or do nothing.
 */
export function decideOnServerStatus(input: {
  bundleVersion: string;
  serverVersion: string;
  originMatch: boolean;
  marker: ReloadMarker | null;
}): ReloadDecision {
  if (!input.originMatch) return { action: "none" };

  // Post-reload startup with a satisfied marker: the reload happened and
  // healed the mismatch — signal client_autoreloaded and clear the marker
  // (^autoreload-telemetry). TRUE equality, not exemption-equality.
  if (input.marker !== null && input.bundleVersion === input.serverVersion) {
    return { action: "signal-autoreloaded", fromVersion: input.marker.fromVersion, toVersion: input.bundleVersion };
  }

  // String inequality with the 0.0.0 exemption on either side.
  if (!isStaleBundle(input.bundleVersion, input.serverVersion)) return { action: "none" };

  // Loop guard: at most one attempt per server version per tab session. A
  // marker for a DIFFERENT server version does not guard — the next release
  // retries naturally (^reload-loop-guard).
  if (input.marker !== null && input.marker.serverVersion === input.serverVersion) return { action: "none" };

  return {
    action: "reload",
    marker: { serverVersion: input.serverVersion, fromVersion: input.bundleVersion },
  };
}

export interface MarkerStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** Read the loop-guard marker; malformed or missing values read as null. */
export function readReloadMarker(storage: MarkerStorage): ReloadMarker | null {
  const raw = storage.getItem(RELOAD_MARKER_KEY);
  if (raw === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const record = parsed as Record<string, unknown>;
  if (typeof record.serverVersion !== "string" || typeof record.fromVersion !== "string") return null;
  return { serverVersion: record.serverVersion, fromVersion: record.fromVersion };
}

export interface UpdateReloadConnection {
  readonly url: string;
  status: string;
  sendTelemetrySignal(event: ClientSignalEventName, properties: Record<string, string>): void;
}

// Variance escape hatch: the typed EventTarget's generic listener signatures
// are contravariant in the event union. `any` keeps the structural owner
// assignable while the agent's listeners remain fully typed.
type AnyEventListener = (event: any) => void;

export interface UpdateReloadConnectionOwner {
  readonly connection: UpdateReloadConnection;
  addEventListener(type: "server-status" | "change", listener: AnyEventListener): void;
  removeEventListener(type: "server-status" | "change", listener: AnyEventListener): void;
}

export interface UpdateReloadAgentOptions {
  owner: UpdateReloadConnectionOwner;
  /**
   * The owned connection's normalized URL. Reload applies only when that
   * connection's origin served the bundle (^reload-origin-rule).
   */
  primaryServerURL: string;
  bundleVersion?: string;
  /** Defaults to `sessionStorage`; with no storage the agent is inert — no guard means no safe reload. */
  storage?: MarkerStorage | null;
  reload?: () => void;
  /**
   * The page's shared navigation latch (navigation-latch.ts): the agent's
   * reload goes through it, and once ANY sanctioned site has begun a
   * navigation the agent stops evaluating — no marker writes and no second
   * reload from a dying page. Defaults to a private latch (same exactly-once
   * behavior, unshared).
   */
  navigationLatch?: NavigationLatch;
}

/**
 * The thin side-effect wrapper around the reload decision: evaluates every
 * `server-status` from the primary connection — which covers both detection
 * points, since initial connect and every reconnect each deliver one
 * (^reload-detection) — writes the marker before reloading (^reload-action),
 * and emits `client_autoreloaded` from a satisfied marker once the transport
 * can carry it (^autoreload-telemetry; `server-status` arrives before the
 * connection reports "connected", so the send is deferred until then).
 */
export function createUpdateReloadAgent(options: UpdateReloadAgentOptions): { dispose(): void } {
  const storage = options.storage !== undefined
    ? options.storage
    : typeof sessionStorage !== "undefined"
      ? sessionStorage
      : null;
  const reload = options.reload ?? (() => location.reload());
  const navigationLatch = options.navigationLatch ?? createNavigationLatch();
  const bundleVersion = options.bundleVersion ?? resolveBundleVersion();

  if (storage === null) {
    return { dispose(): void {} };
  }

  let pendingSignal: { fromVersion: string; toVersion: string } | null = null;

  const trySendPendingSignal = (): void => {
    if (pendingSignal === null) return;
    const connection = options.owner.connection;
    if (connection.url !== options.primaryServerURL || connection.status !== "connected") return;
    const signal = pendingSignal;
    pendingSignal = null;
    connection.sendTelemetrySignal("client_autoreloaded", {
      from_version: signal.fromVersion,
      to_version: signal.toVersion,
    });
  };

  const onServerStatus = (event: ServerStatusEvent): void => {
    // A navigation is already in flight — the page is dying; nothing may act.
    if (navigationLatch.pending) return;
    const decision = decideOnServerStatus({
      bundleVersion,
      serverVersion: event.message.version,
      originMatch: event.serverURL === options.primaryServerURL,
      marker: readReloadMarker(storage),
    });
    switch (decision.action) {
      case "reload":
        storage.setItem(RELOAD_MARKER_KEY, JSON.stringify(decision.marker));
        navigationLatch.begin(reload);
        return;
      case "signal-autoreloaded":
        // Clear first: the emission is exactly-once per satisfied marker,
        // whatever the transport timing.
        storage.removeItem(RELOAD_MARKER_KEY);
        pendingSignal = { fromVersion: decision.fromVersion, toVersion: decision.toVersion };
        trySendPendingSignal();
        return;
      case "none":
        return;
    }
  };

  const onChange = (): void => {
    trySendPendingSignal();
  };

  options.owner.addEventListener("server-status", onServerStatus);
  options.owner.addEventListener("change", onChange);

  return {
    dispose(): void {
      options.owner.removeEventListener("server-status", onServerStatus);
      options.owner.removeEventListener("change", onChange);
    },
  };
}

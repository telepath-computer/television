import { describe, expect, it, vi } from "vitest";
import { EventTarget } from "@rupertsworld/event-target";
import { ChangeEvent } from "@telepath-computer/television-shared";
import { ServerStatusEvent } from "../src/events.ts";
import {
  RELOAD_MARKER_KEY,
  createUpdateReloadAgent,
  decideOnServerStatus,
  readReloadMarker,
  type MarkerStorage,
  type ReloadMarker,
  type UpdateReloadConnection,
} from "../src/services/update-reload.ts";

// Contract tests for the client reload contract
// (specs/arch/updates/version-advertisement.md):
//   ^t-reload-decision — the pure decision over (bundle version, server
//     version, guard marker); messages injected — greenlit,
//     the real websocket crossing owned by ^t-reload-wiring
//     (test/e2e/update-reload.spec.ts). Permutation breadth lives here:
//     string-inequality mismatch (arch/updates/index.md
//     ^updates-version-comparisons), the 0.0.0 exemption
//     (^updates-dev-version), and the sessionStorage loop guard
//     (^reload-loop-guard).
//   ^t-autoreload-signal — producer side of client_autoreloaded
//     (^autoreload-telemetry): exactly once on a satisfied marker, marker
//     cleared; nothing on a persisting mismatch. The socket transport is
//     NOT asserted here — that crossing is owned by
//     client-signals.md ^t-signal-forwarding.

function memoryStorage(initial: Record<string, string> = {}): MarkerStorage & { dump(): Record<string, string> } {
  const backing = new Map(Object.entries(initial));
  return {
    getItem: (key) => backing.get(key) ?? null,
    setItem: (key, value) => {
      backing.set(key, value);
    },
    removeItem: (key) => {
      backing.delete(key);
    },
    dump: () => Object.fromEntries(backing),
  };
}

function marker(serverVersion: string, fromVersion: string): ReloadMarker {
  return { serverVersion, fromVersion };
}

describe("reload decision (^t-reload-decision)", () => {
  const base = { bundleVersion: "1.2.3", serverVersion: "1.2.4", marker: null };

  it("reloads on a true mismatch with no marker, recording the marker payload", () => {
    expect(decideOnServerStatus(base)).toEqual({
      action: "reload",
      marker: { serverVersion: "1.2.4", fromVersion: "1.2.3" },
    });
    // String inequality, not ordering: an OLDER server version still mismatches.
    expect(decideOnServerStatus({ ...base, bundleVersion: "2.0.0", serverVersion: "1.0.0" })).toEqual({
      action: "reload",
      marker: { serverVersion: "1.0.0", fromVersion: "2.0.0" },
    });
  });

  it("never reloads on equal versions", () => {
    expect(decideOnServerStatus({ ...base, serverVersion: "1.2.3" })).toEqual({ action: "none" });
  });

  it("exempts 0.0.0 on either side (dev-version rule)", () => {
    expect(decideOnServerStatus({ ...base, bundleVersion: "0.0.0" })).toEqual({ action: "none" });
    expect(decideOnServerStatus({ ...base, serverVersion: "0.0.0" })).toEqual({ action: "none" });
    expect(decideOnServerStatus({ ...base, bundleVersion: "0.0.0", serverVersion: "0.0.0" })).toEqual({ action: "none" });
  });

  it("does not reload when the marker already records this server version (loop guard ^reload-loop-guard)", () => {
    expect(
      decideOnServerStatus({ ...base, marker: marker("1.2.4", "1.2.3") }),
    ).toEqual({ action: "none" });
  });

  it("reloads again for a NEW server version even with a stale marker present", () => {
    expect(
      decideOnServerStatus({ ...base, serverVersion: "1.2.5", marker: marker("1.2.4", "1.2.2") }),
    ).toEqual({
      action: "reload",
      marker: { serverVersion: "1.2.5", fromVersion: "1.2.3" },
    });
  });

  it("signals client_autoreloaded when the marker is satisfied: versions now equal (^autoreload-telemetry)", () => {
    expect(
      decideOnServerStatus({ ...base, serverVersion: "1.2.3", marker: marker("1.2.3", "1.2.2") }),
    ).toEqual({ action: "signal-autoreloaded", fromVersion: "1.2.2", toVersion: "1.2.3" });
  });

  it("with a marker and a 0.0.0-exempted mismatch, neither reloads nor signals", () => {
    // Exemption treats the versions as matching for reload purposes, but the
    // signal requires TRUE equality of bundle and server version.
    expect(
      decideOnServerStatus({ ...base, bundleVersion: "0.0.0", serverVersion: "1.2.4", marker: marker("1.2.4", "1.2.3") }),
    ).toEqual({ action: "none" });
  });
});

describe("reload marker storage", () => {
  it("round-trips the marker shape and tolerates malformed or missing values as null", () => {
    const storage = memoryStorage();
    expect(readReloadMarker(storage)).toBeNull();

    storage.setItem(RELOAD_MARKER_KEY, JSON.stringify({ serverVersion: "1.2.4", fromVersion: "1.2.3" }));
    expect(readReloadMarker(storage)).toEqual({ serverVersion: "1.2.4", fromVersion: "1.2.3" });

    for (const bad of ["not json", "42", JSON.stringify({ serverVersion: 1 }), JSON.stringify(null), JSON.stringify({ fromVersion: "1.2.3" })]) {
      storage.setItem(RELOAD_MARKER_KEY, bad);
      expect(readReloadMarker(storage), bad).toBeNull();
    }
  });
});

// ── Agent (thin side-effect wrapper) ────────────────────────────────────────

class FakeOwner extends EventTarget<ServerStatusEvent | ChangeEvent> {
  readonly connection: UpdateReloadConnection;

  constructor(connection: UpdateReloadConnection) {
    super();
    this.connection = connection;
  }

  emitStatus(version: string): void {
    this.dispatchEvent(
      new ServerStatusEvent("server-status", {
        message: { type: "server-status", version, requiredDesktopVersion: null, update: null },
      }),
    );
  }

  emitChange(): void {
    this.dispatchEvent(new ChangeEvent("change"));
  }
}

interface AgentHarness {
  owner: FakeOwner;
  connection: { status: string; sendTelemetrySignal: ReturnType<typeof vi.fn> };
  storage: ReturnType<typeof memoryStorage>;
  reload: ReturnType<typeof vi.fn>;
}

function agentHarness(input: { bundleVersion: string; marker?: ReloadMarker; connectionStatus?: string }): AgentHarness {
  const connection = { status: input.connectionStatus ?? "connected", sendTelemetrySignal: vi.fn() };
  const owner = new FakeOwner(connection);
  const storage = memoryStorage(
    input.marker ? { [RELOAD_MARKER_KEY]: JSON.stringify(input.marker) } : {},
  );
  const reload = vi.fn();
  createUpdateReloadAgent({
    owner,
    bundleVersion: input.bundleVersion,
    storage,
    reload,
  });
  return { owner, connection, storage, reload };
}

describe("update reload agent (side effects; ^t-reload-decision wiring + ^t-autoreload-signal)", () => {
  it("on mismatch: records the marker BEFORE invoking reload(), exactly once (^reload-action)", () => {
    const h = agentHarness({ bundleVersion: "1.2.3" });
    let markerAtReload: ReloadMarker | null = null;
    h.reload.mockImplementation(() => {
      markerAtReload = readReloadMarker(h.storage);
    });

    h.owner.emitStatus("1.2.4");
    expect(h.reload).toHaveBeenCalledTimes(1);
    expect(markerAtReload).toEqual({ serverVersion: "1.2.4", fromVersion: "1.2.3" });

    // The marker now guards: a repeat of the same server version is silent.
    h.owner.emitStatus("1.2.4");
    expect(h.reload).toHaveBeenCalledTimes(1);
    expect(h.connection.sendTelemetrySignal).not.toHaveBeenCalled();
  });

  it("an unstamped (0.0.0) bundle never reloads (^updates-dev-version)", () => {
    const h = agentHarness({ bundleVersion: "0.0.0" });
    h.owner.emitStatus("9.9.9");
    expect(h.reload).not.toHaveBeenCalled();
  });

  it("satisfied marker: signals client_autoreloaded exactly once with the marker's versions and clears it (^t-autoreload-signal)", () => {
    const h = agentHarness({ bundleVersion: "1.2.4", marker: marker("1.2.4", "1.2.3") });

    h.owner.emitStatus("1.2.4");
    expect(h.connection.sendTelemetrySignal).toHaveBeenCalledTimes(1);
    expect(h.connection.sendTelemetrySignal).toHaveBeenCalledWith("client_autoreloaded", {
      from_version: "1.2.3",
      to_version: "1.2.4",
    });
    expect(readReloadMarker(h.storage)).toBeNull();

    // A later server-status (e.g. an update-state re-broadcast) does not re-emit.
    h.owner.emitStatus("1.2.4");
    expect(h.connection.sendTelemetrySignal).toHaveBeenCalledTimes(1);
    expect(h.reload).not.toHaveBeenCalled();
  });

  it("persisting mismatch: signals nothing, reloads nothing, and leaves the marker for the guard (^reload-loop-guard)", () => {
    const h = agentHarness({ bundleVersion: "1.2.3", marker: marker("1.2.4", "1.2.3") });

    h.owner.emitStatus("1.2.4");
    expect(h.connection.sendTelemetrySignal).not.toHaveBeenCalled();
    expect(h.reload).not.toHaveBeenCalled();
    expect(readReloadMarker(h.storage)).toEqual({ serverVersion: "1.2.4", fromVersion: "1.2.3" });
  });

  it("defers the autoreloaded signal until the connection is connected (server-status precedes bootstrap)", () => {
    // On a real connection the server-status message arrives before the HTTP
    // bootstrap completes, i.e. before status flips to "connected" — and
    // sendTelemetrySignal drops while not connected. The agent must hold the
    // emission until the transport can carry it.
    const h = agentHarness({ bundleVersion: "1.2.4", marker: marker("1.2.4", "1.2.3"), connectionStatus: "disconnected" });

    h.owner.emitStatus("1.2.4");
    expect(h.connection.sendTelemetrySignal).not.toHaveBeenCalled();
    expect(readReloadMarker(h.storage)).toBeNull();

    h.connection.status = "connected";
    h.owner.emitChange();
    expect(h.connection.sendTelemetrySignal).toHaveBeenCalledTimes(1);
    expect(h.connection.sendTelemetrySignal).toHaveBeenCalledWith("client_autoreloaded", {
      from_version: "1.2.3",
      to_version: "1.2.4",
    });

    // Exactly once: further change events don't re-send.
    h.owner.emitChange();
    expect(h.connection.sendTelemetrySignal).toHaveBeenCalledTimes(1);
  });
});

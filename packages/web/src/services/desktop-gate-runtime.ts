import type { ClientSignalEventName, ServerStatusMessage } from "@telepath-computer/television-shared";
import type { ServerStatusEvent } from "../events.ts";
import { decideGatePresentation, type ElectronDetection } from "./desktop-gate.ts";
import { createNavigationLatch, type NavigationLatch } from "./navigation-latch.ts";
import type { UpdatePresentationState } from "./update-presentation.ts";

// The boot-barrier runtime (specs/arch/updates/desktop-upgrade-gate.md
// ^boot-barrier): the controller wired between the primary ServerConnection's
// `decideBoot` hook and the application-state edge. It halts or boots on each
// attempt's first server-status via the pure decision (desktop-gate.ts). The
// connection records that decision for ApplicationService, while this controller
// re-evaluates every subsequent primary server-status —
// exiting a retracted gate by a reload into a normal boot, never by
// un-halting incrementally (^gate-reevaluation) — suppresses the toast and
// bell while gated (^gate-precedence), and signals desktop_upgrade_gate_shown
// once per required version per page load over the already-open halted
// connection (^gate-telemetry).

// Variance escape hatch, as in update-reload.ts: the typed EventTarget's
// generic listener signatures are contravariant in the event union.
type AnyEventListener = (event: any) => void;

export interface GateConnection {
  sendTelemetrySignal(event: ClientSignalEventName, properties: Record<string, string>): void;
}

export interface GateConnectionOwner {
  readonly connection: GateConnection;
  addEventListener(type: "server-status", listener: AnyEventListener): void;
  removeEventListener(type: "server-status", listener: AnyEventListener): void;
}

export interface DesktopGateControllerOptions {
  /** The page's Electron detection (desktop-gate.ts); the barrier is inert outside Electron context. */
  detection: ElectronDetection;
  /** The reload-into-normal-boot exit (^gate-reevaluation); defaults to location.reload(). */
  reload?: () => void;
  /**
   * The page's shared navigation latch (navigation-latch.ts): the retraction
   * exit navigates through it, and once ANY sanctioned site has begun a
   * navigation the controller goes fully inert — no halted-state publication,
   * telemetry, or second navigation from a dying page. This is the
   * enforcement of ^reload-gate-precedence beyond listener order. Defaults
   * to a private latch (unshared).
   */
  navigationLatch?: NavigationLatch;
  /**
   * The page's shared update-presentation state (update-presentation.ts):
   * the owned suppression contract the toast subscribes to. Flipping its
   * suppress switch is the gate's ONLY interaction with the toast surface
   * (^gate-precedence).
   */
  presentation?: UpdatePresentationState;
}

export interface DesktopGateController {
  /** True while the client is halted at the gate. */
  readonly gated: boolean;
  /** The ServerConnection boot hook — pure decision, no side effects. */
  decideBoot(message: ServerStatusMessage): "boot" | "halt";
  /** Subscribe to the owner's server-status stream. Attach AFTER the reload agent (^reload-gate-precedence). */
  attach(owner: GateConnectionOwner): void;
  dispose(): void;
}

export function createDesktopGateController(options: DesktopGateControllerOptions): DesktopGateController {
  const reload = options.reload ?? ((): void => location.reload());
  const navigationLatch = options.navigationLatch ?? createNavigationLatch();
  let owner: GateConnectionOwner | null = null;
  let gated = false;
  // Once per client per required desktop version per page load (^gate-telemetry).
  const signaledRequirements = new Set<string>();

  const presentationFor = (message: ServerStatusMessage) =>
    decideGatePresentation({
      electron: options.detection.electron,
      shellVersion: options.detection.shellVersion,
      requiredDesktopVersion: message.requiredDesktopVersion,
      desktop: message.update?.desktop ?? null,
    });

  // The gate supersedes the toast and bell (^gate-precedence): flip the
  // shared presentation state's one-way suppress switch — the owned
  // contract the toast subscribes to. The gate never touches the toast
  // component itself.
  function suppressUpdateToasts(): void {
    options.presentation?.suppressToasts();
  }

  function signalGateShown(message: ServerStatusMessage): void {
    const requirement = message.requiredDesktopVersion;
    if (requirement === null || signaledRequirements.has(requirement)) return;
    signaledRequirements.add(requirement);
    // Rides the already-open connection that delivered the gating status —
    // the halted-state send path in ServerConnection (^gate-telemetry).
    // desktop_app_version is omitted when the shell version is unknown
    // (client-signals.md omission-allowed validation).
    owner?.connection.sendTelemetrySignal("desktop_upgrade_gate_shown", {
      ...(options.detection.shellVersion === null ? {} : { desktop_app_version: options.detection.shellVersion }),
      required_desktop_version: requirement,
    });
  }

  const onServerStatus = (event: ServerStatusEvent): void => {
    // A navigation is already in flight (the reload agent's, or this
    // controller's own earlier exit) — the page is dying; the gate must not
    // render, signal, or navigate (^reload-gate-precedence enforcement).
    if (navigationLatch.pending) return;
    if (presentationFor(event.message).gated) {
      gated = true;
      suppressUpdateToasts();
      signalGateShown(event.message);
    } else if (gated) {
      // The condition no longer holds (a lowered or retracted requirement):
      // reload into a normal boot rather than un-halt incrementally
      // (^gate-reevaluation). Through the shared latch, so the dying page's
      // connection never begins a bootstrap.
      navigationLatch.begin(reload);
    }
  };

  return {
    get gated(): boolean {
      return gated;
    },
    decideBoot(message: ServerStatusMessage): "boot" | "halt" {
      return presentationFor(message).gated ? "halt" : "boot";
    },
    attach(target: GateConnectionOwner): void {
      owner = target;
      target.addEventListener("server-status", onServerStatus);
    },
    dispose(): void {
      owner?.removeEventListener("server-status", onServerStatus);
      owner = null;
    },
  };
}

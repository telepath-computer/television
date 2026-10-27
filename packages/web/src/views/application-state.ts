import type {
  ApplicationSnapshot,
} from "../services/application-service.ts";
import type { DesktopUpgradeInstructions } from "@telepath-computer/television-shared";

const FAILED_RECONNECT_LIMIT = 3;

export type ConnectedApplicationState =
  | { readonly kind: "connected" }
  | { readonly kind: "no-channel" }
  | { readonly kind: "empty-channel" };

export type InterruptingApplicationState =
  | { readonly kind: "connecting" }
  | { readonly kind: "disconnected"; readonly nextRetryAt: number | null }
  | { readonly kind: "unauthorized" }
  | { readonly kind: "error"; readonly serverURL: string; readonly nextRetryAt: number | null }
  | {
      readonly kind: "needs-upgrade";
      readonly instructions: DesktopUpgradeInstructions | null;
    };

export type ApplicationState = ConnectedApplicationState | InterruptingApplicationState;

/** Resolve one application presentation from the complete application snapshot. */
export function selectApplicationState(
  snapshot: ApplicationSnapshot,
  serverURL: string,
): ApplicationState {
  const connection = snapshot.connection;

  if (connection.gateHalted) {
    return {
      kind: "needs-upgrade",
      instructions: connection.upgradeInstructions,
    };
  }
  if (connection.authorizationRequired) {
    return { kind: "unauthorized" };
  }
  if (connection.status !== "connected") {
    if (connection.failedReconnectAttempts >= FAILED_RECONNECT_LIMIT ||
        (!connection.hasEverConnected && connection.firstConnectError !== null)) {
      return { kind: "error", serverURL, nextRetryAt: connection.nextRetryAt };
    }
    if (connection.hasEverConnected) {
      return {
        kind: "disconnected",
        nextRetryAt: connection.nextRetryAt,
      };
    }
    return { kind: "connecting" };
  }
  if (!snapshot.ready) {
    return { kind: "connecting" };
  }
  if (snapshot.channels.length === 0) {
    return { kind: "no-channel" };
  }
  if (snapshot.focusedChannel?.pages.length === 0) {
    return { kind: "empty-channel" };
  }
  return { kind: "connected" };
}

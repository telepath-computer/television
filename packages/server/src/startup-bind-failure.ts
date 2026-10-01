import { serializeError } from "./logger.ts";
import type { LaunchMode } from "./telemetry/index.ts";

export const STARTUP_BIND_EXIT_STATUS = 69;

const IPV4_OCTET_COUNT = 4;
const CGNAT_SECOND_OCTET_MIN = 64;
const CGNAT_SECOND_OCTET_MAX = 127;

export interface BoundStartupBindAttempt {
  address: string;
  port: number;
  outcome: "bound";
}

export interface FailedStartupBindAttempt {
  address: string;
  port: number;
  outcome: "failed";
  error: Error;
}

export type StartupBindAttempt = BoundStartupBindAttempt | FailedStartupBindAttempt;

interface FailedStartupBindOutcome {
  address: string;
  port: number;
  outcome: "failed";
  code?: string;
  syscall?: string;
  cause: string;
  hint: string;
}

export interface StartupBindFailureRecord {
  reason: "required-listener-bind-failed";
  exitStatus: typeof STARTUP_BIND_EXIT_STATUS;
  outcomes: Array<BoundStartupBindAttempt | FailedStartupBindOutcome>;
}

export class StartupBindError extends Error {
  readonly exitStatus = STARTUP_BIND_EXIT_STATUS;

  constructor(attempts: readonly StartupBindAttempt[]) {
    const failures = attempts
      .filter((attempt): attempt is FailedStartupBindAttempt => attempt.outcome === "failed")
      .map((attempt) => `${attempt.address}:${attempt.port} (${attempt.error.message})`)
      .join(", ");
    super(`Television could not bind all required listeners: ${failures}`);
    this.name = "StartupBindError";
  }
}

export function buildStartupBindFailureRecord(
  attempts: readonly StartupBindAttempt[],
  launchMode: LaunchMode,
): StartupBindFailureRecord {
  return {
    reason: "required-listener-bind-failed",
    exitStatus: STARTUP_BIND_EXIT_STATUS,
    outcomes: attempts.map((attempt) => {
      if (attempt.outcome === "bound") return attempt;

      const serializedError = serializeError(attempt.error);
      const code = typeof serializedError.code === "string" ? serializedError.code : undefined;
      return {
        address: attempt.address,
        port: attempt.port,
        outcome: attempt.outcome,
        ...(code === undefined ? {} : { code }),
        ...(typeof serializedError.syscall === "string" ? { syscall: serializedError.syscall } : {}),
        cause: bindFailureCause(attempt, code),
        hint: bindFailureHint(attempt, code, launchMode),
      };
    }),
  };
}

function bindFailureCause(attempt: FailedStartupBindAttempt, code: string | undefined): string {
  if (code === "EADDRNOTAVAIL") {
    return `Cannot bind ${attempt.address}:${attempt.port} because the address is not assigned to this host.`;
  }
  if (code === "EADDRINUSE") {
    return `Cannot bind ${attempt.address}:${attempt.port} because the address and port are already in use.`;
  }
  if (code === "EACCES" || code === "EPERM") {
    return `Cannot bind ${attempt.address}:${attempt.port} because the process does not have permission.`;
  }
  return `Cannot bind ${attempt.address}:${attempt.port}: ${attempt.error.message}`;
}

// Only the installed service (launch mode `daemon`) gets the Tailscale hint:
// its service manager retries, and its operator repairs the address in the
// config file. A foreground serve records the generic hint.
function bindFailureHint(attempt: FailedStartupBindAttempt, code: string | undefined, launchMode: LaunchMode): string {
  if (code === "EADDRNOTAVAIL" && launchMode === "daemon" && isCgnatAddress(attempt.address)) {
    return `Address ${attempt.address} is not assigned to any interface. If this is a Tailscale IP, tailscaled may not be up yet (transient at boot), or the tailnet IP may have changed (permanent until the config file's \`listen\` setting is corrected). The service manager will retry.`;
  }
  if (code === "EADDRNOTAVAIL") {
    return `Confirm that ${attempt.address} is assigned to a local interface, then retry.`;
  }
  if (code === "EADDRINUSE") {
    return `Stop the process using ${attempt.address}:${attempt.port}, or choose another port, then retry.`;
  }
  if (code === "EACCES" || code === "EPERM") {
    return "Choose an address and port this process is permitted to bind, then retry.";
  }
  return "Check that the address and port are available, then retry.";
}

function isCgnatAddress(address: string): boolean {
  const octets = address.split(".").map(Number);
  return octets.length === IPV4_OCTET_COUNT &&
    octets[0] === 100 &&
    octets[1] !== undefined &&
    octets[1] >= CGNAT_SECOND_OCTET_MIN &&
    octets[1] <= CGNAT_SECOND_OCTET_MAX;
}

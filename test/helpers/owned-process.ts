import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process";

export const TEST_PROCESS_TERM_GRACE_MS = 2_000;
const OWNER_TOKEN_ENV = "TV_TEST_SURFACE_OWNER";

export type OwnedProcessCleanupOutcome = "already-exited" | "terminated" | "killed" | "survived";

export interface OwnedProcessCleanup {
  termSent: boolean;
  killSent: boolean;
  outcome: OwnedProcessCleanupOutcome;
}

export interface SpawnOwnedProcessOptions extends Omit<SpawnOptions, "detached"> {
  termGraceMs?: number;
}

export interface OwnedProcess {
  child: ChildProcess;
  pid: number;
  dispose(): Promise<OwnedProcessCleanup>;
}

const registered = new Set<OwnedProcess>();

/**
 * Start a long-running test child inside the current surface scope.
 *
 * The child receives the surface owner even when the caller supplies a
 * restricted environment, and starts in its own POSIX process group so prompt
 * cleanup can signal the whole tree. The outer surface supervisor remains the
 * authoritative final reaper if the test worker itself is interrupted.
 */
export function spawnOwnedProcess(command: string, args: readonly string[] = [], options: SpawnOwnedProcessOptions = {}): OwnedProcess {
  const { termGraceMs = TEST_PROCESS_TERM_GRACE_MS, env: requestedEnv, ...spawnOptions } = options;
  if (!Number.isFinite(termGraceMs) || termGraceMs < 0) throw new Error("termGraceMs must be a non-negative finite number");
  const env: NodeJS.ProcessEnv = { ...(requestedEnv ?? process.env) };
  const ownerToken = process.env[OWNER_TOKEN_ENV];
  if (ownerToken !== undefined) env[OWNER_TOKEN_ENV] = ownerToken;
  const detached = process.platform !== "win32";
  const child = spawn(command, [...args], { ...spawnOptions, env, detached });
  if (!child.pid) {
    child.kill();
    throw new Error(`Could not start owned process: ${command}`);
  }

  let cleanupPromise: Promise<OwnedProcessCleanup> | undefined;
  const owned: OwnedProcess = {
    child,
    pid: child.pid,
    dispose(): Promise<OwnedProcessCleanup> {
      cleanupPromise ??= disposeOwnedProcess(owned, termGraceMs).finally(() => registered.delete(owned));
      return cleanupPromise;
    },
  };
  // Keep the handle registered even if the root exits: a detached descendant
  // can retain the process group and still needs prompt group cleanup.
  registered.add(owned);
  return owned;
}

export function ownedProcessCount(): number {
  return registered.size;
}

export async function disposeAllOwnedProcesses(): Promise<void> {
  const failures: unknown[] = [];
  for (const owned of [...registered].reverse()) {
    try {
      await owned.dispose();
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length > 0) throw new AggregateError(failures, "Failed to dispose one or more owned test processes");
}

async function disposeOwnedProcess(owned: OwnedProcess, termGraceMs: number): Promise<OwnedProcessCleanup> {
  const cleanup: OwnedProcessCleanup = { termSent: false, killSent: false, outcome: "already-exited" };
  if (!processTreeExists(owned)) return cleanup;

  cleanup.termSent = signalProcessTree(owned, "SIGTERM");
  if (await waitForProcessTreeExit(owned, termGraceMs)) {
    cleanup.outcome = cleanup.termSent ? "terminated" : "already-exited";
    return cleanup;
  }

  cleanup.killSent = signalProcessTree(owned, "SIGKILL");
  if (await waitForProcessTreeExit(owned, termGraceMs)) {
    cleanup.outcome = cleanup.killSent ? "killed" : "already-exited";
    return cleanup;
  }

  cleanup.outcome = "survived";
  return cleanup;
}

function processTreeExists(owned: OwnedProcess): boolean {
  if (process.platform === "win32") return owned.child.exitCode === null && owned.child.signalCode === null;
  try {
    process.kill(-owned.pid, 0);
    return true;
  } catch (error: any) {
    if (error?.code === "ESRCH") return false;
    // Darwin can retain a group containing only zombies until they are reaped.
    // EPERM still means the group exists; keep polling within the cleanup bound.
    if (error?.code === "EPERM") return true;
    throw error;
  }
}

function signalProcessTree(owned: OwnedProcess, signal: NodeJS.Signals): boolean {
  if (!processTreeExists(owned)) return false;
  try {
    if (process.platform === "win32") return owned.child.kill(signal);
    process.kill(-owned.pid, signal);
    return true;
  } catch (error: any) {
    if (error?.code === "ESRCH") return false;
    throw error;
  }
}

async function waitForProcessTreeExit(owned: OwnedProcess, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (processTreeExists(owned)) {
    if (Date.now() >= deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, Math.min(25, Math.max(1, deadline - Date.now()))));
  }
  return true;
}

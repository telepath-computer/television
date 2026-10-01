import { spawn } from "node:child_process";
import process from "node:process";
import { normalizeProcessLeak } from "./timing-events.mjs";
import {
  OWNER_TOKEN_ENV,
  encodeOwnerToken,
  processIdentityMatches,
  readLinuxListeners,
  readLinuxProcess,
  readMacOSListeners,
  readMacOSProcesses,
  scanLinuxProcesses,
} from "./process-lifecycle.mjs";

export const TEST_PROCESS_TERM_GRACE_MS = 2_000;

const activeSupervisors = new Set();
let handlingSignal = false;
let signalHandlersInstalled = false;

export function createSurfaceSupervisor(options) {
  return new SurfaceSupervisor(options);
}

export function isReportableProcessLeakCleanup(cleanup) {
  return cleanup.outcome !== "already-exited" || cleanup.termSent || cleanup.killSent;
}

export class UnconfirmedSurfaceCleanupError extends Error {
  constructor(processLeaks, remainingCount) {
    super(`Surface cleanup could not confirm an empty owner scan; ${remainingCount} token-bearing process(es) remain`);
    this.name = "UnconfirmedSurfaceCleanupError";
    this.processLeaks = processLeaks;
  }
}

export class SurfaceSupervisor {
  constructor({ runId, surfaceIds, termGraceMs = TEST_PROCESS_TERM_GRACE_MS } = {}) {
    if (process.platform !== "linux" && process.platform !== "darwin") throw new Error(`Surface process ownership is unsupported on ${process.platform}`);
    if (typeof runId !== "string" || !runId) throw new TypeError("Surface supervisor requires a runId");
    if (!Array.isArray(surfaceIds) || surfaceIds.length === 0 || surfaceIds.some((id) => typeof id !== "string" || !id)) throw new TypeError("Surface supervisor requires non-empty surfaceIds");
    if (!Number.isSafeInteger(termGraceMs) || termGraceMs < 0) throw new TypeError("termGraceMs must be a non-negative integer");
    this.runId = runId;
    this.surfaceIds = [...new Set(surfaceIds)].sort();
    this.termGraceMs = termGraceMs;
    const supervisor = readCurrentProcess();
    this.ownerToken = encodeOwnerToken({
      runId,
      surfaceId: this.surfaceIds.join(","),
      supervisorPid: supervisor.pid,
      supervisorStartTime: supervisor.startTime,
    });
    this.activeRoots = new Map();
    this.processLeaks = [];
    this.closed = false;
    this.finishPromise = null;
    activeSupervisors.add(this);
    installSignalHandlers();
  }

  childEnv(env = process.env) {
    return { ...env, [OWNER_TOKEN_ENV]: this.ownerToken };
  }

  run(command, args = [], {
    cwd = process.cwd(),
    env = process.env,
    stdio = "pipe",
    onStdout,
    onStderr,
  } = {}) {
    if (this.closed) throw new Error("Surface supervisor is closed");
    return new Promise((resolve) => {
      const child = spawn(command, args, {
        cwd,
        env: this.childEnv(env),
        detached: true,
        stdio: stdio === "inherit" ? "inherit" : ["ignore", "pipe", "pipe"],
      });
      const root = { pid: child.pid, child };
      if (child.pid) this.activeRoots.set(child.pid, root);
      if (stdio !== "inherit") {
        child.stdout?.on("data", (chunk) => onStdout?.(chunk));
        child.stderr?.on("data", (chunk) => onStderr?.(chunk));
      }
      let settled = false;
      const finish = (result) => {
        if (settled) return;
        settled = true;
        if (child.pid) this.activeRoots.delete(child.pid);
        resolve({ pid: child.pid ?? null, ...result });
      };
      child.once("error", (error) => finish({ exitCode: 127, signal: null, error }));
      child.once("exit", (exitCode, signal) => finish({ exitCode: exitCode ?? 128, signal, error: null }));
    });
  }

  async checkForLeaks() {
    if (this.closed) return this.processLeaks;
    try {
      const found = await this.captureAndReapOwnedProcesses();
      this.processLeaks.push(...found);
      return found;
    } catch (error) {
      if (Array.isArray(error?.processLeaks)) this.processLeaks.push(...error.processLeaks);
      throw error;
    }
  }

  async finish() {
    if (this.finishPromise) return this.finishPromise;
    this.finishPromise = this.finishOnce();
    return this.finishPromise;
  }

  async finishOnce() {
    try {
      await this.stopActiveRoots();
      await this.checkForLeaks();
      this.closed = true;
      return this.processLeaks;
    } finally {
      activeSupervisors.delete(this);
      uninstallSignalHandlersWhenIdle();
    }
  }

  async stopActiveRoots() {
    const roots = [...this.activeRoots.values()];
    for (const root of roots) signalGroup(root.pid, "SIGTERM");
    if (roots.length === 0) return;
    const deadline = Date.now() + this.termGraceMs;
    while (this.activeRoots.size > 0 && Date.now() < deadline) await delay(20);
    // Any root or descendant still carrying the token is captured below before
    // the final KILL. Do not group-KILL here or the leak record would be lost.
  }

  async captureAndReapOwnedProcesses() {
    const states = new Map();
    for (let round = 0; round < 3; round += 1) {
      const owned = scanOwnedProcesses(this.ownerToken);
      for (const processInfo of owned) {
        const key = identityKey(processInfo);
        if (!states.has(key)) states.set(key, captureState(processInfo, this));
      }
      const pending = [...states.values()].filter((state) => state.cleanup.outcome === "unknown");
      if (pending.length === 0) break;

      const beforeTerm = currentMatchingProcesses(pending, this.ownerToken);
      for (const state of pending) {
        const current = beforeTerm.get(identityKey(state.process));
        if (!current) {
          state.cleanup.outcome = "already-exited";
          continue;
        }
        if (signalProcess(current, "SIGTERM", this.ownerToken)) state.cleanup.termSent = true;
      }

      const termSurvivors = await waitForSurvivors(pending, this.ownerToken, this.termGraceMs);
      for (const state of pending) {
        if (state.cleanup.outcome !== "unknown") continue;
        if (!termSurvivors.has(identityKey(state.process))) {
          state.cleanup.outcome = state.cleanup.termSent ? "terminated" : "already-exited";
          continue;
        }
        const current = termSurvivors.get(identityKey(state.process));
        if (signalProcess(current, "SIGKILL", this.ownerToken)) state.cleanup.killSent = true;
      }

      const killSurvivors = await waitForSurvivors(pending, this.ownerToken, this.termGraceMs);
      for (const state of pending) {
        if (state.cleanup.outcome !== "unknown") continue;
        state.cleanup.outcome = killSurvivors.has(identityKey(state.process)) ? "survived" : state.cleanup.killSent ? "killed" : "already-exited";
      }

      const remaining = scanOwnedProcesses(this.ownerToken);
      const unseen = remaining.some((entry) => !states.has(identityKey(entry)));
      if (!unseen) break;
    }

    const finalOwned = new Map(scanOwnedProcesses(this.ownerToken).map((entry) => [identityKey(entry), entry]));
    for (const processInfo of finalOwned.values()) {
      const key = identityKey(processInfo);
      if (!states.has(key)) states.set(key, captureState(processInfo, this));
    }
    for (const state of states.values()) {
      if (finalOwned.has(identityKey(state.process))) state.cleanup.outcome = "survived";
    }
    for (const processInfo of finalOwned.values()) {
      try {
        if (signalProcess(processInfo, "SIGKILL", this.ownerToken)) states.get(identityKey(processInfo)).cleanup.killSent = true;
      } catch {}
    }
    const leaks = [...states.values()]
      .filter((state) => isReportableProcessLeakCleanup(state.cleanup))
      .map((state) => normalizeProcessLeak({ ...state.record, cleanup: state.cleanup }))
      .sort((left, right) => left.leakId.localeCompare(right.leakId));
    if (finalOwned.size > 0) throw new UnconfirmedSurfaceCleanupError(leaks, finalOwned.size);
    return leaks;
  }
}

function captureState(processInfo, supervisor) {
  const listeners = readListeners().filter((listener) => listener.pid === processInfo.pid);
  return {
    process: processInfo,
    record: {
      ownerToken: supervisor.ownerToken,
      owningSurfaceIds: supervisor.surfaceIds,
      pid: processInfo.pid,
      parentPid: processInfo.ppid > 0 ? processInfo.ppid : null,
      processGroupId: Number.isInteger(processInfo.pgid) ? processInfo.pgid : null,
      processStartedAt: processInfo.processStartedAt,
      detectedAt: new Date().toISOString(),
      command: processInfo.executable,
      listeningSockets: listeners.map((listener) => ({
        protocol: "tcp",
        family: listener.address.includes(":") ? "ipv6" : /^\d+(?:\.\d+){3}$/.test(listener.address) ? "ipv4" : "unknown",
        host: listener.address,
        port: listener.port,
      })),
    },
    cleanup: { termSent: false, killSent: false, outcome: "unknown" },
  };
}

function readCurrentProcess() {
  if (process.platform === "linux") return readLinuxProcess(process.pid);
  const current = readMacOSProcesses().find((entry) => entry.pid === process.pid);
  if (!current) throw new Error(`ps did not report surface supervisor PID ${process.pid}`);
  return current;
}

function scanProcesses() {
  return process.platform === "linux" ? scanLinuxProcesses() : readMacOSProcesses();
}

function readListeners() {
  return process.platform === "linux" ? readLinuxListeners() : readMacOSListeners();
}

function scanOwnedProcesses(token) {
  return scanProcesses().filter((entry) => entry.ownerToken === token);
}

function currentMatchingProcesses(states, token) {
  const current = new Map(scanOwnedProcesses(token).map((entry) => [identityKey(entry), entry]));
  return new Map(states.flatMap((state) => {
    const match = current.get(identityKey(state.process));
    return match && processIdentityMatches(match, state.process) ? [[identityKey(state.process), match]] : [];
  }));
}

async function waitForSurvivors(states, token, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let survivors = currentMatchingProcesses(states, token);
  while (survivors.size > 0 && Date.now() < deadline) {
    await delay(20);
    survivors = currentMatchingProcesses(states, token);
  }
  return survivors;
}

function signalProcess(processInfo, signal, token) {
  const current = scanOwnedProcesses(token).find((entry) => processIdentityMatches(entry, processInfo));
  if (!current || current.ownerToken !== token) return false;
  try {
    process.kill(current.pid, signal);
    return true;
  } catch (error) {
    if (error?.code === "ESRCH") return false;
    throw error;
  }
}

function signalGroup(pid, signal) {
  if (!pid) return;
  try {
    process.kill(-pid, signal);
  } catch (error) {
    if (error?.code !== "ESRCH") throw error;
  }
}

function identityKey(processInfo) {
  return `${processInfo.pid}:${processInfo.startTime}`;
}

function installSignalHandlers() {
  if (signalHandlersInstalled) return;
  process.on("SIGINT", onSigint);
  process.on("SIGTERM", onSigterm);
  signalHandlersInstalled = true;
}

function uninstallSignalHandlersWhenIdle() {
  if (activeSupervisors.size > 0 || !signalHandlersInstalled || handlingSignal) return;
  process.off("SIGINT", onSigint);
  process.off("SIGTERM", onSigterm);
  signalHandlersInstalled = false;
}

function onSigint() {
  void handleSignal("SIGINT", 130);
}

function onSigterm() {
  void handleSignal("SIGTERM", 143);
}

async function handleSignal(signal, exitCode) {
  if (handlingSignal) return;
  handlingSignal = true;
  try {
    await Promise.all([...activeSupervisors].map((supervisor) => supervisor.finish()));
  } catch (error) {
    console.error(`Surface cleanup after ${signal} failed: ${error.stack ?? error.message ?? error}`);
  } finally {
    process.exit(exitCode);
  }
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

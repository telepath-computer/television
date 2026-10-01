import process from "node:process";
import { normalizeProcessLeak } from "./timing-events.mjs";
import {
  classifyOwnedProcesses,
  processIdentityMatches,
  readLinuxListeners,
  readLinuxProcess,
  readMacOSListeners,
  readMacOSProcesses,
  scanLinuxProcesses,
} from "./process-lifecycle.mjs";
import { TEST_PROCESS_TERM_GRACE_MS } from "./surface-supervisor.mjs";

const MAX_REAP_ROUNDS = 3;

export async function reapStaleOwnerProcesses({
  termGraceMs = TEST_PROCESS_TERM_GRACE_MS,
  maxRounds = MAX_REAP_ROUNDS,
} = {}) {
  if (!Number.isSafeInteger(termGraceMs) || termGraceMs < 0) throw new TypeError("termGraceMs must be a non-negative integer");
  if (!Number.isSafeInteger(maxRounds) || maxRounds < 1) throw new TypeError("maxRounds must be a positive integer");

  const initial = classifyOwnedProcesses(scanProcesses());
  const liveOwners = initial.filter((entry) => entry.supervisorStatus === "live").map(ownerObservation);
  const states = new Map();
  for (const entry of initial.filter((candidate) => candidate.supervisorStatus === "stale")) addState(states, entry);
  let staleDetected = states.size > 0;

  for (let round = 0; round < maxRounds && states.size > 0; round += 1) {
    const pending = [...states.values()].filter((state) => state.cleanup.outcome === "unknown");
    if (pending.length > 0) {
      const termSignaled = signalRevalidatedStates(pending, "SIGTERM");
      for (const state of pending) if (termSignaled.has(identityKey(state.process))) state.cleanup.termSent = true;
      const termSurvivors = await waitForStaleSurvivors(pending, termGraceMs);
      for (const state of pending) {
        const key = identityKey(state.process);
        if (!termSurvivors.has(key)) {
          state.cleanup.outcome = state.cleanup.termSent ? "terminated" : "already-exited";
          continue;
        }
        const killSignaled = signalRevalidatedStates([state], "SIGKILL");
        if (killSignaled.has(key)) state.cleanup.killSent = true;
      }
      const killSurvivors = await waitForStaleSurvivors(pending, termGraceMs);
      for (const state of pending) {
        if (state.cleanup.outcome !== "unknown") continue;
        state.cleanup.outcome = killSurvivors.has(identityKey(state.process)) ? "survived" : state.cleanup.killSent ? "killed" : "already-exited";
      }
    }

    const remaining = staleClassifications();
    let unseen = false;
    for (const entry of remaining) unseen = addState(states, entry) || unseen;
    if (unseen) staleDetected = true;
    if (!unseen) break;
  }

  let finalStale = staleClassifications();
  for (const entry of finalStale) if (addState(states, entry)) staleDetected = true;
  for (const entry of finalStale) states.get(identityKey(entry.process)).cleanup.outcome = "survived";

  // A dying owner can expose one last inherited child after the bounded rounds.
  // Make one best-effort KILL pass, then fail closed if the confirming scan is nonempty.
  const finalKillSignaled = signalRevalidatedStates(finalStale.map((entry) => states.get(identityKey(entry.process))), "SIGKILL");
  for (const key of finalKillSignaled) states.get(key).cleanup.killSent = true;
  if (finalStale.length > 0) await waitForStaleSurvivors(finalStale.map((entry) => states.get(identityKey(entry.process))), termGraceMs);
  finalStale = staleClassifications();
  for (const entry of finalStale) {
    if (addState(states, entry)) staleDetected = true;
    states.get(identityKey(entry.process)).cleanup.outcome = "survived";
  }
  const lastKillSignaled = signalRevalidatedStates(finalStale.map((entry) => states.get(identityKey(entry.process))), "SIGKILL");
  for (const key of lastKillSignaled) states.get(key).cleanup.killSent = true;
  const finalKeys = new Set(finalStale.map((entry) => identityKey(entry.process)));
  for (const state of states.values()) {
    if (state.cleanup.outcome !== "survived" || finalKeys.has(identityKey(state.process))) continue;
    state.cleanup.outcome = state.cleanup.killSent ? "killed" : "already-exited";
  }

  const processLeaks = [...states.values()]
    .map((state) => normalizeProcessLeak({ ...state.record, cleanup: state.cleanup }))
    .sort((left, right) => left.leakId.localeCompare(right.leakId));
  const cleanupConfirmed = finalStale.length === 0;
  const staleDetails = processLeaks.map((leak) => `${leak.owningSurfaceIds.join(",")} pid=${leak.pid}`).join("; ");
  return {
    staleDetected,
    cleanupConfirmed,
    liveOwners,
    processLeaks,
    remainingStaleOwners: finalStale.map(ownerObservation),
    message: staleDetected
      ? cleanupConfirmed
        ? `Detected and reaped ${processLeaks.length} stale owner process(es) (${staleDetails}); selected surfaces were not started.`
        : `Stale owner cleanup remained contaminated by ${finalStale.length} process(es) (${staleDetails}); selected surfaces were not started.`
      : liveOwners.length > 0
        ? `Left ${liveOwners.length} process(es) with live matching supervisors untouched.`
        : "No live or stale owner-token processes were present.",
  };
}

function addState(states, classification) {
  const key = identityKey(classification.process);
  if (states.has(key)) return false;
  const listeners = readListeners().filter((listener) => listener.pid === classification.process.pid);
  states.set(key, {
    process: classification.process,
    token: classification.token,
    record: {
      ownerToken: classification.token,
      owningSurfaceIds: classification.owner.surfaceId.split(",").filter(Boolean),
      pid: classification.process.pid,
      parentPid: classification.process.ppid > 0 ? classification.process.ppid : null,
      processGroupId: Number.isInteger(classification.process.pgid) ? classification.process.pgid : null,
      processStartedAt: classification.process.processStartedAt,
      detectedAt: new Date().toISOString(),
      command: classification.process.executable,
      listeningSockets: listeners.map((listener) => ({
        protocol: "tcp",
        family: listener.address.includes(":") ? "ipv6" : /^\d+(?:\.\d+){3}$/.test(listener.address) ? "ipv4" : "unknown",
        host: listener.address,
        port: listener.port,
      })),
    },
    cleanup: { termSent: false, killSent: false, outcome: "unknown" },
  });
  return true;
}

function signalRevalidatedStates(states, signal) {
  const signaled = new Set();
  const remaining = new Map(states.map((state) => [identityKey(state.process), state]));
  while (remaining.size > 0) {
    const expected = remaining.values().next().value;
    const snapshot = classifyOwnedProcesses(scanProcesses());
    const current = snapshot.find((entry) =>
      entry.supervisorStatus === "stale" &&
      entry.token === expected.token &&
      processIdentityMatches(entry.process, expected.process));
    remaining.delete(identityKey(expected.process));
    if (!current) continue;

    const liveGroups = new Set(snapshot.filter((entry) => entry.supervisorStatus === "live").map((entry) => entry.process.pgid));
    const currentProcess = scanProcesses().find((entry) => entry.pid === process.pid);
    const canSignalGroup = Number.isSafeInteger(current.process.pgid) && current.process.pgid > 1 &&
      current.process.pgid !== currentProcess?.pgid && !liveGroups.has(current.process.pgid);
    const groupStates = canSignalGroup
      ? [...remaining.values(), expected].filter((state) => state.process.pgid === current.process.pgid)
      : [expected];
    try {
      process.kill(canSignalGroup ? -current.process.pgid : current.process.pid, signal);
      for (const state of groupStates) {
        const key = identityKey(state.process);
        signaled.add(key);
        remaining.delete(key);
      }
    } catch (error) {
      if (error?.code !== "ESRCH") throw error;
    }
  }
  return signaled;
}

async function waitForStaleSurvivors(states, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let survivors = currentStaleMatches(states);
  while (survivors.size > 0 && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 20));
    survivors = currentStaleMatches(states);
  }
  return survivors;
}

function currentStaleMatches(states) {
  const current = staleClassifications();
  return new Map(states.flatMap((state) => {
    const match = current.find((entry) => entry.token === state.token && processIdentityMatches(entry.process, state.process));
    return match ? [[identityKey(state.process), match]] : [];
  }));
}

function staleClassifications() {
  return classifyOwnedProcesses(scanProcesses()).filter((entry) => entry.supervisorStatus === "stale");
}

function ownerObservation(entry) {
  return {
    token: entry.token,
    owner: entry.owner,
    supervisorStatus: entry.supervisorStatus,
    process: {
      pid: entry.process.pid,
      ppid: entry.process.ppid,
      pgid: entry.process.pgid,
      startTime: entry.process.startTime,
      processStartedAt: entry.process.processStartedAt,
      executable: entry.process.executable,
      command: entry.process.command,
    },
  };
}

function scanProcesses() {
  if (process.platform === "linux") return scanLinuxProcesses();
  if (process.platform === "darwin") return readMacOSProcesses();
  throw new Error(`Unsupported platform ${process.platform}; stale owner cleanup requires Linux or macOS process inspection`);
}

function readListeners() {
  return process.platform === "linux" ? readLinuxListeners() : readMacOSListeners();
}

function identityKey(processInfo) {
  return `${processInfo.pid}:${processInfo.startTime}`;
}

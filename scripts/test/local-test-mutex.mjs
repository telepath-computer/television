import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { decodeOwnerToken, processIdentityMatches, readLinuxProcess, readMacOSProcesses, scanLinuxProcesses } from "./process-lifecycle.mjs";
import { reapStaleOwnerProcesses } from "./stale-owner-reaper.mjs";

export const CONTENTION_BYPASS = "against-test-guidance-major-host-contention-and-oom-killed-processes";
export const MUTEX_WAIT = "wait-for-local-test-mutex";
const VERIFY_HANDOFF = "TV_TEST_RUNNER_VERIFY_MUTEX";

export function localTestMutexPath() {
  if (process.env.TV_TEST_RUNNER_LOCK_PATH) {
    if (process.env.TV_TEST_RUNNER_SELFTEST !== "1") throw new Error("TV_TEST_RUNNER_LOCK_PATH requires TV_TEST_RUNNER_SELFTEST=1.");
    console.error("WARNING: TV_TEST_RUNNER_LOCK_PATH self-test seam substitutes a private local-test mutex location.");
    return path.resolve(process.env.TV_TEST_RUNNER_LOCK_PATH);
  }
  // userInfo reads the operating-system account, independent of HOME/TMPDIR.
  return path.join(os.userInfo().homedir, ".cache/television/local-test-mutex.sqlite3");
}

export function validateMutexOptions(options) {
  if (options[MUTEX_WAIT] && options[CONTENTION_BYPASS]) throw new Error(`--${MUTEX_WAIT} and --${CONTENTION_BYPASS} cannot be combined.`);
}

// Stable on-disk contract: one row (slot 1), containing version 1 JSON.
// SQLite supplies atomic compare-and-swap across processes and releases its
// brief write locks after crashes. No transaction spans test execution.
export async function acquireLocalTestMutex({ lockPath, options, role = "run", marked = false }) {
  const { DatabaseSync } = await import("node:sqlite");
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  const db = new DatabaseSync(lockPath);
  db.exec("PRAGMA busy_timeout=1000; CREATE TABLE IF NOT EXISTS local_test_mutex (slot INTEGER PRIMARY KEY CHECK(slot=1), record TEXT NOT NULL)");
  const mine = { ...identity(process.pid), command: process.argv.join(" "), checkout: process.cwd(), role };
  const fresh = { version: 1, id: crypto.randomUUID(), participants: [mine] };
  const handoff = process.env[VERIFY_HANDOFF];
  delete process.env[VERIFY_HANDOFF];
  let waitingFor = null;
  let interrupted = 0;
  const int = () => { interrupted = 130; };
  const term = () => { interrupted = 143; };
  process.on("SIGINT", int); process.on("SIGTERM", term);
  const read = () => db.prepare("SELECT record FROM local_test_mutex WHERE slot=1").get()?.record;
  const replace = (before, after) => db.prepare("UPDATE local_test_mutex SET record=? WHERE slot=1 AND record=?").run(JSON.stringify(after), before).changes === 1;
  try {
    for (;;) {
      if (interrupted) throw Object.assign(new Error("Local-test mutex wait cancelled."), { exitCode: interrupted });
      const before = read();
      if (!before) {
        if (db.prepare("INSERT OR IGNORE INTO local_test_mutex(slot,record) VALUES(1,?)").run(JSON.stringify(fresh)).changes === 1) return ownership(fresh.id);
        continue;
      }
      const holder = parseRecord(before);
      // Only verify's directly spawned test child receives this handoff. It
      // consumes the signal; descendants and unrelated invocations contend.
      if (handoff === holder.id && holder.participants.some(p => p.role === "verify" && p.pid === process.ppid && isLive(p))) {
        if (replace(before, { ...holder, participants: [...holder.participants, mine] })) return ownership(holder.id);
        continue;
      }
      if (!holder.participants.some(isLive)) {
        const recovering = { ...fresh, participants: [...fresh.participants, ...holder.participants] };
        if (!replace(before, recovering)) continue;
        const held = ownership(fresh.id);
        try {
          const recovery = await reapStaleOwnerProcesses();
          if (recovery.staleDetected || !recovery.cleanupConfirmed) throw Object.assign(new Error(`[local-test mutex] ${recovery.message}`), { exitCode: 1 });
          if (interrupted) throw Object.assign(new Error("Local-test mutex wait cancelled."), { exitCode: interrupted });
          replace(JSON.stringify(recovering), fresh);
          return held;
        } catch (error) { held.release({ retain: true }); throw error; }
      }
      if (options[CONTENTION_BYPASS]) {
        console.error(`${describe(holder)} Deliberately running concurrently: major host contention and OOM-killed processes are possible.`);
        db.close();
        return { childEnv: () => ({}), release() {} };
      }
      if (!options[MUTEX_WAIT]) throw new Error(`${describe(holder)} Try after this run finishes, or use --${MUTEX_WAIT}.${marked ? " For broader work, commit and push, then use Blaxel." : " Blaxel is optional if you have access."} Do not stop another agent's run to free the mutex. --${CONTENTION_BYPASS} deliberately permits major host contention and OOM-killed processes.`);
      if (waitingFor !== holder.id) {
        console.error(`Waiting for local-test mutex. ${describe(holder)} Interrupt this wait with Ctrl-C (SIGINT) or SIGTERM; the holder keeps running.`);
        waitingFor = holder.id;
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  } catch (error) { if (db.isOpen) db.close(); throw error; }
  finally { process.off("SIGINT", int); process.off("SIGTERM", term); }

  function ownership(id) {
    let released = false;
    return {
      childEnv: () => ({ [VERIFY_HANDOFF]: id }),
      release({ retain = false } = {}) {
        if (released) return;
        released = true;
        try {
          if (retain) return;
          // Keep the record for recovery if an unhandled exit leaves children.
          if (scanProcesses().some(p => {
            const owner = decodeOwnerToken(p.ownerToken);
            return owner?.supervisorPid === mine.pid && owner.supervisorStartTime === mine.startTime;
          })) return;
          for (;;) {
            const before = read();
            if (!before) return;
            const holder = parseRecord(before);
            if (holder.id !== id) return;
            const participants = holder.participants.filter(p => !processIdentityMatches(p, mine));
            if (participants.length ? replace(before, { ...holder, participants }) : db.prepare("DELETE FROM local_test_mutex WHERE slot=1 AND record=?").run(before).changes === 1) return;
          }
        } finally { db.close(); }
      },
    };
  }
}

function parseRecord(text) {
  const record = JSON.parse(text);
  if (record.version !== 1 || typeof record.id !== "string" || !Array.isArray(record.participants) || !record.participants.length) throw new Error("Unsupported local-test mutex ownership record; keep this file for diagnosis.");
  return record;
}

function identity(pid) {
  const found = process.platform === "linux" ? readLinuxProcess(pid) : readMacOSProcesses().find(p => p.pid === pid);
  if (!found || found.state === "Z") throw Object.assign(new Error(`No live process identity for PID ${pid}`), { code: "ESRCH" });
  return { pid: found.pid, startTime: found.startTime };
}

function isLive(expected) {
  try { return processIdentityMatches(identity(expected.pid), expected); }
  catch (error) { if (["ENOENT", "ESRCH"].includes(error.code)) return false; throw error; }
}

function scanProcesses() { return process.platform === "linux" ? scanLinuxProcesses() : readMacOSProcesses(); }
function describe(holder) { return `Local-test mutex held by ${holder.participants.map(p => `PID ${p.pid} (start ${p.startTime}), ${p.command}, checkout ${p.checkout}`).join("; ")}.`; }

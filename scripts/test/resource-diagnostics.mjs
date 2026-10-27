import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { normalizeSurfaceResult } from "./reporting.mjs";

export const RESOURCE_SIDECAR_BYTES = 128 * 1024;
export const RESOURCE_ATTEMPT_BYTES = 8 * 1024 * 1024;
const KERNEL_BYTES = 64 * 1024;
const COMPACT_RESERVE_BYTES = 8 * 1024;
const probes = {
  memoryAvailable: { unit: "bytes", source: "/proc/meminfo:MemAvailable" },
  sharedMemoryUsed: { unit: "bytes", source: "/proc/meminfo:Shmem" },
  temporaryFree: { unit: "bytes", source: "statfs" },
  oomKills: { unit: "count", source: "/proc/vmstat:oom_kill" },
};
const warnDefault = (message) => console.error(`[resource diagnostics] ${message}`);

/** Shared by planned tasks and the targeted surface parent, never the native child. */
export function surfaceResourceDiagnostics({ resultsDir, surfaceId, env = process.env, runId }) {
  if (env.TV_TEST_TIMING_PROVIDER !== "blaxel-playwright-x64-4vcpu") return { file: null, finish: () => [] };
  return startResourceDiagnostics({ root: resultsDir, identity: {
    runId: env.TV_TEST_RUN_ID ?? runId,
    shardIndex: Number(env.TV_TEST_SHARD_INDEX ?? "1"),
    attemptId: env.TV_TEST_SHARD_ATTEMPT ?? "unavailable",
    surfaceId,
  } });
}

export function startResourceDiagnostics({ root, identity, readProbe = readLinuxResourceProbe, now = () => new Date(), write, warn = warnDefault }) {
  const name = `surface-${randomUUID()}`;
  const tmpdir = os.tmpdir();
  const start = observe(readProbe, now, tmpdir, warn);
  const record = {
    kind: "surface", identity: cleanIdentity(identity), start,
    end: { status: "missing", reason: "parent-did-not-finalize" },
    nativeEvidence: { status: "pending", failedAttempt: null, recovered: null },
    oomDelta: { value: null, unit: "count", reason: "missing-final-observation" },
    kernel: { status: "not-requested", reason: "parent-did-not-finalize" },
  };
  let file = writeResourceDiagnostic(root, name, record, { write, warn });
  return {
    get file() { return file; },
    finish(outcome) {
      try {
        record.end = observe(readProbe, now, tmpdir, warn);
        record.oomDelta = counterDelta(start.oomKills, record.end.oomKills);
        record.nativeEvidence = nativeEvidence(outcome, path.join(root, "resources"), warn);
        if (outcome.exitCode !== 0 || outcome.incomplete || record.nativeEvidence.status !== "complete" || record.nativeEvidence.failedAttempt) {
          const interval = { since: start.observedAt, until: record.end.observedAt };
          try { record.kernel = cleanKernel(readProbe("kernelOOM", interval)); }
          catch (error) { record.kernel = { status: "unavailable", reason: errorCode(error) }; warn(`kernel evidence unavailable: ${errorCode(error)}`); }
        } else record.kernel = { status: "not-requested", reason: "no-failed-native-attempt" };
        file = writeResourceDiagnostic(root, name, record, { write, warn }) ?? file;
      } catch (error) { warn(`final observation unavailable: ${errorCode(error)}`); }
      return file && fs.existsSync(file) ? [file] : [];
    },
  };
}

function observe(readProbe, now, tmpdir, warn) {
  const observedAt = now().toISOString();
  const sample = { status: "observed", observedAt };
  for (const [name, metadata] of Object.entries(probes)) {
    const value = { ...metadata, observedAt, ...(name === "temporaryFree" ? { path: tmpdir } : {}) };
    try {
      const reading = readProbe(name, { tmpdir });
      if (!Number.isSafeInteger(reading) || reading < 0) throw new Error("Invalid numeric probe");
      sample[name] = { ...value, value: reading };
    } catch (error) {
      sample[name] = { ...value, value: null, reason: errorCode(error) };
      warn(`${name} unavailable: ${errorCode(error)}`);
    }
  }
  return sample;
}

export function readLinuxResourceProbe(name, options = {}) {
  if (process.platform !== "linux") throw Object.assign(new Error("Linux required"), { code: "ENOTSUP" });
  if (name === "temporaryFree") {
    const stats = fs.statfsSync(options.tmpdir ?? os.tmpdir());
    return stats.bavail * stats.bsize;
  }
  if (name === "kernelOOM") {
    // Calendar bounds work with the worker's util-linux/libc time parser;
    // explicit UTC prevents local-time interpretation of our ISO observations.
    const calendar = (value) => new Date(value).toISOString().slice(0, -1).replace("T", " ");
    const result = spawnSync("dmesg", ["--kernel", "--time-format", "iso", "--since", calendar(options.since), "--until", calendar(options.until)], { encoding: "utf8", env: { ...process.env, TZ: "UTC", LC_ALL: "C" }, timeout: 2000, maxBuffer: 128 * 1024 });
    const truncated = result.error?.code === "ENOBUFS";
    if (!truncated && (result.error || result.status !== 0)) {
      const permissionCode = /operation not permitted/i.test(result.stderr ?? "") ? "EPERM" : /permission denied/i.test(result.stderr ?? "") ? "EACCES" : "unavailable";
      throw Object.assign(new Error("Kernel log unavailable"), { code: result.error?.code ?? permissionCode });
    }
    return { lines: (result.stdout ?? "").split("\n"), truncated };
  }
  const file = name === "oomKills" ? "/proc/vmstat" : "/proc/meminfo";
  const key = name === "oomKills" ? "oom_kill" : name === "memoryAvailable" ? "MemAvailable:" : "Shmem:";
  const line = fs.readFileSync(file, "utf8").split("\n").find((line) => line.startsWith(`${key} `));
  if (!line) throw Object.assign(new Error("Counter unavailable"), { code: "ENOENT" });
  return Number(line.trim().split(/\s+/)[1]) * (name === "oomKills" ? 1 : 1024);
}

function counterDelta(start, end) {
  if (start.value === null || end.value === null) return { value: null, unit: "count", reason: "unavailable" };
  if (end.value < start.value) return { value: null, unit: "count", reason: "counter-reset" };
  return { value: end.value - start.value, unit: "count" };
}

function nativeEvidence(outcome, diagnosticDir, warn) {
  const nativeExists = outcome.nativeResultPath && fs.existsSync(outcome.nativeResultPath);
  const attemptExists = outcome.attemptResultPath && fs.existsSync(outcome.attemptResultPath);
  const references = {
    resultPath: nativeExists ? path.relative(diagnosticDir, outcome.nativeResultPath) : null,
    attemptResultPath: attemptExists ? path.relative(diagnosticDir, outcome.attemptResultPath) : null,
  };
  if (!nativeExists) return { ...references, status: "missing", failedAttempt: null, recovered: null };
  try {
    const native = normalizeSurfaceResult({ surface: { id: "diagnostic", runner: outcome.runner }, command: [], logPath: null, durationMs: 0, ...outcome });
    const attempts = native.files.flatMap((file) => file.attempts ?? []);
    const complete = native.infraStatus !== "incomplete" && native.files.every((file) => file.complete);
    return { ...references, status: complete ? "complete" : "incomplete", failedAttempt: attempts.some((attempt) => ["failed", "timed-out", "interrupted"].includes(attempt.status)) || native.counts.testsFailed > 0, recovered: native.counts.testsFlakyRecovered > 0 };
  } catch (error) {
    warn(`native attempt evidence unavailable: ${errorCode(error)}`);
    return { ...references, status: "incomplete", failedAttempt: null, recovered: null };
  }
}

// Kernel output is not a trusted text channel. Retain only timestamps, executable
// names and numeric OOM fields, never raw messages, paths, arguments or values.
function cleanKernel(input) {
  const lines = [];
  let bytes = 0;
  let omitted = integer(input?.omittedUnrecognizedLines) ?? 0;
  let truncated = Boolean(input?.truncated);
  for (const raw of input?.lines ?? []) {
    const line = String(raw);
    if (!/out of memory|oom[-_ ]kill|killed process/i.test(line)) continue;
    const killed = /Killed process (\d+) \(([A-Za-z0-9_.+-]{1,80})\)/.exec(line);
    if (!killed) { omitted++; continue; }
    const timestamp = /^\d{4}-\d\d-\d\dT[\d:.,+-]+/.exec(line)?.[0];
    const fields = [...line.matchAll(/\b(total-vm|anon-rss|file-rss|shmem-rss|pgtables|UID|oom_score_adj):\s*(-?\d+)(kB)?/g)].map((match) => `${match[1]}:${match[2]}${match[3] ?? ""}`);
    const retained = [timestamp, `Killed process ${killed[1]} (${killed[2]})`, ...fields].filter(Boolean).join(" ");
    const cost = Buffer.byteLength(retained) + (lines.length ? 1 : 0);
    if (bytes + cost > KERNEL_BYTES) { truncated = true; break; }
    lines.push(retained); bytes += cost;
  }
  return { status: "available", lines, truncated, omittedUnrecognizedLines: omitted };
}

/** One budget for surface records and recovery receipts in the current attempt. */
export function writeResourceDiagnostic(root, name, input, { write = atomicWrite, warn = warnDefault } = {}) {
  try {
    if (!/^[A-Za-z0-9_.-]+$/.test(name)) throw new Error("Invalid diagnostic filename");
    const directory = path.resolve(root, "resources");
    fs.mkdirSync(directory, { recursive: true });
    const file = path.join(directory, `${name}.json`);
    // Reserve each baseline's final compact observation before optional excerpts
    // can consume the remaining budget. Parents write sequentially per attempt.
    const otherUsage = fs.readdirSync(directory).filter((entry) => entry.endsWith(".json") && path.join(directory, entry) !== file)
      .reduce((sum, entry) => sum + Math.max(COMPACT_RESERVE_BYTES, fs.statSync(path.join(directory, entry)).size), 0);
    const budget = Math.min(RESOURCE_SIDECAR_BYTES, RESOURCE_ATTEMPT_BYTES - otherUsage);
    if (budget < COMPACT_RESERVE_BYTES) { warn("attempt budget exhausted; diagnostic omitted"); return null; }
    const record = cleanRecord(input);
    let contents = serialize(record);
    if (Buffer.byteLength(contents) > budget) {
      record.truncated = true;
      const field = record.kind === "recovery" ? "processes" : null;
      const values = field ? record[field] : record.kernel?.lines ?? [];
      if (!field && record.kernel) record.kernel.truncated = true;
      let low = 0; let high = values.length;
      while (low < high) {
        const count = Math.ceil((low + high) / 2);
        if (field) record[field] = values.slice(0, count); else if (record.kernel) record.kernel.lines = values.slice(0, count);
        if (Buffer.byteLength(serialize(record)) <= budget) low = count; else high = count - 1;
      }
      if (field) { record[field] = values.slice(0, low); record.omittedProcesses = values.length - low; }
      else if (record.kernel) record.kernel.lines = values.slice(0, low);
      contents = serialize(record);
      // The omission count itself can add a few bytes at the boundary.
      while (Buffer.byteLength(contents) > budget && field && record[field].length) { record[field].pop(); record.omittedProcesses++; contents = serialize(record); }
      warn("diagnostic truncated to its byte budget");
    }
    if (Buffer.byteLength(contents) > budget) { warn("compact diagnostic exceeds its budget; omitted"); return null; }
    write(file, contents);
    return fs.existsSync(file) ? file : null;
  } catch (error) { warn(`diagnostic write failed: ${errorCode(error)}`); return null; }
}

function cleanRecord(input) {
  const base = { schemaVersion: 1, kind: input.kind === "recovery" ? "recovery" : "surface", identity: cleanIdentity(input.identity ?? {}) };
  if (base.kind === "recovery") return {
    ...base,
    previous: select(input.previous, ["runId", "lockId", "worker", "lastRenewal", "recoverAfter"]),
    cleanup: token(input.cleanup), discardedReports: Boolean(input.discardedReports),
    processes: (input.processes ?? []).map((entry) => ({ pid: integer(entry.pid), startTime: token(entry.startTime), command: executable(entry.command), outcome: token(entry.outcome) })),
  };
  return {
    ...base, start: cleanObservation(input.start), end: cleanObservation(input.end),
    oomDelta: select(input.oomDelta, ["value", "unit", "reason"]),
    nativeEvidence: select(input.nativeEvidence, ["status", "failedAttempt", "recovered", "resultPath", "attemptResultPath"]),
    kernel: input.kernel?.status === "available" ? cleanKernel(input.kernel) : select(input.kernel, ["status", "reason"]),
  };
}

function cleanObservation(input) {
  const record = select(input, ["status", "reason", "observedAt"]);
  for (const key of Object.keys(probes)) if (input?.[key]) record[key] = select(input[key], ["value", "unit", "source", "observedAt", "path", "reason"]);
  return record;
}

function cleanIdentity(input) { return { runId: token(input.runId), shardIndex: integer(input.shardIndex), attemptId: token(input.attemptId), surfaceId: token(input.surfaceId) }; }
function token(value) { return typeof value === "string" ? value.replace(/[^a-zA-Z0-9_.:/@+-]/g, "_").slice(0, 256) : null; }
function executable(value) { return typeof value === "string" ? token(path.basename(value).split(/\s/)[0]) : null; }
function integer(value) { return Number.isSafeInteger(value) && value >= 0 ? value : null; }
function select(input, fields) { return Object.fromEntries(fields.filter((key) => input?.[key] !== undefined).map((key) => [key, input[key]])); }
function serialize(value) { return `${JSON.stringify(value)}\n`; }
function errorCode(error) { return ["EACCES", "EPERM", "ENOENT", "ENOSPC", "EROFS", "EIO", "ENOTSUP", "ETIMEDOUT", "ENOBUFS"].includes(error?.code) ? error.code : "unavailable"; }
function atomicWrite(file, contents) {
  const temporary = `${file}.${process.pid}.tmp`;
  try { fs.writeFileSync(temporary, contents); fs.renameSync(temporary, file); }
  finally { fs.rmSync(temporary, { force: true }); }
}

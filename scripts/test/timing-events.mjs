import crypto from "node:crypto";
import path from "node:path";
import { normalizeTimingPhase } from "./phase-metrics.mjs";

const EVENT_STATUSES = new Set(["passed", "failed", "skipped", "timed-out", "interrupted", "not-assigned", "incomplete", "unknown"]);
const FIXED_TIMING_PROVIDERS = new Set([
  "blaxel-playwright-x64-4vcpu",
  "github-ubuntu-24.04-x64-2vcpu-vm",
  "github-playwright-noble-x64-2vcpu",
]);
const LOCAL_TIMING_PROVIDER = /^local-(?:linux|darwin)-(?:x64|arm64)-[1-9][0-9]*cpu$/;
// Must match the persistent worker checkout root owned by
// scripts/run-blaxel-testshards.mjs (shard lifecycle and artifact download).
const REMOTE_WORKSPACE_ROOT = "/workspace/television";

export function canonicalize(value) {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("canonical JSON rejects non-finite numbers");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map((entry) => canonicalize(entry)).join(",")}]`;
  if (typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => {
      const entry = value[key];
      if (entry === undefined) throw new TypeError(`canonical JSON rejects undefined at ${key}`);
      return `${JSON.stringify(key)}:${canonicalize(entry)}`;
    }).join(",")}}`;
  }
  throw new TypeError(`canonical JSON rejects ${typeof value}`);
}

export function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function testIdentity({ surfaceId, path: filePath, project = null, titlePath, line = null, column = null }) {
  return sha256(Buffer.from(canonicalize(["test-id-v1", surfaceId, normalizePath(filePath), project, titlePath, line, column])));
}

export function processLeakIdentity({ ownerToken, pid, processStartedAt }) {
  return sha256(Buffer.from(canonicalize(["process-leak-id-v1", ownerToken, pid, processStartedAt])));
}

export function normalizeProcessLeak(leak) {
  const normalized = {
    leakId: leak.leakId ?? processLeakIdentity(leak),
    ownerToken: requireString(leak.ownerToken, "ownerToken"),
    owningSurfaceIds: sortedUniqueStrings(leak.owningSurfaceIds, "owningSurfaceIds"),
    pid: requirePositiveInteger(leak.pid, "pid"),
    parentPid: leak.parentPid == null ? null : requirePositiveInteger(leak.parentPid, "parentPid"),
    processGroupId: leak.processGroupId == null ? null : requireInteger(leak.processGroupId, "processGroupId"),
    processStartedAt: requireTimestamp(leak.processStartedAt, "processStartedAt"),
    detectedAt: requireTimestamp(leak.detectedAt, "detectedAt"),
    command: executableOnly(leak.command),
    listeningSockets: [...(leak.listeningSockets ?? [])].map(normalizeSocket).sort(compareSockets),
    cleanup: normalizeCleanup(leak.cleanup),
  };
  if (normalized.owningSurfaceIds.length === 0) throw new TypeError("owningSurfaceIds must not be empty");
  const expected = processLeakIdentity(normalized);
  if (normalized.leakId !== expected) throw new TypeError(`leakId does not match canonical identity: ${normalized.leakId}`);
  return normalized;
}

export function validateTimingProvider(value) {
  if (!FIXED_TIMING_PROVIDERS.has(value) && !LOCAL_TIMING_PROVIDER.test(value)) throw new TypeError(`invalid timing provider: ${JSON.stringify(value)}`);
  return value;
}

// Caller contract: each shard's surfaces are already in registry execution
// order. This serializer deliberately preserves that order instead of sorting
// by surface ID (which would hide a planner/runner ordering defect). Duplicate
// surface IDs are rejected below; repository and planner seams assert the
// registry-order input at their ownership boundary.
export function buildTimingEvents({ run, shards }) {
  validateRunInput(run);
  const orderedShards = [...shards].sort((left, right) => left.index - right.index);
  const events = [];
  events.push(compact({
    schemaVersion: 1,
    sequence: 0,
    kind: "run",
    runId: run.runId,
    commandProvider: run.commandProvider ?? null,
    timingProvider: validateTimingProvider(run.timingProvider),
    status: normalizeRunStatus(run.status),
    startedAt: requireTimestamp(run.startedAt, "run.startedAt"),
    completedAt: requireTimestamp(run.completedAt, "run.completedAt"),
    durationMs: duration(run.durationMs, "run.durationMs"),
    selection: run.selection ?? {},
    git: normalizeGit(run.git),
    environment: normalizeEnvironment(run.environment),
    shardPlanId: run.shardPlanId,
    timingBaselineDigest: run.timingBaselineDigest,
    phases: normalizePhases(run.phases ?? []),
  }));

  for (const shard of orderedShards) {
    const shardId = shard.shardId ?? `${run.runId}:${shard.index}/${shard.total}`;
    events.push(compact({
      schemaVersion: 1,
      sequence: events.length,
      kind: "shard",
      runId: run.runId,
      shardId,
      index: requirePositiveInteger(shard.index, "shard.index"),
      total: requirePositiveInteger(shard.total, "shard.total"),
      status: normalizeEventStatus(shard.status),
      startedAt: optionalTimestamp(shard.startedAt, "shard.startedAt"),
      completedAt: optionalTimestamp(shard.completedAt, "shard.completedAt"),
      durationMs: optionalDuration(shard.durationMs, "shard.durationMs"),
      predictedDurationMs: optionalDuration(shard.predictedDurationMs, "shard.predictedDurationMs"),
      phases: normalizePhases(shard.phases ?? []),
    }));

    const surfaceEventIds = new Map();
    const shardSurfaces = shard.surfaces ?? [];
    if (new Set(shardSurfaces.map((surface) => surface.id)).size !== shardSurfaces.length) throw new TypeError(`shard ${shard.index} contains duplicate surface IDs`);
    for (const surface of shardSurfaces) {
      const surfaceEventId = sha256(Buffer.from(canonicalize(["surface-event-id-v1", run.runId, shardId, surface.id])));
      surfaceEventIds.set(surface.id, surfaceEventId);
      events.push(compact({
        schemaVersion: 1,
        sequence: events.length,
        kind: "surface",
        runId: run.runId,
        shardId,
        surfaceEventId,
        surfaceId: surface.id,
        runner: surface.runner,
        status: normalizeEventStatus(surface.status),
        startedAt: optionalTimestamp(surface.startedAt, "surface.startedAt"),
        completedAt: optionalTimestamp(surface.completedAt, "surface.completedAt"),
        durationMs: optionalDuration(surface.durationMs, "surface.durationMs"),
        durationSource: surface.durationSource ?? "unknown",
        workerCount: surface.workerCount == null ? undefined : requirePositiveInteger(surface.workerCount, "surface.workerCount"),
        retryBudget: requireInteger(surface.retryBudget ?? 0, "surface.retryBudget"),
        phases: normalizePhases(surface.phases ?? []),
      }));

      for (const file of [...(surface.files ?? [])].sort((left, right) => normalizePath(left.path).localeCompare(normalizePath(right.path)))) {
        const filePath = normalizePath(file.path);
        const fileEventId = sha256(Buffer.from(canonicalize(["file-event-id-v1", surfaceEventId, filePath])));
        const attempts = [...(file.attempts ?? [])].sort(compareAttempts);
        events.push(compact({
          schemaVersion: 1,
          sequence: events.length,
          kind: "file",
          runId: run.runId,
          shardId,
          surfaceEventId,
          fileEventId,
          path: filePath,
          status: normalizeEventStatus(file.status),
          complete: Boolean(file.complete),
          startedAt: optionalTimestamp(file.startedAt, "file.startedAt"),
          completedAt: optionalTimestamp(file.completedAt, "file.completedAt"),
          durationMs: duration(file.durationMs ?? 0, "file.durationMs"),
          planningDurationMs: duration(file.planningDurationMs ?? 0, "file.planningDurationMs"),
          durationSource: file.durationSource ?? "unknown",
          testsTotal: requireInteger(file.testsTotal ?? countTests(attempts), "file.testsTotal"),
          retryCount: requireInteger(file.retryCount ?? attempts.filter((attempt) => attempt.attemptIndex > 0).length, "file.retryCount"),
          recoveredFlakeCount: requireInteger(file.recoveredFlakeCount ?? countRecovered(attempts), "file.recoveredFlakeCount"),
        }));
        for (const attempt of attempts) {
          const identityInput = {
            surfaceId: surface.id,
            path: filePath,
            project: attempt.project ?? null,
            titlePath: attempt.titlePath,
            line: attempt.line ?? null,
            column: attempt.column ?? null,
          };
          events.push(compact({
            schemaVersion: 1,
            sequence: events.length,
            kind: "test-attempt",
            runId: run.runId,
            shardId,
            surfaceEventId,
            fileEventId,
            testId: testIdentity(identityInput),
            attemptIndex: requireInteger(attempt.attemptIndex, "attempt.attemptIndex"),
            path: filePath,
            line: attempt.line,
            column: attempt.column,
            project: attempt.project,
            titlePath: attempt.titlePath,
            status: normalizeEventStatus(attempt.status),
            startedAt: optionalTimestamp(attempt.startedAt, "attempt.startedAt"),
            completedAt: optionalTimestamp(attempt.completedAt, "attempt.completedAt"),
            durationMs: duration(attempt.durationMs, "attempt.durationMs"),
            retry: attempt.attemptIndex > 0,
            recoveredFlake: Boolean(attempt.recoveredFlake),
            flakyAnnotated: Boolean(attempt.flakyAnnotated),
          }));
        }
      }
    }

    const leaks = deduplicateLeaks((shard.processLeaks ?? []).concat((shard.surfaces ?? []).flatMap((surface) => surface.processLeaks ?? [])));
    for (const leak of leaks) {
      const ids = leak.owningSurfaceIds.map((surfaceId) => surfaceEventIds.get(surfaceId)).filter(Boolean).sort();
      if (ids.length !== leak.owningSurfaceIds.length) throw new TypeError(`process leak names a surface outside shard ${shard.index}`);
      events.push({ schemaVersion: 1, sequence: events.length, kind: "process-leak", runId: run.runId, shardId, surfaceEventIds: ids, leak });
    }
  }
  validateTimingEvents(events);
  return events;
}

export function serializeTimingEvents(events) {
  validateTimingEvents(events);
  return `${events.map((event) => canonicalize(event)).join("\n")}\n`;
}

export function validateTimingEvents(events) {
  if (!Array.isArray(events) || events.length === 0) throw new TypeError("timing events must be a non-empty array");
  if (events[0]?.kind !== "run") throw new TypeError("first timing event must be run");
  const runId = events[0].runId;
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];
    if (event?.schemaVersion !== 1) throw new TypeError(`event ${index} has unsupported schema`);
    if (event.sequence !== index) throw new TypeError(`event sequence must be contiguous at ${index}`);
    if (event.runId !== runId) throw new TypeError(`event ${index} has a different runId`);
    if (!EVENT_STATUSES.has(event.status) && event.kind !== "process-leak") throw new TypeError(`event ${index} has invalid status`);
  }
  validateTimingProvider(events[0].timingProvider);
  return events;
}

function compareAttempts(left, right) {
  return (left.line ?? Number.MAX_SAFE_INTEGER) - (right.line ?? Number.MAX_SAFE_INTEGER)
    || (left.column ?? Number.MAX_SAFE_INTEGER) - (right.column ?? Number.MAX_SAFE_INTEGER)
    || canonicalize(left.titlePath).localeCompare(canonicalize(right.titlePath))
    || (left.project ?? "").localeCompare(right.project ?? "")
    || left.attemptIndex - right.attemptIndex;
}

function countTests(attempts) {
  return new Set(attempts.map((attempt) => canonicalize([attempt.project ?? null, attempt.titlePath, attempt.line ?? null, attempt.column ?? null]))).size;
}

function countRecovered(attempts) {
  return new Set(attempts.filter((attempt) => attempt.recoveredFlake).map((attempt) => canonicalize([attempt.project ?? null, attempt.titlePath, attempt.line ?? null, attempt.column ?? null]))).size;
}

function deduplicateLeaks(leaks) {
  const byId = new Map();
  for (const rawLeak of leaks) {
    const leak = normalizeProcessLeak(rawLeak);
    const previous = byId.get(leak.leakId);
    if (previous && canonicalize(previous) !== canonicalize(leak)) throw new TypeError(`conflicting process leak ${leak.leakId}`);
    byId.set(leak.leakId, leak);
  }
  return [...byId.values()].sort((left, right) => canonicalize(left.owningSurfaceIds).localeCompare(canonicalize(right.owningSurfaceIds)) || left.pid - right.pid || left.processStartedAt.localeCompare(right.processStartedAt));
}

function normalizeSocket(socket) {
  const protocol = socket.protocol ?? "tcp";
  const family = socket.family ?? "unknown";
  if (protocol !== "tcp" || !["ipv4", "ipv6", "unknown"].includes(family)) throw new TypeError("invalid process leak socket");
  const port = requirePositiveInteger(socket.port, "socket.port");
  if (port > 65535) throw new TypeError("socket.port must not exceed 65535");
  return { protocol, family, host: requireString(socket.host, "socket.host"), port };
}

function compareSockets(left, right) {
  return left.protocol.localeCompare(right.protocol) || left.family.localeCompare(right.family) || left.host.localeCompare(right.host) || left.port - right.port;
}

function normalizeCleanup(cleanup = {}) {
  const outcome = cleanup.outcome ?? "unknown";
  if (!["terminated", "killed", "already-exited", "survived", "unknown"].includes(outcome)) throw new TypeError("invalid process cleanup outcome");
  return { termSent: Boolean(cleanup.termSent), killSent: Boolean(cleanup.killSent), outcome };
}

function executableOnly(command) {
  const value = requireString(command, "command").trim();
  if (!value || /[\u0000\r\n]/.test(value) || /\s--?[^/]/.test(value)) throw new TypeError("process leak command must contain only executable identity");
  return value;
}

function normalizePhases(phases) {
  return phases.map(normalizeTimingPhase);
}

function validateRunInput(run) {
  requireString(run?.runId, "run.runId");
  if (run.commandProvider != null && !["local", "blaxel"].includes(run.commandProvider)) throw new TypeError("invalid command provider");
}

function normalizeRunStatus(status) {
  if (!["passed", "failed", "incomplete"].includes(status)) throw new TypeError(`invalid run status: ${status}`);
  return status;
}

function normalizeEventStatus(status) {
  const mapped = status === "flaky" || status === "expected" || status === "pass" ? "passed"
    : status === "fail" || status === "timedOut" || status === "unexpected" ? (status === "timedOut" ? "timed-out" : "failed")
      : status === "skip" || status === "pending" || status === "todo" ? "skipped" : status;
  if (!EVENT_STATUSES.has(mapped)) return "unknown";
  return mapped;
}

function normalizeGit(git = {}) {
  return { commit: git?.commit ?? null, tree: git?.tree ?? null, dirty: Boolean(git?.dirty) };
}

function normalizeEnvironment(environment = {}) {
  return compact({
    ci: Boolean(environment.ci),
    os: requireString(environment.os, "environment.os"),
    arch: requireString(environment.arch, "environment.arch"),
    node: requireString(environment.node, "environment.node"),
    vitest: environment.vitest,
    playwright: environment.playwright,
    logicalCpuCount: environment.logicalCpuCount,
    runnerImage: environment.runnerImage,
  });
}

function duration(value, name) {
  if (!Number.isFinite(value) || value < 0) throw new TypeError(`${name} must be a non-negative duration`);
  return Math.round(value);
}

function optionalDuration(value, name) {
  return value == null ? undefined : duration(value, name);
}

function requireInteger(value, name) {
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError(`${name} must be a non-negative integer`);
  return value;
}

function requirePositiveInteger(value, name) {
  if (!Number.isSafeInteger(value) || value < 1) throw new TypeError(`${name} must be a positive integer`);
  return value;
}

function requireString(value, name) {
  if (typeof value !== "string" || value.length === 0) throw new TypeError(`${name} must be a non-empty string`);
  return value;
}

function sortedUniqueStrings(values, name) {
  if (!Array.isArray(values) || values.some((value) => typeof value !== "string" || !value)) throw new TypeError(`${name} must be strings`);
  return [...new Set(values)].sort();
}

function requireTimestamp(value, name) {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value)) || !value.endsWith("Z")) throw new TypeError(`${name} must be a UTC ISO-8601 timestamp`);
  return value;
}

function optionalTimestamp(value, name) {
  return value == null ? undefined : requireTimestamp(value, name);
}

function normalizePath(value) {
  let normalized = String(value).replaceAll("\\", "/").replace(/^\.\//, "");
  if (path.posix.isAbsolute(normalized)) {
    const remoteRelative = path.posix.relative(REMOTE_WORKSPACE_ROOT, normalized);
    if (remoteRelative && remoteRelative !== ".." && !remoteRelative.startsWith("../") && !path.posix.isAbsolute(remoteRelative)) normalized = remoteRelative;
  }
  if (!normalized || path.posix.isAbsolute(normalized) || normalized.split("/").includes("..")) throw new TypeError(`path must be repo-relative: ${JSON.stringify(value)}`);
  return normalized;
}

function compact(value) {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));
}

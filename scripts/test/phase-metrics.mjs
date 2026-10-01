import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const PHASE_STATUSES = new Set(["passed", "failed", "skipped", "unknown"]);
const CACHE_STATUSES = new Set(["hit", "miss", "not-applicable", "unknown"]);
const PHASE_CATEGORIES = new Set(["schedule", "checkout", "dependencies", "readiness", "plan", "join", "test", "report", "publication", "verification", "other"]);

export function normalizeTimingPhase(phase) {
  const name = requireString(phase?.name, "phase.name");
  const status = PHASE_STATUSES.has(phase.status) ? phase.status : "unknown";
  const category = phase.category ?? inferPhaseCategory(name);
  if (!PHASE_CATEGORIES.has(category)) throw new TypeError(`invalid phase category: ${JSON.stringify(category)}`);
  const startedAt = optionalTimestamp(phase.startedAt, "phase.startedAt");
  const completedAt = optionalTimestamp(phase.completedAt, "phase.completedAt");
  let durationMs = phase.durationMs == null ? undefined : duration(phase.durationMs, "phase.durationMs");
  if (durationMs == null && startedAt && completedAt) durationMs = duration(Date.parse(completedAt) - Date.parse(startedAt), "phase.durationMs");
  const cacheStatus = phase.cacheStatus;
  if (cacheStatus != null && !CACHE_STATUSES.has(cacheStatus)) throw new TypeError(`invalid phase cache status: ${JSON.stringify(cacheStatus)}`);
  return compact({ name, category, status, startedAt, completedAt, durationMs, cacheStatus });
}

export function normalizeSetupTimingStatus(status) {
  if (status === 0 || status === "passed") return "passed";
  if (status == null || status === "unknown") return "unknown";
  if (status === "skipped") return "skipped";
  return "failed";
}

export function inferPhaseCategory(name) {
  const value = String(name).toLowerCase();
  if (/schedule|restore-wake|sandbox-acquire|vm-ready/.test(value)) return "schedule";
  if (/checkout|git-fetch|git-reset/.test(value)) return "checkout";
  if (/dependenc|\bdeps\b|npm-ci|workspace-cache|runtime-versions|system-deps/.test(value)) return "dependencies";
  if (/runner|test-run|execution-group|surface-compute/.test(value)) return "test";
  if (/browser|playwright-cache|electron-repair|readiness|surface-services|first-test/.test(value)) return "readiness";
  if (/\bplan\b|planning/.test(value)) return "plan";
  if (/join|agreement/.test(value)) return "join";
  if (/report|artifact-download|output-download/.test(value)) return "report";
  if (/publication|publish/.test(value)) return "publication";
  if (/lint|type-check|package-manifest|preflight|verify/.test(value)) return "verification";
  return "other";
}

export function readPhaseMetricsFile(file) {
  if (!file || !fs.existsSync(file)) return [];
  const raw = fs.readFileSync(file, "utf8").trim();
  if (!raw) return [];
  let rows;
  if (raw.startsWith("[")) rows = JSON.parse(raw);
  else rows = raw.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
  if (!Array.isArray(rows)) throw new TypeError("phase metrics file must contain an array or NDJSON rows");
  return rows.map(normalizeTimingPhase);
}

export function appendPhaseMetricFile(file, phase) {
  const normalized = normalizeTimingPhase(phase);
  fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  fs.appendFileSync(file, `${JSON.stringify(normalized)}\n`);
  return normalized;
}

export function recordPhaseMetricBestEffort(context, operation) {
  try {
    return operation();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[phase-metrics] warning: ${context}: ${message}`);
    return null;
  }
}

export function phaseFromEpoch({ name, category, status = "passed", startedMs, completedMs = Date.now(), cacheStatus }) {
  return normalizeTimingPhase({
    name,
    category,
    status,
    startedAt: new Date(startedMs).toISOString(),
    completedAt: new Date(completedMs).toISOString(),
    durationMs: completedMs - startedMs,
    cacheStatus,
  });
}

export function summarizePhaseMetrics(events, { additionalRunPhases = [] } = {}) {
  const run = events.find((event) => event.kind === "run");
  if (!run) throw new TypeError("phase metrics require a run event");
  const shards = events.filter((event) => event.kind === "shard").map((shard) => ({
    index: shard.index,
    total: shard.total,
    status: shard.status,
    durationMs: shard.durationMs,
    phases: (shard.phases ?? []).map(normalizeTimingPhase),
    surfaces: events.filter((event) => event.kind === "surface" && event.shardId === shard.shardId).map((surface) => ({
      surfaceId: surface.surfaceId,
      status: surface.status,
      durationMs: surface.durationMs,
      durationSource: surface.durationSource,
      phases: (surface.phases ?? []).map(normalizeTimingPhase),
    })),
  }));
  const runPhases = [...(run.phases ?? []), ...additionalRunPhases].map(normalizeTimingPhase);
  return {
    schemaVersion: 1,
    run: runPhaseSummary({ startedAt: run.startedAt, completedAt: run.completedAt, durationMs: run.durationMs, phases: runPhases }),
    shards,
  };
}

export function attachPhaseMetricsToSummary({ runDir, summary, events, additionalRunPhases = [] }) {
  summary.phaseMetrics = summarizePhaseMetrics(events, { additionalRunPhases });
  atomicWriteJson(path.join(runDir, "summary.json"), summary);
  return summary.phaseMetrics;
}

export function appendRunSummaryPhase({ runDir, phase }) {
  const summaryPath = path.join(runDir, "summary.json");
  const summary = JSON.parse(fs.readFileSync(summaryPath, "utf8"));
  const normalized = normalizeTimingPhase(phase);
  summary.phaseMetrics ??= { schemaVersion: 1, run: { durationMs: summary.run?.durationMs, phases: [] }, shards: [] };
  summary.phaseMetrics.run ??= { durationMs: summary.run?.durationMs, phases: [] };
  summary.phaseMetrics.run.phases ??= [];
  summary.phaseMetrics.run.phases.push(normalized);
  summary.phaseMetrics.run = runPhaseSummary({
    startedAt: summary.run?.startedAt,
    completedAt: summary.run?.completedAt,
    durationMs: summary.run?.durationMs,
    phases: summary.phaseMetrics.run.phases,
  });
  atomicWriteJson(summaryPath, summary);
  return normalized;
}

function runPhaseSummary({ startedAt, completedAt, durationMs, phases }) {
  const normalized = phases.map(normalizeTimingPhase);
  const starts = [startedAt, ...normalized.map((phase) => phase.startedAt)].filter(Boolean).map(Date.parse).filter(Number.isFinite);
  const completions = [completedAt, ...normalized.map((phase) => phase.completedAt)].filter(Boolean).map(Date.parse).filter(Number.isFinite);
  const observedStartedAt = starts.length ? new Date(Math.min(...starts)).toISOString() : undefined;
  const observedCompletedAt = completions.length ? new Date(Math.max(...completions)).toISOString() : undefined;
  return compact({
    durationMs,
    observedStartedAt,
    observedCompletedAt,
    observedWallDurationMs: observedStartedAt && observedCompletedAt ? Date.parse(observedCompletedAt) - Date.parse(observedStartedAt) : undefined,
    phases: normalized,
  });
}

function atomicWriteJson(file, value) {
  const temporary = `${file}.tmp-p${process.pid}-r${crypto.randomBytes(6).toString("hex")}`;
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx" });
    fs.renameSync(temporary, file);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}

function duration(value, name) {
  if (!Number.isFinite(value) || value < 0) throw new TypeError(`${name} must be a non-negative duration`);
  return Math.round(value);
}

function requireString(value, name) {
  if (typeof value !== "string" || value.length === 0) throw new TypeError(`${name} must be a non-empty string`);
  return value;
}

function optionalTimestamp(value, name) {
  if (value == null) return undefined;
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value)) || !value.endsWith("Z")) throw new TypeError(`${name} must be a UTC ISO-8601 timestamp`);
  return value;
}

function compact(value) {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));
}

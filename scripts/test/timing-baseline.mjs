import fs from "node:fs";
import path from "node:path";
import { owningSurfaces, selectSurfaces } from "./config.mjs";
import { atomicWriteFile } from "./run-context.mjs";
import { validateTimingEvents } from "./timing-events.mjs";

export const TIMING_BASELINE_PATH = "test/timing-baseline.json";
export const BASELINE_TIMING_PROVIDER = "blaxel-playwright-x64-4vcpu";
export const EMPTY_TIMING_BASELINE = { schemaVersion: 1, sourceThrough: null, files: {} };
const EXECUTED_SURFACE_STATUSES = new Set(["passed", "failed", "not-assigned"]);

export function readTimingBaseline({ repoRoot = process.cwd(), baselinePath = TIMING_BASELINE_PATH } = {}) {
  const file = path.resolve(repoRoot, baselinePath);
  let bytes;
  try { bytes = fs.readFileSync(file); } catch (error) {
    if (error?.code === "ENOENT") throw new Error(`timing baseline is missing: ${baselinePath}`);
    throw error;
  }
  let baseline;
  try { baseline = JSON.parse(bytes.toString("utf8")); } catch { throw new Error(`timing baseline is malformed: ${baselinePath}`); }
  validateTimingBaseline(baseline);
  return { baseline, bytes, file };
}

export function validateTimingBaseline(baseline) {
  if (!baseline || baseline.schemaVersion !== 1) throw new Error("timing baseline has unsupported schema");
  if (baseline.sourceThrough !== null && !validTimestamp(baseline.sourceThrough)) throw new Error("timing baseline sourceThrough is invalid");
  if (!baseline.files || typeof baseline.files !== "object" || Array.isArray(baseline.files)) throw new Error("timing baseline files must be an object");
  for (const [file, entry] of Object.entries(baseline.files)) {
    if (!normalizedPath(file)) throw new Error(`timing baseline path is invalid: ${file}`);
    if (!entry || typeof entry.surfaceId !== "string" || !entry.providers || typeof entry.providers !== "object") throw new Error(`timing baseline entry is invalid: ${file}`);
    if (Object.keys(entry.providers).join(",") !== BASELINE_TIMING_PROVIDER) throw new Error(`timing baseline entry must hold only ${BASELINE_TIMING_PROVIDER} measurements: ${file}`);
    const timing = entry.providers[BASELINE_TIMING_PROVIDER];
    if (!Number.isSafeInteger(timing.medianDurationMs) || timing.medianDurationMs < 0) throw new Error(`invalid median for ${file}`);
    for (const field of ["sampleCount", "retryCount", "recoveredFlakeCount"]) if (!Number.isSafeInteger(timing[field]) || timing[field] < (field === "sampleCount" ? 1 : 0)) throw new Error(`invalid ${field} for ${file}`);
    if (!validTimestamp(timing.lastUpdated)) throw new Error(`invalid lastUpdated for ${file}`);
  }
  return baseline;
}

// The only baseline writer (specs/arch/test-runner/sharded-execution.md#Manual update):
// complete-`all` Blaxel runs in this checkout's .test-runs/ feed a full
// recomputation. Nothing is written unless every input run validates.
export function updateTimingBaseline({ repoRoot = process.cwd(), config, dryRun = false } = {}) {
  const existing = readTimingBaseline({ repoRoot });
  const runs = readBaselineInputRuns({ repoRoot, config });
  if (runs.length === 0) throw new Error(`no complete Blaxel runs found under ${path.join(repoRoot, ".test-runs")}; the baseline is unchanged`);
  const baseline = rollupTimingEvents({ runs, config });
  const bytes = serializeTimingBaseline(baseline);
  const changes = diffBaseline(existing.baseline, baseline);
  if (!dryRun && !existing.bytes.equals(bytes)) atomicWriteFile(existing.file, bytes);
  return { baseline, bytes, runs, changes, changed: !existing.bytes.equals(bytes), dryRun };
}

function readBaselineInputRuns({ repoRoot = process.cwd(), config }) {
  const runRoot = path.join(repoRoot, ".test-runs");
  let entries;
  try { entries = fs.readdirSync(runRoot, { withFileTypes: true }); } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
  const suiteSurfaceIds = selectSurfaces(config, { suite: "all" }).map((surface) => surface.id);
  const runs = [];
  for (const name of entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort()) {
    const dir = path.join(runRoot, name);
    const eventsPath = path.join(dir, "events.ndjson");
    if (!fs.existsSync(eventsPath)) continue;
    const lines = fs.readFileSync(eventsPath, "utf8").split("\n").filter(Boolean);
    let run;
    try { run = JSON.parse(lines[0]); } catch { run = null; }
    if (run?.kind !== "run") throw new Error(`unreadable run event in ${dir}`);
    if (!isBlaxelAllCandidate(run)) continue;
    let events;
    try {
      events = validateTimingEvents(lines.map((line) => JSON.parse(line)));
    } catch (error) {
      throw new Error(`invalid timing events in ${dir}: ${error.message}`);
    }
    if (!ranCompleteSuite({ events, suiteSurfaceIds })) continue;
    runs.push({ dir, run, events });
  }
  return runs;
}

function isBlaxelAllCandidate(run) {
  const selection = run.selection ?? {};
  return run.commandProvider === "blaxel"
    && run.timingProvider === BASELINE_TIMING_PROVIDER
    && selection.suite === "all"
    && (selection.files ?? []).length === 0
    && (selection.grep ?? null) === null;
}

// The `all` label alone does not prove the suite ran: surface, package, runner,
// and tag filters and shard subsets keep it, and so does an unfinished run.
// Because the update carries nothing forward, such a run would replace the
// measurements of every file it did not execute.
function ranCompleteSuite({ events, suiteSurfaceIds }) {
  const [run, ...rest] = events;
  const selected = new Set(Array.isArray(run.selection.surfaces) ? run.selection.surfaces : []);
  if (!suiteSurfaceIds.every((id) => selected.has(id))) return false;
  const shards = rest.filter((event) => event.kind === "shard");
  const total = shards[0]?.total;
  const indices = new Set(shards.map((shard) => shard.index));
  if (shards.length !== total || indices.size !== total || shards.some((shard) => shard.total !== total || shard.index < 1 || shard.index > total)) return false;
  if (run.status === "incomplete") return false;
  return rest.every((event) => event.kind !== "surface" || EXECUTED_SURFACE_STATUSES.has(event.status));
}

export function rollupTimingEvents({ runs, config }) {
  const observations = new Map();
  let sourceThrough = null;
  for (const { dir, run, events } of runs) {
    for (const event of events) {
      if (event.kind !== "file" || !event.complete) continue;
      const surface = surfaceForEvent(events, event.surfaceEventId);
      if (!surface) throw new Error(`${dir} file event has no owning surface`);
      const owners = owningSurfaces(config.surfaces, event.path);
      if (owners.length === 0 || !fs.existsSync(path.join(config.root ?? process.cwd(), event.path))) continue;
      if (owners.length !== 1 || owners[0].id !== surface.surfaceId) throw new Error(`${event.path} current registry owner disagrees with event surface ${surface.surfaceId}`);
      const values = observations.get(event.path) ?? { path: event.path, surfaceId: surface.surfaceId, durations: [], retryCount: 0, recoveredFlakeCount: 0, lastUpdated: run.completedAt };
      if (event.status === "passed") values.durations.push(event.planningDurationMs);
      values.retryCount += event.retryCount;
      values.recoveredFlakeCount += event.recoveredFlakeCount;
      if (run.completedAt > values.lastUpdated) values.lastUpdated = run.completedAt;
      observations.set(event.path, values);
    }
    if (sourceThrough == null || run.completedAt > sourceThrough) sourceThrough = run.completedAt;
  }
  const files = {};
  for (const values of [...observations.values()].filter((entry) => entry.durations.length > 0)) {
    values.durations.sort((left, right) => left - right);
    files[values.path] = {
      surfaceId: values.surfaceId,
      providers: {
        [BASELINE_TIMING_PROVIDER]: {
          medianDurationMs: median(values.durations),
          sampleCount: values.durations.length,
          retryCount: values.retryCount,
          recoveredFlakeCount: values.recoveredFlakeCount,
          lastUpdated: values.lastUpdated,
        },
      },
    };
  }
  return { schemaVersion: 1, sourceThrough, files };
}

export function serializeTimingBaseline(baseline) {
  validateTimingBaseline(baseline);
  const sorted = { schemaVersion: 1, sourceThrough: baseline.sourceThrough, files: {} };
  for (const file of Object.keys(baseline.files).sort()) sorted.files[file] = { surfaceId: baseline.files[file].surfaceId, providers: baseline.files[file].providers };
  return Buffer.from(`${JSON.stringify(sorted, null, 2)}\n`);
}

export function diffBaseline(before, after) {
  const beforeEntries = flatten(before);
  const afterEntries = flatten(after);
  const keys = [...new Set([...beforeEntries.keys(), ...afterEntries.keys()])].sort();
  return keys.flatMap((key) => {
    const left = beforeEntries.get(key);
    const right = afterEntries.get(key);
    if (JSON.stringify(left) === JSON.stringify(right)) return [];
    return [{ key, status: left == null ? "added" : right == null ? "removed" : "changed", before: left, after: right }];
  });
}

function surfaceForEvent(events, id) {
  return events.find((event) => event.kind === "surface" && event.surfaceEventId === id);
}

function median(values) {
  const middle = Math.floor(values.length / 2);
  return values.length % 2 ? values[middle] : Math.floor((values[middle - 1] + values[middle] + 1) / 2);
}

function flatten(baseline) {
  const out = new Map();
  for (const [file, entry] of Object.entries(baseline.files)) out.set(file, { surfaceId: entry.surfaceId, ...entry.providers[BASELINE_TIMING_PROVIDER] });
  return out;
}

function normalizedPath(value) {
  return typeof value === "string" && value.length > 0 && !path.posix.isAbsolute(value) && !value.split("/").includes("..");
}

function validTimestamp(value) {
  return typeof value === "string" && value.endsWith("Z") && Number.isFinite(Date.parse(value));
}

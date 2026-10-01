import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { buildReports } from "./reporting.mjs";
import { buildTimingEvents, serializeTimingEvents, validateTimingProvider } from "./timing-events.mjs";
import { attachPhaseMetricsToSummary, phaseFromEpoch, readPhaseMetricsFile } from "./phase-metrics.mjs";

export function createRunContext(commandProvider, { root = process.cwd(), now = new Date(), pid = process.pid, randomBytes = crypto.randomBytes, timingProvider = null, env = process.env } = {}) {
  const resolvedTimingProvider = resolveTimingProvider({ env, supplied: timingProvider ?? env.TV_TEST_TIMING_PROVIDER });
  const runId = createRunId({ now, pid, randomBytes });
  const runDir = path.join(root, ".test-runs", runId);
  for (const child of ["logs", "native", "provider"]) fs.mkdirSync(path.join(runDir, child), { recursive: true });
  return {
    runId,
    runDir: path.relative(root, runDir) || runDir,
    absoluteRunDir: runDir,
    commandProvider,
    timingProvider: resolvedTimingProvider,
  };
}

export function readRunDirectoryIdentity(identityFile, { root = process.cwd() } = {}) {
  const runRoot = path.resolve(root, ".test-runs");
  let value;
  try {
    value = fs.readFileSync(identityFile, "utf8").trim();
  } catch (error) {
    throw new Error(`Run identity was not written: ${error.message}`, { cause: error });
  }
  if (!value || !path.isAbsolute(value)) {
    throw new Error(`Run identity must name an existing directory that is a direct child of ${runRoot}`);
  }
  const runDir = path.resolve(value);
  if (path.dirname(runDir) !== runRoot) {
    throw new Error(`Run identity must name an existing directory that is a direct child of ${runRoot}; received ${runDir}`);
  }
  let stats;
  try {
    stats = fs.statSync(runDir);
  } catch (error) {
    throw new Error(`Run identity must name an existing directory: ${runDir}`, { cause: error });
  }
  if (!stats.isDirectory()) throw new Error(`Run identity must name an existing directory: ${runDir}`);
  return runDir;
}

export function createRunId({ now = new Date(), pid = process.pid, randomBytes = crypto.randomBytes } = {}) {
  if (!Number.isSafeInteger(pid) || pid < 0) throw new TypeError("pid must be an unsigned integer");
  const safeStart = now.toISOString().replace(/[:.]/g, "-");
  const random = randomBytes(8).toString("hex");
  if (!/^[a-f0-9]{16}$/.test(random)) throw new TypeError("run random suffix must be 8 bytes");
  return `${safeStart}-p${pid}-r${random}`;
}

export function resolveTimingProvider({ env = process.env, platform = process.platform, arch = process.arch, logicalCpuCount = os.availableParallelism(), supplied = env.TV_TEST_TIMING_PROVIDER } = {}) {
  if (env.GITHUB_ACTIONS === "true") {
    if (!supplied) throw new Error("TV_TEST_TIMING_PROVIDER is required in GitHub Actions");
    if (supplied.startsWith("local-")) throw new Error("GitHub Actions must use its workflow-supplied GitHub timing provider, not local-*");
    return validateTimingProvider(supplied);
  }
  if (supplied) return validateTimingProvider(supplied);
  return validateTimingProvider(`local-${platform}-${arch}-${logicalCpuCount}cpu`);
}

export function atomicWriteFile(file, contents) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp-p${process.pid}-r${crypto.randomBytes(6).toString("hex")}`;
  try {
    fs.writeFileSync(temporary, contents, { flag: "wx" });
    fs.renameSync(temporary, file);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}

export function atomicWriteJson(file, value) {
  atomicWriteFile(file, `${JSON.stringify(value, null, 2)}\n`);
}

export function finalizeRun({ runContext, selection, git = null, preflights = [], surfaces = [], startedAt, completedAt, phases = [], shard = {}, shards = null }) {
  const reportStarted = Date.now();
  const preflightPhases = preflights.map((preflight) => ({ name: `preflight:${preflight.name}`, category: "verification", status: preflight.status === "passed" ? "passed" : "failed", startedAt: preflight.startedAt, completedAt: preflight.completedAt, durationMs: preflight.durationMs }));
  const runPhases = [...readPhaseMetricsFile(process.env.TV_TEST_PHASE_METRICS_FILE), ...preflightPhases, ...phases];
  const runDir = runContext.absoluteRunDir ?? path.resolve(runContext.runDir);
  const reportContext = {
    runId: runContext.runId,
    provider: runContext.commandProvider,
    commandProvider: runContext.commandProvider,
    timingProvider: runContext.timingProvider,
    runDir,
    selection,
    git,
    preflights,
    surfaces,
    startedAt,
    completedAt,
  };
  const { summary, results } = buildReports(reportContext);
  runPhases.push(phaseFromEpoch({ name: "report-normalization", category: "report", startedMs: reportStarted }));
  const events = buildTimingEvents({
    run: {
      runId: runContext.runId,
      commandProvider: runContext.commandProvider,
      timingProvider: runContext.timingProvider,
      status: summary.run.status,
      startedAt,
      completedAt,
      durationMs: summary.run.durationMs,
      selection,
      git: normalizeGit(git),
      environment: runtimeEnvironment(),
      shardPlanId: shard.planId,
      timingBaselineDigest: shard.timingBaselineDigest,
      phases: runPhases,
    },
    shards: shards ?? [{
      index: shard.index ?? 1,
      total: shard.total ?? 1,
      status: summary.run.status,
      startedAt,
      completedAt,
      durationMs: summary.run.durationMs,
      predictedDurationMs: shard.predictedDurationMs,
      phases: shard.phases ?? [],
      surfaces: results.surfaces,
      processLeaks: shard.processLeaks ?? [],
    }],
  });
  const eventBytes = serializeTimingEvents(events);
  atomicWriteFile(path.join(runDir, "events.ndjson"), eventBytes);
  const reportPhase = phaseFromEpoch({ name: "report-finalization", category: "report", startedMs: reportStarted });
  attachPhaseMetricsToSummary({ runDir, summary, events, additionalRunPhases: [reportPhase] });
  return { summary, results, events };
}

function normalizeGit(git) {
  return {
    commit: git?.commit ?? null,
    tree: git?.tree ?? null,
    dirty: Boolean(git?.dirty ?? git?.workingTreeDirty),
  };
}

function runtimeEnvironment() {
  return {
    ci: Boolean(process.env.CI),
    os: process.platform,
    arch: process.arch,
    node: process.versions.node,
    logicalCpuCount: os.availableParallelism(),
    runnerImage: process.env.ImageOS || undefined,
  };
}

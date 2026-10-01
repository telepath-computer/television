import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import process from "node:process";
import { loadTestConfig, selectSurfaces } from "./config.mjs";
import { groupByExecutionGroup, splitVitestWorkspaceResult, writeVitestRunnerConfig, vitestProjectsArgs } from "./execution-groups.mjs";
import { normalizeProviderShardSurfaces } from "./provider-normalization.mjs";
import { createRunContext, atomicWriteJson, finalizeRun } from "./run-context.mjs";
import { validateShardPlan } from "./shard-plan.mjs";
import { shouldSkipPreCommands } from "./prebuilt.mjs";
import { runPreflights } from "./preflight.mjs";
import { runnerEnv } from "./runner-env.mjs";
import { createSurfaceSupervisor } from "./surface-supervisor.mjs";
import { startSurfaceServices } from "./surface-services.mjs";
import { reapStaleOwnerProcesses } from "./stale-owner-reaper.mjs";

export async function runPlannedShard(rawOptions = {}, env = process.env) {
  const planPath = path.resolve(rawOptions.plan ?? env.TEST_SHARD_PLAN ?? "");
  const shardIndex = positiveInteger(rawOptions.shard ?? env.TEST_SHARD_INDEX, "--shard/TEST_SHARD_INDEX");
  const resultsDir = path.resolve(rawOptions["results-dir"] ?? env.TEST_SHARD_RESULTS_DIR ?? ".testshards/results");
  const testRetries = nonNegativeInteger(rawOptions["test-retries"] ?? env.TEST_RETRIES ?? "0", "--test-retries/TEST_RETRIES");
  const failFast = Boolean(rawOptions["fail-fast"]) || env.TEST_SHARD_FAIL_FAST === "1";
  const skipPreCommands = shouldSkipPreCommands(rawOptions, env);
  const timingProvider = env.TV_TEST_TIMING_PROVIDER;
  if (!planPath || !fs.existsSync(planPath)) throw new Error(`planned shard requires an existing plan file: ${planPath}`);
  if (!timingProvider) throw new Error("TV_TEST_TIMING_PROVIDER is required for planned shard execution");
  const plan = JSON.parse(fs.readFileSync(planPath, "utf8"));
  const shardTotal = positiveInteger(rawOptions.total ?? env.TEST_SHARD_TOTAL ?? plan.shardTotal, "--total/TEST_SHARD_TOTAL");
  const testedCommit = git("rev-parse", "HEAD");
  const testedTree = git("rev-parse", "HEAD^{tree}");
  validateShardPlan(plan, { timingProvider, testedCommit, testedTree, shardIndex, shardTotal });
  fs.mkdirSync(resultsDir, { recursive: true });
  fs.copyFileSync(planPath, path.join(resultsDir, "shard-plan.json"));

  const config = await loadWorkerConfig(env);
  const selected = selectSurfaces(config, { surface: plan.selectedSurfaceIds.join(",") });
  if (selected.map((surface) => surface.id).join("\0") !== plan.selectedSurfaceIds.join("\0")) throw new Error("worker registry does not contain the plan surfaces in registry order");
  const plannedShard = plan.shards[shardIndex - 1];
  const assignedBySurface = new Map(plannedShard.surfaces.map((surface) => [surface.surfaceId, surface.files.map((file) => file.path)]));
  const completeInventory = plan.shards.flatMap((shard) => shard.surfaces.flatMap((surface) => surface.files.map((file) => file.path)));
  validateVitestFilters({ surfaces: selected, assignedBySurface, completeInventory });

  const started = Date.now();
  const startedAt = new Date().toISOString();
  const tasks = selected.map((surface) => taskFromSurface(surface, assignedBySurface.get(surface.id) ?? [], { resultsDir, shardIndex, testRetries }));
  const executionPreflights = runPreflights(["process-lifecycle"], { provider: "local" });
  let failedPreflight = executionPreflights.find((result) => result.status !== "passed");
  let startupOwners = null;
  if (!failedPreflight) {
    const ownerStartedAt = new Date().toISOString();
    const ownerStarted = Date.now();
    startupOwners = await reapStaleOwnerProcesses();
    const blocked = startupOwners.staleDetected || !startupOwners.cleanupConfirmed;
    executionPreflights.push({
      name: "stale-owner-cleanup",
      provider: "local",
      status: blocked ? "failed" : "passed",
      startedAt: ownerStartedAt,
      completedAt: new Date().toISOString(),
      durationMs: Date.now() - ownerStarted,
      message: startupOwners.message,
      failureKind: blocked ? "stale-owner" : null,
      processLeaks: startupOwners.processLeaks,
      liveOwners: startupOwners.liveOwners,
    });
    if (blocked) failedPreflight = executionPreflights.at(-1);
  }
  const taskResults = tasks.filter((task) => task.assignedFiles.length === 0).map(notAssignedResult);
  const assignedTasks = tasks.filter((task) => task.assignedFiles.length > 0);
  if (failedPreflight) taskResults.push(...assignedTasks.map((task) => preflightFailedTask(task, failedPreflight)));
  const groups = failedPreflight ? [] : groupByExecutionGroup(assignedTasks, { getMetadata: (task) => task.executionGroup, getFallbackId: (task) => task.surfaceId });
  const shardPhases = [];
  let stopped = false;
  for (const group of groups) {
    const groupStarted = Date.now();
    const phase = { name: `execution-group:${group.id}`, status: "passed", startedAt: new Date().toISOString() };
    let results;
    if (group.id === "unit:workspaces" && group.items.every((task) => task.runner === "vitest")) results = await runVitestWorkspace(group.items, { resultsDir, shardIndex, skipPreCommands, env, lifecycleRunId: `${plan.planId}:${shardIndex}` });
    else {
      results = [];
      for (const task of group.items) {
        const result = await runStandalone(task, { resultsDir, shardIndex, skipPreCommands, env, lifecycleRunId: `${plan.planId}:${shardIndex}` });
        results.push(result);
        if (result.status === "failed" && failFast) break;
      }
    }
    taskResults.push(...results);
    if (results.some((result) => result.status === "failed")) phase.status = "failed";
    phase.completedAt = new Date().toISOString();
    phase.durationMs = Date.now() - groupStarted;
    shardPhases.push(phase);
    if (phase.status === "failed" && failFast) { stopped = true; break; }
  }
  if (stopped) {
    const recordedSurfaceIds = new Set(taskResults.map((task) => task.surfaceId));
    taskResults.push(...assignedTasks.filter((task) => !recordedSurfaceIds.has(task.surfaceId)).map(failFastSkippedResult));
  }

  const collectionFailure = taskResults.some((task) => task.failureKind === "collection-mismatch" || (task.infraStatus === "incomplete" && task.failureKind !== "process-leak"));
  const failed = taskResults.some((task) => task.status === "failed" || task.failureKind === "process-leak");
  const completedAt = new Date().toISOString();
  const taskInfrastructureFailure = taskResults.find((task) => task.infraStatus === "incomplete");
  const shardFailure = startupOwners && (startupOwners.staleDetected || !startupOwners.cleanupConfirmed)
    ? { failureKind: "stale-owner", failureStep: "startup-owner-cleanup", failureMessage: startupOwners.message, processLeaks: startupOwners.processLeaks }
    : taskInfrastructureFailure
      ? { failureKind: taskInfrastructureFailure.failureKind, failureStep: taskInfrastructureFailure.failureStep, failureMessage: taskInfrastructureFailure.failureMessage }
      : null;
  const summary = {
    schemaVersion: 1,
    status: collectionFailure ? "infra-failed" : failed ? "failed" : "passed",
    suite: "plan",
    shardIndex,
    shardTotal: plan.shardTotal,
    shard: `${shardIndex}/${plan.shardTotal}`,
    planId: plan.planId,
    timingProvider: plan.timingProvider,
    testedCommit: plan.testedCommit,
    testedTree: plan.testedTree,
    timingBaselineDigest: plan.timingBaselineDigest,
    predictedDurationMs: plannedShard.predictedDurationMs,
    assignedFiles: taskResults.flatMap((task) => task.assignedFiles ?? []).sort(),
    collectedFiles: taskResults.flatMap((task) => task.collectedFiles ?? []).sort(),
    failFast,
    stoppedForFailFast: stopped,
    preCommandsSkipped: skipPreCommands,
    startedAt,
    completedAt,
    durationMs: Date.now() - started,
    phases: shardPhases,
    preflights: executionPreflights,
    tasks: taskResults,
    ...(shardFailure ?? {}),
  };
  const summaryPath = path.join(resultsDir, `shard-${shardIndex}.json`);
  atomicWriteJson(summaryPath, summary);

  if (env.GITHUB_ACTIONS === "true") {
    const runContext = createRunContext(null, { timingProvider: plan.timingProvider });
    const providerOutputDir = path.join(runContext.absoluteRunDir, "provider", "github");
    fs.cpSync(resultsDir, providerOutputDir, { recursive: true });
    const providerLogPath = path.join(runContext.absoluteRunDir, "logs", `shard-${shardIndex}.log`);
    fs.writeFileSync(providerLogPath, "Raw runner output is retained in the GitHub Actions job log.\n");
    const retainedSummary = relocateTaskArtifacts(summary, resultsDir, providerOutputDir, path.join(runContext.absoluteRunDir, "native"));
    const surfaces = normalizeProviderShardSurfaces({ provider: "github", providerSummary: { status: summary.status === "passed" ? "passed" : "failed", shards: [retainedSummary] }, outputDir: providerOutputDir, surfaces: selected, delegatedCommand: [process.execPath, "scripts/run-test-shard.mjs"], exitCode: summary.status === "passed" ? 0 : 1, coordinatorLogPath: providerLogPath });
    finalizeRun({ runContext, selection: { surfaces: plan.selectedSurfaceIds, files: summary.assignedFiles }, git: { commit: testedCommit, tree: testedTree, dirty: false }, preflights: executionPreflights, surfaces, startedAt, completedAt, shard: { index: shardIndex, total: plan.shardTotal, planId: plan.planId, timingBaselineDigest: plan.timingBaselineDigest, predictedDurationMs: plannedShard.predictedDurationMs, phases: shardPhases } });
    summary.runId = runContext.runId;
    summary.runDir = runContext.runDir;
    atomicWriteJson(summaryPath, summary);
    atomicWriteJson(path.join(providerOutputDir, `shard-${shardIndex}.json`), relocateTaskArtifacts(summary, resultsDir, providerOutputDir, path.join(runContext.absoluteRunDir, "native")));
  }
  return summary.status === "passed" ? 0 : 1;
}

function relocateTaskArtifacts(summary, resultsDir, providerOutputDir, nativeOutputDir) {
  const relativeResultPath = (file) => {
    if (!file) return null;
    const relative = path.relative(resultsDir, path.resolve(file));
    return relative.startsWith("..") || path.isAbsolute(relative) ? null : relative;
  };
  const relocateProvider = (file) => {
    const relative = relativeResultPath(file);
    return relative == null ? file : path.join(providerOutputDir, relative);
  };
  const relocateNative = (file) => {
    const relative = relativeResultPath(file);
    if (relative == null) return file;
    const destination = path.join(nativeOutputDir, relative);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(path.resolve(file), destination);
    return destination;
  };
  return {
    ...summary,
    tasks: (summary.tasks ?? []).map((task) => ({
      ...task,
      nativeResultPath: relocateNative(task.nativeResultPath),
      attemptResultPath: relocateNative(task.attemptResultPath),
      workspaceNativeResultPath: relocateNative(task.workspaceNativeResultPath),
      lifecycleResultPath: relocateProvider(task.lifecycleResultPath),
      processLeakResultPath: relocateProvider(task.processLeakResultPath),
      generatedInputPaths: (task.generatedInputPaths ?? []).map(relocateProvider),
    })),
  };
}

export function validateVitestFilters({ surfaces, assignedBySurface, completeInventory }) {
  for (const surface of surfaces.filter((candidate) => candidate.runner === "vitest")) {
    for (const file of assignedBySurface.get(surface.id) ?? []) {
      const matches = completeInventory.filter((candidate) => candidate.includes(file));
      if (matches.length !== 1 || matches[0] !== file) throw new Error(`ambiguous Vitest file filter ${file}: ${matches.join(", ") || "no match"}`);
    }
  }
}

export function compareAssignedAndCollected(assigned, collected) {
  const expected = [...assigned].sort();
  const actual = [...collected].sort();
  const duplicates = actual.filter((file, index) => actual.indexOf(file) !== index);
  const missing = expected.filter((file) => !actual.includes(file));
  const extra = actual.filter((file) => !expected.includes(file));
  return { matches: missing.length === 0 && extra.length === 0 && duplicates.length === 0, missing, extra, duplicates };
}

async function runVitestWorkspace(tasks, { resultsDir, shardIndex, skipPreCommands, env, lifecycleRunId }) {
  const started = Date.now();
  const workspacePath = path.join(resultsDir, `workspace-unit-workspaces-shard-${shardIndex}.mjs`);
  const nativeResultPath = path.join(resultsDir, `native-unit-workspaces-shard-${shardIndex}.json`);
  const attemptResultPath = path.join(resultsDir, `native-unit-workspaces-shard-${shardIndex}.attempts.ndjson`);
  const supervisor = createSurfaceSupervisor({ runId: lifecycleRunId, surfaceIds: tasks.map((task) => task.surfaceId) });
  let pre;
  let exitCode = 0;
  let processLeaks = [];
  let commandStarted = null;
  fs.rmSync(attemptResultPath, { force: true });
  const commandArgs = vitestProjectsArgs({ configPath: workspacePath, configPaths: tasks.map((task) => path.resolve(task.config)) });
  try {
    pre = await runPreCommands(tasks, { skipPreCommands, env, supervisor });
    if (!pre.failed) {
      const files = tasks.flatMap((task) => task.assignedFiles).map((file) => path.resolve(file));
      const args = [...commandArgs, ...files, "--reporter=json", "--outputFile", nativeResultPath];
      commandStarted = Date.now();
      exitCode = (await supervisor.run(npx(), args, { env: runnerEnv(env, { TV_VITEST_ATTEMPT_FILE: attemptResultPath }), cwd: process.cwd(), stdio: "inherit" })).exitCode;
    } else {
      exitCode = pre.exitCode;
    }
  } finally {
    processLeaks = await supervisor.finish();
  }
  if (pre.failed) return tasks.map((task) => failedTask(task, pre.exitCode, started, { preCommandsSkipped: skipPreCommands, failureKind: pre.failureKind, failureStep: "pre-command", failureMessage: pre.failureMessage, phases: pre.phases, generatedInputPaths: [workspacePath], processLeaks }));
  const splitStatuses = splitVitestWorkspaceResult({ nativeResultPath, tasks });
  return tasks.map((task) => {
    const status = exitCode === 0 ? 0 : (splitStatuses.get(task.surfaceId) ?? exitCode);
    const collected = collectedVitestFiles(task.nativeResultPath, task);
    return resultForTask(task, status, started, { collectedFiles: collected, preCommandsSkipped: skipPreCommands, attemptResultPath, workspaceNativeResultPath: fs.existsSync(nativeResultPath) ? nativeResultPath : null, generatedInputPaths: [workspacePath], phases: [...pre.phases, phase("runner", commandStarted, status)], processLeaks });
  });
}

async function runStandalone(task, { resultsDir, shardIndex, skipPreCommands, env, lifecycleRunId }) {
  const started = Date.now();
  const supervisor = createSurfaceSupervisor({ runId: lifecycleRunId, surfaceIds: [task.surfaceId] });
  let pre;
  let command;
  let args;
  let childEnv = null;
  let attemptResultPath = null;
  let generatedInputPaths = [];
  let exitCode = 0;
  let commandStarted = null;
  let processLeaks = [];
  let serviceScope = null;
  let serviceFailure = null;
  try {
    pre = await runPreCommands([task], { skipPreCommands, env, supervisor });
    if (pre.failed) {
      exitCode = pre.exitCode;
    } else {
      if (task.services.length > 0) {
        const serviceStarted = Date.now();
        try {
          serviceScope = await startSurfaceServices(task.services, { env: supervisor.childEnv(runnerEnv(env, task.env)) });
          pre.phases.push(phase("surface-services", serviceStarted, 0));
        } catch (error) {
          exitCode = 1;
          serviceFailure = error;
          pre.phases.push(phase("surface-services", serviceStarted, 1));
        }
      }
      if (!serviceFailure && task.runner === "vitest") {
        const runnerConfig = path.join(resultsDir, `${safe(task.surfaceId)}.runner.config.mjs`);
        attemptResultPath = path.join(resultsDir, `${safe(task.surfaceId)}.attempts.ndjson`);
        fs.rmSync(attemptResultPath, { force: true });
        generatedInputPaths = [runnerConfig];
        writeVitestRunnerConfig({ configPath: runnerConfig, baseConfigPath: task.config, runnerPath: "scripts/test/vitest-attempt-reporter.mjs" });
        command = npx();
        args = ["vitest", "run", "--config", runnerConfig, ...task.assignedFiles.map((file) => path.resolve(file)), ...task.retryArgs, "--reporter=json", "--outputFile", task.nativeResultPath];
        childEnv = runnerEnv(env, task.env, serviceScope?.env, { TV_VITEST_ATTEMPT_FILE: attemptResultPath });
      } else if (!serviceFailure) {
        const list = path.join(resultsDir, `${safe(task.surfaceId)}-shard-${shardIndex}.test-list.txt`);
        fs.writeFileSync(list, `${task.assignedFiles.map((file) => playwrightListPath(file, task)).join("\n")}\n`);
        generatedInputPaths = [list];
        command = task.command;
        args = [...task.args, "--test-list", list, ...task.retryArgs, "--reporter=json"];
        childEnv = runnerEnv(env, task.env, serviceScope?.env, { PLAYWRIGHT_JSON_OUTPUT_NAME: task.nativeResultPath });
      }
      if (!serviceFailure) {
        commandStarted = Date.now();
        exitCode = (await supervisor.run(command, args, { env: childEnv, cwd: task.cwd, stdio: "inherit" })).exitCode;
      }
    }
  } finally {
    if (serviceScope) {
      const serviceStopped = Date.now();
      try {
        await serviceScope.stop();
        pre?.phases.push(phase("surface-services-stop", serviceStopped, 0));
      } catch (error) {
        exitCode = 1;
        serviceFailure = error;
        pre?.phases.push(phase("surface-services-stop", serviceStopped, 1));
      }
    }
    processLeaks = await supervisor.finish();
  }
  if (pre.failed) return failedTask(task, pre.exitCode, started, { preCommandsSkipped: skipPreCommands, failureKind: pre.failureKind, failureStep: "pre-command", failureMessage: pre.failureMessage, phases: pre.phases, processLeaks });
  const collected = task.runner === "vitest" ? collectedVitestFiles(task.nativeResultPath, task) : collectedPlaywrightFiles(task.nativeResultPath, task);
  const result = resultForTask(task, exitCode, started, { collectedFiles: collected, preCommandsSkipped: skipPreCommands, attemptResultPath, generatedInputPaths, phases: [...pre.phases, phase("runner", commandStarted, exitCode)], processLeaks });
  return serviceFailure ? { ...result, status: "failed", infraStatus: "incomplete", failureKind: "surface-service", failureStep: commandStarted ? "surface-service-stop" : "surface-service-start", failureMessage: serviceFailure.message ?? String(serviceFailure) } : result;
}

async function runPreCommands(tasks, { skipPreCommands, env, supervisor }) {
  const phases = [];
  if (skipPreCommands) {
    for (const task of tasks.filter((candidate) => candidate.preCommand)) phases.push({ name: `pre-command:${task.surfaceId}`, status: "skipped", reason: "prebuilt-artifact" });
    return { failed: false, exitCode: 0, failureKind: null, phases };
  }
  for (const task of tasks) {
    if (!task.preCommand) continue;
    const started = Date.now();
    const exitCode = (await supervisor.run(task.preCommand.command, task.preCommand.args, { env, cwd: task.preCommand.cwd, stdio: "inherit" })).exitCode;
    phases.push(phase(`pre-command:${task.surfaceId}`, started, exitCode));
    const processLeaks = await supervisor.checkForLeaks();
    if (exitCode !== 0 || processLeaks.length > 0) return {
      failed: true,
      exitCode,
      failureKind: processLeaks.length > 0 ? "process-leak" : "pre-command",
      failureMessage: processLeaks.length > 0
        ? `${processLeaks.length} owned process leak${processLeaks.length === 1 ? "" : "s"} survived the pre-command for ${task.surfaceId}`
        : `Pre-command for ${task.surfaceId} exited ${exitCode}`,
      phases,
    };
  }
  return { failed: false, exitCode: 0, failureKind: null, phases };
}

function taskFromSurface(surface, assignedFiles, { resultsDir, shardIndex, testRetries }) {
  const nativeResultPath = path.join(resultsDir, `native-${safe(surface.id)}-shard-${shardIndex}.json`);
  const cwd = path.resolve(surface.command ? "." : (surface.cwd || "."));
  const base = {
    suite: surface.kind, name: surface.id, surfaceId: surface.id, runner: surface.runner, cwd,
    config: surface.config, roots: surface.roots ?? [], excludeRoots: surface.excludeRoots ?? [], executionGroup: surface.executionGroup,
    assignedFiles, retryBudget: surface.kind === "unit" ? 0 : testRetries,
    nativeResultPath,
    services: surface.services ?? [],
    preCommand: surface.preCommand ? { command: surface.preCommand[0], args: surface.preCommand.slice(1), cwd: process.cwd() } : null,
    retryArgs: surface.kind === "unit" || testRetries === 0 ? [] : [surface.runner === "playwright" ? `--retries=${testRetries}` : `--retry=${testRetries}`],
  };
  if (surface.command) return { ...base, command: surface.command[0], args: surface.command.slice(1), env: {} };
  if (surface.runner === "playwright") return { ...base, command: npx(), args: ["playwright", "test", "--config", path.relative(cwd, path.resolve(surface.config))], env: {} };
  return { ...base, command: npx(), args: [], env: {} };
}

function resultForTask(task, exitCode, started, extras) {
  const comparison = compareAssignedAndCollected(task.assignedFiles, extras.collectedFiles ?? []);
  const mismatch = !comparison.matches;
  const processLeaks = extras.processLeaks ?? [];
  const leaked = processLeaks.length > 0;
  return {
    suite: task.suite, name: task.name, surfaceId: task.surfaceId, runner: task.runner,
    command: task.command, args: task.args, cwd: path.relative(process.cwd(), task.cwd) || ".",
    status: exitCode === 0 && !mismatch && !leaked ? "passed" : "failed", exitCode,
    startedAt: new Date(started).toISOString(), completedAt: new Date().toISOString(), durationMs: Date.now() - started,
    predictedDurationMs: undefined, retryBudget: task.retryBudget,
    assignedFiles: [...task.assignedFiles].sort(), collectedFiles: [...(extras.collectedFiles ?? [])].sort(),
    nativeResultPath: fs.existsSync(task.nativeResultPath) ? task.nativeResultPath : null,
    attemptResultPath: extras.attemptResultPath && fs.existsSync(extras.attemptResultPath) ? extras.attemptResultPath : null,
    workspaceNativeResultPath: extras.workspaceNativeResultPath ?? null,
    generatedInputPaths: extras.generatedInputPaths ?? [],
    preCommandsSkipped: extras.preCommandsSkipped,
    phases: extras.phases ?? [], processLeaks,
    ...(mismatch
      ? { infraStatus: "incomplete", failureKind: "collection-mismatch", failureStep: "collection-validation", failureMessage: JSON.stringify(comparison) }
      : leaked
        ? { infraStatus: "incomplete", failureKind: "process-leak", failureStep: "surface-cleanup", failureMessage: `${processLeaks.length} owned process leak${processLeaks.length === 1 ? "" : "s"} survived surface cleanup` }
        : {}),
  };
}

function failedTask(task, exitCode, started, extras) {
  return {
    ...resultForTask(task, exitCode, started, { ...extras, collectedFiles: [] }),
    failureKind: extras.failureKind,
    failureStep: extras.failureStep,
    ...(extras.failureMessage ? { failureMessage: extras.failureMessage } : {}),
  };
}

function preflightFailedTask(task, preflight) {
  return {
    suite: task.suite, name: task.name, surfaceId: task.surfaceId, runner: task.runner,
    command: task.command, args: task.args, cwd: path.relative(process.cwd(), task.cwd) || ".",
    status: "failed", infraStatus: "incomplete", exitCode: 1,
    startedAt: preflight.startedAt, completedAt: preflight.completedAt, durationMs: preflight.durationMs,
    retryBudget: task.retryBudget, assignedFiles: [...task.assignedFiles].sort(), collectedFiles: [],
    nativeResultPath: null, attemptResultPath: null, workspaceNativeResultPath: null, generatedInputPaths: [],
    preCommandsSkipped: false, phases: [], processLeaks: preflight.processLeaks ?? [],
    failureKind: preflight.failureKind ?? "preflight", failureStep: preflight.name ?? "process-lifecycle", failureMessage: preflight.message ?? "process-lifecycle preflight failed",
  };
}

function notAssignedResult(task) {
  return {
    suite: task.suite, name: task.name, surfaceId: task.surfaceId, runner: task.runner, status: "not-assigned", exitCode: null,
    durationMs: 0, retryBudget: task.retryBudget, assignedFiles: [], collectedFiles: [], preCommandsSkipped: false, phases: [], processLeaks: [], nativeResultPath: null, attemptResultPath: null, workspaceNativeResultPath: null, generatedInputPaths: [],
  };
}

function failFastSkippedResult(task) {
  return {
    suite: task.suite, name: task.name, surfaceId: task.surfaceId, runner: task.runner,
    command: task.command, args: task.args, cwd: path.relative(process.cwd(), task.cwd) || ".",
    status: "skipped", skipReason: "fail-fast", exitCode: null, durationMs: 0, retryBudget: task.retryBudget,
    assignedFiles: [...task.assignedFiles].sort(), collectedFiles: [], preCommandsSkipped: false, phases: [], processLeaks: [],
    nativeResultPath: null, attemptResultPath: null, workspaceNativeResultPath: null, generatedInputPaths: [],
  };
}

function collectedVitestFiles(nativeResultPath, task) {
  if (!fs.existsSync(nativeResultPath)) return [];
  const report = JSON.parse(fs.readFileSync(nativeResultPath, "utf8"));
  return (report.testResults ?? []).map((result) => normalizeCollected(result.name, task));
}

function collectedPlaywrightFiles(nativeResultPath, task) {
  if (!fs.existsSync(nativeResultPath)) return [];
  const report = JSON.parse(fs.readFileSync(nativeResultPath, "utf8"));
  const raw = [];
  collectSpecs(report.suites ?? [], raw);
  return [...new Set(raw.map((file) => normalizeCollected(file, task)))];
}

function collectSpecs(suites, out) {
  for (const suite of suites) {
    for (const spec of suite.specs ?? []) out.push(spec.file);
    collectSpecs(suite.suites ?? [], out);
  }
}

function normalizeCollected(file, task) {
  let normalized = path.isAbsolute(file) ? path.relative(process.cwd(), file) : String(file);
  normalized = normalized.replaceAll("\\", "/").replace(/^\.\//, "");
  const match = task.assignedFiles.filter((candidate) => candidate === normalized || candidate.endsWith(`/${normalized}`));
  if (match.length === 1) return match[0];
  const cwdCandidate = path.posix.join(path.relative(process.cwd(), task.cwd).replaceAll("\\", "/"), normalized).replace(/^\.\//, "");
  return task.assignedFiles.includes(cwdCandidate) ? cwdCandidate : normalized;
}

function playwrightListPath(file, task) {
  const roots = task.roots.filter((root) => file === root || file.startsWith(`${root}/`));
  if (roots.length !== 1) throw new Error(`${task.surfaceId} cannot derive one Playwright test-list root for ${file}`);
  const root = roots[0];
  return file === root ? path.posix.basename(file) : path.posix.relative(root, file);
}

async function loadWorkerConfig(env) {
  const override = env.TEST_SHARD_CONFIG_MODULE;
  if (!override) return loadTestConfig();
  if (env.TV_TEST_RUNNER_SELFTEST !== "1") throw new Error("TEST_SHARD_CONFIG_MODULE is a self-test seam and requires TV_TEST_RUNNER_SELFTEST=1");
  return (await import(pathToFileURL(path.resolve(override)).href)).default;
}

function run(command, args, env, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env, stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code) => resolve(code ?? 128));
  });
}

function phase(name, started, exitCode) {
  return { name, status: exitCode === 0 ? "passed" : "failed", startedAt: new Date(started).toISOString(), completedAt: new Date().toISOString(), durationMs: Date.now() - started };
}

function positiveInteger(value, name) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new Error(`${name} must be a positive integer`);
  return parsed;
}

function nonNegativeInteger(value, name) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error(`${name} must be a non-negative integer`);
  return parsed;
}

function git(...args) {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

function npx() { return process.platform === "win32" ? "npx.cmd" : "npx"; }
function safe(value) { return value.replace(/[^a-zA-Z0-9_.-]/g, "-"); }

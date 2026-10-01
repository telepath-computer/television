#!/usr/bin/env node
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { loadTestConfig, selectSurfaces } from "./test/config.mjs";
import { groupByExecutionGroup, splitVitestWorkspaceResult, vitestProjectsArgs } from "./test/execution-groups.mjs";
import { shouldSkipPreCommands } from "./test/prebuilt.mjs";
import { runnerEnv } from "./test/runner-env.mjs";
import { startSurfaceServices } from "./test/surface-services.mjs";

const npx = process.platform === "win32" ? "npx.cmd" : "npx";

const options = parseArgs(process.argv.slice(2));
if (options.plan || process.env.TEST_SHARD_PLAN) {
  try {
    const { runPlannedShard } = await import("./test/planned-shard-worker.mjs");
    process.exit(await runPlannedShard(options));
  } catch (error) {
    writePlannedFailureSummary(options, error);
    console.error(error?.stack ?? error?.message ?? error);
    process.exit(2);
  }
}
function writePlannedFailureSummary(rawOptions, error) {
  const shardIndex = Number.parseInt(rawOptions.shard ?? process.env.TEST_SHARD_INDEX ?? "", 10);
  const resultsDir = path.resolve(rawOptions["results-dir"] ?? process.env.TEST_SHARD_RESULTS_DIR ?? ".testshards/results");
  if (!Number.isSafeInteger(shardIndex) || shardIndex < 1) return;
  let plan = null;
  try {
    const planPath = path.resolve(rawOptions.plan ?? process.env.TEST_SHARD_PLAN ?? "");
    plan = JSON.parse(fs.readFileSync(planPath, "utf8"));
  } catch {}
  const shardTotal = Number.parseInt(rawOptions.total ?? process.env.TEST_SHARD_TOTAL ?? plan?.shardTotal ?? "", 10);
  const completedAt = new Date().toISOString();
  const summary = {
    schemaVersion: 1,
    status: "infra-failed",
    suite: "plan",
    shardIndex,
    shardTotal: Number.isSafeInteger(shardTotal) && shardTotal > 0 ? shardTotal : null,
    shard: Number.isSafeInteger(shardTotal) && shardTotal > 0 ? `${shardIndex}/${shardTotal}` : String(shardIndex),
    planId: plan?.planId ?? null,
    timingProvider: plan?.timingProvider ?? process.env.TV_TEST_TIMING_PROVIDER ?? null,
    testedCommit: plan?.testedCommit ?? null,
    testedTree: plan?.testedTree ?? null,
    failureKind: "plan-validation",
    failureStep: "plan-validation",
    failureMessage: String(error?.message ?? error),
    startedAt: completedAt,
    completedAt,
    durationMs: 0,
    phases: [],
    assignedFiles: [],
    collectedFiles: [],
    tasks: [],
  };
  fs.mkdirSync(resultsDir, { recursive: true });
  fs.writeFileSync(path.join(resultsDir, `shard-${shardIndex}.json`), `${JSON.stringify(summary, null, 2)}\n`);
}

const shardIndex = Number.parseInt(options.shard ?? process.env.TEST_SHARD_INDEX ?? "", 10);
const shardTotal = Number.parseInt(options.total ?? process.env.TEST_SHARD_TOTAL ?? "", 10);
const suite = options.suite ?? process.env.TEST_SHARD_SUITE ?? "all";
const surfaceIds = options.surfaces ?? process.env.TEST_SHARD_SURFACES ?? null;
const failFast = Boolean(options["fail-fast"]) || process.env.TEST_SHARD_FAIL_FAST === "1";
const resultsDir = options["results-dir"] ?? process.env.TEST_SHARD_RESULTS_DIR ?? ".testshards/results";
const testRetries = parseTestRetries(options["test-retries"] ?? process.env.TEST_RETRIES ?? "0");

if (!Number.isInteger(shardIndex) || !Number.isInteger(shardTotal) || shardIndex < 1 || shardTotal < 1 || shardIndex > shardTotal) {
  console.error("Usage: node scripts/run-test-shard.mjs --shard <1-based-index> --total <count> [--suite unit|e2e|all]");
  process.exit(2);
}

const config = loadTestConfig({ root: process.cwd() });
const shardArg = `--shard=${shardIndex}/${shardTotal}`;
const vitestNoTestsArg = "--passWithNoTests";
const playwrightNoTestsArg = "--pass-with-no-tests";
const selectedSurfaces = surfaceIds ? selectSurfaces(config, { surface: surfaceIds }) : selectSurfaces(config, { suite });
if (selectedSurfaces.length === 0) {
  const selectionDescription = surfaceIds ? `surface selection ${JSON.stringify(surfaceIds)}` : `suite ${JSON.stringify(suite)}`;
  console.error(`No surfaces selected for ${selectionDescription}.`);
  process.exit(2);
}

const executionGroups = groupTasksForShard(selectedSurfaces.map((surface) => taskFromSurface(surface)));

console.log(`test shard ${shardIndex}/${shardTotal}; suite=${suite}; failFast=${failFast}; testRetries=${testRetries}; selected surfaces=${selectedSurfaces.length}; selected execution groups=${executionGroups.length}; shard arg=${shardArg}`);
console.log("Every shard runs every selected execution group with native runner sharding applied to each member surface.");
for (const [index, group] of executionGroups.entries()) {
  console.log(`  ${index + 1}. ${group.name} (${group.tasks.length} surface${group.tasks.length === 1 ? "" : "s"})`);
  for (const task of group.tasks) {
    console.log(`     - [${task.suite}] ${task.name}: ${formatCommand(task.command, task.args)} (cwd=${task.cwd})`);
  }
}

fs.mkdirSync(resultsDir, { recursive: true });

const started = Date.now();
const startedAt = new Date().toISOString();
const taskResults = [];
let stoppedForFailFast = false;
for (const group of executionGroups) {
  const groupStarted = Date.now();
  console.log(`\n=== test shard execution group start: ${group.name} (${group.tasks.length} surface${group.tasks.length === 1 ? "" : "s"}) ===`);
  if (group.id === "unit:workspaces") {
    const { results, status } = await runVitestWorkspaceGroup(group);
    taskResults.push(...results);
    if (status !== 0 && failFast) stoppedForFailFast = true;
  } else {
    for (const task of group.tasks) {
      const taskStarted = Date.now();
      console.log(`\n--- test shard task start: [${task.suite}] ${task.name} ---`);
      if (task.preCommand) {
        console.log(`$ ${formatCommand(task.preCommand.command, task.preCommand.args)} (cwd=${task.preCommand.cwd})`);
        const preStatus = await run(task.preCommand.command, task.preCommand.args, process.env, task.preCommand.cwd);
        if (preStatus !== 0) {
          taskResults.push(resultForTask(task, preStatus, taskStarted));
          if (failFast) {
            stoppedForFailFast = true;
            break;
          }
          continue;
        }
      }
      console.log(`$ ${formatCommand(task.command, task.args)} (cwd=${task.cwd})`);
      let serviceScope = null;
      let status = 1;
      try {
        if (task.services.length > 0) serviceScope = await startSurfaceServices(task.services, { env: runnerEnv(process.env, task.env) });
        status = await run(task.command, task.args, runnerEnv(process.env, task.env, serviceScope?.env), task.cwd);
      } catch (error) {
        console.error(`surface service failure for ${task.name}: ${error.stack ?? error.message ?? error}`);
      } finally {
        if (serviceScope) {
          try {
            await serviceScope.stop();
          } catch (error) {
            status = 1;
            console.error(`surface service teardown failure for ${task.name}: ${error.stack ?? error.message ?? error}`);
          }
        }
      }
      const taskResult = resultForTask(task, status, taskStarted);
      taskResults.push(taskResult);
      if (status !== 0) {
        console.error(`--- test shard task failed: [${task.suite}] ${task.name}; exit=${status}; elapsed=${formatDuration(taskResult.durationMs)} ---`);
        if (failFast) {
          stoppedForFailFast = true;
          break;
        }
        continue;
      }
      console.log(`--- test shard task passed: [${task.suite}] ${task.name}; elapsed=${formatDuration(taskResult.durationMs)} ---`);
    }
  }
  console.log(`=== test shard execution group complete: ${group.name}; elapsed=${formatDuration(Date.now() - groupStarted)} ===`);
  if (stoppedForFailFast) break;
}

const failedTasks = taskResults.filter((task) => task.status === "failed");
const durationMs = Date.now() - started;
const summary = {
  status: failedTasks.length === 0 ? "passed" : "failed",
  suite,
  shardIndex,
  shardTotal,
  shard: `${shardIndex}/${shardTotal}`,
  shardArg,
  failFast,
  startedAt,
  completedAt: new Date().toISOString(),
  durationMs,
  selectedTaskCount: selectedSurfaces.length,
  assignedTaskCount: selectedSurfaces.length,
  selectedExecutionGroupCount: executionGroups.length,
  assignedExecutionGroupCount: executionGroups.length,
  executionGroups: executionGroups.map((group) => ({ id: group.id, name: group.name, surfaceIds: group.tasks.map((task) => task.surfaceId) })),
  shardingModel: "Every shard runs every selected registered test surface, coalesced into execution groups with native runner sharding applied to each member surface.",
  tasks: taskResults,
};
writeSummary(summary);

if (failedTasks.length > 0) {
  console.error(`\ntest shard ${shardIndex}/${shardTotal} failed in ${formatDuration(durationMs)}; failed tasks: ${failedTasks.map((task) => `${task.suite}:${task.name}`).join(", ")}`);
  process.exit(1);
}

console.log(`\ntest shard ${shardIndex}/${shardTotal} passed in ${formatDuration(durationMs)}`);

async function runVitestWorkspaceGroup(group) {
  const started = Date.now();
  const workspacePath = path.resolve(resultsDir, `workspace-${safeName(group.id)}-shard-${shardIndex}.mjs`);
  const nativeResultPath = path.resolve(resultsDir, `native-${safeName(group.id)}-shard-${shardIndex}.json`);
  const configs = group.tasks.map((task) => vitestWorkspaceProject(task));
  const attemptResultPath = path.resolve(resultsDir, `native-${safeName(group.id)}-shard-${shardIndex}.attempts.ndjson`);
  fs.rmSync(attemptResultPath, { force: true });
  const commandArgs = vitestProjectsArgs({ configPath: workspacePath, configPaths: configs });
  try {
    const preCommandResults = await runGroupedPreCommands(group, started);
    if (preCommandResults.some((result) => result.exitCode !== 0)) return { status: 1, results: preCommandResults };

    const args = [...commandArgs, shardArg, vitestNoTestsArg, "--reporter=json", "--outputFile", nativeResultPath];
    console.log(`\n--- test shard grouped task start: ${group.name} ---`);
    console.log(`$ ${formatCommand(npx, args)} (cwd=${process.cwd()})`);
    const status = await run(npx, args, runnerEnv(process.env, { TV_VITEST_ATTEMPT_FILE: attemptResultPath }), process.cwd());
    const splitStatuses = splitVitestWorkspaceResult({ nativeResultPath, tasks: group.tasks });
    const results = group.tasks.map((task) => {
      const taskStatus = status === 0 ? 0 : (splitStatuses.get(task.surfaceId) ?? status);
      const taskResult = resultForTask(task, taskStatus, started);
      if (fs.existsSync(task.nativeResultPath)) taskResult.nativeResultPath = task.nativeResultPath;
      if (fs.existsSync(attemptResultPath)) taskResult.attemptResultPath = attemptResultPath;
      return taskResult;
    });
    const failed = results.filter((result) => result.exitCode !== 0);
    if (failed.length) console.error(`--- test shard grouped task failed: ${group.name}; exit=${status}; elapsed=${formatDuration(Date.now() - started)}; failed surfaces=${failed.map((result) => result.surfaceId).join(",")} ---`);
    else console.log(`--- test shard grouped task passed: ${group.name}; elapsed=${formatDuration(Date.now() - started)} ---`);
    return { status, results };
  } finally {
    fs.rmSync(workspacePath, { force: true });
  }
}

async function runGroupedPreCommands(group, started) {
  const results = [];
  for (const task of group.tasks) {
    if (!task.preCommand) continue;
    console.log(`$ ${formatCommand(task.preCommand.command, task.preCommand.args)} (cwd=${task.preCommand.cwd})`);
    const status = await run(task.preCommand.command, task.preCommand.args, process.env, task.preCommand.cwd);
    if (status !== 0) results.push(resultForTask(task, status, started));
  }
  return results;
}

function vitestWorkspaceProject(task) {
  return path.resolve(process.cwd(), task.config);
}

function groupTasksForShard(tasks) {
  return groupByExecutionGroup(tasks, { getFallbackId: (task) => task.surfaceId }).map((group) => ({ ...group, tasks: group.items }));
}

function taskFromSurface(surface) {
  const name = surface.id;
  const safe = safeName(surface.id);
  const nativeResultPath = path.resolve(resultsDir, `native-${safe}-shard-${shardIndex}.json`);
  const cwd = path.resolve(surface.cwd || ".");
  const base = {
    suite: surface.kind,
    name,
    surfaceId: surface.id,
    runner: surface.runner,
    cwd,
    nativeResultPath,
    // --skip-pre-commands / TEST_SHARD_SKIP_PRECOMMANDS=1: the caller supplies
    // prebuilt outputs (specs/arch/test-runner/github-ci.md#build-once-fan-out).
    preCommand: surface.preCommand && !shouldSkipPreCommands(options) ? { command: surface.preCommand[0], args: surface.preCommand.slice(1), cwd: process.cwd() } : null,
    env: {},
    executionGroup: surface.executionGroup ?? null,
    config: surface.config,
    roots: surface.roots ?? [],
    excludeRoots: surface.excludeRoots ?? [],
    services: surface.services ?? [],
  };
  if (surface.command) {
    return {
      ...base,
      command: surface.command[0],
      args: [...surface.command.slice(1), shardArg, playwrightNoTestsArg, ...testRetryArgs(surface), "--reporter=json"],
      cwd: process.cwd(),
      env: { PLAYWRIGHT_JSON_OUTPUT_NAME: nativeResultPath },
    };
  }
  if (surface.runner === "vitest") {
    return {
      ...base,
      command: npx,
      args: ["vitest", "run", "--config", relativeTo(cwd, surface.config), shardArg, vitestNoTestsArg, ...testRetryArgs(surface), "--reporter=json", "--outputFile", nativeResultPath],
    };
  }
  if (surface.runner === "playwright") {
    return {
      ...base,
      command: npx,
      args: ["playwright", "test", "--config", relativeTo(cwd, surface.config), shardArg, playwrightNoTestsArg, ...testRetryArgs(surface), "--reporter=json"],
      env: { PLAYWRIGHT_JSON_OUTPUT_NAME: nativeResultPath },
    };
  }
  throw new Error(`Unsupported runner ${surface.runner} for ${surface.id}`);
}

function testRetryArgs(surface) {
  if (testRetries <= 0 || surface.kind === "unit") return [];
  if (surface.runner === "playwright") return [`--retries=${testRetries}`];
  if (surface.runner === "vitest") return [`--retry=${testRetries}`];
  return [];
}

function resultForTask(task, status, taskStarted) {
  return {
    suite: task.suite,
    name: task.name,
    surfaceId: task.surfaceId,
    runner: task.runner,
    command: task.command,
    args: task.args,
    cwd: path.relative(process.cwd(), task.cwd) || ".",
    shard: `${shardIndex}/${shardTotal}`,
    status: status === 0 ? "passed" : "failed",
    exitCode: status,
    startedAt: new Date(taskStarted).toISOString(),
    completedAt: new Date().toISOString(),
    durationMs: Date.now() - taskStarted,
    nativeResultPath: fs.existsSync(task.nativeResultPath) ? task.nativeResultPath : null,
  };
}

function parseTestRetries(raw) {
  const value = Number.parseInt(raw, 10);
  if (!Number.isInteger(value) || value < 0) {
    console.error("--test-retries/TEST_RETRIES must be a non-negative integer");
    process.exit(2);
  }
  return value;
}

function parseArgs(args) {
  const parsed = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = args[index + 1];
    if (next && !next.startsWith("--")) {
      parsed[key] = next;
      index += 1;
    } else {
      parsed[key] = "1";
    }
  }
  return parsed;
}

function writeSummary(summary) {
  const file = path.join(resultsDir, `shard-${shardIndex}.json`);
  fs.writeFileSync(file, `${JSON.stringify(summary, null, 2)}\n`);
}

function run(command, args, env, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env, stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (status, signal) => {
      if (status !== null) resolve(status);
      else {
        console.error(`${command} terminated by signal ${signal}`);
        resolve(128);
      }
    });
  });
}

function relativeTo(cwd, file) {
  return path.relative(cwd, path.resolve(file)) || ".";
}

function safeName(value) {
  return value.replace(/[^a-zA-Z0-9_.-]/g, "-");
}

function formatCommand(command, args) {
  return [command, ...args].map((value) => /\s/.test(String(value)) ? JSON.stringify(String(value)) : String(value)).join(" ");
}

function formatDuration(ms) {
  if (ms < 1000) return `${ms}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
}

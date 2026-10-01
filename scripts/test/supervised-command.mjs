#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createSurfaceSupervisor } from "./surface-supervisor.mjs";
import { startSurfaceServices } from "./surface-services.mjs";

const { runId, surfaceIds, resultPath, preCommand, services, command, args } = parseArgs(process.argv.slice(2));
const supervisor = createSurfaceSupervisor({ runId, surfaceIds });
let commandResult = { exitCode: 127, signal: null, error: null };
let cleanupError = null;
let executionFailure = null;
let processLeaks = [];
let serviceScope = null;
try {
  if (preCommand) {
    const preResult = await supervisor.run(preCommand[0], preCommand.slice(1), { cwd: process.cwd(), env: process.env, stdio: "inherit" });
    const preLeaks = await supervisor.checkForLeaks();
    if (preResult.exitCode !== 0 || preLeaks.length > 0) {
      commandResult = preResult;
      executionFailure = { kind: preLeaks.length > 0 ? "process-leak" : "pre-command", message: preLeaks.length > 0 ? `${preLeaks.length} owned process leak(s) remained after preCommand` : `preCommand exited ${preResult.exitCode}` };
    }
  }
  if (!executionFailure && services.length > 0) {
    try {
      serviceScope = await startSurfaceServices(services, { env: supervisor.childEnv(process.env) });
    } catch (error) {
      commandResult = { exitCode: 1, signal: null, error };
      executionFailure = { kind: "surface-service", message: error.message ?? String(error), step: "surface-service-start" };
    }
  }
  if (!executionFailure) {
    commandResult = await supervisor.run(command, args, { cwd: process.cwd(), env: serviceScope?.env ?? process.env, stdio: "inherit" });
  }
} finally {
  if (serviceScope) {
    try {
      await serviceScope.stop();
    } catch (error) {
      commandResult = { exitCode: 1, signal: null, error };
      executionFailure = { kind: "surface-service", message: error.message ?? String(error), step: "surface-service-stop" };
    }
  }
  try {
    processLeaks = await supervisor.finish();
  } catch (error) {
    cleanupError = error;
    processLeaks = Array.isArray(error?.processLeaks) ? error.processLeaks : supervisor.processLeaks;
  }
}

const failedForLifecycle = processLeaks.length > 0 || cleanupError !== null;
const publishedServices = serviceScope?.services ?? [];
const result = {
  schemaVersion: 1,
  runId,
  surfaceIds,
  command: [command, ...args],
  preCommand,
  services,
  publishedServices,
  exitCode: commandResult.exitCode,
  signal: commandResult.signal,
  processLeaks,
  failureKind: cleanupError?.name === "UnconfirmedSurfaceCleanupError" ? "unconfirmed-process-cleanup" : executionFailure?.kind ?? (failedForLifecycle ? "process-leak" : null),
  failureStep: executionFailure?.step ?? null,
  failureMessage: cleanupError?.message ?? executionFailure?.message ?? (processLeaks.length > 0 ? `${processLeaks.length} owned process leak(s) were reaped` : null),
};
fs.mkdirSync(path.dirname(resultPath), { recursive: true });
const temporary = `${resultPath}.${process.pid}.tmp`;
fs.writeFileSync(temporary, `${JSON.stringify(result, null, 2)}\n`);
fs.renameSync(temporary, resultPath);
if (commandResult.error) console.error(commandResult.error.stack ?? commandResult.error.message);
process.exit(failedForLifecycle || executionFailure ? 1 : commandResult.exitCode);

function parseArgs(argv) {
  const separator = argv.indexOf("--");
  if (separator < 0 || separator === argv.length - 1) fail("Usage: supervised-command --run-id <id> --surface <id[,id...]> --result <path> [--pre-command-json <json>] [--services-json <json>] -- <command> [args...]");
  const options = new Map();
  for (let index = 0; index < separator; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    if (!name?.startsWith("--") || value === undefined) fail("supervised-command options require --name value pairs");
    options.set(name.slice(2), value);
  }
  const runId = options.get("run-id");
  const surfaceIds = (options.get("surface") ?? "").split(",").filter(Boolean);
  const resultPath = options.get("result");
  if (!runId || surfaceIds.length === 0 || !resultPath) fail("supervised-command requires --run-id, --surface, and --result");
  return {
    runId,
    surfaceIds,
    resultPath: path.resolve(resultPath),
    preCommand: parseStringArray(options.get("pre-command-json"), "pre-command-json"),
    services: parseServices(options.get("services-json")),
    command: argv[separator + 1],
    args: argv.slice(separator + 2),
  };
}

function parseStringArray(raw, name) {
  if (raw === undefined) return null;
  let value;
  try { value = JSON.parse(raw); } catch { fail(`--${name} must be valid JSON`); }
  if (!Array.isArray(value) || value.length === 0 || value.some((entry) => typeof entry !== "string" || !entry)) fail(`--${name} must be a non-empty string array`);
  return value;
}

function parseServices(raw) {
  if (raw === undefined) return [];
  let value;
  try { value = JSON.parse(raw); } catch { fail("--services-json must be valid JSON"); }
  if (!Array.isArray(value)) fail("--services-json must be an array");
  return value;
}

function fail(message) {
  console.error(message);
  process.exit(2);
}

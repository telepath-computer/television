#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { loadTestConfig, owningSurfaces, selectSurfaces, validateRegistry } from "./config.mjs";
import { requiredPreflights, runPreflights, runRemotePreflight } from "./preflight.mjs";
import { normalizeSurfaceResult, safeSurfaceName } from "./reporting.mjs";
import { atomicWriteFile, createRunContext, finalizeRun, readRunDirectoryIdentity } from "./run-context.mjs";
import { BASELINE_TIMING_PROVIDER, updateTimingBaseline } from "./timing-baseline.mjs";
import { enumerateTestInventory } from "./file-inventory.mjs";
import { recommendShardCount } from "./shard-plan.mjs";
import { normalizeBlaxelSurfaces, normalizeProviderTimingShards, resolveProviderRunGit } from "./provider-normalization.mjs";
import { providerCommandExitCode } from "./provider-outputs.mjs";
import { groupByExecutionGroup, splitVitestWorkspaceResult, writeVitestRunnerConfig, vitestProjectsArgs } from "./execution-groups.mjs";
import { applyCursorAgentEnvWorkaround } from "./cursor-agent-env.mjs";
import { createSurfaceSupervisor } from "./surface-supervisor.mjs";
import { startSurfaceServices } from "./surface-services.mjs";
import { reapStaleOwnerProcesses } from "./stale-owner-reaper.mjs";
import { attestationModeFromEnv, canonicalRetryFacts, collectRunSurfaces, maybePublishAttestation, pruneTestpassRefs, readAttestationPolicyForMode } from "./attestation.mjs";
import { isQualifyingRun } from "./publication-eligibility.mjs";
import { appendPhaseMetricFile, appendRunSummaryPhase, phaseFromEpoch, recordPhaseMetricBestEffort } from "./phase-metrics.mjs";
import { DEFAULT_BLAXEL_POOL_SIZE, RECOMMENDED_TEST_SHARD_COUNT } from "../testshard-constants.mjs";

applyCursorAgentEnvWorkaround(process.env);

const args = process.argv.slice(2);
const command = args[0] ?? "help";
const options = command === "pool" ? parseArgs(args.slice(3))
  : command === "testpass" || command === "baseline" ? parseArgs(args.slice(2))
    : parseArgs(args.slice(1), { allowPositionals: command === "verify" });
const config = command === "testpass" ? null : loadTestConfig();

try {
  if (Object.prototype.hasOwnProperty.call(options, "publish")) fail("--publish is not a supported option. A qualifying Blaxel verify publishes its attestation automatically; use --no-publish to opt out.");
  if (command === "help" || options.help) help();
  else if (command === "list") await list();
  else if (command === "preflight") await preflight();
  else if (["local", "blaxel"].includes(command)) await runProviderShortcut(command);
  else if (command === "verify") await verify();
  else if (command === "pool") await pool();
  else if (command === "testpass") await testpass();
  else if (command === "baseline") await baseline();
  else fail(`Unknown command ${JSON.stringify(command)}. Run npm test -- help.`);
} catch (error) {
  fail(error.message || error);
}

async function list() {
  assertRegistryValid();
  const surfaces = selectSurfaces(config, options);
  for (const surface of surfaces) {
    console.log(`${surface.id}\t${surface.kind}\t${surface.runner}\t${surface.package ?? "-"}\t${surface.config}\t${surface.tags.join(",")}`);
  }
}

async function preflight() {
  const provider = requireProvider();
  assertRegistryValid();
  const surfaces = selectedSurfaces({ requireSelection: false });
  enforceExecutionPlacement(provider, surfaces);
  const results = provider === "local"
    ? runProviderPreflights(provider, surfaces)
    : runRemotePreflightAndPrint(provider, options).results;
  if (results.some((result) => result.status !== "passed")) process.exit(1);
}

async function verify() {
  assertRegistryValid();
  if (process.env.TV_TEST_RUNNER_FAKE_VERIFY_PHASES) fail("TV_TEST_RUNNER_FAKE_VERIFY_PHASES is no longer supported; verify never skips phases and reports a pass.");
  if (process.env.TV_TEST_RUNNER_DRY_RUN === "1") {
    requireSelftestSeam("TV_TEST_RUNNER_DRY_RUN");
    fail("TV_TEST_RUNNER_DRY_RUN cannot be used with verify; verify requires a finalized test run.");
  }
  const provider = resolveVerifyProvider();
  const runDirOutput = path.join(os.tmpdir(), `tv-verify-run-dir-${process.pid}`);
  const phases = verifyPhases(provider, runDirOutput);
  if (options.plan) {
    console.log(`verify plan (${provider})`);
    for (const phase of phases) console.log(`[verify:${phase.name}] ${[phase.command, ...phase.args].map(shellDisplay).join(" ")}`);
    return;
  }
  try {
    fs.rmSync(runDirOutput, { force: true });
  } catch (error) {
    console.error(`[verify] could not clear stale run identity ${runDirOutput}: ${error.message}`);
    process.exitCode = 1;
    return;
  }
  const attestationStart = beginVerifyAttestationFacts();
  const verifyStarted = Date.now();
  const metricsDir = path.resolve(".test-runs");
  fs.mkdirSync(metricsDir, { recursive: true });
  const identity = `${process.pid}-${verifyStarted}`;
  const metricsFile = path.join(metricsDir, `.verify-phases-${identity}.ndjson`);
  let verifiedRunDir = null;
  try {
    for (const phase of phases) {
      const phaseStarted = Date.now();
      console.log(`\n[verify:${phase.name}] ${[phase.command, ...phase.args].map(shellDisplay).join(" ")}`);
      const status = spawnSync(phase.command, phase.args, { cwd: process.cwd(), env: { ...process.env, TV_TEST_PHASE_METRICS_FILE: metricsFile }, stdio: "inherit" }).status ?? 1;
      let phaseRunDir = null;
      let identityError = null;
      if (phase.name === "tests" && status === 0) {
        try {
          phaseRunDir = readRunDirectoryIdentity(runDirOutput);
          verifiedRunDir = phaseRunDir;
        } catch (error) {
          identityError = error;
        }
      } else if (phase.name === "tests" && fs.existsSync(runDirOutput)) {
        phaseRunDir = recordPhaseMetricBestEffort("read failed verify test run identity", () => readRunDirectoryIdentity(runDirOutput));
      }
      const metricStatus = status === 0 && identityError === null ? "passed" : "failed";
      const metric = recordPhaseMetricBestEffort(`construct verify:${phase.name}`, () => phaseFromEpoch({ name: `verify:${phase.name}`, category: phase.name === "tests" ? "test" : "verification", status: metricStatus, startedMs: phaseStarted }));
      if (metric) {
        recordPhaseMetricBestEffort(`append verify:${phase.name} sidecar`, () => appendPhaseMetricFile(metricsFile, metric));
        if (phaseRunDir) recordPhaseMetricBestEffort(`append verify:${phase.name} run summary`, () => appendRunSummaryPhase({ runDir: phaseRunDir, phase: metric }));
      }
      if (identityError) {
        console.error(`[verify:tests] test child exited zero without a valid run identity: ${identityError.message}`);
        process.exitCode = 1;
        return;
      }
      if (status !== 0) { process.exitCode = status; return; }
    }
    if (!verifiedRunDir) {
      console.error("[verify:tests] test child exited zero without a valid run identity");
      process.exitCode = 1;
      return;
    }
    recordPhaseMetricBestEffort("append verify:total run summary", () => appendRunSummaryPhase({ runDir: verifiedRunDir, phase: phaseFromEpoch({ name: "verify:total", category: "verification", startedMs: verifyStarted }) }));
    console.log(`verify passed (${provider})`);
    finishVerifyAttestation(attestationStart, verifiedRunDir, provider);
  } finally {
    recordPhaseMetricBestEffort("remove verify phase sidecar", () => fs.rmSync(metricsFile, { force: true }));
    recordPhaseMetricBestEffort("remove verify run identity", () => fs.rmSync(runDirOutput, { force: true }));
  }
}

// Tree-hash attestation handoff (specs/arch/test-runner/attestation.md#who-writes-and-when).
// Eligibility-qualified publication: verify captures its facts around the
// phases and publishes only when every clause holds; every other outcome is
// a logged no-op, and no failure here can fail the verify.
function testpassLabMode() {
  return attestationModeFromEnv() === "lab";
}

function readAttestationPolicy() {
  return readAttestationPolicyForMode(attestationModeFromEnv());
}

function gitCapture(args) {
  const result = spawnSync("git", args, { cwd: process.cwd(), encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() : null;
}

function beginVerifyAttestationFacts() {
  return {
    treeAtStart: gitCapture(["rev-parse", "HEAD^{tree}"]),
    cleanAtStart: gitCapture(["status", "--short"]) === "",
    policyAtStart: readAttestationPolicy(),
  };
}

function finishVerifyAttestation(start, runDir, provider) {
  try {
    if (options["no-publish"]) {
      console.log("[attestation] not published (--no-publish)");
      return;
    }
    const targetCommit = options.commit ?? "HEAD";
    const testedTree = gitCapture(["rev-parse", `${targetCommit}^{tree}`]);
    let surfaces = [];
    try {
      surfaces = collectRunSurfaces(runDir);
    } catch {
      surfaces = [];
    }
    const facts = {
      treeAtStart: start.treeAtStart,
      treeAtEnd: gitCapture(["rev-parse", "HEAD^{tree}"]),
      testedTree,
      cleanAtStart: start.cleanAtStart,
      cleanAtEnd: gitCapture(["status", "--short"]) === "",
      ignoreUncommitted: allowsUncommitted(options),
      qualifyingRun: isQualifyingRun({ provider, selectionOptions: options }),
      surfaces,
      expectedSurfaceIds: selectSurfaces(config, { suite: "all" }).map((surface) => surface.id),
      shardSubset: Boolean(options["shard-indices"]),
      targetedSelection: Boolean(options.file || options.grep || options.surface || options.package || options.runner || options.tag || (options.suite && options.suite !== "all")),
      canonicalRetries: canonicalRetryFacts({ retriesOption: options.retries, env: process.env }),
      attestedSkipRun: false,
      policyAtStart: start.policyAtStart,
      policyAtEnd: readAttestationPolicy(),
    };
    maybePublishAttestation({
      facts,
      commit: gitCapture(["rev-parse", `${targetCommit}^{commit}`]),
      mode: testpassLabMode() ? "lab" : "production",
    });
  } catch (error) {
    console.error(`[attestation] publish attempt errored (non-fatal): ${error.message}`);
  }
}

function resolveVerifyProvider() {
  const positional = positionalProvider();
  const requested = options.provider ?? positional ?? "auto";
  if (!["auto", "local", "blaxel"].includes(requested)) fail("verify provider must be one of: auto, local, blaxel");
  if (options.provider && positional) fail("Pass verify provider either positionally or with --provider, not both.");
  if (requested === "local") enforceLocalVerifyGuardrail();
  if (requested !== "auto") {
    console.log(`[verify] provider=${requested} (${options.provider ? `explicit --provider ${requested}` : `explicit positional provider ${requested}`})`);
    return requested;
  }

  if (!fs.existsSync(path.join(os.homedir(), ".tvdev-use-blaxel"))) {
    console.log("[verify] provider=local (auto)");
    return "local";
  }

  const remote = runRemotePreflight("blaxel", options, { allowPassingSelftest: Boolean(options.plan) });
  const failed = remote.results.find((result) => result.status !== "passed");
  if (!failed) {
    console.log(`[verify] provider=blaxel (auto: Blaxel preflight passed${remote.git?.commit ? `; commit ${remote.git.commit.slice(0, 12)} is reachable from origin` : ""})`);
    return "blaxel";
  }

  fail(`The default broad verification strategy should be blaxel, which requires a clean working tree and all code pushed to origin. Blaxel preflight failed at ${failed.name}${failed.message ? `: ${failed.message}` : ""} ${preflightRemediation(failed)}\nEscape hatch: npm run verify -- local --allow-extreme-inefficiency`);
}

function enforceLocalVerifyGuardrail() {
  if (!fs.existsSync(path.join(os.homedir(), ".tvdev-use-blaxel")) || options["allow-extreme-inefficiency"]) return;
  fail("~/.tvdev-use-blaxel is present. Use Blaxel for full verification: npm run verify -- blaxel. With explicit human permission under testing policy, allow local verification using npm run verify -- local --allow-extreme-inefficiency.");
}

function positionalProvider() {
  const positional = options._ ?? [];
  if (positional.length === 0) return null;
  if (positional.length > 1) fail("verify accepts at most one positional provider: local or blaxel");
  const provider = positional[0];
  if (!["local", "blaxel"].includes(provider)) fail("verify positional provider must be one of: local, blaxel");
  return provider;
}

function preflightRemediation(result) {
  if (result.name === "working-tree") return "Remediation: commit or stash local changes before broad verification.";
  if (result.name === "origin-reachable") return "Remediation: push the commit to origin before broad verification.";
  if (["blaxel-github-token", "blaxel-auth"].includes(result.name)) return "Remediation: Blaxel is unavailable here; choose a provider explicitly if this is intentional.";
  return "Remediation: fix the named preflight, or choose a provider explicitly if this environment cannot use Blaxel.";
}

function verifyPhases(provider, runDirOutput = null) {
  if (provider === "local") {
    return [
      { name: "preflight", command: process.execPath, args: ["scripts/test/cli.mjs", "preflight", "--provider", "local", "--suite", "all"] },
      { name: "lint", command: npmCommand(), args: ["run", "--silent", "lint"] },
      { name: "type-check", command: npmCommand(), args: ["run", "--silent", "type-check"] },
      { name: "package-manifests", command: npmCommand(), args: ["run", "--silent", "lint:package-manifests"] },
      { name: "tests", command: process.execPath, args: ["scripts/test/cli.mjs", "local", "--suite", "all", "--force", "--retries", options.retries ?? "2", ...(runDirOutput ? ["--run-dir-output", runDirOutput] : [])] },
      vibeModePhase(),
    ];
  }
  const remoteArgs = remoteVerifyArgs();
  return [
    { name: "lint", command: npmCommand(), args: ["run", "--silent", "lint"] },
    { name: "type-check", command: npmCommand(), args: ["run", "--silent", "type-check"] },
    { name: "package-manifests", command: npmCommand(), args: ["run", "--silent", "lint:package-manifests"] },
    { name: "tests", command: process.execPath, args: ["scripts/test/cli.mjs", provider, ...remoteArgs, "--suite", "all", "--force", ...(runDirOutput ? ["--run-dir-output", runDirOutput] : [])] },
    vibeModePhase(),
  ];
}

// Last verify phase (specs/arch/test-runner/test-runner.md#^verify-vibe-mode):
// fails on a vibe branch after every other phase has reported normally.
function vibeModePhase() {
  return { name: "vibe-mode", command: process.execPath, args: ["scripts/test/vibe-mode-check.mjs"] };
}

function remoteVerifyArgs() {
  const out = ["--commit", options.commit ?? "HEAD", "--retries", options.retries ?? "2"];
  for (const key of ["ref", "shards", "shard-indices", "timeout-profile", "retry-infra", "arch", "pool", "allow-shard-count-override"]) {
    if (options[key]) out.push(`--${key}`, options[key]);
  }
  if (allowsUncommitted(options)) out.push("--ignore-uncommitted");
  return out;
}

async function pool() {
  const provider = args[1];
  const action = args[2];
  if (provider !== "blaxel" || !["list", "ensure", "delete"].includes(action)) fail(`Usage: npm test -- pool blaxel <list|ensure|delete> [--pool poc] [--size ${DEFAULT_BLAXEL_POOL_SIZE}]`);
  const delegateArgs = ["scripts/manage-blaxel-testshards.mjs", action];
  for (const [key, value] of Object.entries(options)) {
    delegateArgs.push(`--${key}`);
    if (value !== "1") delegateArgs.push(value);
  }
  const result = spawnSync(process.execPath, delegateArgs, { cwd: process.cwd(), env: process.env, stdio: "inherit" });
  process.exit(result.status ?? 1);
}

// Attestation prune (specs/arch/test-runner/attestation.md#prune-and-retention).
// Dry-run by default; every refusal and any partial deletion failure exits
// non-zero. TV_TESTPASS_LAB=1 selects lab mode, as on every attestation path.
async function testpass() {
  const action = args[1];
  if (action !== "prune") fail("Usage: npm test -- testpass prune <--older-than 30d|--dead-version <n>|--delete-ref <ref>> [--apply]");
  const modes = ["older-than", "dead-version", "delete-ref"].filter((flag) => options[flag] != null);
  if (modes.length > 1) fail("choose one prune mode: --older-than, --dead-version, or --delete-ref");
  const request = { mode: testpassLabMode() ? "lab" : "production", apply: Boolean(options.apply) };
  if (options["delete-ref"] != null) request.deleteRef = String(options["delete-ref"]);
  else if (options["dead-version"] != null) {
    if (!/^[1-9][0-9]*$/.test(String(options["dead-version"]))) fail("--dead-version must be a positive integer");
    request.deadVersion = Number.parseInt(options["dead-version"], 10);
  } else request.olderThanDays = parseOlderThan(options["older-than"] ?? "30d");
  const result = pruneTestpassRefs(request);
  if (result.status === "refused-policy" || result.status === "refused") {
    console.error(`testpass prune refused (${result.mode}): ${result.message}`);
    process.exit(1);
  }
  for (const candidate of result.candidates) {
    const outcome = result.deleted.includes(candidate.ref) ? "deleted"
      : result.failed.some((entry) => entry.ref === candidate.ref) ? "FAILED"
        : result.notDeleted.includes(candidate.ref) ? "not deleted"
          : "would delete";
    console.log(`${outcome} ${candidate.ref} ${candidate.objectId}${candidate.valid ? "" : " (malformed)"}`);
  }
  console.log(`${result.candidates.length} attestation ref(s) ${result.apply ? `processed; ${result.deleted.length} deleted` : "selected; dry run"} (${result.mode}, version ${result.version})`);
  if (result.status === "failed") {
    for (const failure of result.failed) console.error(`deletion failed: ${failure.ref}: ${failure.message}`);
    console.error(`${result.notDeleted.length} candidate(s) not deleted`);
    process.exit(1);
  }
}

async function baseline() {
  if (args[1] !== "update") fail("Usage: npm test -- baseline update [--dry-run]");
  const result = updateTimingBaseline({ config: { ...config, root: process.cwd() }, dryRun: Boolean(options["dry-run"]) });
  for (const change of result.changes) console.log(`${change.status} ${change.key}`);
  const recommendation = blaxelShardRecommendation({ baseline: result.baseline, baselineBytes: result.bytes });
  if (recommendation) console.log(`recommendation ${recommendation.timingProvider}: shards=${recommendation.recommendedCount} predictedMaxMs=${recommendation.recommendedMaximumPredictedDurationMs} current=${recommendation.currentCount}/${recommendation.currentMaximumPredictedDurationMs} capacity=${recommendation.capacity} totalMs=${recommendation.totalPredictedFileWorkMs} heaviestMs=${recommendation.heaviestAtomicFileMs} lowerBoundMs=${recommendation.arithmeticLowerBoundMs}${recommendation.atomicFileExceedsTarget ? " split-or-optimize-heaviest-file" : ""}`);
  console.log(`timing baseline ${result.dryRun ? "dry run" : result.changed ? "updated" : "unchanged"}; runs=${result.runs.length}; entries=${Object.keys(result.baseline.files).length}`);
}

// Only Blaxel's shard count is recommended: the baseline holds Blaxel time
// (specs/arch/test-runner/sharded-execution.md#Shard-count scaling).
function blaxelShardRecommendation({ baseline, baselineBytes }) {
  if (Object.keys(baseline.files).length === 0) return null;
  const selected = selectSurfaces(config, { suite: "all" });
  const inventory = enumerateTestInventory({ surfaces: config.surfaces, selectedSurfaceIds: selected.map((surface) => surface.id) });
  const testedCommit = spawnText("git", ["rev-parse", "HEAD"]).trim();
  const testedTree = spawnText("git", ["rev-parse", "HEAD^{tree}"]).trim();
  return recommendShardCount({ inventory, surfaces: selected, baseline, baselineBytes, timingProvider: BASELINE_TIMING_PROVIDER, testedCommit, testedTree, capacity: DEFAULT_BLAXEL_POOL_SIZE, currentCount: RECOMMENDED_TEST_SHARD_COUNT });
}

function parseOlderThan(value) {
  const match = /^([1-9][0-9]*)d$/.exec(String(value));
  if (!match) fail("--older-than must use positive whole days, for example 30d");
  return Number(match[1]);
}

async function runProviderShortcut(provider) {
  const selectionOptions = defaultAllSelection(options);
  if (isBroadShortcutSelection(selectionOptions) && !selectionOptions.force) {
    fail("Do not use this command for broad verification. Use npm run verify which also includes other critical verifications.");
  }
  await runWithSelection(provider, selectionOptions);
}

function defaultAllSelection(selectionOptions) {
  if (hasSelection(selectionOptions)) return selectionOptions;
  return { ...selectionOptions, suite: "all" };
}

function hasSelection(selectionOptions) {
  return Boolean(selectionOptions.all || selectionOptions.suite || selectionOptions.surface || selectionOptions.package || selectionOptions.file || selectionOptions.runner || selectionOptions.tag);
}

function isBroadShortcutSelection(selectionOptions) {
  if (selectionOptions.file || selectionOptions.surface || selectionOptions.package || selectionOptions.runner || selectionOptions.tag) return false;
  return selectionOptions.suite === "all" || Boolean(selectionOptions.all);
}

function allowsUncommitted(selectionOptions) {
  return Boolean(selectionOptions["ignore-uncommitted"]);
}

async function runWithSelection(provider, selectionOptions) {
  assertRegistryValid();
  const surfaces = selectedSurfaces({ options: selectionOptions, requireSelection: true });
  enforceExecutionPlacement(provider, surfaces);
  if (process.env.TV_TEST_RUNNER_FAKE_LOCAL_PREFLIGHT) requireSelftestSeam("TV_TEST_RUNNER_FAKE_LOCAL_PREFLIGHT");
  const testRetries = resolveTestRetries(selectionOptions, surfaces);
  if (process.env.TV_TEST_RUNNER_DRY_RUN === "1") {
    requireSelftestSeam("TV_TEST_RUNNER_DRY_RUN");
    const selection = selectionSummary(selectionOptions, surfaces);
    console.log(`[dry-run] provider=${provider} suite=${selection.suite ?? "-"} surfaces=${selection.surfaces.join(",")} files=${selection.files.join(",")}`);
    return;
  }
  if (provider === "blaxel") return runBlaxel(selectionOptions, surfaces, testRetries);
  if (provider !== "local") fail(`Provider ${provider} is not implemented in the canonical CLI yet.`);
  const runContext = createProviderRunContext(provider);
  writeRunDirOutput(selectionOptions, runContext);
  const startedAt = new Date().toISOString();
  const selection = selectionSummary(selectionOptions, surfaces);
  fs.writeFileSync(path.join(runContext.runDir, "request.json"), `${JSON.stringify({ provider, selection, surfaces: surfaces.map((surface) => surface.id), startedAt }, null, 2)}\n`);

  const preflights = runPreflights(requiredPreflights(surfaces, provider), { provider });
  const failedPreflight = preflights.find((result) => result.status !== "passed");
  if (failedPreflight) {
    const completedAt = new Date().toISOString();
    finalizeRun({ runContext, selection, git: localGit(), preflights, surfaces: [], startedAt, completedAt });
    console.error(`preflight failed: ${failedPreflight.name}: ${failedPreflight.message ?? "no diagnostic available"}; summary: ${path.join(runContext.runDir, "summary.json")}`);
    process.exit(1);
  }

  const startupOwners = await reapStaleOwnerProcesses();
  console.log(`[stale-owner-cleanup] ${startupOwners.message}`);
  if (startupOwners.staleDetected || !startupOwners.cleanupConfirmed) {
    stopForStaleOwners({ startupOwners, surfaces, runContext, selection, selectionOptions, preflights, startedAt });
  }

  if (!selectionOptions.file && !selectionOptions.grep) {
    return runLocalGrouped(selectionOptions, surfaces, runContext, selection, preflights, startedAt, testRetries);
  }

  const surfaceResults = [];
  for (const surface of surfaces) {
    const result = await runLocalSurface(surface, selectionOptions, runContext.runDir, testRetries);
    surfaceResults.push(result);
    if (hasUnconfirmedSurfaceCleanup(result)) break;
  }
  const completedAt = new Date().toISOString();
  const { summary } = finalizeRun({ runContext, selection, git: localGit(), preflights, surfaces: surfaceResults, startedAt, completedAt });
  printSummary(summary, runContext.runDir);
  process.exit(summary.run.status === "passed" ? 0 : 1);
}

function stopForStaleOwners({ startupOwners, surfaces, runContext, selection, selectionOptions, preflights, startedAt }) {
  const logPath = path.join(runContext.runDir, "logs", "stale-owner-cleanup.json");
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  fs.writeFileSync(logPath, `${JSON.stringify(startupOwners, null, 2)}\n`);
  const byId = new Map(surfaces.map((surface) => [surface.id, surface]));
  const ownerSurfaceIds = [...new Set(startupOwners.processLeaks.flatMap((leak) => leak.owningSurfaceIds))].sort();
  const failedSurfaces = ownerSurfaceIds.map((id) => ({
    ...normalizeSurfaceResult({
      surface: byId.get(id) ?? { id, runner: "lifecycle" },
      command: [process.execPath, "scripts/test/stale-owner-reaper-cli.mjs"],
      exitCode: 1,
      durationMs: 0,
      logPath: relative(logPath),
      nativeResultPath: null,
      processLeaks: startupOwners.processLeaks,
    }),
    counts: { testsTotal: 0, testsPassed: 0, testsFailed: 0, testsSkipped: 0, testsFlakyRecovered: 0 },
    failedTests: [],
    flakyRecoveredTests: [],
    files: [],
    infraStatus: "incomplete",
    failureKind: "stale-owner",
    failureStep: "startup-owner-cleanup",
    failureMessage: startupOwners.message,
  }));
  const completedAt = new Date().toISOString();
  const { summary } = finalizeRun({ runContext, selection, git: localGit(), preflights, surfaces: failedSurfaces, startedAt, completedAt });
  printSummary(summary, runContext.runDir);
  process.exit(1);
}

async function runBlaxel(selectionOptions, surfaces, testRetries = 0) {
  const remote = runRemotePreflightAndPrint("blaxel", selectionOptions);
  assertPreflightsPassed(remote.results);
  const git = remote.git;
  const runContext = createProviderRunContext("blaxel");
  writeRunDirOutput(selectionOptions, runContext);
  const outputDir = path.join(runContext.runDir, "provider", "blaxel");
  fs.mkdirSync(outputDir, { recursive: true });
  const args = ["scripts/run-blaxel-testshards.mjs", "--pool", selectionOptions.pool ?? "poc", "--commit", selectionOptions.commit ?? "HEAD", "--output-dir", outputDir];
  if (selectionOptions["timeout-profile"]) args.push("--timeout-profile", selectionOptions["timeout-profile"]);
  else args.push("--timeout-profile", "cold");
  if (selectionOptions.shards) args.push("--shards", selectionOptions.shards);
  if (selectionOptions["shard-indices"]) args.push("--shard-indices", selectionOptions["shard-indices"]);
  if (selectionOptions["allow-shard-count-override"]) args.push("--allow-shard-count-override", selectionOptions["allow-shard-count-override"]);
  if (selectionOptions["retry-infra"]) args.push("--retry-infra", selectionOptions["retry-infra"]);
  else args.push("--retry-infra", "2");
  if (allowsUncommitted(selectionOptions)) args.push("--allow-dirty");
  if (testRetries > 0) args.push("--test-retries", String(testRetries));

  if (selectionOptions.file || selectionOptions.grep || selectionOptions.surface) {
    if (surfaces.length !== 1) fail("Blaxel targeted runs require a selection that resolves to exactly one surface.");
    const surface = surfaces[0];
    if (!["vitest", "playwright"].includes(surface.runner)) fail(`Blaxel targeted runs do not support runner ${surface.runner}.`);
    args.push(
      "--suite", "target",
      "--shards", "1",
      "--target-surface-id", surface.id,
      "--target-runner", surface.runner,
      "--target-config", relativeToCwd(surface, surface.config),
      "--target-cwd", surface.command ? "." : surface.cwd || ".",
      "--target-retries", String(testRetries),
    );
    if (surface.command) args.push("--target-command-json", JSON.stringify(surface.command));
    if (surface.preCommand) args.push("--target-pre-command-json", JSON.stringify(surface.preCommand));
    if (surface.services.length > 0) args.push("--target-services-json", JSON.stringify(surface.services));
    if (selectionOptions.file) args.push("--target-file", surface.command ? selectionOptions.file : relativeToCwd(surface, selectionOptions.file));
    if (selectionOptions.grep) args.push("--target-grep", selectionOptions.grep);
  } else if (selectionOptions.package || selectionOptions.runner || selectionOptions.tag) {
    args.push("--suite", "selection", "--surfaces", surfaces.map((surface) => surface.id).join(","));
  } else {
    const suite = selectionOptions.suite ?? (selectionOptions.all ? "all" : null);
    if (!["all", "unit", "e2e"].includes(suite)) fail("Blaxel suite runs require --suite all|unit|e2e or --all. The telemetry PostHog roundtrip suite is local-only because it requires the PostHog test read key.");
    args.push("--suite", suite);
  }

  fs.writeFileSync(path.join(runContext.runDir, "request.json"), `${JSON.stringify({ provider: "blaxel", git, selection: selectionSummary(selectionOptions, surfaces), delegatedCommand: [process.execPath, ...args] }, null, 2)}\n`);
  console.log(`[blaxel] ${[process.execPath, ...args].map(shellDisplay).join(" ")}`);
  const exitCode = await runProcess(process.execPath, args, { logPath: path.join(runContext.runDir, "logs", "blaxel.log"), cwd: process.cwd(), env: process.env });
  const providerSummaryPath = path.join(outputDir, "report.json");
  const providerSummary = readJson(providerSummaryPath) ?? readJson(path.join(outputDir, "summary.json"));
  const startedAt = providerSummary?.startedAt ?? new Date().toISOString();
  const completedAt = providerSummary?.completedAt ?? new Date().toISOString();
  const coordinatorLogPath = path.join(runContext.runDir, "logs", "blaxel.log");
  const normalizedSurfaces = normalizeBlaxelSurfaces({ providerSummary, outputDir, surfaces, delegatedCommand: [process.execPath, ...args], exitCode, coordinatorLogPath });
  const timingShards = providerSummary?.plan ? normalizeProviderTimingShards({ providerSummary, outputDir, surfaces, coordinatorLogPath }) : null;
  const { summary } = finalizeRun({
    runContext, selection: selectionSummary(selectionOptions, surfaces), git: resolveProviderRunGit({ providerSummary, fallbackGit: git }), preflights: [], surfaces: normalizedSurfaces, startedAt, completedAt, phases: providerSummary?.phases ?? [],
    shard: { planId: providerSummary?.plan?.planId, timingBaselineDigest: providerSummary?.plan?.timingBaselineDigest },
    shards: timingShards,
  });
  printSummary(summary, runContext.runDir);
  process.exit(providerCommandExitCode({ delegatedExitCode: exitCode, reportStatus: summary.run.status }));
}

async function runLocalGrouped(selectionOptions, surfaces, runContext, selection, preflights, startedAt, testRetries = 0) {
  fs.writeFileSync(path.join(runContext.runDir, "request.json"), `${JSON.stringify({ provider: "local", selection, startedAt }, null, 2)}\n`);
  const surfaceResults = [];
  const groups = groupByExecutionGroup(surfaces, { getFallbackId: (surface) => surface.id });
  groupLoop: for (const group of groups) {
    if (group.id === "unit:workspaces" && group.items.every((surface) => surface.runner === "vitest" && surface.services.length === 0)) {
      const results = await runLocalVitestWorkspaceGroup(group, runContext.runDir);
      surfaceResults.push(...results);
      if (results.some(hasUnconfirmedSurfaceCleanup)) break;
    } else {
      for (const surface of group.items) {
        const result = await runLocalSurface(surface, selectionOptions, runContext.runDir, testRetries);
        surfaceResults.push(result);
        if (hasUnconfirmedSurfaceCleanup(result)) break groupLoop;
      }
    }
  }
  const completedAt = new Date().toISOString();
  const { summary } = finalizeRun({ runContext, selection, git: localGit(), preflights, surfaces: surfaceResults, startedAt, completedAt });
  printSummary(summary, runContext.runDir);
  process.exit(summary.run.status === "passed" ? 0 : 1);
}

async function runLocalVitestWorkspaceGroup(group, runDir) {
  const name = safeSurfaceName(group.id);
  const logPath = path.join(runDir, "logs", name, "raw.log");
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  const nativeResultPath = path.resolve(runDir, "native", `${name}.json`);
  const attemptResultPath = path.resolve(runDir, "native", `${name}.attempts.ndjson`);
  const workspacePath = path.resolve(runDir, "native", `workspace-${name}.mjs`);
  const started = Date.now();
  const supervisor = createSurfaceSupervisor({ runId: path.basename(runDir), surfaceIds: group.items.map((surface) => surface.id) });
  let exitCode = 0;
  let failedPreCommandSurface = null;
  let processLeaks = [];
  let cleanupError = null;
  fs.rmSync(attemptResultPath, { force: true });
  const command = ["npx", ...vitestProjectsArgs({ configPath: workspacePath, configPaths: group.items.map((surface) => path.resolve(surface.config)) }), "--reporter=json", "--outputFile", nativeResultPath];
  console.log(`\n[${group.name}] ${command.map(shellDisplay).join(" ")}`);
  try {
    for (const surface of group.items) {
      if (!surface.preCommand) continue;
      console.log(`[${surface.id}] pre: ${surface.preCommand.map(shellDisplay).join(" ")}`);
      const pre = await runProcess(surface.preCommand[0], surface.preCommand.slice(1), { logPath, append: true, cwd: process.cwd(), supervisor });
      let preCommandLeaks = [];
      try {
        preCommandLeaks = await supervisor.checkForLeaks();
      } catch (error) {
        cleanupError = error;
        processLeaks = collectSupervisorProcessLeaks(supervisor, processLeaks, error);
        recordSurfaceCleanupError(group.id, logPath, error);
      }
      if (pre !== 0 || preCommandLeaks.length > 0 || cleanupError) {
        exitCode = pre !== 0 ? pre : 1;
        failedPreCommandSurface = surface.id;
        break;
      }
    }
    if (failedPreCommandSurface === null) {
      exitCode = await runProcess(command[0], command.slice(1), { logPath, env: reporterEnv({ runner: "vitest" }, nativeResultPath, attemptResultPath), cwd: process.cwd(), supervisor });
    }
  } finally {
    try {
      processLeaks = collectSupervisorProcessLeaks(supervisor, processLeaks, null, await supervisor.finish());
    } catch (error) {
      cleanupError ??= error;
      processLeaks = collectSupervisorProcessLeaks(supervisor, processLeaks, error);
      recordSurfaceCleanupError(group.id, logPath, error);
    }
  }

  if (failedPreCommandSurface !== null) {
    return group.items.map((member) => withSurfaceCleanupFailure(normalizeSurfaceResult({
      surface: member,
      command,
      exitCode: member.id === failedPreCommandSurface ? exitCode : 0,
      durationMs: Date.now() - started,
      logPath: relative(logPath),
      nativeResultPath: null,
      processLeaks,
    }), cleanupError));
  }

  const tasks = group.items.map((surface) => ({ surfaceId: surface.id, cwd: path.resolve(surface.cwd || "."), roots: surface.roots, excludeRoots: surface.excludeRoots, nativeResultPath: path.resolve(runDir, "native", `${safeSurfaceName(surface.id)}.json`) }));
  const splitStatuses = splitVitestWorkspaceResult({ nativeResultPath, tasks });
  return group.items.map((surface) => {
    const result = normalizeSurfaceResult({
      surface: { ...surface, durationSource: "owned-file-sum" },
      command,
      exitCode: exitCode === 0 ? 0 : (splitStatuses.get(surface.id) ?? exitCode),
      durationMs: 0,
      logPath: relative(logPath),
      nativeResultPath: relative(path.resolve(runDir, "native", `${safeSurfaceName(surface.id)}.json`)),
      attemptResultPath: relative(attemptResultPath),
      processLeaks,
    });
    return withSurfaceCleanupFailure({ ...result, durationMs: result.files.reduce((sum, file) => sum + file.durationMs, 0) }, cleanupError);
  });
}

function collectSupervisorProcessLeaks(supervisor, current = [], error = null, finished = []) {
  const byId = new Map();
  for (const leak of [...current, ...finished, ...supervisor.processLeaks, ...(Array.isArray(error?.processLeaks) ? error.processLeaks : [])]) {
    byId.set(leak.leakId ?? JSON.stringify(leak), leak);
  }
  return [...byId.values()].sort((left, right) => String(left.leakId).localeCompare(String(right.leakId)));
}

function recordSurfaceCleanupError(surfaceId, logPath, error) {
  const message = error?.stack ?? error?.message ?? String(error);
  try {
    fs.appendFileSync(logPath, `\nSurface cleanup failed: ${message}\n`);
  } catch (logError) {
    console.error(`[${surfaceId}] could not append surface cleanup failure to ${logPath}: ${logError.message}`);
  }
}

function withSurfaceCleanupFailure(result, cleanupError) {
  if (!cleanupError) return result;
  return {
    ...result,
    status: "failed",
    infraStatus: "incomplete",
    failureKind: "process-leak",
    failureStep: "surface-cleanup",
    failureMessage: cleanupError.message ?? String(cleanupError),
  };
}

function hasUnconfirmedSurfaceCleanup(result) {
  return result.infraStatus === "incomplete" && result.failureStep === "surface-cleanup";
}

async function runLocalSurface(surface, selectionOptions, runDir, testRetries = 0) {
  const name = safeSurfaceName(surface.id);
  const logDir = path.join(runDir, "logs", name);
  fs.mkdirSync(logDir, { recursive: true });
  const logPath = path.join(logDir, "raw.log");
  const nativeResultPath = path.join(runDir, "native", `${name}.json`);
  const nativeResultAbsPath = path.resolve(nativeResultPath);
  const attemptResultPath = path.join(runDir, "native", `${name}.attempts.ndjson`);
  const attemptResultAbsPath = path.resolve(attemptResultPath);
  const runnerConfigPath = surface.runner === "vitest" ? path.resolve(runDir, "native", `${name}.runner.config.mjs`) : null;
  if (runnerConfigPath) {
    fs.rmSync(attemptResultAbsPath, { force: true });
    writeVitestRunnerConfig({ configPath: runnerConfigPath, baseConfigPath: surface.config, runnerPath: "scripts/test/vitest-attempt-reporter.mjs" });
  }
  const command = buildSurfaceCommand(surface, selectionOptions, nativeResultAbsPath, testRetries, runnerConfigPath);
  const started = Date.now();
  const supervisor = createSurfaceSupervisor({ runId: path.basename(runDir), surfaceIds: [surface.id] });
  let exitCode = 0;
  let commandStarted = false;
  let processLeaks = [];
  let cleanupError = null;
  let serviceScope = null;
  const phases = [];
  console.log(`\n[${surface.id}] ${command.map(shellDisplay).join(" ")}`);
  try {
    let readyForCommand = false;
    if (surface.preCommand) {
      console.log(`[${surface.id}] pre: ${surface.preCommand.map(shellDisplay).join(" ")}`);
      const preStarted = Date.now();
      exitCode = await runProcess(surface.preCommand[0], surface.preCommand.slice(1), { logPath, append: true, cwd: process.cwd(), supervisor });
      phases.push(phaseFromEpoch({ name: "pre-command", category: "readiness", status: exitCode === 0 ? "passed" : "failed", startedMs: preStarted }));
      let preCommandLeaks = [];
      try {
        preCommandLeaks = await supervisor.checkForLeaks();
      } catch (error) {
        cleanupError = error;
        processLeaks = collectSupervisorProcessLeaks(supervisor, processLeaks, error);
        recordSurfaceCleanupError(surface.id, logPath, error);
        exitCode = 1;
      }
      if (exitCode === 0 && preCommandLeaks.length === 0 && !cleanupError) readyForCommand = true;
    } else {
      readyForCommand = true;
    }
    if (readyForCommand && surface.services.length > 0) {
      const servicesStarted = Date.now();
      try {
        serviceScope = await startSurfaceServices(surface.services, { env: supervisor.childEnv(process.env) });
        phases.push(phaseFromEpoch({ name: "surface-services", category: "readiness", startedMs: servicesStarted }));
      } catch (error) {
        exitCode = 1;
        phases.push(phaseFromEpoch({ name: "surface-services", category: "readiness", status: "failed", startedMs: servicesStarted }));
        fs.appendFileSync(logPath, `\nSurface service startup failed: ${error.stack ?? error.message ?? error}\n`);
        console.error(`[${surface.id}] surface service startup failed: ${error.message ?? error}`);
        readyForCommand = false;
      }
    }
    if (readyForCommand) {
      commandStarted = true;
      const runnerStarted = Date.now();
      exitCode = await runProcess(command[0], command.slice(1), { logPath, env: reporterEnv(surface, nativeResultAbsPath, attemptResultAbsPath, serviceScope?.env), append: Boolean(surface.preCommand), cwd: commandCwd(surface), supervisor });
      phases.push(phaseFromEpoch({ name: "runner", category: "test", status: exitCode === 0 ? "passed" : "failed", startedMs: runnerStarted }));
    }
  } finally {
    if (serviceScope) {
      const stopStarted = Date.now();
      try {
        await serviceScope.stop();
        phases.push(phaseFromEpoch({ name: "surface-services-stop", category: "readiness", startedMs: stopStarted }));
      } catch (error) {
        exitCode = 1;
        phases.push(phaseFromEpoch({ name: "surface-services-stop", category: "readiness", status: "failed", startedMs: stopStarted }));
        fs.appendFileSync(logPath, `\nSurface service teardown failed: ${error.stack ?? error.message ?? error}\n`);
        console.error(`[${surface.id}] surface service teardown failed: ${error.message ?? error}`);
      }
    }
    try {
      processLeaks = collectSupervisorProcessLeaks(supervisor, processLeaks, null, await supervisor.finish());
    } catch (error) {
      cleanupError ??= error;
      processLeaks = collectSupervisorProcessLeaks(supervisor, processLeaks, error);
      recordSurfaceCleanupError(surface.id, logPath, error);
    }
  }
  if (commandStarted && surface.id === "e2e:desktop" && process.env.SKIP_ELECTRON_E2E === "1" && exitCode === 0 && processLeaks.length === 0 && !cleanupError) {
    return skippedSurfaceResult({ surface, command, durationMs: Date.now() - started, logPath: relative(logPath), reason: "SKIP_ELECTRON_E2E=1", phases });
  }
  return withSurfaceCleanupFailure({ ...normalizeSurfaceResult({ surface, command, exitCode, durationMs: Date.now() - started, logPath: relative(logPath), nativeResultPath: relative(nativeResultPath), attemptResultPath: surface.runner === "vitest" ? relative(attemptResultPath) : null, processLeaks }), phases }, cleanupError);
}

function skippedSurfaceResult({ surface, command, durationMs, logPath, reason, phases = [] }) {
  return {
    id: surface.id,
    runner: surface.runner,
    status: "skipped",
    infraStatus: "completed",
    durationMs,
    durationSource: "surface-wall",
    command,
    counts: { testsTotal: 0, testsPassed: 0, testsFailed: 0, testsSkipped: 0, testsFlakyRecovered: 0 },
    failedTests: [],
    flakyRecoveredTests: [],
    processLeaks: [],
    phases,
    files: [],
    logPath,
    nativeResultPath: null,
    nativeResultPaths: [],
    skipReason: reason,
  };
}

function buildSurfaceCommand(surface, selectionOptions, nativeResultPath, testRetries = 0, runnerConfigPath = null) {
  const file = selectionOptions.file;
  const grep = selectionOptions.grep;
  if (file && !surface.supports.includes("file")) fail(`Surface ${surface.id} does not support --file.`);
  if (grep && !surface.supports.includes("grep")) fail(`Surface ${surface.id} does not support --grep.`);
  if (surface.command) return [...surface.command, ...selectorArgs(surface, file, grep), ...testRetryArgs(surface, testRetries), ...reporterArgs(surface, nativeResultPath)];
  if (surface.runner === "vitest") return ["npx", "vitest", "run", "--config", relativeToCwd(surface, runnerConfigPath ?? surface.config), ...selectorArgs(surface, file, grep), ...testRetryArgs(surface, testRetries), ...reporterArgs(surface, nativeResultPath)];
  if (surface.runner === "playwright") return ["npx", "playwright", "test", "--config", relativeToCwd(surface, surface.config), ...selectorArgs(surface, file, grep), ...testRetryArgs(surface, testRetries), ...reporterArgs(surface, nativeResultPath)];
  fail(`Unsupported runner ${surface.runner} for ${surface.id}`);
}

function selectorArgs(surface, file, grep) {
  const out = [];
  if (file) out.push(surface.command ? file : relativeToCwd(surface, file));
  if (grep) out.push(surface.runner === "vitest" ? "-t" : "-g", grep);
  return out;
}

function testRetryArgs(surface, retries) {
  if (!shouldRetrySurface(surface) || retries <= 0) return [];
  if (surface.runner === "playwright") return [`--retries=${retries}`];
  if (surface.runner === "vitest") return [`--retry=${retries}`];
  return [];
}

function commandCwd(surface) {
  return surface.command ? process.cwd() : path.resolve(surface.cwd || ".");
}

function relativeToCwd(surface, file) {
  return path.relative(path.resolve(surface.cwd || "."), path.resolve(file)) || ".";
}

function reporterArgs(surface, nativeResultPath) {
  if (surface.runner === "vitest") return ["--reporter=json", "--outputFile", nativeResultPath];
  if (surface.runner === "playwright") return ["--reporter=dot,json"];
  return [];
}

function reporterEnv(surface, nativeResultPath, attemptResultPath = null, baseEnv = process.env) {
  const env = { ...baseEnv, FLAKY_TEST_RETRIES: baseEnv.FLAKY_TEST_RETRIES ?? "5" };
  if (surface.runner === "vitest" && attemptResultPath) env.TV_VITEST_ATTEMPT_FILE = attemptResultPath;
  delete env.FORCE_COLOR;
  delete env.NO_COLOR;
  if (surface.runner === "playwright") env.PLAYWRIGHT_JSON_OUTPUT_NAME = nativeResultPath;
  return env;
}

function resolveTestRetries(selectionOptions, surfaces) {
  const explicit = selectionOptions.retries;
  const retriable = hasRetriableSurface(surfaces);
  if (explicit !== undefined) {
    const value = Number.parseInt(explicit, 10);
    if (!Number.isInteger(value) || value < 0) fail("--retries must be a non-negative integer.");
    if (!retriable && value > 0) console.error("NOTICE: --retries is ignored for unit-only selections; runner-level retries apply only to non-unit Vitest and Playwright surfaces.");
    return retriable ? value : 0;
  }
  return retriable ? 2 : 0;
}

function hasRetriableSurface(surfaces) {
  return surfaces.some((surface) => shouldRetrySurface(surface));
}

function shouldRetrySurface(surface) {
  return surface.kind !== "unit" && ["playwright", "vitest"].includes(surface.runner);
}

function selectedSurfaces({ options: localOptions = options, requireSelection }) {
  if (requireSelection && !localOptions.all && !localOptions.suite && !localOptions.surface && !localOptions.package && !localOptions.file && !localOptions.runner && !localOptions.tag) {
    fail("Select tests explicitly with --suite, --all, --surface, --package, --file, --runner, or --tag.");
  }
  if (localOptions.file) {
    const owners = owningSurfaces(config.surfaces, localOptions.file);
    if (owners.length === 0) fail(`No test surface owns ${localOptions.file}.`);
    if (owners.length > 1 && !localOptions.surface) fail(`${localOptions.file} is owned by multiple surfaces:\n${owners.map((surface) => `- ${surface.id}`).join("\n")}\nPass --surface <id> to disambiguate.`);
  }
  const surfaces = selectSurfaces(config, localOptions);
  if (surfaces.length === 0) fail("Selection matched no test surfaces.");
  return surfaces;
}

function assertRegistryValid() {
  const errors = validateRegistry(config);
  if (errors.length) fail(`Test registry validation failed:\n${errors.map((e) => `- ${e}`).join("\n")}`);
}

function enforceExecutionPlacement(provider, surfaces) {
  const isolated = surfaces.filter((surface) => surface.tags.includes("isolated-github-only"));
  if (isolated.length === 0) return;
  const ids = isolated.map((surface) => surface.id).join(", ");
  if (provider === "blaxel") {
    fail(`Surface(s) ${ids} carry the isolated-github-only tag and are never eligible for Blaxel execution. Use an authorized branch-only Process Lifecycle Fault Injection workflow.`);
  }
  const dedicatedWorkflow = process.env.GITHUB_ACTIONS === "true" &&
    process.env.GITHUB_WORKFLOW === "Process Lifecycle Fault Injection" &&
    process.env.TV_TEST_ISOLATED_GITHUB === "1";
  if (!dedicatedWorkflow) {
    fail(`Surface(s) ${ids} carry the isolated-github-only tag and cannot run on a developer host. Use an authorized branch-only Process Lifecycle Fault Injection workflow with its explicit opt-in.`);
  }
}

function runProviderPreflights(provider, surfaces) {
  const checks = requiredPreflights(surfaces, provider);
  const results = runPreflights(checks, { provider });
  printPreflightResults(results);
  return results;
}

function runRemotePreflightAndPrint(provider, selectionOptions) {
  const remote = runRemotePreflight(provider, selectionOptions);
  printPreflightResults(remote.results);
  return remote;
}

function printPreflightResults(results) {
  for (const result of results) console.log(`${result.status === "passed" ? "✓" : "✘"} ${result.name}${result.message ? `: ${result.message}` : ""}`);
}

function assertPreflightsPassed(results) {
  const failed = results.find((result) => result.status !== "passed");
  if (failed) fail(`preflight failed: ${failed.name}${failed.message ? `: ${failed.message}` : ""}`);
}

function requireProvider() {
  if (!options.provider) fail("Test execution requires --provider <local|blaxel>. There is no default provider.");
  if (!["local", "blaxel"].includes(options.provider)) fail("--provider must be one of: local, blaxel");
  return options.provider;
}

function runProcess(command, args, { logPath, env = process.env, append = false, cwd = process.cwd(), supervisor = null }) {
  const log = fs.createWriteStream(logPath, { flags: append ? "a" : "w" });
  log.write(`$ ${[command, ...args].map(shellDisplay).join(" ")}\n\n`);
  if (supervisor) {
    return supervisor.run(command, args, {
      cwd,
      env,
      onStdout: (chunk) => { process.stdout.write(chunk); log.write(chunk); },
      onStderr: (chunk) => { process.stderr.write(chunk); log.write(chunk); },
    }).then((result) => {
      if (result.error) log.write(`\n${result.error.stack || result.error.message}\n`);
      log.end();
      return result.exitCode;
    });
  }
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
    child.stdout.on("data", (chunk) => { process.stdout.write(chunk); log.write(chunk); });
    child.stderr.on("data", (chunk) => { process.stderr.write(chunk); log.write(chunk); });
    child.on("error", (error) => { log.write(`\n${error.stack || error.message}\n`); log.end(); resolve(127); });
    child.on("exit", (code) => { log.end(); resolve(code ?? 1); });
  });
}

function selectionSummary(selectionOptions, surfaces) {
  return { suite: selectionOptions.suite ?? (selectionOptions.all ? "all" : null), surfaces: surfaces.map((surface) => surface.id), files: selectionOptions.file ? [selectionOptions.file] : [], grep: selectionOptions.grep ?? null };
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; }
}

function createProviderRunContext(provider) {
  if (provider === "blaxel") return createRunContext("blaxel", { timingProvider: "blaxel-playwright-x64-4vcpu" });
  return createRunContext("local");
}

function writeRunDirOutput(options, runContext) {
  const output = options["run-dir-output"];
  if (output == null) return;
  if (typeof output !== "string" || output === "1" || output.trim() === "") fail("--run-dir-output requires a file path");
  atomicWriteFile(path.resolve(output), `${runContext.absoluteRunDir}\n`);
}

function localGit() {
  return {
    commit: spawnText("git", ["rev-parse", "HEAD"]).trim() || null,
    tree: spawnText("git", ["rev-parse", "HEAD^{tree}"]).trim() || null,
    dirty: Boolean(spawnText("git", ["status", "--short"]).trim()),
    reachableFromOrigin: null,
  };
}

function spawnText(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8" });
  return result.stdout ?? "";
}

function printSummary(summary, runDir) {
  summary = readJson(path.join(runDir, "summary.json")) ?? summary;
  console.log(`\nstatus=${summary.run.status} infra=${summary.run.infraStatus} tests=${summary.run.testStatus} duration=${formatDuration(summary.run.durationMs)}`);
  for (const phase of summary.phaseMetrics?.run?.phases ?? []) console.log(`phase run ${formatPhase(phase)}`);
  for (const shard of summary.phaseMetrics?.shards ?? []) {
    for (const phase of shard.phases ?? []) console.log(`phase shard ${shard.index}/${shard.total} ${formatPhase(phase)}`);
  }
  const surfaceCompute = (summary.phaseMetrics?.shards ?? []).flatMap((shard) => (shard.surfaces ?? []).map((surface) => ({ ...surface, shard: `${shard.index}/${shard.total}` }))).filter((surface) => surface.durationMs != null).sort((left, right) => right.durationMs - left.durationMs);
  for (const surface of surfaceCompute.slice(0, 10)) console.log(`compute shard ${surface.shard} ${surface.surfaceId}=${formatDuration(surface.durationMs)}`);
  if (surfaceCompute.length > 10) console.log(`compute: ${surfaceCompute.length - 10} more surface metric(s) in summary.json`);
  for (const surface of summary.failedSurfaces ?? []) {
    if (surface.failureKind || surface.failureMessage) {
      const shardText = surface.infraFailedShards?.length ? ` shards=${surface.infraFailedShards.join(",")}` : "";
      console.log(`infra failed: ${surface.id}${shardText} ${surface.failureKind ?? "unknown"}${surface.failureStep ? `/${surface.failureStep}` : ""}: ${surface.failureMessage ?? "see log"}`);
    }
  }
  if (summary.failedTests.length) for (const test of summary.failedTests) console.log(`failed: ${test.surfaceId} ${test.file ?? ""} ${test.title}`);
  if (summary.flakyRecoveredTests.length) {
    console.log(`flaky recovered: ${summary.flakyRecoveredTests.length}`);
    for (const test of summary.flakyRecoveredTests.slice(0, 20)) console.log(`flaky recovered: ${test.surfaceId} attempts=${test.attempts} ${test.file ?? ""} ${test.title}`);
    if (summary.flakyRecoveredTests.length > 20) console.log(`flaky recovered: ${summary.flakyRecoveredTests.length - 20} more`);
  }
  console.log(`summary: ${path.join(runDir, "summary.json")}`);
}

function parseArgs(argv, { allowPositionals = false } = {}) {
  const out = {};
  const positional = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) {
      if (!allowPositionals) fail(`Unexpected positional argument ${JSON.stringify(arg)}. Use explicit flags.`);
      positional.push(arg);
      continue;
    }
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) { out[key] = next; i += 1; }
    else out[key] = "1";
  }
  if (positional.length) out._ = positional;
  return out;
}

function help() {
  console.log(`Usage:
  npm run verify                          # lint, type-check, and all tests; local by default; host marker opts into Blaxel
  npm run verify -- local|blaxel          # explicit verify provider
  npm run verify -- --plan                # print resolved provider + phase commands without running (exit 0 is not a verification)
  npm test -- local [selectors]           # local test run; bare broad runs are refused; use verify
  npm test -- blaxel [selectors]          # Blaxel test run; bare broad runs are refused; use verify
  npm test -- list [selectors]
  npm test -- preflight --provider <local|blaxel> [selectors]
  npm test -- pool blaxel <list|ensure|delete> [--pool poc] [--size ${DEFAULT_BLAXEL_POOL_SIZE}]
  npm test -- testpass prune <--older-than 30d|--dead-version <n>|--delete-ref <ref>> [--apply]
  npm test -- baseline update [--dry-run]    # recompute the timing baseline from this checkout's Blaxel runs

Selectors (choose which tests to run):
  --suite <unit|e2e|e2e-ci|agent|experiment|telemetry-posthog-roundtrip|daemon-acceptance|all>  Named suite. Provider shortcuts refuse --suite all unless --force is passed.
  --surface <id>                One registered surface, e.g. e2e:desktop.
  --package <workspace-name>    Surfaces owned by a workspace package.
  --file <path>                 Surface that owns a test file.
  --grep <pattern>              Test title filter. Bare --grep (no --file/--surface) counts as a broad run.
  --runner <vitest|playwright>  Surfaces using a runner.
  --tag <tag>                   Surfaces with a registry tag.
  --all                         Alias for --suite all.
  --no-publish                  Suppress the attestation write of a qualifying Blaxel verify.
  --run-dir-output <file>       Atomically write this invocation's absolute run-directory path for orchestration.

Broad shortcut override:
  --force                       Allow an intentional raw broad provider run (skips lint/type-check).

Remote options:
  --ignore-uncommitted          Allow remote runs to ignore local uncommitted changes.

Guardrails:
  - Without ~/.tvdev-use-blaxel, verify defaults to local without contacting Blaxel.
    With the marker, verify defaults to Blaxel and refuses automatic local fallback.
    Explicit local verify then requires --allow-extreme-inefficiency.
  - Provider shortcuts (npm test -- local|blaxel) refuse broad --suite all
    runs. Use 'npm run verify' instead, or pass --force when a raw broad
    provider run is intentional.

Retries:
  Non-unit Vitest and Playwright surfaces retry twice by default, including
  targeted runs; unit surfaces do not receive runner-level retries.
  Use --retries <n> to override the non-unit surface retry count.

Examples:
  npm test -- local --file packages/web/test/copy-button.test.ts --grep "renders the 'idle default' state"
  npm test -- local --surface e2e:desktop
  npm run verify
  npm run verify -- blaxel
  npm test -- local --suite telemetry-posthog-roundtrip
  TV_DAEMON_TEST_HOST=1 npm test -- local --suite daemon-acceptance
  npm test -- blaxel --suite e2e
  npm test -- blaxel --shard-indices 5 --force

verify defaults to --provider auto.`);
  process.exit(0);
}

function npmCommand() { return process.platform === "win32" ? "npm.cmd" : "npm"; }

function requireSelftestSeam(name) {
  if (process.env.TV_TEST_RUNNER_SELFTEST !== "1") fail(`${name} is a test-runner self-test seam and requires TV_TEST_RUNNER_SELFTEST=1.`);
  console.error(`WARNING: ${name} self-test seam is active; this invocation is not a real verification run.`);
}

function relative(file) { return path.relative(process.cwd(), file); }
function shellDisplay(value) { return /\s/.test(String(value)) ? JSON.stringify(String(value)) : String(value); }
function formatDuration(ms) { return !Number.isFinite(ms) ? "unknown" : ms < 1000 ? `${ms}ms` : ms < 60000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`; }
function formatPhase(phase) { return `${phase.category}/${phase.name}=${formatDuration(phase.durationMs)} status=${phase.status}${phase.cacheStatus ? ` cache=${phase.cacheStatus}` : ""}`; }
function fail(message) { console.error(message); process.exit(2); }

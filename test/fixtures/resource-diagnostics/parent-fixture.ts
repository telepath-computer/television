import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createShardPlan } from "../../../scripts/test/shard-plan.mjs";
import { targetCommand } from "../../../scripts/test/target-command.mjs";
import { serializeTimingBaseline } from "../../../scripts/test/timing-baseline.mjs";

// A disposable results root and the production surface-parent command
// (planned worker or targeted supervised command) for the resource-diagnostics
// native fixture. Paths are relative to the repository root, the cwd of every
// surface that uses it.
const fixtureRoot = "test/fixtures/resource-diagnostics";
const sourceFile = `${fixtureRoot}/native.fixture.ts`;
const provider = "blaxel-playwright-x64-4vcpu";
export const read = (file: string) => JSON.parse(readFileSync(file, "utf8"));

export function readDiagnostics(dir: string) {
  const root = path.join(dir, "results/resources");
  return existsSync(root) ? readdirSync(root).filter((name) => name.endsWith(".json")).map((name) => read(path.join(root, name))) : [];
}

export function createFixture(entry: "planned" | "targeted", mode: string) {
  mkdirSync(".test-runs", { recursive: true });
  const dir = mkdtempSync(path.join(process.cwd(), ".test-runs/resource-parent-"));
  const results = path.join(dir, "results");
  mkdirSync(results);
  const nativeConfig = path.join(dir, "native.config.mjs");
  writeFileSync(nativeConfig, `export default ${JSON.stringify({ test: { include: [path.resolve(sourceFile)], globalSetup: [path.resolve(`${fixtureRoot}/setup.mjs`)], pool: "forks", maxWorkers: 1, retry: 2 } })};\n`);
  const preCommand = [process.execPath, path.resolve(`${fixtureRoot}/prepare.mjs`)];
  const surface = { id: "fixture:resources", runner: "vitest", kind: "e2e", package: null, config: nativeConfig, absoluteConfig: nativeConfig, roots: [sourceFile], excludeRoots: [], cwd: ".", supports: ["file"], preflight: [], tags: [], agent: false, preCommand, command: null, executionGroup: { id: "fixture:resources", name: "resource fixture", order: 1 } };
  const registryPath = path.join(dir, "registry.mjs");
  writeFileSync(registryPath, `export default ${JSON.stringify({ suites: { all: { include: ["kind:e2e"] } }, surfaces: [surface] })};\n`);
  const plan = createShardPlan({ inventory: [{ path: sourceFile, surfaceId: surface.id, runner: "vitest" }], surfaces: [surface] as any, baseline: { schemaVersion: 1, sourceThrough: null, files: {} }, baselineBytes: serializeTimingBaseline({ schemaVersion: 1, sourceThrough: null, files: {} }), timingProvider: provider, testedCommit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(), testedTree: execFileSync("git", ["rev-parse", "HEAD^{tree}"], { encoding: "utf8" }).trim(), shardTotal: 1 });
  const planPath = path.join(dir, "plan.json");
  writeFileSync(planPath, JSON.stringify(plan));
  const env = { ...process.env, GITHUB_ACTIONS: "false", TV_TEST_RUNNER_SELFTEST: "1", TEST_SHARD_CONFIG_MODULE: registryPath, TV_TEST_TIMING_PROVIDER: provider, TV_TEST_RUN_ID: "resource-parent-run", TV_TEST_SHARD_INDEX: "1", TV_TEST_SHARD_ATTEMPT: "resource-parent-attempt", RESOURCE_FIXTURE_ROOT: dir, RESOURCE_FIXTURE_MODE: mode, TMPDIR: dir, TV_TARGET_RUNNER: "vitest", TV_TARGET_NATIVE_RESULT: path.join(results, "native.json"), TV_VITEST_ATTEMPT_FILE: path.join(results, "native.attempts.ndjson") };
  const args = entry === "planned" ? ["scripts/run-test-shard.mjs", "--plan", planPath, "--shard", "1", "--results-dir", results, "--test-retries", "2"] : ["scripts/test/supervised-command.mjs", "--run-id", "resource-parent-run", "--surface", surface.id, "--result", path.join(results, "lifecycle.json"), "--pre-command-json", JSON.stringify(preCommand), "--", "bash", "-c", targetCommand({ runner: "vitest", cwd: ".", config: nativeConfig, file: sourceFile, files: [sourceFile], retries: "2", command: null })];
  return { dir, args, env, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

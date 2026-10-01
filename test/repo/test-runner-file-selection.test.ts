import { spawnSync } from "node:child_process";
import { targetCommand } from "../../scripts/test/target-command.mjs";
import { enumerateTrackedPaths, loadRegistrySnapshotAtCommit } from "../../scripts/test/file-inventory.mjs";
import { createShardPlan } from "../../scripts/test/shard-plan.mjs";
import { serializeTimingBaseline } from "../../scripts/test/timing-baseline.mjs";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { guidanceCheckout } from "./fixtures/test-runner/guidance-checkout.ts";

const dry = { TV_TEST_RUNNER_DRY_RUN: "1" };
const zero = "--against-test-guidance-turn-flakes-into-failures-on-broad-runs";

// proofs/arch/test-runner/test-runner.md#^t-runner-file-boundary
describe("actual file resolution", () => {
  test("uses untracked local files and the selected committed registry remotely", () => {
    const f = guidanceCheckout();
    try {
      const file = `${f.testsRoot}/new.test.ts`;
      f.write(file, 'import { test } from "vitest"; test("new", () => {});');
      const invoke = (provider: string, extra: string[] = []) => f.run([provider, "--file", file, "--retries", "0", ...extra], dry);
      expect(invoke("local").status).toBe(0);
      expect(invoke("blaxel").stderr).toContain("No test files match");
      f.git("add", "."); f.git("commit", "-qm", "New file");
      const commit = f.git("rev-parse", "HEAD");
      f.surface.id = "fixture:moved-owner";
      f.writeRegistry();
      f.git("add", "."); f.git("commit", "-qm", "Changed owner");
      rmSync(path.join(f.root, file));
      expect(invoke("local").status).toBe(2);
      const remote = invoke("blaxel", ["--commit", commit, "--surface", "fixture:vitest"]);
      expect(remote.status, remote.stderr).toBe(0);
      expect(remote.stdout).toContain("surfaces=fixture:vitest");
      expect(invoke("blaxel", ["--surface", "fixture:vitest"]).stderr).toContain("not part of the selected surfaces");
    } finally { f.cleanup(); }
  });

  test("pins the inventory commit when a selected branch name moves", async () => {
    const f = guidanceCheckout();
    try {
      f.git("branch", "selected");
      const commit = f.git("rev-parse", "selected");
      const snapshot = await loadRegistrySnapshotAtCommit({ repoRoot: f.root, commit: "selected" });
      f.write(`${f.testsRoot}/later.test.ts`, "");
      f.git("add", "."); f.git("commit", "-qm", "Later revision");
      f.git("branch", "-f", "selected", "HEAD");
      expect(snapshot.commit).toBe(commit);
      expect(enumerateTrackedPaths({ repoRoot: f.root, commit: snapshot.commit })).not.toContain(`${f.testsRoot}/later.test.ts`);
    } finally { f.cleanup(); }
  });

  test("distinguishes exact paths, broad filters, exclusions and ambiguous owners", () => {
    const f = guidanceCheckout();
    try {
      writeFileSync(path.join(f.home, ".tvdev-use-blaxel"), "present");
      const check = (file: string, extra: string[] = []) => f.run(["local", "--file", file, ...extra], dry);
      expect(check(`${f.testsRoot}/one.test.ts`).status).toBe(0);
      expect(check(f.testsRoot).stderr).toContain("one test file");
      expect(check("one.test").stderr).toContain("one test file");
      expect(check("missing.test.ts").stderr).toContain("No test files match");
      f.write("unowned.test.ts", "");
      expect(check("unowned.test.ts").stderr).toContain("No test surface owns");
      f.surface.excludeRoots.push(`${f.testsRoot}/one.test.ts`);
      f.writeRegistry();
      expect(check(`${f.testsRoot}/one.test.ts`).stderr).toContain("No test surface owns");
      f.surface.excludeRoots = [];
      f.registry.executionGroups[0].surfaces.push({ ...f.surface, id: "fixture:duplicate" });
      f.writeRegistry();
      expect(check(`${f.testsRoot}/one.test.ts`).stderr).toContain("multiple surfaces");
      expect(check(`${f.testsRoot}/one.test.ts`, ["--surface", "fixture:vitest"]).status).toBe(0);
      rmSync(path.join(f.root, f.testsRoot, "one.test.ts.test.ts"));
      expect(f.run(["local", "--surface", "fixture:vitest"], dry).stderr).toContain("one test file");
    } finally { f.cleanup(); }
  });
});

// proofs/arch/test-runner/test-runner.md#^t-runner-exact-native-file
// proofs/arch/test-runner/test-runner.md#^t-runner-retry-attempts
describe.each(["vitest", "playwright"] as const)("%s native selection and retries", (runner) => {
  test.each(["one.test.ts", "one[1].test.ts"])("collects only the admitted file and title: %s", (name) => {
    const f = guidanceCheckout(runner);
    try {
      writeFileSync(path.join(f.home, ".tvdev-use-blaxel"), "");
      if (name !== "one.test.ts") f.write(`${f.testsRoot}/${name}`, readFileSync(path.join(f.root, f.testsRoot, "one.test.ts"), "utf8"));
      const result = f.run(["local", "--file", `${f.testsRoot}/${name}`, "--grep", "selected|sibling"]);
      expect(result.status, result.stdout + result.stderr).toBe(0);
      const surface = summary(f, result).surfaces[0];
      expect(surface.counts.testsPassed).toBe(1);
      if (runner === "vitest") {
        // Native collection is the boundary here. The remote report normalizer
        // strips /workspace/television even from an authored checkout below it.
        const native = JSON.parse(readFileSync(path.resolve(f.root, surface.nativeResultPath), "utf8"));
        expect(native.testResults.map((file: { name: string }) => file.name)).toEqual([path.join(f.root, f.testsRoot, name)]);
      } else {
        expect(surface.files.map((file: { path: string }) => file.path)).toEqual([`${f.testsRoot}/${name}`]);
      }
    } finally { f.cleanup(); }
  });

  test.each([
    ["default", [], "1", 0, 2], ["focused zero", ["--retries", "0"], "1", 1, 1],
    ["deliberate zero", [zero], "1", 1, 1], ["positive", ["--retries", "3"], "3", 0, 4],
  ] as const)("%s reaches actual native attempts", (_name, flags, fails, status, attempts) => {
    const f = guidanceCheckout(runner);
    try {
      const result = f.run(["local", "--file", `${f.testsRoot}/one.test.ts`, "--grep", "selected attempt", ...flags], { TV_GUIDANCE_FAIL_COUNT: fails });
      expect(result.status, result.stdout + result.stderr).toBe(status);
      const events = readFileSync(path.join(f.root, "attempts.ndjson"), "utf8").trim().split("\n").map((line) => JSON.parse(line));
      expect(events.map((event) => event.attempt)).toEqual(Array.from({ length: attempts }, (_, i) => i));
      if (status === 0) expect(summary(f, result).surfaces[0].counts.testsFlakyRecovered).toBe(1);
    } finally { f.cleanup(); }
  });

  test("targeted worker command keeps exact collection and numeric zero", () => {
    const f = guidanceCheckout(runner);
    try {
      const file = `${f.testsRoot}/one.test.ts`;
      const command = targetCommand({ runner, cwd: ".", config: f.surface.config, file, files: [file], grep: "selected|sibling", retries: "0", command: null });
      const output = path.join(f.root, "target.json");
      const result = spawnSync("bash", ["-c", command], { cwd: f.root, env: { ...f.env, TV_TARGET_NATIVE_RESULT: output }, encoding: "utf8", timeout: 15_000 });
      expect(result.status, result.stdout + result.stderr).toBe(0);
      const native = readFileSync(output, "utf8");
      expect(native).toContain("selected attempt");
      expect(native).not.toContain("adversarial sibling");
      expect(readFileSync(path.join(f.root, "attempts.ndjson"), "utf8").trim().split("\n")).toHaveLength(1);
    } finally { f.cleanup(); }
  });

  test.each([["planned", 0], ["planned", 2], ["diagnostic", 0], ["diagnostic", 2]] as const)("%s worker forwards budget %i even when config retries", (mode, budget) => {
    const f = guidanceCheckout(runner);
    try {
      // This existing worker path rejects ambiguous positional filters. Its
      // retry fixture needs only one file; local/targeted tests retain siblings.
      rmSync(path.join(f.root, f.testsRoot, "one.test.ts.test.ts"));
      f.git("add", "."); f.git("commit", "-qm", "Single worker fixture");
      const baseline = { schemaVersion: 1 as const, sourceThrough: null, files: {} };
      const plan = createShardPlan({
        inventory: [{ path: `${f.testsRoot}/one.test.ts`, surfaceId: f.surface.id, runner }],
        surfaces: [f.surface], baseline, baselineBytes: serializeTimingBaseline(baseline),
        timingProvider: "local-linux-x64-4cpu", testedCommit: f.git("rev-parse", "HEAD"), testedTree: f.git("rev-parse", "HEAD^{tree}"), shardTotal: 1,
      });
      f.write("plan.json", JSON.stringify(plan));
      const env: NodeJS.ProcessEnv = { ...f.env, TV_TEST_TIMING_PROVIDER: "local-linux-x64-4cpu", TV_GUIDANCE_FAIL_COUNT: "1" };
      delete env.GITHUB_ACTIONS;
      delete env.TEST_SHARD_CONFIG_MODULE;
      const result = spawnSync(process.execPath, ["scripts/run-test-shard.mjs", ...(mode === "planned" ? ["--plan", "plan.json"] : ["--total", "1", "--surfaces", f.surface.id]), "--shard", "1", "--results-dir", ".test-runs/worker", "--test-retries", String(budget)], { cwd: f.root, env, encoding: "utf8", timeout: 15_000 });
      expect(result.status, result.stdout + result.stderr).toBe(budget === 0 ? 1 : 0);
      const task = JSON.parse(readFileSync(path.join(f.root, ".test-runs/worker/shard-1.json"), "utf8")).tasks[0];
      if (mode === "planned") expect(task.retryBudget).toBe(budget);
      const attempts = readFileSync(path.join(f.root, "attempts.ndjson"), "utf8").trim().split("\n");
      expect(attempts).toHaveLength(budget === 0 ? 1 : 2);
    } finally { f.cleanup(); }
  });

  test("unit defaults remain zero and a per-test annotation still retries", () => {
    const f = guidanceCheckout(runner);
    try {
      f.surface.kind = "unit"; f.writeRegistry();
      const unit = f.run(["local", "--file", `${f.testsRoot}/one.test.ts`, "--grep", "selected attempt"], { TV_GUIDANCE_FAIL_COUNT: "1" });
      expect(unit.status, unit.stdout + unit.stderr).toBe(1);
      const annotated = f.run(["local", "--file", `${f.testsRoot}/one.test.ts`, "--grep", "annotated retry", "--retries", "0"]);
      expect(annotated.status, annotated.stdout + annotated.stderr).toBe(0);
      expect(summary(f, annotated).surfaces[0].counts.testsFlakyRecovered).toBe(1);
    } finally { f.cleanup(); }
  });
});

function summary(f: ReturnType<typeof guidanceCheckout>, result: { stdout: string }) {
  const file = result.stdout.match(/summary: (.+summary.json)/)?.[1];
  expect(file).toBeTruthy();
  const summaryPath = path.resolve(f.root, file!);
  return JSON.parse(readFileSync(path.join(path.dirname(summaryPath), "results.json"), "utf8"));
}

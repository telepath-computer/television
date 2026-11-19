import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { loadTestConfig } from "../../scripts/test/config.mjs";
import { createShardPlan } from "../../scripts/test/shard-plan.mjs";
import { serializeTimingBaseline } from "../../scripts/test/timing-baseline.mjs";
import { targetCommand } from "../../scripts/test/target-command.mjs";
import { guidanceCheckout } from "./fixtures/test-runner/guidance-checkout.ts";
import { mutexCheckout, ready } from "./fixtures/test-runner/mutex-checkout.ts";

const override = "TV_TEST_AGAINST_TEST_GUIDANCE_DIRECT_NATIVE_RUN";
const refusal = "Direct native test invocation";

// proofs/arch/test-runner/test-runner.md#^t-runner-guidance-usage
test("help explains deliberate native use alongside canonical guidance", () => {
  const r = spawnSync(process.execPath, ["scripts/test/cli.mjs", "help"], { encoding: "utf8" });
  expect(r.status).toBe(0);
  for (const text of [`${override}=1`, "native", "services", "caller", "--file", "--grep", "pushing", "human permission", "--wait-for-local-test-mutex", "--against-test-guidance-major-host-contention-and-oom-killed-processes", "--against-test-guidance-broad-local-run", "--against-test-guidance-turn-flakes-into-failures-on-broad-runs", "--retries 0", "default budget"]) expect(r.stdout).toContain(text);
});

function withoutContext(base: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env = { ...base };
  delete env.TV_TEST_RUNNER_CONTEXT;
  delete env[override];
  delete env.GITHUB_ACTIONS;
  delete env.TEST_SHARD_CONFIG_MODULE;
  return env;
}
function native(runner: "vitest" | "playwright", config: string, args: string[], cwd: string, env: NodeJS.ProcessEnv) {
  return spawnSync("npx", [runner, ...(runner === "vitest" ? ["run"] : ["test"]), "--config", config, ...args], { cwd, env, encoding: "utf8", timeout: 60_000 });
}

// proofs/arch/test-runner/test-runner.md#^t-runner-native-refusal
test("every registered config refuses direct invocation before service setup", () => {
  const home = mkdtempSync(path.join(os.tmpdir(), "native-entrypoints-"));
  const started = Date.now();
  try {
    const env = withoutContext({ ...process.env, HOME: home });
    const configs = new Map(loadTestConfig().surfaces.map(s => [s.config, s]));
    for (const s of configs.values()) {
      // Listing cannot execute test bodies, even if the check regresses. The
      // no-match filter also avoids loading the registered test modules.
      const args = s.runner === "vitest"
        ? ["vitest", "list", "__tv_no_matching_test_file__", "--filesOnly", "--config", s.absoluteConfig]
        : ["playwright", "test", "__tv_no_matching_test_file__", "--list", "--config", s.absoluteConfig];
      const r = spawnSync("npx", args, { cwd: path.resolve(s.cwd), env, encoding: "utf8", timeout: 30_000 });
      expect(r.stderr + r.stdout, s.config).toContain(refusal);
      expect(r.status, s.config).not.toBe(0);
    }
  } finally {
    console.log(`Registered native config sweep: ${Date.now() - started}ms`);
    rmSync(home, { recursive: true, force: true });
  }
}, 120_000);

describe.each(["vitest", "playwright"] as const)("%s native guidance", runner => {
  // proofs/arch/test-runner/test-runner.md#^t-runner-native-refusal
  // proofs/arch/test-runner/test-runner.md#^t-runner-native-override
  test("refuses absent and inexact overrides with host-appropriate next steps", () => {
    const f = guidanceCheckout(runner);
    try {
      for (const marked of [false, true]) {
        if (marked) writeFileSync(path.join(f.home, ".tvdev-use-blaxel"), "");
        for (const value of [undefined, "0", "true"]) {
          const env = withoutContext(f.env);
          if (value !== undefined) env[override] = value;
          const r = native(runner, f.surface.config, runner === "vitest" ? ["-t", "selected|sibling"] : ["-g", "selected|sibling"], f.root, env);
          const output = r.stdout + r.stderr;
          expect(r.status, output).not.toBe(0);
          for (const text of [refusal, "npm test -- local --file", `${override}=1`, "mutex", "file limit"]) expect(output).toContain(text);
          if (marked) for (const text of ["commit", "push", "npm test -- blaxel", "npm run verify -- blaxel"]) expect(output).toContain(text);
          else expect(output).not.toContain("npm test -- blaxel");
        }
      }
    } finally { f.cleanup(); }
  });

  test("deliberate native use skips canonical file and mutex protections", async () => {
    const holder = mutexCheckout(); const f = guidanceCheckout(runner);
    try {
      const active = holder.start(); await ready(active);
      writeFileSync(path.join(f.home, ".tvdev-use-blaxel"), "");
      const env = { ...withoutContext(f.env), [override]: "1", TV_TEST_RUNNER_LOCK_PATH: holder.env.TV_TEST_RUNNER_LOCK_PATH };
      const r = native(runner, f.surface.config, [runner === "vitest" ? "-t" : "-g", "selected|sibling", "--reporter=json"], f.root, env);
      expect(r.status, r.stdout + r.stderr).toBe(0);
      expect(r.stdout).toContain("selected attempt");
      expect(r.stdout).toContain("adversarial sibling");
      expect(holder.run(holder.args).status).toBe(2);
    } finally { f.cleanup(); await holder.cleanup(); }
  });

  // proofs/arch/test-runner/test-runner.md#^t-runner-native-context
  test.each(["local", "planned", "targeted", "diagnostic"] as const)("%s launcher supplies its own context", mode => {
    const f = guidanceCheckout(runner);
    try {
      const file = `${f.testsRoot}/context.test.ts`;
      f.write(file, `import { test, expect } from '${runner === "vitest" ? "vitest" : "@playwright/test"}';
        test('launcher context', () => { expect(process.env.TV_TEST_RUNNER_CONTEXT).toBe('1'); });`);
      // Every remaining file is the one small guarded fixture, even if a
      // diagnostic launcher fails to narrow. No intentional retry cases here.
      rmSync(path.join(f.root, f.testsRoot, "one.test.ts"));
      rmSync(path.join(f.root, f.testsRoot, "one.test.ts.test.ts"));
      f.git("add", "."); f.git("commit", "-qm", "Context fixture");
      const env = withoutContext(f.env);
      env.TV_TEST_TIMING_PROVIDER = "local-linux-x64-4cpu";
      let args: string[];
      if (mode === "local") args = ["scripts/test/cli.mjs", "local", "--file", file];
      else if (mode === "targeted") args = ["scripts/test/supervised-command.mjs", "--run-id", "native-context", "--surface", f.surface.id, "--result", "target-lifecycle.json", "--", "bash", "-c", targetCommand({ runner, cwd: ".", config: f.surface.config, file, files: [file], retries: "2", command: null })];
      else {
        const baseline = { schemaVersion: 1 as const, sourceThrough: null, files: {} };
        const plan = createShardPlan({ inventory: [{ path: file, surfaceId: f.surface.id, runner }], surfaces: [f.surface], baseline, baselineBytes: serializeTimingBaseline(baseline), timingProvider: "local-linux-x64-4cpu", testedCommit: f.git("rev-parse", "HEAD"), testedTree: f.git("rev-parse", "HEAD^{tree}"), shardTotal: 1 });
        f.write("plan.json", JSON.stringify(plan));
        args = ["scripts/run-test-shard.mjs", ...(mode === "planned" ? ["--plan", "plan.json"] : ["--total", "1", "--surfaces", f.surface.id]), "--shard", "1", "--results-dir", ".test-runs/worker", "--test-retries", "2"];
      }
      env.TV_TARGET_NATIVE_RESULT = path.join(f.root, "target.json");
      const r = spawnSync(process.execPath, args, { cwd: f.root, env, encoding: "utf8", timeout: 60_000 });
      expect(r.status, r.stdout + r.stderr).toBe(0);
      const evidence = mode === "local" ? r.stdout : mode === "targeted"
        ? readFileSync(env.TV_TARGET_NATIVE_RESULT, "utf8")
        : readFileSync(path.join(f.root, `.test-runs/worker/native-fixture-${runner}-shard-1.json`), "utf8");
      expect(evidence).toContain(mode === "local" ? "status=passed" : "launcher context");
    } finally { f.cleanup(); }
  });
});

test("native override still requires the declared service setup", () => {
  const env = withoutContext(process.env);
  env[override] = "1";
  delete env.TV_DYNAMIC_FIRST_URL; delete env.TV_DYNAMIC_SECOND_URL;
  const r = native("playwright", "test/runner-fixtures/dynamic-services/playwright.config.ts", ["--list", "__tv_no_matching_test_file__"], process.cwd(), env);
  expect(r.status).not.toBe(0);
  expect(r.stdout + r.stderr).toContain("TV_DYNAMIC_FIRST_URL is required");
  expect(r.stdout + r.stderr).not.toContain(refusal);
});

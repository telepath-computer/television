import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { describe, expect, test } from "vitest";
import { checkManifestCoversRegistry, packUntrackedFiles, prebuiltManifest, runRecipes } from "../../scripts/test/prebuilt.mjs";
import { loadTestConfig } from "../../scripts/test/config.mjs";
import { createShardPlan } from "../../scripts/test/shard-plan.mjs";
import { serializeTimingBaseline } from "../../scripts/test/timing-baseline.mjs";
import fixtureConfig from "./fixtures/test-runner/shard-worker/config.mjs";

// [[arch/test-runner/github-ci.md#^gha-prebuilt-cli-outputs|prebuilt output contract]]

function runPrebuiltCli(args: string[]) {
  return spawnSync(process.execPath, ["scripts/test/prebuilt.mjs", ...args], { encoding: "utf8" });
}

function writeFixtureFile(root: string, relativePath: string, contents: string) {
  const absolute = path.join(root, relativePath);
  mkdirSync(path.dirname(absolute), { recursive: true });
  writeFileSync(absolute, contents);
}

function initializeFixtureRepository(root: string) {
  execFileSync("git", ["init", "--quiet"], { cwd: root });
  execFileSync("git", ["config", "user.name", "Prebuilt Test"], { cwd: root });
  execFileSync("git", ["config", "user.email", "prebuilt@example.invalid"], { cwd: root });
}

function commitFixtureRepository(root: string) {
  execFileSync("git", ["add", "."], { cwd: root });
  execFileSync("git", ["commit", "--quiet", "-m", "fixture"], { cwd: root });
}

function fixtureManifest() {
  return {
    artifactName: "prebuilt-dists" as const,
    builds: [{ id: "fixture-products", command: [process.execPath, "build.mjs"], coversPreCommands: [] }],
  };
}

function gitUntrackedFiles(root: string) {
  return execFileSync("git", ["ls-files", "--others", "-z"], { cwd: root })
    .toString("utf8")
    .split("\0")
    .filter((entry) => entry && !/(^|\/)(?:node_modules|\.git|\.test-runs)(?:\/|$)/.test(entry))
    .sort();
}

describe("prebuilt manifest", () => {
  const manifest = prebuiltManifest();

  test("declares the shared suite build recipe without output paths", () => {
    const config = loadTestConfig();
    const nodeSurface = config.surfaces.find((surface) => surface.id === "e2e:node");
    const recipe = manifest.builds.find((build) => build.coversPreCommands.includes("e2e:node"));

    expect(recipe?.command).toEqual(["node", "scripts/licenses/build-suite.mjs"]);
    expect(recipe?.command).toEqual(nodeSurface?.preCommand);
    expect(recipe).not.toHaveProperty("outputs");
    expect(recipe?.coversPreCommands).toEqual(["e2e:node", "e2e:browser-app", "e2e:browser-app-real-stack", "e2e:view-markdown", "e2e:desktop", "e2e:server"]);
  });

  test("covers every preCommand-declaring surface in the real registry exactly once", () => {
    expect(checkManifestCoversRegistry(loadTestConfig())).toEqual([]);
  });

  test("check CLI passes against the real registry", () => {
    const result = runPrebuiltCli(["check"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("prebuilt manifest covers the registry");
  });

  test("consistency check names missing, duplicate, and invalid coverage", () => {
    const config = loadTestConfig();
    expect(checkManifestCoversRegistry(config, { artifactName: "prebuilt-dists", builds: [] }).some((error) => error.includes("covered by 0"))).toBe(true);
    const doubled = checkManifestCoversRegistry(config, {
      artifactName: "prebuilt-dists",
      builds: [
        { id: "a", command: ["true"], coversPreCommands: ["e2e:node"] },
        { id: "b", command: ["true"], coversPreCommands: ["e2e:node"] },
      ],
    });
    expect(doubled.some((error) => error.includes("covered by 2"))).toBe(true);
  });

  test("packs exactly git's untracked files and symlinks outside node_modules, .git, and .test-runs, preserving stored modes", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "tv-prebuilt-output-"));
    const extracted = mkdtempSync(path.join(os.tmpdir(), "tv-prebuilt-extracted-"));
    const archive = path.join(os.tmpdir(), `tv-prebuilt-${path.basename(root)}.tgz`);
    try {
      initializeFixtureRepository(root);
      writeFileSync(path.join(root, ".gitignore"), "dist/\nnode_modules/\n.test-runs/\n");
      writeFixtureFile(root, "build.mjs", `
        import { chmodSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
        mkdirSync(new URL("./packages/app/dist/empty/", import.meta.url), { recursive: true });
        writeFileSync(new URL("./packages/app/dist/cli.cjs", import.meta.url), "#!/usr/bin/env node\\n");
        chmodSync(new URL("./packages/app/dist/cli.cjs", import.meta.url), 0o755);
        writeFileSync(new URL("./packages/app/dist/zero.txt", import.meta.url), "");
        symlinkSync("cli.cjs", new URL("./packages/app/dist/cli-link", import.meta.url));
        writeFileSync(new URL("./unignored-output.txt", import.meta.url), "unignored\\n");
        mkdirSync(new URL("./node_modules/example/", import.meta.url), { recursive: true });
        writeFileSync(new URL("./node_modules/example/generated.js", import.meta.url), "excluded\\n");
        mkdirSync(new URL("./packages/app/node_modules/example/", import.meta.url), { recursive: true });
        writeFileSync(new URL("./packages/app/node_modules/example/generated.js", import.meta.url), "excluded\\n");
        mkdirSync(new URL("./.test-runs/current/", import.meta.url), { recursive: true });
        writeFileSync(new URL("./.test-runs/current/summary.json", import.meta.url), "{}\\n");
      `);
      commitFixtureRepository(root);

      runRecipes({ root, manifest: fixtureManifest() });
      packUntrackedFiles(root, archive);

      const expected = gitUntrackedFiles(root);
      const packed = execFileSync("tar", ["--list", "--gzip", "--file", archive], { encoding: "utf8" }).trim().split("\n").filter(Boolean).sort();
      expect(packed).toEqual(expected);

      execFileSync("tar", ["--extract", "--gzip", "--file", archive, "--directory", extracted, "--same-permissions", "--no-same-owner"]);
      expect(statSync(path.join(extracted, "packages/app/dist/cli.cjs")).mode & 0o777).toBe(0o755);
      expect(readFileSync(path.join(extracted, "unignored-output.txt"), "utf8")).toBe("unignored\n");
      expect(lstatSync(path.join(extracted, "packages/app/dist/cli-link")).isSymbolicLink()).toBe(true);
      expect(readlinkSync(path.join(extracted, "packages/app/dist/cli-link"))).toBe("cli.cjs");
      expect(existsSync(path.join(extracted, "packages/app/dist/empty"))).toBe(false);
      expect(existsSync(path.join(extracted, "node_modules"))).toBe(false);
      expect(existsSync(path.join(extracted, ".test-runs"))).toBe(false);
    } finally {
      rmSync(archive, { force: true });
      rmSync(extracted, { recursive: true, force: true });
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("allows identical tracked rewrites but rejects a tracked difference left by a recipe", () => {
    for (const [contents, shouldThrow] of [["before\n", false], ["after\n", true]] as const) {
      const root = mkdtempSync(path.join(os.tmpdir(), "tv-prebuilt-tracked-"));
      try {
        initializeFixtureRepository(root);
        writeFixtureFile(root, "tracked.txt", "before\n");
        writeFixtureFile(root, "build.mjs", `import { writeFileSync } from "node:fs"; writeFileSync(new URL("./tracked.txt", import.meta.url), ${JSON.stringify(contents)});`);
        commitFixtureRepository(root);
        const invoke = () => runRecipes({ root, manifest: fixtureManifest() });
        if (shouldThrow) expect(invoke).toThrow(/tracked files differ.*tracked\.txt/is);
        else expect(invoke).not.toThrow();
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    }
  });

  test("the manifest's artifact name is the literal prebuilt-dists", () => {
    expect(manifest.artifactName).toBe("prebuilt-dists");
    const result = runPrebuiltCli(["artifact-name"]);
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe("prebuilt-dists");
  });

  function workerPlan(args: string[], env: Record<string, string> = {}) {
    const root = "test/repo/fixtures/test-runner/shard-worker";
    const parent = path.join(process.cwd(), ".test-runs");
    mkdirSync(parent, { recursive: true });
    const dir = mkdtempSync(path.join(parent, "prebuilt-plan-"));
    const resultsDir = path.join(dir, "results");
    const planPath = path.join(dir, "plan.json");
    const sentinel = path.join(dir, "pre-command-ran");
    const surface = fixtureConfig.surfaces.find((candidate) => candidate.id === "fixture:vitest-one")!;
    const timingProvider = "local-linux-x64-4cpu";
    const baseline = { schemaVersion: 1 as const, sourceThrough: null, files: {} };
    const plan = createShardPlan({
      inventory: [{ path: `${root}/vitest-one.fixture.ts`, surfaceId: surface.id, runner: "vitest" }],
      surfaces: [surface] as any,
      baseline,
      baselineBytes: serializeTimingBaseline(baseline),
      timingProvider,
      testedCommit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
      testedTree: execFileSync("git", ["rev-parse", "HEAD^{tree}"], { encoding: "utf8" }).trim(),
      shardTotal: 1,
    });
    mkdirSync(resultsDir, { recursive: true });
    writeFileSync(planPath, `${JSON.stringify(plan, null, 2)}\n`);
    const inheritedEnv = { ...process.env };
    delete inheritedEnv.GITHUB_ACTIONS;
    delete inheritedEnv.TV_TEST_TIMING_PROVIDER;
    const result = spawnSync(process.execPath, ["scripts/run-test-shard.mjs", "--plan", planPath, "--shard", "1", "--total", "1", "--results-dir", resultsDir, ...args], {
      encoding: "utf8",
      env: { ...inheritedEnv, TV_TEST_TIMING_PROVIDER: timingProvider, TV_TEST_RUNNER_SELFTEST: "1", TEST_SHARD_CONFIG_MODULE: path.join(process.cwd(), `${root}/config.mjs`), TEST_SHARD_SKIP_PRECOMMANDS: "", SHARD_SENTINEL: sentinel, ...env },
    });
    expect(result.status, result.stderr).toBe(0);
    const summary = JSON.parse(readFileSync(path.join(resultsDir, "shard-1.json"), "utf8"));
    const task = summary.tasks[0] as { command: string; args: string[]; preCommandsSkipped: boolean };
    const runDir = summary.runDir ? path.resolve(summary.runDir) : null;
    return {
      task,
      preCommandRan: existsSync(sentinel),
      runDir,
      cleanup: () => {
        rmSync(dir, { recursive: true, force: true });
        if (runDir) rmSync(runDir, { recursive: true, force: true });
      },
    };
  }

  test("requires --plan to name a plan file", () => {
    const result = spawnSync(process.execPath, ["scripts/run-test-shard.mjs", "--plan", "--shard", "1"], { encoding: "utf8" });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("planned shard requires an existing plan file");
  });

  test("real plan-file worker suppresses preCommand under both knob forms while leaving the surface command unchanged", () => {
    const baseline = workerPlan([]);
    const viaFlag = workerPlan(["--skip-pre-commands"]);
    const viaEnv = workerPlan([], { TEST_SHARD_SKIP_PRECOMMANDS: "1" });
    try {
      expect(baseline.preCommandRan).toBe(true);
      expect(baseline.task.preCommandsSkipped).toBe(false);
      for (const skipped of [viaFlag, viaEnv]) {
        expect(skipped.preCommandRan).toBe(false);
        expect(skipped.task.preCommandsSkipped).toBe(true);
        expect(skipped.task.command).toBe(baseline.task.command);
        expect(skipped.task.args).toEqual(baseline.task.args);
      }
    } finally {
      baseline.cleanup();
      viaFlag.cleanup();
      viaEnv.cleanup();
    }
  });

  test("nested plan workers discard inherited GitHub Actions state", () => {
    const savedGitHubActions = process.env.GITHUB_ACTIONS;
    let worker: ReturnType<typeof workerPlan> | null = null;
    try {
      process.env.GITHUB_ACTIONS = "true";
      worker = workerPlan([]);
      expect(worker.runDir).toBeNull();
    } finally {
      if (savedGitHubActions === undefined) delete process.env.GITHUB_ACTIONS;
      else process.env.GITHUB_ACTIONS = savedGitHubActions;
      worker?.cleanup();
    }
  });
});

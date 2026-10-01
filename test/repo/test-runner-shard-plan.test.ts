import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { loadTestConfig } from "../../scripts/test/config.mjs";
import { enumerateTestInventory, enumerateTrackedPaths, loadRegistrySnapshotAtCommit } from "../../scripts/test/file-inventory.mjs";
import { readGhaPlanAgreementParts, validateGhaPlanAgreement } from "../../scripts/test/gha-plan-agreement.mjs";
import { createShardPlan, nearestRankP90, recommendShardCount, validateShardPlan } from "../../scripts/test/shard-plan.mjs";
import { serializeTimingBaseline, type TimingBaseline } from "../../scripts/test/timing-baseline.mjs";

const commit = "a".repeat(40);
const tree = "b".repeat(40);
const provider = "local-linux-x64-4cpu";
const baselineProvider = "blaxel-playwright-x64-4vcpu";
const surfaces = [surface("one", "vitest"), surface("two", "playwright")];

describe("duration-aware shard planning", () => {
  test("gives every tracked canonical repository test inside a registered root exactly one owner", () => {
    const config = loadTestConfig();
    const inventory = enumerateTestInventory({ surfaces: config.surfaces });
    expect(inventory.length).toBeGreaterThan(250);
    expect(new Set(inventory.map((file) => file.path)).size).toBe(inventory.length);
  });

  test("enumerates the same tracked inventory from the checkout and a temporary commit index", async () => {
    const repo = inventoryRepository();
    try {
      const current = enumerateTrackedPaths({ repoRoot: repo.root });
      const fromCommit = enumerateTrackedPaths({ repoRoot: repo.root, commit: repo.commit });
      expect(fromCommit).toEqual(current);
      writeFileSync(path.join(repo.root, "test/one/untracked.test.ts"), "// untracked\n");
      const registry = await loadRegistrySnapshotAtCommit({ repoRoot: repo.root, commit: repo.commit });
      const inventory = enumerateTestInventory({ repoRoot: repo.root, surfaces: registry.surfaces, selectedSurfaceIds: ["one", "two"], commit: repo.commit });
      expect(inventory).toEqual([
        { path: "test/one/a.test.ts", surfaceId: "one", runner: "vitest" },
        { path: "test/one/exact.spec.ts", surfaceId: "two", runner: "playwright" },
      ]);
      expect(inventory.some((file) => file.path.includes("untracked"))).toBe(false);
      expect(registry.registryDigest).toMatch(/^[a-f0-9]{64}$/);
    } finally {
      rmSync(repo.root, { recursive: true, force: true });
    }
  });

  test("skips index-tracked paths deleted from the worktree", () => {
    const repo = inventoryRepository();
    try {
      const deleted = "test/one/a.test.ts";
      rmSync(path.join(repo.root, deleted));

      expect(enumerateTrackedPaths({ repoRoot: repo.root })).not.toContain(deleted);
      expect(enumerateTrackedPaths({ repoRoot: repo.root, commit: repo.commit })).toContain(deleted);
    } finally {
      rmSync(repo.root, { recursive: true, force: true });
    }
  });

  test("enforces filename, root, exclusion, zero-owner, multiple-owner, and config boundaries", () => {
    const repo = inventoryRepository();
    try {
      expect(enumerateTestInventory({ repoRoot: repo.root, surfaces: [surface("one", "vitest", { config: "one.config.ts", roots: ["test/one"] })], commit: repo.commit }).map((file) => file.path)).toEqual(["test/one/a.test.ts", "test/one/exact.spec.ts"]);
      const zeroOwner = [surface("one", "vitest", { config: "one.config.ts", roots: ["test/one"], excludeRoots: ["test/one/exact.spec.ts"] })];
      expect(() => enumerateTestInventory({ repoRoot: repo.root, surfaces: zeroOwner, commit: repo.commit })).toThrow("no registry owner after exclusions");
      const duplicate = [surface("one", "vitest", { config: "one.config.ts", roots: ["test/one"] }), surface("two", "playwright", { config: "two.config.ts", roots: ["test/one"] })];
      expect(() => enumerateTestInventory({ repoRoot: repo.root, surfaces: duplicate, commit: repo.commit })).toThrow("2 registry owners");
      expect(() => enumerateTestInventory({ repoRoot: repo.root, surfaces: [surface("one", "vitest", { config: "missing.config.ts", roots: ["test/one"] })], commit: repo.commit })).toThrow("config is missing");
    } finally {
      rmSync(repo.root, { recursive: true, force: true });
    }
  });

  test("applies global LPT and materializes every surface on every shard", () => {
    const inventory = [file("a", "one", "vitest"), file("b", "one", "vitest"), file("c", "two", "playwright"), file("d", "two", "playwright")];
    const baseline = timingBaseline({ a: ["one", 10], b: ["one", 9], c: ["two", 8], d: ["two", 7] });
    const plan = createShardPlan({ inventory, surfaces, baseline, baselineBytes: serializeTimingBaseline(baseline), timingProvider: provider, testedCommit: commit, testedTree: tree, shardTotal: 2 });
    expect(plan.shards.map((shard) => [shard.predictedDurationMs, shard.surfaces.map((entry) => [entry.surfaceId, entry.files.map((item) => item.path)])])).toEqual([
      [17, [["one", ["test/a.test.ts"]], ["two", ["test/d.test.ts"]]]],
      [17, [["one", ["test/b.test.ts"]], ["two", ["test/c.test.ts"]]]],
    ]);
    expect(validateShardPlan(plan, { inventory, timingProvider: provider, testedCommit: commit, testedTree: tree, shardTotal: 2, shardIndex: 1 })).toBe(plan);
    expect(() => validateShardPlan({ ...plan, planId: "0".repeat(64) }, { inventory })).toThrow("digest mismatch");
    expect(() => validateShardPlan(plan, { timingProvider: "local-linux-x64-8cpu" })).toThrow("timing provider mismatch");
    expect(() => validateShardPlan(plan, { testedCommit: "c".repeat(40) })).toThrow("tested commit mismatch");
    expect(() => validateShardPlan(plan, { testedTree: "d".repeat(40) })).toThrow("tested tree mismatch");
    expect(() => validateShardPlan(plan, { shardTotal: 3 })).toThrow("total mismatch");
    expect(() => validateShardPlan(plan, { shardIndex: 3 })).toThrow("does not contain index 3");
  });

  test("weighs every plan by Blaxel history and gives unknown files generous weights", () => {
    const inventory = [file("known", "one", "vitest"), file("unknown", "one", "vitest"), file("baseline-wide", "two", "playwright")];
    const baseline: TimingBaseline = {
      schemaVersion: 1, sourceThrough: "2026-01-01T00:00:00.000Z", files: {
        "test/known.test.ts": { surfaceId: "one", providers: { [baselineProvider]: timing(1_000) } },
      },
    };
    for (const timingProvider of [provider, baselineProvider, "github-ubuntu-24.04-x64-2vcpu-vm"] as const) {
      const plan = createShardPlan({ inventory, surfaces, baseline, baselineBytes: serializeTimingBaseline(baseline), timingProvider, testedCommit: commit, testedTree: tree, shardTotal: 1 });
      expect(plan.timingProvider).toBe(timingProvider);
      const planned = plan.shards[0].surfaces.flatMap((entry) => entry.files);
      expect(planned.find((entry) => entry.path.endsWith("known.test.ts")), timingProvider).toMatchObject({ weightMs: 1_000, weightSource: "baseline", baselineSampleCount: 1 });
      expect(planned.find((entry) => entry.path.endsWith("unknown.test.ts")), timingProvider).toMatchObject({ weightMs: 30_000, weightSource: "unknown-surface" });
      expect(planned.find((entry) => entry.path.endsWith("baseline-wide.test.ts")), timingProvider).toMatchObject({ weightMs: 30_000, weightSource: "unknown-surface" });
    }
    const otherSubstrate = { ...baseline, files: { "test/known.test.ts": { surfaceId: "one", providers: { "github-ubuntu-24.04-x64-2vcpu-vm": timing(1_000) } } } } as unknown as TimingBaseline;
    expect(() => createShardPlan({ inventory, surfaces, baseline: otherSubstrate, baselineBytes: "{}", timingProvider: provider, testedCommit: commit, testedTree: tree, shardTotal: 1 })).toThrow(`only ${baselineProvider}`);
    const empty: TimingBaseline = { schemaVersion: 1, sourceThrough: null, files: {} };
    const emptyPlan = createShardPlan({ inventory: [file("new", "one", "vitest")], surfaces: [surfaces[0]], baseline: empty, baselineBytes: serializeTimingBaseline(empty), timingProvider: provider, testedCommit: commit, testedTree: tree, shardTotal: 1 });
    expect(emptyPlan.shards[0].surfaces[0].files[0]).toMatchObject({ weightMs: 60_000, weightSource: "unknown-timing-provider" });
    expect(nearestRankP90([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])).toBe(9);
  });

  test("keeps planner imports runnable in the checkout-only join job", () => {
    const source = readFileSync(path.join(process.cwd(), "scripts/test/shard-plan.mjs"), "utf8");
    const imports = [...source.matchAll(/from\s+["']([^"']+)["']/g)].map((match) => match[1]);

    expect(imports).toEqual(expect.arrayContaining(["node:crypto", "./timing-events.mjs", "./timing-baseline.mjs"]));
    expect(imports.every((specifier) => specifier.startsWith("node:") || specifier.startsWith("./"))).toBe(true);
  });

  test("is byte-identical across 50 processes and stays within planning bounds", { timeout: 20_000 }, () => {
    const modulePath = path.join(process.cwd(), "scripts/test/shard-plan.mjs");
    const input = {
      inventory: Array.from({ length: 100 }, (_, index) => file(`f-${index}`, index % 2 ? "one" : "two", index % 2 ? "vitest" : "playwright")),
      surfaces,
      baseline: { schemaVersion: 1, sourceThrough: null, files: {} },
      baselineBytes: serializeTimingBaseline({ schemaVersion: 1, sourceThrough: null, files: {} }).toString("base64"),
      timingProvider: provider, testedCommit: commit, testedTree: tree, shardTotal: 8,
    };
    const program = `import {createShardPlan} from ${JSON.stringify(pathToFileUrl(modulePath))};const i=JSON.parse(Buffer.from(process.argv[1],"base64"));i.baselineBytes=Buffer.from(i.baselineBytes,"base64");const p=createShardPlan(i);process.stdout.write(JSON.stringify(p));`;
    const encoded = Buffer.from(JSON.stringify(input)).toString("base64");
    const outputs: Buffer[] = [];
    const times: number[] = [];
    for (let index = 0; index < 50; index += 1) {
      const started = performance.now();
      const result = spawnSync(process.execPath, ["--input-type=module", "-e", program, encoded], { maxBuffer: 2 * 1024 * 1024 });
      times.push(performance.now() - started);
      expect(result.status, result.stderr.toString()).toBe(0);
      outputs.push(result.stdout);
    }
    expect(new Set(outputs.map((output) => output.toString("utf8"))).size).toBe(1);
    expect(outputs[0].byteLength).toBeLessThan(1024 * 1024);
    times.sort((left, right) => left - right);
    expect(times[Math.ceil(times.length * 0.95) - 1]).toBeLessThan(500);
  });

  test("requires complete direct-GitHub shard and plan agreement", () => {
    const inventory = [file("a", "one", "vitest"), file("b", "one", "vitest"), file("c", "two", "playwright")];
    const plan = createShardPlan({ inventory, surfaces, baseline: emptyBaseline(), baselineBytes: serializeTimingBaseline(emptyBaseline()), timingProvider: "github-playwright-noble-x64-2vcpu", testedCommit: commit, testedTree: tree, shardTotal: 2 });
    const parts = plan.shards.map((shard) => ({ plan, summary: summaryFor(plan, shard.index) }));
    expect(validateGhaPlanAgreement({ parts, expectedShardTotal: 2 })).toMatchObject({ planId: plan.planId, timingProvider: plan.timingProvider, testedTree: tree, shardTotal: 2, assignedFileCount: 3 });
    const downloaded = mkdtempSync(path.join(os.tmpdir(), "tv-gha-agreement-"));
    try {
      for (const part of parts) {
        const providerDir = path.join(downloaded, `artifact-${part.summary.shardIndex}`, "provider/github");
        mkdirSync(providerDir, { recursive: true });
        writeFileSync(path.join(providerDir, `shard-${part.summary.shardIndex}.json`), `${JSON.stringify(part.summary)}\n`);
        writeFileSync(path.join(providerDir, "shard-plan.json"), `${JSON.stringify(part.plan)}\n`);
      }
      expect(validateGhaPlanAgreement({ parts: readGhaPlanAgreementParts(downloaded), expectedShardTotal: 2 })).toMatchObject({ status: "passed", assignedFileCount: 3 });
      const cliOutput = path.join(downloaded, "agreement.json");
      const cli = spawnSync(process.execPath, ["scripts/test/gha-plan-agreement.mjs", "--root", downloaded, "--shards", "2", "--output", cliOutput], { cwd: process.cwd(), encoding: "utf8" });
      expect(cli.status, cli.stderr).toBe(0);
      expect(JSON.parse(readFileSync(cliOutput, "utf8"))).toMatchObject({ status: "passed", assignedFileCount: 3 });
    } finally { rmSync(downloaded, { recursive: true, force: true }); }

    const rejects = (mutate: (value: any[]) => void, message: string) => {
      const changed = structuredClone(parts);
      mutate(changed);
      expect(() => validateGhaPlanAgreement({ parts: changed, expectedShardTotal: 2 })).toThrow(message);
    };
    rejects((value) => { value[1].summary.planId = "0".repeat(64); }, "planId disagreement");
    rejects((value) => { value[1].summary.timingProvider = "github-ubuntu-24.04-x64-2vcpu-vm"; }, "timingProvider disagreement");
    rejects((value) => { value[1].summary.testedTree = "c".repeat(40); }, "testedTree disagreement");
    rejects((value) => { value[1].summary.shardTotal = 3; }, "shardTotal disagreement");
    rejects((value) => { value[1].summary.shardIndex = 1; }, "duplicate shard index");
    expect(() => validateGhaPlanAgreement({ parts: parts.slice(0, 1), expectedShardTotal: 2 })).toThrow("missing shard index");
    rejects((value) => { value[0].summary.collectedFiles = []; }, "assigned/collected mismatch");
    rejects((value) => { value[0].summary.assignedFiles = []; value[0].summary.collectedFiles = []; }, "assigned files disagree with plan");
    rejects((value) => { for (const part of value) { part.plan.testedTree = "d".repeat(40); part.summary.testedTree = "d".repeat(40); } }, "digest mismatch");
  });

  test("recommends the smallest count under target and flags an oversized atomic file", () => {
    const inventory = [file("a", "one", "vitest"), file("b", "one", "vitest"), file("c", "one", "vitest")];
    const baseline = timingBaseline({ a: ["one", 80_000], b: ["one", 80_000], c: ["one", 130_000] });
    const recommendation = recommendShardCount({ inventory, surfaces: [surfaces[0]], baseline, baselineBytes: serializeTimingBaseline(baseline), timingProvider: provider, testedCommit: commit, testedTree: tree, shardTotal: 1, capacity: 4, currentCount: 2 });
    expect(recommendation).toMatchObject({ recommendedCount: 4, heaviestAtomicFileMs: 130_000, arithmeticLowerBoundMs: 130_000, atomicFileExceedsTarget: true, totalPredictedFileWorkMs: 290_000 });
  });
});

function summaryFor(plan: any, shardIndex: number) {
  const assignedFiles = plan.shards[shardIndex - 1].surfaces.flatMap((surface: any) => surface.files.map((entry: any) => entry.path)).sort();
  return {
    schemaVersion: 1, status: "passed", shardIndex, shardTotal: plan.shardTotal, planId: plan.planId,
    timingProvider: plan.timingProvider, testedCommit: plan.testedCommit, testedTree: plan.testedTree,
    assignedFiles, collectedFiles: [...assignedFiles], tasks: [],
  };
}

function emptyBaseline(): TimingBaseline {
  return { schemaVersion: 1, sourceThrough: null, files: {} };
}

function inventoryRepository() {
  const root = mkdtempSync(path.join(os.tmpdir(), "tv-inventory-"));
  git(root, "init");
  git(root, "config", "user.name", "Test");
  git(root, "config", "user.email", "test@example.invalid");
  mkdirSync(path.join(root, "test/one"), { recursive: true });
  writeFileSync(path.join(root, "one.config.ts"), "export default {}\n");
  writeFileSync(path.join(root, "two.config.ts"), "export default {}\n");
  writeFileSync(path.join(root, "test/one/a.test.ts"), "// a\n");
  writeFileSync(path.join(root, "test/one/exact.spec.ts"), "// exact\n");
  writeFileSync(path.join(root, "test/outside.test.ts"), "// outside\n");
  writeFileSync(path.join(root, "test/one/not-a-test.ts"), "// source\n");
  writeFileSync(path.join(root, "test.config.mjs"), `export default {suites:{all:{include:["kind:unit","kind:e2e"]}},executionGroups:[{id:"g",name:"g",order:1,surfaces:[{id:"one",runner:"vitest",config:"one.config.ts",kind:"unit",roots:["test/one"],excludeRoots:["test/one/exact.spec.ts"],supports:[],preflight:[],tags:[],agent:false,command:null,preCommand:null},{id:"two",runner:"playwright",config:"two.config.ts",kind:"e2e",roots:["test/one/exact.spec.ts"],excludeRoots:[],supports:[],preflight:[],tags:[],agent:false,command:null,preCommand:null}]}]};\n`);
  writeFileSync(path.join(root, "test/timing-baseline.json"), '{"schemaVersion":1,"sourceThrough":null,"files":{}}\n');
  git(root, "add", ".");
  git(root, "commit", "-m", "fixture");
  return { root, commit: git(root, "rev-parse", "HEAD") };
}

function surface(id: string, runner: "vitest" | "playwright", overrides: Record<string, unknown> = {}) {
  return { id, runner, config: `${id}.config.ts`, kind: runner === "vitest" ? "unit" : "e2e", package: null, roots: [`test/${id}`], excludeRoots: [], supports: [], preflight: [], tags: [], agent: false, command: null, preCommand: null, executionGroup: null, cwd: ".", absoluteConfig: `${id}.config.ts`, ...overrides } as any;
}

function file(name: string, surfaceId: string, runner: "vitest" | "playwright") {
  return { path: `test/${name}.test.ts`, surfaceId, runner };
}

function timing(value: number) {
  return { medianDurationMs: value, sampleCount: 1, retryCount: 0, recoveredFlakeCount: 0, lastUpdated: "2026-01-01T00:00:00.000Z" };
}

function timingBaseline(entries: Record<string, [string, number]>): TimingBaseline {
  return {
    schemaVersion: 1, sourceThrough: "2026-01-01T00:00:00.000Z",
    files: Object.fromEntries(Object.entries(entries).map(([name, [surfaceId, value]]) => [`test/${name}.test.ts`, { surfaceId, providers: { [baselineProvider]: timing(value) } }])),
  };
}

function pathToFileUrl(file: string) {
  return `file://${file}`;
}

function git(cwd: string, ...args: string[]) {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

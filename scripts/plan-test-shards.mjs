#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { selectSurfaces } from "./test/config.mjs";
import { enumerateTestInventory, loadRegistrySnapshotAtCommit } from "./test/file-inventory.mjs";
import { createShardPlan } from "./test/shard-plan.mjs";
import { validateTimingBaseline } from "./test/timing-baseline.mjs";

const options = parseArgs(process.argv.slice(2));
const repoRoot = process.cwd();
const commit = git(["rev-parse", "--verify", `${options.commit ?? "HEAD"}^{commit}`]);
const tree = git(["rev-parse", "--verify", `${commit}^{tree}`]);
const timingProvider = options["timing-provider"] ?? process.env.TV_TEST_TIMING_PROVIDER;
if (!timingProvider) fail("--timing-provider or TV_TEST_TIMING_PROVIDER is required");
const shardTotal = Number(options.shards);
if (!Number.isSafeInteger(shardTotal) || shardTotal < 1) fail("--shards must be a positive integer");
if (!options.output) fail("--output is required");

const config = await loadRegistrySnapshotAtCommit({ repoRoot, commit });
const selected = options.surfaces ? selectSurfaces(config, { surface: options.surfaces }) : selectSurfaces(config, { suite: options.suite ?? "all" });
if (selected.length === 0) fail("selection matched no test surfaces");
const inventory = enumerateTestInventory({ repoRoot, surfaces: config.surfaces, selectedSurfaceIds: selected.map((surface) => surface.id), commit });
let baselineBytes;
try { baselineBytes = Buffer.from(execFileSync("git", ["show", `${commit}:test/timing-baseline.json`], { cwd: repoRoot })); }
catch { fail(`test/timing-baseline.json is missing from ${commit}`); }
let baseline;
try { baseline = JSON.parse(baselineBytes.toString("utf8")); validateTimingBaseline(baseline); }
catch (error) { fail(`invalid timing baseline at ${commit}: ${error.message}`); }
const plan = createShardPlan({ inventory, surfaces: selected, baseline, baselineBytes, timingProvider, testedCommit: commit, testedTree: tree, shardTotal });
const output = path.resolve(options.output);
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, `${JSON.stringify(plan, null, 2)}\n`);
console.log(`plan ${plan.planId} files=${inventory.length} shards=${shardTotal} tree=${tree}`);

function parseArgs(args) {
  const parsed = {};
  for (let index = 0; index < args.length; index += 1) {
    const name = args[index];
    if (!["--commit", "--suite", "--surfaces", "--timing-provider", "--shards", "--output"].includes(name)) fail(`unknown argument ${name}`);
    const value = args[++index];
    if (value == null) fail(`${name} requires a value`);
    parsed[name.slice(2)] = value;
  }
  return parsed;
}

function git(args) {
  return execFileSync("git", args, { cwd: repoRoot, encoding: "utf8" }).trim();
}

function fail(message) {
  console.error(message);
  process.exit(2);
}

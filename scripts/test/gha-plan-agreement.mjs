#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { validateShardPlan } from "./shard-plan.mjs";

export function validateGhaPlanAgreement({ parts, expectedShardTotal }) {
  if (!Number.isSafeInteger(expectedShardTotal) || expectedShardTotal < 1) throw new Error("expected shard total must be a positive integer");
  if (!Array.isArray(parts)) throw new Error("shard agreement parts must be an array");

  const byIndex = new Map();
  for (const part of parts) {
    const index = part?.summary?.shardIndex;
    if (!Number.isSafeInteger(index) || index < 1) throw new Error(`invalid shard index ${index ?? "missing"}`);
    if (byIndex.has(index)) throw new Error(`duplicate shard index ${index}`);
    byIndex.set(index, part);
  }
  for (let index = 1; index <= expectedShardTotal; index += 1) {
    if (!byIndex.has(index)) throw new Error(`missing shard index ${index}`);
  }
  if (byIndex.size !== expectedShardTotal) throw new Error(`unexpected shard index outside 1..${expectedShardTotal}`);

  const ordered = [...byIndex.entries()].sort(([left], [right]) => left - right).map(([, part]) => part);
  const first = ordered[0].summary;
  const agreementFields = ["planId", "timingProvider", "testedCommit", "testedTree", "shardTotal"];
  for (const field of agreementFields) {
    if (first[field] == null) throw new Error(`shard 1 is missing ${field}`);
    for (const part of ordered.slice(1)) {
      if (part.summary[field] !== first[field]) throw new Error(`${field} disagreement across GitHub shards`);
    }
  }
  if (first.shardTotal !== expectedShardTotal) throw new Error(`shardTotal disagreement: expected ${expectedShardTotal}, received ${first.shardTotal}`);

  const globallyAssigned = [];
  for (const part of ordered) {
    const { summary, plan } = part;
    if (!plan) throw new Error(`shard ${summary.shardIndex} is missing shard-plan.json`);
    if (summary.status !== "passed") throw new Error(`shard ${summary.shardIndex} did not pass`);
    validateShardPlan(plan, {
      timingProvider: summary.timingProvider,
      testedCommit: summary.testedCommit,
      testedTree: summary.testedTree,
      shardIndex: summary.shardIndex,
      shardTotal: summary.shardTotal,
    });
    if (plan.planId !== summary.planId) throw new Error(`shard ${summary.shardIndex} planId disagrees with shard-plan.json`);
    const expectedFiles = plan.shards[summary.shardIndex - 1].surfaces.flatMap((surface) => surface.files.map((file) => file.path)).sort();
    const assignedFiles = normalizedFiles(summary.assignedFiles, `shard ${summary.shardIndex} assignedFiles`);
    const collectedFiles = normalizedFiles(summary.collectedFiles, `shard ${summary.shardIndex} collectedFiles`);
    if (!sameFiles(assignedFiles, expectedFiles)) throw new Error(`shard ${summary.shardIndex} assigned files disagree with plan`);
    if (!sameFiles(assignedFiles, collectedFiles)) throw new Error(`shard ${summary.shardIndex} assigned/collected mismatch`);
    globallyAssigned.push(...assignedFiles);
  }
  if (new Set(globallyAssigned).size !== globallyAssigned.length) throw new Error("a test file is assigned by more than one GitHub shard");

  const planInventory = ordered[0].plan.shards.flatMap((shard) => shard.surfaces.flatMap((surface) => surface.files.map((file) => file.path))).sort();
  if (!sameFiles([...globallyAssigned].sort(), planInventory)) throw new Error("GitHub shard summaries do not cover the complete plan inventory");
  return {
    schemaVersion: 1,
    status: "passed",
    planId: first.planId,
    timingProvider: first.timingProvider,
    testedCommit: first.testedCommit,
    testedTree: first.testedTree,
    shardTotal: expectedShardTotal,
    assignedFileCount: globallyAssigned.length,
  };
}

export function readGhaPlanAgreementParts(root) {
  const summaries = findFiles(path.resolve(root), /^shard-\d+\.json$/).filter((file) => path.basename(path.dirname(file)) === "github");
  return summaries.map((summaryPath) => {
    const planPath = path.join(path.dirname(summaryPath), "shard-plan.json");
    if (!fs.existsSync(planPath)) throw new Error(`${summaryPath} has no sibling shard-plan.json`);
    return { summary: readJson(summaryPath), plan: readJson(planPath), summaryPath, planPath };
  });
}

function normalizedFiles(value, name) {
  if (!Array.isArray(value) || value.some((file) => typeof file !== "string" || file.length === 0)) throw new Error(`${name} must contain paths`);
  const sorted = [...value].sort();
  if (new Set(sorted).size !== sorted.length) throw new Error(`${name} contains duplicates`);
  return sorted;
}

function sameFiles(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function findFiles(root, pattern) {
  if (!fs.existsSync(root)) return [];
  const found = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) found.push(...findFiles(fullPath, pattern));
    else if (pattern.test(entry.name)) found.push(fullPath);
  }
  return found.sort();
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch (error) { throw new Error(`failed to read ${file}: ${error.message}`); }
}

function parseArgs(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index];
    const value = args[index + 1];
    if (!["--root", "--shards", "--output"].includes(name) || value == null) throw new Error("Usage: gha-plan-agreement --root <download-dir> --shards <count> [--output <file>]");
    options[name.slice(2)] = value;
  }
  return options;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const options = parseArgs(process.argv.slice(2));
    const result = validateGhaPlanAgreement({ parts: readGhaPlanAgreementParts(options.root), expectedShardTotal: Number(options.shards) });
    const text = `${JSON.stringify(result, null, 2)}\n`;
    if (options.output) {
      fs.mkdirSync(path.dirname(path.resolve(options.output)), { recursive: true });
      fs.writeFileSync(path.resolve(options.output), text);
    }
    process.stdout.write(text);
  } catch (error) {
    console.error(error?.message ?? error);
    process.exit(1);
  }
}

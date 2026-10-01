#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(SCRIPT_PATH), "..");

function readNpmVersion() {
  const result = spawnSync("npm", ["--version"], { encoding: "utf8" });
  if (result.status !== 0) return "unavailable";
  return result.stdout.trim() || "unavailable";
}

function parseVersion(value) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(value);
  if (!match) return null;
  return match.slice(1, 4).map(Number);
}

function compareVersions(left, right) {
  for (let index = 0; index < 3; index++) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return 0;
}

function npmVersionSatisfies(version, range) {
  const actual = parseVersion(version);
  const match = /^>=(\d+)\.(\d+)(?:\.(\d+))? <(\d+)$/.exec(range);
  if (!actual || !match) return false;
  const lower = [Number(match[1]), Number(match[2]), Number(match[3] ?? 0)];
  return compareVersions(actual, lower) >= 0 && actual[0] < Number(match[4]);
}

export function checkToolchain({ root = REPO_ROOT, nodeVersion = process.version, npmVersion = readNpmVersion() } = {}) {
  let selector = "unreadable";
  let nodeRange = "unreadable";
  let npmRange = "unreadable";

  try {
    selector = readFileSync(path.join(root, ".nvmrc"), "utf8").trim();
    const manifest = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
    nodeRange = manifest.engines?.node ?? "undeclared";
    npmRange = manifest.engines?.npm ?? "undeclared";
  } catch {
    // Declaration failures use the same diagnostic as version failures.
  }

  const node = parseVersion(nodeVersion);
  const declarationsAgree = /^\d+$/.test(selector) && nodeRange === `${selector}.x`;
  const nodeMatches = declarationsAgree && node?.[0] === Number(selector);
  const npmMatches = npmVersionSatisfies(npmVersion, npmRange);

  if (!declarationsAgree) {
    return {
      ok: false,
      nodeVersion,
      npmVersion,
      nodeRange,
      npmRange,
      message: `Television toolchain declarations disagree: .nvmrc selects Node ${selector}, but package.json engines.node requires ${nodeRange}. Align .nvmrc and engines.node, then retry; found Node ${nodeVersion} and npm ${npmVersion} (expected npm ${npmRange}).`,
    };
  }

  if (nodeMatches && npmMatches) {
    return { ok: true, nodeVersion, npmVersion, nodeRange, npmRange };
  }

  return {
    ok: false,
    nodeVersion,
    npmVersion,
    nodeRange,
    npmRange,
    message: `Unsupported Television toolchain: expected Node ${nodeRange} and npm ${npmRange}; found Node ${nodeVersion} and npm ${npmVersion}. Run \`nvm use\` from the repository root to select the runtime in .nvmrc, then retry.`,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === SCRIPT_PATH) {
  const result = checkToolchain();
  if (!result.ok) {
    console.error(result.message);
    process.exit(1);
  }
}

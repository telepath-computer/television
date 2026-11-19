import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { normalizeTestConfig, owningSurfaces } from "./config.mjs";

export const TEST_FILE_PATTERN = /(?:^|\/)[^/]+\.(?:test|spec)\.(?:[cm]?[jt]s)x?$/;

export function enumerateTestInventory({ repoRoot = process.cwd(), surfaces, selectedSurfaceIds = surfaces.map((surface) => surface.id), commit = null } = {}) {
  const tracked = enumerateTrackedPaths({ repoRoot, commit });
  const trackedSet = new Set(tracked);
  for (const surface of surfaces) {
    if (!trackedSet.has(surface.config)) throw new Error(`surface ${surface.id} config is missing from tested tree: ${surface.config}`);
  }
  const selected = new Set(selectedSurfaceIds);
  const files = [];
  for (const file of tracked.filter((entry) => TEST_FILE_PATTERN.test(entry))) {
    const owners = owningSurfaces(surfaces, file);
    const insideRegisteredRoot = surfaces.some((surface) => surface.roots.some((root) => contains(root, file)));
    if (owners.length === 0 && insideRegisteredRoot) throw new Error(`${file} has no registry owner after exclusions`);
    if (owners.length === 0) continue;
    if (owners.length !== 1) throw new Error(`${file} has ${owners.length} registry owners: ${owners.map((owner) => owner.id).join(", ")}`);
    const owner = owners[0];
    if (selected.has(owner.id)) files.push({ path: file, surfaceId: owner.id, runner: owner.runner });
  }
  return files.sort((left, right) => left.path.localeCompare(right.path));
}

export function enumerateTrackedPaths({ repoRoot = process.cwd(), commit = null, includeUntracked = false } = {}) {
  if (!commit) {
    // The index retains unstaged deletions; current-worktree consumers must not
    // try to inspect paths that are tracked there but absent from this tree.
    return [...new Set(splitNull(git(["ls-files", "--cached", ...(includeUntracked ? ["--others", "--exclude-standard"] : []), "-z"], { cwd: repoRoot })))]
      .filter((file) => worktreePathExists(path.join(repoRoot, file)));
  }
  const index = path.join(os.tmpdir(), `tv-test-index-${process.pid}-${crypto.randomBytes(8).toString("hex")}`);
  const env = { ...process.env, GIT_INDEX_FILE: index };
  try {
    git(["read-tree", `${commit}^{tree}`], { cwd: repoRoot, env });
    return splitNull(git(["ls-files", "--cached", "-z"], { cwd: repoRoot, env }));
  } finally {
    fs.rmSync(index, { force: true });
    fs.rmSync(`${index}.lock`, { force: true });
  }
}

export async function loadRegistrySnapshotAtCommit({ repoRoot = process.cwd(), commit = "HEAD" } = {}) {
  commit = git(["rev-parse", "--verify", "--end-of-options", `${commit}^{commit}`], { cwd: repoRoot }).trim();
  const source = git(["show", `${commit}:test.config.mjs`], { cwd: repoRoot });
  const digest = crypto.createHash("sha256").update(source).digest("hex");
  const url = `data:text/javascript;base64,${Buffer.from(source).toString("base64")}#${digest}`;
  let raw;
  try { raw = (await import(url)).default; } catch (error) { throw new Error(`could not load test registry from ${commit}: ${error.message}`); }
  // Package locations belong to the tested tree just as the registry does.
  // In particular, a package's native config need not live at its package root.
  const packageDirs = new Map();
  for (const file of enumerateTrackedPaths({ repoRoot, commit })) {
    if (path.posix.basename(file) !== "package.json" || /(?:^|\/)(?:node_modules|dist|\.git|\.blaxel-testshards|\.testshards|\.test-runs)\//.test(file)) continue;
    const source = git(["show", `${commit}:${file}`], { cwd: repoRoot });
    try {
      const pkg = JSON.parse(source);
      if (pkg.name) packageDirs.set(pkg.name, path.posix.dirname(file));
    } catch {}
  }
  return { ...normalizeTestConfig(raw, { root: repoRoot, packageDirs }), registryDigest: digest, commit };
}

function contains(root, file) {
  return file === root || file.startsWith(`${root}/`);
}

function splitNull(value) {
  return value.split("\0").filter(Boolean).map(normalizePath).sort();
}

function normalizePath(value) {
  return String(value).replaceAll("\\", "/").replace(/^\.\//, "");
}

function worktreePathExists(file) {
  try {
    fs.lstatSync(file);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

function git(args, { cwd, env = process.env } = {}) {
  return execFileSync("git", args, { cwd, env, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
}

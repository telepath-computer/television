#!/usr/bin/env node
// Build the bundled artifact views into `packages/cli/dist/views/<id>/`.
//
// Reads `bundled-views.json` — a map from view id (the on-disk folder name
// under `dist/views/`) to the repo-relative path of the view's workspace
// package. For each entry:
//
//   1. Run `npm --workspace <pkg> run build`.
//   2. Recursively copy `<pkg>/dist/` into `packages/cli/dist/views/<id>/`.
//   3. Verify that `dist/views/<id>/manifest.json` exists; fail the whole
//      build otherwise so a broken view never ships.

import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(packageDir, "../..");
const manifestPath = path.join(packageDir, "bundled-views.json");

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
if (typeof manifest !== "object" || manifest === null || Array.isArray(manifest)) {
  throw new Error(`bundled-views.json must be a JSON object`);
}

const outRoot = path.join(packageDir, "dist", "views");
mkdirSync(outRoot, { recursive: true });

for (const [viewID, relPackagePath] of Object.entries(manifest)) {
  if (typeof relPackagePath !== "string" || relPackagePath.length === 0) {
    throw new Error(`Invalid entry for view "${viewID}": expected a non-empty string path`);
  }

  const pkgPath = path.resolve(repoRoot, relPackagePath);
  if (!existsSync(pkgPath)) {
    throw new Error(`View "${viewID}": package path does not exist: ${pkgPath}`);
  }

  process.stdout.write(`building view "${viewID}" from ${relPackagePath}\n`);

  const result = spawnSync("npm", ["--workspace", relPackagePath, "run", "build"], {
    cwd: repoRoot,
    stdio: "inherit",
  });
  if (result.status !== 0) {
    throw new Error(`View "${viewID}": build failed (exit ${result.status ?? "signal"})`);
  }

  const srcDist = path.join(pkgPath, "dist");
  if (!existsSync(srcDist)) {
    throw new Error(`View "${viewID}": build produced no dist/ at ${srcDist}`);
  }

  const dest = path.join(outRoot, viewID);
  rmSync(dest, { recursive: true, force: true });
  cpSync(srcDist, dest, { recursive: true });

  const manifestFile = path.join(dest, "manifest.json");
  if (!existsSync(manifestFile)) {
    throw new Error(
      `View "${viewID}": manifest.json missing after build (expected at ${manifestFile})`,
    );
  }

  process.stdout.write(`  -> ${path.relative(repoRoot, dest)}\n`);
}

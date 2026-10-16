#!/usr/bin/env node
// Build only the browser component files used by the onboarding bake.
import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(packageRoot, "../..");
const outputRoot = path.resolve(process.env.TV_ONBOARDING_COMPONENTS_DIST_DIR ?? path.join(packageRoot, "onboarding-dist"));
rmSync(outputRoot, { recursive: true, force: true });
mkdirSync(outputRoot, { recursive: true });

for (const name of ["tv-calendar", "tv-tasks"]) {
  const packageName = `@telepath-computer/skill-${name}`;
  const result = spawnSync("npm", ["--workspace", packageName, "run", "build"], {
    cwd: repoRoot,
    stdio: "inherit",
  });
  if (result.status !== 0) throw new Error(`${packageName} build failed (exit ${result.status ?? "signal"})`);
}

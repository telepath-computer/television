#!/usr/bin/env node
// Bundle the resource SDK into packages/server/dist/sdk/v1/resources.js
// (specs/arch/resources/sdk.md#^sdk-build), with its third-party notices beside
// it (specs/arch/licensing.md#^licensing-sdk-notices). The metafile is written
// beside dist/sdk/, not inside it, because the CLI copies that tree
// byte-for-byte; the build contract reads it to check that every input is
// first-party source. `TV_SDK_DIST_DIR` redirects the output for repository
// tests, and the license inventory with it, so a test's build leaves the
// repository's inventory root alone.

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { generateNoticesFromEsbuild } from "../../../scripts/licenses/generate-notices.mjs";
import { resolveInventoryRoot } from "../../../scripts/licenses/lib/inventory.mjs";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const repoRoot = path.resolve(packageRoot, "../..");
const sdkDist = resolvePathOverride("TV_SDK_DIST_DIR", path.join(packageRoot, "dist", "sdk"));
const inventoryRoot = process.env.TV_SDK_DIST_DIR
  ? path.join(path.dirname(sdkDist), ".licenses-inventory")
  : resolveInventoryRoot({ root: repoRoot });

rmSync(sdkDist, { recursive: true, force: true });
mkdirSync(sdkDist, { recursive: true });

const result = await build({
  absWorkingDir: repoRoot,
  entryPoints: ["packages/shared/src/resources/sdk.ts"],
  outfile: path.join(sdkDist, "v1", "resources.js"),
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  metafile: true,
  legalComments: "none",
  logLevel: "warning",
});

writeFileSync(path.join(path.dirname(sdkDist), "sdk-metafile.json"), `${JSON.stringify(result.metafile, null, 2)}\n`);
generateNoticesFromEsbuild({
  surface: "sdk:resources",
  metafile: result.metafile,
  outputPath: path.join(sdkDist, "v1", "THIRD-PARTY-NOTICES.txt"),
  root: repoRoot,
  inventoryRoot,
});
console.log(`  -> ${sdkDist}`);

function resolvePathOverride(envKey, fallbackPath) {
  const override = process.env[envKey];
  if (typeof override !== "string" || override.trim() === "") {
    return fallbackPath;
  }
  return path.isAbsolute(override) ? override : path.resolve(repoRoot, override);
}

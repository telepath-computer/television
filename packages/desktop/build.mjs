#!/usr/bin/env node
// Bundles the Television desktop Electron entrypoints into `dist/`:
//   - electron.cjs                main process (from src/index.ts)
//   - connect-preload.cjs         preload for the BrowserWindow (from src/connect-preload.ts)
//   - connect-page.cjs            connect screen logic (from src/connect-page.ts)
//   - webview-bridge-preload.cjs  preload for <webview> URL artifacts (from src/webview-bridge-preload.ts)
// Copies src/connect.html → dist/connect.html, then combines the four in-memory
// esbuild metafiles into one desktop inventory and generated notices file.
// `electron` is kept external because Electron resolves it from its own runtime,
// and `@todesktop/runtime` because ToDesktop installs it into the app as a
// dependency (specs/arch/desktop/distribution.md).

import path from "node:path";
import { fileURLToPath } from "node:url";
import { copyFileSync, rmSync } from "node:fs";
import { build } from "esbuild";
import { generateNoticesFromInventory } from "../../scripts/licenses/generate-notices.mjs";
import {
  mergeSurfaceInventories,
  resolveInventoryRoot,
} from "../../scripts/licenses/lib/inventory.mjs";
import { inventoryFromEsbuildMetafile } from "../../scripts/licenses/lib/notices.mjs";

const packageDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(packageDir, "../..");
const distDir = path.join(packageDir, "dist");
const inventoryRoot = resolveInventoryRoot({ root: repoRoot });

rmSync(distDir, { recursive: true, force: true });

const buildResults = await Promise.all([
  build({
    entryPoints: [path.join(packageDir, "src", "index.ts")],
    bundle: true,
    // The shared Node-side syntax target (specs/arch/node-versions.md).
    platform: "node",
    target: "node18",
    format: "cjs",
    outfile: path.join(distDir, "electron.cjs"),
    external: ["electron", "@todesktop/runtime"],
    metafile: true,
  }),
  build({
    entryPoints: [path.join(packageDir, "src", "connect-preload.ts")],
    bundle: true,
    // The shared Node-side syntax target (specs/arch/node-versions.md).
    platform: "node",
    target: "node18",
    format: "cjs",
    outfile: path.join(distDir, "connect-preload.cjs"),
    external: ["electron"],
    metafile: true,
  }),
  build({
    entryPoints: [path.join(packageDir, "src", "connect-page.ts")],
    bundle: true,
    platform: "browser",
    target: "es2022",
    format: "iife",
    outfile: path.join(distDir, "connect-page.cjs"),
    metafile: true,
  }),
  build({
    entryPoints: [path.join(packageDir, "src", "webview-bridge-preload.ts")],
    bundle: true,
    // The shared Node-side syntax target (specs/arch/node-versions.md).
    platform: "node",
    target: "node18",
    format: "cjs",
    outfile: path.join(distDir, "webview-bridge-preload.cjs"),
    external: ["electron"],
    metafile: true,
  }),
]);

copyFileSync(
  path.join(packageDir, "src", "connect.html"),
  path.join(distDir, "connect.html"),
);

const bundleInventories = buildResults.map((result, index) => {
  if (result.metafile === undefined) throw new Error(`Desktop esbuild call ${index + 1} produced no metafile`);
  return inventoryFromEsbuildMetafile({
    surface: "desktop",
    metafile: result.metafile,
    root: repoRoot,
    cwd: process.cwd(),
  });
});
const inventory = mergeSurfaceInventories("desktop", bundleInventories);
generateNoticesFromInventory({
  surface: "desktop",
  inventory,
  root: repoRoot,
  inventoryRoot,
  outputPath: path.join(distDir, "THIRD-PARTY-NOTICES.txt"),
});

for (const output of [
  "electron.cjs",
  "connect-preload.cjs",
  "connect-page.cjs",
  "webview-bridge-preload.cjs",
  "connect.html",
  "THIRD-PARTY-NOTICES.txt",
]) {
  process.stdout.write(`  -> ${path.relative(repoRoot, path.join(distDir, output))}\n`);
}

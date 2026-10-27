import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generateNoticesFromInventory } from "./generate-notices.mjs";
import { loadAssetManifest } from "./lib/config.mjs";
import { readSurfaceInventory, resolveInventoryRoot } from "./lib/inventory.mjs";
import { inventoryFromModulePaths } from "./lib/notices.mjs";
import { requireDeclaredLicenseSurface } from "./lib/surfaces.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/** Build-only Vite plugin that writes or verifies emitted third-party package coverage. */
export function createTelevisionLicensePlugin({
  surface,
  mode = "write",
  root = repositoryRoot,
  inventoryRoot = resolveInventoryRoot({ root }),
  assets,
  recordOutputPath,
} = {}) {
  if (typeof surface !== "string" || surface.length === 0) {
    throw new Error("Vite licensing plugin requires a surface");
  }
  if (mode !== "write" && mode !== "verify") {
    throw new Error(`Vite licensing plugin mode must be "write" or "verify"; received ${JSON.stringify(mode)}`);
  }
  requireDeclaredLicenseSurface(surface, { inventory: true });
  return {
    name: `television-license-inventory:${surface}`,
    apply: "build",
    enforce: "pre",
    generateBundle(outputOptions, bundle) {
      if (typeof outputOptions.dir !== "string" || outputOptions.dir.length === 0) {
        throw new Error(`Vite licensing surface ${surface} requires Rollup output.dir`);
      }
      const modules = [];
      for (const output of Object.values(bundle)) {
        if (output.type !== "chunk") continue;
        for (const [id, details] of Object.entries(output.modules)) {
          modules.push({ id, renderedLength: details.renderedLength });
        }
      }
      const inventory = inventoryFromModulePaths({ surface, modules, root });
      if (mode === "verify") {
        let coveringInventory;
        try {
          coveringInventory = readSurfaceInventory(inventoryRoot, surface);
        } catch (error) {
          throw new Error(`missing ${surface} license inventory: ${error instanceof Error ? error.message : String(error)}`);
        }
        verifyInventoryCoverage(inventory, coveringInventory);
        if (recordOutputPath !== undefined) {
          const matchedAssets = matchEmittedAssets(modules, {
            root,
            assets: assets ?? loadAssetManifest({ root }),
          });
          fs.mkdirSync(path.dirname(recordOutputPath), { recursive: true });
          fs.writeFileSync(recordOutputPath, `${JSON.stringify({
            packages: inventory.packages,
            assets: matchedAssets,
          }, null, 2)}\n`);
        }
        return;
      }
      const outputDir = path.isAbsolute(outputOptions.dir)
        ? outputOptions.dir
        : path.resolve(process.cwd(), outputOptions.dir);
      generateNoticesFromInventory({
        surface,
        inventory,
        outputPath: path.join(outputDir, "THIRD-PARTY-NOTICES.txt"),
        root,
        inventoryRoot,
      });
    },
  };
}

function matchEmittedAssets(modules, { root, assets }) {
  const emittedPaths = new Set(modules
    .filter((module) => module.renderedLength > 0 && !module.id.startsWith("\0"))
    .map((module) => {
      const cleanID = module.id.split("?", 1)[0];
      const absolute = path.isAbsolute(cleanID) ? cleanID : path.resolve(root, cleanID);
      return path.relative(root, absolute).split(path.sep).join("/");
    }));
  const matched = assets.filter((asset) => asset.paths.some((assetPath) => emittedPaths.has(assetPath)));
  for (const asset of matched) {
    for (const requiredSurface of ["view:markdown", "source"]) {
      if (!asset.surfaces.includes(requiredSurface)) {
        throw new Error(`packaged Markdown editor asset ${asset.id} must cover the ${requiredSurface} surface`);
      }
    }
  }
  return matched.map((asset) => asset.id).sort(compare);
}

function verifyInventoryCoverage(inventory, coveringInventory) {
  const covered = new Map(coveringInventory.packages.map((record) => [
    `${record.name}\0${record.version}`,
    record,
  ]));
  for (const record of inventory.packages) {
    const coveringRecord = covered.get(`${record.name}\0${record.version}`);
    if (coveringRecord === undefined) {
      throw new Error(`${record.name}@${record.version} is not covered by the ${inventory.surface} license inventory`);
    }
    if (coveringRecord.declaredLicense !== record.declaredLicense) {
      throw new Error(`${record.name}@${record.version} conflicts with the ${inventory.surface} license inventory`);
    }
  }
}

function compare(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

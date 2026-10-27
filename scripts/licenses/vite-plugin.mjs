import path from "node:path";
import { fileURLToPath } from "node:url";
import { generateNoticesFromInventory } from "./generate-notices.mjs";
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
        verifyInventoryCoverage(inventory, readSurfaceInventory(inventoryRoot, surface));
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

function verifyInventoryCoverage(inventory, coveringInventory) {
  const covered = new Map(coveringInventory.packages.map((record) => [
    `${record.name}\0${record.version}`,
    record,
  ]));
  for (const record of inventory.packages) {
    const coveringRecord = covered.get(`${record.name}\0${record.version}`);
    if (coveringRecord === undefined) {
      throw new Error(`${record.name}@${record.version} is not covered by the ${inventory.surface} licence inventory`);
    }
    if (coveringRecord.declaredLicense !== record.declaredLicense) {
      throw new Error(`${record.name}@${record.version} conflicts with the ${inventory.surface} licence inventory`);
    }
  }
}

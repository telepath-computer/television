import path from "node:path";
import { fileURLToPath } from "node:url";
import { generateNoticesFromInventory } from "./generate-notices.mjs";
import { resolveInventoryRoot } from "./lib/inventory.mjs";
import { inventoryFromModulePaths } from "./lib/notices.mjs";
import { requireDeclaredLicenseSurface } from "./lib/surfaces.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/** Build-only Vite plugin that records emitted third-party modules without an in-dist intermediate. */
export function createTelevisionLicensePlugin({
  surface,
  root = repositoryRoot,
  inventoryRoot = resolveInventoryRoot({ root }),
} = {}) {
  if (typeof surface !== "string" || surface.length === 0) {
    throw new Error("Vite licensing plugin requires a surface");
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

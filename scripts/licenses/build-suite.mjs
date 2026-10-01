import { readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildProducts } from "./lib/build-products.mjs";
import { prepareInventoryRoot, resolveInventoryRoot } from "./lib/inventory.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const repositoryRoot = path.resolve(path.dirname(scriptPath), "../..");
const publicPackageLicensePaths = [
  "packages/cli/LICENSE",
];

/** Build the suite's shared products once and leave their inventories for tests. */
export function buildSuite({ root = repositoryRoot } = {}) {
  const resolvedRoot = path.resolve(root);
  const inventoryRoot = resolveInventoryRoot({ root: resolvedRoot });
  prepareInventoryRoot(inventoryRoot);
  for (const licensePath of publicPackageLicensePaths) {
    rmSync(path.join(resolvedRoot, licensePath), { force: true });
  }
  buildProducts({ root: resolvedRoot });
  assertPackageLicenses(resolvedRoot);
  return inventoryRoot;
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === scriptPath) buildSuite();

function assertPackageLicenses(root) {
  const source = readFileSync(path.join(root, "LICENSE"));
  for (const licensePath of publicPackageLicensePaths) {
    let generated;
    try {
      generated = readFileSync(path.join(root, licensePath));
    } catch (error) {
      throw new Error(`Product build did not regenerate ${licensePath}`, { cause: error });
    }
    if (!source.equals(generated)) {
      throw new Error(`Product build regenerated ${licensePath} with bytes that differ from LICENSE`);
    }
  }
}

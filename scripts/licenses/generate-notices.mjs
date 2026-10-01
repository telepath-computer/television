import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadAssetManifest, loadLicenseConfig } from "./lib/config.mjs";
import {
  mergeSurfaceInventories,
  resolveInventoryRoot,
  writeSurfaceInventory,
} from "./lib/inventory.mjs";
import {
  inventoryFromEsbuildMetafile,
  renderFolderNotices,
  renderThirdPartyNotices,
} from "./lib/notices.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/** Generate the committed source-surface notices from the real asset manifest. */
export function generateSourceNotices({
  root = repositoryRoot,
  outputPath,
  config = loadLicenseConfig({ root }),
  assets = loadAssetManifest({ root, config }),
} = {}) {
  const text = renderThirdPartyNotices({
    surface: "source",
    inventory: { surface: "source", packages: [] },
    config,
    assets,
    root,
  });
  if (outputPath !== undefined) syncOutput(outputPath, text);
  return text;
}

/** Generate the committed notices file of every folder an asset names as its `noticesFolder`. */
export function generateFolderNotices({
  root = repositoryRoot,
  config = loadLicenseConfig({ root }),
  assets = loadAssetManifest({ root, config }),
  write = false,
} = {}) {
  const folders = renderFolderNotices({ assets });
  if (write) {
    for (const { folder, text } of folders) syncOutput(path.join(root, folder, "THIRD-PARTY-NOTICES.txt"), text);
  }
  return folders;
}

/** Convert an esbuild metafile, persist its normalized inventory, then render it. */
export function generateNoticesFromEsbuild({
  surface,
  metafile,
  outputPath,
  root = repositoryRoot,
  cwd = root,
  inventoryRoot = resolveInventoryRoot({ root }),
  config = loadLicenseConfig({ root }),
  assets = loadAssetManifest({ root, config }),
}) {
  const inventory = inventoryFromEsbuildMetafile({ surface, metafile, root, cwd, config });
  return persistAndRender({ surface, inventory, outputPath, inventoryRoot, config, assets, root });
}

/** Persist an already normalized package inventory before rendering from that persisted copy. */
export function generateNoticesFromInventory({
  surface,
  inventory,
  outputPath,
  root = repositoryRoot,
  inventoryRoot = resolveInventoryRoot({ root }),
  config = loadLicenseConfig({ root }),
  assets = loadAssetManifest({ root, config }),
}) {
  return persistAndRender({ surface, inventory, outputPath, inventoryRoot, config, assets, root });
}

/** Render an aggregate notice without replacing any source surface inventory. */
export function generateAggregateNotices({
  surface,
  inventories,
  assetSurfaces,
  outputPath,
  root = repositoryRoot,
  config = loadLicenseConfig({ root }),
  assets = loadAssetManifest({ root, config }),
}) {
  requireOutputPath(outputPath);
  const inventory = mergeSurfaceInventories(surface, inventories);
  const text = renderThirdPartyNotices({ surface, inventory, assetSurfaces, config, assets, root });
  syncOutput(outputPath, text);
  return text;
}

function persistAndRender({ surface, inventory, outputPath, inventoryRoot, config, assets, root }) {
  requireOutputPath(outputPath);
  writeSurfaceInventory(inventoryRoot, inventory);
  const text = renderThirdPartyNotices({ surface, inventory, config, assets, root });
  syncOutput(outputPath, text);
  return text;
}

function syncOutput(outputPath, text) {
  requireOutputPath(outputPath);
  if (text === null) {
    fs.rmSync(outputPath, { force: true });
    return;
  }
  fs.mkdirSync(path.dirname(path.resolve(outputPath)), { recursive: true });
  fs.writeFileSync(outputPath, text);
}

function requireOutputPath(outputPath) {
  if (typeof outputPath !== "string" || outputPath.length === 0) {
    throw new Error("A nonempty outputPath is required");
  }
}

function parseArguments(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument.startsWith("--")) throw new Error(`Unexpected argument ${argument}`);
    const name = argument.slice(2);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) throw new Error(`Missing value for --${name}`);
    if (Object.hasOwn(options, name)) throw new Error(`Duplicate argument --${name}`);
    options[name] = value;
    index += 1;
  }
  const known = new Set(["surface", "output", "esbuild-metafile", "cwd", "inventory-root"]);
  for (const name of Object.keys(options)) {
    if (!known.has(name)) throw new Error(`Unknown argument --${name}`);
  }
  if (typeof options.surface !== "string") throw new Error("--surface is required");
  if (typeof options.output !== "string") throw new Error("--output is required");
  return options;
}

function readJSON(filePath, description) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new Error(`Could not read ${description} ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function runCLI() {
  const options = parseArguments(process.argv.slice(2));
  if (options.surface === "source") {
    if (options["esbuild-metafile"] !== undefined) {
      throw new Error("The source surface does not accept a bundle inventory");
    }
    generateSourceNotices({ outputPath: options.output });
    generateFolderNotices({ write: true });
    return;
  }

  const common = {
    surface: options.surface,
    outputPath: path.resolve(options.output),
    root: repositoryRoot,
    inventoryRoot: options["inventory-root"] === undefined
      ? resolveInventoryRoot({ root: repositoryRoot })
      : path.resolve(repositoryRoot, options["inventory-root"]),
  };
  if (options["esbuild-metafile"] === undefined) {
    throw new Error("Package surfaces require --esbuild-metafile");
  }
  generateNoticesFromEsbuild({
    ...common,
    metafile: readJSON(options["esbuild-metafile"], "esbuild metafile"),
    cwd: options.cwd === undefined ? repositoryRoot : path.resolve(repositoryRoot, options.cwd),
  });
}

const isMain = process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    runCLI();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

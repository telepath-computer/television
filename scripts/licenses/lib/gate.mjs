import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generateFolderNotices, generateSourceNotices } from "../generate-notices.mjs";
import { isIgnoredPackage, loadAssetManifest, loadLicenseConfig } from "./config.mjs";
import { readSurfaceInventory, resolveInventoryRoot, surfaceInventoryPath } from "./inventory.mjs";
import { resolvePackageLicense, resolvePackageNotice } from "./notices.mjs";
import { findInstalledDependency, packageInfoToInventoryRecord } from "./package-license.mjs";
import { LICENSE_INVENTORY_SURFACES } from "./surfaces.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
// The manifests whose `dependencies` reach users as installed packages: the
// published CLI package and the desktop workspace, whose dependencies the
// ToDesktop build installs into the app.
const defaultDeclaringManifestPaths = [
  "packages/cli/package.json",
  "packages/desktop/package.json",
];

/** Evaluate every licensing rule and return all failures in deterministic order. */
export function evaluateLicenseGate(options = {}) {
  const root = path.resolve(options.root ?? repositoryRoot);
  const requestedInventoryRoot = options.inventoryRoot ?? resolveInventoryRoot({ root });
  const inventoryRoot = path.isAbsolute(requestedInventoryRoot)
    ? requestedInventoryRoot
    : path.resolve(root, requestedInventoryRoot);
  const config = options.config ?? loadLicenseConfig({ root });
  const assets = options.assets ?? loadAssetManifest({ root, config });
  const declaringManifestPaths = options.declaringManifestPaths ?? defaultDeclaringManifestPaths;
  const errors = [];
  const inventories = options.inventories ?? readDeclaredInventories(inventoryRoot, errors);

  const scannedPackageNames = new Set();
  const surfaces = [];
  for (const inventory of inventories) {
    if (inventory === null || typeof inventory !== "object" || typeof inventory.surface !== "string") {
      errors.push("licensing inventory must have a surface");
      continue;
    }
    surfaces.push(inventory.surface);
    if (!Array.isArray(inventory.packages)) {
      errors.push(`licensing inventory ${inventory.surface} must have a packages array`);
      continue;
    }
    for (const packageRecord of inventory.packages) {
      if (packageRecord !== null && typeof packageRecord === "object" && typeof packageRecord.name === "string") {
        scannedPackageNames.add(packageRecord.name);
      }
      checkPackage(packageRecord, inventory.surface, { root, config, errors, requireNotice: true });
    }
  }
  const observedSurfaces = new Set(surfaces);
  for (const surface of LICENSE_INVENTORY_SURFACES) {
    if (!observedSurfaces.has(surface)) errors.push(`missing declared license surface: ${surface}`);
  }

  checkDeclaredDependencies({
    root,
    config,
    declaringManifestPaths,
    scannedPackageNames,
    errors,
  });

  checkDeadEntries({ config, scannedPackageNames, errors });

  if (options.checkSourceNotice !== false) {
    const sourceError = sourceNoticeError({
      root,
      config,
      assets,
      sourceNoticePath: options.sourceNoticePath,
    });
    if (sourceError !== null) errors.push(sourceError);
    errors.push(...folderNoticeErrors({ root, config, assets }));
  }

  return {
    ok: errors.length === 0,
    surfaces: [...new Set(surfaces)].sort(compare),
    errors,
  };
}

function readDeclaredInventories(inventoryRoot, errors) {
  const inventories = [];
  for (const surface of LICENSE_INVENTORY_SURFACES) {
    const filePath = surfaceInventoryPath(inventoryRoot, surface);
    if (!fs.existsSync(filePath)) continue;
    try {
      inventories.push(readSurfaceInventory(inventoryRoot, surface));
    } catch (error) {
      errors.push(`could not read declared license surface ${surface}: ${errorMessage(error)}`);
    }
  }
  return inventories;
}

/** Compare generated source notices without writing to the committed file. */
export function sourceNoticeError({
  root = repositoryRoot,
  config = loadLicenseConfig({ root }),
  assets = loadAssetManifest({ root, config }),
  sourceNoticePath = path.join(root, "THIRD-PARTY-NOTICES.txt"),
} = {}) {
  let generated;
  try {
    generated = generateSourceNotices({ root, config, assets });
  } catch (error) {
    return `could not generate source notices for comparison: ${errorMessage(error)}`;
  }

  let committed;
  try {
    committed = fs.readFileSync(sourceNoticePath, "utf8");
  } catch (error) {
    if (generated === null && error !== null && typeof error === "object" && error.code === "ENOENT") return null;
    return `${sourceNoticePath} could not be read: ${errorMessage(error)}`;
  }
  return committed === generated
    ? null
    : `${sourceNoticePath} is stale; regenerate the source-surface notices`;
}

/** Compare every generated folder notices file with its committed copy, without writing. */
export function folderNoticeErrors({
  root = repositoryRoot,
  config = loadLicenseConfig({ root }),
  assets = loadAssetManifest({ root, config }),
} = {}) {
  const errors = [];
  for (const { folder, text } of generateFolderNotices({ root, config, assets })) {
    const noticePath = path.join(root, folder, "THIRD-PARTY-NOTICES.txt");
    let committed;
    try {
      committed = fs.readFileSync(noticePath, "utf8");
    } catch (error) {
      errors.push(`${noticePath} could not be read: ${errorMessage(error)}`);
      continue;
    }
    if (committed !== text) errors.push(`${noticePath} is stale; regenerate the folder notices`);
  }
  return errors;
}

export function formatLicenseGateErrors(errors) {
  return [
    `license gate failed with ${errors.length} error${errors.length === 1 ? "" : "s"}:`,
    ...errors.map((error) => `- ${error}`),
  ].join("\n");
}

function checkPackage(packageRecord, surface, { root, config, errors, requireNotice }) {
  const identity = packageIdentity(packageRecord);
  if (identity === null) {
    errors.push(`licensing inventory ${surface} contains an invalid package record`);
    return;
  }

  let resolution;
  try {
    resolution = resolvePackageLicense(packageRecord, config);
  } catch (error) {
    errors.push(`${surface} ${identity}: ${errorMessage(error)}`);
    return;
  }

  if (resolution.drift !== null) {
    errors.push(
      `${surface} ${identity}: elections entry for ${packageRecord.name} is stale; `
      + `expected declaration ${JSON.stringify(resolution.drift.expected)}, `
      + `received ${JSON.stringify(resolution.drift.actual)}`,
    );
  }

  if (resolution.license === null) {
    errors.push(`${surface} ${identity}: package license could not be determined`);
    return;
  }
  if (!config.allow.includes(resolution.license)) {
    errors.push(`${surface} ${identity}: license ${resolution.license} is not allowed for shipped code`);
  }

  if (requireNotice) {
    try {
      resolvePackageNotice(packageRecord, { root, config });
    } catch (error) {
      errors.push(`${surface} ${identity}: ${errorMessage(error)}`);
    }
  }
}

function checkDeclaredDependencies({
  root,
  config,
  declaringManifestPaths,
  scannedPackageNames,
  errors,
}) {
  for (const manifestPath of declaringManifestPaths) {
    const absolutePath = path.isAbsolute(manifestPath) ? manifestPath : path.join(root, manifestPath);
    let manifest;
    try {
      manifest = JSON.parse(fs.readFileSync(absolutePath, "utf8"));
    } catch (error) {
      errors.push(`could not read package manifest ${absolutePath}: ${errorMessage(error)}`);
      continue;
    }
    if (manifest.dependencies === undefined) continue;
    if (manifest.dependencies === null || typeof manifest.dependencies !== "object" || Array.isArray(manifest.dependencies)) {
      errors.push(`package manifest ${absolutePath} dependencies must be an object`);
      continue;
    }
    for (const packageName of Object.keys(manifest.dependencies).sort(compare)) {
      if (isIgnoredPackage(packageName, config)) continue;

      let packageInfo;
      try {
        packageInfo = findInstalledDependency(packageName, { fromDirectory: path.dirname(absolutePath) });
      } catch (error) {
        errors.push(`declared dependency ${packageName} from ${absolutePath}: ${errorMessage(error)}`);
        continue;
      }
      if (packageInfo === null) {
        errors.push(`declared dependency ${packageName} from ${absolutePath} is not installed`);
        continue;
      }
      scannedPackageNames.add(packageInfo.name);
      let packageRecord;
      try {
        packageRecord = packageInfoToInventoryRecord(packageInfo, { root });
      } catch (error) {
        errors.push(`declared dependency ${packageName} from ${absolutePath}: ${errorMessage(error)}`);
        continue;
      }
      checkPackage(packageRecord, "declared dependency", {
        root,
        config,
        errors,
        requireNotice: false,
      });
    }
  }
}

function checkDeadEntries({ config, scannedPackageNames, errors }) {
  for (const category of ["elections", "notices"]) {
    for (const entry of config[category]) {
      if (!scannedPackageNames.has(entry.package)) errors.push(`dead ${category} entry: ${entry.package}`);
    }
  }
}

function packageIdentity(packageRecord) {
  if (packageRecord === null || typeof packageRecord !== "object") return null;
  if (typeof packageRecord.name !== "string" || packageRecord.name.length === 0) return null;
  if (typeof packageRecord.version !== "string" || packageRecord.version.length === 0) return null;
  return `${packageRecord.name}@${packageRecord.version}`;
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function compare(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

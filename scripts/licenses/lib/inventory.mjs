import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { LICENSE_INVENTORY_SURFACES } from "./surfaces.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const inventoryKeys = ["surface", "packages"];
const packageKeys = ["name", "version", "declaredLicense", "licenseFilePath"];

/** Resolve the repository's cross-process inventory root. */
export function resolveInventoryRoot({ root = repositoryRoot } = {}) {
  return path.join(root, ".licenses-inventory");
}

/** Remove stale inventory output and create an empty root. */
export function prepareInventoryRoot(inventoryRoot) {
  fs.rmSync(inventoryRoot, { recursive: true, force: true });
  fs.mkdirSync(inventoryRoot, { recursive: true });
}

/** Return the canonical persisted path for a surface. */
export function surfaceInventoryPath(inventoryRoot, surface) {
  validateSurface(surface, "surface");
  return path.join(inventoryRoot, `${surface}.json`);
}

/** Validate, normalize, sort, and atomically persist one surface inventory. */
export function writeSurfaceInventory(inventoryRoot, inventory) {
  const normalized = validateInventory(inventory, "inventory");
  const filePath = surfaceInventoryPath(inventoryRoot, normalized.surface);
  fs.mkdirSync(inventoryRoot, { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(normalized, null, 2)}\n`);
  fs.renameSync(temporaryPath, filePath);
  return filePath;
}

/** Read one expected surface, validating both its shape and file identity. */
export function readSurfaceInventory(inventoryRoot, surface) {
  const filePath = surfaceInventoryPath(inventoryRoot, surface);
  const inventory = readInventoryFile(filePath);
  if (inventory.surface !== surface) {
    throw new Error(`${filePath}.surface is ${JSON.stringify(inventory.surface)}; expected ${JSON.stringify(surface)}`);
  }
  return inventory;
}

/** Merge inventories into one surface, deduplicating package identities before persistence. */
export function mergeSurfaceInventories(surface, inventories) {
  validateSurface(surface, "surface");
  if (!Array.isArray(inventories) || inventories.length === 0) {
    throw new Error("inventories must be a nonempty array");
  }

  const packages = inventories.flatMap((inventory, inventoryIndex) => (
    validateInventory(inventory, `inventories[${inventoryIndex}]`).packages
  ));
  return validateInventory({
    surface,
    packages: normalizePackageRecords(packages, "inventories"),
  }, "merged inventory");
}

/** Normalize package records, keeping a license-file-bearing duplicate when one exists. */
export function normalizePackageRecords(records, location = "package records") {
  if (!Array.isArray(records)) throw new Error(`${location} must be an array`);
  const byIdentity = new Map();
  for (const [index, value] of records.entries()) {
    const record = validatePackage(value, `${location}[${index}]`);
    const identity = `${record.name}\0${record.version}`;
    const previous = byIdentity.get(identity);
    if (previous === undefined) {
      byIdentity.set(identity, record);
      continue;
    }
    if (previous.declaredLicense !== record.declaredLicense) {
      throw new Error(`${location} has conflicting declared licenses for ${record.name}@${record.version}`);
    }
    const previousPath = previous.licenseFilePath;
    const recordPath = record.licenseFilePath;
    if (
      (previousPath === null && recordPath !== null)
      || (previousPath !== null && recordPath !== null && compare(recordPath, previousPath) < 0)
    ) {
      byIdentity.set(identity, record);
    }
  }
  return [...byIdentity.values()].sort(comparePackages);
}

function readInventoryFile(filePath) {
  let value;
  try {
    value = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new Error(`${filePath} could not be read as inventory JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  return validateInventory(value, filePath);
}

function validateInventory(value, location) {
  assertObject(value, location);
  assertExactKeys(value, inventoryKeys, location);
  const surface = validateSurface(value.surface, `${location}.surface`);
  if (!Array.isArray(value.packages)) throw new Error(`${location}.packages must be an array`);
  const packages = value.packages.map((entry, index) => validatePackage(entry, `${location}.packages[${index}]`));
  packages.sort(comparePackages);

  const seen = new Set();
  for (const entry of packages) {
    const identity = `${entry.name}\0${entry.version}`;
    if (seen.has(identity)) throw new Error(`${location}.packages contains duplicate ${entry.name}@${entry.version}`);
    seen.add(identity);
  }
  return { surface, packages };
}

function validatePackage(value, location) {
  assertObject(value, location);
  assertExactKeys(value, packageKeys, location);
  return {
    name: nonemptyString(value.name, `${location}.name`),
    version: nonemptyString(value.version, `${location}.version`),
    declaredLicense: nullableString(value.declaredLicense, `${location}.declaredLicense`),
    licenseFilePath: nullableString(value.licenseFilePath, `${location}.licenseFilePath`),
  };
}

function validateSurface(value, location) {
  if (typeof value !== "string" || !LICENSE_INVENTORY_SURFACES.includes(value)) {
    throw new Error(`${location} must be a declared inventory surface; received ${JSON.stringify(value)}`);
  }
  return value;
}

function nullableString(value, location) {
  if (value === null) return null;
  return nonemptyString(value, location);
}

function nonemptyString(value, location) {
  if (typeof value !== "string" || value.length === 0) throw new Error(`${location} must be a nonempty string`);
  return value;
}

function assertObject(value, location) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${location} must be an object`);
  }
}

function assertExactKeys(value, keys, location) {
  const allowed = new Set(keys);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new Error(`${location} contains unknown field ${JSON.stringify(key)}`);
  }
  for (const key of keys) {
    if (!(key in value)) throw new Error(`${location}.${key} is required`);
  }
}

function comparePackages(left, right) {
  return compare(left.name, right.name)
    || compare(left.version, right.version)
    || compareNullable(left.declaredLicense, right.declaredLicense)
    || compareNullable(left.licenseFilePath, right.licenseFilePath);
}

function compareNullable(left, right) {
  return compare(left ?? "", right ?? "");
}

function compare(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

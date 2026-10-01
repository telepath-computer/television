import fs from "node:fs";
import path from "node:path";
import { isIgnoredPackage, loadLicenseConfig } from "./config.mjs";
import { normalizePackageRecords } from "./inventory.mjs";
import {
  findInstalledPackage,
  findOwningPackage,
  findPackageNoticeFile,
  packageInfoToInventoryRecord,
} from "./package-license.mjs";

const separator = "=".repeat(80);
const rule = "-".repeat(80);

/** Convert one esbuild metafile's emitted inputs through the shared module-path mapper. */
export function inventoryFromEsbuildMetafile({
  surface,
  metafile,
  root,
  cwd = root,
  config = loadLicenseConfig({ root }),
}) {
  if (metafile === null || typeof metafile !== "object" || Array.isArray(metafile)) {
    throw new Error("esbuild metafile must be an object");
  }
  if (metafile.outputs === null || typeof metafile.outputs !== "object" || Array.isArray(metafile.outputs)) {
    throw new Error("esbuild metafile.outputs must be an object");
  }

  const modules = [];
  for (const [outputPath, output] of Object.entries(metafile.outputs)) {
    if (output === null || typeof output !== "object" || Array.isArray(output)) {
      throw new Error(`esbuild metafile output ${outputPath} must be an object`);
    }
    if (output.inputs === null || typeof output.inputs !== "object" || Array.isArray(output.inputs)) {
      throw new Error(`esbuild metafile output ${outputPath}.inputs must be an object`);
    }
    for (const [inputPath, details] of Object.entries(output.inputs)) {
      if (details === null || typeof details !== "object" || typeof details.bytesInOutput !== "number") {
        throw new Error(`esbuild metafile output ${outputPath}.inputs[${JSON.stringify(inputPath)}].bytesInOutput must be a number`);
      }
      modules.push({ id: inputPath, renderedLength: details.bytesInOutput });
    }
  }
  return inventoryFromModulePaths({ surface, modules, root, cwd, config });
}

/** Map emitted module paths from any bundler to their nearest package owners. */
export function inventoryFromModulePaths({
  surface,
  modules,
  root,
  cwd = root,
  config = loadLicenseConfig({ root }),
}) {
  if (!Array.isArray(modules)) throw new Error(`${surface} bundle modules must be an array`);
  const records = [];
  for (const [index, module] of modules.entries()) {
    const location = `${surface} bundle modules[${index}]`;
    if (module === null || typeof module !== "object" || Array.isArray(module)) {
      throw new Error(`${location} must be an object`);
    }
    const id = requireNonemptyString(module.id, `${location}.id`);
    if (typeof module.renderedLength !== "number" || !Number.isFinite(module.renderedLength)) {
      throw new Error(`${location}.renderedLength must be a finite number`);
    }
    if (module.renderedLength <= 0 || id.startsWith("\0") || !isNodeModulesPath(id)) continue;
    const absoluteInput = path.isAbsolute(id) ? id : path.resolve(cwd, id);
    const packageInfo = findOwningPackage(absoluteInput);
    if (packageInfo === null) throw new Error(`Could not find owning package.json for emitted input ${id}`);
    if (isIgnoredPackage(packageInfo.name, config)) continue;
    records.push(packageInfoToInventoryRecord(packageInfo, { root }));
  }
  return { surface, packages: normalizePackageRecords(records, `${surface} bundle inventory`) };
}

/** Apply an exact recorded license election. */
export function resolvePackageLicense(packageRecord, config) {
  const election = config.elections.find((entry) => entry.package === packageRecord.name) ?? null;
  if (election !== null) {
    if (packageRecord.declaredLicense === election.offered) {
      return { license: election.elected, drift: null };
    }
    return {
      license: packageRecord.declaredLicense,
      drift: { kind: "election", expected: election.offered, actual: packageRecord.declaredLicense },
    };
  }

  return { license: packageRecord.declaredLicense, drift: null };
}

/** Resolve exact upstream notice bytes without parsing README files or synthesizing text. */
export function resolvePackageNotice(packageRecord, { root, config }) {
  if (packageRecord.licenseFilePath !== null) {
    const filePath = resolveInventoryPath(root, packageRecord.licenseFilePath, packageIdentity(packageRecord));
    let text;
    try {
      text = fs.readFileSync(filePath, "utf8");
    } catch (error) {
      throw new Error(`Could not read license file for ${packageIdentity(packageRecord)} at ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
    }
    return { text, source: "package-license-file", sourcePath: filePath, packageRoot: path.dirname(filePath) };
  }

  const configured = config.notices.find((entry) => entry.package === packageRecord.name);
  if (configured !== undefined) {
    const installed = findInstalledPackage(packageRecord.name, packageRecord.version, { root, searchRoots: [root] });
    return {
      text: configured.text,
      source: "reviewed-config",
      sourcePath: configured.source,
      packageRoot: installed?.packageRoot ?? null,
    };
  }
  throw new Error(
    `${packageIdentity(packageRecord)} has neither a package-root license file nor a reviewed notice in scripts/licenses/config.json`,
  );
}

/** Render one stable human-readable notices file from a persisted inventory plus assets. */
export function renderThirdPartyNotices({ surface, inventory, assetSurfaces = [surface], config, assets, root }) {
  if (inventory === null || typeof inventory !== "object" || inventory.surface !== surface) {
    throw new Error(`Notice inventory surface must be ${JSON.stringify(surface)}`);
  }
  if (!Array.isArray(inventory.packages)) throw new Error("Notice inventory packages must be an array");
  if (!Array.isArray(assetSurfaces) || assetSurfaces.length === 0) {
    throw new Error("Notice assetSurfaces must be a nonempty array");
  }
  for (const [index, assetSurface] of assetSurfaces.entries()) {
    requireNonemptyString(assetSurface, `Notice assetSurfaces[${index}]`);
  }

  const packages = normalizePackageRecords(inventory.packages, `${surface} notice inventory`);
  const entries = packages.map((packageRecord) => renderPackageEntry(packageRecord, { root, config }));
  const includedAssetSurfaces = new Set(assetSurfaces);
  const matchingAssets = assets.filter((asset) => (
    asset.surfaces.some((candidate) => includedAssetSurfaces.has(candidate))
  ));
  for (const asset of matchingAssets) entries.push(...renderAssetEntries(asset));
  return renderNoticesFile(entries);
}

/** Render one notices file per folder named by an asset's `noticesFolder`, from the assets naming it. */
export function renderFolderNotices({ assets }) {
  const folders = [...new Set(assets.flatMap((asset) => asset.noticesFolder ?? []))].sort(compare);
  return folders.map((folder) => ({
    folder,
    text: renderNoticesFile(
      assets.filter((asset) => asset.noticesFolder === folder).flatMap(renderAssetEntries),
    ),
  }));
}

function renderNoticesFile(entries) {
  const uniqueEntries = deduplicateNoticeEntries(entries);
  if (uniqueEntries.length === 0) return null;
  uniqueEntries.sort((left, right) => (
    compare(left.name.toLowerCase(), right.name.toLowerCase())
    || compare(left.name, right.name)
    || compare(left.text, right.text)
  ));

  const header = [
    "TELEVISION THIRD-PARTY LICENSING NOTICES",
    "",
    "This file contains the license terms and attribution notices for third-party software and materials included in Television.",
    "",
  ].join("\n");
  return `${header}${uniqueEntries.map((entry) => entry.text).join("\n")}\n`;
}

function renderPackageEntry(packageRecord, { root, config }) {
  const resolution = resolvePackageLicense(packageRecord, config);
  if (resolution.license === null) {
    throw new Error(`${packageIdentity(packageRecord)} license could not be determined`);
  }
  if (resolution.drift !== null) {
    throw new Error(`${packageIdentity(packageRecord)} has stale ${resolution.drift.kind} configuration`);
  }

  const notice = resolvePackageNotice(packageRecord, { root, config });
  let terms = notice.text;

  if (resolution.license === "Apache-2.0" && notice.packageRoot !== null) {
    const upstreamNoticePath = findPackageNoticeFile(notice.packageRoot);
    if (upstreamNoticePath !== null) {
      const upstreamNotice = fs.readFileSync(upstreamNoticePath, "utf8");
      terms += `${terms.endsWith("\n") ? "" : "\n"}\nAdditional notice:\n\n${upstreamNotice}`;
    }
  }
  return renderNoticeEntry(packageIdentity(packageRecord), resolution.license, terms);
}

function renderAssetEntries(asset) {
  return asset.components.map((component) => {
    const name = component.package === undefined
      ? component.name
      : (component.version === undefined ? component.package : `${component.package}@${component.version}`);
    return renderNoticeEntry(name, component.license, component.noticeText);
  });
}

function renderNoticeEntry(name, license, terms) {
  const text = [
    separator,
    name,
    `Licensed under ${license}.`,
    rule,
  ].join("\n");
  return {
    name,
    license,
    terms,
    text: `${text}\n${terms}${terms.endsWith("\n") ? "" : "\n"}`,
  };
}

function deduplicateNoticeEntries(entries) {
  const byName = new Map();
  for (const entry of entries) {
    const previous = byName.get(entry.name);
    if (previous === undefined) {
      byName.set(entry.name, entry);
      continue;
    }
    if (previous.license !== entry.license || previous.terms !== entry.terms) {
      throw new Error(`${entry.name} has entries that disagree about its license or notice text`);
    }
  }
  return [...byName.values()];
}

function resolveInventoryPath(root, inventoryPath, identity) {
  if (path.isAbsolute(inventoryPath)) {
    throw new Error(`${identity} inventory licenseFilePath must be repository-relative; received ${inventoryPath}`);
  }
  const resolved = path.resolve(root, inventoryPath);
  const relative = path.relative(path.resolve(root), resolved);
  if (relative === ".." || relative.startsWith(`..${path.sep}`)) {
    throw new Error(`${identity} inventory licenseFilePath escapes the repository root: ${inventoryPath}`);
  }
  return resolved;
}

function isNodeModulesPath(inputPath) {
  const normalized = inputPath.replace(/\\/g, "/");
  return normalized.startsWith("node_modules/") || normalized.includes("/node_modules/");
}

function packageIdentity(packageRecord) {
  return `${packageRecord.name}@${packageRecord.version}`;
}

function requireNonemptyString(value, location) {
  if (typeof value !== "string" || value.length === 0) throw new Error(`${location} must be a nonempty string`);
  return value;
}

function compare(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

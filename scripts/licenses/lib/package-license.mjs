import fs from "node:fs";
import path from "node:path";

const installedPackageIndexes = new Map();
const licenseFamilies = new Map([
  ["license", 0],
  ["licence", 1],
  ["copying", 2],
]);

/** Find the nearest package.json owner of a concrete module input path. */
export function findOwningPackage(inputPath) {
  const absoluteInput = path.resolve(inputPath);
  let current = existingDirectory(absoluteInput);
  while (true) {
    const manifestPath = path.join(current, "package.json");
    if (fs.existsSync(manifestPath)) {
      const packageInfo = readPackage(manifestPath, { skipIncompleteIdentity: true });
      if (packageInfo !== null) return packageInfo;
    }
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

/** Find an installed package by exact name and version across deterministic node_modules roots. */
export function findInstalledPackage(name, version, { root, searchRoots = [root] } = {}) {
  requireNonemptyString(name, "package name");
  requireNonemptyString(version, "package version");
  if (typeof root !== "string" || root.length === 0) throw new Error("root must be a nonempty path");
  const roots = [...new Set(searchRoots.map((entry) => path.resolve(entry)))].sort(compare);
  const cacheKey = roots.join("\0");
  let index = installedPackageIndexes.get(cacheKey);
  if (index === undefined) {
    index = buildInstalledPackageIndex(roots);
    installedPackageIndexes.set(cacheKey, index);
  }
  return index.get(`${name}\0${version}`)?.[0] ?? null;
}

/** Resolve one declared dependency from the nearest installed node_modules tree. */
export function findInstalledDependency(name, { fromDirectory }) {
  const segments = packageNameSegments(name);
  if (typeof fromDirectory !== "string" || fromDirectory.length === 0) {
    throw new Error("fromDirectory must be a nonempty path");
  }
  let current = path.resolve(fromDirectory);
  while (true) {
    const manifestPath = path.join(current, "node_modules", ...segments, "package.json");
    if (fs.existsSync(manifestPath)) return readPackage(manifestPath);
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

/** Select a package-root license file using stable family and filename precedence. */
export function findPackageLicenseFile(packageRoot) {
  return findPackageRootFile(packageRoot, /^(license|licence|copying)(?:$|[._-])/i, (name) => {
    const family = /^(license|licence|copying)/i.exec(name)?.[1].toLowerCase();
    return licenseFamilies.get(family) ?? Number.MAX_SAFE_INTEGER;
  });
}

/** Select a package-root NOTICE file deterministically. */
export function findPackageNoticeFile(packageRoot) {
  return findPackageRootFile(packageRoot, /^notice(?:$|[._-])/i, () => 0);
}

/** Convert package metadata to the portable persisted inventory shape. */
export function packageInfoToInventoryRecord(packageInfo, { root }) {
  if (packageInfo === null || typeof packageInfo !== "object") throw new Error("packageInfo must be an object");
  return {
    name: packageInfo.name,
    version: packageInfo.version,
    declaredLicense: packageInfo.declaredLicense,
    licenseFilePath: packageInfo.licenseFilePath === null
      ? null
      : repositoryRelativePath(root, packageInfo.licenseFilePath),
  };
}

function readPackage(manifestPath, { skipIncompleteIdentity = false } = {}) {
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  } catch (error) {
    throw new Error(`Could not read package manifest ${manifestPath}: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (skipIncompleteIdentity && (typeof manifest.name !== "string" || typeof manifest.version !== "string")) {
    return null;
  }
  const name = requireNonemptyString(manifest.name, `${manifestPath}.name`);
  const version = requireNonemptyString(manifest.version, `${manifestPath}.version`);
  const declaredLicense = manifest.license ?? null;
  if (declaredLicense !== null && (typeof declaredLicense !== "string" || declaredLicense.length === 0)) {
    throw new Error(`${manifestPath}.license must be a nonempty string or absent`);
  }
  const packageRoot = path.dirname(manifestPath);
  return {
    name,
    version,
    declaredLicense,
    packageRoot,
    manifestPath,
    licenseFilePath: findPackageLicenseFile(packageRoot),
  };
}

function buildInstalledPackageIndex(searchRoots) {
  const index = new Map();
  const visitedModuleRoots = new Set();
  for (const searchRoot of searchRoots) {
    const modulesRoot = path.basename(searchRoot) === "node_modules"
      ? searchRoot
      : path.join(searchRoot, "node_modules");
    visitNodeModules(modulesRoot, index, visitedModuleRoots);
  }
  for (const matches of index.values()) matches.sort((left, right) => compare(left.packageRoot, right.packageRoot));
  return index;
}

function visitNodeModules(modulesRoot, index, visitedModuleRoots) {
  let canonicalRoot;
  try {
    canonicalRoot = fs.realpathSync(modulesRoot);
  } catch {
    return;
  }
  if (visitedModuleRoots.has(canonicalRoot)) return;
  visitedModuleRoots.add(canonicalRoot);

  for (const entry of sortedDirectories(modulesRoot)) {
    if (entry.name.startsWith("@")) {
      for (const scopedEntry of sortedDirectories(path.join(modulesRoot, entry.name))) {
        indexPackage(path.join(modulesRoot, entry.name, scopedEntry.name), index, visitedModuleRoots);
      }
    } else {
      indexPackage(path.join(modulesRoot, entry.name), index, visitedModuleRoots);
    }
  }
}

function indexPackage(packageRoot, index, visitedModuleRoots) {
  const manifestPath = path.join(packageRoot, "package.json");
  if (fs.existsSync(manifestPath)) {
    const packageInfo = readPackage(manifestPath);
    const identity = `${packageInfo.name}\0${packageInfo.version}`;
    const matches = index.get(identity) ?? [];
    matches.push(packageInfo);
    index.set(identity, matches);
  }
  visitNodeModules(path.join(packageRoot, "node_modules"), index, visitedModuleRoots);
}

function sortedDirectories(directory) {
  try {
    return fs.readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() || entry.isSymbolicLink())
      .sort((left, right) => compare(left.name, right.name));
  } catch {
    return [];
  }
}

function findPackageRootFile(packageRoot, pattern, familyRank) {
  let names;
  try {
    names = fs.readdirSync(packageRoot, { withFileTypes: true })
      .filter((entry) => entry.isFile() && pattern.test(entry.name))
      .map((entry) => entry.name);
  } catch (error) {
    throw new Error(`Could not inspect package root ${packageRoot}: ${error instanceof Error ? error.message : String(error)}`);
  }
  names.sort((left, right) => (
    familyRank(left) - familyRank(right)
    || exactStemRank(left) - exactStemRank(right)
    || compare(left.toLowerCase(), right.toLowerCase())
    || compare(left, right)
  ));
  return names.length === 0 ? null : path.join(packageRoot, names[0]);
}

function exactStemRank(name) {
  return /^(?:license|licence|copying|notice)$/i.test(name) ? 0 : 1;
}

function existingDirectory(fileOrDirectory) {
  try {
    return fs.statSync(fileOrDirectory).isDirectory() ? fileOrDirectory : path.dirname(fileOrDirectory);
  } catch {
    return path.dirname(fileOrDirectory);
  }
}

function repositoryRelativePath(root, filePath) {
  const relative = path.relative(path.resolve(root), path.resolve(filePath));
  if (relative === "" || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`Package legal file ${filePath} is outside repository root ${root}`);
  }
  return relative.split(path.sep).join("/");
}

function packageNameSegments(name) {
  requireNonemptyString(name, "package name");
  const match = /^(?:([^@/\s][^/\s]*)|(@[^/\s]+)\/([^/\s]+))$/.exec(name);
  if (match === null) throw new Error(`Invalid package name ${JSON.stringify(name)}`);
  return match[1] === undefined ? [match[2], match[3]] : [match[1]];
}

function requireNonemptyString(value, location) {
  if (typeof value !== "string" || value.length === 0) throw new Error(`${location} must be a nonempty string`);
  return value;
}

function compare(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

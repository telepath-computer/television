import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isDeclaredLicenseSurface } from "./surfaces.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

const configKeys = ["allow", "elections", "notices", "ignored"];
const electionKeys = ["package", "offered", "elected"];
const noticeKeys = ["package", "text", "source"];
const assetKeys = ["id", "paths", "components", "surfaces"];
const optionalAssetKeys = ["noticesFolder"];
const componentKeys = ["package", "version", "name", "license", "noticeText"];

/** Load and validate the reviewed licensing policy configuration. */
export function loadLicenseConfig({
  root = repositoryRoot,
  configPath = path.join(root, "scripts/licenses/config.json"),
} = {}) {
  const value = readJSON(configPath);
  const location = relativeLocation(root, configPath);
  assertObject(value, location);
  assertExactKeys(value, configKeys, location);

  const config = {
    allow: stringArray(value.allow, `${location}.allow`, { nonempty: true }),
    elections: objectArray(value.elections, `${location}.elections`, validateElection),
    notices: objectArray(value.notices, `${location}.notices`, validateNotice),
    ignored: objectArray(value.ignored, `${location}.ignored`, validateIgnored),
  };

  assertUnique(config.allow, `${location}.allow`);
  for (const category of ["elections", "notices"]) {
    assertUnique(config[category].map((entry) => entry.package), `${location}.${category}`, "package");
  }
  assertUnique(config.ignored.map((entry) => entry.pattern), `${location}.ignored`, "pattern");
  return config;
}

/** Match a validated exact package name or scoped wildcard. */
export function isIgnoredPackage(packageName, config) {
  return config.ignored.some(({ pattern }) => (
    pattern.endsWith("/*") ? packageName.startsWith(pattern.slice(0, -1)) : packageName === pattern
  ));
}

/** Load and validate vendored-asset provenance against a licensing config. */
export function loadAssetManifest({
  root = repositoryRoot,
  assetsPath = path.join(root, "scripts/licenses/assets.json"),
  config = loadLicenseConfig({ root }),
} = {}) {
  const value = readJSON(assetsPath);
  const location = relativeLocation(root, assetsPath);
  if (!Array.isArray(value)) fail(location, "must be an array");
  const assets = value.map((asset, index) => validateAsset(asset, `${location}[${index}]`, root, config));
  assertUnique(assets.map((asset) => asset.id), location, "id");
  return assets;
}

function validateElection(value, location) {
  assertExactObject(value, electionKeys, location);
  return {
    package: nonemptyString(value.package, `${location}.package`),
    offered: nonemptyString(value.offered, `${location}.offered`),
    elected: nonemptyString(value.elected, `${location}.elected`),
  };
}

function validateNotice(value, location) {
  assertExactObject(value, noticeKeys, location);
  return {
    package: nonemptyString(value.package, `${location}.package`),
    text: nonemptyString(value.text, `${location}.text`),
    source: nonemptyString(value.source, `${location}.source`),
  };
}

function validateIgnored(value, location) {
  assertObject(value, location);
  const pattern = nonemptyString(value.pattern, `${location}.pattern`);
  const exactName = /^(?:[^@/*\s][^@/*\s]*|@[^@/*\s]+\/[^@/*\s]+)$/;
  const scopedWildcard = /^@[^/*\s]+\/\*$/;
  if (!exactName.test(pattern) && !scopedWildcard.test(pattern)) {
    fail(`${location}.pattern`, "must be an exact package name or a scoped wildcard such as @scope/*");
  }
  return { pattern };
}

function validateAsset(value, location, root, config) {
  assertObject(value, location);
  assertExactKeys(value, assetKeys, location, { optionalKeys: optionalAssetKeys });
  const id = nonemptyString(value.id, `${location}.id`);
  const assetLocation = `Asset ${id}`;
  const paths = stringArray(value.paths, `${assetLocation}.paths`, { nonempty: true });
  for (const assetPath of paths) {
    if (path.isAbsolute(assetPath) || assetPath.split(/[\\/]/).includes("..")) {
      fail(`${assetLocation}.paths`, `must contain repository-relative paths; received ${JSON.stringify(assetPath)}`);
    }
    if (!fs.existsSync(path.join(root, assetPath))) fail(assetLocation, `references missing path ${assetPath}`);
  }

  const surfaces = stringArray(value.surfaces, `${assetLocation}.surfaces`, { nonempty: true });
  for (const surface of surfaces) {
    if (!isDeclaredLicenseSurface(surface)) {
      fail(`${assetLocation}.surfaces`, `contains undeclared surface ${JSON.stringify(surface)}`);
    }
  }
  assertUnique(surfaces, `${assetLocation}.surfaces`);

  if (!Array.isArray(value.components) || value.components.length === 0) {
    fail(`${assetLocation}.components`, "must be a nonempty array");
  }
  const components = value.components.map((component, index) => (
    validateComponent(component, `${assetLocation}.components[${index}]`, config)
  ));

  const asset = { id, paths, components, surfaces };
  if (value.noticesFolder !== undefined) {
    asset.noticesFolder = validateNoticesFolder(value.noticesFolder, `${assetLocation}.noticesFolder`, root);
  }
  return asset;
}

function validateNoticesFolder(value, location, root) {
  const folder = nonemptyString(value, location);
  if (path.isAbsolute(folder) || folder.split(/[\\/]/).includes("..")) {
    fail(location, `must be a repository-relative path; received ${JSON.stringify(folder)}`);
  }
  const stats = fs.statSync(path.join(root, folder), { throwIfNoEntry: false });
  if (stats === undefined || !stats.isDirectory()) fail(location, `must name an existing folder; received ${JSON.stringify(folder)}`);
  return folder;
}

function validateComponent(value, location, config) {
  assertExactObject(value, componentKeys, location, { optional: true });
  const component = {};
  if (value.package !== undefined) {
    component.package = nonemptyString(value.package, `${location}.package`);
    if (isIgnoredPackage(component.package, config)) fail(location, `names ignored package ${component.package}`);
  }
  if (value.version !== undefined) component.version = nonemptyString(value.version, `${location}.version`);
  component.license = nonemptyString(value.license, `${location}.license`);
  if (!config.allow.includes(component.license)) {
    fail(`${location}.license`, `${component.license} is not allowed`);
  }
  component.noticeText = nonemptyString(value.noticeText, `${location}.noticeText`);
  if (component.package === undefined) {
    component.name = nonemptyString(value.name, `${location}.name`);
  } else if (value.name !== undefined) {
    fail(`${location}.name`, "may be declared only for a component without package identity");
  }
  return component;
}

function objectArray(value, location, validate) {
  if (!Array.isArray(value)) fail(location, "must be an array");
  return value.map((entry, index) => validate(entry, `${location}[${index}]`));
}

function stringArray(value, location, { nonempty = false } = {}) {
  if (!Array.isArray(value) || (nonempty && value.length === 0)) {
    fail(location, `must be ${nonempty ? "a nonempty" : "an"} array`);
  }
  return value.map((entry, index) => nonemptyString(entry, `${location}[${index}]`));
}

function nonemptyString(value, location) {
  if (typeof value !== "string" || value.length === 0) fail(location, "must be a nonempty string");
  return value;
}

function assertUnique(values, location, field = "value") {
  const seen = new Set();
  for (const value of values) {
    if (seen.has(value)) fail(location, `contains duplicate ${field} ${JSON.stringify(value)}`);
    seen.add(value);
  }
}

function assertExactObject(value, keys, location, { optional = false } = {}) {
  assertObject(value, location);
  assertExactKeys(value, keys, location, { optional });
}

function assertObject(value, location) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) fail(location, "must be an object");
}

function assertExactKeys(value, keys, location, { optional = false, optionalKeys = [] } = {}) {
  const allowed = new Set([...keys, ...optionalKeys]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) fail(location, `contains unknown field ${JSON.stringify(key)}`);
  }
  if (optional) return;
  for (const key of keys) {
    if (!(key in value)) fail(location, `is missing field ${JSON.stringify(key)}`);
  }
}

function readJSON(filePath) {
  let bytes;
  try {
    bytes = fs.readFileSync(filePath, "utf8");
  } catch (error) {
    throw new Error(`Could not read ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
  }
  try {
    return JSON.parse(bytes);
  } catch (error) {
    throw new Error(`Could not parse ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function relativeLocation(root, filePath) {
  const relative = path.relative(root, filePath);
  return relative && !relative.startsWith("..") ? relative : filePath;
}

function fail(location, message) {
  throw new Error(`${location} ${message}`);
}

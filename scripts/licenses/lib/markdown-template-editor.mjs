import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizePackageRecords } from "./inventory.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const recordKeys = ["packages", "assets"];
const packageKeys = ["name", "version", "declaredLicense", "licenseFilePath"];

export function markdownTemplateEditorFolderPath({ root = repositoryRoot } = {}) {
  return path.join(root, "packages/server/assets/templates/markdown");
}

export function markdownTemplateEditorRecordPath({ root = repositoryRoot } = {}) {
  return path.join(root, "packages/view-markdown/template-editor-licenses.json");
}

/** Read the committed package-and-asset record used by the packaged Markdown editor. */
export function readMarkdownTemplateEditorRecord({
  root = repositoryRoot,
  recordPath = markdownTemplateEditorRecordPath({ root }),
  assets,
} = {}) {
  let value;
  try {
    value = JSON.parse(fs.readFileSync(recordPath, "utf8"));
  } catch (error) {
    throw invalid(`could not read ${recordPath}: ${message(error)}`);
  }

  if (!isObject(value)) throw invalid("the record must be an object");
  assertExactKeys(value, recordKeys, "record");
  if (!Array.isArray(value.packages)) throw invalid("packages must be an array");
  if (!Array.isArray(value.assets)) throw invalid("assets must be an array");

  for (const [index, record] of value.packages.entries()) {
    if (!isObject(record)) throw invalid(`packages[${index}] must be an object`);
    assertExactKeys(record, packageKeys, `packages[${index}]`);
  }

  let packages;
  try {
    packages = normalizePackageRecords(value.packages, "Markdown template editor packages");
  } catch (error) {
    throw invalid(message(error));
  }
  if (packages.length !== value.packages.length || !sameRecords(packages, value.packages)) {
    throw invalid("packages must be sorted and contain no duplicate package identities");
  }

  const assetIDs = value.assets.map((assetID, index) => {
    if (typeof assetID !== "string" || assetID.length === 0) {
      throw invalid(`assets[${index}] must be a nonempty string`);
    }
    return assetID;
  });
  const sortedAssetIDs = [...new Set(assetIDs)].sort(compare);
  if (sortedAssetIDs.length !== assetIDs.length || !sameStrings(sortedAssetIDs, assetIDs)) {
    throw invalid("assets must be sorted and contain no duplicate asset IDs");
  }

  if (assets !== undefined) {
    const assetsByID = new Map(assets.map((asset) => [asset.id, asset]));
    for (const assetID of assetIDs) {
      const asset = assetsByID.get(assetID);
      if (asset === undefined) throw new Error(`unknown Markdown template editor asset: ${assetID}`);
      for (const surface of ["view:markdown", "source"]) {
        if (!asset.surfaces.includes(surface)) {
          throw new Error(`Markdown template editor asset ${assetID} must cover the ${surface} surface`);
        }
      }
    }
  }

  return { packages, assets: assetIDs };
}

function assertExactKeys(value, keys, location) {
  const actual = Object.keys(value);
  for (const key of actual) {
    if (!keys.includes(key)) throw invalid(`${location} contains unknown field ${JSON.stringify(key)}`);
  }
  for (const key of keys) {
    if (!Object.hasOwn(value, key)) throw invalid(`${location} is missing field ${JSON.stringify(key)}`);
  }
}

function sameRecords(left, right) {
  return left.every((record, index) => packageKeys.every((key) => record[key] === right[index]?.[key]));
}

function sameStrings(left, right) {
  return left.every((value, index) => value === right[index]);
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function invalid(detail) {
  return new Error(`invalid Markdown template editor licensing record: ${detail}`);
}

function message(error) {
  return error instanceof Error ? error.message : String(error);
}

function compare(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

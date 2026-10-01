import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import path from "node:path";

const CANONICAL_VERSION_DIRECTORY_RE = /^v\d+(?:\.\d+)?$/;

export function compareCanonicalVersions(left, right) {
  const leftParts = left.slice(1).split(".").map(Number);
  const rightParts = right.slice(1).split(".").map(Number);
  const length = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

async function listVersionDirectories(root, marker) {
  return (await readdir(root, { withFileTypes: true }))
    .filter(
      (entry) =>
        entry.isDirectory() &&
        CANONICAL_VERSION_DIRECTORY_RE.test(entry.name) &&
        existsSync(path.join(root, entry.name, marker)),
    )
    .map((entry) => entry.name)
    .sort(compareCanonicalVersions);
}

export async function listCanonicalVersions(sourceRoot) {
  return listVersionDirectories(sourceRoot, "index.css");
}

export async function listFrozenCanonicalVersions(frozenRoot) {
  return listVersionDirectories(frozenRoot, "frozen.json");
}

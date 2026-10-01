#!/usr/bin/env node
// Validate bundled package shape, exact inventory, and minimum source versions
// before the build copies any theme assets.
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generateBundledThemes } from "../../../scripts/bundled-theme-manifest.mjs";
import {
  compareSemanticVersions,
  isSemanticVersion,
  scanThemesDirectory,
} from "../src/themes.ts";

const BUNDLED_THEMES = generateBundledThemes();

const here = path.dirname(fileURLToPath(import.meta.url));
const themesRoot = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.resolve(here, "..", "assets", "themes");

const snapshot = existsSync(themesRoot)
  ? scanThemesDirectory(themesRoot)
  : { themes: [], errors: [] };
const sourceDirectoryIDs = existsSync(themesRoot)
  ? readdirSync(themesRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
  : [];
const expectedIDs = BUNDLED_THEMES.map(({ id }) => id);
const expectedIDSet = new Set(expectedIDs);
const sourceIDSet = new Set(sourceDirectoryIDs);
const failures = [];

for (const id of expectedIDs) {
  if (!sourceIDSet.has(id)) failures.push(`missing bundled theme ${id}`);
}
for (const id of sourceDirectoryIDs) {
  if (!expectedIDSet.has(id)) failures.push(`unexpected bundled theme ${id}`);
}
for (const entry of snapshot.errors) {
  const label = entry.folder ?? "themes directory";
  failures.push(`${label}: ${entry.error}`);
}

const validThemes = new Map(snapshot.themes.map((theme) => [theme.id, theme]));
for (const { id, minimumVersion } of BUNDLED_THEMES) {
  if (!isSemanticVersion(minimumVersion)) {
    failures.push(`${id}: configured minimum ${minimumVersion} is not a valid Semantic Version`);
    continue;
  }
  const theme = validThemes.get(id);
  if (
    theme !== undefined &&
    compareSemanticVersions(theme.version, minimumVersion) < 0
  ) {
    failures.push(`${id}: source version ${theme.version} is below minimum ${minimumVersion}`);
  }
}

if (failures.length > 0) {
  console.error("bundled theme package tree is invalid");
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

console.log(`bundled theme package tree is valid (${snapshot.themes.length} package(s))`);

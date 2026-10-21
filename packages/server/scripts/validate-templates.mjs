#!/usr/bin/env node
// Validate the exact bundled artifact-template inventory before copying it.
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BUNDLED_ARTIFACT_TEMPLATES } from "../src/bundled-template-installer.ts";
import { validateTemplatePackage } from "../src/templates.ts";
import { compareSemanticVersions } from "../src/themes.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(process.argv[2] ?? path.join(here, "../assets/templates"));
const entries = existsSync(root) ? readdirSync(root, { withFileTypes: true }) : [];
const directories = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
const expected = new Set(BUNDLED_ARTIFACT_TEMPLATES.map(({ id }) => id));
const failures = [];

for (const { id, minimumVersion } of BUNDLED_ARTIFACT_TEMPLATES) {
  if (!directories.includes(id)) {
    failures.push(`missing bundled template ${id}`);
    continue;
  }
  const checked = validateTemplatePackage(path.join(root, id), id);
  for (const error of checked.errors) failures.push(`${id}: ${error}`);
  if (checked.template && compareSemanticVersions(checked.template.version, minimumVersion) < 0) {
    failures.push(`${id}: source version ${checked.template.version} is below minimum ${minimumVersion}`);
  }
}
for (const entry of entries) {
  if (!expected.has(entry.name) || !entry.isDirectory()) failures.push(`unexpected bundled template entry ${entry.name}`);
}

if (failures.length) {
  console.error("bundled artifact template tree is invalid");
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log(`bundled artifact template tree is valid (${directories.length} package(s))`);

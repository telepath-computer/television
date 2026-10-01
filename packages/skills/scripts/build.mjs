#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const skillsPackageDir = path.resolve(here, "..");
const repoRoot = path.resolve(skillsPackageDir, "../..");
const sourcesDir = path.join(skillsPackageDir, "skills");
const distDir = resolvePathOverride("TV_SKILLS_DIST_DIR", path.join(skillsPackageDir, "dist"));

const EXCLUDED_TOP_LEVEL_ENTRIES = new Set([
  "dist",
  "docs",
  "example",
  "node_modules",
  "package.json",
  "playwright.config.ts",
  "src",
  "tsconfig.json",
]);

function resolvePathOverride(envKey, fallbackPath) {
  const override = process.env[envKey];
  if (typeof override !== "string" || override.trim() === "") {
    return fallbackPath;
  }

  return path.isAbsolute(override) ? override : path.resolve(repoRoot, override);
}

function run(cmd, args, cwd) {
  const result = spawnSync(cmd, args, { cwd, stdio: "inherit" });
  if (result.status !== 0) {
    throw new Error(`${cmd} ${args.join(" ")} failed (exit ${result.status ?? "signal"})`);
  }
}

function splitFrontmatter(text) {
  if (!text.startsWith("---\n")) {
    return { frontmatter: {}, body: text };
  }

  const closing = text.indexOf("\n---", 4);
  if (closing === -1) {
    return { frontmatter: {}, body: text };
  }

  const block = text.slice(4, closing);
  const after = text.slice(closing + 4);
  const body = after.startsWith("\n") ? after.slice(1) : after;
  const frontmatter = {};
  for (const rawLine of block.split("\n")) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) continue;
    const colon = line.indexOf(":");
    if (colon === -1) continue;
    const key = line.slice(0, colon).trim();
    let value = line.slice(colon + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    frontmatter[key] = value;
  }
  return { frontmatter, body };
}

function readManifestSkillNames() {
  const manifestPath = path.join(skillsPackageDir, "skills.json");
  const relativeManifestPath = path.relative(repoRoot, manifestPath);
  if (!existsSync(manifestPath)) {
    throw new Error(`Missing skill manifest: ${relativeManifestPath}`);
  }

  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch (error) {
    throw new Error(`Invalid JSON in skill manifest ${relativeManifestPath}: ${error.message}`);
  }

  const names = manifest?.skills;
  if (!Array.isArray(names) || names.length === 0 || names.some((name) => typeof name !== "string" || name.trim() === "")) {
    throw new Error(`Skill manifest ${relativeManifestPath} must contain a non-empty "skills" array of skill names.`);
  }

  const duplicates = names.filter((name, index) => names.indexOf(name) !== index);
  if (duplicates.length > 0) {
    throw new Error(`Skill manifest ${relativeManifestPath} lists duplicate skills: ${[...new Set(duplicates)].join(", ")}`);
  }

  return names;
}

function getSkillBuildInfo(skillDir) {
  const packageJSONPath = path.join(skillDir, "package.json");
  if (!existsSync(packageJSONPath)) {
    return null;
  }

  const packageJSON = JSON.parse(readFileSync(packageJSONPath, "utf8"));
  const buildScript = typeof packageJSON.scripts?.build === "string" ? packageJSON.scripts.build : "";
  if (buildScript.trim() === "") {
    return null;
  }

  if (typeof packageJSON.name !== "string" || packageJSON.name.trim() === "") {
    throw new Error(`Skill package at ${path.relative(repoRoot, packageJSONPath)} is missing a package name.`);
  }

  return { packageName: packageJSON.name };
}

function createSourceFilter(skillDir) {
  return (sourcePath) => {
    const relative = path.relative(skillDir, sourcePath);
    if (relative === "") return true;

    const basename = path.basename(sourcePath);
    if (basename.startsWith(".")) return false;

    const topLevelEntry = relative.split(path.sep)[0];
    if (EXCLUDED_TOP_LEVEL_ENTRIES.has(topLevelEntry)) return false;
    if (/\.config\./.test(topLevelEntry)) return false;

    return true;
  };
}

function emitBuiltSkill(skillName, skillDir, outputDir, buildInfo) {
  run("npm", ["--workspace", buildInfo.packageName, "run", "build"], repoRoot);

  const sourceDistDir = path.join(skillDir, "dist");
  if (!existsSync(sourceDistDir)) {
    throw new Error(`Skill build produced no dist/ at ${path.relative(repoRoot, sourceDistDir)}.`);
  }

  rmSync(outputDir, { recursive: true, force: true });
  cpSync(sourceDistDir, outputDir, { recursive: true });
}

function emitCopiedSkill(skillDir, outputDir) {
  rmSync(outputDir, { recursive: true, force: true });
  cpSync(skillDir, outputDir, {
    recursive: true,
    filter: createSourceFilter(skillDir),
  });
}

function validateSkill(skillName) {
  const skillMarkdownPath = path.join(distDir, skillName, "SKILL.md");
  const relativeSkillMarkdownPath = path.relative(repoRoot, skillMarkdownPath);
  if (!existsSync(skillMarkdownPath)) {
    throw new Error(`Missing emitted SKILL.md: ${relativeSkillMarkdownPath}`);
  }

  const text = readFileSync(skillMarkdownPath, "utf8");
  if (text.trim().length === 0) {
    throw new Error(`Emitted SKILL.md is empty: ${relativeSkillMarkdownPath}`);
  }

  const { frontmatter } = splitFrontmatter(text);
  for (const field of ["name", "description"]) {
    const value = frontmatter[field];
    if (typeof value !== "string" || value.trim() === "") {
      throw new Error(`Invalid SKILL frontmatter in ${relativeSkillMarkdownPath}: missing ${field}.`);
    }
  }

  if (frontmatter.name.trim() !== skillName) {
    throw new Error(
      `Invalid SKILL frontmatter in ${relativeSkillMarkdownPath}: name must be ${skillName}.`,
    );
  }
}

rmSync(distDir, { recursive: true, force: true });
mkdirSync(distDir, { recursive: true });

const manifestSkillNames = readManifestSkillNames();

const missingSkills = manifestSkillNames.filter((name) => !existsSync(path.join(sourcesDir, name)));
if (missingSkills.length > 0) {
  throw new Error(
    `Skill manifest lists skills with no source directory under ${path.relative(repoRoot, sourcesDir)}: ${missingSkills.join(", ")}`,
  );
}

const unlistedDirectories = readdirSync(sourcesDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .filter((name) => !manifestSkillNames.includes(name));
for (const name of unlistedDirectories) {
  process.stdout.write(`  ignoring ${path.relative(repoRoot, path.join(sourcesDir, name))} (not listed in skills.json)\n`);
}

const skills = [...manifestSkillNames]
  .sort((a, b) => a.localeCompare(b))
  .map((name) => ({ name, dir: path.join(sourcesDir, name) }));

for (const skill of skills) {
  const outputDir = path.join(distDir, skill.name);
  const buildInfo = getSkillBuildInfo(skill.dir);

  if (buildInfo) {
    emitBuiltSkill(skill.name, skill.dir, outputDir, buildInfo);
  } else {
    emitCopiedSkill(skill.dir, outputDir);
  }

  validateSkill(skill.name);
  process.stdout.write(`  -> ${path.relative(repoRoot, outputDir)}\n`);
}

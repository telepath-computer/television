#!/usr/bin/env node
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const packageDir = path.resolve(scriptDir, "..");
const repoRoot = path.resolve(packageDir, "../../../..");
const srcDir = path.join(packageDir, "src");
const distDir = path.join(packageDir, "dist");
const defaultFoundationSourceRoot = path.join(
  repoRoot,
  "packages/web/src/foundation",
);
const TOKEN_SHEETS = [
  ["tokens/fonts.css", "Foundation tokens — fonts"],
  ["colors.css", "Foundation tokens — colors"],
  ["text.css", "Foundation tokens — text sizes and line heights"],
  ["spacing.css", "Foundation tokens — spacing and corners"],
  ["shadows.css", "Foundation tokens — shadows"],
  ["layers.css", "Foundation tokens — layers"],
  ["app.css", "Application tokens — grouped by component"],
];
const VOCABULARY_MARKER = "{{INJECT_FOUNDATION_VOCABULARY}}";

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

function readSource(sourceDirectory, relativePath) {
  const text = readFileSync(path.join(sourceDirectory, relativePath), "utf8");
  return splitFrontmatter(text);
}

function renderFrontmatter(fields) {
  const lines = ["---"];
  for (const [key, value] of Object.entries(fields)) {
    lines.push(`${key}: ${value}`);
  }
  lines.push("---");
  return lines.join("\n");
}

function renderFoundationVocabulary(foundationSourceRoot) {
  return TOKEN_SHEETS.map(([filename, group]) => {
    const source = readFileSync(path.join(foundationSourceRoot, filename), "utf8");
    return `/* ${group} */\n${source.trimEnd()}`;
  }).join("\n\n");
}

export function buildTelevision({
  sourceDirectory = srcDir,
  foundationSourceRoot = defaultFoundationSourceRoot,
  outputDir = distDir,
} = {}) {
  const intro = readSource(sourceDirectory, "skill-intro.md");
  const cliCapabilities = readSource(sourceDirectory, "cli-capabilities.md");
  const artifactWorkflow = readSource(sourceDirectory, "artifact-workflow.md");
  const htmlArtifactStyle = readSource(sourceDirectory, "html-artifact-style.md");
  const theming = readSource(sourceDirectory, "theming.md");
  const description = typeof intro.frontmatter.description === "string"
    ? intro.frontmatter.description.trim()
    : "";

  if (description === "") {
    throw new Error("television/src/skill-intro.md must define a non-empty description frontmatter field.");
  }

  const markerCount = theming.body.split(VOCABULARY_MARKER).length - 1;
  if (markerCount === 0) {
    throw new Error(`television/src/theming.md must contain the ${VOCABULARY_MARKER} marker.`);
  }
  if (markerCount !== 1) {
    throw new Error(`television/src/theming.md must contain exactly one ${VOCABULARY_MARKER} marker.`);
  }

  const foundationVocabulary = renderFoundationVocabulary(foundationSourceRoot);
  let renderedTheming = theming.body.replace(
    VOCABULARY_MARKER,
    () => foundationVocabulary,
  );
  const referenceMarker = "{{INJECT_APP_SHELL_REFERENCE}}";
  if (renderedTheming.includes(referenceMarker)) {
    const reference = readSource(sourceDirectory, "app-shell-reference.md").body
      .replace(/^<!-- (?:app-reference-source:|Authority freshness:)[^\n]*-->\r?\n?/gm, "")
      .trimEnd();
    renderedTheming = renderedTheming.replace(referenceMarker, () => reference);
  }
  const renderedSkill = `${renderFrontmatter({
    name: "television",
    description,
  })}

${intro.body.trimEnd()}

${cliCapabilities.body.trimEnd()}

${artifactWorkflow.body.trimEnd()}

${htmlArtifactStyle.body.trimEnd()}
`;

  rmSync(outputDir, { recursive: true, force: true });
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(path.join(outputDir, "SKILL.md"), `${renderedSkill.trimEnd()}\n`);
  writeFileSync(path.join(outputDir, "theming.md"), `${renderedTheming.trimEnd()}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  buildTelevision();
}

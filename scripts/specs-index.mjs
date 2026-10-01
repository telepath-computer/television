#!/usr/bin/env node
/**
 * Generate specs/index.md and, once the proof tree exists, proofs/index.md.
 *
 * The first line of every indexed document must be a single italic sentence:
 * `*One sentence.*` That sentence becomes the index entry.
 *
 * Run: npm run specs:index
 */

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const DEFAULT_REPO_ROOT = resolve(dirname(SCRIPT_PATH), "..");
const DESCRIPTION_PATTERN = /^\*(.+)\*\s*$/;
const ALWAYS_DIRS = ["product", "arch"];
const DIR_ORDER = ["product", "arch"];

function isUISpecProse(rootDir, file, directoryHasIndex) {
  const segments = relative(rootDir, file).split(sep);
  if (segments[0] !== "ui") return true;
  return directoryHasIndex;
}

function walkDocuments(rootDir, directory, indexPath) {
  const out = [];
  const entries = readdirSync(directory, { withFileTypes: true });
  const directoryHasIndex = entries.some((entry) => entry.isFile() && entry.name === "index.md");
  for (const entry of entries) {
    const full = join(directory, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkDocuments(rootDir, full, indexPath));
    } else if (
      entry.name.endsWith(".md")
      && full !== indexPath
      && isUISpecProse(rootDir, full, directoryHasIndex)
    ) {
      out.push(full);
    }
  }
  return out;
}

function firstLineDescription(content, relativePath, rootDir) {
  const newline = content.indexOf("\n");
  const firstLine = newline === -1 ? content : content.slice(0, newline);
  const match = firstLine.match(DESCRIPTION_PATTERN);
  if (!match) return null;
  const fromDir = dirname(relativePath);
  return match[1].trim().replace(/\]\(([^)\s]+)\)/g, (whole, href) => {
    if (/^[a-z][a-z+.-]*:/i.test(href) || href.startsWith("#")) return whole;
    const [target, ...anchor] = href.split("#");
    const rebased = relative(rootDir, join(rootDir, fromDir, target));
    return `](${[rebased, ...anchor].join("#")})`;
  });
}

function countLines(content) {
  if (content.length === 0) return 0;
  let lines = 0;
  for (let index = 0; index < content.length; index += 1) {
    if (content.charCodeAt(index) === 10) lines += 1;
  }
  if (content.charCodeAt(content.length - 1) !== 10) lines += 1;
  return lines;
}

function newNode() {
  return { files: [], dirs: new Map() };
}

function insert(root, segments, file) {
  let node = root;
  for (const directory of segments.slice(0, -1)) {
    if (!node.dirs.has(directory)) node.dirs.set(directory, newNode());
    node = node.dirs.get(directory);
  }
  node.files.push({ name: segments.at(-1), ...file });
}

function dirRank(name) {
  const index = DIR_ORDER.indexOf(name);
  return index === -1 ? DIR_ORDER.length : index;
}

function sortedDirNames(node) {
  return [...node.dirs.keys()].sort((left, right) => {
    const leftRank = dirRank(left);
    const rightRank = dirRank(right);
    return leftRank !== rightRank ? leftRank - rightRank : left.localeCompare(right);
  });
}

function isEmpty(node) {
  return node.files.length === 0 && node.dirs.size === 0;
}

function render(node, depth, out) {
  const indent = "  ".repeat(depth);
  for (const file of [...node.files].sort((left, right) => left.name.localeCompare(right.name))) {
    out.push(`${indent}- \`${file.name}\` (${file.lines} lines) — *${file.description}*`);
  }
  for (const name of sortedDirNames(node)) {
    out.push(`${indent}- **${name}/**`);
    const child = node.dirs.get(name);
    if (isEmpty(child)) out.push(`${indent}  - _(none yet)_`);
    else render(child, depth + 1, out);
  }
}

function indexConfiguration(repoRoot, kind) {
  const rootDir = join(repoRoot, kind);
  const isSpecs = kind === "specs";
  return {
    kind,
    rootDir,
    indexPath: join(rootDir, "index.md"),
    description: isSpecs
      ? "*Generated index of the Television spec set; the first line of each spec is its entry. Rebuild with `npm run specs:index`. Do not hand-edit.*"
      : "*Generated index of the Television proof set; the first line of each proof is its entry. Rebuild with `npm run specs:index`. Do not hand-edit.*",
    title: isSpecs ? "Spec Index" : "Proof Index",
    introduction: isSpecs
      ? "Generated from the first-line description of every spec by `scripts/specs-index.mjs`, mirroring the `specs/` folder tree. See `spec-policy.md` for the description requirement and `spec-docs.md` for what belongs outside `specs/`."
      : "Generated from the first-line description of every proof by `scripts/specs-index.mjs`, mirroring the `proofs/` folder tree. See `../specs/spec-policy.md` for proof authority and layout.",
    missingDescription: isSpecs ? "specs" : "proofs",
  };
}

function renderIndex(configuration) {
  const files = walkDocuments(
    configuration.rootDir,
    configuration.rootDir,
    configuration.indexPath,
  ).sort((left, right) => left.localeCompare(right));
  const errors = [];
  const root = newNode();
  let total = 0;

  for (const full of files) {
    const content = readFileSync(full, "utf8");
    const relativePath = relative(configuration.rootDir, full);
    const description = firstLineDescription(content, relativePath, configuration.rootDir);
    if (description === null) {
      errors.push(`${relativePath}: first line is not a valid italic description (expected \`*One sentence.*\`)`);
      continue;
    }
    insert(root, relativePath.split(sep), { lines: countLines(content), description });
    total += 1;
  }

  if (errors.length > 0) {
    const detail = errors.map((error) => `  - ${error}`).join("\n");
    throw new Error(
      `${configuration.kind}:index failed — these ${configuration.missingDescription} are missing or malforming the required first-line description:\n${detail}\nSee specs/spec-policy.md: the first line of every indexed document is its index entry.`,
    );
  }

  for (const directory of ALWAYS_DIRS) {
    if (!root.dirs.has(directory)) root.dirs.set(directory, newNode());
  }

  const out = [
    configuration.description,
    "",
    `# ${configuration.title}`,
    "",
    configuration.introduction,
    "",
  ];
  render(root, 0, out);
  out.push("");
  return { content: out.join("\n"), total };
}

export function generateIndexes(repoRoot = DEFAULT_REPO_ROOT) {
  const results = [];
  for (const kind of ["specs", "proofs"]) {
    const configuration = indexConfiguration(repoRoot, kind);
    if (!existsSync(configuration.rootDir)) continue;
    const rendered = renderIndex(configuration);
    writeFileSync(configuration.indexPath, rendered.content, "utf8");
    results.push({
      path: relative(repoRoot, configuration.indexPath),
      total: rendered.total,
    });
  }
  return results;
}

if (process.argv[1] && resolve(process.argv[1]) === SCRIPT_PATH) {
  try {
    for (const result of generateIndexes()) {
      console.log(`specs:index wrote ${result.path} (${result.total} ${result.path.startsWith("proofs/") ? "proofs" : "specs"})`);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

#!/usr/bin/env node
/**
 * Generate specs/index.md and, once the proof tree exists, proofs/index.md.
 *
 * Every indexed document must have a single italic description sentence:
 * `*One sentence.*` Markdown puts it on the first line; UI MDX puts it after
 * the Storybook preamble and before the first heading. That sentence becomes
 * the index entry.
 *
 * Run: npm run specs:index
 */

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, extname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const DEFAULT_REPO_ROOT = resolve(dirname(SCRIPT_PATH), "..");
const DESCRIPTION_PATTERN = /^\*(.+)\*\s*$/;
const ALWAYS_DIRS = ["product", "arch"];
const DIR_ORDER = ["product", "arch"];

function isIndexedDocument(rootDir, file, directoryHasIndex, allowUiMdx) {
  const segments = relative(rootDir, file).split(sep);
  const extension = extname(file);
  if (extension === ".mdx") return allowUiMdx && segments[0] === "ui";
  if (extension !== ".md") return false;
  // A proof of an MDX spec is a lone Markdown file, so only spec directories need an index.md.
  return segments[0] !== "ui" || !allowUiMdx || directoryHasIndex;
}

function walkDocuments(rootDir, directory, indexPath, allowUiMdx) {
  const out = [];
  const entries = readdirSync(directory, { withFileTypes: true });
  const directoryHasIndex = entries.some((entry) => entry.isFile() && entry.name === "index.md");
  for (const entry of entries) {
    const full = join(directory, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkDocuments(rootDir, full, indexPath, allowUiMdx));
    } else if (full !== indexPath && isIndexedDocument(rootDir, full, directoryHasIndex, allowUiMdx)) {
      out.push(full);
    }
  }
  return out;
}

function documentDescription(content, relativePath, rootDir) {
  const lines = content.split(/\r?\n/);
  const firstHeading = lines.findIndex((line) => /^#{1,6}\s/.test(line));
  const candidates = relativePath.endsWith(".mdx")
    ? lines.slice(0, firstHeading === -1 ? lines.length : firstHeading)
    : lines.slice(0, 1);
  const description = candidates.find((line) => DESCRIPTION_PATTERN.test(line));
  const match = description?.match(DESCRIPTION_PATTERN);
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
      ? "*Generated index of the Television spec set; the description line of each spec is its entry. Rebuild with `npm run specs:index`. Do not hand-edit.*"
      : "*Generated index of the Television proof set; the first line of each proof is its entry. Rebuild with `npm run specs:index`. Do not hand-edit.*",
    title: isSpecs ? "Spec Index" : "Proof Index",
    introduction: isSpecs
      ? "Generated from the description line of every spec by `scripts/specs-index.mjs`, mirroring the `specs/` folder tree. See `spec-policy.md` for the description requirement and `spec-docs.md` for what belongs outside `specs/`."
      : "Generated from the first-line description of every proof by `scripts/specs-index.mjs`, mirroring the `proofs/` folder tree. See `../specs/spec-policy.md` for proof authority and layout.",
    missingDescription: isSpecs ? "specs" : "proofs",
  };
}

function renderIndex(configuration) {
  const files = walkDocuments(
    configuration.rootDir,
    configuration.rootDir,
    configuration.indexPath,
    configuration.kind === "specs",
  ).sort((left, right) => left.localeCompare(right));
  const errors = [];
  const root = newNode();
  let total = 0;

  for (const full of files) {
    const content = readFileSync(full, "utf8");
    const relativePath = relative(configuration.rootDir, full);
    const description = documentDescription(content, relativePath, configuration.rootDir);
    if (description === null) {
      const location = relativePath.endsWith(".mdx")
        ? "preamble has no valid italic description before the first heading"
        : "first line is not a valid italic description";
      errors.push(`${relativePath}: ${location} (expected \`*One sentence.*\`)`);
      continue;
    }
    insert(root, relativePath.split(sep), { lines: countLines(content), description });
    total += 1;
  }

  if (errors.length > 0) {
    const detail = errors.map((error) => `  - ${error}`).join("\n");
    throw new Error(
      `${configuration.kind}:index failed — these ${configuration.missingDescription} are missing or malforming the required description:\n${detail}\nSee specs/spec-policy.md and specs/spec-ui.md for description placement.`,
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

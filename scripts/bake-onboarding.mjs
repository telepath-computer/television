#!/usr/bin/env node
// The onboarding design bake (specs/arch/onboarding/bake.md): renders design
// channels from specs/ui/onboarding-artifacts/ into the packaged content tree under
// packages/server/assets/onboarding-channels/, updating onboarding-channels.json,
// for a human to review and commit. Run by hand; never part of a build.
//
// Usage:
//   node scripts/bake-onboarding.mjs <design-channel>... [--root <content-tree>]
//     [--designs <design-root>] [--skills-dist <dist-root>]
//
// The whole input contract runs before anything is written; the channel-folder
// rewrite is destructive, so bad inputs must be stopped up front rather than
// left to the post-write validator.
import { spawnSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parse as parseYaml } from "yaml";
import postcss from "postcss";

// The shared layout validation is TypeScript, loaded through Node's native
// type stripping. The repository toolchain is Node 24; this local check keeps
// testing the required capability so it also catches type stripping being
// disabled. The shared imports are deferred so this check runs first.
if (process.features.typescript !== "strip") {
  console.error(
    `bake-onboarding requires the repository Node 24 toolchain with native TypeScript type stripping enabled ` +
      `(process.features.typescript === "strip"); this is Node ${process.versions.node}` +
      `${process.features.typescript === false ? " with type stripping disabled" : ""}`,
  );
  process.exit(1);
}

const [
  { validatePageLayout },
  { DEFAULT_PAGE_GEOMETRY, DEFAULT_PAGE_SIZE },
] = await Promise.all([
  import("../packages/shared/src/layout.ts"),
  import("../packages/shared/src/types.ts"),
]);

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..");
const VALIDATOR = path.join(REPO_ROOT, "packages", "server", "scripts", "validate-onboarding.mjs");
const DATE_MODULE = path.join(REPO_ROOT, "packages", "server", "assets", "onboarding-relative-dates.js");
const DATE_ARTIFACTS = new Set(["productivity/company-todos", "productivity/todays-calendar"]);

const USAGE =
  "usage: node scripts/bake-onboarding.mjs <design-channel>... " +
  "[--root <content-tree>] [--designs <design-root>] [--skills-dist <dist-root>]";

const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;
const SKILL_FILE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const CARD_FIELDS = new Set([
  "id",
  "slug",
  "title",
  "skill",
  "components",
  "size",
  "geometry",
]);
const REQUIRED_CARD_FIELDS = ["id", "slug", "title"];

function fail(message) {
  console.error(message);
  process.exit(1);
}

function slugOk(value) {
  return typeof value === "string" && SLUG_RE.test(value) && !value.includes("--");
}

function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

// --- invocation --------------------------------------------------------------

const FLAG_DEFAULTS = {
  "--root": path.join(REPO_ROOT, "packages", "server", "assets", "onboarding-channels"),
  "--designs": path.join(REPO_ROOT, "specs", "ui", "onboarding-artifacts"),
  "--skills-dist": path.join(REPO_ROOT, "packages", "skills", "dist"),
};

const channels = [];
const flags = { ...FLAG_DEFAULTS };
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  const arg = argv[i];
  if (arg.startsWith("--")) {
    if (!(arg in FLAG_DEFAULTS)) fail(`unknown option '${arg}'\n${USAGE}`);
    const value = argv[++i];
    if (value === undefined) fail(`option '${arg}' needs a value\n${USAGE}`);
    flags[arg] = path.resolve(value);
  } else {
    channels.push(arg);
  }
}

// --- input contract (specs/arch/onboarding/bake.md#^input-contract) ---------
// Every check runs before anything is written.

// Roots: resolved to absolute real paths (symlinks followed), each an
// existing directory, and the writable content root disjoint from both
// read-only input roots.
function resolveRoot(label, p) {
  let real;
  try {
    real = realpathSync(p);
  } catch {
    fail(`${label} root does not exist: ${p}`);
  }
  if (!statSync(real).isDirectory()) fail(`${label} root is not a directory: ${p}`);
  return real;
}

const contentRoot = resolveRoot("content-tree", flags["--root"]);
const designRoot = resolveRoot("design", flags["--designs"]);
const skillsDistRoot = resolveRoot("skills-dist", flags["--skills-dist"]);

function overlaps(a, b) {
  return a === b || a.startsWith(b + path.sep) || b.startsWith(a + path.sep);
}

for (const [label, other] of [
  ["design", designRoot],
  ["skills-dist", skillsDistRoot],
]) {
  if (overlaps(contentRoot, other)) {
    fail(
      `content-tree root and ${label} root overlap after resolution — the folder rewrite is ` +
        `destructive, so the roots must be disjoint:\n  content-tree: ${contentRoot}\n  ${label}: ${other}`,
    );
  }
}

// Starting config: exists, parses, object with a channels array.
const configPath = path.join(contentRoot, "onboarding-channels.json");
if (!existsSync(configPath)) fail(`no onboarding-channels.json at content-tree root: ${contentRoot}`);
let config;
try {
  config = JSON.parse(readFileSync(configPath, "utf8"));
} catch (error) {
  fail(`onboarding-channels.json does not parse: ${error.message}`);
}
if (typeof config !== "object" || config === null || Array.isArray(config)) {
  fail("onboarding-channels.json is not an object");
}
if (!Array.isArray(config.channels)) fail("onboarding-channels.json has no channels array");

// Arguments: at least one distinct, existing, manifest-carrying design channel.
if (channels.length === 0) fail(`at least one design channel is required\n${USAGE}`);
const seen = new Set();
for (const channel of channels) {
  if (seen.has(channel)) fail(`duplicate design-channel argument: ${channel}`);
  seen.add(channel);
  // Slug legality first: channel names become filesystem paths under both
  // roots, so a malformed or path-escaping name must never be joined.
  if (!slugOk(channel)) fail(`channel directory name is not a valid slug: ${channel}`);
  const dir = path.join(designRoot, channel);
  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    fail(`no design channel '${channel}' under ${designRoot}`);
  }
  if (!existsSync(path.join(dir, "layout.yml"))) {
    fail(`design channel '${channel}' has no manifest (layout.yml)`);
  }
}

// Manifest schema, sources, completeness, and skill-dist shape, per channel.
function loadManifest(channel) {
  const manifestPath = path.join(designRoot, channel, "layout.yml");
  let manifest;
  try {
    manifest = parseYaml(readFileSync(manifestPath, "utf8"));
  } catch (error) {
    fail(`${channel}/layout.yml does not parse: ${error.message}`);
  }
  if (typeof manifest !== "object" || manifest === null || Array.isArray(manifest)) {
    fail(`${channel}/layout.yml is not a mapping`);
  }
  for (const key of Object.keys(manifest)) {
    if (key !== "name" && key !== "cards") fail(`unknown field '${key}' in ${channel}/layout.yml`);
  }
  if (!nonEmptyString(manifest.name)) {
    fail(`${channel}/layout.yml 'name' must be a non-empty string`);
  }
  if (!Array.isArray(manifest.cards)) fail(`${channel}/layout.yml 'cards' must be a list`);
  if (manifest.cards.length === 0) fail(`${channel}/layout.yml 'cards' must not be empty`);
  const ids = new Set();
  const slugs = new Set();
  for (const card of manifest.cards) {
    if (typeof card !== "object" || card === null || Array.isArray(card)) {
      fail(`${channel}/layout.yml has a card that is not a mapping`);
    }
    for (const key of Object.keys(card)) {
      if (!CARD_FIELDS.has(key)) fail(`unknown field '${key}' on a card in ${channel}/layout.yml`);
    }
    for (const field of REQUIRED_CARD_FIELDS) {
      if (card[field] === undefined) fail(`a card in ${channel}/layout.yml is missing '${field}'`);
    }
    if (!nonEmptyString(card.id)) fail(`card 'id' in ${channel}/layout.yml must be a non-empty string`);
    if (!slugOk(card.slug)) fail(`card slug in ${channel}/layout.yml is not a valid slug: ${JSON.stringify(card.slug)}`);
    if (!nonEmptyString(card.title)) fail(`card 'title' for '${card.slug}' in ${channel}/layout.yml must be a non-empty string`);
    if (card.components !== undefined && typeof card.components !== "boolean") {
      fail(`card 'components' for '${card.slug}' in ${channel}/layout.yml must be a boolean`);
    }
    if (card.skill !== undefined && !slugOk(card.skill)) {
      fail(`card 'skill' for '${card.slug}' in ${channel}/layout.yml is not a valid skill name`);
    }
    if ("size" in card || "geometry" in card) {
      const validation = validatePageLayout([
        {
          artifactIds: ["onboarding-design-artifact"],
          geometry: "geometry" in card ? card.geometry : DEFAULT_PAGE_GEOMETRY,
          size: "size" in card ? card.size : DEFAULT_PAGE_SIZE,
        },
      ]);
      if (!validation.valid) {
        const label = `card '${card.slug}' in ${channel}/layout.yml`;
        fail(validation.errors.map((error) => error.replace(/^Page 0\b/, label)).join("\n"));
      }
    }
    if (ids.has(card.id)) fail(`duplicate card id '${card.id}' in ${channel}/layout.yml`);
    ids.add(card.id);
    if (slugs.has(card.slug)) fail(`duplicate card slug '${card.slug}' in ${channel}/layout.yml`);
    slugs.add(card.slug);
  }
  return manifest;
}

function resolveSources(channel, manifest) {
  const channelDir = path.join(designRoot, channel);
  const cards = manifest.cards.map((card) => {
    const frame = path.join(channelDir, `${card.slug}.frame`);
    const contentMd = path.join(channelDir, `${card.slug}.md`);
    const hasFrame = existsSync(frame);
    const hasMd = existsSync(contentMd);
    if (hasFrame && hasMd) {
      fail(`ambiguous source for ${channel}/${card.slug}: both .frame and .md exist`);
    }
    if (!hasFrame && !hasMd) {
      fail(`missing source for ${channel}/${card.slug}: neither .frame nor .md exists`);
    }
    const sourcePath = hasMd ? contentMd : frame;
    if (!statSync(sourcePath).isFile()) {
      fail(`source for ${channel}/${card.slug} is not a file: ${sourcePath}`);
    }
    return { ...card, kind: hasMd ? "markdown" : "frame", sourcePath };
  });
  // Source identity is the filename, not a directory or the frame's title.
  const slugSet = new Set(cards.map((card) => card.slug));
  for (const filename of readdirSync(channelDir).sort()) {
    const extension = path.extname(filename);
    if ([".frame", ".md"].includes(extension) && !slugSet.has(path.basename(filename, extension))) {
      fail(`design source '${channel}/${filename}' is omitted from the manifest`);
    }
  }
  return cards;
}

function checkSkillDist(skill) {
  const dir = path.join(skillsDistRoot, skill);
  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    fail(`skill '${skill}' names no built dist directory under ${skillsDistRoot} — build the skills package first`);
  }
  const files = [];
  for (const entry of readdirSync(dir).sort()) {
    const stats = lstatSync(path.join(dir, entry));
    if (stats.isDirectory()) fail(`skill dist '${skill}' contains a subdirectory '${entry}' — unsupported`);
    if (!stats.isFile()) fail(`skill dist '${skill}' contains a non-regular entry (e.g. a symlink) '${entry}' — unsupported`);
    if (entry === "index.html") fail(`skill dist '${skill}' contains index.html, which collides with the artifact entry document`);
    if (!SKILL_FILE_RE.test(entry)) fail(`skill dist '${skill}' filename '${entry}' is outside the safe pattern ${SKILL_FILE_RE}`);
    if (entry !== "SKILL.md") files.push(entry);
  }
  return files;
}

const bakedChannels = [];
const usedSkills = new Map();
for (const channel of channels) {
  const manifest = loadManifest(channel);
  const cards = resolveSources(channel, manifest);
  for (const card of cards) {
    if (card.skill !== undefined && !usedSkills.has(card.skill)) {
      usedSkills.set(card.skill, checkSkillDist(card.skill));
    }
  }
  bakedChannels.push({ channel, name: manifest.name, cards });
}

// --- rendering (specs/arch/onboarding/bake.md#^spec-rendering) ---------------
async function withRenderer(work) {
  // Use the Vite version owned by Frameset. The app still uses an older Vite
  // whose SSR loader cannot resolve Frameset's virtual stylesheet modules.
  const { createServer } = await import(pathToFileURL(
    createRequire(import.meta.resolve("frameset/vite")).resolve("vite"),
  ).href);
  const { default: frameset } = await import("frameset/vite");
  // A private cache (specs/arch/onboarding/bake.md#^renderer-cache): Vite's
  // default under REPO_ROOT is node_modules/.vite, which a dev server running
  // in this checkout is serving optimized dependencies from. Rendering is
  // SSR-only, so the browser dependency optimizer stays off; left on, it
  // scans the repository and keeps writing after close() returns.
  const cacheDir = mkdtempSync(path.join(os.tmpdir(), "tv-onboarding-bake-vite-"));
  const server = await createServer({
    configFile: false,
    root: REPO_ROOT,
    cacheDir,
    optimizeDeps: { noDiscovery: true },
    plugins: [
      {
        name: "onboarding-no-frame-composition",
        enforce: "pre",
        resolveId(source, importer) {
          // Frameset resolves actual body compositions here after parsing
          // Liquid, so raw and commented render examples remain inert.
          if (importer?.endsWith(".frame") && source.endsWith(".frame")) {
            throw new Error(`frame ${importer} imports '${source}' through composition — onboarding frames must be self-contained`);
          }
          return null;
        },
      },
      frameset(),
    ],
    server: { middlewareMode: true, hmr: false, watch: null, ws: false, fs: { strict: false } },
    appType: "custom",
    logLevel: "error",
  }).catch((error) => {
    rmSync(cacheDir, { recursive: true, force: true });
    throw error;
  });
  try {
    return await work(async (absPath) => {
      const mod = await server.ssrLoadModule(absPath);
      return { markup: mod.default.render(), style: mod.default.style };
    });
  } finally {
    try {
      await server.close();
    } finally {
      rmSync(cacheDir, { recursive: true, force: true });
    }
  }
}

// Self-containment inspects actual CSS constructs, per the spec'd semantics
// (specs/arch/onboarding/bake.md#^self-contained-styles): postcss owns the
// structure; CSS escapes are decoded before classification in identifiers and
// string/URL values alike; reference positions are url() tokens, @import
// rules, and the URL-shorthand string arguments of image-set()/src(); and
// exemptions (data:, #fragment) classify the escape-decoded value.

const WS_RE = /[ \t\n\r\f]/;

function isIdentChar(ch) {
  return /[A-Za-z0-9_-]/.test(ch) || ch.charCodeAt(0) >= 0x80;
}

// CSS escape decoding (CSS Syntax §4.3.7): backslash + 1-6 hex digits
// consumes one following whitespace; backslash + newline is a string line
// continuation; backslash + anything else is that character. Input is first
// put through CSS preprocessing (§3.3): CRLF, CR, and form feed become a
// newline, so line continuations work in any line-ending convention.
function decodeCssEscapes(rawText) {
  const text = rawText.replace(/\r\n|\r|\f/g, "\n");
  let out = "";
  let i = 0;
  while (i < text.length) {
    if (text[i] !== "\\") {
      out += text[i++];
      continue;
    }
    const hex = /^[0-9a-fA-F]{1,6}/.exec(text.slice(i + 1))?.[0];
    if (hex) {
      const codePoint = Number.parseInt(hex, 16);
      out += codePoint === 0 || codePoint > 0x10ffff ? "�" : String.fromCodePoint(codePoint);
      i += 1 + hex.length;
      if (text[i] === "\r" && text[i + 1] === "\n") i += 2;
      else if (WS_RE.test(text[i] ?? "")) i += 1;
    } else if (text[i + 1] === "\n") {
      i += 2;
    } else if (i + 1 >= text.length) {
      i += 1;
    } else {
      out += text[i + 1];
      i += 2;
    }
  }
  return out;
}

const URL_BEARING_FUNCTIONS = new Set(["image-set", "-webkit-image-set", "src"]);

// Reads one CSS identifier (maximal munch, escapes included) starting at
// `start`; returns the escape-decoded identifier and the index after it.
function readIdentAt(text, start) {
  let raw = "";
  let i = start;
  while (i < text.length) {
    const ch = text[i];
    if (ch === "\\") {
      const hex = /^[0-9a-fA-F]{1,6}/.exec(text.slice(i + 1))?.[0];
      if (hex) {
        raw += text.slice(i, i + 1 + hex.length);
        i += 1 + hex.length;
        if (text[i] === "\r" && text[i + 1] === "\n") {
          raw += text.slice(i, i + 2);
          i += 2;
        } else if (WS_RE.test(text[i] ?? "")) {
          raw += text[i];
          i += 1;
        }
      } else if (i + 1 < text.length) {
        raw += text.slice(i, i + 2);
        i += 2;
      } else {
        i += 1;
      }
      continue;
    }
    if (!isIdentChar(ch)) break;
    raw += ch;
    i++;
  }
  return [decodeCssEscapes(raw), i];
}

function classifyReference(label, decodedTarget) {
  const target = decodedTarget.trim();
  if (!target.toLowerCase().startsWith("data:") && !target.startsWith("#")) {
    fail(`authored stylesheet for ${label} references an external url(${target}) — packaged content is self-contained`);
  }
}

// Scans one declaration value or at-rule params text for reference positions.
// Maximal-munch identifier reading gives correct CSS ident boundaries: in
// éurl(…) the identifier is "éurl", a different function, not url().
function scanCssText(label, text) {
  const stack = [];
  let i = 0;
  const top = () => stack[stack.length - 1];
  const consumeToken = () => {
    const frame = top();
    if (frame) frame.awaitingFirst = false;
  };

  const readString = (quote) => {
    i++;
    let raw = "";
    while (i < text.length && text[i] !== quote) {
      if (text[i] === "\\") {
        raw += text.slice(i, i + 2);
        i += 2;
      } else {
        raw += text[i++];
      }
    }
    i++;
    return decodeCssEscapes(raw);
  };

  while (i < text.length) {
    const ch = text[i];
    if (WS_RE.test(ch)) {
      i++;
      continue;
    }
    if (ch === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2);
      i = end === -1 ? text.length : end + 2;
      continue;
    }
    if (ch === '"' || ch === "'") {
      const decoded = readString(ch);
      const frame = top();
      if (frame?.urlBearing && frame.awaitingFirst) classifyReference(label, decoded);
      consumeToken();
      continue;
    }
    if (ch === ",") {
      const frame = top();
      if (frame) frame.awaitingFirst = frame.urlBearing;
      i++;
      continue;
    }
    if (ch === "(") {
      consumeToken();
      stack.push({ urlBearing: false, awaitingFirst: false });
      i++;
      continue;
    }
    if (ch === ")") {
      stack.pop();
      i++;
      continue;
    }
    if (isIdentChar(ch) || ch === "\\") {
      const [identDecoded, next] = readIdentAt(text, i);
      i = next;
      const name = identDecoded.toLowerCase();
      if (text[i] === "(") {
        i++;
        consumeToken();
        if (name === "url") {
          while (i < text.length && WS_RE.test(text[i])) i++;
          if (text[i] === '"' || text[i] === "'") {
            classifyReference(label, readString(text[i]));
            while (i < text.length && text[i] !== ")") i++;
            i++;
          } else {
            let raw = "";
            while (i < text.length && text[i] !== ")") raw += text[i++];
            i++;
            classifyReference(label, decodeCssEscapes(raw));
          }
        } else {
          const urlBearing = URL_BEARING_FUNCTIONS.has(name);
          stack.push({ urlBearing, awaitingFirst: urlBearing });
        }
      } else {
        consumeToken();
      }
      continue;
    }
    consumeToken();
    i++;
  }
}

function checkStyle(label, style) {
  let root;
  try {
    root = postcss.parse(style);
  } catch (error) {
    fail(`authored stylesheet for ${label} does not parse as CSS: ${error.message}`);
  }
  root.walkAtRules((atRule) => {
    // postcss splits an at-keyword at the first escape (name "impo",
    // params "\72t …"), so the keyword is re-read as one CSS identifier
    // from the reassembled raw text.
    const rawText = atRule.name + (atRule.raws.afterName ?? "") + atRule.params;
    const [keyword] = readIdentAt(rawText, 0);
    if (keyword.toLowerCase() === "import") {
      fail(`authored stylesheet for ${label} contains an @import rule — packaged content is self-contained`);
    }
    scanCssText(label, atRule.params);
  });
  root.walkDecls((decl) => {
    scanCssText(label, decl.value);
  });
}

// Inspect the authored YAML before loading Frameset: Vite may inline an
// @import or an asset URL, hiding a forbidden dependency in resolved CSS.
// Frameset remains responsible for the complete frame syntax and compilation.
function checkFrameSource(card) {
  const source = readFileSync(card.sourcePath, "utf8");
  const opening = source.match(/^---(?:\r?\n|$)/);
  if (!opening) return;
  const rest = source.slice(opening[0].length);
  const closing = /^---\r?$/m.exec(rest);
  if (!closing) fail(`frame ${card.sourcePath} has an unclosed frontmatter fence`);
  let declarations;
  try {
    declarations = parseYaml(rest.slice(0, closing.index));
  } catch (error) {
    fail(`frame ${card.sourcePath} has invalid frontmatter: ${error.message}`);
  }
  if (declarations === null) return;
  if (typeof declarations !== "object" || Array.isArray(declarations)) {
    fail(`frame ${card.sourcePath} frontmatter must be a mapping`);
  }
  for (const field of ["params", "imports", "data", "script", "adoptedStyles"]) {
    if (Object.hasOwn(declarations, field)) {
      fail(`frame ${card.sourcePath} declares prohibited '${field}'`);
    }
  }
  if (Object.hasOwn(declarations, "style")) {
    if (typeof declarations.style !== "string") fail(`frame ${card.sourcePath} style must be a string`);
    checkStyle(card.sourcePath, declarations.style);
  }
}

const frameCards = bakedChannels.flatMap(({ cards }) => cards.filter((card) => card.kind === "frame"));
for (const card of frameCards) checkFrameSource(card);

if (frameCards.length > 0) {
  try {
    await withRenderer(async (render) => {
      for (const card of frameCards) {
        try {
          card.rendering = await render(card.sourcePath);
        } catch (error) {
          throw new Error(`rendering failed for ${card.sourcePath}: ${error.message}`);
        }
      }
    });
  } catch (error) {
    // withRenderer closes Vite and its children before this process exits.
    fail(error.message);
  }
}

// --- transformation (specs/arch/onboarding/bake.md#^baked-shell) -------------

function escapeTitle(title) {
  return title
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function shellDocument(card, skillFiles, relativeDates) {
  const skillCss = skillFiles.filter((f) => f.endsWith(".css"));
  const skillJs = skillFiles.filter((f) => f.endsWith(".js"));
  const lines = [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeTitle(card.title)}</title>`,
    '<link rel="stylesheet" href="/canonical/v2/styles.css">',
    ...(relativeDates ? ['<script type="module" src="./onboarding-relative-dates.js"></script>'] : []),
    ...(card.components !== false ? ['<script type="module" src="/canonical/v2/components.js"></script>'] : []),
    ...skillCss.map((f) => `<link rel="stylesheet" href="./${f}">`),
    ...skillJs.map((f) => `<script type="module" src="./${f}"></script>`),
    ...(card.rendering.style === undefined ? [] : ["<style>", card.rendering.style, "</style>"]),
    "</head>",
    "<body>",
    card.rendering.markup,
    "</body>",
    "</html>",
  ];
  return lines.join("\n") + "\n";
}

// Read the production module before replacing any channel folder.
const dateModuleBytes = readFileSync(DATE_MODULE);

// --- write phase --------------------------------------------------------------

for (const baked of bakedChannels) {
  const channelDir = path.join(contentRoot, baked.channel);
  // The baked channel's folder is replaced whole (^folder-rewrite).
  rmSync(channelDir, { recursive: true, force: true });
  mkdirSync(channelDir, { recursive: true });
  for (const card of baked.cards) {
    const relativeDates = DATE_ARTIFACTS.has(`${baked.channel}/${card.slug}`);
    if (card.kind === "markdown") {
      writeFileSync(path.join(channelDir, `${card.slug}.md`), readFileSync(card.sourcePath));
    } else if (card.skill !== undefined) {
      const artifactDir = path.join(channelDir, card.slug);
      mkdirSync(artifactDir);
      const skillFiles = usedSkills.get(card.skill);
      writeFileSync(path.join(artifactDir, "index.html"), shellDocument(card, skillFiles, relativeDates));
      for (const file of skillFiles) {
        writeFileSync(path.join(artifactDir, file), readFileSync(path.join(skillsDistRoot, card.skill, file)));
      }
      if (relativeDates) {
        writeFileSync(path.join(artifactDir, "onboarding-relative-dates.js"), dateModuleBytes);
      }
    } else {
      writeFileSync(path.join(channelDir, `${card.slug}.html`), shellDocument(card, [], false));
    }
  }
}

// --- config update (specs/arch/onboarding/bake.md#^config-update) ------------

for (const baked of bakedChannels) {
  const artifacts = baked.cards.map((card) => ({
    slug: card.slug,
    title: card.title,
    ...("size" in card ? { size: card.size } : {}),
    ...("geometry" in card ? { geometry: card.geometry } : {}),
  }));
  const existing = config.channels.find((entry) => entry && entry.slug === baked.channel);
  if (existing) {
    // The entry's name and position are the config's, human-edited.
    existing.artifacts = artifacts;
  } else {
    config.channels.push({ slug: baked.channel, name: baked.name, artifacts });
  }
}

// Canonical serialization: 2-space JSON, trailing
// newline, keys in schema-declared order; preserved entries reserialized the
// same way with their values intact.
const KEY_ORDERS = {
  config: ["version", "focusChannel", "channels"],
  channel: ["slug", "name", "artifacts"],
  artifact: ["slug", "title", "size", "geometry"],
  size: ["width", "height"],
  geometry: ["kind", "full_screen"],
};

function ordered(value, kind) {
  const keys = KEY_ORDERS[kind] ?? Object.keys(value);
  const out = {};
  for (const key of keys) {
    const field = value[key];
    if (field === undefined) continue;
    out[key] =
      kind === "artifact" &&
      (key === "size" || key === "geometry") &&
      typeof field === "object" &&
      field !== null &&
      !Array.isArray(field)
        ? ordered(field, key)
        : field;
  }
  for (const key of Object.keys(value)) if (!(key in out)) out[key] = value[key];
  return out;
}

const canonical = ordered(
  {
    ...config,
    channels: config.channels.map((channel) =>
      typeof channel === "object" && channel !== null
        ? ordered(
            {
              ...channel,
              ...(Array.isArray(channel.artifacts)
                ? { artifacts: channel.artifacts.map((a) => (typeof a === "object" && a !== null ? ordered(a, "artifact") : a)) }
                : {}),
            },
            "channel",
          )
        : channel,
    ),
  },
  "config",
);
writeFileSync(configPath, JSON.stringify(canonical, null, 2) + "\n");

// --- post-write validation ---------------------------------------------------

const validation = spawnSync("node", [VALIDATOR, contentRoot], { encoding: "utf8" });
if (validation.stdout) process.stdout.write(validation.stdout);
if (validation.stderr) process.stderr.write(validation.stderr);
if (validation.status !== 0) {
  fail("bake output failed build validation; the written tree is left in place for inspection");
}

for (const baked of bakedChannels) {
  const shapes = baked.cards
    .map((card) => `${card.slug} (${card.kind === "markdown" ? "md" : card.skill ? "directory" : "html"})`)
    .join(", ");
  console.log(`baked ${baked.channel}: ${shapes}`);
}

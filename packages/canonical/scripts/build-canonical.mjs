#!/usr/bin/env node
/**
 * Build the canonical artifact stylesheet bundle.
 *
 * Discovers live `v<n>/index.css` inputs and frozen `v<n>/frozen.json`
 * payloads. Live versions are built from source; frozen version trees are
 * copied byte-for-byte. A version present in both roots is rejected.
 *
 * Output is byte-stable. Re-running with unchanged inputs produces the same
 * bytes (idempotent). Used in CI and production packaging.
 *
 * Usage: `node scripts/build-canonical.mjs` (CLI), or import
 * `buildCanonicalVersions` programmatically.
 */
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { existsSync, readFileSync } from "node:fs";
import { copyFile, cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { build } from "esbuild";
import {
  compareCanonicalVersions,
  listCanonicalVersions,
  listFrozenCanonicalVersions,
} from "./canonical-versions.mjs";
import { contentAddressedName } from "./content-addressed-name.mjs";
import { extractIconPlaceholders } from "./icon-placeholders.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(scriptDir, "..");
const repoRoot = path.resolve(packageRoot, "../..");

const DEFAULT_SOURCE_ROOT = path.join(packageRoot, "styles", "canonical");
const DEFAULT_FROZEN_ROOT = path.join(packageRoot, "frozen");
const DEFAULT_COMPONENTS_SOURCE = path.join(packageRoot, "canonical-components.ts");
const DEFAULT_OUT_ROOT = path.join(packageRoot, "dist", "canonical");

// Matches a single CSS @import directive on its own line. Captures the
// quoted path. Permissive about quotes and trailing whitespace.
const IMPORT_RE = /^\s*@import\s+["']([^"']+)["']\s*;\s*$/gm;

// Matches a url(...) reference inside CSS (for font-face srcs etc.).
// Captures the inner path; tolerates quoted or unquoted forms.
const URL_RE = /url\(\s*(["']?)([^"')\s]+)\1\s*\)/g;

/**
 * Recursively inline every `@import` rule starting at `entryPath`.
 * Dedup'd by absolute file path so a file imported via two paths only
 * appears once in the output.
 *
 * @param {string} entryPath
 * @param {Set<string>} seen
 * @param {Map<string, string>} fonts
 * @param {{iconStylesSource: string, urlPrefix: string}} version
 * @returns {Promise<string>}
 */
async function inlineImports(entryPath, seen, fonts, version) {
  const abs = path.resolve(entryPath);
  if (seen.has(abs)) return "";
  seen.add(abs);

  const dir = path.dirname(abs);
  const source = await readFile(abs, "utf8");
  const selected = abs === version.iconStylesSource
    ? extractIconPlaceholders(source)
    : source;
  const css = rewriteUrls(selected, dir, fonts, version.urlPrefix);

  // Walk @import directives in order, replacing each with its expanded
  // (already-inlined) contents.
  const parts = [];
  let lastEnd = 0;
  // Each recursive expansion owns its cursor. A shared global-regexp cursor
  // would be reset by the child before the parent resumes.
  const importPattern = new RegExp(IMPORT_RE.source, IMPORT_RE.flags);
  let match;
  while ((match = importPattern.exec(css)) !== null) {
    parts.push(css.slice(lastEnd, match.index));
    const importedRel = match[1];
    const importedAbs = path.resolve(dir, importedRel);
    parts.push(await inlineImports(importedAbs, seen, fonts, version));
    lastEnd = match.index + match[0].length;
  }
  parts.push(css.slice(lastEnd));

  return parts.join("");
}

/**
 * Find every url(...) reference in one source stylesheet and rewrite it to
 * <urlPrefix>/fonts/<stem>.<digest><extension>. Resolve the source path and
 * derive the digest before imports are expanded, while the directory of the
 * stylesheet containing the reference is still known.
 *
 * @param {string} css
 * @param {string} sourceDir
 * @param {Map<string, string>} fonts maps source path → emitted basename
 * @param {string} urlPrefix
 * @returns {string}
 */
function rewriteUrls(css, sourceDir, fonts, urlPrefix) {
  return css.replace(URL_RE, (whole, _quote, url) => {
    // Skip data: URIs and absolute http(s) URLs.
    if (/^(data:|https?:)/.test(url)) return whole;
    // Skip already-absolute paths (e.g. someone hand-coded a /canonical/...).
    if (url.startsWith("/")) return whole;
    const resolved = path.resolve(sourceDir, url);
    if (!existsSync(resolved)) {
      throw new Error(`build-canonical: referenced font missing: ${resolved}`);
    }
    const basename = contentAddressedName(
      path.basename(resolved),
      readFileSync(resolved),
    );
    fonts.set(resolved, basename);
    return `url(${urlPrefix}/fonts/${basename})`;
  });
}

async function bundleComponents(entryPath) {
  const result = await build({
    absWorkingDir: repoRoot,
    entryPoints: [path.resolve(entryPath)],
    outfile: "components.js",
    bundle: true,
    write: false,
    format: "esm",
    platform: "browser",
    target: "es2022",
    charset: "utf8",
    minifyWhitespace: true,
    loader: {
      ".css": "text",
      ".svg": "text",
    },
    logLevel: "silent",
  });
  const output = result.outputFiles.find((file) => file.path.endsWith(".js"));
  if (output === undefined) {
    throw new Error("build-canonical: component build produced no JavaScript output");
  }
  return output.text;
}

/**
 * @param {object} [opts]
 * @param {string} [opts.sourceRoot] live-version root (default: packages/canonical/styles/canonical)
 * @param {string} [opts.frozenRoot] frozen-version root (default alongside the default live root; omitted for an overridden live root)
 * @param {string} [opts.componentsSource] path to canonical-components.ts (default: packages/canonical/canonical-components.ts)
 * @param {string} [opts.outDir] canonical output root (default: packages/canonical/dist/canonical)
 * @returns {Promise<Record<string, {stylesheetPath: string, componentsPath: string, fontPaths: string[]}>>}
 */
export async function buildCanonicalVersions(opts = {}) {
  const sourceRoot = opts.sourceRoot ?? DEFAULT_SOURCE_ROOT;
  const frozenRoot = opts.frozenRoot ?? (
    opts.sourceRoot === undefined ? DEFAULT_FROZEN_ROOT : undefined
  );
  const componentsSource = opts.componentsSource ?? DEFAULT_COMPONENTS_SOURCE;
  const outDir = opts.outDir ?? DEFAULT_OUT_ROOT;

  const liveVersions = await listCanonicalVersions(sourceRoot);
  const frozenVersions = frozenRoot === undefined
    ? []
    : await listFrozenCanonicalVersions(frozenRoot);
  const duplicate = liveVersions.find((version) => frozenVersions.includes(version));
  if (duplicate !== undefined) {
    throw new Error(
      `build-canonical: ${duplicate} is present in both live and frozen roots`,
    );
  }
  const versions = [...liveVersions, ...frozenVersions].sort(compareCanonicalVersions);
  if (versions.length === 0) {
    throw new Error("build-canonical: no live or frozen version directories found");
  }

  const components = liveVersions.length === 0
    ? undefined
    : await bundleComponents(componentsSource);
  // The output root represents exactly the versions present in both input
  // roots. Clear it first so a removed version cannot ship stale.
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });
  const result = {};
  for (const version of versions) {
    const versionOutDir = path.join(outDir, version);
    if (frozenVersions.includes(version)) {
      result[version] = await copyFrozenCanonicalVersion({
        source: path.join(frozenRoot, version),
        outDir: versionOutDir,
      });
      continue;
    }
    result[version] = await buildCanonicalVersion({
      source: path.join(sourceRoot, version, "index.css"),
      iconStylesSource: path.join(
        sourceRoot,
        version,
        "elements",
        "icons",
        "styles.css",
      ),
      outDir: versionOutDir,
      urlPrefix: `/canonical/${version}`,
      components,
    });
  }
  return result;
}

async function copyFrozenCanonicalVersion({ source, outDir }) {
  await cp(source, outDir, { recursive: true, force: false, errorOnExist: true });
  const fontsOutDir = path.join(outDir, "fonts");
  const fontPaths = (await readdir(fontsOutDir, { withFileTypes: true }))
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(fontsOutDir, entry.name));
  return {
    stylesheetPath: path.join(outDir, "styles.css"),
    componentsPath: path.join(outDir, "components.js"),
    fontPaths,
  };
}

async function buildCanonicalVersion({ source, iconStylesSource, outDir, urlPrefix, components }) {
  const fonts = new Map();
  const rewritten = await inlineImports(
    source,
    new Set(),
    fonts,
    {
      iconStylesSource: path.resolve(iconStylesSource),
      urlPrefix,
    },
  );

  await mkdir(outDir, { recursive: true });
  const stylesheetPath = path.join(outDir, "styles.css");
  await writeFile(stylesheetPath, rewritten);

  const componentsPath = path.join(outDir, "components.js");
  await writeFile(componentsPath, components);

  const fontsOutDir = path.join(outDir, "fonts");
  await rm(fontsOutDir, { recursive: true, force: true });
  await mkdir(fontsOutDir, { recursive: true });
  const fontPaths = [];
  for (const [src, basename] of fonts) {
    const dst = path.join(fontsOutDir, basename);
    await copyFile(src, dst);
    fontPaths.push(dst);
  }

  return { stylesheetPath, componentsPath, fontPaths };
}

// CLI entry — `node scripts/build-canonical.mjs`
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  buildCanonicalVersions()
    .then((versions) => {
      for (const { stylesheetPath, componentsPath, fontPaths } of Object.values(versions)) {
        console.log(`wrote ${path.relative(process.cwd(), stylesheetPath)}`);
        console.log(`wrote ${path.relative(process.cwd(), componentsPath)}`);
        for (const f of fontPaths) {
          console.log(`copied ${path.relative(process.cwd(), f)}`);
        }
      }
    })
    .catch((err) => {
      console.error(err.stack ?? err.message ?? err);
      process.exit(1);
    });
}

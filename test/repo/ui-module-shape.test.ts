import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { hasSiblingStylesheet } from "./lib/ui-module-source.ts";

const REPO_ROOT = path.resolve(import.meta.dirname, "../..");

interface PackageManifest {
  readonly exports?: Record<string, string>;
}

interface ProductionFile {
  readonly path: string;
  readonly source: string;
}

const FILE_CACHE = new Map<string, string | null>();

function sourceAt(file: string): string | null {
  const cached = FILE_CACHE.get(file);
  if (cached !== undefined || FILE_CACHE.has(file)) return cached ?? null;
  try {
    if (!statSync(file).isFile()) {
      FILE_CACHE.set(file, null);
      return null;
    }
    const source = readFileSync(file, "utf8");
    FILE_CACHE.set(file, source);
    return source;
  } catch {
    FILE_CACHE.set(file, null);
    return null;
  }
}

function requiredSource(file: string): string {
  const source = sourceAt(file);
  if (source === null) throw new Error(`required source is missing: ${relative(file)}`);
  return source;
}

function packageSourceRoot(manifestPath: string, packageDirectory: string): string {
  const manifest = JSON.parse(
    requiredSource(path.join(REPO_ROOT, manifestPath)),
  ) as PackageManifest;
  const entry = manifest.exports?.["."];
  if (typeof entry !== "string") throw new Error(`${packageDirectory} has no package export`);
  const packageRoot = path.join(REPO_ROOT, packageDirectory);
  const sourceRoot = path.dirname(path.resolve(packageRoot, entry));
  if (!sourceRoot.startsWith(packageRoot + path.sep)) {
    throw new Error(`${packageDirectory} package export leaves its package`);
  }
  return sourceRoot;
}

const WEB_ROOT = packageSourceRoot("packages/web/package.json", "packages/web");
const CANONICAL_ENTRY = path.join(REPO_ROOT, "packages/canonical/canonical-components.ts");
const CANONICAL_API = path.join(
  REPO_ROOT,
  "packages/canonical",
  "test/fixtures/canonical-public-api.json",
);

function productionTypeScriptFiles(root: string): ProductionFile[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const candidate = path.join(root, entry.name);
    if (entry.isDirectory()) return productionTypeScriptFiles(candidate);
    if (!entry.isFile() || !entry.name.endsWith(".ts") || entry.name.endsWith(".test.ts")) {
      return [];
    }
    return [{ path: candidate, source: requiredSource(candidate) }];
  });
}

function relative(file: string): string {
  return path.relative(REPO_ROOT, file).split(path.sep).join("/");
}

function lineAt(source: string, index: number): number {
  return source.slice(0, index).split("\n").length;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hasDirectClass(source: string, className: string, baseName: string): boolean {
  return new RegExp(
    `(?:export\\s+)?class\\s+${escapeRegex(className)}\\s+extends\\s+${escapeRegex(baseName)}(?:\\s|<|\\{)`,
  ).test(source);
}

function resolveRelativeImport(from: string, specifier: string): string | null {
  if (!specifier.startsWith(".")) return null;
  const unresolved = path.resolve(path.dirname(from), specifier);
  const candidates = path.extname(unresolved) === ".js"
    ? [unresolved.slice(0, -3) + ".ts", unresolved]
    : path.extname(unresolved) === ""
    ? [`${unresolved}.ts`, path.join(unresolved, "index.ts")]
    : [unresolved];
  return candidates.find((candidate) => sourceAt(candidate) !== null) ?? null;
}

function directRelativeImports(file: ProductionFile): ProductionFile[] {
  const imports: string[] = [];
  const importPattern = /\b(?:import|export)\s+(?:[^"']*?\s+from\s+)?["'](\.[^"']+)["']/g;
  for (const match of file.source.matchAll(importPattern)) {
    const imported = resolveRelativeImport(file.path, match[1]);
    if (imported?.endsWith(".ts")) imports.push(imported);
  }
  return imports.map((path) => ({ path, source: requiredSource(path) }));
}

function directlyReachableTypeScript(entry: string): Set<string> {
  const reached = new Set<string>();
  const entrySource = sourceAt(entry);
  if (entrySource === null) {
    throw new Error(`module-shape entrypoint is missing: ${relative(entry)}`);
  }
  const visit = (file: ProductionFile): void => {
    if (reached.has(file.path)) return;
    reached.add(file.path);
    for (const imported of directRelativeImports(file)) visit(imported);
  };
  visit({ path: entry, source: entrySource });
  return reached;
}

/**
 * Bounded source heuristic for the repository's current direct spellings.
 * Engineering review owns complete module-shape conformance; this check is
 * intentionally not a TypeScript parser or an exhaustive source-language rule.
 */
function currentFormViolations(): {
  violations: string[];
  viewCount: number;
  appElementCount: number;
  canonicalElementCount: number;
} {
  const webFiles = productionTypeScriptFiles(WEB_ROOT);
  const violations: string[] = [];
  let viewCount = 0;
  let appElementCount = 0;
  let canonicalElementCount = 0;

  const viewPattern = /export\s+class\s+([A-Za-z_$][\w$]*)\s+extends\s+View(?:\s|<|\{)/g;
  for (const file of webFiles) {
    for (const match of file.source.matchAll(viewPattern)) {
      viewCount += 1;
      const className = match[1];
      if (!file.path.startsWith(path.join(WEB_ROOT, "views") + path.sep)) {
        violations.push(`${relative(file.path)}:${lineAt(file.source, match.index)} direct View subclass is outside packages/web/src/views/`);
      }
      const wrapperPattern = new RegExp(
        `export\\s+const\\s+[A-Za-z_$][\\w$]*\\s*=\\s*view\\(\\s*${escapeRegex(className)}\\s*\\)`,
        "g",
      );
      const wrapperCount = [...file.source.matchAll(wrapperPattern)].length;
      if (wrapperCount !== 1) {
        violations.push(`${relative(file.path)} direct View subclass ${className} has ${wrapperCount} exported direct wrappers`);
      }
      if (!hasSiblingStylesheet(file)) {
        violations.push(`${relative(file.path)} direct View subclass ${className} does not import its sibling stylesheet`);
      }
    }
  }

  const canonicalFiles = directlyReachableTypeScript(CANONICAL_ENTRY);
  const canonicalTags = new Set<string>(
    Object.keys((JSON.parse(requiredSource(CANONICAL_API)) as {
      elements: Record<string, Record<string, unknown>>;
    }).elements["canonical-v2"]),
  );
  const registrationPattern = /customElements\s*\.\s*define\s*\(\s*["']([^"']+)["']\s*,\s*([A-Za-z_$][\w$]*)\s*\)/g;
  for (const file of webFiles) {
    for (const match of file.source.matchAll(registrationPattern)) {
      const [, tag, className] = match;
      const at = `${relative(file.path)}:${lineAt(file.source, match.index)}`;
      appElementCount += 1;
      if (!file.path.startsWith(path.join(WEB_ROOT, "elements") + path.sep)) {
        violations.push(`${at} direct app registration is outside packages/web/src/elements/`);
      }
      if (!hasDirectClass(file.source, className, "HTMLElement")) {
        violations.push(`${at} direct app registration does not use a local HTMLElement subclass`);
      }
      if (!tag.startsWith("tv-") && !canonicalTags.has(tag)) {
        violations.push(`${at} direct app registration uses neither a tv- name nor a public canonical v1 name`);
      }
      if (!hasSiblingStylesheet(file)) {
        violations.push(`${at} direct app registration does not import its sibling stylesheet`);
      }
      if (/\bnew\s+CustomEvent\b/.test(file.source)) {
        violations.push(`${at} direct app registration module constructs CustomEvent.detail`);
      }
      if (canonicalFiles.has(file.path)) canonicalElementCount += 1;
    }
  }

  for (const filePath of canonicalFiles) {
    if (filePath === CANONICAL_ENTRY) continue;
    const source = requiredSource(filePath);
    if (!registrationPattern.test(source)) continue;
    registrationPattern.lastIndex = 0;
    if (!filePath.startsWith(path.join(WEB_ROOT, "elements") + path.sep)) {
      violations.push(
        `${relative(filePath)} canonical entrypoint reaches an element module outside packages/web/src/elements/`,
      );
    }
  }

  return {
    violations,
    viewCount,
    appElementCount,
    canonicalElementCount,
  };
}

describe("UI production module-shape heuristic (^ui-t-module-shape)", () => {
  test("flags violations expressed in the repository's current direct forms", () => {
    const result = currentFormViolations();

    expect(result.viewCount).toBeGreaterThan(0);
    expect(result.appElementCount).toBeGreaterThan(0);
    expect(result.canonicalElementCount).toBeGreaterThan(0);
    expect(result.violations, result.violations.join("\n")).toEqual([]);
  });
});

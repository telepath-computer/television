import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { expectedDocumentStyleRoutes } from "./lib/ui-style-crossings.ts";

const REPO_ROOT = path.resolve(import.meta.dirname, "../..");
const WEB_ENTRY = path.join(REPO_ROOT, "packages/web/src/main.ts");
const WEB_VITE_CONFIG = path.join(REPO_ROOT, "packages/web/vite.config.ts");
const MARKDOWN_ENTRY = path.join(REPO_ROOT, "packages/view-markdown/src/main.ts");
const MARKDOWN_DOCUMENT = path.join(REPO_ROOT, "packages/view-markdown/src/index.html");

interface PackageManifest {
  readonly name?: string;
  readonly exports?: Readonly<Record<string, ExportTarget>>;
}

type ExportTarget = string | ExportConditions;

interface ExportConditions {
  readonly [condition: string]: ExportTarget;
}

interface WorkspacePackage {
  readonly directory: string;
  readonly exports: Readonly<Record<string, ExportTarget>>;
}

interface ImportEdge {
  readonly importer: string;
  readonly specifier: string;
  readonly target: string;
}

interface ImportModule {
  readonly path: string;
  readonly source: string;
  readonly edges: readonly ImportEdge[];
}

interface ImportGraph {
  readonly modules: ReadonlyMap<string, ImportModule>;
  readonly missingEntries: readonly string[];
  readonly unresolvedWorkspaceImports: readonly string[];
}

const EXPECTED_DELIVERY_ROUTES = expectedDocumentStyleRoutes();

function isFile(file: string): boolean {
  try {
    return statSync(file).isFile();
  } catch {
    return false;
  }
}

function relative(file: string): string {
  return path.relative(REPO_ROOT, file).split(path.sep).join("/");
}

function expandWorkspacePattern(pattern: string): string[] {
  let directories = [REPO_ROOT];
  for (const segment of pattern.split("/")) {
    directories = directories.flatMap((directory) => {
      if (segment !== "*") return [path.join(directory, segment)];
      if (!existsSync(directory)) return [];
      return readdirSync(directory, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => path.join(directory, entry.name));
    });
  }
  return directories;
}

function workspacePackages(): ReadonlyMap<string, WorkspacePackage> {
  const rootManifest = JSON.parse(
    readFileSync(path.join(REPO_ROOT, "package.json"), "utf8"),
  ) as { readonly workspaces?: readonly string[] };
  const packages = new Map<string, WorkspacePackage>();

  for (const pattern of rootManifest.workspaces ?? []) {
    for (const directory of expandWorkspacePattern(pattern)) {
      const manifestPath = path.join(directory, "package.json");
      if (!isFile(manifestPath)) continue;
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as PackageManifest;
      if (manifest.name === undefined) continue;
      packages.set(manifest.name, {
        directory,
        exports: manifest.exports ?? {},
      });
    }
  }

  return packages;
}

function importSpecifiers(file: string, source: string): string[] {
  if (file.endsWith(".css")) {
    return [...source.matchAll(/@import\s+(?:url\(\s*)?["']([^"']+)["']/g)]
      .map((match) => match[1]);
  }

  return typeScriptImportSpecifiers(source);
}

// Accepted bound (finding 3): this direct-literal scan is not a complete TypeScript parser.
function typeScriptImportSpecifiers(source: string): string[] {
  const specifiers: string[] = [];
  for (
    const match of source.matchAll(
      /\b(?:import|export)\s+(?!type\b)(?:([^"'`;]*?)\bfrom\s*)?["']([^"']+)["']/g,
    )
  ) {
    if (!isErasedNamedTypeClause(match[1])) specifiers.push(match[2]);
  }
  for (const match of source.matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g)) {
    specifiers.push(match[1]);
  }
  return specifiers;
}

function isErasedNamedTypeClause(clause: string | undefined): boolean {
  const trimmed = clause?.trim();
  if (trimmed === undefined || !trimmed.startsWith("{") || !trimmed.endsWith("}")) {
    return false;
  }
  const members = trimmed.slice(1, -1).split(",").map((member) => member.trim()).filter(Boolean);
  return members.length > 0 && members.every((member) => /^type\b/.test(member));
}

function resolveFile(unresolved: string): string | null {
  const extension = path.extname(unresolved);
  const candidates = extension === ".js"
    ? [unresolved.slice(0, -3) + ".ts", unresolved.slice(0, -3) + ".tsx", unresolved]
    : extension === ""
    ? [
        `${unresolved}.ts`,
        `${unresolved}.tsx`,
        `${unresolved}.js`,
        `${unresolved}.mjs`,
        `${unresolved}.css`,
        path.join(unresolved, "index.ts"),
        path.join(unresolved, "index.tsx"),
        path.join(unresolved, "index.js"),
        path.join(unresolved, "index.css"),
      ]
    : [unresolved];
  return candidates.find(isFile) ?? null;
}

function conditionalExportTarget(target: ExportTarget | undefined): string | null {
  if (typeof target === "string") return target;
  if (target === undefined) return null;
  return conditionalExportTarget(target.import) ?? conditionalExportTarget(target.default);
}

function workspaceSpecifier(
  specifier: string,
  packages: ReadonlyMap<string, WorkspacePackage>,
): { readonly packageName: string; readonly subpath: string } | null {
  for (const packageName of packages.keys()) {
    if (specifier === packageName) return { packageName, subpath: "." };
    if (specifier.startsWith(`${packageName}/`)) {
      return { packageName, subpath: `./${specifier.slice(packageName.length + 1)}` };
    }
  }
  return null;
}

function resolveImport(
  importer: string,
  specifier: string,
  packages: ReadonlyMap<string, WorkspacePackage>,
): { readonly target: string | null; readonly workspace: boolean } {
  const pathSpecifier = specifier.split("?", 1)[0];
  if (pathSpecifier.startsWith(".")) {
    return {
      target: resolveFile(path.resolve(path.dirname(importer), pathSpecifier)),
      workspace: false,
    };
  }

  const workspace = workspaceSpecifier(pathSpecifier, packages);
  if (workspace === null) return { target: null, workspace: false };
  const packageInfo = packages.get(workspace.packageName);
  const exported = conditionalExportTarget(packageInfo?.exports[workspace.subpath]);
  return {
    target: exported === null || packageInfo === undefined
      ? null
      : resolveFile(path.resolve(packageInfo.directory, exported)),
    workspace: true,
  };
}

function importGraph(entries: readonly string[]): ImportGraph {
  const packages = workspacePackages();
  const modules = new Map<string, ImportModule>();
  const missingEntries: string[] = [];
  const unresolvedWorkspaceImports: string[] = [];

  const visit = (file: string): void => {
    if (modules.has(file)) return;
    const source = readFileSync(file, "utf8");
    const edges: ImportEdge[] = [];
    modules.set(file, { path: file, source, edges });
    for (const specifier of importSpecifiers(file, source)) {
      const resolved = resolveImport(file, specifier, packages);
      if (resolved.target === null) {
        if (resolved.workspace) {
          unresolvedWorkspaceImports.push(`${relative(file)} -> ${specifier}`);
        }
        continue;
      }
      edges.push({ importer: file, specifier, target: resolved.target });
      visit(resolved.target);
    }
  };

  for (const entry of entries) {
    if (isFile(entry)) {
      visit(entry);
    } else {
      missingEntries.push(relative(entry));
    }
  }
  return { modules, missingEntries, unresolvedWorkspaceImports };
}

function productionHtmlEntries(): string[] {
  const source = readFileSync(WEB_VITE_CONFIG, "utf8");
  const inputBlock = /\binput:\s*\{([\s\S]*?)\n\s*\},/.exec(source)?.[1];
  if (inputBlock === undefined) throw new Error("packages/web/vite.config.ts has no literal build input block");

  const packageDirectory = path.dirname(WEB_VITE_CONFIG);
  return inputBlock.split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const entry = /^[A-Za-z_$][\w$]*:\s*path\.resolve\(packageDir,\s*["']([^"']+\.html)["']\),?$/.exec(line);
      if (entry === null) {
        throw new Error(`unrecognized production HTML build entry; extend the resolver: ${line}`);
      }
      return path.resolve(packageDirectory, entry[1]);
    });
}

function htmlAttribute(tag: string, name: string): string | null {
  const match = new RegExp(
    `\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`,
    "i",
  ).exec(tag);
  return match?.[1] ?? match?.[2] ?? match?.[3] ?? null;
}

function htmlDeliveryRoutes(entries: readonly string[]): string[] {
  const routes: string[] = [];
  for (const entry of entries) {
    const source = readFileSync(entry, "utf8");
    let styleIndex = 0;
    for (const _match of source.matchAll(/<style\b[^>]*>/gi)) {
      routes.push(`embedded document style: ${relative(entry)}#style[${styleIndex}]`);
      styleIndex += 1;
    }
    for (const match of source.matchAll(/<link\b[^>]*>/gi)) {
      const tag = match[0];
      const rel = htmlAttribute(tag, "rel")?.toLowerCase().split(/\s+/) ?? [];
      if (!rel.includes("stylesheet")) continue;
      routes.push(`document stylesheet link: ${relative(entry)} -> ${htmlAttribute(tag, "href") ?? "<missing href>"}`);
    }
  }
  return routes;
}

function constructedSheetSources(module: ImportModule): ReadonlyMap<string, ImportEdge> {
  const cssTextImports = new Map<string, ImportEdge>();
  for (const match of module.source.matchAll(
    /\bimport\s+([A-Za-z_$][\w$]*)\s+from\s+["']([^"']+\.css\?inline)["']/g,
  )) {
    const edge = module.edges.find((candidate) => candidate.specifier === match[2]);
    if (edge !== undefined) cssTextImports.set(match[1], edge);
  }

  const sheetSources = new Map<string, ImportEdge>();
  for (const match of module.source.matchAll(
    /\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*new CSSStyleSheet\(\)/g,
  )) {
    const sheet = match[1];
    const replacement = new RegExp(
      `\\b${sheet}\\.replaceSync\\(\\s*([A-Za-z_$][\\w$]*)\\s*\\)`,
    ).exec(module.source);
    const source = replacement === null ? undefined : cssTextImports.get(replacement[1]);
    if (source !== undefined) sheetSources.set(sheet, source);
  }
  return sheetSources;
}

function deliveryRoutes(graph: ImportGraph): string[] {
  const routes = new Set<string>(htmlDeliveryRoutes([
    ...productionHtmlEntries(),
    MARKDOWN_DOCUMENT,
  ]));

  for (const module of graph.modules.values()) {
    for (const edge of module.edges) {
      if (
        edge.target.endsWith(".css") &&
        !edge.importer.endsWith(".css") &&
        !edge.specifier.includes("?inline")
      ) {
        routes.add(`document stylesheet: ${relative(edge.importer)} -> ${relative(edge.target)}`);
      }
    }

    if (!module.path.endsWith(".ts")) continue;
    const adoptions = [
      ...module.source.matchAll(/\b(\w+)\.adoptedStyleSheets\s*=\s*\[([\s\S]*?)\]/g),
    ].map((match) => ({ owner: match[1], body: match[2] }));

    for (const match of module.source.matchAll(/const\s+(\w+)\s*=\s*new CSSStyleSheet\(\)/g)) {
      const sheet = match[1];
      if (adoptions.some(({ owner, body }) =>
        owner === "document" && new RegExp(`\\b${sheet}\\b`).test(body)
      )) {
        routes.add(`document adopted sheet: ${relative(module.path)}#${sheet}`);
      }
    }

    for (const [sheet, edge] of constructedSheetSources(module)) {
      if (adoptions.some(({ owner, body }) =>
        owner !== "document" && new RegExp(`\\b${sheet}\\b`).test(body)
      )) {
        routes.add(
          `shadow adopted stylesheet: ${relative(module.path)}#${sheet} -> ${relative(edge.target)}`,
        );
      }
    }

    for (const match of module.source.matchAll(
      /const\s+(\w+)\s*=\s*document\.createElement\(\s*(["'])link\2\s*\)/g,
    )) {
      const link = match[1];
      if (new RegExp(`\\b${link}\\.rel\\s*=\\s*(["'])stylesheet\\1`).test(module.source)) {
        routes.add(`document linked stylesheet: ${relative(module.path)}#${link}`);
      }
    }
  }

  return [...routes].sort();
}

function sourceWithoutComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function unrecognizedStyleMechanisms(graph: ImportGraph): string[] {
  const violations: string[] = [];
  for (const module of graph.modules.values()) {
    if (!module.path.endsWith(".ts")) continue;
    const source = sourceWithoutComments(module.source);
    const constructedSheets = new Set(
      [...source.matchAll(/const\s+(\w+)\s*=\s*new CSSStyleSheet\(\)/g)]
        .map((match) => match[1]),
    );
    const shadowSheets = new Set(constructedSheetSources(module).keys());
    let unmatched = "";
    let cursor = 0;

    for (const match of source.matchAll(/\b(\w+)\.adoptedStyleSheets\s*=\s*\[([\s\S]*?)\]\s*;/g)) {
      unmatched += source.slice(cursor, match.index);
      cursor = match.index + match[0].length;
      const owner = match[1];
      const entries = match[2]
        .replace(/\.\.\.document\.adoptedStyleSheets/g, "")
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean);
      const recognizedOwner = owner === "document" ||
        entries.every((entry) => shadowSheets.has(entry));
      const recognizedEntries = entries.every((entry) => constructedSheets.has(entry));
      if (!recognizedOwner || !recognizedEntries) {
        violations.push(`${relative(module.path)} has an unrecognized adoptedStyleSheets assignment`);
      }
    }
    unmatched += source.slice(cursor);
    unmatched = unmatched.replace(/["']adoptedStyleSheets["']\s+in\s+document/g, "");

    if (/\badoptedStyleSheets\b/.test(unmatched)) {
      violations.push(`${relative(module.path)} has an unrecognized adoptedStyleSheets occurrence`);
    }
    if (/\bdocument\.createElement\s*\(\s*(["'])style\1\s*\)/.test(source)) {
      violations.push(
        `${relative(module.path)} has an unrecognized document.createElement("style") occurrence`,
      );
    }
  }
  return violations;
}

describe("production document style delivery (^ui-t-style-delivery)", () => {
  test("excludes erased named type-only imports from graph edges", () => {
    expect(typeScriptImportSpecifiers(`
      import { type First } from "./first.ts";
      export { type Second, type Third as Alias } from "./types.ts";
      import { type Fourth, runtimeValue } from "./mixed.ts";
      import "./side-effect.ts";
    `)).toEqual(["./mixed.ts", "./side-effect.ts"]);
  });

  test("reachable stylesheet and style-adoption routes match the explicit expected routes", () => {
    const appEntry = readFileSync(path.join(REPO_ROOT, "packages/web/src/index.html"), "utf8");
    expect(appEntry).toContain('<html lang="en" data-television-document="app">');

    const graph = importGraph([WEB_ENTRY, MARKDOWN_ENTRY]);
    expect.soft(
      graph.missingEntries,
      `missing production style-delivery graph entries:\n${graph.missingEntries.map((entry) => `- ${entry}`).join("\n")}`,
    ).toEqual([]);
    expect.soft(graph.unresolvedWorkspaceImports).toEqual([]);
    expect(
      [...graph.modules.keys()].map(relative).filter((file) => /clouds(?:-alt)?|wallpapers\/clouds/.test(file)),
    ).toEqual([]);

    const mechanismViolations = unrecognizedStyleMechanisms(graph);
    expect.soft(
      mechanismViolations,
      `${mechanismViolations.join("\n")}\nExtend the delivery route and style-mechanism recognizers.`,
    ).toEqual([]);

    const routes = deliveryRoutes(graph);
    const expectedRoutes = [...EXPECTED_DELIVERY_ROUTES].sort();
    const missingRoutes = expectedRoutes.filter((route) => !routes.includes(route));
    const unexpectedRoutes = routes.filter((route) => !expectedRoutes.includes(route));
    expect.soft(
      { missingRoutes, unexpectedRoutes },
      [
        "document style delivery differs from the specified route set:",
        "missing:",
        ...missingRoutes.map((route) => `- ${route}`),
        "unexpected:",
        ...unexpectedRoutes.map((route) => `- ${route}`),
      ].join("\n"),
    ).toEqual({ missingRoutes: [], unexpectedRoutes: [] });
  });

  // proofs/arch/ui/index.md#^ui-t-theme-resources
  test("keeps the executable theme resource application-only with one owner", () => {
    const appGraph = importGraph([WEB_ENTRY]);
    expect(appGraph.missingEntries).toEqual([]);
    expect(appGraph.unresolvedWorkspaceImports).toEqual([]);

    const ownerPath = "packages/web/src/theme.ts";
    for (const route of [
      "/theme/main.js",
      "/theme/iframe-background.js",
      "/theme/iframe-overlay.js",
    ]) {
      const routeOwners = [...appGraph.modules.values()]
        .filter((module) => module.source.includes(`"${route}"`))
        .map((module) => relative(module.path));
      expect(routeOwners, route).toEqual([ownerPath]);
    }

    const owner = appGraph.modules.get(path.join(REPO_ROOT, ownerPath));
    expect(owner?.source.match(/document\.createElement\(\s*["']link["']\s*\)/g))
      .toHaveLength(1);
    expect(owner?.source.match(/document\.createElement\(\s*["']script["']\s*\)/g))
      .toHaveLength(1);
    expect(owner?.source.match(/document\.createElement\(\s*["']iframe["']\s*\)/g))
      .toHaveLength(1);
    expect(owner?.source).toContain('new URL("/theme/theme.css", serverURL)');
    expect(owner?.source).toContain('new URL("/theme/main.js", serverURL)');
    expect(owner?.source).toContain('new URL("/theme/iframe-background.js", serverURL)');
    expect(owner?.source).toContain('new URL("/theme/iframe-overlay.js", serverURL)');
    for (const eventType of [
      "pointermove",
      "pointerdown",
      "pointerup",
      "pointercancel",
      "click",
    ]) {
      expect(owner?.source).toContain(`document.addEventListener("${eventType}"`);
    }
    expect(owner?.source).toContain("postMessage(message, \"*\")");
    expect(owner?.source).toContain('document.addEventListener("focusin"');
    expect(owner?.source).toContain("focus({ preventScroll: true })");

    const foregroundMarkupOwners = [...appGraph.modules.values()]
      .filter((module) => /id=["']foreground-overlay["']/.test(module.source))
      .map((module) => relative(module.path));
    expect(foregroundMarkupOwners).toEqual(["packages/web/src/views/television-app.ts"]);

    const webAppEntry = path.join(REPO_ROOT, "packages/web/src/index.html");
    const builtInErrorEntries = productionHtmlEntries()
      .filter((entry) => entry !== webAppEntry);
    const standaloneModuleEntries = [
      ...builtInErrorEntries.map((entry) => path.join(path.dirname(entry), "main.ts")),
      path.join(REPO_ROOT, "packages/view-markdown/src/main.ts"),
    ];
    const standaloneGraph = importGraph(standaloneModuleEntries);
    expect(standaloneGraph.missingEntries).toEqual([]);
    expect(standaloneGraph.unresolvedWorkspaceImports).toEqual([]);
    expect([...standaloneGraph.modules.keys()].map(relative))
      .not.toContain("packages/web/src/theme.ts");

    const standaloneSources = new Map<string, string>([
      ...[...standaloneGraph.modules.values()].map((module) => [
        relative(module.path),
        module.source,
      ] as const),
      ...[
        ...builtInErrorEntries,
        path.join(REPO_ROOT, "packages/view-markdown/src/index.html"),
        path.join(REPO_ROOT, "packages/server/src/canonical.ts"),
        path.join(REPO_ROOT, "packages/server/src/artifact-proxy.ts"),
      ].map((file) => [relative(file), readFileSync(file, "utf8")] as const),
    ]);
    for (const applicationOnlyToken of [
      "/theme/main.js",
      "/theme/iframe-background.js",
      "/theme/iframe-overlay.js",
      "theme-iframe-background",
      "theme-iframe-overlay",
      "foreground-overlay",
    ]) {
      expect(
        [...standaloneSources]
          .filter(([, source]) => source.includes(applicationOnlyToken))
          .map(([file]) => file),
        applicationOnlyToken,
      ).toEqual([]);
    }
  });
});

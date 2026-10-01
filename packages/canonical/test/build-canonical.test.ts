/**
 * Integration tests for the versioned canonical production crossing.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { runInNewContext } from "node:vm";
import postcss, { type ChildNode, type Rule } from "postcss";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
// @ts-expect-error — repository build scripts have no declaration files
import { buildCanonicalVersions } from "../scripts/build-canonical.mjs";
// @ts-expect-error — repository build scripts have no declaration files
import { contentAddressedName as productionContentAddressedName } from "../scripts/content-addressed-name.mjs";
// @ts-expect-error — repository build scripts have no declaration files
import { extractIconPlaceholders } from "../scripts/icon-placeholders.mjs";
// @ts-expect-error — repository build scripts have no declaration files
import { listCanonicalVersions } from "../scripts/canonical-versions.mjs";

const PACKAGE_ROOT = path.resolve(import.meta.dirname, "..");
const REPO_ROOT = path.resolve(PACKAGE_ROOT, "../..");
const PRODUCTION_SOURCE_ROOT = path.join(PACKAGE_ROOT, "styles", "canonical");
const IMPORT_RE = /^\s*@import\s+["']([^"']+)["']\s*;\s*$/gm;
const URL_RE = /url\(\s*(["']?)([^"')\s]+)\1\s*\)/g;
const PUBLIC_TAGS = ["checkbox-item", "checkbox-list", "tv-icon", "tv-menu", "tv-menu-item", "tv-option", "tv-popover", "tv-select"];
const ICON_PLACEHOLDER_SELECTOR = /^tv-icon:not\(:defined\)(?:\[size="[^"]+"\])?$/;

type Version = "v1" | "v2";
type LiveVersion = "v2";
type PublicOwner = "canonical-v1" | "canonical-v2";

interface ElementSurface {
  attributes: string[];
  attributeValues: Record<string, string[]>;
  customProperties: string[];
}

interface CompatibilityFixture {
  schemaVersion: number;
  resources: Record<PublicOwner, string[]>;
  tokens: Record<PublicOwner, string[]>;
  elements: Record<PublicOwner, Record<string, ElementSurface>>;
  iconNames: Record<PublicOwner, Record<string, string[]>>;
}

interface VersionAuthority {
  index: string;
  iconStyles: string;
  iconManifest: string;
  elementSpecsRoot: string;
  leaves: Array<{ production: string; authority: string }>;
  font: string;
}

const FROZEN_ROOT = path.join(PACKAGE_ROOT, "frozen");
const FROZEN_V1_ROOT = path.join(FROZEN_ROOT, "v1");
const LIVE_UI_ROOT = path.join(REPO_ROOT, "specs", "ui");
const TOKEN_COUNTS: Record<Version, number> = { v1: 174, v2: 288 };

function leaf(production: string, authority: string): { production: string; authority: string } {
  return { production, authority };
}

function publicOwner(version: Version): PublicOwner {
  return `canonical-${version}`;
}

const VERSION_AUTHORITIES: Record<LiveVersion, VersionAuthority> = {
  v2: {
    index: path.join(LIVE_UI_ROOT, "foundation", "index.css"),
    iconStyles: path.join(LIVE_UI_ROOT, "foundation", "icons", "styles.css"),
    iconManifest: path.join(LIVE_UI_ROOT, "foundation", "icons", "icons.yml"),
    elementSpecsRoot: path.join(LIVE_UI_ROOT, "foundation"),
    leaves: [
      leaf("foundation/reset.css", "foundation/reset.css"),
      leaf("foundation/tokens/fonts.css", "foundation/tokens/fonts.css"),
      leaf("foundation/colors.css", "foundation/tokens/colors.css"),
      leaf("foundation/text.css", "foundation/tokens/text.css"),
      leaf("foundation/spacing.css", "foundation/tokens/spacing.css"),
      leaf("foundation/shadows.css", "foundation/tokens/shadows.css"),
      leaf("foundation/prose.css", "foundation/prose.css"),
      leaf("foundation/layers.css", "foundation/tokens/layers.css"),
      leaf("elements/input/styles.css", "foundation/input/styles.css"),
      leaf("elements/popover/styles.css", "foundation/popover/styles.css"),
      leaf("elements/menu/styles.css", "foundation/menu/styles.css"),
      leaf("elements/select/styles.css", "foundation/select/styles.css"),
      leaf("foundation/fonts/Hind-Variable.woff2", "foundation/fonts/Hind-Variable.woff2"),
      leaf("elements/button/styles.css", "foundation/button/button.css"),
      leaf("elements/icons/styles.css", "foundation/icons/styles.css"),
      leaf("elements/checkbox-list/styles.css", "foundation/checkbox-list/styles.css"),
    ].map(({ production, authority }) => ({
      production,
      authority: path.join(LIVE_UI_ROOT, authority),
    })),
    font: path.join(LIVE_UI_ROOT, "foundation", "fonts", "Hind-Variable.woff2"),
  },
};

let work: string;

beforeEach(async () => {
  work = await mkdtemp(path.join(tmpdir(), "canonical-build-"));
});

afterEach(async () => {
  await rm(work, { recursive: true, force: true });
});

function regexEscape(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function expectUniqueNames(names: string[]): void {
  expect(new Set(names).size).toBe(names.length);
}

function expectRecordedNamesIncluded(recordedNames: string[], currentNames: Set<string>): void {
  expectUniqueNames(recordedNames);
  for (const name of recordedNames) {
    expect(currentNames.has(name), name).toBe(true);
  }
}

function contentAddressedName(filename: string, bytes: Buffer): string {
  const extension = path.extname(filename);
  const stem = extension ? filename.slice(0, -extension.length) : filename;
  const digest = createHash("sha256").update(bytes).digest("hex").slice(0, 8);
  return `${stem}.${digest}${extension}`;
}

function isExactIconPlaceholderRule(rule: Rule): boolean {
  return rule.selectors.length > 0 && rule.selectors.every(
    (selector) => ICON_PLACEHOLDER_SELECTOR.test(selector.trim()),
  );
}

function exactIconPlaceholderRules(css: string): Rule[] {
  return postcss.parse(css).nodes.filter(
    (node): node is Rule => node.type === "rule" && isExactIconPlaceholderRule(node),
  );
}

function semanticNode(node: ChildNode): unknown {
  switch (node.type) {
    case "comment":
      return undefined;
    case "decl":
      return {
        type: node.type,
        prop: node.prop,
        value: node.value,
        important: node.important,
      };
    case "rule":
      return {
        type: node.type,
        selector: node.selector,
        nodes: node.nodes.map(semanticNode).filter((child) => child !== undefined),
      };
    case "atrule":
      return {
        type: node.type,
        name: node.name,
        params: node.params,
        nodes: node.nodes?.map(semanticNode).filter((child) => child !== undefined),
      };
    default:
      throw new Error(`unexpected PostCSS node type: ${(node as { type: string }).type}`);
  }
}

function semanticCSS(css: string): unknown[] {
  return postcss.parse(css).nodes
    .map(semanticNode)
    .filter((node) => node !== undefined);
}

async function resolveAuthoritativeCSS(
  entryPath: string,
  iconStylesPath: string,
  urlPrefix: string,
  seen = new Set<string>(),
): Promise<string> {
  const absolute = path.resolve(entryPath);
  if (seen.has(absolute)) return "";
  seen.add(absolute);

  const sourceDir = path.dirname(absolute);
  const source = absolute === path.resolve(iconStylesPath)
    ? extractIconPlaceholders(await readFile(absolute, "utf8"))
    : await readFile(absolute, "utf8");
  const rewritten = source.replace(URL_RE, (whole: string, _quote: string, url: string) => {
    if (/^(data:|https?:|\/)/.test(url)) return whole;
    const referenced = path.resolve(sourceDir, url);
    const name = contentAddressedName(path.basename(referenced), requireBytes(referenced));
    return `url(${urlPrefix}/fonts/${name})`;
  });

  const parts: string[] = [];
  let lastEnd = 0;
  const imports = new RegExp(IMPORT_RE.source, IMPORT_RE.flags);
  let match: RegExpExecArray | null;
  while ((match = imports.exec(rewritten)) !== null) {
    parts.push(rewritten.slice(lastEnd, match.index));
    parts.push(await resolveAuthoritativeCSS(
      path.resolve(sourceDir, match[1]!),
      iconStylesPath,
      urlPrefix,
      seen,
    ));
    lastEnd = match.index + match[0].length;
  }
  parts.push(rewritten.slice(lastEnd));
  return parts.join("");
}

function requireBytes(filename: string): Buffer {
  // This helper stays synchronous so it can be used from String.replace.
  return readFileSync(filename);
}

async function readCompatibilityFixture(): Promise<CompatibilityFixture> {
  return JSON.parse(
    await readFile(path.join(import.meta.dirname, "fixtures", "canonical-public-api.json"), "utf8"),
  ) as CompatibilityFixture;
}

async function listFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const absolute = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...await listFiles(absolute));
    else if (entry.isFile()) files.push(absolute);
  }
  return files;
}

function bundledIconCSS(components: string): string {
  const expression = /var icon_default=([\s\S]*?);var iconSheet=/.exec(components)?.[1];
  expect(expression, "bundled icon stylesheet expression").toBeDefined();
  return runInNewContext(expression!);
}

function frozenElementSurface(styles: string, components: string): {
  attributes: Set<string>;
  attributeValues: Map<string, Set<string>>;
  customProperties: Set<string>;
} {
  const css = `${styles}\n${bundledIconCSS(components)}`;
  const attributes = new Set<string>();
  const attributeValues = new Map<string, Set<string>>();
  postcss.parse(css).walkRules((rule) => {
    for (const match of rule.selector.matchAll(
      /\[\s*([a-z][a-z0-9-]*)(?:\s*=\s*["']([^"']+)["'])?\s*\]/g,
    )) {
      const attribute = match[1]!;
      attributes.add(attribute);
      if (match[2] !== undefined) {
        const values = attributeValues.get(attribute) ?? new Set<string>();
        values.add(match[2]);
        attributeValues.set(attribute, values);
      }
    }
  });
  for (const match of components.matchAll(
    /(?:getAttribute|hasAttribute)\("([a-z][a-z0-9-]*)"\)/g,
  )) attributes.add(match[1]!);
  for (const observed of components.matchAll(/observedAttributes=\[([^\]]*)\]/g)) {
    for (const match of observed[1]!.matchAll(/"([a-z][a-z0-9-]*)"/g)) {
      attributes.add(match[1]!);
    }
  }
  return {
    attributes,
    attributeValues,
    customProperties: new Set(
      [...css.matchAll(/--[a-z][a-z0-9-]*/g)].map((match) => match[0]),
    ),
  };
}

function frozenIconNames(components: string): Set<string> {
  const body = /var ICONS=\{([\s\S]*?)\};function isIconName/.exec(components)?.[1];
  expect(body, "bundled icon-name table").toBeDefined();
  return new Set(
    [...body!.matchAll(/"([a-z][a-z0-9-]*)":/g)].map((match) => match[1]!),
  );
}

async function setupFixture(version = "v7"): Promise<{
  sourceRoot: string;
  componentsSource: string;
  outDir: string;
  fontBytes: Buffer;
  version: string;
}> {
  const sourceRoot = path.join(work, "sources");
  const versionRoot = path.join(sourceRoot, version);
  const stylesDir = path.join(versionRoot, "foundation");
  const fontsDir = path.join(stylesDir, "fonts");
  const outDir = path.join(work, "dist", "canonical");
  const componentsSource = path.join(work, "canonical-components.ts");
  await mkdir(fontsDir, { recursive: true });

  await writeFile(
    path.join(versionRoot, "index.css"),
    `@import "./foundation/reset.css";\n@import "./foundation/fonts.css";\n@import "./foundation/tokens.css";\n`,
  );
  await writeFile(path.join(stylesDir, "reset.css"), `* { box-sizing: border-box; }\n`);
  await writeFile(
    path.join(stylesDir, "fonts.css"),
    `@font-face {\n  font-family: "TestFont";\n  src: url("fonts/test-font.woff2") format("woff2-variations");\n}\n`,
  );
  await writeFile(path.join(stylesDir, "tokens.css"), `:root { --space-4: 4px; }\n`);
  await writeFile(
    componentsSource,
    `customElements.define("fixture-component", class extends HTMLElement {});\n`,
  );

  const fontBytes = Buffer.from("woff2-binary-fixture");
  await writeFile(path.join(fontsDir, "test-font.woff2"), fontBytes);
  return { sourceRoot, componentsSource, outDir, fontBytes, version };
}

describe("canonical build helpers", () => {
  it("orders every buildable canonical version numerically", async () => {
    const sourceRoot = path.join(work, "version-sources");
    await mkdir(sourceRoot, { recursive: true });
    for (const version of ["v1", "v1.9", "v2", "v2.10", "v3"]) {
      const versionRoot = path.join(sourceRoot, version);
      await mkdir(versionRoot);
      await writeFile(path.join(versionRoot, "index.css"), "/* fixture */\n");
    }
    await mkdir(path.join(sourceRoot, "v4"));
    await mkdir(path.join(sourceRoot, "v3-next"));
    await writeFile(path.join(sourceRoot, "v9"), "not a directory\n");

    expect(await listCanonicalVersions(sourceRoot)).toEqual([
      "v1",
      "v1.9",
      "v2",
      "v2.10",
      "v3",
    ]);
  });

  it("does not lift nested icon placeholders out of their at-rule context", () => {
    const css = [
      "tv-icon:not(:defined) { display: inline-flex; }",
      "@media (min-width: 20rem) {",
      "  tv-icon:not(:defined) { width: 2em; }",
      "}",
      "",
    ].join("\n");
    expect(extractIconPlaceholders(css)).toBe(
      "tv-icon:not(:defined) { display: inline-flex; }\n",
    );
  });

  it("extracts only exact icon placeholder selectors from top-level rules", () => {
    const css = [
      'tv-icon:not(:defined), tv-icon:not(:defined)[size="sm"] { opacity: 1; }',
      "tv-icon:not(:defined), figure { opacity: 0.8; }",
      ':host([size="lg"]), tv-icon:not(:defined)[size="lg"] { font-size: 24px; color: inherit !important; }',
      "tv-icon:not(:defined):hover { opacity: 0.6; }",
      "main tv-icon:not(:defined) { opacity: 0.4; }",
      "",
    ].join("\n");
    expect(extractIconPlaceholders(css)).toBe(
      'tv-icon:not(:defined), tv-icon:not(:defined)[size="sm"] { opacity: 1; }\n\n' +
      'tv-icon:not(:defined) { opacity: 0.8; }\n\n' +
      'tv-icon:not(:defined)[size="lg"] { font-size: 24px; color: inherit !important; }\n',
    );
  });

  it("preserves the stem of an extension-less content-addressed name", () => {
    expect(productionContentAddressedName("Hind", Buffer.from("font"))).toMatch(
      /^Hind\.[0-9a-f]{8}$/,
    );
  });
});

describe("buildCanonicalVersions", () => {
  it("discovers a production version and inlines every import", async () => {
    const { sourceRoot, componentsSource, outDir, version } = await setupFixture();
    const builds = await buildCanonicalVersions({ sourceRoot, componentsSource, outDir });
    const out = await readFile(builds[version].stylesheetPath, "utf8");

    expect(Object.keys(builds)).toEqual([version]);
    expect(out).not.toMatch(/@import/);
    expect(out).toContain("box-sizing: border-box");
    expect(out).toContain('font-family: "TestFont"');
    expect(out).toContain("--space-4: 4px");
  });

  it("supports point versions and rewrites their font URL prefix", async () => {
    const { sourceRoot, componentsSource, outDir, fontBytes, version } =
      await setupFixture("v1.1");
    const builds = await buildCanonicalVersions({ sourceRoot, componentsSource, outDir });
    const fontName = contentAddressedName("test-font.woff2", fontBytes);
    const out = await readFile(builds[version].stylesheetPath, "utf8");

    expect(out).toContain(`url(/canonical/${version}/fonts/${fontName})`);
    expect(await readFile(path.join(outDir, version, "fonts", fontName))).toEqual(fontBytes);
  });

  it("copies every frozen canonical version byte-for-byte into fresh production output", async () => {
    const outDir = path.join(work, "dist", "canonical");
    const builds = await buildCanonicalVersions({ outDir });
    expect(Object.keys(builds)).toEqual(["v1", "v2"]);

    const frozenFiles = (await listFiles(FROZEN_V1_ROOT))
      .map((filename) => path.relative(FROZEN_V1_ROOT, filename))
      .sort();
    const builtV1Root = path.join(outDir, "v1");
    expect((await listFiles(builtV1Root)).map((filename) =>
      path.relative(builtV1Root, filename)).sort()).toEqual(frozenFiles);
    for (const relative of frozenFiles) {
      expect(await readFile(path.join(builtV1Root, relative)), relative).toEqual(
        await readFile(path.join(FROZEN_V1_ROOT, relative)),
      );
    }
    const provenance = JSON.parse(
      await readFile(path.join(builtV1Root, "frozen.json"), "utf8"),
    ) as Record<string, unknown>;
    expect(Object.keys(provenance).sort()).toEqual([
      "esbuildVersion",
      "nodeVersion",
      "npmVersion",
      "sourceCommit",
    ]);
    expect(provenance.sourceCommit).toMatch(/^[0-9a-f]{40}$/);
    expect(provenance.nodeVersion).toMatch(/^v\d+\.\d+\.\d+$/);
    expect(provenance.npmVersion).toMatch(/^\d+\.\d+\.\d+$/);
    expect(provenance.esbuildVersion).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("builds live canonical v2 from its authoritative sources into fresh production output", async () => {
    const outDir = path.join(work, "dist", "canonical");
    const builds = await buildCanonicalVersions({ outDir });
    expect(Object.keys(builds)).toEqual(["v1", "v2"]);

    const rootEntries = (await readdir(PRODUCTION_SOURCE_ROOT, { withFileTypes: true }))
      .map((entry) => entry.name)
      .sort();
    expect(rootEntries).toEqual(["fonts", "v2"]);

    const version = "v2";
    const authority = VERSION_AUTHORITIES[version];
    const productionRoot = path.join(PRODUCTION_SOURCE_ROOT, version);
    const productionFiles = (await listFiles(productionRoot))
      .map((filename) => path.relative(productionRoot, filename))
      .sort();
    expect(productionFiles).toEqual([
      "index.css",
      ...authority.leaves.map((crossing) => crossing.production),
    ].sort());
    for (const crossing of authority.leaves) {
      expect(
        await readFile(path.join(productionRoot, crossing.production)),
        `${version}/${crossing.production}`,
      ).toEqual(await readFile(crossing.authority));
    }

    const productionAggregate = await readFile(path.join(productionRoot, "index.css"), "utf8");
    expect(productionAggregate).not.toContain("specs/");
    const expectedCSS = await resolveAuthoritativeCSS(
      authority.index,
      authority.iconStyles,
      `/canonical/${version}`,
    );
    const builtCSS = await readFile(builds[version].stylesheetPath, "utf8");
    expect(semanticCSS(builtCSS)).toEqual(semanticCSS(
      expectedCSS + extractIconPlaceholders(await readFile(authority.iconStyles, "utf8")),
    ));

    const fontBytes = await readFile(authority.font);
    const fontName = contentAddressedName("Hind-Variable.woff2", fontBytes);
    expect(await readdir(path.join(outDir, version, "fonts"))).toEqual([fontName]);
    expect(await readFile(path.join(outDir, version, "fonts", fontName))).toEqual(fontBytes);
    expect(builtCSS).toContain(`/canonical/${version}/fonts/${fontName}`);

    const components = await readFile(builds[version].componentsPath, "utf8");
    const definedTags = [
      ...components.matchAll(/customElements\.define\("([a-z][a-z0-9-]+)"/g),
    ].map((match) => match[1]).sort();
    expect(definedTags).toEqual(PUBLIC_TAGS);
    expect(bundledIconCSS(components)).toBe(await readFile(authority.iconStyles, "utf8"));
    expect(builtCSS).not.toContain("tv-icon-spin");
    expect(components).not.toMatch(/^\s*import\s/m);

    const productionInputs = [
      ...await listFiles(path.join(PRODUCTION_SOURCE_ROOT, "v2")),
      path.join(PACKAGE_ROOT, "canonical-components.ts"),
      path.join(REPO_ROOT, "packages", "web", "src", "elements", "checkbox-list.ts"),
      path.join(REPO_ROOT, "packages", "web", "src", "elements", "checkbox-list.css"),
      path.join(REPO_ROOT, "packages", "web", "src", "elements", "icon.ts"),
      path.join(REPO_ROOT, "packages", "web", "src", "elements", "icon.css"),
      ...["panel-controller.ts", "popover.ts", "popover.css", "menu.ts", "menu.css", "select.ts", "select.css"]
        .map(filename => path.join(REPO_ROOT, "packages/web/src/elements", filename)),
    ];
    for (const input of productionInputs) {
      if (path.extname(input) === ".woff2") continue;
      expect(await readFile(input, "utf8"), input).not.toMatch(/(?:^|["'(/])specs\//m);
    }
  });

  it("rejects a version present in both live and frozen roots", async () => {
    const { sourceRoot, componentsSource, outDir, version } = await setupFixture();
    const frozenRoot = path.join(work, "frozen");
    const frozenVersion = path.join(frozenRoot, version);
    await mkdir(frozenVersion, { recursive: true });
    await writeFile(path.join(frozenVersion, "frozen.json"), "{}\n");
    await writeFile(path.join(frozenVersion, "styles.css"), "/* frozen */\n");
    await writeFile(path.join(frozenVersion, "components.js"), "/* frozen */\n");

    await expect(buildCanonicalVersions({
      sourceRoot,
      frozenRoot,
      componentsSource,
      outDir,
    })).rejects.toThrow(new RegExp(`${version}.*live.*frozen|${version}.*frozen.*live`, "i"));
  });

  it("extracts exactly the authoritative pre-upgrade icon rules into canonical document scope (^ic-t-pre-upgrade-style-seam)", async () => {
    const builds = await buildCanonicalVersions({ outDir: path.join(work, "dist", "canonical") });
    const version = "v2";
    const iconCSS = await readFile(VERSION_AUTHORITIES[version].iconStyles, "utf8");
    const builtCSS = await readFile(builds[version].stylesheetPath, "utf8");
    const expectedSelectors = [
      "tv-icon:not(:defined)",
      'tv-icon:not(:defined)[size="sm"]',
      'tv-icon:not(:defined)[size="md"]',
      'tv-icon:not(:defined)[size="lg"]',
      'tv-icon:not(:defined)[size="xl"]',
    ];
    const sourceRules = postcss.parse(iconCSS).nodes.filter(
      (node): node is Rule => node.type === "rule",
    );
    const placeholders = expectedSelectors.map((selector) => {
      const rule = sourceRules.find((candidate) => candidate.selectors.includes(selector));
      expect(rule, `authoritative rule for ${selector}`).toBeDefined();
      return rule!.clone({ selector });
    });
    expect(exactIconPlaceholderRules(builtCSS).map((rule) => rule.selector)).toEqual(expectedSelectors);
    expect(exactIconPlaceholderRules(builtCSS).map((rule) => rule.toString())).toEqual(
      placeholders.map((rule) => rule.toString()),
    );
    for (const rule of postcss.parse(iconCSS).nodes.filter(
      (node): node is Rule => node.type === "rule" && !isExactIconPlaceholderRule(node),
    )) {
      expect(builtCSS).not.toContain(rule.toString());
    }
  });

  it("keeps every recorded canonical public name per version and rejects a recorded removal", async () => {
    const fixture = await readCompatibilityFixture();
    const builds = await buildCanonicalVersions({ outDir: path.join(work, "dist", "canonical") });
    expect(fixture.schemaVersion).toBe(2);
    for (const section of [fixture.resources, fixture.tokens, fixture.elements, fixture.iconNames]) {
      expect(Object.keys(section)).toEqual(["canonical-v1", "canonical-v2"]);
    }

    for (const version of ["v1", "v2"] as const) {
      const owner = publicOwner(version);
      const resources = fixture.resources[owner];
      expect(resources).toHaveLength(2);
      for (const resource of resources) {
        expect(resource).toMatch(new RegExp(`^/canonical/${regexEscape(version)}/[a-z0-9./-]+$`));
        expect(existsSync(path.join(
          path.dirname(builds[version].stylesheetPath),
          resource.replace(`/canonical/${version}/`, ""),
        )), resource).toBe(true);
      }

      const builtStyles = await readFile(builds[version].stylesheetPath, "utf8");
      const currentTokens = new Set<string>();
      postcss.parse(builtStyles).walkDecls(declaration => {
        if (declaration.prop.startsWith("--")) currentTokens.add(declaration.prop);
      });
      const recordedTokens = fixture.tokens[owner];
      expect(recordedTokens).toHaveLength(TOKEN_COUNTS[version]);
      expectRecordedNamesIncluded(recordedTokens, currentTokens);

      const builtComponents = await readFile(builds[version].componentsPath, "utf8");
      const currentTags = new Set(
        [...builtComponents.matchAll(/customElements\.define\("([a-z][a-z0-9-]+)"/g)]
          .map((match) => match[1]!),
      );
      const elementSurfaces = fixture.elements[owner];
      expectRecordedNamesIncluded(Object.keys(elementSurfaces), currentTags);
      expect(Object.keys(elementSurfaces)).toEqual(version === "v1" ? ["checkbox-item", "checkbox-list", "tv-icon"] : PUBLIC_TAGS);

      const frozenSurface = version === "v1"
        ? frozenElementSurface(builtStyles, builtComponents)
        : undefined;
      for (const [tag, surface] of Object.entries(elementSurfaces)) {
        expectUniqueNames(surface.attributes);
        expectUniqueNames(surface.customProperties);
        if (version === "v1") {
          for (const attribute of surface.attributes) {
            expect(frozenSurface!.attributes.has(attribute), `${tag} attribute ${attribute}`).toBe(true);
          }
          for (const [attribute, values] of Object.entries(surface.attributeValues)) {
            expect(surface.attributes).toContain(attribute);
            expectUniqueNames(values);
            for (const value of values) {
              expect(
                frozenSurface!.attributeValues.get(attribute)?.has(value),
                `${tag} attribute value ${attribute}=${value}`,
              ).toBe(true);
            }
          }
          for (const customProperty of surface.customProperties) {
            expect(
              frozenSurface!.customProperties.has(customProperty),
              `${tag} custom property ${customProperty}`,
            ).toBe(true);
          }
          continue;
        }

        const directory = tag === "tv-icon" ? "icons"
          : tag.startsWith("checkbox-") ? "checkbox-list"
          : tag === "tv-menu-item" ? "menu"
          : tag === "tv-option" ? "select"
          : tag.slice(3);
        const filenames = ["index.md", "styles.css"];
        if (directory === "icons") filenames.push("icon.frame");
        if (directory === "checkbox-list") filenames.push("template.liquid");
        const ownerSource = (await Promise.all(filenames.map(filename => readFile(
          path.join(VERSION_AUTHORITIES[version].elementSpecsRoot, directory, filename), "utf8",
        )))).join("\n");
        for (const attribute of surface.attributes) {
          expect(ownerSource).toMatch(new RegExp(
            `(?:[\x60"']${regexEscape(attribute)}[\x60"']|\\[${regexEscape(attribute)}(?:[\\]=]))`,
          ));
        }
        for (const [attribute, values] of Object.entries(surface.attributeValues)) {
          expect(surface.attributes).toContain(attribute);
          expectUniqueNames(values);
          for (const value of values) {
            expect(ownerSource).toMatch(new RegExp(
              `(?:[\x60"']${regexEscape(value)}[\x60"']|\\[${regexEscape(attribute)}=["']${regexEscape(value)}["']\\])`,
            ));
          }
        }
        for (const customProperty of surface.customProperties) {
          expect(ownerSource).toContain(customProperty);
        }
      }

      const currentIconNames = version === "v1"
        ? frozenIconNames(builtComponents)
        : new Set(
          [...(await readFile(VERSION_AUTHORITIES[version].iconManifest, "utf8"))
            .matchAll(/^([a-z][a-z0-9-]*):/gm)].map((match) => match[1]!),
        );
      const recordedIconNames = fixture.iconNames[owner]["tv-icon"];
      expect(recordedIconNames).toHaveLength(version === "v1" ? 77 : 101);
      expectRecordedNamesIncluded(recordedIconNames, currentIconNames);
      for (const iconName of recordedIconNames) {
        expect(builtComponents).toContain(`"${iconName}"`);
      }

      const afterRemoval = new Set(currentTokens);
      afterRemoval.delete(recordedTokens[0]);
      expect(() => expectRecordedNamesIncluded(recordedTokens, afterRemoval)).toThrow();
    }
  });

  it("copies only content-addressed font binaries into each version fonts directory", async () => {
    const { sourceRoot, componentsSource, outDir, fontBytes, version } = await setupFixture();
    const fontsDir = path.join(outDir, version, "fonts");
    await mkdir(fontsDir, { recursive: true });
    await writeFile(path.join(fontsDir, "legacy-font.woff2"), "stale");
    await buildCanonicalVersions({ sourceRoot, componentsSource, outDir });

    const fontName = contentAddressedName("test-font.woff2", fontBytes);
    expect(await readdir(fontsDir)).toEqual([fontName]);
    expect(await readFile(path.join(fontsDir, fontName))).toEqual(fontBytes);
  });

  it("changes the published font name when the font bytes change", async () => {
    const { sourceRoot, componentsSource, outDir, fontBytes, version } = await setupFixture();
    const fontPath = path.join(sourceRoot, version, "foundation", "fonts", "test-font.woff2");
    await buildCanonicalVersions({ sourceRoot, componentsSource, outDir });
    const firstName = contentAddressedName("test-font.woff2", fontBytes);

    const changedBytes = Buffer.from("changed-woff2-binary-fixture");
    await writeFile(fontPath, changedBytes);
    const builds = await buildCanonicalVersions({ sourceRoot, componentsSource, outDir });
    const changedName = contentAddressedName("test-font.woff2", changedBytes);
    const builtStyles = await readFile(builds[version].stylesheetPath, "utf8");

    expect(changedName).not.toBe(firstName);
    expect(await readdir(path.join(outDir, version, "fonts"))).toEqual([changedName]);
    expect(builtStyles).toContain(`/canonical/${version}/fonts/${changedName}`);
    expect(builtStyles).not.toContain(`/canonical/${version}/fonts/${firstName}`);
  });

  it("bundles one shared canonical component entry for every version", async () => {
    const { sourceRoot, componentsSource, outDir, version } = await setupFixture();
    const builds = await buildCanonicalVersions({ sourceRoot, componentsSource, outDir });
    const out = await readFile(builds[version].componentsPath, "utf8");
    expect(out).toContain("fixture-component");
    expect(out).not.toMatch(/^\s*import\s/m);
  });

  it("is idempotent", async () => {
    const { sourceRoot, componentsSource, outDir, version } = await setupFixture();
    const firstBuild = await buildCanonicalVersions({ sourceRoot, componentsSource, outDir });
    const first = await readFile(firstBuild[version].stylesheetPath);
    const firstComponents = await readFile(firstBuild[version].componentsPath);
    const secondBuild = await buildCanonicalVersions({ sourceRoot, componentsSource, outDir });
    expect(await readFile(secondBuild[version].stylesheetPath)).toEqual(first);
    expect(await readFile(secondBuild[version].componentsPath)).toEqual(firstComponents);
  });

  it("creates each version output directory tree", async () => {
    const { sourceRoot, componentsSource, outDir, version } = await setupFixture();
    expect(existsSync(outDir)).toBe(false);
    await buildCanonicalVersions({ sourceRoot, componentsSource, outDir });
    expect(existsSync(path.join(outDir, version, "styles.css"))).toBe(true);
    expect(existsSync(path.join(outDir, version, "components.js"))).toBe(true);
    expect(existsSync(path.join(outDir, version, "fonts"))).toBe(true);
  });

  it("removes output for versions no longer present in the source root", async () => {
    const { sourceRoot, componentsSource, outDir, version } = await setupFixture();
    const staleVersion = path.join(outDir, "v99");
    await mkdir(staleVersion, { recursive: true });
    await writeFile(path.join(staleVersion, "styles.css"), "stale");

    await buildCanonicalVersions({ sourceRoot, componentsSource, outDir });

    expect(existsSync(staleVersion)).toBe(false);
    expect(existsSync(path.join(outDir, version, "styles.css"))).toBe(true);
  });

  it("dedups deeply nested imports within a version", async () => {
    const { sourceRoot, componentsSource, outDir, version } = await setupFixture();
    const versionRoot = path.join(sourceRoot, version);
    await writeFile(
      path.join(versionRoot, "index.css"),
      `@import "./a.css";\n@import "./b.css";\n`,
    );
    await writeFile(path.join(versionRoot, "a.css"), `@import "./shared.css";\n.a {}\n`);
    await writeFile(path.join(versionRoot, "b.css"), `@import "./shared.css";\n.b {}\n`);
    await writeFile(path.join(versionRoot, "shared.css"), `.shared { color: red; }\n`);

    const builds = await buildCanonicalVersions({ sourceRoot, componentsSource, outDir });
    const out = await readFile(builds[version].stylesheetPath, "utf8");
    expect(out.match(/\.shared/g)).toHaveLength(1);
    expect(out).toContain(".a");
    expect(out).toContain(".b");
  });
});

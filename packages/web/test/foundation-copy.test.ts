import { globSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { enumerateTrackedPaths } from "../../../scripts/test/file-inventory.mjs";
import { buildVersionedWebBundle } from "../../../test/helpers/versioned-web-bundle.ts";
import {
  UI_STYLE_CROSSINGS,
  type AggregateStyleCrossing,
  type BundledThemeStyleCrossing,
  type EmbeddedStyleCrossing,
  type ImplementationOwnedStyleCrossing,
  type SiblingStyleCrossing,
} from "../../../test/repo/lib/ui-style-crossings.ts";
import { hasSiblingStylesheet } from "../../../test/repo/lib/ui-module-source.ts";
import { styleSourceText } from "../../../test/repo/lib/ui-style-source.ts";

const REPO_ROOT = path.resolve(import.meta.dirname, "../../..");
const AGGREGATE_CROSSING = UI_STYLE_CROSSINGS.find(
  (crossing): crossing is AggregateStyleCrossing => crossing.kind === "aggregate",
)!;
const COPIES = AGGREGATE_CROSSING.copies;

/** The `@import` targets of a stylesheet, as repo-relative paths in order. */
function importsOf(stylesheet: string): string[] {
  const directory = path.posix.dirname(stylesheet);
  return [...readFileSync(path.join(REPO_ROOT, stylesheet), "utf8").matchAll(/@import\s+["']([^"']+)["'];/g)]
    .map((match) => path.posix.normalize(path.posix.join(directory, match[1]!)));
}

function declaresColorScheme(stylesheet: string): boolean {
  const css = readFileSync(path.join(REPO_ROOT, stylesheet), "utf8")
    .replaceAll(/\/\*[\s\S]*?\*\//g, "");
  return /(?:^|[;{])\s*color-scheme\s*:/.test(css);
}

// The spec aggregate's import sequence, mapped copy for copy onto the
// production tree: the order production must load the copies in.
const PRODUCTION_ASSET_BY_SOURCE = new Map(COPIES.map(({ specSource, productionAsset }) => [specSource, productionAsset]));
const SPEC_IMPORT_ORDER = importsOf(AGGREGATE_CROSSING.specSource);
const IMPORT_ORDER = SPEC_IMPORT_ORDER
  .map((specSource) => PRODUCTION_ASSET_BY_SOURCE.get(specSource))
  .map((productionAsset) =>
    productionAsset && `./${path.posix.relative(path.posix.dirname(AGGREGATE_CROSSING.stylesheet), productionAsset)}`
  );
const MODULE_SIBLING_CROSSINGS = UI_STYLE_CROSSINGS.filter(
  (crossing): crossing is SiblingStyleCrossing => crossing.kind === "sibling",
);
const EMBEDDED_DOCUMENT_CROSSINGS = UI_STYLE_CROSSINGS.filter(
  (crossing): crossing is EmbeddedStyleCrossing => crossing.kind === "embedded",
);
const BUNDLED_THEME_CROSSINGS = UI_STYLE_CROSSINGS.filter(
  (crossing): crossing is BundledThemeStyleCrossing => crossing.kind === "bundled-theme",
);
const IMPLEMENTATION_OWNED_CROSSINGS = UI_STYLE_CROSSINGS.filter(
  (crossing): crossing is ImplementationOwnedStyleCrossing =>
    crossing.kind === "implementation-owned",
);
const TRACKED_PATHS = enumerateTrackedPaths({ repoRoot: REPO_ROOT });
const TRACKED_PATH_SET = new Set(TRACKED_PATHS);
const SPECIFIED_NOT_IMPLEMENTED_STATUS = /^\*\*Status:\*\* specified, not implemented\b/m;

function owningSpecIndex(stylesheet: string): string | undefined {
  let directory = path.posix.dirname(stylesheet);
  while (directory.startsWith("specs/ui/")) {
    const candidate = `${directory}/index.md`;
    if (TRACKED_PATH_SET.has(candidate)) return candidate;
    directory = path.posix.dirname(directory);
  }
  return undefined;
}

function isSpecifiedNotImplemented(stylesheet: string): boolean {
  const owner = owningSpecIndex(stylesheet);
  return owner !== undefined && SPECIFIED_NOT_IMPLEMENTED_STATUS.test(
    readFileSync(path.join(REPO_ROOT, owner), "utf8"),
  );
}

function authoritativeCrossingBytes(copy: SiblingStyleCrossing): Buffer {
  return Buffer.from(
    copy.specSources
      .map(authoritativeStyleText)
      .join("\n"),
  );
}

function authoritativeStyleText(source: string): string {
  const css = styleSourceText(source, readFileSync(path.join(REPO_ROOT, source), "utf8"));
  if (css === undefined) throw new Error(`${source} has no authoritative style block`);
  return css;
}

function embeddedStyleBytes(documentPath: string): Buffer {
  const document = readFileSync(path.join(REPO_ROOT, documentPath), "utf8");
  const styles = [...document.matchAll(/<style>([\s\S]*?)<\/style>/g)];
  if (styles.length !== 1) {
    throw new Error(`${documentPath} must contain exactly one embedded style block`);
  }
  return Buffer.from(styles[0][1]);
}

function isFile(file: string): boolean {
  try {
    return statSync(file).isFile();
  } catch {
    return false;
  }
}

function declaresSidebarWidth(stylesheet: string): boolean {
  const css = readFileSync(path.join(REPO_ROOT, stylesheet), "utf8")
    .replaceAll(/\/\*[\s\S]*?\*\//g, "");
  return /(?:^|[;{])\s*--sidebar-width\s*:/.test(css);
}

describe("application foundation production crossing (^ui-t-foundation-copy)", () => {
  test("committed copies are byte-identical and aggregate in owner order", () => {
    for (const { specSource, productionAsset } of COPIES) {
      expect(
        readFileSync(path.join(REPO_ROOT, specSource)),
        `${productionAsset} differs from ${specSource}`,
      ).toEqual(
        readFileSync(path.join(REPO_ROOT, productionAsset)),
      );
    }

    const copiedSources = new Set<string>(COPIES.map(({ specSource }) => specSource));
    const siblingSources = new Set(MODULE_SIBLING_CROSSINGS.flatMap(({ specSources }) => specSources));
    expect(
      TRACKED_PATHS
        .filter((file) => file.startsWith("specs/ui/foundation/"))
        .filter((file) => file.endsWith(".css") && !copiedSources.has(file) && !siblingSources.has(file))
        .filter((file) => file !== AGGREGATE_CROSSING.specSource),
    ).toEqual([]);

    // Every sheet the spec aggregate imports has a production copy, and the
    // production aggregate imports those copies in the spec aggregate's order.
    expect(SPEC_IMPORT_ORDER.filter((specSource) => !PRODUCTION_ASSET_BY_SOURCE.has(specSource))).toEqual([]);
    const aggregate = readFileSync(path.join(REPO_ROOT, AGGREGATE_CROSSING.stylesheet), "utf8");
    expect([...aggregate.matchAll(/@import\s+["']([^"']+)["'];/g)].map((match) => match[1])).toEqual(
      IMPORT_ORDER,
    );
  });

  // spec: proofs/ui/app/index.md#^ap-ac-foundation-color-scheme
  test("foundation entries leave color-scheme defaults to their color sheets", () => {
    for (const { entry, colorSheet } of [
      {
        entry: "specs/ui/foundation/index.css",
        colorSheet: "specs/ui/foundation/tokens/colors.css",
      },
      {
        entry: "packages/web/src/foundation/index.css",
        colorSheet: "packages/web/src/foundation/colors.css",
      },
    ]) {
      const imports = importsOf(entry);
      expect(imports).toContain(colorSheet);
      expect(declaresColorScheme(entry), entry).toBe(false);
      expect(imports.filter(declaresColorScheme)).toEqual([colorSheet]);
    }
  });

  test("production source imports the aggregate without reaching into the specs tree", () => {
    expect(readFileSync(path.join(REPO_ROOT, "packages/web/src/main.ts"), "utf8")).toContain(
      'import "./foundation/index.css";',
    );

    const forbiddenImports = TRACKED_PATHS
      .filter((file) => (file.startsWith("packages/web/src/") || file.startsWith("packages/desktop/src/")))
      .filter((file) => /\.(?:css|html|ts)$/.test(file))
      .flatMap((file) =>
        readFileSync(path.join(REPO_ROOT, file), "utf8")
          .split("\n")
          .filter((line) => /(?:@import|\bimport\b).*specs\/ui\//.test(line))
          .map((line) => `${file}: ${line.trim()}`),
      );
    expect(forbiddenImports).toEqual([]);
  });

  // spec: proofs/ui/app/index.md#^ap-ac-sidebar-width-source
  test("keeps sidebar width client-owned across every delivered application stylesheet", () => {
    const stylesheetPaths = new Set<string>([
      AGGREGATE_CROSSING.specSource,
      AGGREGATE_CROSSING.stylesheet,
      ...COPIES.flatMap(({ specSource, productionAsset }) =>
        [specSource, productionAsset].filter((file) => file.endsWith(".css"))
      ),
      ...MODULE_SIBLING_CROSSINGS
        .filter(({ documentDelivery }) => documentDelivery)
        .flatMap(({ specSources, stylesheet }) => [...specSources, stylesheet]),
      ...BUNDLED_THEME_CROSSINGS.flatMap(({ specSource, assets }) => [
        specSource,
        ...assets.map(({ productionAsset }) => productionAsset),
      ]).filter((file) => file.endsWith(".css")),
      ...IMPLEMENTATION_OWNED_CROSSINGS.flatMap((crossing) =>
        crossing.stylesheet?.startsWith("packages/web/src/")
          ? [crossing.stylesheet]
          : []
      ),
    ]);

    expect(
      [...stylesheetPaths].filter(declaresSidebarWidth),
      "application stylesheets must consume, never declare, --sidebar-width",
    ).toEqual([]);

    for (const stylesheet of [
      "specs/ui/app/styles.css",
      "packages/web/src/views/television-app.css",
    ]) {
      expect(readFileSync(path.join(REPO_ROOT, stylesheet), "utf8"), stylesheet)
        .toMatch(/\.app-sidebar\s*\{[\s\S]*?width:\s*var\(--sidebar-width\)/);
    }
  });

  test("every implemented element, app, theme, and Markdown-editor stylesheet has only byte-identical production crossings", () => {
    const listedSources = [
      ...new Set([
        AGGREGATE_CROSSING.specSource,
        ...COPIES.map(({ specSource }) => specSource).filter((specSource) => specSource.endsWith(".css")),
        ...MODULE_SIBLING_CROSSINGS.flatMap(({ specSources }) => specSources),
        ...EMBEDDED_DOCUMENT_CROSSINGS.map(({ specSource }) => specSource),
        ...BUNDLED_THEME_CROSSINGS.map(({ specSource }) => specSource),
      ]),
    ].sort();
    const allSpecStylesheets = TRACKED_PATHS
      .filter((file) =>
        file.startsWith("specs/ui/elements/") ||
        file.startsWith("specs/ui/foundation/") ||
        file.startsWith("specs/ui/app/") ||
        file.startsWith("specs/ui/themes/") ||
        file.startsWith("specs/ui/setup/") ||
        file.startsWith("specs/ui/markdown-editor/")
      )
      .filter((file) => file.endsWith(".css") || file.endsWith(".frame"))
      .filter((file) => styleSourceText(file, readFileSync(path.join(REPO_ROOT, file), "utf8")) !== undefined)
      .sort();
    const ownerlessStylesheets = allSpecStylesheets.filter(
      (file) => owningSpecIndex(file) === undefined,
    );
    expect(
      ownerlessStylesheets,
      "every discovered stylesheet must belong to an index.md spec",
    ).toEqual([]);

    const implementedSources = allSpecStylesheets
      .filter((file) => !isSpecifiedNotImplemented(file));
    expect(listedSources).toEqual(implementedSources);

    const violations: string[] = [];
    for (const crossing of MODULE_SIBLING_CROSSINGS) {
      const modulePath = path.join(REPO_ROOT, crossing.productionModule);
      const stylesheetPath = path.join(REPO_ROOT, crossing.stylesheet);
      const label = `${crossing.specSources.join(" + ")} -> ${crossing.stylesheet}`;

      if (!isFile(modulePath)) {
        violations.push(`missing production module: ${crossing.productionModule}`);
      } else if (!hasSiblingStylesheet(
        { path: modulePath, source: readFileSync(modulePath, "utf8") },
        stylesheetPath,
      )) {
        violations.push(
          `${crossing.productionModule} does not import its sibling ${path.basename(crossing.stylesheet)}`,
        );
      }

      if (!isFile(stylesheetPath)) {
        violations.push(`missing module-sibling copy: ${label}`);
      } else if (!readFileSync(stylesheetPath).equals(authoritativeCrossingBytes(crossing))) {
        violations.push(`module-sibling byte mismatch: ${label}`);
      }
    }

    for (const crossing of BUNDLED_THEME_CROSSINGS) {
      for (const { specSource, productionAsset } of crossing.assets) {
        if (!isFile(path.join(REPO_ROOT, productionAsset))) {
          violations.push(`missing bundled theme asset: ${specSource} -> ${productionAsset}`);
        } else if (!readFileSync(path.join(REPO_ROOT, specSource)).equals(
          readFileSync(path.join(REPO_ROOT, productionAsset)),
        )) {
          violations.push(`bundled theme byte mismatch: ${specSource} -> ${productionAsset}`);
        }
      }
    }

    for (const crossing of EMBEDDED_DOCUMENT_CROSSINGS) {
      const label = `${crossing.specSource} -> ${crossing.document} <style>`;
      try {
        if (
          !embeddedStyleBytes(crossing.document).equals(
            Buffer.from(authoritativeStyleText(crossing.specSource)),
          )
        ) {
          violations.push(`embedded style byte mismatch: ${label}`);
        }
      } catch (error) {
        violations.push(`${label}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    expect(
      violations,
      `production crossing gaps:\n${violations.map((violation) => `- ${violation}`).join("\n")}`,
    ).toEqual([]);
  });

  test("a fresh production build contains the foundation stylesheet and font bytes", async () => {
    const dist = await buildVersionedWebBundle("found-1-foundation");
    const assetsRoot = path.join(dist, "assets");
    const assets = globSync("**/*", { cwd: assetsRoot })
      .map((file) => path.join(assetsRoot, file))
      .filter(isFile);
    const builtCss = assets
      .filter((file) => file.endsWith(".css"))
      .map((file) => readFileSync(file, "utf8"))
      .join("\n");

    for (const deliveredMarker of [
      "--neutral-950",
      "--font-sans",
      "--space-32",
      "--popover-shadow",
      "--dialog-shadow",
      "font-family:Hind",
      "button[icon]",
      "tv-popover[open]",
      ".dialog-overlay",
      "tv-select",
      "button[size=sm]",
      "[electron-draggable]",
    ]) {
      expect(builtCss, `built CSS lacks ${deliveredMarker}`).toContain(deliveredMarker);
    }

    const authoritativeFont = readFileSync(path.join(
      REPO_ROOT,
      COPIES.find(({ productionAsset }) => productionAsset.endsWith(".woff2"))!.productionAsset,
    ));
    expect(
      assets.filter((file) => file.endsWith(".woff2")).some((file) => readFileSync(file).equals(authoritativeFont)),
    ).toBe(true);
  }, 300_000);
});

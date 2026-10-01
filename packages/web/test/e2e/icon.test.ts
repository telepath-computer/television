import { createRequire } from "node:module";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
// @ts-expect-error — repository build script has no declaration file
import { buildCanonicalVersions } from "../../../canonical/scripts/build-canonical.mjs";

const FIXTURE = "/packages/web/test/e2e/fixtures/icon.html";
const MARKUP_FIXTURE = "/packages/web/test/e2e/fixtures/icon-markup-smoke.html";
const TREE_SCOPE_FIXTURE = "/packages/web/test/e2e/fixtures/icon-tree-scope.html";
const PRE_UPGRADE_FIXTURE = "/packages/web/test/e2e/fixtures/icon-pre-upgrade.html";
const manifestPath = path.resolve(
  import.meta.dirname,
  "../../../../specs/ui/foundation/icons/icons.yml",
);
const require = createRequire(import.meta.url);

// A manifest source is a package specifier, or a path relative to the
// manifest itself for a drawing of our own.
const resolveSource = (source: string) =>
  source.startsWith(".")
    ? path.resolve(path.dirname(manifestPath), source)
    : require.resolve(source);
let canonicalWork = "";
let canonicalStyles = "";

test.beforeAll(async () => {
  canonicalWork = await mkdtemp(path.join(os.tmpdir(), "television-icon-canonical-"));
  const { v2 } = await buildCanonicalVersions({
    outDir: path.join(canonicalWork, "canonical"),
  });
  canonicalStyles = await readFile(v2.stylesheetPath, "utf8");
});

test.afterAll(async () => {
  await rm(canonicalWork, { recursive: true, force: true });
});

type TreeScope = "document-light-dom" | "author-shadow-root";
type IconVariant = "unsized" | "named";

interface IconMeasurement {
  scope: TreeScope;
  variant: IconVariant;
  sizeAttribute: string | null;
  inheritedFontSize: number;
  computedFontSize: number;
  expectedBox: { width: number; height: number };
  box: {
    x: number;
    y: number;
    top: number;
    right: number;
    bottom: number;
    left: number;
    width: number;
    height: number;
  };
}

async function setup(page: Page, reducedMotion: "no-preference" | "reduce"): Promise<void> {
  await page.emulateMedia({ reducedMotion });
  await page.goto(FIXTURE);
  await page.waitForFunction(
    () => (window as unknown as { __fixtureReady?: boolean }).__fixtureReady === true,
  );
}

async function measureIcon(
  page: Page,
  scope: TreeScope,
  variant: IconVariant,
): Promise<IconMeasurement> {
  await page.goto(TREE_SCOPE_FIXTURE);
  await page.evaluate(() => customElements.whenDefined("tv-icon"));

  return page.evaluate(({ scope, variant }) => {
    const host = document.querySelector<HTMLElement>("#shadow-icon-host");
    const container = scope === "document-light-dom"
      ? document.querySelector<HTMLElement>('[data-icon-scope="light"]')
      : host?.shadowRoot?.querySelector<HTMLElement>('[data-icon-scope="shadow"]');
    const icon = container?.querySelector<HTMLElement>(`tv-icon[data-variant="${variant}"]`);
    if (!container || !icon) throw new Error(`Missing ${scope} ${variant} icon fixture`);

    const rect = icon.getBoundingClientRect();
    const inheritedFontSize = Number.parseFloat(getComputedStyle(container).fontSize);
    const computedFontSize = Number.parseFloat(getComputedStyle(icon).fontSize);
    const expectedSize = variant === "named" ? 24 : inheritedFontSize;

    return {
      scope,
      variant,
      sizeAttribute: icon.getAttribute("size"),
      inheritedFontSize,
      computedFontSize,
      expectedBox: { width: expectedSize, height: expectedSize },
      box: {
        x: rect.x,
        y: rect.y,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        left: rect.left,
        width: rect.width,
        height: rect.height,
      },
    };
  }, { scope, variant });
}

function expectIconSize(measurement: IconMeasurement): void {
  const detail = JSON.stringify(measurement, null, 2);
  expect(measurement.box, detail).toMatchObject(measurement.expectedBox);
  expect(measurement.box.width, detail).toBeGreaterThan(0);
  expect(measurement.box.width, detail).toBe(measurement.box.height);
  expect(measurement.box.width, detail).toBe(measurement.computedFontSize);
}

async function readManifest(): Promise<Map<string, string>> {
  const source = await readFile(manifestPath, "utf8");
  return new Map(
    source
      .split("\n")
      .filter((line) => line !== "" && !line.startsWith("#"))
      .map((line) => {
        const match = /^(?<name>[^:]+):\s+"(?<source>[^"]+)"$/.exec(line);
        if (!match?.groups) throw new Error(`Unexpected icon manifest row: ${line}`);
        return [match.groups.name, match.groups.source];
      }),
  );
}

test("renders every manifest glyph through equivalent declarative and imperative shadow roots (^ic-ac-markup-smoke)", async ({
  page,
}) => {
  const manifest = await readManifest();
  const installedSources: Record<string, string> = Object.fromEntries(
    await Promise.all(
      [...manifest].map(async ([name, sourcePath]) => [
        name,
        await readFile(resolveSource(sourcePath), "utf8"),
      ]),
    ),
  );

  await page.goto(MARKUP_FIXTURE);
  await page.waitForFunction(() => {
    const frame = document.querySelector<HTMLIFrameElement>("#icon-markup-frame");
    return frame?.contentDocument?.documentElement.dataset.fixtureReady === "true";
  });

  const observations = await page.evaluate((sources) => {
    const frame = document.querySelector<HTMLIFrameElement>("#icon-markup-frame");
    const doc = frame?.contentDocument;
    if (!doc) throw new Error("Missing icon markup fixture document");

    const normalizeSvg = (source: string): string | null => {
      const template = doc.createElement("template");
      template.innerHTML = source;
      return template.content.firstElementChild?.outerHTML ?? null;
    };
    const sheetText = (root: ShadowRoot): string =>
      root.adoptedStyleSheets.flatMap((sheet) =>
        Array.from(sheet.cssRules, (rule) => rule.cssText)
      ).join("\n");

    return Object.entries(sources).map(([name, source]) => {
      const declarativeSection = [...doc.querySelectorAll<HTMLElement>(
        '[data-icon-path="declarative"]',
      )].find((section) => section.dataset.iconName === name);
      const imperativeSection = [...doc.querySelectorAll<HTMLElement>(
        '[data-icon-path="imperative"]',
      )].find((section) => section.dataset.iconName === name);
      const declarative = declarativeSection?.querySelector<HTMLElement>("tv-icon");
      const imperative = imperativeSection?.querySelector<HTMLElement>("tv-icon");
      const declarativeRoot = declarative?.shadowRoot;
      const imperativeRoot = imperative?.shadowRoot;
      if (!declarative || !imperative || !declarativeRoot || !imperativeRoot) {
        throw new Error(`Missing ${name} construction path`);
      }

      return {
        name,
        declarativeRootPreserved:
          declarativeSection?.dataset.declarativeRootPreserved === "true",
        declarativeMode: declarativeRoot.mode,
        imperativeMode: imperativeRoot.mode,
        declarativeLightNodes: declarative.childNodes.length,
        imperativeLightNodes: imperative.childNodes.length,
        declarativeSheetCount: declarativeRoot.adoptedStyleSheets.length,
        imperativeSheetCount: imperativeRoot.adoptedStyleSheets.length,
        sameSheet: declarativeRoot.adoptedStyleSheets[0] ===
          imperativeRoot.adoptedStyleSheets[0],
        sameContents: declarativeRoot.innerHTML === imperativeRoot.innerHTML,
        sameStyles: sheetText(declarativeRoot) === sheetText(imperativeRoot),
        declarativeSvg: declarativeRoot.querySelector("svg")?.outerHTML ?? null,
        imperativeSvg: imperativeRoot.querySelector("svg")?.outerHTML ?? null,
        expectedSvg: normalizeSvg(source),
      };
    });
  }, installedSources);

  expect(observations).toHaveLength(manifest.size);
  for (const observation of observations) {
    expect(observation, JSON.stringify(observation, null, 2)).toMatchObject({
      declarativeRootPreserved: true,
      declarativeMode: "open",
      imperativeMode: "open",
      declarativeLightNodes: 0,
      imperativeLightNodes: 0,
      declarativeSheetCount: 1,
      imperativeSheetCount: 1,
      sameSheet: true,
      sameContents: true,
      sameStyles: true,
      declarativeSvg: observation.expectedSvg,
      imperativeSvg: observation.expectedSvg,
    });
  }
});

test.describe("tv-icon tree-scope sizing (^ic-ac-tree-scope)", () => {
  const cases: Array<{
    title: string;
    scope: TreeScope;
    variant: IconVariant;
  }> = [
    {
      title: "sizes an unsized icon from inherited text in document light DOM",
      scope: "document-light-dom",
      variant: "unsized",
    },
    {
      title: "sizes a named icon in document light DOM",
      scope: "document-light-dom",
      variant: "named",
    },
    {
      title: "sizes an unsized icon from inherited text inside an author shadow root",
      scope: "author-shadow-root",
      variant: "unsized",
    },
    {
      title: "sizes a named icon inside an author shadow root",
      scope: "author-shadow-root",
      variant: "named",
    },
  ];

  for (const { title, scope, variant } of cases) {
    test(title, async ({ page }) => {
      expectIconSize(await measureIcon(page, scope, variant));
    });
  }
});

test("keeps every canonical icon box stable across definition (^ic-ac-pre-upgrade-box)", async ({
  page,
}) => {
  await page.goto(PRE_UPGRADE_FIXTURE);
  await page.waitForFunction(
    () => (window as unknown as { __fixtureReady?: boolean }).__fixtureReady === true,
  );
  await page.addStyleTag({ content: canonicalStyles });

  const measure = () => page.locator("tv-icon").evaluateAll((icons) =>
    icons.map((icon) => {
      const rect = icon.getBoundingClientRect();
      return {
        variant: (icon as HTMLElement).dataset.variant,
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
      };
    })
  );
  const before = await measure();

  await page.evaluate(async () => {
    const defineIcons = (window as unknown as {
      __defineIcons?: () => Promise<unknown>;
    }).__defineIcons;
    if (!defineIcons) throw new Error("Missing delayed icon definition fixture hook");
    await defineIcons();
    await customElements.whenDefined("tv-icon");
  });
  const after = await measure();

  expect(before.map(({ variant, width, height }) => ({ variant, width, height }))).toEqual([
    { variant: "default", width: 18, height: 18 },
    { variant: "sm", width: 16, height: 16 },
    { variant: "md", width: 20, height: 20 },
    { variant: "lg", width: 24, height: 24 },
    { variant: "xl", width: 32, height: 32 },
  ]);
  expect(after).toEqual(before);
});

test.describe("tv-icon spinning (^ic-ac-spinning)", () => {
  test("starts one continuously advancing animation under normal motion preference", async ({ page }) => {
    await setup(page, "no-preference");

    const result = await page.locator("tv-icon").evaluate(async (icon) => {
      const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      await nextFrame();
      const glyph = icon.shadowRoot?.querySelector("svg");
      const animations = glyph?.getAnimations() ?? [];
      const animation = animations[0];
      const firstTime = Number(animation?.currentTime);
      await nextFrame();
      await nextFrame();
      const secondTime = Number(animation?.currentTime);
      const timing = animation?.effect?.getTiming();

      return {
        advancing: Number.isFinite(firstTime) && secondTime > firstTime,
        continuous: timing?.iterations === Infinity,
        count: animations.length,
        playState: animation?.playState,
      };
    });

    expect(result).toEqual({
      advancing: true,
      continuous: true,
      count: 1,
      playState: "running",
    });
  });

  test("starts no animation under reduced motion preference", async ({ page }) => {
    await setup(page, "reduce");

    const animationCount = await page.locator("tv-icon").evaluate(async (icon) => {
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      );
      return icon.shadowRoot?.querySelector("svg")?.getAnimations().length ?? 0;
    });

    expect(animationCount).toBe(0);
  });
});

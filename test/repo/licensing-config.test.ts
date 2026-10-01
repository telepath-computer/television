import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  loadAssetManifest,
  loadLicenseConfig,
  type LicenseConfig,
} from "../../scripts/licenses/lib/config.mjs";
import {
  prepareInventoryRoot,
  readSurfaceInventory,
  resolveInventoryRoot,
  surfaceInventoryPath,
  writeSurfaceInventory,
  type SurfaceInventory,
} from "../../scripts/licenses/lib/inventory.mjs";
import {
  includedLicenseSurfaces,
  LICENSE_SURFACE_DECLARATIONS,
  licenseSurfaceForPackageDirectory,
} from "../../scripts/licenses/lib/surfaces.mjs";

const repoRoot = path.resolve(import.meta.dirname, "../..");
const tempRoots: string[] = [];

function tempRoot(prefix: string): string {
  const root = mkdtempSync(path.join(os.tmpdir(), prefix));
  tempRoots.push(root);
  return root;
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("licensing configuration", () => {
  test("declares package topology in one module", () => {
    expect(includedLicenseSurfaces("cli")).toEqual([
      "cli",
      "skill:tv-calendar",
      "skill:tv-tasks",
      "view:markdown",
      "web",
    ]);
    expect(licenseSurfaceForPackageDirectory("packages/cli")?.surface).toBe("cli");
    expect(licenseSurfaceForPackageDirectory("packages/desktop")?.surface).toBe("desktop");
    expect(LICENSE_SURFACE_DECLARATIONS.find((entry) => entry.surface === "source")?.producesInventory).toBe(false);
    expect(licenseSurfaceForPackageDirectory("packages/unknown")).toBeNull();
    expect(new Set(LICENSE_SURFACE_DECLARATIONS.map((entry) => entry.surface)).size).toBe(
      LICENSE_SURFACE_DECLARATIONS.length,
    );
  });

  test("loads the reviewed policy decisions", () => {
    const config = loadLicenseConfig();

    expect(config.allow).toEqual(["MIT", "ISC", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "OFL-1.1", "LicenseRef-Unsplash"]);
    expect(Object.keys(config)).toEqual(["allow", "elections", "notices", "ignored"]);
    expect(config.elections).toEqual([
      {
        package: "dompurify",
        offered: "(MPL-2.0 OR Apache-2.0)",
        elected: "Apache-2.0",
      },
    ]);
    expect(config.ignored.map((entry) => entry.pattern)).toEqual(["skills"]);

    const cookieNotice = config.notices.find((entry) => entry.package === "cookie-signature");
    expect(cookieNotice?.source).toBe("cookie-signature@1.0.7 Readme.md, ## License");
    expect(cookieNotice?.text).toContain("Copyright (c) 2012 LearnBoost <tj@learnboost.com>");
  });

  test("loads the pinned vendored assets with complete upstream legal text", () => {
    const assets = loadAssetManifest();
    expect(assets.map((asset) => asset.id)).toEqual([
      "hind-font",
      "phosphor-icons",
      "nord-theme",
      "tokyo-night-theme",
      "clouds-theme",
      "tailwind-foundation",
      "tailwind-token-demo",
    ]);

    const hind = assets[0];
    expect(Object.keys(hind).sort()).toEqual(["components", "id", "paths", "surfaces"]);
    expect(hind.paths).toEqual([
      "packages/canonical/frozen/v1/fonts/Hind-Variable.933e9900.woff2",
      "packages/canonical/styles/canonical/v2/foundation/fonts/Hind-Variable.woff2",
      "packages/web/src/foundation/fonts/Hind-Variable.woff2",
      "specs/ui/foundation/fonts/Hind-Variable.woff2",
    ]);
    expect(hind.surfaces).toEqual(["web", "view:markdown", "source", "desktop"]);
    expect(hind.components).toHaveLength(1);
    expect(hind.components[0]).toMatchObject({ license: "OFL-1.1" });
    expect(hind.components[0].noticeText).toContain("Copyright (c) 2014, Indian Type Foundry");
    expect(hind.components[0].noticeText).toContain("SIL OPEN FONT LICENSE Version 1.1 - 26 February 2007");
    expect(hind.components[0].noticeText).toContain("5) The Font Software, modified or unmodified");
    expect(hind.components[0].noticeText).toMatch(/OR FROM\s+OTHER DEALINGS IN THE FONT SOFTWARE\.\s*$/);

    const phosphor = assets[1];
    expect(phosphor.paths).toEqual([
      "packages/web/src/elements/icon.ts",
      "packages/canonical/frozen/v1/components.js",
      "packages/web/src/elements/select.svg",
      "specs/ui/foundation/icons/select.svg",
    ]);
    expect(phosphor.surfaces).toEqual(["web", "view:markdown", "source", "desktop"]);
    expect(phosphor.components[0]).toMatchObject({
      package: "@phosphor-icons/core",
      version: "2.1.1",
      license: "MIT",
      noticeText: readFileSync(path.join(repoRoot, "node_modules/@phosphor-icons/core/LICENSE"), "utf8"),
    });

    // proofs/arch/licensing.md#^licensing-t-real-assets-seam
    const nord = assets[2];
    expect(nord.paths).toEqual([
      "specs/ui/themes/nord/styles.css",
      "packages/server/assets/themes/nord/theme.css",
    ]);
    expect(nord.surfaces).toEqual(["cli", "source"]);
    expect(nord.noticesFolder).toBe("packages/server/assets/themes/nord");
    expect(nord.components).toHaveLength(1);
    expect(nord.components[0]).toMatchObject({ name: "Nord color palette", license: "MIT" });
    expect(nord.components[0].noticeText).toMatch(/^MIT License \(MIT\)\n\nCopyright \(c\) 2016-present Sven Greb <development@svengreb\.de> \(https:\/\/www\.svengreb\.de\)\n/);
    expect(nord.components[0].noticeText).toMatch(/OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE\nSOFTWARE\.\n$/);
    for (const stylesheet of nord.paths) {
      const header = readFileSync(path.join(repoRoot, stylesheet), "utf8").split("*/")[0];
      expect(header, stylesheet).toMatch(/^\/\*/);
      expect(header, stylesheet).toContain("https://github.com/nordtheme/nord");
      expect(header, stylesheet).toContain("Copyright (c) 2016-present Sven Greb <development@svengreb.de> (https://www.svengreb.de)");
      expect(header, stylesheet).toContain("MIT License");
      expect(header, stylesheet).toContain("THIRD-PARTY-NOTICES.txt");
    }

    for (const asset of assets) {
      for (const assetPath of asset.paths) expect(existsSync(path.join(repoRoot, assetPath)), assetPath).toBe(true);
      for (const component of asset.components) {
        expect(component.license).toBeTruthy();
        expect(component.noticeText).toBeTruthy();
      }
    }
  });

  test.each([
    {
      name: "missing notice text",
      component: { license: "MIT" },
      error: /malformed-asset.*noticeText/i,
    },
    {
      name: "missing license",
      component: { noticeText: "terms" },
      error: /malformed-asset.*license/i,
    },
    {
      name: "disallowed license",
      component: { name: "Fixture component", license: "GPL-3.0-only", noticeText: "terms" },
      error: /malformed-asset.*license.*GPL-3\.0-only.*not allowed/i,
    },
    {
      name: "missing reader-facing name",
      component: { license: "MIT", noticeText: "terms" },
      error: /malformed-asset.*name/i,
    },
  ])("rejects a vendored component with $name", ({ component, error }) => {
    const root = fixtureRoot();
    writeJSON(path.join(root, "assets.json"), [assetFixture({ components: [component] })]);
    expect(() => loadAssetManifest({ root, assetsPath: path.join(root, "assets.json"), config: fixtureConfig() })).toThrow(error);
  });

  // proofs/arch/licensing.md#^licensing-t-real-assets-seam
  test("records the three wallpapers and Tokyo Night palette", () => {
    const config = loadLicenseConfig();
    expect(config.allow).toEqual(["MIT", "ISC", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "OFL-1.1", "LicenseRef-Unsplash"]);
    const assets = loadAssetManifest();
    expect(assets.flatMap((asset) => asset.components.filter((component) => component.license === "LicenseRef-Unsplash").map((component) => component.name))).toEqual([
      "Mingwei Lim — Unsplash BpuF14DFbYs",
      "Ljubomir Žarković — Unsplash bt_ZtkCxLs4",
      "Shot by Cerqueira — Unsplash NpF9JLGYfeQ",
    ]);
    for (const id of ["tokyo-night-theme", "clouds-theme"]) {
      const asset = assets.find((entry) => entry.id === id)!;
      expect(asset.surfaces).toEqual(id === "clouds-theme" ? ["cli", "source", "desktop"] : ["cli", "source"]);
      expect(asset.noticesFolder).toBe(`packages/server/assets/themes/${id.replace("-theme", "")}`);
      for (const component of asset.components.filter((entry) => entry.license === "LicenseRef-Unsplash")) {
        expect(component.noticeText).toContain("Images cannot be sold without significant modification.");
        expect(component.noticeText).toContain("Unsplash grants you an irrevocable, nonexclusive, worldwide copyright license");
        expect(component.noticeText).toContain("https://unsplash.com/photos/");
      }
    }
    const palette = assets.find((entry) => entry.id === "tokyo-night-theme")!.components[0];
    expect(palette).toMatchObject({ name: "Tokyo Night color palette", license: "Apache-2.0" });
    expect(palette.noticeText).toContain("Version 2.0, January 2004");
    expect(palette.noticeText).toContain("END OF TERMS AND CONDITIONS");
    for (const file of ["specs/ui/themes/tokyo-night/styles.css", "packages/server/assets/themes/tokyo-night/theme.css"]) {
      const header = readFileSync(path.join(repoRoot, file), "utf8").split("*/")[0];
      expect(header).toContain("https://github.com/folke/tokyonight.nvim");
      expect(header).toContain("Apache License 2.0");
      expect(header).toContain("THIRD-PARTY-NOTICES.txt");
    }
  });

  // proofs/arch/licensing.md#^licensing-t-real-assets-seam
  test("attributes retained Tailwind palettes on their actual delivery surfaces", () => {
    const assets = loadAssetManifest();
    const clouds = assets.find((asset) => asset.id === "clouds-theme")!;
    expect(clouds.paths).toEqual([
      "specs/ui/themes/clouds/styles.css",
      "packages/server/assets/themes/clouds/theme.css",
      "specs/ui/themes/clouds/wallpaper.webp",
      "specs/ui/themes/clouds/wallpaper-dark.webp",
      "packages/server/assets/themes/clouds/wallpaper.webp",
      "packages/server/assets/themes/clouds/wallpaper-dark.webp",
    ]);
    const tailwind = clouds.components.find((component) => component.name === "Tailwind CSS color palette")!;
    expect(tailwind).toMatchObject({ license: "MIT" });
    expect(tailwind.noticeText).toMatch(/^MIT License\n\nCopyright \(c\) Tailwind Labs, Inc\.\n/);
    expect(tailwind.noticeText).toContain("The above copyright notice and this permission notice shall be included in all\ncopies or substantial portions of the Software.");
    expect(tailwind.noticeText).toMatch(/SOFTWARE\.\n$/);
    const foundation = assets.find((asset) => asset.id === "tailwind-foundation")!;
    expect(foundation.paths).toEqual([
      "specs/ui/foundation/tokens/colors.css",
      "packages/web/src/foundation/colors.css",
      "packages/canonical/styles/canonical/v2/foundation/colors.css",
      "packages/canonical/frozen/v1/styles.css",
    ]);
    expect(foundation.surfaces).toEqual(["web", "view:markdown", "source", "desktop"]);
    expect(foundation.components).toEqual([tailwind]);
    const demo = assets.find((asset) => asset.id === "tailwind-token-demo")!;
    expect(demo.paths).toEqual(["staging/frames/token-system/styles.css"]);
    expect(demo.surfaces).toEqual(["source"]);
    expect(demo.components).toEqual([tailwind]);
    expect(demo).not.toHaveProperty("noticesFolder");
    for (const file of [...clouds.paths.filter((file) => file.endsWith(".css")), ...foundation.paths.filter((file) => !file.includes("/frozen/")), ...demo.paths]) {
      const header = readFileSync(path.join(repoRoot, file), "utf8").split("*/")[0];
      expect(header, file).toMatch(/^\/\*/);
      expect(header, file).toContain("https://github.com/tailwindlabs/tailwindcss");
      expect(header, file).toContain("Copyright (c) Tailwind Labs, Inc.");
      expect(header, file).toContain("MIT License");
      expect(header, file).toContain("THIRD-PARTY-NOTICES.txt");
    }
    expect(readFileSync(path.join(repoRoot, "packages/server/assets/themes/clouds/README.md"), "utf8"))
      .toContain("https://github.com/tailwindlabs/tailwindcss/blob/41d9cae8e53378d16087fcf359eb785c2fd42ce4/LICENSE");
  });

  test("accepts exact and scope ignored patterns and rejects every other wildcard form", () => {
    const root = fixtureRoot();
    const configPath = path.join(root, "config.json");
    const accepted = fixtureConfig({
      ignored: [
        { pattern: "exact-package" },
        { pattern: "@fixture/*" },
      ],
    });
    writeJSON(configPath, accepted);
    expect(loadLicenseConfig({ root, configPath }).ignored).toEqual(accepted.ignored);

    for (const pattern of ["*", "@fixture/pre*", "@fixture/", ""]) {
      writeJSON(configPath, fixtureConfig({ ignored: [{ pattern }] }));
      expect(() => loadLicenseConfig({ root, configPath }), pattern).toThrow(/ignored.*pattern/i);
    }
  });

  test("loads multiple components without package identity under their own names", () => {
    const root = fixtureRoot();
    const assetsPath = path.join(root, "assets.json");
    const components = [
      { name: "First embedded project", license: "MIT", noticeText: "First terms" },
      { name: "Second embedded project", license: "MIT", noticeText: "Second terms" },
    ];
    writeJSON(assetsPath, [assetFixture({ components })]);
    expect(loadAssetManifest({ root, assetsPath, config: fixtureConfig() })[0].components).toEqual(components);
  });

  test("rejects a vendored component naming an ignored package", () => {
    const root = fixtureRoot();
    const assetsPath = path.join(root, "assets.json");
    writeJSON(assetsPath, [assetFixture({
      components: [{ package: "@fixture/ignored", license: "MIT", noticeText: "terms" }],
    })]);
    expect(() => loadAssetManifest({
      root,
      assetsPath,
      config: fixtureConfig({ ignored: [{ pattern: "@fixture/*" }] }),
    })).toThrow(/malformed-asset.*ignored package @fixture\/ignored/i);
  });

  test("accepts an existing notices folder and rejects every other noticesFolder value", () => {
    const root = fixtureRoot();
    const assetsPath = path.join(root, "assets.json");
    mkdirSync(path.join(root, "theme"));
    writeJSON(assetsPath, [assetFixture({ noticesFolder: "theme" })]);
    expect(loadAssetManifest({ root, assetsPath, config: fixtureConfig() })[0].noticesFolder).toBe("theme");

    writeJSON(assetsPath, [assetFixture()]);
    expect(loadAssetManifest({ root, assetsPath, config: fixtureConfig() })[0]).not.toHaveProperty("noticesFolder");

    for (const noticesFolder of [path.join(root, "theme"), "../theme", "theme/../..", "absent", "asset.js", "", 7]) {
      writeJSON(assetsPath, [assetFixture({ noticesFolder })]);
      expect(() => loadAssetManifest({ root, assetsPath, config: fixtureConfig() }), String(noticesFolder))
        .toThrow(/malformed-asset.*noticesFolder/i);
    }
  });

  test("rejects invalid surfaces and missing asset paths with the asset identity", () => {
    const invalidSurfaceRoot = fixtureRoot();
    writeJSON(path.join(invalidSurfaceRoot, "assets.json"), [assetFixture({ surfaces: ["view:markdwon"] })]);
    expect(() => loadAssetManifest({
      root: invalidSurfaceRoot,
      assetsPath: path.join(invalidSurfaceRoot, "assets.json"),
      config: fixtureConfig(),
    })).toThrow(/malformed-asset.*surface.*view:markdwon/i);

    const missingPathRoot = fixtureRoot({ createAsset: false });
    writeJSON(path.join(missingPathRoot, "assets.json"), [assetFixture()]);
    expect(() => loadAssetManifest({
      root: missingPathRoot,
      assetsPath: path.join(missingPathRoot, "assets.json"),
      config: fixtureConfig(),
    })).toThrow(/malformed-asset.*missing.*asset\.js/i);
  });
});

describe("licensing inventory root", () => {
  test("resolves the repository inventory root", () => {
    const root = tempRoot("tv-license-root-");
    expect(resolveInventoryRoot({ root })).toBe(path.join(root, ".licenses-inventory"));
  });

  test("recreates the inventory root", () => {
    const root = tempRoot("tv-license-inventory-");
    mkdirSync(root, { recursive: true });
    writeFileSync(path.join(root, "stale.json"), "stale");

    prepareInventoryRoot(root);
    expect(existsSync(path.join(root, "stale.json"))).toBe(false);
    expect(existsSync(root)).toBe(true);
  });

  test("writes and reads validated inventories deterministically", () => {
    const root = tempRoot("tv-license-inventory-");
    prepareInventoryRoot(root);
    const cli = inventory("cli", [
      packageRecord("z-package", "2.0.0", null, null),
      packageRecord("@scope/a-package", "1.0.0", "MIT", "/licenses/a"),
    ]);

    writeSurfaceInventory(root, cli);
    const firstBytes = readFileSync(surfaceInventoryPath(root, "cli"), "utf8");
    writeSurfaceInventory(root, inventory("cli", [...cli.packages].reverse()));
    expect(readFileSync(surfaceInventoryPath(root, "cli"), "utf8")).toBe(firstBytes);
    expect(firstBytes.endsWith("\n")).toBe(true);
    expect(path.basename(surfaceInventoryPath(root, "view:markdown"))).toBe("view:markdown.json");

    expect(readSurfaceInventory(root, "cli")).toEqual(inventory("cli", [
      packageRecord("@scope/a-package", "1.0.0", "MIT", "/licenses/a"),
      packageRecord("z-package", "2.0.0", null, null),
    ]));
  });

  test("names the inventory path and invalid field when persisted data is malformed", () => {
    const root = tempRoot("tv-license-inventory-");
    prepareInventoryRoot(root);
    const file = surfaceInventoryPath(root, "cli");
    writeJSON(file, {
      surface: "cli",
      packages: [{ name: "bad-package", declaredLicense: "MIT", licenseFilePath: null }],
    });

    expect(() => readSurfaceInventory(root, "cli")).toThrow(/cli\.json.*packages\[0\]\.version/i);
  });

  test("rejects a persisted inventory whose file name and surface disagree", () => {
    const root = tempRoot("tv-license-inventory-");
    prepareInventoryRoot(root);
    writeJSON(surfaceInventoryPath(root, "cli"), inventory("web", []));

    expect(() => readSurfaceInventory(root, "cli")).toThrow(/cli\.json\.surface.*expected "cli"/i);
  });
});

function fixtureConfig(overrides: Partial<LicenseConfig> = {}): LicenseConfig {
  return {
    allow: ["MIT", "OFL-1.1"],
    elections: [],
    notices: [],
    ignored: [],
    ...overrides,
  };
}

function fixtureRoot({ createAsset = true } = {}): string {
  const root = tempRoot("tv-license-config-");
  if (createAsset) writeFileSync(path.join(root, "asset.js"), "fixture");
  return root;
}

function assetFixture(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "malformed-asset",
    paths: ["asset.js"],
    components: [{ name: "Fixture component", license: "MIT", noticeText: "terms" }],
    surfaces: ["source"],
    ...overrides,
  };
}

function inventory(surface: string, packages: SurfaceInventory["packages"]): SurfaceInventory {
  return { surface, packages } as SurfaceInventory;
}

function packageRecord(
  name: string,
  version: string,
  declaredLicense: string | null,
  licenseFilePath: string | null,
): SurfaceInventory["packages"][number] {
  return { name, version, declaredLicense, licenseFilePath };
}

function writeJSON(file: string, value: unknown): void {
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

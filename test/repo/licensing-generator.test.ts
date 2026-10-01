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
  generateFolderNotices,
  generateNoticesFromEsbuild,
  generateSourceNotices,
} from "../../scripts/licenses/generate-notices.mjs";
import {
  loadAssetManifest,
  loadLicenseConfig,
  type LicenseConfig,
  type VendoredAsset,
} from "../../scripts/licenses/lib/config.mjs";
import {
  mergeSurfaceInventories,
  readSurfaceInventory,
  type SurfaceInventory,
} from "../../scripts/licenses/lib/inventory.mjs";
import {
  inventoryFromEsbuildMetafile,
  inventoryFromModulePaths,
  renderThirdPartyNotices,
  resolvePackageLicense,
  resolvePackageNotice,
  type BundleModuleRecord,
  type EsbuildMetafile,
} from "../../scripts/licenses/lib/notices.mjs";
import {
  findOwningPackage,
  findPackageLicenseFile,
} from "../../scripts/licenses/lib/package-license.mjs";
import { createTelevisionLicensePlugin } from "../../scripts/licenses/vite-plugin.mjs";

const repoRoot = path.resolve(import.meta.dirname, "../..");
const fixtureRoot = path.join(repoRoot, "test/fixtures/licensing");
const tempRoots: string[] = [];

function makeTempRoot(prefix = "tv-license-generator-"): string {
  const root = mkdtempSync(path.join(os.tmpdir(), prefix));
  tempRoots.push(root);
  return root;
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("licensing inventory conversion", () => {
  test("rejects an undeclared or non-inventory Vite surface when the plugin is constructed", () => {
    expect(() => createTelevisionLicensePlugin({ surface: "skill:undeclared" as never })).toThrow(
      /undeclared license surface.*skill:undeclared/i,
    );
    expect(() => createTelevisionLicensePlugin({ surface: "source" as never })).toThrow(
      /source.*does not produce an inventory/i,
    );
  });

  test("maps emitted esbuild inputs to nearest scoped and nested package owners", () => {
    const root = createInventoryTree();
    const metafile = readJSON<EsbuildMetafile>(path.join(fixtureRoot, "esbuild-metafile.json"));

    const inventory = inventoryFromEsbuildMetafile({ surface: "cli", metafile, root, cwd: root, config: fixtureConfig() });

    expect(inventory).toEqual({
      surface: "cli",
      packages: [
        packageRecord("@fixture/scoped-package", "2.0.0", "ISC", "node_modules/@fixture/scoped-package/LICENSE.md"),
        packageRecord(
          "nested-package",
          "3.0.0",
          "BSD-3-Clause",
          "node_modules/outer-package/node_modules/nested-package/COPYING",
        ),
        packageRecord("plain-package", "1.0.0", "MIT", "node_modules/plain-package/LICENSE"),
      ],
    });
    expect(inventory.packages.some((entry) => entry.name === "tree-shaken-package")).toBe(false);

    const nestedInput = path.join(root, "node_modules/outer-package/node_modules/nested-package/src/index.js");
    writeJSON(path.join(path.dirname(nestedInput), "package.json"), { type: "module" });
    expect(findOwningPackage(nestedInput)?.name).toBe("nested-package");
  });

  test("maps Vite bundle module lists through the shared owning-package path", () => {
    const root = createInventoryTree();
    const modules = readJSON<BundleModuleRecord[]>(path.join(fixtureRoot, "vite-bundle-modules.json"));

    const inventory = inventoryFromModulePaths({ surface: "web", modules, root, cwd: root, config: fixtureConfig() });

    expect(inventory).toEqual({
      surface: "web",
      packages: [
        packageRecord("@fixture/scoped-package", "2.0.0", "ISC", "node_modules/@fixture/scoped-package/LICENSE.md"),
        packageRecord(
          "nested-package",
          "3.0.0",
          "BSD-3-Clause",
          "node_modules/outer-package/node_modules/nested-package/COPYING",
        ),
        packageRecord("plain-package", "1.0.0", "MIT", "node_modules/plain-package/LICENSE"),
      ],
    });
    expect(inventory.packages.some((entry) => entry.name === "tree-shaken-package")).toBe(false);
  });

  test("keeps the license-file-bearing record when combined inventories repeat a package", () => {
    const withoutLicenseFile = packageRecord("repeated-package", "1.0.0", "MIT", null);
    const withLicenseFile = packageRecord("repeated-package", "1.0.0", "MIT", "node_modules/repeated-package/LICENSE");
    const withoutInventory: SurfaceInventory = { surface: "cli", packages: [withoutLicenseFile] };
    const withInventory: SurfaceInventory = { surface: "web", packages: [withLicenseFile] };

    expect(mergeSurfaceInventories("cli", [withoutInventory, withInventory]).packages).toEqual([
      withLicenseFile,
    ]);
    expect(mergeSurfaceInventories("cli", [withInventory, withoutInventory]).packages).toEqual([
      withLicenseFile,
    ]);
  });

  test("drops exact and scope ignored packages before inventory persistence and notice rendering", () => {
    const root = createInventoryTree();
    const metafile = readJSON<EsbuildMetafile>(path.join(fixtureRoot, "esbuild-metafile.json"));
    const inventoryRoot = path.join(root, "inventories");
    const config = fixtureConfig({
      ignored: [
        { pattern: "plain-package" },
        { pattern: "@fixture/*" },
      ],
    });
    const output = requireNotices(generateNoticesFromEsbuild({
      surface: "cli",
      metafile,
      outputPath: path.join(root, "dist/THIRD-PARTY-NOTICES.txt"),
      root,
      cwd: root,
      inventoryRoot,
      config,
      assets: [],
    }));

    expect(readSurfaceInventory(inventoryRoot, "cli").packages.map((entry) => entry.name)).toEqual(["nested-package"]);
    expect(output).not.toContain("plain-package");
    expect(output).not.toContain("@fixture/scoped-package");

    const allIgnored = fixtureConfig({
      ignored: [
        ...config.ignored,
        { pattern: "nested-package" },
      ],
    });
    const emptyOutputPath = path.join(root, "empty/THIRD-PARTY-NOTICES.txt");
    mkdirSync(path.dirname(emptyOutputPath), { recursive: true });
    writeFileSync(emptyOutputPath, "stale notice");
    const emptyOutput = generateNoticesFromEsbuild({
      surface: "cli",
      metafile,
      outputPath: emptyOutputPath,
      root,
      cwd: root,
      inventoryRoot: path.join(root, "empty-inventories"),
      config: allIgnored,
      assets: [],
    });
    expect(readSurfaceInventory(path.join(root, "empty-inventories"), "cli").packages).toEqual([]);
    expect(emptyOutput).toBeNull();
    expect(existsSync(emptyOutputPath)).toBe(false);
  });

  test("persists a normalized package inventory before rendering", () => {
    const root = createInventoryTree();
    const metafile = readJSON<EsbuildMetafile>(path.join(fixtureRoot, "esbuild-metafile.json"));
    const inventoryRoot = path.join(root, "inventories");
    const outputPath = path.join(root, "dist/THIRD-PARTY-NOTICES.txt");

    const output = requireNotices(generateNoticesFromEsbuild({
      surface: "cli",
      metafile,
      outputPath,
      root,
      cwd: root,
      inventoryRoot,
      config: fixtureConfig(),
      assets: [],
    }));

    expect(readSurfaceInventory(inventoryRoot, "cli")).toEqual(
      inventoryFromEsbuildMetafile({ surface: "cli", metafile, root, cwd: root, config: fixtureConfig() }),
    );
    expect(readFileSync(outputPath, "utf8")).toBe(output);
    expect(output).toContain("nested-package@3.0.0\nLicensed under BSD-3-Clause.\n");
  });

  test("uses deterministic LICENSE, LICENCE, and COPYING precedence", () => {
    const root = makeTempRoot();
    const packageRoot = writePackage(root, "precedence-package", {
      name: "precedence-package",
      version: "1.0.0",
      license: "MIT",
      licenseFilename: "LICENSE-MIT",
      licenseText: "suffix license",
    });
    writeFileSync(path.join(packageRoot, "COPYING"), "copying");
    writeFileSync(path.join(packageRoot, "LICENCE"), "british license");
    writeFileSync(path.join(packageRoot, "LICENSE.md"), "markdown license");
    writeFileSync(path.join(packageRoot, "LICENSE"), "exact license");

    expect(findPackageLicenseFile(packageRoot)).toBe(path.join(packageRoot, "LICENSE"));
  });
});

describe("package notice and license resolution", () => {
  test("copies package license bytes and uses reviewed config only when the file is absent", () => {
    const root = makeTempRoot();
    const licenseText = "UPSTREAM LICENSE\nCopyright Fixture Author\n";
    const packageRoot = writePackage(root, "file-notice", {
      name: "file-notice",
      version: "1.0.0",
      license: "MIT",
      licenseText,
    });
    writePackage(root, "cookie-signature", {
      name: "cookie-signature",
      version: "1.0.7",
      license: "MIT",
      licenseFilename: null,
    });
    const reviewedText = "Copyright &lt;fixture@example.test&gt;\n\nPermission is hereby granted.";
    const config = fixtureConfig({
      notices: [{ package: "cookie-signature", text: reviewedText, source: "fixture README" }],
    });
    const fileRecord = packageRecord(
      "file-notice",
      "1.0.0",
      "MIT",
      relative(root, path.join(packageRoot, "LICENSE")),
    );
    const cookieRecord = packageRecord("cookie-signature", "1.0.7", "MIT", null);

    expect(resolvePackageNotice(fileRecord, { root, config })).toMatchObject({
      text: licenseText,
      source: "package-license-file",
    });
    expect(resolvePackageNotice(cookieRecord, { root, config })).toMatchObject({
      text: reviewedText,
      source: "reviewed-config",
    });

    const output = requireNotices(renderThirdPartyNotices({
      surface: "cli",
      inventory: { surface: "cli", packages: [cookieRecord] },
      config,
      assets: [],
      root,
    }));
    expect(output).toContain("Copyright &lt;fixture@example.test&gt;");
    expect(config.notices[0].text).toBe(reviewedText);

    const realConfig = loadLicenseConfig();
    const realOutput = requireNotices(renderThirdPartyNotices({
      surface: "cli",
      inventory: {
        surface: "cli",
        packages: [packageRecord("cookie-signature", "1.0.7", "MIT", null)],
      },
      config: realConfig,
      assets: [],
      root: repoRoot,
    }));
    expect(realConfig.notices[0].text).toContain("LearnBoost <tj@learnboost.com>");
    expect(realOutput).toContain("LearnBoost <tj@learnboost.com>");
    expect(realOutput).not.toContain("LearnBoost &lt;tj@learnboost.com&gt;");
  });

  test("fails with the package identity when neither license file nor reviewed notice exists", () => {
    const root = makeTempRoot();
    writePackage(root, "missing-notice", {
      name: "missing-notice",
      version: "4.5.6",
      license: "MIT",
      licenseFilename: null,
    });
    const record = packageRecord("missing-notice", "4.5.6", "MIT", null);

    expect(() => resolvePackageNotice(record, { root, config: fixtureConfig() })).toThrow(
      /missing-notice@4\.5\.6.*license file.*reviewed notice/i,
    );
  });

  test("applies an exact election and reports declaration drift", () => {
    const config = fixtureConfig({
      elections: [{
        package: "dual-package",
        offered: "(MPL-2.0 OR Apache-2.0)",
        elected: "Apache-2.0",
      }],
    });

    expect(resolvePackageLicense(
      packageRecord("dual-package", "1.0.0", "(MPL-2.0 OR Apache-2.0)", "/fixture/LICENSE"),
      config,
    )).toEqual({ license: "Apache-2.0", drift: null });

    expect(resolvePackageLicense(
      packageRecord("dual-package", "2.0.0", "MPL-2.0", "/fixture/LICENSE"),
      config,
    )).toEqual({
      license: "MPL-2.0",
      drift: {
        kind: "election",
        expected: "(MPL-2.0 OR Apache-2.0)",
        actual: "MPL-2.0",
      },
    });
  });

  test("reproduces an Apache package's license and NOTICE bytes", () => {
    const root = makeTempRoot();
    const licenseText = "Apache License\nVersion 2.0, January 2004\n";
    const noticeText = "Synthetic Apache Component\nCopyright 2026 Fixture Author\n";
    const packageRoot = writePackage(root, "apache-package", {
      name: "apache-package",
      version: "1.2.3",
      license: "Apache-2.0",
      licenseText,
      noticeText,
    });
    const record = packageRecord(
      "apache-package",
      "1.2.3",
      "Apache-2.0",
      relative(root, path.join(packageRoot, "LICENSE")),
    );

    const output = requireNotices(renderThirdPartyNotices({
      surface: "web",
      inventory: { surface: "web", packages: [record] },
      config: fixtureConfig(),
      assets: [],
      root,
    }));
    expect(output).toContain(licenseText);
    expect(output).toContain(noticeText);
    expect(output.indexOf(licenseText)).toBeLessThan(output.indexOf(noticeText));
  });
});

describe("notice rendering", () => {
  test("renders bundler and asset entries in one reader-facing shape", () => {
    const root = makeTempRoot();
    writeFileSync(path.join(root, "licensed.js"), "fixture");
    const packageRoot = writePackage(root, "bundled-component", {
      name: "bundled-component",
      version: "1.2.3",
      license: "MIT",
      licenseText: "BUNDLED COMPONENT TERMS\n",
    });
    const output = requireNotices(renderThirdPartyNotices({
      surface: "source",
      inventory: {
        surface: "source",
        packages: [packageRecord(
          "bundled-component",
          "1.2.3",
          "MIT",
          relative(root, path.join(packageRoot, "LICENSE")),
        )],
      },
      config: fixtureConfig(),
      assets: assetFixtures(),
      root,
    }));

    const metadata = entryMetadata(output);
    expect(metadata).toContainEqual(["bundled-component@1.2.3", "Licensed under MIT."]);
    expect(metadata).toContainEqual(["Licensed fixture asset", "Licensed under MIT."]);
    expect(output).toContain("BUNDLED COMPONENT TERMS\n");
    expect(output).toContain("FULL LICENSED ASSET TERMS\nCopyright Fixture Asset Author\n");
    expect(output).not.toMatch(/^(?:PACKAGE|ASSET|DESCRIPTION|ORIGIN|COMPONENT|LICENSE|NOTICE SOURCE):/m);
    expect(output).not.toContain("licensed-asset");
  });

  test("renders multiple package-free components under their own names", () => {
    const assets: VendoredAsset[] = [{
      id: "multi-component-bundle",
      paths: ["bundle.js"],
      components: [
        { name: "First embedded project", license: "MIT", noticeText: "First project terms" },
        { name: "Second embedded project", license: "ISC", noticeText: "Second project terms" },
      ],
      surfaces: ["source"],
    }];
    const output = requireNotices(renderThirdPartyNotices({
      surface: "source",
      inventory: { surface: "source", packages: [] },
      config: fixtureConfig(),
      assets,
      root: makeTempRoot(),
    }));

    expect(entryMetadata(output)).toEqual([
      ["First embedded project", "Licensed under MIT."],
      ["Second embedded project", "Licensed under ISC."],
    ]);
    expect(output).not.toContain("multi-component-bundle");
  });

  test("renders an inventory-and-asset duplicate once and rejects disagreements", () => {
    const root = makeTempRoot();
    const packageRoot = writePackage(root, "shared-package", {
      name: "shared-package",
      version: "1.2.3",
      license: "MIT",
      licenseText: "Shared package terms\n",
    });
    const inventory: SurfaceInventory = {
      surface: "web",
      packages: [packageRecord(
        "shared-package",
        "1.2.3",
        "MIT",
        relative(root, path.join(packageRoot, "LICENSE")),
      )],
    };
    const sharedComponent = {
      package: "shared-package",
      version: "1.2.3",
      license: "MIT",
      noticeText: "Shared package terms\n",
    };
    const assets: VendoredAsset[] = [{
      id: "shared-package-assets",
      paths: ["shared.js"],
      components: [sharedComponent],
      surfaces: ["web"],
    }];

    const output = requireNotices(renderThirdPartyNotices({
      surface: "web",
      inventory,
      config: fixtureConfig(),
      assets,
      root,
    }));
    expect(entryMetadata(output).filter(([name]) => name === "shared-package@1.2.3")).toHaveLength(1);

    for (const component of [
      { ...sharedComponent, license: "ISC" },
      { ...sharedComponent, noticeText: "Conflicting terms\n" },
    ]) {
      expect(() => renderThirdPartyNotices({
        surface: "web",
        inventory,
        config: fixtureConfig(),
        assets: [{ ...assets[0], components: [component] }],
        root,
      })).toThrow(/shared-package@1\.2\.3.*disagree/i);
    }
  });

  test("sorts entries case-insensitively into byte-identical output", () => {
    const root = makeTempRoot();
    const config = fixtureConfig();
    const firstRoot = writePackage(root, "z-package", {
      name: "z-package",
      version: "1.0.0",
      license: "MIT",
      licenseText: "Z package terms\n",
    });
    const secondRoot = writePackage(root, "a-package", {
      name: "a-package",
      version: "2.0.0",
      license: "MIT",
      licenseText: "A package terms\n",
    });
    const packages = [
      packageRecord("z-package", "1.0.0", "MIT", relative(root, path.join(firstRoot, "LICENSE"))),
      packageRecord("a-package", "2.0.0", "MIT", relative(root, path.join(secondRoot, "LICENSE"))),
    ];
    const assets = assetFixtures();

    const first = renderThirdPartyNotices({
      surface: "source",
      inventory: { surface: "source", packages },
      config,
      assets,
      root,
    });
    const second = renderThirdPartyNotices({
      surface: "source",
      inventory: { surface: "source", packages: [...packages].reverse() },
      config,
      assets: [...assets].reverse(),
      root,
    });
    expect(second).toBe(first);
    const names = entryMetadata(requireNotices(first)).map(([name]) => name);
    expect(names).toEqual(["a-package@2.0.0", "Licensed fixture asset", "z-package@1.0.0"]);
  });

  // proofs/arch/licensing.md#^licensing-t-generator-contract
  test("renders one notices file per declared folder from the assets naming it", () => {
    const root = makeTempRoot();
    const config = fixtureConfig();
    const asset = (id: string, name: string, noticesFolder?: string): VendoredAsset => ({
      id,
      paths: ["asset.js"],
      components: [{ name, license: "MIT", noticeText: `${name} terms\n` }],
      surfaces: ["source"],
      ...(noticesFolder === undefined ? {} : { noticesFolder }),
    });
    const assets = [
      asset("record-one", "Fixture palette", "themes/fixture"),
      asset("record-two", "Fixture wallpaper", "themes/fixture"),
      asset("record-three", "Unrelated material"),
    ];
    mkdirSync(path.join(root, "themes/fixture"), { recursive: true });

    const folders = generateFolderNotices({ root, config, assets, write: true });
    expect(folders.map((entry) => entry.folder)).toEqual(["themes/fixture"]);
    const written = readFileSync(path.join(root, "themes/fixture/THIRD-PARTY-NOTICES.txt"), "utf8");
    expect(written).toBe(folders[0].text);
    expect(written).toBe(renderThirdPartyNotices({
      surface: "source",
      inventory: { surface: "source", packages: [] },
      config,
      assets: assets.slice(0, 2),
      root,
    }));
    expect(entryMetadata(written).map(([name]) => name)).toEqual(["Fixture palette", "Fixture wallpaper"]);
    expect(written).not.toContain("Unrelated material");
    expect(written).not.toMatch(/record-(?:one|two)|noticesFolder|themes\/fixture/);

    expect(generateFolderNotices({ root, config, assets: [assets[2]], write: true })).toEqual([]);
  });

  test("regenerates the committed theme folder notices byte-for-byte", () => {
    const folders = generateFolderNotices({ root: repoRoot });
    expect(folders.map((entry) => entry.folder)).toEqual([
      "packages/server/assets/themes/clouds",
      "packages/server/assets/themes/nord",
      "packages/server/assets/themes/tokyo-night",
    ]);
    for (const { folder, text } of folders) {
      expect(readFileSync(path.join(repoRoot, folder, "THIRD-PARTY-NOTICES.txt"), "utf8")).toBe(text);
    }
    const clouds = folders.find((entry) => entry.folder.endsWith("/clouds"))!.text;
    const tailwind = loadAssetManifest().find((asset) => asset.id === "clouds-theme")!
      .components.find((component) => component.name === "Tailwind CSS color palette")!;
    expect(entryMetadata(clouds).filter(([name]) => name === "Tailwind CSS color palette"))
      .toEqual([["Tailwind CSS color palette", "Licensed under MIT."]]);
    expect(clouds).toContain(tailwind.noticeText);
    const nord = folders.find((entry) => entry.folder.endsWith("/nord"))!.text;
    expect(entryMetadata(nord)).toEqual([["Nord color palette", "Licensed under MIT."]]);
    expect(nord).toContain("Copyright (c) 2016-present Sven Greb");
  });

  test("regenerates the committed source-surface notices byte-for-byte", () => {
    const generated = generateSourceNotices({ root: repoRoot });
    const committed = readFileSync(path.join(repoRoot, "THIRD-PARTY-NOTICES.txt"), "utf8");

    expect(generated).toBe(committed);
    const notices = requireNotices(generated);
    expect(notices).toContain("Hind variable font\nLicensed under OFL-1.1.");
    expect(notices).toContain("SIL OPEN FONT LICENSE Version 1.1");
    expect(notices).toContain("@phosphor-icons/core@2.1.1\nLicensed under MIT.");
    expect(notices).toContain("Nord color palette\nLicensed under MIT.");
    expect(notices).not.toMatch(/(?:@lit\/reactive-element|lit-element|lit-html)@/);
    expect(notices).not.toContain("@rupertsworld/");
    const renderedNames = entryMetadata(notices).map(([name]) => name);
    expect(renderedNames.filter((name) => name === "Tailwind CSS color palette")).toHaveLength(1);
    expect(notices).toContain("Copyright (c) Tailwind Labs, Inc.");
    for (const asset of loadAssetManifest().filter((entry) => entry.surfaces.includes("source"))) {
      expect(renderedNames).not.toContain(asset.id);
      for (const component of asset.components) expect(notices).toContain(component.noticeText);
    }
  });
});

function createInventoryTree(): string {
  const root = makeTempRoot();
  writePackage(root, "plain-package", {
    name: "plain-package",
    version: "1.0.0",
    license: "MIT",
    licenseText: "Plain package MIT terms\n",
  });
  writePackage(root, "@fixture/scoped-package", {
    name: "@fixture/scoped-package",
    version: "2.0.0",
    license: "ISC",
    licenseFilename: "LICENSE.md",
    licenseText: "Scoped package ISC terms\n",
  });
  writePackage(root, "outer-package", {
    name: "outer-package",
    version: "1.0.0",
    license: "MIT",
    licenseText: "Outer package MIT terms\n",
  });
  writePackage(root, "outer-package/node_modules/nested-package", {
    name: "nested-package",
    version: "3.0.0",
    license: "BSD-3-Clause",
    licenseFilename: "COPYING",
    licenseText: "Nested package BSD terms\n",
  });
  writePackage(root, "tree-shaken-package", {
    name: "tree-shaken-package",
    version: "9.0.0",
    license: "MIT",
    licenseText: "Tree-shaken package terms\n",
  });
  return root;
}

function writePackage(
  root: string,
  modulePath: string,
  options: {
    name: string;
    version: string;
    license: string | null;
    licenseFilename?: string | null;
    licenseText?: string;
    noticeText?: string;
  },
): string {
  const packageRoot = path.join(root, "node_modules", ...modulePath.split("/"));
  mkdirSync(path.join(packageRoot, "src"), { recursive: true });
  const manifest: Record<string, unknown> = { name: options.name, version: options.version };
  if (options.license !== null) manifest.license = options.license;
  writeJSON(path.join(packageRoot, "package.json"), manifest);
  writeFileSync(path.join(packageRoot, "index.js"), "export const fixture = true;\n");
  writeFileSync(path.join(packageRoot, "src/index.js"), "export const nestedFixture = true;\n");
  if (options.licenseFilename !== null) {
    writeFileSync(path.join(packageRoot, options.licenseFilename ?? "LICENSE"), options.licenseText ?? "fixture terms\n");
  }
  if (options.noticeText !== undefined) writeFileSync(path.join(packageRoot, "NOTICE"), options.noticeText);
  return packageRoot;
}

function assetFixtures(): VendoredAsset[] {
  return [{
    id: "licensed-asset",
    paths: ["licensed.js"],
    components: [{
      name: "Licensed fixture asset",
      license: "MIT",
      noticeText: "FULL LICENSED ASSET TERMS\nCopyright Fixture Asset Author\n",
    }],
    surfaces: ["source"],
  }];
}

function fixtureConfig(overrides: Partial<LicenseConfig> = {}): LicenseConfig {
  return {
    allow: ["MIT", "ISC", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "OFL-1.1"],
    elections: [],
    notices: [],
    ignored: [],
    ...overrides,
  };
}

function packageRecord(
  name: string,
  version: string,
  declaredLicense: string | null,
  licenseFilePath: string | null,
): SurfaceInventory["packages"][number] {
  return { name, version, declaredLicense, licenseFilePath };
}

function requireNotices(value: string | null): string {
  if (value === null) throw new Error("Expected generated notices");
  return value;
}

function entryMetadata(notice: string): string[][] {
  return notice.split(/^={80}$/m).slice(1).map((section) => (
    section.split(/^-{80}$/m, 1)[0].trim().split("\n")
  ));
}

function relative(root: string, file: string): string {
  return path.relative(root, file).split(path.sep).join("/");
}

function readJSON<T>(file: string): T {
  return JSON.parse(readFileSync(file, "utf8")) as T;
}

function writeJSON(file: string, value: unknown): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

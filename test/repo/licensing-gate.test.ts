import { spawnSync } from "node:child_process";
import {
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
  generateSourceNotices,
} from "../../scripts/licenses/generate-notices.mjs";
import type {
  LicenseConfig,
  VendoredAsset,
} from "../../scripts/licenses/lib/config.mjs";
import {
  evaluateLicenseGate,
  type LicenseGateResult,
} from "../../scripts/licenses/lib/gate.mjs";
import {
  writeSurfaceInventory,
  type SurfaceInventory,
  type SurfaceInventoryPackage,
} from "../../scripts/licenses/lib/inventory.mjs";
import { LICENSE_INVENTORY_SURFACES } from "../../scripts/licenses/lib/surfaces.mjs";

const repoRoot = path.resolve(import.meta.dirname, "../..");
const tempRoots: string[] = [];

function makeTempRoot(): string {
  const root = mkdtempSync(path.join(os.tmpdir(), "tv-license-gate-"));
  tempRoots.push(root);
  writePublicManifest(root, "cli", {});
  writePublicManifest(root, "desktop", {});
  return root;
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("license gate", () => {
  // proofs/arch/licensing.md#^licensing-t-gate-contract
  test("fails when a declared surface inventory is missing", () => {
    const root = makeTempRoot();
    const inventoryRoot = path.join(root, ".licenses-inventory");
    for (const inventory of completeInventories([]).filter((entry) => entry.surface !== "web")) {
      writeSurfaceInventory(inventoryRoot, inventory);
    }

    const result = evaluateLicenseGate({
      root,
      inventoryRoot,
      config: fixtureConfig(),
      assets: [],
      checkSourceNotice: false,
    });

    expect(result.errors).toContain("missing declared license surface: web");
  });

  test("accepts allowed packages and aggregates disallowed, unknown, and unresolved notices", () => {
    const root = makeTempRoot();
    const allowed = writePackage(root, "allowed-package", "1.0.0", "MIT");
    expect(runGate(root, [allowed]).errors).toEqual([]);

    const disallowed = writePackage(root, "gpl-package", "2.0.0", "GPL-3.0-only");
    const unknown = packageRecord("unknown-package", "3.0.0", null, null);
    writePackageManifest(root, "missing-notice", "4.0.0", "MIT");
    const missingNotice = packageRecord("missing-notice", "4.0.0", "MIT", null);
    const result = runGate(root, [disallowed, unknown, missingNotice]);
    const errors = result.errors.join("\n");

    expect(result.ok).toBe(false);
    expect(errors).toMatch(/gpl-package@2\.0\.0.*GPL-3\.0-only.*not allowed/i);
    expect(errors).toMatch(/unknown-package@3\.0\.0.*license.*could not be determined/i);
    expect(errors).toMatch(/missing-notice@4\.0\.0.*license file.*reviewed notice/i);
  });

  test("uses generator drift results for election declaration failures", () => {
    const root = makeTempRoot();
    const config = fixtureConfig({
      elections: [{
        package: "dual-package",
        offered: "(MPL-2.0 OR Apache-2.0)",
        elected: "Apache-2.0",
      }],
    });
    const dual = writePackage(root, "dual-package", "1.0.0", "(MPL-2.0 OR Apache-2.0)");

    expect(runGate(root, [dual], { config }).errors).toEqual([]);

    const drifted = runGate(root, [
      { ...dual, version: "2.0.0", declaredLicense: "MPL-2.0" },
    ], { config });
    expect(drifted.errors.join("\n")).toMatch(/dual-package@2\.0\.0.*elections entry.*stale.*MPL-2.0/i);
  });

  test("detects dead config entries by category rather than installed-tree presence", () => {
    const root = makeTempRoot();
    const stalePackages = ["dead-election", "dead-notice"];
    for (const packageName of stalePackages) writePackageManifest(root, packageName, "1.0.0", "MIT");
    const config = fixtureConfig({
      elections: [{ package: "dead-election", offered: "MIT OR ISC", elected: "MIT" }],
      notices: [{ package: "dead-notice", text: "Fixture terms", source: "Fixture source" }],
      ignored: [{ pattern: "@currently-absent/*" }],
    });
    const live = writePackage(root, "live-package", "1.0.0", "MIT");
    const errors = runGate(root, [live], { config }).errors.join("\n");

    expect(errors).toContain("dead elections entry: dead-election");
    expect(errors).toContain("dead notices entry: dead-notice");
    expect(errors).not.toMatch(/dead ignored/i);
  });

  test("keeps each config category alive only through its declared domain", () => {
    const root = makeTempRoot();
    const config = fixtureConfig({
      elections: [{ package: "dual-package", offered: "MIT OR ISC", elected: "MIT" }],
      notices: [{ package: "notice-package", text: "Reviewed fixture terms", source: "Fixture README" }],
      ignored: [{ pattern: "@fixture/*" }],
    });
    const packages = [
      writePackage(root, "dual-package", "1.0.0", "MIT OR ISC"),
      packageRecord("notice-package", "1.0.0", "MIT", null),
    ];
    writePackageManifest(root, "notice-package", "1.0.0", "MIT");
    expect(runGate(root, packages, { config }).errors).toEqual([]);
  });

  test("checks the declared dependencies of the CLI package and the desktop workspace without requiring notices or scanning their closures", () => {
    const root = makeTempRoot();
    writePublicManifest(root, "cli", {
      "permitted-package": "1.0.0",
      "forbidden-package": "1.0.0",
      "ignored-package": "1.0.0",
    });
    writePublicManifest(root, "desktop", {
      "desktop-permitted-package": "1.0.0",
      "desktop-forbidden-package": "1.0.0",
    });
    writePackageManifest(root, "permitted-package", "1.0.0", "MIT");
    writePackageManifest(root, "forbidden-package", "1.0.0", "GPL-3.0-only");
    writePackageManifest(root, "desktop-permitted-package", "1.0.0", "MIT");
    writePackageManifest(root, "desktop-forbidden-package", "1.0.0", "GPL-3.0-only");
    const permittedRoot = path.join(root, "node_modules/permitted-package");
    writePackageManifest(permittedRoot, "transitive-package", "1.0.0", "GPL-3.0-only");
    const config = fixtureConfig({
      ignored: [{ pattern: "ignored-package" }],
    });

    const errors = runGate(root, [], { config }).errors.join("\n");
    expect(errors).toMatch(/declared dependency.*forbidden-package@1\.0\.0.*GPL-3\.0-only.*not allowed/i);
    expect(errors).toMatch(/declared dependency.*desktop-forbidden-package@1\.0\.0.*GPL-3\.0-only.*not allowed/i);
    expect(errors).not.toContain("permitted-package");
    expect(errors).not.toContain("transitive-package");
    expect(errors).not.toContain("ignored-package");
  });

  test("fails when a handled declared dependency is not installed", () => {
    const root = makeTempRoot();
    writePublicManifest(root, "cli", { "missing-package": "1.0.0" });
    expect(runGate(root, []).errors.join("\n")).toMatch(/declared dependency.*missing-package.*not installed/i);

    const desktopRoot = makeTempRoot();
    writePublicManifest(desktopRoot, "desktop", { "missing-desktop-package": "1.0.0" });
    expect(runGate(desktopRoot, []).errors.join("\n")).toMatch(/declared dependency.*missing-desktop-package.*not installed/i);
  });

  test("compares generated source notices byte-for-byte with the committed file", () => {
    const root = makeTempRoot();
    const config = fixtureConfig();
    const assets: VendoredAsset[] = [];
    expect(generateSourceNotices({ root, config, assets })).toBeNull();
    expect(() => readFileSync(path.join(root, "THIRD-PARTY-NOTICES.txt"), "utf8")).toThrow();

    const passing = evaluateLicenseGate({
      root,
      inventories: completeInventories([]),
      config,
      assets,
    });
    expect(passing.errors).toEqual([]);

    writeFileSync(path.join(root, "THIRD-PARTY-NOTICES.txt"), "stale notice\n");
    const stale = evaluateLicenseGate({
      root,
      inventories: completeInventories([]),
      config,
      assets,
    });
    expect(stale.errors.join("\n")).toMatch(/THIRD-PARTY-NOTICES\.txt.*stale/i);
  });

  // proofs/arch/licensing.md#^licensing-t-gate-contract
  test("fails when a folder notices file is missing or stale and passes when it is current", () => {
    const root = makeTempRoot();
    const config = fixtureConfig();
    mkdirSync(path.join(root, "theme"));
    const assets: VendoredAsset[] = [{
      id: "fixture-theme",
      paths: ["theme"],
      components: [{ name: "Fixture palette", license: "MIT", noticeText: "Fixture palette terms\n" }],
      surfaces: ["source"],
      noticesFolder: "theme",
    }];
    const evaluate = () => evaluateLicenseGate({ root, inventories: completeInventories([]), config, assets });
    writeFileSync(path.join(root, "THIRD-PARTY-NOTICES.txt"), generateSourceNotices({ root, config, assets })!);

    expect(evaluate().errors.join("\n")).toMatch(/theme[\\/]THIRD-PARTY-NOTICES\.txt.*could not be read/i);

    writeFileSync(path.join(root, "theme/THIRD-PARTY-NOTICES.txt"), "stale notice\n");
    expect(evaluate().errors.join("\n")).toMatch(/theme[\\/]THIRD-PARTY-NOTICES\.txt.*stale/i);

    generateFolderNotices({ root, config, assets, write: true });
    expect(evaluate().errors).toEqual([]);
  });

  test("check process exits nonzero and reports every disallowed package", () => {
    const root = makeTempRoot();
    const config = fixtureConfig();
    const assets: VendoredAsset[] = [];
    writeJSON(path.join(root, "scripts/licenses/config.json"), config);
    writeJSON(path.join(root, "scripts/licenses/assets.json"), assets);
    expect(generateSourceNotices({ root, config, assets })).toBeNull();
    const first = writePackage(root, "bad-one", "1.0.0", "GPL-3.0-only");
    const second = writePackage(root, "bad-two", "2.0.0", "CC-BY-NC-4.0");
    for (const inventory of completeInventories([first, second])) {
      writeSurfaceInventory(path.join(root, ".licenses-inventory"), inventory);
    }

    const result = spawnSync(process.execPath, [
      path.join(repoRoot, "scripts/licenses/check.mjs"),
      "--root",
      root,
    ], { encoding: "utf8" });

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("checked license surface: cli");
    expect(result.stderr).toContain("bad-one@1.0.0");
    expect(result.stderr).toContain("bad-two@2.0.0");
  });
});

function runGate(
  root: string,
  packages: SurfaceInventoryPackage[],
  options: { config?: LicenseConfig; assets?: VendoredAsset[] } = {},
): LicenseGateResult {
  return evaluateLicenseGate({
    root,
    inventories: completeInventories(packages),
    config: options.config ?? fixtureConfig(),
    assets: options.assets ?? [],
    checkSourceNotice: false,
  });
}

function completeInventories(packages: SurfaceInventoryPackage[]): SurfaceInventory[] {
  return LICENSE_INVENTORY_SURFACES.map((surface) => ({ surface, packages: surface === "cli" ? packages : [] }));
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

function writePackage(
  root: string,
  name: string,
  version: string,
  license: string | null,
): SurfaceInventoryPackage {
  const packageRoot = writePackageManifest(root, name, version, license);
  const licensePath = path.join(packageRoot, "LICENSE");
  writeFileSync(licensePath, `License terms for ${name}\n`);
  return packageRecord(name, version, license, relative(root, licensePath));
}

function writePackageManifest(root: string, name: string, version: string, license: string | null): string {
  const packageRoot = path.join(root, "node_modules", ...name.split("/"));
  mkdirSync(packageRoot, { recursive: true });
  const manifest: Record<string, unknown> = { name, version };
  if (license !== null) manifest.license = license;
  writeJSON(path.join(packageRoot, "package.json"), manifest);
  return packageRoot;
}

function writePublicManifest(root: string, packageDirectory: "cli" | "desktop", dependencies: Record<string, string>): void {
  writeJSON(path.join(root, `packages/${packageDirectory}/package.json`), {
    name: `@fixture/${packageDirectory}`,
    version: "1.0.0",
    dependencies,
  });
}

function packageRecord(
  name: string,
  version: string,
  declaredLicense: string | null,
  licenseFilePath: string | null,
): SurfaceInventoryPackage {
  return { name, version, declaredLicense, licenseFilePath };
}

function relative(root: string, file: string): string {
  return path.relative(root, file).split(path.sep).join("/");
}

function writeJSON(file: string, value: unknown): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

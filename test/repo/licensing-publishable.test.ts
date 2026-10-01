import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import type { LicenseConfig } from "../../scripts/licenses/lib/config.mjs";
import { renderThirdPartyNotices } from "../../scripts/licenses/lib/notices.mjs";

const repoRoot = path.resolve(import.meta.dirname, "../..");
const checkerPath = path.join(repoRoot, "scripts/check-publishable.mjs");
const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const fixtureLicense = "Fixture MIT license terms\n";
const fixtureDependency = {
  name: "fixture-dependency",
  version: "1.0.0",
  declaredLicense: "MIT",
  licenseFilePath: "node_modules/fixture-dependency/LICENSE",
};

describe("publishable manifest lint", () => {
  test("manifest checker requires MIT on the root and every public or private workspace", () => {
    const cases = [
      { target: "root", license: undefined },
      { target: "root", license: "Apache-2.0" },
      { target: "public", license: undefined },
      { target: "public", license: "ISC" },
      { target: "private", license: undefined },
      { target: "private", license: "UNLICENSED" },
    ] as const;

    for (const fixtureCase of cases) {
      const licenses = { root: "MIT", public: "MIT", private: "MIT" } as Record<string, string | undefined>;
      licenses[fixtureCase.target] = fixtureCase.license;
      const fixture = makeFixture({ licenses });
      const result = runManifestCheck(fixture);

      expect(
        result.status,
        `${fixtureCase.target}=${String(fixtureCase.license)}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
      ).toBe(1);
      expect(result.stderr).toMatch(new RegExp(`${fixtureCase.target === "root" ? "package" : fixtureCase.target}.*license.*MIT`, "is"));
    }
  });

  test("manifest checker passes the real repository tree", () => {
    const result = runManifestCheck(repoRoot, checkerPath);

    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(result.stdout).toContain("manifest lint passed");
  });

  test("manifest checker requires engines.node on every publishable workspace", () => {
    const fixture = makeFixture({
      licenses: { root: "MIT", public: "MIT", private: "MIT" },
      publicNodeEngine: null,
    });
    const result = runManifestCheck(fixture);

    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/@fixture\/public.*engines\.node/is);
  });

  test("manifest checker retains the private-workspace runtime dependency rule", () => {
    const fixture = makeFixture({
      licenses: { root: "MIT", public: "MIT", private: "MIT" },
      publicDependencies: { "@fixture/private": "*" },
    });
    const result = runManifestCheck(fixture);

    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/public.*private workspace package @fixture\/private.*dependencies/is);
  });
});

describe("publishable tarball licensing", () => {
  test("takes each package surface from the shared declaration", () => {
    const fixture = makeFixture({
      licenses: { root: "MIT", public: "MIT", private: "MIT" },
    });
    const surfacesPath = path.join(fixture, "scripts/licenses/lib/surfaces.mjs");
    writeFileSync(
      surfacesPath,
      readFileSync(surfacesPath, "utf8").replace(
        'packageDirectory: "packages/cli"',
        'packageDirectory: "packages/not-cli"',
      ),
    );

    const result = runTarballCheck(fixture);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/no licensing surface is declared.*@fixture\/public.*packages\/cli/is);
  });

  test("names the package that needs building when a declared inventory is missing", () => {
    const fixture = makeFixture({
      licenses: { root: "MIT", public: "MIT", private: "MIT" },
    });
    rmSync(path.join(fixture, ".licenses-inventory/web.json"));

    const result = runTarballCheck(fixture);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/@fixture\/public.*build/i);
    expect(result.stderr).not.toContain("ENOENT");
  });

  test("tarball checker reads required legal bytes from the packed artifact", () => {
    const failures = [
      {
        name: "missing package license",
        options: { packageLicense: null },
        expected: /packed tarball.*LICENSE.*missing/is,
      },
      {
        name: "mismatched package license",
        options: { packageLicense: "Different license bytes\n" },
        expected: /packed tarball.*LICENSE.*byte-identical/is,
      },
      {
        name: "missing package notices",
        options: { packageNotices: null },
        expected: /packed tarball.*dist\/THIRD-PARTY-NOTICES\.txt.*missing/is,
      },
      {
        name: "empty package notices",
        options: { packageNotices: "" },
        expected: /packed tarball.*dist\/THIRD-PARTY-NOTICES\.txt.*empty/is,
      },
    ] as const;

    for (const fixtureCase of failures) {
      const fixture = makeFixture({
        licenses: { root: "MIT", public: "MIT", private: "MIT" },
        ...fixtureCase.options,
      });
      const result = runTarballCheck(fixture);
      expect(
        result.status,
        `${fixtureCase.name}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
      ).toBe(1);
      expect(result.stderr).toMatch(fixtureCase.expected);
    }

    const passingFixture = makeFixture({
      licenses: { root: "MIT", public: "MIT", private: "MIT" },
    });
    const passing = runTarballCheck(passingFixture);
    expect(passing.status, `${passing.stdout}\n${passing.stderr}`).toBe(0);
    expect(passing.stdout).toContain("tarball check passed for @fixture/public");

    const emptySurface = makeFixture({
      licenses: { root: "MIT", public: "MIT", private: "MIT" },
      includeEntries: false,
      packageNotices: null,
    });
    const emptyPassing = runTarballCheck(emptySurface);
    expect(emptyPassing.status, `${emptyPassing.stdout}\n${emptyPassing.stderr}`).toBe(0);

    const unexpectedNotice = makeFixture({
      licenses: { root: "MIT", public: "MIT", private: "MIT" },
      includeEntries: false,
      packageNotices: "Unexpected notice\n",
    });
    const unexpected = runTarballCheck(unexpectedNotice);
    expect(unexpected.status).toBe(1);
    expect(unexpected.stderr).toMatch(/notices.*exists.*no third-party entries/is);
  }, 60_000);
});

function makeFixture({
  licenses,
  publicDependencies = {},
  publicNodeEngine = ">=22",
  packageLicense = fixtureLicense,
  packageNotices = "generated",
  includeEntries = true,
}: {
  licenses: Record<"root" | "public" | "private", string | undefined>;
  publicDependencies?: Record<string, string>;
  publicNodeEngine?: string | null;
  packageLicense?: string | null;
  packageNotices?: "generated" | string | null;
  includeEntries?: boolean;
}): string {
  const root = mkdtempSync(path.join(os.tmpdir(), "tv-publishable-manifest-"));
  tempRoots.push(root);
  mkdirSync(path.join(root, "scripts"), { recursive: true });
  copyFileSync(checkerPath, path.join(root, "scripts/check-publishable.mjs"));
  cpSync(path.join(repoRoot, "scripts/licenses"), path.join(root, "scripts/licenses"), { recursive: true });
  writeFileSync(path.join(root, "LICENSE"), fixtureLicense);

  writeJSON(path.join(root, "package.json"), manifest({
    name: "fixture-root",
    version: "1.0.0",
    private: true,
    workspaces: ["packages/*"],
    license: licenses.root,
  }));
  writeJSON(path.join(root, "packages/cli/package.json"), manifest({
    name: "@fixture/public",
    version: "1.0.0",
    engines: publicNodeEngine === null ? undefined : { node: publicNodeEngine },
    dependencies: publicDependencies,
    license: licenses.public,
  }));
  writeJSON(path.join(root, "packages/private/package.json"), manifest({
    name: "@fixture/private",
    version: "1.0.0",
    private: true,
    license: licenses.private,
  }));
  if (packageLicense !== null) writeFileSync(path.join(root, "packages/cli/LICENSE"), packageLicense);

  const config: LicenseConfig = {
    allow: ["MIT"],
    elections: [],
    notices: [],
    ignored: [],
  };
  writeJSON(path.join(root, "scripts/licenses/config.json"), config);
  writeJSON(path.join(root, "scripts/licenses/assets.json"), []);
  mkdirSync(path.join(root, "node_modules/fixture-dependency"), { recursive: true });
  writeJSON(path.join(root, "node_modules/fixture-dependency/package.json"), {
    name: fixtureDependency.name,
    version: fixtureDependency.version,
    license: fixtureDependency.declaredLicense,
  });
  writeFileSync(path.join(root, fixtureDependency.licenseFilePath), "Fixture dependency terms\n");

  const packages = includeEntries ? [fixtureDependency] : [];
  for (const surface of ["cli", "web", "view:markdown", "skill:tv-calendar", "skill:tv-tasks"]) {
    writeJSON(path.join(root, `.licenses-inventory/${surface}.json`), {
      surface,
      packages: surface === "cli" ? packages : [],
    });
  }
  const generated = renderThirdPartyNotices({
    surface: "cli",
    inventory: { surface: "cli", packages },
    assetSurfaces: ["cli", "web", "view:markdown", "skill:tv-calendar", "skill:tv-tasks"],
    config,
    assets: [],
    root,
  });
  if (packageNotices !== null) {
    const noticePath = path.join(root, "packages/cli/dist/THIRD-PARTY-NOTICES.txt");
    mkdirSync(path.dirname(noticePath), { recursive: true });
    writeFileSync(noticePath, packageNotices === "generated" ? generated ?? "" : packageNotices);
  }
  return root;
}

function manifest(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));
}

function runManifestCheck(root: string, script = path.join(root, "scripts/check-publishable.mjs")) {
  return runChecker(root, script, "--manifest-only");
}

function runTarballCheck(root: string) {
  return runChecker(root, path.join(root, "scripts/check-publishable.mjs"), "--tarballs");
}

function runChecker(root: string, script: string, mode: "--manifest-only" | "--tarballs") {
  return spawnSync(process.execPath, [script, mode], {
    cwd: root,
    encoding: "utf8",
    timeout: 20_000,
  });
}

function writeJSON(file: string, value: unknown): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

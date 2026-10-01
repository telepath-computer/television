import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";

const REPO_ROOT = path.resolve(process.cwd());
const INTERNAL_SCOPE = "@telepath-computer/";
const DEP_FIELDS = ["dependencies", "devDependencies", "peerDependencies"] as const;
const CLOUDS_MANIFEST_PATH = path.join(
  REPO_ROOT,
  "packages/server/assets/themes/clouds/manifest.json",
);

type PackageJSON = {
  name: string;
  version: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
};

function readPackage(packageJsonPath: string): PackageJSON {
  return JSON.parse(readFileSync(packageJsonPath, "utf8")) as PackageJSON;
}

function workspacePackagePaths(): string[] {
  const workspaces = JSON.parse(execFileSync(
    "npm",
    ["query", ".workspace", "--json"],
    { cwd: REPO_ROOT, encoding: "utf8" },
  )) as Array<{ location: string }>;
  return workspaces.map(({ location }) => path.join(REPO_ROOT, location, "package.json"));
}

describe("package version sync", () => {
  it("every workspace package.json version matches the root", () => {
    const root = readPackage(path.join(REPO_ROOT, "package.json"));

    const mismatches = workspacePackagePaths()
      .map((pkgPath) => ({ pkgPath, pkg: readPackage(pkgPath) }))
      .filter(({ pkg }) => pkg.version !== root.version)
      .map(({ pkgPath, pkg }) => `${pkgPath}: ${pkg.version}`);

    expect(mismatches, `expected every workspace to be at ${root.version}; mismatches:\n${mismatches.join("\n")}`).toEqual([]);
  });

  it("keeps Clouds package and authored-against versions independent of app releases", () => {
    expect(JSON.parse(readFileSync(CLOUDS_MANIFEST_PATH, "utf8"))).toEqual({
      name: "Clouds",
      version: "2.1.0",
      colorScheme: "light dark",
      authoredForAppVersion: "1.3.1",
    });
  });

  it("every internal @telepath-computer/* dep spec is the wildcard '*'", () => {
    const paths = [path.join(REPO_ROOT, "package.json"), ...workspacePackagePaths()];

    const bad: string[] = [];
    for (const pkgPath of paths) {
      const pkg = readPackage(pkgPath);
      for (const field of DEP_FIELDS) {
        const deps = pkg[field];
        if (!deps) continue;
        for (const [name, spec] of Object.entries(deps)) {
          if (name.startsWith(INTERNAL_SCOPE) && spec !== "*") {
            bad.push(`${pkgPath}: ${field}.${name} = "${spec}"`);
          }
        }
      }
    }

    expect(bad, `expected every internal dep to be "*"; offenders:\n${bad.join("\n")}`).toEqual([]);
  });
});

describe("publish workflow toolchain and safety gates", () => {
  // proofs/arch/updates/index.md#^updates-t-publish-order
  it("publishes only the CLI package, under a version npm does not yet have, after versioning and building", () => {
    const workflow = readFileSync(path.join(REPO_ROOT, ".github/workflows/publish.yml"), "utf8");
    const setupIndex = workflow.indexOf("uses: actions/setup-node@");
    const installIndex = workflow.indexOf("- run: npm ci");
    const syncIndex = workflow.indexOf('npm version "$VERSION" --workspaces --include-workspace-root --no-git-tag-version --allow-same-version');
    const npmHasVersionIndex = workflow.indexOf('npm view "@telepath-computer/television@$VERSION" version');
    const patchIndex = workflow.indexOf("npm version patch --workspaces --include-workspace-root --no-git-tag-version");
    const finalVersionIndex = workflow.lastIndexOf("npm version");
    const dryRunIndex = workflow.indexOf("npm ci --dry-run");
    const buildIndex = workflow.indexOf("TV_NPM_RELEASE=1 npm run build");
    const telemetryGuardIndex = workflow.indexOf("node scripts/check-release-telemetry.mjs packages/cli/dist/cli.cjs");
    const publishIndex = workflow.indexOf("npm publish");

    expect(workflow.match(/uses: actions\/setup-node@/g)).toHaveLength(1);
    expect(workflow).toContain("node-version-file: .nvmrc");
    expect(workflow).not.toMatch(/^\s+node-version:/m);
    expect(workflow).not.toContain("npm@11");
    expect(workflow).not.toMatch(/npx[^\n]*npm/);
    expect(setupIndex).toBeLessThan(installIndex);

    // The version step starts from the CLI manifest's version, sets every
    // workspace to it, and raises the patch number while npm already has it.
    expect(workflow).toContain('VERSION=$(node -p "require(\'./$PKG\').version")');
    expect(workflow).toContain("PKG=packages/cli/package.json");
    expect(workflow).not.toContain("HEAD~1");
    expect(installIndex).toBeLessThan(syncIndex);
    expect(syncIndex).toBeLessThan(npmHasVersionIndex);
    expect(npmHasVersionIndex).toBeLessThan(patchIndex);
    expect(workflow.slice(npmHasVersionIndex - 200, patchIndex)).toMatch(/while npm view/);
    expect(finalVersionIndex).toBeLessThan(dryRunIndex);
    expect(dryRunIndex).toBeLessThan(buildIndex);
    expect(buildIndex).toBeGreaterThan(0);
    expect(telemetryGuardIndex).toBeGreaterThan(buildIndex);
    expect(telemetryGuardIndex).toBeLessThan(publishIndex);
    expect(workflow.slice(telemetryGuardIndex, publishIndex)).not.toContain("npm run build");
    expect(workflow.match(/npm ci --dry-run/g)).toHaveLength(1);
    expect(workflow.match(/npm publish/g)).toHaveLength(1);
    expect(workflow).toContain("npm publish --workspace @telepath-computer/television --access public");
    expect(workflow).not.toContain("television-desktop");

    expect(workflow).toContain("id-token: write");
    expect(workflow).toContain("registry-url: https://registry.npmjs.org");
    expect(workflow).toContain("stale run:");
    expect(workflow).toContain("[skip ci]");
    expect(workflow).toContain("git add -u package-lock.json ':(glob)**/package.json'");
  });

  // proofs/arch/updates/index.md#^updates-t-publish-order
  it("skips every publishing step for a paused or stale commit", () => {
    const workflow = parseYaml(readFileSync(path.join(REPO_ROOT, ".github/workflows/publish.yml"), "utf8")) as {
      jobs: Record<string, { steps: Array<{ id?: string; if?: string; run?: string; uses?: string }> }>;
    };
    const steps = workflow.jobs.publish!.steps;
    const gateIndex = steps.findIndex((step) => step.id === "gate");
    expect(gateIndex).toBeGreaterThanOrEqual(0);

    const gate = steps[gateIndex]!.run ?? "";
    expect(gate).toContain("[ -f .github/PAUSE_PUBLISH ]");
    expect(gate).toContain("git fetch --depth=1 origin main");
    expect(gate).toContain("git cat-file -e FETCH_HEAD:.github/PAUSE_PUBLISH");
    expect(gate).toMatch(/PUBLISH=false/);
    expect(gate).toContain("MAIN_TIP=$(git rev-parse FETCH_HEAD)");
    expect(gate).toContain("HEAD_SHA=$(git rev-parse HEAD)");
    expect(gate).toMatch(/if \[ "\$MAIN_TIP" != "\$HEAD_SHA" \]; then\s+echo [^\n]+\s+PUBLISH=false\s+fi/);
    expect(gate).toContain('echo "publish=$PUBLISH" >> "$GITHUB_OUTPUT"');

    const later = steps.slice(gateIndex + 1);
    expect(later.length).toBeGreaterThan(0);
    for (const step of later) {
      expect(step.if, step.run ?? step.uses).toBe("${{ steps.gate.outputs.publish == 'true' }}");
    }
  });
});

describe("publish workflow bump commands", () => {
  let fixtureRoot: string;

  const PACKAGES = ["pkg-a", "pkg-b"];

  function writeJSON(p: string, value: unknown): void {
    writeFileSync(p, JSON.stringify(value, null, 2) + "\n");
  }

  function seedMonorepo(rootVersion: string, workspaceVersion: string): void {
    writeJSON(path.join(fixtureRoot, "package.json"), {
      name: "root-fixture",
      version: rootVersion,
      private: true,
      workspaces: PACKAGES.map((name) => `packages/${name}`),
    });
    for (const name of PACKAGES) {
      const dir = path.join(fixtureRoot, "packages", name);
      mkdirSync(dir, { recursive: true });
      writeJSON(path.join(dir, "package.json"), {
        name: `@fixture/${name}`,
        version: workspaceVersion,
        private: true,
      });
    }
  }

  function seedCloudsManifest(): string {
    const themeManifestPath = path.join(
      fixtureRoot,
      "packages/pkg-a/assets/themes/clouds/manifest.json",
    );
    mkdirSync(path.dirname(themeManifestPath), { recursive: true });
    writeFileSync(themeManifestPath, readFileSync(CLOUDS_MANIFEST_PATH));
    return themeManifestPath;
  }

  function versionsByFile(): Record<string, string> {
    const paths = [
      path.join(fixtureRoot, "package.json"),
      ...PACKAGES.map((name) => path.join(fixtureRoot, "packages", name, "package.json")),
    ];
    const out: Record<string, string> = {};
    for (const p of paths) {
      out[path.relative(fixtureRoot, p)] = JSON.parse(readFileSync(p, "utf8")).version;
    }
    return out;
  }

  beforeEach(() => {
    fixtureRoot = mkdtempSync(path.join(os.tmpdir(), "tv-version-sync-"));
  });

  afterEach(() => {
    rmSync(fixtureRoot, { recursive: true, force: true });
  });

  it("auto-bump branch bumps root and every workspace together", () => {
    // Mirrors the publish.yml command used when root is unchanged from HEAD~1.
    seedMonorepo("0.1.29", "0.1.29");
    const themeManifestPath = seedCloudsManifest();
    const authoredMetadata = readFileSync(themeManifestPath);

    execFileSync(
      "npm",
      ["version", "patch", "--workspaces", "--include-workspace-root", "--no-git-tag-version"],
      { cwd: fixtureRoot, stdio: "pipe" },
    );

    expect(versionsByFile()).toEqual({
      "package.json": "0.1.30",
      "packages/pkg-a/package.json": "0.1.30",
      "packages/pkg-b/package.json": "0.1.30",
    });
    expect(readFileSync(themeManifestPath)).toEqual(authoredMetadata);
  });

  it("explicit-bump branch syncs workspaces up to an already-bumped root", () => {
    // Mirrors the publish.yml command used when root was manually bumped.
    // Root is already at 0.2.0; workspaces still at 0.1.29 from last release.
    seedMonorepo("0.2.0", "0.1.29");
    const themeManifestPath = seedCloudsManifest();
    const authoredMetadata = readFileSync(themeManifestPath);

    execFileSync(
      "npm",
      ["version", "0.2.0", "--workspaces", "--no-git-tag-version", "--allow-same-version"],
      { cwd: fixtureRoot, stdio: "pipe" },
    );

    expect(versionsByFile()).toEqual({
      "package.json": "0.2.0",
      "packages/pkg-a/package.json": "0.2.0",
      "packages/pkg-b/package.json": "0.2.0",
    });
    expect(readFileSync(themeManifestPath)).toEqual(authoredMetadata);
  });
});

import { createRequire } from "node:module";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  resolveBundledSkillsRoot,
  resolveBundledViewsPath,
  resolveCanonicalDir,
  resolveOnboardingContentPath,
  resolveBundledThemesPath,
  resolveStaticDir,
} from "../../packages/cli/src/index.ts";

// Full-build copy handoffs and asset lookup seams declared by
// [[arch/cli/index.md#^cli-build-web-copy]] through
// [[arch/cli/index.md#^cli-resolve-skills-success]]. Local and Blaxel workers
// run the e2e:node production-build preCommand. GitHub shards deliberately
// skip repeated preCommands and instead restore every packaged and
// producer-side tree below from the same CLI build recipe through
// [[arch/test-runner/github-ci.md#^gha-prebuilt-cli-outputs]]. No provider
// skips a completeness assertion when one of those trees is absent.

const REPO_ROOT = path.resolve(import.meta.dirname, "../..");
const CLI_DIST = path.join(REPO_ROOT, "packages/cli/dist");
const BUILT_CLI = path.join(CLI_DIST, "cli.cjs");
const SOURCE_CLI = path.join(REPO_ROOT, "packages/cli/src/index.ts");
const require = createRequire(import.meta.url);

type Resolver = () => string | undefined;
type BuiltAssetResolvers = {
  resolveStaticDir: Resolver;
  resolveBundledViewsPath: Resolver;
  resolveCanonicalDir: Resolver;
  resolveOnboardingContentPath: Resolver;
  resolveBundledThemesPath: Resolver;
  resolveBundledSkillsRoot: Resolver;
};

function loadBuiltResolvers(): BuiltAssetResolvers {
  const previousVitest = process.env.VITEST;
  process.env.VITEST = "true";
  try {
    return require(BUILT_CLI) as BuiltAssetResolvers;
  } finally {
    if (previousVitest === undefined) delete process.env.VITEST;
    else process.env.VITEST = previousVitest;
  }
}

function withEntryPath<T>(entryPath: string, operation: () => T): T {
  const previous = process.argv[1];
  process.argv[1] = entryPath;
  try {
    return operation();
  } finally {
    process.argv[1] = previous;
  }
}

function listTreeRecursive(root: string, prefix = ""): string[] {
  const entries: string[] = [];
  for (const entry of readdirSync(path.join(root, prefix), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const relative = path.join(prefix, entry.name);
    if (entry.isDirectory()) {
      entries.push(`${relative}${path.sep}`);
      entries.push(...listTreeRecursive(root, relative));
    } else {
      entries.push(relative);
    }
  }
  return entries;
}

function expectByteIdenticalTree(source: string, packaged: string): void {
  expect(existsSync(source), `source tree ${source}`).toBe(true);
  expect(existsSync(packaged), `packaged tree ${packaged}`).toBe(true);
  const sourceEntries = listTreeRecursive(source);
  const sourceFiles = sourceEntries.filter((relative) => !relative.endsWith(path.sep));
  expect(sourceFiles.length, `source files in ${source}`).toBeGreaterThan(0);
  expect(listTreeRecursive(packaged), packaged).toEqual(sourceEntries);
  for (const relative of sourceFiles) {
    const sourceBytes = readFileSync(path.join(source, relative));
    const packagedBytes = readFileSync(path.join(packaged, relative));
    expect(packagedBytes.equals(sourceBytes), `${packaged}/${relative}`).toBe(true);
  }
}

describe("full CLI build asset copies", () => {
  it("copies the complete web application byte-for-byte", () => {
    expectByteIdenticalTree(
      path.join(REPO_ROOT, "packages/web/dist"),
      path.join(CLI_DIST, "web"),
    );
  });

  it("copies the complete markdown viewer byte-for-byte", () => {
    expectByteIdenticalTree(
      path.join(REPO_ROOT, "packages/view-markdown/dist"),
      path.join(CLI_DIST, "views/markdown"),
    );
  });

  it("copies the complete artifact-missing viewer byte-for-byte", () => {
    expectByteIdenticalTree(
      path.join(REPO_ROOT, "packages/web/dist/views/artifact-missing"),
      path.join(CLI_DIST, "views/artifact-missing"),
    );
  });

  it("copies every built canonical version asset tree byte-for-byte", () => {
    const canonicalBuild = path.join(REPO_ROOT, "packages/canonical/dist/canonical");
    const serverBuild = path.join(REPO_ROOT, "packages/server/dist/canonical");
    expectByteIdenticalTree(canonicalBuild, serverBuild);
    expectByteIdenticalTree(serverBuild, path.join(CLI_DIST, "canonical"));
  });

  it("ships the complete bundled theme tree byte-for-byte", () => {
    const source = path.join(REPO_ROOT, "packages/server/assets/themes");
    expectByteIdenticalTree(source, path.join(REPO_ROOT, "packages/server/dist/themes"));
    expectByteIdenticalTree(source, path.join(CLI_DIST, "themes"));
  });

  it("copies every built bundled skill byte-for-byte", () => {
    expectByteIdenticalTree(
      path.join(REPO_ROOT, "packages/skills/dist"),
      path.join(CLI_DIST, "skills"),
    );
  });
});

const builtResolvers = loadBuiltResolvers();
const resolverCases: Array<{
  name: string;
  builtResolver: Resolver;
  builtPath: string;
  devResolver: Resolver;
  devPath: string;
  requiredChildren?: string[];
}> = [
  {
    name: "static web",
    builtResolver: builtResolvers.resolveStaticDir,
    builtPath: path.join(CLI_DIST, "web"),
    devResolver: resolveStaticDir,
    devPath: path.join(REPO_ROOT, "packages/web/dist"),
  },
  {
    name: "bundled views",
    builtResolver: builtResolvers.resolveBundledViewsPath,
    builtPath: path.join(CLI_DIST, "views"),
    devResolver: resolveBundledViewsPath,
    devPath: path.join(REPO_ROOT, "packages/cli/dist/views"),
  },
  {
    name: "canonical assets",
    builtResolver: builtResolvers.resolveCanonicalDir,
    builtPath: path.join(CLI_DIST, "canonical"),
    devResolver: resolveCanonicalDir,
    devPath: path.join(REPO_ROOT, "packages/server/dist/canonical"),
    requiredChildren: ["v1", "v2"],
  },
  {
    name: "onboarding content",
    builtResolver: builtResolvers.resolveOnboardingContentPath,
    builtPath: path.join(CLI_DIST, "onboarding"),
    devResolver: resolveOnboardingContentPath,
    devPath: path.join(REPO_ROOT, "packages/server/assets/onboarding-channels"),
  },
  {
    name: "bundled themes",
    builtResolver: builtResolvers.resolveBundledThemesPath,
    builtPath: path.join(CLI_DIST, "themes"),
    devResolver: resolveBundledThemesPath,
    devPath: path.join(REPO_ROOT, "packages/server/assets/themes"),
  },
  {
    name: "bundled skills",
    builtResolver: builtResolvers.resolveBundledSkillsRoot,
    builtPath: path.join(CLI_DIST, "skills"),
    devResolver: resolveBundledSkillsRoot,
    devPath: path.join(REPO_ROOT, "packages/skills/dist"),
  },
];

describe("CLI asset resolver success layouts", () => {
  it.each(resolverCases)("resolves $name from the built package layout", ({ builtResolver, builtPath, requiredChildren = [] }) => {
    const resolved = withEntryPath(BUILT_CLI, builtResolver);
    expect(resolved).toBe(builtPath);
    for (const child of requiredChildren) {
      expect(existsSync(path.join(resolved!, child)), `${child} under ${resolved}`).toBe(true);
    }
  });

  it.each(resolverCases)("resolves $name from the development layout", ({ devResolver, devPath, requiredChildren = [] }) => {
    const resolved = withEntryPath(SOURCE_CLI, devResolver);
    expect(resolved).toBe(devPath);
    for (const child of requiredChildren) {
      expect(existsSync(path.join(resolved!, child)), `${child} under ${resolved}`).toBe(true);
    }
  });
});

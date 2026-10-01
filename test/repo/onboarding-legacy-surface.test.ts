import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";

// Static guard for the retired single-artifact onboarding runtime
// (notes/onboarding-specs-final-review.md finding 1): the deleted runtime
// symbols must not silently return to production code or build scripts.
// Migration constants and test fixtures are exempt by design: the migration keys on the
// legacy artifact ID, and fixtures reproduce legacy storage states.

const repoRoot = path.resolve(import.meta.dirname, "../..");

// Production code paths: package sources and build scripts. Tests, fixtures,
// docs, specs, and notes are exempt — they legitimately reproduce or describe
// the legacy surface.
const PRODUCTION_ROOTS = [
  "packages/artifact/src",
  "packages/cli/src",
  "packages/cli/build.mjs",
  "packages/cli/build-views.mjs",
  "packages/desktop/src",
  "packages/server/src",
  "packages/server/scripts",
  "packages/shared/src",
  "packages/skillbench/src",
  "packages/skills/skills",
  "packages/web/src",
];

// Symbols of the deleted legacy runtime. `ONBOARDING_ARTIFACT_ID` (the
// migration constant) and the bare `television-onboarding` ID-prefix string
// are deliberately NOT in this list.
const FORBIDDEN_SYMBOLS = [
  "installOnboardingArtifact",
  "onboardingArtifactSourcePath",
  "OnboardingArtifactSourcePath",
  "ONBOARDING_ARTIFACT_DIRNAME",
  "ONBOARDING_ARTIFACT_TITLE",
  "ONBOARDING_SCREEN_NAME",
  "ONBOARDING_ARTIFACT_SENTINEL_VERSION",
  "__TV_ONBOARDING_ARTIFACT_PATH__",
  "getDefaultOnboardingArtifactSourcePath",
  "assets/television-onboarding",
];

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".mjs", ".cjs", ".js", ".sh"]);

function listProductionFiles(): string[] {
  const files: string[] = [];
  const visit = (candidate: string): void => {
    const stats = statSync(candidate);
    if (stats.isFile()) {
      if (SOURCE_EXTENSIONS.has(path.extname(candidate)) && !candidate.endsWith(".test.ts")) {
        files.push(candidate);
      }
      return;
    }
    for (const entry of readdirSync(candidate)) {
      if (entry === "node_modules" || entry === "dist") continue;
      visit(path.join(candidate, entry));
    }
  };
  for (const root of PRODUCTION_ROOTS) {
    const absolute = path.join(repoRoot, root);
    try {
      visit(absolute);
    } catch {
      // A production root may not exist in every checkout shape; the roots
      // that matter are asserted present below.
    }
  }
  return files;
}

describe("onboarding legacy surface", () => {
  test("canonical previews use only the built static version root", () => {
    const retiredShim = ["canonical", "middleware"].join("-");
    const retiredAggregate = ["artifact", "css"].join(".");
    const retiredPaths = [
      `packages/skills/${retiredShim}.mjs`,
      `packages/skills/${retiredShim}.d.mts`,
      `packages/skills/test/${retiredShim}.test.ts`,
      `packages/canonical/styles/${retiredAggregate}`,
    ];
    expect(
      retiredPaths.filter((relativePath) =>
        existsSync(path.join(repoRoot, relativePath))
      ),
    ).toEqual([]);

    const storybookConfig = readFileSync(
      path.join(repoRoot, "storybook/.storybook/main.ts"),
      "utf8",
    );
    expect(storybookConfig).toContain(
      '{ from: "../../packages/canonical/dist/canonical", to: "/canonical" }',
    );
    expect(storybookConfig).not.toContain("canonicalMiddleware");
    expect(storybookConfig).not.toContain("canonical-dev-server");

    const calendarFixture = readFileSync(
      path.join(
        repoRoot,
        "packages/skills/skills/tv-calendar/test/e2e/fixture.ts",
      ),
      "utf8",
    );
    expect(calendarFixture).toContain(
      'canonical/styles/canonical/v2/index.css"',
    );
    expect(calendarFixture).not.toContain(retiredAggregate);
  });

  test("legacy onboarding runtime surface stays deleted from production code and build scripts", () => {
    const files = listProductionFiles();
    // Sanity: the walk found the roots that carried the legacy runtime.
    expect(files.some((file) => file.endsWith(path.join("server", "src", "server-store.ts")))).toBe(true);
    expect(files.some((file) => file.endsWith(path.join("cli", "build.mjs")))).toBe(true);

    const violations: string[] = [];
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      for (const symbol of FORBIDDEN_SYMBOLS) {
        if (text.includes(symbol)) {
          violations.push(`${path.relative(repoRoot, file)}: ${symbol}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

});

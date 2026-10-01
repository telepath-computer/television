import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { CANONICAL_TEST_INCLUDE_ROOTS, loadTestConfig, owningSurfaces, selectSurfaces, validateRegistry, type TestConfig, type TestSurface } from "../../scripts/test/config.mjs";

const config = loadTestConfig();

describe("test runner registry", () => {
  test("validates the repository registry", () => {
    expect(validateRegistry(config)).toEqual([]);
  });

  test("e2e:node preCommand uses the shared licensing product build", () => {
    const surface = selectSurfaces(config, { surface: "e2e:node" })[0];
    expect(surface.preCommand).toEqual(["node", "scripts/licenses/build-suite.mjs"]);
  });

  test("resolves suite/package/surface selectors", () => {
    expect(selectSurfaces(config, { suite: "e2e" }).every((surface) => surface.kind === "e2e")).toBe(true);
    expect(selectSurfaces(config, { suite: "telemetry-posthog-roundtrip" }).map((surface) => surface.id)).toEqual(["telemetry-posthog-roundtrip:integration"]);
    expect(selectSurfaces(config, { suite: "daemon-acceptance" }).map((surface) => surface.id)).toEqual(["daemon-acceptance:cli"]);
    expect(selectSurfaces(config, { package: "@telepath-computer/canonical" }).map((surface) => surface.id)).toEqual(["unit:canonical"]);
    expect(selectSurfaces(config, { package: "@telepath-computer/television-web" }).map((surface) => surface.id).sort()).toEqual(["e2e:browser-app", "unit:browser-app"]);
    expect(selectSurfaces(config, { surface: "e2e:browser-app" }).map((surface) => surface.id)).toEqual(["e2e:browser-app"]);
  });

  test("restricts lifecycle fault surfaces to isolated GitHub runners", () => {
    const lifecycle = selectSurfaces(config, { tag: "isolated-github-only" });
    const ids = [
      "experiment:lifecycle-orchestrator",
      "experiment:lifecycle-clean",
      "experiment:lifecycle-leak",
      "experiment:lifecycle-term-resistant",
      "experiment:lifecycle-precommand-leak",
      "experiment:lifecycle-active",
      "experiment:lifecycle-recovered-leak",
      "experiment:lifecycle-late-spawn",
    ];

    expect(lifecycle.map((surface) => surface.id)).toEqual(ids);
    expect(lifecycle.every((surface) => surface.kind === "experiment" && surface.tags.includes("isolated-github-only"))).toBe(true);
    expect(selectSurfaces(config, { suite: "all" }).map((surface) => surface.id)).not.toEqual(expect.arrayContaining(ids));
  });

  test("models the historical shard execution groups", () => {
    const allSurfaces = selectSurfaces(config, { suite: "all" });
    expect(allSurfaces.map((surface) => surface.id)).not.toContain("telemetry-posthog-roundtrip:integration");
    expect(allSurfaces.map((surface) => surface.id)).not.toContain("daemon-acceptance:cli");
    expect(selectSurfaces(config, { suite: "e2e-ci" }).map((surface) => surface.id)).not.toContain("daemon-acceptance:cli");
    expect(allSurfaces.map((surface) => surface.id)).toContain("unit:build-config");
    const groups = new Map(allSurfaces.map((surface) => [surface.executionGroup?.id ?? surface.id, surface.executionGroup]));
    expect([...groups.values()].sort((left, right) => (left?.order ?? 0) - (right?.order ?? 0)).map((group) => group?.id)).toEqual([
      "unit:root",
      "unit:workspaces",
      "e2e:node",
      "e2e:browser-app",
      "e2e:artifact",
      "e2e:browser-app-real-stack",
      "e2e:view-markdown",
      "e2e:calendar-skill",
      "e2e:desktop",
      "e2e:server",
      "e2e:tasks-skill",
    ]);
    expect(allSurfaces.filter((surface) => surface.executionGroup?.id === "unit:workspaces").map((surface) => surface.id)).toEqual([
      "unit:artifact",
      "unit:canonical",
      "unit:cli",
      "unit:desktop",
      "unit:shared",
      "unit:utils",
      "unit:server",
      "unit:view-markdown",
      "unit:browser-app",
      "unit:skills",
      "unit:skillbench",
      "unit:staging",
    ]);
  });

  test("assigns each real test file to exactly one surface", () => {
    const testFiles = discoverTestFiles(path.resolve(import.meta.dirname, "../.."));
    const ownership = testFiles.map((file) => ({ file, owners: owningSurfaces(config.surfaces, file).map((surface) => surface.id) }));
    expect(ownership.filter((entry) => entry.owners.length === 0)).toEqual([]);
    expect(ownership.filter((entry) => entry.owners.length > 1)).toEqual([]);
  });

  test("uses explicit excludeRoots when resolving file ownership", () => {
    expect(owningSurfaces(config.surfaces, "packages/web/test/e2e/root-horizontal-overflow.test.ts").map((surface) => surface.id)).toEqual(["e2e:browser-app"]);
    expect(owningSurfaces(config.surfaces, "packages/web/test/e2e/onboarding-browser.test.ts").map((surface) => surface.id)).toEqual(["e2e:browser-app-real-stack"]);
    expect(owningSurfaces(config.surfaces, "packages/web/test/swipe-gesture.test.ts").map((surface) => surface.id)).toEqual(["unit:browser-app"]);
    expect(owningSurfaces(config.surfaces, "packages/canonical/test/build-canonical.test.ts").map((surface) => surface.id)).toEqual(["unit:canonical"]);
    expect(owningSurfaces(config.surfaces, "packages/server/test/telemetry-posthog.integration.test.ts").map((surface) => surface.id)).toEqual(["telemetry-posthog-roundtrip:integration"]);
    expect(owningSurfaces(config.surfaces, "test/node/daemon-acceptance.test.ts").map((surface) => surface.id)).toEqual(["daemon-acceptance:cli"]);
    expect(owningSurfaces(config.surfaces, "test/repo/build-config-integrity.test.ts").map((surface) => surface.id)).toEqual(["unit:build-config"]);
  });

  test("fails when --file conflicts with other selectors", () => {
    expect(() => selectSurfaces(config, { suite: "unit", file: "packages/web/test/e2e/root-horizontal-overflow.test.ts" })).toThrow(/packages\/web\/test\/e2e\/root-horizontal-overflow\.test\.ts is not part of the selected surfaces/);
  });

  test("retains ordered dynamic-service declarations", () => {
    const surface = selectSurfaces(config, { surface: "experiment:dynamic-services" })[0];
    expect(surface.services).toEqual([
      { id: "first", kind: "vite", config: "test/runner-fixtures/dynamic-services/first.vite.config.ts", publishUrlEnv: "TV_DYNAMIC_FIRST_URL" },
      { id: "second", kind: "vite", config: "test/runner-fixtures/dynamic-services/second.vite.config.ts", publishUrlEnv: "TV_DYNAMIC_SECOND_URL" },
    ]);
    expect(Object.fromEntries([
      "e2e:browser-app",
      "e2e:view-markdown",
      "e2e:calendar-skill",
      "e2e:tasks-skill",
    ].map((id) => {
      const selected = selectSurfaces(config, { surface: id })[0];
      return [id, selected.services.map((service) => service.publishUrlEnv)];
    }))).toEqual({
      "e2e:browser-app": ["TV_WEB_E2E_URL"],
      "e2e:view-markdown": ["TV_VIEW_MARKDOWN_E2E_URL"],
      "e2e:calendar-skill": ["TV_CALENDAR_E2E_URL"],
      "e2e:tasks-skill": ["TV_TASKS_E2E_URL"],
    });
  });

  test("publishes artifact dual origins without a deterministic port window", () => {
    const surface = selectSurfaces(config, { surface: "e2e:artifact" })[0];
    expect(surface.services).toEqual([
      { id: "artifact-view", kind: "vite", config: "packages/artifact/test/e2e/harness/view/vite.config.ts", publishUrlEnv: "TV_ARTIFACT_E2E_VIEW_URL" },
      { id: "artifact-host", kind: "vite", config: "packages/artifact/test/e2e/harness/host/vite.config.ts", publishUrlEnv: "TV_ARTIFACT_E2E_HOST_URL" },
    ]);

    const artifactE2ERoot = path.resolve(import.meta.dirname, "../../packages/artifact/test/e2e");
    expect(existsSync(path.join(artifactE2ERoot, "artifact-e2e-ports.js"))).toBe(false);
    const forbiddenPortAllocator = /ARTIFACT_E2E_(?:HOST|VIEW)_PORT|ARTIFACT_E2E_PORT_BASE|ARTIFACT_E2E_RUN_ID|PORT_RANGE_(?:START|END)|RUN_WINDOW_COUNT|legacyArtifactE2EPortList|publishArtifactE2EPorts|readPublishedArtifactE2EPorts/;
    expect(findMatchingSourceFiles(artifactE2ERoot, forbiddenPortAllocator)).toEqual([]);
  });

  test("publishes the desktop dynamic service without fixed fixture ports", () => {
    const surface = selectSurfaces(config, { surface: "e2e:desktop" })[0];
    expect(surface.services).toEqual([
      { id: "desktop-fixtures", kind: "vite", config: "config/vite.e2e.ts", publishUrlEnv: "TV_DESKTOP_E2E_URL" },
    ]);

    const desktopRoot = path.resolve(import.meta.dirname, "../../packages/desktop");
    const playwrightConfig = readFileSync(path.join(desktopRoot, "playwright.config.ts"), "utf8");
    expect(playwrightConfig).not.toContain("webServer");
    expect(findMatchingSourceFiles(path.join(desktopRoot, "test/e2e"), /\b4273\b/)).toEqual([]);
  });

  test("accepts valid services and reports every invalid declaration", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "tv-test-registry-"));
    mkdirSync(path.join(root, "test/fixture"), { recursive: true });
    writeFileSync(path.join(root, "test/fixture/playwright.config.ts"), "export default {}\n");
    writeFileSync(path.join(root, "test/fixture/first.vite.config.ts"), "export default {}\n");
    writeFileSync(path.join(root, "test/fixture/second.vite.config.ts"), "export default {}\n");
    const base: Omit<TestSurface, "services"> = {
      id: "fixture",
      runner: "playwright" as const,
      config: "test/fixture/playwright.config.ts",
      kind: "experiment",
      package: null,
      roots: ["test/fixture"],
      excludeRoots: [],
      supports: ["file", "grep", "shard"],
      preflight: ["node"],
      tags: [],
      agent: false,
      command: null,
      preCommand: null,
      executionGroup: null,
      cwd: ".",
      absoluteConfig: path.join(root, "test/fixture/playwright.config.ts"),
    };
    const valid: TestConfig = { surfaces: [{ ...base, services: [
      { id: "first", kind: "vite", config: "test/fixture/first.vite.config.ts", publishUrlEnv: "TV_FIRST_URL" },
      { id: "second", kind: "vite", config: "test/fixture/second.vite.config.ts", publishUrlEnv: "TV_SECOND_URL" },
    ] }], suites: {} };
    expect(validateRegistry(valid, { root })).toEqual([]);

    const invalid = { surfaces: [{ ...base, services: [
      { id: "duplicate", kind: "vite", config: "test/fixture/first.vite.config.ts", publishUrlEnv: "TV_FIRST_URL" },
      { id: "duplicate", kind: "http", config: "test/fixture/missing.vite.config.ts", publishUrlEnv: "invalid-name" },
      { id: "third", kind: "vite", config: "test/fixture/second.vite.config.ts", publishUrlEnv: "TV_FIRST_URL" },
    ] }], suites: {} };
    expect(validateRegistry(invalid as unknown as TestConfig, { root })).toEqual(expect.arrayContaining([
      "surface fixture has duplicate service id: duplicate",
      "surface fixture service duplicate has unsupported kind: http",
      "surface fixture service duplicate config does not exist: test/fixture/missing.vite.config.ts",
      "surface fixture service duplicate has invalid publishUrlEnv: invalid-name",
      "surface fixture has duplicate service publishUrlEnv: TV_FIRST_URL",
    ]));
  });

  test("detects unregistered configs under canonical include roots", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "tv-test-registry-"));
    mkdirSync(path.join(root, "packages/example"), { recursive: true });
    writeFileSync(path.join(root, "packages/example/vitest.config.ts"), "export default {}\n");
    const fakeConfig = { surfaces: [], suites: {} };
    expect(validateRegistry(fakeConfig, { root })).toContain("unregistered test config: packages/example/vitest.config.ts");
  });

  test("ignores configs outside canonical include roots", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "tv-test-registry-"));
    mkdirSync(path.join(root, "prototypes/example"), { recursive: true });
    mkdirSync(path.join(root, "experiments/example"), { recursive: true });
    writeFileSync(path.join(root, "prototypes/example/vitest.config.ts"), "export default {}\n");
    writeFileSync(path.join(root, "experiments/example/vitest.config.ts"), "export default {}\n");
    const fakeConfig = { surfaces: [], suites: {} };
    expect(validateRegistry(fakeConfig, { root })).toEqual([]);
  });
});

function findMatchingSourceFiles(root: string, pattern: RegExp): string[] {
  const matches: string[] = [];
  const visitSources = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) visitSources(full);
      else if (/\.(?:[cm]?[jt]s|d\.ts|html)$/.test(entry.name) && pattern.test(readFileSync(full, "utf8"))) {
        matches.push(path.relative(root, full));
      }
    }
  };
  visitSources(root);
  return matches.sort();
}

function discoverTestFiles(root: string): string[] {
  const out = new Set<string>();
  for (const includeRoot of CANONICAL_TEST_INCLUDE_ROOTS) {
    const absoluteRoot = path.join(root, includeRoot);
    if (!existsSync(absoluteRoot)) continue;
    visit(absoluteRoot, root, out);
  }
  return [...out].sort();
}

function visit(dir: string, root: string, out: Set<string>): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (["node_modules", "dist", ".test-runs", ".testshards"].includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) visit(full, root, out);
    else if (/\.(test|spec)\.ts$/.test(entry.name)) out.add(path.relative(root, full));
  }
}

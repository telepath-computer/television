import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
// @ts-expect-error — jsdom is intentionally installed without a declaration package
import { JSDOM } from "jsdom";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
// @ts-expect-error — repository build script has no declaration file
import { buildCanonicalVersions } from "../../packages/canonical/scripts/build-canonical.mjs";
import { buildVersionedWebBundle } from "../helpers/versioned-web-bundle.ts";

const repoRoot = path.resolve(import.meta.dirname, "../..");
const cliDistPath = path.join(repoRoot, "packages/cli/dist/cli.cjs");
const require = createRequire(import.meta.url);

const EXPECTED_PRODUCTION_PROJECT_ID = 482_022;
const EXPECTED_TEST_PROJECT_ID = 484_904;
const EXPECTED_PRODUCTION_PROJECT_TOKEN = "phc_qASjRhbnr7AA9ak5YeQtWtHdGY5P9TM9Q2k86G34LoYP";
const EXPECTED_PRODUCTION_INGESTION_HOST = "https://us.i.posthog.com";

type BuiltCliTelemetryConfig = {
  telemetryBuild: string | null;
  telemetrySuppressionReason: string | null;
  posthogProject: {
    projectId: number;
    projectToken: string;
    ingestionHost: string;
  } | null;
};

type BuiltCliTelemetryConfigOptions = { developerHost?: boolean };

// Static wiring guards, not behavior coverage: they prove the build scripts
// reference the theme and onboarding validation steps and the onboarding
// content-dir define. Their behavioral halves live in the package validator
// tests and test/node/onboarding-packaging.test.ts.
describe("server and CLI build config", () => {
  test("server build validates and ships the onboarding content tree", () => {
    const buildScript = readFileSync(path.join(repoRoot, "packages/server/scripts/build.sh"), "utf8");
    expect(buildScript).toContain("set -euo pipefail");
    expect(buildScript).toContain("validate-onboarding.mjs");
    expect(buildScript).toContain("assets/onboarding-channels");
    expect(buildScript).not.toContain("television-onboarding");
  });

  test("server build validates and ships bundled theme packages", () => {
    const buildScript = readFileSync(path.join(repoRoot, "packages/server/scripts/build.sh"), "utf8");
    expect(buildScript).toContain("validate-themes.mjs");
    expect(buildScript).toContain("assets/themes");
    expect(buildScript).toContain("dist/themes");
  });

  test("CLI build ships the onboarding tree with the final content-dir define and no legacy define", () => {
    const buildScript = readFileSync(path.join(repoRoot, "packages/cli/build.mjs"), "utf8");
    expect(buildScript).toContain('__TV_ONBOARDING_CONTENT_DIR__: JSON.stringify("./onboarding")');
    expect(buildScript).toContain("onboarding-channels.json");
    expect(buildScript).not.toContain("__TV_ONBOARDING_ARTIFACT_PATH__");
    expect(buildScript).not.toContain("television-onboarding");

    const cliSource = readFileSync(path.join(repoRoot, "packages/cli/src/index.ts"), "utf8");
    expect(cliSource).toContain("__TV_ONBOARDING_CONTENT_DIR__");
    expect(cliSource).not.toContain("__TV_ONBOARDING_ARTIFACT_PATH__");
  });

  test("CLI build ships bundled themes with the sibling-directory define", () => {
    const buildScript = readFileSync(path.join(repoRoot, "packages/cli/build.mjs"), "utf8");
    expect(buildScript).toContain('__TV_BUNDLED_THEMES_DIR__: JSON.stringify("./themes")');
    expect(buildScript).toContain("packages/server/dist/themes");

    const cliSource = readFileSync(path.join(repoRoot, "packages/cli/src/index.ts"), "utf8");
    expect(cliSource).toContain("__TV_BUNDLED_THEMES_DIR__");
    expect(cliSource).toContain("resolveBundledThemesPath");
  });
});

describe("canonical font preload build seam", () => {
  test("the production shell preloads the exact canonical Hind URL (^ui-t-canonical-font-preload)", async () => {
    const canonicalWork = mkdtempSync(
      path.join(os.tmpdir(), "television-preload-canonical-"),
    );
    try {
      const canonicalRoot = path.join(canonicalWork, "canonical");
      const { v2: { stylesheetPath, fontPaths } } = await buildCanonicalVersions({
        outDir: canonicalRoot,
      });
      const canonicalDir = path.join(canonicalRoot, "v2");
      const webDist = await buildVersionedWebBundle();
      const webFont = readFileSync(
        path.join(
          repoRoot,
          "packages/web/src/foundation/fonts/Hind-Variable.woff2",
        ),
      );
      const canonicalFont = readFileSync(
        path.join(
          repoRoot,
          "packages/canonical/styles/canonical/v2/foundation/fonts/Hind-Variable.woff2",
        ),
      );
      expect(webFont).toEqual(canonicalFont);

      const digest = createHash("sha256")
        .update(webFont)
        .digest("hex")
        .slice(0, 8);
      const expectedURL = `/canonical/v2/fonts/Hind-Variable.${digest}.woff2`;
      const canonicalStyles = readFileSync(stylesheetPath, "utf8");
      const fontURLs = [
        ...canonicalStyles.matchAll(
          /url\((\/canonical\/v2\/fonts\/[a-zA-Z0-9._-]+)\)/g,
        ),
      ].map((match) => match[1]);
      expect(fontURLs).toEqual([expectedURL]);
      expect(fontPaths).toEqual([
        path.join(canonicalDir, "fonts", path.basename(expectedURL)),
      ]);
      expect(readFileSync(fontPaths[0]!)).toEqual(webFont);

      const sourceHTML = readFileSync(
        path.join(repoRoot, "packages/web/src/index.html"),
        "utf8",
      );
      expect(sourceHTML).not.toContain("/canonical/v2/fonts/");
      const builtHTML = readFileSync(path.join(webDist, "index.html"), "utf8");
      const document = new JSDOM(builtHTML).window.document;
      const preloads = [
        ...document.querySelectorAll<HTMLLinkElement>(
          'link[rel="preload"][as="font"]',
        ),
      ];
      expect(preloads).toHaveLength(1);
      expect(preloads[0]!.getAttribute("href")).toBe(expectedURL);
      expect(preloads[0]!.hasAttribute("crossorigin")).toBe(true);
    } finally {
      rmSync(canonicalWork, { recursive: true, force: true });
    }
  }, 300_000);
});

// Seam test for the web bundle's version stamp
// (specs/arch/updates/version-advertisement.md ^t-web-stamp): the build
// boundary — version input → stamped bundle — crossed on real `vite build`
// output. Also the smoke test for the versioned-bundle builder the update
// acceptance harnesses use: it must emit into a temp directory, never
// packages/web/dist.
describe("web bundle version stamp", () => {
  function bundleSource(distDir: string): string {
    const assetsDir = path.join(distDir, "assets");
    return readdirSync(assetsDir)
      .filter((name) => name.endsWith(".js"))
      .map((name) => readFileSync(path.join(assetsDir, name), "utf8"))
      .join("\n");
  }

  test("a production build stamps the workspace package version (^web-version-stamp)", async () => {
    const workspaceVersion = (
      JSON.parse(readFileSync(path.join(repoRoot, "packages/web/package.json"), "utf8")) as { version: string }
    ).version;
    const distDir = await buildVersionedWebBundle();
    expect(distDir).not.toBe(path.join(repoRoot, "packages/web/dist"));
    expect(existsSync(path.join(distDir, "index.html"))).toBe(true);
    expect(bundleSource(distDir)).toContain(JSON.stringify(workspaceVersion));
  }, 300_000);

  test("TV_TEST_WEB_VERSION stamps the chosen version instead (^hook-web-version)", async () => {
    const distDir = await buildVersionedWebBundle("9.8.7");
    expect(distDir).not.toBe(path.join(repoRoot, "packages/web/dist"));
    expect(bundleSource(distDir)).toContain(JSON.stringify("9.8.7"));
  }, 300_000);

  test("the builder caches per version within a worker", async () => {
    const [first, second] = await Promise.all([buildVersionedWebBundle("9.8.7"), buildVersionedWebBundle("9.8.7")]);
    expect(first).toBe(second);
    const other = await buildVersionedWebBundle("9.8.6");
    expect(other).not.toBe(first);
  }, 300_000);
});

// proofs/arch/telemetry/sink.md#^t-build-config-integrity
// proofs/product/telemetry.md#^ac-release-default
// All compiled telemetry requests are intercepted; no collector is contacted.
describe("CLI build telemetry configuration", () => {
  let tempRoot: string;
  let releasePath: string;
  let ordinaryStandalonePath: string;
  let preloadPath: string;

  beforeAll(() => {
    tempRoot = mkdtempSync(path.join(os.tmpdir(), "television-telemetry-build-"));
    releasePath = path.join(tempRoot, "release.cjs");
    ordinaryStandalonePath = path.join(tempRoot, "ordinary.cjs");
    preloadPath = path.join(tempRoot, "capture.cjs");
    const env: NodeJS.ProcessEnv = { ...process.env, VITEST: "true" };
    delete env.TV_NPM_RELEASE;
    const ordinary = spawnSync("npm", ["run", "build"], { cwd: repoRoot, encoding: "utf8", env });
    expect(ordinary.status, `${ordinary.stdout}\n${ordinary.stderr}`).toBe(0);
    for (const [outfile, release] of [[ordinaryStandalonePath, false], [releasePath, true]] as const) {
      const build = spawnSync(process.execPath, ["packages/cli/build.mjs", "--outfile", outfile], {
        cwd: repoRoot, encoding: "utf8", env: { ...env, TV_NPM_RELEASE: release ? "1" : "true" },
      });
      expect(build.status, `${build.stdout}\n${build.stderr}`).toBe(0);
    }
    cpSync(path.join(repoRoot, "packages/cli/dist/skills"), path.join(tempRoot, "skills"), { recursive: true });
    writeFileSync(preloadPath, `
const { appendFileSync } = require('node:fs');
const record = value => appendFileSync(process.env.TV_CAPTURE_FILE, JSON.stringify(value) + '\\n');
Object.defineProperty(globalThis, 'fetch', { configurable: false, writable: false, value: async (url, init) => {
  record({ url: String(url), body: JSON.parse(String(init?.body ?? '{}')), headers: init?.headers });
  return new Response(null, { status: 200 });
}});
record({ active: true });
`);
    // Prove the interceptor works before running a potentially release-marked CLI.
    const probe = runIntercepted(["-e", "fetch('http://127.0.0.1:1/probe')"], {});
    expect(probe.records).toEqual([{ active: true }, { url: "http://127.0.0.1:1/probe", body: {} }]);
  }, 300_000);

  afterAll(() => { if (tempRoot) rmSync(tempRoot, { recursive: true, force: true }); });

  function inspect(bundlePath: string, env: Record<string, string | undefined> = {}, developerHost = false): BuiltCliTelemetryConfig {
    const previous = process.env.VITEST;
    process.env.VITEST = "true";
    try {
      const cli = require(bundlePath) as { inspectTelemetryBuildConfig: (env: Record<string, string | undefined>, options: BuiltCliTelemetryConfigOptions) => BuiltCliTelemetryConfig };
      return cli.inspectTelemetryBuildConfig(env, { developerHost });
    } finally {
      if (previous === undefined) delete process.env.VITEST;
      else process.env.VITEST = previous;
    }
  }

  function runIntercepted(args: string[], overrides: NodeJS.ProcessEnv) {
    const captureFile = path.join(tempRoot, "capture.jsonl");
    writeFileSync(captureFile, "");
    const result = spawnSync(process.execPath, ["--require", preloadPath, ...args], {
      cwd: tempRoot, encoding: "utf8", timeout: 30_000,
      env: { PATH: process.env.PATH, HOME: tempRoot, TELEVISION_DEVELOPER_HOME: tempRoot, TV_CAPTURE_FILE: captureFile, ...overrides },
    });
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    const records = readFileSync(captureFile, "utf8").trim().split("\n").map((line) => JSON.parse(line));
    expect(records[0]).toEqual({ active: true });
    return { records, stderr: result.stderr };
  }

  test("ordinary full and standalone builds cannot be promoted at runtime", () => {
    for (const bundlePath of [cliDistPath, ordinaryStandalonePath]) {
      for (const env of [{}, { NODE_ENV: "production", TELEVISION_TELEMETRY_BUILD: "production", TV_NPM_RELEASE: "1" }]) {
        expect(inspect(bundlePath, env)).toMatchObject({ telemetryBuild: "development", telemetrySuppressionReason: "development" });
      }
      expect(inspect(bundlePath, {}, true).telemetrySuppressionReason).toBe("development");
      expect(inspect(bundlePath, { TV_TELEMETRY_TEST: "1" })).toMatchObject({ telemetrySuppressionReason: null, posthogProject: { projectId: EXPECTED_TEST_PROJECT_ID } });
    }
  });

  test("release bundles default to production with developer routing and suppression intact", () => {
    expect(inspect(releasePath)).toEqual({ telemetryBuild: "production", telemetrySuppressionReason: null,
      posthogProject: { projectId: EXPECTED_PRODUCTION_PROJECT_ID, projectToken: EXPECTED_PRODUCTION_PROJECT_TOKEN, ingestionHost: EXPECTED_PRODUCTION_INGESTION_HOST } });
    expect(inspect(releasePath, {}, true)).toMatchObject({ telemetrySuppressionReason: "developer-host", posthogProject: null });
    expect(inspect(releasePath, { TV_TELEMETRY_TEST: "1" }).posthogProject!.projectId).toBe(EXPECTED_TEST_PROJECT_ID);
    expect(inspect(releasePath, { DO_NOT_TRACK: "1" }).telemetrySuppressionReason).toBe("do-not-track");
    expect(inspect(releasePath, { CI: "1" }).telemetrySuppressionReason).toBe("ci");
    expect(inspect(releasePath, { TELEVISION_TELEMETRY_BUILD: "development" }).telemetrySuppressionReason).toBeNull();
    for (const bundlePath of [cliDistPath, ordinaryStandalonePath, releasePath]) {
      const bundle = readFileSync(bundlePath, "utf8");
      expect(bundle).toContain(EXPECTED_PRODUCTION_PROJECT_TOKEN);
      expect(bundle).not.toContain("phx_");
    }
  });

  test("the publication guard rejects ordinary output and accepts isolated release output", () => {
    for (const [bundlePath, expected] of [[cliDistPath, 1], [releasePath, 0]] as const) {
      const result = spawnSync(process.execPath, ["scripts/check-release-telemetry.mjs", bundlePath], { cwd: repoRoot, encoding: "utf8" });
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(expected);
      if (expected === 1) expect(result.stderr).toContain("Publication requires an npm-release telemetry build");
    }
  });

  // proofs/product/telemetry.md#^ac-release-default
  test.each([
    ["ordinary", false, false, false, null, false, {}],
    ["ordinary marked", false, true, false, null, false, {}],
    ["ordinary test", false, false, true, EXPECTED_TEST_PROJECT_ID, false, {}],
    ["release", true, false, false, EXPECTED_PRODUCTION_PROJECT_ID, false, {}],
    ["release marked", true, true, false, null, false, {}],
    ["release marked test", true, true, true, EXPECTED_TEST_PROJECT_ID, false, {}],
    ["release HOME-only marked", true, true, false, null, true, {}],
    ["release HOME-only unmarked", true, false, false, EXPECTED_PRODUCTION_PROJECT_ID, true, {}],
    ["test CI", true, false, true, null, false, { CI: "1" }],
    ["test DNT", true, false, true, null, false, { DO_NOT_TRACK: "1" }],
    ["test opted-out", true, false, true, null, false, { optedOut: true }],
  ] as const)("compiled skills install: %s", (_label, release, marked, testMode, expectedProject, homeOnly, controls) => {
    const root = mkdtempSync(path.join(tempRoot, "case-"));
    const home = path.join(root, "data");
    const destination = path.join(root, ".codex", "skills");
    if (marked) writeFileSync(path.join(root, ".tv-developer"), "");
    if ("optedOut" in controls) {
      mkdirSync(path.join(home, "state"), { recursive: true });
      writeFileSync(path.join(home, "state/telemetry.json"), JSON.stringify({ schemaVersion: 1, userId: "opted-out-fixture", optedOut: true, lastVersion: "" }));
    }
    const { records, stderr } = runIntercepted([release ? releasePath : cliDistPath, "--home", home, "skills", "install", destination, "--installed-by-agent", "  Novel Harness  "], {
      HOME: root, TELEVISION_DEVELOPER_HOME: homeOnly ? undefined : root,
      ...(release ? {} : { NODE_ENV: "production", TELEVISION_TELEMETRY_BUILD: "production", TV_NPM_RELEASE: "1" }),
      ...(testMode ? { TV_TELEMETRY_TEST: "1" } : {}),
      ...("CI" in controls ? { CI: controls.CI } : {}),
      ...("DO_NOT_TRACK" in controls ? { DO_NOT_TRACK: controls.DO_NOT_TRACK } : {}),
    });
    expect(stderr).toBe(expectedProject === EXPECTED_PRODUCTION_PROJECT_ID
      ? "Fully anonymized telemetry is enabled by default. Opt out: tv telemetry disable.\n" : "");
    const repeat = runIntercepted([release ? releasePath : cliDistPath, "--home", home, "skills", "install", destination], {
      HOME: root, TELEVISION_DEVELOPER_HOME: root,
    });
    expect(repeat.stderr).toBe("");
    expect(readFileSync(path.join(destination, "television", "SKILL.md"), "utf8")).toBe(readFileSync(path.join(tempRoot, "skills/television/SKILL.md"), "utf8"));
    const requests = records.slice(1);
    if (expectedProject === null) {
      expect(requests).toEqual([]);
    } else {
      expect(requests).toHaveLength(1);
      expect(requests[0].body).toMatchObject({ event: "skill_installed", properties: { installed_by_agent: "novel harness", agent_type: "codex", $ip: "0.0.0.0", $geoip_disable: true } });
      expect(requests[0].body.api_key).toBe(inspect(releasePath, expectedProject === EXPECTED_TEST_PROJECT_ID ? { TV_TELEMETRY_TEST: "1" } : {}).posthogProject!.projectToken);
      expect(JSON.stringify(requests)).not.toContain(root);
    }
  });

  test("ordinary package and CI build recipes never set the release flag", () => {
    const files = spawnSync("git", ["ls-files", "--", "package.json", "packages/*/package.json", "scripts/", "test.prebuilt.mjs", "test.config.mjs", ".github/actions/", ".github/workflows/", "packages/cli/build.mjs"], { cwd: repoRoot, encoding: "utf8" });
    expect(files.status).toBe(0);
    const allowed = new Set([".github/workflows/publish.yml", "packages/cli/build.mjs"]);
    const offenders = files.stdout.trim().split("\n").filter((file) => !allowed.has(file) && /\.(?:json|[cm]?[jt]s|sh|ya?ml)$/.test(file) && readFileSync(path.join(repoRoot, file), "utf8").includes("TV_NPM_RELEASE"));
    expect(offenders).toEqual([]);
  });
});

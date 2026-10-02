import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  loadOnboardingConfig,
  resolveOnboardingArtifactSource,
  validateOnboardingContentTree,
} from "../src/onboarding-content.ts";
import { SHIPPED_ONBOARDING_CHANNELS } from "../../../test/helpers/shipped-onboarding.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixturesRoot = path.join(here, "fixtures", "onboarding-content");
const productionRoot = path.resolve(here, "..", "assets", "onboarding-channels");
const canonicalPublicAPI = JSON.parse(
  readFileSync(
    path.resolve(
      here,
      "../..",
      "canonical/test/fixtures/canonical-public-api.json",
    ),
    "utf8",
  ),
) as { tokens: Record<string, string[]> };

function fixture(name: string): string {
  return path.join(fixturesRoot, name);
}

function loadConfigWithArtifact(
  artifact: Record<string, unknown>,
  options: { nonFiniteWidth?: boolean } = {},
): ReturnType<typeof loadOnboardingConfig> {
  const root = mkdtempSync(path.join(os.tmpdir(), "television-onboarding-config-"));
  const config = JSON.parse(
    readFileSync(path.join(fixture("valid"), "onboarding-channels.json"), "utf8"),
  ) as { channels: Array<{ artifacts: Array<Record<string, unknown>> }> };
  config.channels[0]!.artifacts[0] = artifact;
  let serialized = JSON.stringify(config, null, 2) + "\n";
  if (options.nonFiniteWidth) {
    serialized = serialized.replace('"NON_FINITE_WIDTH"', "1e400");
  }
  writeFileSync(path.join(root, "onboarding-channels.json"), serialized);
  try {
    return loadOnboardingConfig(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

// One fixture tree per defect class of the validation matrix
// (proofs/arch/onboarding/content.md#^t-validation-matrix), each paired with a
// fragment its error message must contain to count as a useful error.
const defectMatrix: Array<[fixtureName: string, errorMatch: RegExp]> = [
  ["unparseable-config", /parse/i],
  ["schema-bad-version", /version/i],
  ["schema-empty-channels", /channels/i],
  ["schema-empty-name", /name/i],
  ["schema-empty-title", /title/i],
  ["schema-empty-artifacts", /artifacts/i],
  ["slug-pattern", /slug/i],
  ["slug-double-hyphen", /--/],
  ["missing-channel-folder", /folder/i],
  ["unknown-focus", /focusChannel/],
  ["missing-artifact-source", /source/i],
  ["ambiguous-artifact-source", /ambiguous/i],
  ["ambiguous-html-md", /ambiguous/i],
  ["ambiguous-md-dir", /ambiguous/i],
  ["dir-artifact-no-index", /index\.html/],
  ["duplicate-channel-slugs", /duplicate/i],
  ["duplicate-artifact-slugs", /duplicate/i],
  ["orphan-channel-folder", /unreferenced/i],
  ["orphan-root-file", /unreferenced/i],
  ["orphan-artifact-file", /unreferenced/i],
  ["orphan-dotfile", /unreferenced/i],
];

describe("Onboarding content validation", () => {
  describe("Validation catches each defect class", () => {
    it("passes a fully valid fixture tree with artifact order and optional page layout", () => {
      const result = validateOnboardingContentTree(fixture("valid"));
      expect(result.errors).toEqual([]);
      expect(result.valid).toBe(true);

      const loaded = loadOnboardingConfig(fixture("valid"));
      expect(loaded.errors).toEqual([]);
      expect(loaded.config?.version).toBe(3);
      expect(loaded.config?.channels.map((channel) => ({
        slug: channel.slug,
        artifactOrder: channel.artifacts.map((artifact) => artifact.slug),
      }))).toEqual([
        { slug: "first", artifactOrder: ["intro"] },
        { slug: "second", artifactOrder: ["notes", "readme", "extra"] },
      ]);
      expect(loaded.config?.channels[0]?.artifacts[0]).toMatchObject({
        size: { width: 901.5, height: 677.25 },
        geometry: { kind: "single", full_screen: true },
      });
    });

    it.each(defectMatrix)("fails %s with a useful error", (fixtureName, errorMatch) => {
      const result = validateOnboardingContentTree(fixture(fixtureName));
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors.join("\n")).toMatch(errorMatch);
    });
  });

  describe("Runtime validation allows lazy source failures", () => {
    // The installer uses schema-only validation plus lazy per-channel source
    // resolution (specs/arch/onboarding/installer.md#^lazy-source-resolution),
    // so a missing source must not fail config loading.
    it("loads a schema-valid config whose artifact source is missing", () => {
      const result = loadOnboardingConfig(fixture("missing-artifact-source"));
      expect(result.errors).toEqual([]);
      expect(result.config).toBeDefined();
      expect(result.config!.channels[0]!.artifacts.map((a) => a.slug)).toEqual(["present", "gone"]);
    });

    it("loads a config from a tree with unreferenced content on disk", () => {
      const result = loadOnboardingConfig(fixture("orphan-channel-folder"));
      expect(result.errors).toEqual([]);
      expect(result.config).toBeDefined();
    });

    it("still rejects schema, slug, and artifact-list defects", () => {
      for (const fixtureName of [
        "unparseable-config",
        "schema-bad-version",
        "schema-empty-channels",
        "schema-empty-name",
        "schema-empty-title",
        "schema-empty-artifacts",
        "slug-pattern",
        "slug-double-hyphen",
        "unknown-focus",
        "duplicate-channel-slugs",
        "duplicate-artifact-slugs",
      ]) {
        const result = loadOnboardingConfig(fixture(fixtureName));
        expect(result.config, fixtureName).toBeUndefined();
        expect(result.errors.length, fixtureName).toBeGreaterThan(0);
      }
    });

    const layoutDefects: Array<{
      name: string;
      artifact: Record<string, unknown>;
      match: RegExp;
      nonFiniteWidth?: boolean;
    }> = [
      {
        name: "unknown artifact key",
        artifact: { slug: "intro", title: "Intro", sise: { width: 900, height: 600 } },
        match: /unknown.*sise/i,
      },
      {
        name: "non-object size",
        artifact: { slug: "intro", title: "Intro", size: null },
        match: /size.*object/i,
      },
      {
        name: "unknown size key",
        artifact: { slug: "intro", title: "Intro", size: { width: 900, height: 600, depth: 1 } },
        match: /size.*unknown.*depth/i,
      },
      {
        name: "missing size width",
        artifact: { slug: "intro", title: "Intro", size: { height: 600 } },
        match: /size width.*finite positive/i,
      },
      {
        name: "missing size height",
        artifact: { slug: "intro", title: "Intro", size: { width: 900 } },
        match: /size height.*finite positive/i,
      },
      {
        name: "non-numeric size axis",
        artifact: { slug: "intro", title: "Intro", size: { width: "900", height: 600 } },
        match: /size width.*finite positive/i,
      },
      {
        name: "non-finite size axis",
        artifact: { slug: "intro", title: "Intro", size: { width: "NON_FINITE_WIDTH", height: 600 } },
        match: /size width.*finite positive/i,
        nonFiniteWidth: true,
      },
      {
        name: "zero size axis",
        artifact: { slug: "intro", title: "Intro", size: { width: 0, height: 600 } },
        match: /size width.*finite positive/i,
      },
      {
        name: "negative size axis",
        artifact: { slug: "intro", title: "Intro", size: { width: 900, height: -1 } },
        match: /size height.*finite positive/i,
      },
      {
        name: "non-object geometry",
        artifact: { slug: "intro", title: "Intro", geometry: null },
        match: /geometry.*object/i,
      },
      {
        name: "unknown geometry key",
        artifact: {
          slug: "intro",
          title: "Intro",
          geometry: { kind: "single", full_screen: false, row: 1 },
        },
        match: /geometry.*unknown.*row/i,
      },
      {
        name: "unknown geometry kind",
        artifact: { slug: "intro", title: "Intro", geometry: { kind: "grid", full_screen: false } },
        match: /unknown geometry kind/i,
      },
      {
        name: "missing full-screen flag",
        artifact: { slug: "intro", title: "Intro", geometry: { kind: "single" } },
        match: /geometry.*boolean full_screen/i,
      },
      {
        name: "non-boolean full-screen flag",
        artifact: {
          slug: "intro",
          title: "Intro",
          geometry: { kind: "single", full_screen: "true" },
        },
        match: /geometry.*boolean full_screen/i,
      },
    ];

    it.each(layoutDefects)("rejects $name", ({ artifact, match, nonFiniteWidth = false }) => {
      const result = loadConfigWithArtifact(artifact, { nonFiniteWidth });
      expect(result.config).toBeUndefined();
      expect(result.errors.join("\n")).toMatch(match);
    });

    it("fails the same missing-source tree under full build validation", () => {
      const result = validateOnboardingContentTree(fixture("missing-artifact-source"));
      expect(result.valid).toBe(false);
      expect(result.errors.join("\n")).toMatch(/source/i);
    });
  });

  describe("Artifact source resolution", () => {
    it("resolves a single-file artifact to its .html file", () => {
      const result = resolveOnboardingArtifactSource(fixture("valid"), "second", "notes");
      expect(result).toEqual({
        ok: true,
        source: { kind: "file", path: path.join(fixture("valid"), "second", "notes.html") },
      });
    });

    it("resolves a single-file artifact to its .md file", () => {
      const result = resolveOnboardingArtifactSource(fixture("valid"), "second", "readme");
      expect(result).toEqual({
        ok: true,
        source: { kind: "file", path: path.join(fixture("valid"), "second", "readme.md") },
      });
    });

    it("resolves a directory artifact to its folder", () => {
      const result = resolveOnboardingArtifactSource(fixture("valid"), "first", "intro");
      expect(result).toEqual({
        ok: true,
        source: { kind: "directory", path: path.join(fixture("valid"), "first", "intro") },
      });
    });

    it("fails on a missing source", () => {
      const result = resolveOnboardingArtifactSource(fixture("missing-artifact-source"), "one", "gone");
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toMatch(/source/i);
    });

    it("fails on an ambiguous source", () => {
      const result = resolveOnboardingArtifactSource(fixture("ambiguous-artifact-source"), "one", "a");
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toMatch(/ambiguous/i);
    });

    it("fails on a directory artifact without index.html", () => {
      const result = resolveOnboardingArtifactSource(fixture("dir-artifact-no-index"), "one", "a");
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toMatch(/index\.html/);
    });
  });

  describe("production onboarding tree", () => {
    // specs/arch/onboarding/content.md#^no-placeholder-content — full build
    // validation includes the unreferenced-content check, so a green run here
    // proves the shipped tree contains only configured channels and artifacts.
    it("passes full build validation with no unreferenced content", () => {
      const result = validateOnboardingContentTree(productionRoot);
      expect(result.errors).toEqual([]);
      expect(result.valid).toBe(true);
    });

    it("ships the tv-guide welcome channel and the pinned channel set", () => {
      const result = loadOnboardingConfig(productionRoot);
      expect(result.errors).toEqual([]);
      const config = result.config!;
      expect(config.focusChannel).toBe("tv-guide");
      // The channel SET is pinned in exactly one place
      // (test/helpers/shipped-onboarding.ts); everything about the channels
      // beyond tv-guide is derived from the config at runtime so a
      // slug-preserving content replacement needs no test edits. The
      // tv-guide assertions below are a DELIBERATE content pin.
      expect(config.channels.map((s) => s.slug)).toEqual(SHIPPED_ONBOARDING_CHANNELS);
      expect(config.channels.find((s) => s.slug === "tv-guide")!.artifacts).toEqual([
        {
          slug: "welcome",
          title: "Welcome to Television",
          size: { width: 800, height: 770 },
        },
      ]);
      const source = resolveOnboardingArtifactSource(productionRoot, "tv-guide", "welcome");
      const welcomePath = path.join(productionRoot, "tv-guide", "welcome.html");
      expect(source).toEqual({
        ok: true,
        source: { kind: "file", path: welcomePath },
      });
      const welcome = readFileSync(welcomePath, "utf8");
      expect(welcome).toContain('href="/canonical/v2/styles.css"');
      expect(welcome).toContain('src="/canonical/v2/components.js"');
      const liveTokens = new Set(canonicalPublicAPI.tokens["canonical-v2"] ?? []);
      const referencedTokens = [...welcome.matchAll(/var\(\s*(--[a-z0-9-]+)/g)]
        .map((match) => match[1]!);
      expect(referencedTokens.length).toBeGreaterThan(0);
      for (const token of referencedTokens) {
        expect(liveTokens.has(token), token).toBe(true);
      }
      // Content-agnostic: every configured artifact on every shipped channel
      // resolves to a real source in the tree.
      for (const channel of config.channels) {
        for (const artifact of channel.artifacts) {
          const resolved = resolveOnboardingArtifactSource(productionRoot, channel.slug, artifact.slug);
          expect(resolved.ok, `${channel.slug}/${artifact.slug}`).toBe(true);
        }
      }
    });
  });
});

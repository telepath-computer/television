import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import postcss from "postcss";
import { afterEach, describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(process.cwd());
const TEMP_DIRS: string[] = [];
const APP_VERSION_PASSTHROUGH = "Copy that exact release version unchanged into `authoredForAppVersion`.";
const NONRELEASE_VERSION_GUIDANCE = "A missing version or the `0.0.0` development sentinel does not identify a release, so omit the metadata.";
const FOUNDATION_FILES = [
  "reset.css",
  "tokens/fonts.css",
  "colors.css",
  "text.css",
  "spacing.css",
  "shadows.css",
  "layers.css",
  "prose.css",
];
const CANONICAL_V2_SPEC_ROOT = path.join(
  REPO_ROOT,
  "packages",
  "canonical",
  "styles",
  "canonical",
  "v2",
);

interface CompatibilityFixture {
  resources: Record<string, string[]>;
  tokens: Record<string, string[]>;
  nativeControls: Record<string, Record<string, Record<string, string[]>>>;
  elements: Record<
    string,
    Record<
      string,
      {
        attributes: string[];
        attributeValues: Record<string, string[]>;
        customProperties: string[];
      }
    >
  >;
}

function publicFoundationTokens(): string[] {
  const names = FOUNDATION_FILES.flatMap((filename) => {
    const css = readFileSync(
      path.join(CANONICAL_V2_SPEC_ROOT, "foundation", filename),
      "utf8",
    );
    const declarations: string[] = [];
    postcss.parse(css).walkDecls(declaration => {
      if (declaration.prop.startsWith("--")) declarations.push(declaration.prop);
    });
    return declarations;
  });
  return [...new Set(names)].sort();
}

function publicIconNames(): string[] {
  const manifest = readFileSync(
    path.join(
      REPO_ROOT,
      "specs",
      "ui",
      "foundation",
      "icons",
      "icons.yml",
    ),
    "utf8",
  );
  return [...manifest.matchAll(/^([a-z][a-z0-9-]*):/gm)].map(
    (match) => match[1],
  );
}

function canonicalCompatibilityFixture(): CompatibilityFixture {
  return JSON.parse(
    readFileSync(
      path.join(
        REPO_ROOT,
        "packages",
        "canonical",
        "test",
        "fixtures",
        "canonical-public-api.json",
      ),
      "utf8",
    ),
  ) as CompatibilityFixture;
}

afterEach(() => {
  for (const dir of TEMP_DIRS.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function readDistFile(root: string, ...segments: string[]): string {
  return readFileSync(path.join(root, ...segments), "utf8");
}

function runBuild(scriptPath: string, cwd: string, env: NodeJS.ProcessEnv = {}): void {
  execFileSync(process.execPath, [scriptPath], {
    cwd,
    env: {
      ...process.env,
      ...env,
    },
    stdio: "pipe",
  });
}

function createTempSkillsRepo() {
  const root = mkdtempSync(path.join(os.tmpdir(), "tv-skills-build-"));
  TEMP_DIRS.push(root);

  const skillsPackageDir = path.join(root, "packages", "skills");
  mkdirSync(path.join(skillsPackageDir, "scripts"), { recursive: true });
  mkdirSync(path.join(skillsPackageDir, "skills"), { recursive: true });
  mkdirSync(path.join(skillsPackageDir, "shared"), { recursive: true });

  cpSync(
    path.join(REPO_ROOT, "packages", "skills", "scripts", "build.mjs"),
    path.join(skillsPackageDir, "scripts", "build.mjs"),
  );

  writeFileSync(path.join(skillsPackageDir, "shared", "house-style.md"), "House style.\n");

  return {
    root,
    scriptPath: path.join(skillsPackageDir, "scripts", "build.mjs"),
    skillsPackageDir,
  };
}

function writeSkillFile(skillsPackageDir: string, skillName: string, relativePath: string, content: string): void {
  const filepath = path.join(skillsPackageDir, "skills", skillName, relativePath);
  mkdirSync(path.dirname(filepath), { recursive: true });
  writeFileSync(filepath, content);
}

function writeManifest(skillsPackageDir: string, skillNames: string[]): void {
  writeFileSync(path.join(skillsPackageDir, "skills.json"), `${JSON.stringify({ skills: skillNames }, null, 2)}\n`);
}

function runBuildExpectFailure(scriptPath: string, cwd: string): string {
  try {
    runBuild(scriptPath, cwd);
    throw new Error("expected build to fail");
  } catch (error) {
    if (error instanceof Error && error.message === "expected build to fail") {
      throw error;
    }
    const stderr = typeof error === "object" && error !== null && "stderr" in error
      ? (error as { stderr?: Buffer }).stderr
      : undefined;
    return stderr?.toString("utf8") ?? (error instanceof Error ? error.message : String(error));
  }
}

describe("skills build", () => {
  it("builds the manifest collection with television theming guidance and specialist artifacts", () => {
    const skillsDistRoot = mkdtempSync(path.join(os.tmpdir(), "tv-skills-dist-"));
    TEMP_DIRS.push(skillsDistRoot);

    runBuild(path.join(REPO_ROOT, "packages", "skills", "scripts", "build.mjs"), REPO_ROOT, {
      TV_SKILLS_DIST_DIR: skillsDistRoot,
    });

    expect(existsSync(path.join(skillsDistRoot, "television", "SKILL.md"))).toBe(true);
    expect(existsSync(path.join(skillsDistRoot, "television", "theming.md"))).toBe(true);
    expect(existsSync(path.join(skillsDistRoot, "television", "resources.md"))).toBe(true);
    expect(existsSync(path.join(skillsDistRoot, "television", "house-style.md"))).toBe(false);
    expect(existsSync(path.join(skillsDistRoot, "television", "cli-capabilities.md"))).toBe(false);
    expect(existsSync(path.join(skillsDistRoot, "television", "artifact-workflow.md"))).toBe(false);

    expect(existsSync(path.join(skillsDistRoot, "tv-calendar", "SKILL.md"))).toBe(true);
    expect(existsSync(path.join(skillsDistRoot, "tv-calendar", "calendar.js"))).toBe(true);
    expect(existsSync(path.join(skillsDistRoot, "tv-calendar", "calendar.css"))).toBe(true);
    expect(existsSync(path.join(skillsDistRoot, "tv-calendar", "house-style.md"))).toBe(false);

    expect(existsSync(path.join(skillsDistRoot, "tv-table", "SKILL.md"))).toBe(true);
    expect(existsSync(path.join(skillsDistRoot, "tv-table", "house-style.md"))).toBe(false);
    expect(existsSync(path.join(skillsDistRoot, "tv-table", "example"))).toBe(false);
    expect(existsSync(path.join(skillsDistRoot, "tv-table", "docs"))).toBe(false);
    expect(existsSync(path.join(skillsDistRoot, "tv-table", "src"))).toBe(false);
    expect(existsSync(path.join(skillsDistRoot, "tv-table", "package.json"))).toBe(false);

    expect(existsSync(path.join(skillsDistRoot, "tv-theme"))).toBe(false);
    const retiredThemeSource = path.join(
      REPO_ROOT,
      "packages",
      "skills",
      "skills",
      "tv-theme",
    );
    expect(existsSync(path.join(retiredThemeSource, "package.json"))).toBe(false);
    expect(existsSync(path.join(retiredThemeSource, "scripts"))).toBe(false);
    expect(existsSync(path.join(retiredThemeSource, "src"))).toBe(false);

    expect(existsSync(path.join(REPO_ROOT, "packages", "skills", "dist", "skills"))).toBe(false);
    expect(existsSync(path.join(skillsDistRoot, "television", ".skill-manifest.json"))).toBe(false);
    expect(existsSync(path.join(skillsDistRoot, "television", "artifact-types"))).toBe(false);

    const televisionSkill = readDistFile(skillsDistRoot, "television", "SKILL.md");
    const televisionTheming = readDistFile(skillsDistRoot, "television", "theming.md");
    expect(televisionSkill).toMatch(/^---\nname: television\ndescription: .+\n---/);
    expect(televisionSkill).not.toMatch(/^version:/m);
    expect(televisionSkill).toContain("# Television");
    expect(televisionSkill).toContain("Re-read this skill only if it is not already in your context or you know it changed.");
    expect(televisionSkill).toContain("# TV CLI capabilities");
    expect(televisionSkill).toContain("Active theme changed from '<previous>' to '<new>'.");
    expect(televisionSkill).toContain("Active theme unchanged: '<selection>'.");
    expect(televisionSkill).toContain("Active theme: '<new>'.");
    expect(televisionSkill).toContain("use `None` for no theme");
    expect(televisionSkill).not.toContain("set-theme` is intentionally silent");
    expect(televisionSkill).toContain("# Artifact workflow");
    expect(televisionSkill).toContain("# HTML artifact style");
    expect(televisionSkill).toContain("Data before presentation");
    expect(televisionSkill).toContain("https://television.run/install.md");
    expect(televisionSkill).toContain("Fetch the full raw content — never a summary.");
    expect(televisionSkill).toContain(
      "clients select the artifact's tab page, switching channels first when needed",
    );
    expect(televisionSkill).toContain(
      "(`create-channel`, `list-channels`, `get-channel`, `update-channel`, `remove-channel`, `focus-channel`, `focus-status`, `set-theme`)",
    );
    expect(televisionSkill).toContain(
      "(`serve`, `status`, `stop`, `config`, `themes-path`, `telemetry`, `skills install`)",
    );
    expect(televisionSkill).toContain("remove its tab page from the channel");
    expect(televisionSkill).not.toContain("scroll and highlight the artifact");
    expect(televisionSkill).not.toContain("remove its card from its channel");
    expect(televisionSkill).not.toContain("removes its registry record and its card from the channel");
    expect(televisionSkill).toContain(
      '/canonical/v2/styles.css?authoredForAppVersion=<version>',
    );
    expect(televisionSkill).toContain("read the exact release `version` from `tv status`");
    expect(televisionSkill).toContain("checkout root `package.json`");
    expect(televisionSkill).toContain(APP_VERSION_PASSTHROUGH);
    expect(televisionSkill).toContain(NONRELEASE_VERSION_GUIDANCE);
    expect(televisionSkill).toContain(
      "Preserve an existing `authoredForAppVersion` value during unrelated maintenance",
    );
    expect(televisionSkill).toContain("omit the query parameter");
    expect(televisionSkill).toContain("advisory authoring context");
    expect(televisionSkill).toContain("[theming guidance](./theming.md)");
    expect(televisionSkill).toContain("[resource guidance](./resources.md)");

    const htmlGuidance = readFileSync(
      path.join(
        REPO_ROOT,
        "packages",
        "skills",
        "skills",
        "television",
        "src",
        "html-artifact-style.md",
      ),
      "utf8",
    );
    const compatibility = canonicalCompatibilityFixture();
    const publicTokens = publicFoundationTokens();
    const iconNames = publicIconNames();
    expect(publicTokens).toEqual([...compatibility.tokens["canonical-v2"]!].sort());
    expect(iconNames).toHaveLength(101);

    // Positive control: the source section reached the real built skill and
    // carries every current public name, not a hand-selected sample.
    for (const resource of compatibility.resources["canonical-v2"] ?? []) {
      expect(htmlGuidance, resource).toContain(resource);
      expect(televisionSkill, resource).toContain(resource);
    }
    for (const token of publicTokens) {
      expect(htmlGuidance, token).toContain(`\`${token}\``);
      expect(televisionSkill, token).toContain(`\`${token}\``);
    }
    for (const [tag, attributes] of Object.entries(compatibility.nativeControls["canonical-v2"])) {
      for (const [attribute, values] of Object.entries(attributes)) {
        for (const value of values) {
          for (const guidance of [htmlGuidance, televisionSkill]) {
            expect(guidance).toContain(`<${tag} ${attribute}="${value}"`);
          }
        }
      }
    }
    const retiredTokens = (compatibility.tokens["canonical-v1"] ?? [])
      .filter((token) => !publicTokens.includes(token));
    expect(retiredTokens.length).toBeGreaterThan(0);
    for (const guidance of [htmlGuidance, televisionSkill]) {
      expect(guidance).toMatch(/Load both canonical\s+v2 resources in the document head/);
      for (const token of retiredTokens) expect(guidance, token).not.toContain(token);
    }
    const artifactSkillStylesheets = [
      readDistFile(skillsDistRoot, "tv-calendar", "calendar.css"),
      readDistFile(skillsDistRoot, "tv-tasks", "task.css"),
    ];
    for (const stylesheet of artifactSkillStylesheets) {
      const executableCSS = stylesheet.replace(/\/\*[\s\S]*?\*\//g, "");
      for (const token of retiredTokens) expect(executableCSS, token).not.toContain(token);
    }
    for (const iconName of iconNames) {
      expect(htmlGuidance, iconName).toContain(`\`${iconName}\``);
      expect(televisionSkill, iconName).toContain(`\`${iconName}\``);
    }
    for (const [tag, surface] of Object.entries(
      compatibility.elements["canonical-v2"] ?? {},
    )) {
      expect(htmlGuidance, tag).toContain(`<${tag}`);
      expect(televisionSkill, tag).toContain(`<${tag}`);
      for (const attribute of surface.attributes) {
        expect(htmlGuidance, `${tag}.${attribute}`).toMatch(
          new RegExp(`<${tag}[^>]*\\b${attribute}(?:=|\\s|>)`),
        );
        expect(televisionSkill, `${tag}.${attribute}`).toMatch(
          new RegExp(`<${tag}[^>]*\\b${attribute}(?:=|\\s|>)`),
        );
      }
      for (const [attribute, values] of Object.entries(
        surface.attributeValues,
      )) {
        const publicValues = `${attribute}="${values.join("|")}"`;
        expect(htmlGuidance, `${tag}.${attribute} values`).toContain(
          publicValues,
        );
        expect(televisionSkill, `${tag}.${attribute} values`).toContain(
          publicValues,
        );
      }
      for (const customProperty of surface.customProperties) {
        expect(htmlGuidance, `${tag}.${customProperty}`).toContain(
          `\`${customProperty}\``,
        );
        expect(televisionSkill, `${tag}.${customProperty}`).toContain(
          `\`${customProperty}\``,
        );
      }
    }
    expect(htmlGuidance).toContain('size="sm|md|lg|xl"');
    expect(televisionSkill).toContain('size="sm|md|lg|xl"');
    for (const guidance of [htmlGuidance, televisionSkill]) {
      expect(guidance).toContain(
        "`tv-icon` may be composed inside an author-created shadow root",
      );
    }

    // The positives above establish that this is the built HTML guidance
    // before these absence checks constrain the stale private vocabulary.
    for (const staleCheckboxAPI of [
      "--checkbox-list-gap",
      "--checkbox-size",
      "--checkbox-gap",
      "--checkbox-border-color",
      "--checkbox-radius",
      "--checkbox-checked-content-color",
      "--checkbox-checked-decoration",
    ]) {
      expect(htmlGuidance).not.toContain(staleCheckboxAPI);
      expect(televisionSkill).not.toContain(staleCheckboxAPI);
    }
    expect(htmlGuidance).not.toContain("::part(");
    expect(televisionSkill).not.toContain("::part(");
    expect(htmlGuidance).not.toContain('size="16|24|32"');
    expect(televisionSkill).not.toContain('size="16|24|32"');
    expect(htmlGuidance).not.toContain("subtract-square");
    expect(televisionSkill).not.toContain("subtract-square");
    expect(htmlGuidance).not.toContain("528px");
    expect(televisionSkill).not.toContain("528px");
    expect(htmlGuidance).not.toContain("800px");
    expect(televisionSkill).not.toContain("800px");
    expect(televisionSkill).not.toContain("--persist-uninstall");

    const artifactCalendarSkill = readDistFile(skillsDistRoot, "tv-calendar", "SKILL.md");
    expect(artifactCalendarSkill).toMatch(/^---\nname: tv-calendar\ndescription: .+\n---/);
    expect(artifactCalendarSkill).not.toContain("/skills/artifact-calendar/calendar.css");
    expect(artifactCalendarSkill).not.toContain("/skills/artifact-calendar/calendar.js");
    expect(artifactCalendarSkill).toContain("Know the main `television` skill first.");
    expect(artifactCalendarSkill).toContain("Re-read it only if it is not already in your context or you know it changed.");
    expect(artifactCalendarSkill).not.toContain("house-style.md");

    const artifactTableSkill = readDistFile(skillsDistRoot, "tv-table", "SKILL.md");
    expect(artifactTableSkill).toMatch(/^---\nname: tv-table\ndescription: .+\n---/);
    expect(artifactTableSkill).toContain("Know the main `television` skill first.");
    expect(artifactTableSkill).toContain("Re-read it only if it is not already in your context or you know it changed.");
    expect(artifactTableSkill).not.toContain("house-style.md");

    const artifactTasksSkill = readDistFile(skillsDistRoot, "tv-tasks", "SKILL.md");
    const sidebarViewSkill = readFileSync(
      path.join(REPO_ROOT, "packages", "skills", "skills", "tv-sidebar-view", "SKILL.md"),
      "utf8",
    );
    const appVersionDiscovery =
      "For a running server, read the exact release `version` from `tv status`; " +
      "when working in a Television checkout, read the exact version from the checkout root `package.json`.";
    for (const skill of [
      artifactTasksSkill,
      artifactCalendarSkill,
      artifactTableSkill,
      sidebarViewSkill,
    ]) {
      expect(skill).toContain("/canonical/v2/styles.css?authoredForAppVersion=<version>");
      for (const token of retiredTokens) expect(skill, token).not.toContain(token);
      expect(skill.split(appVersionDiscovery)).toHaveLength(2);
      expect(skill).toContain(APP_VERSION_PASSTHROUGH);
      expect(skill).toContain(NONRELEASE_VERSION_GUIDANCE);
    }
    const artifactTasksCSS = readDistFile(skillsDistRoot, "tv-tasks", "task.css");
    expect(artifactTasksSkill).toContain("Television's frame already names the artifact");
    expect(artifactTasksSkill).toContain("frame title doesn't say");
    expect(artifactTasksSkill).not.toContain("Television card");
    expect(artifactTasksSkill).not.toContain("card name");
    expect(artifactTasksCSS).toContain("artifact frame supplies the chrome around the document");
    expect(artifactTasksCSS).not.toContain("card chrome");

    for (const heading of [
      "# Authoring Television themes",
      "## Theme package and authoring record",
      "### Bundled theme upgrades",
      "## Styling a partial overlay",
      "### Start with the four semantic colors",
      "## Runtime and loading",
      "## Appearance",
      "## Theme selection",
      "## Authoring workflow",
      "## Clouds as a worked example",
    ]) {
      expect(televisionTheming).toContain(heading);
    }
    // proofs/arch/themes/authoring.md#^theme-authoring-t-themes-path-workflow
    expect(televisionTheming).toContain("<themesPath>/<theme-id>/");
    expect(televisionTheming).toContain("<themesPath>/clouds/");
    expect(televisionTheming).toContain("the same `--home`");
    expect(televisionTheming).toContain("`~/.tv-home`");
    for (const retired of ["storage-path", "<storagePath>"]) {
      expect(televisionTheming).not.toContain(retired);
    }
    for (const retired of ["storage-path", "TELEVISION_STORAGE_PATH", "TELEVISION_PORT", "TELEVISION_HOME", "~/.television/artifacts"]) {
      expect(televisionSkill).not.toContain(retired);
    }
    expect(televisionTheming).toContain("preserve that filesystem string exactly");
    expect(televisionTheming).toContain("Do not choose a theme ID beginning with `.`");
    expect(televisionTheming).toContain("Never write into a theme folder you did not author");
    expect(televisionTheming).toContain("explicit confirmation before reusing any existing theme ID");
    expect(televisionTheming).toContain("Keep all theme-authoring work inside this theme folder");
    expect(televisionTheming).toContain(
      "Do not edit Television's installed source, and do not suggest it",
    );
    expect(televisionTheming).toContain("tell them it is unsupported");
    expect(televisionTheming).toContain("it can break features");
    expect(televisionTheming).toContain(
      "the next npm update replaces the installed source and discards the change",
    );
    expect(televisionTheming).toContain("it is their computer; make the change they asked for");
    expect(televisionTheming).toContain("README.md");
    expect(televisionTheming).toContain("user's visual intent");
    expect(televisionTheming).toContain('"colorScheme": "light dark"');
    expect(televisionTheming).toContain('"authoredForAppVersion": "<app-version>"');
    expect(televisionTheming).toContain(APP_VERSION_PASSTHROUGH);
    expect(televisionTheming).toContain(NONRELEASE_VERSION_GUIDANCE);
    expect(televisionTheming).toContain("package `version` remains independent");
    expect(televisionTheming).toContain(
      "Television may occasionally upgrade an installed bundled theme to deliver important Television fixes.",
    );
    expect(televisionTheming).toContain(
      "Before replacing it, Television copies its current folder to a hidden timestamped backup beside the theme.",
    );
    expect(televisionTheming).toContain("version may meet or exceed Television's minimum");
    expect(televisionTheming).toContain("files may contain user edits");
    expect(televisionTheming).toContain("`tv themes-path`");
    expect(televisionTheming).toContain("`tv status`");
    expect(televisionTheming).toContain("served byte for byte");
    expect(televisionTheming).toContain("Frozen canonical v1");
    expect(televisionTheming).toContain("HTML artifacts reload");
    expect(televisionTheming).toContain("markdown editor preserves");
    for (const semanticColor of [
      "--color-surface",
      "--color-surface-muted",
      "--color-text",
      "--color-text-muted",
    ]) {
      expect(televisionTheming).toContain(semanticColor);
    }
    expect(televisionTheming).toContain("A fixed Dark-only or Light-only look");
    expect(televisionTheming).toContain("overrides are optional and keep their foundation defaults when omitted");
    expect(televisionTheming).toContain("Each base color regenerates its complete scale");
    expect(televisionTheming).toContain("Most control families derive active background from resting background");
    expect(televisionTheming).toContain("Wallpaper-overlay controls add a wash of their text color");
    expect(televisionTheming).toContain("an active value inherited from an ancestor was derived there");
    expect(televisionTheming).toContain("Unselected tabs use the wallpaper-overlay treatment by default");
    expect(televisionTheming).toContain("Use the tab tokens only when tabs must differ");
    expect(televisionTheming).toContain("set both `--tab-background` and `--tab-background-active`");
    expect(televisionTheming).toContain("Leave `--tab-background-hover` alone");

    // proofs/arch/themes/authoring.md#^theme-authoring-t-color-scheme-guidance
    const colorSchemeGuidance = {
      requiresManifestField: televisionTheming.includes(
        "manifest's required `colorScheme`",
      ),
      adaptiveManifest: televisionTheming.includes(
        "`light dark` follows that preference",
      ),
      fixedLightManifest: televisionTheming.includes(
        "`light` and `dark` fix the effective appearance",
      ),
      preservesFixedPreference: televisionTheming.includes(
        "without rewriting the preference",
      ) && televisionTheming.includes(
        "A stored preference change under a fixed theme changes no presentation.",
      ),
      refreshPublishesScheme: televisionTheming.includes(
        "includes a changed `colorScheme`",
      ),
      foundationOwnsNativeScheme: televisionTheming.includes(
        "The foundation supplies Television's zero-specificity `color-scheme` value",
      ) && televisionTheming.includes(
        "Theme CSS never declares `color-scheme`",
      ),
      fixedUsesRootTokens: televisionTheming.includes(
        "A fixed theme puts its semantic colors and other token statements at `:root`",
      ),
      adaptiveUsesModeSelectors: televisionTheming.includes(
        "An adaptive theme declares `light dark`",
      ) && televisionTheming.includes(
        "`[data-theme=\"light\"]` and `[data-theme=\"dark\"]`",
      ),
      avoidsAlternateAppearanceMechanisms: televisionTheming.includes(
        "Do not use `light-dark()` or `prefers-color-scheme`",
      ) && !televisionTheming.includes("@media (prefers-color-scheme"),
      verifiesAdaptiveAndFixedStates: televisionTheming.includes(
        "For an adaptive theme, inspect light and dark effective appearance.",
      ) && televisionTheming.includes(
        "For a fixed theme, inspect matching and opposing stored preferences",
      ),
      omitsDefectWorkaround: !televisionTheming.includes("Known defect") &&
        !televisionTheming.includes("TV-803"),
    };
    expect(colorSchemeGuidance).toEqual({
      requiresManifestField: true,
      adaptiveManifest: true,
      fixedLightManifest: true,
      preservesFixedPreference: true,
      refreshPublishesScheme: true,
      foundationOwnsNativeScheme: true,
      fixedUsesRootTokens: true,
      adaptiveUsesModeSelectors: true,
      avoidsAlternateAppearanceMechanisms: true,
      verifiesAdaptiveAndFixedStates: true,
      omitsDefectWorkaround: true,
    });

    // proofs/arch/themes/authoring.md#^theme-authoring-t-active-package-guidance
    const activePackageGuidance = {
      anyFileUsesLiveUpdate: televisionTheming.includes(
        "Saving any file in the active package tree uses the live-update path.",
      ),
      affectedSurfacesRefresh: televisionTheming.includes(
        "The application and affected artifacts refresh",
      ),
      registryPublishesMetadata: televisionTheming.includes(
        "Registry refresh publishes package discovery and manifest metadata.",
      ),
      workflowUsesPackageTree: televisionTheming.includes(
        "Iterate on the files in its watched package tree.",
      ),
      workflowPublishesManifest: televisionTheming.includes(
        "Refresh the theme registry to publish manifest changes.",
      ),
      omitsEntryOnlyException: !televisionTheming.includes(
        "Saving the active `theme.css` uses the live-edit path.",
      ),
      omitsSupplementaryException: !televisionTheming.includes(
        "Supplementary file changes use normal browser revalidation",
      ),
      omitsEntryOnlyWorkflow: !televisionTheming.includes(
        "Iterate on the watched entry stylesheet.",
      ),
    };
    expect(activePackageGuidance).toEqual({
      anyFileUsesLiveUpdate: true,
      affectedSurfacesRefresh: true,
      registryPublishesMetadata: true,
      workflowUsesPackageTree: true,
      workflowPublishesManifest: true,
      omitsEntryOnlyException: true,
      omitsSupplementaryException: true,
      omitsEntryOnlyWorkflow: true,
    });

    // proofs/arch/themes/authoring.md#^theme-authoring-t-javascript-guidance
    for (const executableGuidance of [
      "## Theme effects and scripts",
      '"enableMainJS": true',
      "`main.js`",
      '"enableIframeBackgroundJS": true',
      "`iframe-background.js`",
      '"enableIframeOverlayJS": true',
      "`iframe-overlay.js`",
      "registered manifest snapshot",
      "Television does not parse or validate JavaScript",
      "Prefer CSS",
      "#foreground-overlay",
      "#theme-iframe-background",
      "#theme-iframe-overlay",
      "sandboxed frame",
      "`sandbox=\"allow-scripts\"`",
      "opaque origin",
      "cannot access the application DOM",
      "without main-page consent",
      "pointer input continues to the application",
      "`television-theme-pointer-move`",
      "`television-theme-pointer-down`",
      "`television-theme-pointer-up`",
      "`television-theme-pointer-cancel`",
      "`television-theme-pointer-click`",
      "`clientX`",
      "`clientY`",
      "`button`",
      "`buttons`",
      "`event.source === parent`",
      "opaque recipient requires `\"*\"`",
      "does not create a reverse command channel",
      "browser and desktop application document",
      "never run in artifacts",
      "not a stable JavaScript theme API",
      "Every active-package refresh reruns",
      "destroys and recreates each enabled iframe",
      "repeat-safe",
      "frame's removal ends its document, listeners, timers, and effects",
      "`document.currentScript.src`",
      "load failure, syntax error, or uncaught exception",
      "CPU or GPU use",
    ]) {
      expect(televisionTheming, executableGuidance).toContain(executableGuidance);
    }
    for (const retiredExecutableGuidance of [
      '"enableJS": true',
      "root `theme.js`",
    ]) {
      expect(televisionTheming, retiredExecutableGuidance).not.toContain(
        retiredExecutableGuidance,
      );
    }

    // proofs/arch/themes/authoring.md#^theme-authoring-t-frame-appearance-guidance
    for (const frameAppearanceGuidance of [
      "keeps each frame element's `color-scheme` and its document's declared scheme matched to the effective `data-theme`",
      "that match is what keeps the frame transparent",
      "Read `data-theme` from the frame document's root once at startup",
      "Appearance changes recreate the frames and rerun their scripts",
      "need no appearance listener",
      "Never change `color-scheme` on the frame document's root",
      "forces the frame opaque",
      "Theme CSS cannot cross into frame documents",
    ]) {
      expect(televisionTheming, frameAppearanceGuidance).toContain(
        frameAppearanceGuidance,
      );
    }

    // proofs/arch/themes/authoring.md#^theme-authoring-t-javascript-consent-guidance
    for (const consentGuidance of [
      "registered `enableMainJS: true` makes the root `main.js` eligible",
      "active theme's exact ID in the server's persisted consent set",
      "Selecting or activating a theme does not grant consent",
      "inspect and explain `main.js`",
      "ask the user to grant consent in Settings",
      "does not grant consent on the user's behalf",
      "explicit trust decision",
      "DOM, globals, browser storage, and network APIs",
      "Consent persists for the exact theme ID",
      "automatically reloads the application document",
      "DOM additions, listeners, timers, globals, and other document-lifetime effects",
    ]) {
      expect(televisionTheming, consentGuidance).toContain(consentGuidance);
    }
    for (const manualReloadGuidance of [
      "reload the application manually",
      "manually reload the application",
      "manual reload",
      "Cmd+R",
      "Ctrl+R",
    ]) {
      expect(televisionTheming, manualReloadGuidance).not.toContain(
        manualReloadGuidance,
      );
    }

    expect(televisionTheming).toContain("partial overlay");
    expect(televisionTheming).toContain("Override documented tokens at `:root` wherever they express the intended change");
    expect(televisionTheming).not.toContain("### Applying tokens");
    expect(televisionTheming).not.toContain("Shared native inputs and errors");
    expect(televisionSkill).toContain('`aria-invalid="true"`');
    expect(televisionSkill).toContain("`aria-describedby`");
    expect(televisionSkill).toContain("`tv-error`");
    expect(televisionTheming).toContain("application rules can still win if their selectors are more specific");
    expect(televisionTheming).not.toContain("Foundation element override points");
    expect(televisionTheming).toContain('`data-theme="light"`');
    expect(televisionTheming).toContain('`data-theme="dark"`');
    expect(televisionTheming).toContain("Do not use `light-dark()` or `prefers-color-scheme`");
    expect(televisionTheming).toContain(
      "matching native controls and embedded contexts to `data-theme`",
    );
    expect(televisionTheming).toContain("Theme CSS never declares `color-scheme`");
    expect(televisionTheming).toContain("the manifest is the theme's one appearance declaration");
    expect(televisionTheming).toContain("Settings UI");
    expect(televisionTheming).toContain("`tv set-theme <theme-id>`");
    expect(televisionTheming).toContain("Active theme changed from '<previous>' to '<new>'.");
    expect(televisionTheming).toContain("Active theme unchanged: '<selection>'.");
    expect(televisionTheming).toContain("Active theme: '<new>'.");
    expect(televisionTheming).toContain("four captures");
    expect(televisionTheming).toContain("Wait for the user's consent before capturing them");
    expect(televisionTheming).toContain("delete every temporary capture after review");

    expect(televisionTheming).not.toContain("Placeholder —");
    expect(televisionTheming).not.toContain("{{INJECT_");
    expect(televisionTheming).not.toContain("themes-conformance-waiver");
    for (const filename of ["tokens/fonts.css", "colors.css", "text.css", "spacing.css", "shadows.css", "layers.css", "app.css"]) {
      const source = readFileSync(path.join(REPO_ROOT, "packages/web/src/foundation", filename), "utf8");
      expect(televisionTheming).toContain(source.trimEnd());
    }
    const reference = readFileSync(path.join(REPO_ROOT, "packages/skills/skills/television/src/app-shell-reference.md"), "utf8");
    expect(televisionTheming).not.toContain("app-reference-source");
    for (const line of reference.split("\n")) {
      if (line.trim() && !line.startsWith("<!-- app-reference-source:") && !line.startsWith("<!-- Authority freshness:")) {
        expect(televisionTheming).toContain(line);
      }
    }
    for (const obsolete of ["Create a new skill", "tv-theme-", "null theme"]) {
      expect(televisionTheming).not.toContain(obsolete);
    }
    expect(televisionTheming).not.toContain("@media (prefers-color-scheme");
    expect(televisionTheming).not.toContain("house-style.md");
  });

  it("ignores skill directories that are not listed in the manifest", () => {
    const { root, scriptPath, skillsPackageDir } = createTempSkillsRepo();
    writeManifest(skillsPackageDir, ["listed-skill"]);
    writeSkillFile(
      skillsPackageDir,
      "listed-skill",
      "SKILL.md",
      "---\nname: listed-skill\ndescription: Listed skill.\n---\n\n# Listed\n",
    );
    writeSkillFile(
      skillsPackageDir,
      "stale-residue",
      "dist/SKILL.md",
      "---\nname: stale-residue\ndescription: Stale leftover folder.\n---\n\n# Stale\n",
    );
    writeSkillFile(skillsPackageDir, "stale-residue", "out/output.html", "<!doctype html>\n");

    runBuild(scriptPath, root);
    expect(existsSync(path.join(skillsPackageDir, "dist", "listed-skill", "SKILL.md"))).toBe(true);
    expect(existsSync(path.join(skillsPackageDir, "dist", "stale-residue"))).toBe(false);
  });

  it("fails when the manifest lists a skill with no source directory", () => {
    const { root, scriptPath, skillsPackageDir } = createTempSkillsRepo();
    writeManifest(skillsPackageDir, ["ghost-skill"]);

    const stderr = runBuildExpectFailure(scriptPath, root);
    expect(stderr).toContain("ghost-skill");
    expect(stderr).toContain("no source directory");
  });

  it("fails when the manifest is missing", () => {
    const { root, scriptPath, skillsPackageDir } = createTempSkillsRepo();
    writeSkillFile(
      skillsPackageDir,
      "some-skill",
      "SKILL.md",
      "---\nname: some-skill\ndescription: Some skill.\n---\n\n# Some skill\n",
    );

    const stderr = runBuildExpectFailure(scriptPath, root);
    expect(stderr).toContain("Missing skill manifest");
    expect(stderr).toContain("skills.json");
  });

  it("fails when the manifest lists duplicate skills", () => {
    const { root, scriptPath, skillsPackageDir } = createTempSkillsRepo();
    writeManifest(skillsPackageDir, ["dup-skill", "dup-skill"]);
    writeSkillFile(
      skillsPackageDir,
      "dup-skill",
      "SKILL.md",
      "---\nname: dup-skill\ndescription: Duplicate skill.\n---\n\n# Dup\n",
    );

    const stderr = runBuildExpectFailure(scriptPath, root);
    expect(stderr).toContain("duplicate skills");
    expect(stderr).toContain("dup-skill");
  });

  it("fails when an emitted SKILL.md is missing a name field", () => {
    const { root, scriptPath, skillsPackageDir } = createTempSkillsRepo();
    writeManifest(skillsPackageDir, ["bad-skill"]);
    writeSkillFile(
      skillsPackageDir,
      "bad-skill",
      "SKILL.md",
      "---\ndescription: Missing name.\n---\n\n# Bad skill\n",
    );

    const stderr = runBuildExpectFailure(scriptPath, root);
    expect(stderr).toContain("bad-skill/SKILL.md");
    expect(stderr).toContain("name");
  });

  it("fails when an emitted SKILL.md is missing a description field", () => {
    const { root, scriptPath, skillsPackageDir } = createTempSkillsRepo();
    writeManifest(skillsPackageDir, ["bad-skill"]);
    writeSkillFile(
      skillsPackageDir,
      "bad-skill",
      "SKILL.md",
      "---\nname: bad-skill\n---\n\n# Bad skill\n",
    );

    const stderr = runBuildExpectFailure(scriptPath, root);
    expect(stderr).toContain("bad-skill/SKILL.md");
    expect(stderr).toContain("description");
  });

  it("fails when an emitted SKILL.md is missing entirely", () => {
    const { root, scriptPath, skillsPackageDir } = createTempSkillsRepo();
    writeManifest(skillsPackageDir, ["bad-skill"]);
    writeSkillFile(skillsPackageDir, "bad-skill", "example/index.html", "<!doctype html>\n");

    const stderr = runBuildExpectFailure(scriptPath, root);
    expect(stderr).toContain("bad-skill/SKILL.md");
    expect(stderr).toContain("Missing emitted SKILL.md");
  });

  it("fails when SKILL frontmatter name does not match the renamed skill directory", () => {
    const { root, scriptPath, skillsPackageDir } = createTempSkillsRepo();
    writeManifest(skillsPackageDir, ["tv-calendar"]);
    writeSkillFile(
      skillsPackageDir,
      "tv-calendar",
      "SKILL.md",
      "---\nname: artifact-calendar\ndescription: Wrong renamed skill.\n---\n\n# Bad skill\n",
    );

    const stderr = runBuildExpectFailure(scriptPath, root);
    expect(stderr).toContain("tv-calendar/SKILL.md");
    expect(stderr).toContain("name must be tv-calendar");
  });
});

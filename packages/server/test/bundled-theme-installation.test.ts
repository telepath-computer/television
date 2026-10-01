import { parse } from "yaml";
import { afterEach, describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  BUNDLED_THEMES,
  BUNDLED_THEME_IDS,
  DEFAULT_BUNDLED_THEME_ID,
  type BundledThemeState,
  getBundledThemeBackupTempPath,
  getBundledThemeCopyTempPath,
  getBundledThemeStateTempPath,
  readBundledThemeStateFile,
  writeBundledThemeStateFile,
} from "../src/bundled-theme-installer.ts";
import { getBundledThemesStatePath } from "../src/artifact-paths.ts";
import { ServerStore } from "../src/server-store.ts";
import { isSemanticVersion, scanThemesDirectory } from "../src/themes.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const validateThemesScript = path.resolve(here, "..", "scripts", "validate-themes.mjs");
const UNPRIVILEGED_USER_ID = 65_534;

interface TestTree {
  root: string;
  themesPath: string;
}

function createTestTree(prefix: string): TestTree {
  const root = mkdtempSync(path.join(os.tmpdir(), prefix));
  const themesPath = path.join(root, "themes");
  mkdirSync(themesPath, { recursive: true });
  return { root, themesPath };
}

function writePackage(themesPath: string, themeID: string, options: {
  name?: string;
  version?: string;
  colorScheme?: string;
  css?: string;
  asset?: string;
} = {}): string {
  const packagePath = path.join(themesPath, themeID);
  mkdirSync(packagePath, { recursive: true });
  writeFileSync(path.join(packagePath, "manifest.json"), `${JSON.stringify({
    name: options.name ?? themeID,
    version: options.version ?? (themeID === "clouds" ? "2.1.0" : "1.1.0"),
    colorScheme: options.colorScheme ??
      (themeID === "nord" || themeID === "tokyo-night" ? "dark" : "light dark"),
  }, null, 2)}\n`);
  writeFileSync(path.join(packagePath, "theme.css"), options.css ?? `:root { --fixture-theme: ${themeID}; }\n`);
  if (options.asset !== undefined) {
    mkdirSync(path.join(packagePath, "assets"));
    writeFileSync(path.join(packagePath, "assets", "texture.txt"), options.asset);
  }
  return packagePath;
}

function writeBundledSourceTree(
  themesPath: string,
  overrides: Partial<Record<(typeof BUNDLED_THEMES)[number]["id"], Parameters<typeof writePackage>[2]>> = {},
): void {
  for (const { id, minimumVersion } of BUNDLED_THEMES) {
    writePackage(themesPath, id, {
      name: id === "clouds" ? "Clouds" : id,
      version: minimumVersion,
      ...overrides[id],
    });
  }
}

function writeState(
  storagePath: string,
  installedThemeIDs: string[],
  initialThemeSelectionComplete = true,
): void {
  const statePath = getBundledThemesStatePath(storagePath);
  mkdirSync(path.dirname(statePath), { recursive: true });
  writeFileSync(statePath, `${JSON.stringify({
    version: 2,
    installedThemeIDs: [...installedThemeIDs].sort((left, right) => left.localeCompare(right, "en")),
    initialThemeSelectionComplete,
  }, null, 2)}\n`);
}

function seedDisplay(
  storagePath: string,
  activeThemeName: string | null,
  themeJavaScriptConsentIds: string[] = [],
): void {
  const channelsDir = path.join(storagePath, "state", "channels");
  mkdirSync(channelsDir, { recursive: true });
  writeFileSync(path.join(channelsDir, "channel-a.json"), `${JSON.stringify({
    id: "channel-a",
    name: "A",
    layoutVersion: 2,
    layout: [],
  }, null, 2)}\n`);
  writeFileSync(path.join(storagePath, "state", "display.json"), `${JSON.stringify({
    focusedChannelId: "channel-a",
    pinnedChannelIds: [],
    activeThemeName,
    appearanceMode: "system",
    themeJavaScriptConsentIds,
  }, null, 2)}\n`);
}

function readState(storagePath: string): BundledThemeState {
  return JSON.parse(
    readFileSync(getBundledThemesStatePath(storagePath), "utf8"),
  ) as BundledThemeState;
}

function boot(storagePath: string, bundledThemesPath: string): ServerStore {
  return new ServerStore({
    storagePath,
    bundledThemesPath,
    installOnboardingChannels: true,
  });
}

function filesUnder(root: string, prefix = ""): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(path.join(root, prefix), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, "en"))) {
    const relative = path.join(prefix, entry.name);
    if (entry.isDirectory()) files.push(...filesUnder(root, relative));
    else files.push(relative);
  }
  return files;
}

function snapshotFiles(root: string): Record<string, { bytes: Buffer; mtimeMs: number }> {
  return Object.fromEntries(filesUnder(root).map((relative) => {
    const filePath = path.join(root, relative);
    return [relative, { bytes: readFileSync(filePath), mtimeMs: statSync(filePath).mtimeMs }];
  }));
}

function expectSnapshot(root: string, expected: ReturnType<typeof snapshotFiles>): void {
  expect(filesUnder(root)).toEqual(Object.keys(expected));
  for (const [relative, snapshot] of Object.entries(expected)) {
    const filePath = path.join(root, relative);
    expect(readFileSync(filePath), relative).toEqual(snapshot.bytes);
    expect(statSync(filePath).mtimeMs, relative).toBe(snapshot.mtimeMs);
  }
}

function expectSnapshotBytes(root: string, expected: ReturnType<typeof snapshotFiles>): void {
  expect(filesUnder(root)).toEqual(Object.keys(expected));
  for (const [relative, snapshot] of Object.entries(expected)) {
    expect(readFileSync(path.join(root, relative)), relative).toEqual(snapshot.bytes);
  }
}

function setTreeTime(root: string, date: Date): void {
  for (const relative of filesUnder(root)) utimesSync(path.join(root, relative), date, date);
}

function makeTreeWorldAccessible(root: string): void {
  chmodSync(root, 0o777);
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const entryPath = path.join(root, entry.name);
    if (entry.isDirectory()) makeTreeWorldAccessible(entryPath);
    else chmodSync(entryPath, 0o666);
  }
}

describe("bundled theme installation", () => {
  const roots: string[] = [];
  const stores: ServerStore[] = [];

  afterEach(() => {
    for (const store of stores.splice(0)) store.dispose();
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  function trackedTree(prefix: string): TestTree {
    const tree = createTestTree(prefix);
    roots.push(tree.root);
    return tree;
  }

  function trackedBoot(storagePath: string, bundledThemesPath: string): ServerStore {
    const store = boot(storagePath, bundledThemesPath);
    stores.push(store);
    return store;
  }

  function dispose(store: ServerStore): void {
    store.dispose();
    stores.splice(stores.indexOf(store), 1);
  }

  // proofs/arch/themes/bundled-installation.md#^bundled-t-version-table
  it("declares the exact bundled theme IDs, minimums, and default", () => {
    expect(BUNDLED_THEMES).toEqual(parse(readFileSync(path.resolve(here, "../../../specs/ui/themes/bundled.yml"), "utf8")));
    expect(BUNDLED_THEME_IDS).toEqual(BUNDLED_THEMES.map(({ id }) => id));
    expect(BUNDLED_THEMES.every(({ minimumVersion }) => isSemanticVersion(minimumVersion))).toBe(true);
    expect(DEFAULT_BUNDLED_THEME_ID).toBe("clouds");
  });

  // proofs/arch/themes/bundled-installation.md#^bundled-t-color-scheme-versions
  it("declares the exact bundled source versions, minimums, and color schemes", () => {
    const sourcePath = path.resolve(import.meta.dirname, "../assets/themes");
    const snapshot = scanThemesDirectory(sourcePath);

    expect(snapshot.errors).toEqual([]);
    expect(Object.fromEntries(snapshot.themes.map((theme) => [theme.id, {
      version: theme.version,
      colorScheme: theme.colorScheme,
      minimumVersion: BUNDLED_THEMES.find(({ id }) => id === theme.id)?.minimumVersion,
    }]))).toEqual({
      aquarium: {
        version: "1.0.2",
        colorScheme: "light dark",
        minimumVersion: "1.0.2",
      },
      blueprint: {
        version: "1.0.0",
        colorScheme: "dark",
        minimumVersion: "1.0.0",
      },
      "crt-phosphor": {
        version: "1.0.0",
        colorScheme: "dark",
        minimumVersion: "1.0.0",
      },
      clouds: {
        version: "2.1.0",
        colorScheme: "light dark",
        minimumVersion: "2.1.0",
      },
      nord: {
        version: "1.1.1",
        colorScheme: "dark",
        minimumVersion: "1.1.0",
      },
      swiss: {
        version: "1.1.1",
        colorScheme: "light dark",
        minimumVersion: "1.1.0",
      },
      "tokyo-night": {
        version: "1.1.1",
        colorScheme: "dark",
        minimumVersion: "1.1.0",
      },
    });
  });

  it("enumerates exactly the valid bundled source-package IDs", () => {
    const sourcePath = path.resolve(import.meta.dirname, "../assets/themes");
    const snapshot = scanThemesDirectory(sourcePath);

    expect(snapshot.errors).toEqual([]);
    expect(snapshot.themes.map((theme) => theme.id).sort()).toEqual([...BUNDLED_THEME_IDS].sort());
  });

  // proofs/arch/themes/bundled-installation.md#^bundled-t-build-validation
  it("validates exact bundled inventory, package shape, and minimum versions", () => {
    const validate = (themesPath?: string) => spawnSync(
      process.execPath,
      themesPath === undefined ? [validateThemesScript] : [validateThemesScript, themesPath],
      { encoding: "utf8" },
    );

    const committed = validate();
    expect(committed.status, committed.stderr).toBe(0);

    const missing = trackedTree("television-bundled-theme-validation-");
    writeBundledSourceTree(missing.themesPath);
    rmSync(path.join(missing.themesPath, "clouds"), { recursive: true });
    const missingResult = validate(missing.themesPath);
    expect(missingResult.status).toBe(1);
    expect(missingResult.stderr).toMatch(/missing.*clouds/i);

    const extra = trackedTree("television-bundled-theme-validation-");
    writeBundledSourceTree(extra.themesPath);
    writePackage(extra.themesPath, "extra-theme");
    const extraResult = validate(extra.themesPath);
    expect(extraResult.status).toBe(1);
    expect(extraResult.stderr).toMatch(/unexpected.*extra-theme/i);

    const invalid = trackedTree("television-bundled-theme-validation-");
    writeBundledSourceTree(invalid.themesPath);
    rmSync(path.join(invalid.themesPath, "nord", "theme.css"));
    const invalidResult = validate(invalid.themesPath);
    expect(invalidResult.status).toBe(1);
    expect(invalidResult.stderr).toMatch(/nord.*theme\.css/i);

    const belowMinimum = trackedTree("television-bundled-theme-validation-");
    writeBundledSourceTree(belowMinimum.themesPath, { clouds: { version: "1.99.0" } });
    const belowMinimumResult = validate(belowMinimum.themesPath);
    expect(belowMinimumResult.status).toBe(1);
    expect(belowMinimumResult.stderr).toMatch(/clouds.*2\.1\.0/i);
  });

  // proofs/arch/themes/bundled-installation.md#^bundled-t-retired-package
  it("preserves an installed theme removed from the bundled source", () => {
    const source = trackedTree("television-retired-theme-source-");
    writeBundledSourceTree(source.themesPath);
    const storage = trackedTree("television-retired-theme-storage-");
    seedDisplay(storage.root, "solarized");
    writeState(storage.root, [...BUNDLED_THEME_IDS, "solarized"]);
    const installed = writePackage(storage.themesPath, "solarized", { name: "Solarized", asset: "original texture\n" });
    writeFileSync(path.join(installed, "user-note.txt"), "keep my changes\n");
    const before = snapshotFiles(installed);

    const next = trackedBoot(storage.root, source.themesPath);
    expectSnapshot(installed, before);
    expect(next.getThemeRegistry().themes).toEqual([{
      id: "solarized",
      name: "Solarized",
      version: "1.1.0",
      colorScheme: "light dark",
    }]);
    expect(next.getActiveThemeName()).toBe("solarized");
  });

  // proofs/arch/themes/bundled-installation.md#^bundled-t-install-preserve-replace
  it.each([
    ["unhandled absent theme", false, "absent", "1.1.0", "1.1.0", "install"],
    ["handled deleted theme", true, "absent", "1.1.0", "1.1.0", "absent"],
    ["invalid directory", true, "invalid", "1.1.0", "1.1.0", "replace"],
    ["non-directory content", true, "file", "1.1.0", "1.1.0", "replace"],
    ["below-minimum version", true, "valid", "1.0.9", "1.1.0", "replace"],
    ["prerelease below minimum", true, "valid", "1.1.0-alpha.1", "1.1.0", "replace"],
    ["version equal to minimum", true, "valid", "1.1.0", "1.1.0", "preserve"],
    ["version above minimum", true, "valid", "10.0.0", "1.1.0", "preserve"],
    ["unrecorded sufficient version", false, "valid", "1.1.0", "1.1.0", "preserve"],
    ["sufficient version despite newer source", true, "valid", "1.1.0", "2.0.0", "preserve"],
  ] as const)("installs, preserves, and replaces from the minimum-version decision matrix: %s", (_label, handled, kind, version, sourceVersion, outcome) => {
    const source = trackedTree("television-bundled-theme-source-");
    writeBundledSourceTree(source.themesPath, { nord: { version: sourceVersion } });
    const storage = trackedTree("television-bundled-theme-storage-");
    seedDisplay(storage.root, null);
    writeState(storage.root, BUNDLED_THEME_IDS.filter((id) => handled || id !== "nord"));
    const destination = path.join(storage.themesPath, "nord");
    if (kind === "invalid") {
      mkdirSync(destination);
      writeFileSync(path.join(destination, "theme.css"), "/* invalid */\n");
    } else if (kind === "file") {
      writeFileSync(destination, "invalid non-directory content\n");
    } else if (kind === "valid") {
      writePackage(storage.themesPath, "nord", { version, css: "/* user content */\n", asset: "user asset\n" });
    }
    const before = outcome === "preserve" ? snapshotFiles(destination) : null;
    const store = trackedBoot(storage.root, source.themesPath);

    if (outcome === "absent") {
      expect(existsSync(destination)).toBe(false);
    } else if (before !== null) {
      expectSnapshot(destination, before);
    } else {
      expectSnapshotBytes(destination, snapshotFiles(path.join(source.themesPath, "nord")));
    }
    expect(store.getThemeRegistry().errors).toEqual([]);
    expect(readState(storage.root)).toEqual({
      version: 2,
      installedThemeIDs: [...BUNDLED_THEME_IDS].sort((left, right) => left.localeCompare(right, "en")),
      initialThemeSelectionComplete: true,
    });
  });

  // proofs/arch/themes/bundled-installation.md#^bundled-t-backup-replacement
  it("copies complete unused backups before repeated replacement and keeps selection and consent", () => {
    const source = trackedTree("television-bundled-theme-source-");
    writeBundledSourceTree(source.themesPath);
    const storage = trackedTree("television-bundled-theme-storage-");
    seedDisplay(storage.root, "clouds", ["clouds", "private-theme"]);
    writeState(storage.root, [...BUNDLED_THEME_IDS]);
    const destination = writePackage(storage.themesPath, "clouds", {
      version: "1.4.0",
      css: "/* first prior */\n",
      asset: "first prior asset\n",
    });
    writeFileSync(path.join(destination, "extra.txt"), "first extra\n");
    const firstPrior = snapshotFiles(destination);

    const first = trackedBoot(storage.root, source.themesPath);
    expectSnapshotBytes(destination, snapshotFiles(path.join(source.themesPath, "clouds")));
    expect(first.getDisplayState()).toMatchObject({
      activeThemeName: "clouds",
      themeJavaScriptConsentIds: ["clouds", "private-theme"],
    });
    expect(first.getThemeRegistry().themes.map(({ id }) => id)).toEqual(["clouds"]);
    expect(first.getThemeRegistry().errors).toEqual([]);
    dispose(first);

    rmSync(destination, { recursive: true });
    writePackage(storage.themesPath, "clouds", {
      version: "1.5.0",
      css: "/* second prior */\n",
      asset: "second prior asset\n",
    });
    writeFileSync(path.join(destination, "extra.txt"), "second extra\n");
    const secondPrior = snapshotFiles(destination);

    const second = trackedBoot(storage.root, source.themesPath);
    expectSnapshotBytes(destination, snapshotFiles(path.join(source.themesPath, "clouds")));
    const backups = readdirSync(storage.themesPath)
      .filter((name) => /^\.clouds\.backup\.\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}$/.test(name))
      .sort();
    expect(backups).toHaveLength(2);
    expectSnapshotBytes(path.join(storage.themesPath, backups[0]!), firstPrior);
    expectSnapshotBytes(path.join(storage.themesPath, backups[1]!), secondPrior);
    expect(second.getThemeRegistry().themes.map(({ id }) => id)).toEqual(["clouds"]);
    expect(second.getThemeRegistry().errors).toEqual([]);
  });

  // proofs/arch/themes/bundled-installation.md#^bundled-t-failures
  it("warns on replacement failure, continues other themes, and converges on retry", () => {
    const source = trackedTree("television-bundled-theme-source-");
    writeBundledSourceTree(source.themesPath);
    const storage = trackedTree("television-bundled-theme-storage-");
    seedDisplay(storage.root, null);
    writeState(
      storage.root,
      BUNDLED_THEME_IDS.filter((id) => id !== "clouds" && id !== "nord"),
      false,
    );
    const destination = writePackage(storage.themesPath, "clouds", {
      version: "1.0.0",
      css: "/* prior */\n",
      asset: "prior asset\n",
    });
    const prior = snapshotFiles(destination);
    const obstruction = getBundledThemeCopyTempPath(storage.root, "clouds");
    writeFileSync(obstruction, "blocks replacement staging");
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const first = trackedBoot(storage.root, source.themesPath);
    expectSnapshot(destination, prior);
    expect(existsSync(obstruction)).toBe(false);
    expect(existsSync(path.join(storage.themesPath, "nord"))).toBe(true);
    expect(readState(storage.root)).toMatchObject({
      installedThemeIDs: expect.arrayContaining(["nord"]),
      initialThemeSelectionComplete: false,
    });
    expect(first.getActiveThemeName()).toBeNull();
    expect(warning.mock.calls.some(([message]) => String(message).includes("Failed to replace bundled theme \"clouds\""))).toBe(true);
    dispose(first);

    const second = trackedBoot(storage.root, source.themesPath);
    expectSnapshotBytes(destination, snapshotFiles(path.join(source.themesPath, "clouds")));
    expect(second.getActiveThemeName()).toBe("clouds");
    expect(readState(storage.root)).toMatchObject({ initialThemeSelectionComplete: true });
    warning.mockRestore();
  });

  it("warns on backup failure, preserves the destination, and converges on retry", () => {
    const source = trackedTree("television-bundled-theme-source-");
    writeBundledSourceTree(source.themesPath);
    const storage = trackedTree("television-bundled-theme-storage-");
    seedDisplay(storage.root, null);
    writeState(
      storage.root,
      BUNDLED_THEME_IDS.filter((id) => id !== "clouds" && id !== "nord"),
      false,
    );
    const destination = writePackage(storage.themesPath, "clouds", {
      version: "1.0.0",
      css: "/* prior */\n",
      asset: "prior asset\n",
    });
    const prior = snapshotFiles(destination);
    writeFileSync(getBundledThemeBackupTempPath(storage.root, "clouds"), "blocks backup copy");
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const first = trackedBoot(storage.root, source.themesPath);
    expectSnapshot(destination, prior);
    expect(existsSync(path.join(storage.themesPath, "nord"))).toBe(true);
    expect(first.getActiveThemeName()).toBeNull();
    expect(warning.mock.calls.some(([message]) => String(message).includes("Failed to back up bundled theme \"clouds\""))).toBe(true);
    dispose(first);

    const second = trackedBoot(storage.root, source.themesPath);
    expectSnapshotBytes(destination, snapshotFiles(path.join(source.themesPath, "clouds")));
    expect(second.getActiveThemeName()).toBe("clouds");
    warning.mockRestore();
  });

  it("recovers a prior destination before retrying an interrupted replacement", () => {
    const source = trackedTree("television-bundled-theme-source-");
    writeBundledSourceTree(source.themesPath);
    const storage = trackedTree("television-bundled-theme-storage-");
    seedDisplay(storage.root, "clouds", ["clouds"]);
    writeState(storage.root, [...BUNDLED_THEME_IDS]);
    const destination = writePackage(storage.themesPath, "clouds", {
      version: "1.0.0",
      css: "/* interrupted prior */\n",
      asset: "interrupted prior asset\n",
    });
    const prior = snapshotFiles(destination);
    const previousPath = path.join(storage.themesPath, ".clouds.bundled-theme.previous-424242");
    const stagedPath = path.join(storage.themesPath, ".clouds.bundled-theme.tmp-424242");
    renameSync(destination, previousPath);
    cpSync(path.join(source.themesPath, "clouds"), stagedPath, { recursive: true });

    const store = trackedBoot(storage.root, source.themesPath);

    expectSnapshotBytes(destination, snapshotFiles(path.join(source.themesPath, "clouds")));
    expect(existsSync(previousPath)).toBe(false);
    expect(existsSync(stagedPath)).toBe(false);
    const backup = readdirSync(storage.themesPath).find((name) => name.startsWith(".clouds.backup."));
    expect(backup).toBeDefined();
    expectSnapshotBytes(path.join(storage.themesPath, backup!), prior);
    expect(store.getActiveThemeName()).toBe("clouds");
  });

  it("keeps a completed install pending when its state write fails, then converges", () => {
    const source = trackedTree("television-bundled-theme-source-");
    writeBundledSourceTree(source.themesPath);
    const storage = trackedTree("television-bundled-theme-storage-");
    seedDisplay(storage.root, null);
    writeState(storage.root, BUNDLED_THEME_IDS.filter((id) => id !== "clouds"), false);
    mkdirSync(getBundledThemeStateTempPath(storage.root));
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const first = trackedBoot(storage.root, source.themesPath);
    expectSnapshotBytes(
      path.join(storage.themesPath, "clouds"),
      snapshotFiles(path.join(source.themesPath, "clouds")),
    );
    expect(readState(storage.root).installedThemeIDs).not.toContain("clouds");
    expect(first.getActiveThemeName()).toBeNull();
    expect(warning.mock.calls.some(([message]) => String(message).includes("Failed to record bundled theme \"clouds\""))).toBe(true);
    dispose(first);

    const second = trackedBoot(storage.root, source.themesPath);
    expect(second.getActiveThemeName()).toBe("clouds");
    expect(readState(storage.root)).toMatchObject({
      installedThemeIDs: [...BUNDLED_THEME_IDS].sort((left, right) => left.localeCompare(right, "en")),
      initialThemeSelectionComplete: true,
    });
    warning.mockRestore();
  });

  it("leaves invalid state and all destinations untouched", () => {
    const source = trackedTree("television-bundled-theme-source-");
    writePackage(source.themesPath, "ocean");
    const storage = trackedTree("television-bundled-theme-storage-");
    const statePath = getBundledThemesStatePath(storage.root);
    mkdirSync(path.dirname(statePath), { recursive: true });
    const invalid = "{ definitely not valid JSON\n";
    writeFileSync(statePath, invalid);
    const leftover = path.join(storage.themesPath, ".ocean.bundled-theme.tmp-1234");
    mkdirSync(leftover);

    trackedBoot(storage.root, source.themesPath);
    expect(readFileSync(statePath, "utf8")).toBe(invalid);
    expect(existsSync(path.join(storage.themesPath, "ocean"))).toBe(false);
    expect(existsSync(leftover)).toBe(true);
  });

  it("removes only crash-leftover directories in the installer namespace", () => {
    const source = trackedTree("television-bundled-theme-source-");
    const storage = trackedTree("television-bundled-theme-storage-");
    const leftover = getBundledThemeCopyTempPath(storage.root, "clouds");
    const unrelated = path.join(storage.themesPath, ".clouds.other.tmp-1234");
    const matchingFile = path.join(storage.themesPath, ".Paper Theme.bundled-theme.tmp-5678");
    mkdirSync(leftover);
    mkdirSync(unrelated);
    writeFileSync(matchingFile, "not an installer directory");

    trackedBoot(storage.root, source.themesPath);

    expect(existsSync(leftover)).toBe(false);
    expect(existsSync(unrelated)).toBe(true);
    expect(readFileSync(matchingFile, "utf8")).toBe("not an installer directory");
  });

  it("selects the default theme Clouds exactly once from an unset theme", () => {
    const source = trackedTree("television-bundled-theme-source-");
    writePackage(source.themesPath, "clouds", { name: "Clouds" });
    const fresh = trackedTree("television-bundled-theme-storage-");

    const first = trackedBoot(fresh.root, source.themesPath);
    expect(first.getActiveThemeName()).toBe("clouds");
    expect(readState(fresh.root)).toEqual({
      version: 2,
      installedThemeIDs: ["clouds"],
      initialThemeSelectionComplete: true,
    });
    dispose(first);

    const upgrade = trackedTree("television-bundled-theme-storage-");
    seedDisplay(upgrade.root, null);
    const existingClouds = writePackage(upgrade.themesPath, "clouds", {
      name: "Existing Clouds",
      version: "2.1.0",
      css: "/* sufficient existing Clouds */\n",
    });
    const existingSnapshot = snapshotFiles(existingClouds);
    const upgraded = trackedBoot(upgrade.root, source.themesPath);
    expect(upgraded.getActiveThemeName()).toBe("clouds");
    expectSnapshot(existingClouds, existingSnapshot);
  });

  it("selects Clouds after replacing a below-minimum pre-existing package", () => {
    const source = trackedTree("television-bundled-theme-source-");
    writeBundledSourceTree(source.themesPath);
    const storage = trackedTree("television-bundled-theme-storage-");
    seedDisplay(storage.root, null);
    writeState(storage.root, BUNDLED_THEME_IDS.filter((id) => id !== "clouds"), false);
    writePackage(storage.themesPath, "clouds", { version: "1.99.0" });

    const store = trackedBoot(storage.root, source.themesPath);

    expect(store.getActiveThemeName()).toBe("clouds");
    expect(store.getThemeRegistry().themes.find(({ id }) => id === "clouds")?.version).toBe("2.1.0");
    expect(readState(storage.root)).toMatchObject({ initialThemeSelectionComplete: true });
  });

  it("preserves set themes and applies invalid-theme fallback after the Clouds decision", () => {
    const source = trackedTree("television-bundled-theme-source-");
    writePackage(source.themesPath, "clouds", { name: "Clouds" });

    const valid = trackedTree("television-bundled-theme-storage-");
    writePackage(valid.themesPath, "paper", { name: "Paper" });
    seedDisplay(valid.root, "paper");
    const validStore = trackedBoot(valid.root, source.themesPath);
    expect(validStore.getActiveThemeName()).toBe("paper");
    expect(readState(valid.root)).toMatchObject({ initialThemeSelectionComplete: true });

    const invalid = trackedTree("television-bundled-theme-storage-");
    seedDisplay(invalid.root, "missing");
    const invalidStore = trackedBoot(invalid.root, source.themesPath);
    expect(invalidStore.getActiveThemeName()).toBeNull();
    expect(readState(invalid.root)).toMatchObject({ initialThemeSelectionComplete: true });
  });

  it("keeps the explicit null theme and deletion after the decision", () => {
    const source = trackedTree("television-bundled-theme-source-");
    writePackage(source.themesPath, "clouds", { name: "Clouds" });
    const storage = trackedTree("television-bundled-theme-storage-");

    const first = trackedBoot(storage.root, source.themesPath);
    first.patchDisplay({ activeThemeName: null });
    dispose(first);
    const nullThemeRestart = trackedBoot(storage.root, source.themesPath);
    expect(nullThemeRestart.getActiveThemeName()).toBeNull();
    dispose(nullThemeRestart);

    rmSync(path.join(storage.themesPath, "clouds"), { recursive: true });
    const deletedRestart = trackedBoot(storage.root, source.themesPath);
    expect(deletedRestart.getActiveThemeName()).toBeNull();
    expect(existsSync(path.join(storage.themesPath, "clouds"))).toBe(false);
  });

  it("replaces and selects an invalid same-ID Clouds folder", () => {
    const source = trackedTree("television-bundled-theme-source-");
    writePackage(source.themesPath, "clouds", { name: "Clouds", version: "2.0.0" });
    const storage = trackedTree("television-bundled-theme-storage-");
    mkdirSync(path.join(storage.themesPath, "clouds"));
    writeFileSync(path.join(storage.themesPath, "clouds", "theme.css"), "/* prior invalid content */\n");

    const store = trackedBoot(storage.root, source.themesPath);
    expect(store.getActiveThemeName()).toBe("clouds");
    expect(readState(storage.root)).toEqual({
      version: 2,
      installedThemeIDs: ["clouds"],
      initialThemeSelectionComplete: true,
    });
    expect(readdirSync(storage.themesPath).some((name) => name.startsWith(".clouds.backup."))).toBe(true);
  });

  it("defers the Clouds decision after a failed first copy", () => {
    const source = trackedTree("television-bundled-theme-source-");
    writePackage(source.themesPath, "clouds", { name: "Clouds" });
    const storage = trackedTree("television-bundled-theme-storage-");
    writeFileSync(getBundledThemeCopyTempPath(storage.root, "clouds"), "blocks first copy");

    const first = trackedBoot(storage.root, source.themesPath);
    expect(first.getActiveThemeName()).toBeNull();
    expect(existsSync(getBundledThemesStatePath(storage.root))).toBe(false);
    dispose(first);

    const second = trackedBoot(storage.root, source.themesPath);
    expect(second.getActiveThemeName()).toBe("clouds");
    expect(readState(storage.root)).toMatchObject({ initialThemeSelectionComplete: true });
  });

  it("stops boot if recording the completed decision fails, then converges", () => {
    const source = trackedTree("television-bundled-theme-source-");
    writePackage(source.themesPath, "clouds", { name: "Clouds" });
    const storage = trackedTree("television-bundled-theme-storage-");
    writePackage(storage.themesPath, "clouds", { name: "Clouds" });
    mkdirSync(path.join(storage.root, "state"), { recursive: true });
    writeFileSync(getBundledThemesStatePath(storage.root), `${JSON.stringify({
      version: 2,
      installedThemeIDs: ["clouds"],
      initialThemeSelectionComplete: false,
    }, null, 2)}\n`);
    seedDisplay(storage.root, null);
    mkdirSync(getBundledThemeStateTempPath(storage.root));

    expect(() => trackedBoot(storage.root, source.themesPath)).toThrow();
    expect(JSON.parse(readFileSync(path.join(storage.root, "state", "display.json"), "utf8"))).toMatchObject({
      activeThemeName: "clouds",
    });
    expect(readState(storage.root)).toMatchObject({ initialThemeSelectionComplete: false });

    const retry = trackedBoot(storage.root, source.themesPath);
    expect(retry.getActiveThemeName()).toBe("clouds");
    expect(readState(storage.root)).toMatchObject({ initialThemeSelectionComplete: true });
  });

  it("stops on a default-selection display write failure and converges on retry", () => {
    const source = trackedTree("television-bundled-theme-source-");
    writeBundledSourceTree(source.themesPath);
    const storage = trackedTree("television-bundled-theme-storage-");
    writePackage(storage.themesPath, "clouds", { name: "Clouds" });
    writeState(storage.root, [...BUNDLED_THEME_IDS], false);
    seedDisplay(storage.root, null);
    const displayPath = path.join(storage.root, "state", "display.json");
    const dropRootWriteBypass = process.geteuid?.() === 0 && process.seteuid !== undefined;
    if (dropRootWriteBypass) {
      makeTreeWorldAccessible(source.root);
      makeTreeWorldAccessible(storage.root);
    }
    chmodSync(displayPath, 0o444);

    try {
      if (dropRootWriteBypass) process.seteuid!(UNPRIVILEGED_USER_ID);
      expect(() => trackedBoot(storage.root, source.themesPath)).toThrow();
    } finally {
      if (dropRootWriteBypass) process.seteuid!(0);
    }
    expect(JSON.parse(readFileSync(displayPath, "utf8"))).toMatchObject({ activeThemeName: null });
    expect(readState(storage.root)).toMatchObject({ initialThemeSelectionComplete: false });

    chmodSync(displayPath, 0o644);
    const retry = trackedBoot(storage.root, source.themesPath);
    expect(retry.getActiveThemeName()).toBe("clouds");
    expect(readState(storage.root)).toMatchObject({ initialThemeSelectionComplete: true });
  });

  it("does no bundled-theme work during token-only construction", () => {
    const source = trackedTree("television-bundled-theme-source-");
    writePackage(source.themesPath, "clouds", { name: "Clouds" });
    const storage = trackedTree("television-bundled-theme-storage-");
    mkdirSync(path.join(storage.themesPath, ".clouds.bundled-theme.tmp-1234"));

    const store = new ServerStore({
      storagePath: storage.root,
      bundledThemesPath: source.themesPath,
      installOnboardingChannels: false,
    });
    stores.push(store);

    expect(existsSync(path.join(storage.themesPath, "clouds"))).toBe(false);
    expect(existsSync(path.join(storage.themesPath, ".clouds.bundled-theme.tmp-1234"))).toBe(true);
    expect(existsSync(getBundledThemesStatePath(storage.root))).toBe(false);
  });
});

describe("bundled theme state", () => {
  const roots: string[] = [];
  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  function storagePath(): string {
    const root = mkdtempSync(path.join(os.tmpdir(), "television-bundled-theme-state-"));
    roots.push(root);
    mkdirSync(path.join(root, "state"));
    return root;
  }

  it("reads absent, current, and invalid bundled-theme state", () => {
    const root = storagePath();
    const statePath = getBundledThemesStatePath(root);
    expect(readBundledThemeStateFile(root)).toEqual({ status: "absent" });

    writeFileSync(statePath, JSON.stringify({
      version: 2,
      installedThemeIDs: ["Theme ID.v2", "日本語 🎨"],
      initialThemeSelectionComplete: false,
    }));
    expect(readBundledThemeStateFile(root)).toEqual({
      status: "ok",
      state: {
        version: 2,
        installedThemeIDs: ["Theme ID.v2", "日本語 🎨"],
        initialThemeSelectionComplete: false,
      },
    });

    const invalidValues = [
      "{",
      JSON.stringify({ version: 9, installedThemeIDs: [], initialThemeSelectionComplete: false }),
      JSON.stringify({ version: 2, legacyIDs: [], initialThemeSelectionComplete: false }),
      JSON.stringify({ version: 2, installedThemeIDs: [] }),
      JSON.stringify({ version: 2, installedThemeIDs: [], initialThemeSelectionComplete: "no" }),
      JSON.stringify({ version: 2, installedThemeIDs: [7], initialThemeSelectionComplete: false }),
      JSON.stringify({ version: 2, installedThemeIDs: ["alpha", "alpha"], initialThemeSelectionComplete: false }),
      JSON.stringify({ version: 2, installedThemeIDs: ["beta", "alpha"], initialThemeSelectionComplete: false }),
      JSON.stringify({ version: 2, installedThemeIDs: [], initialThemeSelectionComplete: false, extra: true }),
    ];
    for (const value of invalidValues) {
      writeFileSync(statePath, value);
      expect(readBundledThemeStateFile(root).status, value).toBe("invalid");
    }
  });

  it("leaves the previous complete state intact when replacement fails", () => {
    const root = storagePath();
    const statePath = getBundledThemesStatePath(root);
    const original = `${JSON.stringify({
      version: 2,
      installedThemeIDs: ["alpha"],
      initialThemeSelectionComplete: false,
    }, null, 2)}\n`;
    writeFileSync(statePath, original);
    mkdirSync(getBundledThemeStateTempPath(root));

    expect(() => writeBundledThemeStateFile(root, {
      version: 2,
      installedThemeIDs: ["alpha", "beta"],
      initialThemeSelectionComplete: true,
    })).toThrow();
    expect(readFileSync(statePath, "utf8")).toBe(original);
    expect(existsSync(getBundledThemeStateTempPath(root))).toBe(false);
  });
});

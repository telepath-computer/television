import { describe, expect, it } from "vitest";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { mkdtempSync } from "node:fs";
import { NotFoundError } from "@telepath-computer/television-shared";
import { createServingStore } from "../../../test/helpers/serving-store.ts";
import { seedThemePackage } from "../../../test/helpers/theme-package.ts";

function tempDir(): string {
  return mkdtempSync(path.join(os.tmpdir(), "television-theme-registry-"));
}

function writeInvalidManifest(themeDir: string): void {
  writeFileSync(
    path.join(themeDir, "manifest.json"),
    `${JSON.stringify({ name: "Broken", version: "not-semver" }, null, 2)}\n`,
    "utf8",
  );
}

function seedCurrentDisplay(
  storagePath: string,
  activeThemeName: string,
  themeJavaScriptConsentIds?: string[],
): void {
  const channelsDir = path.join(storagePath, "state", "channels");
  mkdirSync(channelsDir, { recursive: true });
  writeFileSync(
    path.join(channelsDir, "channel-a.json"),
    `${JSON.stringify({ id: "channel-a", name: "A", layoutVersion: 2, layout: [] }, null, 2)}\n`,
    "utf8",
  );
  writeFileSync(
    path.join(storagePath, "state", "display.json"),
    `${JSON.stringify({
      focusedChannelId: "channel-a",
      pinnedChannelIds: [],
      activeThemeName,
      ...(themeJavaScriptConsentIds === undefined ? {} : { themeJavaScriptConsentIds }),
    }, null, 2)}\n`,
    "utf8",
  );
}

describe("theme registry lifetime", () => {
  it("scans at serving boot and replaces the complete snapshot on refresh", () => {
    const storagePath = tempDir();
    seedThemePackage(storagePath, "Zulu Theme", "/* zulu */", { name: "Zulu" });
    const brokenDir = seedThemePackage(storagePath, "broken");
    writeInvalidManifest(brokenDir);
    const store = createServingStore(storagePath);

    try {
      expect(store.getThemeRegistry()).toEqual({
        themes: [{
          id: "Zulu Theme",
          name: "Zulu",
          version: "1.0.0",
          colorScheme: "light dark",
        }],
        errors: [{ folder: "broken", error: expect.stringContaining("Semantic Version") }],
      });

      rmSync(path.join(storagePath, "themes", "Zulu Theme"), { recursive: true });
      seedThemePackage(storagePath, "Amber Theme", "/* amber */", { name: "Amber" });
      seedThemePackage(storagePath, "broken", "/* repaired */", { name: "Beta" });

      expect(store.getThemeRegistry().themes.map((theme) => theme.id)).toEqual(["Zulu Theme"]);
      expect(store.refreshThemeRegistry()).toEqual({
        themes: [
          { id: "Amber Theme", name: "Amber", version: "1.0.0", colorScheme: "light dark" },
          { id: "broken", name: "Beta", version: "1.0.0", colorScheme: "light dark" },
        ],
        errors: [],
      });
    } finally {
      store.dispose();
      rmSync(storagePath, { recursive: true, force: true });
    }
  });

  it("rejects themes added after boot until refresh", () => {
    const storagePath = tempDir();
    const store = createServingStore(storagePath);

    try {
      seedThemePackage(storagePath, "Later Theme.v2");
      expect(() => store.patchDisplay({ activeThemeName: "Later Theme.v2" })).toThrow(NotFoundError);
      expect(store.getThemeRegistry()).toEqual({ themes: [], errors: [] });

      store.refreshThemeRegistry();
      expect(() => store.patchDisplay({ activeThemeName: "later theme.v2" })).toThrow(NotFoundError);
      expect(() => store.patchDisplay({ activeThemeName: "Later Theme.v2" })).not.toThrow();
      expect(store.getActiveThemeName()).toBe("Later Theme.v2");
    } finally {
      store.dispose();
      rmSync(storagePath, { recursive: true, force: true });
    }
  });

  it("preserves a manifest-less package folder while persisting the null theme", () => {
    const storagePath = tempDir();
    const themeDir = path.join(storagePath, "themes", "paperlike");
    mkdirSync(themeDir, { recursive: true });
    const css = "/* existing package without a manifest */\n";
    writeFileSync(path.join(themeDir, "theme.css"), css);
    seedCurrentDisplay(storagePath, "paperlike");
    const store = createServingStore(storagePath);

    try {
      expect(store.getThemeRegistry()).toEqual({
        themes: [],
        errors: [{ folder: "paperlike", error: expect.stringContaining("cannot read manifest.json") }],
      });
      expect(store.getActiveThemeName()).toBeNull();
      expect(readFileSync(path.join(themeDir, "theme.css"), "utf8")).toBe(css);
      expect(existsSync(path.join(themeDir, "manifest.json"))).toBe(false);
      expect(JSON.parse(readFileSync(path.join(storagePath, "state", "display.json"), "utf8"))).toMatchObject({
        activeThemeName: null,
      });
    } finally {
      store.dispose();
      rmSync(storagePath, { recursive: true, force: true });
    }
  });

  // proofs/arch/themes/index.md#^themes-t-color-scheme-registry-refresh
  it("publishes a selected color scheme change only after normalized refresh", () => {
    const storagePath = tempDir();
    const themeDir = seedThemePackage(storagePath, "paperlike", "/* theme */", {
      colorScheme: "dark",
    });
    seedCurrentDisplay(storagePath, "paperlike");
    const store = createServingStore(storagePath, {
      watchContentFile: () => ({ close() {}, on() {} }),
    });
    const events: Array<{
      themeName: string | null;
      activeThemeColorScheme: string | null;
    }> = [];
    store.addEventListener("theme-changed", (event) => {
      events.push({
        themeName: event.themeName,
        activeThemeColorScheme: event.activeThemeColorScheme,
      });
    });

    const writeColorScheme = (colorScheme: string): void => {
      writeFileSync(
        path.join(themeDir, "manifest.json"),
        `${JSON.stringify({
          name: "paperlike",
          version: "1.0.0",
          colorScheme,
        }, null, 2)}\n`,
        "utf8",
      );
    };

    try {
      expect(store.getThemeRegistry().themes[0]?.colorScheme).toBe("dark");
      writeColorScheme(" LiGhT ");
      expect(store.getThemeRegistry().themes[0]?.colorScheme).toBe("dark");
      expect(events).toEqual([]);

      expect(store.refreshThemeRegistry().themes[0]?.colorScheme).toBe("light");
      expect(events).toEqual([{
        themeName: "paperlike",
        activeThemeColorScheme: "light",
      }]);

      writeColorScheme("LIGHT");
      store.refreshThemeRegistry();
      expect(events).toHaveLength(1);
    } finally {
      store.dispose();
      rmSync(storagePath, { recursive: true, force: true });
    }
  });

  // proofs/arch/themes/index.md#^themes-t-javascript-registry-refresh
  // proofs/arch/themes/index.md#^themes-t-javascript-consent-events
  it("publishes every selected JavaScript declaration transition with complete consent after refresh", () => {
    const storagePath = tempDir();
    const themeDir = seedThemePackage(storagePath, "executable", "/* theme */", {
      mainJS: "globalThis.mainExecuted = true;",
      iframeBackgroundJS: "globalThis.backgroundExecuted = true;",
      iframeOverlayJS: "globalThis.overlayExecuted = true;",
    });
    seedCurrentDisplay(storagePath, "executable", ["executable", "inactive-consent"]);
    const store = createServingStore(storagePath, {
      watchContentFile: () => ({
        close() {},
        on() {},
      }),
    });
    const events: Array<{
      themeName: string | null;
      activeThemeColorScheme: string | null;
      themeJavaScriptConsentIds: string[];
      registeredTheme: Record<string, unknown>;
    }> = [];
    store.addEventListener("theme-changed", (event) => {
      events.push({
        themeName: event.themeName,
        activeThemeColorScheme: event.activeThemeColorScheme,
        themeJavaScriptConsentIds: event.themeJavaScriptConsentIds,
        registeredTheme: { ...store.getThemeRegistry().themes[0] },
      });
    });

    const declarations = [
      "enableMainJS",
      "enableIframeBackgroundJS",
      "enableIframeOverlayJS",
    ] as const;
    const writeManifest = (
      values: Partial<Record<typeof declarations[number], boolean>>,
    ): void => {
      writeFileSync(
        path.join(themeDir, "manifest.json"),
        `${JSON.stringify({
          name: "executable",
          version: "1.0.0",
          colorScheme: "light dark",
          ...values,
        }, null, 2)}\n`,
        "utf8",
      );
    };

    try {
      const transitions = [false, true, undefined, true, false, undefined] as const;
      for (const declaration of declarations) {
        for (const value of transitions) {
          const eventCount = events.length;
          const registryBeforeWrite = store.getThemeRegistry();
          writeManifest(value === undefined ? {} : { [declaration]: value });
          expect(store.getThemeRegistry()).toEqual(registryBeforeWrite);
          expect(events).toHaveLength(eventCount);
          const refreshed = store.refreshThemeRegistry();
          const registered = refreshed.themes[0]!;
          if (value === undefined) {
            expect(registered).not.toHaveProperty(declaration);
          } else {
            expect(registered[declaration]).toBe(value);
          }
          expect(events).toHaveLength(eventCount + 1);
          expect(events.at(-1)).toEqual({
            themeName: "executable",
            activeThemeColorScheme: "light dark",
            themeJavaScriptConsentIds: ["executable", "inactive-consent"],
            registeredTheme: registered,
          });

          store.refreshThemeRegistry();
          expect(events).toHaveLength(eventCount + 1);
        }
      }

      const eventCount = events.length;
      const registryBeforeJointWrite = store.getThemeRegistry();
      writeManifest({
        enableMainJS: true,
        enableIframeBackgroundJS: true,
        enableIframeOverlayJS: true,
      });
      expect(store.getThemeRegistry()).toEqual(registryBeforeJointWrite);
      expect(events).toHaveLength(eventCount);
      const jointlyEnabled = store.refreshThemeRegistry().themes[0]!;
      expect(events).toHaveLength(eventCount + 1);
      expect(events.at(-1)?.registeredTheme).toEqual(jointlyEnabled);
      expect(jointlyEnabled).toMatchObject({
        enableMainJS: true,
        enableIframeBackgroundJS: true,
        enableIframeOverlayJS: true,
      });

      expect(new Set(events.map((event) => event.themeJavaScriptConsentIds)).size)
        .toBe(events.length);
      events[0]!.themeJavaScriptConsentIds.push("listener-mutation");
      expect(store.getDisplayState().themeJavaScriptConsentIds)
        .toEqual(["executable", "inactive-consent"]);
      expect(events.at(-1)?.themeJavaScriptConsentIds)
        .toEqual(["executable", "inactive-consent"]);
      expect(store.getActiveThemeName()).toBe("executable");
    } finally {
      store.dispose();
      rmSync(storagePath, { recursive: true, force: true });
    }
  });

  it("clears an invalid active theme at boot and refresh", () => {
    const storagePath = tempDir();
    const themeDir = seedThemePackage(storagePath, "paperlike");
    writeInvalidManifest(themeDir);
    seedCurrentDisplay(storagePath, "paperlike");
    const store = createServingStore(storagePath);

    try {
      expect(store.getActiveThemeName()).toBeNull();
      expect(JSON.parse(readFileSync(path.join(storagePath, "state", "display.json"), "utf8"))).toMatchObject({
        focusedChannelId: "channel-a",
        pinnedChannelIds: [],
        activeThemeName: null,
      });

      seedThemePackage(storagePath, "paperlike");
      store.refreshThemeRegistry();
      store.patchDisplay({ activeThemeName: "paperlike" });
      const events: Array<string | null> = [];
      store.addEventListener("theme-changed", (event) => events.push(event.themeName));

      writeInvalidManifest(themeDir);
      const refreshed = store.refreshThemeRegistry();
      expect(refreshed.themes).toEqual([]);
      expect(refreshed.errors[0]).toMatchObject({ folder: "paperlike" });
      expect(store.getActiveThemeName()).toBeNull();
      expect(events).toEqual([null]);
    } finally {
      store.dispose();
      rmSync(storagePath, { recursive: true, force: true });
    }
  });
});

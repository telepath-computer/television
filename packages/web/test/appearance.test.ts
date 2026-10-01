// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  appearanceResolverScriptSource,
  bridgeScriptSource,
  installAppearanceResolver,
} from "@telepath-computer/television-artifact/browser";
import {
  APPEARANCE_CACHE_KEY,
  appearanceBootstrapScriptSource,
  resolveAppearanceInput,
} from "../src/appearance.ts";

const REPO_ROOT = path.resolve(import.meta.dirname, "../../..");

function installMatchMedia(matches = false): void {
  vi.stubGlobal("matchMedia", vi.fn(() => ({
    matches,
    media: "(prefers-color-scheme: dark)",
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })));
}

beforeEach(() => {
  vi.resetModules();
  delete window.__televisionAppearanceResolver;
  delete document.documentElement.dataset.theme;
  window.localStorage.clear();
  installMatchMedia();
});

afterEach(() => {
  delete window.__televisionAppearanceResolver;
  delete document.documentElement.dataset.theme;
  window.localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("shell appearance bootstrap and confirmed state", () => {
  it.each([
    ["system", null, "system"],
    ["light", null, "light"],
    ["dark", "light dark", "dark"],
    ["system", "light dark", "system"],
    ["light", "dark", "dark"],
    ["dark", "light", "light"],
  ] as const)(
    "resolves stored %s with active scheme %s to %s",
    (appearanceMode, activeThemeColorScheme, expected) => {
      expect(resolveAppearanceInput(appearanceMode, activeThemeColorScheme))
        .toBe(expected);
    },
  );

  it("serializes one resolver implementation for shell, proxy, bridge, and standalone builds", () => {
    const implementation = installAppearanceResolver.toString();
    expect(appearanceBootstrapScriptSource()).toContain(implementation);
    expect(appearanceResolverScriptSource('"system"')).toContain(implementation);
    expect(bridgeScriptSource()).toContain(implementation);

    const webVite = readFileSync(
      path.join(REPO_ROOT, "packages/web/vite.config.ts"),
      "utf8",
    );
    const markdownVite = readFileSync(
      path.join(REPO_ROOT, "packages/view-markdown/vite.config.ts"),
      "utf8",
    );
    expect(webVite).toContain("appearanceResolverScriptSource");
    expect(markdownVite).toContain("appearanceResolverScriptSource");

    for (const documentPath of [
      "packages/web/src/views/artifact-missing/index.html",
      "packages/web/src/views/url-unsupported/index.html",
      "packages/view-markdown/src/index.html",
    ]) {
      const authored = readFileSync(path.join(REPO_ROOT, documentPath), "utf8");
      expect(authored).not.toContain("__televisionAppearanceResolver");
      expect(authored).not.toContain("data-theme=");
    }
  });

  it.each([
    ["light", "light"],
    ["dark", "dark"],
    ["system", "light"],
  ] as const)("uses a cached %s preference for first paint", async (cached, effective) => {
    window.localStorage.setItem(APPEARANCE_CACHE_KEY, cached);
    const { appearanceBootstrapScriptSource } = await import("../src/appearance.ts");

    Function(appearanceBootstrapScriptSource())();

    expect(document.documentElement.dataset.theme).toBe(effective);
  });

  it.each([null, "", "sepia", "{broken"])(
    "falls back to system for malformed cached value %j",
    async (cached) => {
      if (cached !== null) window.localStorage.setItem(APPEARANCE_CACHE_KEY, cached);
      const { appearanceBootstrapScriptSource } = await import("../src/appearance.ts");

      Function(appearanceBootstrapScriptSource())();

      expect(document.documentElement.dataset.theme).toBe("light");
    },
  );

  it("falls back to system when cache reads fail", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    const { appearanceBootstrapScriptSource } = await import("../src/appearance.ts");

    Function(appearanceBootstrapScriptSource())();

    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("confirmed server state replaces and caches the bootstrap preference", async () => {
    window.localStorage.setItem(APPEARANCE_CACHE_KEY, "light");
    const appearance = await import("../src/appearance.ts");
    Function(appearance.appearanceBootstrapScriptSource())();

    appearance.applyConfirmedAppearance("dark");

    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(window.localStorage.getItem(APPEARANCE_CACHE_KEY)).toBe("dark");
  });

  it("applies confirmed state when cache writes fail", async () => {
    const appearance = await import("../src/appearance.ts");
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("blocked", "QuotaExceededError");
    });

    appearance.applyConfirmedAppearance("dark");

    expect(setItem).toHaveBeenCalledWith(APPEARANCE_CACHE_KEY, "dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
  });
});

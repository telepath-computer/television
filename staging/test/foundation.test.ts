// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const STORE_KEY = "frameset-environment";
const removeListeners: (() => void)[] = [];

// The module applies on import and listens for the workshop's events, so
// each scenario prepares the document, storage, and URL, then imports a
// fresh copy.
const importFoundation = async () => {
  vi.resetModules();
  await import("../../frames/lib/foundation.ts");
};

const themeStyle = () =>
  document.querySelector<HTMLStyleElement>("style[data-foundation-frame-theme]");

describe("the workshop document basics", () => {
  beforeEach(() => {
    // Module resets do not reset the document singleton or its listeners.
    // Track real registrations so each scenario owns a fresh environment.
    const addWindowListener = window.addEventListener.bind(window);
    vi.spyOn(window, "addEventListener").mockImplementation((type, listener, options) => {
      addWindowListener(type, listener, options);
      removeListeners.push(() => window.removeEventListener(type, listener, options));
    });
    const addDocumentListener = document.addEventListener.bind(document);
    vi.spyOn(document, "addEventListener").mockImplementation((type, listener, options) => {
      addDocumentListener(type, listener, options);
      removeListeners.push(() => document.removeEventListener(type, listener, options));
    });
    localStorage.clear();
    history.replaceState(null, "", "/");
    document.querySelectorAll("style[data-foundation-frame-theme], style[data-staging-foundation]")
      .forEach((el) => el.remove());
    document.documentElement.removeAttribute("data-theme");
    document.documentElement.removeAttribute("data-staging-environment");
  });

  afterEach(() => {
    for (const remove of removeListeners.splice(0)) remove();
    delete (window as unknown as { __stagingFoundation?: () => void }).__stagingFoundation;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  test("defaults to light with the staging styles injected", async () => {
    await importFoundation();

    expect(document.documentElement.dataset.theme).toBe("light");
    expect(document.querySelector("style[data-staging-foundation]")).not.toBeNull();
    expect(themeStyle()?.textContent).toBe("");
  });

  test("ignores a stored workshop selection", async () => {
    localStorage.setItem(STORE_KEY, JSON.stringify({ appearance: "dark", theme: "gruvbox" }));
    await importFoundation();

    expect(document.documentElement.dataset.theme).toBe("light");
    expect(document.documentElement.dataset.stagingSelectedTheme).toBe("none");
    expect(themeStyle()?.textContent).toBe("");
  });

  test("query controls apply on each render without writing shared storage", async () => {
    await importFoundation();
    expect(document.documentElement.dataset.theme).toBe("light");

    history.replaceState(null, "", "/?appearance=dark&theme=nord");
    window.dispatchEvent(new Event("frameset:rendered"));

    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(document.documentElement.dataset.stagingSelectedTheme).toBe("nord");
    expect(localStorage.getItem(STORE_KEY)).toBeNull();

    history.replaceState(null, "", "/");
    window.dispatchEvent(new Event("frameset:rendered"));
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(document.documentElement.dataset.stagingSelectedTheme).toBe("none");
    expect(localStorage.getItem(STORE_KEY)).toBeNull();
  });

  test("storage events leave frame controls unchanged and reuse one style element", async () => {
    history.replaceState(null, "", "/?appearance=dark&theme=nord");
    await importFoundation();
    const style = themeStyle();
    expect(style).not.toBeNull();

    localStorage.setItem(STORE_KEY, JSON.stringify({ appearance: "light", theme: "none" }));
    window.dispatchEvent(new StorageEvent("storage", { key: STORE_KEY }));
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(document.documentElement.dataset.stagingSelectedTheme).toBe("nord");
    window.dispatchEvent(new Event("frameset:rendered"));
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(document.documentElement.dataset.stagingSelectedTheme).toBe("nord");
    expect(themeStyle()).toBe(style);
    expect(document.querySelectorAll("style[data-foundation-frame-theme]")).toHaveLength(1);
  });
});

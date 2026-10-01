// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import type { SelectElement } from "../src/elements/select.ts";
import { html, render } from "lit-html";
import type {
  AppearanceMode,
  ThemeRegistrySnapshot,
} from "@telepath-computer/television-shared";
import {
  SettingsView,
  type SettingsApplication,
} from "../src/views/settings.ts";

function deferred<T>(): {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(reason: unknown): void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

// Geometry belongs to real-browser acceptance; this service-boundary fixture
// only needs the browser observer's lifecycle shape.
vi.stubGlobal("ResizeObserver", class { observe(): void {} disconnect(): void {} });

async function openPanel(panel: HTMLElement): Promise<void> {
  panel.removeAttribute("open");
  await settle();
  panel.setAttribute("open", "");
  await settle();
}

function options(panel: Element): { value: string; text: string }[] {
  return [...panel.querySelectorAll("tv-option")].map(option => ({
    value: option.getAttribute("value") ?? "", text: option.textContent?.trim() ?? "",
  }));
}

const hosts: HTMLElement[] = [];

afterEach(() => {
  for (const host of hosts) {
    render(null, host);
    host.remove();
  }
  hosts.length = 0;
});

describe("settings markup", () => {
  // proofs/ui/app/settings/index.md#^settings-ac-markup
  it("renders settings controls and registry states", async () => {
    const firstList = deferred<ThemeRegistrySnapshot>();
    const firstRefresh = deferred<ThemeRegistrySnapshot>();
    let appearanceMode: AppearanceMode = "dark";
    const activeThemeName: string | null = "clouds";
    let connectionStatus: SettingsApplication["snapshot"]["connection"]["status"] = "connected";
    const application: SettingsApplication = {
      snapshot: {
        get connection() {
          return {
            authorizationRequired: false,
            authorizationRejected: false,
            gateHalted: false,
            status: connectionStatus,
            hasEverConnected: true,
            firstConnectError: null,
            nextRetryAt: null,
            upgradeInstructions: null,
          };
        },
        get display() {
          return {
            focusedChannelId: null,
            pinnedChannelIds: [],
            activeThemeName,
            activeThemeColorScheme: "light dark" as const,
            appearanceMode,
            themeJavaScriptConsentIds: [],
            acpEnabled: false,
          };
        },
      },
      listThemes: vi.fn(() => firstList.promise),
      refreshThemes: vi.fn(() => firstRefresh.promise),
      setActiveTheme: vi.fn(async () => undefined),
      setAppearanceMode: vi.fn(async () => {
        throw new Error("display is read-only");
      }),
      setThemeJavaScriptConsent: vi.fn(async () => undefined),
    };
    const host = document.createElement("div");
    hosts.push(host);
    document.body.append(host);
    render(html`${SettingsView(application)}`, host);
    await settle();

    const trigger = document.querySelector<HTMLButtonElement>(".settings-trigger")!;
    const popover = document.querySelector<HTMLElement>(".settings-popover")!;
    expect(trigger.getAttribute("aria-label")).toBe("Settings");
    expect(trigger.id).toBe("settings-trigger");
    expect(trigger.querySelector("tv-icon")?.getAttribute("name")).toBe("settings");
    expect(trigger.nextElementSibling).toBe(popover);
    expect(popover.localName).toBe("tv-popover");
    expect(popover.getAttribute("trigger")).toBe(trigger.id);
    expect(popover.hasAttribute("placement")).toBe(false);

    const appearance = document.querySelector<SelectElement>('tv-select[name="appearance-mode"]')!;
    expect(document.querySelector("#settings-appearance-label")?.textContent?.trim()).toBe("Light/dark mode");
    expect(options(appearance).map(({ value, text }) => ({ value, text }))).toEqual([
      { value: "system", text: "Adapt to system" },
      { value: "light", text: "Light" },
      { value: "dark", text: "Dark" },
    ]);
    expect(appearance.value).toBe("dark");

    await openPanel(popover);
    await settle();
    expect(application.listThemes).toHaveBeenCalledOnce();
    expect(document.querySelector('[role="status"]')?.textContent).toContain("Loading themes…");

    firstList.resolve({
      themes: [
        {
          id: "clouds",
          name: "Clouds",
          version: "1.0.0",
          colorScheme: "light dark",
        },
        {
          id: "Slate Theme.v2 🎨",
          name: "Slate",
          version: "2.0.0",
          colorScheme: "dark",
        },
      ],
      errors: [
        { folder: "broken", error: "manifest.json is missing" },
        { folder: null, error: "themes directory cannot be read" },
      ],
    });
    await settle();

    const theme = document.querySelector<SelectElement>('tv-select[name="theme"]')!;
    expect(document.querySelector("#settings-theme-label")?.textContent?.trim()).toBe("Theme");
    expect(options(theme).map(({ value, text }) => ({ value, text }))).toEqual([
      { value: "", text: "None" },
      { value: "clouds", text: "Clouds" },
      { value: "Slate Theme.v2 🎨", text: "Slate" },
    ]);
    expect(popover.textContent?.toLowerCase()).not.toContain("null theme");
    expect(theme.value).toBe("clouds");
    expect([...document.querySelectorAll(".settings-errors p")].map((row) => row.textContent?.trim())).toEqual([
      "broken: manifest.json is missing",
      "Themes directory: themes directory cannot be read",
    ]);
    expect(options(theme).some(({ value }) => value === "broken")).toBe(false);

    const refresh = document.querySelector<HTMLButtonElement>('button[aria-label="Refresh themes"]')!;
    expect(refresh.querySelector("tv-icon")?.getAttribute("name")).toBe("reload");
    refresh.click();
    await settle();
    expect(application.refreshThemes).toHaveBeenCalledOnce();
    firstRefresh.reject(new Error("scan failed"));
    await settle();
    expect(document.querySelector('[role="alert"]')?.textContent).toContain(
      "Unable to refresh themes: scan failed",
    );
    expect(options(theme).map(({ value }) => value)).toEqual(["", "clouds", "Slate Theme.v2 🎨"]);

    vi.mocked(application.listThemes).mockRejectedValueOnce(new Error("list failed"));
    await openPanel(popover);
    await settle();
    expect(document.querySelector('[role="alert"]')?.textContent).toContain(
      "Unable to load themes: list failed",
    );
    expect(options(theme).map(({ value }) => value)).toEqual(["", "clouds", "Slate Theme.v2 🎨"]);

    theme.value = "Slate Theme.v2 🎨";
    theme.dispatchEvent(new Event("change", { bubbles: true }));
    await settle();
    expect(application.setActiveTheme).toHaveBeenCalledWith("Slate Theme.v2 🎨");
    expect(theme.value).toBe("clouds");

    appearance.value = "light";
    appearance.dispatchEvent(new Event("change", { bubbles: true }));
    await settle();
    expect(application.setAppearanceMode).toHaveBeenCalledWith("light");
    expect(appearance.value).toBe("dark");
    expect(document.querySelector('[role="alert"]')?.textContent).toContain(
      "Unable to change light/dark mode: display is read-only",
    );

    connectionStatus = "disconnected";
    render(html`${SettingsView(application)}`, host);
    await settle();
    expect([...document.querySelectorAll<SelectElement>('tv-select[name="theme"] tv-option')]).toHaveLength(1);

    connectionStatus = "connected";
    render(html`${SettingsView(application)}`, host);
    await settle();
    await openPanel(document.querySelector<HTMLElement>(".settings-popover")!);
    await settle();
    expect(application.listThemes).toHaveBeenCalledTimes(3);
  });

  // proofs/ui/app/settings/index.md#^settings-t-javascript-consent
  it("renders confirmed executable-theme consent and recovers failed writes", async () => {
    let activeThemeName: string | null = "Theme.ID";
    let themeJavaScriptConsentIds: string[] = [];
    const setThemeJavaScriptConsent = vi.fn(async () => undefined);
    const application = {
      snapshot: {
        connection: {
          authorizationRequired: false,
          authorizationRejected: false,
          gateHalted: false,
          status: "connected" as const,
          hasEverConnected: true,
          firstConnectError: null,
          nextRetryAt: null,
          upgradeInstructions: null,
        },
        get display() {
          return {
            focusedChannelId: null,
            pinnedChannelIds: [],
            activeThemeName,
            activeThemeColorScheme: "light dark" as const,
            appearanceMode: "system" as const,
            themeJavaScriptConsentIds,
            acpEnabled: false,
          };
        },
      },
      listThemes: vi.fn(async () => ({
        themes: [
          {
            id: "Theme.ID",
            name: "Executable",
            version: "1.0.0",
            colorScheme: "light dark" as const,
            enableMainJS: true,
          },
          {
            id: "disabled",
            name: "Disabled",
            version: "1.0.0",
            colorScheme: "light dark" as const,
            enableMainJS: false,
          },
          {
            id: "iframe-only",
            name: "Iframe only",
            version: "1.0.0",
            colorScheme: "light dark" as const,
            enableIframeBackgroundJS: true,
            enableIframeOverlayJS: true,
          },
          {
            id: "ordinary",
            name: "Ordinary",
            version: "1.0.0",
            colorScheme: "light dark" as const,
          },
        ],
        errors: [],
      })),
      refreshThemes: vi.fn(async () => ({ themes: [], errors: [] })),
      setActiveTheme: vi.fn(async () => undefined),
      setAppearanceMode: vi.fn(async () => undefined),
      setThemeJavaScriptConsent,
    } as SettingsApplication & {
      setThemeJavaScriptConsent(themeId: string, enabled: boolean): Promise<void>;
    };
    const host = document.createElement("div");
    hosts.push(host);
    document.body.append(host);
    const renderSettings = (): void => {
      render(html`${SettingsView(application)}`, host);
    };
    renderSettings();

    expect(document.querySelector(".settings-javascript-consent")).toBeNull();
    await openPanel(document.querySelector<HTMLElement>(".settings-popover")!);
    await settle();

    const section = document.querySelector<HTMLElement>(
      ".settings-javascript-consent",
    )!;
    expect(section.getAttribute("aria-label"))
      .toBe("Experimental main-page JavaScript");
    expect(section.querySelector(".settings-javascript-disclosure")?.textContent)
      .toBe("This theme uses experimental JavaScript. JavaScript can access your Television content, so only enable for themes you trust or have had your agent inspect.");
    expect(section.querySelector(".settings-javascript-toggle")?.textContent?.trim())
      .toBe("Enable experimental javascript for this theme");

    let toggle = section.querySelector<HTMLInputElement>(
      'input[name="theme-javascript-consent"]',
    )!;
    expect(toggle.getAttribute("role")).toBe("switch");
    expect(toggle.value).toBe("Theme.ID");
    expect(toggle.checked).toBe(false);

    toggle.checked = true;
    toggle.dispatchEvent(new Event("change", { bubbles: true }));
    await settle();
    expect(setThemeJavaScriptConsent).toHaveBeenCalledWith("Theme.ID", true);
    expect(document.querySelector<HTMLInputElement>(
      'input[name="theme-javascript-consent"]',
    )?.checked).toBe(false);

    themeJavaScriptConsentIds = ["Theme.ID"];
    renderSettings();
    toggle = document.querySelector<HTMLInputElement>(
      'input[name="theme-javascript-consent"]',
    )!;
    expect(toggle.checked).toBe(true);

    setThemeJavaScriptConsent.mockRejectedValueOnce(new Error("consent denied"));
    toggle.checked = false;
    toggle.dispatchEvent(new Event("change", { bubbles: true }));
    await settle();
    expect(document.querySelector<HTMLInputElement>(
      'input[name="theme-javascript-consent"]',
    )?.checked).toBe(true);
    expect(document.querySelector('[role="alert"]')?.textContent).toContain(
      "Unable to change theme JavaScript consent: consent denied",
    );

    for (const hiddenTheme of ["disabled", "iframe-only", "ordinary", null]) {
      activeThemeName = hiddenTheme;
      renderSettings();
      expect(document.querySelector(".settings-javascript-consent")).toBeNull();
    }
  });
});

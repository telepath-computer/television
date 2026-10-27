// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "lit-html";

const NativeMutationObserver = globalThis.MutationObserver;
const liveMutationObservers: MutationObserver[] = [];

const mockState = vi.hoisted(() => {
  class MockLocalStore {
    static instances: MockLocalStore[] = [];
    args: unknown[];
    state: unknown;
    addEventListener = vi.fn();
    removeEventListener = vi.fn();
    get = vi.fn(() => this.state);
    set = vi.fn((next: unknown) => {
      this.state = next;
    });

    constructor(...args: unknown[]) {
      this.args = args;
      this.state = args[1];
      MockLocalStore.instances.push(this);
    }
  }

  const createDefaultLocalState = vi.fn(() => ({ authTokens: {} }));
  let navigationPending = false;
  let navigationAction: (() => void) | null = null;
  const navigationBegin = vi.fn((navigate: () => void) => {
    navigationPending = true;
    navigationAction = navigate;
  });
  const navigationLatch = {
    get pending(): boolean {
      return navigationPending;
    },
    begin: navigationBegin,
  };
  const runNavigationAction = (): void => {
    if (navigationAction === null) throw new Error("No pending navigation action");
    navigationAction();
  };
  const resetNavigationLatch = (): void => {
    navigationPending = false;
    navigationAction = null;
    navigationBegin.mockClear();
  };
  const televisionAppView = vi.fn((_application: unknown, _options: unknown) => {
    const fragment = document.createDocumentFragment();
    const root = document.createElement("div");
    root.id = "app";
    root.tabIndex = -1;
    const foreground = document.createElement("div");
    foreground.id = "foreground-overlay";
    foreground.setAttribute("inert", "");
    foreground.setAttribute("aria-hidden", "true");
    fragment.append(root, foreground);
    return fragment;
  });

  class MockApplicationService {
    static instances: MockApplicationService[] = [];
    args: unknown;
    disposeMock = vi.fn();
    listeners = new Map<string, Set<(event: Event & Record<string, unknown>) => void>>();
    addEventListener = vi.fn((type: string, listener: (event: Event & Record<string, unknown>) => void) => {
      const listeners = this.listeners.get(type) ?? new Set();
      listeners.add(listener);
      this.listeners.set(type, listeners);
    });
    removeEventListener = vi.fn((type: string, listener: (event: Event & Record<string, unknown>) => void) => {
      this.listeners.get(type)?.delete(listener);
    });
    handleNavigationKey = vi.fn();
    themeRegistry = {
      themes: [] as Array<{
        id: string;
        name: string;
        version: string;
        enableIframeBackgroundJS?: boolean;
        enableIframeOverlayJS?: boolean;
      }>,
      errors: [] as unknown[],
    };
    listThemes = vi.fn(async () => this.themeRegistry);
    snapshot = {
      ready: false,
      channels: [],
      display: {
        focusedChannelId: null,
        pinnedChannelIds: [],
        activeThemeName: null as string | null,
        activeThemeColorScheme: null as "light" | "dark" | "light dark" | null,
        appearanceMode: "system" as "system" | "light" | "dark",
        themeJavaScriptConsentIds: [] as string[],
        acpEnabled: false,
      },
      focusedChannel: null,
      connection: {
        authorizationRequired: false,
        gateHalted: false,
        status: "disconnected",
        hasEverConnected: false,
        firstConnectError: null,
      },
    };

    constructor(args: unknown) {
      this.args = args;
      MockApplicationService.instances.push(this);
    }

    emit(type: string, properties: Record<string, unknown> = {}): void {
      const eventProperties = type === "theme-changed" &&
          !("activeThemeColorScheme" in properties)
        ? {
            activeThemeColorScheme: this.snapshot.display.activeThemeColorScheme,
            ...properties,
          }
        : properties;
      const event = Object.assign(new Event(type), eventProperties);
      for (const listener of this.listeners.get(type) ?? []) listener(event);
    }

    dispose(): void {
      this.disposeMock();
    }
  }

  class MockServerConnectionOwner {
    static instances: MockServerConnectionOwner[] = [];
    args: { serverURL: string };
    connection: {
      url: string;
      status: string;
      bootState: "pending" | "booted" | "halted";
      hasAuthRejected: boolean;
      client: { artifacts: { list(): Promise<{ artifacts: unknown[] }> } };
    };
    connectError: string | null = null;
    connect = vi.fn(async () => undefined);
    changeListeners = new Set<() => void>();
    addEventListener = vi.fn((type: string, listener: () => void) => {
      if (type === "change") this.changeListeners.add(listener);
    });
    removeEventListener = vi.fn((type: string, listener: () => void) => {
      if (type === "change") this.changeListeners.delete(listener);
    });

    constructor(args: { serverURL: string }) {
      this.args = args;
      this.connection = {
        url: args.serverURL,
        status: "disconnected",
        bootState: "pending",
        hasAuthRejected: false,
        client: { artifacts: { list: vi.fn(async () => ({ artifacts: [] })) } },
      };
      MockServerConnectionOwner.instances.push(this);
    }

    emitChange(): void {
      for (const listener of this.changeListeners) listener();
    }
  }

  return {
    MockLocalStore,
    createDefaultLocalState,
    dependenciesRegister: vi.fn(),
    resolveAuthToken: vi.fn(),
    resolveDesktopAppVersion: vi.fn(),
    isElectronMode: vi.fn(),
    MockApplicationService,
    MockServerConnectionOwner,
    navigationLatch,
    navigationBegin,
    runNavigationAction,
    resetNavigationLatch,
    televisionAppView,
  };
});

vi.mock("@rupertsworld/dependencies", () => {
  return {
    dependencies: {
      register: mockState.dependenciesRegister,
    },
  };
});

vi.mock("../src/store.ts", () => {
  return {
    LocalStore: mockState.MockLocalStore,
    createDefaultLocalState: mockState.createDefaultLocalState,
    // main.ts normalizes the page origin for the reload agent's primary
    // origin; identity is fine for these renderer-wiring assertions.
    normalizeServerURL: (url: string) => url,
  };
});

vi.mock("../src/config.ts", () => {
  return {
    resolveAuthToken: mockState.resolveAuthToken,
    resolveDesktopAppVersion: mockState.resolveDesktopAppVersion,
    isElectronMode: mockState.isElectronMode,
  };
});

vi.mock("../src/services/application-service.ts", () => {
  return {
    ApplicationService: mockState.MockApplicationService,
  };
});

vi.mock("../src/services/server-connection-owner.ts", () => {
  return {
    ServerConnectionOwner: mockState.MockServerConnectionOwner,
  };
});

vi.mock("../src/services/navigation-latch.ts", () => {
  return {
    createNavigationLatch: vi.fn(() => mockState.navigationLatch),
  };
});

vi.mock("../src/views/television-app.ts", () => {
  return { TelevisionAppView: mockState.televisionAppView };
});

async function flushThemeWork(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe("renderer", () => {
  beforeEach(() => {
    for (const observer of liveMutationObservers.splice(0)) observer.disconnect();
    vi.stubGlobal("MutationObserver", class extends NativeMutationObserver {
      constructor(callback: MutationCallback) {
        super(callback);
        liveMutationObservers.push(this);
      }
    });
    vi.resetModules();
    render(null, document.body);
    document.querySelector('[data-television-style="television-active-theme"]')?.remove();
    document.querySelector('[data-television-script="television-active-theme"]')?.remove();
    document.querySelector("#theme-iframe-background")?.remove();
    document.querySelector("#theme-iframe-overlay")?.remove();
    mockState.MockApplicationService.instances.length = 0;
    mockState.MockServerConnectionOwner.instances.length = 0;
    mockState.MockLocalStore.instances.length = 0;
    mockState.createDefaultLocalState.mockClear();
    mockState.dependenciesRegister.mockReset();
    mockState.resolveAuthToken.mockReset();
    mockState.resolveAuthToken.mockReturnValue(null);
    mockState.resolveDesktopAppVersion.mockReset();
    mockState.resolveDesktopAppVersion.mockReturnValue(null);
    mockState.isElectronMode.mockReset();
    mockState.resetNavigationLatch();
    mockState.televisionAppView.mockClear();
    delete (globalThis as typeof globalThis & { __televisionNativeBridge?: unknown }).__televisionNativeBridge;
    delete (globalThis as typeof globalThis & { __telepath?: unknown }).__telepath;
    delete window.__televisionAppearanceResolver;
    window.history.replaceState(null, "", "/");
    window.localStorage.clear();
    vi.stubGlobal("matchMedia", vi.fn(() => ({
      matches: false,
      media: "(prefers-color-scheme: dark)",
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })));
  });

  it("defers the Electron root until the existing boot decision settles", async () => {
    mockState.isElectronMode.mockReturnValue(true);

    await import("../src/main.ts");

    expect(document.querySelector("#app")).toBeNull();
    const owner = mockState.MockServerConnectionOwner.instances[0];
    owner.connection.bootState = "halted";
    owner.emitChange();

    const appRoot = document.querySelector("#app");
    expect(appRoot).toBe(document.body.firstElementChild);
    expect(mockState.televisionAppView).toHaveBeenCalledOnce();
    expect(owner.removeEventListener).toHaveBeenCalledWith(
      "change",
      expect.any(Function),
    );
  });

  it("presents Electron authorization when rejection settles before a boot decision", async () => {
    mockState.isElectronMode.mockReturnValue(true);

    await import("../src/main.ts");

    expect(document.querySelector("#app")).toBeNull();
    const owner = mockState.MockServerConnectionOwner.instances[0];
    owner.connection.hasAuthRejected = true;
    owner.emitChange();

    expect(document.querySelector("#app")).not.toBeNull();
  });

  it("in electron mode creates store/services and registers them in DI", async () => {
    // The one server is the page's own origin; a leftover ?serverURL= is ignored.
    window.history.replaceState(null, "", "/?mode=electron&serverURL=http%3A%2F%2Felsewhere.example");
    mockState.isElectronMode.mockReturnValue(true);

    await import("../src/main.ts");

    expect(mockState.MockLocalStore.instances).toHaveLength(1);
    expect(mockState.MockLocalStore.instances[0].args[0]).toBe("television-electron");
    expect(mockState.createDefaultLocalState).toHaveBeenCalledWith();
    expect(mockState.MockApplicationService.instances).toHaveLength(1);
    expect(mockState.MockApplicationService.instances[0].args).toMatchObject({
      navigationKeyHandler: expect.any(Function),
      retainedGateHalted: expect.any(Function),
    });
    expect(mockState.MockServerConnectionOwner.instances).toHaveLength(1);
    expect(mockState.MockServerConnectionOwner.instances[0].args.serverURL).toBe(window.location.origin);
    expect(mockState.MockServerConnectionOwner.instances[0].connect).toHaveBeenCalledTimes(1);
    expect(mockState.dependenciesRegister).toHaveBeenCalledTimes(2);
  });

  it("delivers Electron native arrows to the existing application navigation edge", async () => {
    const onNavigationKey = vi.fn();
    (globalThis as typeof globalThis & {
      __televisionNativeBridge?: { onNavigationKey(callback: (key: string) => void): void };
    }).__televisionNativeBridge = { onNavigationKey };
    mockState.isElectronMode.mockReturnValue(true);

    await import("../src/main.ts");

    expect(onNavigationKey).toHaveBeenCalledOnce();
    const receiver = onNavigationKey.mock.calls[0][0] as (key: "ArrowUp") => void;
    receiver("ArrowUp");
    expect(mockState.MockApplicationService.instances[0].handleNavigationKey).toHaveBeenCalledOnce();
    expect(mockState.MockApplicationService.instances[0].handleNavigationKey).toHaveBeenCalledWith("ArrowUp");
  });

  // proofs/arch/themes/delivery.md#^theme-delivery-t-app-link-renderer
  it("ties the theme link to connection and theme events before display readiness", async () => {
    const serverURL = window.location.origin;
    mockState.isElectronMode.mockReturnValue(true);

    await import("../src/main.ts");
    const application = mockState.MockApplicationService.instances[0];
    const owner = mockState.MockServerConnectionOwner.instances[0];
    expect(application.snapshot.ready).toBe(false);

    owner.connection.status = "connected";
    owner.connection.bootState = "booted";
    owner.emitChange();

    const firstLink = document.querySelector<HTMLLinkElement>(
      'link[data-television-style="television-active-theme"]',
    );
    expect(firstLink).not.toBeNull();
    const themeURL = new URL(firstLink!.href);
    expect(themeURL.origin).toBe(serverURL);
    expect(themeURL.pathname).toBe("/theme/theme.css");

    application.emit("theme-changed", {
      themeName: "another-theme",
      themeJavaScriptConsentIds: [],
    });
    const refreshedLink = document.querySelector<HTMLLinkElement>(
      'link[data-television-style="television-active-theme"]',
    );
    expect(refreshedLink).not.toBe(firstLink);
    expect(refreshedLink?.href).not.toBe(firstLink?.href);

    owner.connection.status = "disconnected";
    owner.emitChange();
    expect(document.querySelector(
      'link[data-television-style="television-active-theme"]',
    )).toBeNull();
  });

  // proofs/arch/themes/delivery.md#^theme-delivery-t-app-script-renderer
  it("ties the theme script to confirmed consent, refresh, and connection lifecycle", async () => {
    const serverURL = window.location.origin;
    mockState.isElectronMode.mockReturnValue(true);

    await import("../src/main.ts");
    const application = mockState.MockApplicationService.instances[0];
    const owner = mockState.MockServerConnectionOwner.instances[0];
    const seam = (globalThis as typeof globalThis & {
      __telepath?: { applicationService?: unknown };
    }).__telepath;
    expect(seam?.applicationService).toBe(application);
    expect(mockState.dependenciesRegister).toHaveBeenCalledTimes(2);
    expect(owner.connection.client).not.toHaveProperty("themes");

    owner.connection.status = "connected";
    owner.connection.bootState = "booted";
    owner.emitChange();
    const initialLink = document.querySelector<HTMLLinkElement>(
      'link[data-television-style="television-active-theme"]',
    );
    expect(initialLink).not.toBeNull();
    expect(document.querySelector(
      'script[data-television-script="television-active-theme"]',
    )).toBeNull();

    application.snapshot.connection.status = "connected";
    application.snapshot.ready = true;
    application.snapshot.display.activeThemeName = "Theme.ID";
    application.themeRegistry.themes = [{
      id: "Theme.ID",
      name: "Background",
      version: "1.0.0",
      enableIframeBackgroundJS: true,
    }];
    application.emit("change");
    await flushThemeWork();
    expect(document.querySelector(
      'script[data-television-script="television-active-theme"]',
    )).toBeNull();
    const firstFrame = document.querySelector("#theme-iframe-background");
    expect(firstFrame).not.toBeNull();

    application.snapshot.display.themeJavaScriptConsentIds = ["Theme.ID"];
    application.emit("theme-changed", {
      themeName: "Theme.ID",
      themeJavaScriptConsentIds: ["Theme.ID"],
    });
    const first = document.querySelector<HTMLScriptElement>(
      'script[data-television-script="television-active-theme"]',
    );
    expect(first).not.toBeNull();
    expect(new URL(first!.src).origin).toBe(serverURL);
    expect(new URL(first!.src).pathname).toBe("/theme/main.js");
    expect(document.querySelector(
      'link[data-television-style="television-active-theme"]',
    )).toBe(initialLink);
    expect(document.querySelector("#theme-iframe-background")).toBe(firstFrame);

    application.snapshot.display.themeJavaScriptConsentIds = [
      "Theme.ID",
      "other-theme",
    ];
    application.emit("theme-changed", {
      themeName: "Theme.ID",
      themeJavaScriptConsentIds: ["Theme.ID", "other-theme"],
    });
    expect(document.querySelector(
      'script[data-television-script="television-active-theme"]',
    )).toBe(first);
    expect(document.querySelector(
      'link[data-television-style="television-active-theme"]',
    )).toBe(initialLink);
    expect(document.querySelector("#theme-iframe-background")).toBe(firstFrame);

    application.emit("theme-changed", {
      themeName: "Theme.ID",
      themeJavaScriptConsentIds: ["Theme.ID", "other-theme"],
    });
    expect(firstFrame?.isConnected).toBe(false);
    await flushThemeWork();
    const refreshedFrame = document.querySelector("#theme-iframe-background");
    expect(refreshedFrame).not.toBeNull();
    expect(refreshedFrame).not.toBe(firstFrame);
    const refreshed = document.querySelector<HTMLScriptElement>(
      'script[data-television-script="television-active-theme"]',
    );
    const refreshedLink = document.querySelector<HTMLLinkElement>(
      'link[data-television-style="television-active-theme"]',
    );
    expect(refreshed).not.toBe(first);
    expect(first?.isConnected).toBe(false);
    expect(refreshedLink).not.toBe(initialLink);
    expect(initialLink?.isConnected).toBe(false);

    application.snapshot.display.appearanceMode = "dark";
    application.emit("appearance-changed", { appearanceMode: "dark" });
    await flushThemeWork();
    expect(document.querySelector(
      'script[data-television-script="television-active-theme"]',
    )).toBe(refreshed);
    expect(document.querySelector(
      'link[data-television-style="television-active-theme"]',
    )).toBe(refreshedLink);
    const appearanceFrame = document.querySelector<HTMLIFrameElement>(
      "#theme-iframe-background",
    );
    expect(appearanceFrame).not.toBeNull();
    expect(appearanceFrame).not.toBe(refreshedFrame);
    expect(refreshedFrame?.isConnected).toBe(false);
    expect(appearanceFrame?.srcdoc).toContain('<html data-theme="dark">');

    application.snapshot.connection.status = "disconnected";
    owner.connection.status = "disconnected";
    owner.emitChange();
    expect(refreshed?.isConnected).toBe(false);
    expect(document.querySelector(
      'script[data-television-script="television-active-theme"]',
    )).toBeNull();
    expect(document.querySelector("#theme-iframe-background")).toBeNull();

    owner.connection.status = "connected";
    owner.emitChange();
    expect(document.querySelector(
      'script[data-television-script="television-active-theme"]',
    )).toBeNull();

    application.snapshot.connection.status = "connected";
    application.emit("change");
    await flushThemeWork();
    const reconnected = document.querySelector<HTMLScriptElement>(
      'script[data-television-script="television-active-theme"]',
    );
    expect(reconnected).not.toBeNull();
    expect(reconnected).not.toBe(refreshed);
    expect(document.querySelector("#theme-iframe-background")).not.toBeNull();
  });

  // proofs/arch/themes/delivery.md#^theme-delivery-t-frame-lifecycle
  it("installs ready theme frames after deferred application mount", async () => {
    const serverURL = window.location.origin;
    mockState.isElectronMode.mockReturnValue(true);

    await import("../src/main.ts");
    const application = mockState.MockApplicationService.instances[0];
    const owner = mockState.MockServerConnectionOwner.instances[0];
    owner.connection.status = "connected";
    application.snapshot.connection.status = "connected";
    application.snapshot.ready = true;
    application.snapshot.display.activeThemeName = "Theme.ID";
    application.themeRegistry.themes = [{
      id: "Theme.ID",
      name: "Background",
      version: "1.0.0",
      enableIframeBackgroundJS: true,
    }];
    application.emit("change");
    await flushThemeWork();
    expect(application.listThemes).not.toHaveBeenCalled();
    expect(document.querySelector("#theme-iframe-background")).toBeNull();

    owner.connection.bootState = "halted";
    owner.emitChange();
    await flushThemeWork();

    expect(mockState.televisionAppView).toHaveBeenCalledOnce();
    expect(application.listThemes).toHaveBeenCalledOnce();
    expect(document.querySelector("#theme-iframe-background")).not.toBeNull();
  });

  // proofs/arch/themes/delivery.md#^theme-delivery-t-frame-lifecycle
  // proofs/arch/themes/delivery.md#^theme-delivery-t-app-script-renderer
  it("reconciles theme frames across confirmed setup, refresh, selection, and connection state", async () => {
    const serverURL = window.location.origin;
    mockState.isElectronMode.mockReturnValue(false);

    await import("../src/main.ts");
    const application = mockState.MockApplicationService.instances[0];
    const owner = mockState.MockServerConnectionOwner.instances[0];
    expect(application.listThemes).not.toHaveBeenCalled();

    owner.connection.status = "connected";
    owner.connection.bootState = "booted";
    owner.emitChange();
    expect(application.listThemes).not.toHaveBeenCalled();

    application.themeRegistry.themes = [{
      id: "Theme.ID",
      name: "Background",
      version: "1.0.0",
      enableIframeBackgroundJS: true,
    }];
    application.snapshot.connection.status = "connected";
    application.snapshot.ready = true;
    application.snapshot.display.activeThemeName = "Theme.ID";
    application.emit("change");
    await flushThemeWork();

    const background = document.querySelector<HTMLIFrameElement>("#theme-iframe-background");
    expect(background).not.toBeNull();
    expect(document.querySelector("#theme-iframe-overlay")).toBeNull();
    expect(application.listThemes).toHaveBeenCalledOnce();
    const firstLink = document.querySelector<HTMLLinkElement>(
      'link[data-television-style="television-active-theme"]',
    );

    application.snapshot.display.themeJavaScriptConsentIds = ["unrelated"];
    application.emit("theme-changed", {
      themeName: "Theme.ID",
      themeJavaScriptConsentIds: ["unrelated"],
    });
    expect(document.querySelector("#theme-iframe-background")).toBe(background);
    expect(document.querySelector(
      'link[data-television-style="television-active-theme"]',
    )).toBe(firstLink);
    expect(application.listThemes).toHaveBeenCalledOnce();

    let resolveAppearanceLookup!: (snapshot: typeof application.themeRegistry) => void;
    const appearanceLookup = new Promise<typeof application.themeRegistry>((resolve) => {
      resolveAppearanceLookup = resolve;
    });
    application.listThemes.mockImplementationOnce(async () => {
      expect(background?.isConnected).toBe(false);
      expect(document.querySelector("#theme-iframe-background")).toBeNull();
      return appearanceLookup;
    });
    document.documentElement.dataset.theme = "dark";
    await Promise.resolve();
    expect(background?.isConnected).toBe(false);
    expect(document.querySelector("#theme-iframe-background")).toBeNull();
    expect(application.listThemes).toHaveBeenCalledTimes(2);

    resolveAppearanceLookup(application.themeRegistry);
    await flushThemeWork();
    const appearanceBackground = document.querySelector<HTMLIFrameElement>(
      "#theme-iframe-background",
    );
    expect(appearanceBackground).not.toBeNull();
    expect(appearanceBackground).not.toBe(background);
    expect(appearanceBackground?.srcdoc).toContain('<html data-theme="dark">');

    application.themeRegistry.themes = [{
      id: "Theme.ID",
      name: "Both",
      version: "1.0.0",
      enableIframeBackgroundJS: true,
      enableIframeOverlayJS: true,
    }];
    application.emit("theme-changed", {
      themeName: "Theme.ID",
      themeJavaScriptConsentIds: ["unrelated"],
    });
    expect(appearanceBackground?.isConnected).toBe(false);
    expect(document.querySelector("#theme-iframe-background")).toBeNull();
    expect(document.querySelector("#theme-iframe-overlay")).toBeNull();
    await flushThemeWork();
    const refreshedBackground = document.querySelector("#theme-iframe-background");
    const refreshedOverlay = document.querySelector("#theme-iframe-overlay");
    expect(refreshedBackground).not.toBeNull();
    expect(refreshedOverlay).not.toBeNull();
    expect(application.listThemes).toHaveBeenCalledTimes(3);

    application.themeRegistry.themes = [{
      id: "Theme.ID",
      name: "Overlay only",
      version: "1.0.0",
      enableIframeBackgroundJS: false,
      enableIframeOverlayJS: true,
    }];
    application.emit("theme-changed", {
      themeName: "Theme.ID",
      themeJavaScriptConsentIds: ["unrelated"],
    });
    expect(refreshedBackground?.isConnected).toBe(false);
    expect(refreshedOverlay?.isConnected).toBe(false);
    await flushThemeWork();
    const independentlyRecreatedOverlay = document.querySelector("#theme-iframe-overlay");
    expect(document.querySelector("#theme-iframe-background")).toBeNull();
    expect(independentlyRecreatedOverlay).not.toBeNull();

    application.themeRegistry.themes = [{
      id: "Theme.ID",
      name: "Background only",
      version: "1.0.0",
      enableIframeBackgroundJS: true,
      enableIframeOverlayJS: false,
    }];
    application.emit("theme-changed", {
      themeName: "Theme.ID",
      themeJavaScriptConsentIds: ["unrelated"],
    });
    expect(independentlyRecreatedOverlay?.isConnected).toBe(false);
    await flushThemeWork();
    const independentlyRecreatedBackground = document.querySelector("#theme-iframe-background");
    expect(independentlyRecreatedBackground).not.toBeNull();
    expect(document.querySelector("#theme-iframe-overlay")).toBeNull();

    application.themeRegistry.themes = [{
      id: "Overlay.ID",
      name: "Overlay",
      version: "1.0.0",
      enableIframeOverlayJS: true,
    }];
    application.snapshot.display.activeThemeName = "Overlay.ID";
    application.emit("theme-changed", {
      themeName: "Overlay.ID",
      themeJavaScriptConsentIds: ["unrelated"],
    });
    expect(independentlyRecreatedBackground?.isConnected).toBe(false);
    await flushThemeWork();
    expect(document.querySelector("#theme-iframe-background")).toBeNull();
    const selectedOverlay = document.querySelector("#theme-iframe-overlay");
    expect(selectedOverlay).not.toBeNull();

    application.themeRegistry.themes = [{
      id: "Overlay.ID",
      name: "Disabled",
      version: "1.0.0",
      enableIframeBackgroundJS: false,
      enableIframeOverlayJS: false,
    }];
    application.emit("theme-changed", {
      themeName: "Overlay.ID",
      themeJavaScriptConsentIds: ["unrelated"],
    });
    expect(selectedOverlay?.isConnected).toBe(false);
    await flushThemeWork();
    expect(document.querySelector("#theme-iframe-background")).toBeNull();
    expect(document.querySelector("#theme-iframe-overlay")).toBeNull();

    const callsBeforeNull = application.listThemes.mock.calls.length;
    application.snapshot.display.activeThemeName = null;
    application.emit("theme-changed", {
      themeName: null,
      themeJavaScriptConsentIds: ["unrelated"],
    });
    await flushThemeWork();
    expect(application.listThemes).toHaveBeenCalledTimes(callsBeforeNull);
    expect(document.querySelector("#theme-iframe-background")).toBeNull();
    expect(document.querySelector("#theme-iframe-overlay")).toBeNull();

    application.themeRegistry.themes = [{
      id: "Theme.ID",
      name: "Both",
      version: "1.0.0",
      enableIframeBackgroundJS: true,
      enableIframeOverlayJS: true,
    }];
    application.snapshot.display.activeThemeName = "Theme.ID";
    application.emit("theme-changed", {
      themeName: "Theme.ID",
      themeJavaScriptConsentIds: ["unrelated"],
    });
    await flushThemeWork();
    expect(document.querySelector("#theme-iframe-background")).not.toBeNull();
    expect(document.querySelector("#theme-iframe-overlay")).not.toBeNull();

    application.snapshot.connection.status = "disconnected";
    owner.connection.status = "disconnected";
    owner.emitChange();
    expect(document.querySelector("#theme-iframe-background")).toBeNull();
    expect(document.querySelector("#theme-iframe-overlay")).toBeNull();

    const callsBeforeReconnect = application.listThemes.mock.calls.length;
    owner.connection.status = "connected";
    owner.emitChange();
    expect(document.querySelector("#theme-iframe-background")).toBeNull();
    expect(application.listThemes).toHaveBeenCalledTimes(callsBeforeReconnect);
    application.snapshot.connection.status = "connected";
    application.emit("change");
    await flushThemeWork();
    expect(application.listThemes).toHaveBeenCalledTimes(callsBeforeReconnect + 1);
    expect(document.querySelector("#theme-iframe-background")).not.toBeNull();
    expect(document.querySelector("#theme-iframe-overlay")).not.toBeNull();
    expect(mockState.navigationBegin).not.toHaveBeenCalled();
  });

  // proofs/arch/themes/delivery.md#^theme-delivery-t-frame-lifecycle
  // proofs/arch/themes/delivery.md#^theme-delivery-t-frame-appearance-lifecycle
  it("fails theme frame lookup closed while stylesheet, main script, and application continue", async () => {
    const serverURL = window.location.origin;
    mockState.isElectronMode.mockReturnValue(false);

    await import("../src/main.ts");
    const application = mockState.MockApplicationService.instances[0];
    const owner = mockState.MockServerConnectionOwner.instances[0];
    owner.connection.status = "connected";
    owner.connection.bootState = "booted";
    owner.emitChange();
    application.snapshot.connection.status = "connected";
    application.snapshot.ready = true;
    application.snapshot.display.activeThemeName = "Theme.ID";
    application.snapshot.display.themeJavaScriptConsentIds = ["Theme.ID"];
    application.listThemes.mockRejectedValueOnce(new Error("registry unavailable"));
    application.emit("change");
    await flushThemeWork();

    expect(document.querySelector("#app")).not.toBeNull();
    expect(document.querySelector(
      'link[data-television-style="television-active-theme"]',
    )).not.toBeNull();
    expect(document.querySelector(
      'script[data-television-script="television-active-theme"]',
    )).not.toBeNull();
    expect(document.querySelector("#theme-iframe-background")).toBeNull();
    expect(document.querySelector("#theme-iframe-overlay")).toBeNull();

    application.themeRegistry.themes = [{
      id: "Theme.ID",
      name: "Both",
      version: "1.0.0",
      enableIframeBackgroundJS: true,
      enableIframeOverlayJS: true,
    }];
    application.snapshot.display.appearanceMode = "dark";
    application.emit("appearance-changed", { appearanceMode: "dark" });
    await flushThemeWork();
    const firstBackground = document.querySelector("#theme-iframe-background");
    const firstOverlay = document.querySelector("#theme-iframe-overlay");
    const mainAfterRetry = document.querySelector(
      'script[data-television-script="television-active-theme"]',
    );
    expect(firstBackground).not.toBeNull();
    expect(firstOverlay).not.toBeNull();

    application.listThemes.mockRejectedValueOnce(new Error("replacement failed"));
    application.emit("theme-changed", {
      themeName: "Theme.ID",
      themeJavaScriptConsentIds: ["Theme.ID"],
    });
    expect(firstBackground?.isConnected).toBe(false);
    expect(firstOverlay?.isConnected).toBe(false);
    await flushThemeWork();
    expect(document.querySelector("#theme-iframe-background")).toBeNull();
    expect(document.querySelector("#theme-iframe-overlay")).toBeNull();
    expect(document.querySelector("#app")).not.toBeNull();
    expect(document.querySelector(
      'link[data-television-style="television-active-theme"]',
    )).not.toBeNull();
    expect(document.querySelector(
      'script[data-television-script="television-active-theme"]',
    )).not.toBe(mainAfterRetry);
    expect(mockState.navigationBegin).not.toHaveBeenCalled();

    application.snapshot.display.appearanceMode = "light";
    application.emit("appearance-changed", { appearanceMode: "light" });
    await flushThemeWork();
    expect(document.querySelector("#theme-iframe-background")).not.toBeNull();
    expect(document.querySelector("#theme-iframe-overlay")).not.toBeNull();
  });

  // proofs/arch/themes/delivery.md#^theme-delivery-t-frame-lifecycle
  // proofs/arch/themes/delivery.md#^theme-delivery-t-frame-appearance-lifecycle
  it("discards superseded theme frame resolutions and rejections", async () => {
    const serverURL = window.location.origin;
    mockState.isElectronMode.mockReturnValue(false);

    await import("../src/main.ts");
    const application = mockState.MockApplicationService.instances[0];
    const owner = mockState.MockServerConnectionOwner.instances[0];
    let resolveStaleSelection!: (snapshot: typeof application.themeRegistry) => void;
    const staleSelection = new Promise<typeof application.themeRegistry>((resolve) => {
      resolveStaleSelection = resolve;
    });
    application.listThemes.mockImplementationOnce(async () => staleSelection);
    owner.connection.status = "connected";
    owner.connection.bootState = "booted";
    owner.emitChange();
    application.snapshot.connection.status = "connected";
    application.snapshot.ready = true;
    application.snapshot.display.activeThemeName = "Stale.ID";
    application.emit("change");
    await flushThemeWork();

    application.listThemes.mockResolvedValueOnce({
      themes: [{
        id: "Current.ID",
        name: "Current",
        version: "1.0.0",
        enableIframeOverlayJS: true,
      }],
      errors: [],
    });
    application.snapshot.display.activeThemeName = "Current.ID";
    application.emit("theme-changed", {
      themeName: "Current.ID",
      themeJavaScriptConsentIds: [],
    });
    await flushThemeWork();
    const currentOverlay = document.querySelector("#theme-iframe-overlay");
    expect(currentOverlay).not.toBeNull();

    resolveStaleSelection({
      themes: [{
        id: "Stale.ID",
        name: "Stale",
        version: "1.0.0",
        enableIframeBackgroundJS: true,
      }],
      errors: [],
    });
    await flushThemeWork();
    expect(document.querySelector("#theme-iframe-background")).toBeNull();
    expect(document.querySelector("#theme-iframe-overlay")).toBe(currentOverlay);

    let rejectStaleRefresh!: (error: Error) => void;
    const staleRefresh = new Promise<typeof application.themeRegistry>((_resolve, reject) => {
      rejectStaleRefresh = reject;
    });
    application.listThemes.mockImplementationOnce(async () => staleRefresh);
    document.documentElement.dataset.theme = "dark";
    await Promise.resolve();
    expect(currentOverlay?.isConnected).toBe(false);

    application.listThemes.mockResolvedValueOnce({
      themes: [{
        id: "Current.ID",
        name: "Current",
        version: "1.0.0",
        enableIframeBackgroundJS: true,
      }],
      errors: [],
    });
    document.documentElement.dataset.theme = "light";
    await flushThemeWork();
    const currentBackground = document.querySelector<HTMLIFrameElement>(
      "#theme-iframe-background",
    );
    expect(currentBackground).not.toBeNull();
    expect(currentBackground?.srcdoc).toContain('<html data-theme="light">');

    rejectStaleRefresh(new Error("superseded failure"));
    await flushThemeWork();
    expect(document.querySelector("#theme-iframe-background")).toBe(currentBackground);
    expect(document.querySelector("#theme-iframe-overlay")).toBeNull();

    let resolveStaleConnection!: (snapshot: typeof application.themeRegistry) => void;
    const staleConnection = new Promise<typeof application.themeRegistry>((resolve) => {
      resolveStaleConnection = resolve;
    });
    application.listThemes.mockImplementationOnce(async () => staleConnection);
    application.emit("theme-changed", {
      themeName: "Current.ID",
      themeJavaScriptConsentIds: [],
    });
    expect(currentBackground?.isConnected).toBe(false);

    application.snapshot.connection.status = "disconnected";
    owner.connection.status = "disconnected";
    owner.emitChange();
    application.listThemes.mockResolvedValueOnce({
      themes: [{
        id: "Reconnect.ID",
        name: "Reconnect",
        version: "1.0.0",
        enableIframeOverlayJS: true,
      }],
      errors: [],
    });
    application.snapshot.display.activeThemeName = "Reconnect.ID";
    owner.connection.status = "connected";
    owner.emitChange();
    application.snapshot.connection.status = "connected";
    application.emit("change");
    await flushThemeWork();
    const reconnectOverlay = document.querySelector("#theme-iframe-overlay");
    expect(reconnectOverlay).not.toBeNull();

    resolveStaleConnection({
      themes: [{
        id: "Current.ID",
        name: "Stale connection",
        version: "1.0.0",
        enableIframeBackgroundJS: true,
      }],
      errors: [],
    });
    await flushThemeWork();
    expect(document.querySelector("#theme-iframe-background")).toBeNull();
    expect(document.querySelector("#theme-iframe-overlay")).toBe(reconnectOverlay);
    expect(mockState.navigationBegin).not.toHaveBeenCalled();
  });

  // proofs/arch/themes/delivery.md#^theme-delivery-t-script-reset
  it.each([
    {
      transition: "active theme consent withdrawal",
      themeName: "Theme.ID",
      themeJavaScriptConsentIds: [],
    },
    {
      transition: "selection of another theme",
      themeName: "other-theme",
      themeJavaScriptConsentIds: ["Theme.ID"],
    },
    {
      transition: "selection of the null theme",
      themeName: null,
      themeJavaScriptConsentIds: ["Theme.ID"],
    },
  ])("forces one full reload for $transition when a theme include exists", async ({
    themeName,
    themeJavaScriptConsentIds,
  }) => {
    mockState.isElectronMode.mockReturnValue(false);

    await import("../src/main.ts");
    const application = mockState.MockApplicationService.instances[0];
    const owner = mockState.MockServerConnectionOwner.instances[0];
    owner.connection.status = "connected";
    owner.connection.bootState = "booted";
    owner.emitChange();
    application.snapshot.connection.status = "connected";
    application.snapshot.ready = true;
    application.snapshot.display.activeThemeName = "Theme.ID";
    application.snapshot.display.themeJavaScriptConsentIds = ["Theme.ID"];
    application.emit("change");
    expect(document.querySelector(
      'script[data-television-script="television-active-theme"]',
    )).not.toBeNull();

    application.emit("theme-changed", {
      themeName,
      themeJavaScriptConsentIds,
    });
    application.emit("theme-changed", {
      themeName,
      themeJavaScriptConsentIds,
    });

    expect(mockState.navigationBegin).toHaveBeenCalledOnce();
  });

  // proofs/arch/themes/delivery.md#^theme-delivery-t-script-reset
  it("applies theme transitions in place when no script include exists", async () => {
    mockState.isElectronMode.mockReturnValue(false);

    await import("../src/main.ts");
    const application = mockState.MockApplicationService.instances[0];
    const owner = mockState.MockServerConnectionOwner.instances[0];
    owner.connection.status = "connected";
    owner.emitChange();
    application.snapshot.connection.status = "connected";
    application.snapshot.ready = true;
    application.snapshot.display.activeThemeName = null;
    application.snapshot.display.themeJavaScriptConsentIds = ["Theme.ID"];
    application.emit("change");
    expect(document.querySelector(
      'script[data-television-script="television-active-theme"]',
    )).toBeNull();

    application.emit("theme-changed", {
      themeName: "Theme.ID",
      themeJavaScriptConsentIds: ["Theme.ID"],
    });

    expect(mockState.navigationBegin).not.toHaveBeenCalled();
    expect(document.querySelector(
      'script[data-television-script="television-active-theme"]',
    )).not.toBeNull();
  });

  // proofs/arch/themes/delivery.md#^theme-delivery-t-settings-reopen
  it.each([
    { settingsState: "open", open: true, expectsMarker: true },
    { settingsState: "closed", open: false, expectsMarker: false },
  ])("prepares the theme reset URL for $settingsState Settings", async ({
    open,
    expectsMarker,
  }) => {
    window.history.replaceState(
      { retained: true },
      "",
      "/channels?desktopAppVersion=1.2.3&kept=yes#current",
    );
    mockState.isElectronMode.mockReturnValue(false);

    await import("../src/main.ts");
    const settingsPopover = document.createElement("div");
    settingsPopover.id = "settings-popover";
    settingsPopover.toggleAttribute("open", open);
    document.body.append(settingsPopover);
    const application = mockState.MockApplicationService.instances[0];
    const owner = mockState.MockServerConnectionOwner.instances[0];
    owner.connection.status = "connected";
    owner.connection.bootState = "booted";
    owner.emitChange();
    application.snapshot.connection.status = "connected";
    application.snapshot.ready = true;
    application.snapshot.display.activeThemeName = "Theme.ID";
    application.snapshot.display.themeJavaScriptConsentIds = ["Theme.ID"];
    application.emit("change");

    application.emit("theme-changed", {
      themeName: "other-theme",
      themeJavaScriptConsentIds: ["Theme.ID"],
    });
    expect(mockState.navigationBegin).toHaveBeenCalledOnce();
    mockState.runNavigationAction();

    const url = new URL(window.location.href);
    expect(url.pathname).toBe("/channels");
    expect(url.searchParams.get("desktopAppVersion")).toBe("1.2.3");
    expect(url.searchParams.get("kept")).toBe("yes");
    expect(url.searchParams.has("reopenSettings")).toBe(expectsMarker);
    expect(url.hash).toBe("#current");
    expect(window.history.state).toEqual({ retained: true });
  });

  // proofs/arch/themes/delivery.md#^theme-delivery-t-settings-reopen
  it("consumes the theme reset marker and reopens Settings once after connected mount", async () => {
    const settingsPopover = document.createElement("div");
    settingsPopover.id = "settings-popover";
    const setAttribute = vi.spyOn(settingsPopover, "setAttribute");
    mockState.televisionAppView.mockImplementationOnce((_application, _options) => {
      const fragment = document.createDocumentFragment();
      const root = document.createElement("div");
      root.id = "app";
      root.append(settingsPopover);
      const foreground = document.createElement("div");
      foreground.id = "foreground-overlay";
      fragment.append(root, foreground);
      return fragment;
    });
    window.history.replaceState(
      { retained: true },
      "",
      "/channels?desktopAppVersion=1.2.3&reopenSettings=1#current",
    );
    mockState.isElectronMode.mockReturnValue(false);

    await import("../src/main.ts");

    expect(window.location.pathname).toBe("/channels");
    expect(window.location.search).toBe(
      "?desktopAppVersion=1.2.3",
    );
    expect(window.location.hash).toBe("#current");
    expect(window.history.state).toEqual({ retained: true });
    const options = mockState.televisionAppView.mock.calls[0]?.[1] as {
      onRenderComplete(state: string): void;
    };
    options.onRenderComplete("connecting");
    expect(settingsPopover.hasAttribute("open")).toBe(false);
    options.onRenderComplete("no-channel");
    options.onRenderComplete("connected");
    options.onRenderComplete("connecting");
    options.onRenderComplete("connected");
    expect(settingsPopover.hasAttribute("open")).toBe(true);
    expect(setAttribute.mock.calls.filter(([name]) => name === "open")).toHaveLength(1);
  });

  // proofs/arch/themes/delivery.md#^theme-delivery-t-shell-appearance
  // proofs/arch/themes/delivery.md#^theme-delivery-t-fixed-preference-resources
  it("keeps fixed-theme appearance and resources stable until the active scheme becomes adaptive", async () => {
    mockState.isElectronMode.mockReturnValue(false);

    await import("../src/main.ts");
    const application = mockState.MockApplicationService.instances[0];
    const owner = mockState.MockServerConnectionOwner.instances[0];
    application.themeRegistry.themes = [{
      id: "Fixed.ID",
      name: "Fixed dark",
      version: "1.0.0",
      enableIframeBackgroundJS: true,
    }];
    owner.connection.status = "connected";
    owner.connection.bootState = "booted";
    owner.emitChange();
    application.snapshot.connection.status = "connected";
    application.snapshot.ready = true;
    application.snapshot.display.activeThemeName = "Fixed.ID";
    application.snapshot.display.activeThemeColorScheme = "dark";
    application.snapshot.display.appearanceMode = "light";
    application.snapshot.display.themeJavaScriptConsentIds = ["Fixed.ID"];
    application.emit("change");
    await flushThemeWork();

    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(window.localStorage.getItem("television-appearance-mode")).toBe("dark");
    const fixedLink = document.querySelector(
      'link[data-television-style="television-active-theme"]',
    );
    const fixedScript = document.querySelector(
      'script[data-television-script="television-active-theme"]',
    );
    const fixedFrame = document.querySelector("#theme-iframe-background");
    expect(fixedLink).not.toBeNull();
    expect(fixedScript).not.toBeNull();
    expect(fixedFrame).not.toBeNull();

    application.snapshot.display.appearanceMode = "system";
    application.emit("appearance-changed", { appearanceMode: "system" });
    await flushThemeWork();

    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(window.localStorage.getItem("television-appearance-mode")).toBe("dark");
    expect(document.querySelector(
      'link[data-television-style="television-active-theme"]',
    )).toBe(fixedLink);
    expect(document.querySelector(
      'script[data-television-script="television-active-theme"]',
    )).toBe(fixedScript);
    expect(document.querySelector("#theme-iframe-background")).toBe(fixedFrame);

    application.snapshot.display.activeThemeColorScheme = "light dark";
    application.emit("theme-changed", {
      themeName: "Fixed.ID",
      activeThemeColorScheme: "light dark",
      themeJavaScriptConsentIds: ["Fixed.ID"],
    });
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(window.localStorage.getItem("television-appearance-mode")).toBe("system");
    expect(fixedFrame?.isConnected).toBe(false);
    await flushThemeWork();
    expect(document.querySelector("#theme-iframe-background")).not.toBe(fixedFrame);
    expect(mockState.navigationBegin).not.toHaveBeenCalled();
  });

  // proofs/arch/themes/delivery.md#^theme-delivery-t-script-reset-appearance
  it.each([false, true])(
    "applies destination appearance before a theme reset when cache writes fail: %s",
    async (cacheWriteFails) => {
      mockState.isElectronMode.mockReturnValue(false);

      await import("../src/main.ts");
      const application = mockState.MockApplicationService.instances[0];
      const owner = mockState.MockServerConnectionOwner.instances[0];
      owner.connection.status = "connected";
      owner.connection.bootState = "booted";
      owner.emitChange();
      application.snapshot.connection.status = "connected";
      application.snapshot.ready = true;
      application.snapshot.display.activeThemeName = "Dark.ID";
      application.snapshot.display.activeThemeColorScheme = "dark";
      application.snapshot.display.appearanceMode = "dark";
      application.snapshot.display.themeJavaScriptConsentIds = ["Dark.ID"];
      application.emit("change");
      expect(document.querySelector(
        'script[data-television-script="television-active-theme"]',
      )).not.toBeNull();

      const setItem = vi.spyOn(Storage.prototype, "setItem");
      if (cacheWriteFails) {
        setItem.mockImplementation(() => {
          throw new DOMException("blocked", "QuotaExceededError");
        });
      }
      mockState.navigationBegin.mockClear();
      application.emit("theme-changed", {
        themeName: "Light.ID",
        activeThemeColorScheme: "light",
        themeJavaScriptConsentIds: ["Dark.ID"],
      });

      expect(document.documentElement.dataset.theme).toBe("light");
      if (!cacheWriteFails) {
        expect(window.localStorage.getItem("television-appearance-mode")).toBe("light");
      }
      expect(setItem).toHaveBeenCalledWith("television-appearance-mode", "light");
      expect(mockState.navigationBegin).toHaveBeenCalledOnce();
      expect(setItem.mock.invocationCallOrder.at(-1)).toBeLessThan(
        mockState.navigationBegin.mock.invocationCallOrder[0]!,
      );
      setItem.mockRestore();
    },
  );

  // proofs/arch/desktop/appearance.md#^desktop-appearance-t-renderer
  it("keeps Electron startup running when the shell lacks the appearance bridge operation", async () => {
    (globalThis as typeof globalThis & {
      __televisionNativeBridge?: {
        onNavigationKey(callback: (key: string) => void): void;
      };
    }).__televisionNativeBridge = { onNavigationKey: vi.fn() };
    mockState.isElectronMode.mockReturnValue(true);

    await import("../src/main.ts");
    const application = mockState.MockApplicationService.instances[0];
    const owner = mockState.MockServerConnectionOwner.instances[0];
    owner.connection.status = "connected";
    owner.connection.bootState = "booted";
    owner.emitChange();

    application.snapshot.connection.status = "connected";
    application.snapshot.ready = true;
    application.snapshot.display.appearanceMode = "light";
    application.snapshot.display.activeThemeColorScheme = "dark";
    expect(() => application.emit("change")).not.toThrow();

    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(document.querySelector(
      'link[data-television-style="television-active-theme"]',
    )).not.toBeNull();
  });

  it("sends resolved Electron appearance before mount and only when effective input changes", async () => {
    const setAppearanceMode = vi.fn();
    (globalThis as typeof globalThis & {
      __televisionNativeBridge?: {
        onNavigationKey(callback: (key: string) => void): void;
        setAppearanceMode(mode: "system" | "light" | "dark"): void;
      };
    }).__televisionNativeBridge = {
      onNavigationKey: vi.fn(),
      setAppearanceMode,
    };
    mockState.isElectronMode.mockReturnValue(true);

    await import("../src/main.ts");
    const application = mockState.MockApplicationService.instances[0];
    const owner = mockState.MockServerConnectionOwner.instances[0];
    owner.connection.status = "connected";
    application.snapshot.connection.status = "connected";
    application.snapshot.ready = true;
    application.snapshot.display.activeThemeColorScheme = "light dark";
    application.snapshot.display.appearanceMode = "system";
    application.emit("change");

    expect(setAppearanceMode.mock.calls).toEqual([["system"]]);
    expect(mockState.televisionAppView).not.toHaveBeenCalled();

    owner.connection.bootState = "halted";
    owner.emitChange();
    expect(mockState.televisionAppView).toHaveBeenCalledOnce();
    expect(setAppearanceMode.mock.invocationCallOrder[0]).toBeLessThan(
      mockState.televisionAppView.mock.invocationCallOrder[0]!,
    );

    application.snapshot.display.appearanceMode = "light";
    application.emit("appearance-changed", { appearanceMode: "light" });
    application.snapshot.display.appearanceMode = "dark";
    application.emit("appearance-changed", { appearanceMode: "dark" });
    expect(setAppearanceMode.mock.calls).toEqual([
      ["system"],
      ["light"],
      ["dark"],
    ]);

    application.snapshot.display.activeThemeColorScheme = "light";
    application.emit("theme-changed", {
      themeName: "Fixed.Light",
      activeThemeColorScheme: "light",
      themeJavaScriptConsentIds: [],
    });
    application.snapshot.display.appearanceMode = "system";
    application.emit("appearance-changed", { appearanceMode: "system" });
    expect(setAppearanceMode.mock.calls).toEqual([
      ["system"],
      ["light"],
      ["dark"],
      ["light"],
    ]);

    application.snapshot.display.activeThemeColorScheme = "dark";
    application.emit("theme-changed", {
      themeName: "Fixed.Dark",
      activeThemeColorScheme: "dark",
      themeJavaScriptConsentIds: [],
    });
    application.snapshot.display.appearanceMode = "light";
    application.emit("appearance-changed", { appearanceMode: "light" });
    expect(setAppearanceMode.mock.calls).toEqual([
      ["system"],
      ["light"],
      ["dark"],
      ["light"],
      ["dark"],
    ]);

    application.snapshot.display.activeThemeColorScheme = null;
    application.emit("theme-changed", {
      themeName: null,
      activeThemeColorScheme: null,
      themeJavaScriptConsentIds: [],
    });
    expect(setAppearanceMode.mock.calls).toEqual([
      ["system"],
      ["light"],
      ["dark"],
      ["light"],
      ["dark"],
      ["light"],
    ]);

    owner.connection.status = "disconnected";
    application.snapshot.connection.status = "disconnected";
    application.snapshot.ready = false;
    application.emit("change");
    expect(setAppearanceMode.mock.calls).toHaveLength(6);

    owner.connection.status = "connected";
    application.snapshot.connection.status = "connected";
    application.snapshot.ready = true;
    application.snapshot.display.activeThemeColorScheme = "light";
    application.snapshot.display.appearanceMode = "dark";
    application.emit("change");
    expect(setAppearanceMode.mock.calls).toHaveLength(7);
    expect(setAppearanceMode.mock.calls.at(-1)).toEqual(["light"]);
  });

  it("never calls the native appearance bridge in browser mode", async () => {
    const setAppearanceMode = vi.fn();
    (globalThis as typeof globalThis & {
      __televisionNativeBridge?: {
        onNavigationKey(callback: (key: string) => void): void;
        setAppearanceMode(mode: "system" | "light" | "dark"): void;
      };
    }).__televisionNativeBridge = {
      onNavigationKey: vi.fn(),
      setAppearanceMode,
    };
    mockState.isElectronMode.mockReturnValue(false);

    await import("../src/main.ts");
    const application = mockState.MockApplicationService.instances[0];
    const owner = mockState.MockServerConnectionOwner.instances[0];
    owner.connection.status = "connected";
    application.snapshot.connection.status = "connected";
    application.snapshot.ready = true;
    application.snapshot.display.appearanceMode = "dark";
    application.emit("change");
    application.emit("appearance-changed", { appearanceMode: "light" });

    expect(setAppearanceMode).not.toHaveBeenCalled();
  });

  it("in browser mode registers services and passes the app view runtime options", async () => {
    mockState.isElectronMode.mockReturnValue(false);

    await import("../src/main.ts");

    expect(mockState.MockLocalStore.instances).toHaveLength(1);
    expect(mockState.MockLocalStore.instances[0].args[0]).toBe("television-browser");
    expect(mockState.createDefaultLocalState).toHaveBeenCalledWith();
    expect(mockState.MockApplicationService.instances).toHaveLength(1);
    expect(mockState.MockApplicationService.instances[0].args).toMatchObject({
      navigationKeyHandler: expect.any(Function),
    });
    expect(mockState.MockServerConnectionOwner.instances).toHaveLength(1);
    expect(mockState.MockServerConnectionOwner.instances[0].connect).toHaveBeenCalledTimes(1);
    expect(mockState.dependenciesRegister).toHaveBeenCalledTimes(2);

    expect(mockState.televisionAppView).toHaveBeenCalledOnce();
    expect(mockState.televisionAppView.mock.calls[0]?.[0]).toBe(
      mockState.MockApplicationService.instances[0],
    );
    expect(mockState.televisionAppView.mock.calls[0]?.[1]).toMatchObject({
      serverURL: window.location.origin,
      electronMode: false,
    });
  });
});

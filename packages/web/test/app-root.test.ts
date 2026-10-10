// @vitest-environment jsdom

import { DesktopUpgradeGateView } from "../src/views/desktop-upgrade-gate.ts";

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { DesktopUpdateState } from "../src/services/desktop-update.ts";
import { StandInDesktopUpdateBridge } from "./helpers/desktop-update-bridge.ts";
import { render } from "lit-html";
import {
  DEFAULT_PAGE_GEOMETRY,
  DEFAULT_PAGE_SIZE,
} from "@telepath-computer/television-shared";
import type {
  ApplicationChannelSnapshot,
  ApplicationSnapshot,
} from "../src/services/application-service.ts";
import {
  CHANNEL_SIDEBAR_COLLAPSED_STORAGE_KEY,
  ChannelSidebarCollapsedPreference,
} from "../src/services/channel-sidebar-collapsed.ts";
import { ChannelSidebarWidthPreference } from "../src/services/channel-sidebar-width.ts";
import {
  SystemModalView,
  type SystemModalState,
} from "../src/views/system-modal.ts";
import { TelevisionAppView } from "../src/views/television-app.ts";
import { installNativeDialogMock } from "./helpers/dialog.ts";

const SERVER_URL = "http://localhost:32848";
const SIDEBAR_WIDTH_PREFERENCE = new ChannelSidebarWidthPreference(localStorage);

class MemoryStorage implements Storage {
  readonly #values = new Map<string, string>();

  constructor(entries: Readonly<Record<string, string>> = {}) {
    for (const [key, value] of Object.entries(entries)) this.#values.set(key, value);
  }

  get length(): number {
    return this.#values.size;
  }

  clear(): void {
    this.#values.clear();
  }

  getItem(key: string): string | null {
    return this.#values.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.#values.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.#values.delete(key);
  }

  setItem(key: string, value: string): void {
    this.#values.set(key, value);
  }
}

function collapsedPreference(collapsed = false): ChannelSidebarCollapsedPreference {
  return new ChannelSidebarCollapsedPreference(new MemoryStorage(
    collapsed ? { [CHANNEL_SIDEBAR_COLLAPSED_STORAGE_KEY]: "true" } : {},
  ));
}

const SIDEBAR_COLLAPSED_PREFERENCE = collapsedPreference();

vi.stubGlobal("ResizeObserver", class { observe(): void {} disconnect(): void {} });

const POPULATED_PAGE = {
  artifactIds: ["artifact-1"],
  geometry: DEFAULT_PAGE_GEOMETRY,
  size: DEFAULT_PAGE_SIZE,
};

const POPULATED_CHANNEL: ApplicationChannelSnapshot = {
  id: "channel-1",
  name: "Research",
  pages: [POPULATED_PAGE],
  selectedPage: POPULATED_PAGE,
  artifacts: [],
};

const EMPTY_CHANNEL: ApplicationChannelSnapshot = {
  ...POPULATED_CHANNEL,
  pages: [],
  selectedPage: null,
};

function applicationSnapshot(
  overrides: Omit<Partial<ApplicationSnapshot>, "connection"> & {
    connection?: Partial<ApplicationSnapshot["connection"]>;
  } = {},
): ApplicationSnapshot {
  const { connection: connectionOverrides, ...snapshotOverrides } = overrides;
  const channels = overrides.channels ?? [POPULATED_CHANNEL];
  const focusedChannel = overrides.focusedChannel === undefined
    ? channels[0] ?? null
    : overrides.focusedChannel;
  return {
    ready: true,
    channels,
    display: {
      focusedChannelId: focusedChannel?.id ?? null,
      pinnedChannelIds: focusedChannel ? [focusedChannel.id] : [],
      activeThemeName: null,
      activeThemeColorScheme: null,
      appearanceMode: "system",
      themeJavaScriptConsentIds: [],
      acpEnabled: false,
    },
    focusedChannel,
    ...snapshotOverrides,
    connection: {
      authorizationRequired: false,
      gateHalted: false,
      status: "connected",
      hasEverConnected: true,
      failedReconnectAttempts: 0,
      firstConnectError: null,
      nextRetryAt: null,
      upgradeInstructions: null,
      ...connectionOverrides,
    },
  };
}

class FakeApplication extends EventTarget {
  snapshot: ApplicationSnapshot;
  handleNavigationKey = vi.fn((_key: string) => undefined);
  getArtifactViewURL = vi.fn(() => "/artifact-view");
  getArtifactContentURL = vi.fn(() => null);

  constructor(snapshot: ApplicationSnapshot) {
    super();
    this.snapshot = snapshot;
  }

  setSnapshot(snapshot: ApplicationSnapshot): void {
    this.snapshot = snapshot;
    this.dispatchEvent(new Event("change"));
  }
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

let restoreDialog: () => void;
let bodyRenderInitialized = false;
const applicationHosts: HTMLElement[] = [];

function createApplicationHost(): HTMLElement {
  const host = document.createElement("main");
  applicationHosts.push(host);
  document.body.append(host);
  return host;
}

beforeAll(() => {
  restoreDialog = installNativeDialogMock();
});

afterEach(() => {
  for (const host of applicationHosts) render(null, host);
  applicationHosts.length = 0;
  if (bodyRenderInitialized) {
    render(null, document.body);
    for (const child of [...document.body.children]) child.remove();
  } else {
    document.body.replaceChildren();
  }
});

afterAll(() => restoreDialog());

describe("application-state selection (^ap-ac-one-state)", () => {
  it("resolves every shell input and overlapping connection fact to one presentation", async () => {
    const application = new FakeApplication(applicationSnapshot());
    const app = createApplicationHost();
    let resolveRender: ((state: string) => void) | null = null;
    const nextApplicationRender = (): Promise<string> =>
      new Promise((resolve) => {
        resolveRender = resolve;
      });
    const initialRender = nextApplicationRender();
    render(TelevisionAppView(application as never, {
      serverURL: SERVER_URL,
      electronMode: false,
      sidebarWidthPreference: SIDEBAR_WIDTH_PREFERENCE,
      sidebarCollapsedPreference: SIDEBAR_COLLAPSED_PREFERENCE,
      onRenderComplete(state) {
        resolveRender?.(state);
        resolveRender = null;
      },
    }), app);
    expect(await initialRender).toBe("connected");
    await flush();

    const rows: Array<{
      name: string;
      snapshot: ApplicationSnapshot;
      state: string;
    }> = [
      { name: "connected populated channel", snapshot: applicationSnapshot(), state: "connected" },
      {
        name: "connected with no channels",
        snapshot: applicationSnapshot({ channels: [], focusedChannel: null }),
        state: "no-channel",
      },
      {
        name: "connected with an empty focused channel",
        snapshot: applicationSnapshot({ channels: [EMPTY_CHANNEL], focusedChannel: EMPTY_CHANNEL }),
        state: "empty-channel",
      },
      {
        name: "retained gate outranks authorization, prior session, and error",
        snapshot: applicationSnapshot({
          connection: {
            authorizationRequired: true,
            gateHalted: true,
            status: "disconnected",
            hasEverConnected: true,
            firstConnectError: "offline",
          },
        }),
        state: "needs-upgrade",
      },
      {
        name: "gate outranks a connection interstitial",
        snapshot: applicationSnapshot({
          connection: {
            gateHalted: true,
            status: "disconnected",
            hasEverConnected: false,
            firstConnectError: "offline",
          },
        }),
        state: "needs-upgrade",
      },
      {
        name: "a lost prior session disconnects over the mounted shell",
        snapshot: applicationSnapshot({
          connection: {
            status: "disconnected",
            hasEverConnected: true,
            firstConnectError: "offline",
          },
        }),
        state: "disconnected",
      },
      ...[1, 2, 3].map((failedReconnectAttempts) => ({
        name: `after ${failedReconnectAttempts} failed reconnects`,
        snapshot: applicationSnapshot({ connection: {
          status: "disconnected", failedReconnectAttempts,
        } }),
        state: failedReconnectAttempts < 3 ? "disconnected" : "error",
      })),
      ...[false, true].flatMap((hasEverConnected) => ["unauthorized", "needs-upgrade"].map((state) => ({
        name: `${state} answers immediately with prior session=${hasEverConnected}`,
        snapshot: applicationSnapshot({ connection: {
          status: "disconnected", hasEverConnected, failedReconnectAttempts: 3,
          firstConnectError: "offline",
          authorizationRequired: state === "unauthorized",
          gateHalted: state === "needs-upgrade",
        } }),
        state,
      }))),
      {
        name: "a failed first connection shows its error",
        snapshot: applicationSnapshot({
          connection: {
            status: "disconnected",
            hasEverConnected: false,
            firstConnectError: "offline",
          },
        }),
        state: "error",
      },
      {
        name: "a pending first connection shows connecting",
        snapshot: applicationSnapshot({
          ready: false,
          connection: {
            status: "disconnected",
            hasEverConnected: false,
            firstConnectError: null,
          },
        }),
        state: "connecting",
      },
    ];

    for (const row of rows) {
      const rendered = nextApplicationRender();
      application.setSnapshot(row.snapshot);
      expect(await rendered, row.name).toBe(row.state);
      await flush();
      expect(app.querySelector("#app")?.getAttribute("data-app-state"), row.name).toBe(row.state);
      expect(app.querySelectorAll(":scope > #app > .system-modal-host, :scope > #app > .desktop-upgrade-gate"), row.name).toHaveLength(
        ["connected", "no-channel", "empty-channel"].includes(row.state) ? 0 : 1,
      );

    }
  });
});

describe("root shell composition and readiness (^ap-ac-markup-smoke)", () => {
  it("commits each shell state before reporting render complete", async () => {
    const application = new FakeApplication(applicationSnapshot());
    const app = createApplicationHost();

    const committedStates: string[] = [];
    render(TelevisionAppView(application as never, {
      serverURL: SERVER_URL,
      electronMode: false,
      sidebarWidthPreference: SIDEBAR_WIDTH_PREFERENCE,
      sidebarCollapsedPreference: SIDEBAR_COLLAPSED_PREFERENCE,
      onRenderComplete() {
        committedStates.push(app.querySelector("#app")?.getAttribute("data-app-state") ?? "missing");
      },
    }), app);
    await flush();

    const assertComposition = (state: string, shell: boolean, modal: boolean): void => {
      expect(committedStates.at(-1)).toBe(state);
      const applicationRoot = app.querySelector<HTMLElement>(":scope > #app");
      expect(applicationRoot?.getAttribute("data-app-state")).toBe(state);
      expect(applicationRoot?.getAttribute("tabindex")).toBe("-1");
      const foreground = app.querySelector<HTMLElement>(":scope > #foreground-overlay");
      expect(foreground).not.toBeNull();
      expect(foreground?.hasAttribute("inert")).toBe(true);
      expect(foreground?.getAttribute("aria-hidden")).toBe("true");
      expect([...app.children]).toEqual([applicationRoot, foreground]);
      expect(app.querySelectorAll(":scope > #app > .app-sidebar")).toHaveLength(shell ? 1 : 0);
      expect(app.querySelectorAll(":scope > #app > .app-main")).toHaveLength(shell ? 1 : 0);
      expect(app.querySelectorAll(":scope > #app > .system-modal-host, :scope > #app > .desktop-upgrade-gate")).toHaveLength(modal ? 1 : 0);
      if (shell) {
        const main = app.querySelector(".app-main")!;
        expect(main.children).toHaveLength(2);
        expect(main.children[0].classList.contains("top-bar")).toBe(true);
        expect(main.children[1].classList.contains("stage")).toBe(true);
        expect(main.querySelector(":scope > .top-bar > .tab-strip")).not.toBeNull();
        expect(main.querySelector(":scope > .top-bar > .top-bar-controls > .skill-trigger"))
          .not.toBeNull();
        expect(main.querySelector(":scope > .stage > .filmstrip")).not.toBeNull();
      }
    };

    assertComposition("connected", true, false);
    const sidebar = app.querySelector(".app-sidebar");
    const main = app.querySelector(".app-main");
    const topBar = app.querySelector(".top-bar");
    const stage = app.querySelector(".stage");

    const rows: Array<{
      snapshot: ApplicationSnapshot;
      state: string;
      shell: boolean;
      modal: boolean;
    }> = [
      {
        snapshot: applicationSnapshot({ channels: [], focusedChannel: null }),
        state: "no-channel",
        shell: true,
        modal: false,
      },
      {
        snapshot: applicationSnapshot({ channels: [EMPTY_CHANNEL], focusedChannel: EMPTY_CHANNEL }),
        state: "empty-channel",
        shell: true,
        modal: false,
      },
      {
        snapshot: applicationSnapshot({
          connection: { status: "disconnected", hasEverConnected: true },
        }),
        state: "disconnected",
        shell: true,
        modal: true,
      },
      {
        snapshot: applicationSnapshot({ connection: {
          status: "disconnected", hasEverConnected: true, failedReconnectAttempts: 3,
        } }),
        state: "error",
        shell: true,
        modal: true,
      },
      {
        snapshot: applicationSnapshot({
          ready: false,
          connection: { status: "disconnected", hasEverConnected: false },
        }),
        state: "connecting",
        shell: false,
        modal: true,
      },
      {
        snapshot: applicationSnapshot({
          connection: { authorizationRequired: true },
        }),
        state: "unauthorized",
        shell: false,
        modal: true,
      },
      {
        snapshot: applicationSnapshot({
          connection: {
            status: "disconnected",
            hasEverConnected: false,
            firstConnectError: "offline",
          },
        }),
        state: "error",
        shell: false,
        modal: true,
      },
      {
        snapshot: applicationSnapshot({
          connection: { gateHalted: true },
        }),
        state: "needs-upgrade",
        shell: false,
        modal: true,
      },
    ];

    for (const row of rows) {
      application.setSnapshot(row.snapshot);
      await flush();
      assertComposition(row.state, row.shell, row.modal);
      if (row.state === "disconnected") {
        expect(app.querySelector(".app-sidebar")).toBe(sidebar);
        expect(app.querySelector(".app-main")).toBe(main);
        expect(app.querySelector(".top-bar")).toBe(topBar);
        expect(app.querySelector(".stage")).toBe(stage);
      }
    }
  });
});

describe("collapsed shell composition (^ap-ac-collapse-composition)", () => {
  it("omits only the sidebar and passes collapsed focus facts to the top bar", async () => {
    const focusedChannel: ApplicationChannelSnapshot = {
      ...POPULATED_CHANNEL,
      artifacts: [{
        id: "artifact-1",
        kind: "path",
        path: "/tmp/research-note.html",
        title: "Research note",
      }],
    };
    const rows = [
      { name: "open with focus", collapsed: false, focused: true },
      { name: "open without focus", collapsed: false, focused: false },
      { name: "collapsed with focus", collapsed: true, focused: true },
      { name: "collapsed without focus", collapsed: true, focused: false },
    ] as const;

    for (const row of rows) {
      const channels = row.focused ? [focusedChannel] : [];
      const application = new FakeApplication(applicationSnapshot({
        channels,
        focusedChannel: row.focused ? focusedChannel : null,
      }));
      const app = createApplicationHost();

      render(TelevisionAppView(application as never, {
        serverURL: SERVER_URL,
        electronMode: false,
        sidebarWidthPreference: SIDEBAR_WIDTH_PREFERENCE,
        sidebarCollapsedPreference: collapsedPreference(row.collapsed),
      }), app);
      await flush();

      expect(app.querySelectorAll(":scope > #app > .app-sidebar"), row.name)
        .toHaveLength(row.collapsed ? 0 : 1);
      expect(app.querySelectorAll(":scope > #app > .app-sidebar-resize"), row.name)
        .toHaveLength(row.collapsed ? 0 : 1);
      expect(app.querySelectorAll(":scope > #app > .app-main"), row.name)
        .toHaveLength(1);
      const main = app.querySelector<HTMLElement>(":scope > #app > .app-main")!;
      expect([...main.children].map(({ className }) => className), row.name)
        .toEqual(["top-bar", "stage"]);
      expect(main.querySelectorAll(":scope > .top-bar > .top-bar-lead"), row.name)
        .toHaveLength(row.collapsed ? 1 : 0);
      expect(app.querySelectorAll(".sidebar-toggle"), row.name).toHaveLength(0);
      expect(app.querySelectorAll(".sidebar-toggle-paint"), row.name).toHaveLength(0);
      expect(app.querySelectorAll(".sidebar-toggle-seat"), row.name).toHaveLength(0);
      expect(
        [...main.querySelectorAll<HTMLElement>(".tab-label")]
          .map((label) => label.textContent?.trim()),
        row.name,
      ).toEqual(row.focused ? ["Research note"] : []);

      if (row.collapsed) {
        const lead = main.querySelector<HTMLElement>(".top-bar-lead")!;
        expect(lead.children, row.name).toHaveLength(row.focused ? 2 : 1);
        const expand = lead.querySelector<HTMLButtonElement>(":scope > button.sidebar-expand");
        expect(expand?.getAttribute("aria-label"), row.name).toBe("Show sidebar");
        expect(expand?.getAttribute("title"), row.name).toBe("Show sidebar");
        expect([...expand?.children ?? []].map((child) => ({
          tag: child.tagName,
          name: child.getAttribute("name"),
        })), row.name).toEqual([{ tag: "TV-ICON", name: "sidebar" }]);
        expect(main.querySelectorAll(".channel-switcher"), row.name)
          .toHaveLength(row.focused ? 1 : 0);
        expect(main.querySelectorAll(".channel-switcher-pop"), row.name)
          .toHaveLength(0);
        expect(
          main.querySelector(".channel-switcher")?.hasAttribute("aria-expanded") ?? false,
          row.name,
        ).toBe(false);
      } else {
        const titlebar = app.querySelector<HTMLElement>(
          ":scope > #app > .app-sidebar .sidebar-titlebar",
        )!;
        expect([...titlebar.children].map((element) => ({
          tag: element.tagName,
          className: element.className,
        })), row.name).toEqual([
          { tag: "BUTTON", className: "channel-create" },
          { tag: "SPAN", className: "toolbar-separator" },
          { tag: "BUTTON", className: "sidebar-collapse" },
        ]);
        const collapse = titlebar.querySelector<HTMLButtonElement>(
          ":scope > button.sidebar-collapse",
        )!;
        expect([...collapse.children].map((child) => ({
          tag: child.tagName,
          name: child.getAttribute("name"),
        })), row.name).toEqual([{ tag: "TV-ICON", name: "sidebar" }]);
      }
    }
  });
});

describe("application theme visual layers (^ap-ac-theme-layers)", () => {
  it("composes enabled frames around the production app root and permanent foreground", async () => {
    document.documentElement.dataset.theme = "light";
    const application = new FakeApplication(applicationSnapshot());
    bodyRenderInitialized = true;
    render(TelevisionAppView(application as never, {
      serverURL: SERVER_URL,
      electronMode: false,
      sidebarWidthPreference: SIDEBAR_WIDTH_PREFERENCE,
      sidebarCollapsedPreference: SIDEBAR_COLLAPSED_PREFERENCE,
    }), document.body);
    await flush();
    const theme = await import("../src/theme.ts");

    await theme.refreshThemeFrames(SERVER_URL, "Theme.ID", async () => ({
      themes: [{
        id: "Theme.ID",
        name: "Visual",
        version: "1.0.0",
        colorScheme: "light dark",
        enableIframeBackgroundJS: true,
        enableIframeOverlayJS: true,
      }],
      errors: [],
    }));

    expect([...document.body.children].map((element) => element.id)).toEqual([
      "theme-iframe-background",
      "app",
      "foreground-overlay",
      "theme-iframe-overlay",
    ]);
    for (const frame of document.querySelectorAll<HTMLIFrameElement>(
      "#theme-iframe-background, #theme-iframe-overlay",
    )) {
      expect(frame.getAttribute("sandbox")).toBe("allow-scripts");
      expect(frame.hasAttribute("inert")).toBe(true);
      expect(frame.getAttribute("tabindex")).toBe("-1");
      expect(frame.getAttribute("aria-hidden")).toBe("true");
      expect(frame.srcdoc).not.toBe("");
    }
    const foreground = document.querySelector<HTMLElement>("#foreground-overlay")!;
    expect(foreground.hasAttribute("inert")).toBe(true);
    expect(foreground.getAttribute("aria-hidden")).toBe("true");
    const background = document.querySelector("#theme-iframe-background");
    const overlay = document.querySelector("#theme-iframe-overlay");

    application.setSnapshot(applicationSnapshot({
      connection: { status: "disconnected", hasEverConnected: true },
    }));
    await flush();
    expect(document.querySelector("#theme-iframe-background")).toBe(background);
    expect(document.querySelector("#theme-iframe-overlay")).toBe(overlay);
    expect([...document.body.children].map((element) => element.id)).toEqual([
      "theme-iframe-background",
      "app",
      "foreground-overlay",
      "theme-iframe-overlay",
    ]);

    theme.clearThemeFrames();
  });
});

describe("application navigation listener lifecycle", () => {
  it("owns one document listener only while the root is connected", async () => {
    const application = new FakeApplication(applicationSnapshot());
    const app = createApplicationHost();
    const appView = () => TelevisionAppView(application as never, {
      serverURL: SERVER_URL,
      electronMode: false,
      sidebarWidthPreference: SIDEBAR_WIDTH_PREFERENCE,
      sidebarCollapsedPreference: SIDEBAR_COLLAPSED_PREFERENCE,
    });

    render(appView(), app);
    await flush();
    const matched = new KeyboardEvent("keydown", {
      key: "ArrowRight",
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    document.body.dispatchEvent(matched);
    expect(matched.defaultPrevented).toBe(true);
    expect(application.handleNavigationKey).toHaveBeenCalledOnce();
    expect(application.handleNavigationKey).toHaveBeenCalledWith("ArrowRight");

    render(null, app);
    application.handleNavigationKey.mockClear();
    const afterDisconnect = new KeyboardEvent("keydown", {
      key: "ArrowRight",
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    document.body.dispatchEvent(afterDisconnect);
    expect(afterDisconnect.defaultPrevented).toBe(false);
    expect(application.handleNavigationKey).not.toHaveBeenCalled();

    render(appView(), app);
    await flush();
    const afterReconnect = new KeyboardEvent("keydown", {
      key: "ArrowRight",
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    document.body.dispatchEvent(afterReconnect);
    expect(application.handleNavigationKey).toHaveBeenCalledOnce();
  });
});

describe("system modal (^sm-ac-markup-smoke)", () => {
  it("renders connection contents by state and place, with only local disconnect actions", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
    const host = createApplicationHost();
    const disconnect = vi.fn();
    const downloadedBridge = new StandInDesktopUpdateBridge();
    downloadedBridge.report("1.5.0");
    const desktopUpdate = new DesktopUpdateState({ electron: true, bridge: downloadedBridge });
    const states: SystemModalState[] = [
      { kind: "connecting" },
      { kind: "disconnected", nextRetryAt: 15_000 },
      { kind: "disconnected", nextRetryAt: null },
      { kind: "unauthorized" },
      { kind: "error", serverURL: SERVER_URL, nextRetryAt: 15_000 },
      { kind: "error", serverURL: SERVER_URL, nextRetryAt: null },
    ];
    try {
      for (const context of ["browser", "desktop", "local"] as const) {
        for (const state of states) {
          render(SystemModalView(state, { context, onDisconnect: disconnect }), host);
          await flush();
          expect(host.querySelectorAll("dialog")).toHaveLength(1);
          expect(host.querySelector(".desktop-upgrade-gate")).toBeNull();
          expect(host.querySelector("form, input")).toBeNull();
          expect(host.querySelector("h2")?.textContent).toBe({
            connecting: "Connecting", disconnected: "Disconnected",
            unauthorized: "Access token required", error: "Can’t connect with server",
          }[state.kind]);
          const spinner = host.querySelector('tv-icon[name="spinner"][spinning]');
          expect(spinner !== null).toBe(state.kind === "connecting" || state.kind === "disconnected");
          if (state.kind === "connecting") expect(host.querySelector("p")).toBeNull();
          if (state.kind === "unauthorized") {
            expect(host.querySelector('tv-icon[name="locked"]')).not.toBeNull();
            expect(host.textContent).toContain({
              browser: "paste the whole link into the address bar",
              desktop: "Choose Television › Disconnect from Server",
              local: "Disconnect from Server, then paste the current link",
            }[context]);
          }
          if (state.kind === "error") {
            expect(host.querySelector("tv-icon")).toBeNull();
            expect(host.querySelector(".server-url")?.textContent).toBe(SERVER_URL);
            expect(host.textContent).toContain("Check your internet connection and that the server is running.");
          }
          if (state.kind === "error" || state.kind === "disconnected") {
            expect(host.textContent).toContain(state.nextRetryAt === null ? "Reconnecting now…" : "Reconnecting in 5s…");
          }
          const button = host.querySelector<HTMLButtonElement>("button");
          const offersDisconnect = context === "local" && (state.kind === "unauthorized" || state.kind === "error");
          expect(button !== null).toBe(offersDisconnect);
          disconnect.mockClear();
          if (offersDisconnect) {
            expect(button?.getAttribute("intent")).toBe("danger");
            expect(button?.textContent?.trim()).toBe("Disconnect from Server");
            button!.click();
            expect(disconnect).toHaveBeenCalledOnce();
          }
        }
      }
      render(SystemModalView({ kind: "disconnected", nextRetryAt: 15_000 }, { context: "browser" }), host);
      await vi.advanceTimersByTimeAsync(1_000);
      expect(host.textContent).toContain("Reconnecting in 4s…");
      for (const update of [undefined, desktopUpdate]) {
        render(DesktopUpgradeGateView({ upgradeMarkdown: "# Channel upgrade" }, update), host);
        await flush();
        expect(host.querySelectorAll("dialog")).toHaveLength(1);
        expect(host.querySelector(".system-modal")).toBeNull();
        expect(host.textContent).toContain(update ? "The new version has already downloaded" : "Channel upgrade");
        expect(host.querySelector(".upgrade-gate-restart") !== null).toBe(Boolean(update));
      }
    } finally {
      render(null, host);
      vi.useRealTimers();
    }
  });
});

// Composition contract: posed prior-session and platform facts; native drag
// hit testing is covered by the Electron seam.
it("requests a desktop drag strip only over a bare background", async () => {
  const rows: Array<{ connection: Partial<ApplicationSnapshot["connection"]>; hasShell: boolean }> = [
    { connection: { status: "disconnected", hasEverConnected: true }, hasShell: true },
    { connection: { status: "disconnected", hasEverConnected: true, failedReconnectAttempts: 3 }, hasShell: true },
    { connection: { status: "disconnected", hasEverConnected: false }, hasShell: false },
    { connection: { status: "disconnected", hasEverConnected: false, firstConnectError: "offline" }, hasShell: false },
    { connection: { authorizationRequired: true }, hasShell: false },
    { connection: { gateHalted: true }, hasShell: false },
  ];
  for (const electronMode of [false, true]) {
    for (const collapsed of [false, true]) {
      const host = createApplicationHost();
      const application = new FakeApplication(applicationSnapshot());
      render(TelevisionAppView(application as never, {
        serverURL: SERVER_URL, electronMode,
        sidebarWidthPreference: SIDEBAR_WIDTH_PREFERENCE,
        sidebarCollapsedPreference: collapsedPreference(collapsed),
      }), host);
      for (const { connection, hasShell } of rows) {
        application.setSnapshot(applicationSnapshot({ connection }));
        await flush();
        expect(host.querySelectorAll(".app-main")).toHaveLength(hasShell ? 1 : 0);
        expect(host.querySelectorAll(".window-drag-strip")).toHaveLength(electronMode && !hasShell ? 1 : 0);
        expect(host.querySelectorAll("dialog")).toHaveLength(1);
        if (connection.authorizationRequired) {
          expect(host.textContent).toContain(electronMode ? "Choose Television › Disconnect from Server" : "paste the whole link into the address bar");
        }
      }
    }
  }
});

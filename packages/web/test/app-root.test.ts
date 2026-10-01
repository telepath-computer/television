// @vitest-environment jsdom

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
  type SystemModalApplication,
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
      authorizationRejected: false,
      gateHalted: false,
      status: "connected",
      hasEverConnected: true,
      firstConnectError: null,
      nextRetryAt: null,
      upgradeInstructions: null,
      ...connectionOverrides,
    },
  };
}

class FakeApplication extends EventTarget implements SystemModalApplication {
  snapshot: ApplicationSnapshot;
  authenticate = vi.fn(async (_token: string) => undefined);
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
      runtimeServerURL: SERVER_URL,
      electronMode: false,
      primaryServerURL: SERVER_URL,
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
      rejectionAlert?: boolean;
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
        name: "authorization outranks gate, prior session, and error",
        snapshot: applicationSnapshot({
          connection: {
            authorizationRequired: true,
            authorizationRejected: true,
            gateHalted: true,
            status: "disconnected",
            hasEverConnected: true,
            firstConnectError: "offline",
          },
        }),
        state: "unauthorized",
        rejectionAlert: true,
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
      expect(app.querySelectorAll(":scope > #app > .system-modal-host"), row.name).toHaveLength(
        ["connected", "no-channel", "empty-channel"].includes(row.state) ? 0 : 1,
      );
      if (row.rejectionAlert !== undefined) {
        expect(app.querySelector('[role="alert"]') !== null, row.name).toBe(row.rejectionAlert);
      }
    }
  });
});

describe("root shell composition and readiness (^ap-ac-markup-smoke)", () => {
  it("commits each shell state before reporting render complete", async () => {
    const application = new FakeApplication(applicationSnapshot());
    const app = createApplicationHost();

    const committedStates: string[] = [];
    render(TelevisionAppView(application as never, {
      runtimeServerURL: SERVER_URL,
      electronMode: false,
      primaryServerURL: SERVER_URL,
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
      expect(app.querySelectorAll(":scope > #app > .system-modal-host")).toHaveLength(modal ? 1 : 0);
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
        runtimeServerURL: SERVER_URL,
        electronMode: false,
        primaryServerURL: SERVER_URL,
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
      runtimeServerURL: SERVER_URL,
      electronMode: false,
      primaryServerURL: SERVER_URL,
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
      runtimeServerURL: SERVER_URL,
      electronMode: false,
      primaryServerURL: SERVER_URL,
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
  it("renders each selected interrupting surface and no other", async () => {
    const application = new FakeApplication(applicationSnapshot());
    const host = document.createElement("main");
    document.body.append(host);
    const draw = (state: SystemModalState, desktopUpdate?: DesktopUpdateState) =>
      render(SystemModalView(state, application, desktopUpdate), host);
    const downloadedBridge = new StandInDesktopUpdateBridge();
    downloadedBridge.report("1.5.0");

    const rows: Array<{
      name: string;
      state: SystemModalState;
      desktopUpdate?: DesktopUpdateState;
      assert: () => void;
    }> = [
      {
        name: "connecting",
        state: { kind: "connecting" },
        assert: () => {
          expect(host.querySelector('tv-icon[name="spinner"][spinning]')).not.toBeNull();
          expect(host.querySelector("h2")?.textContent).toBe("Connecting");
          expect(host.querySelector(".system-modal > p")).toBeNull();
        },
      },
      {
        name: "disconnected countdown",
        state: { kind: "disconnected", nextRetryAt: Date.now() + 5_000 },
        assert: () => {
          expect(host.querySelector('tv-icon[name="spinner"][spinning]')).not.toBeNull();
          expect(host.querySelector("h2")?.textContent).toBe("Disconnected");
          expect(host.querySelector(".system-modal > p")?.textContent).toMatch(/^Reattempting in \d+s…$/);
        },
      },
      {
        name: "disconnected attempt in flight",
        state: { kind: "disconnected", nextRetryAt: null },
        assert: () => {
          expect(host.querySelector(".system-modal > p")?.textContent).toBe("Reattempting now…");
        },
      },
      {
        name: "authorization",
        state: { kind: "unauthorized" },
        assert: () => {
          expect(host.querySelector('tv-icon[name="locked"]')).not.toBeNull();
          expect(host.querySelector("h2")?.textContent).toBe("Enter access token");
          expect(host.textContent).toContain("This server requires an access token to connect.");
          const input = host.querySelector<HTMLInputElement>('input[name="token"]');
          expect(input?.type).toBe("password");
          expect(input?.required).toBe(true);
          expect(input?.getAttribute("aria-label")).toBe("Access token");
          expect(input?.hasAttribute("aria-invalid")).toBe(false);
          expect(input?.hasAttribute("aria-describedby")).toBe(false);
          expect(host.querySelector("button")?.textContent?.trim()).toBe("Connect");
          expect(host.querySelector('[role="alert"]')).toBeNull();
        },
      },
      {
        name: "rejected authorization",
        state: { kind: "unauthorized", invalid: true },
        assert: () => {
          const input = host.querySelector<HTMLInputElement>('input[name="token"]');
          expect(input?.value).toBe("");
          expect(input?.getAttribute("aria-invalid")).toBe("true");
          expect(input?.getAttribute("aria-describedby")).toBe("auth-token-error");
          expect(host.querySelector("#auth-token-error")?.classList.contains("tv-error")).toBe(true);
          expect(host.querySelector('[role="alert"]')?.textContent).toContain(
            "The previous token was rejected. Try again.",
          );
        },
      },
      {
        name: "first-connect error",
        state: { kind: "error", serverURL: SERVER_URL, message: "Connection refused" },
        assert: () => {
          expect(host.querySelector("h2")?.textContent).toBe("Can’t connect with server");
          expect(host.querySelector(".server-url")?.textContent).toBe(SERVER_URL);
          expect(host.textContent).toContain("Connection refused");
        },
      },
      {
        name: "desktop upgrade",
        state: {
          kind: "needs-upgrade",
          instructions: { upgradeMarkdown: "# Channel upgrade\n\nRun the channel command." },
        },
        assert: () => {
          expect(host.querySelector(".desktop-upgrade-gate")).not.toBeNull();
          expect(host.querySelector(".system-modal")).toBeNull();
          expect(host.querySelector(".desktop-upgrade-gate")?.textContent).toContain("Channel upgrade");
          expect(host.querySelector(".upgrade-gate-restart")).toBeNull();
        },
      },
      {
        name: "desktop upgrade with a downloaded update",
        state: {
          kind: "needs-upgrade",
          instructions: { upgradeMarkdown: "# Channel upgrade\n\nRun the channel command." },
        },
        desktopUpdate: new DesktopUpdateState({ electron: true, bridge: downloadedBridge }),
        assert: () => {
          expect(host.querySelector(".system-modal")).toBeNull();
          expect(host.querySelector(".desktop-upgrade-gate")?.textContent).toContain("The new version has already downloaded");
          expect(host.querySelector(".desktop-upgrade-gate")?.textContent).not.toContain("Channel upgrade");
          expect(host.querySelector(".upgrade-gate-restart")?.textContent?.trim()).toBe("Restart to update");
        },
      },
    ];

    for (const row of rows) {
      draw(row.state, row.desktopUpdate);
      await flush();
      expect(host.querySelectorAll(":scope > .system-modal-host"), row.name).toHaveLength(1);
      expect(host.querySelectorAll("dialog"), row.name).toHaveLength(1);
      row.assert();
    }
  });
});

describe("system-modal token submission (^sm-ac-auth-submit)", () => {
  it("refuses blank values, authenticates entered tokens, and clears a rejected token", async () => {
    const application = new FakeApplication(applicationSnapshot());
    const host = document.createElement("main");
    document.body.append(host);
    const draw = (state: SystemModalState) => render(SystemModalView(state, application), host);

    draw({ kind: "unauthorized" });
    await flush();
    const input = host.querySelector<HTMLInputElement>('input[name="token"]')!;
    input.value = "   ";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.form!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    expect(application.authenticate).not.toHaveBeenCalled();

    input.value = "  first-token  ";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.form!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    expect(application.authenticate).toHaveBeenCalledTimes(1);
    expect(application.authenticate).toHaveBeenLastCalledWith("first-token");
    expect(host.querySelector('[role="alert"]')).toBeNull();

    // Submission and an in-flight reconnect do not imply rejection.
    draw({ kind: "connecting" });
    draw({ kind: "unauthorized" });
    await flush();
    expect(host.querySelector<HTMLInputElement>('input[name="token"]')?.value).toBe("  first-token  ");
    expect(host.querySelector('[role="alert"]')).toBeNull();

    // The application state explicitly reports rejection before the view
    // clears the rejected token and offers a replacement.
    draw({ kind: "unauthorized", invalid: true });
    await flush();
    const replacement = host.querySelector<HTMLInputElement>('input[name="token"]')!;
    expect(replacement.value).toBe("");
    expect(host.querySelector('[role="alert"]')).not.toBeNull();

    replacement.value = "replacement-token";
    replacement.dispatchEvent(new Event("input", { bubbles: true }));
    replacement.form!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    expect(application.authenticate).toHaveBeenCalledTimes(2);
    expect(application.authenticate).toHaveBeenLastCalledWith("replacement-token");

    draw({ kind: "unauthorized" });
    await flush();
    const fresh = host.querySelector<HTMLInputElement>('input[name="token"]')!;
    expect(fresh.hasAttribute("aria-invalid")).toBe(false);
    expect(fresh.hasAttribute("aria-describedby")).toBe(false);
    expect(host.querySelector("#auth-token-error")).toBeNull();
  });
});

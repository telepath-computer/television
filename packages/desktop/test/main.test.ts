import { statSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DESKTOP_UPDATE_DOWNLOADED_CHANNEL,
  GET_DESKTOP_UPDATE_CHANNEL,
  RESTART_TO_INSTALL_UPDATE_CHANNEL,
} from "../src/desktop-update.ts";

type BrowserWindowOptions = {
  title?: string;
  icon?: string;
  minWidth?: number;
  minHeight?: number;
  titleBarStyle?: string;
  trafficLightPosition?: { x: number; y: number };
  webPreferences?: {
    contextIsolation?: boolean;
    preload?: string;
  };
};

type WindowOpenHandler = (details: { url: string }) => { action: "allow" | "deny" };
type IpcHandler = (event: unknown, ...args: unknown[]) => unknown;
type IpcListener = (event: {
  sender: {
    getType(): string;
    getURL(): string;
    hostWebContents?: { getURL(): string } | null;
  };
}, ...args: unknown[]) => void;
type BeforeInputEventHandler = (
  event: { preventDefault(): void },
  input: {
    type: string;
    key: string;
    isAutoRepeat: boolean;
    isComposing: boolean;
    shift: boolean;
    control: boolean;
    alt: boolean;
    meta: boolean;
  },
) => void;

const mockState = vi.hoisted(() => {
  const onceHandlers = new Map<string, () => void>();
  const appHandlers = new Map<string, (...args: unknown[]) => void>();
  const ipcHandlers = new Map<string, IpcHandler>();
  const ipcListeners = new Map<string, IpcListener>();
  let autoEmitReadyToShowOnLoad = false;

  class MockBrowserWindow {
    static instances: MockBrowserWindow[] = [];
    options: BrowserWindowOptions;
    loadURL = vi.fn(async (_url: string) => {
      if (autoEmitReadyToShowOnLoad) this.emitOnce("ready-to-show");
    });
    loadFile = vi.fn(async (_file: string) => {
      if (autoEmitReadyToShowOnLoad) this.emitOnce("ready-to-show");
    });
    show = vi.fn();
    webContents = { on: vi.fn(), send: vi.fn() };

    constructor(options: BrowserWindowOptions) {
      this.options = options;
      MockBrowserWindow.instances.push(this);
    }

    once(event: string, handler: () => void): void {
      onceHandlers.set(event, handler);
    }

    on(_event: string, _handler: () => void): void {}

    emitOnce(event: string): void {
      const handler = onceHandlers.get(event);
      if (handler) handler();
    }

    static getAllWindows(): MockBrowserWindow[] {
      return MockBrowserWindow.instances;
    }
  }

  // Every app call and the update runtime's start, in the order they happen.
  const callOrder: string[] = [];
  const recorded = <Args extends unknown[], Result>(name: string, implementation: (...args: Args) => Result) =>
    vi.fn((...args: Args) => {
      callOrder.push(name);
      return implementation(...args);
    });
  const app = {
    name: "Television",
    setName: recorded("app.setName", (_name: string) => {}),
    whenReady: recorded("app.whenReady", async () => {}),
    getPath: recorded("app.getPath", (_name: string) => "/tmp/television-test-userdata"),
    getVersion: recorded("app.getVersion", () => "0.1.170"),
    setAboutPanelOptions: recorded("app.setAboutPanelOptions", (_options: unknown) => {}),
    on: recorded("app.on", (event: string, handler: (...args: unknown[]) => void) => {
      appHandlers.set(event, handler);
    }),
    quit: recorded("app.quit", () => {}),
  };
  const autoUpdaterListeners = new Map<string, (payload: unknown) => void>();
  const runtime = {
    init: recorded("runtime.init", (..._args: unknown[]) => {}),
    autoUpdater: {
      on: vi.fn((event: string, listener: (payload: unknown) => void) => {
        autoUpdaterListeners.set(event, listener);
      }),
      restartAndInstall: vi.fn((..._args: unknown[]) => {}),
    },
  };
  const Menu = {
    buildFromTemplate: vi.fn((template: unknown) => template),
    setApplicationMenu: vi.fn(),
  };
  const ipcMain = {
    handle: vi.fn((channel: string, handler: IpcHandler) => {
      ipcHandlers.set(channel, handler);
    }),
    on: vi.fn((channel: string, listener: IpcListener) => {
      ipcListeners.set(channel, listener);
    }),
  };
  const nativeTheme = { themeSource: "system" };
  const shell = {
    openExternal: vi.fn(async (_url: string) => {}),
  };

  return {
    callOrder,
    runtime,
    autoUpdaterListeners,
    MockBrowserWindow,
    app,
    Menu,
    ipcMain,
    nativeTheme,
    shell,
    appHandlers,
    ipcHandlers,
    ipcListeners,
    setAutoEmitReadyToShowOnLoad: (value: boolean) => {
      autoEmitReadyToShowOnLoad = value;
    },
  };
});

// Declared mock: records the update runtime's start and forfeits what the
// runtime does to the product's update path (proofs/product/desktop-app.md).
vi.mock("@todesktop/runtime", () => ({ default: mockState.runtime }));

vi.mock("electron", () => ({
  app: mockState.app,
  BrowserWindow: mockState.MockBrowserWindow,
  Menu: mockState.Menu,
  ipcMain: mockState.ipcMain,
  nativeTheme: mockState.nativeTheme,
  shell: mockState.shell,
}));

const fsState = vi.hoisted(() => {
  const files = new Map<string, string>();
  return {
    files,
    reset: () => files.clear(),
  };
});

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    existsSync: (path: string) => fsState.files.has(path),
    readFileSync: (path: string) => {
      const content = fsState.files.get(path);
      if (content === undefined) throw new Error(`ENOENT: ${path}`);
      return content;
    },
    writeFileSync: (path: string, content: string) => {
      fsState.files.set(path, content);
    },
    renameSync: (oldPath: string, newPath: string) => {
      const content = fsState.files.get(oldPath);
      if (content === undefined) throw new Error(`ENOENT: ${oldPath}`);
      fsState.files.set(newPath, content);
      fsState.files.delete(oldPath);
    },
  };
});

describe("Electron main process", () => {
  const fetchMock = vi.fn<typeof fetch>();
  const connectCheckBody = {
    product: "television",
    additiveFutureIdentity: { tolerated: true },
  };

  beforeEach(() => {
    mockState.MockBrowserWindow.instances.length = 0;
    mockState.appHandlers.clear();
    mockState.ipcHandlers.clear();
    mockState.ipcListeners.clear();
    mockState.nativeTheme.themeSource = "dark";
    mockState.setAutoEmitReadyToShowOnLoad(false);
    mockState.app.on.mockClear();
    mockState.app.whenReady.mockClear();
    mockState.app.whenReady.mockImplementation(async () => {});
    mockState.app.getVersion.mockClear();
    mockState.app.setAboutPanelOptions.mockClear();
    mockState.ipcMain.handle.mockClear();
    mockState.ipcMain.on.mockClear();
    mockState.shell.openExternal.mockClear();
    mockState.autoUpdaterListeners.clear();
    mockState.runtime.autoUpdater.restartAndInstall.mockClear();
    mockState.Menu.buildFromTemplate.mockClear();
    mockState.Menu.setApplicationMenu.mockClear();
    fsState.reset();
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(new Response(JSON.stringify(connectCheckBody), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    vi.resetModules();
  });

  afterEach(() => {
    fsState.reset();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  async function loadAppModule() {
    return await import("@telepath-computer/television-desktop");
  }

  // proofs/arch/desktop/updates.md#^desktop-updates-t-start
  it("starts the update runtime once, with only its notification turned off, straight after naming the app", async () => {
    mockState.callOrder.length = 0;
    mockState.runtime.init.mockClear();

    await loadAppModule();

    expect(mockState.runtime.init).toHaveBeenCalledTimes(1);
    expect(mockState.runtime.init.mock.calls[0]).toEqual([
      { updateReadyAction: { showNotification: "never" } },
    ]);
    expect(mockState.app.setName).toHaveBeenCalledWith("Television");
    const nameIndex = mockState.callOrder.indexOf("app.setName");
    expect(nameIndex).toBeGreaterThanOrEqual(0);
    expect(mockState.callOrder.slice(nameIndex, nameIndex + 2)).toEqual(["app.setName", "runtime.init"]);
  });

  function downloadedEvent(version: string | undefined): unknown {
    return {
      disableUpdateReadyAction: false,
      sources: ["auto-check-on-interval"],
      updateInfo: version === undefined ? null : { version, releaseDate: "2026-09-26T00:00:00.000Z" },
    };
  }

  const restartEvent = {
    sender: {
      getType: () => "window",
      getURL: () => "https://television.test/app",
    },
  };

  // proofs/arch/desktop/updates.md#^desktop-updates-t-record
  it("records the runtime's downloaded update, reports each new version to the window, and restarts only with a record", async () => {
    vi.stubEnv("TV_TEST_MODE", "");
    const main = await loadAppModule();
    await new main.App().start();

    const win = mockState.MockBrowserWindow.instances[0]!;
    const getUpdate = mockState.ipcHandlers.get(GET_DESKTOP_UPDATE_CHANNEL);
    const restart = mockState.ipcListeners.get(RESTART_TO_INSTALL_UPDATE_CHANNEL);
    const downloaded = mockState.autoUpdaterListeners.get("update-downloaded");
    if (!getUpdate || !restart || !downloaded) throw new Error("desktop update wiring was not registered");
    const reported = () =>
      win.webContents.send.mock.calls.filter(([channel]) => channel === DESKTOP_UPDATE_DOWNLOADED_CHANNEL);
    const restartAndInstall = mockState.runtime.autoUpdater.restartAndInstall;

    expect(await getUpdate({})).toBeNull();
    restart(restartEvent);
    expect(restartAndInstall).not.toHaveBeenCalled();

    downloaded(downloadedEvent("1.5.0"));
    expect(await getUpdate({})).toBe("1.5.0");
    expect(reported()).toEqual([[DESKTOP_UPDATE_DOWNLOADED_CHANNEL, "1.5.0"]]);

    // The runtime re-emits after every later check while the update waits.
    downloaded(downloadedEvent("1.5.0"));
    downloaded(downloadedEvent(undefined));
    expect(reported()).toHaveLength(1);
    expect(await getUpdate({})).toBe("1.5.0");

    downloaded(downloadedEvent("1.6.0"));
    expect(await getUpdate({})).toBe("1.6.0");
    expect(reported()).toEqual([
      [DESKTOP_UPDATE_DOWNLOADED_CHANNEL, "1.5.0"],
      [DESKTOP_UPDATE_DOWNLOADED_CHANNEL, "1.6.0"],
    ]);

    restart(restartEvent);
    expect(restartAndInstall).toHaveBeenCalledTimes(1);
    expect(restartAndInstall).toHaveBeenCalledWith();
  });

  // proofs/arch/desktop/updates.md#^desktop-updates-t-record
  it("records a restart for the test instead of calling the runtime in test mode", async () => {
    vi.stubEnv("TV_TEST_MODE", "true");
    const globalState = globalThis as typeof globalThis & { __televisionRestartToInstallLog?: string[] };
    delete globalState.__televisionRestartToInstallLog;
    const main = await loadAppModule();
    await new main.App().start();

    mockState.autoUpdaterListeners.get("update-downloaded")!(downloadedEvent("1.5.0"));
    mockState.ipcListeners.get(RESTART_TO_INSTALL_UPDATE_CHANNEL)!(restartEvent);

    expect(mockState.runtime.autoUpdater.restartAndInstall).not.toHaveBeenCalled();
    expect(globalState.__televisionRestartToInstallLog).toEqual(["1.5.0"]);
    delete globalState.__televisionRestartToInstallLog;
  });

  it("creates BrowserWindow with contextIsolation and the connect preload", async () => {
    const main = await loadAppModule();
    await new main.App().start();

    expect(mockState.MockBrowserWindow.instances).toHaveLength(1);
    const win = mockState.MockBrowserWindow.instances[0];
    expect(win.options.webPreferences?.contextIsolation).toBe(true);
    expect(win.options.webPreferences?.preload).toMatch(/connect-preload\.cjs$/);
  });

  it("starts native appearance at system and accepts only valid IPC values", async () => {
    const main = await loadAppModule();
    await new main.App().start();

    expect(mockState.nativeTheme.themeSource).toBe("system");
    const listener = mockState.ipcListeners.get("television:set-appearance-mode");
    expect(listener).toBeDefined();
    const event = {
      sender: {
        getType: () => "window",
        getURL: () => "https://television.test/app",
      },
    };

    for (const mode of ["light", "dark", "system"] as const) {
      listener!(event, mode);
      expect(mockState.nativeTheme.themeSource).toBe(mode);
    }
    for (const invalid of ["sepia", null, 1, {}]) {
      listener!(event, invalid);
      expect(mockState.nativeTheme.themeSource).toBe("system");
    }
  });

  // proofs/arch/desktop/index.md#^desktop-t-window-identity
  it("creates BrowserWindow with Television title and the packaged icon", async () => {
    const main = await loadAppModule();
    await new main.App().start();

    const expectedIcon = path.resolve(import.meta.dirname, "../assets/icon.png");
    const win = mockState.MockBrowserWindow.instances[0];
    expect({ title: win.options.title, icon: win.options.icon }).toEqual({
      title: "Television",
      icon: expectedIcon,
    });
    expect(statSync(expectedIcon).size).toBeGreaterThan(0);
  });

  it("creates BrowserWindow with the authoritative window minimum", async () => {
    const main = await loadAppModule();
    await new main.App().start();

    const win = mockState.MockBrowserWindow.instances[0];
    expect({ minWidth: win.options.minWidth, minHeight: win.options.minHeight }).toEqual({
      minWidth: 500,
      minHeight: 500,
    });
  });

  it("creates the hidden titlebar at the authored traffic-light position", async () => {
    const main = await loadAppModule();
    await new main.App().start();

    const win = mockState.MockBrowserWindow.instances[0];
    expect({
      titleBarStyle: win.options.titleBarStyle,
      trafficLightPosition: win.options.trafficLightPosition,
    }).toEqual({
      titleBarStyle: "hidden",
      trafficLightPosition: { x: 15, y: 15 },
    });
  });

  it("sets the webview preload and explicitly disables webview contextIsolation", async () => {
    const main = await loadAppModule();
    await new main.App().start();

    const win = mockState.MockBrowserWindow.instances[0];
    const call = win.webContents.on.mock.calls.find(([event]) => event === "will-attach-webview");
    expect(call).toBeDefined();
    const handler = call![1] as (event: unknown, webPreferences: BrowserWindowOptions["webPreferences"]) => void;
    const webPreferences: BrowserWindowOptions["webPreferences"] = {};

    handler({}, webPreferences);

    expect(webPreferences.preload).toMatch(/webview-bridge-preload\.cjs$/);
    expect(webPreferences.contextIsolation).toBe(false);
  });

  it("consumes a matching webview chord and sends its arrow once to the embedding renderer", async () => {
    const main = await loadAppModule();
    await new main.App().start();

    const createdHandler = mockState.appHandlers.get("web-contents-created");
    expect(createdHandler).toBeDefined();
    const hostSend = vi.fn();
    const guestOn = vi.fn();
    const guest = {
      getType: () => "webview",
      hostWebContents: { send: hostSend },
      on: guestOn,
      setWindowOpenHandler: vi.fn(),
    };
    createdHandler!({}, guest);

    const call = guestOn.mock.calls.find(([event]) => event === "before-input-event");
    expect(call).toBeDefined();
    const handler = call![1] as BeforeInputEventHandler;
    const event = { preventDefault: vi.fn() };
    handler(event, {
      type: "keyDown",
      key: "ArrowRight",
      isAutoRepeat: false,
      isComposing: false,
      shift: false,
      control: process.platform !== "darwin",
      alt: process.platform === "darwin",
      meta: false,
    });

    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(hostSend).toHaveBeenCalledOnce();
    expect(hostSend).toHaveBeenCalledWith("television:navigation-key", "ArrowRight");
  });

  // spec: proofs/arch/artifact-frame/artifact-bridge.md#^ab-ac-application-link-main
  it("blocks non-web main-frame navigation but leaves browser-local subframes native", async () => {
    const main = await loadAppModule();
    await new main.App().start();

    const createdHandler = mockState.appHandlers.get("web-contents-created");
    const guestOn = vi.fn();
    createdHandler!({}, {
      getType: () => "webview",
      hostWebContents: { send: vi.fn() },
      on: guestOn,
      setWindowOpenHandler: vi.fn(),
    });
    const call = guestOn.mock.calls.find(([event]) => event === "will-frame-navigate");
    expect(call).toBeDefined();
    const handler = call![1] as (event: { url: string; isMainFrame: boolean; preventDefault(): void }) => void;

    for (const url of [
      "example-app://open/item",
      "javascript:document.body.textContent='owned'",
      "file:///tmp/note.html",
    ]) {
      const event = { url, isMainFrame: true, preventDefault: vi.fn() };
      handler(event);
      expect(event.preventDefault).toHaveBeenCalledOnce();
    }
    const web = { url: "https://example.com", isMainFrame: true, preventDefault: vi.fn() };
    handler(web);
    expect(web.preventDefault).not.toHaveBeenCalled();

    for (const url of [
      "about:srcdoc",
      "about:blank",
      "data:text/html,nested",
      "blob:https://television.test/id",
    ]) {
      const event = { url, isMainFrame: false, preventDefault: vi.fn() };
      handler(event);
      expect(event.preventDefault).not.toHaveBeenCalled();
    }
    const applicationSubframe = {
      url: "example-app://open/from-subframe",
      isMainFrame: false,
      preventDefault: vi.fn(),
    };
    handler(applicationSubframe);
    expect(applicationSubframe.preventDefault).toHaveBeenCalledOnce();
  });

  it("does not attach native navigation before a webview has a host", async () => {
    const main = await loadAppModule();
    await new main.App().start();

    const createdHandler = mockState.appHandlers.get("web-contents-created");
    const guestOn = vi.fn();
    createdHandler!({}, {
      getType: () => "webview",
      hostWebContents: null,
      on: guestOn,
      setWindowOpenHandler: vi.fn(),
    });

    expect(guestOn).not.toHaveBeenCalledWith("before-input-event", expect.any(Function));
  });

  it("leaves BrowserWindow input to the renderer shell handler", async () => {
    const main = await loadAppModule();
    await new main.App().start();

    const createdHandler = mockState.appHandlers.get("web-contents-created");
    const windowOn = vi.fn();
    createdHandler!({}, {
      getType: () => "window",
      on: windowOn,
      setWindowOpenHandler: vi.fn(),
    });

    expect(windowOn).not.toHaveBeenCalledWith("before-input-event", expect.any(Function));
  });

  it("loads the connect screen when no connection is saved", async () => {
    const main = await loadAppModule();
    await new main.App().start();

    const win = mockState.MockBrowserWindow.instances[0];
    expect(win.loadFile).toHaveBeenCalledTimes(1);
    expect(win.loadFile).toHaveBeenCalledWith(expect.stringMatching(/connect\.html$/));
    expect(win.loadURL).not.toHaveBeenCalled();
  });

  // Spec: ^updates-t-preflight-desktop-contract
  it("connect IPC accepts additive connect-check JSON, saves normalized fields, and loads the versioned remote URL", async () => {
    const main = await loadAppModule();
    await new main.App().start();
    mockState.app.getVersion.mockClear();

    const win = mockState.MockBrowserWindow.instances[0];
    win.loadFile.mockClear();
    win.loadURL.mockClear();

    const handler = mockState.ipcHandlers.get("television:connect");
    expect(handler).toBeDefined();

    const result = await handler!({}, "localhost:32848/?token=abc123");
    expect(result).toMatchObject({ ok: true, attempt: expect.any(Number) });
    await mockState.ipcHandlers.get("television:complete-connect")!({}, (result as { attempt: number }).attempt);

    const saved = JSON.parse(fsState.files.get("/tmp/television-test-userdata/connection.json")!);
    expect(saved.serverURL).toBe("http://localhost:32848");
    expect(saved.token).toBe("abc123");
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:32848/desktop/connect-check?desktopAppVersion=0.1.170",
      expect.objectContaining({
        method: "GET",
        headers: { Authorization: "Bearer abc123" },
        signal: expect.any(AbortSignal),
      }),
    );
    expect(mockState.app.getVersion).toHaveBeenCalledTimes(1);
    expect(win.loadURL).toHaveBeenCalledTimes(1);
    const loaded = new URL(win.loadURL.mock.calls[0][0]);
    expect(loaded.protocol).toBe("http:");
    expect(loaded.host).toBe("localhost:32848");
    expect(loaded.searchParams.get("mode")).toBe("electron");
    expect(loaded.searchParams.get("token")).toBe("abc123");
    expect(loaded.searchParams.get("desktopAppVersion")).toBe("0.1.170");
  });

  it("connect IPC does not save submitted fields before URL validation", async () => {
    const main = await loadAppModule();
    await new main.App().start();

    const handler = mockState.ipcHandlers.get("television:connect");
    await expect(handler!({}, "not a url!!!")).resolves.toEqual({
      ok: false,
      message: "Enter a valid http or https URL",
    });

    expect(fsState.files.get("/tmp/television-test-userdata/connection.json")).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("connect IPC does not save submitted fields or loadURL when the connect check fails", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 }));

    const main = await loadAppModule();
    await new main.App().start();

    const win = mockState.MockBrowserWindow.instances[0];
    win.loadURL.mockClear();

    const handler = mockState.ipcHandlers.get("television:connect");
    await expect(handler!({}, "http://127.0.0.1:9")).resolves.toEqual({
      ok: false,
      message: "This link is missing an access token. Ask your agent for the current link.",
    });

    expect(fsState.files.get("/tmp/television-test-userdata/connection.json")).toBeUndefined();
    expect(win.loadURL).not.toHaveBeenCalled();
  });

  it("connect IPC loads remote URL without ?token= when token is empty", async () => {
    const main = await loadAppModule();
    await new main.App().start();

    const win = mockState.MockBrowserWindow.instances[0];
    win.loadURL.mockClear();

    const handler = mockState.ipcHandlers.get("television:connect");
    const result = await handler!({}, "https://tv.example.com") as { attempt: number };
    await mockState.ipcHandlers.get("television:complete-connect")!({}, result.attempt);

    const loaded = new URL(win.loadURL.mock.calls[0][0]);
    expect(loaded.searchParams.get("mode")).toBe("electron");
    expect(loaded.searchParams.has("token")).toBe(false);
  });

  it("shows the window once ready-to-show fires", async () => {
    mockState.setAutoEmitReadyToShowOnLoad(true);

    const main = await loadAppModule();
    await new main.App().start();

    const win = mockState.MockBrowserWindow.instances[0];
    expect(win.show).toHaveBeenCalledTimes(1);
  });

  // Proof: [[arch/desktop/index.md#^desktop-t-about-version|About-panel version configuration]].
  it("configures the macOS About panel before installing the application menu", async () => {
    mockState.app.getVersion.mockReturnValueOnce("1.3.1");
    const main = await loadAppModule();
    const platform = Object.getOwnPropertyDescriptor(process, "platform");
    Object.defineProperty(process, "platform", { ...platform, value: "darwin" });

    try {
      await new main.App().start();
    } finally {
      Object.defineProperty(process, "platform", platform!);
    }

    expect(mockState.app.setAboutPanelOptions).toHaveBeenCalledWith({
      applicationVersion: "1.3.1",
      version: "",
    });
    expect(mockState.app.setAboutPanelOptions.mock.invocationCallOrder[0]).toBeLessThan(
      mockState.Menu.setApplicationMenu.mock.invocationCallOrder[0],
    );
  });

  it("registers a Disconnect from Server menu item", async () => {
    const main = await loadAppModule();
    await new main.App().start();

    expect(mockState.Menu.setApplicationMenu).toHaveBeenCalledTimes(1);
    const template = mockState.Menu.buildFromTemplate.mock.calls[0][0] as Array<{
      submenu?: Array<{ label?: string }>;
    }>;
    const labels = template.flatMap((item) => item.submenu?.map((sub) => sub.label) ?? []);
    expect(labels).toContain("Disconnect from Server");
  });

  it("routes webContents window-open URLs to shell.openExternal", async () => {
    const main = await loadAppModule();
    await new main.App().start();

    const createdHandler = mockState.appHandlers.get("web-contents-created");
    expect(createdHandler).toBeDefined();
    const setWindowOpenHandler = vi.fn();
    createdHandler!({}, { getType: () => "window", setWindowOpenHandler });

    expect(setWindowOpenHandler).toHaveBeenCalledTimes(1);
    const handler = setWindowOpenHandler.mock.calls[0][0] as WindowOpenHandler;
    expect(handler({ url: "https://example.com/page" })).toEqual({ action: "deny" });
    expect(mockState.shell.openExternal).toHaveBeenCalledWith("https://example.com/page");

    mockState.shell.openExternal.mockClear();
    expect(handler({ url: "example-app://open/item" })).toEqual({ action: "deny" });
    expect(mockState.shell.openExternal).not.toHaveBeenCalled();
  });

  // spec: proofs/arch/artifact-frame/artifact-bridge.md#^ab-ac-application-link-main
  it("opens application-link IPC only from connected-origin webviews", async () => {
    const main = await loadAppModule();
    await new main.App().start();

    const listener = mockState.ipcListeners.get("television:open-application-link");
    expect(listener).toBeDefined();
    const eventFrom = (
      type: string,
      senderURL: string,
      hostURL = "https://television.test/app",
    ) => ({
      sender: {
        getType: () => type,
        getURL: () => senderURL,
        hostWebContents: { getURL: () => hostURL },
      },
    });
    const localWebviewEvent = eventFrom("webview", "https://television.test/artifact/id/index.html");

    listener!(localWebviewEvent, "example-app://open/item");
    expect(mockState.shell.openExternal).toHaveBeenCalledWith("example-app://open/item");

    mockState.shell.openExternal.mockClear();
    for (const denied of [
      "https://example.com",
      "javascript:document.body.textContent='owned'",
      "file:///tmp/note.html",
      "http://[",
    ]) {
      listener!(localWebviewEvent, denied);
    }
    for (const deniedSender of [
      eventFrom("window", "https://television.test/app"),
      eventFrom("webview", "https://third-party.test/page"),
      eventFrom("webview", "https://television.test.attacker.invalid/page"),
      eventFrom("webview", "about:blank"),
      eventFrom("webview", "file:///tmp/page.html", "file:///tmp/host.html"),
      { sender: { getType: () => "webview", getURL: () => "https://television.test/page", hostWebContents: null } },
    ]) {
      listener!(deniedSender, "example-app://open/item");
    }
    expect(mockState.shell.openExternal).not.toHaveBeenCalled();
  });

});

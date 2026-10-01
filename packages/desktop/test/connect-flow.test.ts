/**
 * End-to-end connect flow through main-process IPC + persistence + connect page API.
 * Exercises the scenarios a human would hit without launching Electron UI.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type IpcHandler = (event: unknown, ...args: unknown[]) => unknown;

const mockState = vi.hoisted(() => {
  class MockBrowserWindow {
    static instances: MockBrowserWindow[] = [];
    loadURL = vi.fn(async (_url: string) => {});
    loadFile = vi.fn(async () => {});
    show = vi.fn();
    webContents = { on: vi.fn(), send: vi.fn() };
    once = vi.fn();
    on = vi.fn();
    constructor() {
      MockBrowserWindow.instances.push(this);
    }
  }

  const ipcHandlers = new Map<string, IpcHandler>();
  return {
    MockBrowserWindow,
    ipcHandlers,
    app: {
      setName: vi.fn(),
      setAboutPanelOptions: vi.fn(),
      whenReady: vi.fn(async () => {}),
      getPath: vi.fn(() => "/tmp/television-connect-flow"),
      getVersion: vi.fn(() => "0.1.170"),
      on: vi.fn(),
    },
    Menu: { buildFromTemplate: vi.fn((t: unknown) => t), setApplicationMenu: vi.fn() },
    ipcMain: {
      handle: vi.fn((channel: string, handler: IpcHandler) => {
        ipcHandlers.set(channel, handler);
      }),
      on: vi.fn(),
    },
    shell: { openExternal: vi.fn() },
    nativeTheme: { themeSource: "system" },
  };
});

// Declared mock: the update runtime needs a real Electron app, which this test
// replaces; the runtime's start is covered in main.test.ts.
vi.mock("@todesktop/runtime", () => ({ default: { init: vi.fn() } }));

vi.mock("electron", () => ({
  app: mockState.app,
  BrowserWindow: mockState.MockBrowserWindow,
  Menu: mockState.Menu,
  ipcMain: mockState.ipcMain,
  shell: mockState.shell,
  nativeTheme: mockState.nativeTheme,
}));

const fsState = vi.hoisted(() => ({ files: new Map<string, string>() }));

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

describe("connect flow", () => {
  const fetchMock = vi.fn<typeof fetch>();
  const connectCheckBody = { product: "television", futureIdentityMember: true };
  const storePath = "/tmp/television-connect-flow/connection.json";

  beforeEach(() => {
    mockState.MockBrowserWindow.instances.length = 0;
    mockState.ipcHandlers.clear();
    mockState.Menu.buildFromTemplate.mockClear();
    fsState.files.clear();
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(new Response(JSON.stringify(connectCheckBody), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function startApp() {
    const main = await import("@telepath-computer/television-desktop");
    await new main.App().start();
    return main;
  }

  it("does not persist submitted fields when the connect check fails", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 }));
    fsState.files.set(storePath, JSON.stringify({ serverURL: "http://127.0.0.1:8", token: "old-token" }));
    await startApp();

    const connect = mockState.ipcHandlers.get("television:connect")!;
    await expect(connect({}, { serverURL: "http://127.0.0.1:9", token: "my-token" })).resolves.toEqual({
      ok: false,
      message: "Token rejected",
    });

    expect(JSON.parse(fsState.files.get(storePath)!)).toEqual({
      serverURL: "http://127.0.0.1:8",
      token: "old-token",
    });

    const getConnection = mockState.ipcHandlers.get("television:get-connection")!;
    await expect(getConnection({})).resolves.toEqual({
      serverURL: "http://127.0.0.1:8",
      token: "old-token",
    });
  });

  it("loads saved connections that do not have a token", async () => {
    fsState.files.set(storePath, JSON.stringify({ serverURL: "http://127.0.0.1:32848" }));
    await startApp();

    const getConnection = mockState.ipcHandlers.get("television:get-connection")!;
    await expect(getConnection({})).resolves.toEqual({
      serverURL: "http://127.0.0.1:32848",
      token: "",
    });
  });

  it("simulates app restart: saved token preloads via get-connection then bootstrap can reconnect", async () => {
    fsState.files.set(
      storePath,
      JSON.stringify({ serverURL: "http://127.0.0.1:32848", token: "restart-token" }),
    );

    await startApp();

    const intent = mockState.ipcHandlers.get("television:get-connect-screen-intent")!;
    const getConnection = mockState.ipcHandlers.get("television:get-connection")!;
    expect(await intent({})).toBe("bootstrap");
    await expect(getConnection({})).resolves.toEqual({
      serverURL: "http://127.0.0.1:32848",
      token: "restart-token",
    });

    const connect = mockState.ipcHandlers.get("television:connect")!;
    await expect(connect({}, { serverURL: "http://127.0.0.1:32848", token: "restart-token" })).resolves.toEqual({
      ok: true,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:32848/desktop/connect-check?desktopAppVersion=0.1.170",
      expect.objectContaining({
        method: "GET",
        headers: { Authorization: "Bearer restart-token" },
      }),
    );
    const win = mockState.MockBrowserWindow.instances[0];
    expect(win.loadURL).toHaveBeenCalledTimes(1);
    const loaded = new URL(win.loadURL.mock.calls[0]![0]!);
    expect(loaded.searchParams.get("token")).toBe("restart-token");
    expect(loaded.searchParams.get("mode")).toBe("electron");
  });

  it("menu reopen uses manual intent so page layer must not auto-submit saved connection", async () => {
    fsState.files.set(storePath, JSON.stringify({ serverURL: "http://127.0.0.1:1", token: "tok" }));
    await startApp();

    const template = mockState.Menu.buildFromTemplate.mock.calls.at(-1)![0] as Array<{
      submenu?: Array<{ label?: string; click?: () => void }>;
    }>;
    const connectItem = template.flatMap((item) => item.submenu ?? []).find((s) => s.label === "Connect to server…");
    connectItem!.click!();

    const intent = mockState.ipcHandlers.get("television:get-connect-screen-intent")!;
    expect(await intent({})).toBe("manual");
    await expect(mockState.ipcHandlers.get("television:get-connection")!({})).resolves.toEqual({
      serverURL: "http://127.0.0.1:1",
      token: "tok",
    });
  });

  it("remote load failure returns to connect screen in manual mode", async () => {
    await startApp();
    const win = mockState.MockBrowserWindow.instances[0];
    const failLoad = win.webContents.on.mock.calls.find(([event]) => event === "did-fail-load")?.[1] as (
      event: unknown,
      code: number,
      desc: string,
      url: string,
      isMainFrame: boolean,
    ) => void;

    expect(failLoad).toBeDefined();
    win.loadFile.mockClear();
    failLoad({}, -1, "ERR_FAILED", "http://127.0.0.1:9/?mode=electron", true);

    expect(win.loadFile).toHaveBeenCalledWith(expect.stringMatching(/connect\.html$/));
    const intent = mockState.ipcHandlers.get("television:get-connect-screen-intent")!;
    expect(await intent({})).toBe("manual");
  });
});

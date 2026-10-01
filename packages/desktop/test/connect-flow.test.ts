/**
 * Main-process contracts with recording Electron/filesystem peers and controlled
 * fetch/timers. Real IPC, disk and navigation are crossed by desktop acceptance.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type IpcHandler = (event: unknown, ...args: unknown[]) => unknown;

const mockState = vi.hoisted(() => {
  class MockBrowserWindow {
    static instances: MockBrowserWindow[] = [];
    loadURL = vi.fn(async (_url: string) => {});
    loadFile = vi.fn(async () => {});
    show = vi.fn();
    webContents = { on: vi.fn(), send: vi.fn(), stop: vi.fn() };
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
    rmSync: (path: string) => fsState.files.delete(path),
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
    vi.useFakeTimers();
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
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  async function startApp() {
    const main = await import("@telepath-computer/television-desktop");
    await new main.App().start();
    return main;
  }

  function invoke(channel: string, ...args: unknown[]): Promise<any> {
    return Promise.resolve(mockState.ipcHandlers.get(`television:${channel}`)!({}, ...args));
  }

  function disconnectItem() {
    const template = mockState.Menu.buildFromTemplate.mock.calls.at(-1)![0] as Array<{
      submenu?: Array<{ label?: string; enabled?: boolean; accelerator?: string; click?: () => void }>;
    }>;
    return template.flatMap(item => item.submenu ?? []).find(item => item.label === "Disconnect from Server")!;
  }

  // proofs/arch/desktop/connect-flow.md#^desktop-t-connect-entry
  it("starts without a record in setup and saves a checked link before the Connected handoff", async () => {
    await startApp();
    expect(await invoke("get-connect-state")).toEqual({ kind: "setup" });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(disconnectItem()).toMatchObject({ enabled: false, accelerator: "CmdOrCtrl+," });
    const result = await invoke("connect", "https://example.test/path?token=a%2Bb&extra=1");
    expect(result).toMatchObject({ ok: true, attempt: expect.any(Number) });
    expect(JSON.parse(fsState.files.get(storePath)!)).toEqual({ serverURL: "https://example.test", token: "a+b" });
    expect(disconnectItem().enabled).toBe(true);
    const win = mockState.MockBrowserWindow.instances[0];
    expect(win.loadURL).not.toHaveBeenCalled();
    await invoke("complete-connect", result.attempt);
    expect(new URL(win.loadURL.mock.calls[0]![0]!).searchParams.get("token")).toBe("a+b");
  });

  it("keeps rejected setup links inline and a tokenless retry carries no previous token", async () => {
    await startApp();
    fetchMock.mockResolvedValueOnce(new Response("", { status: 401 }));
    expect(await invoke("connect", "http://example.test/?token=wrong")).toMatchObject({ ok: false, message: expect.stringMatching(/link/) });
    expect(await invoke("get-connect-state")).toEqual({ kind: "setup" });
    expect(fsState.files.has(storePath)).toBe(false);
    await invoke("connect", "http://example.test/anything");
    expect(fetchMock.mock.calls.at(-1)![1]!.headers).toEqual({});
    expect(JSON.parse(fsState.files.get(storePath)!)).toEqual({ serverURL: "http://example.test", token: "" });
  });

  it("starts saved records with Connecting then retries failures with backoff and stops on 401", async () => {
    fsState.files.set(storePath, JSON.stringify({ serverURL: "http://example.test", token: "saved" }));
    let resolveCheck!: (value: Response) => void;
    fetchMock.mockImplementationOnce(() => new Promise(resolve => { resolveCheck = resolve; }));
    await startApp();
    expect(await invoke("get-connect-state")).toEqual({ kind: "connecting", serverURL: "http://example.test" });
    expect(disconnectItem().enabled).toBe(true);
    resolveCheck(new Response("unavailable", { status: 503 }));
    await vi.advanceTimersByTimeAsync(0);
    const first = await invoke("get-connect-state");
    const firstDelay = first.nextRetryAt - Date.now();
    expect(first).toMatchObject({ kind: "error", nextRetryAt: expect.any(Number) });
    let retryCheck!: (value: Response) => void;
    fetchMock.mockImplementationOnce(() => new Promise(resolve => { retryCheck = resolve; }));
    await vi.advanceTimersByTimeAsync(first.nextRetryAt - Date.now());
    expect(await invoke("get-connect-state")).toMatchObject({ kind: "error", nextRetryAt: null });
    retryCheck(new Response("", { status: 503 }));
    await vi.advanceTimersByTimeAsync(0);
    const second = await invoke("get-connect-state");
    expect(second.nextRetryAt - Date.now()).toBeGreaterThan(firstDelay);
    fetchMock.mockResolvedValueOnce(new Response("", { status: 401 }));
    await vi.advanceTimersByTimeAsync(second.nextRetryAt - Date.now());
    expect(await invoke("get-connect-state")).toMatchObject({ kind: "unauthorized" });
    const calls = fetchMock.mock.calls.length;
    await vi.advanceTimersByTimeAsync(60000);
    expect(fetchMock).toHaveBeenCalledTimes(calls);
  });

  it("reconnects saved records automatically and treats malformed records as setup", async () => {
    fsState.files.set(storePath, "not json");
    await startApp();
    expect(await invoke("get-connect-state")).toEqual({ kind: "setup" });
    fsState.files.set(storePath, JSON.stringify({ serverURL: "http://example.test", token: "" }));
    fetchMock.mockResolvedValueOnce(new Response("", { status: 503 }));
    await startApp();
    await vi.advanceTimersByTimeAsync(0);
    const retry = await invoke("get-connect-state");
    expect(retry.kind).toBe("error");
    await vi.advanceTimersByTimeAsync(retry.nextRetryAt - Date.now());
    expect(mockState.MockBrowserWindow.instances.at(-1)!.loadURL).toHaveBeenCalledWith("http://example.test/?mode=electron&desktopAppVersion=0.1.170");
  });

  // proofs/arch/desktop/connect-flow.md#^desktop-t-disconnect
  it("disconnect cancels pending checks, retries and a successful setup handoff", async () => {
    fsState.files.set(storePath, JSON.stringify({ serverURL: "http://example.test", token: "secret" }));
    let resolveCheck!: (value: Response) => void;
    fetchMock.mockImplementationOnce(() => new Promise(resolve => { resolveCheck = resolve; }));
    await startApp();
    expect(disconnectItem().enabled).toBe(true);
    disconnectItem().click!();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock.mock.calls[0]![1]!.signal!.aborted).toBe(true);
    resolveCheck(new Response(JSON.stringify(connectCheckBody)));
    await vi.advanceTimersByTimeAsync(0);
    expect(fsState.files.has(storePath)).toBe(false);
    const win = mockState.MockBrowserWindow.instances[0];
    expect(win.loadURL).not.toHaveBeenCalled();
    const success = await invoke("connect", "http://example.test");
    disconnectItem().click!();
    await vi.advanceTimersByTimeAsync(0);
    await invoke("complete-connect", success.attempt);
    expect(win.loadURL).not.toHaveBeenCalled();
    expect(fsState.files.has(storePath)).toBe(false);
    expect(disconnectItem().enabled).toBe(false);
    expect(await invoke("get-connect-state")).toEqual({ kind: "setup" });

    fsState.files.set(storePath, JSON.stringify({ serverURL: "http://example.test", token: "" }));
    fetchMock.mockRejectedValue(new Error("unreachable"));
    await startApp();
    await vi.advanceTimersByTimeAsync(0);
    await invoke("disconnect");
    const calls = fetchMock.mock.calls.length;
    await vi.advanceTimersByTimeAsync(60000);
    expect(fetchMock).toHaveBeenCalledTimes(calls);
  });

  // proofs/arch/desktop/connect-flow.md#^desktop-t-connect-load-recovery
  it("only a genuine top-level remote load failure re-enters saved startup", async () => {
    fsState.files.set(storePath, JSON.stringify({ serverURL: "http://example.test", token: "" }));
    await startApp();
    await vi.advanceTimersByTimeAsync(0);
    const win = mockState.MockBrowserWindow.instances[0];
    const fail = win.webContents.on.mock.calls.find(([event]) => event === "did-fail-load")![1] as Function;
    win.loadFile.mockClear();
    fail({}, -3, "aborted", "http://example.test", true);
    fail({}, -2, "failed", "http://example.test", false);
    fail({}, -2, "failed", "file:///connect.html", true);
    expect(win.loadFile).not.toHaveBeenCalled();
    fetchMock.mockRejectedValue(new Error("offline"));
    fail({}, -2, "failed", "http://example.test", true);
    await vi.advanceTimersByTimeAsync(0);
    expect(win.loadFile).toHaveBeenCalledTimes(1);
    expect(await invoke("get-connect-state")).toMatchObject({ kind: "error", serverURL: "http://example.test" });
    expect(fsState.files.has(storePath)).toBe(true);
    const close = win.on.mock.calls.find(([event]) => event === "closed")![1] as Function;
    close();
    const calls = fetchMock.mock.calls.length;
    await vi.advanceTimersByTimeAsync(60000);
    expect(fetchMock).toHaveBeenCalledTimes(calls);
  });
});

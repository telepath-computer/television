// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SET_APPEARANCE_MODE_CHANNEL } from "../src/appearance-mode.ts";
import {
  DESKTOP_UPDATE_DOWNLOADED_CHANNEL,
  GET_DESKTOP_UPDATE_CHANNEL,
  RESTART_TO_INSTALL_UPDATE_CHANNEL,
} from "../src/desktop-update.ts";

const mocks = vi.hoisted(() => ({
  exposed: new Map<string, unknown>(),
  exposeInMainWorld: vi.fn((name: string, value: unknown) => {
    mocks.exposed.set(name, value);
  }),
  invoke: vi.fn(),
  on: vi.fn(),
  send: vi.fn(),
}));

vi.mock("electron", () => ({
  contextBridge: { exposeInMainWorld: mocks.exposeInMainWorld },
  ipcRenderer: {
    invoke: mocks.invoke,
    on: mocks.on,
    send: mocks.send,
  },
}));

interface NativeBridge {
  setAppearanceMode(mode: unknown): void;
  onDesktopUpdateDownloaded(callback: (version: string) => void): void;
  restartToInstallUpdate(): void;
}

describe("connect preload native appearance bridge", () => {
  beforeEach(async () => {
    vi.resetModules();
    mocks.exposed.clear();
    mocks.exposeInMainWorld.mockClear();
    mocks.invoke.mockClear();
    mocks.on.mockClear();
    mocks.send.mockClear();
    await import("../src/connect-preload.ts");
  });

  it.each(["system", "light", "dark"])("sends valid %s appearance", (mode) => {
    const bridge = mocks.exposed.get("__televisionNativeBridge") as NativeBridge;

    bridge.setAppearanceMode(mode);

    expect(mocks.send).toHaveBeenCalledWith(SET_APPEARANCE_MODE_CHANNEL, mode);
  });

  it.each([undefined, null, "sepia", 1, {}])(
    "rejects unknown appearance input %j",
    (mode) => {
      const bridge = mocks.exposed.get("__televisionNativeBridge") as NativeBridge;

      bridge.setAppearanceMode(mode);

      expect(mocks.send).not.toHaveBeenCalled();
    },
  );
});

// proofs/arch/desktop/updates.md#^desktop-updates-t-preload
describe("connect preload desktop update operations", () => {
  const listeners = new Map<string, (event: unknown, value: unknown) => void>();

  async function loadBridge(recorded: string | null): Promise<NativeBridge> {
    vi.resetModules();
    mocks.exposed.clear();
    mocks.invoke.mockReset();
    mocks.on.mockReset();
    mocks.send.mockClear();
    listeners.clear();
    mocks.on.mockImplementation((channel: string, listener: (event: unknown, value: unknown) => void) => {
      listeners.set(channel, listener);
    });
    mocks.invoke.mockImplementation(async (channel: string) =>
      channel === GET_DESKTOP_UPDATE_CHANNEL ? recorded : undefined,
    );
    await import("../src/connect-preload.ts");
    return mocks.exposed.get("__televisionNativeBridge") as NativeBridge;
  }

  async function settle(): Promise<void> {
    for (let index = 0; index < 4; index += 1) await Promise.resolve();
  }

  it("reports the recorded version at once, then each different version, only as non-empty strings", async () => {
    const bridge = await loadBridge("1.5.0");
    const reported: string[] = [];

    bridge.onDesktopUpdateDownloaded((version) => reported.push(version));
    await settle();

    expect(mocks.invoke).toHaveBeenCalledWith(GET_DESKTOP_UPDATE_CHANNEL);
    expect(reported).toEqual(["1.5.0"]);
    const push = listeners.get(DESKTOP_UPDATE_DOWNLOADED_CHANNEL);
    if (!push) throw new Error("the preload did not listen for downloaded updates");
    for (const value of ["1.5.0", "", 7, null, undefined, {}, "1.6.0", "1.6.0"]) push({}, value);
    expect(reported).toEqual(["1.5.0", "1.6.0"]);
  });

  it("reports nothing while the main process holds no record", async () => {
    const bridge = await loadBridge(null);
    const reported: string[] = [];

    bridge.onDesktopUpdateDownloaded((version) => reported.push(version));
    await settle();

    expect(reported).toEqual([]);
    listeners.get(DESKTOP_UPDATE_DOWNLOADED_CHANNEL)!({}, "1.5.0");
    expect(reported).toEqual(["1.5.0"]);
  });

  it("sends the restart request with no payload", async () => {
    const bridge = await loadBridge("1.5.0");

    bridge.restartToInstallUpdate();

    expect(mocks.send).toHaveBeenCalledTimes(1);
    expect(mocks.send.mock.calls[0]).toEqual([RESTART_TO_INSTALL_UPDATE_CHANNEL]);
  });
});

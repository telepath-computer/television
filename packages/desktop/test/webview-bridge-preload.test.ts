// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

// The webview preload script imports `electron` for its `ipcRenderer`. In the
// test environment we substitute a fake that records sendToHost calls and
// exposes registered handlers so we can fire them manually.

interface FakeIpcRenderer {
  send: Mock<(...args: unknown[]) => void>;
  sendToHost: Mock<(...args: unknown[]) => void>;
  on: Mock<(...args: unknown[]) => void>;
  removeListener: Mock<(...args: unknown[]) => void>;
  handlers: Map<string, (event: unknown, payload: unknown) => void>;
}

const fakeIpc: FakeIpcRenderer = {
  send: vi.fn(),
  sendToHost: vi.fn(),
  on: vi.fn(),
  removeListener: vi.fn(),
  handlers: new Map(),
};

vi.mock("electron", () => ({
  contextBridge: {
    exposeInMainWorld: vi.fn(),
  },
  ipcRenderer: {
    send: (...args: unknown[]) => fakeIpc.send(...args),
    sendToHost: (...args: unknown[]) => fakeIpc.sendToHost(...args),
    on: (channel: string, handler: (event: unknown, payload: unknown) => void) => {
      fakeIpc.on(channel, handler);
      fakeIpc.handlers.set(channel, handler);
    },
    removeListener: (channel: string, handler: (event: unknown, payload: unknown) => void) => {
      fakeIpc.removeListener(channel, handler);
      if (fakeIpc.handlers.get(channel) === handler) fakeIpc.handlers.delete(channel);
    },
  },
}));

const BRIDGE_CHANNEL = "television-artifact-bridge";
const OPEN_APPLICATION_LINK_CHANNEL = "television:open-application-link";

async function importPreloadAt(pathname: string): Promise<void> {
  window.history.pushState({}, "", pathname);
  vi.resetModules();
  await import("../src/webview-bridge-preload.ts");
}

describe("webview-bridge-preload", () => {
  const installedWindowListeners: Array<{
    type: string;
    listener: EventListenerOrEventListenerObject;
    options?: boolean | AddEventListenerOptions;
  }> = [];
  const addWindowEventListener = window.addEventListener.bind(window);

  beforeEach(() => {
    vi.useRealTimers();
    fakeIpc.send.mockClear();
    fakeIpc.sendToHost.mockClear();
    fakeIpc.on.mockClear();
    fakeIpc.removeListener.mockClear();
    fakeIpc.handlers.clear();
    document.body.innerHTML = "";
    delete window.__televisionContentBridge;
    vi.spyOn(window, "addEventListener").mockImplementation((type, listener, options) => {
      installedWindowListeners.push({ type, listener, options });
      addWindowEventListener(type, listener, options);
    });
  });

  afterEach(() => {
    // Stop preload poll work before removing the listeners that dispose it.
    window.dispatchEvent(new Event("pagehide"));
    vi.clearAllTimers();
    vi.useRealTimers();
    for (const { type, listener, options } of installedWindowListeners.splice(0)) {
      window.removeEventListener(type, listener, options);
    }
    vi.restoreAllMocks();
  });

  it("exposes a content bridge backed by sendToHost and ipcRenderer.on", async () => {
    await importPreloadAt("/");
    expect(window.__televisionContentBridge).toBeDefined();
    const callback = vi.fn();
    const unsubscribe = window.__televisionContentBridge!.onHostMessage(callback);
    const handler = fakeIpc.handlers.get(BRIDGE_CHANNEL);
    expect(handler).toBeDefined();

    const message = { type: "content-updated", content: "from host" };
    handler!(null, message);
    expect(callback).toHaveBeenCalledWith(message);

    window.__televisionContentBridge!.postToHost({ type: "ready" });
    expect(fakeIpc.sendToHost).toHaveBeenCalledWith(BRIDGE_CHANNEL, { type: "ready" });

    unsubscribe();
    expect(fakeIpc.removeListener).toHaveBeenCalledWith(BRIDGE_CHANNEL, handler);
  });

  // spec: proofs/arch/artifact-frame/artifact-bridge.md#^ab-ac-application-link-preload
  it("gates application-link bridge requests on active user activation", async () => {
    let active = false;
    const userActivation = Object.create(Object.defineProperty({}, "isActive", {
      configurable: true,
      get: () => active,
    })) as { isActive: boolean };
    Object.defineProperty(window.navigator, "userActivation", {
      configurable: true,
      value: userActivation,
    });
    await importPreloadAt("/views/markdown/");
    const bridge = window.__televisionContentBridge as typeof window.__televisionContentBridge & {
      openApplicationLink(url: string): boolean;
    };

    expect(bridge.openApplicationLink("example-app://open/item")).toBe(false);
    expect(fakeIpc.send).not.toHaveBeenCalled();

    Object.defineProperty(userActivation, "isActive", { configurable: true, value: true });
    expect(bridge.openApplicationLink("example-app://open/item")).toBe(false);
    expect(fakeIpc.send).not.toHaveBeenCalled();
    delete (userActivation as { isActive?: boolean }).isActive;

    active = true;
    expect(bridge.openApplicationLink("example-app://open/item")).toBe(true);
    expect(fakeIpc.send).toHaveBeenCalledWith(
      OPEN_APPLICATION_LINK_CHANNEL,
      "example-app://open/item",
    );

    fakeIpc.send.mockClear();
    for (const denied of [
      "https://example.com",
      "javascript:document.body.textContent='owned'",
      "file:///tmp/note.html",
      "http://[",
    ]) {
      expect(bridge.openApplicationLink(denied)).toBe(false);
    }
    expect(fakeIpc.send).not.toHaveBeenCalled();
  });

  // spec: proofs/arch/artifact-frame/artifact-bridge.md#^ab-ac-application-link-preload
  it("normalizes application-link anchor dispositions and relays only during activation", async () => {
    let active = false;
    const userActivation = Object.create(Object.defineProperty({}, "isActive", {
      configurable: true,
      get: () => active,
    })) as { isActive: boolean };
    Object.defineProperty(window.navigator, "userActivation", {
      configurable: true,
      value: userActivation,
    });
    await importPreloadAt("/artifact/01J00000000000000000000000/index.html");
    document.body.innerHTML = `
      <a id="app-link" href="example-app://open/item">Open app</a>
      <a id="target-link" href="example-app://open/target" target="_blank">Target app</a>
      <a id="download-link" href="example-app://open/download" download>Download app</a>
    `;
    const anchor = document.getElementById("app-link")!;

    const programmatic = new MouseEvent("click", { bubbles: true, cancelable: true });
    anchor.dispatchEvent(programmatic);
    expect(programmatic.defaultPrevented).toBe(true);
    expect(fakeIpc.send).not.toHaveBeenCalled();

    active = true;
    const activations = [
      { id: "app-link", event: new MouseEvent("click", { bubbles: true, cancelable: true, ctrlKey: true }) },
      { id: "target-link", event: new MouseEvent("click", { bubbles: true, cancelable: true }) },
      { id: "download-link", event: new MouseEvent("click", { bubbles: true, cancelable: true }) },
      { id: "app-link", event: new MouseEvent("auxclick", { bubbles: true, cancelable: true, button: 1 }) },
    ];
    for (const { id, event } of activations) {
      document.getElementById(id)!.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(true);
    }
    expect(fakeIpc.send.mock.calls).toEqual([
      [OPEN_APPLICATION_LINK_CHANNEL, "example-app://open/item"],
      [OPEN_APPLICATION_LINK_CHANNEL, "example-app://open/target"],
      [OPEN_APPLICATION_LINK_CHANNEL, "example-app://open/download"],
      [OPEN_APPLICATION_LINK_CHANNEL, "example-app://open/item"],
    ]);
  });

  it("posts target lifecycle shapes with one document GUID", async () => {
    vi.spyOn(document, "readyState", "get").mockReturnValue("complete");
    await importPreloadAt("/artifact/01J00000000000000000000000/index.html");

    const readyMessages = fakeIpc.sendToHost.mock.calls
      .filter(([, message]) => (message as { type?: string }).type === "bridge-ready")
      .map(([, message]) => message);
    expect(readyMessages).toEqual([{ type: "bridge-ready", guid: expect.any(String) }]);
    const ready = readyMessages[0] as { type: "bridge-ready"; guid: string };

    fakeIpc.sendToHost.mockClear();
    const ordinaryPageshow = new Event("pageshow") as PageTransitionEvent;
    Object.defineProperty(ordinaryPageshow, "persisted", { value: false });
    window.dispatchEvent(ordinaryPageshow);
    expect(fakeIpc.sendToHost).not.toHaveBeenCalled();

    window.dispatchEvent(new Event("pagehide"));
    expect(fakeIpc.sendToHost).toHaveBeenCalledWith(BRIDGE_CHANNEL, { type: "leaving", guid: ready.guid });

    fakeIpc.sendToHost.mockClear();
    const persistedPageshow = new Event("pageshow") as PageTransitionEvent;
    Object.defineProperty(persistedPageshow, "persisted", { value: true });
    window.dispatchEvent(persistedPageshow);
    expect(fakeIpc.sendToHost.mock.calls).toEqual([
      [BRIDGE_CHANNEL, { type: "bridge-ready", guid: ready.guid }],
    ]);
  });

  // proofs/arch/artifact-frame/artifact-bridge.md#^ab-ac-pointer-producers
  it("reports trusted webview pointer input without interfering", async () => {
    vi.spyOn(document, "readyState", "get").mockReturnValue("complete");
    await importPreloadAt("/artifact/01J00000000000000000000000/index.html");
    fakeIpc.sendToHost.mockClear();

    const preventDefault = vi.fn();
    const stopPropagation = vi.fn();
    const stopImmediatePropagation = vi.fn();
    const setPointerCapture = vi.fn();
    const rows = [
      { eventType: "pointermove", button: -1, buttons: 5 },
      { eventType: "pointerdown", button: 0, buttons: 1 },
      { eventType: "pointerup", button: 2, buttons: 0 },
      { eventType: "pointercancel", button: 2, buttons: 4 },
      { eventType: "click", button: 1, buttons: 0 },
    ] as const;

    for (const row of rows) {
      const listener = installedWindowListeners.filter(({ type }) => type === row.eventType).at(-1)?.listener;
      if (typeof listener !== "function") throw new Error(`Missing ${row.eventType} listener`);
      listener({
        type: row.eventType,
        isTrusted: true,
        clientX: 33.5,
        clientY: 72.25,
        button: row.button,
        buttons: row.buttons,
        preventDefault,
        stopPropagation,
        stopImmediatePropagation,
        target: { setPointerCapture },
      } as unknown as Event);
      expect(fakeIpc.sendToHost).toHaveBeenLastCalledWith(BRIDGE_CHANNEL, {
        type: "artifact-pointer",
        ...row,
        clientX: 33.5,
        clientY: 72.25,
      });
    }

    const move = installedWindowListeners.filter(({ type }) => type === "pointermove").at(-1)?.listener;
    if (typeof move !== "function") throw new Error("Missing pointermove listener");
    move({
      type: "pointermove",
      isTrusted: false,
      clientX: 1,
      clientY: 2,
      button: -1,
      buttons: 0,
    } as unknown as Event);

    expect(fakeIpc.sendToHost).toHaveBeenCalledTimes(rows.length);
    expect(preventDefault).not.toHaveBeenCalled();
    expect(stopPropagation).not.toHaveBeenCalled();
    expect(stopImmediatePropagation).not.toHaveBeenCalled();
    expect(setPointerCapture).not.toHaveBeenCalled();
  });

  it("waits for an incomplete document to load and posts ready exactly once", async () => {
    vi.spyOn(document, "readyState", "get").mockReturnValue("loading");
    await importPreloadAt("/artifact/01J00000000000000000000000/index.html");

    expect(fakeIpc.sendToHost).not.toHaveBeenCalledWith(
      BRIDGE_CHANNEL,
      expect.objectContaining({ type: "bridge-ready" }),
    );

    window.dispatchEvent(new Event("load"));
    window.dispatchEvent(new Event("load"));

    const readyMessages = fakeIpc.sendToHost.mock.calls
      .filter(([, message]) => (message as { type?: string }).type === "bridge-ready")
      .map(([, message]) => message);
    expect(readyMessages).toEqual([{ type: "bridge-ready", guid: expect.any(String) }]);
  });

  it("polls TV artifact URLs and sends changed ETags to the host", async () => {
    vi.useFakeTimers();
    fakeIpc.sendToHost.mockClear();
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 200, headers: { ETag: '"one"' } }))
      .mockResolvedValueOnce(new Response(null, { status: 200, headers: { ETag: '"two"' } }));
    Object.defineProperty(window, "fetch", { configurable: true, value: fetch });

    await importPreloadAt("/artifact/01J00000000000000000000000/index.html");
    await vi.advanceTimersByTimeAsync(0);
    expect(fakeIpc.sendToHost).not.toHaveBeenCalledWith(BRIDGE_CHANNEL, { type: "proxy-content-changed" });
    await vi.advanceTimersByTimeAsync(5000);

    expect(fetch).toHaveBeenCalledWith(window.location.href, {
      method: "HEAD",
      signal: expect.objectContaining({ aborted: false }),
    });
    expect(fakeIpc.sendToHost).toHaveBeenCalledWith(BRIDGE_CHANNEL, { type: "proxy-content-changed" });
  });

  // spec: proofs/arch/artifact-frame/artifact-bridge.md#^ab-ac-poll-lifecycle
  it("cancels hidden poll work and resumes one loop with its prior ETag on persisted pageshow", async () => {
    vi.useFakeTimers();
    fakeIpc.sendToHost.mockClear();
    let resolveInFlight!: (response: Response) => void;
    let inFlightSignal: AbortSignal | undefined;
    const inFlight = new Promise<Response>((resolve) => {
      resolveInFlight = resolve;
    });
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 200, headers: { ETag: '"one"' } }))
      .mockResolvedValueOnce(new Response(null, { status: 200, headers: { ETag: '"one"' } }))
      .mockImplementationOnce((_url: string, init?: RequestInit) => {
        inFlightSignal = init?.signal ?? undefined;
        return inFlight;
      })
      .mockResolvedValueOnce(new Response(null, { status: 200, headers: { ETag: '"two"' } }))
      .mockResolvedValueOnce(new Response(null, { status: 200, headers: { ETag: '"two"' } }));
    Object.defineProperty(window, "fetch", { configurable: true, value: fetch });

    await importPreloadAt("/artifact/01J00000000000000000000000/index.html");
    await vi.advanceTimersByTimeAsync(0);
    expect(fetch).toHaveBeenCalledTimes(1);

    window.dispatchEvent(new Event("pagehide"));
    await vi.advanceTimersByTimeAsync(5000);
    expect(fetch).toHaveBeenCalledTimes(1);

    const ordinaryPageshow = new Event("pageshow") as PageTransitionEvent;
    Object.defineProperty(ordinaryPageshow, "persisted", { value: false });
    window.dispatchEvent(ordinaryPageshow);
    await vi.advanceTimersByTimeAsync(5000);
    expect(fetch).toHaveBeenCalledTimes(1);

    const firstRestore = new Event("pageshow") as PageTransitionEvent;
    Object.defineProperty(firstRestore, "persisted", { value: true });
    window.dispatchEvent(firstRestore);
    await vi.advanceTimersByTimeAsync(0);
    expect(fetch).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(5000);
    expect(fetch).toHaveBeenCalledTimes(3);
    window.dispatchEvent(new Event("pagehide"));
    expect(inFlightSignal?.aborted).toBe(true);
    resolveInFlight(new Response(null, { status: 200, headers: { ETag: '"two"' } }));
    await vi.advanceTimersByTimeAsync(15000);
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(fakeIpc.sendToHost).not.toHaveBeenCalledWith(BRIDGE_CHANNEL, { type: "proxy-content-changed" });

    const secondRestore = new Event("pageshow") as PageTransitionEvent;
    Object.defineProperty(secondRestore, "persisted", { value: true });
    window.dispatchEvent(secondRestore);
    const duplicateRestore = new Event("pageshow") as PageTransitionEvent;
    Object.defineProperty(duplicateRestore, "persisted", { value: true });
    window.dispatchEvent(duplicateRestore);
    await vi.advanceTimersByTimeAsync(0);

    expect(fetch).toHaveBeenCalledTimes(4);
    expect(fakeIpc.sendToHost).toHaveBeenCalledWith(BRIDGE_CHANNEL, { type: "proxy-content-changed" });
    await vi.advanceTimersByTimeAsync(5000);
    expect(fetch).toHaveBeenCalledTimes(5);
  });

  it("does not poll non-TV artifact URLs", async () => {
    vi.useFakeTimers();
    fakeIpc.sendToHost.mockClear();
    const fetch = vi.fn();
    Object.defineProperty(window, "fetch", { configurable: true, value: fetch });

    await importPreloadAt("/not-artifact/01J00000000000000000000000/index.html");
    await vi.advanceTimersByTimeAsync(15000);

    expect(fetch).not.toHaveBeenCalled();
  });
});

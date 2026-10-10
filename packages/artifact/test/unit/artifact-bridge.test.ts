// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  classifyLinkTarget,
  isWebNavigationURL,
} from "@telepath-computer/television-artifact";
import {
  bridgeScriptSource,
  installBridge,
  isArtifactMissingNotification,
  isArtifactMissingRequest,
  isArtifactPointerNotification,
  isBridgeLeavingNotification,
  isBridgeReadyNotification,
  isNavigationKeyChord,
  isNavigationKeyNotification,
  isNavigationRequest,
  isProxyContentChangedNotification,
  isURLTargetNotification,
  isURLTargetRequest,
  type NavigationKeyChordInput,
} from "@telepath-computer/television-artifact/browser";

/**
 * Creates a child iframe and returns its contentWindow. The child window's
 * `parent` points at the outer jsdom window, which is what the bridge's
 * `win.parent === win` check expects.
 */
function makeFramedWindow(url?: string): Window {
  const iframe = document.createElement("iframe");
  if (url) iframe.src = url;
  document.body.appendChild(iframe);
  const win = iframe.contentWindow;
  if (!win) throw new Error("iframe has no contentWindow");
  return win;
}

function navigationKeyInput(
  overrides: Partial<NavigationKeyChordInput> = {},
): NavigationKeyChordInput {
  return {
    key: "ArrowLeft",
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    isComposing: false,
    repeat: false,
    ...overrides,
  };
}

function keyboardEvent(
  win: Window,
  init: KeyboardEventInit,
): KeyboardEvent {
  const KeyboardEventConstructor = (win as Window & typeof globalThis).KeyboardEvent;
  return new KeyboardEventConstructor("keydown", {
    bubbles: true,
    cancelable: true,
    ...init,
  });
}

afterEach(() => vi.restoreAllMocks());

beforeEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = "";
  delete (window as Window & { __televisionArtifactBridgeInstalled?: boolean }).__televisionArtifactBridgeInstalled;
  delete (window as Window & { __televisionContentBridge?: unknown }).__televisionContentBridge;
  delete (window as Window & { __televisionAppearanceResolver?: unknown }).__televisionAppearanceResolver;
  document.documentElement.removeAttribute("data-theme");
});

describe("URL target message guards", () => {
  it("accepts the URL target request and notification shapes", () => {
    expect(isURLTargetRequest({ type: "url-target-request" })).toBe(true);
    expect(isURLTargetNotification({ type: "url-target", url: "https://example.com" })).toBe(true);
    expect(isURLTargetNotification({ type: "url-target", url: null })).toBe(true);
  });

  it("rejects malformed URL target messages", () => {
    expect(isURLTargetRequest({ type: "url-target-request", id: "abc" })).toBe(false);
    expect(isURLTargetRequest({ type: "url-target" })).toBe(false);
    expect(isURLTargetRequest(null)).toBe(false);
    expect(isURLTargetRequest("url-target-request")).toBe(false);
    expect(isURLTargetNotification({ type: "url-target" })).toBe(false);
    expect(isURLTargetNotification({ type: "url-target", url: 1 })).toBe(false);
    expect(isURLTargetNotification({ type: "url-target", url: "https://example.com", id: "abc" })).toBe(false);
    expect(isURLTargetNotification({ type: "navigation-request", url: "https://example.com" })).toBe(false);
    expect(isURLTargetNotification(null)).toBe(false);
    expect(isURLTargetNotification("url-target")).toBe(false);
  });
});

describe("artifact missing message guards", () => {
  it("accepts the artifact missing request and notification shapes", () => {
    expect(isArtifactMissingRequest({ type: "artifact-missing-request" })).toBe(true);
    expect(isArtifactMissingNotification({
      type: "artifact-missing",
      title: "Missing artifact",
      path: "/tmp/missing.html",
    })).toBe(true);
  });

  it("rejects malformed artifact missing messages", () => {
    expect(isArtifactMissingRequest({ type: "artifact-missing-request", id: "abc" })).toBe(false);
    expect(isArtifactMissingRequest({ type: "artifact-missing" })).toBe(false);
    expect(isArtifactMissingRequest(null)).toBe(false);
    expect(isArtifactMissingRequest("artifact-missing-request")).toBe(false);
    expect(isArtifactMissingNotification({ type: "artifact-missing", path: "/tmp/missing.html" })).toBe(false);
    expect(isArtifactMissingNotification({ type: "artifact-missing", title: "Missing", path: 1 })).toBe(false);
    expect(isArtifactMissingNotification({ type: "artifact-missing", title: "Missing", path: "/tmp/missing.html", id: "abc" })).toBe(false);
    expect(isArtifactMissingNotification({ type: "url-target", title: "Missing", path: "/tmp/missing.html" })).toBe(false);
    expect(isArtifactMissingNotification(null)).toBe(false);
    expect(isArtifactMissingNotification("artifact-missing")).toBe(false);
  });
});

describe("artifact pointer message guard", () => {
  // proofs/arch/artifact-frame/artifact-bridge.md#^ab-ac-message-guards
  it("accepts only the closed artifact pointer notification shape", () => {
    const message = {
      type: "artifact-pointer",
      eventType: "pointermove",
      clientX: 12.5,
      clientY: 34.25,
      button: -1,
      buttons: 1,
    };
    expect(isArtifactPointerNotification(message)).toBe(true);
    expect(isArtifactPointerNotification({ ...message, eventType: "pointerenter" })).toBe(false);
    expect(isArtifactPointerNotification({ ...message, clientX: Number.NaN })).toBe(false);
    expect(isArtifactPointerNotification({ ...message, clientY: "34" })).toBe(false);
    expect(isArtifactPointerNotification({ ...message, button: null })).toBe(false);
    expect(isArtifactPointerNotification({ ...message, buttons: undefined })).toBe(false);
    expect(isArtifactPointerNotification({ ...message, id: "content-message" })).toBe(false);
    expect(isArtifactPointerNotification({ type: "navigation-key" })).toBe(false);
    expect(isArtifactPointerNotification(null)).toBe(false);
  });
});

describe("installBridge", () => {
  it("serialized source resolves appearance before bridge installation, including top-level documents", () => {
    const source = bridgeScriptSource({ reportNavigation: false });
    expect(source.indexOf(')("system",window)')).toBeGreaterThanOrEqual(0);
    expect(source.indexOf(')("system",window)')).toBeLessThan(source.indexOf(")(window,"));

    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn(() => ({
        matches: true,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    });
    window.eval(source);

    expect(document.documentElement.dataset.theme).toBe("dark");
    expect((window as Window & {
      __televisionAppearanceResolver?: unknown;
    }).__televisionAppearanceResolver).toBeDefined();
    expect((window as Window & {
      __televisionArtifactBridgeInstalled?: boolean;
    }).__televisionArtifactBridgeInstalled).toBeUndefined();
  });

  it("is a no-op when the window has no framing parent", () => {
    const postMessage = vi.spyOn(window, "postMessage");
    const addWindowListener = vi.spyOn(window, "addEventListener");
    const addDocumentListener = vi.spyOn(document, "addEventListener");

    installBridge(window);

    expect(postMessage).not.toHaveBeenCalled();
    expect(addWindowListener).not.toHaveBeenCalled();
    expect(addDocumentListener).not.toHaveBeenCalled();
    expect((window as Window & { __televisionArtifactBridgeInstalled?: boolean }).__televisionArtifactBridgeInstalled).toBeUndefined();
  });

  it("self-reports navigation and bridge readiness on install", () => {
    const win = makeFramedWindow();
    const parentPostMessage = vi.spyOn(win.parent, "postMessage");
    installBridge(win);

    expect(parentPostMessage).toHaveBeenCalledWith(
      { type: "navigation-request", url: win.location.href },
      "*",
    );
    expect(parentPostMessage).toHaveBeenLastCalledWith(
      { type: "bridge-ready", guid: expect.any(String) },
      "*",
    );
  });

  it("installs lifecycle listeners before emitting its single bridge-ready", () => {
    const win = makeFramedWindow();
    const addEventListener = vi.spyOn(win, "addEventListener");
    const parentPostMessage = vi.spyOn(win.parent, "postMessage");

    installBridge(win, { reportNavigation: false });
    installBridge(win, { reportNavigation: false });

    expect(parentPostMessage).toHaveBeenCalledTimes(1);
    expect(parentPostMessage).toHaveBeenCalledWith(
      { type: "bridge-ready", guid: expect.any(String) },
      "*",
    );
    const readyOrder = parentPostMessage.mock.invocationCallOrder[0]!;
    expect(addEventListener.mock.calls.map(([type]) => type)).toEqual([
      "pagehide",
      "pageshow",
      "keydown",
      "pointermove",
      "pointerdown",
      "pointerup",
      "pointercancel",
      "click",
    ]);
    expect(addEventListener.mock.invocationCallOrder.every((order) => order < readyOrder)).toBe(true);
    expect((win as Window & {
      __televisionArtifactBridgeInstalled?: boolean;
    }).__televisionArtifactBridgeInstalled).toBe(true);
  });

  // proofs/arch/artifact-frame/artifact-bridge.md#^ab-ac-pointer-producers
  it("reports trusted artifact pointer input without interfering", () => {
    const win = makeFramedWindow();
    const addEventListener = vi.spyOn(win, "addEventListener");
    const parentPostMessage = vi.spyOn(win.parent, "postMessage");
    installBridge(win, { reportNavigation: false });
    parentPostMessage.mockClear();

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
      const listener = addEventListener.mock.calls.find(([type]) => type === row.eventType)?.[1];
      if (typeof listener !== "function") throw new Error(`Missing ${row.eventType} listener`);
      listener({
        type: row.eventType,
        isTrusted: true,
        clientX: 123.25,
        clientY: 45.5,
        button: row.button,
        buttons: row.buttons,
        preventDefault,
        stopPropagation,
        stopImmediatePropagation,
        target: { setPointerCapture },
      } as unknown as Event);
      expect(parentPostMessage).toHaveBeenLastCalledWith({
        type: "artifact-pointer",
        ...row,
        clientX: 123.25,
        clientY: 45.5,
      }, "*");
    }

    const move = addEventListener.mock.calls.find(([type]) => type === "pointermove")?.[1];
    if (typeof move !== "function") throw new Error("Missing pointermove listener");
    move({
      type: "pointermove",
      isTrusted: false,
      clientX: 1,
      clientY: 2,
      button: -1,
      buttons: 0,
    } as unknown as Event);

    expect(parentPostMessage).toHaveBeenCalledTimes(rows.length);
    expect(preventDefault).not.toHaveBeenCalled();
    expect(stopPropagation).not.toHaveBeenCalled();
    expect(stopImmediatePropagation).not.toHaveBeenCalled();
    expect(setPointerCapture).not.toHaveBeenCalled();
  });

  it("leaves top-level webview document lifecycle to the Electron preload", () => {
    const postToHost = vi.fn();
    (window as Window & { __televisionContentBridge?: { postToHost(message: unknown): void; onHostMessage(callback: (message: unknown) => void): () => void } }).__televisionContentBridge = {
      postToHost,
      onHostMessage: vi.fn(() => () => undefined),
    };

    installBridge(window);

    expect(postToHost).not.toHaveBeenCalled();
  });

  // spec: proofs/arch/artifact-frame/artifact-bridge.md#^ab-ac-bfcache-producers
  it("posts leaving on pagehide and reposts bridge-ready with the same GUID on persisted pageshow", () => {
    const win = makeFramedWindow();
    const parentPostMessage = vi.spyOn(win.parent, "postMessage");
    installBridge(win, { reportNavigation: false });
    const ready = parentPostMessage.mock.calls.find(([message]) => {
      return (message as { type?: string }).type === "bridge-ready";
    })?.[0] as { guid: string } | undefined;
    if (!ready) throw new Error("Expected bridge-ready");
    parentPostMessage.mockClear();

    win.dispatchEvent(new Event("pagehide"));
    expect(parentPostMessage).toHaveBeenCalledWith({ type: "leaving", guid: ready.guid }, "*");

    const ordinaryPageshow = new Event("pageshow") as PageTransitionEvent;
    Object.defineProperty(ordinaryPageshow, "persisted", { value: false });
    win.dispatchEvent(ordinaryPageshow);
    expect(parentPostMessage).toHaveBeenCalledTimes(1);

    const persistedPageshow = new Event("pageshow") as PageTransitionEvent;
    Object.defineProperty(persistedPageshow, "persisted", { value: true });
    win.dispatchEvent(persistedPageshow);

    expect(parentPostMessage).toHaveBeenLastCalledWith(
      { type: "bridge-ready", guid: ready.guid },
      "*",
    );
  });

  it("does not require crypto.randomUUID for bridge GUID generation", () => {
    const secure = makeFramedWindow();
    const securePostMessage = vi.spyOn(secure.parent, "postMessage");
    const getRandomValues = vi.fn((values: Uint32Array) => {
      values.set([1, 2, 3, 4]);
      return values;
    });
    const randomUUID = vi.fn(() => {
      throw new Error("randomUUID must not be used");
    });
    Object.defineProperty(secure, "crypto", {
      configurable: true,
      value: { getRandomValues, randomUUID },
    });

    installBridge(secure, { reportNavigation: false });

    expect(getRandomValues).toHaveBeenCalledTimes(1);
    expect(randomUUID).not.toHaveBeenCalled();
    expect(securePostMessage).toHaveBeenCalledWith(
      { type: "bridge-ready", guid: expect.stringMatching(/^tvb-/) },
      "*",
    );

    securePostMessage.mockClear();
    const fallback = makeFramedWindow();
    Object.defineProperty(fallback, "crypto", {
      configurable: true,
      value: { randomUUID },
    });

    installBridge(fallback, { reportNavigation: false });

    expect(randomUUID).not.toHaveBeenCalled();
    expect(securePostMessage).toHaveBeenCalledWith(
      { type: "bridge-ready", guid: expect.stringMatching(/^tvb-/) },
      "*",
    );
  });

  it("skips navigation reporting when disabled", () => {
    const win = makeFramedWindow();
    const parentPostMessage = vi.spyOn(win.parent, "postMessage");
    installBridge(win, { reportNavigation: false });

    expect(parentPostMessage).toHaveBeenCalledTimes(1);
    expect(parentPostMessage).toHaveBeenCalledWith(
      { type: "bridge-ready", guid: expect.any(String) },
      "*",
    );
    expect(parentPostMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "navigation-request" }),
      "*",
    );
  });

  it("Navigation API posts cross-document requests even when canIntercept is false", () => {
    const win = makeFramedWindow("https://internal.test/current");
    const navigation = new EventTarget();
    Object.defineProperty(win, "navigation", { configurable: true, value: navigation });
    const parentPostMessage = vi.spyOn(win.parent, "postMessage");
    installBridge(win);
    parentPostMessage.mockClear();

    const dispatchNavigation = (url: string, canIntercept: boolean) => {
      const event = new Event("navigate", { cancelable: true });
      const preventDefault = vi.fn();
      Object.defineProperties(event, {
        canIntercept: { value: canIntercept },
        destination: { value: { url, sameDocument: false } },
        navigationType: { value: "push" },
        preventDefault: { value: preventDefault },
      });
      navigation.dispatchEvent(event);
      return preventDefault;
    };

    const crossOriginURL = "https://example.com/external";
    expect(dispatchNavigation(crossOriginURL, true)).toHaveBeenCalledTimes(1);
    expect(parentPostMessage).toHaveBeenCalledWith(
      { type: "navigation-request", url: crossOriginURL },
      "*",
    );

    parentPostMessage.mockClear();
    const sameOriginURL = `${win.location.origin}/next`;
    expect(dispatchNavigation(sameOriginURL, true)).not.toHaveBeenCalled();
    expect(parentPostMessage).toHaveBeenCalledWith(
      { type: "navigation-request", url: sameOriginURL, native: true },
      "*",
    );

    parentPostMessage.mockClear();
    expect(dispatchNavigation(crossOriginURL, false)).not.toHaveBeenCalled();
    expect(parentPostMessage).toHaveBeenCalledWith(
      { type: "navigation-request", url: crossOriginURL },
      "*",
    );

    parentPostMessage.mockClear();
    expect(dispatchNavigation("example-app://open/item", true)).not.toHaveBeenCalled();
    expect(dispatchNavigation("javascript:document.body.textContent='owned'", true)).not.toHaveBeenCalled();
    expect(parentPostMessage).not.toHaveBeenCalled();
  });

  // spec: proofs/arch/artifact-frame/artifact-bridge.md#^ab-ac-link-classifier
  it("keeps serialized web and browser-local classification in parity with the shared classifier", () => {
    const win = makeFramedWindow("https://internal.test/current");
    const navigation = new EventTarget();
    Object.defineProperty(win, "navigation", { configurable: true, value: navigation });
    const parentPostMessage = vi.spyOn(win.parent, "postMessage");
    const root = win.document.documentElement ??
      win.document.appendChild(win.document.createElement("html"));
    const body = win.document.body ?? root.appendChild(win.document.createElement("body"));
    const anchor = win.document.createElement("a");
    body.appendChild(anchor);
    installBridge(win);
    parentPostMessage.mockClear();

    for (const url of [
      "https://example.com/page",
      "http://example.com/page",
      "/relative",
      "example-app://open/item",
      "mailto:user@example.com",
      "about:blank",
      "blob:https://internal.test/id",
      "chrome-extension://example/page.html",
      "chrome://settings/",
      "data:text/html,hello",
      "devtools://devtools/bundled/",
      "file:///tmp/note.html",
      "filesystem:https://internal.test/temporary/note.html",
      "javascript:document.body.textContent='owned'",
      "view-source:https://internal.test/",
      "http://[",
    ]) {
      parentPostMessage.mockClear();
      const navigateEvent = new Event("navigate", { cancelable: true });
      Object.defineProperties(navigateEvent, {
        canIntercept: { value: false },
        destination: { value: { url, sameDocument: false } },
        navigationType: { value: "push" },
        preventDefault: { value: vi.fn() },
      });
      navigation.dispatchEvent(navigateEvent);
      const reportedAsWeb = parentPostMessage.mock.calls.some(([message]) =>
        (message as { type?: string }).type === "navigation-request"
      );

      anchor.setAttribute("href", url);
      const clickEvent = new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        ctrlKey: true,
      });
      anchor.dispatchEvent(clickEvent);
      const normalizedAsApplication = clickEvent.defaultPrevented;
      const expected = classifyLinkTarget(url, win.location.href).kind;

      expect(reportedAsWeb, url).toBe(expected === "web");
      expect(normalizedAsApplication, url).toBe(expected === "application");
      expect(reportedAsWeb, url).toBe(isWebNavigationURL(url, win.location.href));
    }
  });

  // spec: proofs/arch/artifact-frame/artifact-bridge.md#^ab-ac-navigation-key
  it("matches the platform navigation chord for every arrow", () => {
    const arrows = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"] as const;
    for (const platform of ["MacIntel", "darwin"]) {
      for (const key of arrows) {
        expect(isNavigationKeyChord(
          navigationKeyInput({ key, altKey: true, repeat: true }),
          platform,
        )).toBe(true);
      }
    }
    for (const platform of ["Win32", "Linux x86_64"]) {
      for (const key of arrows) {
        expect(isNavigationKeyChord(
          navigationKeyInput({ key, ctrlKey: true, repeat: true }),
          platform,
        )).toBe(true);
      }
    }
  });

  // spec: proofs/arch/artifact-frame/artifact-bridge.md#^ab-ac-navigation-key
  it("rejects composition, non-arrows, missing chords, and every extra modifier", () => {
    for (const input of [
      navigationKeyInput(),
      navigationKeyInput({ ctrlKey: true }),
      navigationKeyInput({ altKey: true, ctrlKey: true }),
      navigationKeyInput({ altKey: true, metaKey: true }),
      navigationKeyInput({ altKey: true, shiftKey: true }),
      navigationKeyInput({ altKey: true, isComposing: true }),
      navigationKeyInput({ altKey: true, key: "Home" }),
    ]) {
      expect(isNavigationKeyChord(input, "MacIntel")).toBe(false);
    }
    for (const input of [
      navigationKeyInput(),
      navigationKeyInput({ altKey: true }),
      navigationKeyInput({ ctrlKey: true, altKey: true }),
      navigationKeyInput({ ctrlKey: true, metaKey: true }),
      navigationKeyInput({ ctrlKey: true, shiftKey: true }),
      navigationKeyInput({ ctrlKey: true, isComposing: true }),
      navigationKeyInput({ ctrlKey: true, key: "Enter" }),
    ]) {
      expect(isNavigationKeyChord(input, "Linux x86_64")).toBe(false);
    }
  });

  // spec: proofs/arch/artifact-frame/artifact-bridge.md#^ab-ac-navigation-key
  it("captures matching chords in editing targets without stopping propagation", () => {
    const cases = [
      { platform: "MacIntel", modifiers: { altKey: true }, target: "input" },
      { platform: "Win32", modifiers: { ctrlKey: true }, target: "textarea" },
      { platform: "Linux x86_64", modifiers: { ctrlKey: true }, target: "div" },
    ] as const;
    const arrows = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"] as const;

    for (const testCase of cases) {
      const win = makeFramedWindow();
      Object.defineProperty(win.navigator, "platform", {
        configurable: true,
        value: testCase.platform,
      });
      const target = win.document.createElement(testCase.target);
      if (testCase.target === "div") target.setAttribute("contenteditable", "true");
      win.document.body.appendChild(target);
      const descendantHandler = vi.fn((event: Event) => event.stopPropagation());
      target.addEventListener("keydown", descendantHandler);
      const parentPostMessage = vi.spyOn(win.parent, "postMessage");
      installBridge(win, { reportNavigation: false });
      parentPostMessage.mockClear();

      for (const key of arrows) {
        const event = keyboardEvent(win, { key, repeat: true, ...testCase.modifiers });
        target.dispatchEvent(event);
        expect(event.defaultPrevented).toBe(true);
      }

      expect(descendantHandler).toHaveBeenCalledTimes(arrows.length);
      expect(parentPostMessage.mock.calls).toEqual(arrows.map((key) => [
        { type: "navigation-key", key },
        "*",
      ]));
      parentPostMessage.mockRestore();
    }
  });

  // spec: proofs/arch/artifact-frame/artifact-bridge.md#^ab-ac-navigation-key
  it("leaves unmatched keydown behavior untouched", () => {
    const cases = [
      {
        platform: "MacIntel",
        events: [
          { key: "ArrowLeft" },
          { key: "ArrowLeft", ctrlKey: true },
          { key: "ArrowLeft", altKey: true, ctrlKey: true },
          { key: "ArrowLeft", altKey: true, metaKey: true },
          { key: "ArrowLeft", altKey: true, shiftKey: true },
          { key: "ArrowLeft", altKey: true, isComposing: true },
          { key: "Home", altKey: true },
        ],
      },
      ...["Win32", "Linux x86_64"].map((platform) => ({
        platform,
        events: [
          { key: "ArrowLeft" },
          { key: "ArrowLeft", altKey: true },
          { key: "ArrowLeft", ctrlKey: true, altKey: true },
          { key: "ArrowLeft", ctrlKey: true, metaKey: true },
          { key: "ArrowLeft", ctrlKey: true, shiftKey: true },
          { key: "ArrowLeft", ctrlKey: true, isComposing: true },
          { key: "Home", ctrlKey: true },
        ],
      })),
    ];

    for (const testCase of cases) {
      const win = makeFramedWindow();
      Object.defineProperty(win.navigator, "platform", {
        configurable: true,
        value: testCase.platform,
      });
      const input = win.document.createElement("input");
      win.document.body.appendChild(input);
      const parentPostMessage = vi.spyOn(win.parent, "postMessage");
      installBridge(win, { reportNavigation: false });
      parentPostMessage.mockClear();

      for (const init of testCase.events) {
        const event = keyboardEvent(win, init);
        input.dispatchEvent(event);
        expect(event.defaultPrevented).toBe(false);
      }
      expect(parentPostMessage).not.toHaveBeenCalled();
      parentPostMessage.mockRestore();
    }
  });

  it("fallback click interception posts regular anchor navigations", () => {
    const win = makeFramedWindow();
    const parentPostMessage = vi.spyOn(win.parent, "postMessage");
    Object.defineProperty(win, "navigation", { configurable: true, value: undefined });
    win.document.body.innerHTML = `<a id="link" href="https://example.com/path">go</a>`;
    installBridge(win);
    parentPostMessage.mockClear();

    const link = win.document.getElementById("link")!;
    const event = new MouseEvent("click", { bubbles: true, cancelable: true });
    link.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(parentPostMessage).toHaveBeenCalledWith(
      { type: "navigation-request", url: "https://example.com/path" },
      "*",
    );
  });

  // spec: proofs/arch/artifact-frame/artifact-bridge.md#^ab-ac-fallback-recorder
  describe("the fallback recorder (^ab-ac-fallback-recorder)", () => {
    /** A framed window whose document resolves addresses against an artifact page's. */
    function artifactPageWindow(): Window {
      const win = makeFramedWindow();
      win.document.head.innerHTML = `<base href="https://internal.test/artifact/a/index.html">`;
      return win;
    }

    const navigationRequests = (spy: { mock: { calls: unknown[][] } }): Array<{ type: string; url: string }> =>
      spy.mock.calls
        .map(([message]) => message as { type: string; url: string })
        .filter((message) => message.type === "navigation-request");

    /** A click or submission whose preventDefault calls are counted. */
    function counted<T extends Event>(event: T): T & { preventions: number } {
      const counter = Object.assign(event, { preventions: 0 });
      const preventDefault = event.preventDefault.bind(event);
      Object.defineProperty(event, "preventDefault", {
        value: () => {
          counter.preventions += 1;
          preventDefault();
        },
      });
      return counter;
    }

    function click(win: Window, id: string) {
      const event = counted(new (win as Window & typeof globalThis).MouseEvent("click", { bubbles: true, cancelable: true }));
      win.document.getElementById(id)!.dispatchEvent(event);
      return event;
    }

    function submit(win: Window, formID: string, submitterID?: string) {
      const form = win.document.getElementById(formID) as HTMLFormElement;
      const submitter = submitterID === undefined ? null : win.document.getElementById(submitterID) as HTMLElement;
      const event = counted(new (win as Window & typeof globalThis).SubmitEvent("submit", { bubbles: true, cancelable: true, submitter }));
      form.dispatchEvent(event);
      return event;
    }

    it("records with the fallback when the Navigation API is absent or its entries are disabled, and with the API otherwise", () => {
      for (const [name, navigation, fallback] of [
        ["absent", undefined, true],
        ["entries disabled, as with an opaque origin", Object.assign(new EventTarget(), { currentEntry: null }), true],
        ["entries enabled", Object.assign(new EventTarget(), { currentEntry: {} }), false],
      ] as const) {
        const win = artifactPageWindow();
        Object.defineProperty(win, "navigation", { configurable: true, value: navigation });
        const listened = navigation === undefined ? null : vi.spyOn(navigation, "addEventListener");
        win.document.body.innerHTML = `<a id="link" href="/artifact/a/next.html">next</a>`;
        const parentPostMessage = vi.spyOn(win.parent, "postMessage");
        installBridge(win);
        parentPostMessage.mockClear();

        const event = click(win, "link");
        expect({ name, prevented: event.defaultPrevented, reported: navigationRequests(parentPostMessage) }).toEqual({
          name,
          prevented: fallback,
          reported: fallback ? [{ type: "navigation-request", url: "https://internal.test/artifact/a/next.html" }] : [],
        });
        if (listened) expect(listened.mock.calls.some(([type]) => type === "navigate"), name).toBe(!fallback);
        parentPostMessage.mockRestore();
      }
    });

    it("neither prevents nor reports a click or submission a page handler cancels, wherever and whenever it registered", () => {
      for (const where of ["target", "document", "window"] as const) {
        for (const when of ["before", "after"] as const) {
          for (const kind of ["click", "submit"] as const) {
            const win = artifactPageWindow();
            Object.defineProperty(win, "navigation", { configurable: true, value: undefined });
            win.document.body.innerHTML = `
              <a id="link" href="/artifact/a/next.html">next</a>
              <form id="form" action="/artifact/a/search"><input name="q" value="x"></form>
            `;
            const target = { target: win.document.getElementById(kind === "click" ? "link" : "form")!, document: win.document, window: win }[where];
            const cancel = (event: Event) => event.preventDefault();
            const parentPostMessage = vi.spyOn(win.parent, "postMessage");
            if (when === "before") target.addEventListener(kind, cancel);
            installBridge(win);
            if (when === "after") target.addEventListener(kind, cancel);
            parentPostMessage.mockClear();

            const event = kind === "click" ? click(win, "link") : submit(win, "form");
            const label = `${kind} cancelled on the ${where}, registered ${when} the bridge`;
            expect({ label, preventions: event.preventions, reported: navigationRequests(parentPostMessage) }).toEqual({ label, preventions: 1, reported: [] });
            parentPostMessage.mockRestore();
          }
        }
      }
    });

    it("prevents and reports only uncancelled GET submissions to the frame itself, at the address the browser would load", () => {
      const win = artifactPageWindow();
      Object.defineProperty(win, "navigation", { configurable: true, value: undefined });
      win.document.body.innerHTML = `
        <form id="get" action="search?old=1#results">
          <input name="q" value="cats &amp; dogs">
          <button id="plain" name="go" value="yes">Go</button>
          <button id="elsewhere" formaction="/artifact/a/other" name="via" value="button">Other</button>
          <button id="to-tab" formtarget="_blank">Tab</button>
          <button id="as-post" formmethod="post">Post</button>
          <button id="as-dialog" formmethod="dialog">Dialog</button>
        </form>
        <form id="post" method="post" action="save"><input name="q" value="x"><button id="post-as-get" formmethod="get">Get</button></form>
        <form id="dialog" method="dialog"><button>Close</button></form>
        <form id="targeted" target="_blank" action="search"><input name="q" value="x"></form>
        <form id="named" action="search"><input name="action" value="find"><input name="method" value="exact"><input name="target" value="titles"></form>
      `;
      // In a browser, a form's controls named action, method and target hide
      // the form's properties of those names; jsdom does not, so these stand in.
      const named = win.document.getElementById("named") as HTMLFormElement;
      for (const name of ["action", "method", "target"]) {
        Object.defineProperty(named, name, { value: named.elements.namedItem(name) });
      }
      const parentPostMessage = vi.spyOn(win.parent, "postMessage");
      installBridge(win);

      const outcome = (formID: string, submitterID?: string) => {
        parentPostMessage.mockClear();
        const event = submit(win, formID, submitterID);
        return { prevented: event.defaultPrevented, reported: navigationRequests(parentPostMessage).map((message) => message.url) };
      };
      expect(outcome("get")).toEqual({ prevented: true, reported: ["https://internal.test/artifact/a/search?q=cats+%26+dogs#results"] });
      expect(outcome("get", "plain")).toEqual({ prevented: true, reported: ["https://internal.test/artifact/a/search?q=cats+%26+dogs&go=yes#results"] });
      expect(outcome("get", "elsewhere")).toEqual({ prevented: true, reported: ["https://internal.test/artifact/a/other?q=cats+%26+dogs&via=button"] });
      expect(outcome("post", "post-as-get")).toEqual({ prevented: true, reported: ["https://internal.test/artifact/a/save?q=x"] });
      expect(outcome("named")).toEqual({ prevented: true, reported: ["https://internal.test/artifact/a/search?action=find&method=exact&target=titles"] });
      for (const [formID, submitterID] of [
        ["get", "to-tab"],
        ["targeted", undefined],
        ["get", "as-post"],
        ["get", "as-dialog"],
        ["post", undefined],
        ["dialog", undefined],
      ] as const) {
        expect({ formID, submitterID, ...outcome(formID, submitterID) }).toEqual({ formID, submitterID, prevented: false, reported: [] });
      }
    });
  });

  // spec: proofs/arch/artifact-frame/reload-navigation.md#^rn-ac-navigation-control
  it("fallback click interception leaves non-web anchors native and unreported", () => {
    const win = makeFramedWindow();
    const parentPostMessage = vi.spyOn(win.parent, "postMessage");
    Object.defineProperty(win, "navigation", { configurable: true, value: undefined });
    win.document.body.innerHTML = `
      <a id="application" href="example-app://open/item">app</a>
      <a id="script" href="javascript:document.body.dataset.activated='true'">script</a>
    `;
    installBridge(win);
    parentPostMessage.mockClear();

    for (const id of ["application", "script"]) {
      const event = new MouseEvent("click", { bubbles: true, cancelable: true });
      win.document.getElementById(id)!.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);
    }
    expect(parentPostMessage).not.toHaveBeenCalled();
  });

  // spec: proofs/arch/artifact-frame/artifact-bridge.md#^ab-ac-application-link-browser
  it("normalizes application-link new-context requests to same-context handoff", () => {
    const win = makeFramedWindow();
    Object.defineProperty(win, "navigation", { configurable: true, value: new EventTarget() });
    const parentPostMessage = vi.spyOn(win.parent, "postMessage");
    win.document.body.innerHTML = `
      <a id="application" href="example-app://open/item">app</a>
      <a id="target-application" href="example-app://open/target" target="_blank">target app</a>
      <a id="download-application" href="example-app://open/download" download>download app</a>
      <a id="web" href="https://example.com/path">web</a>
      <a id="script" href="javascript:void(0)">script</a>
    `;
    installBridge(win);
    parentPostMessage.mockClear();

    const click = (id: string, modifiers: MouseEventInit = {}, type = "click") => {
      const event = new MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        ...modifiers,
      });
      win.document.getElementById(id)!.dispatchEvent(event);
      return event;
    };

    expect(click("application").defaultPrevented).toBe(false);
    expect(click("application", { metaKey: true }).defaultPrevented).toBe(true);
    expect(click("application", { ctrlKey: true }).defaultPrevented).toBe(true);
    expect(click("application", { button: 1 }, "auxclick").defaultPrevented).toBe(true);
    expect(click("target-application").defaultPrevented).toBe(true);
    expect(click("download-application").defaultPrevented).toBe(true);
    expect(click("application", { shiftKey: true }).defaultPrevented).toBe(true);
    expect(click("application", { altKey: true }).defaultPrevented).toBe(true);
    expect(click("web", { ctrlKey: true }).defaultPrevented).toBe(false);
    expect(click("script", { ctrlKey: true }).defaultPrevented).toBe(false);
    expect(parentPostMessage).not.toHaveBeenCalled();
  });

  it("fallback click interception skips modifier clicks", () => {
    const win = makeFramedWindow();
    const parentPostMessage = vi.spyOn(win.parent, "postMessage");
    Object.defineProperty(win, "navigation", { configurable: true, value: undefined });
    win.document.body.innerHTML = `<a id="link" href="https://example.com/path">go</a>`;
    installBridge(win);
    parentPostMessage.mockClear();

    const link = win.document.getElementById("link")!;
    for (const modifiers of [
      { metaKey: true },
      { ctrlKey: true },
      { shiftKey: true },
      { altKey: true },
    ]) {
      const event = new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        ...modifiers,
      });
      link.dispatchEvent(event);

      expect(event.defaultPrevented).toBe(false);
      expect(parentPostMessage).not.toHaveBeenCalled();
    }
  });

  it("fallback replaceState posts a replace navigation request", () => {
    const win = makeFramedWindow();
    const parentPostMessage = vi.spyOn(win.parent, "postMessage");
    Object.defineProperty(win, "navigation", { configurable: true, value: undefined });
    Object.defineProperty(win.history, "replaceState", { configurable: true, writable: true, value: vi.fn() });
    installBridge(win);
    parentPostMessage.mockClear();

    win.history.replaceState({}, "", win.location.href);

    expect(parentPostMessage).toHaveBeenCalledWith(
      { type: "navigation-request", url: win.location.href, replace: true, sameDocument: true },
      "*",
    );
  });

  // spec: proofs/arch/artifact-frame/artifact-bridge.md#^ab-ac-content-poll-browser-contract
  it("polls TV artifact URLs and reports changed ETags", async () => {
    vi.useFakeTimers();
    const win = makeFramedWindow("http://producer.test/artifact/01J00000000000000000000000/index.html");
    const parentPostMessage = vi.spyOn(win.parent, "postMessage");
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 200, headers: { ETag: '"one"' } }))
      .mockResolvedValueOnce(new Response(null, { status: 200, headers: { ETag: '"one"' } }))
      .mockResolvedValueOnce(new Response(null, { status: 200, headers: { ETag: '"two"' } }));
    Object.defineProperty(win, "fetch", { configurable: true, value: fetch });

    installBridge(win, { reportNavigation: false });
    await vi.advanceTimersByTimeAsync(0);
    expect(parentPostMessage).not.toHaveBeenCalledWith({ type: "proxy-content-changed" }, "*");
    await vi.advanceTimersByTimeAsync(5000);
    expect(parentPostMessage).not.toHaveBeenCalledWith({ type: "proxy-content-changed" }, "*");
    await vi.advanceTimersByTimeAsync(5000);

    expect(fetch).toHaveBeenCalledWith(win.location.href, {
      method: "HEAD",
      signal: expect.objectContaining({ aborted: false }),
    });
    expect(parentPostMessage).toHaveBeenCalledWith({ type: "proxy-content-changed" }, "*");
  });

  // spec: proofs/arch/artifact-frame/artifact-bridge.md#^ab-ac-offline-rejection
  it("backs off after poll errors and self-heals when a changed ETag returns", async () => {
    vi.useFakeTimers();
    const win = makeFramedWindow("http://producer.test/artifact/01J00000000000000000000000/index.html");
    const parentPostMessage = vi.spyOn(win.parent, "postMessage");
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 200, headers: { ETag: '"one"' } }))
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(new Response(null, { status: 200, headers: { ETag: '"two"' } }));
    Object.defineProperty(win, "fetch", { configurable: true, value: fetch });

    installBridge(win, { reportNavigation: false });
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(5000);
    expect(parentPostMessage).not.toHaveBeenCalledWith({ type: "proxy-content-changed" }, "*");
    await vi.advanceTimersByTimeAsync(10000);

    expect(parentPostMessage).toHaveBeenCalledWith({ type: "proxy-content-changed" }, "*");
  });

  // spec: proofs/arch/artifact-frame/artifact-bridge.md#^ab-ac-poll-lifecycle
  it("cancels hidden poll work and resumes one loop with its prior ETag on persisted pageshow", async () => {
    vi.useFakeTimers();
    const win = makeFramedWindow("http://producer.test/artifact/01J00000000000000000000000/index.html");
    const parentPostMessage = vi.spyOn(win.parent, "postMessage");
    let resolveInFlight!: (response: Response) => void;
    let inFlightSignal: AbortSignal | undefined;
    const inFlight = new Promise<Response>((resolve) => {
      resolveInFlight = resolve;
    });
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 200, headers: { ETag: '"one"' } }))
      .mockResolvedValueOnce(new Response(null, { status: 200, headers: { ETag: '"one"' } }))
      .mockImplementationOnce((_url: string, init: RequestInit) => {
        inFlightSignal = init.signal ?? undefined;
        return inFlight;
      })
      .mockResolvedValueOnce(new Response(null, { status: 200, headers: { ETag: '"two"' } }))
      .mockResolvedValueOnce(new Response(null, { status: 200, headers: { ETag: '"two"' } }));
    Object.defineProperty(win, "fetch", { configurable: true, value: fetch });

    installBridge(win, { reportNavigation: false });
    await vi.advanceTimersByTimeAsync(0);
    expect(fetch).toHaveBeenCalledTimes(1);

    win.dispatchEvent(new Event("pagehide"));
    await vi.advanceTimersByTimeAsync(5000);
    expect(fetch).toHaveBeenCalledTimes(1);

    const ordinaryPageshow = new Event("pageshow") as PageTransitionEvent;
    Object.defineProperty(ordinaryPageshow, "persisted", { value: false });
    win.dispatchEvent(ordinaryPageshow);
    await vi.advanceTimersByTimeAsync(5000);
    expect(fetch).toHaveBeenCalledTimes(1);

    const firstRestore = new Event("pageshow") as PageTransitionEvent;
    Object.defineProperty(firstRestore, "persisted", { value: true });
    win.dispatchEvent(firstRestore);
    await vi.advanceTimersByTimeAsync(0);
    expect(fetch).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(5000);
    expect(fetch).toHaveBeenCalledTimes(3);
    win.dispatchEvent(new Event("pagehide"));
    expect(inFlightSignal?.aborted).toBe(true);
    resolveInFlight(new Response(null, { status: 200, headers: { ETag: '"two"' } }));
    await vi.advanceTimersByTimeAsync(15000);
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(parentPostMessage).not.toHaveBeenCalledWith({ type: "proxy-content-changed" }, "*");

    const secondRestore = new Event("pageshow") as PageTransitionEvent;
    Object.defineProperty(secondRestore, "persisted", { value: true });
    win.dispatchEvent(secondRestore);
    const duplicateRestore = new Event("pageshow") as PageTransitionEvent;
    Object.defineProperty(duplicateRestore, "persisted", { value: true });
    win.dispatchEvent(duplicateRestore);
    await vi.advanceTimersByTimeAsync(0);

    expect(fetch).toHaveBeenCalledTimes(4);
    expect(parentPostMessage).toHaveBeenCalledWith({ type: "proxy-content-changed" }, "*");
    await vi.advanceTimersByTimeAsync(5000);
    expect(fetch).toHaveBeenCalledTimes(5);
  });

  // spec: proofs/arch/artifact-frame/artifact-bridge.md#^ab-ac-content-poll-cadence
  it("falls back to production timing for every invalid browser poll cadence", async () => {
    vi.useFakeTimers();
    const invalidCadences = [
      { normalMs: 0, slowMs: 750 },
      { normalMs: Number.NaN, slowMs: 750 },
      { normalMs: Number.POSITIVE_INFINITY, slowMs: 750 },
      { normalMs: 250, slowMs: 0 },
      { normalMs: 250, slowMs: Number.NaN },
      { normalMs: 250, slowMs: Number.POSITIVE_INFINITY },
      { normalMs: 750, slowMs: 250 },
    ];

    for (const pollCadence of invalidCadences) {
      const win = makeFramedWindow("http://producer.test/artifact/01J00000000000000000000000/index.html");
      const fetch = vi.fn().mockResolvedValue(
        new Response(null, { status: 200, headers: { ETag: '"one"' } }),
      );
      Object.defineProperty(win, "fetch", { configurable: true, value: fetch });

      installBridge(win, { reportNavigation: false, pollCadence });
      await vi.advanceTimersByTimeAsync(0);
      expect(fetch).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(4999);
      expect(fetch).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(fetch).toHaveBeenCalledTimes(2);

      win.dispatchEvent(new Event("pagehide"));
      vi.clearAllTimers();
    }
  });

  // spec: proofs/arch/artifact-frame/artifact-bridge.md#^ab-ac-content-poll-browser-contract
  it("does not poll non-TV artifact URLs", async () => {
    vi.useFakeTimers();
    const win = makeFramedWindow("http://producer.test/not-artifact/index.html");
    const fetch = vi.fn();
    Object.defineProperty(win, "fetch", { configurable: true, value: fetch });

    installBridge(win, { reportNavigation: false });
    await vi.advanceTimersByTimeAsync(15000);

    expect(fetch).not.toHaveBeenCalled();
  });

  it("is idempotent — calling twice installs one set of listeners", () => {
    const win = makeFramedWindow();
    const parentPostMessage = vi.spyOn(win.parent, "postMessage");
    installBridge(win);
    installBridge(win);
    parentPostMessage.mockClear();

    win.dispatchEvent(new Event("pagehide"));

    expect(parentPostMessage).toHaveBeenCalledTimes(1);
    expect(parentPostMessage).toHaveBeenCalledWith(
      { type: "leaving", guid: expect.any(String) },
      "*",
    );
  });
});

describe("bridgeScriptSource", () => {
  it("returns a self-executing IIFE string with the helper needed by transformed dev output", () => {
    const source = bridgeScriptSource();
    expect(source).toMatch(/^\(function\(\)\{/);
    expect(source).toContain("const __name=(target)=>target;");
    expect(source).toMatch(/\)\(window,\{\}\);\}\)\(\);$/);
    expect(source).toContain("addEventListener");
  });

  it("serializes a test poll cadence into injected bridge options", () => {
    const source = bridgeScriptSource({ pollCadence: { normalMs: 250, slowMs: 750 } });

    expect(source).toContain('"pollCadence":{"normalMs":250,"slowMs":750}');
  });

  it("produces runnable source that behaves like installBridge when eval'd in a fresh window", async () => {
    vi.useFakeTimers();
    const win = makeFramedWindow("http://producer.test/artifact/01J00000000000000000000000/index.html");
    Object.defineProperty(win.navigator, "platform", {
      configurable: true,
      value: "MacIntel",
    });
    const fetch = vi.fn().mockResolvedValue(
      new Response(null, { status: 200, headers: { ETag: '"one"' } }),
    );
    Object.defineProperty(win, "fetch", { configurable: true, value: fetch });
    Object.defineProperty(win, "matchMedia", {
      configurable: true,
      value: vi.fn(() => ({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    });
    const parentPostMessage = vi.spyOn(win.parent, "postMessage");

    // Evaluate the source in the context of the framed window. We do
    // this by injecting a <script> element; jsdom runs it synchronously.
    const doc = win.document;
    const root = doc.documentElement ?? doc.appendChild(doc.createElement("html"));
    const body = doc.body ?? root.appendChild(doc.createElement("body"));
    const script = doc.createElement("script");
    script.textContent = bridgeScriptSource();
    body.appendChild(script);
    await vi.advanceTimersByTimeAsync(0);

    const ready = parentPostMessage.mock.calls.find(([message]) => {
      return (message as { type?: string }).type === "bridge-ready";
    })?.[0] as { guid: string } | undefined;
    if (!ready) throw new Error("Expected bridge-ready");
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(win.location.href, {
      method: "HEAD",
      signal: expect.objectContaining({ aborted: false }),
    });
    parentPostMessage.mockClear();

    const chord = keyboardEvent(win, { key: "ArrowRight", altKey: true });
    win.document.body.dispatchEvent(chord);
    win.dispatchEvent(new Event("pagehide"));

    expect(chord.defaultPrevented).toBe(true);
    expect(parentPostMessage).toHaveBeenCalledWith(
      { type: "navigation-key", key: "ArrowRight" },
      "*",
    );
    expect(parentPostMessage).toHaveBeenCalledWith(
      { type: "leaving", guid: ready.guid },
      "*",
    );
  });
});

describe("isNavigationKeyNotification", () => {
  it("accepts valid navigation key notifications", () => {
    for (const key of ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"] as const) {
      expect(isNavigationKeyNotification({ type: "navigation-key", key })).toBe(true);
    }
  });

  it("rejects invalid navigation key notifications", () => {
    expect(isNavigationKeyNotification({ type: "navigation-key" })).toBe(false);
    expect(isNavigationKeyNotification({ type: "navigation-key", key: "Home" })).toBe(false);
    expect(isNavigationKeyNotification({ type: "navigation-key", key: 1 })).toBe(false);
    expect(isNavigationKeyNotification({ type: "navigation-key", key: "ArrowLeft", id: "abc" })).toBe(false);
    expect(isNavigationKeyNotification({ type: "filmstrip-key", key: "ArrowLeft" })).toBe(false);
    expect(isNavigationKeyNotification(null)).toBe(false);
    expect(isNavigationKeyNotification("navigation-key")).toBe(false);
  });
});

describe("isBridgeReadyNotification", () => {
  it("accepts bridge-ready notifications", () => {
    expect(isBridgeReadyNotification({ type: "bridge-ready", guid: "guid-1" })).toBe(true);
  });

  it("rejects malformed bridge-ready notifications", () => {
    expect(isBridgeReadyNotification({ type: "bridge-ready" })).toBe(false);
    expect(isBridgeReadyNotification({ type: "bridge-ready", guid: 1 })).toBe(false);
    expect(isBridgeReadyNotification({ type: "bridge-ready", guid: "guid-1", id: "abc" })).toBe(false);
    expect(isBridgeReadyNotification({ type: "leaving", guid: "guid-1" })).toBe(false);
    expect(isBridgeReadyNotification(null)).toBe(false);
    expect(isBridgeReadyNotification("bridge-ready")).toBe(false);
  });
});

describe("isBridgeLeavingNotification", () => {
  it("accepts leaving notifications", () => {
    expect(isBridgeLeavingNotification({ type: "leaving", guid: "guid-1" })).toBe(true);
  });

  it("rejects malformed leaving notifications", () => {
    expect(isBridgeLeavingNotification({ type: "leaving" })).toBe(false);
    expect(isBridgeLeavingNotification({ type: "leaving", guid: 1 })).toBe(false);
    expect(isBridgeLeavingNotification({ type: "leaving", guid: "guid-1", id: "abc" })).toBe(false);
    expect(isBridgeLeavingNotification({ type: "bridge-ready", guid: "guid-1" })).toBe(false);
    expect(isBridgeLeavingNotification(null)).toBe(false);
  });
});

describe("isProxyContentChangedNotification", () => {
  it("accepts proxy content changed notifications", () => {
    expect(isProxyContentChangedNotification({ type: "proxy-content-changed" })).toBe(true);
  });

  it("rejects id-bearing or unrelated messages", () => {
    expect(isProxyContentChangedNotification({ type: "proxy-content-changed", id: "abc" })).toBe(false);
    expect(isProxyContentChangedNotification({ type: "content-updated" })).toBe(false);
    expect(isProxyContentChangedNotification(null)).toBe(false);
  });
});

describe("isNavigationRequest", () => {
  it("accepts valid navigation requests", () => {
    expect(isNavigationRequest({ type: "navigation-request", url: "https://example.com" })).toBe(true);
    expect(
      isNavigationRequest({
        type: "navigation-request",
        url: "/artifact/a/page.html",
        replace: true,
        sameDocument: true,
        native: false,
      }),
    ).toBe(true);
  });

  it("rejects invalid navigation requests", () => {
    expect(isNavigationRequest({ type: "navigation-request" })).toBe(false);
    expect(isNavigationRequest({ type: "navigation-request", url: 1 })).toBe(false);
    expect(isNavigationRequest({ type: "navigation-request", url: "/", replace: "yes" })).toBe(false);
    expect(isNavigationRequest({ type: "navigation-request", url: "/", sameDocument: "yes" })).toBe(false);
    expect(isNavigationRequest({ type: "navigation-request", url: "/", native: "yes" })).toBe(false);
    expect(isNavigationRequest({ type: "navigation-request", url: "/", id: "abc" })).toBe(false);
    expect(isNavigationRequest({ type: "url-target", url: "/" })).toBe(false);
    expect(isNavigationRequest(null)).toBe(false);
    expect(isNavigationRequest("navigation-request")).toBe(false);
  });
});

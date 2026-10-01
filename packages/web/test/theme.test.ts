// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";

interface ThemeRegistrySnapshot {
  themes: Array<{
    id: string;
    name: string;
    version: string;
    enableIframeBackgroundJS?: boolean;
    enableIframeOverlayJS?: boolean;
  }>;
  errors: unknown[];
}

interface ThemeModule {
  refreshThemeLink(serverURL: string): HTMLLinkElement;
  clearThemeLink(): void;
  getThemeLink(): HTMLLinkElement | null;
  refreshThemeScript(serverURL: string): HTMLScriptElement;
  clearThemeScript(): void;
  getThemeScript(): HTMLScriptElement | null;
  refreshThemeFrames(
    serverURL: string,
    activeThemeID: string | null,
    listThemes: () => Promise<ThemeRegistrySnapshot>,
  ): Promise<void>;
  clearThemeFrames(): void;
  getThemeFrame(kind: "background" | "overlay"): HTMLIFrameElement | null;
}

type AddedDocumentListener = [
  type: string,
  listener: EventListenerOrEventListenerObject | null,
  options?: boolean | AddEventListenerOptions,
];

const FIXED_TIME = 1_700_000_000_000;
const SERVER_URL = "https://television.example:32848/path";

let theme: ThemeModule;
let documentAddEventListener: MockInstance<Document["addEventListener"]>;
let windowAddEventListener: MockInstance<Window["addEventListener"]>;

function registry(
  id: string,
  declarations: {
    enableIframeBackgroundJS?: boolean;
    enableIframeOverlayJS?: boolean;
  } = {},
): ThemeRegistrySnapshot {
  return {
    themes: [{ id, name: id, version: "1.0.0", ...declarations }],
    errors: [],
  };
}

function expectedFrameDocument(
  scriptURL: string,
  appearance: "light" | "dark",
): string {
  return `<!doctype html>
<html data-theme="${appearance}">
<head>
<meta charset="utf-8">
<style>
html, body {
  width: 100%;
  height: 100%;
  margin: 0;
  overflow: hidden;
  background: transparent;
  color-scheme: ${appearance};
}
</style>
</head>
<body>
<script src="${scriptURL}"></script>
</body>
</html>`;
}

function getDocumentListener(type: string): EventListener {
  const calls = documentAddEventListener.mock.calls.filter(
    ([eventType]) => eventType === type,
  ) as AddedDocumentListener[];
  expect(calls, `document ${type} listeners`).toHaveLength(1);
  const call = calls[0];
  expect(call, `document ${type} listener`).toBeDefined();
  expect(call?.[2]).toMatchObject({ capture: true });
  const listener = call?.[1];
  if (typeof listener !== "function") {
    throw new Error(`Expected callable document ${type} listener`);
  }
  return listener;
}

beforeEach(async () => {
  vi.resetModules();
  document.documentElement.dataset.theme = "light";
  document.head.innerHTML = '<link rel="stylesheet" href="/application.css">';
  document.body.innerHTML = `
    <div id="app" tabindex="-1"><button id="application-control">Control</button></div>
    <div id="foreground-overlay" inert aria-hidden="true"></div>
  `;
  documentAddEventListener = vi.spyOn(document, "addEventListener");
  windowAddEventListener = vi.spyOn(window, "addEventListener");
  theme = await import("../src/theme.ts");
});

afterEach(() => {
  theme.clearThemeLink();
  theme.clearThemeScript();
  if (typeof theme.clearThemeFrames === "function") theme.clearThemeFrames();
  vi.restoreAllMocks();
});

describe("application active-theme link", () => {
  // proofs/arch/themes/delivery.md#^theme-delivery-t-style-notification
  it("notifies only for current stylesheet settlement and removal", () => {
    const notified = vi.fn();
    document.addEventListener("television-theme-styles-changed", notified);
    try {
      const stale = theme.refreshThemeLink(SERVER_URL);
      const current = theme.refreshThemeLink(SERVER_URL);
      expect(notified).not.toHaveBeenCalled();
      stale.dispatchEvent(new Event("load"));
      stale.dispatchEvent(new Event("error"));
      expect(notified).not.toHaveBeenCalled();
      current.dispatchEvent(new Event("load"));
      expect(notified).toHaveBeenCalledTimes(1);
      expect(notified.mock.calls[0]![0]).toBeInstanceOf(Event);
      expect(notified.mock.calls[0]![0]).not.toHaveProperty("detail");
      const failed = theme.refreshThemeLink(SERVER_URL);
      failed.dispatchEvent(new Event("error"));
      expect(notified).toHaveBeenCalledTimes(2);
      theme.clearThemeLink();
      expect(notified).toHaveBeenCalledTimes(3);
      failed.dispatchEvent(new Event("load"));
      theme.clearThemeLink();
      expect(notified).toHaveBeenCalledTimes(3);
    } finally {
      document.removeEventListener("television-theme-styles-changed", notified);
    }
  });

  it("links the public stable route on the connected server", () => {
    const link = theme.refreshThemeLink(SERVER_URL);

    const url = new URL(link.href);
    expect(link.rel).toBe("stylesheet");
    expect(url.origin).toBe("https://television.example:32848");
    expect(url.pathname).toBe("/theme/theme.css");
    expect(url.searchParams.get("tv-theme")).toBeTruthy();
    expect(link.dataset.televisionStyle).toBe("television-active-theme");
  });

  it("uses a link without fetching CSS or attaching authorization", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const link = theme.refreshThemeLink("http://example.test");

    const url = new URL(link.href);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(link.getAttribute("crossorigin")).toBeNull();
    expect(url.origin).toBe("http://example.test");
    expect(url.pathname).toBe("/theme/theme.css");
  });

  it("clears the link on disconnect", () => {
    theme.refreshThemeLink("http://example.test");
    theme.clearThemeLink();

    expect(theme.getThemeLink()).toBeNull();
    expect(document.querySelector('[data-television-style="television-active-theme"]')).toBeNull();
  });

  it("replaces the previous node so a stale load cannot become current", () => {
    const first = theme.refreshThemeLink("http://first.example");
    const second = theme.refreshThemeLink("http://second.example");

    expect(first.isConnected).toBe(false);
    expect(second.isConnected).toBe(true);
    expect(second.href).not.toBe(first.href);
    expect(theme.getThemeLink()).toBe(second);
    expect(document.querySelectorAll('[data-television-style="television-active-theme"]')).toHaveLength(1);
  });

  it("keeps every setup and refresh link last in document stylesheet order", () => {
    theme.refreshThemeLink("http://example.test");
    const viewStyle = document.createElement("style");
    viewStyle.textContent = ".view {}";
    document.head.append(viewStyle);

    const refreshed = theme.refreshThemeLink("http://example.test");
    const styleNodes = [...document.head.querySelectorAll("link[rel=stylesheet], style")];
    expect(styleNodes.at(-1)).toBe(refreshed);
  });

  it("does not change the link when confirmed appearance changes", async () => {
    const link = theme.refreshThemeLink("http://example.test");
    const setPreference = vi.fn();
    window.__televisionAppearanceResolver = { setPreference };
    const { applyConfirmedAppearance } = await import("../src/appearance.ts");

    applyConfirmedAppearance("dark");

    expect(setPreference).toHaveBeenCalledWith("dark");
    expect(theme.getThemeLink()).toBe(link);
    expect(link.isConnected).toBe(true);
  });
});

describe("application active-theme script", () => {
  // proofs/arch/themes/delivery.md#^theme-delivery-t-app-script-module
  it("installs one cache-busted classic script from the connected server", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const script = theme.refreshThemeScript(SERVER_URL);

    const url = new URL(script.src);
    expect(url.origin).toBe("https://television.example:32848");
    expect(url.pathname).toBe("/theme/main.js");
    expect(url.searchParams.get("tv-theme")).toBeTruthy();
    expect(script.getAttribute("type")).toBeNull();
    expect(script.getAttribute("crossorigin")).toBeNull();
    expect(script.dataset.televisionScript).toBe("television-active-theme");
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(document.head.querySelectorAll(
      'script[data-television-script="television-active-theme"]',
    )).toHaveLength(1);
  });

  it("removes the prior script before appending its replacement and clears it", () => {
    const first = theme.refreshThemeScript("http://first.example");
    const originalAppend = document.head.append.bind(document.head);
    const append = vi.spyOn(document.head, "append").mockImplementation((...nodes) => {
      expect(first.isConnected).toBe(false);
      originalAppend(...nodes);
    });

    const second = theme.refreshThemeScript("http://second.example");

    expect(append).toHaveBeenCalledOnce();
    expect(first.isConnected).toBe(false);
    expect(second.isConnected).toBe(true);
    expect(second.src).not.toBe(first.src);
    expect(theme.getThemeScript()).toBe(second);
    expect(document.head.querySelectorAll(
      'script[data-television-script="television-active-theme"]',
    )).toHaveLength(1);

    theme.clearThemeScript();
    expect(second.isConnected).toBe(false);
    expect(theme.getThemeScript()).toBeNull();
  });

  // proofs/arch/themes/delivery.md#^theme-delivery-t-app-script-module
  it("leaves stylesheet and sandboxed frame identity and ordering unchanged", async () => {
    const link = theme.refreshThemeLink("http://example.test");
    const stylesBefore = [...document.head.querySelectorAll("link[rel=stylesheet], style")];
    await theme.refreshThemeFrames(
      SERVER_URL,
      "Theme.ID",
      async () => registry("Theme.ID", {
        enableIframeBackgroundJS: true,
        enableIframeOverlayJS: true,
      }),
    );
    const background = theme.getThemeFrame("background");
    const overlay = theme.getThemeFrame("overlay");

    theme.refreshThemeScript("http://example.test");
    theme.refreshThemeScript("http://example.test");

    expect(theme.getThemeLink()).toBe(link);
    expect(link.isConnected).toBe(true);
    expect([...document.head.querySelectorAll("link[rel=stylesheet], style")])
      .toEqual(stylesBefore);
    expect(theme.getThemeFrame("background")).toBe(background);
    expect(theme.getThemeFrame("overlay")).toBe(overlay);
    theme.clearThemeScript();
    expect(theme.getThemeFrame("background")).toBe(background);
    expect(theme.getThemeFrame("overlay")).toBe(overlay);
    expect([...document.body.children].map((element) => element.id)).toEqual([
      "theme-iframe-background",
      "app",
      "foreground-overlay",
      "theme-iframe-overlay",
    ]);
  });
});

describe("sandboxed theme frame documents", () => {
  // proofs/arch/themes/delivery.md#^theme-delivery-t-frame-document
  // proofs/ui/app/index.md#^ap-ac-theme-layers
  it("creates independent and joint frames with exact documents, attributes, and body order", async () => {
    vi.spyOn(Date, "now").mockReturnValue(FIXED_TIME);
    const listThemes = vi.fn();

    listThemes.mockResolvedValueOnce(registry("Theme.ID", {
      enableIframeBackgroundJS: true,
    }));
    await theme.refreshThemeFrames(SERVER_URL, "Theme.ID", listThemes);
    const background = theme.getThemeFrame("background");
    expect(background).not.toBeNull();
    expect(theme.getThemeFrame("overlay")).toBeNull();
    expect([...document.body.children].map((element) => element.id))
      .toEqual(["theme-iframe-background", "app", "foreground-overlay"]);
    expect(background?.getAttributeNames().sort()).toEqual([
      "aria-hidden", "id", "inert", "sandbox", "srcdoc", "tabindex",
    ]);
    expect(background?.getAttribute("sandbox")).toBe("allow-scripts");
    expect(background?.getAttribute("inert")).toBe("");
    expect(background?.getAttribute("tabindex")).toBe("-1");
    expect(background?.getAttribute("aria-hidden")).toBe("true");
    expect(background?.srcdoc).toBe(expectedFrameDocument(
      `${SERVER_URL.replace("/path", "")}/theme/iframe-background.js?tv-theme=${FIXED_TIME}-1`,
      "light",
    ));

    listThemes.mockResolvedValueOnce(registry("Theme.ID", {
      enableIframeOverlayJS: true,
    }));
    await theme.refreshThemeFrames(SERVER_URL, "Theme.ID", listThemes);
    const overlay = theme.getThemeFrame("overlay");
    expect(theme.getThemeFrame("background")).toBeNull();
    expect([...document.body.children].map((element) => element.id))
      .toEqual(["app", "foreground-overlay", "theme-iframe-overlay"]);
    expect(overlay?.getAttributeNames().sort()).toEqual([
      "aria-hidden", "id", "inert", "sandbox", "srcdoc", "tabindex",
    ]);
    expect(overlay?.getAttribute("sandbox")).toBe("allow-scripts");
    expect(overlay?.getAttribute("inert")).toBe("");
    expect(overlay?.getAttribute("tabindex")).toBe("-1");
    expect(overlay?.getAttribute("aria-hidden")).toBe("true");
    expect(overlay?.srcdoc).toBe(expectedFrameDocument(
      `${SERVER_URL.replace("/path", "")}/theme/iframe-overlay.js?tv-theme=${FIXED_TIME}-2`,
      "light",
    ));

    listThemes.mockResolvedValueOnce(registry("Theme.ID", {
      enableIframeBackgroundJS: true,
      enableIframeOverlayJS: true,
    }));
    await theme.refreshThemeFrames(SERVER_URL, "Theme.ID", listThemes);
    expect([...document.body.children].map((element) => element.id)).toEqual([
      "theme-iframe-background",
      "app",
      "foreground-overlay",
      "theme-iframe-overlay",
    ]);
    expect(theme.getThemeFrame("background")?.srcdoc).toBe(expectedFrameDocument(
      `${SERVER_URL.replace("/path", "")}/theme/iframe-background.js?tv-theme=${FIXED_TIME}-3`,
      "light",
    ));
    expect(theme.getThemeFrame("overlay")?.srcdoc).toBe(expectedFrameDocument(
      `${SERVER_URL.replace("/path", "")}/theme/iframe-overlay.js?tv-theme=${FIXED_TIME}-4`,
      "light",
    ));

    listThemes.mockResolvedValueOnce(registry("Theme.ID", {
      enableIframeBackgroundJS: false,
      enableIframeOverlayJS: false,
    }));
    await theme.refreshThemeFrames(SERVER_URL, "Theme.ID", listThemes);
    expect(theme.getThemeFrame("background")).toBeNull();
    expect(theme.getThemeFrame("overlay")).toBeNull();

    listThemes.mockResolvedValueOnce(registry("Theme.ID"));
    await theme.refreshThemeFrames(SERVER_URL, "Theme.ID", listThemes);
    expect(theme.getThemeFrame("background")).toBeNull();
    expect(theme.getThemeFrame("overlay")).toBeNull();

    listThemes.mockResolvedValueOnce(registry("Different.ID", {
      enableIframeBackgroundJS: true,
      enableIframeOverlayJS: true,
    }));
    await theme.refreshThemeFrames(SERVER_URL, "Theme.ID", listThemes);
    expect(theme.getThemeFrame("background")).toBeNull();
    expect(theme.getThemeFrame("overlay")).toBeNull();
    expect(listThemes).toHaveBeenCalledTimes(6);
  });

  // proofs/arch/themes/delivery.md#^theme-delivery-t-frame-appearance-document
  it("bakes light and dark appearance into both frame documents", async () => {
    vi.spyOn(Date, "now").mockReturnValue(FIXED_TIME);
    const cases = [
      { appearance: "light", kind: "background" },
      { appearance: "light", kind: "overlay" },
      { appearance: "dark", kind: "background" },
      { appearance: "dark", kind: "overlay" },
    ] as const;

    for (const [index, { appearance, kind }] of cases.entries()) {
      document.documentElement.dataset.theme = appearance;
      await theme.refreshThemeFrames(
        SERVER_URL,
        "Theme.ID",
        async () => registry("Theme.ID", kind === "background"
          ? { enableIframeBackgroundJS: true }
          : { enableIframeOverlayJS: true }),
      );

      const route = kind === "background" ? "iframe-background.js" : "iframe-overlay.js";
      expect(theme.getThemeFrame(kind)?.srcdoc).toBe(expectedFrameDocument(
        `${SERVER_URL.replace("/path", "")}/theme/${route}?tv-theme=${FIXED_TIME}-${index + 1}`,
        appearance,
      ));
    }
  });

  it("destroys both frames before replacement and keeps link and main script independent", async () => {
    const link = theme.refreshThemeLink(SERVER_URL);
    const script = theme.refreshThemeScript(SERVER_URL);
    await theme.refreshThemeFrames(
      SERVER_URL,
      "Theme.ID",
      async () => registry("Theme.ID", {
        enableIframeBackgroundJS: true,
        enableIframeOverlayJS: true,
      }),
    );
    const firstBackground = theme.getThemeFrame("background")!;
    const firstOverlay = theme.getThemeFrame("overlay")!;
    let resolveRegistry!: (snapshot: ThemeRegistrySnapshot) => void;
    const pendingRegistry = new Promise<ThemeRegistrySnapshot>((resolve) => {
      resolveRegistry = resolve;
    });

    const replacement = theme.refreshThemeFrames(
      SERVER_URL,
      "Theme.ID",
      async () => pendingRegistry,
    );

    expect(firstBackground.isConnected).toBe(false);
    expect(firstOverlay.isConnected).toBe(false);
    expect(theme.getThemeFrame("background")).toBeNull();
    expect(theme.getThemeFrame("overlay")).toBeNull();
    expect(theme.getThemeLink()).toBe(link);
    expect(theme.getThemeScript()).toBe(script);

    resolveRegistry(registry("Theme.ID", { enableIframeBackgroundJS: true }));
    await replacement;
    expect(theme.getThemeFrame("background")).not.toBe(firstBackground);
    expect(theme.getThemeFrame("overlay")).toBeNull();
    expect(theme.getThemeLink()).toBe(link);
    expect(theme.getThemeScript()).toBe(script);

    theme.clearThemeFrames();
    expect(theme.getThemeFrame("background")).toBeNull();
    expect(theme.getThemeFrame("overlay")).toBeNull();
    expect(theme.getThemeLink()).toBe(link);
    expect(theme.getThemeScript()).toBe(script);
  });
});

describe("sandboxed theme frame pointer and focus protection", () => {
  // proofs/arch/themes/delivery.md#^theme-delivery-t-frame-pointer
  it("forwards the closed trusted pointer protocol without interfering or replaying", async () => {
    await theme.refreshThemeFrames(
      SERVER_URL,
      "Theme.ID",
      async () => registry("Theme.ID", {
        enableIframeBackgroundJS: true,
        enableIframeOverlayJS: true,
      }),
    );
    const backgroundWindow = theme.getThemeFrame("background")!.contentWindow!;
    const overlayWindow = theme.getThemeFrame("overlay")!.contentWindow!;
    const backgroundPost = vi.spyOn(backgroundWindow, "postMessage");
    const overlayPost = vi.spyOn(overlayWindow, "postMessage");
    const preventDefault = vi.fn();
    const stopPropagation = vi.fn();
    const stopImmediatePropagation = vi.fn();
    const setPointerCapture = vi.fn();
    const releasePointerCapture = vi.fn();
    const target = { setPointerCapture, releasePointerCapture };

    const rows = [
      {
        event: "pointermove",
        input: { button: 2, buttons: 5 },
        output: { type: "television-theme-pointer-move", button: -1, buttons: 5 },
      },
      {
        event: "pointerdown",
        input: { button: 0, buttons: 1 },
        output: { type: "television-theme-pointer-down", button: 0, buttons: 1 },
      },
      {
        event: "pointerup",
        input: { button: 2, buttons: 1 },
        output: { type: "television-theme-pointer-up", button: 2, buttons: 1 },
      },
      {
        event: "pointercancel",
        input: { button: 2, buttons: 4 },
        output: { type: "television-theme-pointer-cancel", button: -1, buttons: 0 },
      },
      {
        event: "click",
        input: { button: 1, buttons: 3 },
        output: { type: "television-theme-pointer-click", button: 1, buttons: 0 },
      },
    ] as const;

    for (const row of rows) {
      getDocumentListener(row.event)({
        type: row.event,
        isTrusted: true,
        clientX: 123.25,
        clientY: 45.5,
        ...row.input,
        target,
        preventDefault,
        stopPropagation,
        stopImmediatePropagation,
      } as unknown as Event);
      const message = {
        ...row.output,
        clientX: 123.25,
        clientY: 45.5,
      };
      expect(backgroundPost).toHaveBeenLastCalledWith(message, "*");
      expect(overlayPost).toHaveBeenLastCalledWith(message, "*");
    }
    expect(backgroundPost).toHaveBeenCalledTimes(rows.length);
    expect(overlayPost).toHaveBeenCalledTimes(rows.length);
    expect(preventDefault).not.toHaveBeenCalled();
    expect(stopPropagation).not.toHaveBeenCalled();
    expect(stopImmediatePropagation).not.toHaveBeenCalled();
    expect(setPointerCapture).not.toHaveBeenCalled();
    expect(releasePointerCapture).not.toHaveBeenCalled();

    getDocumentListener("pointermove")({
      isTrusted: false,
      clientX: 1,
      clientY: 2,
      button: -1,
      buttons: 0,
    } as unknown as Event);
    expect(backgroundPost).toHaveBeenCalledTimes(rows.length);
    expect(overlayPost).toHaveBeenCalledTimes(rows.length);

    theme.clearThemeFrames();
    getDocumentListener("click")({
      isTrusted: true,
      clientX: 1,
      clientY: 2,
      button: 0,
      buttons: 0,
    } as unknown as Event);
    expect(backgroundPost).toHaveBeenCalledTimes(rows.length);
    expect(overlayPost).toHaveBeenCalledTimes(rows.length);

    await theme.refreshThemeFrames(
      SERVER_URL,
      "Theme.ID",
      async () => registry("Theme.ID", { enableIframeBackgroundJS: true }),
    );
    const replacementPost = vi.spyOn(
      theme.getThemeFrame("background")!.contentWindow!,
      "postMessage",
    );
    expect(replacementPost).not.toHaveBeenCalled();
  });

  it("accepts no frame-originated command or reply path", async () => {
    await theme.refreshThemeFrames(
      SERVER_URL,
      "Theme.ID",
      async () => registry("Theme.ID", {
        enableIframeBackgroundJS: true,
        enableIframeOverlayJS: true,
      }),
    );
    expect(documentAddEventListener.mock.calls.filter(([type]) => type === "message"))
      .toEqual([]);
    expect(windowAddEventListener.mock.calls.filter(([type]) => type === "message"))
      .toEqual([]);
    const backgroundWindow = theme.getThemeFrame("background")!.contentWindow!;
    const overlayWindow = theme.getThemeFrame("overlay")!.contentWindow!;
    const backgroundPost = vi.spyOn(backgroundWindow, "postMessage");
    const overlayPost = vi.spyOn(overlayWindow, "postMessage");

    window.dispatchEvent(new MessageEvent("message", {
      source: backgroundWindow,
      data: { type: "run-host-operation" },
    }));
    window.dispatchEvent(new MessageEvent("message", {
      source: overlayWindow,
      data: { type: "run-host-operation" },
    }));

    expect(backgroundPost).not.toHaveBeenCalled();
    expect(overlayPost).not.toHaveBeenCalled();
  });

  // proofs/arch/themes/delivery.md#^theme-delivery-t-frame-lifecycle
  it("remembers ordinary application focus and restores accidental current-frame focus", async () => {
    await theme.refreshThemeFrames(
      SERVER_URL,
      "Theme.ID",
      async () => registry("Theme.ID", {
        enableIframeBackgroundJS: true,
        enableIframeOverlayJS: true,
      }),
    );
    const focusListener = getDocumentListener("focusin");
    const applicationControl = document.querySelector<HTMLElement>("#application-control")!;
    const applicationRoot = document.querySelector<HTMLElement>("#app")!;
    const controlFocus = vi.spyOn(applicationControl, "focus");
    const rootFocus = vi.spyOn(applicationRoot, "focus");

    focusListener({ target: applicationControl } as unknown as Event);
    expect(controlFocus).not.toHaveBeenCalled();
    expect(rootFocus).not.toHaveBeenCalled();
    const disconnectedControl = document.createElement("button");
    focusListener({ target: disconnectedControl } as unknown as Event);
    focusListener({
      target: document.querySelector("#foreground-overlay"),
    } as unknown as Event);

    focusListener({ target: theme.getThemeFrame("background") } as unknown as Event);
    expect(controlFocus).toHaveBeenCalledOnce();
    expect(controlFocus).toHaveBeenCalledWith({ preventScroll: true });
    expect(rootFocus).not.toHaveBeenCalled();

    applicationControl.remove();
    focusListener({ target: theme.getThemeFrame("overlay") } as unknown as Event);
    expect(rootFocus).toHaveBeenCalledOnce();
    expect(rootFocus).toHaveBeenCalledWith({ preventScroll: true });
  });
});

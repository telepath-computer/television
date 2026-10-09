// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { html, render } from "lit-html";
import { view } from "@telepath-computer/utils/lit-view";
import {
  ArtifactView,
  convertURLForInternalOrigin,
  type ArtifactViewOptions,
} from "../src/views/artifact-view.ts";
import {
  ArtifactDocumentHostView,
  type ArtifactDocumentHost,
} from "../src/views/artifact-document-host.ts";
import {
  ArtifactTrustedChannel,
  type ArtifactFrameInboundMessage,
} from "../src/components/artifact-trusted-channel.ts";
import type { Artifact } from "@telepath-computer/television-artifact";
import { ArtifactContentChangedEvent, RequestError, ThemeChangedEvent } from "@telepath-computer/television-shared";
import {
  type ArtifactNavigationState,
  artifactNavigationStorageKey,
  type ArtifactNavigationRecord,
} from "../src/services/artifact-navigation-state.ts";
import { installNativeDialogMock } from "./helpers/dialog.ts";

const WEBVIEW_BRIDGE_CHANNEL = "television-artifact-bridge";
const APPLICATION_LINK_HOST_CHANNEL = "television-application-link";

function createApplication(markdown: {
  get(input: { artifactID: string }): Promise<string>;
  update(input: { artifactID: string; content: string }): Promise<void>;
} = {
  get: vi.fn(async () => ""),
  update: vi.fn(async () => undefined),
}) {
  return Object.assign(new EventTarget(), {
    markdown,
    handleNavigationKey: vi.fn(),
    readMarkdown: (artifactID: string) => markdown.get({ artifactID }),
    writeMarkdown: (artifactID: string, content: string) =>
      markdown.update({ artifactID, content }),
  });
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

let drawingHost: ArtifactViewTestHost | null = null;

class CapturedArtifactView extends ArtifactView {
  override update(...args: Parameters<ArtifactView["update"]>): unknown {
    if (drawingHost) drawingHost.view = this;
    return super.update(...args);
  }
}

const CapturedArtifactViewView = view(CapturedArtifactView);

class ArtifactViewTestHost extends HTMLElement {
  #artifact: Artifact | null = null;
  #application = createApplication();
  #viewURL: string | null = null;
  #contentURL: string | null = null;
  #fullScreen = false;
  #onFullScreenChange: (fullScreen: boolean) => void = () => {};
  #part: ReturnType<typeof render> | null = null;
  view: ArtifactView | null = null;

  get artifact(): Artifact {
    if (!this.#artifact) throw new Error("Artifact view test host has no artifact");
    return this.#artifact;
  }

  set artifact(value: Artifact) {
    this.#artifact = value;
    this.#draw();
  }

  get application(): ReturnType<typeof createApplication> {
    return this.#application;
  }

  set application(value: ReturnType<typeof createApplication>) {
    this.#application = value;
    this.#draw();
  }

  get viewURL(): string | null {
    return this.#viewURL;
  }

  set viewURL(value: string | null) {
    this.#viewURL = value;
    this.#draw();
  }

  get contentURL(): string | null {
    return this.#contentURL;
  }

  set contentURL(value: string | null) {
    this.#contentURL = value;
    this.#draw();
  }

  get fullScreen(): boolean {
    return this.#fullScreen;
  }

  set fullScreen(value: boolean) {
    this.#fullScreen = value;
    this.#draw();
  }

  set onFullScreenChange(value: (fullScreen: boolean) => void) {
    this.#onFullScreenChange = value;
    this.#draw();
  }

  rerender(): void {
    this.#draw();
  }

  connectedCallback(): void {
    this.#part?.setConnected(true);
    this.#draw();
  }

  disconnectedCallback(): void {
    this.#part?.setConnected(false);
  }

  #draw(): void {
    if (!this.isConnected || !this.#artifact) return;
    const options: ArtifactViewOptions = {
      viewURL: this.#viewURL,
      contentURL: this.#contentURL,
      fullScreen: this.#fullScreen,
      inert: false,
      onFullScreenChange: this.#onFullScreenChange,
    };
    drawingHost = this;
    try {
      this.#part = render(
        CapturedArtifactViewView(this.#application as never, this.#artifact, options),
        this,
      );
    } finally {
      drawingHost = null;
    }
  }
}

if (!customElements.get("artifact-view-test-host")) {
  customElements.define("artifact-view-test-host", ArtifactViewTestHost);
}

function createHost(artifact: Artifact): ArtifactViewTestHost {
  const host = document.createElement("artifact-view-test-host") as ArtifactViewTestHost;
  host.artifact = artifact;
  return host;
}

function mount(artifact: Artifact): ArtifactViewTestHost {
  const host = createHost(artifact);
  document.body.appendChild(host);
  return host;
}

function mountAfterArtifactSet(artifact: Artifact): ArtifactViewTestHost {
  const host = createHost(artifact);
  expect(host.querySelector("iframe")).toBeNull();
  document.body.appendChild(host);
  return host;
}

function mountFrameContract(options: {
  artifact: Artifact;
  application: ReturnType<typeof createApplication>;
  fullScreen?: boolean;
}): ArtifactViewTestHost {
  const el = createHost(options.artifact);
  el.fullScreen = options.fullScreen ?? false;
  el.application = options.application;
  document.body.appendChild(el);
  return el;
}

function setNavigationFixture(
  artifactID: string,
  entries: readonly string[],
  cursor: number,
): void {
  if (entries.length === 0) return;
  localStorage.setItem(
    artifactNavigationStorageKey(artifactID),
    JSON.stringify({
      v: 1,
      entries: entries.map((url) => ({ url })),
      cursor,
      lastWritten: Date.now(),
    } satisfies ArtifactNavigationRecord),
  );
}

function frame(el: HTMLElement): HTMLIFrameElement {
  const iframe = el.querySelector("iframe");
  if (!iframe) throw new Error("Expected iframe");
  return iframe;
}

function button(el: HTMLElement, label: string): HTMLButtonElement {
  const match = el.querySelector<HTMLButtonElement>(`button[aria-label='${label}']`);
  if (!match) throw new Error(`Expected ${label} button`);
  return match;
}

function dispatchApplicationLinkRequest(webview: HTMLElement, value: unknown): void {
  webview.dispatchEvent(new CustomEvent("ipc-message", {
    detail: { channel: APPLICATION_LINK_HOST_CHANNEL, args: [value] },
  }));
}

function dispatchWebviewIpc(webview: HTMLElement, payload: unknown): void {
  webview.dispatchEvent(new CustomEvent("ipc-message", {
    detail: { channel: WEBVIEW_BRIDGE_CHANNEL, args: [payload] },
  }));
}

function dispatchNavigation(
  el: HTMLElement,
  init: { url: string; replace?: boolean; sameDocument?: boolean; native?: boolean; guid?: string },
): void {
  const iframeWindow = frame(el).contentWindow;
  if (!iframeWindow) throw new Error("Expected iframe contentWindow");
  window.dispatchEvent(
    new MessageEvent("message", {
      data: { type: "navigation-request", ...init },
      source: iframeWindow,
    }),
  );
}

function dispatchBridgeReady(el: HTMLElement, guid: string): void {
  dispatchFrameMessage(el, { type: "bridge-ready", guid });
}

function dispatchFrameMessage(
  el: HTMLElement,
  data: unknown,
  options: { source?: MessageEventSource | null; origin?: string } = {},
): void {
  const iframe = frame(el);
  const iframeWindow = iframe.contentWindow;
  if (!iframeWindow) throw new Error("Expected iframe contentWindow");
  window.dispatchEvent(
    new MessageEvent("message", {
      data,
      origin: options.origin ?? "",
      source: options.source ?? iframeWindow,
    }),
  );
}

function requestURLTarget(el: HTMLElement): ReturnType<typeof vi.spyOn> {
  return requestFrameMessage(el, { type: "url-target-request" });
}

function requestFrameMessage(el: HTMLElement, data: unknown): ReturnType<typeof vi.spyOn> {
  const iframeWindow = frame(el).contentWindow;
  if (!iframeWindow) throw new Error("Expected iframe contentWindow");
  const postMessage = vi.spyOn(iframeWindow, "postMessage").mockImplementation(() => {});
  window.dispatchEvent(
    new MessageEvent("message", {
      data,
      source: iframeWindow,
    }),
  );
  return postMessage;
}

function navigationRecord(artifactId: string): ArtifactNavigationRecord | null {
  const raw = localStorage.getItem(artifactNavigationStorageKey(artifactId));
  return raw ? (JSON.parse(raw) as ArtifactNavigationRecord) : null;
}

function trustedChannel(el: HTMLElement): ArtifactTrustedChannel {
  const view = (el as ArtifactViewTestHost).view;
  if (!view) throw new Error("Expected captured artifact view");
  return (view as unknown as { _trustedChannel: ArtifactTrustedChannel })._trustedChannel;
}

function expectTrust(
  el: HTMLElement,
  currentGuid: string | null,
  lifecycleWindow: Window | null = null,
): void {
  expect(trustedChannel(el).trustState).toEqual({ currentGuid, lifecycleWindow });
}

function mountDocumentHost(
  artifact: Artifact,
  onEmbedLoadChange: (loaded: boolean) => void = () => {},
): {
  host: ArtifactDocumentHost;
  rerender(): void;
} {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const captured: { host?: ArtifactDocumentHost } = {};
  const capture = (value: ArtifactDocumentHost) => {
    captured.host = value;
  };
  const rerender = () => {
    render(html`${ArtifactDocumentHostView(capture, onEmbedLoadChange)}`, container);
  };
  rerender();
  const host = captured.host;
  if (!host) throw new Error("Expected document host");
  host.assignSource({
    artifact,
    application: null,
    electron: false,
    viewURL: null,
    contentURL: null,
    currentURL: null,
  });
  return { host, rerender };
}

describe("artifact document host", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    window.history.replaceState(null, "", "/");
  });

  it("routes path and URL sources through the document host", () => {
    const path = mountDocumentHost({
      id: "html",
      kind: "path",
      title: "HTML",
      path: "/tmp/page.html",
    });
    const url = mountDocumentHost({
      id: "url",
      kind: "url",
      title: "URL",
      url: "https://example.com",
    });

    const pathFrame = path.host.currentFrame as HTMLIFrameElement;
    const urlFrame = url.host.currentFrame as HTMLIFrameElement;
    const pathWindow = pathFrame.contentWindow;
    const urlWindow = urlFrame.contentWindow;
    expect(pathFrame.getAttribute("src")).toBe("/artifact/html/page.html");
    expect(urlFrame.getAttribute("src")).toBe("/views/url-unsupported/");

    path.rerender();
    url.rerender();

    expect(path.host.currentFrame).toBe(pathFrame);
    expect(url.host.currentFrame).toBe(urlFrame);
    expect((path.host.currentFrame as HTMLIFrameElement).contentWindow).toBe(pathWindow);
    expect((url.host.currentFrame as HTMLIFrameElement).contentWindow).toBe(urlWindow);
  });

  it("owns embed-load state across iframe source changes and webview failures", () => {
    const loaded: boolean[] = [];
    const mounted = mountDocumentHost(
      { id: "html", kind: "path", title: "HTML", path: "/tmp/page.html" },
      (value) => loaded.push(value),
    );
    const iframe = mounted.host.currentFrame;
    if (!iframe) throw new Error("Expected iframe");
    expect(loaded.at(-1)).toBe(false);

    iframe.dispatchEvent(new Event("load"));
    expect(loaded.at(-1)).toBe(true);

    mounted.host.assignSource({
      artifact: { id: "other", kind: "path", title: "Other", path: "/tmp/other.html" },
      application: null,
      electron: false,
      viewURL: null,
      contentURL: null,
      currentURL: null,
    });
    expect(mounted.host.currentFrame).toBe(iframe);
    expect(loaded.at(-1)).toBe(false);

    mounted.host.assignSource({
      artifact: { id: "other", kind: "path", title: "Other", path: "/tmp/other.html" },
      application: null,
      electron: true,
      viewURL: null,
      contentURL: null,
      currentURL: null,
    });
    const webview = mounted.host.currentFrame;
    expect(webview?.tagName.toLowerCase()).toBe("webview");
    webview?.dispatchEvent(new Event("did-fail-load"));
    expect(loaded.at(-1)).toBe(true);
  });

  it("preserves the owned frame when the artifact wrapper ordinarily rerenders", async () => {
    const el = mount({ id: "html", kind: "path", title: "HTML", path: "/tmp/page.html" });
    await flush();
    const before = frame(el);
    const beforeWindow = before.contentWindow;

    el.artifact = { id: "html", kind: "path", title: "Renamed", path: "/tmp/page.html" };
    await flush();

    expect(frame(el)).toBe(before);
    expect(frame(el).contentWindow).toBe(beforeWindow);
    expect(el.querySelector(".artifact-title")?.textContent).toBe("Renamed");
  });
});

describe("artifact trusted channel", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    window.history.replaceState(null, "", "/");
  });

  // spec: proofs/arch/artifact-frame/artifact-bridge.md#^ab-ac-detached-window
  it("ignores messages when the current iframe is detached", () => {
    const delivered: ArtifactFrameInboundMessage[] = [];
    const channel = new ArtifactTrustedChannel((message) => delivered.push(message));
    const iframe = document.createElement("iframe");
    document.body.appendChild(iframe);
    channel.connect();
    channel.setCurrentFrame(iframe);
    const iframeWindow = iframe.contentWindow;
    if (!iframeWindow) throw new Error("Expected iframe contentWindow");
    iframe.remove();
    Object.defineProperty(iframe, "contentWindow", {
      configurable: true,
      value: iframeWindow,
    });

    window.dispatchEvent(new MessageEvent("message", {
      data: { type: "navigation-request", url: "/views/markdown/" },
      source: iframeWindow,
    }));

    expect(delivered).toEqual([]);
    Reflect.deleteProperty(iframe, "contentWindow");
    channel.disconnect();
  });

  // spec: proofs/arch/artifact-frame/artifact-bridge.md#^ab-ac-detached-window
  it("ignores messages when the current iframe and event source have no window identity", () => {
    const delivered: ArtifactFrameInboundMessage[] = [];
    const channel = new ArtifactTrustedChannel((message) => delivered.push(message));
    const iframe = document.createElement("iframe");
    document.body.appendChild(iframe);
    channel.connect();
    channel.setCurrentFrame(iframe);
    Object.defineProperty(iframe, "contentWindow", {
      configurable: true,
      value: null,
    });

    expect(iframe.isConnected).toBe(true);
    expect(iframe.contentWindow === null).toBe(true);
    window.dispatchEvent(new MessageEvent("message", {
      data: { type: "navigation-request", url: "/views/markdown/" },
      source: null,
    }));

    expect(delivered).toEqual([]);
    Reflect.deleteProperty(iframe, "contentWindow");
    channel.disconnect();
  });

  it("delivers every recognized current-frame message without adopting trust", () => {
    const delivered: ArtifactFrameInboundMessage[] = [];
    const channel = new ArtifactTrustedChannel((message) => delivered.push(message));
    const iframe = document.createElement("iframe");
    document.body.appendChild(iframe);
    channel.connect();
    channel.setCurrentFrame(iframe);

    const messages: ArtifactFrameInboundMessage[] = [
      { type: "navigation-request", url: "/artifact/test/next.html" },
      { type: "navigation-key", key: "ArrowLeft" },
      {
        type: "artifact-pointer",
        eventType: "pointermove",
        clientX: 10,
        clientY: 20,
        button: -1,
        buttons: 0,
      },
      { type: "proxy-content-changed" },
      { type: "url-target-request" },
      { type: "artifact-missing-request" },
    ];
    for (const message of messages) {
      window.dispatchEvent(new MessageEvent("message", {
        data: message,
        source: iframe.contentWindow,
      }));
    }

    expect(delivered).toEqual(messages);
    expect(channel.trustState).toEqual({ currentGuid: null, lifecycleWindow: null });
    channel.disconnect();
  });
});

describe("artifact-frame view rendering dispatcher", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    localStorage.clear();
    window.history.replaceState(null, "", "/");
  });

  // proofs/arch/artifact-frame/artifact-bridge.md#^ab-ac-pointer-host
  // proofs/arch/themes/delivery.md#^theme-delivery-t-frame-pointer
  it("relays only current artifact pointer input to theme frames in application coordinates", async () => {
    document.documentElement.dataset.theme = "light";
    document.body.innerHTML = `
      <div id="app" tabindex="-1"></div>
      <div id="foreground-overlay" inert aria-hidden="true"></div>
    `;
    const theme = await import("../src/theme.ts");
    await theme.refreshThemeFrames(
      "https://television.example",
      "pointer-theme",
      async () => ({
        themes: [{
          id: "pointer-theme",
          name: "Pointer theme",
          version: "1.0.0",
          colorScheme: "light dark",
          enableIframeBackgroundJS: true,
          enableIframeOverlayJS: true,
        }],
        errors: [],
      }),
    );
    const backgroundWindow = theme.getThemeFrame("background")?.contentWindow;
    const overlayWindow = theme.getThemeFrame("overlay")?.contentWindow;
    if (!backgroundWindow || !overlayWindow) throw new Error("Expected theme frame windows");
    const backgroundPost = vi.spyOn(backgroundWindow, "postMessage");
    const overlayPost = vi.spyOn(overlayWindow, "postMessage");

    const el = createHost({
      id: "pointer-artifact",
      kind: "path",
      title: "Pointer artifact",
      path: "/tmp/pointer.html",
    });
    document.querySelector("#app")?.appendChild(el);
    await flush();
    const artifactFrame = frame(el);
    Object.defineProperties(artifactFrame, {
      clientWidth: { configurable: true, value: 400 },
      clientHeight: { configurable: true, value: 200 },
    });
    vi.spyOn(artifactFrame, "getBoundingClientRect").mockReturnValue({
      x: 20,
      y: 30,
      left: 20,
      top: 30,
      right: 220,
      bottom: 130,
      width: 200,
      height: 100,
      toJSON: () => ({}),
    });
    const message = {
      type: "artifact-pointer",
      eventType: "pointermove",
      clientX: 80,
      clientY: 40,
      button: 2,
      buttons: 5,
    } as const;

    const unrelated = document.createElement("iframe");
    document.body.append(unrelated);
    dispatchFrameMessage(el, message, { source: unrelated.contentWindow });
    dispatchFrameMessage(el, message, { source: backgroundWindow });
    expect(backgroundPost).not.toHaveBeenCalled();
    expect(overlayPost).not.toHaveBeenCalled();

    dispatchFrameMessage(el, message);
    const expected = {
      type: "television-theme-pointer-move",
      clientX: 60,
      clientY: 50,
      button: -1,
      buttons: 5,
    };
    expect(backgroundPost).toHaveBeenCalledOnce();
    expect(backgroundPost).toHaveBeenCalledWith(expected, "*");
    expect(overlayPost).toHaveBeenCalledOnce();
    expect(overlayPost).toHaveBeenCalledWith(expected, "*");
    expect(trustedChannel(el).currentGuid).toBeNull();

    Object.defineProperty(artifactFrame, "clientWidth", { configurable: true, value: 0 });
    dispatchFrameMessage(el, { ...message, eventType: "click" });
    expect(backgroundPost).toHaveBeenCalledOnce();
    expect(overlayPost).toHaveBeenCalledOnce();
    theme.clearThemeFrames();
  });

  it("preserves synchronous artifact rerenders", async () => {
    const el = mount({
      id: "lifecycle",
      kind: "path",
      title: "Initial title",
      path: "/tmp/lifecycle.html",
    });
    const initialFrame = frame(el);
    const initialWindow = initialFrame.contentWindow;

    el.artifact = {
      id: "lifecycle",
      kind: "path",
      title: "Updated title",
      path: "/tmp/lifecycle.html",
    };

    await flush();
    expect(frame(el)).toBe(initialFrame);
    expect(frame(el).contentWindow).toBe(initialWindow);
    expect(el.querySelector(".artifact-title")?.textContent).toBe("Updated title");
  });

  it("renders non-markdown file path artifacts through the encoded proxy URL, sandboxed", async () => {
    const el = mount({
      id: "file id",
      kind: "path",
      title: "File",
      path: "/tmp/file (1)#?.%.é.html",
    });
    await flush();

    const iframe = frame(el);
    expect(iframe.getAttribute("src")).toBe("/artifact/file%20id/file%20(1)%23%3F.%25.%C3%A9.html");
    expect(iframe.getAttribute("sandbox")).toBe("allow-scripts allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox allow-downloads");
    expect(el.textContent).not.toContain("arrives in a later slice");
  });

  it("renders directory path artifacts through the proxy directory root, sandboxed", async () => {
    const el = mount({ id: "dir", kind: "path", title: "Dir", path: "/tmp/site/" });
    await flush();

    const iframe = frame(el);
    expect(iframe.getAttribute("src")).toBe("/artifact/dir/");
    expect(iframe.getAttribute("sandbox")).toBe("allow-scripts allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox allow-downloads");
  });

  it("renders markdown path artifacts through the markdown view route with the future content URL", async () => {
    const el = mount({ id: "md", kind: "path", title: "Note", path: "/tmp/note.md" });
    await flush();

    const iframe = frame(el);
    expect(iframe.getAttribute("src")).toBe("/views/markdown/");
    expect(iframe.dataset.contentUrl).toBe("/markdown/md");
    expect(iframe.hasAttribute("sandbox")).toBe(false);
  });

  it("renders a not-found page for markdown 404s and recovers on a later successful fetch", async () => {
    let missing = true;
    const application = createApplication({
      get: vi.fn(async () => {
        if (missing) throw new RequestError("Markdown artifact not found: md", { serverURL: "http://example.test", status: 404 });
        return "# Restored";
      }),
      update: vi.fn(async () => undefined),
    });
    const el = mount({ id: "md", kind: "path", title: "Note", path: "/tmp/note.md" }) as unknown as HTMLElement & { application: unknown };
    el.application = application;
    await flush();
    await flush();

    expect(el.textContent).toContain("Artifact file not found");
    expect(el.textContent).toContain("/tmp/note.md");
    expect(el.querySelector("iframe")).toBeNull();

    missing = false;
    application.dispatchEvent(new ArtifactContentChangedEvent("artifact-content-changed", { artifactID: "md" }));
    await flush();
    await flush();

    expect(el.textContent).not.toContain("Artifact file not found");
    expect(frame(el).getAttribute("src")).toBe("/views/markdown/");
  });

  it("clears missing markdown state and refetches when the same artifact is retargeted", async () => {
    let missing = true;
    const get = vi.fn(async ({ artifactID }: { artifactID: string }) => {
      if (artifactID !== "md") throw new Error("unexpected artifact id");
      if (missing) throw new RequestError("Markdown artifact not found: md", { serverURL: "http://example.test", status: 404 });
      return "# Retargeted";
    });
    const application = createApplication({ get, update: vi.fn(async () => undefined) });
    const el = mount({ id: "md", kind: "path", title: "Note", path: "/tmp/missing.md" }) as unknown as HTMLElement & {
      artifact: Artifact;
      application: unknown;
    };
    el.application = application;
    await flush();
    await flush();
    expect(el.textContent).toContain("Artifact file not found");

    missing = false;
    el.artifact = { id: "md", kind: "path", title: "Note", path: "/tmp/live.md" };
    await flush();
    await flush();

    expect(el.textContent).not.toContain("Artifact file not found");
    expect(frame(el).getAttribute("src")).toBe("/views/markdown/");
    expect(get).toHaveBeenCalledTimes(2);
  });

  it("reloads HTML artifacts after retargeting to another path with the same basename", async () => {
    const application = createApplication();
    const el = mount({ id: "html", kind: "path", title: "HTML", path: "/tmp/missing/page.html" }) as unknown as HTMLElement & {
      artifact: Artifact;
      application: unknown;
    };
    el.application = application;
    await flush();
    expect(frame(el).getAttribute("src")).toBe("/artifact/html/page.html");

    el.artifact = { id: "html", kind: "path", title: "HTML", path: "/tmp/live/page.html" };
    await flush();
    expect(frame(el).getAttribute("src")).toBe("/artifact/html/page.html");

    application.dispatchEvent(new ArtifactContentChangedEvent("artifact-content-changed", { artifactID: "html" }));
    await flush();

    expect(frame(el).getAttribute("src")).toBe("/artifact/html/page.html?tv-reload=1");
  });

  it("keeps stale markdown UI for non-404 fetch failures", async () => {
    let fail = false;
    const application = createApplication({
      get: vi.fn(async () => {
        if (fail) throw new RequestError("Failed", { serverURL: "http://example.test", status: 500 });
        return "# Initial";
      }),
      update: vi.fn(async () => undefined),
    });
    const el = mount({ id: "md", kind: "path", title: "Note", path: "/tmp/note.md" }) as unknown as HTMLElement & { application: unknown };
    el.application = application;
    await flush();
    await flush();

    fail = true;
    application.dispatchEvent(new ArtifactContentChangedEvent("artifact-content-changed", { artifactID: "md" }));
    await flush();
    await flush();

    expect(el.textContent).not.toContain("Artifact file not found");
    expect(frame(el).getAttribute("src")).toBe("/views/markdown/");
  });

  it("syncMarkdownHost wires Electron markdown webviews after the dispatcher flip", async () => {
    window.history.replaceState(null, "", "/?mode=electron");
    const application = createApplication({
      get: vi.fn(async () => "# Electron webview markdown"),
      update: vi.fn(async () => undefined),
    });
    const el = mount({ id: "md", kind: "path", title: "Note", path: "/tmp/note.md" }) as unknown as HTMLElement & { application: unknown };
    el.application = application;
    await flush();

    const webview = el.querySelector("webview[data-content-url]") as (HTMLElement & { send?: ReturnType<typeof vi.fn> }) | null;
    if (!webview) throw new Error("Expected markdown webview");
    webview.send = vi.fn();

    dispatchWebviewIpc(webview, { type: "ready" });
    await flush();

    expect(application.markdown.get).toHaveBeenCalledWith({ artifactID: "md" });
    expect(webview.send).toHaveBeenCalledWith(WEBVIEW_BRIDGE_CHANNEL, {
      type: "content-updated",
      content: "# Electron webview markdown",
    });
  });

  it("renders browser URL artifacts through the unsupported placeholder iframe without loading the remote URL", async () => {
    const el = mount({ id: "url", kind: "url", title: "Remote", url: "https://example.com/remote" });
    await flush();

    const iframe = frame(el);
    expect(iframe.getAttribute("src")).toBe("/views/url-unsupported/");
    expect(iframe.getAttribute("src")).not.toContain("example.com");
    expect(iframe.hasAttribute("sandbox")).toBe(false);
  });


  it("keeps browser URL artifacts on the unsupported placeholder when reassigned", async () => {
    const el = mount({ id: "url", kind: "url", title: "Remote", url: "https://example.com/a" });
    await flush();
    expect(frame(el).getAttribute("src")).toBe("/views/url-unsupported/");

    el.artifact = { id: "url", kind: "url", title: "Remote", url: "https://example.com/b" };
    await flush();

    expect(frame(el).getAttribute("src")).toBe("/views/url-unsupported/");
    expect(frame(el).getAttribute("src")).not.toContain("example.com");
  });

  // spec: proofs/arch/artifact-frame/artifact-bridge.md#^ab-ac-view-replies
  it("replies to unsupported page URL target requests with the browser URL artifact target", async () => {
    const el = mount({ id: "url", kind: "url", title: "Remote", url: "https://example.com/remote" });
    await flush();

    const postMessage = requestURLTarget(el);

    expect(postMessage).toHaveBeenCalledWith(
      { type: "url-target", url: "https://example.com/remote" },
      "*",
    );
    expect(frame(el).getAttribute("src")).toBe("/views/url-unsupported/");

    el.artifact = { id: "url", kind: "url", title: "Updated remote", url: "https://example.com/updated" };
    await flush();
    postMessage.mockClear();
    dispatchFrameMessage(el, { type: "url-target-request" });

    expect(postMessage).toHaveBeenCalledWith(
      { type: "url-target", url: "https://example.com/updated" },
      "*",
    );
    expect(frame(el).getAttribute("src")).toBe("/views/url-unsupported/");
  });

  // spec: proofs/arch/artifact-frame/artifact-bridge.md#^ab-ac-view-replies
  it("replies to missing-artifact view requests with path artifact metadata", async () => {
    const el = mount({ id: "html", kind: "path", title: "Missing HTML", path: "/tmp/missing.html" });
    await flush();

    const postMessage = requestFrameMessage(el, { type: "artifact-missing-request" });

    expect(postMessage).toHaveBeenCalledWith(
      { type: "artifact-missing", title: "Missing HTML", path: "/tmp/missing.html" },
      "*",
    );

    el.artifact = { id: "html", kind: "path", title: "Moved HTML", path: "/tmp/moved.html" };
    await flush();
    postMessage.mockRestore();
    const updatedPostMessage = requestFrameMessage(el, { type: "artifact-missing-request" });

    expect(updatedPostMessage).toHaveBeenCalledWith(
      { type: "artifact-missing", title: "Moved HTML", path: "/tmp/moved.html" },
      "*",
    );

    el.artifact = { id: "remote", kind: "url", title: "Remote", url: "https://example.com" };
    await flush();
    const nonPathPostMessage = requestFrameMessage(el, { type: "artifact-missing-request" });

    expect(nonPathPostMessage).not.toHaveBeenCalled();
  });

  // spec: proofs/arch/artifact-frame/artifact-bridge.md#^ab-ac-view-replies
  it("stops browser missing-artifact redispatch when a replacement document adopts", async () => {
    const el = mount({ id: "html", kind: "path", title: "Missing HTML", path: "/tmp/missing.html" });
    await flush();

    dispatchBridgeReady(el, "requesting-document");
    const postMessage = requestFrameMessage(el, { type: "artifact-missing-request" });
    expect(postMessage).toHaveBeenCalledWith(
      { type: "artifact-missing", title: "Missing HTML", path: "/tmp/missing.html" },
      "*",
    );

    postMessage.mockClear();
    dispatchBridgeReady(el, "replacement-document");
    el.artifact = { id: "html", kind: "path", title: "Retitled", path: "/tmp/missing.html" };
    await flush();

    expect(postMessage).not.toHaveBeenCalled();
  });

  // spec: proofs/arch/artifact-frame/artifact-bridge.md#^ab-ac-view-replies
  it("replies to Electron missing-artifact view requests with path artifact metadata", async () => {
    window.history.replaceState(null, "", "/?mode=electron");
    const el = mount({ id: "html", kind: "path", title: "Missing HTML", path: "/tmp/missing.html" });
    await flush();
    const webview = el.querySelector("webview.artifact-content") as (HTMLElement & { send?: ReturnType<typeof vi.fn> }) | null;
    if (!webview) throw new Error("Expected webview");
    const send = vi.fn();
    webview.send = send;

    dispatchWebviewIpc(webview, { type: "artifact-missing-request" });

    expect(send).toHaveBeenCalledWith("television-artifact-bridge", {
      type: "artifact-missing",
      title: "Missing HTML",
      path: "/tmp/missing.html",
    });

    send.mockClear();
    el.artifact = { id: "html", kind: "path", title: "Renamed HTML", path: "/tmp/missing.html" };
    await flush();

    expect(send).toHaveBeenCalledWith("television-artifact-bridge", {
      type: "artifact-missing",
      title: "Renamed HTML",
      path: "/tmp/missing.html",
    });

    send.mockClear();
    webview.dispatchEvent(Object.assign(new Event("did-start-navigation"), {
      isMainFrame: true,
      isInPlace: false,
    }));
    dispatchWebviewIpc(webview, { type: "bridge-ready", guid: "external-guid" });
    el.artifact = { id: "html", kind: "path", title: "Renamed while external", path: "/tmp/missing.html" };
    await flush();

    expect(send).not.toHaveBeenCalled();

    el.artifact = { id: "html", kind: "path", title: "Moved HTML", path: "/tmp/moved.html" };
    await flush();
    send.mockClear();
    dispatchWebviewIpc(webview, { type: "artifact-missing-request" });

    expect(send).toHaveBeenCalledWith("television-artifact-bridge", {
      type: "artifact-missing",
      title: "Moved HTML",
      path: "/tmp/moved.html",
    });

    el.artifact = { id: "remote", kind: "url", title: "Remote", url: "https://example.com" };
    await flush();
    const currentWebview = el.querySelector("webview.artifact-content");
    expect(currentWebview).toBe(webview);
    send.mockClear();
    dispatchWebviewIpc(webview, { type: "artifact-missing-request" });

    expect(send).not.toHaveBeenCalled();
  });

  // spec: proofs/arch/artifact-frame/artifact-bridge.md#^ab-ac-key-no-trust
  // spec: proofs/arch/artifact-frame/artifact-bridge.md#^ab-ac-no-adoption
  it("delivers source-valid navigation keys while unready and unfocused without adopting trust", async () => {
    const application = createApplication();
    const el = mount({ id: "key", kind: "path", title: "Key", path: "/tmp/key.html" }) as unknown as HTMLElement & {
      application: unknown;
    };
    el.application = application;
    await flush();
    const outside = document.createElement("button");
    document.body.appendChild(outside);
    outside.focus();

    dispatchFrameMessage(el, { type: "navigation-key", key: "ArrowUp" });
    await flush();

    expect(document.activeElement).toBe(outside);
    expect(application.handleNavigationKey).toHaveBeenCalledOnce();
    expect(application.handleNavigationKey).toHaveBeenCalledWith("ArrowUp");
    expectTrust(el, null);

    dispatchFrameMessage(
      el,
      { type: "navigation-key", key: "ArrowDown" },
      { source: window },
    );
    await flush();

    expect(application.handleNavigationKey).toHaveBeenCalledOnce();
    expectTrust(el, null);
  });

  // spec: proofs/arch/artifact-frame/artifact-bridge.md#^ab-ac-ready
  it("adopts browser bridge-ready identity from the source-validated current frame", async () => {
    const url = "https://producer.test/artifact/01J00000000000000000000000/index.html";
    const el = mount({ id: "tv", kind: "url", title: "Shared", url });
    await flush();

    const iframe = frame(el);
    expect(iframe.getAttribute("src")).toBe(url);
    expectTrust(el, null);

    dispatchBridgeReady(el, "guid-a");
    await flush();
    expectTrust(el, "guid-a", iframe.contentWindow);
  });

  // spec: proofs/arch/artifact-frame/artifact-bridge.md#^ab-ac-ready
  it("preserves a same-document missing reply when its current GUID reposts", async () => {
    const el = mount({ id: "html", kind: "path", title: "Missing HTML", path: "/tmp/missing.html" });
    await flush();

    dispatchBridgeReady(el, "persisted-document");
    const postMessage = requestFrameMessage(el, { type: "artifact-missing-request" });
    postMessage.mockClear();

    dispatchBridgeReady(el, "persisted-document");
    el.artifact = { id: "html", kind: "path", title: "Retitled", path: "/tmp/missing.html" };
    await flush();

    expect(postMessage).toHaveBeenCalledWith(
      { type: "artifact-missing", title: "Retitled", path: "/tmp/missing.html" },
      "*",
    );
  });

  // spec: proofs/arch/artifact-frame/artifact-bridge.md#^ab-ac-ready-source
  it("ignores bridge-ready from a window other than the current iframe", async () => {
    const el = mount({ id: "source", kind: "path", title: "Source", path: "/tmp/source.html" });
    await flush();

    dispatchFrameMessage(el, { type: "bridge-ready", guid: "foreign-guid" }, { source: window });
    await flush();
    expectTrust(el, null);

    dispatchBridgeReady(el, "current-guid");
    await flush();
    expectTrust(el, "current-guid", frame(el).contentWindow);
  });

  // spec: proofs/arch/artifact-frame/artifact-bridge.md#^ab-ac-ready-source
  it("ignores IPC from a replaced webview and adopts from the current peer", async () => {
    window.history.replaceState(null, "", "/?mode=electron");
    const el = mount({ id: "old", kind: "path", title: "Old", path: "/tmp/old.html" }) as unknown as HTMLElement & {
      artifact: Artifact;
    };
    await flush();
    const oldWebview = el.querySelector("webview.artifact-content") as HTMLElement | null;
    if (!oldWebview) throw new Error("Expected old webview");

    window.history.replaceState(null, "", "/");
    el.artifact = { id: "browser", kind: "path", title: "Browser", path: "/tmp/browser.html" };
    await flush();
    window.history.replaceState(null, "", "/?mode=electron");
    el.artifact = { id: "current", kind: "path", title: "Current", path: "/tmp/current.html" };
    await flush();
    const currentWebview = el.querySelector("webview.artifact-content") as HTMLElement | null;
    if (!currentWebview || currentWebview === oldWebview) throw new Error("Expected replacement webview");

    dispatchWebviewIpc(oldWebview, { type: "bridge-ready", guid: "stale-guid" });
    expectTrust(el, null);

    dispatchWebviewIpc(currentWebview, { type: "bridge-ready", guid: "current-guid" });
    expectTrust(el, "current-guid");
  });

  // spec: proofs/arch/artifact-frame/artifact-bridge.md#^ab-ac-application-link-host
  it("passes an application link to the native bridge only from the webview it shows, on its own origin", async () => {
    const openApplicationLink = vi.fn();
    const native = globalThis as typeof globalThis & { __televisionNativeBridge?: unknown };
    native.__televisionNativeBridge = { openApplicationLink };
    try {
      window.history.replaceState(null, "", "/?mode=electron");
      const el = mount({ id: "old", kind: "path", title: "Old", path: "/tmp/old.html" }) as unknown as HTMLElement & {
        artifact: Artifact;
      };
      await flush();
      const oldWebview = el.querySelector("webview.artifact-content") as (HTMLElement & { getURL?: () => string }) | null;
      if (!oldWebview) throw new Error("Expected webview");
      const ownPage = new URL("/artifact/old/index.html", window.location.origin).href;
      oldWebview.getURL = () => ownPage;

      dispatchApplicationLinkRequest(oldWebview, "example-app://open/item");
      expect(openApplicationLink.mock.calls).toEqual([["example-app://open/item"]]);

      openApplicationLink.mockClear();
      for (const shown of [
        "https://third-party.example/page",
        "https://producer.example/artifact/01J00000000000000000000000/index.html",
        "chrome-error://chromewebdata/",
        "about:blank",
        "data:text/html,<p>page</p>",
        "file:///tmp/old.html",
        // A blob URL reports the origin of the page that created it.
        `blob:${window.location.origin}/7d3b9a52-6c51-4b4e-9d2f-2f8c9a1e0b4d`,
        "not a url",
      ]) {
        oldWebview.getURL = () => shown;
        dispatchApplicationLinkRequest(oldWebview, "example-app://open/item");
      }
      oldWebview.getURL = () => ownPage;
      dispatchApplicationLinkRequest(oldWebview, 42);
      dispatchWebviewIpc(oldWebview, "example-app://open/item");
      dispatchWebviewIpc(oldWebview, { type: "open-application-link", url: "example-app://open/item" });
      expect(openApplicationLink).not.toHaveBeenCalled();

      window.history.replaceState(null, "", "/");
      el.artifact = { id: "browser", kind: "path", title: "Browser", path: "/tmp/browser.html" };
      await flush();
      window.history.replaceState(null, "", "/?mode=electron");
      el.artifact = { id: "current", kind: "path", title: "Current", path: "/tmp/current.html" };
      await flush();
      const currentWebview = el.querySelector("webview.artifact-content") as (HTMLElement & { getURL?: () => string }) | null;
      if (!currentWebview || currentWebview === oldWebview) throw new Error("Expected replacement webview");
      currentWebview.getURL = () => new URL("/artifact/current/index.html", window.location.origin).href;

      dispatchApplicationLinkRequest(oldWebview, "example-app://open/stale");
      expect(openApplicationLink).not.toHaveBeenCalled();
      dispatchApplicationLinkRequest(currentWebview, "example-app://open/current");
      expect(openApplicationLink.mock.calls).toEqual([["example-app://open/current"]]);
    } finally {
      delete native.__televisionNativeBridge;
    }
  });

  // spec: proofs/arch/artifact-frame/artifact-bridge.md#^ab-ac-reparent
  it("clears trusted identity when a loaded frame component is reconnected", async () => {
    const url = "https://producer.test/artifact/01J00000000000000000000000/index.html";
    const el = mount({ id: "tv-reparent", kind: "url", title: "Shared", url });
    await flush();
    dispatchBridgeReady(el, "reparent-guid");
    await flush();
    expectTrust(el, "reparent-guid", frame(el).contentWindow);

    el.remove();
    expectTrust(el, null);
    document.body.appendChild(el);
    await flush();

    expect(frame(el).getAttribute("src")).toBe(url);
    expectTrust(el, null);
  });

  // spec: proofs/arch/artifact-frame/reload-navigation.md#^rn-ac-cache-buster
  // spec: proofs/arch/artifact-frame/reload-navigation.md#^ac-reload-src
  // spec: proofs/arch/artifact-frame/artifact-bridge.md#^ab-ac-reload-swap-reset
  it("resets trust for a shared-TV reload and retains its new identity across ordinary rerenders", async () => {
    const url = "https://producer.test/artifact/01J00000000000000000000000/index.html";
    const pageURL = "https://producer.test/artifact/01J00000000000000000000000/page2.html";
    const el = mount({ id: "tv-rerender", kind: "url", title: "Shared", url }) as unknown as HTMLElement & {
      artifact: Artifact;
    };
    await flush();
    dispatchNavigation(el, { url: pageURL });
    await flush();
    expect(navigationRecord("tv-rerender")?.entries).toEqual([{ url: pageURL }]);

    const setAttribute = vi.spyOn(frame(el), "setAttribute");
    dispatchFrameMessage(el, { type: "proxy-content-changed" });
    await flush();

    const reloadedFrame = frame(el);
    const firstReloadSrc = `${pageURL}?tv-reload=1`;
    expect(reloadedFrame.getAttribute("src")).toBe(firstReloadSrc);
    expect(setAttribute.mock.calls.filter(([name]) => name === "src")).toEqual([
      ["src", firstReloadSrc],
    ]);
    expectTrust(el, null);
    expect(navigationRecord("tv-rerender")?.entries).toEqual([{ url: pageURL }]);

    dispatchBridgeReady(el, "reload-guid");
    await flush();
    expectTrust(el, "reload-guid", reloadedFrame.contentWindow);
    setAttribute.mockClear();

    el.artifact = { id: "tv-rerender", kind: "url", title: "Renamed", url };
    await flush();

    expect(frame(el).getAttribute("src")).toBe(firstReloadSrc);
    expect(setAttribute).not.toHaveBeenCalledWith("src", url);
    expectTrust(el, "reload-guid", reloadedFrame.contentWindow);

    dispatchNavigation(el, { url: `${pageURL}#section`, sameDocument: true });
    await flush();
    expect(frame(el).getAttribute("src")).toBe(firstReloadSrc);
    expectTrust(el, "reload-guid", reloadedFrame.contentWindow);

    setAttribute.mockClear();
    dispatchFrameMessage(el, { type: "proxy-content-changed" });
    await flush();

    const secondReloadSrc = `${pageURL}?tv-reload=2#section`;
    expect(frame(el).getAttribute("src")).toBe(secondReloadSrc);
    expect(setAttribute.mock.calls.filter(([name]) => name === "src")).toEqual([
      ["src", secondReloadSrc],
    ]);
    expect(navigationRecord("tv-rerender")?.entries).toEqual([
      { url: pageURL },
      { url: `${pageURL}#section` },
    ]);
    expectTrust(el, null);
  });

  // spec: proofs/arch/artifact-frame/reload-navigation.md#^ac-reload-src
  // spec: proofs/arch/artifact-frame/artifact-bridge.md#^ab-ac-reload-swap-reset
  it("clears persisted reload source and trust for a real artifact URL change", async () => {
    const first = "https://producer.test/artifact/01J00000000000000000000000/index.html?lang=en#start";
    const changedSearch = "https://producer.test/artifact/01J00000000000000000000000/index.html?lang=fr#details";
    const changedOrigin = "https://alternate.test/artifact/01J00000000000000000000000/index.html?lang=fr#details";
    const changedPath = "https://alternate.test/artifact/01J00000000000000000000000/other.html?lang=fr#details";
    const el = mount({ id: "tv-clear", kind: "url", title: "Shared", url: first }) as unknown as HTMLElement & {
      artifact: Artifact;
    };
    await flush();
    dispatchFrameMessage(el, { type: "proxy-content-changed" });
    await flush();
    const firstReloadSrc = "https://producer.test/artifact/01J00000000000000000000000/index.html?lang=en&tv-reload=1#start";
    expect(frame(el).getAttribute("src")).toBe(firstReloadSrc);
    dispatchBridgeReady(el, "reload-guid");
    await flush();
    expectTrust(el, "reload-guid", frame(el).contentWindow);

    el.artifact = {
      id: "tv-clear",
      kind: "url",
      title: "Shared",
      url: "https://producer.test/artifact/01J00000000000000000000000/index.html?lang=en#details",
    };
    await flush();
    expect(frame(el).getAttribute("src")).toBe(firstReloadSrc);
    expectTrust(el, "reload-guid", frame(el).contentWindow);

    el.artifact = { id: "tv-clear", kind: "url", title: "Shared", url: changedSearch };
    await flush();
    expect(frame(el).getAttribute("src")).toBe(changedSearch);
    expectTrust(el, null);

    dispatchBridgeReady(el, "search-guid");
    dispatchFrameMessage(el, { type: "proxy-content-changed" });
    await flush();
    expect(frame(el).getAttribute("src")).toBe(
      "https://producer.test/artifact/01J00000000000000000000000/index.html?lang=fr&tv-reload=2#details",
    );
    expectTrust(el, null);

    el.artifact = { id: "tv-clear", kind: "url", title: "Shared", url: changedOrigin };
    await flush();
    expect(frame(el).getAttribute("src")).toBe(changedOrigin);

    dispatchFrameMessage(el, { type: "proxy-content-changed" });
    await flush();
    expect(frame(el).getAttribute("src")).toBe(
      "https://alternate.test/artifact/01J00000000000000000000000/index.html?lang=fr&tv-reload=3#details",
    );

    el.artifact = { id: "tv-clear", kind: "url", title: "Shared", url: changedPath };
    await flush();
    expect(frame(el).getAttribute("src")).toBe(changedPath);

    dispatchFrameMessage(el, { type: "proxy-content-changed" });
    await flush();
    expect(frame(el).getAttribute("src")).toContain("tv-reload=4");
    dispatchNavigation(el, {
      url: "https://alternate.test/artifact/01J00000000000000000000000/final.html",
    });
    await flush();
    expect(frame(el).getAttribute("src")).toBe(
      "https://alternate.test/artifact/01J00000000000000000000000/final.html",
    );
    expect(frame(el).getAttribute("src")).not.toContain("tv-reload");
  });

  it("renders Electron URL artifacts through webview with the remote URL", async () => {
    window.history.replaceState(null, "", "/?mode=electron");
    const url = "https://example.com/remote";
    const el = mount({ id: "url", kind: "url", title: "Remote", url });
    await flush();

    const webview = el.querySelector<HTMLElement>("webview");
    if (!webview) throw new Error("Expected webview");
    expect(webview.getAttribute("src")).toBe(url);
    expect(el.querySelector("iframe")).toBeNull();
  });

  it("subscribes the current webview before assigning its loadable source", async () => {
    window.history.replaceState(null, "", "/?mode=electron");
    const originalSetAttribute = HTMLElement.prototype.setAttribute;
    const setAttribute = vi.spyOn(HTMLElement.prototype, "setAttribute").mockImplementation(function (
      this: HTMLElement,
      name: string,
      value: string,
    ) {
      if (this.tagName.toLowerCase() === "webview" && name === "src") {
        dispatchWebviewIpc(this, { type: "bridge-ready", guid: "synchronous-guid" });
      }
      originalSetAttribute.call(this, name, value);
    });

    try {
      const el = mount({ id: "sync-webview", kind: "path", title: "Fast", path: "/tmp/fast.html" });
      await flush();
      expect(el.querySelector("webview")?.getAttribute("src")).toBe("/artifact/sync-webview/fast.html");
      expectTrust(el, "synchronous-guid");
    } finally {
      setAttribute.mockRestore();
    }
  });

  // spec: proofs/arch/artifact-frame/artifact-bridge.md#^ab-ac-ready
  it("adopts Electron bridge-ready identity from the subscribed webview", async () => {
    window.history.replaceState(null, "", "/?mode=electron");
    const url = "https://producer.test/artifact/01J00000000000000000000000/index.html";
    const el = mount({ id: "tv-webview", kind: "url", title: "Shared", url });
    await flush();
    const webview = el.querySelector("webview.artifact-content") as HTMLElement | null;
    if (!webview) throw new Error("Expected webview");
    expect(webview.getAttribute("src")).toBe(url);
    expectTrust(el, null);

    dispatchWebviewIpc(webview, { type: "bridge-ready", guid: "guid-a" });
    await flush();
    expectTrust(el, "guid-a");
  });

  // spec: proofs/arch/artifact-frame/artifact-bridge.md#^ab-ac-host-reset
  it("clears trust before host-driven browser navigation", async () => {
    const first = "https://producer.test/artifact/01J00000000000000000000000/index.html";
    const second = "https://producer.test/artifact/01J00000000000000000000000/page2.html";
    const el = mount({ id: "tv-host-nav", kind: "url", title: "Shared", url: first });
    await flush();
    dispatchBridgeReady(el, "guid-a");
    await flush();
    expectTrust(el, "guid-a", frame(el).contentWindow);

    dispatchNavigation(el, { url: second });
    await flush();
    expect(frame(el).getAttribute("src")).toBe(second);
    expectTrust(el, null);
    dispatchBridgeReady(el, "guid-b");
    await flush();
    expectTrust(el, "guid-b", frame(el).contentWindow);

    button(el, "Back").click();
    await flush();

    expect(frame(el).getAttribute("src")).toBe(first);
    expectTrust(el, null);
  });

  // spec: proofs/arch/artifact-frame/artifact-bridge.md#^ab-ac-reset-order
  it("keeps a fast browser identity adopted when host navigation assigns its target", async () => {
    const first = "https://producer.test/artifact/01J00000000000000000000000/index.html";
    const second = "https://producer.test/artifact/01J00000000000000000000000/page2.html";
    const originalSetAttribute = HTMLElement.prototype.setAttribute;
    let announced = false;
    const setAttribute = vi.spyOn(HTMLElement.prototype, "setAttribute").mockImplementation(function (
      this: HTMLElement,
      name: string,
      value: string,
    ) {
      originalSetAttribute.call(this, name, value);
      if (this.tagName.toLowerCase() !== "iframe" || name !== "src" || value !== second || announced) return;
      announced = true;
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "bridge-ready", guid: "fast-target-guid" },
        source: (this as HTMLIFrameElement).contentWindow,
      }));
    });

    try {
      const el = mount({ id: "tv-fast-nav", kind: "url", title: "Shared", url: first });
      await flush();
      dispatchBridgeReady(el, "first-guid");

      dispatchNavigation(el, { url: second });
      await flush();
      await new Promise((resolve) => window.setTimeout(resolve, 0));

      expect(announced).toBe(true);
      expect(frame(el).getAttribute("src")).toBe(second);
      expectTrust(el, "fast-target-guid", frame(el).contentWindow);
    } finally {
      setAttribute.mockRestore();
    }
  });

  // spec: proofs/arch/artifact-frame/artifact-bridge.md#^ab-ac-native-nav
  it("retains browser trust for native navigation requests until matched leaving", async () => {
    const first = "/artifact/native/index.html";
    const second = "/artifact/native/page2.html";
    const el = mount({ id: "native", kind: "path", title: "Native", path: "/tmp/index.html" });
    await flush();
    dispatchBridgeReady(el, "guid-a");
    await flush();
    const lifecycleWindow = frame(el).contentWindow;
    expectTrust(el, "guid-a", lifecycleWindow);

    dispatchNavigation(el, { url: second, native: true });
    await flush();
    expect(frame(el).getAttribute("src")).toBe(first);
    expect(navigationRecord("native")?.entries).toEqual([{ url: second }]);
    expectTrust(el, "guid-a", lifecycleWindow);

    dispatchFrameMessage(el, { type: "leaving", guid: "guid-a" });
    await flush();
    expectTrust(el, null);

    dispatchBridgeReady(el, "guid-b");
    dispatchFrameMessage(el, { type: "leaving", guid: "guid-a" });
    await flush();
    expectTrust(el, "guid-b", frame(el).contentWindow);
  });

  // Back and Forward are host-driven: they assign the frame's src
  // (specs/arch/artifact-frame/reload-navigation.md, "Intersection with
  // readiness tracking"). A same-origin frame reports the host's own
  // assignment as a native request that changes no history.
  it("assigns the frame's src on Forward after a native request that changed no history", async () => {
    const first = "/artifact/native-back/index.html";
    const second = "/artifact/native-back/page2.html";
    const el = mount({ id: "native-back", kind: "path", title: "Native", path: "/tmp/index.html" });
    await flush();
    dispatchBridgeReady(el, "guid-a");
    dispatchNavigation(el, { url: second, native: true });
    await flush();

    button(el, "Back").click();
    await flush();
    expect(frame(el).getAttribute("src")).toBe(first);
    dispatchNavigation(el, { url: first, native: true });
    await flush();
    expect(navigationRecord("native-back")).toMatchObject({ entries: [{ url: second }], cursor: -1 });

    button(el, "Forward").click();
    await flush();
    expect(frame(el).getAttribute("src")).toBe(second);
  });

  // spec: proofs/arch/artifact-frame/artifact-bridge.md#^ab-ac-stale
  it("ignores stale lifecycle GUIDs and does not adopt from non-ready messages", async () => {
    const url = "https://producer.test/artifact/01J00000000000000000000000/index.html";
    const el = mount({ id: "tv-stale-guid", kind: "url", title: "Shared", url });
    await flush();

    dispatchBridgeReady(el, "guid-a");
    await flush();
    dispatchBridgeReady(el, "guid-b");
    await flush();
    expectTrust(el, "guid-b", frame(el).contentWindow);

    dispatchFrameMessage(el, { type: "leaving", guid: "guid-a" });
    await flush();
    expectTrust(el, "guid-b", frame(el).contentWindow);

    dispatchFrameMessage(el, { type: "leaving", guid: "guid-b" });
    await flush();
    expectTrust(el, null);

    dispatchNavigation(el, { url, guid: "guid-a" });
    await flush();
    expectTrust(el, null);
  });

  // spec: proofs/arch/artifact-frame/artifact-bridge.md#^ab-ac-stale
  it("accepts iframe leaving from the expected origin only for the current GUID", async () => {
    // A frame the host sandboxes, local or shared, sends from the opaque origin "null".
    for (const artifact of [
      { id: "tv-leaving-origin", kind: "url", title: "Shared", url: "https://producer.test/artifact/01J00000000000000000000000/index.html" },
      { id: "local-leaving-origin", kind: "path", title: "Local", path: "/tmp/index.html" },
    ] satisfies Artifact[]) {
      const sandboxed = mount(artifact);
      await flush();
      dispatchBridgeReady(sandboxed, "guid-a");
      await flush();
      expectTrust(sandboxed, "guid-a", frame(sandboxed).contentWindow);

      for (const origin of ["https://attacker.test", "https://producer.test", window.location.origin]) {
        dispatchFrameMessage(sandboxed, { type: "leaving", guid: "guid-a" }, { source: window, origin });
        await flush();
        expectTrust(sandboxed, "guid-a", frame(sandboxed).contentWindow);
      }
      dispatchFrameMessage(sandboxed, { type: "leaving", guid: "old-guid" }, { source: window, origin: "null" });
      await flush();
      expectTrust(sandboxed, "guid-a", frame(sandboxed).contentWindow);

      dispatchFrameMessage(sandboxed, { type: "leaving", guid: "guid-a" }, { source: window, origin: "null" });
      await flush();
      expectTrust(sandboxed, null);
    }

    // An unsandboxed frame, the Markdown editor, sends from its src's origin.
    const editor = mount({ id: "md-leaving-origin", kind: "path", title: "Note", path: "/tmp/note.md" });
    await flush();
    dispatchBridgeReady(editor, "editor-guid");
    await flush();
    expectTrust(editor, "editor-guid", frame(editor).contentWindow);

    dispatchFrameMessage(editor, { type: "leaving", guid: "editor-guid" }, { source: window, origin: "null" });
    await flush();
    expectTrust(editor, "editor-guid", frame(editor).contentWindow);

    dispatchFrameMessage(editor, { type: "leaving", guid: "old-editor-guid" }, { source: window, origin: window.location.origin });
    await flush();
    expectTrust(editor, "editor-guid", frame(editor).contentWindow);

    dispatchFrameMessage(editor, { type: "leaving", guid: "editor-guid" }, { source: window, origin: window.location.origin });
    await flush();
    expectTrust(editor, null);
  });

  // spec: proofs/arch/artifact-frame/artifact-bridge.md#^ab-ac-replace-reset
  // spec: proofs/arch/artifact-frame/artifact-bridge.md#^ab-ac-stale-window
  it("clears trust across markdown removal and recovery and rejects the former window", async () => {
    let missing = false;
    const application = createApplication({
      get: vi.fn(async () => {
        if (missing) {
          throw new RequestError("Markdown artifact not found: md-replace", {
            serverURL: "http://example.test",
            status: 404,
          });
        }
        return "# Restored";
      }),
      update: vi.fn(async () => undefined),
    });
    const el = mount({ id: "md-replace", kind: "path", title: "Note", path: "/tmp/note.md" }) as unknown as HTMLElement & {
      application: unknown;
    };
    el.application = application;
    await flush();
    await flush();
    const oldFrame = frame(el);
    const oldWindow = oldFrame.contentWindow;
    dispatchBridgeReady(el, "markdown-guid");
    await flush();
    expectTrust(el, "markdown-guid", oldWindow);

    missing = true;
    application.dispatchEvent(new ArtifactContentChangedEvent("artifact-content-changed", { artifactID: "md-replace" }));
    await flush();
    await flush();
    expect(el.querySelector("iframe")).toBeNull();
    expectTrust(el, null);

    missing = false;
    application.dispatchEvent(new ArtifactContentChangedEvent("artifact-content-changed", { artifactID: "md-replace" }));
    await flush();
    await flush();
    const replacementFrame = frame(el);
    expect(replacementFrame).not.toBe(oldFrame);
    expectTrust(el, null);

    window.dispatchEvent(new MessageEvent("message", {
      data: { type: "navigation-request", url: "/artifact/md-replace/stale.html", native: true },
      source: oldWindow,
    }));
    await flush();
    expect(navigationRecord("md-replace")).toBeNull();
    expectTrust(el, null);
  });

  // spec: proofs/arch/artifact-frame/artifact-bridge.md#^ab-ac-replace-reset
  it("clears trust before public view URL retargeting", async () => {
    const el = mount({ id: "view-retarget", kind: "path", title: "View", path: "/tmp/view.html" }) as unknown as HTMLElement & {
      viewURL: string;
    };
    await flush();
    dispatchBridgeReady(el, "view-guid");
    await flush();
    expectTrust(el, "view-guid", frame(el).contentWindow);

    el.viewURL = "/views/replacement/";
    await flush();

    expect(frame(el).getAttribute("src")).toBe("/views/replacement/");
    expectTrust(el, null);
  });

  // spec: proofs/arch/artifact-frame/artifact-bridge.md#^ab-ac-bfcache
  it("re-adopts a persisted browser document only after leaving clears its remembered GUID", async () => {
    const url = "https://producer.test/artifact/01J00000000000000000000000/index.html";
    const el = mount({ id: "tv-bfcache", kind: "url", title: "Shared", url });
    await flush();

    dispatchBridgeReady(el, "guid-a");
    await flush();
    expectTrust(el, "guid-a", frame(el).contentWindow);

    dispatchFrameMessage(el, { type: "leaving", guid: "guid-a" });
    await flush();
    expectTrust(el, null);

    dispatchBridgeReady(el, "guid-a");
    await flush();
    expectTrust(el, "guid-a", frame(el).contentWindow);
  });

  // spec: proofs/arch/artifact-frame/artifact-bridge.md#^ab-ac-electron-nav
  // spec: proofs/arch/artifact-frame/artifact-bridge.md#^ab-ac-electron-subframe-nav
  it("retires Electron trust on full-document main-frame navigation only", async () => {
    window.history.replaceState(null, "", "/?mode=electron");
    const url = "https://producer.test/artifact/01J00000000000000000000000/index.html";
    const el = mount({ id: "tv-webview-nav", kind: "url", title: "Shared", url });
    await flush();
    const webview = el.querySelector("webview.artifact-content") as HTMLElement | null;
    if (!webview) throw new Error("Expected webview");

    dispatchWebviewIpc(webview, { type: "bridge-ready", guid: "guid-a" });
    await flush();
    expectTrust(el, "guid-a");

    webview.dispatchEvent(Object.assign(new Event("did-navigate-in-page"), { url: `${url}#section` }));
    await flush();
    expectTrust(el, "guid-a");

    webview.dispatchEvent(Object.assign(new Event("did-start-navigation"), { isMainFrame: true, isInPlace: true }));
    await flush();
    expectTrust(el, "guid-a");

    webview.dispatchEvent(Object.assign(new Event("did-start-navigation"), { isMainFrame: false, isInPlace: false }));
    await flush();
    expectTrust(el, "guid-a");

    webview.dispatchEvent(Object.assign(new Event("did-start-navigation"), { isMainFrame: true, isInPlace: false }));
    await flush();
    expectTrust(el, null);
  });

  // spec: proofs/arch/artifact-frame/artifact-bridge.md#^ab-ac-electron-fail
  // spec: proofs/arch/artifact-frame/artifact-bridge.md#^ab-ac-electron-subframe-fail
  it("retires Electron trust on main-frame failure and adopts an error document", async () => {
    window.history.replaceState(null, "", "/?mode=electron");
    const url = "https://producer.test/artifact/01J00000000000000000000000/index.html";
    const el = mount({ id: "tv-webview-fail", kind: "url", title: "Shared", url });
    const currentWebview = (): HTMLElement => {
      const webview = el.querySelector("webview.artifact-content") as HTMLElement | null;
      if (!webview) throw new Error("Expected webview");
      return webview;
    };
    await flush();

    dispatchWebviewIpc(currentWebview(), { type: "bridge-ready", guid: "guid-a" });
    await flush();
    expectTrust(el, "guid-a");

    currentWebview().dispatchEvent(Object.assign(new Event("did-fail-load"), { isMainFrame: false }));
    await flush();
    expectTrust(el, "guid-a");

    currentWebview().dispatchEvent(Object.assign(new Event("did-fail-load"), { isMainFrame: true }));
    await flush();
    expectTrust(el, null);

    dispatchWebviewIpc(currentWebview(), { type: "bridge-ready", guid: "error-guid" });
    await flush();
    expectTrust(el, "error-guid");
  });

  it("renders Electron path artifacts through webview without rendering an iframe", async () => {
    window.history.replaceState(null, "", "/?mode=electron");
    const el = mount({ id: "html", kind: "path", title: "HTML", path: "/tmp/index.html" });
    await flush();

    const webview = el.querySelector("webview.artifact-content");
    expect(webview?.getAttribute("src")).toBe("/artifact/html/index.html");
    expect(el.querySelector("iframe")).toBeNull();
  });

  it("routes Electron webview navigation-request IPC through artifact navigation", async () => {
    window.history.replaceState(null, "", "/?mode=electron");
    const el = mount({ id: "html", kind: "path", title: "HTML", path: "/tmp/index.html" });
    await flush();
    const webview = el.querySelector("webview.artifact-content") as HTMLElement | null;
    if (!webview) throw new Error("Expected webview");

    dispatchWebviewIpc(webview, { type: "navigation-request", url: "/artifact/html/page2.html" });
    await flush();

    const currentWebview = el.querySelector("webview.artifact-content") as HTMLElement | null;
    expect(currentWebview?.getAttribute("src")).toBe("/artifact/html/page2.html");
    expect(navigationRecord("html")?.entries).toEqual([
      { url: "/artifact/html/page2.html" },
    ]);
  });

  it("renders Electron markdown artifacts through webview with content IPC metadata", async () => {
    window.history.replaceState(null, "", "/?mode=electron");
    const el = mount({ id: "md", kind: "path", title: "Note", path: "/tmp/note.md" });
    await flush();

    const webview = el.querySelector<HTMLElement>("webview.artifact-content");
    expect(webview?.getAttribute("src")).toBe("/views/markdown/");
    expect(webview?.dataset.contentUrl).toBe("/markdown/md");
    expect(webview?.classList).not.toContain("artifact-frame");
    expect(el.querySelector("iframe")).toBeNull();
  });

  // spec: proofs/ui/app/artifact-frame/index.md#^af-ui-ac-frame-markup
  it("renders frame chrome states and named confirmation (^af-ui-ac-frame-markup)", async () => {
    const restoreDialog = installNativeDialogMock();
    try {
      const states = [
        { name: "no-history", entries: [], cursor: -1, back: false, forward: false, fullScreen: false },
        { name: "history-tail", entries: ["/page-1"], cursor: 0, back: true, forward: false, fullScreen: false },
        { name: "history-middle", entries: ["/page-1", "/page-2"], cursor: 0, back: true, forward: true, fullScreen: false },
        { name: "history-home", entries: ["/page-1", "/page-2"], cursor: -1, back: false, forward: true, fullScreen: false },
        { name: "full-screen", entries: [], cursor: -1, back: false, forward: false, fullScreen: true },
      ] as const;

      const menus = new Set<string>();
      for (const state of states) {
        const artifact = {
          id: `artifact-${state.name}`,
          kind: "path" as const,
          title: `Artifact ${state.name}`,
          path: `/tmp/${state.name}.html`,
        };
        setNavigationFixture(artifact.id, state.entries, state.cursor);
        const el = mountFrameContract({
          artifact,
          application: createApplication(),
          fullScreen: state.fullScreen,
        });
        await flush();

        const menu = el.querySelector<HTMLElement>("tv-menu");
        const menuTrigger = button(el, `${artifact.title} menu`);
        if (!menu) throw new Error("Expected artifact menu");
        menus.add(menuTrigger.id);
        expect(el.querySelector(".artifact-view")?.classList).toContain("artifact-frame");
        expect(frame(el).classList).toContain("artifact-content");
        expect(frame(el).classList).not.toContain("artifact-frame");
        expect(el.querySelector(".artifact-title")?.textContent).toBe(artifact.title);
        expect(frame(el).getAttribute("title")).toBe(artifact.title);
        expect(el.querySelector(".artifact-title-bar tv-icon[name='artifact']")).not.toBeNull();
        expect(menuTrigger.id).not.toBe("");
        expect(menuTrigger.nextElementSibling).toBe(menu);
        expect(menu.getAttribute("trigger")).toBe(menuTrigger.id);
        expect(menu.hasAttribute("placement")).toBe(false);

        const back = el.querySelector<HTMLButtonElement>("button[aria-label='Back']");
        const forward = el.querySelector<HTMLButtonElement>("button[aria-label='Forward']");
        if (state.back || state.forward) {
          expect(back?.disabled).toBe(!state.back);
          expect(forward?.disabled).toBe(!state.forward);
          expect(el.querySelector(".artifact-bar-divider")).not.toBeNull();
        } else {
          expect(back).toBeNull();
          expect(forward).toBeNull();
          expect(el.querySelector(".artifact-bar-divider")).toBeNull();
        }

        expect([...el.querySelectorAll("tv-menu-item")].map((item) => item.textContent?.trim())).toEqual([
          state.fullScreen ? "Exit full-screen" : "Make full-screen",
          "Delete",
        ]);
        expect(el.querySelectorAll("tv-menu hr")).toHaveLength(1);
        expect(el.querySelector('tv-menu-item[intent="danger"]')?.textContent?.trim()).toBe("Delete");
      }
      expect(menus.size).toBe(states.length);

      const confirmationHost = [...document.querySelectorAll<ArtifactViewTestHost>("artifact-view-test-host")]
        .find((candidate) => candidate.artifact.id === "artifact-no-history");
      if (!confirmationHost) throw new Error("Expected confirmation frame");
      [...confirmationHost.querySelectorAll<HTMLButtonElement>("tv-menu-item")]
        .find((item) => item.textContent?.trim() === "Delete")
        ?.click();
      await flush();

      const alert = confirmationHost.querySelector("[role='alertdialog']");
      const actions = [...confirmationHost.querySelectorAll<HTMLButtonElement>(".dialog-actions button")];
      expect(alert?.querySelector("h2")?.textContent).toBe("Delete “Artifact no-history”?");
      expect(alert?.querySelector("p")?.textContent).toBe(
        "It’s removed from this channel; the file or web page it points to is not deleted.",
      );
      expect(actions.map((action) => action.textContent?.trim())).toEqual(["Cancel", "Delete"]);
      expect(actions[0]).toBe(document.activeElement);
      expect(actions[1]?.getAttribute("intent")).toBe("danger");
      actions[0]?.click();
      await flush();
    } finally {
      restoreDialog();
    }
  });

  // spec: proofs/ui/app/artifact-frame/index.md#^af-ui-ac-frame-actions
  it("routes frame controls through navigation and application operations without replacing the host (^af-ui-ac-frame-actions)", async () => {
    const restoreDialog = installNativeDialogMock();
    try {
      const artifact = { id: "actions", kind: "path" as const, title: "Action frame", path: "/tmp/actions.html" };
      setNavigationFixture(artifact.id, ["/artifact/actions/page-1.html", "/artifact/actions/page-2.html"], 0);
      const application = Object.assign(createApplication(), {
        deleteArtifact: vi.fn(async () => undefined),
      });
      const recordFullScreenRequest = vi.fn<(fullScreen: boolean) => void>();
      const el = mountFrameContract({
        artifact,
        application,
      });
      el.onFullScreenChange = recordFullScreenRequest;
      await flush();
      const ownedFrame = frame(el);
      const ownedWindow = ownedFrame.contentWindow;
      const state = (el.view as unknown as {
        _navigationState: { back(): void; forward(): void };
      })._navigationState;
      const back = vi.spyOn(state, "back");
      const forward = vi.spyOn(state, "forward");

      button(el, "Back").click();
      await flush();
      expect(back).toHaveBeenCalledOnce();
      expect(forward).not.toHaveBeenCalled();

      button(el, "Forward").click();
      await flush();
      expect(forward).toHaveBeenCalledOnce();
      const chromeWindow = frame(el).contentWindow;

      const menuAction = (label: string): HTMLButtonElement => {
        const action = [...el.querySelectorAll<HTMLButtonElement>("tv-menu-item")]
          .find((candidate) => candidate.textContent?.trim() === label);
        if (!action) throw new Error(`Expected ${label} menu action`);
        return action;
      };
      menuAction("Make full-screen").click();
      expect(recordFullScreenRequest).toHaveBeenLastCalledWith(true);

      el.fullScreen = true;
      await flush();
      menuAction("Exit full-screen").click();
      expect(recordFullScreenRequest).toHaveBeenLastCalledWith(false);

      el.fullScreen = false;
      await flush();
      const titleBar = el.querySelector<HTMLElement>(".artifact-title-bar");
      if (!titleBar) throw new Error("Expected artifact title bar");
      titleBar.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
      expect(recordFullScreenRequest).toHaveBeenLastCalledWith(true);
      const toggleCalls = recordFullScreenRequest.mock.calls.length;
      button(el, "Action frame menu").dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
      expect(recordFullScreenRequest).toHaveBeenCalledTimes(toggleCalls);

      menuAction("Delete").click();
      await flush();
      let dialogActions = [...el.querySelectorAll<HTMLButtonElement>(".dialog-actions button")];
      dialogActions[0]?.click();
      await flush();
      expect(application.deleteArtifact).not.toHaveBeenCalled();
      expect(el.querySelector("dialog")).toBeNull();

      menuAction("Delete").click();
      await flush();
      dialogActions = [...el.querySelectorAll<HTMLButtonElement>(".dialog-actions button")];
      dialogActions[1]?.click();
      await flush();
      expect(application.deleteArtifact).toHaveBeenCalledOnce();
      expect(application.deleteArtifact).toHaveBeenCalledWith(artifact.id);
      expect(frame(el)).toBe(ownedFrame);
      expect(frame(el).contentWindow).toBe(chromeWindow);
      expect(ownedWindow).not.toBeNull();
    } finally {
      restoreDialog();
    }
  });

  // spec: proofs/product/artifact-navigation.md#^ac-forward-truncation
  // spec: proofs/arch/artifact-frame/reload-navigation.md#^rn-ac-forward-truncation
  it("discard forwards entries when navigating after back", async () => {
    const el = mount({ id: "html", kind: "path", title: "HTML", path: "/tmp/index.html" });
    await flush();
    dispatchNavigation(el, { url: "/artifact/html/page1.html" });
    dispatchNavigation(el, { url: "/artifact/html/page2.html" });
    await flush();

    button(el, "Back").click();
    await flush();
    dispatchNavigation(el, { url: "/artifact/html/page3.html" });
    await flush();

    expect(navigationRecord("html")?.entries).toEqual([
      { url: "/artifact/html/page1.html" },
      { url: "/artifact/html/page3.html" },
    ]);
    expect(navigationRecord("html")?.cursor).toBe(1);
  });

  // spec: proofs/arch/artifact-frame/artifact-bridge.md#^ab-ac-no-adoption
  it("records same-document navigation without changing iframe src", async () => {
    const internalURL = "https://internal.test/artifact/html/index.html";
    const el = mount({ id: "html", kind: "path", title: "HTML", path: "/tmp/index.html" }) as unknown as HTMLElement & {
      viewURL: string;
    };
    el.viewURL = internalURL;
    await flush();
    const iframe = frame(el);
    dispatchBridgeReady(el, "same-document-guid");
    await flush();
    const setAttribute = vi.spyOn(iframe, "setAttribute");

    dispatchNavigation(el, { url: `${internalURL}#section`, sameDocument: true });
    await flush();

    expect(navigationRecord("html")?.entries).toEqual([
      { url: "/artifact/html/index.html#section" },
    ]);
    expect(frame(el).getAttribute("src")).toBe(internalURL);
    expect(setAttribute).not.toHaveBeenCalledWith("src", expect.any(String));
    expectTrust(el, "same-document-guid", iframe.contentWindow);
  });

  it("shows the unsupported page for external browser navigation", async () => {
    const el = mount({ id: "html", kind: "path", title: "HTML", path: "/tmp/index.html" });
    await flush();

    dispatchNavigation(el, { url: "https://example.com/page" });
    await flush();

    expect(frame(el).getAttribute("src")).toBe("/views/url-unsupported/");
    expect(navigationRecord("html")?.entries).toEqual([{ url: "https://example.com/page" }]);
  });

  // spec: proofs/arch/artifact-frame/reload-navigation.md#^rn-ac-web-navigation-ingress
  it("rejects non-web browser navigation before conversion or history mutation", async () => {
    const el = mount({ id: "non-web", kind: "path", title: "HTML", path: "/tmp/index.html" });
    await flush();
    const initialSrc = frame(el).getAttribute("src");

    for (const url of [
      "example-app://open/item",
      "obsidian://open?vault=pages&file=note",
      "javascript:document.body.textContent='owned'",
      "file:///tmp/note.html",
      "http://[",
    ]) {
      dispatchNavigation(el, { url });
      await flush();
    }

    expect(navigationRecord("non-web")).toBeNull();
    expect(frame(el).getAttribute("src")).toBe(initialSrc);
  });

  // spec: proofs/arch/artifact-frame/reload-navigation.md#^rn-ac-current-route
  it("does not treat two opaque URL origins as same-origin", () => {
    const url = "obsidian://open?vault=pages&file=note";
    expect(convertURLForInternalOrigin(url, url)).toBe(url);
  });

  // spec: proofs/arch/artifact-frame/reload-navigation.md#^rn-ac-current-route
  it("derives internal navigation from the artifact canonical origin, not frame src", async () => {
    const internalURL = "https://internal.test/artifact/canonical/index.html";
    const el = mount({ id: "canonical", kind: "path", title: "HTML", path: "/tmp/index.html" }) as unknown as HTMLElement & {
      viewURL: string;
    };
    el.viewURL = internalURL;
    await flush();
    const iframe = frame(el);
    const originalGetAttribute = iframe.getAttribute.bind(iframe);
    const getAttribute = vi.spyOn(iframe, "getAttribute").mockImplementation((name) =>
      name === "src" ? "https://other.test/current.html" : originalGetAttribute(name)
    );

    dispatchNavigation(el, { url: "https://other.test/next.html" });
    getAttribute.mockRestore();
    await flush();

    expect(navigationRecord("canonical")?.entries).toEqual([
      { url: "https://other.test/next.html" },
    ]);
    expect(frame(el).getAttribute("src")).toBe("/views/url-unsupported/");
  });

  // spec: proofs/arch/artifact-frame/artifact-bridge.md#^ab-ac-view-replies
  it("replies to unsupported page URL target requests with the current external navigation target", async () => {
    const el = mount({ id: "html", kind: "path", title: "HTML", path: "/tmp/index.html" });
    await flush();
    dispatchNavigation(el, { url: "https://example.com/page" });
    await flush();

    const postMessage = requestURLTarget(el);

    expect(postMessage).toHaveBeenCalledWith(
      { type: "url-target", url: "https://example.com/page" },
      "*",
    );
    expect(frame(el).getAttribute("src")).toBe("/views/url-unsupported/");

    postMessage.mockRestore();
    const setAttribute = vi.spyOn(frame(el), "setAttribute");
    dispatchNavigation(el, { url: "https://example.com/updated" });
    await flush();

    expect(setAttribute).toHaveBeenCalledWith("src", "/views/url-unsupported/");
    expect(frame(el).getAttribute("src")).toBe("/views/url-unsupported/");

    // This injected request proves the host's current answer. FRAME-2 owns the
    // real unsupported view's displayed-target outcome after reassignment.
    const currentPostMessage = requestURLTarget(el);
    expect(currentPostMessage).toHaveBeenCalledWith(
      { type: "url-target", url: "https://example.com/updated" },
      "*",
    );
  });

  it("suppresses duplicate navigation requests that match the current URL", async () => {
    const el = mount({ id: "html", kind: "path", title: "HTML", path: "/tmp/index.html" });
    await flush();
    dispatchNavigation(el, { url: "/artifact/html/page2.html" });
    await flush();
    const iframe = frame(el);
    const setAttribute = vi.spyOn(iframe, "setAttribute");

    dispatchNavigation(el, { url: "/artifact/html/page2.html" });
    await flush();

    expect(navigationRecord("html")?.entries).toEqual([
      { url: "/artifact/html/page2.html" },
    ]);
    expect(setAttribute).not.toHaveBeenCalled();
  });

  it("does not assign iframe src when navigation render already targets the current URL", async () => {
    const el = mount({ id: "html", kind: "path", title: "HTML", path: "/tmp/index.html" });
    await flush();
    dispatchNavigation(el, { url: "/artifact/html/page2.html" });
    await flush();
    const iframe = frame(el);
    const setAttribute = vi.spyOn(iframe, "setAttribute");

    el.rerender();
    await flush();

    expect(frame(el).getAttribute("src")).toBe("/artifact/html/page2.html");
    expect(setAttribute).not.toHaveBeenCalledWith("src", "/artifact/html/page2.html");
  });

  it("removes the navigation state listener on disconnect", async () => {
    const el = mount({ id: "html", kind: "path", title: "HTML", path: "/tmp/index.html" });
    await flush();
    const state = (el.view as unknown as { _navigationState: EventTarget })._navigationState;
    const removeEventListener = vi.spyOn(state, "removeEventListener");

    el.remove();

    expect(removeEventListener).toHaveBeenCalledWith("change", expect.any(Function));
  });

  // spec: proofs/arch/artifact-frame/reload-navigation.md#^rn-ac-state-binding
  it("disposes old navigation state when artifact is reassigned", async () => {
    const el = mount({ id: "html", kind: "path", title: "HTML", path: "/tmp/index.html" });
    await flush();
    dispatchNavigation(el, { url: "/artifact/html/page2.html" });
    await flush();
    const firstState = (el.view as unknown as { _navigationState: EventTarget })._navigationState;
    const removeFirstListener = vi.spyOn(firstState, "removeEventListener");

    el.artifact = { id: "next", kind: "path", title: "Next", path: "/tmp/next.html" };
    await flush();

    expect(removeFirstListener).toHaveBeenCalledWith("change", expect.any(Function));
    expect(frame(el).getAttribute("src")).toBe("/artifact/next/next.html");

    const secondState = (el.view as unknown as { _navigationState: EventTarget })._navigationState;
    const removeSecondListener = vi.spyOn(secondState, "removeEventListener");
    el.artifact = { id: "next", kind: "path", title: "Next", path: "/tmp/moved.html" };
    await flush();

    expect(removeSecondListener).toHaveBeenCalledWith("change", expect.any(Function));
    expect(frame(el).getAttribute("src")).toBe("/artifact/next/moved.html");
  });

  it("creates navigation state after artifact is set before connection", async () => {
    const el = mountAfterArtifactSet({ id: "html", kind: "path", title: "HTML", path: "/tmp/index.html" });
    await flush();

    dispatchNavigation(el, { url: "/artifact/html/page2.html" });
    await flush();

    expect(frame(el).getAttribute("src")).toBe("/artifact/html/page2.html");
    expect(navigationRecord("html")?.entries).toEqual([
      { url: "/artifact/html/page2.html" },
    ]);
  });

  // spec: proofs/arch/artifact-frame/artifact-bridge.md#^ab-ac-subscribe-first
  it("subscribes before creating a loadable frame when artifact is set before connection", async () => {
    const el = document.createElement("artifact-view-test-host") as ArtifactViewTestHost;
    el.artifact = { id: "fast-html", kind: "path", title: "HTML", path: "/tmp/index.html" };
    expect(el.querySelector("iframe")).toBeNull();

    document.body.appendChild(el);
    const iframe = frame(el);
    dispatchBridgeReady(el, "fast-local-guid");
    await flush();

    expect(iframe.getAttribute("src")).toBe("/artifact/fast-html/index.html");
    expectTrust(el, "fast-local-guid", iframe.contentWindow);
  });

  // spec: proofs/product/artifact-navigation.md#^ac-persisted
  // spec: proofs/arch/artifact-frame/reload-navigation.md#^ac-persist
  it("restores persisted navigation state when connected", async () => {
    localStorage.setItem(
      artifactNavigationStorageKey("html"),
      JSON.stringify({
        v: 1,
        entries: [{ url: "/artifact/html/page2.html" }],
        cursor: 0,
        lastWritten: Date.now(),
      } satisfies ArtifactNavigationRecord),
    );

    const internalURL = "https://internal.test/artifact/html/index.html";
    const el = document.createElement("artifact-view-test-host") as ArtifactViewTestHost;
    el.viewURL = internalURL;
    el.artifact = { id: "html", kind: "path", title: "HTML", path: "/tmp/index.html" };
    document.body.appendChild(el);
    await flush();

    expect(frame(el).getAttribute("src")).toBe(
      "https://internal.test/artifact/html/page2.html",
    );
    expect(navigationRecord("html")?.cursor).toBe(0);
  });

  // spec: proofs/arch/artifact-frame/reload-navigation.md#^rn-ac-reload-target
  it("hosts markdown content over Electron webview IPC", async () => {
    window.history.replaceState(null, "", "/?mode=electron");
    let markdownContent = "# Initial";
    const application = createApplication({
      get: vi.fn(async () => markdownContent),
      update: vi.fn(async ({ content }: { content: string }) => {
        markdownContent = content;
      }),
    });
    const el = mount({ id: "md", kind: "path", title: "Note", path: "/tmp/note.md" }) as unknown as HTMLElement & { application: unknown };
    el.application = application;
    await flush();

    const webview = el.querySelector("webview[data-content-url]") as unknown as HTMLElement & { send: ReturnType<typeof vi.fn> };
    if (!webview) throw new Error("Expected markdown webview");
    const markdownViewSrc = webview.getAttribute("src");
    const setAttribute = vi.spyOn(webview, "setAttribute");
    webview.send = vi.fn();

    dispatchWebviewIpc(webview, { type: "ready" });
    expect(webview.send).toHaveBeenCalledWith(WEBVIEW_BRIDGE_CHANNEL, {
      type: "content-updated",
      content: "# Initial",
    });

    markdownContent = "# Remote";
    application.dispatchEvent(new ArtifactContentChangedEvent("artifact-content-changed", { artifactID: "md" }));
    await flush();
    expect(webview.send).toHaveBeenCalledWith(WEBVIEW_BRIDGE_CHANNEL, {
      type: "content-updated",
      content: "# Remote",
    });
    expect(webview.getAttribute("src")).toBe(markdownViewSrc);
    expect(setAttribute).not.toHaveBeenCalledWith("src", expect.any(String));

    dispatchWebviewIpc(webview, { type: "update-content", id: "save-1", content: "# Edited" });
    await flush();
    expect(application.markdown.update).toHaveBeenCalledWith({ artifactID: "md", content: "# Edited" });
    expect(webview.send).toHaveBeenCalledWith(WEBVIEW_BRIDGE_CHANNEL, {
      type: "response",
      id: "save-1",
      result: {},
    });
    expect(markdownContent).toBe("# Edited");
  });

  it("records Electron webview did-navigate events without stripping external origins", async () => {
    window.history.replaceState(null, "", "/?mode=electron");
    const el = mount({ id: "url", kind: "url", title: "Remote", url: "https://example.com/start" });
    await flush();
    const webview = el.querySelector("webview")!;

    webview.dispatchEvent(new CustomEvent("did-navigate", {
      detail: {},
      bubbles: false,
      cancelable: false,
    }));
    webview.dispatchEvent(Object.assign(new Event("did-navigate"), { url: "https://example.com/next" }));
    await flush();

    expect(navigationRecord("url")?.entries).toEqual([{ url: "https://example.com/next" }]);
    expect(webview.getAttribute("src")).toBe("https://example.com/next");
  });

  // spec: proofs/arch/artifact-frame/reload-navigation.md#^rn-ac-main-frame-navigation
  it("ignores Electron webview did-navigate-in-page events from child frames", async () => {
    window.history.replaceState(null, "", "/?mode=electron");
    const el = mount({ id: "url", kind: "url", title: "Remote", url: "https://example.com/start" });
    await flush();
    const webview = el.querySelector("webview")!;
    const state = (el.view as unknown as { _navigationState: ArtifactNavigationState })._navigationState;
    const before = { currentURL: state.currentURL, historyLength: state.entries.length };

    webview.dispatchEvent(Object.assign(new Event("did-navigate-in-page"), {
      url: "https://example.com/child#section",
      isMainFrame: false,
    }));
    await flush();

    expect({ currentURL: state.currentURL, historyLength: state.entries.length }).toEqual(before);
  });

  // spec: proofs/arch/artifact-frame/reload-navigation.md#^rn-ac-web-navigation-ingress
  it("rejects non-web Electron full and in-page navigation events", async () => {
    window.history.replaceState(null, "", "/?mode=electron");
    const el = mount({ id: "electron-non-web", kind: "url", title: "Remote", url: "https://example.com/start" });
    await flush();
    const webview = el.querySelector("webview")!;
    const initialSrc = webview.getAttribute("src");

    webview.dispatchEvent(Object.assign(new Event("did-navigate"), {
      url: "example-app://open/item",
    }));
    webview.dispatchEvent(Object.assign(new Event("did-navigate-in-page"), {
      url: "javascript:document.body.textContent='owned'",
    }));
    await flush();

    expect(navigationRecord("electron-non-web")).toBeNull();
    expect(webview.getAttribute("src")).toBe(initialSrc);
  });

  it("suppresses Electron webview navigation events that match current history", async () => {
    window.history.replaceState(null, "", "/?mode=electron");
    const el = mount({ id: "url", kind: "url", title: "Remote", url: "https://example.com/start" });
    await flush();
    const webview = el.querySelector("webview")!;

    webview.dispatchEvent(Object.assign(new Event("did-navigate"), { url: "https://example.com/next" }));
    await flush();
    webview.dispatchEvent(Object.assign(new Event("did-navigate"), { url: "https://example.com/next" }));
    await flush();

    expect(navigationRecord("url")?.entries).toEqual([{ url: "https://example.com/next" }]);
  });

  it("does not record Electron path webview reload URLs as navigation", async () => {
    window.history.replaceState(null, "", "/?mode=electron");
    const el = mount({ id: "html", kind: "path", title: "HTML", path: "/tmp/index.html" });
    await flush();
    const webview = el.querySelector("webview")!;

    webview.dispatchEvent(Object.assign(new Event("did-navigate"), {
      url: `${window.location.origin}/artifact/html/index.html?tv-reload=1`,
    }));
    await flush();

    expect(navigationRecord("html")).toBeNull();
  });

  // spec: proofs/arch/artifact-frame/reload-navigation.md#^rn-ac-local-content
  it("reloads proxy iframes when artifact content changes", async () => {
    const application = createApplication();
    const el = mount({ id: "html", kind: "path", title: "HTML", path: "/tmp/index.html" }) as unknown as HTMLElement & { application: unknown };
    el.application = application;
    await flush();

    const iframe = frame(el);
    const setAttribute = vi.spyOn(iframe, "setAttribute");
    application.dispatchEvent(new ArtifactContentChangedEvent("artifact-content-changed", { artifactID: "other" }));
    expect(setAttribute).not.toHaveBeenCalled();

    application.dispatchEvent(new ArtifactContentChangedEvent("artifact-content-changed", { artifactID: "html" }));
    expect(setAttribute).toHaveBeenCalledWith("src", "/artifact/html/index.html?tv-reload=1");

    const sharedURL = "https://producer.test/artifact/01J00000000000000000000000/index.html";
    const shared = mount({ id: "shared", kind: "url", title: "Shared", url: sharedURL }) as unknown as HTMLElement & { application: unknown };
    shared.application = application;
    await flush();
    const sharedSetAttribute = vi.spyOn(frame(shared), "setAttribute");

    application.dispatchEvent(new ArtifactContentChangedEvent("artifact-content-changed", { artifactID: "shared" }));

    expect(sharedSetAttribute).not.toHaveBeenCalled();
    expect(frame(shared).getAttribute("src")).toBe(sharedURL);
  });

  it("does not record artifact-content-changed reload reports as navigation", async () => {
    const application = createApplication();
    const el = mount({ id: "html", kind: "path", title: "HTML", path: "/tmp/index.html" }) as unknown as HTMLElement & { application: unknown };
    el.application = application;
    await flush();

    application.dispatchEvent(new ArtifactContentChangedEvent("artifact-content-changed", { artifactID: "html" }));
    dispatchNavigation(el, { url: "/artifact/html/index.html?tv-reload=1" });
    await flush();

    expect(navigationRecord("html")).toBeNull();
  });

  // spec: proofs/arch/artifact-frame/reload-navigation.md#^ac-forward-reload
  it("preserves forward history when a navigated sub-page hot-reloads", async () => {
    const application = createApplication();
    const el = mount({ id: "html", kind: "path", title: "HTML", path: "/tmp/index.html" }) as unknown as HTMLElement & { application: unknown };
    el.application = application;
    await flush();

    dispatchNavigation(el, { url: "/artifact/html/page1.html" });
    dispatchNavigation(el, { url: "/artifact/html/page2.html" });
    await flush();
    button(el, "Back").click();
    await flush();

    application.dispatchEvent(new ArtifactContentChangedEvent("artifact-content-changed", { artifactID: "html" }));
    dispatchNavigation(el, { url: "/artifact/html/page1.html?tv-reload=1" });
    await flush();

    expect(navigationRecord("html")?.entries).toEqual([
      { url: "/artifact/html/page1.html" },
      { url: "/artifact/html/page2.html" },
    ]);
    expect(navigationRecord("html")?.cursor).toBe(0);
  });

  it("moves artifact-content-changed subscriptions when the application changes", async () => {
    const oldApplication = createApplication();
    const newApplication = createApplication();
    const el = mount({ id: "html", kind: "path", title: "HTML", path: "/tmp/index.html" }) as unknown as HTMLElement & { application: unknown };
    el.application = oldApplication;
    await flush();
    el.application = newApplication;
    await flush();

    const iframe = frame(el);
    const setAttribute = vi.spyOn(iframe, "setAttribute");
    oldApplication.dispatchEvent(new ArtifactContentChangedEvent("artifact-content-changed", { artifactID: "html" }));
    expect(setAttribute).not.toHaveBeenCalled();

    newApplication.dispatchEvent(new ArtifactContentChangedEvent("artifact-content-changed", { artifactID: "html" }));
    expect(setAttribute).toHaveBeenCalledWith("src", "/artifact/html/index.html?tv-reload=1");
  });

  it("removes artifact-content-changed application subscriptions on disconnect", async () => {
    const application = createApplication();
    const el = mount({ id: "html", kind: "path", title: "HTML", path: "/tmp/index.html" }) as unknown as HTMLElement & { application: unknown };
    el.application = application;
    await flush();

    const iframe = frame(el);
    const setAttribute = vi.spyOn(iframe, "setAttribute");
    el.remove();
    application.dispatchEvent(new ArtifactContentChangedEvent("artifact-content-changed", { artifactID: "html" }));

    expect(setAttribute).not.toHaveBeenCalled();
  });

  // spec: proofs/arch/artifact-frame/reload-navigation.md#^ac-theme-exception
  it("reloads proxy iframes when the active theme changes", async () => {
    const application = createApplication();
    const el = mount({ id: "html", kind: "path", title: "HTML", path: "/tmp/index.html" }) as unknown as HTMLElement & { application: unknown };
    el.application = application;
    await flush();

    const iframe = frame(el);
    const setAttribute = vi.spyOn(iframe, "setAttribute");
    application.dispatchEvent(new ThemeChangedEvent("theme-changed", {
      themeName: "paperlike",
      activeThemeColorScheme: "light dark",
      themeJavaScriptConsentIds: [],
    }));
    application.dispatchEvent(new ThemeChangedEvent("theme-changed", {
      themeName: "midnight",
      activeThemeColorScheme: "dark",
      themeJavaScriptConsentIds: [],
    }));

    expect(setAttribute.mock.calls.filter(([name]) => name === "src")).toEqual([
      ["src", "/artifact/html/index.html?tv-reload=1"],
      ["src", "/artifact/html/index.html?tv-reload=2"],
    ]);

    const sharedURL = "https://producer.test/artifact/01J00000000000000000000000/index.html";
    const shared = mount({ id: "shared-theme", kind: "url", title: "Shared", url: sharedURL }) as unknown as HTMLElement & { application: unknown };
    shared.application = application;
    await flush();
    const sharedSetAttribute = vi.spyOn(frame(shared), "setAttribute");

    application.dispatchEvent(new ThemeChangedEvent("theme-changed", {
      themeName: "paperlike",
      activeThemeColorScheme: "light dark",
      themeJavaScriptConsentIds: [],
    }));

    expect(sharedSetAttribute).not.toHaveBeenCalled();
    expect(frame(shared).getAttribute("src")).toBe(sharedURL);
  });

});
describe("browser demo mode artifact frame", () => {
  const RETURN_LABEL = "Return to the original page";
  const ULID = "01J0000000000000000000ABCD";
  const external = { id: "demo-page", kind: "url" as const, title: "Demo page", url: "https://news.example/start" };

  beforeEach(() => {
    document.body.innerHTML = "";
    localStorage.clear();
    window.history.replaceState(null, "", "/");
  });

  function demoApplication(on: boolean) {
    return Object.assign(createApplication(), {
      browserDemoMode: on,
      deleteArtifact: vi.fn(async () => undefined),
    });
  }

  function returnButton(el: HTMLElement): HTMLButtonElement | null {
    return el.querySelector<HTMLButtonElement>(`.artifact-title-bar button[aria-label='${RETURN_LABEL}']`);
  }

  // spec: proofs/ui/app/artifact-frame/index.md#^af-ui-ac-frame-markup
  it("renders the return state with the icon in a button and no direction controls (^af-ui-ac-frame-markup)", async () => {
    setNavigationFixture(external.id, ["https://news.example/a", "https://news.example/b"], 0);
    const el = mountFrameContract({ artifact: external, application: demoApplication(true) });
    await flush();

    const control = returnButton(el);
    expect(control?.classList).toContain("artifact-return");
    expect(control?.querySelector("tv-icon[name='artifact']")).not.toBeNull();
    expect(el.querySelector("button[aria-label='Back']")).toBeNull();
    expect(el.querySelector("button[aria-label='Forward']")).toBeNull();
    expect(el.querySelector(".artifact-bar-divider")).toBeNull();
    expect(frame(el).getAttribute("src")).toBe(external.url);
  });

  // spec: proofs/ui/app/artifact-frame/index.md#^af-ui-ac-return-scope
  it("makes the artifact icon a button only for an external page artifact in a browser under demo mode (^af-ui-ac-return-scope)", async () => {
    const artifacts: Artifact[] = [
      external,
      { id: "shared", kind: "url", title: "Shared", url: `https://other.example/artifact/${ULID}/` },
      { id: "path", kind: "path", title: "Path", path: "/tmp/page.html" },
      { id: "note", kind: "path", title: "Note", path: "/tmp/note.md" },
      { id: "app-link", kind: "url", title: "App link", url: "obsidian://open?vault=x" },
    ];
    for (const electron of [false, true]) {
      window.history.replaceState(null, "", electron ? "/?mode=electron" : "/");
      for (const demo of [false, true]) {
        for (const artifact of artifacts) {
          document.body.innerHTML = "";
          const el = mountFrameContract({ artifact, application: demoApplication(demo) });
          await flush();
          const expected = !electron && demo && artifact.id === external.id;
          const label = `${artifact.id} electron=${electron} demo=${demo}`;
          const icon = el.querySelector(".artifact-title-bar tv-icon[name='artifact']");
          expect(icon, label).not.toBeNull();
          expect(icon?.closest("button") ?? null, label).toBe(expected ? returnButton(el) : null);
          expect(returnButton(el) !== null, label).toBe(expected);
        }
      }
    }
  });

  // spec: proofs/ui/app/artifact-frame/index.md#^af-ui-ac-frame-actions
  it("assigns the artifact's own URL as the frame src when return is pressed (^af-ui-ac-frame-actions)", async () => {
    const application = demoApplication(true);
    const recordFullScreenRequest = vi.fn<(fullScreen: boolean) => void>();
    const el = mountFrameContract({ artifact: external, application });
    el.onFullScreenChange = recordFullScreenRequest;
    await flush();
    const ownedFrame = frame(el);
    const setAttribute = vi.spyOn(ownedFrame, "setAttribute");

    returnButton(el)?.click();
    await flush();
    expect(setAttribute).toHaveBeenCalledWith("src", external.url);
    expect(frame(el)).toBe(ownedFrame);

    returnButton(el)?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    expect(recordFullScreenRequest).not.toHaveBeenCalled();
    expect(application.handleNavigationKey).not.toHaveBeenCalled();
    expect(application.deleteArtifact).not.toHaveBeenCalled();
  });

  // spec: proofs/product/artifacts.md#^af-ac-demo-untouched
  it("leaves a demo-mode page's URL untouched through theme and content change events (^af-ac-demo-untouched)", async () => {
    const application = demoApplication(true);
    const el = mountFrameContract({ artifact: external, application });
    await flush();
    const ownedFrame = frame(el);
    const setAttribute = vi.spyOn(ownedFrame, "setAttribute");

    application.dispatchEvent(new ThemeChangedEvent("theme-changed", {
      themeName: "paperlike",
      activeThemeColorScheme: "light dark",
      themeJavaScriptConsentIds: [],
    }));
    application.dispatchEvent(new ArtifactContentChangedEvent("artifact-content-changed", { artifactID: external.id }));
    await flush();

    expect(setAttribute).not.toHaveBeenCalledWith("src", expect.anything());
    expect(frame(el)).toBe(ownedFrame);
    expect(frame(el).getAttribute("src")).toBe(external.url);
  });

  // spec: proofs/arch/artifact-frame/artifact-bridge.md#^ab-ac-demo-inert-host
  it("acts on no bridge message from a demo-mode frame (^ab-ac-demo-inert-host)", async () => {
    const application = demoApplication(true);
    const el = mountFrameContract({ artifact: external, application });
    await flush();
    const view = el.view as unknown as { handleTrustedFrameMessage(...args: unknown[]): void };
    const handled = vi.spyOn(view, "handleTrustedFrameMessage");
    const iframeWindow = frame(el).contentWindow;
    if (!iframeWindow) throw new Error("Expected iframe contentWindow");
    const replies = vi.spyOn(iframeWindow, "postMessage").mockImplementation(() => {});
    const src = frame(el).getAttribute("src");

    const messages = [
      { type: "bridge-ready", guid: "demo-guid" },
      { type: "navigation-request", url: "https://news.example/elsewhere" },
      { type: "navigation-request", url: "https://news.example/native", native: true },
      { type: "navigation-key", key: "ArrowDown" },
      { type: "artifact-pointer", eventType: "pointermove", clientX: 4, clientY: 5, button: 0, buttons: 0 },
      { type: "proxy-content-changed" },
      { type: "url-target-request" },
      { type: "artifact-missing-request" },
      { type: "leaving", guid: "demo-guid" },
    ];
    for (const data of messages) {
      window.dispatchEvent(new MessageEvent("message", { data, origin: "https://news.example", source: iframeWindow }));
      await flush();
    }

    expect(handled).not.toHaveBeenCalled();
    expect(application.handleNavigationKey).not.toHaveBeenCalled();
    expect(replies).not.toHaveBeenCalled();
    expect(navigationRecord(external.id)).toBeNull();
    expectTrust(el, null);
    expect(frame(el).getAttribute("src")).toBe(src);
    expect(el.querySelector("button[aria-label='Back']")).toBeNull();
  });
});

// spec: proofs/arch/artifact-frame/isolation.md#^iso-t-attributes
describe("artifact frame sandbox and allow attributes (^iso-t-attributes)", () => {
  const SANDBOX = "allow-scripts allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox allow-downloads";
  const ALLOW = "clipboard-write; fullscreen; autoplay; picture-in-picture; web-share; encrypted-media";
  const SHARED_URL = "https://producer.test/artifact/01J00000000000000000000000/index.html";

  interface Assignment {
    frame: Element;
    src: string;
    sandbox: string | null;
    allow: string | null;
  }

  let assignments: Assignment[] = [];

  beforeEach(() => {
    document.body.innerHTML = "";
    localStorage.clear();
    window.history.replaceState(null, "", "/");
    assignments = [];
    // Each frame's attributes at the moment its `src` is assigned.
    const setAttribute = Element.prototype.setAttribute;
    vi.spyOn(Element.prototype, "setAttribute").mockImplementation(function (this: Element, name: string, value: string) {
      if (this.tagName === "IFRAME" && name === "src") {
        assignments.push({ frame: this, src: value, sandbox: this.getAttribute("sandbox"), allow: this.getAttribute("allow") });
      }
      setAttribute.call(this, name, value);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function recorded(): Array<Omit<Assignment, "frame">> {
    return assignments.map(({ src, sandbox, allow }) => ({ src, sandbox, allow }));
  }

  it("sandboxes proxied and shared documents, and nothing else, as one iframe element moves between them", async () => {
    const application = Object.assign(createApplication(), { browserDemoMode: true });
    const el = mountFrameContract({ artifact: { id: "page", kind: "path", title: "Page", path: "/tmp/page.html" }, application });
    await flush();
    const element = frame(el);
    for (const artifact of [
      { id: "notes", kind: "path", title: "Notes", path: "/tmp/notes.md" },
      { id: "shared", kind: "url", title: "Shared", url: SHARED_URL },
      { id: "demo", kind: "url", title: "Demo", url: "https://news.example/start" },
      { id: "site", kind: "path", title: "Site", path: "/tmp/site/" },
      { id: "demo", kind: "url", title: "Demo", url: "https://news.example/start" },
      { id: "notes", kind: "path", title: "Notes", path: "/tmp/notes.md" },
      { id: "page", kind: "path", title: "Page", path: "/tmp/page.html" },
    ] satisfies Artifact[]) {
      el.artifact = artifact;
      await flush();
      expect(frame(el)).toBe(element);
    }

    expect(assignments.every((assignment) => assignment.frame === element)).toBe(true);
    expect(recorded()).toEqual([
      { src: "/artifact/page/page.html", sandbox: SANDBOX, allow: ALLOW },
      { src: "/views/markdown/", sandbox: null, allow: ALLOW },
      { src: SHARED_URL, sandbox: SANDBOX, allow: ALLOW },
      { src: "https://news.example/start", sandbox: null, allow: ALLOW },
      { src: "/artifact/site/", sandbox: SANDBOX, allow: ALLOW },
      { src: "https://news.example/start", sandbox: null, allow: ALLOW },
      { src: "/views/markdown/", sandbox: null, allow: ALLOW },
      { src: "/artifact/page/page.html", sandbox: SANDBOX, allow: ALLOW },
    ]);

    el.artifact = { id: "demo", kind: "url", title: "Demo", url: "https://news.example/start" };
    await flush();
    button(el, "Return to the original page").click();
    expect(recorded().at(-1)).toEqual({ src: "https://news.example/start", sandbox: null, allow: ALLOW });
  });

  it("sandboxes a proxied Markdown file and not the placeholder for an external page when Back and Forward assign them", async () => {
    const el = mount({ id: "site", kind: "path", title: "Site", path: "/tmp/site/" });
    await flush();
    dispatchBridgeReady(el, "guid-a");
    dispatchNavigation(el, { url: "/artifact/site/notes.md", native: true });
    await flush();
    dispatchNavigation(el, { url: "https://example.com/elsewhere" });
    await flush();
    for (const label of ["Back", "Back", "Forward", "Forward"]) {
      button(el, label).click();
      await flush();
    }

    const element = frame(el);
    expect(assignments.every((assignment) => assignment.frame === element)).toBe(true);
    expect(recorded()).toEqual([
      { src: "/artifact/site/", sandbox: SANDBOX, allow: ALLOW },
      { src: "/views/url-unsupported/", sandbox: null, allow: ALLOW },
      { src: "/artifact/site/notes.md", sandbox: SANDBOX, allow: ALLOW },
      { src: "/artifact/site/", sandbox: SANDBOX, allow: ALLOW },
      { src: "/artifact/site/notes.md", sandbox: SANDBOX, allow: ALLOW },
      { src: "/views/url-unsupported/", sandbox: null, allow: ALLOW },
    ]);
  });

  it("shows the missing-artifact page the app renders in no frame, and frames the recovered editor unsandboxed", async () => {
    let missing = true;
    const application = createApplication({
      get: vi.fn(async () => {
        if (missing) throw new RequestError("Markdown artifact not found: md", { serverURL: "http://example.test", status: 404 });
        return "# Restored";
      }),
      update: vi.fn(async () => undefined),
    });
    const el = mountFrameContract({ artifact: { id: "md", kind: "path", title: "Note", path: "/tmp/note.md" }, application });
    await vi.waitFor(() => expect(el.querySelector(".artifact-missing")).not.toBeNull());
    expect(el.querySelector("iframe")).toBeNull();

    missing = false;
    application.dispatchEvent(new ArtifactContentChangedEvent("artifact-content-changed", { artifactID: "md" }));
    await vi.waitFor(() => expect(el.querySelector("iframe")).not.toBeNull());
    expect(recorded().at(-1)).toEqual({ src: "/views/markdown/", sandbox: null, allow: ALLOW });
  });
});

describe("artifact webview partitions (^dp-t-interface-names)", () => {
  type Bridge = { artifactPartitions?: unknown };
  const environment = globalThis as typeof globalThis & { __televisionNativeBridge?: Bridge };

  interface WebviewAssignment {
    webview: Element;
    src: string;
    partition: string | null;
  }

  let assignments: WebviewAssignment[] = [];

  beforeEach(() => {
    document.body.innerHTML = "";
    localStorage.clear();
    window.history.replaceState(null, "", "/?mode=electron");
    assignments = [];
    // Each webview's partition at the moment its `src` is assigned.
    const setAttribute = Element.prototype.setAttribute;
    vi.spyOn(Element.prototype, "setAttribute").mockImplementation(function (this: Element, name: string, value: string) {
      if (this.tagName === "WEBVIEW" && name === "src") {
        assignments.push({ webview: this, src: value, partition: this.getAttribute("partition") });
      }
      setAttribute.call(this, name, value);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete environment.__televisionNativeBridge;
    window.history.replaceState(null, "", "/");
  });

  function webview(el: HTMLElement): HTMLElement {
    const element = el.querySelector<HTMLElement>("webview");
    if (!element) throw new Error("Expected webview");
    return element;
  }

  const SHARED_URL = "https://producer.test/artifact/01J00000000000000000000000/index.html";
  const artifacts: Array<[Artifact, string]> = [
    [{ id: "page", kind: "path", title: "Page", path: "/tmp/page.html" }, "tv-artifact:page"],
    [{ id: "site 01/é", kind: "path", title: "Site", path: "/tmp/site/" }, "tv-artifact:site 01/é"],
    [{ id: "notes", kind: "path", title: "Notes", path: "/tmp/notes.md" }, "tv-artifact:notes"],
    [{ id: "web", kind: "url", title: "Web", url: "https://news.example/start" }, "tv-url-artifact"],
    [{ id: "shared", kind: "url", title: "Shared", url: SHARED_URL }, "tv-url-artifact"],
  ];

  // spec: proofs/arch/desktop/artifact-partitions.md#^dp-t-interface-names
  it("names each artifact webview's partition before its first navigation, and replaces the webview when its partition changes", async () => {
    environment.__televisionNativeBridge = { artifactPartitions: 1 };
    for (const [artifact, partition] of artifacts) {
      document.body.innerHTML = "";
      assignments = [];
      const el = mount(artifact);
      await flush();
      expect({ id: artifact.id, first: assignments[0] && { src: assignments[0].src, partition: assignments[0].partition } })
        .toEqual({ id: artifact.id, first: { src: expect.any(String), partition } });
      expect(webview(el).getAttribute("partition")).toBe(partition);
    }

    // One webview keeps its partition as its document moves to another of the
    // artifact's pages, to an external page and back.
    document.body.innerHTML = "";
    const el = mount({ id: "page", kind: "path", title: "Page", path: "/tmp/page.html" });
    await flush();
    const element = webview(el);
    for (const url of ["http://localhost:3000/artifact/page/other.html", "https://news.example/elsewhere", "http://localhost:3000/artifact/page/page.html"]) {
      element.dispatchEvent(Object.assign(new Event("did-navigate"), { url }));
      await flush();
      expect({ url, same: webview(el) === element, partition: webview(el).getAttribute("partition") })
        .toEqual({ url, same: true, partition: "tv-artifact:page" });
    }

    // A change of kind, or of artifact, needs another partition and so a new webview.
    for (const [artifact, partition] of [
      [{ id: "page", kind: "url", title: "Page", url: "https://news.example/start" }, "tv-url-artifact"],
      [{ id: "page", kind: "path", title: "Page", path: "/tmp/page.html" }, "tv-artifact:page"],
      [{ id: "other", kind: "path", title: "Other", path: "/tmp/other.html" }, "tv-artifact:other"],
    ] satisfies Array<[Artifact, string]>) {
      const previous = webview(el);
      assignments = [];
      (el as unknown as { artifact: Artifact }).artifact = artifact;
      await flush();
      expect({ id: artifact.id, kind: artifact.kind, replaced: webview(el) !== previous, attached: previous.isConnected })
        .toEqual({ id: artifact.id, kind: artifact.kind, replaced: true, attached: false });
      // The view may assign the new webview more than one address as it
      // restores the artifact's history; each finds the partition in place.
      expect(assignments.length).toBeGreaterThan(0);
      expect(assignments.map(({ webview: assigned, partition: named }) => ({ current: assigned === webview(el), partition: named })))
        .toEqual(assignments.map(() => ({ current: true, partition })));
    }
  });

  // spec: proofs/arch/desktop/artifact-partitions.md#^dp-t-interface-names
  it("names no partition unless the native bridge carries the flag", async () => {
    for (const bridge of [undefined, {}, { artifactPartitions: 2 }, { artifactPartitions: true }, { artifactPartitions: "1" }]) {
      if (bridge === undefined) delete environment.__televisionNativeBridge;
      else environment.__televisionNativeBridge = bridge;
      for (const [artifact] of artifacts) {
        document.body.innerHTML = "";
        assignments = [];
        const el = mount(artifact);
        await flush();
        expect({ bridge, id: artifact.id, partitions: assignments.map(({ partition }) => partition), attribute: webview(el).hasAttribute("partition") })
          .toEqual({ bridge, id: artifact.id, partitions: [null], attribute: false });
      }
    }
  });
});

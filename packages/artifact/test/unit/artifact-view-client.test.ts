// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import {
  ArtifactContext,
  ArtifactView,
  WebviewArtifactContext,
  WebviewArtifactViewRuntime,
} from "@telepath-computer/television-artifact/browser";

function makeIframe(): HTMLIFrameElement {
  const iframe = document.createElement("iframe");
  document.body.appendChild(iframe);
  return iframe;
}

function makeContextWindow(): Window {
  // Nested iframe gives us a child window whose `parent` is the outer window,
  // which is what `ArtifactContext` expects.
  const iframe = document.createElement("iframe");
  document.body.appendChild(iframe);
  const win = iframe.contentWindow;
  if (!win) throw new Error("iframe has no contentWindow");
  return win;
}

function dispatchIframeMessage(iframe: HTMLIFrameElement, payload: unknown): void {
  window.dispatchEvent(new MessageEvent("message", {
    data: payload,
    source: iframe.contentWindow,
  }));
}

function dispatchWebviewIpc(webview: HTMLElement, payload: unknown): void {
  webview.dispatchEvent(new CustomEvent("ipc-message", {
    detail: { channel: "television-artifact-bridge", args: [payload] },
  }));
}

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("ArtifactView", () => {
  it("throws the documented error when handleUpdateContent is registered twice", () => {
    const view = new ArtifactView(makeIframe());
    view.handleUpdateContent(async () => {});
    expect(() => view.handleUpdateContent(async () => {})).toThrow(
      "handleUpdateContent: handler already registered",
    );
    view.dispose();
  });

  it("methods throw after dispose()", () => {
    const view = new ArtifactView(makeIframe());
    view.dispose();
    expect(() => { view.content = "x"; }).toThrow("ArtifactView is disposed");
    expect(() => view.handleUpdateContent(async () => {})).toThrow("ArtifactView is disposed");
    expect(() => view.notifyStylesChanged()).toThrow("ArtifactView is disposed");
  });

  it("sends styles-changed only after the iframe reports ready", () => {
    const iframe = makeIframe();
    const postMessage = vi.spyOn(iframe.contentWindow!, "postMessage");
    const view = new ArtifactView(iframe);

    view.notifyStylesChanged();
    expect(postMessage).not.toHaveBeenCalled();

    dispatchIframeMessage(iframe, { type: "ready" });
    view.notifyStylesChanged();
    expect(postMessage).toHaveBeenCalledTimes(1);
    expect(postMessage).toHaveBeenCalledWith({ type: "styles-changed" }, "*");
    view.dispose();
  });

  it("content getter returns null before first set; returns last-set value after", () => {
    const view = new ArtifactView(makeIframe());
    expect(view.content).toBeNull();
    view.content = "a";
    expect(view.content).toBe("a");
    view.content = "b";
    expect(view.content).toBe("b");
    view.dispose();
  });

  it("dispose() is idempotent", () => {
    const view = new ArtifactView(makeIframe());
    view.dispose();
    expect(() => view.dispose()).not.toThrow();
  });

  it("[Symbol.dispose]() is equivalent to dispose()", () => {
    const view = new ArtifactView(makeIframe());
    view[Symbol.dispose]();
    expect(() => { view.content = "x"; }).toThrow("ArtifactView is disposed");
  });
});

describe("WebviewArtifactViewRuntime", () => {
  it("redelivers latched content on every ready message and forwards save responses", async () => {
    const webview = document.createElement("webview") as unknown as HTMLElement & { send: Mock<(channel: string, payload: unknown) => void> };
    webview.send = vi.fn();
    const runtime = new WebviewArtifactViewRuntime(webview);
    runtime.content = "initial";
    runtime.handleUpdateContent(async (content) => {
      runtime.content = content;
    });

    dispatchWebviewIpc(webview, { type: "ready" });
    dispatchWebviewIpc(webview, { type: "ready" });

    expect(webview.send).toHaveBeenNthCalledWith(1, "television-artifact-bridge", {
      type: "content-updated",
      content: "initial",
    });
    expect(webview.send).toHaveBeenNthCalledWith(2, "television-artifact-bridge", {
      type: "content-updated",
      content: "initial",
    });

    dispatchWebviewIpc(webview, { type: "update-content", id: "save-1", content: "saved" });
    await Promise.resolve();

    expect(webview.send).toHaveBeenCalledWith("television-artifact-bridge", {
      type: "response",
      id: "save-1",
      result: {},
    });
    expect(runtime.content).toBe("saved");
    runtime.dispose();
  });

  it("sends styles-changed only after the webview reports ready", () => {
    const webview = document.createElement("webview") as unknown as HTMLElement & { send: Mock<(channel: string, payload: unknown) => void> };
    webview.send = vi.fn();
    const runtime = new WebviewArtifactViewRuntime(webview);

    runtime.notifyStylesChanged();
    expect(webview.send).not.toHaveBeenCalled();

    dispatchWebviewIpc(webview, { type: "ready" });
    runtime.notifyStylesChanged();
    expect(webview.send).toHaveBeenCalledTimes(1);
    expect(webview.send).toHaveBeenCalledWith(
      "television-artifact-bridge",
      { type: "styles-changed" },
    );
    runtime.dispose();
  });

  it("removes the webview ipc-message listener on dispose", () => {
    const webview = document.createElement("webview") as unknown as HTMLElement & { send: Mock<(channel: string, payload: unknown) => void> };
    webview.send = vi.fn();
    const runtime = new WebviewArtifactViewRuntime(webview);
    runtime.content = "initial";
    runtime.dispose();

    dispatchWebviewIpc(webview, { type: "ready" });

    expect(webview.send).not.toHaveBeenCalled();
  });
});

describe("WebviewArtifactContext", () => {
  it("uses __televisionContentBridge for ready, content updates, and save responses", async () => {
    const callbacks: Array<(message: unknown) => void> = [];
    const removers: Array<ReturnType<typeof vi.fn>> = [];
    const bridge = {
      postToHost: vi.fn(),
      onHostMessage: vi.fn((callback: (message: unknown) => void) => {
        callbacks.push(callback);
        const remove = vi.fn();
        removers.push(remove);
        return remove;
      }),
    };
    const win = { __televisionContentBridge: bridge } as unknown as Window;

    const context = new WebviewArtifactContext(win);
    expect(bridge.postToHost).toHaveBeenCalledWith({ type: "ready" });

    const contentUpdates: string[] = [];
    context.addEventListener("content-updated", (event) => contentUpdates.push(event.content));
    callbacks[0]!({ type: "content-updated", content: "host content" });
    expect(contentUpdates).toEqual(["host content"]);

    const stylesChanged = vi.fn();
    context.onStylesChanged(stylesChanged);
    callbacks[0]!({ type: "styles-changed" });
    expect(stylesChanged).toHaveBeenCalledTimes(1);

    const pending = context.updateContent("view content");
    const request = bridge.postToHost.mock.calls.at(-1)?.[0] as { id: string };
    callbacks[0]!({ type: "response", id: request.id, result: {} });
    await expect(pending).resolves.toBeUndefined();

    context.dispose();
    expect(removers[0]).toHaveBeenCalledTimes(1);
  });

  it("throws when the preload bridge is unavailable", () => {
    expect(() => new WebviewArtifactContext({} as Window)).toThrow(
      "WebviewArtifactContext: window has no __televisionContentBridge",
    );
  });
});

describe("ArtifactContext", () => {
  it("dispose() rejects in-flight updateContent() promises", async () => {
    const win = makeContextWindow();
    const context = new ArtifactContext(win);
    const pending = context.updateContent("payload");
    context.dispose();
    await expect(pending).rejects.toThrow("ArtifactContext disposed");
  });

  it("dispose() clears the pending-request map so later responses are ignored", async () => {
    const win = makeContextWindow();
    const context = new ArtifactContext(win);
    const pending = context.updateContent("payload");
    context.dispose();
    await expect(pending).rejects.toThrow("ArtifactContext disposed");
    // A second dispose() must not throw or double-reject.
    expect(() => context.dispose()).not.toThrow();
  });

  it("methods throw after dispose()", () => {
    const win = makeContextWindow();
    const context = new ArtifactContext(win);
    context.dispose();
    expect(() => context.updateContent("x")).toThrow("ArtifactContext is disposed");
  });

  it("dispose() is idempotent", () => {
    const win = makeContextWindow();
    const context = new ArtifactContext(win);
    context.dispose();
    expect(() => context.dispose()).not.toThrow();
  });

  it("[Symbol.dispose]() is equivalent to dispose()", () => {
    const win = makeContextWindow();
    const context = new ArtifactContext(win);
    context[Symbol.dispose]();
    expect(() => context.updateContent("x")).toThrow("ArtifactContext is disposed");
  });

  it("throws when constructed on a window with no distinct parent", () => {
    // `window.parent === window` for the top-level jsdom window.
    expect(() => new ArtifactContext(window)).toThrow("ArtifactContext: window has no parent");
  });
});

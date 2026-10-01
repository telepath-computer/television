// @vitest-environment jsdom
// Renderer contracts replace the local bridge, clipboard and animation scheduler.
// Real IPC, native input and CSS motion are crossed by connect-screen acceptance.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ConnectPageAPI } from "../src/connect-page.ts";
import type { ConnectScreenState } from "../src/connect-screen.ts";

let dispose: (() => void) | undefined;
let init: typeof import("../src/connect-page.ts").initConnectPage;
const frameCallbacks: FrameRequestCallback[] = [];

beforeEach(async () => {
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { frameCallbacks.push(callback); return frameCallbacks.length; });
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal("CSSStyleSheet", class { replaceSync() {} });
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  HTMLDialogElement.prototype.close = function () { this.open = false; };
  Element.prototype.getAnimations = vi.fn(() => []);
  init = (await import("../src/connect-page.ts")).initConnectPage;
});
afterEach(() => {
  dispose?.();
  document.body.replaceChildren();
  frameCallbacks.length = 0;
  vi.unstubAllGlobals();
});

async function mount(state: ConnectScreenState = { kind: "setup" }) {
  let listener!: (state: ConnectScreenState) => void;
  const api: ConnectPageAPI = {
    getState: vi.fn(async () => state),
    onState: callback => { listener = callback; return () => {}; },
    connect: vi.fn(), completeConnect: vi.fn(async () => {}), disconnect: vi.fn(async () => {}),
  };
  const host = document.createElement("div");
  document.body.append(host);
  dispose = init(api, host);
  await Promise.resolve();
  return { api, publish: (next: ConnectScreenState) => listener(next) };
}
const input = () => document.querySelector<HTMLInputElement>(".setup-link input")!;
const form = () => document.querySelector<HTMLFormElement>(".setup-link")!;
const state = () => document.querySelector(".setup-screen")?.getAttribute("data-state");
const submit = () => form().dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };

// proofs/ui/setup/index.md#^setup-t-states
describe("setup renderer", () => {
  it("renders ready, connecting, inline error and Connected through a single-link submission", async () => {
    const { api } = await mount();
    expect(state()).toBe("ready");
    expect(input().value).toBe("");
    expect(input().required).toBe(true);
    expect(input().getAttribute("aria-label")).toBe("Link from your agent");
    expect(input().dataset.size).toBe("lg");
    expect(document.querySelector(".setup-submit")?.getAttribute("size")).toBe("lg");
    expect(document.querySelector(".copy-button")?.hasAttribute("size")).toBe(false);
    expect(document.querySelector(".artifact-title")?.textContent).toContain("Connect to Television");
    expect(document.querySelector("iframe, webview, .artifact-menu-trigger, .artifact-back")).toBeNull();
    submit();
    expect(api.connect).not.toHaveBeenCalled();
    let resolve!: (value: { ok: false; message: string }) => void;
    vi.mocked(api.connect).mockImplementationOnce(() => new Promise(r => { resolve = r; }));
    const link = "http://example.test/?token=wrong";
    input().value = link;
    submit();
    expect(api.connect).toHaveBeenCalledWith(link);
    expect(state()).toBe("connecting");
    expect(input().disabled).toBe(true);
    expect(document.querySelector<HTMLButtonElement>(".setup-submit")!.disabled).toBe(true);
    expect(document.querySelector('.setup-submit tv-icon[name="spinner"][spinning]')).not.toBeNull();
    resolve({ ok: false, message: "Ask your agent for the current link." });
    await flush();
    expect(state()).toBe("error");
    expect(input().value).toBe(link);
    expect(input().disabled).toBe(false);
    expect(input().getAttribute("aria-invalid")).toBe("true");
    expect(input().getAttribute("aria-describedby")).toBe("setup-link-error");
    expect(document.getElementById("setup-link-error")?.textContent).toContain("current link");
    expect(document.querySelector(".setup-hint")).toBeNull();
    vi.mocked(api.connect).mockResolvedValueOnce({ ok: true, attempt: 7 });
    input().value = "http://example.test/?token=correct";
    submit();
    expect(state()).toBe("connecting");
    expect(input().hasAttribute("aria-invalid")).toBe(false);
    await flush();
    expect(state()).toBe("connected");
    expect(document.querySelector(".setup-document")?.hasAttribute("inert")).toBe(true);
    expect(document.querySelector(".setup-done")?.hasAttribute("aria-hidden")).toBe(false);
    expect(api.completeConnect).not.toHaveBeenCalled();
  });

  // proofs/ui/setup/index.md#^setup-t-copy
  it("Copy supplies the frame prompt and leaves both steps and the entered link available", async () => {
    const clipboard = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: clipboard } });
    const { api } = await mount();
    input().value = "http://example.test/?token=keep";
    document.querySelector<HTMLButtonElement>(".copy-button")!.click();
    expect(clipboard).toHaveBeenCalledWith("Read the Television admin guide at https://television.run/install.md and help me get Television installed. I'm on the desktop app connect screen.");
    expect(state()).toBe("ready");
    expect(input().value).toBe("http://example.test/?token=keep");
    expect(input().disabled).toBe(false);
    expect(document.querySelectorAll(".setup-step")).toHaveLength(2);
    expect(document.querySelector(".setup-document")?.hasAttribute("inert")).toBe(false);
    expect(api.connect).not.toHaveBeenCalled();
  });

  it("completes the Connected handoff without transition events under reduced motion", async () => {
    const { api } = await mount();
    vi.mocked(api.connect).mockResolvedValue({ ok: true, attempt: 9 });
    input().value = "http://example.test";
    submit();
    await flush();
    frameCallbacks.shift()!(0);
    await flush();
    frameCallbacks.shift()!(16);
    await flush();
    expect(api.completeConnect).toHaveBeenCalledWith(9);
  });

  it("renders saved states without setup and disconnects through the shared local modal", async () => {
    const { api, publish } = await mount({ kind: "connecting", serverURL: "http://example.test" });
    expect(document.querySelector(".setup-screen")).toBeNull();
    expect(document.body.textContent).toContain("Connecting");
    publish({ kind: "unauthorized", serverURL: "http://example.test" });
    await flush();
    expect(document.body.textContent).toContain("Access token required");
    document.querySelector<HTMLButtonElement>(".system-modal-disconnect")!.click();
    expect(api.disconnect).toHaveBeenCalledOnce();
  });
});

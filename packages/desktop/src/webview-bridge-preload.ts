// Preload for `<webview>` elements that embed URL artifacts. Runs inside
// the webview's renderer process. A `<webview>` is its own top-level
// browsing context (its `window.parent === window`), so the standard
// `installBridge` from `@telepath-computer/television-artifact/browser`
// cannot reach the embedder via `window.postMessage`. We use Electron's
// IPC instead: `ipcRenderer.sendToHost` reaches the embedding renderer,
// where the host listens via `webview.addEventListener("ipc-message", …)`.
//
// The preload is the webview document's lifecycle authority. It carries the
// target lifecycle shapes and artifact-route freshness notification over IPC;
// the browser bridge remains inert in this top-level browsing context.
import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import { classifyLinkTarget } from "@telepath-computer/television-artifact/link-target";
import { OPEN_APPLICATION_LINK_CHANNEL } from "./application-link.ts";

const BRIDGE_CHANNEL = "television-artifact-bridge";

type BridgeMessage =
  | {
    type: "bridge-ready";
    guid: string;
  }
  | {
    type: "leaving";
    guid: string;
  }
  | {
    type: "proxy-content-changed";
  }
  | {
    type: "artifact-pointer";
    eventType: "pointermove" | "pointerdown" | "pointerup" | "pointercancel" | "click";
    clientX: number;
    clientY: number;
    button: number;
    buttons: number;
  };

interface ContentBridge {
  postToHost(message: unknown): void;
  onHostMessage(callback: (message: unknown) => void): () => void;
  openApplicationLink(url: string): boolean;
}

// Webviews run this preload without context isolation. Capture Chromium's native
// activation getter before artifact scripts can shadow the page-visible property.
const userActivation = window.navigator.userActivation;
let userActivationPrototype: object | null = userActivation
  ? Object.getPrototypeOf(userActivation) as object | null
  : null;
let userActivationIsActiveGetter: (() => boolean) | undefined;
while (userActivationPrototype && !userActivationIsActiveGetter) {
  userActivationIsActiveGetter = Object.getOwnPropertyDescriptor(
    userActivationPrototype,
    "isActive",
  )?.get;
  userActivationPrototype = Object.getPrototypeOf(userActivationPrototype) as object | null;
}
const applyFunction = Reflect.apply;

function hasActiveUserGesture(): boolean {
  if (!userActivation || !userActivationIsActiveGetter) return false;
  try {
    return applyFunction(userActivationIsActiveGetter, userActivation, []) === true;
  } catch {
    return false;
  }
}

function openApplicationLink(url: string): boolean {
  if (!hasActiveUserGesture()) return false;
  const target = classifyLinkTarget(url, window.document.baseURI);
  if (target.kind !== "application") return false;
  ipcRenderer.send(OPEN_APPLICATION_LINK_CHANNEL, target.url);
  return true;
}

const contentBridge: ContentBridge = {
  postToHost(message: unknown): void {
    ipcRenderer.sendToHost(BRIDGE_CHANNEL, message);
  },
  onHostMessage(callback: (message: unknown) => void): () => void {
    const listener = (_event: IpcRendererEvent, message: unknown): void => {
      callback(message);
    };
    ipcRenderer.on(BRIDGE_CHANNEL, listener);
    return () => {
      ipcRenderer.removeListener(BRIDGE_CHANNEL, listener);
    };
  },
  openApplicationLink,
};

if (process.contextIsolated) {
  contextBridge.exposeInMainWorld("__televisionContentBridge", contentBridge);
} else {
  (window as Window & { __televisionContentBridge?: ContentBridge })
    .__televisionContentBridge = contentBridge;
}

function handleApplicationAnchorActivation(event: MouseEvent): void {
  const supportedButton = (event.type === "click" && event.button === 0) ||
    (event.type === "auxclick" && event.button === 1);
  if (!supportedButton) return;
  const target = event.target;
  if (!(target instanceof Element)) return;
  const anchor = target.closest("a[href]") as HTMLAnchorElement | null;
  if (!anchor) return;
  const link = classifyLinkTarget(anchor.href, window.document.baseURI);
  if (link.kind !== "application") return;
  event.preventDefault();
  openApplicationLink(link.url);
}

window.addEventListener("click", handleApplicationAnchorActivation, true);
window.addEventListener("auxclick", handleApplicationAnchorActivation, true);

const GUID_RADIX = 36;
const GUID_WORD_COUNT = 4;

function makeBridgeGuid(): string {
  const now = Date.now().toString(GUID_RADIX);
  try {
    const cryptoLike = window.crypto;
    if (cryptoLike && typeof cryptoLike.getRandomValues === "function") {
      const values = new Uint32Array(GUID_WORD_COUNT);
      cryptoLike.getRandomValues(values);
      return `tvb-${now}-${Array.from(values, (value) => value.toString(GUID_RADIX)).join("-")}`;
    }
  } catch {
    // Fall through to the non-cryptographic fallback below.
  }
  return `tvb-${now}-${Math.random().toString(GUID_RADIX).slice(2)}-${Math.random().toString(GUID_RADIX).slice(2)}`;
}

const documentGuid = makeBridgeGuid();

function postBridgeReady(): void {
  ipcRenderer.sendToHost(BRIDGE_CHANNEL, {
    type: "bridge-ready",
    guid: documentGuid,
  } satisfies BridgeMessage);
}

function postInitialBridgeReady(): void {
  if (document.readyState === "complete") {
    postBridgeReady();
    return;
  }
  window.addEventListener("load", postBridgeReady, { once: true });
}

window.addEventListener("pagehide", () => {
  ipcRenderer.sendToHost(BRIDGE_CHANNEL, { type: "leaving", guid: documentGuid } satisfies BridgeMessage);
});
window.addEventListener("pageshow", (event: PageTransitionEvent) => {
  if (event.persisted === true) {
    postBridgeReady();
  }
});

const pointerEventTypes = [
  "pointermove",
  "pointerdown",
  "pointerup",
  "pointercancel",
  "click",
] as const;
for (const eventType of pointerEventTypes) {
  window.addEventListener(eventType, (event) => {
    const pointer = event as PointerEvent | MouseEvent;
    if (!pointer.isTrusted) return;
    ipcRenderer.sendToHost(BRIDGE_CHANNEL, {
      type: "artifact-pointer",
      eventType,
      clientX: pointer.clientX,
      clientY: pointer.clientY,
      button: pointer.button,
      buttons: pointer.buttons,
    } satisfies BridgeMessage);
  }, true);
}

postInitialBridgeReady();

function testArtifactPollCadence(): { normalMs: number; slowMs: number } | null {
  if (process.env.TV_TEST_MODE !== "true") return null;
  const normalMs = Number(process.env.TV_TEST_ARTIFACT_POLL_NORMAL_MS);
  const slowMs = Number(process.env.TV_TEST_ARTIFACT_POLL_SLOW_MS);
  if (!Number.isFinite(normalMs) || normalMs <= 0 || !Number.isFinite(slowMs) || slowMs < normalMs) {
    return null;
  }
  return { normalMs, slowMs };
}

function startProxyContentPoll(): void {
  const capturedURL = window.location.href;
  // Inlined copy of isTvArtifact from packages/artifact/src/model.ts. This is
  // deliberately NOT DRY: importing the canonical predicate would pull zod/ulid
  // into the preload bundle. Keep this regex in sync with the canonical predicate
  // and the bridge copy in packages/artifact/src/browser/artifact-bridge.ts.
  const isTvArtifactURL = (url: string): boolean => {
    try {
      const parsed = new URL(url);
      return /^\/artifact\/[0-9A-Za-z]{26}(\/|$)/.test(parsed.pathname);
    } catch {
      return false;
    }
  };
  if (!isTvArtifactURL(capturedURL) || typeof window.fetch !== "function") return;

  // Deliberate non-DRY duplicate of the bridge poll loop in
  // packages/artifact/src/browser/artifact-bridge.ts. Keep behavior identical;
  // the two-loop parity test guards this.
  const PRODUCTION_NORMAL_POLL_MS = 5000;
  const PRODUCTION_SLOW_POLL_MS = 15000;
  const cadence = testArtifactPollCadence();
  const NORMAL_POLL_MS = cadence?.normalMs ?? PRODUCTION_NORMAL_POLL_MS;
  const SLOW_POLL_MS = cadence?.slowMs ?? PRODUCTION_SLOW_POLL_MS;
  let baselineETag: string | null = null;
  let delayMs = NORMAL_POLL_MS;
  let generation = 0;
  let active = false;
  let queuedTimer: number | null = null;
  let activeAbortController: AbortController | null = null;

  const stopPollLoop = () => {
    if (!active) return;
    active = false;
    generation += 1;
    if (queuedTimer !== null) {
      window.clearTimeout(queuedTimer);
      queuedTimer = null;
    }
    activeAbortController?.abort();
    activeAbortController = null;
  };

  const startPollLoop = () => {
    if (active) return;
    active = true;
    const loopGeneration = ++generation;
    const poll = () => {
      if (!active || loopGeneration !== generation) return;
      queuedTimer = null;
      const AbortControllerConstructor = (window as Window & {
        AbortController?: typeof AbortController;
      }).AbortController;
      const abortController = typeof AbortControllerConstructor === "function"
        ? new AbortControllerConstructor()
        : null;
      activeAbortController = abortController;
      void (async () => {
        try {
          const response = await window.fetch(capturedURL, {
            method: "HEAD",
            ...(abortController ? { signal: abortController.signal } : {}),
          });
          if (!active || loopGeneration !== generation) return;
          if (!response.ok) throw new Error("Artifact poll failed");
          const etag = response.headers.get("ETag");
          if (!etag) throw new Error("Artifact poll missing ETag");
          delayMs = NORMAL_POLL_MS;
          if (baselineETag === null) {
            baselineETag = etag;
          } else if (etag !== baselineETag) {
            baselineETag = etag;
            ipcRenderer.sendToHost(BRIDGE_CHANNEL, { type: "proxy-content-changed" } satisfies BridgeMessage);
          }
        } catch {
          if (active && loopGeneration === generation) {
            delayMs = Math.min(SLOW_POLL_MS, delayMs * 2);
          }
        } finally {
          if (activeAbortController === abortController) {
            activeAbortController = null;
          }
          if (active && loopGeneration === generation) {
            queuedTimer = window.setTimeout(poll, delayMs);
          }
        }
      })();
    };
    poll();
  };

  window.addEventListener("pagehide", stopPollLoop);
  window.addEventListener("pageshow", (event) => {
    if ((event as PageTransitionEvent).persisted === true) {
      startPollLoop();
    }
  });
  startPollLoop();
}

startProxyContentPoll();

import { ArtifactView } from "@telepath-computer/television-artifact/browser";

declare const __TV_ARTIFACT_E2E_VIEW_URL__: string;

type EventRecord = { type: string; content?: string; at: number };

declare global {
  interface Window {
    __view?: ArtifactView;
    __events: EventRecord[];
    __unknownMessages: unknown[];
    __bootView: (options?: {
      registerHandler?: "resolve" | "throw" | "none";
      initialContent?: string;
      deferIframeLoad?: boolean;
    }) => Promise<void>;
    __finishIframeLoad: () => void;
    __disposeView: () => void;
    __setContent: (content: string) => void;
    __getContent: () => string | null;
    __rebootIframe: () => Promise<void>;
    __handlerInvocations: string[];
    __resolveNextHandler: () => void;
    __rejectNextHandler: (message: string) => void;
    __bootScrollHarness: () => Promise<void>;
  }
}

const hostWindow = window;

hostWindow.__events = [];
hostWindow.__unknownMessages = [];
hostWindow.__handlerInvocations = [];

const iframeBaseURL = (() => {
  const url = new URL(__TV_ARTIFACT_E2E_VIEW_URL__);
  url.pathname = "/";
  url.search = "";
  url.hash = "";
  return url.href;
})();

function getIframe(): HTMLIFrameElement {
  const iframe = document.getElementById("view-iframe");
  if (!(iframe instanceof HTMLIFrameElement)) {
    throw new Error("view-iframe not found");
  }
  return iframe;
}

function waitForIframeLoad(iframe: HTMLIFrameElement, src: string): Promise<void> {
  return new Promise((resolve) => {
    iframe.addEventListener("load", () => resolve(), { once: true });
    iframe.src = src;
  });
}

// When tests need the ArtifactView to exist *before* the iframe finishes
// loading (so they can set `view.content` before `ready` arrives), they pass
// `deferIframeLoad: true`. The iframe src is assigned but we don't wait on
// load; the test drives __finishIframeLoad() when ready.
let pendingIframeLoad: Promise<void> | null = null;

function beginIframeLoad(iframe: HTMLIFrameElement): Promise<void> {
  const src = `${iframeBaseURL}?cache=${Date.now()}`;
  pendingIframeLoad = waitForIframeLoad(iframe, src);
  return pendingIframeLoad;
}

// Log any unrecognized messages posted to this window so we can assert that
// they don't disturb the host. The harness logs only messages whose `source`
// is the view iframe (jsdom / dev noise arrives from elsewhere).
hostWindow.addEventListener("message", (event) => {
  const iframe = document.getElementById("view-iframe");
  if (!(iframe instanceof HTMLIFrameElement)) return;
  if (event.source !== iframe.contentWindow) return;
  hostWindow.__unknownMessages.push(event.data);
});

let resolvePending: (() => void) | null = null;
let rejectPending: ((err: Error) => void) | null = null;

hostWindow.__resolveNextHandler = () => {
  resolvePending?.();
  resolvePending = null;
  rejectPending = null;
};
hostWindow.__rejectNextHandler = (message: string) => {
  rejectPending?.(new Error(message));
  resolvePending = null;
  rejectPending = null;
};

hostWindow.__bootView = async (options = {}) => {
  hostWindow.__events = [];
  hostWindow.__unknownMessages = [];
  hostWindow.__handlerInvocations = [];
  const iframe = getIframe();
  const loadPromise = beginIframeLoad(iframe);
  const view = new ArtifactView(iframe);
  hostWindow.__view = view;
  view.addEventListener("ready", () => {
    hostWindow.__events.push({ type: "ready", at: Date.now() });
  });
  if (options.initialContent !== undefined) {
    view.content = options.initialContent;
  }
  if (options.registerHandler === "resolve") {
    view.handleUpdateContent(async (content) => {
      hostWindow.__handlerInvocations.push(content);
    });
  } else if (options.registerHandler === "throw") {
    view.handleUpdateContent(async (content) => {
      hostWindow.__handlerInvocations.push(content);
      await new Promise<void>((resolve, reject) => {
        resolvePending = resolve;
        rejectPending = reject;
      });
    });
  }
  if (!options.deferIframeLoad) {
    await loadPromise;
  }
};

hostWindow.__finishIframeLoad = () => {
  // Exposed for tests that booted with deferIframeLoad: awaiting this from the
  // test side is equivalent to awaiting the iframe's load event.
  return pendingIframeLoad ?? Promise.resolve();
};

hostWindow.__disposeView = () => {
  hostWindow.__view?.dispose();
  hostWindow.__view = undefined;
};

hostWindow.__setContent = (content: string) => {
  if (!hostWindow.__view) throw new Error("__setContent: no view");
  hostWindow.__view.content = content;
};

hostWindow.__getContent = () => {
  return hostWindow.__view?.content ?? null;
};

hostWindow.__rebootIframe = async () => {
  const iframe = getIframe();
  await beginIframeLoad(iframe);
};

// Boot the iframe in scroll-bridge mode (`?scroll=1`). The view harness
// detects the flag, installs the scroll bridge, and constructs a
// fixed-height flex layout with an inner `overflow: auto` scroller —
// reproducing the iframe-overflow pattern that view-markdown uses. No
// ArtifactView runtime is created: the spec is exercising bridge
// behaviour, not the artifact protocol.
hostWindow.__bootScrollHarness = async () => {
  const iframe = getIframe();
  const src = `${iframeBaseURL}?cache=${Date.now()}&scroll=1`;
  pendingIframeLoad = waitForIframeLoad(iframe, src);
  await pendingIframeLoad;
};


import {
  isArtifactMissingRequest,
  isArtifactPointerNotification,
  isBridgeLeavingNotification,
  isBridgeReadyNotification,
  isNavigationKeyNotification,
  isNavigationRequest,
  isProxyContentChangedNotification,
  isURLTargetRequest,
  type ArtifactMissingRequest,
  type ArtifactPointerNotification,
  type BridgeDocumentGuid,
  type BridgeLeavingNotification,
  type BridgeMessage,
  type BridgeReadyNotification,
  type NavigationKeyNotification,
  type NavigationRequestNotification,
  type ProxyContentChangedNotification,
  type URLTargetRequest,
} from "@telepath-computer/television-artifact/browser";

/** Messages an artifact document can send to its host. */
export type ArtifactFrameInboundMessage =
  | ArtifactMissingRequest
  | ArtifactPointerNotification
  | BridgeLeavingNotification
  | BridgeReadyNotification
  | NavigationKeyNotification
  | NavigationRequestNotification
  | ProxyContentChangedNotification
  | URLTargetRequest;

/** Reply path matching the peer that supplied an accepted message. */
export interface ArtifactBridgeReplyTransport {
  send(message: BridgeMessage): void;
}

export interface ArtifactFrameTrustState {
  currentGuid: BridgeDocumentGuid | null;
  lifecycleWindow: Window | null;
}

export type ArtifactFrameMessageHandler = (
  message: ArtifactFrameInboundMessage,
  transport: ArtifactBridgeReplyTransport,
) => void;

export type ArtifactFrameDocumentChangeHandler = () => void;

export type ArtifactApplicationLinkHandler = (url: string) => void;

interface WebviewIpcMessage {
  channel: string;
  args: unknown[];
}

interface WebviewElement extends HTMLElement {
  send?: (channel: string, payload: unknown) => void;
  getURL?: () => string;
}

/**
 * Owns artifact-frame identity and transport validation. Product effects stay
 * in the artifact wrapper; this class only supplies a source-valid stream and
 * its matching reply path.
 */
export class ArtifactTrustedChannel {
  readonly #onMessage: ArtifactFrameMessageHandler;
  readonly #onDocumentChange: ArtifactFrameDocumentChangeHandler;
  readonly #onApplicationLink: ArtifactApplicationLinkHandler;
  #currentGuid: BridgeDocumentGuid | null = null;
  #lifecycleWindow: Window | null = null;
  #currentFrame: HTMLElement | null = null;
  #subscribedWebview: WebviewElement | null = null;
  #connected = false;

  constructor(
    onMessage: ArtifactFrameMessageHandler,
    onDocumentChange: ArtifactFrameDocumentChangeHandler = () => {},
    onApplicationLink: ArtifactApplicationLinkHandler = () => {},
  ) {
    this.#onMessage = onMessage;
    this.#onDocumentChange = onDocumentChange;
    this.#onApplicationLink = onApplicationLink;
  }

  get currentGuid(): BridgeDocumentGuid | null {
    return this.#currentGuid;
  }

  get lifecycleWindow(): Window | null {
    return this.#lifecycleWindow;
  }

  get trustState(): Readonly<ArtifactFrameTrustState> {
    return {
      currentGuid: this.#currentGuid,
      lifecycleWindow: this.#lifecycleWindow,
    };
  }

  connect(): void {
    if (this.#connected) return;
    this.#connected = true;
    window.addEventListener("message", this.#handleIframeMessage);
    this.#syncWebviewSubscription();
  }

  disconnect(): void {
    if (!this.#connected) return;
    window.removeEventListener("message", this.#handleIframeMessage);
    this.#connected = false;
    this.#unsubscribeFromWebview();
  }

  reset(): void {
    this.#currentGuid = null;
    this.#lifecycleWindow = null;
    this.#onDocumentChange();
  }

  /** Synchronizes the peer after the wrapper has reset and assigned source. */
  setCurrentFrame(frame: HTMLElement | null): void {
    if (frame === this.#currentFrame) {
      this.#syncWebviewSubscription();
      return;
    }

    this.#unsubscribeFromWebview();
    if (this.#currentFrame !== null) this.reset();
    this.#currentFrame = isArtifactFrame(frame) ? frame : null;
    this.#syncWebviewSubscription();
  }

  readonly #handleIframeMessage = (event: MessageEvent): void => {
    const message = artifactFrameInboundMessage(event.data);
    if (!message) return;

    const frame = this.#currentFrame;
    if (!frame || frame.tagName.toLowerCase() !== "iframe" || !frame.isConnected) return;
    const iframe = frame as HTMLIFrameElement;
    const currentFrameWindow = iframe.contentWindow;
    if (currentFrameWindow === null) return;
    const leaving = message.type === "leaving";
    const nativeNavigation = message.type === "navigation-request" &&
      message.native === true &&
      message.sameDocument !== true;
    const fromCurrentFrame = currentFrameWindow === event.source;
    const fromLifecycleWindow = (leaving || nativeNavigation) &&
      this.#lifecycleWindow !== null &&
      this.#lifecycleWindow === event.source;
    const fromExpectedLifecycleOrigin = leaving && expectedFrameOrigin(iframe) === event.origin;
    if (!fromCurrentFrame && !fromLifecycleWindow && !fromExpectedLifecycleOrigin) return;

    this.#receive(message, iframe, {
      send: (reply) => iframe.contentWindow?.postMessage(reply, "*"),
    });
  };

  readonly #handleWebviewIpcMessage = (event: Event): void => {
    const ipc = ((event as Event & { detail?: WebviewIpcMessage }).detail ??
      (event as unknown as WebviewIpcMessage));
    if (ipc?.channel === WEBVIEW_APPLICATION_LINK_CHANNEL) {
      this.#receiveApplicationLink(ipc.args?.[0]);
      return;
    }
    if (!ipc || ipc.channel !== WEBVIEW_BRIDGE_CHANNEL) return;
    const message = artifactFrameInboundMessage(ipc.args?.[0]);
    const webview = this.#subscribedWebview;
    if (!message || !webview) return;

    this.#receive(message, webview, {
      send: (reply) => webview.send?.(WEBVIEW_BRIDGE_CHANNEL, reply),
    });
  };

  /**
   * Passes on an application-link request from the webview the host shows,
   * only while it shows a page on the host's own HTTP(S) origin
   * (specs/arch/artifact-frame/artifact-bridge.md#^ab-link-handling). The
   * webview's URL decides, since a sandboxed document's own origin is opaque.
   */
  #receiveApplicationLink(value: unknown): void {
    const webview = this.#subscribedWebview;
    if (!webview || typeof value !== "string" || !showsHostWebOrigin(webview)) return;
    this.#onApplicationLink(value);
  }

  readonly #handleWebviewDidStartNavigation = (event: Event): void => {
    const navigation = eventFields(event) as { isMainFrame?: unknown; isInPlace?: unknown };
    if (navigation.isMainFrame === true && navigation.isInPlace !== true) {
      this.reset();
    }
  };

  readonly #handleWebviewDidFailLoad = (event: Event): void => {
    const failure = eventFields(event) as { isMainFrame?: unknown };
    if (failure.isMainFrame === false) return;
    this.reset();
  };

  #receive(
    message: ArtifactFrameInboundMessage,
    frame: HTMLElement,
    transport: ArtifactBridgeReplyTransport,
  ): void {
    if (message.type === "bridge-ready" && message.guid !== this.#currentGuid) {
      if (this.#currentGuid !== null) this.#onDocumentChange();
      this.#currentGuid = message.guid;
      this.#lifecycleWindow = frame.tagName.toLowerCase() === "iframe"
        ? (frame as HTMLIFrameElement).contentWindow
        : null;
    } else if (message.type === "leaving" && message.guid === this.#currentGuid) {
      this.reset();
    }

    this.#onMessage(message, transport);
  }

  #syncWebviewSubscription(): void {
    if (!this.#connected) return;
    const frame = this.#currentFrame;
    const webview = frame?.tagName.toLowerCase() === "webview" ? frame as WebviewElement : null;
    if (webview === this.#subscribedWebview) return;

    this.#unsubscribeFromWebview();
    if (!webview) return;
    webview.addEventListener("ipc-message", this.#handleWebviewIpcMessage);
    webview.addEventListener("did-start-navigation", this.#handleWebviewDidStartNavigation);
    webview.addEventListener("did-fail-load", this.#handleWebviewDidFailLoad);
    this.#subscribedWebview = webview;
  }

  #unsubscribeFromWebview(): void {
    const webview = this.#subscribedWebview;
    if (!webview) return;
    webview.removeEventListener("ipc-message", this.#handleWebviewIpcMessage);
    webview.removeEventListener("did-start-navigation", this.#handleWebviewDidStartNavigation);
    webview.removeEventListener("did-fail-load", this.#handleWebviewDidFailLoad);
    this.#subscribedWebview = null;
  }
}

const WEBVIEW_BRIDGE_CHANNEL = "television-artifact-bridge";
const WEBVIEW_APPLICATION_LINK_CHANNEL = "television-application-link";

function isWebURL(url: URL | Location): boolean {
  return url.protocol === "http:" || url.protocol === "https:";
}

// A `blob:` URL reports the origin of the page that created it, so the
// webview's URL must itself be HTTP(S).
function showsHostWebOrigin(webview: WebviewElement): boolean {
  const host = window.location;
  if (!isWebURL(host)) return false;
  try {
    const shown = new URL(webview.getURL?.() ?? "");
    return isWebURL(shown) && shown.origin === host.origin;
  } catch {
    return false;
  }
}

function artifactFrameInboundMessage(value: unknown): ArtifactFrameInboundMessage | null {
  if (isArtifactMissingRequest(value)) return value;
  if (isArtifactPointerNotification(value)) return value;
  if (isBridgeLeavingNotification(value)) return value;
  if (isBridgeReadyNotification(value)) return value;
  if (isNavigationKeyNotification(value)) return value;
  if (isNavigationRequest(value)) return value;
  if (isProxyContentChangedNotification(value)) return value;
  if (isURLTargetRequest(value)) return value;
  return null;
}

function isArtifactFrame(frame: HTMLElement | null): frame is HTMLElement {
  if (!frame) return false;
  const tag = frame.tagName.toLowerCase();
  return tag === "iframe" || tag === "webview";
}

function expectedFrameOrigin(frame: HTMLIFrameElement): string | null {
  // A frame the host sandboxes has an opaque origin, which a message reports as "null".
  if (frame.hasAttribute("sandbox")) return "null";
  try {
    return new URL(frame.getAttribute("src") ?? frame.src, window.location.href).origin;
  } catch {
    return null;
  }
}

function eventFields(event: Event): Record<string, unknown> {
  return ((event as Event & { detail?: Record<string, unknown> }).detail ??
    event) as unknown as Record<string, unknown>;
}

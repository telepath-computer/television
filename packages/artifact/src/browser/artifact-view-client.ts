import { defineEvent, EventTarget } from "@rupertsworld/event-target";
import { withDisposable } from "@telepath-computer/utils/disposable";
import { ulid } from "ulid";
import {
  isContentUpdatedNotification,
  isReadyNotification,
  isResponseMessage,
  isStylesChangedNotification,
  isUpdateContentRequest,
  type ContentUpdatedEvent as ContentUpdatedEventInterface,
  type ContentUpdatedNotification,
  type HostToViewMessage,
  type ReadyEvent as ReadyEventInterface,
  type ResponseMessage,
  type StylesChangedNotification,
  type UpdateContentRequest,
  type ViewToHostMessage,
} from "../artifact-view-protocol.ts";
export type ReadyEvent = ReadyEventInterface;
export const ReadyEvent = defineEvent<ReadyEvent>();

export type ContentUpdatedEvent = ContentUpdatedEventInterface;
export const ContentUpdatedEvent = defineEvent<ContentUpdatedEvent>();

const NO_HANDLER_ERROR_MESSAGE = "No handler registered for update-content";
const DOUBLE_HANDLER_ERROR_MESSAGE = "handleUpdateContent: handler already registered";

type UpdateContentHandler = (content: string) => Promise<void>;

interface PendingRequest {
  resolve: () => void;
  reject: (reason: Error) => void;
}

export interface ArtifactContextLike {
  addEventListener(
    type: "content-updated",
    listener: (event: ContentUpdatedEvent) => void,
    options?: boolean | AddEventListenerOptions,
  ): void;
  removeEventListener(
    type: "content-updated",
    listener: (event: ContentUpdatedEvent) => void,
    options?: boolean | EventListenerOptions,
  ): void;
  updateContent(content: string): Promise<void>;
}

interface ContentBridge {
  postToHost(message: ViewToHostMessage): void;
  onHostMessage(callback: (message: unknown) => void): () => void;
}

interface ContentBridgeWindow extends Window {
  __televisionContentBridge?: ContentBridge;
}

interface WebviewIpcMessage {
  channel: string;
  args: unknown[];
}

interface WebviewElement extends HTMLElement {
  send?: (channel: string, payload: unknown) => void;
}

const WEBVIEW_BRIDGE_CHANNEL = "television-artifact-bridge";

function coerceErrorMessage(error: unknown): string {
  if (error instanceof Error && typeof error.message === "string") {
    return error.message;
  }
  return String(error);
}

const DisposableArtifactViewEventTarget = withDisposable(
  EventTarget as abstract new () => EventTarget<ReadyEvent>,
);

const DisposableArtifactContextEventTarget = withDisposable(
  EventTarget as abstract new () => EventTarget<ContentUpdatedEvent>,
);

/**
 * Host-side handle to a view iframe. Constructed in the parent window.
 *
 * Speaks the artifact-view protocol:
 *   - listens for `ready` notifications and `update-content` requests from the
 *     view
 *   - sends `content-updated` notifications to the view
 *   - sends `response` messages back to the view's `update-content` requests
 *
 * The v1 host never initiates requests, so no pending-request bookkeeping is
 * needed on this side.
 */
export class ArtifactView extends DisposableArtifactViewEventTarget {
  readonly #iframe: HTMLIFrameElement;
  readonly #window: Window;
  readonly #listener: (event: MessageEvent) => void;
  #updateContentHandler: UpdateContentHandler | null = null;
  #content: string | null = null;
  #viewReady = false;

  constructor(iframe: HTMLIFrameElement) {
    super();
    this.#iframe = iframe;
    const ownerWindow = iframe.ownerDocument.defaultView;
    if (!ownerWindow) {
      throw new Error("ArtifactView: iframe has no owner window");
    }
    this.#window = ownerWindow;
    this.#listener = (event) => this.#onMessage(event);
    this.#window.addEventListener("message", this.#listener);
  }

  /**
   * The content that should currently be displayed in the view.
   *
   * Setting this is the *only* way to push content to the view. The value is
   * latched on the host side: whenever the view posts `ready` (initial mount
   * or reload), the host re-delivers the current content automatically. No
   * consumer needs to listen for `ready` to push content.
   *
   * `null` means "nothing to deliver yet" — the view will receive nothing on
   * `ready` until content is set for the first time. Once set, the value
   * cannot be un-set; assign `""` for empty content.
   */
  get content(): string | null {
    return this.#content;
  }

  set content(value: string) {
    this.#assertNotDisposed();
    this.#content = value;
    if (this.#viewReady) {
      this.#postContentUpdated(value);
    }
  }

  handleUpdateContent(handler: UpdateContentHandler): void {
    this.#assertNotDisposed();
    if (this.#updateContentHandler !== null) {
      throw new Error(DOUBLE_HANDLER_ERROR_MESSAGE);
    }
    this.#updateContentHandler = handler;
  }

  notifyStylesChanged(): void {
    this.#assertNotDisposed();
    if (!this.#viewReady) return;
    const message: StylesChangedNotification = { type: "styles-changed" };
    this.#postToView(message);
  }

  dispose(): void {
    this.#window.removeEventListener("message", this.#listener);
    this.#updateContentHandler = null;
  }

  #postContentUpdated(content: string): void {
    const message: ContentUpdatedNotification = { type: "content-updated", content };
    this.#postToView(message);
  }

  #onMessage(event: MessageEvent): void {
    if (this.disposed) return;
    if (event.source !== this.#iframe.contentWindow) return;
    const data = event.data as unknown;
    if (isReadyNotification(data)) {
      this.#viewReady = true;
      this.dispatchEvent(new ReadyEvent("ready"));
      if (this.#content !== null) {
        this.#postContentUpdated(this.#content);
      }
      return;
    }
    if (isUpdateContentRequest(data)) {
      void this.#handleUpdateContentRequest(data);
      return;
    }
    // Unknown shape: silently drop.
  }

  async #handleUpdateContentRequest(request: UpdateContentRequest): Promise<void> {
    const handler = this.#updateContentHandler;
    if (handler === null) {
      this.#postToView({
        type: "response",
        id: request.id,
        error: { message: NO_HANDLER_ERROR_MESSAGE },
      });
      return;
    }
    try {
      await handler(request.content);
    } catch (error) {
      if (this.disposed) return;
      this.#postToView({
        type: "response",
        id: request.id,
        error: { message: coerceErrorMessage(error) },
      });
      return;
    }
    if (this.disposed) return;
    this.#postToView({ type: "response", id: request.id, result: {} });
  }

  #postToView(message: HostToViewMessage): void {
    const target = this.#iframe.contentWindow;
    if (!target) return;
    target.postMessage(message, "*");
  }

  #assertNotDisposed(): void {
    if (this.disposed) {
      throw new Error("ArtifactView is disposed");
    }
  }
}

/**
 * Host-side handle to a view webview. Constructed in the embedding renderer.
 *
 * Speaks the same artifact-view protocol as `ArtifactView`, but transports
 * messages over Electron's `<webview>` IPC bridge instead of postMessage.
 */
export class WebviewArtifactViewRuntime extends DisposableArtifactViewEventTarget {
  readonly #webview: WebviewElement;
  readonly #listener: (event: Event) => void;
  #updateContentHandler: UpdateContentHandler | null = null;
  #content: string | null = null;
  #viewReady = false;

  constructor(webview: WebviewElement) {
    super();
    this.#webview = webview;
    this.#listener = (event) => this.#onMessage(event);
    this.#webview.addEventListener("ipc-message", this.#listener);
  }

  get content(): string | null {
    return this.#content;
  }

  set content(value: string) {
    this.#assertNotDisposed();
    this.#content = value;
    if (this.#viewReady) {
      this.#postContentUpdated(value);
    }
  }

  handleUpdateContent(handler: UpdateContentHandler): void {
    this.#assertNotDisposed();
    if (this.#updateContentHandler !== null) {
      throw new Error(DOUBLE_HANDLER_ERROR_MESSAGE);
    }
    this.#updateContentHandler = handler;
  }

  notifyStylesChanged(): void {
    this.#assertNotDisposed();
    if (!this.#viewReady) return;
    const message: StylesChangedNotification = { type: "styles-changed" };
    this.#postToView(message);
  }

  dispose(): void {
    this.#webview.removeEventListener("ipc-message", this.#listener);
    this.#updateContentHandler = null;
  }

  #postContentUpdated(content: string): void {
    const message: ContentUpdatedNotification = { type: "content-updated", content };
    this.#postToView(message);
  }

  #onMessage(event: Event): void {
    if (this.disposed) return;
    const ipc = ((event as Event & { detail?: WebviewIpcMessage }).detail ??
      (event as unknown as WebviewIpcMessage));
    if (!ipc || ipc.channel !== WEBVIEW_BRIDGE_CHANNEL) return;
    const data = ipc.args?.[0] as unknown;
    if (isReadyNotification(data)) {
      this.#viewReady = true;
      this.dispatchEvent(new ReadyEvent("ready"));
      if (this.#content !== null) {
        this.#postContentUpdated(this.#content);
      }
      return;
    }
    if (isUpdateContentRequest(data)) {
      void this.#handleUpdateContentRequest(data);
      return;
    }
    // Unknown shape: silently drop.
  }

  async #handleUpdateContentRequest(request: UpdateContentRequest): Promise<void> {
    const handler = this.#updateContentHandler;
    if (handler === null) {
      this.#postToView({
        type: "response",
        id: request.id,
        error: { message: NO_HANDLER_ERROR_MESSAGE },
      });
      return;
    }
    try {
      await handler(request.content);
    } catch (error) {
      if (this.disposed) return;
      this.#postToView({
        type: "response",
        id: request.id,
        error: { message: coerceErrorMessage(error) },
      });
      return;
    }
    if (this.disposed) return;
    this.#postToView({ type: "response", id: request.id, result: {} });
  }

  #postToView(message: HostToViewMessage): void {
    this.#webview.send?.(WEBVIEW_BRIDGE_CHANNEL, message);
  }

  #assertNotDisposed(): void {
    if (this.disposed) {
      throw new Error("WebviewArtifactViewRuntime is disposed");
    }
  }
}

/**
 * View-side handle to the host. Constructed inside the iframe.
 *
 * Posts `ready` synchronously on construction, listens for `content-updated`
 * notifications and `response` messages, and sends `update-content` requests
 * back to the host.
 */
export class ArtifactContext extends DisposableArtifactContextEventTarget implements ArtifactContextLike {
  readonly #window: Window;
  readonly #parent: Window;
  readonly #listener: (event: MessageEvent) => void;
  readonly #pending = new Map<string, PendingRequest>();
  readonly #stylesChangedListeners = new Set<() => void>();

  constructor(target: Window = globalThis as unknown as Window) {
    super();
    this.#window = target;
    const parent = target.parent;
    if (!parent || parent === target) {
      throw new Error("ArtifactContext: window has no parent");
    }
    this.#parent = parent;
    this.#listener = (event) => this.#onMessage(event);
    this.#window.addEventListener("message", this.#listener);
    this.#postToHost({ type: "ready" });
  }

  onStylesChanged(listener: () => void): () => void {
    this.#assertNotDisposed();
    this.#stylesChangedListeners.add(listener);
    return () => this.#stylesChangedListeners.delete(listener);
  }

  updateContent(content: string): Promise<void> {
    this.#assertNotDisposed();
    const id = ulid();
    const message: UpdateContentRequest = { type: "update-content", id, content };
    return new Promise<void>((resolve, reject) => {
      this.#pending.set(id, { resolve, reject });
      this.#postToHost(message);
    });
  }

  dispose(): void {
    this.#window.removeEventListener("message", this.#listener);
    this.#stylesChangedListeners.clear();
    const pending = [...this.#pending.values()];
    this.#pending.clear();
    for (const { reject } of pending) {
      reject(new Error("ArtifactContext disposed"));
    }
  }

  #onMessage(event: MessageEvent): void {
    if (this.disposed) return;
    if (event.source !== this.#parent) return;
    const data = event.data as unknown;
    if (isContentUpdatedNotification(data)) {
      this.dispatchEvent(new ContentUpdatedEvent("content-updated", { content: data.content }));
      return;
    }
    if (isStylesChangedNotification(data)) {
      for (const listener of this.#stylesChangedListeners) listener();
      return;
    }
    if (isResponseMessage(data)) {
      this.#resolveResponse(data);
      return;
    }
    // Unknown shape: silently drop.
  }

  #resolveResponse(response: ResponseMessage): void {
    const pending = this.#pending.get(response.id);
    if (!pending) return;
    this.#pending.delete(response.id);
    if (response.error !== undefined) {
      pending.reject(new Error(response.error.message));
      return;
    }
    pending.resolve();
  }

  #postToHost(message: ViewToHostMessage): void {
    this.#parent.postMessage(message, "*");
  }

  #assertNotDisposed(): void {
    if (this.disposed) {
      throw new Error("ArtifactContext is disposed");
    }
  }
}

/**
 * View-side handle to the host when the view runs inside an Electron webview.
 */
export class WebviewArtifactContext extends DisposableArtifactContextEventTarget implements ArtifactContextLike {
  readonly #bridge: ContentBridge;
  readonly #unsubscribe: () => void;
  readonly #pending = new Map<string, PendingRequest>();
  readonly #stylesChangedListeners = new Set<() => void>();

  constructor(target: Window = globalThis as unknown as Window) {
    super();
    const bridge = (target as ContentBridgeWindow).__televisionContentBridge;
    if (!bridge) {
      throw new Error("WebviewArtifactContext: window has no __televisionContentBridge");
    }
    this.#bridge = bridge;
    this.#unsubscribe = bridge.onHostMessage((message) => this.#onMessage(message));
    this.#postToHost({ type: "ready" });
  }

  onStylesChanged(listener: () => void): () => void {
    this.#assertNotDisposed();
    this.#stylesChangedListeners.add(listener);
    return () => this.#stylesChangedListeners.delete(listener);
  }

  updateContent(content: string): Promise<void> {
    this.#assertNotDisposed();
    const id = ulid();
    const message: UpdateContentRequest = { type: "update-content", id, content };
    return new Promise<void>((resolve, reject) => {
      this.#pending.set(id, { resolve, reject });
      this.#postToHost(message);
    });
  }

  dispose(): void {
    this.#unsubscribe();
    this.#stylesChangedListeners.clear();
    const pending = [...this.#pending.values()];
    this.#pending.clear();
    for (const { reject } of pending) {
      reject(new Error("WebviewArtifactContext disposed"));
    }
  }

  #onMessage(data: unknown): void {
    if (this.disposed) return;
    if (isContentUpdatedNotification(data)) {
      this.dispatchEvent(new ContentUpdatedEvent("content-updated", { content: data.content }));
      return;
    }
    if (isStylesChangedNotification(data)) {
      for (const listener of this.#stylesChangedListeners) listener();
      return;
    }
    if (isResponseMessage(data)) {
      this.#resolveResponse(data);
      return;
    }
    // Unknown shape: silently drop.
  }

  #resolveResponse(response: ResponseMessage): void {
    const pending = this.#pending.get(response.id);
    if (!pending) return;
    this.#pending.delete(response.id);
    if (response.error !== undefined) {
      pending.reject(new Error(response.error.message));
      return;
    }
    pending.resolve();
  }

  #postToHost(message: ViewToHostMessage): void {
    this.#bridge.postToHost(message);
  }

  #assertNotDisposed(): void {
    if (this.disposed) {
      throw new Error("WebviewArtifactContext is disposed");
    }
  }
}

import { html } from "lit-html";
import { view, View } from "@telepath-computer/utils/lit-view";
import {
  ArtifactView as ArtifactViewRuntime,
  WebviewArtifactViewRuntime,
} from "@telepath-computer/television-artifact/browser";
import {
  isMarkdownPath,
  isTvArtifact,
  missingArtifactDescription,
  missingArtifactRecoveryHint,
  missingArtifactTitle,
  type Artifact,
} from "@telepath-computer/television-artifact";
import { RequestError } from "@telepath-computer/television-shared";
import type { ApplicationService } from "../services/application-service.ts";
import { artifactRenderRoute, type ArtifactRenderRoute } from "../artifact-dispatcher.ts";
import "./artifact-document-host.css";

const HTTP_NOT_FOUND = 404;
const URL_UNSUPPORTED_VIEW_URL = "/views/url-unsupported/";
// The attributes of every artifact iframe
// (specs/arch/artifact-frame/isolation.md#^iso-iframe-sandbox, ^iso-iframe-allow).
const FRAME_SANDBOX = "allow-scripts allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox allow-downloads";
const FRAME_ALLOW = "clipboard-write; fullscreen; autoplay; picture-in-picture; web-share; encrypted-media";
// The partition names the desktop main process reads from a webview
// (specs/arch/desktop/artifact-partitions.md#^dp-interface-names).
const ARTIFACT_PARTITION_PREFIX = "tv-artifact:";
const URL_ARTIFACT_PARTITION = "tv-url-artifact";

/**
 * The complete input for one logical artifact document. Navigation and reload
 * policy remain with the wrapper; this host owns the live node selected by the
 * resulting renderer route and all content delivery inside that node.
 */
export interface ArtifactDocumentSource {
  artifact: Artifact;
  application: ApplicationService | null;
  electron: boolean;
  browserDemo?: boolean;
  viewURL: string | null;
  contentURL: string | null;
  currentURL: string | null;
  frameSrcOverride?: string | null;
}

export function artifactDocumentRoute(source: ArtifactDocumentSource): ArtifactRenderRoute {
  const route = artifactRenderRoute(source.artifact, {
    electron: source.electron,
    browserDemo: source.browserDemo ?? false,
  });
  let resolved: ArtifactRenderRoute;

  if (route.renderer === "url-direct") {
    // Television records no navigation for a demo-mode page, so it always
    // starts from the artifact's own URL.
    resolved = route;
  } else if (source.currentURL === null) {
    const viewURL = source.viewURL ?? route.viewURL;
    if (route.renderer === "markdown") {
      resolved = {
        renderer: "markdown",
        viewURL,
        contentURL: source.contentURL ?? route.contentURL,
      };
    } else if (route.renderer === "url-webview" && route.contentURL !== null) {
      resolved = {
        renderer: "url-webview",
        viewURL,
        contentURL: source.contentURL ?? route.contentURL,
      };
    } else {
      resolved = { ...route, viewURL };
    }
  } else if (isExternalURL(source.currentURL) && !source.electron) {
    resolved = isTvArtifact(source.currentURL)
      ? { renderer: "proxy-iframe", viewURL: source.currentURL, contentURL: null }
      : { renderer: "proxy-iframe", viewURL: URL_UNSUPPORTED_VIEW_URL, contentURL: null };
  } else if (isExternalURL(source.currentURL)) {
    resolved = { renderer: "url-webview", viewURL: source.currentURL, contentURL: null };
  } else {
    resolved = {
      renderer: source.electron ? "url-webview" : "proxy-iframe",
      viewURL: viewURLForInternalNavigation(source.currentURL, source.viewURL),
      contentURL: null,
    };
  }

  return source.frameSrcOverride
    ? { ...resolved, viewURL: source.frameSrcOverride }
    : resolved;
}

export type ArtifactDocumentHostCapture = (host: ArtifactDocumentHost) => void;
export type ArtifactEmbedLoadChange = (loaded: boolean) => void;
/** Called before a frame becomes loadable, and with null before replacement. */
export type ArtifactDocumentFrameChange = (frame: HTMLElement | null) => void;

/**
 * Owns one iframe or webview and the markdown content runtime attached to it.
 * The surrounding artifact wrapper remains the coordinator for trust,
 * navigation/reload, status replies, input delivery, and chrome.
 */
export class ArtifactDocumentHost extends View<[
  ArtifactDocumentHostCapture,
  ArtifactEmbedLoadChange,
  ArtifactDocumentFrameChange?,
]> {
  #source: ArtifactDocumentSource | null = null;
  #frame: HTMLElement | null = null;
  #output: unknown = "";
  #onEmbedLoadChange: ArtifactEmbedLoadChange = () => {};
  #onFrameChange: ArtifactDocumentFrameChange = () => {};
  #embedLoadFrame: HTMLElement | null = null;
  #embedLoadKey: string | null = null;
  #markdownFrame: HTMLElement | null = null;
  #markdownHost: ArtifactViewRuntime | WebviewArtifactViewRuntime | null = null;
  #markdownContentURL: string | null = null;
  #markdownArtifactID: string | null = null;
  #markdownContent: string | null = null;
  #markdownFetchedArtifactID: string | null = null;
  #markdownFetchedApplication: ApplicationService | null = null;
  #missingArtifactID: string | null = null;

  get currentFrame(): HTMLElement | null {
    return this.#frame;
  }

  connected(): void {
    this.#syncEmbedLoadState();
    this.#syncMarkdownHost();
  }

  disconnected(): void {
    this.#unsubscribeFromEmbedLoad();
    this.#disposeMarkdownHost();
  }

  template(
    capture: ArtifactDocumentHostCapture,
    onEmbedLoadChange: ArtifactEmbedLoadChange,
    onFrameChange: ArtifactDocumentFrameChange = () => {},
  ): unknown {
    this.#onEmbedLoadChange = onEmbedLoadChange;
    this.#onFrameChange = onFrameChange;
    capture(this);
    return this.#output;
  }

  assignSource(source: ArtifactDocumentSource): void {
    const previous = this.#source;
    const changedDocument = previous ? !sameArtifactDocument(previous.artifact, source.artifact) : true;

    if (
      previous?.artifact.id !== source.artifact.id ||
      (previous?.artifact.kind === "path" && source.artifact.kind === "path" && previous.artifact.path !== source.artifact.path)
    ) {
      this.#missingArtifactID = null;
    }

    if (changedDocument) {
      this.#markdownContent = null;
      if (this.#markdownHost) this.#markdownHost.content = "";
      this.#markdownFetchedArtifactID = null;
      this.#markdownFetchedApplication = null;
    }

    this.#source = source;
    this.#syncOutput();
  }

  /**
   * Lets the wrapper keep ownership of content-change subscription and reload
   * policy while markdown bytes and missing-state transitions remain here.
   * Returns true when this host consumed the matching event.
   */
  handleArtifactContentChanged(artifactID: string): boolean {
    const source = this.#source;
    if (artifactID !== source?.artifact.id) return false;
    if (!this.#markdownHost && !this.#isCurrentMarkdownMissing()) return false;
    void this.#fetchMarkdownContent();
    return true;
  }

  /** Notify only the current markdown view; readiness gating stays in its runtime. */
  handleThemeChanged(): boolean {
    const artifact = this.#source?.artifact;
    if (
      artifact?.kind !== "path" ||
      !isMarkdownPath(artifact.path) ||
      this.#markdownHost === null
    ) {
      return false;
    }
    this.#markdownHost.notifyStylesChanged();
    return true;
  }

  /** Rebind load observation after a later-owner path mutates frame.src. */
  refreshFrameLoadState(): void {
    this.#syncEmbedLoadState();
  }

  /** Assigns the current frame's document outside a source change, as Back, Forward and a demo page's return do. */
  assignFrameSrc(src: string): void {
    if (this.#frame) this.#setFrameSrc(this.#frame, src);
  }

  /**
   * Assigns a frame's document. An iframe first gets the `sandbox` attribute
   * when the document is one the artifact proxy serves, on this server or
   * another Television host, and loses it otherwise, since the browser fixes
   * a frame's sandbox when its navigation starts and one element shows many
   * documents. An external page under browser demo mode is never sandboxed.
   */
  #setFrameSrc(frame: HTMLElement, src: string): void {
    if (frame.tagName.toLowerCase() === "iframe") {
      if (!this.#showsDemoPage() && isProxiedDocumentURL(src)) frame.setAttribute("sandbox", FRAME_SANDBOX);
      else frame.removeAttribute("sandbox");
    }
    frame.setAttribute("src", src);
  }

  #showsDemoPage(): boolean {
    const source = this.#source;
    return source !== null && artifactRenderRoute(source.artifact, {
      electron: source.electron,
      browserDemo: source.browserDemo ?? false,
    }).renderer === "url-direct";
  }

  #syncOutput(): void {
    const source = this.#source;
    if (!source) return;

    if (source.artifact.kind === "path" && this.#isCurrentMarkdownMissing()) {
      this.#showMissingArtifact(source.artifact);
      return;
    }

    const route = artifactDocumentRoute(source);
    const frame = this.#ensureFrame(route.renderer, webviewPartition(source));
    this.#assignFrameRoute(frame, route);
    this.#setOutput(frame);
    this.#syncEmbedLoadState();
    this.#syncMarkdownHost();
  }

  /**
   * Reuses the current frame while it is the right element. A webview's
   * partition is fixed at its first navigation, so a webview whose artifact
   * needs another partition is replaced.
   */
  #ensureFrame(renderer: ArtifactRenderRoute["renderer"], partition: string | null): HTMLElement {
    const tagName = renderer === "url-webview" ? "webview" : "iframe";
    const current = this.#frame;
    if (
      current?.tagName.toLowerCase() === tagName &&
      (tagName !== "webview" || current.getAttribute("partition") === partition)
    ) {
      return current;
    }

    this.#unsubscribeFromEmbedLoad();
    this.#disposeMarkdownHost();

    const frame = document.createElement(tagName);
    frame.className = "artifact-content";
    if (tagName === "webview") {
      if (partition !== null) frame.setAttribute("partition", partition);
      frame.setAttribute("allowpopups", "");
    } else {
      frame.setAttribute("allow", FRAME_ALLOW);
    }
    this.#frame = frame;
    return frame;
  }

  #assignFrameRoute(frame: HTMLElement, route: ArtifactRenderRoute): void {
    if (frame.getAttribute("src") !== route.viewURL) {
      // The wrapper clears trust and subscribes this peer before `src` can
      // start a document whose ready message may be one-shot.
      this.#onFrameChange(null);
      this.#onFrameChange(frame);
      this.#setFrameSrc(frame, route.viewURL);
    }

    if (route.contentURL === null) {
      delete frame.dataset.contentUrl;
    } else {
      frame.dataset.contentUrl = route.contentURL;
    }
  }

  #setOutput(output: unknown): void {
    if (this.#output === output) return;
    this.#output = output;
    this.render(output);
  }

  #showMissingArtifact(artifact: Artifact & { kind: "path" }): void {
    this.#onFrameChange(null);
    this.#unsubscribeFromEmbedLoad();
    this.#disposeMarkdownHost();
    this.#frame = null;
    this.#onEmbedLoadChange(false);
    this.#setOutput(html`
      <section class="artifact-missing artifact-content" role="status" aria-label="Artifact file not found">
        <div class="artifact-missing-wrapper">
          <h1>${missingArtifactTitle()}</h1>
          <p>${missingArtifactDescription()}</p>
          <section class="artifact-missing-path" aria-label="Missing artifact path">
            <p class="artifact-missing-path-label">Registered path:</p>
            <p><code>${artifact.path}</code></p>
          </section>
          <p>${missingArtifactRecoveryHint()}</p>
        </div>
      </section>
    `);
  }

  readonly #handleEmbedLoad = (): void => {
    if (!this.#frame || this.#frame !== this.#embedLoadFrame) return;
    this.#onEmbedLoadChange(true);
  };

  #syncEmbedLoadState(): void {
    const frame = this.#frame;
    const key = frame
      ? `${frame.tagName.toLowerCase()}:${frame.getAttribute("src") ?? ""}:${frame.dataset.contentUrl ?? ""}`
      : null;
    if (frame && frame === this.#embedLoadFrame && key === this.#embedLoadKey) return;

    this.#unsubscribeFromEmbedLoad();
    this.#onEmbedLoadChange(false);
    if (!frame || !key || !this.isConnected) return;

    this.#embedLoadFrame = frame;
    this.#embedLoadKey = key;
    if (frame.tagName.toLowerCase() === "webview") {
      frame.addEventListener("did-finish-load", this.#handleEmbedLoad);
      frame.addEventListener("did-fail-load", this.#handleEmbedLoad);
      return;
    }

    frame.addEventListener("load", this.#handleEmbedLoad);
    const iframe = frame as HTMLIFrameElement;
    try {
      if (iframe.isConnected && iframe.contentDocument?.readyState === "complete") {
        this.#handleEmbedLoad();
      }
    } catch {
      // Cross-origin frames report load through the event listener above.
    }
  }

  #unsubscribeFromEmbedLoad(): void {
    if (!this.#embedLoadFrame) {
      this.#embedLoadKey = null;
      return;
    }
    this.#embedLoadFrame.removeEventListener("load", this.#handleEmbedLoad);
    this.#embedLoadFrame.removeEventListener("did-finish-load", this.#handleEmbedLoad);
    this.#embedLoadFrame.removeEventListener("did-fail-load", this.#handleEmbedLoad);
    this.#embedLoadFrame = null;
    this.#embedLoadKey = null;
  }

  #syncMarkdownHost(): void {
    const source = this.#source;
    const frame = this.#frame;
    const contentURL = frame?.dataset.contentUrl ?? null;
    const artifactID = source?.artifact.id ?? null;
    if (!source || !frame || !contentURL || !artifactID) {
      this.#disposeMarkdownHost({ clearContent: true });
      return;
    }

    // The runtime is bound to the editable frame and artifact, not to the
    // display-only content URL. A route-relative URL can become absolute after
    // ready; recreating for that string change would discard latched readiness.
    if (frame !== this.#markdownFrame || artifactID !== this.#markdownArtifactID) {
      this.#disposeMarkdownHost();
      this.#markdownFrame = frame;
      this.#markdownContentURL = contentURL;
      this.#markdownArtifactID = artifactID;
      const host = frame.tagName.toLowerCase() === "webview"
        ? new WebviewArtifactViewRuntime(frame)
        : new ArtifactViewRuntime(frame as HTMLIFrameElement);
      this.#markdownHost = host;
      host.handleUpdateContent(async (content) => {
        const currentSource = this.#source;
        const currentApplication = currentSource?.application;
        if (!currentSource || !currentApplication) throw new Error("No markdown artifact selected");
        await currentApplication.writeMarkdown(currentSource.artifact.id, content);
        this.#markdownContent = content;
        if (this.#markdownHost === host) host.content = content;
      });
      if (this.#markdownContent !== null) host.content = this.#markdownContent;
    } else {
      this.#markdownContentURL = contentURL;
    }

    this.#ensureMarkdownContentFetched();
  }

  #ensureMarkdownContentFetched(): void {
    const source = this.#source;
    const application = source?.application;
    if (!source || !application || !this.#markdownHost) return;
    if (
      this.#markdownFetchedArtifactID === source.artifact.id &&
      this.#markdownFetchedApplication === application
    ) {
      return;
    }
    this.#markdownFetchedArtifactID = source.artifact.id;
    this.#markdownFetchedApplication = application;
    void this.#fetchMarkdownContent();
  }

  async #fetchMarkdownContent(): Promise<void> {
    const source = this.#source;
    const application = source?.application;
    if (!source || !application) return;
    const artifactID = source.artifact.id;
    try {
      const content = await application.readMarkdown(artifactID);
      if (this.#source?.artifact.id !== artifactID || this.#source.application !== application) return;
      this.#missingArtifactID = null;
      this.#markdownContent = content;
      const host = this.#markdownHost;
      if (!host) {
        this.#syncOutput();
        return;
      }
      host.content = content;
    } catch (error) {
      if (this.#source?.artifact.id !== artifactID || this.#source.application !== application) return;
      if (error instanceof RequestError && error.status === HTTP_NOT_FOUND) {
        this.#missingArtifactID = artifactID;
        this.#markdownContent = null;
        this.#disposeMarkdownHost();
        this.#syncOutput();
        return;
      }
      this.#markdownFetchedArtifactID = null;
      this.#markdownFetchedApplication = null;
      // Keep the last successfully delivered editor content visible.
    }
  }

  #isCurrentMarkdownMissing(): boolean {
    const artifact = this.#source?.artifact;
    return this.#missingArtifactID === artifact?.id &&
      artifact.kind === "path" &&
      isMarkdownPath(artifact.path);
  }

  #disposeMarkdownHost(options: { clearContent?: boolean } = {}): void {
    this.#markdownHost?.dispose();
    this.#markdownHost = null;
    this.#markdownFrame = null;
    this.#markdownContentURL = null;
    this.#markdownArtifactID = null;
    this.#markdownFetchedArtifactID = null;
    this.#markdownFetchedApplication = null;
    if (options.clearContent) this.#markdownContent = null;
  }
}

export const ArtifactDocumentHostView = view(ArtifactDocumentHost);

/**
 * The partition a desktop webview showing this artifact asks for, when the
 * window's native preload bridge says the main process sets them up.
 */
function webviewPartition(source: ArtifactDocumentSource): string | null {
  const bridge = (globalThis as typeof globalThis & {
    __televisionNativeBridge?: { artifactPartitions?: unknown };
  }).__televisionNativeBridge;
  if (!source.electron || bridge?.artifactPartitions !== 1) return null;
  return source.artifact.kind === "path" ? `${ARTIFACT_PARTITION_PREFIX}${source.artifact.id}` : URL_ARTIFACT_PARTITION;
}

function isExternalURL(url: string): boolean {
  return url.startsWith("http://") || url.startsWith("https://");
}

/** Whether a frame address is the artifact proxy's, under any ID, on any host. */
function isProxiedDocumentURL(url: string): boolean {
  try {
    return /^\/artifact\/[^/]+(\/|$)/.test(new URL(url, window.location.href).pathname);
  } catch {
    return false;
  }
}

function viewURLForInternalNavigation(url: string, viewURL: string | null): string {
  if (!url.startsWith("/") || !viewURL) return url;
  try {
    return new URL(url, viewURL).toString();
  } catch {
    return url;
  }
}

function sameArtifactDocument(left: Artifact, right: Artifact): boolean {
  if (left.id !== right.id || left.kind !== right.kind) return false;
  if (left.kind === "path" && right.kind === "path") return left.path === right.path;
  if (left.kind === "url" && right.kind === "url") return left.url === right.url;
  return true;
}

import { View, view } from "@telepath-computer/utils/lit-view";
import { html, type TemplateResult } from "lit-html";
import type { Part } from "lit-html/directive.js";
import { createRef, ref, type Ref } from "lit-html/directives/ref.js";
import {
  dialogTemplate,
  presentDialog,
  type DialogPresentation,
} from "./dialog.ts";
import {
  MenuView,
  type MenuEntry,
} from "./menu.ts";
import {
  isTvArtifact,
  isWebNavigationURL,
  type Artifact,
} from "@telepath-computer/television-artifact";
import {
  ARTIFACT_MISSING_MESSAGE_TYPE,
  URL_TARGET_MESSAGE_TYPE,
  type NavigationRequestNotification,
} from "@telepath-computer/television-artifact/browser";
import type { ApplicationService } from "../services/application-service.ts";
import { isElectronMode } from "../config.ts";
import { artifactRenderRoute } from "../artifact-dispatcher.ts";
import { forwardThemePointer } from "../theme.ts";
import { ArtifactNavigationState, PROXY_RELOAD_PARAM, convertURL } from "../services/artifact-navigation-state.ts";
import {
  ArtifactDocumentHostView,
  artifactDocumentRoute,
  type ArtifactDocumentHost,
  type ArtifactDocumentSource,
} from "./artifact-document-host.ts";
import {
  ArtifactTrustedChannel,
  type ArtifactBridgeReplyTransport,
  type ArtifactFrameInboundMessage,
} from "../components/artifact-trusted-channel.ts";
import "../elements/icon.ts";
import "./artifact-view.css";
import "./artifact-view.host.css";

const URL_UNSUPPORTED_VIEW_URL = "/views/url-unsupported/";

/**
 * Frame for a single artifact. The title bar is owned by this component; the
 * content area delegates to one of the current artifact renderers:
 *
 * 1. **Path proxy iframe** — HTML/path artifacts load directly from the
 *    unauthenticated `/artifact/:id` capability route. The server injects the
 *    browser bridge into proxied HTML.
 * 2. **Markdown view iframe** — markdown path artifacts load the bundled
 *    markdown view and exchange content through `/markdown/:id`; the view
 *    installs its own bridge in-document.
 * 3. **URL artifact** — Electron renders the remote URL in a `<webview>`;
 *    browsers show a local unsupported placeholder, or, under browser demo
 *    mode, load an external page directly in a bridgeless iframe.
 *
 * Wire-up:
 * - `viewURL` / `contentURL` remain supplied by the owning view, but the
 *   current path/url model computes the render route from `artifact`.
 * - `application` is the shared application edge. It carries markdown
 *   saves/refetches and content/theme change signals.
 */

export interface ArtifactViewOptions {
  viewURL: string | null;
  contentURL: string | null;
  fullScreen: boolean;
  inert: boolean;
  onFullScreenChange(fullScreen: boolean): void;
}

/**
 * The artifact frame chrome, document source, trust, and navigation owner.
 * TV-642 still owns redesigning its imperative source/trust coordination; this
 * view conversion changes the outer scheduler without crossing those bounds.
 */
export class ArtifactView extends View<[ApplicationService, Artifact, ArtifactViewOptions]> {
  private _artifact: Artifact | null = null;
  private _viewURL: string | null = null;
  private _contentURL: string | null = null;
  private _application: ApplicationService | null = null;
  private _fullScreen = false;
  private _inert = false;
  private _onFullScreenChange: (fullScreen: boolean) => void = () => {};
  private _connected = false;
  private _deleteConfirmationOpen = false;
  private _dialogPresentation: DialogPresentation | null = null;
  private _subscribedWebview: HTMLElement | null = null;
  private _documentHost: ArtifactDocumentHost | null = null;
  private _pendingDocumentSource: ArtifactDocumentSource | null = null;
  private _rootRef: Ref<HTMLElement> = createRef();
  private readonly _trustedChannel = new ArtifactTrustedChannel(
    (message, transport) => {
      this.handleTrustedFrameMessage(message, transport);
    },
    () => {
      this._missingArtifactReplyTransport = null;
    },
    (url) => openApplicationLinkThroughShell(url),
  );
  private _activeReloadFrameSrc: string | null = null;
  private _applicationSubscriptionsAttached = false;
  private _proxyReloadVersion = 0;
  private _navigationState: ArtifactNavigationState | null = null;
  private _navigationArtifactId: string | null = null;
  private _navigationCanonicalURL: string | null = null;
  private _preserveFrameSrcOnNavigationRender = false;
  private _missingArtifactReplyTransport: ArtifactBridgeReplyTransport | null = null;

  override update(
    part: Part,
    args: [ApplicationService, Artifact, ArtifactViewOptions],
  ): unknown {
    const [application, artifact, options] = args;
    let handledRender = false;

    if (this._application !== application) {
      this.detachApplicationSubscriptions();
      this._application = application;
      this.attachApplicationSubscriptions();
      if (this._connected) {
        this.assignDocumentSource({ preserveFrameSrc: true });
        handledRender = true;
      }
    }

    const previousArtifact = this._artifact;
    if (previousArtifact !== artifact) {
      const changedDocument = previousArtifact
        ? !sameArtifactDocument(previousArtifact, artifact)
        : true;
      if (changedDocument) this._activeReloadFrameSrc = null;
      this._artifact = artifact;
      this.syncNavigationState();
      if (this._connected) {
        this.renderArtifact({ resetTrust: changedDocument });
        handledRender = true;
        if (previousArtifact && changedMissingArtifactMetadata(previousArtifact, artifact)) {
          const reply = this.currentMissingArtifactMessage();
          if (reply) this._missingArtifactReplyTransport?.send(reply);
        }
      } else if (changedDocument) {
        this.resetTrustedFrame();
      }
    }

    if (this._viewURL !== options.viewURL) {
      this._viewURL = options.viewURL;
      this.syncNavigationState();
      if (this._connected) {
        this.renderArtifact({ resetTrust: true });
        handledRender = true;
      } else {
        this._trustedChannel.reset();
      }
    }

    if (this._contentURL !== options.contentURL) {
      this._contentURL = options.contentURL;
      if (this._connected) {
        this.renderArtifact();
        handledRender = true;
      }
    }

    if (this._fullScreen !== options.fullScreen) {
      this._fullScreen = options.fullScreen;
      if (this._connected && this._artifact) {
        this.renderArtifact({ preserveFrameSrc: true });
        handledRender = true;
      }
    }

    this._inert = options.inert;
    this._onFullScreenChange = options.onFullScreenChange;
    if (this._connected && !handledRender) {
      this.renderArtifact({ preserveFrameSrc: true });
    }
    return super.update(part, args);
  }

  private attachApplicationSubscriptions(): void {
    if (!this._application || this._applicationSubscriptionsAttached) return;
    this._application.addEventListener("artifact-content-changed", this.handleArtifactContentChanged);
    this._application.addEventListener("theme-changed", this.handleThemeChanged);
    this._applicationSubscriptionsAttached = true;
  }

  private detachApplicationSubscriptions(): void {
    if (!this._application || !this._applicationSubscriptionsAttached) return;
    this._application.removeEventListener("artifact-content-changed", this.handleArtifactContentChanged);
    this._application.removeEventListener("theme-changed", this.handleThemeChanged);
    this._applicationSubscriptionsAttached = false;
  }

  get activeView(): null {
    return null;
  }

  connected(): void {
    this._connected = true;
    this._trustedChannel.connect();
    this.attachApplicationSubscriptions();
    this.resetTrustedFrame();
    this.syncNavigationState();
    this.renderArtifact();
    this.syncFrameSubscriptions();
  }

  disconnected(): void {
    this._connected = false;
    this._dialogPresentation?.withdraw();
    this._dialogPresentation = null;
    this._deleteConfirmationOpen = false;
    this.resetTrustedFrame();
    this._trustedChannel.disconnect();
    this.unsubscribeFromWebview();
    this.syncNavigationState();
    this.detachApplicationSubscriptions();
  }

  private handleTrustedFrameMessage(
    message: ArtifactFrameInboundMessage,
    transport: ArtifactBridgeReplyTransport,
  ): void {
    switch (message.type) {
      case "url-target-request":
        transport.send({ type: URL_TARGET_MESSAGE_TYPE, url: this.currentExternalTargetURL() });
        return;
      case "artifact-missing-request": {
        const reply = this.currentMissingArtifactMessage();
        if (reply) {
          this._missingArtifactReplyTransport = transport;
          transport.send(reply);
        }
        return;
      }
      case "proxy-content-changed":
        this.handleProxyContentChanged();
        return;
      case "navigation-request":
        this.handleNavigationRequest(message);
        return;
      case "navigation-key":
        this._application?.handleNavigationKey(message.key);
        return;
      case "artifact-pointer":
        this.handleArtifactPointer(message);
        return;
      case "bridge-ready":
      case "leaving":
        // Lifecycle is owned by the channel.
        return;
    }
  }

  private handleArtifactPointer(
    message: Extract<ArtifactFrameInboundMessage, { type: "artifact-pointer" }>,
  ): void {
    const frame = this.currentFrame;
    if (frame === null || frame.clientWidth <= 0 || frame.clientHeight <= 0) return;
    const rect = frame.getBoundingClientRect();
    forwardThemePointer({
      eventType: message.eventType,
      clientX: rect.left + message.clientX * rect.width / frame.clientWidth,
      clientY: rect.top + message.clientY * rect.height / frame.clientHeight,
      button: message.button,
      buttons: message.buttons,
    });
  }

  private currentExternalTargetURL(): string | null {
    const currentURL = this._navigationState?.currentURL ?? null;
    if (currentURL && isExternalURL(currentURL)) return currentURL;
    if (this._artifact?.kind === "url") return this._artifact.url;
    return null;
  }

  private currentMissingArtifactMessage(): { type: typeof ARTIFACT_MISSING_MESSAGE_TYPE; title: string; path: string } | null {
    const artifact = this._artifact;
    if (artifact?.kind !== "path") return null;
    return { type: ARTIFACT_MISSING_MESSAGE_TYPE, title: artifact.title, path: artifact.path };
  }


  private handleProxyContentChanged(): void {
    if (this._artifact?.kind !== "url" || !isTvArtifact(this._artifact.url)) return;
    this.reloadProxyFrame();
  }

  private handleNavigationRequest(message: NavigationRequestNotification): void {
    if (!isWebNavigationURL(message.url, window.location.href)) return;
    this.syncNavigationState();
    const state = this._navigationState;
    if (!state) return;

    const url = this.convertIframeNavigationURL(message.url);
    if (url === URL_UNSUPPORTED_VIEW_URL) return;
    if (url === state.currentURL) return;

    const nativeNavigation = (message as NavigationRequestNotification & { native?: boolean }).native === true;
    if (message.sameDocument || nativeNavigation) {
      this._preserveFrameSrcOnNavigationRender = true;
    }
    if (message.replace) {
      state.replace(url);
    } else {
      state.navigate(url);
    }
    // A request that changed no history committed nothing, so no render
    // consumed the flag; left set, it would keep the next Back or Forward
    // from assigning the frame's src.
    this._preserveFrameSrcOnNavigationRender = false;
  }

  private readonly handleNavigationChange = (): void => {
    const preserveFrameSrc = this._preserveFrameSrcOnNavigationRender;
    const forceFrameSrc = !preserveFrameSrc;
    if (forceFrameSrc && !isElectronMode()) {
      this.renderArtifact({ preserveFrameSrc: true });
      this.forceCurrentFrameSrc();
    } else {
      this.renderArtifact({ preserveFrameSrc, resetTrust: forceFrameSrc });
    }
    this._preserveFrameSrcOnNavigationRender = false;
  };

  private readonly handleArtifactContentChanged = (event: Event): void => {
    const artifactID = (event as { artifactID?: unknown }).artifactID;
    const artifact = this._artifact;
    if (!artifact || artifactID !== artifact.id || artifact.kind !== "path") return;
    if (typeof artifactID === "string" && this._documentHost?.handleArtifactContentChanged(artifactID)) return;
    this.reloadProxyFrame();
  };

  private readonly handleThemeChanged = (): void => {
    if (this._artifact?.kind === "url" && isTvArtifact(this._artifact.url)) return;
    // A demo-mode page is the external site's own document; Television
    // neither restyles nor reloads it.
    if (this.isDemoPage()) return;
    if (this._documentHost?.handleThemeChanged()) return;
    this.reloadProxyFrame();
  };

  private syncNavigationState(): void {
    if (!this._connected || !this._artifact || this.isDemoPage()) {
      this.disposeNavigationState();
      return;
    }

    const canonicalURL = this.canonicalURLForArtifact(this._artifact);
    if (
      this._navigationState &&
      this._navigationArtifactId === this._artifact.id &&
      this._navigationCanonicalURL === canonicalURL
    ) {
      return;
    }

    this.disposeNavigationState();
    this._navigationState = new ArtifactNavigationState(this._artifact.id, canonicalURL);
    this._navigationArtifactId = this._artifact.id;
    this._navigationCanonicalURL = canonicalURL;
    this._navigationState.addEventListener("change", this.handleNavigationChange);
    if (this._navigationState.currentURL !== null) {
      this.renderArtifact();
    } else if (this._navigationState.canGoForward) {
      this.renderArtifact({ preserveFrameSrc: true });
    }
  }

  private disposeNavigationState(): void {
    this._navigationState?.removeEventListener("change", this.handleNavigationChange);
    this._navigationState = null;
    this._navigationArtifactId = null;
    this._navigationCanonicalURL = null;
    this._preserveFrameSrcOnNavigationRender = false;
  }

  private canonicalURLForArtifact(artifact: Artifact): string {
    const route = artifactDocumentRoute({
      artifact,
      application: this._application,
      electron: isElectronMode(),
      browserDemo: this.browserDemo,
      viewURL: this._viewURL,
      contentURL: this._contentURL,
      currentURL: null,
    });
    const viewURL = route.viewURL;
    if (artifact.kind === "url" && isTvArtifact(artifact.url)) return convertURL(viewURL);
    if (route.renderer === "url-webview") return convertURL(viewURL);
    return convertURLForInternalOrigin(viewURL, viewURL);
  }

  private convertIframeNavigationURL(url: string): string {
    if (this._artifact?.kind === "url" && isTvArtifact(this._artifact.url) && isTvArtifact(url)) {
      return convertURL(url);
    }
    return convertURLForInternalOrigin(
      url,
      this._viewURL ?? this._navigationCanonicalURL ?? null,
    );
  }

  private handleWebviewNavigationEvent(event: Event): boolean {
    const url = (event as Event & { url?: unknown }).url;
    if (typeof url !== "string") return false;
    if (!isWebNavigationURL(url, window.location.href)) return false;
    this.syncNavigationState();
    const state = this._navigationState;
    if (!state) return false;

    const converted = convertURL(url);
    if (converted === state.currentURL) return false;
    state.navigate(converted);
    return true;
  }

  private readonly handleWebviewDidNavigate = (event: Event): void => {
    this.handleWebviewNavigationEvent(event);
  };

  private readonly handleWebviewDidNavigateInPage = (event: Event): void => {
    const navigation = event as Event & { isMainFrame?: unknown };
    if (navigation.isMainFrame === false) return;
    this._preserveFrameSrcOnNavigationRender = true;
    const changed = this.handleWebviewNavigationEvent(event);
    if (!changed) {
      this._preserveFrameSrcOnNavigationRender = false;
    }
  };

  private syncWebviewSubscription(currentFrame: HTMLElement | null = this.currentFrame): void {
    const webview = currentFrame?.tagName.toLowerCase() === "webview" ? currentFrame : null;
    if (webview === this._subscribedWebview) return;
    this.unsubscribeFromWebview();
    if (webview) {
      webview.addEventListener("did-navigate", this.handleWebviewDidNavigate);
      webview.addEventListener("did-navigate-in-page", this.handleWebviewDidNavigateInPage);
      this._subscribedWebview = webview;
    }
  }

  private unsubscribeFromWebview(): void {
    if (this._subscribedWebview) {
      this._subscribedWebview.removeEventListener("did-navigate", this.handleWebviewDidNavigate);
      this._subscribedWebview.removeEventListener(
        "did-navigate-in-page",
        this.handleWebviewDidNavigateInPage,
      );
      this._subscribedWebview = null;
    }
  }

  private get currentFrame(): HTMLElement | null {
    return this._documentHost?.currentFrame ?? null;
  }

  private readonly captureDocumentHost = (host: ArtifactDocumentHost): void => {
    this._documentHost = host;
    if (this._pendingDocumentSource) {
      host.assignSource(this._pendingDocumentSource);
      this.syncFrameSubscriptions();
    }
  };

  private readonly handleEmbedLoadChange = (loaded: boolean): void => {
    this._rootRef.value?.toggleAttribute("data-embed-loaded", loaded);
  };

  private readonly handleDocumentFrameChange = (frame: HTMLElement | null): void => {
    if (frame === null) this.resetTrustedFrame();
    this.syncFrameTitle(frame);
    this._trustedChannel.setCurrentFrame(this.bridgeFrame(frame));
    this.syncWebviewSubscription(frame);
  };

  private syncFrameSubscriptions(): void {
    const frame = this.currentFrame;
    this.syncFrameTitle(frame);
    this._trustedChannel.setCurrentFrame(this.bridgeFrame(frame));
    this.syncWebviewSubscription(frame);
  }

  /**
   * A demo-mode page is not a bridge participant
   * (specs/arch/artifact-frame/artifact-bridge.md#^ab-demo-frame-inert): the
   * channel is given no frame, so no message from it is accepted.
   */
  private bridgeFrame(frame: HTMLElement | null): HTMLElement | null {
    return this.isDemoPage() ? null : frame;
  }

  private get browserDemo(): boolean {
    return this._application?.browserDemoMode === true;
  }

  /** An external page artifact a browser shows under browser demo mode. */
  private isDemoPage(): boolean {
    const artifact = this._artifact;
    if (!artifact) return false;
    return artifactRenderRoute(artifact, {
      electron: isElectronMode(),
      browserDemo: this.browserDemo,
    }).renderer === "url-direct";
  }

  private returnToOriginalPage(): void {
    const artifact = this._artifact;
    const frame = this.currentFrame;
    if (artifact?.kind !== "url" || frame?.tagName.toLowerCase() !== "iframe") return;
    this._rootRef.value?.removeAttribute("data-embed-loaded");
    this._documentHost?.assignFrameSrc(artifact.url);
    this._documentHost?.refreshFrameLoadState();
  }

  private syncFrameTitle(frame: HTMLElement | null): void {
    if (frame && this._artifact && frame.getAttribute("title") !== this._artifact.title) {
      frame.setAttribute("title", this._artifact.title);
    }
  }

  private resetTrustedFrame(): void {
    this._missingArtifactReplyTransport = null;
    this._trustedChannel.reset();
  }

  private assignDocumentSource(
    options: { preserveFrameSrc?: boolean; frameSrcOverride?: string | null; resetTrust?: boolean } = {},
  ): void {
    const artifact = this._artifact;
    if (!artifact) return;
    if (options.resetTrust) this.resetTrustedFrame();

    const sourceBase: ArtifactDocumentSource = {
      artifact,
      application: this._application,
      electron: isElectronMode(),
      browserDemo: this.browserDemo,
      viewURL: this._viewURL,
      contentURL: this._contentURL,
      currentURL: this._navigationState?.currentURL ?? null,
    };
    const route = artifactDocumentRoute(sourceBase);
    const existingFrameSrc = this.currentFrame?.getAttribute("src");
    let activeReloadSrc: string | null = null;
    if (this._activeReloadFrameSrc) {
      if (sameLogicalDocumentURL(this._activeReloadFrameSrc, route.viewURL)) {
        activeReloadSrc = this._activeReloadFrameSrc;
      } else {
        this._activeReloadFrameSrc = null;
      }
    }

    const viewURL = options.frameSrcOverride ??
      activeReloadSrc ??
      (options.preserveFrameSrc && existingFrameSrc ? existingFrameSrc : route.viewURL);
    const source: ArtifactDocumentSource = {
      ...sourceBase,
      frameSrcOverride: viewURL,
    };
    this._pendingDocumentSource = source;
    this._documentHost?.assignSource(source);
    this.syncFrameSubscriptions();
  }

  private reloadProxyFrame(): void {
    const frame = this.currentFrame;
    if (!frame || frame.hasAttribute("data-content-url")) return;
    if (frame.tagName.toLowerCase() === "webview" && !(this._artifact?.kind === "path" || (this._artifact?.kind === "url" && isTvArtifact(this._artifact.url)))) return;
    const src = this._artifact?.kind === "url" && isTvArtifact(this._artifact.url)
      ? (this._navigationState?.currentURL ?? frame.getAttribute("src"))
      : frame.getAttribute("src");
    if (src === null) return;
    const next = new URL(src, window.location.href);
    next.searchParams.set(PROXY_RELOAD_PARAM, String(++this._proxyReloadVersion));
    const nextSrc = src.startsWith("/") ? `${next.pathname}${next.search}${next.hash}` : next.href;
    this._activeReloadFrameSrc = nextSrc;
    this._rootRef.value?.removeAttribute("data-embed-loaded");
    this.renderArtifact({ frameSrcOverride: nextSrc, resetTrust: true });
  }

  private forceCurrentFrameSrc(): void {
    if (!this._artifact) return;
    const route = artifactDocumentRoute({
      artifact: this._artifact,
      application: this._application,
      electron: isElectronMode(),
      browserDemo: this.browserDemo,
      viewURL: this._viewURL,
      contentURL: this._contentURL,
      currentURL: this._navigationState?.currentURL ?? null,
    });
    if (route.renderer === "url-webview") return;
    const currentFrame = this.currentFrame;
    const frame = currentFrame?.tagName.toLowerCase() === "iframe"
      ? currentFrame as HTMLIFrameElement
      : null;
    if (!frame) return;
    this.resetTrustedFrame();
    this._activeReloadFrameSrc = null;
    this._rootRef.value?.removeAttribute("data-embed-loaded");
    this._documentHost?.assignFrameSrc(route.viewURL);
    this._documentHost?.refreshFrameLoadState();
  }

  private menuEntries(): readonly MenuEntry[] {
    return [
      {
        label: this._fullScreen ? "Exit full-screen" : "Make full-screen",
        action: () => this.requestFullScreen(!this._fullScreen),
      },
      { separator: true },
      {
        label: "Delete",
        destructive: true,
        action: () => this.showDeleteConfirmation(),
      },
    ];
  }

  private closeMenu(): void {
    const root = this._rootRef.value;
    const trigger = root?.querySelector<HTMLButtonElement>(".artifact-menu-trigger");
    if (trigger) root?.ownerDocument.querySelector<HTMLElement>(`tv-menu[trigger="${trigger.id}"]`)?.removeAttribute("open");
  }

  private requestFullScreen(fullScreen: boolean): void {
    this.closeMenu();
    this._onFullScreenChange(fullScreen);
  }

  private readonly handleTitleBarDoubleClick = (event: MouseEvent): void => {
    const target = event.target;
    if (target instanceof Element && target.closest("button")) return;
    this.requestFullScreen(!this._fullScreen);
  };

  private showDeleteConfirmation(): void {
    if (this._deleteConfirmationOpen) return;
    this.closeMenu();
    this._deleteConfirmationOpen = true;
    this.renderArtifact({ preserveFrameSrc: true });
    const dialog = this._rootRef.value?.querySelector<HTMLDialogElement>("dialog");
    if (!dialog) return;
    this._dialogPresentation = presentDialog(dialog, () => this.dismissDeleteConfirmation());
    this._rootRef.value?.querySelector<HTMLButtonElement>(".dialog-actions button")?.focus();
  }

  private dismissDeleteConfirmation(): void {
    const presentation = this._dialogPresentation;
    this._dialogPresentation = null;
    this._deleteConfirmationOpen = false;
    presentation?.withdraw();
    if (this.isConnected && this._artifact) this.renderArtifact({ preserveFrameSrc: true });
  }

  private confirmDelete(): void {
    const artifactID = this._artifact?.id;
    const application = this._application;
    this.dismissDeleteConfirmation();
    if (!artifactID || !application) return;
    void application.deleteArtifact(artifactID).catch(() => {});
  }

  private artifactIconTemplate() {
    if (!this.isDemoPage()) return html`<tv-icon name="artifact"></tv-icon>`;
    return html`
      <button
        icon
        size="sm"
        variant="ghost"
        class="artifact-return"
        @click=${() => this.returnToOriginalPage()}
        aria-label="Return to the original page"
      >
        <tv-icon name="artifact"></tv-icon>
      </button>
    `;
  }

  private navigationControlsTemplate() {
    const state = this._navigationState;
    if (!state || (!state.canGoBack && !state.canGoForward)) return null;
    return html`
      <button
        icon
        size="sm"
        variant="ghost"
        class="artifact-back"
        ?disabled=${!state.canGoBack}
        @click=${() => state.back()}
        aria-label="Back"
      >
        <tv-icon name="back" size="sm"></tv-icon>
      </button>
      <button
        icon
        size="sm"
        variant="ghost"
        class="artifact-forward"
        ?disabled=${!state.canGoForward}
        @click=${() => state.forward()}
        aria-label="Forward"
      >
        <tv-icon name="forward" size="sm"></tv-icon>
      </button>
      <span class="artifact-bar-divider" aria-hidden="true"></span>
    `;
  }

  private deleteConfirmationTemplate() {
    if (!this._deleteConfirmationOpen || !this._artifact) return null;
    return dialogTemplate(html`
      <div class="dialog-alert" role="alertdialog">
        <h2>Delete “${this._artifact.title}”?</h2>
        <p>It’s removed from this channel; the file or web page it points to is not deleted.</p>
        <div class="dialog-actions">
          <button @click=${() => this.dismissDeleteConfirmation()}>Cancel</button>
          <button intent="danger" @click=${() => this.confirmDelete()}>Delete</button>
        </div>
      </div>
    `);
  }

  template(
    _application: ApplicationService,
    _artifact: Artifact,
    _options: ArtifactViewOptions,
  ): TemplateResult {
    const artifact = this._artifact!;

    return html`
      <div
        class="artifact-view artifact-frame"
        kind=${artifact.kind}
        ?full-screen=${this._fullScreen}
        ?inert=${this._inert}
        ._trustedChannel=${this._trustedChannel}
        ${ref(this._rootRef)}
      >
        <div class="artifact-frame-clip">
          ${ArtifactDocumentHostView(
            this.captureDocumentHost,
            this.handleEmbedLoadChange,
            this.handleDocumentFrameChange,
          )}
          <footer class="artifact-title-bar" @dblclick=${this.handleTitleBarDoubleClick}>
            ${this.artifactIconTemplate()}
            <span class="artifact-title">${artifact.title}</span>
            ${this.navigationControlsTemplate()}
            ${MenuView(this.menuEntries(), {
              trigger: (id) => html`
                <button
                  icon
                  size="sm"
                  variant="ghost"
                  class="artifact-menu-trigger"
                  id=${id}
                  aria-label=${`${artifact.title} menu`}
                >
                  <tv-icon name="expand"></tv-icon>
                </button>
              `,
            })}
          </footer>
        </div>
        ${this.deleteConfirmationTemplate()}
      </div>
    `;
  }

  private renderArtifact(
    options: {
      preserveFrameSrc?: boolean;
      forceFrameSrc?: boolean;
      frameSrcOverride?: string | null;
      resetTrust?: boolean;
    } = {},
  ): void {
    if (!this._artifact) return;
    this.assignDocumentSource({
      preserveFrameSrc: options.preserveFrameSrc ?? false,
      frameSrcOverride: options.frameSrcOverride,
      resetTrust: options.resetTrust,
    });
    this.render();
    if (options.forceFrameSrc) this.forceCurrentFrameSrc();
    this.syncFrameSubscriptions();
  }
}

export const ArtifactViewView = view(ArtifactView);

function isExternalURL(url: string): boolean {
  return url.startsWith("http://") || url.startsWith("https://");
}

/** Passes an artifact's application link to the desktop main process through the window's native preload bridge. */
function openApplicationLinkThroughShell(url: string): void {
  const nativeBridge = (globalThis as typeof globalThis & {
    __televisionNativeBridge?: { openApplicationLink?: (url: string) => void };
  }).__televisionNativeBridge;
  nativeBridge?.openApplicationLink?.(url);
}

function sameArtifactDocument(left: Artifact, right: Artifact): boolean {
  if (left.id !== right.id || left.kind !== right.kind) return false;
  if (left.kind === "path" && right.kind === "path") return left.path === right.path;
  if (left.kind === "url" && right.kind === "url") {
    return sameLogicalDocumentURL(left.url, right.url);
  }
  return true;
}

function changedMissingArtifactMetadata(left: Artifact, right: Artifact): boolean {
  return left.kind === "path" &&
    right.kind === "path" &&
    left.id === right.id &&
    (left.title !== right.title || left.path !== right.path);
}

function sameLogicalDocumentURL(left: string, right: string): boolean {
  try {
    const parsedLeft = new URL(left, window.location.href);
    const parsedRight = new URL(right, window.location.href);
    parsedLeft.searchParams.delete(PROXY_RELOAD_PARAM);
    parsedRight.searchParams.delete(PROXY_RELOAD_PARAM);
    return parsedLeft.origin === parsedRight.origin &&
      parsedLeft.pathname === parsedRight.pathname &&
      parsedLeft.search === parsedRight.search;
  } catch {
    return false;
  }
}

export function convertURLForInternalOrigin(url: string, internalURL: string | null): string {
  try {
    const parsed = new URL(url, window.location.href);
    if (internalURL) {
      const internal = new URL(internalURL, window.location.href);
      if (parsed.origin !== "null" && parsed.origin === internal.origin) {
        parsed.searchParams.delete(PROXY_RELOAD_PARAM);
        return `${parsed.pathname}${parsed.search}${parsed.hash}`;
      }
    }
  } catch {
    return convertURL(url);
  }
  return convertURL(url);
}

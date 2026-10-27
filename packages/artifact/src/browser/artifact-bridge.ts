/**
 * Artifact iframe bridge: reports document lifecycle, navigation, and
 * freshness across the iframe boundary, and exports the wire contract.
 *
 * Installed inside an artifact iframe by `installBridge(window)`. The
 * function body is intentionally self-contained — no module-scope
 * imports, type guards, or closures — so `bridgeScriptSource()` can
 * serialise it via `.toString()` for server-side injection into
 * proxy-served HTML responses.
 */

import { installAppearanceResolver } from "./appearance-resolver.ts";

// -----------------------------------------------------------------------------
// Wire messages
// -----------------------------------------------------------------------------

export const URL_TARGET_REQUEST_MESSAGE_TYPE = "url-target-request";
export const URL_TARGET_MESSAGE_TYPE = "url-target";
export const ARTIFACT_MISSING_REQUEST_MESSAGE_TYPE = "artifact-missing-request";
export const ARTIFACT_MISSING_MESSAGE_TYPE = "artifact-missing";
export const PROXY_CONTENT_CHANGED_MESSAGE_TYPE = "proxy-content-changed";
export const BRIDGE_READY_MESSAGE_TYPE = "bridge-ready";
export const BRIDGE_LEAVING_MESSAGE_TYPE = "leaving";
export const ARTIFACT_POINTER_MESSAGE_TYPE = "artifact-pointer";

export type BridgeDocumentGuid = string;

/**
 * View → host URL-target request. Emitted by the browser URL-unsupported view
 * so the host can provide the external URL without putting it in the iframe
 * `src`.
 */
export interface URLTargetRequest {
  type: typeof URL_TARGET_REQUEST_MESSAGE_TYPE;
}

/**
 * Host → view URL-target notification. Carries the current external URL when
 * known, or `null` when the host has no external URL for this iframe.
 */
export interface URLTargetNotification {
  type: typeof URL_TARGET_MESSAGE_TYPE;
  url: string | null;
}

/**
 * View → host missing-artifact request. Emitted by the bundled artifact-missing
 * view so the host can provide registry metadata without putting it in the
 * iframe URL or server-rendered HTML.
 */
export interface ArtifactMissingRequest {
  type: typeof ARTIFACT_MISSING_REQUEST_MESSAGE_TYPE;
}

/**
 * Host → view missing-artifact notification. Carries display metadata for a
 * missing path artifact.
 */
export interface ArtifactMissingNotification {
  type: typeof ARTIFACT_MISSING_MESSAGE_TYPE;
  title: string;
  path: string;
}

/**
 * View → host content-change notification. Emitted by the in-iframe proxy
 * poller when the proxied artifact's ETag changes.
 */
export interface ProxyContentChangedNotification {
  type: typeof PROXY_CONTENT_CHANGED_MESSAGE_TYPE;
}

/**
 * View → host readiness notification. Emitted after the bridge is installed in
 * the current embedded document.
 */
export interface BridgeReadyNotification {
  type: typeof BRIDGE_READY_MESSAGE_TYPE;
  guid: BridgeDocumentGuid;
}

/**
 * View → host lifecycle notification. Emitted when the current embedded
 * document is leaving so the host can stop trusting that document instance.
 */
export interface BridgeLeavingNotification {
  type: typeof BRIDGE_LEAVING_MESSAGE_TYPE;
  guid: BridgeDocumentGuid;
}

/**
 * View → host navigation request. Emitted by bridge navigation interception
 * when an artifact document wants the host-managed frame history to move.
 */
export interface NavigationRequestNotification {
  type: "navigation-request";
  url: string;
  replace?: boolean;
  sameDocument?: boolean;
  native?: boolean;
}

/**
 * View → host navigation-key notification. Carries the physical arrow value;
 * the host owns its application-level meaning.
 */
export type NavigationKey = "ArrowLeft" | "ArrowRight" | "ArrowUp" | "ArrowDown";

export interface NavigationKeyNotification {
  type: "navigation-key";
  key: NavigationKey;
}

export type ArtifactPointerEventType =
  | "pointermove"
  | "pointerdown"
  | "pointerup"
  | "pointercancel"
  | "click";

/**
 * View → host pointer notification. Coordinates are CSS pixels in the artifact
 * document's viewport; the host maps them into its application viewport.
 */
export interface ArtifactPointerNotification {
  type: typeof ARTIFACT_POINTER_MESSAGE_TYPE;
  eventType: ArtifactPointerEventType;
  clientX: number;
  clientY: number;
  button: number;
  buttons: number;
}

/** The keyboard fields used by the platform navigation-chord predicate. */
export interface NavigationKeyChordInput {
  readonly key: string;
  readonly altKey: boolean;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly shiftKey: boolean;
  readonly isComposing: boolean;
  readonly repeat: boolean;
}

/**
 * Matches the browser and Electron navigation chord without assigning an
 * application meaning to the physical arrow. `platform` accepts browser
 * platform identities (for example `MacIntel`, `Win32`, and `Linux x86_64`)
 * and Node's `darwin` identity.
 */
export function isNavigationKeyChord(
  input: NavigationKeyChordInput,
  platform: string,
): input is NavigationKeyChordInput & { readonly key: NavigationKey } {
  const arrow = input.key === "ArrowLeft" ||
    input.key === "ArrowRight" ||
    input.key === "ArrowUp" ||
    input.key === "ArrowDown";
  if (!arrow || input.isComposing || input.metaKey || input.shiftKey) return false;

  const macOS = platform === "darwin" || /^(Mac|iPhone|iPad|iPod)/i.test(platform);
  return macOS
    ? input.altKey && !input.ctrlKey
    : input.ctrlKey && !input.altKey;
}

/**
 * Bridge messages exchanged between the iframe and its host. Internal
 * to the bridge — the v1 content protocol in
 * `../artifact-view-protocol.ts` is a separate union.
 */
export type BridgeMessage =
  | URLTargetRequest
  | URLTargetNotification
  | ArtifactMissingRequest
  | ArtifactMissingNotification
  | ProxyContentChangedNotification
  | BridgeReadyNotification
  | BridgeLeavingNotification
  | NavigationRequestNotification
  | NavigationKeyNotification
  | ArtifactPointerNotification;

// -----------------------------------------------------------------------------
// Type guards
// -----------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function isURLTargetRequest(value: unknown): value is URLTargetRequest {
  if (!isRecord(value)) return false;
  if (value.type !== URL_TARGET_REQUEST_MESSAGE_TYPE) return false;
  return !("id" in value);
}

export function isURLTargetNotification(value: unknown): value is URLTargetNotification {
  if (!isRecord(value)) return false;
  if (value.type !== URL_TARGET_MESSAGE_TYPE) return false;
  if (typeof value.url !== "string" && value.url !== null) return false;
  return !("id" in value);
}

export function isArtifactMissingRequest(value: unknown): value is ArtifactMissingRequest {
  if (!isRecord(value)) return false;
  if (value.type !== ARTIFACT_MISSING_REQUEST_MESSAGE_TYPE) return false;
  return !("id" in value);
}

export function isArtifactMissingNotification(value: unknown): value is ArtifactMissingNotification {
  if (!isRecord(value)) return false;
  if (value.type !== ARTIFACT_MISSING_MESSAGE_TYPE) return false;
  if (typeof value.title !== "string") return false;
  if (typeof value.path !== "string") return false;
  return !("id" in value);
}

export function isProxyContentChangedNotification(value: unknown): value is ProxyContentChangedNotification {
  if (!isRecord(value)) return false;
  if (value.type !== PROXY_CONTENT_CHANGED_MESSAGE_TYPE) return false;
  return !("id" in value);
}

export function isBridgeReadyNotification(value: unknown): value is BridgeReadyNotification {
  if (!isRecord(value)) return false;
  if (value.type !== BRIDGE_READY_MESSAGE_TYPE) return false;
  if (typeof value.guid !== "string") return false;
  return !("id" in value);
}

export function isBridgeLeavingNotification(value: unknown): value is BridgeLeavingNotification {
  if (!isRecord(value)) return false;
  if (value.type !== BRIDGE_LEAVING_MESSAGE_TYPE) return false;
  if (typeof value.guid !== "string") return false;
  return !("id" in value);
}

export function isNavigationRequest(
  value: unknown,
): value is NavigationRequestNotification {
  if (!isRecord(value)) return false;
  if (value.type !== "navigation-request") return false;
  if (typeof value.url !== "string") return false;
  if ("replace" in value && typeof value.replace !== "boolean") return false;
  if ("sameDocument" in value && typeof value.sameDocument !== "boolean") {
    return false;
  }
  if ("native" in value && typeof value.native !== "boolean") return false;
  return !("id" in value);
}

export function isNavigationKeyNotification(value: unknown): value is NavigationKeyNotification {
  if (!isRecord(value)) return false;
  if (value.type !== "navigation-key") return false;
  if (
    value.key !== "ArrowLeft" &&
    value.key !== "ArrowRight" &&
    value.key !== "ArrowUp" &&
    value.key !== "ArrowDown"
  ) {
    return false;
  }
  return !("id" in value);
}

export function isArtifactPointerNotification(
  value: unknown,
): value is ArtifactPointerNotification {
  if (!isRecord(value)) return false;
  if (value.type !== ARTIFACT_POINTER_MESSAGE_TYPE) return false;
  if (
    value.eventType !== "pointermove" &&
    value.eventType !== "pointerdown" &&
    value.eventType !== "pointerup" &&
    value.eventType !== "pointercancel" &&
    value.eventType !== "click"
  ) {
    return false;
  }
  if (typeof value.clientX !== "number" || !Number.isFinite(value.clientX)) return false;
  if (typeof value.clientY !== "number" || !Number.isFinite(value.clientY)) return false;
  if (typeof value.button !== "number" || !Number.isFinite(value.button)) return false;
  if (typeof value.buttons !== "number" || !Number.isFinite(value.buttons)) return false;
  return !("id" in value);
}

// -----------------------------------------------------------------------------
// In-iframe bridge installer
// -----------------------------------------------------------------------------

/**
 * Installs the browser artifact bridge inside `win`.
 *
 * Self-contained on purpose: the function body MUST NOT reference
 * module-scope imports, type guards, or closures. That constraint lets
 * `bridgeScriptSource()` serialise the function via `.toString()` for
 * host-side injection.
 *
 * Idempotent: calling it more than once on the same window installs the
 * bridge once, so lifecycle and navigation reports are not duplicated.
 *
 * In a top-level Electron webview, returns without posting lifecycle messages;
 * the Electron preload is the single lifecycle authority there.
 */
export interface ArtifactPollCadence {
  normalMs: number;
  slowMs: number;
}

export interface InstallBridgeOptions {
  reportNavigation?: boolean;
  /** Test-only scheduling override; production callers omit it. */
  pollCadence?: ArtifactPollCadence;
}

export function installBridge(win: Window = window, options: InstallBridgeOptions = {}): void {
  const bridgeWindow = win as Window & {
    __televisionArtifactBridgeInstalled?: boolean;
  };
  if (win.parent === win) {
    return;
  }
  if (bridgeWindow.__televisionArtifactBridgeInstalled === true) {
    return;
  }
  bridgeWindow.__televisionArtifactBridgeInstalled = true;

  const makeBridgeGuid = (): string => {
    const GUID_RADIX = 36;
    const GUID_WORD_COUNT = 4;
    const now = Date.now().toString(GUID_RADIX);
    try {
      const cryptoLike = win.crypto;
      if (cryptoLike && typeof cryptoLike.getRandomValues === "function") {
        const values = new Uint32Array(GUID_WORD_COUNT);
        cryptoLike.getRandomValues(values);
        return `tvb-${now}-${Array.from(values, (value) => value.toString(GUID_RADIX)).join("-")}`;
      }
    } catch {
      // Fall through to the non-cryptographic fallback below.
    }
    return `tvb-${now}-${Math.random().toString(GUID_RADIX).slice(2)}-${Math.random().toString(GUID_RADIX).slice(2)}`;
  };

  const documentGuid = makeBridgeGuid();
  const postBridgeReady = () => {
    win.parent.postMessage({ type: "bridge-ready", guid: documentGuid }, "*");
  };

  win.addEventListener("pagehide", () => {
    win.parent.postMessage({ type: "leaving", guid: documentGuid }, "*");
  });
  win.addEventListener("pageshow", (event) => {
    if ((event as PageTransitionEvent).persisted === true) {
      postBridgeReady();
    }
  });

  // Deliberate local copy of isNavigationKeyChord. installBridge is
  // .toString()-serialized for proxy injection and cannot reference module
  // scope. The browser contract runs the same matrix against both copies.
  win.addEventListener("keydown", (event) => {
    const keyboard = event as KeyboardEvent;
    const arrow = keyboard.key === "ArrowLeft" ||
      keyboard.key === "ArrowRight" ||
      keyboard.key === "ArrowUp" ||
      keyboard.key === "ArrowDown";
    const platform = win.navigator.platform;
    const macOS = platform === "darwin" || /^(Mac|iPhone|iPad|iPod)/i.test(platform);
    const modifiersMatch = macOS
      ? keyboard.altKey && !keyboard.ctrlKey && !keyboard.metaKey && !keyboard.shiftKey
      : keyboard.ctrlKey && !keyboard.altKey && !keyboard.metaKey && !keyboard.shiftKey;
    if (!arrow || keyboard.isComposing || !modifiersMatch) return;

    keyboard.preventDefault();
    win.parent.postMessage({ type: "navigation-key", key: keyboard.key }, "*");
  }, true);

  const pointerEventTypes = [
    "pointermove",
    "pointerdown",
    "pointerup",
    "pointercancel",
    "click",
  ] as const;
  for (const eventType of pointerEventTypes) {
    win.addEventListener(eventType, (event) => {
      const pointer = event as PointerEvent | MouseEvent;
      if (!pointer.isTrusted) return;
      win.parent.postMessage({
        type: "artifact-pointer",
        eventType,
        clientX: pointer.clientX,
        clientY: pointer.clientY,
        button: pointer.button,
        buttons: pointer.buttons,
      }, "*");
    }, true);
  }

  const capturedURL = win.location.href;
  // Inlined copy of isTvArtifact from packages/artifact/src/model.ts. This is
  // deliberately NOT DRY: the bridge is .toString()-serialized for proxy injection
  // and cannot import it.
  // Keep this regex in sync with the canonical predicate and the preload copy in
  // packages/desktop/src/webview-bridge-preload.ts.
  const isTvArtifactURL = (url: string): boolean => {
    try {
      const parsed = new URL(url);
      return /^\/artifact\/[0-9A-Za-z]{26}(\/|$)/.test(parsed.pathname);
    } catch {
      return false;
    }
  };
  if (isTvArtifactURL(capturedURL) && typeof win.fetch === "function") {
    // Deliberate non-DRY duplicate of the preload poll loop in
    // packages/desktop/src/webview-bridge-preload.ts. Keep behavior identical;
    // the two-loop parity test guards this.
    const PRODUCTION_NORMAL_POLL_MS = 5000;
    const PRODUCTION_SLOW_POLL_MS = 15000;
    const cadence = options.pollCadence;
    const validCadence = cadence !== undefined
      && Number.isFinite(cadence.normalMs)
      && cadence.normalMs > 0
      && Number.isFinite(cadence.slowMs)
      && cadence.slowMs >= cadence.normalMs
      ? cadence
      : null;
    const NORMAL_POLL_MS = validCadence?.normalMs ?? PRODUCTION_NORMAL_POLL_MS;
    const SLOW_POLL_MS = validCadence?.slowMs ?? PRODUCTION_SLOW_POLL_MS;
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
        win.clearTimeout(queuedTimer);
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
        const AbortControllerConstructor = (win as Window & {
          AbortController?: typeof AbortController;
        }).AbortController;
        const abortController = typeof AbortControllerConstructor === "function"
          ? new AbortControllerConstructor()
          : null;
        activeAbortController = abortController;
        void (async () => {
          try {
            const response = await win.fetch(capturedURL, {
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
              win.parent.postMessage({ type: "proxy-content-changed" }, "*");
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
              queuedTimer = win.setTimeout(poll, delayMs);
            }
          }
        })();
      };
      poll();
    };

    win.addEventListener("pagehide", stopPollLoop);
    win.addEventListener("pageshow", (event) => {
      if ((event as PageTransitionEvent).persisted === true) {
        startPollLoop();
      }
    });
    startPollLoop();
  }

  if (options.reportNavigation !== false) {
    // Deliberate local copy of link-target.ts's browser-local protocols.
    // installBridge is serialized; the classifier parity test guards both copies.
    const browserLocalProtocols = new Set([
      "about:",
      "blob:",
      "chrome-extension:",
      "chrome:",
      "data:",
      "devtools:",
      "file:",
      "filesystem:",
      "javascript:",
      "view-source:",
    ]);
    const applicationNavigationURL = (value: string, baseURL: string): URL | null => {
      try {
        const parsed = new URL(value, baseURL);
        if (parsed.protocol === "http:" || parsed.protocol === "https:") return null;
        return browserLocalProtocols.has(parsed.protocol) ? null : parsed;
      } catch {
        return null;
      }
    };
    const webNavigationURL = (value: string, baseURL: string): URL | null => {
      try {
        const parsed = new URL(value, baseURL);
        return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed : null;
      } catch {
        return null;
      }
    };

    // Another browsing context or a download has no useful meaning for an
    // application handoff. Collapse those dispositions to the native
    // same-context navigation used by a plain custom-scheme anchor.
    const handleApplicationAnchorActivation = (event: MouseEvent) => {
      const leftClick = event.type === "click" && event.button === 0;
      const middleClick = event.type === "auxclick" && event.button === 1;
      if (!leftClick && !middleClick) return;
      const elementConstructor = win.document.defaultView?.Element;
      if (!elementConstructor || !(event.target instanceof elementConstructor)) return;
      const anchor = event.target.closest("a[href]") as HTMLAnchorElement | null;
      if (!anchor) return;
      const url = applicationNavigationURL(anchor.href, win.document.baseURI);
      if (!url) return;
      const target = anchor.target.toLowerCase();
      const requestsAnotherContext = middleClick || event.metaKey || event.ctrlKey ||
        event.shiftKey || event.altKey || (target !== "" && target !== "_self");
      if (!requestsAnotherContext && !anchor.hasAttribute("download")) return;

      event.preventDefault();
      win.location.href = url.href;
    };
    win.document.addEventListener("click", handleApplicationAnchorActivation, true);
    win.document.addEventListener("auxclick", handleApplicationAnchorActivation, true);
    const postNavigationRequest = (message: {
      url: string;
      replace?: boolean;
      sameDocument?: boolean;
      native?: boolean;
    }) => {
      win.parent.postMessage({ type: "navigation-request", ...message }, "*");
    };

    postNavigationRequest({ url: win.location.href });

    // The Navigation API's entries and events are disabled in a document
    // with an opaque origin, as every sandboxed artifact document has, so
    // the fallback records there too.
    const navigation = (win as Window & { navigation?: EventTarget & { currentEntry?: unknown } }).navigation;
    if (navigation && navigation.currentEntry !== null) {
      navigation.addEventListener("navigate", (event) => {
        const navigateEvent = event as Event & {
          destination?: { url?: string; sameDocument?: boolean };
          navigationType?: string;
          preventDefault: () => void;
        };
        const url = navigateEvent.destination?.url;
        if (typeof url !== "string") return;
        const parsedURL = webNavigationURL(url, win.location.href);
        if (!parsedURL) return;
        const sameDocument = navigateEvent.destination?.sameDocument === true;
        const message = {
          url,
          ...(navigateEvent.navigationType === "replace" ? { replace: true } : {}),
          ...(sameDocument ? { sameDocument: true } : {}),
        };
        if (sameDocument) {
          postNavigationRequest(message);
          return;
        }
        if (parsedURL.origin === win.location.origin) {
          postNavigationRequest({ ...message, native: true });
          return;
        }
        const canIntercept = (navigateEvent as unknown as { canIntercept?: boolean }).canIntercept;
        if (canIntercept !== false) {
          navigateEvent.preventDefault();
        }
        postNavigationRequest(message);
      });
    } else {
      // The fallback acts on a click or submission only after every page
      // handler has run, wherever and whenever it was registered, and only
      // when none cancelled it. A window listener added while the event is
      // captured runs after every other listener of the window's bubble phase.
      const afterPageHandlers = (type: "click" | "submit", act: (event: Event) => void) => {
        let pending: ((event: Event) => void) | null = null;
        win.addEventListener(
          type,
          (captured) => {
            if (pending) win.removeEventListener(type, pending);
            const settle = (event: Event) => {
              if (event !== captured) return;
              win.removeEventListener(type, settle);
              pending = null;
              if (!event.defaultPrevented) act(event);
            };
            pending = settle;
            win.addEventListener(type, settle);
          },
          true,
        );
      };

      afterPageHandlers("click", (event) => {
        const mouse = event as MouseEvent;
        // Modifier-clicks are intentionally left to browser defaults instead
        // of being intercepted into host-managed artifact history. Cmd/Ctrl
        // opens a new tab, Shift opens a new window, and middle-click/auxclick
        // is not handled by this click listener so the browser can open a
        // background tab. In Electron those default window-open paths are
        // routed by setWindowOpenHandler to shell.openExternal.
        if (mouse.metaKey || mouse.ctrlKey || mouse.shiftKey || mouse.altKey) return;
        const elementConstructor = win.document.defaultView?.Element;
        if (!elementConstructor || !(mouse.target instanceof elementConstructor)) return;
        const anchor = mouse.target.closest("a[href]") as HTMLAnchorElement | null;
        if (!anchor) return;
        if (anchor.target && anchor.target.toLowerCase() !== "_self") return;
        if (anchor.hasAttribute("download")) return;
        const href = anchor.getAttribute("href");
        if (!href) return;
        const url = webNavigationURL(anchor.href, win.document.baseURI);
        if (!url) return;
        if (
          url.origin === win.location.origin &&
          url.pathname === win.location.pathname &&
          url.search === win.location.search &&
          url.hash !== ""
        ) {
          postNavigationRequest({ url: url.href, sameDocument: true });
          return;
        }
        mouse.preventDefault();
        postNavigationRequest({ url: url.href });
      });

      const originalPushState = win.history.pushState.bind(win.history);
      const originalReplaceState = win.history.replaceState.bind(win.history);
      win.history.pushState = function pushState(...args) {
        originalPushState(...args);
        postNavigationRequest({ url: win.location.href, sameDocument: true });
      };
      win.history.replaceState = function replaceState(...args) {
        originalReplaceState(...args);
        postNavigationRequest({ url: win.location.href, replace: true, sameDocument: true });
      };

      win.addEventListener("popstate", () => {
        postNavigationRequest({ url: win.location.href, sameDocument: true });
      });
      win.addEventListener("hashchange", () => {
        postNavigationRequest({ url: win.location.href, sameDocument: true });
      });

      // Only a GET submission to the frame itself is recorded; the browser
      // performs every other, such as a POST or dialog submission or one to
      // another browsing context. The submit button's formaction, formmethod,
      // formtarget and value apply as the browser applies them. The form's
      // own action, method and target are read from its attributes, because
      // a control with one of those names hides the form's property of it.
      afterPageHandlers("submit", (event) => {
        const submit = event as SubmitEvent;
        const form = submit.target;
        const formConstructor = win.document.defaultView?.HTMLFormElement;
        if (!formConstructor || !(form instanceof formConstructor)) return;
        const submitter = submit.submitter ?? null;
        const override = (name: string) => (submitter?.hasAttribute(name) ? submitter.getAttribute(name) ?? "" : null);
        const target = override("formtarget") ?? form.getAttribute("target");
        if (target && target.toLowerCase() !== "_self") return;
        // A method the browser does not know means GET, as in the browser.
        const method = (override("formmethod") ?? form.getAttribute("method"))?.toLowerCase();
        if (method === "post" || method === "dialog") return;
        const action = webNavigationURL((override("formaction") ?? form.getAttribute("action")) || win.location.href, win.document.baseURI);
        if (!action) return;
        const formDataConstructor = win.document.defaultView?.FormData;
        if (!formDataConstructor) return;
        const params = new URLSearchParams();
        for (const [name, value] of new formDataConstructor(form, submitter)) {
          params.append(name, typeof value === "string" ? value : value.name);
        }
        action.search = params.toString();
        submit.preventDefault();
        postNavigationRequest({ url: action.href });
      });
    }
  }

  postBridgeReady();
}

/**
 * Returns the bridge as a self-executing IIFE source string, ready to
 * inject into a proxied HTML document as the content of a `<script>` tag.
 */
export function bridgeScriptSource(options: InstallBridgeOptions = {}): string {
  return `(function(){const __name=(target)=>target;(${installAppearanceResolver.toString()})("system",window);(${installBridge.toString()})(window,${JSON.stringify(options)});})();`;
}

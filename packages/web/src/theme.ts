import type { ThemeRegistrySnapshot } from "@telepath-computer/television-shared";

const THEME_RESOURCE_MARKER = "television-active-theme";
const THEME_REVISION_PARAMETER = "tv-theme";
let currentLink: HTMLLinkElement | null = null;
let currentScript: HTMLScriptElement | null = null;
let currentBackgroundFrame: HTMLIFrameElement | null = null;
let currentOverlayFrame: HTMLIFrameElement | null = null;
let lastApplicationFocus: HTMLElement | null = null;
let resourceRevision = 0;
let frameOperation = 0;

type ThemeFrameKind = "background" | "overlay";
type ThemeFrameAppearance = "light" | "dark";

type ThemeFramePointerMessage = {
  type:
    | "television-theme-pointer-move"
    | "television-theme-pointer-down"
    | "television-theme-pointer-up"
    | "television-theme-pointer-cancel"
    | "television-theme-pointer-click";
  clientX: number;
  clientY: number;
  button: number;
  buttons: number;
};

export interface ThemePointerInput {
  eventType: "pointermove" | "pointerdown" | "pointerup" | "pointercancel" | "click";
  clientX: number;
  clientY: number;
  button: number;
  buttons: number;
}

/**
 * Replace the application document's active-theme link with a fresh request.
 * A unique query prevents Firefox from reusing the prior link's stylesheet
 * without revalidating the stable route. Removing the previous node first
 * prevents its later load from becoming the current sheet. Appending the
 * replacement keeps the theme last in document stylesheet order.
 */
export function refreshThemeLink(serverURL: string): HTMLLinkElement {
  const link = document.createElement("link");
  const themeURL = new URL("/theme/theme.css", serverURL);
  themeURL.searchParams.set(THEME_REVISION_PARAMETER, nextThemeRevision());
  link.rel = "stylesheet";
  link.href = themeURL.toString();
  link.dataset.televisionStyle = THEME_RESOURCE_MARKER;

  const settled = () => {
    if (currentLink === link) {
      document.dispatchEvent(new Event("television-theme-styles-changed"));
    }
  };
  link.addEventListener("load", settled, { once: true });
  link.addEventListener("error", settled, { once: true });
  currentLink?.remove();
  document.head.append(link);
  currentLink = link;
  return link;
}

export function clearThemeLink(): void {
  if (!currentLink) return;
  currentLink.remove();
  currentLink = null;
  document.dispatchEvent(new Event("television-theme-styles-changed"));
}

export function getThemeLink(): HTMLLinkElement | null {
  return currentLink;
}

/**
 * Replace the application document's active-theme script with a fresh classic
 * external script. The public route applies the registered manifest gate, so
 * the application needs no second manifest model.
 */
export function refreshThemeScript(serverURL: string): HTMLScriptElement {
  const script = document.createElement("script");
  const themeURL = new URL("/theme/main.js", serverURL);
  themeURL.searchParams.set(THEME_REVISION_PARAMETER, nextThemeRevision());
  script.src = themeURL.toString();
  script.dataset.televisionScript = THEME_RESOURCE_MARKER;

  currentScript?.remove();
  document.head.append(script);
  currentScript = script;
  return script;
}

export function clearThemeScript(): void {
  currentScript?.remove();
  currentScript = null;
}

export function getThemeScript(): HTMLScriptElement | null {
  return currentScript;
}

/**
 * Destroy the current sandbox documents before resolving the active package's
 * registered frame declarations. Registry errors are intentionally contained:
 * the next resource refresh or reconnect performs the next lookup.
 */
export async function refreshThemeFrames(
  serverURL: string,
  activeThemeID: string | null,
  listThemes: () => Promise<ThemeRegistrySnapshot>,
): Promise<void> {
  const operation = invalidateAndRemoveThemeFrames();
  if (activeThemeID === null) return;

  let snapshot: ThemeRegistrySnapshot;
  try {
    snapshot = await listThemes();
  } catch {
    return;
  }
  if (operation !== frameOperation) return;

  const activeTheme = snapshot.themes.find((candidate) => candidate.id === activeThemeID);
  if (activeTheme === undefined) return;
  const applicationRoot = document.querySelector<HTMLElement>("#app");
  const foreground = document.querySelector<HTMLElement>("#foreground-overlay");
  if (applicationRoot === null || foreground === null) return;

  const background = activeTheme.enableIframeBackgroundJS === true
    ? createThemeFrame(serverURL, "background")
    : null;
  const overlay = activeTheme.enableIframeOverlayJS === true
    ? createThemeFrame(serverURL, "overlay")
    : null;

  if (operation !== frameOperation) return;
  if (background !== null) {
    applicationRoot.before(background);
    currentBackgroundFrame = background;
  }
  if (overlay !== null) {
    foreground.after(overlay);
    currentOverlayFrame = overlay;
  }
}

export function clearThemeFrames(): void {
  invalidateAndRemoveThemeFrames();
}

export function getThemeFrame(kind: ThemeFrameKind): HTMLIFrameElement | null {
  return kind === "background" ? currentBackgroundFrame : currentOverlayFrame;
}

function invalidateAndRemoveThemeFrames(): number {
  frameOperation += 1;
  currentBackgroundFrame?.remove();
  currentOverlayFrame?.remove();
  currentBackgroundFrame = null;
  currentOverlayFrame = null;
  return frameOperation;
}

function createThemeFrame(
  serverURL: string,
  kind: ThemeFrameKind,
): HTMLIFrameElement {
  const scriptURL = kind === "background"
    ? new URL("/theme/iframe-background.js", serverURL)
    : new URL("/theme/iframe-overlay.js", serverURL);
  scriptURL.searchParams.set(THEME_REVISION_PARAMETER, nextThemeRevision());

  const frame = document.createElement("iframe");
  frame.id = kind === "background"
    ? "theme-iframe-background"
    : "theme-iframe-overlay";
  frame.setAttribute("sandbox", "allow-scripts");
  frame.setAttribute("inert", "");
  frame.setAttribute("tabindex", "-1");
  frame.setAttribute("aria-hidden", "true");
  frame.srcdoc = themeFrameDocument(
    scriptURL.toString(),
    currentThemeFrameAppearance(),
  );
  return frame;
}

function currentThemeFrameAppearance(): ThemeFrameAppearance {
  const appearance = document.documentElement.dataset.theme;
  if (appearance !== "light" && appearance !== "dark") {
    throw new Error("Application root has no effective theme-frame appearance");
  }
  return appearance;
}

function themeFrameDocument(
  scriptURL: string,
  appearance: ThemeFrameAppearance,
): string {
  return `<!doctype html>
<html data-theme="${appearance}">
<head>
<meta charset="utf-8">
<style>
html, body {
  width: 100%;
  height: 100%;
  margin: 0;
  overflow: hidden;
  background: transparent;
  color-scheme: ${appearance};
}
</style>
</head>
<body>
<script src="${scriptURL}"></script>
</body>
</html>`;
}

export function forwardThemePointer(input: ThemePointerInput): void {
  let type: ThemeFramePointerMessage["type"];
  let button = input.button;
  let buttons = input.buttons;
  switch (input.eventType) {
    case "pointermove":
      type = "television-theme-pointer-move";
      button = -1;
      break;
    case "pointerdown":
      type = "television-theme-pointer-down";
      break;
    case "pointerup":
      type = "television-theme-pointer-up";
      break;
    case "pointercancel":
      type = "television-theme-pointer-cancel";
      button = -1;
      buttons = 0;
      break;
    case "click":
      type = "television-theme-pointer-click";
      buttons = 0;
      break;
  }

  const message: ThemeFramePointerMessage = {
    type,
    clientX: input.clientX,
    clientY: input.clientY,
    button,
    buttons,
  };
  for (const frame of [currentBackgroundFrame, currentOverlayFrame]) {
    if (frame?.isConnected !== true) continue;
    frame.contentWindow?.postMessage(message, "*");
  }
}

function forwardTrustedThemePointerEvent(event: PointerEvent | MouseEvent): void {
  if (!event.isTrusted) return;
  forwardThemePointer({
    eventType: event.type as ThemePointerInput["eventType"],
    clientX: event.clientX,
    clientY: event.clientY,
    button: event.button,
    buttons: event.buttons,
  });
}

document.addEventListener("pointermove", forwardTrustedThemePointerEvent, { capture: true });
document.addEventListener("pointerdown", forwardTrustedThemePointerEvent, { capture: true });
document.addEventListener("pointerup", forwardTrustedThemePointerEvent, { capture: true });
document.addEventListener("pointercancel", forwardTrustedThemePointerEvent, { capture: true });
document.addEventListener("click", forwardTrustedThemePointerEvent, { capture: true });

function restoreThemeFrameFocus(target: Element | null): boolean {
  if (target !== currentBackgroundFrame && target !== currentOverlayFrame) return false;

  const remembered = lastApplicationFocus?.isConnected === true &&
      lastApplicationFocus !== currentBackgroundFrame &&
      lastApplicationFocus !== currentOverlayFrame &&
      lastApplicationFocus.closest("#foreground-overlay") === null
    ? lastApplicationFocus
    : null;
  const destination = remembered ?? document.querySelector<HTMLElement>("#app");
  destination?.focus({ preventScroll: true });
  return true;
}

document.addEventListener("focusin", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  if (restoreThemeFrameFocus(target)) return;

  if (
    target.isConnected &&
    target.closest("#foreground-overlay") === null
  ) {
    lastApplicationFocus = target;
  }
}, { capture: true });

// Focus moving into a child browsing context does not consistently dispatch a
// parent-document focusin event. The preceding application blur does capture
// at the window; defer until activeElement identifies the destination frame.
window.addEventListener("blur", () => {
  queueMicrotask(() => restoreThemeFrameFocus(document.activeElement));
}, { capture: true });

function nextThemeRevision(): string {
  resourceRevision += 1;
  return `${Date.now()}-${resourceRevision}`;
}

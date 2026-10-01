import type { FrameContent } from "../../../lib/frame.ts";
import wallpaper from "../../../../packages/server/assets/themes/clouds/wallpaper.webp";
import template from "../../../../specs/ui/app/skill-selector/template.liquid";

// Story staging (not spec content): a full-viewport stage over the app's
// real wallpaper; pins the native-popover trigger where the top bar's trailing
// region would place it.
//
// Spec renders build inside an isolated frame booting only the production
// foundation/global sheets and tv-icon, while surface implementations are
// never loaded — the staged
// <skill-selector> markup structurally cannot be hijacked by the real
// component registered in the preview document.

const COPIED_CONFIRMATION_MS = 1400;

// rubot is served over http (not a secure context), where navigator.clipboard
// is unavailable; fall back to execCommand so copy works while testing there.
function copyToClipboard(doc: Document, text: string): void {
  if (navigator.clipboard && window.isSecureContext) {
    void navigator.clipboard.writeText(text).catch(() => execCommandCopy(doc, text));
    return;
  }
  execCommandCopy(doc, text);
}

function execCommandCopy(doc: Document, text: string): void {
  const area = doc.createElement("textarea");
  area.value = text;
  area.style.position = "fixed";
  area.style.top = "-9999px";
  doc.body.append(area);
  area.focus();
  area.select();
  try {
    doc.execCommand("copy");
  } catch {
    /* ignore */
  }
  area.remove();
}

const STAGING_CSS = /*css*/ `
  .stage {
    min-height: 100vh;
    background-position: center;
    background-size: cover;
    background-repeat: no-repeat;
  }

  .stage skill-selector .skill-trigger {
    position: fixed;
    top: 8px;
    right: 8px;
    z-index: 1200;
  }
`;

function makeStage(doc: Document): HTMLElement {
  if (!doc.querySelector("style[data-staging='skill-selector']")) {
    const style = doc.createElement("style");
    style.dataset.staging = "skill-selector";
    style.textContent = STAGING_CSS;
    doc.head.append(style);
  }
  const container = doc.createElement("div");
  container.className = "stage";
  container.style.backgroundImage = `url(${wallpaper})`;
  return container;
}

function apply(container: HTMLElement, rendering: { markup: string; styles: string[] }): void {
  const doc = container.ownerDocument;
  container.innerHTML = rendering.markup;
  for (const text of rendering.styles) {
    const sheet = doc.createElement("style");
    sheet.textContent = text;
    container.append(sheet);
  }
}

// One persistent isolated frame per spec story, ui primitives booted.
function specStage(name: string, build: (container: HTMLElement) => void): FrameContent {
  return (doc: Document) => {
    const container = makeStage(doc);
    doc.body.append(container);
    build(container);
  };
}

export function stage(name: string, rendering: { markup: string; styles: string[] }): FrameContent {
  return specStage(name, (container) => {
    apply(container, rendering);
    if (name === "open") {
      // Presents on the trigger's behalf (specs/ui/elements/popover/index.md ^po-invoker).
      container.querySelector<HTMLElement>("[popover]")?.showPopover({
        source: container.querySelector<HTMLElement>("[popovertarget]") ?? undefined,
      });
    }
  });
}

// Throwaway interactivity for judging feel: the native popover target supplies
// toggle, outside-click, and Escape behavior; each card's copy button writes
// its prompt and briefly swaps to the confirmation.
export function demo(): FrameContent {
  return specStage("demo", (container) => {
    const doc = container.ownerDocument;
    let copiedTimer: number | undefined;
    apply(container, template());

    // Each composed copy-button toggles its own `copied` attribute on the live
    // DOM — the spec's no-reflow mechanism — rather than re-rendering.
    for (const el of container.querySelectorAll<HTMLElement>("copy-button")) {
      const prompt = el.getAttribute("prompt") ?? "";
      el.querySelector("button")?.addEventListener("click", () => {
        copyToClipboard(doc, prompt);
        for (const other of container.querySelectorAll("copy-button")) {
          other.removeAttribute("copied");
        }
        el.setAttribute("copied", "");
        clearTimeout(copiedTimer);
        copiedTimer = window.setTimeout(() => {
          if (container.isConnected) el.removeAttribute("copied");
        }, COPIED_CONFIRMATION_MS);
      });
    }
  });
}

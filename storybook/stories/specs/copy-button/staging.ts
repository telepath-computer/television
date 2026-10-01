import type { FrameContent } from "../../../lib/frame.ts";
import template from "../../../../specs/ui/app/copy-button/template.liquid";

// Story staging (not spec content): the control's variants stacked on a plain
// surface.
//
// Spec renders build inside an isolated frame booting only
// the production foundation/global sheets and tv-icon, while surface
// implementations are never loaded. There is no impl side here, so every
// story is frame-staged.

export interface CopyButtonArgs {
  label: string;
  prompt: string;
  variant?: string;
}

const COPIED_CONFIRMATION_MS = 1400;

const STAGING_CSS = /*css*/ `
  .stage {
    min-height: 100vh;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--space-16);
    padding: var(--space-32);
    background: var(--color-bg);
  }
`;

function makeStage(doc: Document): HTMLElement {
  if (!doc.querySelector("style[data-staging='copy-button']")) {
    const style = doc.createElement("style");
    style.dataset.staging = "copy-button";
    style.textContent = STAGING_CSS;
    doc.head.append(style);
  }
  const container = doc.createElement("div");
  container.className = "stage";
  return container;
}

// Render each variant's template and stack them. All renderings share the one
// imported stylesheet, so the styles are applied once.
function render(container: HTMLElement, variants: CopyButtonArgs[], copied: boolean): void {
  const doc = container.ownerDocument;
  const renderings = variants.map((v) =>
    template({ label: v.label, prompt: v.prompt, variant: v.variant, copied }),
  );
  container.innerHTML = renderings.map((r) => r.markup).join("\n");
  for (const text of renderings[0].styles) {
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

export function stageVariants(
  name: string,
  variants: CopyButtonArgs[],
  copied = false,
): FrameContent {
  return specStage(name, (container) => render(container, variants, copied));
}

// Throwaway interactivity for judging feel (spec-ui: stories may wire
// non-binding interactions before implementation exists): each stacked button
// copies its prompt and briefly swaps to the confirmation, independently.
export function demoVariants(variants: CopyButtonArgs[]): FrameContent {
  return specStage("demo", (container) => {
    render(container, variants, false);
    const timers = new WeakMap<HTMLElement, number>();
    for (const el of container.querySelectorAll<HTMLElement>("copy-button")) {
      const prompt = el.getAttribute("prompt") ?? "";
      el.querySelector("button")?.addEventListener("click", () => {
        void navigator.clipboard?.writeText(prompt).catch(() => {});
        el.setAttribute("copied", "");
        const prev = timers.get(el);
        if (prev) clearTimeout(prev);
        timers.set(
          el,
          window.setTimeout(() => {
            if (container.isConnected) el.removeAttribute("copied");
          }, COPIED_CONFIRMATION_MS),
        );
      });
    }
  });
}

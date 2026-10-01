import wallpaper from "../../../../packages/server/assets/themes/clouds/wallpaper.webp";
import template from "../../../../specs/ui/app/update-notification/template.liquid";
import { frame } from "../../../lib/frame.ts";

// Story staging (not spec content): a full-viewport stage over the app's
// real wallpaper; pins the native-popover bell where the top bar's trailing
// region would place it.
//
// Spec renders mount in an isolated child document that boots only the
// production foundation and tv-icon, while the surface
// implementation (registered in
// the visible preview by impl.ts) never is. All stage DOM is created
// through the child document so it upgrades against the child registry.
//
// Matches the implementation's COPY_CONFIRMATION_MS, so the two sides of the
// Spec/Impl toggle flash the copied swap for the same duration.
const COPIED_CONFIRMATION_MS = 1500;

const STAGING_CSS = /*css*/ `
  .stage {
    min-height: 100vh;
    background-position: center;
    background-size: cover;
    background-repeat: no-repeat;
  }

  /* Pins the bell where the application root's top bar would place it — the
     placement is the top bar's, not the surface's, so staging supplies it. */
  .stage .update-bell {
    position: fixed;
    top: 8px;
    right: 8px;
    z-index: 1200;
  }
`;

// Stages mount in the shared warm frame (persistentFrame), so the ui boot
// is paid once per session and story switches just swap the stage DOM.
function mount(build: (doc: Document) => HTMLElement): HTMLElement {
  return frame({ name: "ui" }, (doc) => doc.body.append(build(doc)));
}

function makeStage(doc: Document): HTMLElement {
  const container = doc.createElement("div");
  container.className = "stage";
  container.style.backgroundImage = `url(${wallpaper})`;
  return container;
}

// (Re)fill a stage with a template rendering. innerHTML wipes the container,
// so the staging stylesheet is appended alongside the rendering's styles on
// every application.
function apply(container: HTMLElement, rendering: { markup: string; styles: string[] }): void {
  const doc = container.ownerDocument;
  container.innerHTML = rendering.markup;
  for (const text of [STAGING_CSS, ...rendering.styles]) {
    const sheet = doc.createElement("style");
    sheet.textContent = text;
    container.append(sheet);
  }
}

// Impl mounts get the same wallpaper stage as spec renders, so the two
// sides of the Spec/Impl toggle are compared in the same habitat.
export function stageElement(el: HTMLElement): HTMLElement {
  const container = makeStage(document);
  const sheet = document.createElement("style");
  sheet.textContent = STAGING_CSS;
  container.append(sheet, el);
  return container;
}

export function stage(rendering: { markup: string; styles: string[] }): HTMLElement {
  return mount((doc) => {
    const container = makeStage(doc);
    apply(container, rendering);
    return container;
  });
}

// Throwaway interactivity for judging feel: the native target toggles the
// manual popover; Later and Escape hide it, and copy briefly swaps its label.
export function demo({ body, promptText }: { body: string; promptText: string }): HTMLElement {
  return mount((doc) => {
    const container = makeStage(doc);
    let copiedTimer: number | undefined;
    apply(container, template({ open: true, body, prompt: true }));

    const trigger = container.querySelector<HTMLElement>(".update-bell");
    const popover = container.querySelector<HTMLElement>(".update-popover");
    container.querySelector(".update-later")?.addEventListener("click", () => {
      popover?.hidePopover();
      trigger?.focus();
    });
    popover?.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      popover.hidePopover();
      trigger?.focus();
    });
    // The copied swap toggles the template's own `copied` class on the live
    // DOM — the spec's no-reflow mechanism — rather than re-rendering, so
    // the open popover is not torn down at the moment the spec constrains.
    container.querySelector(".update-copy")?.addEventListener("click", (event) => {
      void navigator.clipboard?.writeText(promptText).catch(() => {});
      const button = event.currentTarget as HTMLElement;
      button.classList.add("copied");
      clearTimeout(copiedTimer);
      copiedTimer = window.setTimeout(() => {
        if (container.isConnected) button.classList.remove("copied");
      }, COPIED_CONFIRMATION_MS);
    });
    // Presents on the bell's behalf (specs/ui/elements/popover/index.md ^po-invoker).
    requestAnimationFrame(() => popover?.showPopover({ source: trigger ?? undefined }));
    return container;
  });
}

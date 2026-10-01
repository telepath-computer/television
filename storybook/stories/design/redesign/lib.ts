// Design workshop (not a spec): tiny shared helpers for the redesign mocks.

import { html, type TemplateResult } from "lit-html";
import { frame } from "../../../lib/frame.ts";
import { REDESIGN_CSS } from "./styles.ts";

// Phosphor glyphs (regular weight), inlined as lit templates.
const ICON_PATHS = {
  max: "M216,48V88a8,8,0,0,1-16,0V56H168a8,8,0,0,1,0-16h40A8,8,0,0,1,216,48ZM88,200H56V168a8,8,0,0,0-16,0v40a8,8,0,0,0,8,8H88a8,8,0,0,0,0-16Zm120-40a8,8,0,0,0-8,8v32H168a8,8,0,0,0,0,16h40a8,8,0,0,0,8-8V168A8,8,0,0,0,208,160ZM88,40H48a8,8,0,0,0-8,8V88a8,8,0,0,0,16,0V56H88a8,8,0,0,0,0-16Z",
  restore:
    "M152,96V48a8,8,0,0,1,16,0V88h40a8,8,0,0,1,0,16H160A8,8,0,0,1,152,96ZM96,152H48a8,8,0,0,0,0,16H88v40a8,8,0,0,0,16,0V160A8,8,0,0,0,96,152Zm112,0H160a8,8,0,0,0-8,8v48a8,8,0,0,0,16,0V168h40a8,8,0,0,0,0-16ZM96,40a8,8,0,0,0-8,8V88H48a8,8,0,0,0,0,16H96a8,8,0,0,0,8-8V48A8,8,0,0,0,96,40Z",
  close:
    "M205.66,194.34a8,8,0,0,1-11.32,11.32L128,139.31,61.66,205.66a8,8,0,0,1-11.32-11.32L116.69,128,50.34,61.66A8,8,0,0,1,61.66,50.34L128,116.69l66.34-66.35a8,8,0,0,1,11.32,11.32L139.31,128Z",
} as const;

export type IconName = keyof typeof ICON_PATHS;

export const icon = (name: IconName): TemplateResult =>
  html`<svg class="icon" viewBox="0 0 256 256"><path d="${ICON_PATHS[name]}"/></svg>`;

// An isolated document for a mock, built on the shared isolation primitive
// (storybook/lib/frame.ts) with nothing booted — a clean room.
// Each mock names its own persistent frame. `host` is the slot the story
// returns; `root` is the render target appended into the warm document on
// each mount. The mocks build DOM in the parent and let it adopt across —
// safe here because wireframes contain no custom-element tags; same-origin
// adoption preserves lit's listeners.
export function mockFrame(name: string, css = REDESIGN_CSS): { host: HTMLElement; root: HTMLElement } {
  const root = document.createElement("div");
  const style = document.createElement("style");
  style.textContent = css;
  root.append(style);
  const host = frame({ name: "blank" }, (doc) => doc.body.append(root));
  return { host, root };
}

// Placeholder "document" — skeleton bars standing in for real artifact
// content, so a pane reads as filled rather than blank. Sections are a heading
// bar plus a few text lines of varied width. Styling lives in `.fake*`
// (styles.ts); the container scrolls if it outgrows its pane.
const FAKE_SECTIONS = [
  { head: "38%", lines: ["96%", "88%", "70%"] },
  { head: "30%", lines: ["92%", "100%", "61%"] },
  { head: "44%", lines: ["84%", "94%", "78%", "50%"] },
  { head: "34%", lines: ["100%", "72%"] },
];

export function fakeDoc(sections = FAKE_SECTIONS.length): TemplateResult {
  return html`
    <div class="fake">
      ${Array.from({ length: sections }, (_, i) => {
        const sec = FAKE_SECTIONS[i % FAKE_SECTIONS.length];
        return html`
          <div class="fake-sec">
            <div class="fake-h" style="width: ${sec.head}"></div>
            ${sec.lines.map((w) => html`<div class="fake-line" style="width: ${w}"></div>`)}
          </div>
        `;
      })}
    </div>
  `;
}

// The twelve project plans — the shared use case across the Organizing mocks
// (grouped nav, tab views, artifact panel, artifact sidebar).
export const PLANS = [
  "Website redesign",
  "Mobile app",
  "Pricing update",
  "Onboarding revamp",
  "Docs overhaul",
  "Data migration",
  "Hiring pipeline",
  "Support automation",
  "Infra upgrade",
  "Brand refresh",
  "Partnerships",
  "Q3 planning",
];

// The screens rail; rows are inert unless onSelect is given.
export function railTpl(
  names: string[],
  activeIdx: number,
  onSelect?: (idx: number) => void,
): TemplateResult {
  return html`
    <aside class="rail">
      <div class="rail-header"><div class="label">Television</div></div>
      <div class="screens">
        ${names.map(
          (name, i) => html`
            <div
              class="screen-row ${i === activeIdx ? "active" : ""}"
              @click=${onSelect ? () => onSelect(i) : undefined}
            >
              ${name}
            </div>
          `,
        )}
      </div>
      <div class="rail-footer"><div class="new-screen">+ New screen</div></div>
    </aside>
  `;
}

// Remove an element once its own transition finishes (ignores transitionend
// bubbling up from descendants).
export function removeAfterTransition(target: HTMLElement): void {
  const done = (e: TransitionEvent) => {
    if (e.target !== target) return;
    target.removeEventListener("transitionend", done);
    target.remove();
  };
  target.addEventListener("transitionend", done);
}

// The stage boards' shared mount (staging, not spec content): the real stage
// template posed at one state per board. A page's size is its own state
// ([[ui/app/stage/index.md]], Page sizing); with no resize gesture staged yet, every page
// sits at the authored initial size, read from the spec's measures.
import "../../lib/foundation.ts";
import stage from "../../../specs/ui/app/stage/template.liquid";
import { PAGE_INITIAL_HEIGHT_PX, PAGE_INITIAL_WIDTH_PX } from "../../lib/stage-measures.ts";
import { factorFor, pageBox } from "../../lib/resize.ts";

const PAGES = [
  { id: "cal", src: "/specs/ui/onboarding-artifacts/productivity/todays-calendar", name: "Today's calendar", selected: true },
  { id: "prio", src: "/specs/ui/onboarding-artifacts/productivity/priorities-today", name: "Priorities today" },
  { id: "todos", src: "/specs/ui/onboarding-artifacts/productivity/company-todos", name: "Company to-dos" },
];

export function mountStage({ blank = false }: { blank?: boolean } = {}): void {
  const pages = blank ? [] : PAGES;
  const { markup, styles } = stage({ pages });
  document.head.insertAdjacentHTML("beforeend", `<style>${styles.join("\n")}</style>`);
  document.body.insertAdjacentHTML("beforeend", markup);

  // The authored size is stated at the reference page box; this board's box
  // is smaller, so the size renders through the sizing shares as the app does.
  const f = factorFor(pageBox(document.querySelector<HTMLElement>(".filmstrip")!));
  for (const pageEl of document.querySelectorAll<HTMLElement>(".page")) {
    pageEl.style.width = `${PAGE_INITIAL_WIDTH_PX * f.w}px`;
    pageEl.style.height = `${PAGE_INITIAL_HEIGHT_PX * f.h}px`;
  }

  // The selected page rests centred, the spec's invariant.
  const selected = document.querySelector(".page[selected]");
  if (selected) {
    const strip = document.querySelector(".filmstrip")!;
    const b = selected.getBoundingClientRect();
    const sb = strip.getBoundingClientRect();
    strip.scrollLeft += b.left + b.width / 2 - (sb.left + sb.width / 2);
  }
}

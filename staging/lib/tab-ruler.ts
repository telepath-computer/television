// The tab's measuring twin (staging, not spec content). The spec claims a
// tab's minimum width is min(label, floor)
// ([[ui/app/stage/tab-strip/index.md#^tb-tab-bounds]]), which CSS cannot yet state
// (`fit-content(floor)` has not shipped). This realizes it structurally: a
// hidden copy of the label sharing the pill's cell, capped at the floor less
// the pill's padding, gives the pill its automatic minimum. No
// `overflow: hidden` on the twin, deliberately — it would zero the
// automatic minimum, and the floor with it.
import raw from "../../specs/ui/app/stage/tab-strip/measures.yml?raw";

export const TAB_FLOOR_PX = Number(raw.match(/^\s+floor_px:\s*(\d+)/m)![1]);

export const RULER_CSS = `
  .tab-label, .tab-ruler { grid-area: 1 / 1; }
  .tab-ruler {
    visibility: hidden;
    height: 0;
    white-space: nowrap;
    max-width: calc(${TAB_FLOOR_PX}px - 2 * var(--space-10));
  }
`;

export function addTabRulers(root: ParentNode = document): void {
  for (const tab of root.querySelectorAll(".tab")) {
    if (tab.querySelector(".tab-ruler")) continue;
    const ruler = document.createElement("span");
    ruler.className = "tab-ruler";
    ruler.setAttribute("aria-hidden", "true");
    ruler.textContent = tab.querySelector(".tab-label")?.textContent ?? "";
    tab.append(ruler);
  }
}

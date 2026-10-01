// Staging shim (apparatus, not spec and not the implementation): makes the
// staged sidebar feel real in Storybook, per the contract of
// specs/ui/skills/sidebar-view/index.md — selection on press, single
// selection, re-press no-op, view switching, drag-resize. It deliberately
// mirrors that contract WITHOUT loading the shipped carried JS: spec
// staging never loads implementations. The shipped behavior lives in
// packages/skills/skills/tv-sidebar-view/sidebar.js and is reviewed
// through eval artifacts in the Preview leaf, not here.
//
// Runs in the isolated frame's document via the frame's boot list.

const EDGE = 5;

function sidebarEdge(event: MouseEvent): HTMLElement | null {
  const sidebar = document.querySelector("tv-sidebar") as HTMLElement | null;
  if (!sidebar) return null;
  const rect = sidebar.getBoundingClientRect();
  const inEdge =
    Math.abs(event.clientX - rect.right) <= EDGE &&
    event.clientY >= rect.top &&
    event.clientY <= rect.bottom;
  return inEdge ? sidebar : null;
}

let dragging: HTMLElement | null = null;

document.addEventListener("mousedown", (event) => {
  if (event.button !== 0) return;

  const sidebar = sidebarEdge(event);
  if (sidebar) {
    dragging = sidebar;
    event.preventDefault();
    return;
  }

  const target = event.target as Element | null;
  const item = target?.closest?.("tv-sidebar-item");
  if (!item) return;
  if (item.hasAttribute("selected")) return;
  item.closest("tv-sidebar")?.querySelectorAll("tv-sidebar-item[selected]").forEach((selected) => {
    selected.removeAttribute("selected");
  });
  item.setAttribute("selected", "");

  const id = item.getAttribute("item");
  document.querySelectorAll("tv-view").forEach((view) => {
    view.toggleAttribute("shown", view.getAttribute("item") === id);
  });
});

document.addEventListener("mousemove", (event) => {
  if (dragging) {
    const rect = dragging.getBoundingClientRect();
    dragging.style.setProperty("--sidebar-width", `${event.clientX - rect.left}px`);
    return;
  }
  document.body.style.cursor = sidebarEdge(event) ? "col-resize" : "";
});

document.addEventListener("mouseup", () => {
  dragging = null;
});

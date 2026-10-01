/** The menu pattern's keyboard, shared by the workshop's documents: opening
 *  focuses the first item; arrows rove. Enter, Escape, and light dismiss are
 *  the platform's. */
export function wireMenu(menu: HTMLElement) {
  menu.addEventListener("toggle", (ev) => {
    if ((ev as ToggleEvent).newState === "open") {
      menu.querySelector<HTMLElement>(".menu-item")?.focus();
    }
  });
  menu.addEventListener("keydown", (ev) => {
    if (ev.key !== "ArrowDown" && ev.key !== "ArrowUp") return;
    ev.preventDefault();
    const items = [...menu.querySelectorAll<HTMLElement>(".menu-item")];
    const i = items.indexOf(document.activeElement as HTMLElement);
    const next = ev.key === "ArrowDown" ? Math.min(i + 1, items.length - 1) : Math.max(i - 1, 0);
    items[next]?.focus();
  });
}

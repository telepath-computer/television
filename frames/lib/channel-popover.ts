import { settleDocument } from "./foundation";
import { channelPopoverDrag } from "./channel-popover-drag";

/** Workshop interaction only; markup and highlight styling come from the spec. */
export const channelPopoverPrototype = (host: HTMLElement): (() => void) => {
  const panel = host.querySelector<HTMLElement>(".channel-switcher-pop")!;
  const trigger = host.querySelector<HTMLButtonElement>(".channel-switcher")!;
  const rows = () => [...panel.querySelectorAll<HTMLElement>('.channel[role="option"]')];
  const focus = (row?: HTMLElement) => {
    row?.focus({ preventScroll: true });
    row?.scrollIntoView({ block: "nearest" });
  };
  // Let the shared workshop popover wiring own trigger toggle and dismissal.
  trigger.id = "channel-popover-prototype-trigger";
  panel.setAttribute("trigger", trigger.id);
  panel.toggleAttribute("open", host.dataset.open === "true");
  settleDocument();
  const drag = channelPopoverDrag(panel);

  const onClick = (event: MouseEvent) => {
    const target = event.target as Element;
    if (trigger.contains(target)) {
      // The foundation listener toggles the panel earlier on document click.
      if (panel.hasAttribute("open") && event.detail === 0) focus(rows()[0]);
      return;
    }
    const row = target.closest<HTMLElement>('.channel[role="option"]');
    if (!row || !panel.contains(row)) return;
    for (const option of rows()) option.setAttribute("aria-selected", option === row ? "true" : "false");
    trigger.querySelector(".channel-switcher-name")!.textContent = row.textContent;
    panel.removeAttribute("open");
    if (panel.contains(document.activeElement)) trigger.focus({ preventScroll: true });
    settleDocument();
  };
  const onPointerMove = (event: PointerEvent) => {
    if (drag.active() || !panel.hasAttribute("open") || panel.querySelector("input, tv-menu[open]")) return;
    const row = (event.target as Element).closest<HTMLElement>(".channel-row")
      ?.querySelector<HTMLElement>('.channel[role="option"]');
    if (row && panel.contains(row)) focus(row);
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (drag.active() || !panel.hasAttribute("open")) return;
    const target = event.target as Element;
    if (target.closest("input, tv-menu") || panel.querySelector("tv-menu[open]")) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      const options = rows();
      const index = options.indexOf(document.activeElement as HTMLElement);
      const down = event.key === "ArrowDown";
      const next = index < 0
        ? (down ? 0 : options.length - 1)
        : Math.max(0, Math.min(options.length - 1, index + (down ? 1 : -1)));
      event.preventDefault();
      focus(options[next]);
    } else if ((event.key === "Enter" || event.key === " ") && target.matches('.channel[role="option"]')) {
      event.preventDefault();
      (target as HTMLElement).click();
    }
  };
  document.addEventListener("click", onClick);
  host.addEventListener("pointermove", onPointerMove);
  document.addEventListener("keydown", onKeyDown);
  return () => {
    drag.dispose();
    document.removeEventListener("click", onClick);
    host.removeEventListener("pointermove", onPointerMove);
    document.removeEventListener("keydown", onKeyDown);
  };
};

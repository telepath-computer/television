/** DOM focus is the navigation state shared by menus and channel lists. */
export function focusOption(option: HTMLElement | undefined): void {
  option?.focus({ preventScroll: true });
  option?.scrollIntoView({ block: "nearest" });
}

/** Enter from either end, then clamp arrow movement to the available options. */
export function navigateOptions(event: KeyboardEvent, options: readonly HTMLElement[]): boolean {
  if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return false;
  if (options.length === 0) return false;
  const current = options.indexOf(options[0]!.ownerDocument.activeElement as HTMLElement);
  const down = event.key === "ArrowDown";
  const next = current < 0
    ? (down ? 0 : options.length - 1)
    : Math.max(0, Math.min(options.length - 1, current + (down ? 1 : -1)));
  event.preventDefault();
  event.stopImmediatePropagation();
  focusOption(options[next]);
  return true;
}

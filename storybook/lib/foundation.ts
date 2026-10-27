/**
 * Gives static open-panel story markup the edge layers normally placed by the
 * foundation panel controller at runtime.
 */
export function poseOpenFoundationPanel(panel: HTMLElement): void {
  const box = panel.getBoundingClientRect();
  panel.style.setProperty("--_panel-edge-position", "fixed");
  panel.style.setProperty("--_panel-edge-inset", `${box.top}px auto auto ${box.left}px`);
  panel.style.setProperty("--_panel-edge-width", `${box.width}px`);
  panel.style.setProperty("--_panel-edge-height", `${box.height}px`);
}

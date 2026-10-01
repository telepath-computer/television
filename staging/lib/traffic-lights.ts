// The macOS window-control cluster, staging's own fixture — macOS draws the
// real one. The app sets titleBarStyle "hidden" with trafficLightPosition
// { x: 12, y: 12 } (packages/desktop/src/index.ts), so the cluster overlays
// the window's top-left corner; drawn at that offset to show what the
// reserved space covers.
const CSS = `
  .traffic-lights {
    position: absolute;
    top: 12px;
    left: 12px;
    z-index: 1;
    display: flex;
    gap: 10px;
  }

  .traffic-lights > span {
    width: 14px;
    height: 14px;
    border-radius: 50%;
    /* Each button carries a darker rim; without it the circles read as flat
       stickers rather than as the real control. */
    border: 1px solid;
  }

  .traffic-lights > :nth-child(1) { background: #ed6a5f; border-color: #e24b41; }
  .traffic-lights > :nth-child(2) { background: #f6be50; border-color: #e1a73e; }
  .traffic-lights > :nth-child(3) { background: #61c555; border-color: #2dac2f; }
`;

export function installTrafficLights(host: HTMLElement): void {
  if (!document.querySelector("[data-traffic-lights-css]")) {
    document.head.insertAdjacentHTML("beforeend", `<style data-traffic-lights-css>${CSS}</style>`);
  }
  host.insertAdjacentHTML("afterbegin", '<div class="traffic-lights" aria-hidden="true"><span></span><span></span><span></span></div>');
}

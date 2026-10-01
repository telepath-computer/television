import "../../lib/foundation.ts";
import systemModalTemplate from "../../../specs/ui/app/system-modal/template.liquid";
import {
  driveSystemModalPoses,
  type SystemModalPose,
} from "./poses.ts";

const injectedStyles = new Set<string>();

await driveSystemModalPoses({
  exposeAs: "__poseSystemModalSpec",
  async render(pose) {
    const host = document.querySelector<HTMLElement>("#system-modal-specification");
    if (host === null) throw new Error("System modal specification frame needs its host");
    const rendered = systemModalTemplate(templateDataFor(pose));
    for (const css of rendered.styles) {
      if (injectedStyles.has(css)) continue;
      document.head.insertAdjacentHTML("beforeend", `<style>${css}</style>`);
      injectedStyles.add(css);
    }
    host.replaceChildren();
    host.insertAdjacentHTML("beforeend", rendered.markup);
    await new Promise((resolve) => requestAnimationFrame(resolve));
  },
});

function templateDataFor(pose: SystemModalPose): Record<string, unknown> {
  switch (pose.name) {
    case "connecting":
      return { state: pose.state };
    case "disconnected-countdown":
      return { state: pose.state, seconds: pose.seconds };
    case "disconnected-now":
      return { state: pose.state };
    case "unauthorized":
      return { state: pose.state, invalid: pose.invalid };
    case "unauthorized-invalid":
      return { state: pose.state, invalid: pose.invalid };
    case "error":
      return {
        state: pose.state,
        server_url: pose.serverURL,
        message: pose.message,
      };
    case "needs-upgrade":
      return {
        state: pose.state,
        upgrade_instructions: pose.upgrade.instructions,
      };
  }
}

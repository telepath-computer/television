import "../../../packages/web/src/foundation/index.css";
import "../../../packages/web/src/views/system-modal.css";
import { render } from "lit-html";
import {
  SystemModalView,
  type SystemModalApplication,
  type SystemModalState,
} from "../../../packages/web/src/views/system-modal.ts";
import {
  driveSystemModalPoses,
  type SystemModalPose,
} from "./poses.ts";

const MILLISECONDS_PER_SECOND = 1000;
const application: SystemModalApplication = {
  authenticate(_token: string): Promise<void> {
    return Promise.resolve();
  },
};

await driveSystemModalPoses({
  exposeAs: "__poseSystemModal",
  async ready() {
    await customElements.whenDefined("tv-icon");
  },
  async render(pose) {
    const host = document.querySelector<HTMLElement>("#system-modal-implementation");
    if (host === null) throw new Error("System modal implementation frame needs its host");
    render(SystemModalView(stateFor(pose), application), host);
    await Promise.resolve();
    await new Promise((resolve) => requestAnimationFrame(resolve));
  },
});

function stateFor(pose: SystemModalPose): SystemModalState {
  switch (pose.name) {
    case "connecting":
      return { kind: pose.state };
    case "disconnected-countdown":
      return {
        kind: pose.state,
        nextRetryAt: Date.now() + pose.seconds * MILLISECONDS_PER_SECOND,
      };
    case "disconnected-now":
      return { kind: pose.state, nextRetryAt: null };
    case "unauthorized":
      return { kind: pose.state, invalid: pose.invalid };
    case "unauthorized-invalid":
      return { kind: pose.state, invalid: pose.invalid };
    case "error":
      return {
        kind: pose.state,
        serverURL: pose.serverURL,
        message: pose.message,
      };
    case "needs-upgrade":
      return {
        kind: pose.state,
        instructions: { upgradeMarkdown: pose.upgrade.markdown },
      };
  }
}

// One channel board: the channel template mounted in one state. Each state
// file is a frame of its own (frames are src-only documents), so the mounting
// is shared here and the file names the state.
import "../../lib/foundation.ts";
import channel from "../../../specs/ui/app/sidebar/channel.liquid";
import { installPseudoStates } from "../../lib/pseudo-states.ts";

export function mountChannel(state: "rest" | "hover" | "selected" | "renaming" | "unpinning"): void {
  const { markup, styles } = channel({
    channel: { id: "sam", name: "Meeting with Sam", ...(state === "selected" ? { selected: true } : {}), ...(state === "renaming" ? { renaming: true } : {}), ...(state === "unpinning" ? { dragged: true, unpinning: true } : {}) },
  });
  document.head.insertAdjacentHTML("beforeend", `<style>${styles.join("\n")}</style>`);
  document.body.insertAdjacentHTML("beforeend", markup);
  if (state === "hover") {
    installPseudoStates();
    document.querySelector(".channel-row")!.setAttribute("data-hover", "");
  }
}

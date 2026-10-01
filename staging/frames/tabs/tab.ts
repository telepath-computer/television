// One tab board: the tab template (the same one the strip composes) mounted in
// one state. Each state file is a frame of its own (frames are src-only
// documents), so the mounting is shared here and the file names the state.
//
// Hover cannot be expressed in markup, so every rule mentioning it is given a
// mirrored selector driven by an attribute (staging/lib/pseudo-states).
import "../../lib/foundation.ts";
import tab from "../../../specs/ui/app/stage/tab-strip/tab.liquid";
import { installPseudoStates } from "../../lib/pseudo-states.ts";
import { RULER_CSS, addTabRulers } from "../../lib/tab-ruler.ts";

const STATES = {
  rest: { tab: { name: "Calendar" } },
  hover: { tab: { name: "Calendar" }, mark: ".tab" },
  selected: { tab: { name: "Calendar", selected: true } },
  "selected-hover": { tab: { name: "Calendar", selected: true }, mark: ".tab" },
} as const;

export function mountTab(state: keyof typeof STATES): void {
  const { tab: data, mark } = STATES[state] as { tab: object; mark?: string };
  const { markup, styles } = tab({ tab: data });
  document.head.insertAdjacentHTML("beforeend", `<style>${styles.join("\n")}\n${RULER_CSS}</style>`);
  document.body.insertAdjacentHTML("beforeend", markup);
  addTabRulers();
  if (mark) {
    installPseudoStates();
    document.querySelector(mark)!.setAttribute("data-hover", "");
  }
}

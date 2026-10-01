// One bell board: the update bell mounted in one state. Each state file is a
// frame of its own (frames are src-only documents), so the mounting is shared
// here and the file names the state.
//
// Rest, hover and active are pseudo-state mirrors on the bell itself. Held is
// real — the panel is actually open, then hidden by the board's own CSS, since
// the held styling keys on the adjacent panel's open state, not on its
// visibility. Only the held board keeps the panel in the document, which is
// also what keeps the held styling off the resting states.
import "../../lib/foundation.ts";
import updateNotification from "../../../specs/ui/app/update-notification/template.liquid";
import { installPseudoStates } from "../../lib/pseudo-states.ts";

export function mountBell(state: "rest" | "hover" | "active" | "held"): void {
  const { markup, styles } = updateNotification({ body: "<p>…</p>", prompt: true });
  document.head.insertAdjacentHTML("beforeend", `<style>${styles.join("\n")}</style>`);
  const holder = document.createElement("div");
  holder.innerHTML = markup;
  const bell = holder.querySelector("button.update-bell")!;
  const panel = holder.querySelector("[popover]")! as HTMLElement;

  if (state === "held") {
    document.body.append(bell, panel);
    (panel as { showPopover(options?: object): void }).showPopover({ source: bell });
    return;
  }

  document.body.append(bell);
  if (state !== "rest") {
    installPseudoStates();
    bell.setAttribute(`data-${state}`, "");
  }
}

// One skill-selector board: the template mounted, one part kept. The surface
// is a trigger and a panel, so it is staged as the two things they are: the
// trigger on its own, and the popover's content shown as content — in flow,
// pinned open by the content board — since its anchored, floating behaviour is
// the popover primitive's and is judged on that spec's frame and in the App.
//
// Each part file is a frame of its own (frames are src-only documents), so the
// mounting is shared here and the file names the part. Each board is its own
// document, so the popover markup's id cannot collide across boards and each
// render keeps only the part it shows.
import "../../lib/foundation.ts";
import skillSelector from "../../../specs/ui/app/skill-selector/template.liquid";

export function mountSkillSelector(part: "trigger" | "content"): void {
  const { markup, styles } = skillSelector({});
  document.head.insertAdjacentHTML("beforeend", `<style>${styles.join("\n")}</style>`);

  const holder = document.createElement("div");
  holder.innerHTML = markup;
  const kept =
    part === "trigger"
      ? holder.querySelector("button[popovertarget]")!
      : holder.querySelector("[popover]")!;
  document.body.append(kept);
}

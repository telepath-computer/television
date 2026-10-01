// One strip board: the tab strip template mounted with one of the staged tab
// sets. Each set is a frame of its own (frames are src-only documents), so the
// mounting is shared here and the file names the set.
import "../../lib/foundation.ts";
import tabStrip from "../../../specs/ui/app/stage/tab-strip/tab-strip.liquid";
import { RULER_CSS, addTabRulers } from "../../lib/tab-ruler.ts";

const SETS = {
  strip: [
    { name: "Daily brief", selected: true },
    { name: "Calendar" },
    { name: "To-do list" },
  ],
  one: [{ name: "Scratchpad", selected: true }],
  long: [{ name: "An artifact with a rather longer name than usual", selected: true }],
} as const;

export function mountStrip(set: keyof typeof SETS): void {
  const { markup, styles } = tabStrip({ tabs: SETS[set] });
  document.head.insertAdjacentHTML("beforeend", `<style>${styles.join("\n")}\n${RULER_CSS}</style>`);
  document.body.insertAdjacentHTML("beforeend", markup);
  addTabRulers();
}

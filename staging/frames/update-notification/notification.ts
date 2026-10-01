// One notice board: the update notification's panel mounted as plain content —
// in flow, pinned open by staging. Only the panel is taken; the bell has its
// own sheet (../update-bell/), and the notice's floating and its refusal to
// light-dismiss are judged in the App frame, where the surface is composed
// live.
//
// Each board is a document of its own (frames are src-only documents), so the
// promptless state is a second render without `prompt`; the prompted board
// hands the template an actual copy value. The old single-document staging derived it from a
// clone only because two renders there would have duplicated the popover id.
import "../../lib/foundation.ts";
import updateNotification from "../../../specs/ui/app/update-notification/template.liquid";

const BODY =
  "<h3>Television 0.2 is available</h3><p>New stage, new tabs, and a faster start. Upgrade when convenient.</p>";

export function mountNotice(withPrompt: boolean): void {
  const prompt = withPrompt ? "Upgrade Television following https://television.run/install.md" : undefined;
  const { markup, styles } = updateNotification({ body: BODY, prompt });
  document.head.insertAdjacentHTML("beforeend", `<style>${styles.join("\n")}</style>`);
  const holder = document.createElement("div");
  holder.innerHTML = markup;
  document.body.append(holder.querySelector("[popover]")!);
}

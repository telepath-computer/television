// Story staging (not spec content): the gate is self-backgrounded, so the
// stage is just a mount point for the rendered markup and its styles.
//
// This surface has a Spec/Impl toggle whose impl branch mounts the real
// component in the preview document, so the story cannot hand content to the
// decorator — it opts out with `frame: false` and frames the spec branch here.
// The frame boots only the production foundation and tv-icon, so the
// implementation registered in the preview by impl.ts never reaches the staged markup.
import { frame } from "../../../lib/frame.ts";

export function stage(rendering: { markup: string; styles: string[] }): HTMLElement {
  return frame({ name: "ui" }, (doc) => {
    const container = doc.createElement("div");
    container.innerHTML = rendering.markup;
    for (const text of rendering.styles) {
      const sheet = doc.createElement("style");
      sheet.textContent = text;
      container.append(sheet);
    }
    doc.body.append(container);
  });
}

// A Table template prototype: the example page from the former tv-table
// skill, rendered with the stylesheet artifacts receive. Static, not editable.

import "../../../specs/ui/foundation/index.css";
import houseStyleExample from "../../../packages/skills/skills/tv-table/example/index.html?raw";

// The example is a whole document; a story renders its body and styles. The
// styles go last: the preview parses a story as a document, and a leading
// <style> would land in its head and be dropped.
const styles = [...houseStyleExample.matchAll(/<style>([\s\S]*?)<\/style>/g)].map((match) => match[1]).join("\n");
const body = /<body[^>]*>([\s\S]*)<\/body>/.exec(houseStyleExample)?.[1] ?? "";

export default {
  title: "Experiments/Table/House style",
  parameters: { layout: "fullscreen" },
};

export const Static = {
  render: () => `${body}<style>${styles}</style>`,
};

// The preview is an inert staging platform: a stage for frames to sit on, and
// nothing else. No product package is imported here — the design system is
// booted inside a frame that wants it (frames/ui.html), and the few stagings
// that mount product code in this document import what they need themselves,
// so a dependency is declared where it is used rather than carried for every
// story.
import type { Preview } from "@storybook/web-components-vite";
import { frame, stage, type FrameContent, type FrameOptions } from "../lib/frame.ts";
import "../lib/storybook.css";

const preview: Preview = {
  // Every story sits on a stage, and renders into the frame its `frame`
  // parameter asks for — a story returns the frame's content (markup, or a
  // builder handed the child document), never the frame itself. `frame: false`
  // keeps the stage but leaves a story to build its own frames, which is the
  // only way to put more than one on a page.
  decorators: [
    (storyFn, context) => {
      const options = context.parameters.frame as FrameOptions | false | undefined;
      if (options === false) return stage(storyFn() as Node);
      return stage(frame(options ?? {}, storyFn() as FrameContent));
    },
  ],
  globalTypes: {
    // Toggled by the custom Spec/Impl tool in manager.ts, which only
    // shows on stories tagged "has-impl".
    specMode: {
      description: "UI specs: render the spec templates or the implementation",
    },
    // Toggled by the custom Nav tool in manager.ts, which only shows on
    // stories tagged "orient" (the grouped-nav design mock).
    orient: {
      description: "Grouped-nav orientation: nav on top or left",
    },
  },
  initialGlobals: {
    specMode: "spec",
    orient: "left",
  },
  parameters: {
    options: {
      // Sections in fixed order; within every level, loose stories and
      // components sort alphabetically first and folders sink to the bottom.
      // Pairwise sorting can't see the tree, so nodes that hold loose stories
      // AND subfolders (mixed nodes) are named explicitly to sink with the
      // folders. Same-component stories keep their export order.
      // @ts-expect-error -- storySort's SOURCE is extracted and eval'd by the
      // manager, so the params must stay annotation-free (TS syntax breaks it).
      storySort: (a, b) => {
        const SECTIONS = ["Specs", "Design"];
        const MIXED = new Set(["Design/Redesign"]);
        // Sunk folders under Specs keep a fixed order (surfaces first is
        // the folder-sink rule; this orders the folders themselves).
        const SPECS_FOLDERS = ["Onboarding", "Skills", "Internal tools"];
        const UNLISTED = SECTIONS.length + 1; // unknown sections sort after the listed ones
        const A = a.title.split("/");
        const B = b.title.split("/");
        if (A[0] !== B[0]) {
          const sa = SECTIONS.indexOf(A[0]);
          const sb = SECTIONS.indexOf(B[0]);
          return (sa < 0 ? UNLISTED : sa) - (sb < 0 ? UNLISTED : sb) || A[0].localeCompare(B[0]);
        }
        for (let i = 1; i < Math.max(A.length, B.length); i += 1) {
          if (A[i] === B[i]) continue;
          if (A[i] === undefined) return -1; // a's stories sit on the shared node itself
          if (B[i] === undefined) return 1;
          const aFolder = A.length > i + 1 || MIXED.has(A.slice(0, i + 1).join("/"));
          const bFolder = B.length > i + 1 || MIXED.has(B.slice(0, i + 1).join("/"));
          // Foundation floats above everything in Specs, even loose surfaces.
          if (A[0] === "Specs" && i === 1 && (A[1] === "Foundation") !== (B[1] === "Foundation")) {
            return A[1] === "Foundation" ? -1 : 1;
          }
          if (aFolder !== bFolder) return aFolder ? 1 : -1; // folders sink
          if (aFolder && A[0] === "Specs" && i === 1) {
            const fa = SPECS_FOLDERS.indexOf(A[1]);
            const fb = SPECS_FOLDERS.indexOf(B[1]);
            const cap = SPECS_FOLDERS.length;
            const diff = (fa < 0 ? cap : fa) - (fb < 0 ? cap : fb);
            if (diff !== 0) return diff;
          }
          return A[i].localeCompare(B[i], undefined, { numeric: true });
        }
        return 0;
      },
    },
  },
};

export default preview;

import type { Preview } from "@storybook/html-vite";
import { Html } from "../lib/html.ts";
import iconFrame from "../../specs/ui/foundation/icons/icon.frame";

// Frames whose bodies write shadow roots. Frameset forbids a <style> in a
// frame body, so such a frame declares its shadow-root CSS as adoptedStyles,
// keyed by element name, for the renderer to adopt into each root.
const shadowRootFrames = [iconFrame];

// Storybook inserts a returned string with innerHTML, which leaves a
// declarative shadow root as an inert <template>. HTML from a spec template,
// or any other string, is parsed as a document instead, so shadow roots
// attach, and the frames' shadow-root CSS is adopted into them. A story that
// returns DOM nodes, as production stories do, is left as it is.
const preview: Preview = {
  decorators: [
    (story) => {
      const result: unknown = story();
      if (typeof result !== "string" && !(result instanceof Html)) return result as Node;
      const fragment = document.createDocumentFragment();
      fragment.append(...Document.parseHTMLUnsafe(String(result)).body.childNodes);
      for (const frame of shadowRootFrames) {
        for (const [name, texts] of Object.entries(frame.adoptedStyles ?? {})) {
          const sheets = texts.map((text) => {
            const sheet = new CSSStyleSheet();
            sheet.replaceSync(text);
            return sheet;
          });
          for (const element of fragment.querySelectorAll(name)) {
            if (element.shadowRoot) element.shadowRoot.adoptedStyleSheets = sheets;
          }
        }
      }
      return fragment;
    },
  ],
};

export default preview;

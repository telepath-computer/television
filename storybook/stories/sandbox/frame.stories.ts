// Sandbox: the frame primitive on its own, as a place to see what a frame is
// and to try a new frame document against something trivial.
//
// A story renders into a pre-configured document under `storybook/frames/`
// rather than into the preview. The frame's boot is ordinary markup — a
// `<script type="module">` in the HTML — so the browser loads it, and module
// scripts being deferred means it has run by the time `load` fires.

import type { Meta } from "@storybook/web-components-vite";
import { frame, type FrameStory } from "../../lib/frame.ts";

const meta: Meta = {
  title: "Sandbox/Frame",
  parameters: { layout: "fullscreen" },
};

export default meta;

const CONTROLS = /*html*/ `
  <div style="display: flex; align-items: center; gap: var(--space-12, 12px); padding: var(--space-16, 16px)">
    <button variant="primary" size="sm">Primary</button>
    <button variant="ghost" size="sm">Ghost</button>
    <tv-icon name="notification"></tv-icon>
  </div>
`;

// The common case: an ordinary story handing content to the decorator. Sizing
// the frame is what makes it a box on the stage; the default document is the
// design system, so the buttons carry the package's styling and the icon
// renders — proof the stylesheet is adopted and the elements registered.
export const Default: FrameStory = {
  parameters: { frame: { width: 640, height: 400 } },
  render: () => CONTROLS,
};

// The same markup in a document with nothing in it. The buttons fall back to
// the browser's own styling and <tv-icon> stays an unknown, unrendered element
// — the clean room the foundation spec needs, where only its own data styles
// the frame.
export const Blank: FrameStory = {
  parameters: { frame: { name: "blank", width: 640, height: 400 } },
  render: () => CONTROLS,
};

// What the parameter cannot express: two independent documents side by side.
// Each box is its own realm, so they cannot style or register over each other.
// Opts out of the decorator's framing, since it builds its own.
export const TwoBoxes = {
  parameters: { frame: false },
  render: () => {
    const row = document.createElement("div");
    row.style.cssText = "display: flex; gap: 16px;";
    for (const label of ["left", "right"]) {
      row.append(
        frame(
          { width: 320, height: 220 },
          `${CONTROLS}<p style="padding: 0 var(--space-16, 16px)">Box: ${label}</p>`,
        ),
      );
    }
    return row;
  },
};

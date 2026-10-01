import type { Meta } from "@storybook/web-components-vite";
import type { FrameContent, FrameStory } from "../../../lib/frame.ts";
import { COLOR_GROUPS, TINT_BACKGROUNDS, tokenGallery } from "./staging.ts";

const meta: Meta = {
  title: "Specs/Foundation",
  parameters: { frame: { name: "blank" },
    layout: "fullscreen",
    // Spec staging wires no events and scripts no interactions — hide the
    // permanently empty panels; Controls stays for the background dropdown.
    actions: { disable: true },
    interactions: { disable: true },
  },
};

export default meta;

// The foundation token spec rendered group by group — one story per group,
// so each scale is reviewed on its own. Every story stages into the shared
// "foundation" isolated frame with an empty boot list: a clean-room document
// the app stylesheet never loads into, so the gallery shows the tokens
// exactly as specified. The gallery injects the spec's own CSS
// (fonts.css + tokens.css) into the frame and enumerates the tokens back
// out of that sheet — whichever groups a story shows, the alpha values the
// tint chips reference are readable from the same sheet.
function gallery(groups: string[], background?: string): FrameContent {
  return (doc: Document) => {
    doc.body.append(tokenGallery(doc, groups, background));
  };
}

// Spacing renders as padding: a tinted frame whose padding is the token,
// wrapping a content chip.
export const Spacing: FrameStory = {
  render: () => gallery(["spacing"]),
};

export const Radius: FrameStory = {
  render: () => gallery(["radius"]),
};

// The fixed palettes as chip grids — one grid per group, each chip filled
// with its token's value, name and value printed inside.
export const Colors: FrameStory = {
  render: () => gallery([...COLOR_GROUPS]),
};

// All typography on one screen, drawing on both the fonts and type groups:
// a specimen card per family token (content set through the realized
// variables), the pangram across Hind's 300–700 variable weight range with
// the body weight marked, the type-scale ladder with resolved pixel sizes
// read back from the browser, and the authored knobs as a data list.
// The spec's fonts.css loads the committed Hind cut into the frame;
// staging asserts the load with a visible error banner.
export const Type: FrameStory = {
  render: () => gallery(["type"]),
};

// The tint scale as a palette grid: every chip runs the token's own
// currentColor color-mix expression against the ground picked in the
// story's Controls panel — switching grounds shows the same tokens
// re-resolving against a new foreground. The alpha strengths the scale
// draws are printed in the chip labels; the footnotes carry the alpha-*
// usage guidance, so no separate alpha story.
export const Tint: FrameStory = {
  tags: ["panel"],
  args: { background: "white" },
  argTypes: {
    background: {
      control: "select",
      options: Object.keys(TINT_BACKGROUNDS),
    },
  },
  render: (args) => gallery(["tint"], args.background as string),
};

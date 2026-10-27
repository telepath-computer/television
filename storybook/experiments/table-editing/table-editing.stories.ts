// Non-binding experiment for trying proposed Table editing behaviour before
// it is specified. Nothing in production conforms to these stories.

import "../../../specs/ui/foundation/index.css";
import "./styles.css";
import { createTableEditingExperiment, type TableEditingArgs, type TableEditingState } from "./table-editing.ts";

const blank: TableEditingState = {
  columns: {},
  rows: {},
};

const blankWithHeader: TableEditingState = {
  showHeader: true,
  columns: {},
  rows: {},
};

const parks: TableEditingState = {
  showHeader: true,
  columns: {
    c1: { order: 1, name: "Park" },
    c2: { order: 2, name: "State" },
    c3: { order: 3, name: "Open" },
    c4: { order: 4, name: "Rating" },
    c5: { order: 5, name: "Notes" },
    c6: { order: 6, name: "Details" },
  },
  rows: {
    r1: { order: 1, cells: { c1: "Acadia", c2: "Maine", c3: "true", c4: "4.9", c5: "Granite peaks, woodland paths and the rocky Atlantic coast.", c6: '{"region":"Northeast"}' } },
    r2: { order: 2, cells: { c1: "Arches", c2: "Utah", c3: "true", c4: "4.8", c5: "More than two thousand natural sandstone arches.", c6: '{"region":"West"}' } },
    r3: { order: 3, cells: { c1: "Everglades", c2: "Florida", c3: "false", c4: "4.6", c5: "A slow river of grass, mangroves and coastal prairie.", c6: '{"region":"South"}' } },
    r4: { order: 4, cells: { c1: "Olympic", c2: "Washington", c3: "true", c4: "4.8", c5: "Glacier-capped mountains, old-growth rainforest and a wild Pacific shoreline.", c6: '{"region":"West"}' } },
    r5: { order: 5, cells: { c1: "Yosemite", c2: "California", c3: "true", c4: "4.9", c5: "Waterfalls, deep valleys, grand meadows and ancient giant sequoias.", c6: '{"region":"West"}' } },
    r6: { order: 6, cells: { c1: "Zion", c2: "Utah", c3: "true", c5: "Sandstone cliffs above a narrow canyon.", c6: '{"region":"West"}' } },
  },
};

const noNames: TableEditingState = {
  showHeader: false,
  columns: {
    c1: { order: 1 },
    c2: { order: 2 },
    c3: { order: 3 },
  },
  rows: {
    r1: { order: 1, cells: { c1: "Morning", c2: "Train", c3: "08:40" } },
    r2: { order: 2, cells: { c1: "Afternoon", c2: "Walk" } },
    r3: { order: 3, cells: { c1: "Evening", c3: "Dinner" } },
  },
};

const storyArgs = (initialState: TableEditingState, headerToggle: "shown" | "hidden" = "shown"): TableEditingArgs => ({
  initialState,
  headerToggle,
  theme: "light",
});

export default {
  title: "Experiments/Table editing",
  parameters: {
    layout: "fullscreen",
    docs: { story: { inline: false, height: "760px" } },
  },
  argTypes: {
    initialState: { control: false, table: { disable: true } },
    headerToggle: {
      name: "Header context-menu item",
      control: "inline-radio",
      options: ["shown", "hidden"],
    },
    theme: { control: "inline-radio", options: ["light", "dark"] },
  },
  render: createTableEditingExperiment,
};

/** An untouched table draws four virtual rows and columns without storing them. */
export const Blank = { args: storyArgs(blank) };

/** A blank table whose data explicitly asks for editable column headers. */
export const BlankWithHeader = { name: "Blank with header", args: storyArgs(blankWithHeader) };

/** The current Table story's parks converted to the proposed string-cell shape. */
export const Parks = { args: storyArgs(parks) };

/** Stored columns can remain unnamed while reference strips identify positions. */
export const NoNames = { name: "No names", args: storyArgs(noNames) };

/** A blank table whose row and column menus omit the agent-owned header setting. */
export const BlankNoToggle = { name: "Blank, no toggle", args: storyArgs(blank, "hidden") };

/** Named parks columns stay visible while their menus omit the header setting. */
export const ParksNoToggle = { name: "Parks, no toggle", args: storyArgs(parks, "hidden") };

import type { Meta, StoryObj } from "@storybook/web-components-vite";
import { tmuxMock } from "./tmux.ts";
import { tabPrototypeMock } from "./tab-prototype.ts";
import { membersPrototypeMock } from "./members-prototype.ts";

// Design workshop (not a spec): mockup 2 — the tmux model (screens in a
// rail, tabs per screen, each tab a pane-group). One flat group: a story per
// tab-style variant, with the interactive prototypes alongside their styles.

const meta: Meta = {
  title: "Design/Redesign/Tab groups",
  parameters: { frame: false, layout: "fullscreen" },
};

export default meta;

export const Tabs: StoryObj = {
  render: () => tmuxMock("tabs"),
};

// Drag to merge/break-out groups, double-click to rename.
export const TabsPrototype: StoryObj = {
  name: "Tabs (prototype)",
  render: () => tabPrototypeMock(),
};

export const Minimap: StoryObj = {
  render: () => tmuxMock("minimap"),
};

export const LeadCount: StoryObj = {
  name: "Lead count",
  render: () => tmuxMock("lead-count"),
};

export const Expandable: StoryObj = {
  render: () => tmuxMock("expandable"),
};

export const SplitTabs: StoryObj = {
  name: "Split tabs",
  render: () => tmuxMock("members"),
};

// Chips per artifact; click to open, drag a chip out to break it out.
export const SplitTabsPrototype: StoryObj = {
  name: "Split tabs (prototype)",
  render: () => membersPrototypeMock(),
};

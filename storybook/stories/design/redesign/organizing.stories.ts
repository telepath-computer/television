import type { Meta, StoryObj } from "@storybook/web-components-vite";
import { groupedNavMock } from "./grouped-nav.ts";
import { tabViewsMock } from "./tab-views.ts";
import { artifactPanelMock } from "./artifact-panel.ts";
import { artifactSidebarMock } from "./artifact-sidebar.ts";

// Design workshop (not a spec): approaches to organizing many artifacts on a
// screen — here, viewing twelve project plans. Grouped nav, view-type as a
// property of the tab, a pinnable artifact panel, or one artifact with its
// own sidebar.

const meta: Meta = {
  title: "Design/Redesign/Organizing",
  parameters: { frame: false, layout: "fullscreen" },
};

export default meta;

// Approach 1 — grouped artifacts; nav sits top or left, flipped from the
// "Nav" toggle in the Storybook toolbar (see manager.ts).
export const GroupedNav: StoryObj = {
  name: "Grouped nav (top / left)",
  tags: ["orient"],
  render: (_args, { globals }: { globals: { orient?: string } }) =>
    groupedNavMock(globals.orient === "top" ? "top" : "left"),
};

// Approach 2 — the tab's view type (split / sidebar / grid) is switchable.
export const ViewTypes: StoryObj = {
  name: "Tab view types",
  render: () => tabViewsMock(),
};

// Tabs by default, plus a per-screen artifact panel you can pin open — a
// sidebar for the heavy screens (a plan per project), nothing on light ones.
export const ArtifactPanel: StoryObj = {
  name: "Artifact panel",
  render: () => artifactPanelMock(),
};

// One artifact carrying its own sidebar — the twelve plans consolidated into a
// single "Project plans" artifact whose sidebar navigates them.
export const ArtifactSidebar: StoryObj = {
  name: "Artifact + sidebar",
  render: () => artifactSidebarMock(),
};

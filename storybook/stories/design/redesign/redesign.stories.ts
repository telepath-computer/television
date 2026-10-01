import type { Meta, StoryObj } from "@storybook/web-components-vite";
import { scrollingMock } from "./scrolling.ts";
import { scalingMock } from "./scaling.ts";

// Design workshop (not a spec): the three artifact-surface mockups.
// Mockup 2 (the tmux rail/tabs/panes model) lives in Design/Redesign/Tmux
// with one story per tab-style variant.

const meta: Meta = {
  title: "Design/Redesign",
  parameters: { frame: false, layout: "fullscreen" },
};

export default meta;

// Mockup 1 — today's free-scrolling strip, plus a screens rail and a
// full-screen mode on every card.
export const Scrolling: StoryObj = {
  render: () => scrollingMock(),
};

// Mockup 3 — the in-between: grouped layout language on the strip, flat
// per-artifact tabs that anchor their artifact to the left edge.
export const SlidingTabs: StoryObj = {
  name: "Sliding tabs",
  render: () => scalingMock(),
};

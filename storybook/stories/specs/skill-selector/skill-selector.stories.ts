import type { Meta } from "@storybook/web-components-vite";
import type { FrameStory } from "../../../lib/frame.ts";
import { demo, stage } from "./staging.ts";
import template from "../../../../specs/ui/app/skill-selector/template.liquid";

const meta: Meta = {
  title: "Specs/Skill selector",
  parameters: { frame: { name: "ui" }, layout: "fullscreen" },
};

export default meta;

// Interactive staging of the spec template: the trigger toggles the popover,
// outside click and Escape dismiss it, and each card's copy button works.
export const Demo: FrameStory = {
  render: () => demo(),
};

export const Open: FrameStory = {
  render: () => stage("open", template()),
};

export const TriggerOnly: FrameStory = {
  render: () => stage("trigger-only", template()),
};

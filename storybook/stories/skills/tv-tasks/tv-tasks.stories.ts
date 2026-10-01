import type { Meta, StoryObj } from "@storybook/web-components-vite";
import { skillbenchFrame } from "../../../lib/skillbench-frame.ts";

// The tv-tasks skill's story file: state stories as this skill grows spec
// staging, and the Preview leaf embedding skillbench for its eval outputs
// (specs/arch/making-skills.md).

const meta: Meta = {
  title: "Specs/Skills/Tasks",
  parameters: { layout: "fullscreen" },
};

export default meta;

export const Preview: StoryObj = {
  render: () => skillbenchFrame("storybook/skill-evals/tv-tasks.json", "tv-tasks evals"),
};

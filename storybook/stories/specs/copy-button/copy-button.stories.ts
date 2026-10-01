import type { Meta } from "@storybook/web-components-vite";
import type { FrameStory } from "../../../lib/frame.ts";
import { demoVariants, stageVariants, type CopyButtonArgs } from "./staging.ts";

const meta: Meta = {
  title: "Specs/Copy button",
  parameters: { frame: { name: "ui" }, layout: "fullscreen" },
};

export default meta;

const SAMPLE_PROMPT = "Create a calendar artifact for …";

// The variants the callers use today: ghost (skill-selector) and primary
// (update-notification).
const VARIANTS: CopyButtonArgs[] = [
  { label: "Copy prompt", prompt: SAMPLE_PROMPT, variant: "ghost" },
  { label: "Copy update prompt", prompt: SAMPLE_PROMPT, variant: "primary" },
];

// Interactive: each stacked button copies its prompt and briefly confirms.
export const Demo: FrameStory = {
  render: () => demoVariants(VARIANTS),
};

export const Idle: FrameStory = {
  render: () => stageVariants("idle", VARIANTS),
};

export const Copied: FrameStory = {
  render: () => stageVariants("copied", VARIANTS, true),
};

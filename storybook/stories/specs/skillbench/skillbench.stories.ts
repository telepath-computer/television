import type { Meta, StoryObj } from "@storybook/web-components-vite";
import type { FrameContent, FrameStory } from "../../../lib/frame.ts";
import { skillbenchFrame } from "../../../lib/skillbench-frame.ts";
import template from "../../../../specs/ui/skillbench/template.liquid";

// Stages the skillbench ui spec (specs/ui/skillbench/) with sample data.
// The implementation is packages/skillbench/public/, held to this by
// review; the live page is embedded per skill as its Preview leaf.

const SAMPLE = {
  title: "Errands checklist",
  prompt:
    "Read the SKILL.md staged in the current directory and follow it. Author this artifact: a simple errands checklist: five short tasks, no due dates or tags, one already checked off. Write index.html into the current directory.",
  // Jobs with output first, not-run at the bottom, per the spec's ordering point.
  jobs: [
    { name: "Errands checklist", active: true, hasOutput: true },
    { name: "Today list", hasOutput: false },
    { name: "Project sections", hasOutput: false },
    { name: "Urgent standout", hasOutput: false },
    { name: "Sprint with counts", hasOutput: false },
  ],
  sizes: [
    { label: "Default — 4×6 units (528×800)", selected: true },
    { label: "Max width — 8×6 units (1072×800)" },
    { label: "Narrow — 2×6 units (256×800)" },
  ],
};

function staged(args = {}): FrameContent {
  return (doc: Document) => {
    const { markup, styles } = template({ ...SAMPLE, ...args });
    const style = doc.createElement("style");
    style.textContent = styles.join("\n");
    doc.head.append(style);
    doc.body.innerHTML = markup;
  };
}

const meta: Meta = {
  title: "Specs/Internal tools/Skillbench",
  parameters: { frame: { name: "blank" }, layout: "fullscreen" },
};

export default meta;

export const Reviewing: FrameStory = {
  render: () => staged(),
};

export const NotRun: FrameStory = {
  name: "Not run",
  render: () =>
    staged({
      title: "Today list",
      notRun: true,
      jobs: SAMPLE.jobs.map((j) => ({ ...j, active: j.name === "Today list" })),
    }),
};

export const Impl: StoryObj = {
  name: "Impl (live)",
  parameters: { frame: false },
  render: () => skillbenchFrame("storybook/skill-evals/tv-tasks.json", "implementation"),
};

import type { Meta, StoryObj } from "@storybook/web-components-vite";
import { frame } from "../../../lib/frame.ts";
import { skillbenchFrame } from "../../../lib/skillbench-frame.ts";
import template from "../../../../specs/ui/skills/sidebar-view/template.liquid";

// Stages the sidebar-view skill spec template
// (specs/ui/skills/sidebar-view/) in an isolated frame: the template's
// rendered markup and styles inside the staging chrome, with example
// sidebar data supplied here (staging content, not spec content).

const task = (title: string, meta = "") =>
  `<div class="staged-task"><span class="box"></span>${title}${meta ? `<span class="meta">${meta}</span>` : ""}</div>`;

const VIEWS = [
  {
    item: "all-tasks",
    shown: true,
    html: `<h1>All tasks</h1>${task("Call the paper supplier about cover stock", "Riso zine · today")}${task("Book the van for the studio move", "Studio move · Fri")}${task("Patch the tandem's rear tube", "Tandem")}${task("Send floor plan to the insurance broker", "Insurance")}${task("Collect the drum cartridge from the depot", "Riso zine")}`,
  },
  {
    item: "riso-zine-3",
    html: `<h1>Launch riso zine issue 3</h1><p>Issue 3 goes to print at the end of the month. Cover stock is the open question — the supplier's 270gsm recycled needs a test run before committing.</p>${task("Call the paper supplier about cover stock", "today")}${task("Collect the drum cartridge from the depot")}`,
  },
  {
    item: "studio-move",
    html: `<h1>Move studio to carriage works</h1><p>Keys on the 1st. The riso and the flat files need the van; everything else fits the wagon.</p>${task("Book the van for the studio move", "Fri")}`,
  },
  {
    item: "tandem",
    html: `<h1>Fix up the tandem bike</h1>${task("Patch the tandem's rear tube")}`,
  },
  {
    item: "insurance",
    html: `<h1>Print-shop insurance</h1><p>Broker wants the floor plan and the equipment list before quoting.</p>${task("Send floor plan to the insurance broker")}`,
  },
];

const SAMPLE = {
  views: VIEWS,
  groups: [
    {
      items: [{ id: "all-tasks", label: "All tasks", selected: true }],
    },
    {
      title: "Projects",
      items: [
        { id: "riso-zine-3", label: "Launch riso zine issue 3" },
        { id: "studio-move", label: "Move studio to carriage works" },
        { id: "tandem", label: "Fix up the tandem bike" },
        { id: "insurance", label: "Print-shop insurance" },
      ],
    },
  ],
};

// The canonical artifact stylesheet supplies the tokens the spec styles
// use — the same sheet the shipped artifact links at runtime.
const STYLESHEETS = [
  "/canonical/v2/styles.css",
  "/lib/storybook.css",
  "/stories/skills/tv-sidebar-view/staging.css",
];

// This staging is itself a stage — it holds its own box inside the frame — so
// it links the staging stylesheet into that document; preview styles do not
// cross an iframe boundary.
//
// Its behavior module is story-specific, which a shared frame document cannot
// express. A script element created through the child document does execute
// (unlike one assigned via innerHTML), so the builder appends it after the
// markup exists.
function staged(): HTMLElement {
  return frame({ name: "blank" }, (doc) => {
    for (const href of STYLESHEETS) {
      const link = doc.createElement("link");
      link.rel = "stylesheet";
      link.href = href;
      doc.head.append(link);
    }

    const { markup, styles } = template(SAMPLE);
    if (styles.length > 0) {
      const style = doc.createElement("style");
      style.textContent = styles.join("\n");
      doc.head.append(style);
    }
    doc.body.className = "storybook-stage";
    doc.body.innerHTML = `
      <div class="storybook-frame" style="width: 720px; height: 920px">${markup}</div>
      <div class="storybook-caption">Sidebar view — example sidebar</div>
    `;

    const behavior = doc.createElement("script");
    behavior.type = "module";
    behavior.src = "/stories/skills/tv-sidebar-view/staging-behavior.ts";
    doc.head.append(behavior);
  });
}

const meta: Meta = {
  title: "Specs/Skills/Sidebar View",
  parameters: { frame: false, layout: "fullscreen" },
};

export default meta;

export const Template: StoryObj = {
  render: () => staged(),
};

export const Preview: StoryObj = {
  render: () => skillbenchFrame("storybook/skill-evals/tv-sidebar-view.json", "tv-sidebar-view evals"),
};

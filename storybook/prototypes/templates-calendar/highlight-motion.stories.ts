// A non-binding motion demo of the Calendar highlight lifting; not part of the spec, and nothing conforms to it.
//
// It reuses the markup and stylesheet of the Calendar spec stories
// (storybook/spec/templates/calendar/) in their one-day state, and raises the
// launch rehearsal a moment after load so the lift can be watched.

import spec, { OneDay } from "../../spec/templates/calendar/calendar.stories.ts";

// How long after loading the highlight is added.
const LIFT_DELAY_MS = 1700;

type Play = { canvasElement: HTMLElement };

export default {
  title: "Prototypes/Templates/Calendar",
  parameters: spec.parameters,
  globals: spec.globals,
  render: spec.render,
  args: spec.args,
};

export const HighlightMotion = {
  name: "Highlight motion",
  globals: OneDay.globals,
  parameters: OneDay.parameters,
  args: OneDay.args,
  play: async (context: Play) => {
    spec.play(context);
    await new Promise((resolve) => setTimeout(resolve, LIFT_DELAY_MS));
    context.canvasElement.querySelector('calendar-event[data-key="launch"]')?.setAttribute("highlight", "");
  },
};

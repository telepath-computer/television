import "../../../specs/ui/foundation/index.css";
import "../../../specs/ui/foundation/tokens/app.css";
import "./styles.css";
import { templatesPopover, type TemplateRowParams, type TemplatesPopoverParams } from "./templates-popover.ts";
import { html } from "../../lib/html.ts";
import calendarImage from "../../spec/templates-popover/thumbnails/calendar.png";
import tableImage from "../../spec/templates-popover/thumbnails/table.png";
import tasksImage from "../../spec/templates-popover/thumbnails/tasks.png";
import markdownImage from "../../spec/templates-popover/thumbnails/markdown.png";

const templates: TemplateRowParams[] = [
  { name: "Calendar", description: "A week calendar for events supplied by an agent.", image: calendarImage },
  { name: "Markdown", description: "A document you and an agent can both edit.", image: markdownImage },
  { name: "Table", description: "Records in rows and columns, updated as they change.", image: tableImage },
  { name: "Tasks", description: "A checklist of tasks with due dates and labels.", image: tasksImage },
];

export default {
  title: "Experiments/Rejected/Templates popover, accent selection",
  render: (args: TemplatesPopoverParams) => html`
    <div style="display: flex; flex-direction: column; align-items: flex-end; gap: var(--popover-distance)">
      ${templatesPopover(args)}
    </div>`,
  args: { open: true, search: "", templates, selected: 0, errors: 0 },
};

// A dense list with the search field as header, one row selected in the
// accent colour, and a footer.
export const ListWithAccentSelection = {};

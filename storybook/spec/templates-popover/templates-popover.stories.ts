// The Templates popover's spec: each story is one state, with its markup
// written here. The prose is specs/ui/app/templates-popover.mdx;
// the styles are styles.css, beside this file.

import "../../../specs/ui/foundation/index.css";
import "../../../specs/ui/foundation/tokens/app.css";
import "./styles.css";
import { html, Html } from "../../lib/html.ts";
import iconFrame from "../../../specs/ui/foundation/icons/icon.frame";
import calendarImage from "./thumbnails/calendar.png";
import tableImage from "./thumbnails/table.png";
import checklistImage from "./thumbnails/tasks.png";
import markdownImage from "./thumbnails/markdown.png";

const icon = (params: { name: string; size?: string }): Html =>
  new Html(iconFrame.render(params, { serializableShadowRoots: true }));

interface Template {
  name: string;
  image?: string;
}

interface InvalidTemplate {
  folder: string;
  error: string;
}

interface Args {
  open: boolean;
  search: string;
  templates: Template[];
  highlighted: number | null;
  // In the app this is the pointer's press; stories set it to show the state.
  pressed: number | null;
  invalid: InvalidTemplate[];
  folderError: string | null;
}

const tile = ({ name, image }: Template, index: number, highlighted: boolean, pressed: boolean) => html`
  <li role="option" id="template-${index}" class="template-tile"${highlighted ? html` data-highlighted` : ""}${pressed ? html` data-pressed` : ""}>
    <span class="template-tile-card">${image ? html`<img src="${image}" alt="" draggable="false">` : icon({ name: "artifact" })}</span>
    <span class="template-tile-name">${name}</span>
  </li>`;

const invalidRow = ({ folder, error }: InvalidTemplate) => html`
  <li class="template-invalid">
    ${icon({ name: "warning" })}
    <span class="template-invalid-text">
      <span class="template-invalid-folder">${folder}</span>
      <span>${error}</span>
    </span>
  </li>`;

// The trigger sits near the navbar's trailing end, so the panel aligns its
// right edge with the trigger's and opens below it, as the popover spec
// places it.
const render = ({ open, search, templates, highlighted, pressed, invalid, folderError }: Args) => {
  // The search field controls the grid only while there is one.
  const showGrid = folderError === null && templates.length > 0;
  return html`
  <div style="display: flex; flex-direction: column; align-items: flex-end; gap: var(--popover-distance)">
    <button class="templates-trigger" id="templates-trigger" icon variant="ghost" aria-label="Templates" title="Templates" aria-expanded="${open ? "true" : "false"}">${icon({ name: "skills", size: "sm" })}</button>
    <tv-popover class="templates-popover" trigger="templates-trigger"${open ? html` open` : ""}>
      <h2 class="templates-heading">Artifact templates</h2>
      <p class="templates-intro">Each template is a kind of artifact. Click one to add it to this channel. To make your own, ask your agent.</p>
      <label class="templates-search">
        ${icon({ name: "search" })}
        <input type="text" role="combobox" placeholder="Search templates" aria-label="Search templates"${showGrid ? html` aria-expanded="true" aria-controls="templates-grid"` : html` aria-expanded="false"`}${showGrid && highlighted !== null ? html` aria-activedescendant="template-${highlighted}"` : ""} value="${search}">
      </label>
      <div class="templates-body">
        ${folderError !== null
          ? html`<div class="templates-folder-error">${icon({ name: "warning" })}<span class="template-invalid-text"><span class="template-invalid-folder">Television couldn't read the templates folder.</span><span>${folderError}</span></span></div>`
          : templates.length > 0
            ? html`<ul class="templates-grid" id="templates-grid" role="listbox" aria-label="Templates">${templates.map((t, i) => tile(t, i, i === highlighted, i === pressed))}</ul>`
            : search === "" && invalid.length > 0
              ? html`<p class="templates-empty">No valid templates. Ask your agent to fix or make one.</p>`
              : search === ""
              ? html`<p class="templates-empty">No templates yet. Ask your agent to make one.</p>`
              : html`<p class="templates-empty">No templates match “${search}”.</p>`}
        ${invalid.length > 0
          ? html`<ul class="templates-invalid" aria-label="Templates with errors">${invalid.map(invalidRow)}</ul>`
          : ""}
      </div>
    </tv-popover>
  </div>`;
};

// Sample templates show the grid with real thumbnails.
const calendar: Template = { name: "Calendar", image: calendarImage };

const templates: Template[] = [
  calendar,
  { name: "Checklist", image: checklistImage },
  { name: "Markdown", image: markdownImage },
  { name: "Table", image: tableImage },
];

export default {
  title: "Spec/Templates popover",
  render,
  args: { open: true, search: "", templates, highlighted: null, pressed: null, invalid: [], folderError: null } satisfies Args,
};

export const Closed = { args: { open: false } };

export const Open = {};

// The pointer is over the second tile, or the arrow keys moved there: one
// highlight serves both.
export const Highlighted = { args: { highlighted: 1 } };

// The second tile is being pressed.
export const Pressed = { args: { highlighted: 1, pressed: 1 } };

// Typing highlights the first match, so Return creates it.
export const Searching = {
  args: { search: "c", templates: templates.filter((t) => /c/i.test(t.name)), highlighted: 0 },
};

export const NoMatches = { args: { search: "spreadsheet", templates: [] } };

// The templates folder is empty.
export const NoTemplates = { args: { templates: [] } };

// The templates folder holds only folders with errors.
export const OnlyErrors = {
  args: { templates: [], invalid: [{ folder: "my-template", error: "manifest.json is missing a description." }] },
};

// The templates folder itself cannot be read.
export const FolderUnreadable = {
  args: { templates: [], folderError: "EACCES: permission denied, scandir '/home/me/.television/templates'" },
};

export const WithoutImage = { args: { templates: [calendar, { name: "Notebook" }] } };

export const LongName = {
  args: { templates: [{ name: "A template with a much longer name than usual", image: markdownImage }, calendar] },
};

export const WithErrors = {
  args: { invalid: [{ folder: "my-template", error: "manifest.json is missing a description." }] },
};

export const MultipleErrors = {
  args: {
    invalid: [
      { folder: "my-template", error: "manifest.json is missing a description." },
      { folder: "weekly-review", error: "index.html is missing." },
      { folder: "old-dashboard", error: "manifest.json is not valid JSON." },
    ],
  },
};

export const LongError = {
  args: {
    invalid: [
      {
        folder: "a-template-folder-with-a-very-long-name-that-keeps-going",
        error:
          "manifest.json is missing a description, its version \"1.0\" is not a valid Semantic Version, and data.json is larger than the store's 1 MiB limit.",
      },
    ],
  },
};

// Enough templates that the grid scrolls under the fixed heading and search.
export const ManyTemplates = {
  args: {
    templates: [
      ...templates,
      { name: "Weekly review", image: markdownImage },
      { name: "Reading list", image: checklistImage },
      { name: "Budget", image: tableImage },
      { name: "Trip plan", image: calendarImage },
      { name: "Meeting notes", image: markdownImage },
      { name: "Packing list", image: checklistImage },
      { name: "Contacts", image: tableImage },
      { name: "Habits", image: checklistImage },
      { name: "Notebook" },
    ].sort((a, b) => a.name.localeCompare(b.name, "en")),
  },
};

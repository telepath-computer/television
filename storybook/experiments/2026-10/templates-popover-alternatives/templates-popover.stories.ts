// Historical Templates popover alternatives. This dated experiment has no
// current UI authority; its styles remain beside this file.

import "../../../../specs/ui/foundation/index.css";
import "../../../../specs/ui/foundation/tokens/app.css";
import "./styles.css";
import { html, Html } from "../../../lib/html.ts";
import iconFrame from "../../../../specs/ui/foundation/icons/icon.frame";
import calendarImage from "../../../../specs/ui/app/skill-selector/thumbnails/calendar.png";
import tableImage from "../../../../specs/ui/app/skill-selector/thumbnails/table.png";
import checklistImage from "../../../../specs/ui/app/skill-selector/thumbnails/tasks.png";
import markdownImage from "../../../../specs/ui/app/skill-selector/thumbnails/markdown.png";

const icon = (params: { name: string; size?: string }): Html =>
  new Html(iconFrame.render(params, { serializableShadowRoots: true }));

interface Template {
  name: string;
  description: string;
  // Without an image, the row shows a placeholder.
  image?: string;
}

interface InvalidTemplate {
  folder: string;
  error: string;
}

interface Args {
  open: boolean;
  // The text in the search field.
  search: string;
  // The templates that match the search, in list order.
  templates: Template[];
  // The highlighted row's index, or null when no row is highlighted.
  highlighted: number | null;
  invalid: InvalidTemplate[];
  // Historical alternative: an ordinary bordered search field on
  // the muted bar, instead of a borderless one.
  fieldSearch?: boolean;
  // Historical alternative: templates as grabbable tiles in a grid,
  // with their names underneath, instead of a list.
  tiles?: boolean;
  // The tiles tilted in 3D, with stronger shadows.
  tilted?: boolean;
  // The index of the tile being pressed, or null. Shown only in stories; in
  // the app it is the pointer's press.
  pressed?: number | null;
}

const row = ({ name, description, image }: Template, index: number, highlighted: boolean) => html`
  <li role="option" id="alternative-template-row-${index}" class="alternative-template-row"${highlighted ? html` data-highlighted` : ""}>
    <span class="alternative-template-image">${image ? html`<img src="${image}" alt="">` : icon({ name: "artifact" })}</span>
    <span class="alternative-template-text">
      <span class="alternative-template-name">${name}</span>
      <span class="alternative-template-description">${description}</span>
    </span>
  </li>`;

const tile = ({ name, image }: Template, index: number, highlighted: boolean, pressed: boolean) => html`
  <li role="option" id="alternative-template-row-${index}" class="alternative-template-tile"${highlighted ? html` data-highlighted` : ""}${pressed ? html` data-pressed` : ""}>
    <span class="alternative-template-tile-card">${image ? html`<img src="${image}" alt="">` : icon({ name: "artifact" })}</span>
    <span class="alternative-template-tile-name">${name}</span>
  </li>`;

const invalidRow = ({ folder, error }: InvalidTemplate) => html`
  <li class="alternative-template-invalid">
    ${icon({ name: "warning" })}
    <span class="alternative-template-text">
      <span class="alternative-template-name">${folder}</span>
      <span class="alternative-template-description">${error}</span>
    </span>
  </li>`;

// The trigger sits near the navbar's trailing end, so the panel aligns its
// right edge with the trigger's and opens below it, as the popover spec
// places it.
const render = ({ open, search, templates, highlighted, invalid, fieldSearch = false, tiles = false, tilted = false, pressed = null }: Args) => html`
  <div style="display: flex; flex-direction: column; align-items: flex-end; gap: var(--popover-distance)">
    <button class="alternative-templates-trigger" id="alternative-templates-trigger" icon variant="ghost" aria-label="Templates" title="Templates" aria-expanded="${open ? "true" : "false"}">${icon({ name: "skills", size: "sm" })}</button>
    <tv-popover class="alternative-templates-popover${tiles ? " alternative-templates-popover-tiles" : ""}${tilted ? " alternative-templates-popover-tilted" : ""}" trigger="alternative-templates-trigger"${open ? html` open` : ""}>
      ${fieldSearch
        ? html`<h2 class="alternative-templates-heading">Artifact templates</h2>
          <p class="alternative-templates-intro">Each template is a kind of artifact. Click one to add it to this channel. To make your own, ask your agent.</p>`
        : ""}
      <label class="alternative-templates-search${fieldSearch ? " alternative-templates-search-field" : ""}">
        ${icon({ name: "search" })}
        <input type="text" role="combobox" placeholder="Search templates" aria-label="Search templates" aria-expanded="true" aria-controls="alternative-templates-list"${highlighted === null ? "" : html` aria-activedescendant="alternative-template-row-${highlighted}"`} value="${search}">
      </label>
      <div class="alternative-templates-body">
        ${templates.length > 0
          ? html`<ul class="${tiles ? "alternative-templates-tiles" : "alternative-templates-list"}" id="alternative-templates-list" role="listbox" aria-label="Templates">${templates.map((t, i) => (tiles ? tile(t, i, i === highlighted, i === pressed) : row(t, i, i === highlighted)))}</ul>`
          : html`<p class="alternative-templates-empty">No templates match “${search}”.</p>`}
        ${invalid.length > 0
          ? html`<div class="alternative-templates-section">Templates with errors</div><ul class="alternative-templates-list">${invalid.map(invalidRow)}</ul>`
          : ""}
      </div>
    </tv-popover>
  </div>`;

const calendar: Template = {
  name: "Calendar",
  description: "A week calendar for events supplied by an agent.",
  image: calendarImage,
};

const templates: Template[] = [
  calendar,
  { name: "Markdown", description: "A document you and an agent can both edit.", image: markdownImage },
  { name: "Table", description: "Records in rows and columns, updated as they change.", image: tableImage },
  { name: "Checklist", description: "A simple list to add to and check off.", image: checklistImage },
];

export default {
  title: "Experiments/2026-10/Templates popover alternatives",
  render,
  args: { open: true, search: "", templates, highlighted: null, invalid: [] } satisfies Args,
};

// A list with a muted, borderless search bar as the header.
export const ListWithMutedSearchBar = {};

// A list under an "Artifact templates" heading and a bordered search field.
export const ListWithHeadingAndSearchField = { args: { fieldSearch: true } };

// Tiles tilted in 3D, with stronger shadows.
export const TiltedTiles = { args: { fieldSearch: true, tiles: true, tilted: true } };

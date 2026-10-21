// Experiment: the Templates popover designed the way a macOS library panel
// would be. The search field is the header, one row is always selected in the
// accent colour, rows are dense, and a footer holds the folder action and any
// errors. Not a spec; the spec is storybook/spec/templates-popover/.

import { html, Html } from "../../lib/html.ts";
import iconFrame from "../../../specs/ui/foundation/icons/icon.frame";

const icon = (params: { name: string; size?: string }): Html =>
  new Html(iconFrame.render(params, { serializableShadowRoots: true }));

export interface TemplateRowParams {
  name: string;
  description: string;
  image?: string;
}

export interface TemplatesPopoverParams {
  open: boolean;
  search: string;
  templates: TemplateRowParams[];
  // The index of the selected row.
  selected: number;
  // How many template folders have errors.
  errors: number;
}

function row({ name, description, image }: TemplateRowParams, selected: boolean): Html {
  return html`<li role="option" class="xp-row" aria-selected="${selected ? "true" : "false"}">
    <span class="xp-thumb">${image ? html`<img src="${image}" alt="">` : icon({ name: "artifact" })}</span>
    <span class="xp-name">${name}</span>
    <span class="xp-description">${description}</span>
  </li>`;
}

export function templatesPopover({ open, search, templates, selected, errors }: TemplatesPopoverParams): Html {
  return html`<button class="templates-trigger" id="templates-trigger" icon variant="ghost" aria-label="Templates" title="Templates" aria-expanded="${open ? "true" : "false"}">${icon({ name: "skills", size: "sm" })}</button>
<tv-popover class="xp-popover" trigger="templates-trigger"${open ? html` open` : ""}>
  <div class="xp-search">
    ${icon({ name: "search" })}
    <input type="text" placeholder="Search templates" aria-label="Search templates" value="${search}">
  </div>
  ${templates.length > 0
    ? html`<ul class="xp-list" role="listbox" aria-label="Templates">${templates.map((t, i) => row(t, i === selected))}</ul>`
    : html`<p class="xp-empty">No results for “${search}”</p>`}
  <footer class="xp-footer">
    <button class="xp-footer-action" variant="ghost">${icon({ name: "folder" })} Open Templates Folder</button>
    ${errors > 0 ? html`<button class="xp-footer-errors" variant="ghost">${icon({ name: "warning" })} ${errors} ${errors === 1 ? "error" : "errors"}</button>` : ""}
  </footer>
</tv-popover>`;
}

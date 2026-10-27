import "../../../../specs/ui/foundation/index.css";
import "../../../../specs/ui/foundation/tokens/app.css";
import "./styles.css";
import { html, Html } from "../../../lib/html.ts";
import iconFrame from "../../../../specs/ui/foundation/icons/icon.frame";

const icon = (params: { name: string; size?: string }): Html =>
  new Html(iconFrame.render(params, { serializableShadowRoots: true }));

// The icons of the templates installed on Rupert's Television, copied here.
const icons = import.meta.glob<string>("./icons/*.svg", { eager: true, import: "default", query: "?url" });
const iconFor = (id: string) => icons[`./icons/${id}.svg`];

interface Item {
  id: string;
  name: string;
}

type Copy = "toolbox" | "saved";
type Layout = "grid" | "list";

interface Args {
  copy: Copy;
  layout: Layout;
  items: Item[];
  search: string;
  highlighted: number | null;
}

const copyText: Record<Copy, { label: string; placeholder: string; footer: string }> = {
  toolbox: {
    label: "Toolbox",
    placeholder: "Search toolbox…",
    footer: "Ask your agent to add artifacts to your toolbox, then reuse them anywhere.",
  },
  saved: {
    label: "Saved artifacts",
    placeholder: "Search saved artifacts…",
    footer: "Ask your agent to save an artifact here, then reuse it anywhere.",
  },
};

const palette = ["red", "orange", "yellow", "green", "cyan", "blue", "purple", "pink", "neutral"];
const HASH_START = 7;
const HASH_MULTIPLIER = 31;
const letterIcon = ({ id, name }: Item) => {
  const hash = [...id].reduce((value, character) => (value * HASH_MULTIPLIER + character.codePointAt(0)!) >>> 0, HASH_START);
  const color = `var(--${palette[hash % palette.length]}-600)`;
  return html`<span class="tg-icon tg-letter" aria-hidden="true" style="background: ${color}">${[...name][0].toUpperCase()}</span>`;
};

const tile = (item: Item, index: number, highlighted: boolean) => {
  const src = iconFor(item.id);
  return html`
    <li role="option" id="tg-item-${index}" class="tg-tile" aria-selected="${highlighted ? "true" : "false"}"${highlighted ? html` data-highlighted` : ""}>
      ${src ? html`<img class="tg-icon" src="${src}" alt="" draggable="false">` : letterIcon(item)}
      <span class="tg-name">${item.name}</span>
    </li>`;
};

// Everything installed on Rupert's Television.
const installed: Item[] = [
  { id: "agent-inbox", name: "Agent inbox" },
  { id: "calendar", name: "Calendar" },
  { id: "checklist", name: "Checklist" },
  { id: "code", name: "Code" },
  { id: "colour-study", name: "Color study" },
  { id: "draft-email", name: "Draft email" },
  { id: "elevation-map", name: "Elevation map" },
  { id: "feed", name: "Feed" },
  { id: "fridge-poetry", name: "Fridge poetry" },
  { id: "fastmail", name: "Inbox" },
  { id: "map", name: "Map" },
  { id: "pet", name: "Pet" },
  { id: "place", name: "Place" },
  { id: "sticky-note", name: "Sticky note" },
  { id: "table", name: "Table" },
  { id: "timeline", name: "Timeline" },
  { id: "trip", name: "Trip" },
];

// What a new installation comes with (BUNDLED_ARTIFACT_TEMPLATE_IDS), plus
// Table, which is being brought in.
const bundled = installed.filter(item => ["calendar", "checklist", "sticky-note", "table"].includes(item.id));

const panel = ({ copy, layout, items, search, highlighted }: Args) => {
  const text = copyText[copy];
  const query = search.trim().toLowerCase();
  const shown = query === "" ? items : items.filter(item => item.name.toLowerCase().includes(query));
  return html`
  <div style="display: flex; flex-direction: column; align-items: flex-end; gap: var(--popover-distance)">
    <button class="toolbox-trigger" id="tg-trigger-${layout}" icon variant="ghost" aria-label="${text.label}" title="${text.label}" aria-expanded="true">${icon({ name: "skills", size: "sm" })}</button>
    <tv-popover class="tg-popover tg-${layout}-popover" trigger="tg-trigger-${layout}" role="region" aria-label="${text.label}" open>
      <label class="tg-search">
        ${icon({ name: "search" })}
        <input type="text" role="combobox" placeholder="${text.placeholder}" aria-label="${text.placeholder.replace("…", "")}" autocomplete="off" aria-expanded="true" aria-controls="tg-${layout}" value="${search}">
      </label>
      <div class="tg-body">
        ${shown.length > 0
          ? html`<ul class="tg-${layout}" id="tg-${layout}" role="listbox" aria-label="${text.label}">${shown.map((item, i) => tile(item, i, i === highlighted))}</ul>`
          : html`<p class="tg-empty">Nothing matches “${search}”.</p>`}
      </div>
      <p class="tg-footer">${text.footer}</p>
    </tv-popover>
  </div>`;
};

const render = (args: Args) => panel(args);

export default {
  title: "Experiments/2026-10/Toolbox grid",
  render,
  args: { copy: "saved", layout: "grid", items: bundled, search: "", highlighted: null } satisfies Args,
  argTypes: {
    copy: { control: "inline-radio", options: ["saved", "toolbox"] },
    layout: { control: "inline-radio", options: ["grid", "list"] },
  },
  play: ({ canvasElement }: { canvasElement: HTMLElement }) => {
    canvasElement.querySelector<HTMLInputElement>(".tg-search input")?.focus();
  },
};

export const SavedArtifacts = { args: { copy: "saved" } };
export const Toolbox = { args: { copy: "toolbox" } };
export const Highlighted = { args: { highlighted: 1 } };
export const Searching = { args: { search: "check", highlighted: 0 } };
export const AllInstalled = { args: { items: installed } };
export const AllInstalledHighlighted = { args: { items: installed, highlighted: 4 } };

// The alternative: the current list, with bigger rows and icons.
export const List = { args: { layout: "list" } };
export const ListHighlighted = { args: { layout: "list", highlighted: 1 } };
export const ListAllInstalled = { args: { layout: "list", items: installed } };

// Both layouts together, to compare.
export const SideBySide = {
  render: (args: Args) => html`
    <div style="display: flex; gap: 48px; align-items: flex-start">
      ${panel({ ...args, layout: "grid" })}
      ${panel({ ...args, layout: "list" })}
    </div>`,
};

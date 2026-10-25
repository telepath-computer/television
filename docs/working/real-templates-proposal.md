# The first real artifact templates — proposal

**Status:** draft for Rupert, first written October 16, 2026 and updated for the October 22 linked-template decisions. This proposal explores Calendar, Table, Checklist and Markdown; it does not change the [current bundled inventory](../../specs/arch/templates/bundled-templates.md). The feature branches for Checklist and Calendar have developed their designs further. Their specs govern those designs when integrated.

Each template is an ordinary folder: `manifest.json` with embedded `dataSchema`, an `index.html` page, a `README.md` for agents, and optional local icon assets declared by manifest `icons`. Using it links an artifact to the installed folder; each artifact keeps its own store. An agent uses `--copy`, or copies and repoints an existing artifact, before editing files for just that artifact.

Templates supply no starting data. A caller can supply an optional starting value with `--data` or `--data-file`. The page renders its empty state without a value and defaults for missing fields in partial data. It must not write defaults on load: that can race with agent writes or fail for read-only share viewers. Schema `default` annotations do not supply starting values. The starting displays recommended below describe page behavior, not writes to the store.

Every page reads its store through the resource SDK and updates live when an agent writes with `tv resource json`. Lists that several writers add to are keyed maps built with `push`, with an `order` field where order matters. The `tv-*` skills no longer ship, so any component a template uses is copied into the template folder itself, as onboarding already does.

Each section gives a recommendation and the questions to settle. The recommendations start from the draft written on October 15 and set aside then, revised with the points raised about it.

## Calendar

A week view of events, using the calendar component from the former `tv-calendar` skill.

```ts
interface CalendarData {
  startDate?: string; // YYYY-MM-DD; absent: the current local week, starting Monday
  events: Record<string, {
    title: string;
    start: string;      // YYYY-MM-DDTHH:MM, or YYYY-MM-DD for all-day
    end: string;        // same form; an all-day end is exclusive
    allDay?: boolean;
    color?: "red" | "orange" | "yellow" | "green" | "blue" | "purple";
  }>;
}
```

**Recommendation.** Read-only in the page: an agent adds and changes events. It starts on the current week with no events and a one-line hint in the empty week: "Ask your agent to add events."

**To settle.**
1. Read-only, or can a person add and move events in the page? Editing makes it useful on its own but is considerably more work.
2. Week view only, or also a day or month view?

## Table

A record table in the house style of the former `tv-table` skill.

```ts
interface TableData {
  title: string;
  columns: { key: string; label: string }[];  // in display order; set by the agent
  rows: Record<string, { order: number; cells: Record<string, string> }>;
}
```

**Recommendation.** Columns come from the data rather than being fixed, so the same template serves an expense list (Item, Amount, Date) or a contact list. Read-only in the page; an agent sets the columns and adds rows. It starts with a title, three sample columns and no rows, with the hint "Ask your agent to add rows."

**To settle.**
1. Data-defined columns, as above, or a fixed set? The October 15 draft fixed Title, Status, Owner, Area and Due.
2. Should cells have types (text, number, date, status pill), or is plain text enough for the first version?
3. Read-only, or can a person sort by a column?

## Checklist

A plain list of items to tick off, simpler than the former `tv-tasks` model.

```ts
interface ChecklistData {
  title: string;
  items: Record<string, { order: number; text: string; done: boolean }>;
}
```

**Recommendation.** Fully usable by a person: add an item, edit its text, tick or untick it, remove it. Each change writes only that item through the SDK; adding uses `push`. No reordering. It starts with the title "Checklist" and no items, with the add field focused.

**To settle.**
1. Should ticked items move to the bottom, stay in place, or be hidden behind a "Show done" toggle?
2. Is drag-to-reorder needed in the first version?

## Markdown

A Markdown document, using Television's existing interactive Markdown editor (`packages/view-markdown`), with its text kept in the artifact's store instead of a file.

```ts
interface MarkdownData {
  markdown: string;
}
```

**Recommendation.** The same editor and editing gestures as Markdown file artifacts, with the editor's load and save pointed at the store's `markdown` field. An agent's write updates the open editor; the editor's own saves do not reset the caret. It starts with `# Untitled` and an empty line, focused for typing.

**To settle.**
1. If the person and an agent edit at the same moment, the last save wins, as with files today. Is that acceptable for the first version?
2. Does the template need the editor's table editing and links between documents, or plain Markdown only?

## For all four

**Toolbox and icons.** The [Toolbox](../../specs/ui/app/toolbox.mdx) lists names and icons and searches names only. Manifest descriptions remain required for agents. Optional manifest `icons` uses [W3C Web App Manifest form](https://www.w3.org/TR/appmanifest/#icons-member), with SVG or PNG files inside the folder. The [icon contract](../../specs/arch/templates/index.md#^artifact-template-icon-route) owns selection and ignored entries. Supplied icons have no added background; absent or failed icons use the default letter circle. The app and server never fetch favicons.

**Order and display.** The Toolbox retains the scan order, alphabetically by name and then ID. Each template may declare starting `display` options, including size, full-screen, and transparency; linking does not make those settings update existing artifacts.

## Data compatibility for linked templates

Editing an installed template changes every linked page while existing stores keep their values. A new schema must accept every value accepted by the previous schema, and the page must continue to render it. Adding an optional field is compatible only if its constraints do not reject values previously accepted. This is an authoring responsibility, without automatic schema comparison or store migration.

Each manifest `dataSchema` embeds a [JSON Schema Draft 2020-12](../../specs/arch/templates/index.md#^artifact-template-schema) schema object or boolean, with references confined to that schema. An invalid schema makes the template invalid. The server validates caller-supplied starting data before creating anything and writes it within the creation request. Agents use `tv templates list` to choose and `tv templates show <id>` to inspect `dataSchema` before writing. Later store writes do not enforce it.

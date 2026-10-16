# The first real artifact templates — proposal

**Status:** draft for Rupert, October 16, 2026. The template mechanism is built and in a draft PR with one placeholder template, Example. This proposal settles the four templates that ship in its place: Calendar, Table, Checklist and Markdown. The branch does not merge until they are specified and built.

Each template is an ordinary template folder: `manifest.json`, an `index.html` page, a `data.json` starting value for the artifact's JSON store, a `README.md` for an agent adapting the copy, and a portrait `thumbnail.png` (4:5, about 400 by 500 pixels). Every page reads its store through the resource SDK and updates live when an agent writes with `tv resource json`. Lists that several writers add to are keyed maps built with `push`, with an `order` field where order matters. The `tv-*` skills no longer ship, so any component a template uses is copied into the template folder itself, as onboarding already does.

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

**Settled by Rupert on October 16, 2026.** The page's look and behaviour are the spec pilot in `storybook/spec/templates/checklist/` (stories, `checklist.mdx`, `styles.css`): a sheet of paper with an editable title, items that tick, edit in place and wrap, and an "Add an item" field.

```ts
interface ChecklistData {
  title: string;
  items: Record<string, { order: number; text: string; done: boolean }>; // keys from push
}
```

Decisions:
1. Return in the title adds a new, empty item at the top and puts the caret in it; Return in an item adds a new, empty item directly below it. An item left empty is removed.
2. Done items stay in place, muted and struck through. No reordering in the first version.
3. When an agent or another viewer changes the item a person is editing, the person's text wins. Other changes show at once.
4. Read-only when the page's access to its store is `read` (a read-only share link) or `null` (no access, as after the link is revoked), detected through the SDK's `getAccess` and `onAccessChanged`; it switches live as access changes.
5. Starting size about 640 by 800 reference pixels, through the template's display options.
6. A new checklist has the title "Checklist" and no items, with the add field focused.
7. The Example template is deleted when Checklist ships; it was never released.

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

**Thumbnails.** Each template's `thumbnail.png` is a screenshot of its page holding sample data, cropped to 4:5. The agent makes them once the pages exist; Rupert approves them.

**Popover order.** The scan sorts templates alphabetically by name, so the popover shows Calendar, Checklist, Markdown, Table. Is that order fine, or should bundled templates appear in a chosen order?

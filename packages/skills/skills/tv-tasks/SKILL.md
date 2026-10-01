---
name: tv-tasks
description: Create to-do list HTML artifacts for Television, to visualize tasks, plans, check them off, etc.
---

# Authoring a task list

Know the main `television` skill first (re-read only if it's not in context or
changed) — it covers the Television workflow, artifact registration, and the
canonical HTML house style. This skill only adds the task-list vocabulary.

A calm, scannable to-do list: sections of task rows, each with a checkbox,
title, optional note, and a metadata line (due date, project, tags). You author
plain `tv-task-*` markup; the CSS and two small components do the rest.

## Load these

Every artifact is self-contained. Carry `task.css` and `task.js` from this skill
folder into the output (don't reference `/skills/tv-tasks/…` URLs).

For a directory artifact, copy both next to `index.html` and load them with the
canonical boilerplate:

```html
<link rel="stylesheet" href="/canonical/v2/styles.css?authoredForAppVersion=<version>" />
<script type="module" src="/canonical/v2/components.js"></script>
<link rel="stylesheet" href="./task.css" />
<script type="module" src="./task.js"></script>
```

For a running server, read the exact release `version` from `tv status`; when working in a Television checkout, read the exact version from the checkout root `package.json`. Copy that exact release version unchanged into `authoredForAppVersion`. A missing version or the `0.0.0` development sentinel does not identify a release, so omit the metadata.

For a single-file artifact, inline `task.css`/`task.js` into `<style>` and
`<script type="module">` tags instead. `components.js` gives you `<tv-icon>`;
`task.js` registers `<tv-task-checkbox>` and `<tv-task-meta-due>`.

A task list is not a prose document: don't add `body` padding (the house
style doc suggests it for prose) — `tv-task-list` and the page header supply
their own gutters. Leave the body at zero.

Television manages light and dark appearance. Live canonical v2 supplies the
selected theme and shared defaults; the task kit inherits its surface, text,
muted-text, and border roles. Author no `data-theme` marker or separate dark
palette. Task colors use existing semantics: primary for checked checkboxes,
`--color-primary-text` for their marks, `--color-alert` for due today and the
default highlight, and `--color-danger` for overdue.

## Markup

Author this shape — a page header, then a list of sections and rows:

```html
<header>
  <h1>Television</h1>
  <p>Wednesday, June 25</p>
</header>

<tv-task-list>
  <tv-task-section>
    <header><h2>Today</h2></header>

    <tv-task>
      <tv-task-checkbox></tv-task-checkbox>
      <tv-task-body>
        <tv-task-title>Review the task-list example</tv-task-title>
        <tv-task-note>Density, grouping, and Things-like hierarchy.</tv-task-note>
        <tv-task-meta>
          <tv-task-meta-due date="2026-06-26"></tv-task-meta-due>
          <tv-task-meta-item><tv-icon name="hash"></tv-icon>TV Skills</tv-task-meta-item>
          <tv-task-meta-tag>design</tv-task-meta-tag>
        </tv-task-meta>
      </tv-task-body>
    </tv-task>
  </tv-task-section>
</tv-task-list>
```

## Components

### `<tv-task-list>`
The list root. One per view, holding the sections (or bare rows). It draws no
frame of its own — the page is the surface, and Television's artifact frame
provides the chrome around the document.

### Headers — `<header>` + `<h1>`/`<h2>` + optional `<p>`

A page title is optional — Television's frame already names the artifact, so
a bare list is fine. Add one when the list benefits from its own masthead: a
date line ("Today" lists usually carry the date), a person, or context the
frame title doesn't say. When you do, use the house header idiom *above*
`<tv-task-list>` (not inside it): a `<header>` with an `<h1>` and optionally
a `<p>` subtitle. House styles own its look; the skill only aligns it with
the list. Title each section with an `<h2>` inside the section's own
`<header>`. Keep these as real HTML headings, not `tv-task-*`, so the
document outline stays navigable.

### `<tv-task-section>`
A titled group of rows: a `<header>` then the `<tv-task>`s. Group by one
meaningful axis — a when-bucket (Today / Upcoming / Someday), a project, or an
area. A few purposeful groups read well; one section per task defeats the point,
and a flat handful of tasks needs no sections at all. Don't render a section
with no tasks — omit it entirely unless the user asked to see the empty group.

### `<tv-task-count>`
An optional task count beside a section heading:
`<header><h2>Today</h2><tv-task-count>3</tv-task-count></header>`. Renders
inline right of the heading — muted, unbolded, never floated to the far edge.
You write the number; nothing counts for you — keep it true to the rows
actually in the section, and skip it when it adds nothing.

### `<tv-task>`
One task row — a `<tv-task-checkbox>` followed by a `<tv-task-body>`. Give it a
plain `id` if you'll wire interactivity. One per task.

Add `highlighted` to emphasize a row: a soft wash of the shared alert color by default. The hue
is one knob — `--task-highlight` — settable inline for a single row (`<tv-task highlighted style="--task-highlight: var(--color-primary)">`)
or on an ancestor to retint every highlight in the list. Highlight only with
a good reason: the user asked for it, or the emphasis clearly benefits them
(the one row they should see first). At more than one or two per list the
emphasis stops meaning anything.

### `<tv-task-checkbox>`
The circular checkbox at the head of each row; every row has exactly one. Add
`checked` to mark a task done (the row strikes through and mutes) or `disabled`
to mute a row without completing it. No label — it takes its accessible name from
the row's `<tv-task-title>`. On user toggle it emits a bubbling `toggle` event
and exposes a `checked` property (see Interactivity).

### `<tv-task-body>`
The content column right of the checkbox — wraps the title, note, and meta. One
per row, always present.

### `<tv-task-title>`
The task's name, as plain text. Required, one per row; keep it a short imperative
line.

### `<tv-task-note>`
A brief, muted one-line description under the title. Optional — add it only when
the title doesn't say enough, and keep it to a single line. Most tasks are
clearer without one.

### `<tv-task-meta>`
The metadata line under the title/note. It holds any mix of the three chips
below, in any order. Include it only when the task has metadata — otherwise omit
it.

### `<tv-task-meta-due>`
A due date: `<tv-task-meta-due date="YYYY-MM-DD">`. Give it only the machine
date — it computes urgency (today → alert, overdue → danger, upcoming → muted),
writes the human label ("Today", "Tomorrow", "Jun 20"), and draws the calendar
glyph. Never hand-format the date or set a color. At most one per task.

### `<tv-task-meta-item>`
The escape hatch for metadata that isn't a date or tag — an `<tv-icon>` plus
text, like a project or context:

```html
<tv-task-meta-item><tv-icon name="hash"></tv-icon>TV Skills</tv-task-meta-item>
```

Useful, but restrained: one or two at most. A row crowded with chips stops being
scannable.

### `<tv-task-meta-tag>`

A small pill for a label or tag: `<tv-task-meta-tag>design</tv-task-meta-tag>`.
Repeatable, but a few keywords — not a tag soup. Two or three sharpen a row; six
bury it.

### `<tv-task-placeholder>`

A centered, muted empty-state message:
`<tv-task-placeholder>Nothing here yet</tv-task-placeholder>`. Rarely needed —
by default an empty section simply isn't rendered (see `<tv-task-section>`).
Use it only when showing the empty group is the point — the user asked to see
it, or an interactive list empties itself and the space must not collapse.

## Interactivity

- On user toggle a checkbox emits a bubbling `toggle` event; read the new state
  from `e.checked`. Setting `el.checked = true/false` programmatically reflects
  the attribute (completes/uncompletes the row) but emits nothing.
- Listen once on the list and delegate. Give each `<tv-task>` a plain `id` and
  identify the toggled task with `e.target.closest("tv-task").id`.
- Nothing is persisted — wire the handler to whatever you want (localStorage, a
  `fetch` to your own API, …). On load, restore state by setting `el.checked`.

```js
const list = document.querySelector("tv-task-list");
list.addEventListener("toggle", (e) => {
  const id = e.target.closest("tv-task").id;
  save(id, e.checked); // your persistence; nothing is stored for you
});
```

## Example variations

Completed and disabled rows:

```html
<tv-task>
  <tv-task-checkbox checked></tv-task-checkbox>
  <tv-task-body><tv-task-title>Ship the icon migration</tv-task-title></tv-task-body>
</tv-task>
<tv-task>
  <tv-task-checkbox disabled></tv-task-checkbox>
  <tv-task-body><tv-task-title>Blocked on review</tv-task-title></tv-task-body>
</tv-task>
```

An overdue date and multiple tags — same markup, the component colors it:

```html
<tv-task-meta>
  <tv-task-meta-due date="2026-06-10"></tv-task-meta-due>
  <tv-task-meta-tag>urgent</tv-task-meta-tag>
  <tv-task-meta-tag>backend</tv-task-meta-tag>
</tv-task-meta>
```

A highlighted row, retinted to match the artifact's accent:

```html
<tv-task highlighted style="--task-highlight: var(--color-primary)">
  <tv-task-checkbox></tv-task-checkbox>
  <tv-task-body><tv-task-title>Sign the lease by Friday</tv-task-title></tv-task-body>
</tv-task>
```

The kit retains `--task-due-today`, `--task-highlight`, and `--task-meta-text`
for deliberate artifact customization. Prefer shared semantic tokens for their
values. Their defaults follow alert, the due-today color, and shared muted text
at 85% opacity, respectively; the kit does not redefine canonical color tokens.

## Guidelines

- **Icons are always `<tv-icon name="…">`** — never a span or inline SVG. In
  metadata use `calendar` (handled by the due component) and `hash`
  (project); for other `tv-task-meta-item`s pick from the canonical icon
  catalog listed in the main `television` skill. Names outside that closed
  catalog render no glyph.
- **Standalone sizing is `size="sm|md|lg|xl"`** on `<tv-icon>`; an icon beside
  text omits `size` and follows that text.
- **Rows are flat by default** — no backdrop, no dividers; whitespace does
  the separating. If you restyle rows (background, radius, spacing), keep
  that model in mind — deliberate, list-wide changes, not per-row chrome.

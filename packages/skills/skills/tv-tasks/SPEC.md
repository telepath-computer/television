# tv-tasks — specification

The design spec for the `tv-tasks` artifact skill: a Things-3-inspired to-do list that an
agent authors as a self-contained HTML artifact. It covers the **look & feel** and the
**markup vocabulary**. The code is the source of truth for exact values — `src/task.css`
for styling, `src/task.ts` for the components — so this spec stays at the level of intent
and rules, not pixel values.

---

## Look & feel

North star: **Things 3** — calm, restrained, legible; density and scannability over
decoration.

- **Shape.** The artifact page is the list's surface — Television's artifact frame
  supplies the chrome around the document, so the skill draws no frame of its own.
  Tasks are rows; sections group them with whitespace and a heading.
- **Type.** Titles sit at the body weight; notes and metadata drop a step and go muted;
  section headings are small and semibold. **Two muted tones**: notes, completed and
  disabled titles, and the placeholder use the shared `--color-text-muted`; the meta
  line — dates, projects, tags, counts — recedes a further step via `--task-meta-text` (85% of muted).
- **Color is restrained and token-driven** — effectively monochrome plus a few accents:
  primary (`--color-primary`) for the checked checkbox with `--color-primary-text`
  for its mark, alert (`--task-due-today`, defaulting to `--color-alert`) for a
  due-today date, danger (`--color-danger`) for overdue. Everything else is
  text / border / surface tokens.
- **The checkbox** is a circular control with a soft "pop" on check (a quick overshoot
  + the mark drawing in).
- **Rows separate by whitespace** — no dividers, no backdrop per row; sections separate
  by more whitespace and their heading.
- **Density** is comfortable-but-tight — it should read like real software, not an airy
  prose document.
- **Appearance** follows canonical and the selected theme. The kit inherits shared
  surface, text, muted-text, border, and native color-scheme defaults in both modes.

State appearance:

- **Completed** — title struck through and muted; the due date drops its urgency color to
  muted. Driven live by the checkbox, not a class.
- **Disabled** — the whole row reads muted.
- **Due urgency** — today alert, overdue danger, upcoming muted.
- **Empty** — an empty section is omitted, not rendered. The placeholder ("Nothing
  here yet") exists for the rare case where showing the empty group is the point.

Exact paddings, sizes, radii, and the specific tokens are deliberately left to
`task.css`.

---

## Markup

### Principles

- **Two kinds of element.** *Behavior → registered web component.* *Pure structure
  → unregistered `tv-task-*` styling element* (a hyphenated custom-element tag, never
  `customElements.define`'d, styled by CSS). Use bare attributes for state, no inventing a
  class/component when an element + attribute will do.
- **Namespace.** `tv-task-*` for this skill's elements; canonical elements reused from
  `/canonical/v2/components.js` keep their own names (`<tv-icon>`). The `tv-task-`
  prefix marks this skill's ownership at a glance.
- **No classes.** Structure is elements, state is bare attributes; CSS targets element and
  attribute selectors only. The agent never assembles a class string.
- **Real HTML where it fits.** Headings (`<h1>`/`<h2>`), a `<p>` heading subtext, and the
  checkbox's internal `<input>` stay standard elements.
- **Bespoke element when there's fixed presentation or logic** (a due date computes
  itself; a tag is a pill); the **generic `tv-task-meta-item` is the escape hatch** for
  arbitrary icon + text we haven't named.

### Element vocabulary

| Element | Kind | Purpose | Attributes |
|---|---|---|---|
| `<tv-task-list>` | styling | The list root; the page header sits above it. | — |
| `<tv-task-section>` | styling | A group of tasks (a when-bucket, project, or area). | — |
| `<tv-task>` | styling | One task row. | `highlighted` |
| `<tv-task-count>` | styling | Task count beside a section heading. | — |
| `<tv-task-checkbox>` | **component** | The accessible checkbox + mark + animation. | `checked` (reflected), `disabled` |
| `<tv-task-body>` | styling | The content column of a row (title/note/meta). | — |
| `<tv-task-title>` | styling | The task title. Required. | — |
| `<tv-task-note>` | styling | One-line description. Optional. | — |
| `<tv-task-meta>` | styling | The metadata row. Optional. | — |
| `<tv-task-meta-due>` | **component** | A due date — takes a machine date, computes today/overdue/upcoming vs the current clock, formats it, colors it, renders the calendar glyph. | `date` (ISO) |
| `<tv-task-meta-item>` | styling | Generic icon + text metadata (project, area, …). Muted. | — |
| `<tv-task-meta-tag>` | styling | A label/tag/context pill. Repeatable. | — |
| `<tv-task-placeholder>` | styling | Empty-state message, only when showing the empty group is the point — empty sections are omitted by default. | — |

The metadata chips form a family under the deeper `tv-task-meta-*` prefix; the depth
signals "this lives in the meta line." Distinct row parts (`tv-task-title`,
`tv-task-note`) stay bare. A chip is a direct child of `<tv-task-meta>` — self-contained
chips (`due`, `tag`) stand alone; `tv-task-meta-item` is the one that *groups* a loose
`<tv-icon>` + text into a single unit.

**Headers** are plain HTML, not `tv-task-*`: the page header (`<header>` with `<h1>` and
an optional `<p>` subtitle, usually the date) sits *above* `<tv-task-list>` and is the
canonical page-header idiom — house typography styles it. The skill gives the page one
default inset (`--space-16`), at zero specificity so an artifact's own `body` rule
replaces it, which the header, the list and anything placed between them, such as an
add form or a toolbar, share; and it stands each of the page's blocks one gap
(`--space-12`) below the one before. The gap below the header is the same whether it
ends with its `<h1>`, its subtitle or a message, and whether or not it sits in a prose
region. Sections title themselves with a `<header><h2>` inside.
This is deliberate — real `<h1>`/`<h2>` keep the document outline and let a screen
reader navigate section-to-section, which a styled `tv-task-*` wrapper can't. The
example pins the exact shape so the agent doesn't improvise the heading level or
contents.

**Counts** — `<tv-task-count>` beside the `<h2>` in a section header, laid inline by
the header's baseline flex (never floated to the far edge): meta-tone, `--text-sm`,
body weight. Styling-only — the author writes the number; the skill renders no verdict
on whether it matches the rows.

**Icons** are always `<tv-icon name="…">` — the canonical element from
`/canonical/v2/components.js`. For generic metadata it's nested in the markup so the author
picks the glyph (`<tv-task-meta-item><tv-icon name="hash">…`); the due-date component uses
`<tv-icon name="calendar" size="sm">` inside its own shadow. Icons referenced: `calendar` (due),
`hash` (project).

### States (how the CSS derives them)

- **Completed** — `<tv-task-checkbox>` reflects a `checked` attribute on its host (its real
  `<input>` lives in shadow DOM, where `:has()` can't reach it). The row styles completion
  via `tv-task:has(tv-task-checkbox[checked])` — strikethrough + muted title, muted due.
- **Disabled** — `tv-task:has(tv-task-checkbox[disabled])` → muted title.
- **Highlighted** — a `highlighted` attribute on `tv-task`: a soft wash derived from
  one knob (`--task-highlight`, default the due-today alert color) so retinting is a single
  color change. No edge lines — rows are borderless throughout. Emphasis is
  orthogonal to completion; a highlighted done row keeps its wash.
- **Due urgency** — computed by `<tv-task-meta-due>` from its `date` vs the current clock:
  today (alert), overdue (danger), upcoming (muted). Muted when the row is completed.

### Full example

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

Empty state: a section with no tasks is omitted from the artifact entirely. The
placeholder (`<tv-task-placeholder>`) exists only for the deliberate case of showing an
empty group — asked-for, or an interactive list that empties itself.

### Accessibility

- `<tv-task-checkbox>` wraps a real `<input type="checkbox">`, so a screen reader gets the
  checkbox role + checked state.
- Its **accessible name is derived from the row's title** (the component reads the adjacent
  `<tv-task-title>`), so the author never repeats the title and a SR user hears which task
  each checkbox belongs to.
- Keyboard focus shows a `:focus-visible` ring on the mark.

---

## What ships

`tv-tasks` is a **built skill** (the `tv-calendar` pattern): its build emits `dist/` with
three files —

- `task.css` — styles every `tv-task-*` styling element, built on canonical tokens.
- `task.js` (compiled from `task.ts`) — registers the skill-local components
  (`<tv-task-checkbox>`, `<tv-task-meta-due>`).
- `SKILL.md` — the authoring contract.

An artifact simply **loads** both — a `<link>` for `task.css` and a `<script type="module">`
for `task.js` — alongside the canonical boilerplate it already pulls in
(`/canonical/v2/styles.css?authoredForAppVersion=<version>` for tokens, `/canonical/v2/components.js` for `<tv-icon>`).

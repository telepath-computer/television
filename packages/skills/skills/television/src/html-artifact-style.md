# HTML artifact style

Write a complete HTML document for the Television viewer. Load both canonical
v2 resources in the document head:

```html
<link rel="stylesheet" href="/canonical/v2/styles.css?authoredForAppVersion=<version>">
<script type="module" src="/canonical/v2/components.js"></script>
```

Replace `<version>` with the Television app version whose canonical surface you
are authoring against. The Artifact workflow section explains how to find that
version and when to set, preserve, or omit this advisory query parameter.

The stylesheet provides Television's reset, Hind font, public design tokens,
semantic document defaults, and public element styles. The script registers
the public custom elements. Add local CSS for the artifact's own layout,
density, hierarchy, and specialized presentation.

Lean on semantic HTML first. Put `text-display="prose"` on a body or section
to apply readable styling to its headings, paragraphs, lists, links, code
blocks, blockquotes, rules, images and tables. Rely on those defaults instead of recreating baseline
typography in each artifact.

## Page header

The artifact frame's title bar already names the artifact. Add a page header
when the document benefits from its own masthead, such as a more specific title
or a subtitle carrying a date, person, or status.

Use a `<header>` containing an `<h1>` and, when useful, one `<p>` subtitle:

```html
<header>
  <h1>Quarterly plan</h1>
  <p>Friday, June 26</p>
</header>
```

Use the prose region for document reading rhythm; author any special header treatment locally.

For prose-like documents, 32px padding on the top and sides with 64px at the
bottom is a useful starting point. Adapt it to the document's content and
available space:

```css
body {
  padding: 32px 32px 64px;
}
```

## Canonical tokens

Use these public custom properties in artifact-authored CSS. Include a literal
fallback when the artifact should remain readable without the canonical sheet:

```css
.panel {
  padding: var(--space-16, 16px);
  gap: var(--space-12, 12px);
  color: var(--color-text, #222);
}
```

Fallbacks are paired: a guarded ground goes with a guarded text color, using
values that read together.

This public inventory is closed. Do not invent token names; when no public
token expresses a value, use an intentional literal, and when one does, use the
documented token with a literal fallback where appropriate.

### Fonts

`--font-sans`, `--font-mono`, `--font-weight-normal`, `--font-weight-medium`, `--font-weight-semibold`.

### Colors

`--checkbox-color`, `--panel-background`, `--panel-text-color`, `--panel-border-color`, `--panel-border`, `--panel-edge-highlight`, `--panel-edge-shadow`, `--option-background-highlighted`, `--option-background-active`, `--control-background`, `--control-text-color`, `--control-border-color`, `--control-border-width`, `--control-border`, `--input-placeholder-text-color`, `--neutral`, `--red`, `--orange`, `--yellow`, `--green`, `--cyan`, `--blue`, `--purple`, `--pink`, `--accent`, `--neutral-50`, `--neutral-100`, `--neutral-200`, `--neutral-300`, `--neutral-400`, `--neutral-500`, `--neutral-600`, `--neutral-700`, `--neutral-800`, `--neutral-900`, `--neutral-950`, `--red-50`, `--red-100`, `--red-200`, `--red-300`, `--red-400`, `--red-500`, `--red-600`, `--red-700`, `--red-800`, `--red-900`, `--red-950`, `--orange-50`, `--orange-100`, `--orange-200`, `--orange-300`, `--orange-400`, `--orange-500`, `--orange-600`, `--orange-700`, `--orange-800`, `--orange-900`, `--orange-950`, `--yellow-50`, `--yellow-100`, `--yellow-200`, `--yellow-300`, `--yellow-400`, `--yellow-500`, `--yellow-600`, `--yellow-700`, `--yellow-800`, `--yellow-900`, `--yellow-950`, `--green-50`, `--green-100`, `--green-200`, `--green-300`, `--green-400`, `--green-500`, `--green-600`, `--green-700`, `--green-800`, `--green-900`, `--green-950`, `--cyan-50`, `--cyan-100`, `--cyan-200`, `--cyan-300`, `--cyan-400`, `--cyan-500`, `--cyan-600`, `--cyan-700`, `--cyan-800`, `--cyan-900`, `--cyan-950`, `--blue-50`, `--blue-100`, `--blue-200`, `--blue-300`, `--blue-400`, `--blue-500`, `--blue-600`, `--blue-700`, `--blue-800`, `--blue-900`, `--blue-950`, `--purple-50`, `--purple-100`, `--purple-200`, `--purple-300`, `--purple-400`, `--purple-500`, `--purple-600`, `--purple-700`, `--purple-800`, `--purple-900`, `--purple-950`, `--pink-50`, `--pink-100`, `--pink-200`, `--pink-300`, `--pink-400`, `--pink-500`, `--pink-600`, `--pink-700`, `--pink-800`, `--pink-900`, `--pink-950`, `--accent-50`, `--accent-100`, `--accent-200`, `--accent-300`, `--accent-400`, `--accent-500`, `--accent-600`, `--accent-700`, `--accent-800`, `--accent-900`, `--accent-950`, `--neutral-alpha-5`, `--neutral-alpha-10`, `--neutral-alpha-15`, `--neutral-alpha-25`, `--neutral-alpha-50`, `--neutral-alpha-75`, `--red-alpha-5`, `--red-alpha-10`, `--red-alpha-15`, `--red-alpha-25`, `--red-alpha-50`, `--red-alpha-75`, `--orange-alpha-5`, `--orange-alpha-10`, `--orange-alpha-15`, `--orange-alpha-25`, `--orange-alpha-50`, `--orange-alpha-75`, `--yellow-alpha-5`, `--yellow-alpha-10`, `--yellow-alpha-15`, `--yellow-alpha-25`, `--yellow-alpha-50`, `--yellow-alpha-75`, `--green-alpha-5`, `--green-alpha-10`, `--green-alpha-15`, `--green-alpha-25`, `--green-alpha-50`, `--green-alpha-75`, `--cyan-alpha-5`, `--cyan-alpha-10`, `--cyan-alpha-15`, `--cyan-alpha-25`, `--cyan-alpha-50`, `--cyan-alpha-75`, `--blue-alpha-5`, `--blue-alpha-10`, `--blue-alpha-15`, `--blue-alpha-25`, `--blue-alpha-50`, `--blue-alpha-75`, `--purple-alpha-5`, `--purple-alpha-10`, `--purple-alpha-15`, `--purple-alpha-25`, `--purple-alpha-50`, `--purple-alpha-75`, `--pink-alpha-5`, `--pink-alpha-10`, `--pink-alpha-15`, `--pink-alpha-25`, `--pink-alpha-50`, `--pink-alpha-75`, `--accent-alpha-5`, `--accent-alpha-10`, `--accent-alpha-15`, `--accent-alpha-25`, `--accent-alpha-50`, `--accent-alpha-75`, `--alpha-3`, `--alpha-5`, `--alpha-10`, `--alpha-15`, `--alpha-20`, `--alpha-25`, `--alpha-40`, `--alpha-50`, `--alpha-75`, `--hover-mix`, `--alpha-active`, `--tint-hover`, `--tint-active`, `--icon-check`, `--color-surface`, `--color-surface-muted`, `--color-text`, `--color-text-muted`, `--color-text-reversed`, `--color-border`, `--color-danger`, `--tint-danger`, `--tint-danger-hover`, `--tint-danger-active`, `--color-alert`, `--tint-alert`, `--tint-alert-hover`, `--tint-alert-active`, `--color-success`, `--tint-success`, `--tint-surface`, `--tint-surface-muted`, `--color-primary`, `--tint-primary`, `--tint-primary-hover`, `--tint-primary-active`, `--color-primary-text`, `--outline-focus`, `--control-background-hover`, `--control-background-active`, `--color-primary-hover`, `--color-primary-active`, `--color-danger-hover`, `--color-danger-active`, `--color-alert-hover`, `--color-alert-active`, `--color-link`, `--color-overlay`, `--state-flip`, `--contrast-flip`.

### Type

`--control-font-size`, `--text-base`, `--text-sm`, `--text-md`, `--text-lg`, `--text-xl`, `--text-2xl`, `--text-3xl`, `--text-4xl`, `--line-control`, `--line-control-sm`.

### Spacing and radii

`--control-radius`, `--control-padding`, `--space-2`, `--space-3`, `--space-4`, `--space-6`, `--space-8`, `--space-10`, `--space-12`, `--space-16`, `--space-20`, `--space-24`, `--space-32`, `--space-48`, `--space-64`, `--radius-pill`, `--panel-radius`, `--popover-distance`.

### Shadows

`--shadow-sm`, `--shadow-md`, `--shadow-lg`, `--shadow-xl`, `--popover-shadow`, `--dialog-shadow`.

### Layers

`--layer-ground`, `--layer-panel`, `--layer-overlay`.

## Canonical components

### Native inputs and errors

Native text-entry inputs and textareas receive shared styling automatically.
Supported input types are absent or empty type, `text`, `email`, `url`, `tel`,
`password` and `number`; search fields and other controls are outside this
treatment. Give each field an accessible label; a placeholder is only a hint.
Use `disabled` to disable a field and `readonly` to retain selectable contents
without editing. Preserve the keyboard focus ring and state styling.

When presenting a validation error, set `aria-invalid="true"` and associate
the message using `aria-describedby`. The foundation supplies the invalid
border. Use a paragraph with `class="tv-error"` for shared message styling:

```html
<label for="name">Name</label>
<input id="name" aria-invalid="true" aria-describedby="name-error">
<p id="name-error" class="tv-error">Enter a name.</p>
```

Explain what needs correcting in text, not color alone. Preserve existing hint
IDs when adding the error ID to `aria-describedby`. When the error clears,
remove `aria-invalid` (or set it to `false`), remove only the error ID from
`aria-describedby`, and remove the message or hide it with native `hidden`.
Do not mark untouched required fields invalid merely because they are empty.

`tv-error` adds no validation, visibility, focus or announcement behavior and
can also style messages outside inputs. Decide whether an asynchronous error
needs a live announcement; the class does not imply `role="alert"`.

### Popovers, menus and selects

Pair a panel with the ID of a trigger button in the same document:

```html
<button id="details">Details</button>
<tv-popover trigger="details" open>Panel contents</tv-popover>
<button id="manual-details">Manual details</button>
<tv-popover trigger="manual-details" manual>Explicitly dismissed contents</tv-popover>

<button id="actions">Actions</button>
<tv-menu trigger="actions" open>
  <tv-menu-item>Rename</tv-menu-item>
  <hr>
  <tv-menu-item intent="danger">Delete</tv-menu-item>
</tv-menu>
<button id="manual-actions">Manual actions</button>
<tv-menu trigger="manual-actions" manual>…</tv-menu>

<button id="choice" aria-label="Appearance"></button>
<tv-select trigger="choice" open>
  <tv-option value="light" selected>Light</tv-option>
  <tv-option value="dark">Dark</tv-option>
</tv-select>
```

The `open` attribute controls visibility; omit it for the usual closed initial state.
Popover and menu triggers toggle their panels. Manual popovers and menus require
explicit closing. Ordinary panels dismiss on outside press or Escape; menus
also close on item activation and support keyboard navigation and typeahead.
Author action handlers on the menu items.

Menus and popovers prefer below the trigger with left edges aligned, flip toward
more room when needed, and constrain scrolling within their own document. Selects
open over the selected row and keep an owning Settings-style popover open. A select
copies its selected option label to the trigger. Its `value` property reads or sets
a matching option value; a committed user choice emits `change`. No direction
attributes or internal classes are part of the authoring API.

### Static checkbox lists

Use `checkbox-list` and `checkbox-item` for a checklist whose state is authored
into the document:

```html
<checkbox-list>
  <checkbox-item checked>Completed item</checkbox-item>
  <checkbox-item>Open item</checkbox-item>
</checkbox-list>
```

`checked` marks a completed `checkbox-item`. Checked rows render muted and
struck through, and the marker shows a not-allowed cursor to communicate its
static nature. The list is presentational and does not toggle when pressed.
The shared `--checkbox-color` token controls checked marker fill and border:

```css
:root {
  --checkbox-color: var(--color-success);
}
```

### Icons

`<tv-icon name="…" size="sm|md|lg|xl" spinning>` is the complete authoring
shape. Supply `name`. Omit `size` beside text so the icon follows the current
font size, or choose `sm`, `md`, `lg`, or `xl` for a standalone icon. Add the
boolean `spinning` attribute for continuous activity.

`tv-icon` may be composed inside an author-created shadow root; it renders and
sizes there the same way it does in document light DOM.

```html
<tv-icon name="check" size="md"></tv-icon>
<tv-icon name="spinner" size="md" spinning></tv-icon>
```

The public icon names are:

- `check`, `close`, `copy`, `pin`, `search`, `add`, `more`, `settings`
- `expand`, `collapse`, `collapse-up`, `skills`, `notification`, `artifact`
- `spinner`, `locked`, `unpin`, `back`, `forward`, `television`, `calendar`
- `grid`, `hash`, `delete`, `edit`, `link`, `external`, `download`, `reload`
- `warning`, `info`, `file`, `folder`, `clock`, `user`, `upload`, `star`
- `home`, `send`, `filter`, `sort`, `help`, `chart`, `image`, `chat`
- `location`, `play`, `pause`, `stop`, `video`, `music`, `error`, `email`
- `phone`, `web`, `tag`, `bookmark`, `table`, `code`, `group`, `up`, `down`
- `money`, `bank`, `card`, `wallet`, `gauge`, `activity`, `trend-up`
- `trend-down`, `database`, `server`, `deploy`, `list`, `terminal`, `branch`
- `shield`, `select`, `sidebar`, `plane`, `car`, `bus`, `bed`, `food`
- `cake`, `tent`, `microphone`, `luggage`, `key`, `sun`, `moon`, `at`
- `briefcase`, `bicycle`, `train`, `gift`, `book`, `camera`, `inbox`
- `hourglass`, `printer`

Choose a name from this catalog. When the catalog has no suitable glyph, use a
text label or an emoji.

## Available document space

Television presents each artifact as its own document inside a resizable
artifact frame. Build responsive layouts from the document's available width
and height. Vertical document scrolling is appropriate for overflow; reserve
horizontal scrolling for content that needs width, such as a data table or
timeline.

For a native dialog, put its contents in one direct `.dialog-content` child: `<dialog><div class="dialog-content">…</div></dialog>`. Author content layout on that child. It scrolls within the viewport and any authored dialog height or maximum height while the dialog paints its rim and broad shadow. Unwrapped dialogs retain native overflow.

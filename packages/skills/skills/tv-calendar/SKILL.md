---
name: tv-calendar
description: Author self-contained HTML calendar artifacts using the bundled calendar-week elements and copied calendar assets.
---

# Authoring a calendar week

Know the main `television` skill first. Re-read it only if it is not already in your context or you know it changed. It defines the general Television workflow, path artifact registration, and the canonical HTML house style. This skill only adds calendar-specific guidance.

A working-week calendar with a generated header strip, all-day band, time axis,
and timed event grid. The agent only authors a single `<calendar-week>` plus
flat sibling `<calendar-event>` children. The component renders the rest.

## Required assets

Every calendar artifact must be self-contained. Read `calendar.css` and
`calendar.js` from this skill folder and carry them into the artifact output
instead of referencing `/skills/tv-calendar/...` URLs.

For a Television HTML directory artifact, copy both files into the registered directory next to `index.html` and reference them relatively:

```html
<link rel="stylesheet" href="/canonical/v2/styles.css?authoredForAppVersion=<version>" />
<link rel="stylesheet" href="./calendar.css" />
<script type="module" src="./calendar.js"></script>
```

For a running server, read the exact release `version` from `tv status`; when working in a Television checkout, read the exact version from the checkout root `package.json`. Copy that exact release version unchanged into `authoredForAppVersion`. A missing version or the `0.0.0` development sentinel does not identify a release, so omit the metadata.

For a standalone single-file HTML artifact, inline the contents of
`calendar.css` and `calendar.js` directly into `<style>` and
`<script type="module">` tags so the output stays self-contained.

`calendar.js` registers the custom elements. `calendar.css` provides the
calendar-specific chrome styling. Do not reimplement those elements yourself.

## Markup contract

Author exactly this surface:

```html
<calendar-week start-date="YYYY-MM-DD" days="N" start-hour="8">
  <calendar-event title="..." start="..." end="..." color="blue"></calendar-event>
  <calendar-event title="..." start="..." end="..." all-day color="purple"></calendar-event>
</calendar-week>
```

`<calendar-week>` attributes:

- `start-date` is required and must be a real `YYYY-MM-DD` date.
- `days` is required and should usually be `5` or `7`.
- `start-hour` is optional. Omit it unless you need a fixed initial scroll position.

`<calendar-event>` attributes:

- `title` is required.
- `start` is required.
- `end` is required.
- `all-day` is optional and presence-only. Use it only for all-day events.
- `color` is optional. Allowed values: `red`, `orange`, `yellow`, `green`, `blue`, `purple`.

## Timed vs. all-day events

Timed events:

- Omit `all-day`.
- Use `YYYY-MM-DDTHH:MM` wall-clock datetimes for both `start` and `end`.
- Keep each event within a single day.

All-day events:

- Include `all-day`.
- Use date-only `YYYY-MM-DD` values for both `start` and `end`.
- `end` is non-inclusive, following RFC 5545.

## What the component auto-renders

Do not author any of these directly:

- `<calendar-headers>`
- `<calendar-day>`
- `<calendar-allday>`
- `<calendar-grid>`
- `<calendar-time-axis>`
- `<calendar-column>`
- `<calendar-cell>`

## Behavior to rely on

- all-day events clip silently to the visible range
- all-day events stack into lanes automatically when their visible spans overlap
- timed events on the same day cascade to the right when their time ranges overlap
- malformed events are silently dropped

## Content guidance

- make the schedule feel real
- vary event titles and durations
- use the color palette intentionally
- avoid placeholder text like "Event 1"

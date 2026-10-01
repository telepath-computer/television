# `<calendar-event>`

One calendar event authored as a direct child of `<calendar-week>`. The week
validates the event, routes it to the generated all-day or timed section, and
renders the block markup.

## Attributes

| Attribute | Required | Type | Notes |
|-----------|----------|------|-------|
| `title` | yes | string | Rendered as an `<h3>` inside the event block. |
| `start` | yes | date or datetime | All-day events use `YYYY-MM-DD`. Timed events use `YYYY-MM-DDTHH:MM`. |
| `end` | yes | date or datetime | Same shape as `start`. Always non-inclusive. |
| `all-day` | no | boolean (presence-only) | Required for all-day routing. Omit it for timed events. |
| `color` | no | `red` \| `orange` \| `yellow` \| `green` \| `blue` \| `purple` | Known values apply the matching palette. Omitted or unknown values fall back to the neutral default. |

## Shapes

Timed event:

```html
<calendar-event
  title="Standup"
  start="2026-05-06T09:00"
  end="2026-05-06T10:30"
></calendar-event>
```

All-day event:

```html
<calendar-event
  title="Holiday"
  start="2026-05-04"
  end="2026-05-05"
  all-day
></calendar-event>
```

Multi-day all-day event:

```html
<calendar-event
  title="Vacation"
  start="2026-05-04"
  end="2026-05-09"
  all-day
></calendar-event>
```

`end` is non-inclusive in every case.

## Color palette

When `color` is one of the six allowed values, the week applies the matching UI
tokens to the rendered block:

- Timed events use `--{color}-100` for the block background and
  `--{color}-500` for the left border.
- All-day events use `--{color}-200` for a more solid pill treatment and remove
  the left border.
- Unknown values are ignored and render with the neutral default styling.

## Placement variables

Valid timed events are routed into `<calendar-grid>` and receive:

- `--day-index`
- `--y-start`
- `--y-end`
- `--cascade-depth`

Valid all-day events are routed into `<calendar-allday>` and receive:

- `--day-start`
- `--day-span`
- `--lane-index`

When any all-day events are placed, `<calendar-week>` also sets
`--allday-lane-count` so the generated all-day band can grow enough rows to fit
the assigned lanes.

## Overlap behavior

- All-day events use first-fit lane assignment in authored order. Each event is
  placed into the lowest-numbered lane whose existing events do not overlap its
  clipped visible span.
- Timed events cascade within a day. `--cascade-depth` is the count of
  earlier-starting events on that day whose `[start, end)` interval overlaps the
  current event, and the rendered block shifts right as that depth increases.

The rendered block markup is invariant across both modes:

```html
<div class="event-block">
  <div class="event-block-inner">
    <h3>…</h3>
  </div>
</div>
```

## Silent drop rules

The event renders nothing when any of these apply:

- Missing `title`, `start`, or `end`
- Unparseable date or datetime values
- `end <= start`
- `all-day` with datetime values
- Timed event with date-only values
- Mixed date/date-time shapes
- Timed event spanning midnight
- Event outside the visible range

Partially overlapping all-day events clip to the visible range instead of
dropping.

## Non-goals

- Multi-day timed events
- Custom block body content
- Hover or click interaction

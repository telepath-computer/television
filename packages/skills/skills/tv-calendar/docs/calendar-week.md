# `<calendar-week>`

The week-view container. It takes a start date plus a contiguous day count,
then auto-renders the headers strip, all-day band, time axis, day columns,
and now-line chrome for that range.

Author `<calendar-event>` elements as direct light-DOM children of
`<calendar-week>`. The week routes them into its generated
`<calendar-allday>` or `<calendar-grid>` section after validation.

## Attributes

| Attribute | Property | Type | Required | Notes |
|-----------|----------|------|----------|-------|
| `start-date` | `startDate` | `YYYY-MM-DD` | yes | Local wall-clock date for the leftmost day column. |
| `days` | `days` | integer `>= 1` | yes | Number of contiguous day columns starting at `start-date`. |
| `start-hour` | `startHour` | integer `0..23` | no | Explicit initial scroll target. If omitted, the week infers it from the earliest visible timed event minus one hour, clamped to `0`, then falls back to `8`. |

## Authored children

`<calendar-week>` accepts flat `<calendar-event>` children only. Agents do
not author `<calendar-day>`, `<calendar-time-axis>`, or the section wrappers.
Those are generated from `start-date` and `days`.

## Validation and routing

`<calendar-week>` renders best-effort. Invalid events are silently dropped:

- Missing required attributes
- Unparseable date or datetime values
- `end <= start`
- `all-day` with datetime values
- Timed events with date-only values
- Mixed date/date-time shapes
- Timed events spanning midnight
- Events entirely outside the visible range

All-day events require `all-day` plus date-only `start` and `end` values.
Their `end` is non-inclusive. A Mon–Fri vacation is:

```html
<calendar-event
  title="Vacation"
  start="2026-05-04"
  end="2026-05-09"
  all-day
></calendar-event>
```

Partially overlapping all-day events clip silently to the visible columns.

Timed events require datetime `start` and `end` values in local wall-clock
form (`YYYY-MM-DDTHH:MM`). Cross-midnight timed events are out of scope in
this slice and are dropped.

## CSS contract

`<calendar-week>` sets these variables on the host:

| Variable | Value |
|----------|-------|
| `--day-count` | Visible day-column count |
| `--hour-count` | Always `24` |
| `--hour-min-height` | Hour-row floor used by the grid layout |

The implementation also sets `--start-hour` internally for the scroll marker.

Auto-rendered per-day chrome elements receive `--day-index` (1-based):

- `<calendar-headers> > <calendar-day>`
- `<calendar-allday> > <calendar-cell>`
- `<calendar-grid> > <calendar-column>`

See `internal-rendering.md` for the generated section markup and CSS targets.

## Initial scroll

`<calendar-week>` is its own scroll container. After layout it scrolls so the
resolved start-hour row sits just below the sticky headers strip:

1. Use `start-hour` if present and valid.
2. Else use the earliest visible timed event's start hour minus one.
3. Else use `8`.

## Now-line

If today's local date falls within `[start-date, start-date + days)`, week
renders a `.now-line` inside `<calendar-grid>` at the current wall-clock
time. It recomputes every minute from a `setInterval` started in
`connected()` and cleared in `disconnected()`.

## Non-goals

- Authored override sections (`<calendar-headers>`, `<calendar-allday>`, `<calendar-grid>`)
- Multi-day timed events
- Event overlap lanes
- Color palettes or categories
- Non-contiguous day ranges
- Sub-hour scroll targets
- Timezones or DST handling

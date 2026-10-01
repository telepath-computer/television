# `<calendar-time-axis>`

Hour labels for the timed grid. This element still exists as code, but it is
no longer agent-authored. `<calendar-week>` auto-renders it inside
`<calendar-grid>`.

## Authorship

Agents do not write `<calendar-time-axis>` directly. The generated structure is:

```html
<calendar-grid>
  <calendar-time-axis></calendar-time-axis>
  …
</calendar-grid>
```

## Rendered output

`<calendar-time-axis>` uses `display: contents` and renders 24 `.hour-label`
elements into the parent grid.

- `grid-column: time-left / days-start`
- `grid-row-start: calc(var(--hour-index) + 1)`

Labels are formatted in 12-hour time:

- `0` → `12 AM`
- `1` → `1 AM`
- `12` → `12 PM`
- `13` → `1 PM`
- `23` → `11 PM`

The midnight label remains in the DOM but is visually hidden.

## Non-goals

- Agent-authored secondary time axes
- Half-hour or quarter-hour ticks
- Timezone offsets

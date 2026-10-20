# Calendar artifact

This page shows the events in this artifact's JSON store in a calendar of one to seven days. Its JavaScript modules and `styles.css` started from Television's tv-calendar component and run without a build step.

## The store

The store starts with an empty `events` object. Set `days` to an integer from 1 to 7, or leave it out for seven days. Set `startDate` to the first day shown, as `YYYY-MM-DD`, or leave it out. Without `startDate`, a seven-day calendar starts on Monday of the current local week, and a shorter one starts today. A `startDate` or `days` the page cannot read is treated as absent.

Add each event under `events/<key>` with a string `title`, `start`, and `end`. The key identifies the event but is not shown. Timed events use local `YYYY-MM-DDTHH:MM` values and end on the day they start. All-day events use `YYYY-MM-DD`, set `allDay` to true, and use the day after the last day as `end`. Optional fields are `detail` (one line of text), `attendees` (an array of names), `color` (`red`, `orange`, `yellow`, `green`, `blue`, or `purple`; blue when absent), and `highlight` (a boolean). An event whose fields break these rules, or one outside the days shown, is not displayed. If the value as a whole breaks them, because it is not an object or `events` is missing or not an object, or the store has no value, the page shows an error page instead of the calendar until the value is fixed.

Write one event with `tv resource json set --artifact <id> events/review '<json-object>'`. Set `events/review/highlight` to `true` to raise an existing event, and to `false` to settle it. The page follows changes live and never writes to the store.

## The page

The page fills its frame and looks like a calendar app: the month and year at the top, a header for each day, a band for all-day events when there are any, and an hour grid that scrolls. On first load it scrolls to an hour before the earliest event. Overlapping timed events sit side by side. Days share the width equally down to 100 pixels each; below that the days scroll sideways and the hour labels stay in place. An event's attendees show after a person icon, as many names as fit and a count of the rest. Colours, fonts and corner radii come from the active Television theme, so the calendar follows theme and light or dark changes without edits.

A store write changes only the affected event's block; the rest of the page is not redrawn and the scroll position stays where it is.

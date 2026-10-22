*Proves the bundled Calendar package and its live page delivery.*

# Calendar artifact template — proof

Proves [specs/arch/templates/calendar.md](../../../specs/arch/templates/calendar.md).

## Coverage model

The package check reads the real Calendar source: its manifest, empty starting store, README guidance, linked stylesheets, thumbnail size, and a byte comparison of its `styles.css` with the stylesheet of the [Calendar UI spec](../../../specs/ui/templates/calendar.mdx) stories. A browser opens a Calendar artifact against a running server and real store, and a spawned `tv resource json` write adds an event to the open page. The [Calendar UI proof](../../ui/templates/calendar/index.md) covers that page's layout, live updates, and the store contract's rule that invalid events are not shown. The ordinary copy, seed, and default display rules are covered by [template architecture](./index.md) and [layout creation](../layout/index.md#^ly-ac-create-appends); build membership and minimum versions are covered by [bundled installation](./bundled-installation.md). Visual polish is judged in browser review.

## Test hooks

No production test hook is needed.

## Assertions

- **Contract** (real bundled Calendar source and the Calendar UI spec stylesheet on disk; no mocks): Under [the Calendar store](../../../specs/arch/templates/calendar.md#^bundled-artifact-template-calendar-store), [page](../../../specs/arch/templates/calendar.md#^bundled-artifact-template-calendar-page), and [README guidance](../../../specs/arch/templates/calendar.md#^bundled-artifact-template-calendar-readme), the manifest matches the [inventory](./bundled-templates.md#^templates-bundled-t-inventory) with no `display`, `data.json` is `{"events":{}}`, the README names each store field, the write command, and the tv-calendar origin, the page links the canonical stylesheet and then `./styles.css`, `styles.css` equals the spec stylesheet byte for byte, and `thumbnail.png` is a 400 by 500 PNG. *(policy-grade test: `packages/server/test/calendar-template.test.ts`, cases tagged `^templates-calendar-t-package`)* ^templates-calendar-t-package
- **Acceptance** (real browser → running server → Calendar artifact created from the bundled template with an authored starting store value; a spawned `tv` process; no mocks except the standard CSS-motion override, which forfeits motion only): Under [the Calendar store](../../../specs/arch/templates/calendar.md#^bundled-artifact-template-calendar-store), the page loads the canonical stylesheet, and a spawned `tv resource json set` write of a new event under `events/` shows that event on the open page. *(policy-grade test: `packages/web/test/e2e/template-calendar-real-stack.test.ts`, cases tagged `^templates-calendar-ac-live`)* ^templates-calendar-ac-live

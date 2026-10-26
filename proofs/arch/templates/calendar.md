*Proves the bundled Calendar package and its live page delivery.*

# Calendar artifact template — proof

Proves [specs/arch/templates/calendar.md](../../../specs/arch/templates/calendar.md).

## Coverage model

The package checks read the real Calendar source: its manifest, empty starting store, README guidance, linked stylesheets, and icon. The [Calendar UI proof](../../ui/templates/calendar.md#^calendar-ac-conformance) holds the page's appearance to the [Calendar UI spec](../../../specs/ui/templates/calendar.mdx) stories by conformance. A browser opens a Calendar artifact against a running server and real store, and a spawned `tv resource json` write adds an event to the open page. The [Calendar UI proof](../../ui/templates/calendar.md) covers that page's layout, live updates, and the store contract's rules that invalid events are not shown and that a `startDate`, `days` or `visibleHours` that breaks the contract is treated as absent ([`visibleHours`](../../ui/templates/calendar.md#^calendar-ac-visible-hours-invalid)). The ordinary copy, seed, and default display rules are covered by [template architecture](./index.md) and [layout creation](../layout/index.md#^ly-ac-create-appends); build membership and minimum versions are covered by [bundled installation](./bundled-installation.md). Visual polish is judged in browser review.

## Test hooks

No production test hook is needed.

## Assertions

- **Contract** (real bundled Calendar source on disk; no mocks): Under [the Calendar store](../../../specs/arch/templates/calendar.md#^bundled-artifact-template-calendar-store), [page](../../../specs/arch/templates/calendar.md#^bundled-artifact-template-calendar-page), and [README guidance](../../../specs/arch/templates/calendar.md#^bundled-artifact-template-calendar-readme), the manifest matches the [inventory](./bundled-templates.md#^templates-bundled-t-inventory) with no `display` and with the specified schema as its `dataSchema`, `data.json` is `{"events":{}}`, the README names each store field, `visibleHours` among them, the write command, and the tv-calendar origin, and the page links the canonical stylesheet and then `./styles.css`. *(policy-grade test: `packages/server/test/calendar-template.test.ts`, cases tagged `^templates-calendar-t-package`)* ^templates-calendar-t-package
- **Contract** (real bundled folder → production template scanner; no mocks): Under [icon requirements](../../../specs/arch/templates/calendar.md#^bundled-artifact-template-calendar-page), the manifest's only icon entry is `icon.svg`, and the scanner selects that readable SVG for the Toolbox slot. [Calendar UI review](../../ui/templates/calendar.md#^calendar-review-icon) covers how the icon looks. *(policy-grade test: `packages/server/test/calendar-template.test.ts`, “supplies its SVG icon to the Toolbox”)* ^templates-calendar-t-icon
- **Acceptance** (real browser → running server → Calendar artifact created from the bundled template with an authored starting store value; a spawned `tv` process; no mocks except the standard CSS-motion override, which forfeits CSS motion only): Under [the Calendar store](../../../specs/arch/templates/calendar.md#^bundled-artifact-template-calendar-store), the page loads the canonical stylesheet, and a spawned `tv resource json set` write of a new event under `events/` shows that event on the open page. *(policy-grade test: `packages/web/test/e2e/template-calendar-real-stack.test.ts`, cases tagged `^templates-calendar-ac-live`)* ^templates-calendar-ac-live

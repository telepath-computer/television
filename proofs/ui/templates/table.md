*Proves the Table page behaviour and rendered conformance to every UI-spec story in a real browser against a running server.*

# Table template (UI) — proof

Proves [specs/ui/templates/table.mdx](../../../specs/ui/templates/table.mdx).

## Coverage model

Browser tests create real Table artifacts from the installed bundled template and open the packaged page against a running Television server. Writes use the real artifact API or a spawned `tv resource json` command. The page uses its real resource SDK, DOM and stylesheet. No test replaces the store, SDK or page markup.

[Conformance](../../../specs/spec-ui.md#conformance) compares every exported [Table story](../../../storybook/spec/templates/table/table.stories.ts) with production in the same state. It runs in Chromium against the Storybook built from this worktree and the installed Table served by a running Television server through the unchanged forwarding proxy. Both pages compare `.table-page` at the story viewport and appearance, after story and production actions finish, with no permitted differences.

The loading assertion holds the page connection before store data arrives. The disconnection assertion first lets traffic reach the real server, then closes and temporarily refuses connections. The saved-data-unavailable assertion makes the real stored bytes unreadable while the server restarts, then restores them and restarts it again. These seams change only the declared condition.

## Test hooks

No production test hook is used. Starting store values, window sizes, real page inputs and proxy connection control are fixtures.

## Assertions

Each assertion below is **Acceptance** (real browser → packaged Table → running server, real store and SDK), cited to `packages/web/test/e2e/template-table-real-stack.test.ts`.

- Under [A new table](../../../specs/ui/templates/table.mdx#a-new-table), creating Table from Toolbox delivers the bundled icon, uses the shared display default, seeds exactly an empty `rows` object, serves the packaged canonical and local dependencies, and shows the empty state. The copy remains independent of the bundled source. *(cases tagged `^table-ac-new`)* ^table-ac-new
- Under [Rows, columns and cells](../../../specs/ui/templates/table.mdx#rows-columns-and-cells), agent writes show in numeric `order` and key order, hide row keys and `order`, derive stable first-seen columns, show the total count, and render empty values, booleans, numbers, JSON, short text and long text as specified. *(cases tagged `^table-ac-rows`)* ^table-ac-rows
- Under [Search](../../../specs/ui/templates/table.mdx#search), real typing filters cell values case-insensitively without changing the count or store, shows the no-results query, and Escape clears the query. *(cases tagged `^table-ac-search`)* ^table-ac-search
- Under [Sort](../../../specs/ui/templates/table.mdx#sort), real header presses cycle ascending, descending and stored order, keep empty values last, update `aria-sort`, and do not write. *(cases tagged `^table-ac-sort`)* ^table-ac-sort
- Under [Selection](../../../specs/ui/templates/table.mdx#selection), a real row press selects it, focus changes its presentation, arrows move among visible rows, Escape clears it, search may hide it without clearing it, and removing the stored row clears it. None of those actions writes. *(cases tagged `^table-ac-selection`)* ^table-ac-selection
- Under [Scrolling and narrow artifacts](../../../specs/ui/templates/table.mdx#scrolling-and-narrow-artifacts), many rows scroll beneath sticky headers, and a narrow artifact scrolls sideways with the correct edge fades. *(cases tagged `^table-ac-scroll`)* ^table-ac-scroll
- Under [Read-only and access loss](../../../specs/ui/templates/table.mdx#read-only-and-access-loss), a read-only share shows the table and keeps local controls; after revocation, the page listener receives `no-store` and the last table remains with no error. *(case tagged `^table-ac-access`)* ^table-ac-access
- Under [Disconnection](../../../specs/ui/templates/table.mdx#disconnection), a disconnected page keeps its last table and shows no message; a spawned `tv` write appears after reconnection. *(cases tagged `^table-ac-disconnection`)* ^table-ac-disconnection
- Under [Data the page cannot read](../../../specs/ui/templates/table.mdx#data-the-page-cannot-read), malformed or missing later values show the standard alert without a repair write and return live after valid data is restored. Real unavailable saved bytes show the same alert and recover after restoration without a reload. *(case tagged `^table-ac-unreadable`)* ^table-ac-unreadable
- Under [Appearance](../../../specs/ui/templates/table.mdx#appearance), the page follows light and dark appearance through foundation roles. *(cases tagged `^table-ac-appearance`)* ^table-ac-appearance

## Review

- Under [Icon](../../../specs/ui/templates/table.mdx#icon), review checks that the Toolbox icon is a pale teal table with a solid teal header and a teal grid, and remains legible at 20 pixels on light and dark backgrounds. The [package proof](../../arch/templates/table.md#^templates-table-t-icon) shows that Toolbox receives the file. *(visual review; no automated test)* ^table-review-icon

## Conformance

- **Acceptance — every spec story conforms.** Under [story output](../../../specs/spec-ui.md#^ui-story-output) and [conformance](../../../specs/spec-ui.md#^ui-conformance-test), generate one test for every Table story export; a story without a production state fails. Compare `.table-page` in Storybook and production at the same viewport and appearance with no allowed difference. Production uses the real installed template, server, resource SDK and store. Store values repeat story data, and real input reaches local page states. *(policy-grade test: `packages/web/test/e2e/template-table-conformance.test.ts`, “Table conforms”)* ^table-ac-conformance

| Stories | Production state |
| --- | --- |
| `WithRows`, `Dark` | Store the six-row parks fixture; `Dark` emulates dark appearance. |
| `New` | Create the installed template with the exact empty seed. |
| `Filtered`, `NoResults` | Open the parks rows and type `Utah` or `Redwood` in search. |
| `Sorted` | Open the parks rows and press the `Rating` header once. |
| `Selected` | Open the parks rows, press the Olympic row, and focus the table scroll region. |
| `ManyRows` | Store the 80-row fixture. |
| `Narrow` | Open the parks rows at 400 by 600 pixels and scroll 180 pixels sideways. |
| `Loading` | Hold the connection before the store value arrives. |
| `Unreadable`, `UnreadableDark` | Store a root with `rows` as a list; emulate dark appearance for `UnreadableDark`. |

# Toolbox grid plan

This document records the decisions and open questions for moving the approved Toolbox grid from the Storybook experiment into the UI spec, spec stories, production, and tests. The specification edits remain drafts until Rupert reviews them.

## Decisions supplied by the design

- Use the three-column grid and the `toolbox` title and search copy from the experiment, not the `list` layout or `saved` copy variant. Retain the existing footer copy recorded below instead of the experimental footer copy.
- Use the stated panel, tile, icon, text, footer, scrolling, pointer, activation, and keyboard behavior.
- Keep every existing story and state, every behavior not changed by the grid, and the exact copy “Toolbox”, “Search toolbox…” and “Saved artifacts, ready to reuse anywhere. Ask your agent to add one.”
- Use dated October 2026 folders for every finished experiment named in the task. Storybook has no `Rejected` category.

## Decisions completed during derivation

- Follow the roles, states and properties of the WAI-ARIA combobox grid-popup pattern. The input remains the only DOM focus target and carries `role="combobox"`, `aria-haspopup="grid"`, `aria-autocomplete="list"`, `aria-expanded`, `aria-controls`, and `aria-activedescendant` as applicable. The popup is a named `grid`; each visual row is a `row`; each tile is a named, selected or unselected `gridcell`. Toolbox defines its own keyboard behavior.
- Group cells into semantic rows of three. The final row has one or two cells when the result count is not divisible by three; it has no placeholder cells.
- Up with no highlight leaves the highlight clear. Only unmodified Up and Down are claimed as grid-navigation keys while the grid is present. Unmodified Left and Right are claimed only after a tile is highlighted; modified arrows, horizontal arrows with no highlight, and every arrow during input-method composition retain normal text-field behavior. An unmodified arrow at a first or last endpoint is still claimed.
- Calculate keyboard movement over the filtered items in discovery order. Down from a tile with no cell directly below moves to the final filtered tile, including when the highlighted tile is already last.
- Keep empty and error content in the existing plain text layouts instead of forcing those states into cells. Keep the 16px warning icon centred in its existing 20px slot beside the message.
- Give the scrolling body trailing space and matching scroll clearance equal to the footer's measured height. This allows all scrolling content and a keyboard-highlighted tile to move fully above the floating footer even when font metrics or themes change its height.
- Use real `row` wrappers, each containing a three-column CSS grid. This avoids relying on `display: contents` for accessibility semantics.
- Keep the historical Templates popover alternatives under `2026-10/templates-popover-alternatives`; neither its folder nor Storybook title uses an outcome category.
- Delete the empty Templates popover pilot placeholder because it declares no stories and nothing references it.

## Open questions

1. **Should Left and Right navigate after search highlights the first match?** A non-empty matching search highlights the first tile, so unmodified Left and Right immediately navigate the results in reading order; they stop at the endpoints. Modified Left and Right, including Shift, Option/Alt, Command or Control, retain normal text-field behavior. Recommendation: keep this rule because the visible highlight consistently identifies the next action, while modifiers preserve text selection and larger cursor movements.
2. **Should Up from the top row clear the highlight?** Recommendation: keep this rule because it gives the input an explicit route back to ordinary unmodified Left and Right cursor movement without clearing the query.
3. **Should Down without a tile directly below move to the last tile?** Recommendation: keep this rule because every column reaches the final available result rather than stopping above a short last row.
4. Rupert must review the drafted specification prose before the change can merge into a shared branch.

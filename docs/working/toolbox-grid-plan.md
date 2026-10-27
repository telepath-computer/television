# Toolbox grid plan

This document records the decisions and open questions for moving the approved Toolbox grid from the Storybook experiment into the UI spec, spec stories, production, and tests. The specification edits remain drafts until Rupert reviews them.

## Decisions supplied by the design

- Use the three-column grid and the existing Toolbox copy. Do not use the list layout or the Saved artifacts copy.
- Use the stated panel, tile, icon, text, footer, scrolling, pointer, activation, and keyboard behavior.
- Keep every existing story and state, every behavior not changed by the grid, and the current search and footer wording.
- Use dated October 2026 folders for every finished experiment named in the task. Storybook has no `Rejected` category.

## Decisions completed during derivation

- Follow the WAI-ARIA combobox grid-popup pattern. The input remains the only DOM focus target and carries `role="combobox"`, `aria-haspopup="grid"`, `aria-autocomplete="list"`, `aria-expanded`, `aria-controls`, and `aria-activedescendant` as applicable. The popup is a named `grid`; each visual row is a `row`; each tile is a named, selected or unselected `gridcell`.
- Group cells into semantic rows of three. The final row has one or two cells when the result count is not divisible by three; it has no placeholder cells.
- Up with no highlight leaves the highlight clear. Up and Down remain claimed as grid-navigation keys while the grid is present. Left and Right are claimed only after a tile is highlighted, so the input keeps native caret movement otherwise.
- Calculate keyboard movement over the filtered items in discovery order. Down from a tile with no cell directly below moves to the final filtered tile, including when the highlighted tile is already last.
- Keep empty and error content in the existing plain text layouts instead of forcing those states into cells. Keep the 16px warning icon centred in its existing 20px slot beside the message.
- Give the scrolling body 64px of trailing space and matching scroll clearance. This is the approved experiment value and allows the final row and a keyboard-highlighted tile to move fully above the floating footer.
- Use real `row` wrappers, each containing a three-column CSS grid. This avoids relying on `display: contents` for accessibility semantics.
- Keep the original `templates-popover-rejected` filesystem slug as a historical identifier after moving it under `2026-10`; remove `Rejected` from the Storybook title and hierarchy.
- Move the two remaining retired Templates popover placeholder files into `2026-10/templates-popover-pilot`. Do not restore the historical story implementation that is no longer in this branch.

## Open questions

1. Rupert has not confirmed the Left and Right rule. The implementation follows the task: move in reading order across rows while a tile is highlighted, stop at the first and last tiles, and leave native text-cursor behavior unchanged when no tile is highlighted.
2. Rupert must review the drafted specification prose before the change can merge into a shared branch.

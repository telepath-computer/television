*How the production menu's semantics and keyboard/pointer interaction are proven in Chromium.*

# Menu (UI) — proof

Proves [specs/ui/foundation/menu/index.md](../../../../specs/ui/foundation/menu/index.md).

## Coverage model

`packages/web/test/e2e/panel-elements.test.ts` loads the production menu and menu-item elements in Chromium. Authored action labels, a separator, and click counters are fixture data. Chromium's accessibility tree observes `ElementInternals` roles; real pointer and keyboard input exercises focus and activation. The fixture's optional prevention of button pointer-focus matches the application's host convention. No production mechanism is replaced. The fixture installs no CSS-motion override; the assertions observe settled behavior and make no motion-timing claim.

The [popover proof](../popover/index.md) owns shared pairing, dismissal, focus return, placement, and document lifecycle through the same production panel controller. Menu-specific coverage observes which item receives focus and which ordinary click is delivered. Composing surfaces own what those commands do. The existing case covers both opening methods, directional entry and traversal, end boundaries, pointer highlighting, and keyboard/pointer activation.

## Test hooks

No production test hook is required; fixture click counters observe authored actions.

## Assertions

- **Contract** (production menu and item elements in Chromium with authored actions and separator): the [markup](../../../../specs/ui/foundation/menu/index.md#markup) and [keyboard contract](../../../../specs/ui/foundation/menu/index.md#keyboard) expose menu/item semantics without authored roles; keyboard opening focuses the first action, pointer opening leaves focus in place, first Down/Up enters at the first/last action, arrows skip separators and hold at the ends, pointer movement moves the single highlight, and pointer press or Enter delivers exactly one ordinary click and closes the menu. Existing evidence: `panel-elements.test.ts`, “menu distinguishes keyboard and pointer opening and activates the highlighted action” and “manual notifications do not take keyboard navigation away from an open menu”. ^mn-ac-input

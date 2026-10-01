*How the promises in Menu view are proven.*

# Menu view — proof

Proves [specs/arch/ui/menu-view.md](../../../specs/arch/ui/menu-view.md).

## Coverage model

The production menu view composes shared elements and mints each trigger id from a module counter. The mocked-DOM contract checks two independently bound positions and a re-render, then invokes the ordinary item click handlers. It forfeits browser interaction and placement to the [menu](../../ui/foundation/menu/index.md) and [popover](../../ui/foundation/popover/index.md) proofs; composing surface tests own the application commands.

## Assertions

- **Contract** (the production menu view rendered in a mocked DOM, with authored actions recording calls; the mocked DOM forfeits layout, focus, and dismissal to the shared-element browser tests): under the [trigger-ID contract](../../../specs/arch/ui/menu-view.md), two menu positions receive distinct, nonempty trigger ids; each panel names its own trigger; a re-render preserves those ids and pairings; menu entries retain order, separators, destructive intent, and ordinary click activation — *(covered by `packages/web/test/menu.test.ts`, “MenuView (^mn-ac-markup-smoke)”)*. ^mn-ac-markup-smoke

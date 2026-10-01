*The menu-view architecture: how production views author menus, and the one rule for trigger ids.*

# Menu view

A view composes a menu by authoring the elements ([ui/foundation/menu/index.md](../../ui/foundation/menu/index.md), Markup): a trigger button carrying an id, a `<tv-menu>` naming that id, and the items as children with ordinary click listeners. Pairing, dismissal, placement, keyboard, and the trigger's expanded state are the elements' own ([elements.md](./elements.md), tv-menu and tv-popover); the view wires nothing.

What remains this architecture's is trigger ids. The `trigger` reference resolves document-wide, so a view mints each trigger id from a module-level counter: unique across the application by construction, stable for the bound position's lifetime, opaque to callers, and never derived from caller or domain identity.

## Testing

The elements own their behaviour ([ui/foundation/menu/index.md](../../ui/foundation/menu/index.md)); composing surfaces own their commands. The [companion proof](../../../proofs/arch/ui/menu-view.md) describes coverage of minted, unique, stable trigger ids in production views and the browser behavior covered by the shared elements.

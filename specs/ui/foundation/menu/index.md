*UI spec: the menu — a popover whose contents are actions, and the vocabulary its interior is built from.*

# Menu (UI)

A list of actions opened from a trigger — the overflow menu on a channel row or a tab. The menu is a popover specialization ([popover](../popover/index.md)): the panel, pairing, and dismissal are the popover's, and this spec owns the interior and the keyboard.

**Status:** current stage-one menu vocabulary and keyboard authority; contents remain the composing surface's.

## Markup

The menu is the custom element `<tv-menu>`, holding its items:

- `<tv-menu>` — the panel. It carries the popover's attributes — `trigger`, `manual`, `open` — with the popover's meanings ([popover](../popover/index.md), Markup).
- `<tv-menu-item>` — one action: the label is the content, and a press or Enter activates it. An action is a command — nothing is selected or persisted by the menu. `intent="danger"` marks a destructive action, worn as the danger color ([ui/foundation/button/index.md](../button/index.md), intents).
- `<hr>` between items draws a separator.

The elements carry the menu semantics themselves — the menu role, the item roles, the keyboard — so the composing surface writes no roles and no wiring: a trigger button with an id, the panel naming it, the items inside. [frames/foundations/menu.frame](../../../../frames/foundations/menu.frame) stages the specimen, and [styles.css](./styles.css) states the interior.

## Keyboard

A menu opened from the keyboard focuses its first action; a menu opened by pointer leaves focus where it was, and the first arrow press enters the list — Down at the first action, Up at the last. The arrow keys move between actions, skipping separators; focus stays on the first action when Up has nowhere to go and on the last when Down has nowhere to go. The highlight is singular across input methods: pointing at an action moves it there, and the arrow keys continue from wherever it last was. Enter activates the highlighted action, and activating an action closes the menu. Escape and light dismiss are the popover's.

## Testing

The [companion proof](../../../../proofs/ui/foundation/menu/index.md) describes the production-element browser coverage and its boundaries. The [popover](../popover/index.md) owns dismissal, placement, and the trigger contract; composing surfaces own their commands and what those commands do.

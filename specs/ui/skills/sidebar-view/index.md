*UI spec: the sidebar-view skill's surface — a master–detail artifact whose sidebar navigates views authored within the artifact; its interaction, markup, and styling.*

# Sidebar view (UI)

The sidebar-view skill produces a master–detail artifact: a navigation sidebar of items, in groups, beside a detail pane where views render. The artifact authors its own views; the sidebar selection determines which shows. This directory owns the surface's interaction, markup, and styling ([spec-ui.md](../../../spec-ui.md)).

**Status:** non-shipping prototype authority by architect ruling. The skill is deliberately unregistered and unpublished ([arch/skills/sidebar-view.md](../../../arch/skills/sidebar-view.md)). Registration requires a separate publication/conformance pass, including an accessible keyboard and focus model. This specified boundary keeps prototype behavior from becoming shipping authority through registration alone; [TV-585](https://linear.app/telepath-computer/issue/TV-585) owns Rupert confirming the publication requirements or replacing them.

The supporting artifacts, each authoritative:

- [ui/skills/sidebar-view/template.liquid](./template.liquid) — the rendered markup: a `tv-sidebar` of `tv-sidebar-group`s (optional `h2` title), each of `tv-sidebar-item`s — an item carries its identity in the `item` attribute, its label in a `<label>`, and `selected` when it is the selection — beside the detail pane of `tv-view`s, each keyed to an item by the same `item` identity, `shown` when its item is the selection. A view's content is free-form authored markup. No icons for now.
- [ui/skills/sidebar-view/styles.css](./styles.css) — the styling. Things 3-leaning direction; values are literal while the design settles.

Points:

- Pressing an item selects it: the selection moves to it on press, not on release.
- One item is selected at a time, across the whole sidebar: authored initial markup has exactly one `selected` item and `shown` on its matching view; selecting another item deselects the previous selection and switches the shown view.
- Pressing the already-selected item does nothing.
- Selection determines what the detail pane shows: the detail pane holds one view per item, keyed by the same identity, and the view matching the selection is the one shown. A view's content is free-form — what's inside is the artifact's own business, not specified here.
- A label too long for the sidebar truncates with an ellipsis, and never shows a whitespace gap before the ellipsis ("carriage…", not "carriage …").
- Items always live in groups; an untitled group is the idiom for ungrouped items.
- Views are authored within the artifact the sidebar belongs to; the sidebar is not a shell for navigating other artifacts. View contents are free-form authored markup placed inside the matching `tv-view`; that is the prototype's complete construction model.
- The boundary between the sidebar and the detail pane can be dragged to resize the sidebar, between a minimum and a maximum width. The chosen width is remembered per artifact and shared by everyone viewing it: resizing the sidebar in one browser resizes it in every other. Someone viewing the artifact through a read-only share link sees the shared width and can resize the sidebar only for themselves.
- The prototype specifies pointer selection only. It makes no keyboard or focus promise and is not publication-quality accessibility authority; those behaviors must be designed before registration.

*Arch spec: the elements Television defines — each one's name and public API.*

# Elements

The elements Television defines, whether the app writes them in its own chrome or an artifact writes them in its document ([arch/ui/index.md](./index.md)). Each entry is an element's contract: its name, the markup it is written as, its attributes, and its scripting and styling API. What each live element looks like is specified by its UI spec. What a frozen canonical version shipped is held by that version's committed stylesheet and component bundle ([../canonical.md](../canonical.md)), not rebuilt from the live element.

Canonical ([../canonical.md](../canonical.md)) makes some of these public to artifacts. A public element's contract is additionally held to its version's compatibility rule, so an entry here is what that version has promised.

## tv-icon

Realizes the icon surface ([../../ui/foundation/icons/index.md](../../ui/foundation/icons/index.md)): draws one glyph from the set. A custom element, registered by the app and by canonical's `components.js`.

- **`name`** — required; which icon to draw, one of the names in the set's `icons.yml`. The names v1 has made public are permanent.
- **`size`** — optional, `sm | md | lg | xl`, each a stated pixel size; absent, the icon is `1em` square and follows the text it sits in.
- **`spinning`** — optional boolean attribute; present, the icon turns continuously.

The element carries the set, so every public name draws without a further request.

The element renders its styles and named glyph in its own open shadow root ([../../ui/foundation/icons/index.md#^ic-light-dom](../../ui/foundation/icons/index.md#^ic-light-dom)). Authored surface markup supplies that root declaratively; on upgrade, an icon without one attaches and populates an equivalent root imperatively. The icon therefore works wherever an author writes it, including inside an author-created shadow root, as part of the public contract. The shadow internals are rendered implementation, not a canonical authoring API: no internal selector, part, or structure is public.

No properties, methods, or events. No custom properties either: the inherited font-size and `currentColor` cross into the shadow root and size and colour the glyph.

## checkbox-list, checkbox-item

Realize the checklist surface ([../../ui/foundation/checkbox-list/index.md](../../ui/foundation/checkbox-list/index.md)): rows carrying a done mark. Custom elements, registered by canonical's `components.js`. The box and its check are drawn entirely by the document stylesheet.

- `<checkbox-list>` takes `<checkbox-item>` children and nothing else.
- `<checkbox-item>` holds the row's own content, the author's to write.
- **`checked`** — optional boolean attribute on an item; present, the row reads as done.

No scripting API — no properties, methods, or events — and nothing toggles: what a row states is the markup the author wrote.

The elements and their author-written row content stay in light DOM. They are page-content vocabulary, and composition inside an author-created shadow root is not part of their contract.

The styling API is the tag names and `checked`. Checked marker fill and border consume the shared foundation token `--checkbox-color`, defined in [the color vocabulary](../../ui/foundation/tokens/colors.css). The remaining styling is defined in the checklist UI stylesheet. A checklist that wants different spacing or a different done treatment writes ordinary CSS against the elements it already has.

## tv-popover

Realizes the popover surface ([../../ui/foundation/popover/index.md](../../ui/foundation/popover/index.md)). A custom element, registered by the app and by canonical's `components.js`. The authored attributes — `trigger`, `manual`, `open` — are stated in the Markup section there.

Script opens and closes the panel by setting and removing the `open` attribute; what happens when the panel opens and closes is stated by the UI spec. There are no properties, methods, or events; one is added when a surface needs it.

The element owns `aria-expanded` on the button the `trigger` attribute names — the code contract behind the expanded-state behaviour the UI spec states ([../../ui/foundation/popover/index.md#trigger](../../ui/foundation/popover/index.md#trigger)):

- When the element connects and finds its trigger, it writes the attribute: `"true"` if the panel is open, `"false"` if not.
- When `open` is set, it writes `"true"`; when `open` is removed, it writes `"false"` — in the same moment, whoever changed the attribute.
- When a re-render replaces the trigger or strips its attributes, the element re-asserts the current value.
- When the element disconnects, it removes the attribute from the trigger it was paired with. View templates author panels closed: `open` is element-managed state, and a template that never binds it cannot clobber it on a re-render. Dismissal and exclusivity listeners are document-level, one set shared by every instance. Contents stay in light DOM, written by the composing surface.

## tv-menu, tv-menu-item

Realize the menu surface ([../../ui/foundation/menu/index.md](../../ui/foundation/menu/index.md)). Custom elements, registered by the app and by canonical's `components.js`. `tv-menu` is a popover specialization: it carries the popover's attributes with the popover's meanings and the popover's `open` scripting contract, and adds the menu semantics — its own `role="menu"`, each item's `role="menuitem"`, and the keyboard behaviour the UI spec states — set through `ElementInternals`, so authored markup carries no roles.

The authored markup is stated in the Markup section of the UI spec. Items and separators stay in light DOM, written by the composing surface; item activation is an ordinary click, so a view binds a listener and no callback API exists. As with the popover: no properties, methods, or events until a surface needs one.

## tv-select, tv-option

Realize the select surface ([../../ui/foundation/select/index.md](../../ui/foundation/select/index.md)). Custom elements, registered by the app and by canonical's `components.js`. `tv-select` is a popover specialization: it carries the popover's attributes with the popover's meanings and the popover's `open` scripting contract, and adds the selection semantics — the panel's own `role="listbox"`, each option's `role="option"` and `aria-selected`, and the selection and keyboard behaviour the UI spec states — the elements' own roles set through `ElementInternals`, so authored markup carries no roles.

Selects are excluded from popover exclusivity in both directions, as stated by the [select UI spec](../../ui/foundation/select/index.md#popover-exclusivity). The shared implementation must not close popovers or menus when a select opens, or close selects when a popover or menu opens through that rule.

The authored markup is stated in the Markup section of the UI spec; options stay in light DOM, written by the composing surface. On `<tv-option>`:

- **`value`** — required; the value the option stands for.
- **`selected`** — boolean; the selection. Authored to state the initial choice; element-managed thereafter — a commit moves the attribute to the committed option. With none authored, the element selects the first option.
- **`highlighted`** — element-managed only, never authored: present on the highlighted option while the panel is open, singular by construction.

The scripting surface, on `<tv-select>`:

- **`value`** — property: reads the selected option's `value`; assigning selects the option carrying that value, without firing `change`. Assigning a value no option carries changes nothing.
- **`change`** — an ordinary event, dispatched on the element when a commit changes the selection. Committing the already-selected option fires nothing.

While the panel is open, the keyboard contract the UI spec states is delivered by document-level listeners, one set shared by every instance like the popover's dismissal listeners — never by trigger focus, which a pointer press does not confer. The keys the UI spec binds are consumed while a panel is open and reach nothing else.

The UI spec binds the trigger's visible content and its widest-option width, including that ordinary CSS on the trigger overrides the width; how the element reserves that width is its own, provided a plain `width` declaration on the trigger still wins.

Placement uses one shared implementation for every popover-family panel. Popovers and menus open below the trigger with left edges aligned; `tv-select` retains its separate alignment over the selected option. The shared implementation handles window-edge flipping. There is no per-surface direction attribute or artifact-menu exception.

The trigger contract extends the popover's: beyond `aria-expanded`, the element owns the trigger's content — the selected option's label and the select caret, rewritten on every selection change — and the trigger's combobox semantics: `role="combobox"`, `aria-haspopup="listbox"`, `aria-controls` naming the panel, and `aria-activedescendant` naming the highlighted option while the panel is open. As with the popover's `aria-expanded`: written when the element connects and finds its trigger, re-asserted when a re-render replaces the trigger or strips its attributes, removed when the element disconnects. Ids the pairing needs — the panel's, an option's — are minted by the element where the markup carries none: opaque, unique, and stable for the element's lifetime, following the same discipline [menu-view.md](./menu-view.md) states for trigger ids.

## Testing

The testing policy says to name coverage provided by other specs rather than duplicate it ([testing-policy.md#Tests are the validation mechanism](../testing-policy.md#Tests are the validation mechanism)). The [icon](../../ui/foundation/icons/index.md), [checkbox-list](../../ui/foundation/checkbox-list/index.md), [popover](../../ui/foundation/popover/index.md), [menu](../../ui/foundation/menu/index.md), and [select](../../ui/foundation/select/index.md) UI specs own coverage of element behavior. [Canonical](../canonical.md) owns coverage of making elements public and preserving compatibility, and [UI architecture](./index.md) owns coverage of module structure. This spec does not require tests that duplicate that coverage.

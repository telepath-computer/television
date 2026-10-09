*Arch spec: the tv-sidebar-view skill's bundle facts — where it keeps the sidebar width, event stance, known gaps against its ui spec, and how each shipped file was derived.*

# Sidebar-view skill (architecture)

The per-skill record for `tv-sidebar-view` (`packages/skills/skills/tv-sidebar-view/`). Its surface is owned by [ui/skills/sidebar-view/index.md](../../ui/skills/sidebar-view/index.md); how skills are made in general is [arch/making-skills.md](../making-skills.md). This spec holds only what is true of *this* skill's bundle and would otherwise live in code comments.

**Status: non-shipping prototype by architect ruling.** The skill is deliberately absent from `skills.json`, so it is not built or published (releases publish automatically from main). To try it locally: add `"tv-sidebar-view"` to `skills.json`, `npm run build` in `packages/skills`, and do not commit the registration. Registration is a separate publication decision after review of UI accessibility, carried-asset conformance, and the known gap below. This specified boundary prevents registration from making the publication decision implicitly; [TV-585](https://linear.app/telepath-computer/issue/TV-585) owns Rupert confirming the publication requirements or replacing them.

## Storage

The remembered sidebar width (the ui spec's "remembered per artifact and shared by everyone viewing it") is a number of CSS pixels at the path `tv-sidebar-view/width` in the artifact's own [JSON store](../../product/resources/json-store.md), which the carried JS reaches through the resource SDK. The sidebar takes the stored width and follows changes to it, and keeps its default width while the store holds none or cannot be read. A resize writes the width; when the store refuses the write, as it does for a page with `read` access, or the write fails, the new width stays in that page.

## Events

v1 exposes **no public selection event**: the carried JS switches views internally (item identity → matching `tv-view`), and artifacts have no supported way to observe selection. Deliberate — the ui spec's boundary ("the sidebar knows nothing about views" beyond identity) is honored inside the component, and the API surface stays unfrozen until a real consumer needs it. Adding a public event is a spec change here first.

## Prototype and publication boundary

The carried behavior is pointer-only. Because the prototype is unregistered, no shipping assertion or package-build promise is created for it. Promotion requires the UI spec to define keyboard/focus behavior, conformance proof for the carried CSS/JS/SKILL files, and repair of the truncation gap below; registration must not be used to discover those requirements after publication.

## Known gap

- The UI spec's truncation point — a label never shows a whitespace gap before its ellipsis — is unimplemented (plain CSS `text-overflow: ellipsis`; the trim needs measurement logic). Acknowledged in the carried JS header; conformance debt, not an oversight.

## Derivation

Per the mechanisms of [arch/making-skills.md](../making-skills.md):

| Shipped file | Mechanism |
|---|---|
| `sidebar.css` | copy — the ui spec's `styles.css` verbatim, plus the artifact page-sizing block its header declares |
| `SKILL.md` | authored — hand-written against the ui spec's points; exemplar markup hand-rendered from the template (baked once bake tooling exists) |
| `sidebar.js` | implemented — against the ui spec's interaction points, plus the storage contract above |

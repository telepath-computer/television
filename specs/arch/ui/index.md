*Arch spec: how the UI is implemented.*

# UI architecture

What each surface looks like and does is owned by its UI spec ([../../spec-ui.md](../../spec-ui.md)); this spec owns the shape of the code that realizes them.

UI surfaces materialize through views, the application root included: the entry module renders the app view into the document. A custom element exists only where the tag itself is the interface — an element canonical makes public for foreign documents to write. Views need not correspond one-to-one with surfaces, and their arguments need not follow the argument structure of the surface's templates: how surfaces decompose into views, and what each view takes, are implementation choices unless an arch spec specifies them.

The web client requires browser `localStorage` and does not fall back when it is absent. If `localStorage` is unavailable, the entry script aborts with a console error and leaves a blank page.

## Client-persisted preferences

Per-client memory persists in browser `localStorage`, one standalone key per concern, owned by a small module that declares the key and its record shape; new keys take the `tv-` prefix. Each persisted concern's contract lives in the spec that owns it; this section owns the convention. ^ui-client-prefs

## Documents

The application specifies two documents ([spec-ui.md#authority](../../spec-ui.md#authority)), each realized once:

- The application document — `packages/web/src/index.html`, whose root carries the app-document marker and into which the entry module renders the app view. Its stylesheet is the complete foundation, [ui/foundation/index.css](../../ui/foundation/index.css); [foundation.md](./foundation.md) states how that crosses to production.
- The artifact document — the document an artifact renders in. It carries the stylesheet and components script of the canonical version it links ([canonical.md](../canonical.md)), then the active theme, then the artifact's own styling. The application document and its stylesheet never reach it.

The entry module exposes [Electron context](../updates/desktop-upgrade-gate.md#^electron-context) to stylesheets by setting `data-platform="electron"` on the application document root when `?mode=electron` is present, and omitting the attribute otherwise. ^ui-platform-marker

## Views

Every view is a `View` ([lit-view.md](./lit-view.md)). The class is defined on its own, and the export wraps it once — `class SkillList extends View { … }` then `export const SkillListView = view(SkillList)` — so every view is invoked the same way at every call site.

Views hold UI state only — the transient state of their own surface. Application state lives in services: a view subscribes in `connected()`, unsubscribes in `disconnected()`, and changes application state by calling service methods, never by holding it. Views communicate upward through callbacks passed as arguments.

A view receives everything it depends on — services included — as host arguments; service resolution happens at the composition root that renders it. A custom element receives nothing and resolves nothing: configured through its attributes and properties alone, it behaves identically in any document — the app's or an artifact's — which is the portability a public element exists for.

Views live in `packages/web/src/views/`, each with its styles in a sibling `.css` file the view imports.

## Rendering

Templates are lit-html. Rendering is declarative by default — `template()` derives the markup, `render()` commits it. Imperative DOM mutation is used where it matters, a judgment the implementing model makes unless an arch spec specifies it. The clear cases: element identity that must survive reordering (iframes reload when re-inserted — order with `moveBefore`), and gesture-driven choreography whose transient DOM changes happen outside the data flow (drag, the channel-change transition).

Keyed collections render with lit's `repeat` by default; the identity-critical ones are the imperative case above.

## Styling

A global stylesheet realizes the foundation styling that the app delivers ([foundation.md](./foundation.md)), divided into module files as needed. Implementation-owned host scaffolding and styling under a named code-governed carve-out may use additional sibling sheets imported by the same module.

One module under `packages/web/src/` owns the app document's active-theme stylesheet, main-script include, both sandboxed frame documents, host-to-frame pointer forwarding, and frame-focus guard. The app view supplies the permanent CSS foreground element specified by the [app UI](../../ui/app/index.md#^app-theme-visual-layers). [Theme delivery](../themes/delivery.md) owns everything else about how theme resources reach documents.

## Custom elements

A custom element is a direct, framework-free `HTMLElement` subclass. Its element contract owns whether author light DOM or an element shadow root holds its contents; any imperative rendering is synchronous with its attribute and lifecycle callbacks. Where views take callbacks, elements dispatch events: each event is an `Event` subclass carrying its payload as typed fields — never `CustomEvent` with `detail`.

Custom-element modules live in `packages/web/src/elements/`, with their styles in a sibling `.css` file the module imports. Custom elements carry the `tv-` prefix, canonical's public elements included. The prefix yields only to the versioning contract: a name a canonical version has already shipped is permanent as shipped ([arch/canonical.md](../canonical.md)'s v1 set), so it keeps the name it shipped under.

For live canonical versions, `packages/canonical/canonical-components.ts` imports the production element modules it makes public from `packages/web/src/elements/`. Making them public creates neither a second element implementation nor a second module shape.

## Theme application

Theme selection, clearing, and live package updates apply to the application under [themes and appearance](../../product/themes-and-appearance.md). [Theme delivery](../themes/delivery.md) owns how the active resources reach the application; each [UI surface](../../spec-ui.md) owns its rendered appearance. ^ui-browser-theme-scope

## Related architecture specs

- [foundation.md](./foundation.md): how foundation and element stylesheets cross into production, and the Electron drag-region convention.
- [keyboard-navigation.md](./keyboard-navigation.md): the shell's navigation handler.
- [overflow-fade.md](./overflow-fade.md): the helper that fades items at scrollport edges.

## Testing

Engineering review judges whether view and custom-element modules conform to these rules. The repository heuristic checks only the declaration and registration syntax the current tree uses, so passing it does not prove that every production view or custom element conforms.

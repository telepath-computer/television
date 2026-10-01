*Arch spec: how the UI is implemented.*

# UI architecture

What each surface looks like and does is owned by its UI spec ([../../spec-ui.md](../../spec-ui.md)); this spec owns the shape of the code that realizes them.

UI surfaces materialize through views, the application root included: the entry module renders the app view into the document. A custom element exists only where the tag itself is the interface — an element canonical makes public for foreign documents to write; otherwise none is involved. Views need not correspond one-to-one with surfaces, and their arguments need not adhere to the argument structure of the surface's templates — how surfaces decompose into views, and what each view takes, are choices made by the implementing model according to the best implementation approach, or specified independently under arch specs where they matter.

**Status:** implemented app UI architecture.

The web client requires browser `localStorage` and is not expected to fall back gracefully or handle its absence. If `localStorage` is unavailable, the entry script aborts with a console error and leaves a blank page. A small user-facing message explaining the failure is desired and tracked in [TV-708](https://linear.app/telepath-computer/issue/TV-708/web-client-show-a-small-message-when-browser-storage-is-unavailable).

## Client-persisted preferences

Per-client memory persists in browser `localStorage`, one standalone key per concern, owned by a small module that declares the key and its record shape; new keys take the `tv-` prefix. Each persisted concern's contract lives in the spec that owns it; this section owns the convention. ^ui-client-prefs

## Documents

The application specifies two documents ([spec-ui.md#authority](../../spec-ui.md#authority)), each realized once:

- The application document — `packages/web/src/index.html`, whose root carries the app-document marker and into which the entry module renders the app view. Its stylesheet is the complete foundation, [ui/foundation/index.css](../../ui/foundation/index.css); [foundation.md](./foundation.md) states how that crosses to production.
- The artifact document — the document an artifact renders in. It carries the stylesheet and components script of the canonical version it links ([canonical.md](../canonical.md)), then the active theme, then the artifact's own styling. The application document and its stylesheet never reach it.

The entry module exposes [Electron context](../updates/desktop-upgrade-gate.md#^electron-context) to stylesheets by setting `data-platform="electron"` on the application document root when `?mode=electron` is present, and omitting the attribute otherwise. ^ui-platform-marker

## Views

Every view is a `View` ([lit-view.md](./lit-view.md)): host arguments in, `template()` deriving the output, `connected()`/`disconnected()` around anything held, `render()` to commit.

The class is defined on its own, and the export wraps it once — `class SkillList extends View { … }` then `export const SkillListView = view(SkillList)` — so every view is invoked the same way at every call site.

Views hold UI state only — the transient state of their own surface. Application state lives in services: a view subscribes in `connected()`, unsubscribes in `disconnected()`, and changes application state by calling service methods, never by holding it. Views communicate upward through callbacks passed as arguments.

A view receives everything it depends on — services included — as host arguments; service resolution happens at the composition root that renders it. A custom element receives nothing and resolves nothing: configured through its attributes and properties alone, it behaves identically in any document — the app's or an artifact's — which is the portability a public element exists for.

Views live in `packages/web/src/views/`, each with its styles in a sibling `.css` file the view imports.

## Rendering

Templates are lit-html. Rendering is declarative by default — `template()` derives the markup, `render()` commits it. Imperative DOM mutation is used where it matters, a judgment the implementing model makes unless an arch spec specifies it. The clear cases: element identity that must survive reordering (iframes reload when re-inserted — order with `moveBefore`), and gesture-driven choreography where transient surgery happens outside the data flow (drag, the channel-change transition).

Keyed collections render with lit's `repeat` by default; the identity-critical ones are the imperative case above.

## Styling

A global stylesheet realizes the foundation styling that the app delivers ([foundation.md](./foundation.md)), divided into module files as needed. A view's own styles are its sibling `.css`, per Views above. Implementation-owned host scaffolding and styling under a named code-governed carve-out may use additional sibling sheets imported by the same module.

One module under `packages/web/src/` owns the app document's active-theme stylesheet, main-script include, both sandboxed frame documents, host-to-frame pointer forwarding, and frame-focus guard. Theme JavaScript is application-only and never enters artifact documents. The app view supplies the permanent CSS foreground element specified by the [app UI](../../ui/app/index.md#^app-theme-visual-layers). The Clouds UI stylesheet crosses into its installed bundled package and does not enter the compiled web import graph. The markdown editor and the two built-in error documents load the fixed-`system` resolver before `/canonical/v2/styles.css`; view-specific styles follow canonical. [Theme delivery](../themes/delivery.md) owns resource URLs, stylesheet and script installation, manifest and consent gates, refresh and reset lifecycles, iframe isolation, pointer transport, focus restoration, appearance continuity, and the root appearance resolver.

## Helpers

[Overflow fade](./overflow-fade.md) owns the independent helper that positions per-item masks at scrollport edges while preserving backdrop blur.

## Custom elements

A custom element is a direct, framework-free `HTMLElement` subclass. Its element contract owns whether author light DOM or an element shadow root holds its contents; any imperative rendering is synchronous with its attribute and lifecycle callbacks. Where views take callbacks, elements dispatch events: each event is an `Event` subclass carrying its payload as typed fields — never `CustomEvent` with `detail`.

Custom-element modules live in `packages/web/src/elements/`, with their styles in a sibling `.css` file the module imports. Custom elements carry the `tv-` prefix, canonical's public elements included. The prefix yields only to the versioning contract: a name a canonical version has already shipped is permanent as shipped ([arch/canonical.md](../canonical.md)'s v1 set), so it keeps the name it shipped under.

For live canonical versions, `packages/canonical/canonical-components.ts` imports the production element modules it makes public from `packages/web/src/elements/`. Making them public creates neither a second element implementation nor a second module shape. A frozen canonical version instead serves its committed `components.js`; it does not rebuild from this entry or inherit later module changes.

## Foundation

The foundation crossing, membership, ambient delivery, and Electron drag-region convention are [foundation.md](./foundation.md)'s.

## Theme application

Theme selection, clearing, and live package updates apply to the application under [themes and appearance](../../product/themes-and-appearance.md). [Theme delivery](../themes/delivery.md) owns how the active resources reach the application; each [UI surface](../../spec-ui.md) owns its rendered appearance. ^ui-browser-theme-scope

## Keyboard navigation

The shell's navigation handler — the single policy point the chord's three delivery paths feed — is [arch/ui/keyboard-navigation.md](./keyboard-navigation.md)'s.

## Testing

Testing is governed by [../testing-policy.md](../testing-policy.md) unless otherwise specified here. What a surface's suite is responsible for — and what it is not — is the testing policy's ([../testing-policy.md#^ui-suite-scope](../testing-policy.md#^ui-suite-scope)).

Engineering review judges complete conformance to the rules for view and custom-element modules. The review compares the production tree with this architecture and the repository's code style. The repository heuristic checks only the declaration and registration syntax used in the current tree. Equivalent declarations or registrations written with different syntax escape the heuristic. Passing the heuristic therefore does not prove that every production view or custom element conforms.

*Arch spec: the lit-view module — stateful views for lit-html; what each member does with lit's directive machinery.*

# lit-view

A base class over lit-html's `AsyncDirective` giving views a plain lifecycle vocabulary. It is for views that hold instance state — a subscription, a timer, an owned node — and want to live inside lit-html templates without adopting a component framework: acquire when you become live, release when you leave, derive your output in one place, commit whenever you need to.

## Module

`@telepath-computer/utils/lit-view` (`packages/utils/src/lit-view.ts`), exporting two names: the abstract class **`View`** and the wrapper **`view()`**. Its one dependency is `lit-html` — specifically `AsyncDirective` and `directive` from `lit-html/async-directive.js` and `noChange` from `lit-html`. The module's whole point is to specify a precise use of that machinery; the members below are defined by what they do with it.

## API

```ts
class SkillList extends View {
  #unsubscribe?: () => void;

  connected()    { this.#unsubscribe = service.subscribe(() => this.render()); }
  disconnected() { this.#unsubscribe?.(); this.#unsubscribe = undefined; }

  template() { return html`…derived from current state…`; }
}

export const SkillListView = view(SkillList);
```

- **`view(Class)`** — calls lit's `directive(Class)` and returns the resulting template-callable. Invoking it in a template produces a `DirectiveResult`; lit constructs **one instance per bound child position** and reuses that instance for every subsequent host render at the position. Convention: the class defined on its own, the export wrapping it once.
- **The host path** — the base overrides `Directive.update(part, args)`, lit's host-render entry: it stores the arguments, then — under the commit guard — runs `connected()` on first activation and returns `template(...args)` as the value lit commits. `connected()` running guarded is load-bearing: a subscription that notifies synchronously calls `render()`, which no-ops, and the returned value already carries that state. The directive's own `render()` slot is never used — which is what frees the `render` name for committing on the instance.
- **`connected()`** — the view is live: acquire. Invoked from `update()` on first activation, and again from lit's `reconnected()` callback after every reattachment, so acquisition must be re-runnable. Both invocations run under the commit guard: anything `connected()` triggers synchronously defers to the path that invoked it.
- **`disconnected()`** — the view is paused or gone: release. This *is* lit's `AsyncDirective.disconnected()` callback, implemented directly by the subclass. Lit fires it when the part's tree leaves the document — a removal, a cached swap-out, a keyed list move — and may follow it with `reconnected()`. Do not use Lit's `keyed()` directive to replace a template containing views: it resets the part's committed value before clearing, so discarded nested views miss disconnection. Those views can retain subscriptions, global listeners, owned objects, and their reachable state indefinitely, creating a memory leak and allowing callbacks to run after their DOM has disappeared. Use a keyed `repeat()` when replacement must release nested view resources.
- **`template(...args)`** — derive output from the latest host arguments; any lit-renderable value. Defaults to `noChange` (lit: leave the committed value as it is), for views that paint entirely by hand.
- **`this.render(t?)`** — commit via `AsyncDirective.setValue()`: `t`, or `template()` called with the stored host arguments when bare. Guarded twice: it no-ops when `this.isConnected` is false (lit warns on detached `setValue`), and no-ops during a host render (calling `setValue` from inside `update()` is illegal in lit — there, the host path's return value carries).
- **`reconnected()`** — reserved by the base; subclasses do not override it. It maps lit's reattachment callback to `connected()` under the commit guard, then a conditional, deferred catch-up: if the same render pass re-runs `update()`, the host path carries current state and the catch-up is dropped; otherwise a microtask commits `render()` after the pass unwinds — where `setValue` is legal. Catch-up for notifications missed while detached, never committed mid-render.

## Guarantees

- `connected()` runs exactly once per period of attachment; host re-renders do not repeat it.
- After a reconnect, the committed output reflects current state with no subclass code — via the host path when the reattachment re-renders the view, via a microtask-deferred commit when it doesn't.
- `render()` never throws for lifecycle reasons: detached and mid-host-render calls are no-ops — including calls from inside `connected()`, which always runs under the guard.
- A stable node returned from `template()` keeps its identity across host renders: lit's `ChildPart` dirty-checks the committed value by identity and no-ops on the same node — the recipe for identity-critical interiors (live iframes, keyed syncs), where the view mutates its owned subtree and returns the same element every time.

## Non-goals

No scheduling or batching (commits are synchronous — the reconnection catch-up, deferred one microtask, is the sole exception), no reactive properties (arguments arrive from the host; shared state belongs to whatever owns it), no shadow DOM, no styles, no element identity. If a view needs to be a real custom element, make one — this class is for views that don't.

## Testing

The testing policy permits jsdom for contract coverage of the lifecycle and commit cases ([mocking policy](../testing-policy.md#Mocking policy)). That coverage does not establish node or iframe behavior in a real browser. Coverage of the guarantee that a stable node keeps its identity must therefore exercise lit-html's real `ChildPart` with an owned iframe in a real browser.

The testing policy says to name coverage provided by other specs rather than duplicate it ([testing-policy.md#Tests are the validation mechanism](../testing-policy.md#Tests are the validation mechanism)). [Product artifacts](../../product/artifacts.md) owns coverage of the real artifact frame's production view composition. It also owns coverage of a live artifact document surviving host re-renders. The base `View` lifecycle is proven once here. A surface's proof relies on that lifecycle coverage rather than repeating it.


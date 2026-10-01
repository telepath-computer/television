# utils

Small self-contained modules, each a subpath export of `@telepath-computer/utils`.

## disposable

Idempotent `Disposable` and `withDisposable` lifecycle helpers live at
`@telepath-computer/utils/disposable`. Runtime entrypoints that need the
explicit-resource-management globals import
`@telepath-computer/utils/disposable-polyfill` once before loading disposable
classes.

The lifecycle contract and authoring rules are documented in
[docs/disposable.md](docs/disposable.md).

## lit-view

Stateful views for lit-html without a component framework: a small base class over `AsyncDirective` with a plain lifecycle — `connected`/`disconnected` to acquire and release, `template` to derive, `render` to commit. Use it when a view holds something with a lifetime — a service subscription, a dwell timer, an owned DOM node — and a plain template function stops being enough. The spec is [specs/arch/ui/lit-view.md](../../specs/arch/ui/lit-view.md).

```ts
import { html } from "lit-html";
import { view, View } from "@telepath-computer/utils/lit-view";

class SkillList extends View {
  #unsubscribe?: () => void;

  connected()    { this.#unsubscribe = service.subscribe(() => this.render()); }
  disconnected() { this.#unsubscribe?.(); this.#unsubscribe = undefined; }

  template() { return html`…`; }
}

export const SkillListView = view(SkillList);

// elsewhere, in any template, at any depth:
html`<section>${SkillListView()}</section>`;
```

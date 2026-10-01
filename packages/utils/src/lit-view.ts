import { noChange } from "lit-html";
import type { Part } from "lit-html/directive.js";
import { AsyncDirective, directive } from "lit-html/async-directive.js";

// A small view base over lit-html's AsyncDirective, giving views a plain
// lifecycle vocabulary. Spec: specs/arch/ui/lit-view.md; the shape in one glance:
//
//   connected()     — you are live: acquire (subscribe, start timers).
//                     Runs on first render and again after every reconnect.
//   disconnected()  — you are paused or gone: release. This is lit's own
//                     callback used directly, and it may be followed by
//                     connected() again — a list move, a cached swap.
//   template(args)  — derive your output from the latest host arguments.
//                     Defaults to nothing, for views that paint by hand.
//   this.render(t?) — commit: t, or template() when called bare. Safe from
//                     subscriptions and timers: it no-ops while detached, and
//                     during a host render the host's own result carries.
//
// The host path routes through update(), leaving the directive's render()
// slot unused — which is what frees the name for committing. After a
// reconnect the base re-runs connected() and catches up — via the host
// render when one carries the reattachment, else a microtask commit — so a
// restored view can never show stale state. Subclasses do not override
// reconnected.

export abstract class View<Args extends unknown[] = []> extends AsyncDirective {
  #args = [] as unknown as Args;
  #live = false;
  #guarded = false;
  #catchUp = false;

  connected(): void {}

  template(..._args: Args): unknown {
    return noChange;
  }

  render(...committed: unknown[]): unknown {
    if (!this.isConnected || this.#guarded) return noChange;
    this.setValue(committed.length ? committed[0] : this.template(...this.#args));
    return noChange;
  }

  override update(_part: Part, args: Args): unknown {
    this.#args = args;
    this.#catchUp = false;
    this.#guarded = true;
    try {
      if (!this.#live) {
        this.#live = true;
        this.connected();
      }
      return this.template(...args);
    } finally {
      this.#guarded = false;
    }
  }

  // connected() runs under the guard: a subscription notifying synchronously
  // defers to whichever path invoked it. The catch-up is conditional and
  // deferred — a host update() in the same pass carries current state and
  // drops it; otherwise it commits once the pass has unwound, where
  // setValue is legal.
  protected override reconnected(): void {
    this.#guarded = true;
    try {
      this.connected();
    } finally {
      this.#guarded = false;
    }
    this.#catchUp = true;
    queueMicrotask(() => {
      if (!this.#catchUp) return;
      this.#catchUp = false;
      this.render();
    });
  }
}

/**
 * Wraps a View subclass as the callable used in templates:
 *
 *   class SkillList extends View { ... }
 *   export const SkillListView = view(SkillList);
 */
export function view<Args extends unknown[]>(
  Ctor: abstract new (...args: never[]) => View<Args>,
): (...args: Args) => unknown {
  return directive(Ctor as never) as unknown as (...args: Args) => unknown;
}

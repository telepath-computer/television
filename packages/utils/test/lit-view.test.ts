import { describe, expect, test } from "vitest";
import { html, render } from "lit-html";
import { cache } from "lit-html/directives/cache.js";
import { view, View } from "../src/lit-view.ts";

// A probe view capturing its instance and lifecycle counts, deriving from an
// external source so catch-up and self-commit are observable.
let source = "initial";
let probe: InstanceType<typeof ProbeClass>;

class ProbeClass extends View<[string]> {
  connectedCount = 0;
  disconnectedCount = 0;

  connected() {
    probe = this;
    this.connectedCount += 1;
  }

  disconnected() {
    this.disconnectedCount += 1;
  }

  template(label: string) {
    return html`<p>${label}:${source}</p>`;
  }
}
const Probe = view(ProbeClass as never) as (label: string) => unknown;

function mount() {
  const el = document.createElement("div");
  document.body.append(el);
  return el;
}

describe("host rendering", () => {
  test("derives output from template() with host arguments", () => {
    const el = mount();
    render(html`${Probe("a")}`, el);
    expect(el.textContent).toBe("a:initial");
  });

  test("re-derives on new host arguments", () => {
    const el = mount();
    const page = (label: string) => html`${Probe(label)}`;
    render(page("a"), el);
    render(page("b"), el);
    expect(el.textContent).toBe("b:initial");
  });

  test("a bare subclass renders nothing", () => {
    class Bare extends View {}
    const BareView = view(Bare as never) as () => unknown;
    const el = mount();
    render(html`${BareView()}`, el);
    expect(el.textContent).toBe("");
  });
});

describe("lifecycle", () => {
  test("connected() runs once across host re-renders", () => {
    const el = mount();
    const page = (label: string) => html`${Probe(label)}`;
    render(page("a"), el);
    render(page("b"), el);
    render(page("c"), el);
    expect(probe.connectedCount).toBe(1);
    expect(el.textContent).toBe("c:initial");
  });

  test("disconnected() runs when the view leaves the tree", () => {
    const el = mount();
    render(html`${Probe("a")}`, el);
    const mounted = probe;
    render(html``, el);
    expect(mounted.disconnectedCount).toBe(1);
  });

  test("a cached swap pauses and resumes: connected() again on return", () => {
    const el = mount();
    const page = (show: boolean) => html`${cache(show ? html`${Probe("a")}` : html`<i>off</i>`)}`;
    render(page(true), el);
    const mounted = probe;
    render(page(false), el);
    expect(mounted.disconnectedCount).toBe(1);
    render(page(true), el);
    expect(mounted.connectedCount).toBe(2);
    expect(el.textContent).toBe("a:initial");
  });
});

describe("committing", () => {
  test("render() commits template() from outside a host render", () => {
    source = "initial";
    const el = mount();
    render(html`${Probe("a")}`, el);
    source = "changed";
    probe.render();
    expect(el.textContent).toBe("a:changed");
  });

  test("render(t) commits the given template", () => {
    const el = mount();
    render(html`${Probe("a")}`, el);
    probe.render(html`<p>handed</p>`);
    expect(el.textContent).toBe("handed");
  });

  test("render() after removal is a safe no-op", () => {
    source = "initial";
    const el = mount();
    render(html`${Probe("a")}`, el);
    const mounted = probe;
    render(html``, el);
    expect(() => mounted.render()).not.toThrow();
    expect(el.textContent).toBe("");
  });

  test("render() during a host render defers to the host result", () => {
    class Reentrant extends View<[string]> {
      template(label: string) {
        this.render(); // must not recurse or clobber
        return html`<p>${label}</p>`;
      }
    }
    const R = view(Reentrant as never) as (label: string) => unknown;
    const el = mount();
    expect(() => render(html`${R("ok")}`, el)).not.toThrow();
    expect(el.textContent).toBe("ok");
  });
});

// The subscribe-and-catch-up pattern the base exists for: a service that
// notifies synchronously on subscribe lands a render() call inside
// connected() — which the base runs during host renders (first activation in
// update(), reattachment in reconnected()). The committing guarantee says
// those calls are no-ops; these pin it where connected() is the caller.
describe("subscription catch-up", () => {
  test("a synchronous notification during connected() defers to the host render", () => {
    source = "initial";
    let templateCount = 0;
    class SyncCatchUp extends View {
      connected() {
        this.render();
      }
      template() {
        templateCount += 1;
        return html`<p>now:${source}</p>`;
      }
    }
    const S = view(SyncCatchUp as never) as () => unknown;
    const el = mount();
    render(html`${S()}`, el);
    expect(el.textContent).toBe("now:initial");
    expect(templateCount).toBe(1);
  });

  test("reattachment without a host render catches up in a microtask", async () => {
    source = "initial";
    const el = mount();
    const part = render(html`${Probe("a")}`, el);
    const mounted = probe;
    part.setConnected(false);
    expect(mounted.disconnectedCount).toBe(1);
    source = "changed";
    part.setConnected(true);
    expect(mounted.connectedCount).toBe(2);
    await Promise.resolve();
    expect(el.textContent).toBe("a:changed");
  });

  test("a synchronous notification during reconnection commits once, with current state", async () => {
    source = "initial";
    let templateCount = 0;
    class SyncCatchUp extends View {
      connected() {
        this.render();
      }
      template() {
        templateCount += 1;
        return html`<p>now:${source}</p>`;
      }
    }
    const S = view(SyncCatchUp as never) as () => unknown;
    const el = mount();
    const page = (show: boolean) => html`${cache(show ? html`${S()}` : html`<i>off</i>`)}`;
    render(page(true), el);
    render(page(false), el);
    source = "changed";
    templateCount = 0;
    render(page(true), el);
    expect(el.textContent).toBe("now:changed");
    expect(templateCount).toBe(1);
    await Promise.resolve();
    expect(templateCount).toBe(1);
    expect(el.textContent).toBe("now:changed");
  });

  test("a disconnect before the catch-up flushes cancels it", async () => {
    source = "initial";
    const el = mount();
    const part = render(html`${Probe("a")}`, el);
    part.setConnected(false);
    part.setConnected(true);
    part.setConnected(false);
    source = "changed";
    await Promise.resolve();
    expect(el.textContent).toBe("a:initial");
    part.setConnected(true);
    await Promise.resolve();
    expect(el.textContent).toBe("a:changed");
  });

  test("rapid reconnects before the flush coalesce to one commit", async () => {
    source = "initial";
    let templateCount = 0;
    class Counting extends View {
      template() {
        templateCount += 1;
        return html`<p>${source}</p>`;
      }
    }
    const C = view(Counting as never) as () => unknown;
    const el = mount();
    const part = render(html`${C()}`, el);
    part.setConnected(false);
    part.setConnected(true);
    part.setConnected(false);
    part.setConnected(true);
    templateCount = 0;
    await Promise.resolve();
    expect(templateCount).toBe(1);
  });
});

describe("imperative recipe", () => {
  test("a stable node returned from template() keeps its identity and mutations", () => {
    class Owned extends View<[number]> {
      node?: HTMLElement;
      template(n: number) {
        this.node ??= document.createElement("div");
        this.node.dataset.host = String(n);
        return this.node;
      }
    }
    const O = view(Owned as never) as (n: number) => unknown;
    const el = mount();
    const page = (n: number) => html`${O(n)}`;
    render(page(1), el);
    const first = el.querySelector("div")!;
    first.dataset.mutated = "yes";
    render(page(2), el);
    const second = el.querySelector("div")!;
    expect(second).toBe(first);
    expect(second.dataset.mutated).toBe("yes");
    expect(second.dataset.host).toBe("2");
  });

  test("separate positions get separate instances", () => {
    class Counting extends View {
      static instances = 0;
      connected() {
        Counting.instances += 1;
      }
      template() {
        return html`<i>x</i>`;
      }
    }
    const C = view(Counting as never) as () => unknown;
    const el = mount();
    render(html`${C()}${C()}`, el);
    expect(Counting.instances).toBe(2);
  });
});

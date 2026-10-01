import { describe, expect, it } from "vitest";
import { Disposable, withDisposable } from "@telepath-computer/utils/disposable";

class CounterDisposable extends Disposable {
  public calls = 0;

  isDisposed(): boolean {
    return this.disposed;
  }

  override dispose(): void {
    this.calls += 1;
  }
}

describe("Disposable", () => {
  it("runs subclass dispose logic once", () => {
    const disposable = new CounterDisposable();

    disposable.dispose();
    disposable.dispose();

    expect(disposable.calls).toBe(1);
  });

  it("Symbol.dispose delegates to dispose", () => {
    const disposable = new CounterDisposable();

    disposable[Symbol.dispose]();
    disposable[Symbol.dispose]();

    expect(disposable.calls).toBe(1);
  });

  it("is idempotent across mixed dispose and Symbol.dispose calls", () => {
    const disposable = new CounterDisposable();

    disposable.dispose();
    disposable[Symbol.dispose]();
    disposable.dispose();

    expect(disposable.calls).toBe(1);
  });

  it("is idempotent when Symbol.dispose is called before dispose", () => {
    const disposable = new CounterDisposable();

    disposable[Symbol.dispose]();
    disposable.dispose();
    disposable[Symbol.dispose]();

    expect(disposable.calls).toBe(1);
  });

  it("exposes disposed state before and after first disposal", () => {
    const disposable = new CounterDisposable();
    expect(disposable.isDisposed()).toBe(false);

    disposable.dispose();
    expect(disposable.isDisposed()).toBe(true);

    disposable.dispose();
    expect(disposable.isDisposed()).toBe(true);
  });
});

class CounterDisposableMixin extends withDisposable(class {}) {
  public calls = 0;

  dispose(): void {
    this.calls += 1;
  }

  isDisposed(): boolean {
    return this.disposed;
  }
}

class EventTargetDisposable extends withDisposable(EventTarget) {
  public calls = 0;

  dispose(): void {
    this.calls += 1;
  }
}

describe("withDisposable", () => {
  it("runs base dispose logic once", () => {
    const disposable = new CounterDisposableMixin();

    disposable.dispose();
    disposable.dispose();

    expect(disposable.calls).toBe(1);
  });

  it("Symbol.dispose delegates to dispose", () => {
    const disposable = new CounterDisposableMixin();

    disposable[Symbol.dispose]();
    disposable[Symbol.dispose]();

    expect(disposable.calls).toBe(1);
  });

  it("tracks disposed state", () => {
    const disposable = new CounterDisposableMixin();
    expect(disposable.isDisposed()).toBe(false);

    disposable.dispose();
    expect(disposable.isDisposed()).toBe(true);
  });

  it("works when mixed into classes that do not already implement dispose", () => {
    const disposable = new EventTargetDisposable();

    disposable.dispose();
    disposable[Symbol.dispose]();

    expect(disposable.calls).toBe(1);
  });
});

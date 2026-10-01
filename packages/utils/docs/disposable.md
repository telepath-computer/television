# Disposable specification

Defines the shared lifecycle teardown contract for app-owned classes.

## Purpose

Provide one consistent teardown API across Television-owned classes, while remaining compatible with TC39 explicit resource management.

- Canonical method: `dispose()`
- Standard protocol hook: `[Symbol.dispose]()`
- Required behavior: idempotent teardown

This spec applies to app-owned classes (services, controllers, managers, stores). Platform APIs (`WebSocket`, `FSWatcher`, etc.) keep their native methods (`close()`, etc.) and are adapted inside class `dispose()` implementations.

## Contract

## `DisposableLike`

```ts
export interface DisposableLike {
  dispose(): void;
  [Symbol.dispose](): void;
}
```

### Semantics

1. `dispose()` releases resources owned by the instance.
2. `dispose()` is idempotent (first call performs teardown, subsequent calls no-op).
3. `[Symbol.dispose]()` must delegate to `dispose()` and therefore be idempotent as well.
4. Implementations may expose a protected/internal disposed flag for guards.

## Shared implementations

`packages/utils/src/disposable.ts`, exported as `@telepath-computer/utils/disposable`, provides:

- `Disposable` base class
- `withDisposable(Base)` mixin

Both provide:

- idempotent wrapping of subclass/base `dispose()`
- `[Symbol.dispose]()` forwarding
- protected `disposed` getter

## Authoring rules

For classes using `Disposable` or `withDisposable`:

- Define `dispose` as a class method (`dispose() {}`), not a class field (`dispose = () => {}`).
- Do not reassign `this.dispose` post-construction.

These are enforced by ESLint rules in this repository (with explicit exemptions where internal wrapping is implemented).

## Usage patterns

### Extend base class

```ts
class FooService extends Disposable {
  dispose(): void {
    this.socket?.close();
    window.removeEventListener("message", this.onMessage);
  }
}
```

### Apply mixin

```ts
class Foo extends withDisposable(EventTarget) {
  dispose(): void {
    // cleanup
  }
}
```

## Testing requirements

Any new disposable implementation should verify:

- `dispose()` executes teardown once.
- mixed `dispose()` and `[Symbol.dispose]()` calls remain single-execution.
- disposed state transitions (`false` -> `true`) if state is exposed.

## Runtime support notes

TypeScript does not polyfill runtime disposable primitives. This project uses the `disposablestack` shim through `@telepath-computer/utils/disposable-polyfill` where runtime globals are needed (`Symbol.dispose`, `DisposableStack`, etc.).

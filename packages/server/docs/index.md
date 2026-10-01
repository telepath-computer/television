# Server documentation

The `@telepath-computer/television-server` package is Television's backend: an HTTP API, a WebSocket event stream, and the sole owner of persisted state under `<storagePath>`.

Its root module intentionally exposes the server/store plus the configuration and telemetry adapters consumed by the CLI. The HTTP client is owned and exported by `@telepath-computer/television-shared`; other server modules remain internal.

## Behavior

**Bootstrap.** Construction is synchronous. Serving startup and token-only construction follow different paths in [ServerStore](../src/server-store.ts); the [onboarding installer](../../../specs/arch/onboarding/installer.md) governs serving bootstrap and its default-channel conditions.

**Request handling.** Authentication depends on the selected mode and route; [server composition](../src/server.ts), [routes](../src/routes.ts), and [auth helpers](../src/auth.ts) define those checks. Authorized mutations flow through `ServerStore`, which validates input, persists to disk, updates in-memory state, and emits a typed event.

**Event flow.** The server's WebSocket handler subscribes to `ServerStore` events and broadcasts each to every connected client. The store event *is* the wire event — no mapping, no translation.

## Requirements and implementation

The [migration map](../../../specs/spec-migration.md) identifies the requirements under spec authority. The [onboarding](../../../specs/arch/onboarding/index.md), [layout](../../../specs/arch/layout/index.md), and [theme](../../../specs/arch/themes/index.md) specs govern their stated contracts. Other behavior is governed by code:

- [ServerStore](../src/server-store.ts) — persisted server state and bootstrap.
- [Artifact model](../../artifact/src/model.ts) — artifact schemas and types.
- [Auth helpers](../src/auth.ts) — token and request checks.

## Internal docs

- [ServerStore implementation notes](./server-store.md) — public API, validation, removal behavior, and events; these notes defer to the applicable specs and authoritative code.

# Server documentation

The `@telepath-computer/television-server` package is Television's backend: an HTTP API, a WebSocket event stream, and the sole owner of persisted state under `<storagePath>`.

Its root module intentionally exposes the server/store plus the configuration and telemetry adapters consumed by the CLI. The HTTP client is owned and exported by `@telepath-computer/television-shared`; other server modules remain internal.

The [server spec](../../../specs/arch/server/index.md) is the starting point for listener startup, the control API, the serving store and document delivery.

| Implementation | Governing contract |
|---|---|
| [Server composition](../src/server.ts) | [Listener lifecycle and discovery](../../../specs/arch/server/index.md) |
| [Routes](../src/routes.ts) and [events](../src/event-stream.ts) | [Client connections](../../../specs/arch/server/connections.md) |
| [ServerStore](../src/server-store.ts) | [Boot and durable state](../../../specs/arch/server/store.md) |
| [Artifact model](../../artifact/src/model.ts) and [proxy](../src/artifact-proxy.ts) | [Registry and serving](../../../specs/arch/server/artifacts.md) |

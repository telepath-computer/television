# @telepath-computer/television-server

Television's backend. HTTP API, WebSocket event stream, and the sole owner of persisted state at `<storagePath>`.

## Modules

- `server.ts` — Composition root: creates the Express app, registers routes, wires the `/events` upgrade path, owns lifecycle.
- `routes.ts` — REST route handlers (`/channels`, `/channels/:id`, `/artifacts`, `/artifacts/:id`, `/display`, `/themes`, `/artifact`, `/markdown`, and fixed `/views` assets). The server composition root mounts each `/canonical/v<n>` bundle.
- `event-stream.ts` — `/events` WebSocket server. Pure server→client pub-sub that re-broadcasts `ServerStore` domain events.
- Also includes the experimental ACP bridge modules — see [Experimental: ACP bridge (unsupported)](#experimental-acp-bridge-unsupported).
- `server-store.ts` — The `ServerStore` class. Single filesystem owner; manages token, channels, artifact manifests, and the layout-derived artifact ownership index.
- `auth.ts` — Token generation and request-authorization helpers.
- `config.ts` — Environment and default resolution for `storagePath`, ports, URLs.
- `index.ts` — Narrow package boundary for the server and the configuration and telemetry adapters consumed by the CLI.

See the [package implementation notes](./docs/index.md) for server orientation and the [migration map](../../specs/spec-migration.md) for requirements under spec authority.

## Usage

```ts
import { ServerStore, Server } from "@telepath-computer/television-server";

const store = new ServerStore({
  storagePath: "/path/to/.television",
  installOnboardingChannels: true,
});
const server = new Server({
  store,
  host: "localhost",
  port: 32848,
});
await server.start();
```

A serving store uses `installOnboardingChannels: true`; its bootstrap is governed by the [onboarding installer spec](../../specs/arch/onboarding/installer.md). A token-only construction uses `installOnboardingChannels: false` to provision the token without loading serving state. Startup depends on those options, and request authorization depends on the server’s selected authentication mode and route; see [server composition](src/server.ts) and [auth helpers](src/auth.ts).

Artifact lifecycle is one-channel-per-artifact: `POST /artifacts` requires `channelID`, writes metadata, and appends the card to that channel; `DELETE /artifacts/:id` removes the owning card and metadata; `DELETE /channels/:id` removes the channel file and hard-deletes referenced artifact records. Path and URL targets are content-only pointers and are never removed by these registry operations.

## Experimental: ACP bridge (unsupported)

> The ACP integration described below is an experimental, undocumented,
> unsupported feature. It is opt-in via `TELEVISION_ACP_AGENT` and is not part
> of Television's public surface. Skill content and the agent admin guide do
> not recommend or describe it. Future releases may change or remove it without
> notice. This section exists for developers working on the bridge itself.

The server package includes an experimental ACP bridge wiring up an OpenCLAW or Hermes chat session. The bridge is opt-in and not part of the supported public interface.

Bridge-specific modules:

- `acp-server.ts` — `/acp` WebSocket server. Owns per-connection ACP bridge lifecycle.
- `acp-bridge.ts` — child-process management for the ACP subprocess.

Environment:

`TELEVISION_ACP_AGENT` is optional. When unset, the server starts without ACP wiring. When set to `openclaw` or `hermes`, `resolveACPAgentProfile(process.env)` returns the corresponding profile; callers that want to thread an explicit profile can pass it as `acpProfile` to the `Server` constructor.

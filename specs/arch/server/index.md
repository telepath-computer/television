*The server architecture root: what a Television server is, the module map, the feature specs that own requirements the server carries out, the parts that remain code-governed on purpose, the one release a server and its clients share, and the ACP bridge's home context.*

# Server architecture

A Television server is one Node.js process serving one [Television home](../../product/cli.md#^cli-home) over HTTP and WebSockets. It keeps that home's state, serves the app and the content of artifacts, and announces every change to the clients connected to it: browsers, the desktop app, and the CLI that people and agents use. `tv serve` runs it in the foreground or as the persisted service ([product/cli.md](../../product/cli.md#Server lifecycle commands)).

## Module map

| Spec | Owns |
|---|---|
| [lifecycle.md](./lifecycle.md) | binding the listeners all or nothing, the fatal record of a failed start, what starts once the listeners are bound, the server's origins, `/health`, stopping, and the log |
| [http.md](./http.md) | authentication, the route families and whether each requires the token, refusals and unexpected failures, and the `/events` stream |
| [storage.md](./storage.md) | the home's layout, the token file, the artifact, channel and display records, one server per home, the serving bootstrap and token-only construction, and the default-channel invariant |
| [migration.md](./migration.md) | the one boot-time migration that carries a pre-redesign home forward |
| [local-content.md](./local-content.md) | the artifact proxy and the watching of artifacts' and the active theme's files |

## Requirements that feature specs own

Most of what a server does serves one feature, and that feature's spec owns it even though server code carries it out. The server specs above own the mechanisms every feature shares.

| Feature | Owning specs |
|---|---|
| Channels, pins and focus | [channel state](../channel-state/index.md), [product/channels.md](../../product/channels.md) |
| Tab pages, layout updates and artifact moves | [layout](../layout/index.md) |
| Artifacts and their documents | [product/artifacts.md](../../product/artifacts.md), [isolation](../artifact-frame/isolation.md), [proxy caching](../artifact-frame/proxy-caching.md), [the artifact bridge](../artifact-frame/artifact-bridge.md) |
| Themes and appearance | [theme architecture](../themes/index.md), [theme delivery](../themes/delivery.md), [bundled installation](../themes/bundled-installation.md) |
| Resources and share links | [the resource layer](../resources/index.md), [the JSON store](../resources/json-store.md), [the resource SDK](../resources/sdk.md) |
| Onboarding channels | [the installer](../onboarding/installer.md), [content](../onboarding/content.md) |
| Telemetry | [the telemetry architecture](../telemetry/index.md) and its modules |
| Version advertisement, the update channel and the desktop upgrade gate | [the updates architecture](../updates/index.md) and its modules |
| The canonical bundle | [canonical](../canonical.md) |

## What remains code-governed

These parts of the server are governed by code on purpose:

- the paths, methods and bodies of the routes, and the event vocabulary, that the server shares with the app and CLI of its own release ([channel state](../channel-state/index.md#^cs-wire-carve-out)), apart from what [http.md](./http.md) and the feature specs pin;
- the Markdown editor's content protocol, the server's rendering of Markdown artifacts, and the bundled missing-artifact view ([the frame core](../artifact-frame/index.md#^frame-core-carve-out));
- the ACP bridge, apart from [its home context](#^cli-acp-home-context).

## One release

A server and its clients run one release. The server serves the app, and the app reloads itself when it finds it was built for another release ([version advertisement](../updates/version-advertisement.md#The reload contract)); the CLI ships in the same package as the server. Television does not support a client of a different release from its server, or a server older than the data in its home ([resources](../resources/index.md#^rs-file-formats)). What crosses releases is owned where it is defined:

- the home's stored data, which a later release reads ([migration](./migration.md), and each record's owner);
- the desktop app's [connect check](../updates/desktop-upgrade-gate.md#^pre-gate-handshake) and the [legacy `/display` fields](../updates/desktop-upgrade-gate.md#^pre-gate-legacy-display) that let installed desktop apps reach the upgrade gate;
- the [update channel](../updates/update-channel.md#Evolution protocol), which every installed release polls;
- the [canonical bundle's versions](../canonical.md#Versioning), which artifacts written for earlier releases link;
- an artifact's address, which another host's app loads as a [shared artifact](../../product/artifacts.md#shared-artifacts).

## The ACP bridge

When a server is started with an ACP agent profile ([arch/cli/index.md](../cli/index.md#Experimental ACP agent wiring)), it accepts `/acp` WebSocket connections and runs the configured agent for each. The bridge is experimental and development-facing, and code governs it except for one requirement. ^srv-acp

A server that launches an ACP agent tells the agent how its `tv` commands reach this server. In the Television context block the agent receives alongside its prompts, whenever that block is sent and whether or not a channel is attached, the server supplies `--home <absolute-home>` for the home it serves, and adds `--port <port>` with the port it bound only when config port is `0`. No environment variable carries these values. The agent's `tv` commands then reach this server whether it serves the default home, a home given with `--home`, or a development server's own home. The requirement binds the server's ACP bridge (`packages/server/src/acp-bridge.ts`) and the web client's ACP client (`packages/web/src/services/acp-client.ts`), which assembles the context block. ^cli-acp-home-context

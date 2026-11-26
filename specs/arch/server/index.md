*The server architecture root: what the Television server is, the decisions that shape it, what it owes to everything outside its own process, and which spec owns each part of it.*

# Server architecture

The Television server is one process that serves one [Television home](../../product/cli.md#^cli-home). It keeps that home's channels, artifacts and display state, serves the application and artifact documents over HTTP, pushes changes to connected clients over a WebSocket, and answers the `tv` commands and agents that administer it. `packages/server` implements it, and `tv serve` starts it ([CLI architecture](../cli/index.md#Server process boundary)).

This document states the decisions the whole server rests on and maps the specs that own its parts. Most of the server's behavior belongs to a feature, such as themes, resources or telemetry, and is specified with that feature. The specs in this directory own what no feature owns: starting and stopping, the layout of the home, authorization and the event stream, and the artifact registry and proxy. Where no spec states a requirement, the code governs.

## Decisions

**One store owns the state.** `ServerStore` is the only code that reads or writes the home's state. It loads all of it into memory when it is constructed, validates every change, saves each change to disk as part of making it, and then announces the change as an event. The HTTP routes, the event stream and the artifact proxy read and change state only through the store. Stopping the server therefore saves nothing, because nothing is waiting to be saved.

**One server per home.** A home has no lock and no coordination between writers. Two servers started on the same home overwrite each other's records, and telemetry would count them as [one installation](../telemetry/identity.md). This is an accepted limitation: Television is installed as one service per operating-system user ([persisted service](../../product/cli.md#^cli-persist-home-service)), and a second server on the same home is not supported.

**State is ready before the server listens.** Migration, loading and every installation step finish while the store is constructed, before any listener binds ([lifecycle](./lifecycle.md#The order of a serving start)). A client that can reach the server therefore never sees a partly loaded home.

**Features attach to the core; they do not live in it.** Each feature owns its records, routes and events, and its own spec states them. The core supplies the places they attach: a step in the starting order, a path in the home, a route under the authorization rule, a message on the event stream.

## What the server owes to what is outside it

What a server spec pins depends on who is on the other side.

| The other side | What it relies on | Owner |
|---|---|---|
| A later release serving the same home | the files in the home and their formats | [storage](./storage.md), and each feature's spec for its own files |
| The web application the server serves | nothing pinned: the server and its web bundle ship together and may change together | [the unpinned API](./http.md#What is not pinned) |
| The `tv` CLI, and agents through it | the token file, the health response, and the server's replies to the commands | [HTTP surface](./http.md); [product CLI](../../product/cli.md) |
| The desktop app, which is released separately | the connect check, the artifact listing, and the required desktop version | [desktop upgrade gate](../updates/desktop-upgrade-gate.md#^pre-gate-handshake); [artifact partitions](../desktop/artifact-partitions.md#^dp-artifacts-route) |
| Artifact documents and people holding share links | the artifact proxy's addresses, the sandbox, the canonical bundle and the resource SDK | [artifact proxy](./artifact-proxy.md); [isolation](../artifact-frame/isolation.md); [canonical](../canonical.md); [resource SDK](../resources/sdk.md) |
| People and agents who write files | the config file, theme packages, and the files artifacts point at | [product CLI](../../product/cli.md#^cli-config-file); [themes](../themes/index.md); [artifacts](./artifacts.md) |
| The service manager that runs the server | exiting when it cannot listen, with a recognizable status | [listening](./lifecycle.md#Listening); [CLI architecture](../cli/index.md#Daemon boundary) |
| The update channel and the analytics service | the requests the server makes to them | [update channel](../updates/update-channel.md); [telemetry sink](../telemetry/sink.md) |

The CLI and the server are built from one release and installed together. A server keeps running the release it started from until it is restarted, so after an upgrade a newer `tv` can meet an older server until the restart. Television makes no compatibility promise for that interval; restarting the server ends it. ^srv-cli-same-release

## Specs

| Spec | Owns |
|---|---|
| [lifecycle.md](./lifecycle.md) | constructing the store, the order of a serving start, listening on every address or none, the origins a started server reports, and stopping |
| [storage.md](./storage.md) | the layout of the home, the channel, artifact and display records, the token file, how formats change between releases, and the log |
| [http.md](./http.md) | authorization, the health response, the event stream, and what about the API is left unpinned |
| [artifacts.md](./artifacts.md) | the artifact registry: the record, which channel holds an artifact, and watching a path artifact's files |
| [artifact-proxy.md](./artifact-proxy.md) | serving a path artifact's files: its addresses, serving under a share ID, and caching |

Server behavior owned by a feature's spec:

| Behavior | Owner |
|---|---|
| The channel record's fields, focus, pins, and how clients stay in step with the server | [channel state](../channel-state/index.md) |
| Layout, layout updates, and moving an artifact between channels | [layout](../layout/index.md) |
| The migration of a home written by an earlier release | [the server migration](../layout/migration.md) |
| Onboarding channels and the default channel | [onboarding installer](../onboarding/installer.md) |
| Themes: packages, the registry, selection, and the `/theme/` route | [themes](../themes/index.md), [delivery](../themes/delivery.md), [bundled installation](../themes/bundled-installation.md) |
| Resources: stores, share links, their routes and events | [resources](../resources/index.md) |
| The sandbox header and the cross-origin rules on each route | [isolation](../artifact-frame/isolation.md) |
| The scripts the proxy adds to HTML | [artifact bridge](../artifact-frame/artifact-bridge.md) |
| The canonical bundle's routes | [canonical](../canonical.md) |
| Version advertisement, the update channel and the required desktop version | [updates](../updates/index.md) |
| Telemetry: identity, control routes, hooks and client signals | [telemetry](../telemetry/index.md) |
| The config file and the selection of the home | [product CLI](../../product/cli.md#Television home and configuration); [CLI architecture](../cli/index.md#Home and config resolution) |

## The experimental agent bridge

The server can launch an agent process and relay a chat with it to the web application, when `TELEVISION_ACP_AGENT` names one. This bridge is experimental and unsupported: it is not part of Television's product, no guide or skill describes it, and it may change or disappear in any release. Its endpoint, protocol and chat interface are governed by code.

One requirement holds while it exists. A server that launches an agent tells the agent how its `tv` commands reach this server. In the Television context block the agent receives alongside its prompts, whenever that block is sent and whether or not a channel is attached, the server supplies `--home <absolute-home>` for the home it serves, and adds `--port <port>` with the port it acquired only when the config port is `0`. No environment variable carries these values. The agent's `tv` commands then reach this server whether it serves the default home, a home given with `--home`, or a development server's own home. ^cli-acp-home-context

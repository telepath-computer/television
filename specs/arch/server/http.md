*The server's HTTP and WebSocket surface: how requests are authorized, the health response, the event stream, and which parts of the API are deliberately left unpinned.*

# Server HTTP surface

Everything outside the server process reaches it over HTTP or a WebSocket: the web application, the desktop app, the `tv` commands, agents, and the documents of artifacts. This document defines the rules they all share: who may call what, what the unauthenticated health response says, and how the event stream behaves. It also says which parts of the API a client outside the release may rely on, which is very little.

## Authorization

A home has one bearer token ([the token file](./storage.md#The token)). Whether the server requires it is decided when the server starts, from the config file's `auth` setting, which is on by default ([product CLI](../../product/cli.md#^cli-config-file)).

Every route belongs to one of three classes: ^srv-route-classes

- *Token routes* act with the server's full authority: the routes that read and change channels, artifacts and display state, the theme, telemetry and resource administration routes, and the event stream. A server that requires the token refuses a request to one without it. This is what other specs mean by the server's standard authorization.
- *Capability routes* are authorized by an unguessable ID in their path and accept no token: the [artifact proxy](./artifact-proxy.md) and the [page connection](../resources/index.md#^rs-artifact-routes).
- *Public routes* serve what is the same for everyone and need nothing: the health response, the web application's own files, the canonical bundle, the active theme's files, and the resource SDK.

A new route is a token route unless the document that will call it cannot hold the token, as an artifact's document cannot.

The token travels in two ways. An HTTP request carries it as `Authorization: Bearer <token>`, and a refused request is answered `401`. A WebSocket carries it as the `token` query parameter, because a browser cannot set a header on a WebSocket; the server accepts the connection and, when the token is wrong or missing, closes it at once with status `4401`, so the client can tell a refusal from an unreachable server. ^srv-token-transport

On a server that does not require the token, every token route answers anyone who can reach it. This is the accepted cost of tokenless mode, which the person running the server chooses and the CLI [warns about](../../product/cli.md#Server lifecycle commands); [resources](../../product/resources/resources.md#^rs-tokenless) states what it exposes. ^srv-tokenless

The server does not check a request's `Origin` or `Host`, and treats a request from the same machine like any other. The token, or the ID in a capability route's path, is the whole check. Which routes send cross-origin headers, and why, is [isolation's](../artifact-frame/isolation.md#^iso-routes).

## The health response

`GET /health` answers without the token, so that a command or a person can tell whether a server is running before they have anything to present. It reports `status`, the server's release `version` ([version advertisement](../updates/version-advertisement.md#^health-version)), the `bindAddresses` and `port` it is listening on, and its [`origins`](./lifecycle.md#Origins). It carries no path on the server's machine and nothing about the home's contents. ^srv-health

Because it needs no token, anyone who can reach a server that listens on `0.0.0.0` can read the machine's IPv4 addresses from `origins`. Moving the list behind the token is [TV-952](https://linear.app/telepath-computer/issue/TV-952).

## Refusals

A token route that refuses a request answers with a status outside the 200s and a JSON body whose `error` is a message. The `tv` commands print that message to the person or agent as it is ([CLI architecture](../cli/index.md#Command parser and error normalization)), so the server writes it for them: it says what was wrong in terms of what they asked for, and the [product CLI](../../product/cli.md) pins the wording of the cases it names. ^srv-refusals

## The event stream

The *event stream*, `/events`, is the WebSocket on which the server tells connected clients what changed. It is a token route. ^srv-events

- **The first message describes the server.** It is `server-status`, which [version advertisement](../updates/version-advertisement.md#^events-version) owns, and it precedes every other message on the connection.
- **Every change reaches every connected client.** After that first message, the server sends each event to every client connected when it happens, including the client that caused it, in the order the changes were made. One change can produce several events, and the specs that own those events give their order where it matters ([channel deletion](../channel-state/index.md#^cs-delete-ordering), for example).
- **Nothing is replayed.** The stream carries no snapshot and no history. A client reads the current state over HTTP and treats the stream as changes since ([channel state](../channel-state/index.md#^cs-converge) says how it avoids losing one in between).
- **Clients say almost nothing.** The server acts on the two [telemetry messages](../telemetry/client-signals.md) a client may send and silently drops anything else, without answering or closing the connection.

The events themselves belong to the specs whose state they report: channels and focus to [channel state](../channel-state/index.md), layout to [layout](../layout/index.md), themes and appearance to [themes](../themes/index.md), artifact content to [artifacts](./artifacts.md#Watching content), and resource events to [resources](../resources/index.md#^rs-events-stream).

## What is not pinned

The server's route names, request and response bodies, and event names are not a public API. The supported ways in are the `tv` commands and the web application, both of which use the shared client in `packages/shared` and ship in the same release as the server. Between those parties the names and shapes may change in any release without a compatibility step, and no spec lists them. The web application reloads itself when it meets a server from a different release ([the reload contract](../updates/version-advertisement.md#The reload contract)). ^srv-api-unpinned

What the routes mean is pinned, by the specs that own the state: renaming a route is a code change, but changing what a layout update or a focus write does is a spec change first.

A few surfaces are used by something that does not ship with the server, and their owners pin them exactly:

| Surface | Relied on by | Owner |
|---|---|---|
| `GET /health` | `tv status`, service checks | [above](#^srv-health) |
| `GET /desktop/connect-check`, and the bounded older shape of `GET /display` | desktop apps of other releases | [desktop upgrade gate](../updates/desktop-upgrade-gate.md#^pre-gate-handshake) |
| the artifact listing of `GET /artifacts` | desktop apps of other releases | [artifact partitions](../desktop/artifact-partitions.md#^dp-artifacts-route) |
| `/artifact/<id>/…` | artifact documents, share links, other Television hosts | [artifact proxy](./artifact-proxy.md) |
| `/canonical/v<n>/…` | artifact documents | [canonical](../canonical.md) |
| `/sdk/v1/…` and the resource route prefixes | artifact documents | [resource SDK](../resources/sdk.md), [resources](../resources/index.md#Route families) |

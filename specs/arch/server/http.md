*The server's HTTP and WebSocket surface: authentication by the server's token, the route families with whether each requires the token and which spec owns what it does, how refusals and failures are answered, and the `/events` stream.*

# Server HTTP surface

Everything a client does with a Television server goes through the HTTP routes and WebSocket endpoints on its listeners. The app, the CLI and agents use the routes that require the server's token; artifact documents, and pages anywhere, load the public ones. This spec owns authentication, which routes require the token, the rules for answering refusals and failures, and the event stream. The specs named in the route table own what each family does, and [isolation](../artifact-frame/isolation.md#^iso-routes) owns each route's handling of requests from other origins.

## Authentication

A server requires its [token](./storage.md#^srv-token-file) unless its config file sets `auth` to `false` ([product/cli.md](../../product/cli.md#^cli-config-file)). A server that requires the token checks it on every request to a route the table below marks as requiring it:

- An HTTP request carries `Authorization: Bearer <token>`. A request without the exact token is refused with `401` and `{ "error": "Unauthorized" }`.
- A WebSocket client presents the token as the `token` query parameter of the address it connects to, since a browser cannot set headers on a WebSocket. A connection without the exact token is closed with status `4401` before the server sends anything on it.

A server that does not require the token authorizes every request; [product/resources/resources.md](../../product/resources/resources.md#^rs-tokenless) states what that exposes. A connect link brings the token to a browser in the page's address ([product/cli.md](../../product/cli.md#^cli-connect-link)), so the app's HTML is served with `Referrer-Policy: no-referrer` and the address never reaches another site as a referrer. ^srv-auth

## Route families

| Route | Requires the token | What it does is owned by |
|---|---|---|
| `GET /health` | no | [lifecycle](./lifecycle.md#^srv-health) |
| the app's page and bundle | no | the web app; its caching by [version advertisement](../updates/version-advertisement.md#^cache-headers) |
| `/channels`, `/channels/<id>` | yes | [channel state](../channel-state/index.md), [layout](../layout/index.md#Layout updates) and [product/channels.md](../../product/channels.md) |
| `/artifacts`, `/artifacts/<id>`, `/artifacts/<id>/move` | yes | [the artifact record](./storage.md#^srv-artifact-record), [layout](../layout/index.md#Layout updates), [product/artifacts.md](../../product/artifacts.md) and [path artifact creation](../../product/cli.md#Path artifact creation) |
| `/display`, `/display/focus` | yes | [channel state](../channel-state/index.md#The shared model), [theme architecture](../themes/index.md#selection-and-display-state), and the desktop gate's [legacy fields](../updates/desktop-upgrade-gate.md#^pre-gate-legacy-display) |
| `/themes`, `/themes/refresh` | yes | [theme architecture](../themes/index.md#control-api-and-shared-client) |
| `/telemetry`, `/telemetry/enable`, `/telemetry/disable` | yes | [telemetry identity](../telemetry/identity.md) |
| `/markdown/<id>` | yes | the Markdown editor's content protocol, which is code-governed ([the frame core](../artifact-frame/index.md#^frame-core-carve-out)) |
| `/demo-mode` | yes | [browser demo mode](../../product/artifacts.md#^af-demo-mode) |
| `/desktop/connect-check` | yes | [the desktop connect check](../updates/desktop-upgrade-gate.md#^pre-gate-handshake) |
| `/api/resources/v1/…` | yes | [the administrative routes](../resources/index.md#^rs-admin-routes) |
| `/artifact/<id>/…` | no; the ID is the capability | [the artifact proxy](./local-content.md#^srv-artifact-proxy) |
| `/artifact-resources/<id>/v1/connection`, a WebSocket | no; the ID is the capability | [the page connection](../resources/index.md#^rs-artifact-routes) |
| `/canonical/v<n>/…` | no | [the canonical bundle](../canonical.md) |
| `/theme/…` | no | [theme delivery](../themes/delivery.md#active-theme-route) |
| `/sdk/v1/…` | no | [the resource SDK](../resources/sdk.md#^sdk-serving) |
| `/views/<view-id>/…` | no | the bundled views for missing artifacts and the Markdown editor, which are code-governed ([the frame core](../artifact-frame/index.md#^frame-core-carve-out)) |
| `/events`, a WebSocket | yes | [below](#^srv-events) |
| `/acp`, a WebSocket present only when an ACP agent is configured | yes | [the ACP bridge](./index.md#^srv-acp) |

The public routes serve what is public, or what an unguessable ID in the path reaches. A WebSocket upgrade to any other path is refused. ^srv-routes

The channel, artifact, display and theme routes are the interface between the server and the clients of its own release. Their paths, methods and bodies may change between releases ([channel state](../channel-state/index.md#^cs-wire-carve-out)), apart from what the desktop connect check and the legacy `/display` fields freeze for installed desktop apps.

## Refusals and failures

The channel, artifact, display and theme routes refuse a request with a status and `{ "error": string }`: `400` for a request the server cannot accept as given, `404` when it names a channel, artifact or theme that does not exist, `409` when it conflicts with the current state, such as a layout whose pages no longer match the channel's ([layout](../layout/index.md#^ly-update-membership)), and `503` when an artifact record's save has an unknown outcome ([product/artifacts.md](../../product/artifacts.md#^af-record-saved)). The CLI prints a refusal's `error` text ([arch/cli/index.md](../cli/index.md#Command parser and error normalization)), so where the product CLI gives a refusal's wording, such as `Channel not found: <channel-id>`, that wording is the server's text. ^srv-refusals

A request that fails unexpectedly, on any route, is answered with the failure's own error status when it has one and `500` otherwise, with that status's standard text, never the failure's message or stack: a failure's message can name an artifact's files, and so an artifact ID that a share link hides. The failure is written to [the log](./lifecycle.md#^srv-log). ^srv-unexpected-failure

## The event stream

`/events` is the WebSocket on which the server announces changes. Once a connection is authenticated, its first message is `server-status` ([version advertisement](../updates/version-advertisement.md#^events-version)). After that the server sends each event to every connection open when the event is emitted, in the order the events are emitted. Nothing is replayed: a client that connects later learns the current state by fetching it ([channel state](../channel-state/index.md#^cs-converge)). The stream carries the events of channels, artifacts and their content, display state and themes, `server-status`, and resource events. Its message vocabulary is shared only with the app of the same release, except for resource events. ^srv-events

Resource events reach agents through `tv resource events` and `tv resource json watch`, which read this stream ([resources](../resources/index.md#^rs-cli-integration)). Each is sent as `{ type: "resource-event", event: ResourceEvent }` ([ResourceEvent](../resources/index.md#^rs-arch-events)), in the order the resource layer emits them, and a client ignores the message types it does not use. The stream accepts a connection whatever its `Origin` header, so on a server that does not require the token a page on another site can open it and read every event, including the artifact IDs that resource events carry. That exposure is accepted with the rest of tokenless mode ([product/resources/resources.md](../../product/resources/resources.md#^rs-tokenless)), and it is why such a server refuses share links. ^rs-events-stream

A client sends the server only two kinds of message on the stream, both telemetry inputs: the activity signal ([sessions.md](../telemetry/sessions.md#^activity-signal-acceptance)) and the telemetry client signal ([client-signals.md](../telemetry/client-signals.md#^signal-validation)). Both require the telemetry metadata the client puts in the connection's address ([client.md](../telemetry/client.md)). The server drops every other message, and every message on a connection without that metadata, and answers none of them. ^srv-events-inbound

*The control API, workspace event stream and optional agent connection served on every listener.*

# Client connections

Clients read and change the workspace through the control API. Connected clients learn of changes through a separate WebSocket. A page running inside an artifact has a different interface, the [resource page connection](../resources/index.md#the-page-connection), whose authority is limited to the ID in its address.

## Access

With authentication enabled, control HTTP requests carry `Authorization: Bearer <token>`. Missing and incorrect credentials receive 401. On `/events` and the optional `/acp` socket, supply the same token in the `token` query parameter. Failure closes the socket with code 4401 before it delivers data or starts an agent. In tokenless mode these interfaces are open to anyone who can reach them. A listening address or browser origin confers no separate privilege. [Artifact isolation](../artifact-frame/isolation.md#^iso-routes) defines which routes allow cross-origin reads and which public files an artifact can use.

## Reading and changing the workspace

The CLI uses these JSON requests against the running server. Channel and artifact responses carry the [channel model](../channel-state/index.md#^cs-channel-shape) and [artifact record](artifacts.md#^rs-artifact-record).

| Request | What the caller sends or receives |
|---|---|
| `GET /channels` · `GET /channels/:id` | A list as `{ channels }`, or a snapshot as `{ channel, artifacts }` for one channel. |
| `POST /channels` · `PATCH /channels/:id` | Create with `name` and an optional `id`, or update the name, the whole layout, or both. Return `{ channel }`. [Layout](../layout/index.md) owns membership validation. |
| `DELETE /channels/:id` | Return the removed `channelID`, its `metadataPath` and the `artifactResults` for its members. [Channel deletion](../../product/channels.md#^ch-delete-semantics) owns the effects. |
| `GET /artifacts` · `GET /artifacts/:id` | Return `{ artifacts }` or `{ artifact }`. A `channelID` query scopes the list to one channel. The desktop reaper relies on the [complete unfiltered response](../desktop/artifact-partitions.md#^dp-artifacts-route). |
| `POST /artifacts` · `PATCH /artifacts/:id` | Create a record on `channelID` with optional [placement](../layout/index.md#^ly-placement) and return `{ artifact, channelID }`. Edit a record's title or pointer and return `{ artifact }`. |
| `POST /artifacts/:id/move` | Send the destination `channelID` and optionally `before` or `after` with the neighboring artifact's ID. The reply carries `artifactID`, `channelID` and `outcome` (`moved`, `repositioned` or `unchanged`). |
| `DELETE /artifacts/:id` | Return `outcome: "deleted"`, the `artifactID`, its `kind` and its `path` or `url`. |
| `GET /display` · `PATCH /display` | Read [focus and pins](../channel-state/index.md), [theme and appearance](../themes/index.md), and ACP availability. Patch the supplied writable fields together, with 204 on success. |
| `POST /display/focus` | Send `{ artifactID }`. Select its owning channel before announcing artifact focus to all clients, even if the channel was already focused. Return `{ channelID, artifactID }`. |
| `GET /telemetry` · `POST /telemetry/enable` · `POST /telemetry/disable` | Return the resulting [telemetry status](../telemetry/identity.md), including its unavailable state when initialization fails. |

The caller can distinguish invalid input (400), a missing entity (404), a conflict with current membership (409), and an artifact save whose outcome is unknown (503). In particular, an existing artifact left off every channel by an interrupted move still has a readable record, but focusing it conflicts. Detailed unexpected errors go to the server log. The HTTP response carries the status and its fixed text so filesystem paths cannot escape to a share holder.

Desktop releases identify a server before loading its app. The [desktop handshake](../updates/desktop-upgrade-gate.md#^pre-gate-handshake) owns both the bearer-only connect check and the display fields earlier releases require.

## Live events

`/events` broadcasts JSON to connected clients. After authentication the first message is [server status](../updates/version-advertisement.md#^events-version). Subsequent messages report workspace changes, focused artifacts, changes to file content and settings, and [update status](../updates/update-channel.md). The stream has no replay. A returning client recovers from [current snapshots](../channel-state/index.md#^cs-converge). A local page selection is private unless the server broadcasts an explicit artifact focus.

For agents watching resources, the stream sends `{ type: "resource-event", event: ResourceEvent }` to every connected client in [resource event](../resources/index.md#^rs-arch-events) order. Receipt of the initial status establishes that the subscription is live. Clients ignore message types they do not consume. The socket accepts any origin, so in tokenless mode other sites can read those events, including artifact IDs. ^rs-events-stream

Inbound messages on this stream are limited to telemetry. Read [client metadata](../telemetry/client.md) from the connection query. An activity message must contain exactly `type: "telemetry-activity"` and the matching `clientId`. Deliver it to [session tracking](../telemetry/sessions.md). Forward a [validated client signal](../telemetry/client-signals.md#^signal-validation) through the telemetry runtime. Ignore other input without replying. Opening or closing the socket alone has no session meaning.

## Agent connection

When the CLI supplies an experimental ACP agent profile, display state advertises `acpEnabled: true` and the server accepts `/acp`. Each authenticated or tokenless connection has its own agent. A connect request launches the configured command on demand, isolated from the server's controlling terminal. The bridge relays JSON messages between that socket and the child's newline-delimited standard input and output. Only a ready child receives messages. Launch failure or exit is reported to its client. Detaching the socket or stopping the server terminates the child and its process group so a disconnected session cannot leave a running agent behind.

The ready message supplies the web client with the agent identity, session ID strategy, session working directory and the `tvArgs` to reach this server. Whenever the client sends a Television context block with a prompt, include those arguments, whether or not a channel is attached. They are `--home <absolute-home>`, plus `--port <acquired-port>` only when the configured port is zero. This keeps an agent's commands in the workspace its user is viewing. ^cli-acp-home-context

## Testing guidance

Exercise the agent home and port in the context block received by the launched agent. Checking the server's ready message alone misses the web client that assembles that block.

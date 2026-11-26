*Server lifecycle: how a server binds its listeners all or nothing, the fatal record a failed start leaves, what starts once the listeners are bound, the origins it reports, `/health`, how it stops, and its log.*

# Server lifecycle

`tv serve` builds a server for one Television home and starts it; the server then listens until it is disposed. This spec owns what starting and stopping do, the addresses the server reports, its health response, and its log. How the CLI turns a failed start into an exit status, and how the persisted service is restarted after one, are [the CLI's side of startup bind failure](../cli/startup-bind-failure.md).

## Listeners

The server listens on every address of its resolved listener list, which the [server lifecycle commands](../../product/cli.md#Server lifecycle commands) derive from the config file's `listen` setting. The first listener binds the configured port, which may be `0`, and every other listener binds the port the first one got. ^port-zero

**Starting is all or nothing.** A started server is listening on every resolved address; if any address cannot be bound, the server does not run at all. The persisted service is restarted by its service manager whenever the process exits, and that restart is the only retry. A server that kept running on some of its addresses would look healthy to the service manager and never be restarted, so an address that appears late, typically a Tailscale address that is not yet assigned when the machine boots, would never be bound. Exiting hands the retry to the service manager, which relaunches the server until the address exists. Binding every address also keeps `/health`'s `bindAddresses` truthful. ^all-or-nothing

When a bind fails, `start()`:

1. attempts every other listener as well, once each, so that one start records every address that failed at the same time; ^attempt-all
2. writes one [fatal record](#^record-outcomes) to the log before it returns; ^one-record
3. closes every listener that did bind, the first one included when it bound port `0`; ^socket-cleanup
4. rejects with an error carrying the [bind-failure exit status](../cli/startup-bind-failure.md#^exit-69), 69.

The server never waits for an address, watches network interfaces, or binds again within one process. ^no-wait

Every bind error ends the start the same way: an address on no interface (`EADDRNOTAVAIL`), a port in use (`EADDRINUSE`, which includes a reinstall racing a terminating instance), a refused privileged port (`EACCES` or `EPERM`), or anything else. Whether a failure is permanent cannot be known from inside one attempt, and a restart is cheap, so the error's class changes only the hint the fatal record gives. ^all-errors-fatal

## The fatal record

A failed start writes one record to the log. It carries every resolved address with the port its bind used and its outcome, `bound` or `failed`; a failure also records its error `code` and `syscall`. An address that bound and was then closed is recorded as `bound`. ^record-outcomes

The record also carries the exit status and a cause and hint chosen by error class. For `EADDRNOTAVAIL` on an address in `100.64.0.0/10`, the range Tailscale assigns from, when the server runs as the persisted service (launch mode `daemon`), the hint says that the address is not assigned to any interface; that if it is a Tailscale address, Tailscale may not be up yet, which passes at boot, or the address may have changed, which lasts until the config file's `listen` setting is corrected; and that the service manager will retry. Every other case records a one-line cause. The address range and the launch mode select only the hint's text, so a wrong guess mislabels a log line and changes nothing else. ^record-hint

The record in the log is the one durable account of a failed start. The server may also write the failure to stderr, but the service definitions keep stderr unreliably or not at all, so nothing depends on it. ^log-authority

## After the listeners bind

Once every listener is bound, the server starts telemetry, which loads its identity and emits the boot events ([identity.md](../telemetry/identity.md)), starts polling the update channel ([update-channel.md](../updates/update-channel.md#Server-side polling)), and logs that it started. A start that fails to bind emits no telemetry and polls nothing, so a server in a restart loop does not report a start each time it fails; the cost for a home whose very first start fails is [identity's accepted limitation](../telemetry/identity.md#^prior-serving-evidence).

## The server's origins

After `start()`, `Server.getOrigins()` returns the origins the server can be reached at ([connect links](../../product/cli.md#^cli-connect-link)): for each resolved address in order, `http://<address>:<port>` with the port it bound, except that `0.0.0.0` becomes one origin for each IPv4 address the machine's network interfaces report when the list is asked for, in that order, loopback included. An origin that would repeat appears once. `/health` carries the list, and so does the reply to a share request, beside the link's path ([resources](../resources/index.md#^rs-share-cli-integration)). ^cli-server-origins

## Health

`GET /health` tells any client that the server is running and how to reach it. It requires no token:

```ts
interface HealthResponse {
  status: "ok";
  version: string;          // the release version (version-advertisement.md ^health-version)
  bindAddresses: string[];  // the resolved listener addresses
  origins: string[];        // the server's origins, above
  port: number;             // the port the listeners bound
}
```

`tv status`, `tv links` and the persisted install's health wait read it ([arch/cli/index.md](../cli/index.md#Client boundary)). Because it requires no token, anyone who can reach a server listening on `0.0.0.0` can read the machine's IPv4 addresses from it; serving the origins from a response that requires the token is [TV-952](https://linear.app/telepath-computer/issue/TV-952). ^srv-health

## Stopping

Disposing a server releases everything it holds: its listeners and every open HTTP and WebSocket connection, update-channel polling with any request in flight ([update-channel.md](../updates/update-channel.md#^poll-lifecycle)), content watching, the processes the ACP bridge started, and telemetry's pending deliveries within [the sink's bounds](../telemetry/sink.md#Behavior and operations). It then logs that the server stopped. Disposing a server a second time does nothing. ^srv-dispose

## The log

The log is `logs/tv.log` in the home. The server and the CLI append records to it, one JSON object per line, each with a local timestamp, the process ID and a message. The file is rotated daily and old files are deleted, so records from a long restart loop cannot fill the disk. A record that cannot be written is reported on stderr and never fails what was being logged. ^srv-log

## Testing

The product CLI proof's [bind-failure acceptance](../../../proofs/product/cli.md#^cli-ac-bind-failure) covers the spawned process's exit. Start's behavior on a failed bind is proven through a real `Server` binding real sockets, without a second spawned-process test.

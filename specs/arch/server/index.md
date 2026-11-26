*How one Television server serves a home, binds its listeners and reports where clients can reach it.*

# Television server

A Television server presents one workspace over HTTP. A CLI on the host, a browser on the network and a desktop app can all use the same workspace. Every listener serves the same state, application and access policy. The [CLI](../cli/index.md#^cli-serve-adapter) selects the home, settings and packaged assets. The [store](store.md) opens the home, the [control interface](connections.md) connects clients to it, and the [artifact proxy](artifacts.md) serves documents from it.

## Bringing the server online

Resolve the IPv4 listeners according to the [CLI listen setting](../../product/cli.md#server-lifecycle-commands). Bind loopback first unless the wildcard covers it. All listeners use one port, including when the first bind acquires an ephemeral port. Each address gets one attempt. Startup succeeds only when all have bound. A service that stayed alive on loopback after failing to bind its network address would look healthy to the service manager and would never acquire the missing listener. ^all-or-nothing

On any bind error, record the whole attempt before exiting, close all sockets acquired during it, and return failure with `exitStatus: 69` (`EX_UNAVAILABLE`). The [installed service manager](../cli/startup-bind-failure.md) owns retries. ^exit-69

The operator can diagnose a failed start from `<home>/logs/tv.log` even when the service manager discards stderr. Write one timestamped JSON record with the process ID, exit status and the outcome for **each** address and port attempted, including the successful binds. A failed outcome carries the system error code and syscall when available, its cause and a hint. For an installed service seeing `EADDRNOTAVAIL` on a CGNAT address (`100.64.0.0/10`), explain that the address is unassigned, Tailscale may still be starting or its address may have changed, and the service manager will retry. Foreground runs get the ordinary address diagnosis. The log rotates daily with 14-day retention to bound the cost of repeated failures. ^record-outcomes

Once listening, the server starts [boot telemetry](store.md#telemetry-at-commit) and the [update-channel poller](../updates/update-channel.md). Shutdown releases the listeners, client connections, agent processes and file watches, stops polling and shuts down telemetry.

## Where to connect

`GET /health` is an unauthenticated liveness probe. Its JSON is also used by the CLI to build connect links. ^cli-server-origins

```ts
type ServerHealth = {
  status: "ok";
  version: string;
  bindAddresses: string[];
  origins: string[];
  port: number;
};
```

The [release version](../updates/version-advertisement.md#^health-version) identifies the running server. The port is the bound port. In bind order, each address contributes its HTTP origin, except that `0.0.0.0` expands to the host's **current** IPv4 interface addresses in system order, loopback included. Keep the first occurrence of each origin. Thus anyone able to reach a wildcard listener can read its interface addresses. The [share reply](../resources/index.md#^rs-share-cli-integration) uses the same origins.

## Delivery

The server supplies the app bundle for its running release. [Version advertisement](../updates/version-advertisement.md) owns response versioning and app cache policy. [Canonical assets](../canonical.md), [active-theme files](../themes/delivery.md) and the [resource SDK](../resources/sdk.md#^sdk-serving) have their own public delivery contracts. Artifact isolation owns the [route-by-route browser access rules](../artifact-frame/isolation.md#^iso-routes), including sandbox headers on error responses.

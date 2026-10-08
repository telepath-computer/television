*The resource SDK: the browser module the server serves at `/sdk/v1/resources.js` — its build and packaging, how it is served, how it finds its artifact from an artifact ID or share ID, the layer's functions and error shape, the page's access level, handles, the connection status, and the client side of the page connection.*

# Resource SDK

An artifact's page uses its store through one JavaScript module that the Television server serves. The module needs no configuration: it works out which artifact it belongs to from the page's address, whether that holds the artifact's own ID or a share ID, and talks to the server over one connection that it manages itself. This document defines how the module is built, served and connected, and the functions every resource type shares.

## What this owns

This spec owns the *resource SDK*: the module at `/sdk/v1/resources.js`, its build and packaging, how the server serves it, how it identifies its artifact, the resource layer's functions and their types, the page's access level, handle behavior, error objects, the connection status, and the client side of the [page connection](./index.md#^rs-page-connection). Each type's functions are owned by the type's spec; the JSON store's are in [json-store.md](./json-store.md#SDK functions). The connection's server-side rules are owned by [the resource architecture](./index.md).

## Build and packaging

The module's source entry is `packages/shared/src/resources/sdk.ts`. The server package build bundles it with esbuild into one browser ES module at `packages/server/dist/sdk/v1/resources.js`. The bundle's inputs are Television's own source alone, with nothing from `node_modules`, the CLI package or the shared client's administrative methods. One of them, the push-key generator, is adapted from the Firebase JavaScript SDK, so the build also writes the SDK's third-party notices beside the module, at `packages/server/dist/sdk/v1/THIRD-PARTY-NOTICES.txt` ([licensing](../licensing.md#^licensing-sdk-notices)). ^sdk-build

The CLI build copies `packages/server/dist/sdk/` to `packages/cli/dist/sdk/`, and the CLI resolves that directory with `resolveSdkDir()` and passes it to the server as `sdkDir` ([arch/cli/index.md](../cli/index.md#Build and packaged asset layout)). `Server` takes `sdkDir` as an optional option. Without it, `/sdk/v1/resources.js` and the SDK's notices answer `404` and the rest of the resource layer works, so servers that tests construct directly need no SDK path unless they load the SDK. ^sdk-packaging

## Serving

The server answers `GET` and `HEAD` for `/sdk/v1/resources.js` without authorization, with `Content-Type: text/javascript; charset=utf-8`, an `ETag`, and `Cache-Control: no-cache`, the revalidating class of [the canonical cache policy](../canonical.md#^cn-cache-policy). Every page receives the same bytes: the module carries no credentials, artifact IDs or other per-request content. The server answers `GET` and `HEAD` for `/sdk/v1/THIRD-PARTY-NOTICES.txt` the same way, without authorization and with the same headers apart from `Content-Type: text/plain; charset=utf-8`, with the notices file the build wrote beside the module. The `v1` in the module's path is the resource API version; a later version would be served beside it at its own path. ^sdk-serving

## Finding the artifact

The SDK reads its ID from the page's own address: the path segment after `/artifact/` in `location.pathname`, which is the artifact's ID or a [share ID](./index.md#^rs-share-ids). The SDK cannot tell which, and needs not: it connects with the ID it read, and the server resolves it. Every document an HTML artifact serves, including pages in a folder artifact's subfolders and pages reached through a share link, has that form. On a page whose path has another form, every SDK function fails with `not-artifact-page`. The SDK connects to the page connection at the page's own host, over the scheme [the connection](#^sdk-connection) gives. ^sdk-artifact-id

## The layer's functions

```ts
export type AccessLevel = "read" | "read-write";

/** Resolves with the page's level on its artifact's store: the level its address carries. Rejects with no-store when the address reaches no artifact that has a store. */
export function getAccess(): Promise<AccessLevel>;

/** Calls back with the page's level on its artifact's store once it is known, then with each change, until Unsubscribe is called. The level is null while the page's address reaches no artifact that has a store, as after the share link it was opened through is revoked. */
export function onAccessChanged(callback: (access: AccessLevel | null) => void): Unsubscribe;

/** Calls back with each event the page receives (index.md, Resource events). */
export function onResourcesChanged(callback: (event: PageEvent) => void): Unsubscribe;

/** With the bindings flag on: a store this artifact can use, as its page sees it. It carries only what Television generates, never the description or usage an agent wrote. */
export interface ResourceInfo {
  resourceID: string;
  type: ResourceType;   // index.md
  access: AccessLevel;  // the page's level on the store
}

/** With the flag on: resolves with the stores this artifact can use, its own once it has been written and those it is bound to, ordered by resource ID. */
export function listResources(): Promise<ResourceInfo[]>;

/** With the flag on: resolves with one store this artifact can use; rejects with not-bound when it cannot use it. */
export function getResourceInfo(resourceID: string): Promise<ResourceInfo>;

/** Whether the page can reach its server ([connection status](#^sdk-connection-status)). */
export type ConnectionStatus = "idle" | "connecting" | "connected" | "disconnected";

/** The connection status now. Opens no connection. */
export function getConnectionStatus(): ConnectionStatus;

/** Calls back with the connection status as it stands soon after registration, then with each change. */
export function onConnectionStatusChanged(callback: (status: ConnectionStatus) => void): Unsubscribe;

export type Unsubscribe = () => void;
```

Each type adds its accessor, such as `getStore`, and its functions to the same module. With the bindings flag off, `listResources` and `getResourceInfo` reject with `not-enabled`.

The SDK keeps the page's level on its artifact's store from the connection's opening state and from the server's changes to it, which follow a change to the share link the page was opened through. The level is `null` while the page's address reaches no artifact that has a store: from the start on such a page, and once the share link the page was opened through is revoked or its artifact deleted, which the SDK learns from the opening state of the connection it makes after the server closes the old one ([handles](#^sdk-handles)). A change to the level of a share link to an artifact without a store leaves it `null`. `onAccessChanged` calls its callback with that level as it stands once the connection's opening state has arrived, which may be at once, and then with each change, so that a page that listens only for its level hears that it has lost access. A registered callback keeps the connection open, so a page that renders a read-only view keeps it current. `getAccess` follows the rules for requests in [reconnection](#^sdk-reconnect): it waits while a connection opens, and fails at once with `disconnected` while the page is disconnected. ^sdk-access

Errors from the SDK are `Error` objects with a string `code` from [the layer's codes](./index.md#Errors) or the type's codes, and a message for people. The module exports no error classes. ^sdk-errors

## Handles

A type's accessor returns a handle at once, without network I/O. Without an argument it returns the handle for the artifact's own store, whose first operation fails with `no-store` when the page's address reaches no artifact that has a store. When the address stops reaching it, as when the share link the page was opened through is revoked or the artifact deleted, the server closes the connection; on reconnection the handle's next operation fails with `no-store`, and each of its active listeners receives the error through its error callback and is removed. ^sdk-handles

When the artifact's own store is [destroyed](./index.md#^rs-destroy-order), the handle keeps working: its listeners hear the root with no value, and the artifact's next write creates its new store.

With a resource ID, the accessor returns the handle for that store, the artifact's own included, whose operations fail with `not-enabled` while the bindings flag is off. With the flag on, its first operation fails with `not-bound` if the artifact is not bound to that store, and with `wrong-type` if the resource is of another type. When the binding is removed or the store destroyed, the handle's next operation fails with `not-bound`, and each of its active listeners receives the error through its error callback and is removed. A handle keeps working if the artifact is bound to the store again. ^sdk-bound-handles

The SDK uses the page's access, from the connection's opening state and the server's changes to it, and with the flag on `bound` and `unbound` events, to reject a write through `read` access with `read-only` before it shows the write locally ([json-store.md](./json-store.md#^js-arch-local-writes)). The page's level on its artifact's store limits its level on every store it reaches: the SDK applies it to the artifact's own store by either address, knowing that store's resource ID from the access, and the access gives each bound store at the page's level on it, which that level already limits. Each change of access arrives whole in one message ([index.md](./index.md#^rs-own-store-destroyed)), so a write the page makes as it hears the change never meets the new level on one store and the old on another. A write to a store by a resource ID that the page is not known to reach is sent, and the server answers it.

## Connection client

The SDK opens the page connection when the page first performs an operation, subscribes, or registers an `onResourcesChanged`, `onAccessChanged` or `onConnectionStatusChanged` callback, and closes it once none of those is outstanding. It opens the connection on the page's own host, over `wss:` when the page was loaded over `https:`, as through [a front that terminates TLS](../../product/resources/resources.md#^rs-https-front), and over `ws:` otherwise. ^sdk-connection

The SDK reports the page connection's *status*, so that a page can show the person whether what they do can reach the server:

- `idle`: the SDK holds no connection, because nothing the page uses needs one. The status is `idle` until the page first uses the SDK.
- `connecting`: the SDK is opening a connection and has not found the server unreachable since it began. Requests and writes made now wait for the connection.
- `connected`: the connection's opening state has arrived.
- `disconnected`: the connection was lost, or the SDK could not open one. Requests and writes fail at once ([reconnection](#^sdk-reconnect)), and the SDK keeps trying to reconnect for as long as anything needs the connection.

The status becomes `connecting` when the page needs a connection while it is `idle`, and `connected` when that connection's opening state arrives. A connection that closes for any reason but the SDK's own, before its opening state or after it, makes the status `disconnected`; reconnection attempts leave it `disconnected` until one's opening state arrives, which makes it `connected`. When nothing needs the connection any longer, the SDK closes it or stops reconnecting, and the status becomes `idle`. `getConnectionStatus` returns the status and opens no connection. `onConnectionStatusChanged` calls its callback with the status as it stands soon after the registration returns, and then with each change, until its `Unsubscribe` is called. A registered callback keeps the connection open, so a page that shows the status sees it current. ^sdk-connection-status

When the connection is lost, the status becomes `disconnected`, and status callbacks hear it, before the page hears anything else of the loss. The SDK then rolls back every unconfirmed write and rejects each with `disconnected` ([json-store.md](./json-store.md#^js-arch-local-writes)), and rejects every outstanding request, such as a `get` or a `listResources`, with `disconnected`. A connection that closes before its opening state arrives does the same to the writes and requests waiting for it. Subscriptions and callbacks stay registered, including those registered while the page is disconnected. While the status is `disconnected`, every request and write fails at once with `disconnected` and sends nothing: a function that returns a promise rejects, and a write is rejected before it is shown. The SDK reconnects with exponential backoff that starts at 250 milliseconds and is capped at 30 seconds, with random jitter. On each reconnection it resubscribes every active subscription, and each listener hears the current value if it differs from the last value the listener heard, so a rolled-back write that the server applied meanwhile appears then; one the server applies later appears when it does, as another client's change. Nothing else is sent again: no write or request is sent on more than one connection, and there is no offline mode. ^sdk-reconnect

The SDK uses no feature that browsers restrict to secure contexts, so it works on pages served over plain HTTP from addresses other than `localhost`; `crypto.getRandomValues` is available in every context. ^sdk-plain-http

An exception thrown by a page's callback is reported through the browser's uncaught-error reporting and does not affect other callbacks, subscriptions or the connection. ^sdk-callback-isolation

## Testing

SDK coverage must load the module as the server serves it, in a real browser, from a page on a plain-HTTP origin that is not `localhost`, so that the secure-context restriction is in force.

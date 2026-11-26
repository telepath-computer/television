# ServerStore

`ServerStore` is the filesystem owner for Television server state. It manages the auth token, channel files, display singleton, artifact registry metadata, content watchers, and theme watcher under `<storagePath>`.

See the [server store spec](../../../specs/arch/server/store.md) for the on-disk layout, serving and token-only construction, and filesystem observation. [Artifact registry](../../../specs/arch/server/artifacts.md) defines the record type. The [implementation](../src/server-store.ts) exposes workspace operations to the request handlers.

## Construction

```ts
const store = new ServerStore({
  storagePath: "/path/to/.television",
  installOnboardingChannels: true,
});
```

# Live Blaxel harness qualification

Run on a dedicated credentialed Blaxel coordinator sandbox outside every worker
pool, from a committed and pushed checkout with the repository's selected Node,
dependencies and local process-lifecycle prerequisites installed. This driver must
not run on a shared developer host or a leased worker.

## Preparing a coordinator

Any credentialed sandbox outside the worker pools will do. One way, from a
developer host with the Blaxel SDK installed by `npm ci` and Blaxel credentials:

1. Create the sandbox with the workers' image and no `purpose=testshards` label,
   for example with `SandboxInstance.createIfNotExists({ name, image:
   "blaxel/playwright-chromium:latest", memory: 8192, region: "us-pdx-1", labels:
   { project: "television", purpose: "harness-coordinator" } })` from
   `@blaxel/core`.
2. Through `sandbox.process.exec`, install `git`, `curl`, `python3` and
   `iproute2` with `apt-get`, then nvm `v0.40.3` and the Node major in `.nvmrc`
   as the default.
3. Clone the repository, check out the pushed revision under test and run
   `npm ci`. Give Git the GitHub token through the process environment and a
   `GIT_ASKPASS` helper that prints it, so the token is never stored. Create
   `~/.tv-developer`.
4. Start the driver below as a process with `keepAlive: true`, passing
   `BLAXEL_TV_GH_TOKEN`, `BL_API_KEY` and `BL_WORKSPACE` in its environment, and
   redirect its output to a file to read afterwards. A passing run takes about
   five minutes.
5. After retrieving the evidence, delete the coordinator with
   `SandboxInstance.delete(name)` and confirm that neither it nor any worker of the
   private pool remains.

## Running the driver

Supply the coordinator's sandbox name and an exclusively owned disposable pool:

```sh
TV_BLAXEL_HARNESS_COORDINATOR=<coordinator-sandbox-name> \
TV_BLAXEL_HARNESS_POOL=<disposable-private-pool> \
npm test -- local --file test/runner-fixtures/blaxel-harness/driver/harness.test.ts
```

The driver deletes that pool before provisioning two fresh workers and deletes it
again after qualification. Retain any earlier reports first. Never name a shared
pool. The coordinator remains allocated for the caller to retrieve evidence and
dispose of it. Native retry defaults apply.

The CLI requires both names, local execution and no shard owner token. The driver
also checks that the named coordinator lacks the worker `purpose=testshards` label.
These checks prevent accidental placement; the operator supplies the actual
dedicated coordinator's name.

Cleanup fixtures and sentinels include the selected pool in their names. Each
fresh worker has one fixture-mode input, `/tmp/tv-blaxel-harness-mode.json`, read
by the committed native fixtures. It needs no additional production environment
forwarding and disappears with the private worker.

Inspect the canonical run directory and `.test-runs/blaxel-live-*/` for the
individual commands, child run pointers, recovery evidence, completion and cleanup
records. Expected native fixture failures are checked by the driver; a passing
driver does not turn those child reports into passing suites.

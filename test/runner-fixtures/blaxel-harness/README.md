# Live Blaxel harness qualification

Run on a dedicated credentialed Blaxel coordinator sandbox outside every worker
pool, from a committed and pushed checkout with the repository's selected Node,
dependencies and local process-lifecycle prerequisites installed. This driver must
not run on a shared developer host or a leased worker.

Supply the coordinator's sandbox name and an exclusively owned disposable pool:

```sh
TV_BLAXEL_HARNESS_COORDINATOR=<coordinator-sandbox-name> \
TV_BLAXEL_HARNESS_POOL=<disposable-private-pool> \
npm test -- local --surface experiment:blaxel-harness
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

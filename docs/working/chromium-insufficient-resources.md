# Chromium resource failures on Blaxel

Investigator: rose, 2026-10-01. Branch: `thopter/investigate-chromium-insufficient-resources`, based on `68b8ab11`. All five experiments ran through the canonical runner on committed, pushed revisions, on Blaxel, with the default two retries. No tests, browsers, application servers, Electron, builds, lint, or type checks ran on the shared development host.

## Finding

The resource pressure is **Chromium response-body shared memory competing with a persistent, RAM-backed sandbox filesystem**, with two observed failure modes: failed resource loads and kernel OOM kills of renderers. Neither the entire suite nor another shard is necessary to reproduce it.

The unbundled Vite application makes hundreds of small module requests. Chromium 148 allocates 2 MiB shared-memory response buffers, many of which remain open after loading and navigation until garbage collection. The two-page theme-reset test loads each document four times. A passing run reached 707 descriptors in each renderer, predominantly shared-memory handles, and consumed several GiB beyond the sandbox's baseline. Forcing garbage collection between reloads released hundreds of these buffers and prevented that accumulation.

Persistent Blaxel workers already use substantial RAM for their writable filesystem. Playwright launches Chromium with `--disable-dev-shm-usage`, placing shared-memory files under `/tmp` on that filesystem. The root filesystem reported a 6,676,103,168-byte capacity on the 8 GB workers; `/dev/shm` was almost empty. Persisted test runtime directories reduce the space and RAM left for browser buffers. A concrete leak is the cached CLI runtime created by `getSourceCLIEntry()` in `test/helpers/product-server.ts`: it makes a `television-source-cli-e2e-*` directory per worker and never removes it. The original failing sandbox, `poc-131`, had **267 such directories**, with approximately **1.2 GB under `/tmp`** at inspection.

**Confidence boundary:** RAM exhaustion and renderer OOM kills are directly proven by kernel logs. The `ERR_INSUFFICIENT_RESOURCES` reproduction shows exhausted shared-memory/storage capacity and excludes socket/admission limits for an inspected failed request. The exact failing allocation syscall and errno were not captured; attributing that error specifically to the Mojo response-pipe allocation is a strong source-supported inference, not a syscall trace.

## Reproduction results

| Experiment | Revision | Blaxel sandbox | Selection and result |
|---|---|---|---|
| 1 | `0ba2dcda` | `poc-143` | Original theme-reset case plus observation: passed first attempt. Sampled peak: 549,428 KiB available RAM, 5,840,544 KiB shared memory, 707 maximum process descriptors, 261 maximum outstanding requests. |
| 2 | `0ba2dcda` | `poc-39` | Whole theme acceptance file: passed. Theme-reset sampled peak: only 153,952 KiB available RAM, 6,173,108 KiB shared memory, 707 descriptors, 265 outstanding requests. |
| 3 | `0ba2dcda` | `poc-15` | Only original shard 8's assignment: theme reset failed all three attempts. Attempts 0/1 timed out after renderer OOM kills; attempt 2 recorded **136 ERR_INSUFFICIENT_RESOURCES requests**. |
| 4 | `8a75e3a9` | `poc-32` | Original theme-reset case alone, with filesystem measurements: all three attempts timed out. Kernel logs identify **one killed Chromium renderer per attempt**. No request-failed error was required for this failure mode. |
| 5 | `9743dbe7` | `poc-03` | Same case, with diagnostic `page.requestGC()` after each completed reload step: passed first attempt, no OOM kills. First GC released **220 buffers of 2,097,152 bytes in each of two renderers**. Shared memory fell from 3,822,512 to 2,920,608 KiB; root space increased by 923,779,072 bytes. |

The GC run used a different sandbox with a lower baseline; its pass alone is not a controlled estimate of flake reduction. The within-process disappearance of 440 2 MiB buffers is the causal evidence for retained response buffers. Subsequent reloads stayed near the lower shared-memory level. This is an investigation technique, not a proposed test fix.

In experiment 3's request-failure snapshot:

- Available RAM was 70,980 KiB and shared memory was 6,518,872 KiB.
- The two renderers had 694 and 563 descriptors, including 664 and 533 shared-memory descriptors. Every inspected process had a 4,096-descriptor limit. The network service was far below that limit.
- The kernel killed renderer PIDs 6721 and 6921 during attempts 0/1. Their PIDs match the experiment's process records. The final retry reached allocation failures instead.
- Shared memory was within about 1 MiB of the worker's root-filesystem capacity. That instrumentation revision did not record `statfs`, so this is a capacity comparison, not a sampled free-byte count at that error.
- Its NetLog contains eight malformed lines consistent with interrupted writes; do not treat the whole file as valid JSON. Parsing complete lines shows the first failed module request (`missing-artifact-page.ts`, NetLog source 5561) obtained an **HTTP 304 response**, reached `URL_REQUEST_DELEGATE_RESPONSE_STARTED`, and was then cancelled. Its request was admitted and its socket transaction completed. The later failure is not a socket-pool or outstanding-request admission rejection.

Experiment 4 sampled available RAM down to 69,600 KiB. Kernel logs identify renderer PIDs 1850, 2065, and 2277, corresponding to its three attempts. The minimum sampled `/tmp` free space was 279,891,968, 267,485,184, and 58,142,720 bytes by attempt. Physical memory can exhaust before the filesystem quota; a 250 ms sampler also cannot establish the instantaneous minimum. The absence of ERR_INSUFFICIENT_RESOURCES does not indicate a healthy browser.

## Original run and shard packing

Original run:

`/home/user/workspace/wt/television-desktop-connect-links-plan/.test-runs/2026-10-01T21-41-23-867Z-p2861143-ra3e7bfaa4a5003cd`

The supplied retry-1 trace, `/tmp/desktop-connect-theme-reset-blaxel-trace.zip`, records Chromium `148.0.7778.96`, 2,017 requests across two pages, four document loads per page, and 16 consecutive SVG-module failures during the fourth load on one page. Each page has approximately 258 unique URLs; total requests must not be mistaken for simultaneous requests.

Shard 8 runs six unit files, `token-only-persistence.test.ts`, `theme-product-acceptance.test.ts`, then desktop `user-data-identity.test.ts`. Surfaces execute sequentially; theme acceptance uses one Playwright worker. No process leak was reported. Experiment 3 reproduced its failure without the other 35 shards; experiment 4 reproduced OOM in the single case without earlier files. Simultaneous shards, a particular preceding test, and retained processes from earlier files are **not necessary causes**.

The full-verify correlation is better explained by available capacity on the assigned persistent worker than by a unique full-verify execution mode. Baseline shared memory varied substantially: approximately 2.9 GB on experiment 5's worker versus 4.2 GB on experiment 4's. The original failing worker had only about 2 GB root space free at later inspection. That persisted filesystem is a contributor, not a measurement of exact free space at the historical failure instant.

## Responsible harness and test behavior

1. `test/helpers/product-server.ts:getSourceCLIEntry()` creates a temporary build/runtime tree and retains its filename in module state. `disposeAllProductServers()` removes server homes and optional bundled runtime copies, but not the shared source-CLI tree. There is no worker-exit cleanup for it. Blaxel checkout reset cleans the repository and `.testshards` results, not these `/tmp` directories. Worker reuse accumulates hundreds of them.
2. `ProductServer.appURL()` creates a development proxy to Vite. Tests navigating to `/packages/web/src/index.html` load the source-module graph. Theme reset repeatedly reloads two documents together, making buffer accumulation unusually large. The preceding executable-theme acceptance also uses two development pages, but its buffers need not survive into the reset test to cause the failure.
3. Playwright's default `--disable-dev-shm-usage` couples response buffers to the writable root filesystem. The mount reports `upperdir=/mnt/tmp/upper`; writable files contribute to shared-memory pressure. `/dev/shm` stays effectively unused. Moving allocations there would not create more physical RAM, and has not been validated as a fix.
4. A passing process-leak audit cannot detect retained files or predict shared-memory allocation spikes. Browser retries start fresh processes but inherit the same worker's persisted files and limited capacity.

## Other intermittent tests

The reported demo-mode case was on **shard 36**, not shard 8. `summary.json` incorrectly points its log to shard 8; the native shard plan and report are the stronger evidence. Its first attempt timed out in `afterEach`, during cleanup of its server/site; retry passed in 1.394 s. This is **not yet attributable** to Chromium resource exhaustion.

Both `browser-demo-mode.test.ts` and `channel-switcher-context-menu.test.ts` use the unbundled development application; demo-mode also reloads it. They share exposure to the capacity problem, but no trace or kernel evidence was supplied for the channel-switcher drag failure, and this investigation has not established that either intermittent failure shares the cause. Do not relabel all browser flakes as resource failures.

## Recommended fix and scope

1. **Fix the test-runtime file leak and reclaim existing accumulation on idle leased workers.** Give the source-CLI runtime a worker lifetime, clean it after its product servers stop, and cover Playwright and other callers of the helper. Preserve once-per-worker build reuse; deleting it after every test would add unnecessary builds. Reclaim demonstrably orphaned generated runtime directories, rather than arbitrary `/tmp` files or processes selected by name. This is test-harness/provider work, with no production behavior change.
2. **Use the built application for product acceptances that do not require development-module behavior.** The PR #9 author's theme-reset change removes the triggering fan-out. Review other `ProductServer.appURL()` consumers for the same distinction; component fixtures that intentionally exercise source modules may need different handling. This is test setup work, not a production bundling change.
3. **Make failures diagnosable.** Retain small per-attempt memory/free-space measurements and OOM-counter changes, plus browser crashes/request errors, when acceptance fails. Process-leak checks alone cannot identify this failure class. Bound artifact retention on persistent workers.

Increasing retries, globally serializing the suite, or raising descriptor limits is not the primary fix: the failures already occur in one test with one worker and low descriptor counts. More RAM or fresh workers provide capacity, but do not cure runtime-directory retention. Routine forced GC is not the proposed fix.

There is also a separate reproducibility issue: the coordinator aliases Chromium build 1223 into the build-1208 path expected by Playwright 1.58.2. Its manifest expects Chromium `145.0.7632.6`, while tests actually run `148.0.7778.96`. Provision the matching browser version instead of this alias. Whether version alignment changes buffer retention remains untested; it is not established as the root cause.

## What remains unknown

- The exact failed allocation syscall/errno for the original 16 SVG errors. The response-pipe path is inferred from source, accepted HTTP responses, capacity measurements, and the GC experiment.
- Whether Chromium 145 retains the same buffers, and whether Chromium 148's retention is intended GC timing or a regression.
- Whether cleanup alone leaves sufficient headroom for every source-based acceptance on an 8 GB worker. No cleanup-only A/B or post-fix full verify was performed.
- Whether demo-mode teardown or channel-switcher drag flakes share any part of this cause.
- The original worker's exact capacity at the historical failure instant; later inspection cannot recover it.

## Reproduction and retained evidence

Experiment revisions remain in branch history. The final report revision restores test/harness files to `68b8ab11`; instrumentation and forced GC are not proposed changes for merge.

Targeted runs used:

```sh
npm test -- blaxel --file packages/web/test/e2e/theme-product-acceptance.test.ts --grep 'executable theme reset reloads connected Chromium documents under confirmed state' --ignore-uncommitted --run-dir-output /tmp/rose-chromium-runN
```

Experiment 2 omitted `--grep`. Experiment 3 used:

```sh
npm test -- blaxel --shard-indices 8 --force --ignore-uncommitted --run-dir-output /tmp/rose-chromium-run3
```

`--ignore-uncommitted` acknowledged only a local `node_modules` symlink to already-installed coordinator dependencies. Actual test code was committed and pushed. The first attempt to dispatch experiment 1 stopped at remote preflight because this symlink appeared untracked; it ran no tests.

[measurements.json](chromium-insufficient-resources-evidence/measurements.json) retains compact measurements, commit/sandbox/run-directory identities, and GC snapshots. Detailed [GC renderer descriptors](chromium-insufficient-resources-evidence/gc-renderers.json) and [original-worker filesystem inspection](chromium-insufficient-resources-evidence/filesystem-inspection.txt) are also retained. Kernel evidence: [shard replay](chromium-insufficient-resources-evidence/run3-kernel-oom.txt), [isolated case](chromium-insufficient-resources-evidence/run4-kernel-oom.txt). Full normalized reports remain under this worktree's `.test-runs/`, with exact paths in the JSON. Downloaded NetLogs remain at `/tmp/rose-run1.netlog.json` and `/tmp/rose-run3-retry2.netlog.json` on the development host.

Primary Chromium 148 source references:

- [Response buffer size: 2 MiB](https://github.com/chromium/chromium/blob/148.0.7778.96/services/network/public/cpp/loading_params.cc#L15-L45).
- [Response-pipe allocation failure becomes ERR_INSUFFICIENT_RESOURCES](https://github.com/chromium/chromium/blob/148.0.7778.96/services/network/url_loader.cc#L1216-L1238).
- [DataPipe allocates shared memory](https://github.com/chromium/chromium/blob/148.0.7778.96/mojo/core/ipcz_driver/data_pipe.cc#L145-L170).
- [Shared-memory files and AllocateFileRegion](https://github.com/chromium/chromium/blob/148.0.7778.96/base/memory/platform_shared_memory_region_posix.cc#L189-L243).
- [Outstanding-loader limit: 2,700](https://github.com/chromium/chromium/blob/148.0.7778.96/services/network/network_context.h#L968-L972) and [admission check](https://github.com/chromium/chromium/blob/148.0.7778.96/services/network/url_loader_factory.cc#L238-L283).
- [POSIX descriptor errors also map to this code](https://github.com/chromium/chromium/blob/148.0.7778.96/net/base/net_errors_posix.cc#L84-L113), explaining why the error string alone cannot identify the resource.

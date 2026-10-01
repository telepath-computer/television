# Chromium resource failures on Blaxel

Investigator: rose. Branch: `thopter/investigate-chromium-insufficient-resources`, based on `68b8ab11`. All execution is remote on Blaxel; no tests, browser, application server, or Electron run on the shared development host.

## Evidence at investigation start

- Full verify at `68b8ab11`: theme reset failed all three attempts on shard 8. Trace supplied at `/tmp/desktop-connect-theme-reset-blaxel-trace.zip` is retry 1. Chromium identifies itself as `148.0.7778.96`.
- The trace records 2,017 requests across two pages and four document loads per page. Sixteen consecutive SVG-module imports fail with `ERR_INSUFFICIENT_RESOURCES` during the fourth load on one page. Each page has approximately 258 unique request URLs; the raw total is not a concurrent-request count.
- The native shard plan assigns theme-product-acceptance to shard 8, with token-only-persistence and six unit files before it, and desktop user-data-identity after it. Surfaces run sequentially. Theme acceptance uses one Playwright worker. Its retry gets a fresh worker/browser.
- No process leak was reported, including at shard startup. This does not measure memory or descriptor pressure during a test.
- The demo-mode flake is on shard 36, despite summary.json pointing its log path to shard 8. Its first attempt timed out in afterEach; the retry passed in 1.394 s. There is no current evidence that this is the same network error.
- `scripts/run-blaxel-testshards.mjs` aliases Chromium build 1223 into Playwright's expected build-1208 paths. This is a browser-version mismatch, not yet evidence of causation.

Original run: `/home/user/workspace/wt/television-desktop-connect-links-plan/.test-runs/2026-10-01T21-41-23-867Z-p2861143-ra3e7bfaa4a5003cd`.

## Competing explanations

- Chromium request quota: version 148 source has a 2,700-loader limit per initiating process. The trace's request volume appears too low, but transient outstanding counts need measurement.
- File descriptors / shared-memory allocation: the Chromium error has paths for both descriptor exhaustion and failed Mojo response data-pipe allocation. Need process limits, peak FD counts, and browser logs.
- Memory, process leakage, shard packing: not established by the full-verify correlation. Fresh retry browsers and sequential surfaces weaken retained-page and simultaneous-surface explanations.

Source references: [URL loader factory](https://github.com/chromium/chromium/blob/148.0.7778.96/services/network/url_loader_factory.cc), [network context](https://github.com/chromium/chromium/blob/148.0.7778.96/services/network/network_context.h), [URL loader](https://github.com/chromium/chromium/blob/148.0.7778.96/services/network/url_loader.cc), [POSIX error mapping](https://github.com/chromium/chromium/blob/148.0.7778.96/net/base/net_errors_posix.cc).

## Experiments

Pending: the exact failing test, with default retries, instrumented to record request failures, outstanding requests, process FD counts and limits, memory/cgroup statistics, Chromium stderr, and NetLog. Instrumentation is investigation-only and changes no production code.

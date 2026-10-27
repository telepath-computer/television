# Test-harness cleanup: slice 1 evidence

Owner: rose. Draft PR #12, branch `thopter/test-harness-resource-cleanup`. Derived from the converged [plan](test-harness-resource-cleanup-plan.md). This record covers worker-owned builds and the five built-application walks. It does not claim the diagnostics or remote worker lifecycle from slices 2 and 3.

## Changes and review scope

`WorkerBuilds` owns temporary directories before preparation starts, shares pending and successful results by key, removes failed output and permits retry, and waits for preparation before worker teardown removes the remaining output. Both real builders use it. The web builder retains serialized environment overrides and version-keyed reuse. Source CLI preparation now returns its entry only after the build and runtime assets succeed.

Playwright's existing shared registration now has a worker fixture in addition to its per-case server cleanup. Vitest callers use a small worker-scoped fixture registration. Normal server disposal preserves reusable builds. Worker cleanup stops registered servers before removing builds; failed server cleanup remains registered and prevents build removal. Per-launch cleanup is registered before configuration or preparation, and a failed private bundle copy removes both that runtime and its launch-owned home.

The five selected walks load built assets: persistence and executable lifecycle in `theme-product-acceptance.test.ts`, plus all three demo-mode cases. The theme walks keep their browser origins through the existing stable-front proxy while each replacement backend binds port `0`. Existing product, appearance, motion and authentication behavior is preserved. The unsupported-URL document is copied under the test runtime's `web/views/url-unsupported` static path, matching the production package layout. PR #9's reset test and the separate Settings development-module walk are unchanged.

Five already-built browser update/gate files and two Node update/reload files also change their test registration so their versioned web outputs receive teardown. Their loading and assertions do not change. The other Vitest registrations are the source-CLI proxy and ACP callers, foundation-copy tests, and build-config integrity. No production application file, dependency, timeout default or retry default changes.

## Placement and red/green

Every test ran from `/workspace/television` on `tv-cleanup-coordinator-rose`, using the canonical Blaxel runner and private pool `rose-cleanup`. Native execution ran on `tv-testshard-x64-rose-cleanup-01` or `-02`, at committed, pushed revisions. No tests, builds, lint, type checks, browsers or servers ran on the shared development host. The shared pool was not used or modified. Default canonical retries were retained: two for e2e and zero for unit surfaces, plus two infrastructure retries. The nested worker fixtures deliberately use zero retries so each child records exactly two cases; their canonical parent retains the e2e budget.

- `564a8edb` stopped at registry validation before execution because two static nested configs looked like unregistered surfaces. This is setup failure, not red evidence. `74485d22` generates the native configs inside the acceptance's private temporary directory, following the existing nested-runner arrangement.
- At `74485d22`, the Playwright child successfully built and used the real output in both cases, but the parent found four retained harness directories after worker exit. The Vitest case established the same failure at `2460d06a`. All three canonical attempts failed on that assertion, with no process-leak or infrastructure failure.
- The four cache contracts at `2460d06a` failed on retained partial/completed output. Their builders are the proof-declared substitutes and use a real temporary filesystem. The lifecycle seam, rather than these callbacks, establishes usable real CLI/web output and actual framework teardown.
- At `8bfd952f`, all four contracts, both framework seam cases, and the existing startup-disposal/proxy file passed. Each framework ran two worker lifetimes; cases reused output within a worker, later workers had separate paths, failed-copy output disappeared before the valid launch, and teardown left no owned build or launch directories.
- At `d43623ba`, all five selected browser cases reached and failed the new request-boundary assertion: development modules were still requested. At `a2fd5a1e`, the executable walk passed but persistence failed on a 404 for the unsupported-URL view. The helper had copied it to the sibling-view location even though the server serves this document through the web static root. `3156e303` corrects only that destination. The narrow persistence run, whole demo file and whole theme file then passed.
- Inspection of the repository TypeScript target prompted `502ba255`: explicit constructor field assignments replace parameter properties, and test rendezvous promises use ES2022-compatible construction. This changes no lifetime behavior. Remote lint passed at that revision; type checking found that the adapted startup-disposal assertion had used Playwright’s plural `intervals` instead of Vitest’s singular `interval`. `38976455` corrects the option. Both `npm run lint` and `npm run type-check` then passed on the private coordinator at that pushed revision, and the cache-contract and startup-disposal files passed there through the canonical Blaxel runner. Static logs are retained locally under `.test-runs/slice-1-static/`.

The run table below records the native evidence and exact canonical selections. Each command has the prefix `npm test -- blaxel --pool rose-cleanup`; the `--run-dir-output` receipt used for orchestration changes no selection. Every run directory is under `/workspace/television/.test-runs/` on the coordinator and has also been copied under `.test-runs/` in the contribution worktree. `summary.json`, `results.json`, `events.ndjson`, the provider request/report/setup/shard files and native JSON are retained for executed runs. The interrupted fetch has only canonical summaries/events and its coordinator log; it never produced a provider or native report. The native JSON embeds request inventories, so they remain available after later worker checkout or cleanup.

| Commit | Canonical selection after the command prefix | Result | Run-directory name |
| --- | --- | --- | --- |
| `74485d22` | `--file test/node/worker-build-lifetime.e2e.test.ts --grep 'playwright workers'` | failed (1 failing case) | `2026-10-27T16-59-11-096Z-p2995-r90394ebd75419cf9` |
| `2460d06a` | `--file test/repo/worker-builds.test.ts` | failed (4 failing cases) | `2026-10-27T17-01-33-418Z-p3544-rf0ed6ae6891b7bef` |
| `2460d06a` | `--file test/node/worker-build-lifetime.e2e.test.ts --grep 'vitest workers'` | failed (1 failing case) | `2026-10-27T17-02-51-359Z-p4091-r5570749d7be150b1` |
| `8bfd952f` | `--file test/repo/worker-builds.test.ts` | passed | `2026-10-27T17-04-17-350Z-p4640-rcf9e120c55c8be12` |
| `8bfd952f` | `--file test/node/worker-build-lifetime.e2e.test.ts` | passed | `2026-10-27T17-04-25-470Z-p4733-rbbb88b3e4252cfc0` |
| `8bfd952f` | `--file test/node/product-server-proxy.e2e.test.ts` | passed | `2026-10-27T17-04-54-699Z-p4840-r7088235135e9aca5` |
| `d43623ba` | `--file packages/web/test/e2e/theme-product-acceptance.test.ts --grep 'theme settings persist\|executable themes run only'` | failed (2 failing cases) | `2026-10-27T17-06-17-318Z-p5370-rdb44323ae2540294` |
| `d43623ba` | `--file packages/web/test/e2e/browser-demo-mode.test.ts` | failed (3 failing cases) | `2026-10-27T17-06-45-779Z-p5483-r1ecb1a123a8af3bd` |
| `a2fd5a1e` | `--file packages/web/test/e2e/theme-product-acceptance.test.ts --grep 'theme settings persist\|executable themes run only'` | failed (1 failing case) | `2026-10-27T17-08-32-289Z-p6045-r1adf8b65c466ea55` |
| `3156e303` | `--file packages/web/test/e2e/theme-product-acceptance.test.ts --grep 'theme settings persist'` | passed | `2026-10-27T17-10-55-998Z-p6619-r99415de847ed17ad` |
| `3156e303` | `--file packages/web/test/e2e/browser-demo-mode.test.ts` | passed | `2026-10-27T17-11-19-136Z-p6726-rf86e68498d027234` |
| `3156e303` | `--file packages/web/test/e2e/theme-product-acceptance.test.ts` | passed | `2026-10-27T17-11-40-111Z-p6829-r29aa92fa0c6cb29c` |
| `3156e303` | `--file test/repo/build-config-integrity.test.ts --grep 'canonical font preload build seam\|web bundle version stamp'` | passed | `2026-10-27T17-12-32-079Z-p7345-rfbd491c0ee9aed82` |
| `3156e303` | `--file packages/web/test/foundation-copy.test.ts` | passed | `2026-10-27T17-12-48-815Z-p7444-r94b6e463c178a6b4` |
| `3156e303` | `--file test/node/acp-home-context.test.ts` | passed | `2026-10-27T17-12-58-704Z-p7540-r84fc72db15ad1385` |
| `3156e303` | `--file test/node/update-reload.e2e.test.ts` | passed | `2026-10-27T17-13-13-727Z-p7640-rd72830577adb0018` |
| `3156e303` | `--file test/node/update-reload-guard.e2e.test.ts` | passed | `2026-10-27T17-13-31-883Z-p7741-r161ae1bc0a41232f` |
| `3156e303` | `--file packages/web/test/e2e/update-reload.spec.ts` | passed | `2026-10-27T17-14-11-154Z-p7844-r2c4c37ea91b77a0a` |
| `3156e303` | `--file packages/web/test/e2e/update-journey.spec.ts` | passed | `2026-10-27T17-14-29-358Z-p7946-r2c2aef1f919cbe7d` |
| `3156e303` | `--file packages/web/test/e2e/update-notification.01.spec.ts` | passed | `2026-10-27T17-15-05-017Z-p8039-rbee79ef58ccb9edd` |
| `3156e303` | `--file packages/web/test/e2e/update-notification.02.spec.ts` | passed | `2026-10-27T17-15-28-580Z-p8147-r1c56a1d06122b465` |
| `3156e303` | `--file packages/web/test/e2e/gate-boot-barrier.spec.ts` | passed | `2026-10-27T17-15-49-683Z-p8247-r828004637951bbdb` |
| `38976455` | `--file test/repo/worker-builds.test.ts` | passed | `2026-10-27T17-19-37-128Z-p9328-r8f26a6a3c4857187` |
| `38976455` | `--file test/node/product-server-proxy.e2e.test.ts` | incomplete | `2026-10-27T17-19-45-200Z-p9422-r9fa89f239159c80d` |
| `38976455` | `--file test/node/product-server-proxy.e2e.test.ts` | passed | `2026-10-27T17-25-51-595Z-p10092-r14dcdf8329a685aa` |

Every completed green run above has zero recovered native retries, process leaks and infrastructure failures. One final proxy rerun stalled in the coordinator’s HTTPS `git fetch origin --prune`, before acquisition. After confirming the Git child’s PID, start time, parent and command, I stopped that child on the private coordinator. The canonical result is retained as **incomplete**, with unknown tests and one infrastructure failure; it is neither red nor green evidence. Repeating the identical file selection passed. The repeat used process-local Git low-speed limits (one byte/second for 60 seconds) to bound another network stall; no repository, runner timeout or retry default changed.

## Request inventories and limits

The red theme runs observed 254–255 distinct development-path records per application document. On the passing complete walks, the persistence page has 38 distinct request records, and the two executable pages have 27 and 26. The three demo walks have 25, 20 and 20. All six application documents request `/` and built `/assets/` JavaScript; none of their complete retained inventories contains a development path (`/packages/`, `/@vite/`, `/@id/`, `/@fs/` or `/node_modules/`). Inventories omit query values, fragments and headers, and deduplicate by path, resource type and main-frame membership. These are loading-path observations, not raw request counts, peak-memory measurements or incremental savings after PR #32.

The full theme file on the private Chromium image passed its five Chromium cases and skipped its Firefox-only case. The optional Firefox project was unavailable on that image. This slice makes no new Firefox execution claim. The focused build-config selection covers its four builder/font-preload cases; unrelated CLI telemetry-build cases await the integrated gate.

Full verification, the killed-worker cleanup backstop, renewable reservations through retrieval, abandoned-run recovery, scratch cleanup and bounded failure diagnostics remain pending under the later slices. The private coordinator and two workers remain allocated for that work. No pool drain, worker recreation, shared-worker experiment or production resource-behavior change was performed.

Primitive's commit hook surfaced a truncated set of existing decisions; that was not a complete constraint check. No decision was overridden or reconciled. This slice implements the converged direction and establishes no new durable team policy.

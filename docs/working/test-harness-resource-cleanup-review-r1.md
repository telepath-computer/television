# Proposal review, round 1: test-harness resource cleanup (draft PR #12)

**Verdict: FAIL.** Two blockers, both about scope and consequences, not about the diagnosis. The diagnosis is supported, the three recommended fixes are the right ones, and the core `/tmp` answer is safe. The proposal then adds a rework of the worker lease that the cleanup does not need, and it leaves out what happens while other branches keep running the old harness on the same pool.

- Reviewed: `docs/working/test-harness-resource-cleanup-proposal.md` at `1652787e` on `thopter/test-harness-resource-cleanup`, with the investigation report and both evidence folders.
- Against: Josh's request (the investigator's recommended fixes, and whether `/tmp` on Blaxel workers can be cleaned safely before or after runs), the contribution workflow, the reviewer checklist, and the code and specs the proposal cites.
- I ran nothing. Every check below is a read of files in the checkout.

## Is the diagnosis supported? Yes

I checked the report's claims against the retained evidence and the code.

| Claim | Evidence | Result |
| --- | --- | --- |
| Renderers were killed for lack of memory | Kernel logs: two kills in the shard replay, three in the isolated case, each a `chrome-headless` process | Proven |
| The unbundled page's response buffers are the consumer | The forced-collection experiment released 220 buffers of 2 MiB in each of two renderers; a passing run fell to about 0.55 GB of free memory | Proven for retention; the failing allocation call is inferred, and the report says so |
| The worker's writable filesystem is RAM | Mount table: overlay with its upper layer under `/mnt/tmp`; idle shared memory tracks used root space on both inventoried workers | Supported |
| `getSourceCLIEntry()` leaks one directory per worker process | `test/helpers/product-server.ts:67-76`: the cache is set at line 70, before the build at 71; nothing removes the directory | Confirmed |
| `buildVersionedWebBundle()` leaks one directory per version | `test/helpers/versioned-web-bundle.ts:39-41, 62-70`: no removal, and a failed build stays cached | Confirmed |
| 267 and 146 leaked directories on `poc-131`; 17 and 27 on `poc-03` | Inventory files | Counts and byte totals match |
| The lock is reclaimed on time alone, and released before results are downloaded | `scripts/run-blaxel-testshards.mjs:406` (expiry), `:859` (exit trap), `:457-502` (download after the process ends) | Confirmed |
| The 17 web test files in the conversion table are the `ProductServer.appURL()` users | A search finds exactly those 17, plus the three desktop files the proposal excludes | Confirmed |
| The product runtime lacks the `url-unsupported` view | `test/helpers/product-server.ts:103-132` copies the index, assets, two views and canonical only | Confirmed |

The report is careful about what it does not know, and the proposal carries those limits forward.

## Blocker 1: the lease rework is not needed for safe cleanup, and its consequences are not examined

The proposal says cleanup "therefore extends the existing lease boundary" and calls this "a narrowly required correction". It asks for all of the following:
- the coordinator holds the lease through download and disposal;
- the worker stops unlocking at shell exit;
- reclamation checks the prior supervisor's process identity instead of the expiry time;
- acquisition stays exclusive under racing coordinators;
- an ambiguous owner keeps the worker unavailable;
- results move to an attempt-specific directory.

**Safe cleanup does not depend on any of that.** The proposal's own directory design already makes it safe:
- A job creates its attempt directory under a random name, so it owns it by construction. It can remove it in the exit path that exists today, before that path releases the lock (`run-blaxel-testshards.mjs:859`).
- Reclaiming an older attempt directory needs one local check: is the recorded supervisor, by process ID and start time, still alive? If it is, leave the directory. That check protects a live job even when the lock has wrongly changed hands.
- Results do not live in the scratch directory, so the download race does not bear on scratch cleanup.

**The lease weaknesses are real but separate.**
- The download race is a genuine defect: the lock is released at shell exit, and the next job's first step deletes the results directory.
- The expiry concern is weaker than the text suggests. The lock lives 900 or 1200 seconds against a worker timeout of 240 or 480 seconds (`run-blaxel-testshards.mjs:1176-1178`). The Blaxel spec names expiry deliberately as "the final bound" for a worker whose cleanup could not be confirmed (`specs/arch/test-runner/blaxel-testshards.md:29-31`).
- The proposal itself says no observed failure is attributed to these races.

**The consequences are not handled.**
- *Availability.* Today a worker with unconfirmed cleanup comes back when its lock expires. Under the proposal an ambiguous owner keeps it unavailable. On a pool that every agent shares, that turns a twenty-minute delay into a worker that stays out until someone intervenes. The proposal does not say who clears it or how.
- *Mixed versions.* Each coordinator runs from its own branch and uploads its own shard script. Branches that have not taken this change will keep reclaiming on expiry and unlocking at exit. The new guarantees do not hold while they exist, and the proposal mentions this only for the one-time cleanup.
- *Spec weight.* It replaces a rule the Blaxel spec states on purpose. That is a decision for Josh on its own merits, not a side effect of cleaning `/tmp`.

**To clear this:** take the lease rework out of this contribution and record the download race as its own item; or keep it, but present it to Josh as a separate decision with the consequences above worked through, and drop the claim that cleanup requires it.

## Blocker 2: the proposal does not say what happens while other branches still run the old harness

The helpers and the shard script are per-branch. A run dispatched from a branch without this change still writes `television-source-cli-e2e-*` and `television-web-bundle-*` straight into `/tmp` on the shared workers, and nothing in the new routine cleanup removes them: it deliberately does not infer ownership from a prefix.

So three statements in the proposal are true only for updated branches:
- "A worker should start its next shard without accumulating the preceding shard's disposable files."
- The legacy removal is a "one-time operation".
- "The normal before/after cleanup covers future runs regardless of which helper created their temporary files."

Old-branch runs will keep leaking, slowly (about 4 MB per leaked runtime), until every active branch has taken main. That may be perfectly acceptable. Josh should see it and choose, because the alternatives differ in cost:
- accept the residue and repeat the legacy cleanup once branches have caught up;
- let the routine pre-run step remove these two known generated prefixes on a leased idle worker;
- recreate the pool at a chosen time.

**To clear this:** state the mixed-version period, its effect on each claim above, and the option the proposal recommends.

## Is the `/tmp` answer safe and evidenced? Yes at its core

- **"Not blanket" is right and evidenced.** The inventories show the lock, the uploaded shard scripts, the provider's upload directory and the X11 directory all in `/tmp`. Deleting everything before a run would remove the job's own script and lock.
- **"Yes for files the runner owns" is right.** A per-attempt directory with `TMPDIR` pointing into it gives cleanup an exact boundary. It also catches leaks nobody has found yet. The inventories show more leaked prefixes than the two helpers: 222 uploaded shard files, 33 `tv-electron-env-*`, and dozens of `tv-attest-*` directories from test fixtures.
- **The wiring claims hold where I could check them.** Both helpers use `os.tmpdir()`. The Playwright and Chromium claims match my knowledge of those sources, but I did not fetch them. The proposal correctly says a live run must still observe Node paths and Chromium's shared-memory files under the attempt directory.
- **The stated limits are the right ones:** hard-coded `/tmp` paths and the X11 socket directory do not move; deleting a directory does not free memory that a live process still holds.

The answer would be easier for Josh to act on if it came first and plainly:
- **After a run:** yes, the run removes its own scratch before releasing the worker.
- **Before a run:** yes, for scratch whose recorded owner is dead; never everything.
- **What is already there:** a separate decision (see refinement 2).

## Is the scope proportionate? Partly

Apart from the lease rework, the three fixes are the investigator's three recommendations. Their weight in the proposal does not match their effect, and the proposal should say so.

## Refinements (non-blocking)

1. **State how much each fix buys.**
   - On `poc-131`, `/tmp` held 1.2 GB of 4.3 GB used on a 6.3 GB root. The rest is the checkout and `node_modules` (1.4 GB), the Playwright browsers (0.9 GB) and caches. On `poc-03`, `/tmp` held 0.16 GB of about 3.0 GB.
   - The theme-reset test consumed roughly 3.2 GB by itself in a passing run.
   - So even a perfectly clean worker runs that unbundled test within about half a gigabyte of the limit. The built-application change removes gigabytes per test; cleanup recovers at most about one, on the worst worker seen.
   - Both are worth doing, but the problem statement should give these sizes so the cleanup machinery is sized to its benefit.

2. **Weigh recreating the pool against the bespoke legacy cleanup.**
   - The Blaxel spec already defines provisioning as delete-then-ensure and says it is fresh-only (`blaxel-testshards.md:21-23`). Recreating the pool once clears every worker with no new code.
   - The proposal offers that only as a fallback. It prefers a "drained worker under an exclusive maintenance lease" with layout checks, and does not say whether that is new code or an operator procedure.
   - Say which, and why it beats recreation.

3. **Name the minimum diagnostics that would have identified this incident.**
   - Free memory, shared memory, free bytes on the temporary filesystem and the kernel's out-of-memory kill counter, read at surface start and end, plus the kernel's kill lines on failure, would have been enough.
   - The periodic sampler, the per-process descriptor summaries, the attempt records and the recording-time caps are the investigation's tools.
   - The diagnostics section reaches into five specs. Mark the minimum as the commitment and the rest as optional.

4. **Two validation questions need answers before work starts.**
   - *Which pool?* Lease, cleanup and interruption experiments must not run on the shared `poc` pool that other agents use. The proposal says "an isolated Blaxel worker" without naming a pool or its cost against the 75-shard limit.
   - *Which host runs the final gate?* The proposal requires `npm run verify -- blaxel` from "a dedicated Blaxel coordinator host". Nothing in the documents shows such a host exists. The workflow accepts ready-PR GitHub CI as full validation, and the Blaxel spec asks only for a live targeted run and a planned-shard run for coordinator changes. Either name the host or use that route.

5. **Say what stays exposed.** 41 test files load the unbundled page. The proposal converts the 17 that go through `ProductServer.appURL()` and leaves the three desktop ones. About 21 others reach the development page without the product server and keep the same per-load cost. Say whether any of them reload or open several pages, since that is what made theme-reset fail.

6. **Give the reason for fixing the helpers as well as adding scratch space.** On Blaxel, attempt scratch removed at shard end would clear the helpers' directories without touching the helpers. The helper fix is what protects hosts with no shard script. This development host has 1,388 `television-source-cli-e2e-*` and 727 `television-web-bundle-*` directories in `/tmp` today. That is the argument for doing both, and the proposal does not make it. Whether to clean this host is the owner's call.

7. **Sequencing with PR #9.** Both change `theme-product-acceptance.test.ts`, and both touch `test/helpers/stable-front-proxy.ts`: PR #9 adds a hook, and this proposal reuses the proxy for restart walks. Say which lands first.

## Reviewer checklist

The proposal changes no spec yet, so most checklist items apply at the next stage. Two apply now:

- **Authority.** The derivation section names the owning specs correctly. With the lease rework removed, `preflight.md` and most of the `blaxel-testshards.md` changes fall away.
- **Testing directives.** The proposed policy line, built application by default for product browser acceptance, is a real human-owned directive and belongs in `testing-policy.md`. It should come with refinement 5's statement of what remains on the development page and why.

## What I could not establish

- Whether Blaxel kills a shard process at its timeout. That decides how real the expiry overlap is; I assumed it can fail.
- The make-up of the 0.9 GB of Playwright browsers on the workers, or whether any of the non-`/tmp` baseline is reclaimable.
- The Chromium and Playwright source claims, which I did not fetch.
- Why `poc-32` and `poc-15` started with less free memory than the passing workers. Neither was inventoried, so the share due to `/tmp` there is unknown.

## Housekeeping

- Read-only: no edits, commits or pushes, and nothing run on this host or on Blaxel. I listed names in this host's `/tmp` to count the leaked directories; nothing was changed.
- Primitive produced no output during this review, so I have nothing to report on its usefulness.

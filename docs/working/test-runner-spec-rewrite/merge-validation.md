# Validation of the #49 and #12 integration

This branch integrates #49 (local test-runner guardrails, head `ea587122`) and #12 (Blaxel worker leases, recovery, cleanup and diagnostics, head `9787188d`), both cut from main `a8e73fbf`. The merge commits are `3c8e1ae6` (#49) and `bcc65d97` (#12); their messages list the reconciliation. This note records the evidence that the integrated tree stands for both PRs, and which of their own evidence carries forward.

## Fix after the integration review

An independent review of `bcc65d97` found that on a marked host, a dedicated harness coordinator selecting `experiment:blaxel-harness` by surface or tag was refused with a redirect to `npm test -- blaxel …`, which the driver's placement check refuses. `8e6cfcb2` makes the driver a local-only selection in the marked-host refusal, which now names `npm test -- local --file test/runner-fixtures/blaxel-harness/driver/harness.test.ts`, and narrows the driver surface's registry root to that file. The marked-home guardrail tests cover the surface and tag selections and the one-file form.

- `test/repo/test-runner-guardrails.test.ts` passed locally after the edit (run `2026-10-28T10-20-47-745Z-p1707019-r349043cfc85d5e63`). That tree was `bcc65d97` plus the uncommitted fix, which was then committed unchanged as `8e6cfcb2`, and unrelated spec drafts. The full verify below covers the committed tree.
- A dry run on this marked host, with both harness variables set, printed the one-file route and no Blaxel command.

## Full verification

| Revision | Command | Result | Run directory |
|---|---|---|---|
| `bcc65d97` | `npm run verify -- blaxel` | passed: 22 surfaces, 36 shards, no failures, recovered flakes, leaks or infrastructure failures; attestation `refs/testpass/1/525624a5…` | `.test-runs/2026-10-28T10-00-43-840Z-p1692106-r34f2d38fb9650509` |
| `8e6cfcb2` | `npm run verify -- blaxel` | passed: 22 surfaces, 36 shards, no failures, recovered flakes, leaks or infrastructure failures; attestation `refs/testpass/1/1fa0f84c…` | `.test-runs/2026-10-28T10-26-27-193Z-p1712863-r87698ed901a403eb` |

## Targeted and planned Blaxel handoffs on `8e6cfcb2`

The full verify is a planned run, so it does not enter the targeted dispatch path the integration changed: `target-native.mjs` now writes the Vitest runner config and attempt file, `supervised-command.mjs` finds the attempt file for diagnostics, and the target summary advertises the generated config. These small fixture selections crossed the real Blaxel API and transport on the shared `poc` pool. Each ran with `--commit 8e6cfcb2` and the default infrastructure retry budget of 2.

| Probe | Selection | Expected | Observed | Run directory |
|---|---|---|---|---|
| A | `--file test/runner-fixtures/guidance/vitest/one.test.ts --grep 'deliberate first-attempt failure\|sibling'` | pass after one recovered attempt | exit 0; budget `2`; native report holds only `one.test.ts` (adversarial sibling `one.test.ts.test.ts` absent); attempts `failed`, `passed`; generated `native-shard-1.json.runner.mjs`, attempt file and native report downloaded and readable; diagnostic record complete with `failedAttempt: true`, `recovered: true`, kernel evidence available, both links resolve | `.test-runs/2026-10-28T10-23-13-752Z-p1710376-r9118b10c699014bb` |
| B | as A, with `--retries 0` | the deliberate failure is final after one attempt | exit 1; budget `0`; one `failed` attempt; same artifacts retained; diagnostic `failedAttempt: true`, `recovered: false` | `.test-runs/2026-10-28T10-23-11-962Z-p1710373-r9ceb449ad7bda74d` |
| C | `--file test/runner-fixtures/guidance/playwright/one.test.ts --grep 'deliberate first-attempt failure\|sibling'` | pass after one recovered attempt | exit 0; budget `2`; native report holds only `one.test.ts`; diagnostic complete with `recovered: true` | `.test-runs/2026-10-28T10-24-08-127Z-p1711445-rb2d4c679f21425bd` |
| D | `--tag runner-guidance --runner playwright --against-test-guidance-turn-flakes-into-failures-on-broad-runs --shards 2 --allow-shard-count-override 1` | planned zero budget; deliberate failure final; per-test annotation still retries | exit 1; `--test-retries 0`, `--retry-infra 2`; shard 1 ran `one.test.ts` with the deliberate failure final after one attempt and the annotated case recovered; shard 2 ran the sibling file; both shards' test lists, native reports and diagnostics retained | `.test-runs/2026-10-28T10-24-42-747Z-p1711676-r9d77334ea5dd8cef` |

C and D were first started concurrently with A and B and stopped at the `origin-fetch` preflight, because four simultaneous `git fetch origin --prune` calls in one checkout contend for the same refs. They passed preflight when rerun one after another; the runs above are those reruns.

## Evidence carried forward from the source PRs

The integration leaves these paths as each PR left them, so their own live evidence still applies and is not repeated:

- **#12 lease, recovery, provisioning and temporary-file behavior.** The lease, recovery, pool publication and deletion, and scratch cleanup code is unchanged from `9787188d`. The PR's live qualification ran `test/runner-fixtures/blaxel-harness/` on disposable private workers from a dedicated coordinator, covering competing acquisition and deletion, delayed retrieval, active and quiet coordinator crashes, recovery receipts, diagnostic transport and Node/Chromium temporary-file placement. Its worker-lease and lease-contract files passed on private workers at `2156f266`, and GitHub CI run [40594589067](https://github.com/telepath-computer/television/actions/runs/40594589067) passed at `9787188d`. The integration changed the driver surface's registry root from its directory to its only test file, and nothing in the driver or fixtures.
- **#49 mutex fault cases on isolated GitHub.** The mutex and lifecycle code and fixtures are identical to `ea587122`. [Isolated Linux lifecycle run 40502488567](https://github.com/telepath-computer/television/actions/runs/40502488567) passed at `eeef2dab` (direct mutex tests, verify handoff tests, four mutex crash and recovery cases, thirteen lifecycle cases). GitHub CI run [40514829404](https://github.com/telepath-computer/television/actions/runs/40514829404) passed at `ea587122`.

Required GitHub checks and human review still govern any eventual merge of this branch's integration into a shared branch.

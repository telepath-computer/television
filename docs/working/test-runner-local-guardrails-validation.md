# Local guardrails validation

This record accompanies the [implementation plan](test-runner-local-guardrails-plan.md). Local checks run only the test file under edit. Broader checks use a committed, pushed revision on Blaxel. Deliberate zero-retry probes below are fixture evidence, separate from validation with the default budget.

## Slice 1 — file admission and retries

Node v24.21.0 and npm 11.19.0 satisfy the repository declarations. `npm ci` completed in this worktree.

Local red/green checks preceding the first slice commit:

| Check | Red evidence | Green evidence |
| --- | --- | --- |
| `test-runner-guardrails.test.ts`, grep `local file and retry admission` | `2026-10-01T22-50-14-056Z-p2895870-r86c1a5770ff37a80`: marked breadth, broad zero and fractional/junk counts admitted | `2026-10-01T22-57-30-289Z-p2898332-r390f87ebbab9ce15`; full file passed in `2026-10-01T22-58-33-887Z-p2900578-r71fd89abea678b11`; refined admission cases passed in `2026-10-01T23-10-23-798Z-p2916826-r60825fa5e69d7956`; the expanded full file passed in `2026-10-01T23-14-15-771Z-p2921003-rcf9d504cfd6e3bcd` (20.5 seconds) |
| `test-runner-file-selection.test.ts` | `2026-10-01T23-01-08-715Z-p2903197-rba42108eeb8af17e` and corrected Playwright grep in `2026-10-01T23-01-47-293Z-p2904902-rfacaa88f9756af5a`: sibling collection and inherited native retries; fixture setup mistakes were corrected before relying on red evidence | Local inventory/collection/retry cases passed in `2026-10-01T23-03-31-631Z-p2907723-rc4e0568dbab7b140` |
| Planned and targeted worker cases in that same file | `2026-10-01T23-05-17-495Z-p2910271-rba770b98f8e5b399`: zero omitted by both worker adapters; `2026-10-01T23-06-06-032Z-p2911084-rc95ea0389a0d6719`: both target commands collected the adversarial sibling | Complete file passed in `2026-10-01T23-07-13-806Z-p2911754-r5c29f2e5069efd92` (48.9 seconds); the expanded file with diagnostic-worker and punctuation cases passed in `2026-10-01T23-11-58-751Z-p2917783-re9c8392c43117224` (65 seconds) |
| `test-runner-attestation.test.ts`, grep `parsed retry departures` | `2026-10-01T23-08-45-081Z-p2914181-r6a4ec7bc731c3716`: the standalone override was classified canonical | Full file passed in `2026-10-01T23-09-17-645Z-p2914376-r9d657779f38517b5` |

Run IDs refer to `.test-runs/<id>/` in the contribution worktree, containing native results and normalized summaries. Fixtures deliberately fail their first attempt to distinguish default/positive retries from zero. Those failures are expected assertions inside the outer test; they are not unexplained product flakes. Setup/import failures alone were not accepted as red behavior.

The opt-in `experiment:guidance-vitest` and `experiment:guidance-playwright` surfaces are excluded from `all`. They contain tiny native tests, including an adversarial sibling and an intentional first-attempt failure. Local tests copy these inputs into temporary checkouts with the production CLI, real Git inventories and private mutex paths reserved for slice 2. They launch no browser, repository-wide gate or destructive lifecycle fixture.

Mutex/wait, native-entrypoint enforcement and the complete instruction-layer changes remain assigned to slices 2 and 3. Shared help and option-independence proof markers remain open until their whole assertions are covered.


### Live Blaxel evidence at `26e67c2b1a59f38978a4bc22dd0c4676e113968e`

The branch was clean, committed and pushed before these commands. The ordinary validation command used default retries:

```bash
npm test -- blaxel --surface unit:root --commit 26e67c2b
```

Run `2026-10-01T23-16-20-537Z-p2923525-rfd479cbbc11c9159` reached all repository tests and reported four failures: two Vitest collection assertions compared normalized paths inside a nested checkout against ordinary repository-relative paths, and two provider assertions referenced the target-command implementation that moved. The file-collection assertions now inspect the actual native file identities; the provider tests exercise a real wrapper invocation carrying selectors, numeric zero and the absolute reporter path. Focused local checks passed in `2026-10-01T23-20-22-607Z-p2924705-r1e2b821b311364bc` and `2026-10-01T23-21-04-926Z-p2925253-ra14ab52d9bdc4df9`. Broader revalidation follows the pushed test corrections.

These three deliberate zero-budget probes validated remote handoffs:

```bash
npm test -- blaxel --file test/runner-fixtures/guidance/vitest/one.test.ts --grep 'deliberate first-attempt failure|sibling' --retries 0 --commit 26e67c2b
npm test -- blaxel --file test/runner-fixtures/guidance/playwright/one.test.ts --grep 'deliberate first-attempt failure|sibling' --retries 0 --commit 26e67c2b
npm test -- blaxel --tag runner-guidance --runner playwright --against-test-guidance-turn-flakes-into-failures-on-broad-runs --shards 2 --allow-shard-count-override 1 --commit 26e67c2b
```

| Probe | Retained run | Observed evidence |
| --- | --- | --- |
| Targeted Vitest | `2026-10-01T23-16-58-170Z-p2923764-r0c2e288d8a84cd72` | One actual file; sibling absent. Deliberate case failed at attempt index 0 with no second attempt; three other titles skipped. |
| Targeted Playwright | `2026-10-01T23-17-40-954Z-p2923923-r56b120209810d077` | One actual file and one test; sibling absent. Deliberate case failed at attempt index 0 with no second attempt. |
| Planned Playwright, two shards | `2026-10-01T23-18-22-967Z-p2924200-rc11f3d9ecadd7578` | Both worker tasks report `retryBudget: 0`; each collected exactly its assigned file. The deliberate blanket-budget case failed after one attempt. The separately annotated case recovered on attempt index 1, proving that blanket zero leaves per-test retries intact. |

All three exited 1 with completed infrastructure and the expected deliberate fixture failure. Their canonical `request.json` delegated `--test-retries 0`; targeted provider requests retained `retries: "0"` and the exact file list. Every provider request retained `retryInfra: 2`. Reports, native JSON, attempt sidecars and generated configs are retained below each run's `provider/blaxel/` directory. These are successful behavioral probes, not passing repository validations.

The pool skipped workers 21, 22 and 29 because their provisioned nvm entrypoint was absent, then acquired other workers successfully. No pool provisioning or repair was performed. Native-context evidence remains assigned to slice 3; these runs establish collection and retry transport.

The broader rerun on `43ddcfab9a629c6c88045d6daf11cfd464677db8` passed: `npm test -- blaxel --surface unit:root --commit 43ddcfab`, run `2026-10-01T23-22-54-928Z-p2925736-ree6511d4f0c1c232`. It covered 43 files and 477 cases (476 passed, one standing skip), with no recovered outer flakes.

A subsequent inspection found that a symbolic commit target could move during remote preflight's fetch. File admission now pins the resolved commit and passes that identity through inventory, preflight and dispatch. The authored Git-branch test failed in `2026-10-01T23-24-43-365Z-p2926104-r675cae41675b6f0d` and passed with the file-resolution group in `2026-10-01T23-25-31-837Z-p2926337-r3890b24c49371df4`. A further pushed-tree repository-surface run validates that final implementation.

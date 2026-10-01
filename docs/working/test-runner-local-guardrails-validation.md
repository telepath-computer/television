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

Remote validation and live handoff evidence are pending the first pushed slice revision. Mutex/wait, native-entrypoint enforcement and the complete instruction-layer changes remain assigned to slices 2 and 3. Shared help and option-independence proof markers remain open until their whole assertions are covered.

# Proof review, round 2: test-harness resource cleanup (PR #12, 3fa15d47)

**Verdict: PASS.** The placement spec delta gives the live tests and their deliberately failing fixtures a home that fits the registry and runner as they are, with no new kind or suite, and it states Josh's host rule outright. The five proof refinements are applied, one of them better than I asked. What remains is the proof binding the author deliberately held back until this spec review: naming the two surfaces, the coordinator host and the two selection commands in the live declarations. That is a bounded follow-up derived from a paragraph reviewed here, and I do not think it needs another independent round if it stays within what this report describes. Three small refinements follow.

- Reviewed: `git diff 9fd51f49 3fa15d47` for specs, proofs and working documents; the whole current proof delta against `origin/main` for the Blaxel, reporting, testing-policy, themes, artifacts and bridge proofs; the placement delta against the registry, runner and Blaxel specs and the runner's selection code; the reviewer checklist and the proof policy.
- Branch state: contains `origin/main` (`a8e73fbf`); the copied round 1 review is identical to mine; the spec and proof indexes match the files.
- I ran nothing. Every check is a read of files in the checkout or of git history.

## The placement spec delta

| Claim | Where | Checked |
| --- | --- | --- |
| Two `kind: "experiment"` surfaces: `experiment:blaxel-harness` (driver) and `experiment:blaxel-harness-fixtures` (native fixtures, tag `blaxel-harness-fixture`) | `test-registry.md:97` `^blaxel-harness-surfaces` | Uses the existing kind; the sentence that counted the experiment suite's "two placement classes" is removed, so nothing now miscounts. `all` and `e2e-ci` select by kind (`:90-93`), so both surfaces are excluded from broad runs and ordinary CI without a new rule. |
| The driver runs as `npm test -- local --surface experiment:blaxel-harness` on a dedicated credentialed Blaxel coordinator sandbox outside the worker pool, from a committed and pushed checkout, never on a shared developer host or a leased worker | `test-runner.md:147-149` `^blaxel-harness-placement` | States Josh's rule as spec. The local provider accepts every registered suite and surface (`:70`). |
| `--tag blaxel-harness-fixture` dispatches a planned `--suite selection --surfaces …` run; `--surface experiment:blaxel-harness-fixtures` dispatches a targeted run; workers read the committed registry, no forwarded hook | `:151` | Matches the runner today: `--surface/--file/--grep` take the targeted path and `--package/--runner/--tag` become `--suite selection --surfaces` (`scripts/test/cli.mjs:491-510`). The coordinator already accepts `--suite selection` with `--surfaces` (`blaxel-testshards.md:117-118`). A two-shard planned run of one surface needs the existing `--shards 2 --allow-shard-count-override 1`. |
| Deliberate fixture failures stay failed native results; the driver asserts expected outcomes and cleans up its coordinators and pool, reporting what it could not clean | `:151` | Same precedent as the `isolated-github-only` fixtures: registered surfaces that are never in `all`. |
| Blaxel's `Testing` section points at the placement | `blaxel-testshards.md:172` | Reference only. |

The delta is proportionate: four sentences in the registry, two paragraphs in the runner, one reference. It changes no lock, recovery, cleanup or diagnostic promise.

## The proof refinements

1. **Citation grades and the proxy.** Every assertion whose walk is being moved to the built application now carries the mixed form, "policy-grade test for the existing walk: …; built-application boundary: test to be written", and names the stable-front proxy as harness transport: the product theme assertions (`^theme-ac-selection`, `^theme-ac-executable-browser`, `^theme-ac-sandboxed-frames`, `^theme-ac-frame-appearance`, `^theme-ac-active-package`, `^theme-ac-appearance`), the delivery assertions (`^theme-delivery-t-active-package-refresh`, `^theme-delivery-t-frame-browser`, `^theme-delivery-t-frame-appearance-browser`), the demo-mode walks and the bridge's pointer and demo-inert assertions. The author found the frame, pointer and bridge assertions I had not listed; the reset walk and the already-built walks keep plain coverage, correctly.
2. **The guard seam** is now an ordinary repository test on Linux, needing no credentials (`proofs/arch/test-runner/blaxel-testshards.md:78`).
3. **The reporting hook** says it serves the local parent/child seam only and is not forwarded to workers (`reporting.md:22`). The worker-side selection commands are now in the spec and await the binding below.
4. **Launch cleanup** is folded into the real worker seam (`testing-policy.md:25`) and the standalone assertion is gone. The response is right that my premise was too narrow: the policy's cleanup section does say that cleanup of long-running modules is core to correctness, below its motion subsection. The consolidation still stands on its own merits, one fixture and one launch sequence fewer.
5. **Upload paths and the `temporary-cleanup` phase** are observed inside `^blaxel-t-retrieval` on the run that already happens.

## What is left: the binding

The Blaxel proof's coverage model still says the live tests are "an explicit paid-service selection" (`:15`), and the shared live declaration (`:84`) and `^reporting-t-resource-live` still name no surface, host or selection. The response records this as deliberately pending spec convergence and lists what it will add. For that follow-up to stay bounded, it should contain only:

- in the shared live declaration: the driver surface, the fixture surface, the coordinator host rule, and the two selection commands, with links to `^blaxel-harness-placement` and `^blaxel-harness-surfaces`;
- the coverage-model sentence replaced by one that says where the live tests live and that they are excluded from `all` and ordinary CI by kind;
- one contract in the registry or runner proof over the committed registry: `all` and `e2e-ci` resolve without either surface, the tag resolves to the fixture surface alone, and the driver's dispatched selections name only the fixture surface. That is a source-level contract, not a live run.

Within that scope I would not ask for another round. Anything beyond it, the owner judges under the bounded-refinement rule.

## Refinements (none blocking)

1. **The runner's `Selectors` paragraph should say what the new section relies on.** `test-runner.md:70` says narrower remote work uses "surface, file, or grep selection through the target path" and is silent on `--package`, `--runner` and `--tag`, which the code sends to the planned selection path. The placement paragraph depends on that path. One clause at `:70` makes the spec self-consistent instead of leaving the only statement of the planned-selection route inside a specialized section.
2. **`test-runner.md:92` now has a third opt-in placement it does not mention.** "The `telemetry-posthog-roundtrip` and `daemon-acceptance` suites are not broad verification" could add "and the Blaxel harness surfaces ([#Blaxel harness qualification](#Blaxel harness qualification))" so a reader of the guardrail section sees all three.
3. **Minimum shard shape for the planned fixture run.** The fixture surface must hold at least two files for `^blaxel-t-retrieval`'s two-shard run; worth one clause in the fixture surface's description so the first implementer does not discover it from a plan failure.

## Reviewer checklist

- **Authority and placement.** Surface declarations in the registry spec, execution placement in the runner spec, a reference from the provider spec. Nothing spec-shaped remains in the proofs once the binding lands.
- **Proof coverage, mocking and boundaries.** Unchanged from round 1 and still sound; the consolidated worker seam keeps its real crossing.
- **Citation grades.** Honest everywhere I looked.
- **References.** All new anchors resolve; indexes regenerated.
- **Size and simplicity.** No new kind, suite, hook or framework; the driver reuses canonical commands.

## Evidence and limits

- Read the full spec and proof diffs, the response's round 1 section, and the current Blaxel, reporting and testing-policy proofs; checked the placement claims against `cli.mjs` and the coordinator option table; confirmed the policy's cleanup sentence the response cites.
- Not established: whether a `local` run of the driver surface on the coordinator sandbox passes local preflight's capability checks as that sandbox is provisioned, which the first run will show.

## Housekeeping

- Read-only: no edits, commits or pushes; nothing run on this host or on Blaxel. `git fetch origin` updated remote-tracking refs.
- Primitive produced no output during this review, so I have nothing to report on its usefulness. The response records a Primitive decision (`dec_7893f958`) from the author's session; I have not seen it and do not assess it.

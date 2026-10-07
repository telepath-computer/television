# Overnight trim run: morning summary

Five areas of Television's specs were trimmed under the sharper spec policy, each by an Opus area owner with up to four rounds of review by Codex GPT-6 Astra. Each area is on its own branch, stacked on `thopter/spec-tightening` at `f6cdd91e`. Each area's review document is at `docs/working/spec-tightening/trims/<area>/review.md` on that area's branch, next to the raw reviews. No pull requests were opened.

## Results

| Area | Branch | Words before → after | Rounds | Decisions | Judgment calls | Link test |
|---|---|---|---|---|---|---|
| CLI | `thopter/trim-cli` | 15,622 → 13,488 (−14%) | 2, converged | 2 | 10 | passes |
| UI architecture | `thopter/trim-ui-arch` | 11,311 → 10,451 (−8%) | 2, converged | 3 | 16 | passes |
| Desktop | `thopter/trim-desktop` | 11,755 → 11,165 (−5%) | 2, converged | 2 | 8 | passes |
| Core model | `thopter/trim-core` | 11,527 → 10,586 (−8%) | 2, converged | 4 | 12 | passes |
| Updates and versioning | `thopter/trim-updates` | 18,476 → 16,368 (−11%) | 2, converged | 5 | 10 | passes |
| **Total** | | **68,691 → 62,058 (−10%)** | | **16** | **56** | |

Every area converged in two rounds. None hit the four-round limit, so there are no interrupted trajectories to report.

## What stands out

- **The cuts are much smaller than earlier estimates.** Readings of these areas before the policy was finished estimated 30–65% could go. The run removed 5–14%. There seem to be three reasons:
  - **"Unsure means keep" did a lot of work.** That was the intent.
  - **Several owners deferred to you questions the policy arguably answers.** The clearest cases are pinned internal TypeScript types, kept because each spec's ownership paragraph named them, which an owner read as a human decision. Examples are the CLI's test-interface types and build constants, and the overflow-fade helper's signature. If you rule these out, a second pass would cut more.
  - **These areas are contract-heavy.** The owners consistently reported that most of what remains is real contract with other versions, external services, or the people and agents who use the CLI.
- **Review caught real losses.** Round 1 found blocking problems in three areas, and each was fixed:
  - **CLI:** the dropped `set-theme none` exception, and the variables an ACP agent passes to the installed service.
  - **Desktop:** the dropped rule that the test URL must be on `127.0.0.1`.
  - **Updates and versioning:** three, including a contradiction between product and arch specs, and a missed link repoint.
- **Some reviews were quick.** Both core-model reviews took about four minutes, and the first was short. Depth may vary between areas.
- **One cut was made after review.** In desktop, after round 2 approved the trim, the owner cut a redundant testing paragraph in `arch/desktop/updates.md` that no reviewer has seen. Its review document says so.
- **The `## Testing` heading was handled inconsistently.** Core model kept `## Testing` because other specs cite it, and raised the rename as a decision. Updates and versioning renamed its headings to the policy's new heading and repointed 12 links. The other three areas left the heading as it was. This needs one decision before the branches merge.
- **The borrowed test dependencies were missing.** The `node_modules` path in the brief no longer existed, so each owner borrowed another copy to run the spec-link test. Vitest versions differed: 2.1.9, 4.1.5 and others.

## Decisions for you, all areas

Each decision is described fully, with its options and what the branch does now, in that area's `review.md`.

**Across areas**
- **`## Testing` headings:** rename them to the policy's new heading across the repo, or accept `## Testing` as a form. Core raised this; updates already renamed its own.
- **Block refs nothing cites:** sweep them after proofs are re-derived, or leave them. In core, 42 of 94 are uncited.
- **Ticket links as markers on known gaps** (core): allowed or not. The branch cuts them and keeps the limitations they marked.

**CLI**
1. Keep pinning the CLI's internal test-interface types (`CLIEnvironment` and related), or reduce them to the decision plus the one surface the publish workflow uses. The branch keeps them.
2. Keep the esbuild define values pinned. Only `__TV_TELEMETRY_BUILD__` has an outside party. The branch keeps them.

**UI architecture**
1. Should `conformance.md` keep describing conformance machinery that doesn't exist yet (TV-649), or keep only what holds today? The branch keeps it.
2. Keep the overflow-fade helper's pinned signature. The branch keeps it.
3. Is `lit-view.md`'s description in terms of lit-html internals deliberate? The branch keeps it.

**Desktop**
1. The first-release version constraint (1.4.0 and 1.4.1 test releases) is probably met and so is history. Remove it and fix the specs and proofs that cite it, or keep it. The branch keeps it.
2. A one-time requirement for macOS preflight evidence was cut as history. Nothing now says where that evidence comes from. Is a standing rule needed?

**Core model**
1. The caller-supplied channel id gap is wider than the spec says: a duplicate id silently replaces an existing channel. Accept it and state it, or close it.

**Updates and versioning**
1. **Toast while the channel is down:** the code keeps showing the last valid notice when the channel goes down, which the product spec contradicted. The branch rewords the product spec to match the code. Confirm, or decide that a failed poll clears the notice.
2. **`server-status` fields:** `type`, `version` and `requiredDesktopVersion` are read across releases in practice. Pin them as frozen, or accept the risk.
3. **The TV-684 paragraph:** keep the whole cutoff paragraph, or move its plan details to the ticket.
4. **The desktop app's update check:** "every ten minutes" is the vendor's default, not something Television sets. Keep it as a promise and set or state it, or drop the number.
5. **The staging runbook:** it depends on test hooks declared only in proofs. Promote them into the arch specs, or accept it.

## Spec and code mismatches found

These were reported, not fixed.

**CLI**
- Bind failures get a hint for every failed address, not only in the one case the spec names.
- The skills resolver checks paths in a different order from the spec's table.
- The publish workflow loads the built CLI as a module, which no spec names as a contract.

**UI architecture**
- Several views do not follow the documented `View` shape.
- A missing `localStorage` produces an uncaught exception and a styled empty page.

**Desktop**
- `RuntimeValidation` did not match the code; the trim removes it.
- A small step-order difference in the harness setup.

**Core model**
- A folder artifact saved without a trailing separator is never watched.
- Version-1 records migrate only when the server starts serving.
- Malformed records are skipped during migration instead of stopping boot.
- Navigating to an artifact's home keeps forward history.
- Routine state writes are not atomic.

**Updates and versioning:** five, listed in its review document.

## Suggested order for review

1. Settle the cross-area decisions, especially the `## Testing` heading, since the branches have to agree before merging.
2. Read the review documents in any order. Each lists its judgment calls with what the remaining text still lets a reader derive; check those claims against the diff.
3. Rule on the area decisions. Rulings that remove pinned internal types would justify a second, more thorough pass on CLI and UI architecture.

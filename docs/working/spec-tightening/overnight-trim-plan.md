# Overnight trim run: plan

A plan for agents to trim Television's specs under the sharper spec policy overnight, so that Josh can review the results the next day. Nothing in it has run yet. Scope, the tool that runs it, and whether governance specs are included are still to be decided.

## What the run does

The specs are divided into areas of related specs. For each area:

1. **A worker trims the area's specs** under `specs/spec-policy.md` as it stands on `thopter/spec-tightening`. It judges each statement on its own merits: a statement stays when a reader could not reasonably derive it from what is kept. The worker checks the specs' claims against the code, because a spec's description of a mechanism can be wrong.
2. **A reviewer from a different model family reviews the trim against the policy in both directions.** It asks whether the trim is missing something that belongs, and whether it cut a contract, a decision, an accepted limitation, or anything else that derivation needs.
3. **The worker addresses the findings.** Steps 2 and 3 repeat for up to four rounds. An area has converged when the reviewer's latest pass finds nothing blocking.

Each area works on its own branch, stacked on `thopter/spec-tightening` after that branch is brought up to date with `main`. Each trimmed spec is its own commit. No pull requests are opened.

## How the workers judge

- When unsure whether something belongs, keep it and say so in the review document. A missed cut can be made later; a wrong cut can silently lose a decision.
- Where conforming depends on a product or architecture decision, name the decision and leave the text as it is.
- Report mismatches between spec and code, and contracts the specs do not name. Do not fix them.
- Edit only the area's own specs. One exception: when a cited statement is cut and its content lives on elsewhere, the worker repoints the citation to the new owner. That edit may touch other specs, proofs or test comments, but only the link itself changes. When nothing replaces the content, the citation is left dangling and recorded.
- Proofs are not re-derived overnight. That happens after Josh accepts an area's trims.

Because of dangling citations, an area's branch may fail the spec-link test until its proofs are re-derived. The review document lists every expected failure; any other failure is a real problem.

## What the run produces

**The trimmed specs** on each area's branch are the result. The git diff is the complete record of what changed.

**A review document for each area** in `docs/working/spec-tightening/trims/` is a guide to that diff. It covers what needs Josh's attention and what a diff cannot show.

The shape below is the architect's initial idea of what such a document might contain. It is a suggestion, not a requirement. The architect cannot yet predict what an area's review will need to say. Each agent is expected to use its own judgment to structure its document so that it captures what is important.

- **Header:** the branch and commits, the specs covered, words before and after for each spec, and one line on convergence.
- **Decisions for Josh:** the question, where it arises, the options, and what the branch currently does.
- **Did not converge** (only when that happened):
  - the round-by-round trajectory: findings raised, addressed, disputed and new in each round;
  - what kind of trajectory it was: narrowing, persistent disagreement or churn;
  - each open finding, with the reviewer's and the worker's positions side by side.
- **Judgment calls in the diff:** cuts where a reasonable person could disagree. For each: where it is, what was cut, the reason under the policy, and what the remaining text still lets a reader derive. If the reviewer disputed it, its view too.
- **Kept but doubtful:** statements left in that may be over-specified, with why they were kept.
- **Routine cuts:** one bullet per cut, grouped by kind. Each bullet gives where it is, what was cut, and where its content still lives or how it is derived.
- **Findings that aren't edits:** mismatches between spec and code, with the code location as evidence, and contracts the specs do not name.
- **Effects:**
  - stale proof sections;
  - citations repointed, from where to where;
  - citations left dangling;
  - the spec-link test result, with the expected failures listed.

**A morning summary** sits above the area documents:
- one row per area: words before and after, convergence status, and the count of decisions and of judgment calls;
- areas that did not converge listed first;
- all decisions gathered into one list.

## Still to decide

- **Scope:** all product and architecture areas, or a first batch. The suggested first batch is the test runner, telemetry, artifact frame, updates and the CLI.
- **The tool that runs it:** a Workflow script, Control Plane, or a herdr supervisor with workers.
- **Governance specs:** whether they go through the filter in this run, before the policy itself has merged.

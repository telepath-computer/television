# Vibe waiver template and notices

For the principal agent entering vibe mode under the [contribution skill](../SKILL.md). Write the waiver below to `specs/vibe-waiver.md` on the vibe branch, replacing the angle-bracket placeholders. Then insert the notices immediately after the top-level heading of `AGENTS.md` and of `specs/spec-workflow.md`. Commit all three as the branch's first commit. Update the waiver's rigor section when the human changes their choice.

## Waiver

```markdown
*This branch is in vibe mode: the spec-driven contribution process is switched off here so the team can build and learn from an experiment quickly. The branch is never merged into `main`.*

# Vibe waiver

**Status:** active on this branch. **Base:** `<branch or commit this vibe branch started from>`.

On this branch the spec-driven contribution process is switched off, and working code is what matters. Specs, proofs, and tests are context, not authority: read them to work faster, and edit them freely with no obligations attached. None of the following are required unless the human asks for them:

- the spec-first sequence, spec deltas, the spec gate, and human spec ownership for edits made on the branch;
- proofs and proof convergence;
- red/green TDD and proof-derived tests;
- planning and slices;
- independent review and convergence;
- the full verification gate or a green CI run;
- PR preparation for human review.

## Rigor chosen for this branch

**Chosen:** <code only, tested code, full derivation without gates, or whatever the human named>. Work in the order it implies, and report what was exercised and what was not.

- **Code only:** direct edits judged by running the result. Maximum expediency for a small experiment.
- **Tested code:** red/green tests around the code, without specs or proofs. Fewer defects, because a failing test states the intended behavior independently of the code.
- **Full derivation without gates:** specs, proofs, a plan if needed, tests, then code, with no spec gate, independent review, or verification gate. For complex work that needs multi-stage planning and goes faster without the review gates.

## The one rule

A vibe branch is never merged into `main`. Vibe-coded work does not belong in production. Whether it may land anywhere else is a human judgment made at merge review, as it is for any branch. Human review at merge is the protection. `npm run verify` and CI always fail on this branch by design. Verify still runs everything first: lint, type-check, and the full suite execute and report normally, and the vibe-mode check fails last, after them, whenever this file exists. In CI the vibe-mode job fails and the required join with it, while every other job still reports its own result. Targeted test commands are untouched, so red/green work and any other rigor chosen above proceed as usual; only the two gates fail closed.

When something here turns out to be worth shipping, it becomes an ordinary contribution under the workflow, with this branch as reference material.
```

## Notice for `AGENTS.md`

```markdown
> **This is a vibe branch.** It has been switched to vibe mode; see [the vibe waiver](specs/vibe-waiver.md) for what that means. The rules and ceremony of the spec-driven workflow are optional here. The user has chosen to prioritize rapid experimental code changes, bypassing any or all of the workflow according to their preferences, so specs, proofs, and tests may have drifted from the code.
```

## Notice for `specs/spec-workflow.md`

```markdown
> **This branch has been switched to vibe mode.** See [the vibe waiver](vibe-waiver.md) for what that means. The rules and ceremony outlined in this workflow are entirely optional here. The user has chosen to prioritize rapid experimental code changes, bypassing any or all of the workflow according to their preferences, so specs, proofs, and tests may have drifted from the code.
```

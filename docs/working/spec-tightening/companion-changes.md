# Companion changes for the sharper spec policy

The draft in `sharper-spec-policy.md` needs edits to other documents. This file lists them so the proposal can be reviewed as one change. Nothing here has been applied.

## 1. `specs/spec-workflow.md`: take over the review rules

The sharper spec policy keeps only the principle that every spec statement is owned by a human and backed by human review. The rules for when and how that review happens move into the workflow.

### Text to move in

Add a section, proposed heading `## Human review`, after "Pull requests and human revisions". It carries the following, moved from the current `spec-policy.md` with their anchors so that citations can follow:

- **The shared-branch spec-review rule** (from "Slop-free zone", the paragraph anchored `^shared-branch-spec-review`). It covers:
  - Before a pull request carrying spec deltas merges into a shared branch, a human reads every spec delta, understands it, and stands behind it.
  - The review may happen before implementation or on the pull request that first carries the deltas into a shared branch, but must be complete before that pull request merges.
  - A later promotion of an integration branch does not defer it.
  - An agent reviews spec changes for consistency and correctness regardless of who wrote them.
  - The contribution owner may self-merge after human review, with no requirement for another person's approval or a GitHub review object.
- **How an exemption from human line review is declared** (from "Slop-free zone", the second paragraph). The policy keeps the principle that an architect may exempt a spec. The workflow says how review then proceeds for it.
- **Human PR review** (the whole current section, anchor `human-pr-review`): the confirmation that every spec delta is acceptable, and the human's scan of the footprint of code and test changes with its red flags.

### Text to change in place

- `spec-workflow.md:240` reads "Human review follows [spec policy's shared-branch spec-review rule](spec-policy.md#^shared-branch-spec-review) and [minimum PR review](spec-policy.md#human-pr-review)". It becomes a reference to the new local section.
- `spec-workflow.md:8` shows the cascade as `spec prose (and testing directives) → proofs → real tests → real code`. It follows whatever name the testing-directives section takes in `spec-proofs.md` (item 3).
- `spec-workflow.md:44` ("including their testing directives") and `:97` ("Honor testing directives") follow the same rename.

Citations of `spec-policy.md#Slop-free zone` at `spec-workflow.md:25`, `:29` and `:46` stay valid, because the policy keeps that heading. Read in context they point at "the review required by spec policy", so they may read better pointing at the new workflow section.

## 2. Citations elsewhere that follow the moved anchors

- `developer-skills/tvdev-contribute/SKILL.md:26` cites `spec-policy.md#^shared-branch-spec-review`. It moves to the workflow anchor.
- `AGENTS.md:25` cites `spec-policy.md#Slop-free zone` for ownership rules. That heading is kept.

The sharper spec policy keeps these anchors and headings, so their citations need no change:
- `^runbook-type`
- `^explainer-type`
- `^limitations-are-the-exception`
- `^implementation-notes`
- "Specific specs may state exceptions"
- "Authoring guidance", now a subsection

## 3. `specs/spec-proofs.md`: the renamed section

"Testing directives" (anchors `^testing-directives` and `^testing-directive-standing`) defines the `## Testing` section a spec may carry. It changes to name the heading `## Inputs to proof derivation that the spec does not otherwise show` and its subsections, as stated in the sharper spec policy. The rule that a directive shapes test design and orders no assertion of its own (`^testing-directive-standing`) stays.

Add what kinds of assertion each kind of spec's proof carries, which the current `spec-policy.md` states and the sharper spec policy leaves to `spec-proofs.md`:
- A product spec's proof carries the acceptance assertions that establish its measures of acceptance.
- An architecture spec's proof carries contract, seam and acceptance assertions, in whatever form fits: end-to-end, integration or unit-level.
- Acceptance-style behaviour tests generally run as full, non-mocked end-to-end tests, but no kind of spec is bound to a particular test tier.

The same rename reaches the developer skills that use the phrase "testing directives":
- `developer-skills/tvdev-contribute/SKILL.md:34`
- `developer-skills/tvdev-review/SKILL.md:18`

## 4. `specs/arch/testing-policy.md`

- Remove the paragraph anchored `^ui-no-manual-checklists`, with nothing in its place (hard case 26). Nothing cites that anchor.
- Line 34 says coverage and test honesty "are judged by reviewers (human and agent)". Proofs are agent-owned, so this becomes judged by agent reviewers, matching the sharper spec policy's authority cascade.

## 5. Existing specs

The `## Testing` sections in existing specs are renamed and cut down when each spec is trimmed under the sharper spec policy. They are not part of this change.

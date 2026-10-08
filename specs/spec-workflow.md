*The authority chain and the spec-first workflow that keeps specs the source of truth.*

# Spec Workflow

## Authority and derivation

```
spec  →  proofs  →  real tests  →  real code
```

Specs are the highest authority for the requirements they state. Derivation proceeds from specs to proofs, tests, and code: each stage follows the requirements established above it. Discoveries travel back through that chain. When proof design, testing, or implementation reveals an ambiguity or a needed change to a requirement, resolve it in the owning spec under human ownership, then update the downstream work. Code must follow the spec wherever it states a requirement. Outside specified requirements, code remains authoritative under [spec-migration.md](spec-migration.md). Specifying one requirement does not require adopting the rest of a module.

## Human intent and agent judgment

A contribution may start with a rough request, detailed spec edits, or design aids. The human and agent clarify the desired result and unresolved decisions. The agent may draft specs, or the human may edit them directly. An agent reviews the deltas in either case.

Agents proceed autonomously on details derivable from the authorized intent and governing specs. When choosing between materially different product or architectural intentions, ask the human. Continue only work that does not depend on the decision; pause when it blocks the derivation chain. Proof authoring is a useful detector of incomplete intent: if the expected result cannot be determined, explain the ambiguity and resolve it in the spec rather than inventing an assertion.

## Feature workflow

### Recommended approach

For changes expressed through prose and conceptual decisions, the human and agent develop a proposal. Independent agent review of the proposal is optional when it would help settle the design. Once the human approves the proposal, an agent applies it to the owning specs. For design work, the human can work directly in the UI specs, using them as the working surface for decisions.

In both cases the spec deltas then pass the *spec gate*, which begins the autonomous phase. To pass it, every spec delta has converged under independent agent review, and the [human review](#human-review) is complete unless the human chose to finish it before the pull request that first carries the deltas into a shared branch merges. The human stands behind the intended result. The reviewer assesses the affected spec tree for coherence, consistency, and implementability, including consequential edge cases and interactions with the rest of the system, against the existing spec standard: sufficiently clear to produce predictable behavior across reasonable implementation interpretations, as stated in the [reviewer checklist](reviewer-checklist.md). That standard leaves room for implementer judgment. The autonomous phase begins with proof derivation and convergence.

After the spec gate, agents derive and independently converge the proofs, then a plan when the slice count is not clear. They implement and converge each slice, converge a final review of the integrated result when there is more than one slice, and prepare the PR for human review. Proof derivation and independent approval are required in every form of the process; they have no human approval gate. The [proof policy](spec-proofs.md) determines the proof obligations of the affected specs.

Proposals record intent; their decisions flow into the authoritative specs. A proposal is a working document under [spec-docs.md](spec-docs.md); pre-merge docs prep decides whether it is archived. Human review before merge follows [Human review](#human-review).

### Shortening the chain

The human can choose an earlier handoff. They may hand over an approved proposal and leave its conversion to specs and spec review to agents, deferring human spec review until the pull request that first carries the deltas into a shared branch. For a small change they are confident agents can handle, they may hand over a verbal instruction, without preparing a proposal or spec delta themselves. Before deriving proofs, agents still derive any necessary spec edits and pass the spec gate. The human's review remains due before that pull request merges.

Skip the plan when the work is clearly one slice, and converge the implementation as the whole result. That convergence includes the holistic review and full verification obligations; a separate final review is unnecessary. When the slice count is not clear, derive and converge a plan. Planning may conclude that one slice suffices; the work then proceeds as unplanned work, with the plan's validation criteria carried into that single convergence. Work with more than one slice converges each slice and then the integrated result.

These choices shorten preparation or combine implementation stages. Independent approval of spec deltas and proofs remains required, as does human review before the first shared-branch merge. Discoveries requiring product or architectural decisions return to the human under the intent guidance above.

### Spec-first change

Follow this spec-first sequence for every change, with proof derivation and red/green TDD as the default for all work:

1. Decide whether it changes user-facing behavior, an implementation contract, or both.
2. If behavior changes, update the owning product specs first, including any [testing guidance](spec-proofs.md#^testing-guidance) they need.
3. Update the arch specs that own the affected contracts or modules, and any testing guidance they need.
4. Pass the *spec gate* ([Recommended approach](#recommended-approach)): every spec delta has converged under independent agent review, and the [human review](#human-review) is complete unless the human chose to finish it before the pull request that first carries the deltas into a shared branch merges.
5. Derive or update the proof for every touched spec. An ambiguity in a spec is a finding for the spec, never a choice the proof makes.
6. When the slice count is not clear, derive and independently converge a plan from the specs and proofs under [Planning and slices](#planning-and-slices). A plan may settle on one slice.
7. For each planned slice, or once for one-slice work, follow red/green TDD: write the failing tests, citing their proof assertions where useful, then implement until they pass under [test iteration discipline](arch/testing-policy.md#Test iteration discipline). Converge each implementation under [Independent review and convergence](#independent-review-and-convergence).
8. When the plan has more than one slice, converge the integrated result: specs, proofs, tests, and code agree, every obligation and temporary failing-test baseline is resolved, and the full verification gate passes.
9. Push learnings upward: changed promises and ambiguities into specs, changed proof design into proofs.

Test obligations follow the affected specs and [testing policy](arch/testing-policy.md); change size does not exempt work from this sequence.

### Iteration is a cycle

Spec-first does not mean spec-complete-first. A spec, the implementation it drives, and the *back pressure* that implementation generates (see [spec-policy.md](spec-policy.md)) form a loop, not a one-way street:

```
spec  →  implementation + tests  →  learnings (back pressure)  →  spec  →  …
```

A best-effort spec captures our current understanding; building against it surfaces unforeseen problems and decisions; those learnings flow back up and sharpen the spec; the next pass builds on the sharper spec. The "spec-first change" steps above are one turn of this loop — real work usually goes around several times before an area settles.

What keeps the loop honest is back pressure's own discipline: every turn ends with the learnings landed in the spec, so the spec stays authoritative and complete — never code or tests quietly carrying behavior the spec should own. A loop that leaves the spec behind is how authority rots.

### Build sequence

The conditionals show the shortening choices above. Each `converge` call uses [Independent review and convergence](#independent-review-and-convergence).

```python
def build(feature):
  # Recommended: proposal or direct design edits, then human spec review.
  # The human may instead hand off a proposal or a small verbal request early.
  if human_edits_specs_directly:
    human.and_agent.develop_spec_edits(feature)
  else:
    if use_proposal:
      human.and_agent.develop_proposal(feature)
      if proposal_review_warranted:
        converge("Review and refine the proposal with the human")
      human.approve_proposal(feature)
    else:
      human.give_instruction(feature)
    agent1.task("Derive the necessary spec edits from the agreed intent")

  # Spec gate: agent convergence always; human review follows spec policy and
  # may wait until the pull request that first carries the deltas into a shared branch.
  # The autonomous phase starts after it.
  converge("Make the spec deltas coherent, consistent, and implementable")
  if not human_chooses_early_handoff:
    human.complete_required_spec_review(feature)
  # Revisions return through affected work and review; approvals cover the result.

  # Autonomous derivation: proofs are always derived and independently approved.
  converge("""
    Derive or update proofs from the approved specs. Honor the specs' testing guidance,
    use the cheapest honest coverage, declare mocks and forfeits,
    and return ambiguous expected behavior to the owning spec.
  """)

  # Plan only when the slice count is not clear. Planning may settle on one
  # slice; its validation criteria then feed the single convergence below.
  plan = None
  if not clearly_one_slice:
    converge("""
      Derive a plan from the specs and proofs, with coherent implementation
      slices and validation criteria. Use red/green TDD. Assign any temporary
      failing-test baseline to a later healing slice; the final result is green.
    """)
    plan = reviewed_plan

  if plan and len(plan.slices) > 1:
    for slice in plan.slices:
      converge("Implement slice {slice} with its proof-derived tests using red/green TDD")
    converge("""
      Complete and review the integrated result: specs, proofs, tests, and code
      agree, all obligations are fulfilled, and the full verification gate passes.
    """)
  else:
    converge("""
      Implement and review the whole change using red/green TDD and proof-derived
      tests. Fulfill all obligations, reconcile specs, proofs, tests, and code,
      and pass the full verification gate.
    """)

  agent1.task("Prepare or update the PR under PR-writing guidance")
  human.task("Complete the review required by spec policy and scan the code/test impact before the pull request into the first shared branch merges")
  # Human revisions return through the affected derivation and convergence.
  # Docs prep follows completion of the work, independently of when human
  # spec review occurs; draft PRs retain their working documents.
  agent1.task("Run pre-merge docs prep before treating the completed contribution as ready to merge into a shared branch")
  # The owner may self-merge after human review and verification.
```

## Planning and slices

A *slice* is a coherent unit of implementation that one agent can complete and another can review as a whole. Work that is clearly one slice skips planning and combines implementation with integrated-result convergence. When the slice count is not clear, a reviewed plan is derived from the specs and proofs before implementation; a plan that settles on one slice returns the work to that single convergence. The conditions in `build` express that judgment and the human's chosen handoff.

Each slice states its verification criteria and expected test baseline. A non-final slice may leave functionality incomplete or tests failing when necessary, provided the plan explicitly records that baseline and assigns its resolution to later slices. Review assesses the slice against those stated obligations; intermediate slices need not preserve full application functionality or a fully green suite. The final slice resolves every temporary baseline, delivers the complete functionality, and leaves the suite green. The integrated result must pass the full verification gate before merge under [testing policy](arch/testing-policy.md#Verification provider and completion).

### Slice count guidance

Derive slices as substantive, logically grouped phases of the work. A task checklist identifies work to cover; it does not determine slice boundaries. Keep changes and their tests together when they need to be understood together, including across modules or application layers.

Each slice adds a slow, expensive convergence cycle, favoring consolidation. Too many moving targets can overwhelm implementer and reviewer reasoning or exceed an agent's context window, leading to missed interactions and defects. During plan convergence, split where focused reasoning warrants the cost; combine where it remains manageable.

Small fixes and isolated features normally fit one slice. Adding a persistent channel property across disk storage and CLI commands, client-server state and API, and a UI affordance might take three. Slightly changing an established property's shape might take one or two because the surrounding mechanisms already exist. These examples are guides, not fixed counts.

More than roughly ten slices should be exceptional in routine development and prompt scrutiny for unnecessary fragmentation. Television's 80-slice UX redesign followed weeks of specification for replacing hundreds of thousands of lines and supporting full-stack changes.

## Independent review and convergence

Convergence applies to specs, proofs, a plan when needed, each implementation stage, and the integrated result. Optional proposal review uses the same routine. One agent owns the work; another independently reviews the whole current result against the applicable intent and specs. A blocking finding causes another iteration. PASS handling follows the bounded refinement rule below.

### Reviewer independence

Reviews run in a separate agent context using the highest-quality model at extra-high (`xhigh`) reasoning effort. `xhigh` (X H I G H) is an exact value that must be preserved. Every compaction must preserve the exact letters X H I G H (`xhigh`), including compaction of an already compacted summary and every subsequent compaction, without rounding it up to `max`, “maximum effort,” or any other inaccurate value. The recommended arrangement is to implement with one model and review with a state-of-the-art model from a different provider; when the harness cannot reach an alternative model, the best available model still reviews. This is guidance, not a checked rule. The agent tools must support that independent context, whether through subagents, another agent’s CLI, or a multi-agent workflow. A second pass in the implementer’s own context does not establish independent review. Report the actual reviewer setup and any unmet requirement honestly.

### Blocker judgment

PASS means no blockers, where “blocker” is left to agent judgment.

Set the bar with the mentality of a senior engineer, responsible for both direct requirements and indirect ones: overall success and integrity of the system. A senior asks, “Does allowing this into the system create a state, contract, or precedent that we should not permit?” Thinking through the consequences can raise an issue to blocker status or make it less important than it initially sounds.

For example, incoherence or conflicting contracts in specs, comments, or test assertions may seem inconsequential because users cannot see them. A senior engineer recognizes the erroneous assumptions they can produce later and the precedent that tolerated defects set for further deterioration. Conversely, an O(n²) function might be flagged as bad on principle, while closer examination shows that n is reliably small and the code only needs a comment explaining that constraint.

Use *high* standards for quality and *impeccable* standards for assessing consequences and severity.

### Findings and bounded refinement

Always return the full review to the implementer, including a PASS. Findings are arguments to assess against intent, specs, and the whole result. The implementer chooses worthwhile refinements, with diminishing appetite for polish after earlier hardening. Refinements after the very first review being PASS receive one follow-up review; refinements after a later PASS do not automatically trigger another review. Request another review when changes materially depart from what was reviewed or raise a correctness concern. A PASS should normally conclude review rather than generate an endless sequence of elective improvements.

### Stalled convergence

If convergence appears stuck, involve the human. Around five rounds is a useful point to assess progress, not an automatic escalation threshold; stuck work may need help sooner.

### Convergence sequence

```python
def converge(task):
  agent1.task("Read the authoritative specs and work spec-first. {task}")

  iteration = 0
  while true:
    iteration += 1

    # Review works in layers like an onion. Cognitive limits mean a reviewer
    # cannot be expected to find every issue in one pass; clearing larger
    # issues makes subtler ones visible in the next whole-result review.
    review = agent2.task("""
      Independently read the authoritative specs and policies.
      Review agent1's entire current result for {task}.
      Report all findings, prioritized, identify which are blocking,
      and give a binary PASS/FAIL verdict. PASS means no blocking defects remain.
    """)

    if review.pass:
      # Consider the full report and apply worthwhile refinements.
      refinements = agent1.consider(review)
      if refinements.changed and (iteration == 1 or refinements.need_review):
        continue
      return done

    # Around five rounds is a useful point to assess progress, not an
    # automatic escalation threshold. Stuck work may need help sooner.
    if convergence_appears_stuck(review_history):
      check_in_with_human(review_history)

    # Remediate warranted findings after FAIL, then review the whole result.
    # Findings are signal, not authority: agent1 uses judgment when integrating
    # them rather than applying them mechanically.
    agent1.task("""
      Consider the entire findings set in {review.findings} for {task}.
      Independently verify each finding against the specs and current work,
      and remediate it where warranted.
    """)
```

## External contributions

Television does not currently accept external pull requests. Forking, building and modifying Television under its [license](../LICENSE) is welcome. The project plans to open contributions through its spec-driven process later. People interested in contributing are invited to join the project’s Discord to chat. The root `CONTRIBUTORS.md` communicates this policy to prospective contributors.

## Pull requests and human revisions

This section owns pull-request timing and the shared-branch workflow. Shared branches are `main` and every branch under `integration/`, at any depth; `integration/desktop/refresh` is inside the namespace, while `feature/integration/desktop` is outside it. ^shared-branch-workflow

Developers work on their own development branches. These branches may be unfinished or failing, and commits, pushes, and draft pull requests may be used as checkpoints. Draft pull request CI starts only when the pull request is marked ready for review.

When a developer wants to contribute that work to a shared branch:

1. Finish the work. Before full validation, update the development branch so its head contains every commit currently in the target, then commit and push that head. If this update merges the target or rebases the development branch onto it, follow [logical-merging guidance](../developer-skills/logical-merging/SKILL.md): reconcile both histories' policies and intent across the entire resulting tree, including changes Git does not report as conflicts. Only validation of the up-to-date tree counts toward the merge because that tree reflects the result being integrated.
2. Open a pull request from it as ready for review, or mark an existing draft ready. Full validation for the pushed tree may come from `npm run verify` before this step, from the ready pull request's GitHub CI, or from both. A qualifying Blaxel verify or the complete GitHub CI run can publish a [tree attestation](arch/test-runner/attestation.md); GitHub CI may reuse a valid attestation instead of repeating heavy tests, while every required check still reports.
3. Merge only after the human review below is complete and all required GitHub checks pass. If the target moves, update the development branch so it contains the new target head, then validate the resulting tree again; earlier test and CI results no longer count.

A GitHub ruleset machine-enforces the pull-request, required-check, and strict up-to-date requirements for `main` and branches under `integration/`.

The shared branch takes the change only at that merge. When CI on a shared branch is red, corrective or revert work lands before other changes. Pull requests to other branches may open before full verification, but every integrated result must pass the full gate before merge.

Human review follows [Human review](#human-review). When work is staged through an integration branch, the pull request into that branch is the pull request governed by the spec-review rule. Agent review and verification do not replace this human responsibility.

Once the work is complete, perform [pre-merge docs prep](spec-docs.md#^pre-pr-docs-prep) before treating the contribution as ready to merge into a shared branch, leaving `docs/working/` empty. Work-in-progress and draft PRs retain working documents, including during human spec review.

Use [PR-writing](../developer-skills/pr-writing/SKILL.md) guidance to explain the final change against the PR's actual base, its impact, and the validation performed. A review request may revise the intended outcome; carry that decision through the affected specs, proofs, tests, and implementation, and review and validate the changed result. Revisions remain subject to the same review policy. Respect the scope authorized by the human throughout.

## Human review

[Spec policy](spec-policy.md#Slop-free zone) requires every spec statement to be owned by a human and backed by human review. This section governs how and when that review happens.

Before a pull request carrying spec deltas merges into a [shared branch](#^shared-branch-workflow), a human reads every spec delta, understands it, and stands behind it as correct and intentional. That review may happen before implementation or on the pull request that first carries the deltas into a shared branch, but it must be complete before that pull request merges. A later pull request that promotes an integration branch to another shared branch does not defer the review: unapproved spec content never enters a shared branch. Human ownership does not require early approval. An agent reviews spec changes for consistency and correctness regardless of who authored them. The contribution owner may self-merge after human review; this workflow does not require another person’s approval or a GitHub review object. ^shared-branch-spec-review

A spec that an architect has exempted from human line review declares that decision in its own header and names the review model that applies ([spec policy](spec-policy.md#Specific specs may state exceptions)). That review model takes the place of the human line review for that spec.

### Human PR review

Human PR review is the final check that the contribution expresses the intended product and stays within its expected scope. At a minimum, the human confirms that every spec delta is fully acceptable: read, understood, correct, intentional, and something they stand behind under spec policy's ownership rules. Independent agent review supports this responsibility but cannot replace it, except for a spec exempted as above.

The human also scans the footprint of the code and test changes for disproportionate or unexpected impact. Red flags include scope expansion, new dependencies, substantial new machinery in production code or test harnesses, and changes to files or behaviors whose connection to the task is unclear. These warrant explanation and scrutiny before approval; their significance depends on the intended change.

This scan does not require line-by-line human review of all code and tests. It asks whether the implementation's scope and complexity are proportionate and explainable. Agents remain responsible for detailed correctness, coverage, and verification. Humans may inspect or test the result further as appropriate.

## Reviews maintain authority

Coverage, clarity, and ownership are checked by review — human and agent — not by tooling. A reviewer reads the spec and the change together and asks the questions in [reviewer-checklist.md](reviewer-checklist.md).

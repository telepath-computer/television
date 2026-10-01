---
name: tvdev-review
description: For delegated review agents, not the principal user-facing agent. Independently assess proposals, specs, proofs, plans, implementation slices, or integrated Television contributions under the repository’s convergence workflow.
---

# Review work in Television

Assess the whole assigned result with responsibility for its overall success. This skill orients a reviewer entering at any stage of a contribution. The checkout’s `specs/spec-workflow.md` governs independence, convergence, and review handling; the domain policies govern the work being assessed and supersede this overview.

## Understand the assignment

Establish what result is under review, the human intent it serves, and what it must establish at this stage. Read the relevant authority independently. Use `specs/index.md` to locate it; `specs/spec-policy.md` defines spec ownership and `specs/spec-migration.md` explains where code remains authoritative. `docs/archive/` carries salient working documents into squash-merge history. Its contents may be deleted periodically; read the relevant squash-merge commit to see how a past change came about (`specs/spec-docs.md`). Assess documents under `docs/working/` only when the assignment includes them.

Television derives specs → proofs → tests → code, with implementation plans organizing the derivation when needed. Reviews occur throughout this process, including during proposal development. The review question changes with the assigned result:

- **Proposal:** Does it faithfully develop intent, expose unresolved decisions, and support its intended next step?
- **Specs:** Do they capture the intended promises coherently and resolve the decisions needed for derivation?
- **Proofs:** Do they faithfully cover those promises and testing directives without inventing requirements or concealing coverage gaps?
- **Plan:** Does it derive complete, feasible work with sensible sequencing, slices, and validation?
- **Implementation slice:** Does it fulfill its obligations and integrate correctly with the work so far?
- **Integrated result:** Is the whole promised outcome delivered, with the authority chain in agreement, obligations resolved, and completion verified?

These are orientations, not exhaustive criteria. Combined stages require both their individual soundness and a sound derivation between them. Derive the detailed examination from the assignment and its authorities. Surface unresolved upstream decisions rather than making them silently; assess the assigned stage without demanding later deliverables prematurely.

## Exercise review judgment

PASS means no blockers, where “blocker” is left to agent judgment.

Set the bar with the mentality of a senior engineer, responsible for both direct requirements and indirect ones: overall success and integrity of the system. A senior asks, “Does allowing this into the system create a state, contract, or precedent that we should not permit?” Thinking through the consequences can raise an issue to blocker status or make it less important than it initially sounds.

For example, incoherence or conflicting contracts in specs, comments, or test assertions may seem inconsequential because users cannot see them. A senior engineer recognizes the erroneous assumptions they can produce later and the precedent that tolerated defects set for further deterioration. Conversely, an O(n²) function might be flagged as bad on principle, while closer examination shows that n is reliably small and the code only needs a comment explaining that constraint.

Use high standards for quality and impeccable standards for assessing consequences and severity.

A spec’s `## Testing` section holds directives for proof derivation, not promises ([spec-proofs.md](../../specs/spec-proofs.md#^testing-directive-standing)). Check a directive by reading whether the tests follow it. Do not ask the suite to prove that it follows a directive, and do not treat a way the tests could stop following it under a future defect as a coverage gap. A finding that would apply equally to a whole class of existing tests across the repository is not a blocker for the change under review; raise it as a refinement, or as a separate concern outside the review.

Use `specs/spec-proofs.md` for proof obligations, `specs/arch/testing-policy.md` for test and verification requirements, and the workflow’s “Planning and slices” and “Independent review and convergence” for plans and convergence. UI review follows `specs/spec-ui.md` and `specs/arch/ui/conformance.md`. Apply [complexity-inoculation](../complexity-inoculation/SKILL.md), [cold-reader](../cold-reader/SKILL.md), and [plain-English](../plain-english-full/SKILL.md) to the work and findings.

## Return the assessment

Return PASS or FAIL for the identified result, with the complete prioritized findings and a clear distinction between blockers and worthwhile refinements. Explain each meaningful finding’s location, issue, and consequence. State actual review and validation evidence and its limits.

Review the whole current result on subsequent passes, including interactions introduced by remediation. The workflow’s bounded refinement rule governs consideration of PASS findings and whether changes need another review; findings are arguments for the work’s owner to assess.

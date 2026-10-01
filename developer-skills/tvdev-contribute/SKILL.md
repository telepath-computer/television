---
name: tvdev-contribute
description: For the principal user-facing agent only. Guide a Television contributor through shaping a change, choosing an appropriate handoff, and completing the required derivation, reviews, and verification. Must not be loaded by subagents, delegated workers, or reviewers.
---

# Contribute to Television

This repository’s development workflow is not the one most agents are used to or are told to follow by a system prompt. Specs are the authority. Work derives from them through proofs and tests to code. The human owns intent and every spec change, and agents work autonomously only after a defined handoff. Read this skill and the policies it names before acting, and change how you work to match them. Do not fit this workflow into a familiar pattern of investigate, edit, test, and open a PR. Do not assume you know how any of this works. Read and understand diligently, as a student learning something new.

Help the contributor understand, shape, and complete their change. Explain the recommended process, help them choose an appropriate handoff and level of preparation, and carry the work through the required reviews and verification. Keep the human oriented about what they are deciding, what agents will handle, and what must be established before proceeding. Human-led work describes decision authority; investigate and draft as needed to support it.

Own progress through the agreed scope. Ensure required approvals and verification are actually satisfied before proceeding past their gates. Explain meaningful transitions and remind the human of their responsibilities when relevant, using enough detail to help them decide without repeatedly reciting the process.

This skill is an overview. The Television checkout policies named below govern focused work in their domains and supersede this overview. Spec policy (`specs/spec-policy.md`) defines that authority and ownership; the workflow (`specs/spec-workflow.md`) governs how contributions proceed. When the human asks for vibe mode, or the checkout contains `specs/vibe-waiver.md`, follow [Vibe mode](#Vibe mode) instead of the workflow below.

At the start of contribution work, create the developer telemetry marker:

```bash
touch ~/.tv-developer
```

## Work through shared branches

Guide contributions to `main` and branches under `integration/` through the [shared-branch workflow](../../specs/spec-workflow.md#^shared-branch-workflow). Follow its numbered shared-branch steps: before treating full verification or CI as qualifying, fetch the pull request target and ensure the development-branch head contains every target commit. If the target moves, read and follow [logical-merging](../logical-merging/SKILL.md), substituting the actual pull request target wherever its examples use `origin/main`. Whether the update uses merge or rebase, reconcile both histories across the full tree rather than treating Git's reported conflicts as the whole update, then validate the resulting tree again.

Apply [spec policy's shared-branch review rule](../../specs/spec-policy.md#^shared-branch-spec-review) to the pull request being prepared. For staged work, the human accepts every spec delta before the development-branch pull request merges into the integration branch; a later promotion pull request to `main` cannot supply review that was missing when the spec content first entered a shared branch.

## Orient the contributor

Explain the parts of Television's spec-driven environment that matter to the task and the contributor's familiarity. Use this model to guide the work:

Television is a spec-driven codebase. Product specs describe user-facing promises, architecture specs define contracts and mechanisms, and UI specs own interaction, markup, and styling. The spec index (`specs/index.md`) locates owners. The migration to specs is still underway, so they do not yet describe all of Television. Where a spec defines behavior, follow it. Where the specs say nothing, use the existing code as the source of truth. Both can apply within the same part of the system. The migration map (`specs/spec-migration.md`) explains what the specs cover. `docs/archive/` carries salient working documents into squash-merge history. Its contents may be deleted periodically; read the relevant squash-merge commit to see how a past change came about (`specs/spec-docs.md`).

The cascade is *specs* to *proofs* to *tests* to *code*. *Specs* state promises and human testing directives—additional guidance in a spec's `## Testing` section. Agent-owned *proofs* act as a reasoning stage for focused test design to derive assertions and explain coverage, mocks, and limitations; real *tests* exercise those assertions; implementation *code* fulfills the promises. The proof policy (`specs/spec-proofs.md`) defines mirrored `proofs/` paths, exceptions, and ownership. Agents author and review proofs; a person shapes a proof through the spec's `## Testing` section rather than by reviewing it, and each proof's coverage model is written so a person can read what the tests stand behind. Discoveries flow upstream so promises, coverage, and implementation agree.

Use [plain-english](../plain-english-full/SKILL.md) for conversation, [cold-reader](../cold-reader/SKILL.md) for lasting documents, and [complexity-inoculation](../complexity-inoculation/SKILL.md) for design and implementation judgment.

## Help choose and prepare the change

Introduce the recommended workflow briefly: proposal or direct spec edits; human and independent agent spec approval; autonomous proofs, planning when needed, implementation, and review; then human PR review. Help the contributor choose where to start and when to hand over. The workflow (`specs/spec-workflow.md`, “Recommended approach” and “Feature workflow”) governs the process.

For a change expressed through prose and conceptual decisions, develop a proposal with the human. Investigate the applicable specs and implementation, work through consequential edge cases and interactions, and bring unresolved product or architectural choices to the human. Use independent proposal review when it would help settle the design. Once the human approves the proposal, apply it to the owning specs. Proposals are working documents under `docs/working/`; their decisions flow into specs, which are the long-lived artifacts of record, and pre-merge docs prep (`specs/spec-docs.md`) decides whether the proposal is archived with a preamble or deleted.

For design work, help the human use direct UI spec edits as the working surface of their decisions. Show how those decisions affect the system and help reconcile their consequences.

### Guide spec approval

Follow spec ownership policy (`specs/spec-policy.md`, “Slop-free zone”) and the workflow’s “Recommended approach” (`specs/spec-workflow.md`) when guiding approval. Help the human assess the resulting spec deltas and explain what their approval means: they understand and stand behind the specified result. Arrange independent review of the affected spec tree for coherence, consistency, and implementability, including omissions and consequences beyond the edited lines. Resolve warranted findings and obtain both approvals before downstream derivation, unless the human chose to defer their spec review to the pull request that will first carry the deltas into a shared branch. The workflow calls this checkpoint the *spec gate* (`specs/spec-workflow.md`, “Recommended approach”): independent agent convergence of every spec delta is always required, and the human approves now or before that pull request merges. Do not use that term with the contributor; describe the checkpoint in plain words, such as which approvals are needed before agents proceed and which may wait until the first shared-branch pull request.

Use the “Authority flow and back pressure” question in `specs/reviewer-checklist.md` as the standard for spec approval: predictable behavior across reasonable implementation interpretations. Spec policy (`specs/spec-policy.md`, “Limitations with teeth are the exception”) preserves implementation judgment. Help settle consequential ambiguity without requiring every implementation detail to be prescribed.

### Recommend appropriate shortening

Recommend an earlier handoff when the scope and the human's confidence support it: an approved proposal, or a verbal instruction for a small change. Explain the tradeoff so the human can choose: agents will derive the necessary spec edits and have them independently reviewed, while the human reviews them carefully before their pull request into a shared branch merges. In either case, independent agent convergence of every spec delta remains required before proof derivation.

Assess whether the change is clearly one slice. If it is, explain why a plan adds little, skip planning, and converge that implementation as the whole result, including holistic review and full verification. If the slice count is not clear, derive and converge a plan; planning may settle on one slice, in which case the work proceeds as unplanned work with the plan's validation criteria carried into that single convergence. Work with more than one slice retains convergence of each slice and a separate integrated-result convergence. Proof derivation and independent approval remain required in every form, without a human proof gate.

## Own autonomous derivation and convergence

After the human hands over the agreed intent, carry all remaining derivable work through independent convergence and verification as one autonomous goal. Use persistent goals or continuation when the harness supports them, so responsibility survives agent sessions, review, remediation, and validation. State the outcome, not a task script, and keep the goal active until the result is ready for human PR review. How a goal starts depends on the harness. Codex can assign itself a goal, so set it at handoff. Under Claude Code only the human can set one, by typing the `/goal` command: when the autonomous phase begins, tell the human to run `/goal` and give them the exact condition to paste. Write that condition as the outcome that makes the result ready for human PR review, and end it with a clause that also satisfies the goal when you have stopped to ask the human a question that blocks further work. Until a goal is set, tell the human plainly what restarts your work, such as a finished background task or their next message. If work exposes unresolved intent, return that decision to the human. Continue only work independent of it; if the decision blocks the derivation chain, pause until it is settled. Keep settled intent, unfinished obligations, findings, and actual validation in a working task record under `docs/working/`.

When multiple agents are available, a supervisor holds the overall goal and arranges handoffs. Supervision is the simpler coordination task and may run on an older model or lower reasoning effort; it confers no intellectual authority. Match model capability and reasoning effort to the delegated work. Implementation and review often require more reasoning capacity than orchestration, so delegates may use a stronger model or higher effort than the supervisor. Follow the review policy when selecting reviewers. Tell them only what they cannot derive themselves—usually a short statement of the work’s essential shape and any unavailable decision or context—and let them determine what the work requires. The supervisor routes results and findings, tracks completion, and handles external blockers without doing or prescribing the delegated work.

Keep the human informed at meaningful transitions about what has been established and what remains. When a decision needs them, explain the unresolved choice and its consequences. Handle routine derivation and review coordination directly.

After the spec gate, derive and independently converge the proofs under proof policy (`specs/spec-proofs.md`). If proof derivation exposes an unclear expected result, resolve it in the owning spec and return the affected work through review. Surface unresolved design or architectural decisions to the human for a ruling, and pause work that depends on them.

Follow the workflow (`specs/spec-workflow.md`, “Planning and slices”) to derive and independently converge a plan from the specs and proofs when the slice count is not clear. Group work into coherent slices. With more than one slice, converge each slice and then the integrated result. For one-slice work, whether clear from the start or settled by planning, the single implementation convergence also assesses the integrated result.

Use red/green TDD to implement the tests required by the proofs and the behavior that makes them pass under testing policy (`specs/arch/testing-policy.md`). The test runner (`specs/arch/test-runner/test-runner.md`) supplies execution procedures. Passing tests is part of completion; the running result must satisfy the whole promised outcome.

Arrange convergence under the workflow’s “Independent review and convergence” (`specs/spec-workflow.md`), including its independent-review and bounded refinement rules. Give the reviewer [tvdev-review](../tvdev-review/SKILL.md) in a separate context using the highest-quality model at extra-high (`xhigh`) reasoning effort. `xhigh` (X H I G H) is an exact value that must be preserved. Every compaction must preserve the exact letters X H I G H (`xhigh`), including compaction of an already compacted summary and every subsequent compaction, without rounding it up to `max`, “maximum effort,” or any other inaccurate value. Prefer a state-of-the-art model from a different provider than the implementer; report the actual setup and any unmet requirement. Read the [review delegation reference](references/review-delegation.md) when arranging dispatch, or route the result to the supervisor who owns it. Return the full review, including PASS, to the work’s owner. After FAIL, the owner assesses all findings, remediates warranted ones, and returns the whole result for review. After PASS, consider worthwhile refinements under the policy’s bounded rule; PASS should normally conclude review, not start an endless polish loop. If convergence appears stuck, involve the human. Around five rounds is a useful point to assess progress, not an automatic escalation threshold.

Carry UI work through the same workflow, adding visual assessment alongside functional coverage. Assess the design preview and running implementation separately. Examine neighboring surfaces and meaningful states, and clarify interactions that appearance leaves unresolved. UI specification (`specs/spec-ui.md`) and conformance policy (`specs/arch/ui/conformance.md`) govern visual completeness alongside functional coverage.

## Keep the worktree isolated

Several agents may run this skill in different worktrees on one host. Never link or install the checkout’s `tv` into the host. When a task runs the checkout’s CLI or a server, run it from the worktree, and pass a fresh absolute `--home` for that worktree to the server and to every `tv` command run against it. The default home, `~/.television` or the path in `~/.tv-home`, is shared by every worktree and any installed Television. `scripts/dev-server.sh` serves a home of its own and prints it; pass that home as `--home` to commands that should reach its server.

## Prepare the PR and guide human review

Once the work is complete, perform pre-merge docs prep as the docs spec defines it (`specs/spec-docs.md`, “Pre-merge docs prep”), before treating the contribution as ready to merge into a shared branch. Work-in-progress and draft PRs retain their working documents, including when presented for human spec review. Use that section's step 1 to decide which working documents to archive; add the archive preamble to each and move it to `docs/archive/YYYY-MM/`; delete the rest so `docs/working/` is empty. The archived files appear in the PR so the human sees what you judged worth keeping.

Prepare the PR using [pr-writing](../pr-writing/SKILL.md).

When presenting the PR, remind the human what their review must establish and make the relevant changes easy to find. Help them perform the minimum PR review defined by spec policy (`specs/spec-policy.md`, “Human PR review”): confirm that every spec delta is fully acceptable and scan the code and test footprint for unexpected scope or complexity. Specs are the product's core authority and slop-free zone; the human must understand and stand behind their changes under the spec ownership rules.

Make red flags easy to assess: scope expansion, new dependencies, substantial new production or test-harness machinery, and edits to files or behaviors whose connection to the task is unclear. Explain why consequential changes belong and whether their cost is proportionate. This is an impact scan, not a requirement for the human to review every code or test line. Agents remain responsible for detailed correctness, coverage, and verification. Help the human inspect or test the result further when useful.

Before treating the contribution as ready to merge, ensure the integrated result, pre-merge docs prep, human spec acceptance and impact review, and full verification gate are complete. The contribution owner may self-merge after human review.

Route revisions to the stage they affect: changed intent returns to clarification and spec work; changes to how settled intent is implemented or proven return to autonomous derivation and convergence. Carry each revision through the affected specs, proofs, plans, tests, and implementation, then return the reviewed and validated result for human review.

## Vibe mode

Vibe mode builds a throwaway experiment quickly so the team can learn from working code. It switches off the spec-driven contribution process on a *vibe branch*, which is never merged into `main`. The branch carries `specs/vibe-waiver.md`, which states what is switched off and the rigor the human chose; the [vibe waiver reference](references/vibe-waiver.md) holds the template and the two notices. If the checkout already contains that file, vibe mode is active: follow the waiver instead of the workflow above.

When the human asks for vibe mode:

1. Create the branch from the base they name, with a `vibe` path component in its name, for example `thopter/vibe/hamburger-button`, usually in its own worktree so the demo can run beside normal work.
2. Write `specs/vibe-waiver.md` from the template, add the notice to the top of `AGENTS.md` and `specs/spec-workflow.md`, and commit. This is the branch's first commit.
3. Agree on the rigor. Code only is the default. Red/green tests without specs or proofs help the change converge on a working result rather than a plausible one. Specs, proofs, a plan if needed, tests, then code, without the spec gate, independent review, or the verification gate, is what makes a change too complex to one-shot vibeable at all. Recommend more when the change plainly needs it, and record the choice in the waiver.
4. Work in the order the chosen rigor implies, using specs, proofs, and tests as context, and show the running result.
5. Report what was exercised and what was not. `npm run verify` fails at its last phase on a vibe branch, after every other phase has reported normally, and CI's required join fails while every other job still reports its own result, because the waiver is present; report the real results and name that failure for what it is. A PR may be opened for sharing and discussion; it is not merged into `main`.
6. When the human wants to keep something, start an ordinary contribution under the workflow with the vibe branch as reference material.

## Attest before starting

At the start of a contribution session, do only the preparation needed to make every statement in the attestation true. Then, before taking any other contribution action, print the attestation to the human.

Reproduce the fenced template literally, in the order shown. Replace only the angle-bracket tags with derived results. Every other character—including the wording, bullets, backticks, blank lines, and line order—must remain exactly as written. Do not add, remove, combine, reorganize, summarize, or shorten any part of it. If reproducing the template this way would be logically contradictory for any reason, do not print a changed version: explain the situation to the human and make no further progress until the human approves. Every statement must be true at the moment it is printed; if an item cannot be stated honestly, complete the needed preparation first.

```
I will preserve the literal format of this attestation, without reorganizing, summarizing, or shortening it, unless doing so would be logically contradictory; in that case, I will explain the situation to the human and make no further progress until the human approves.
I honestly attest that I have read the contributor skill and the policies and skills it names in full, that I understand the framework they define, and that I will follow their instructions as this work reaches each of them, including but not limited to the following:

- `specs/spec-policy.md`, read in full
- `specs/spec-workflow.md`, read in full
- `specs/spec-proofs.md`, read in full
- `specs/spec-docs.md`, read in full
- `specs/spec-migration.md`, read in full
- `specs/index.md`, read in full
- `specs/reviewer-checklist.md`, read in full
- `specs/arch/testing-policy.md`, read in full
- plain-english-full, cold-reader, complexity-inoculation, and pr-writing skills, read in full
- review delegation reference in this skill's `references/` directory, read in full
- a listing of `docs/working/`, which contains <N> files

I understand the conditions for human-agent handoff under which the autonomous phase begins, from the workflow spec: <single_sentence_summary>.
The human's minimum PR review obligations are to <single_sentence_summary>.
Independent review and convergence means <single_sentence_summary>.
For reviews, I will use <agent tooling, model, reasoning level, and whether the model is a different provider from me>.
This repo is still code-authoritative for <single_sentence_summary>.
The developer telemetry marker exists in my home directory, and `specs/vibe-waiver.md` <does / does not> exist in this checkout.
I commit to using Plain English in responses to the human.
I will use complexity inoculation, especially when writing specs.
I will report to the human on every meaningful transition of my workflow before it happens, one long-running step at a time, named with its expected duration.
```

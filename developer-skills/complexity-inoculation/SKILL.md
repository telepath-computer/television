---
name: complexity-inoculation
description: >-
  Keep the cost of accreted complexity under control. Use while writing text that shapes other agents'
  or people's work (specs, design documents, proposals, plans, Linear tickets, delegated task
  descriptions, review findings, skills, agent instructions) and while designing, implementing, or
  reviewing what that text produces. Also use when local decisions cascade into machinery, a solution
  exceeds its purpose, inherited text drives work, during long autonomous plans, or when asked for
  "complexity inoculation."
---

# Complexity inoculation

This skill exists to keep cost under control in text that shapes later work and in the systems built from it. That text includes specs, design documents, proposals, plans, Linear tickets, delegated task descriptions, review findings, skills, and agent instructions, whether the later work is done by other agents, people, or yourself.

Agents lean toward complexity by default, and this skill works against that bias. The bias probably comes from training to carry complex work alone from start to finish, where resolving every detail and handling every case yourself is the job. Working in a team, supervising other agents, or writing specs for others calls for different skills: stating the intent, trusting capable readers, and leaving open what they can settle. You can understand these skills and apply them when asked, but you will not use them by default; this skill is the request to use them. The ways of incurring cost below are listed because they are what an agent does without that request, so expect your first drafts to contain them.

Every requirement, rule, mechanism, abstraction, test, procedure, and review demand costs something for as long as it exists, whether or not it ever changes what anyone does. It earns something only by meeting a need: delivering an outcome someone requires, or preventing a failure that would plausibly happen without it. Anything that meets no need earns nothing and pays every cost below. Meeting a need is still not enough on its own: the need must be worth more than the cost, and correctness alone does not justify an absurd ratio.

For instructions, the need is what the reader cannot work out alone. Assume the reader is at least as capable as you, often more, and better placed to settle details, because it will be looking at the actual case. An owner's decision counts as a need, since no reader can derive a decision someone else made.

Writing is cheap, and the author pays little of what the text costs afterward, so cost is easy to add without noticing. Before giving text or machinery authority, name the need it meets and ask whether a competent reader or builder would meet it anyway without being told. "It is true", "it is good practice", "it completes the picture", and "someone might forget" name no need; neither do completeness, symmetry, rigor, or future-proofing. If you cannot name one, leave it out. Even when a need is real, consider meeting it by deleting or narrowing a requirement, layer, field, rule, or mechanism before adding another.

Apply this within ordinary work and normal review, not as a separate process; the last section explains why.

## What cost looks like

- **Build.** Code, state, validation, migrations, failure behavior, operations, and compatibility. A short sentence can create large obligations, so ask what literal compliance would require.
- **Attention.** Everyone who reads the document reads it, every time. Unneeded text also dilutes the text that matters, until readers skim past the constraints that count.
- **Review.** Every reviewer checks every change against it.
- **Drift.** It must stay consistent with the text and system around it as both change. Where nobody keeps it consistent, it contradicts them and misleads.
- **Edges.** Every rule draws a boundary. Cases near it need deciding and tests need writing, and a reader unsure whether a case falls under it must stop, ask, or guess.
- **Litigiousness.** Where judgment should decide, readers instead argue over whether a case is covered, hesitate over ordinary decisions, and request approvals nobody intended. This spreads beyond the rule that caused it: each prohibition teaches readers to expect more prohibitions.
- **Misdirection.** When the text is wrong or incomplete, readers follow it anyway, and faithful work goes the wrong way.
- **Compounding.** Each addition interacts with what is already there. Its edges meet other rules' edges, its tests constrain unrelated changes, and its existence makes the next addition look necessary, so total cost grows faster than the number of things added.
- **Encrustation.** Over time, tests, processes, other documents, and habits come to depend on it, and each dependent makes it harder to remove. What is cheap to delete the week it is written can cost too much to delete a year later.

## How cost is incurred without need, and how to correct it

### Following a cascade: question the earliest premise

Individually reasonable decisions can produce a system nobody would choose from scratch. A sentence becomes a requirement, then a mechanism with constraints and edge cases, preserved by tests and process. Each step is justified by the one before, so every step looks needed while the whole is not.

You may already be deep in one; the sign is work growing past its purpose. Restate the original problem, ask whether you would choose this solution from scratch for it, and look for what can be removed or narrowed while preserving the outcome. When X requires Y, which forces Z and a failure policy, question X before polishing Z. The fix is usually upstream, and usually a removal.

Inherited specs, plans, and earlier layers are premises in the chain. Their authority does not make their design immune to scrutiny, and "the previous layer required it" describes history, not value. Before a spec or plan is ready, ask whether you would introduce its concepts and constraints on a blank page, and simplify before implementation gives them weight.

### Saying what the reader would work out anyway: leave derivable detail to the reader

State the intent and what the reader could not work out alone, and let the reader derive the rest. The most common way to say more is **advance solution design**: the author does the work for the reader before anyone has looked at the actual case, writing out the steps, files, or fields they expect it to need. That detail reflects what the author expected, yet readers treat it as decided and keep to it where it is wrong or incomplete. Enumerated cases do the same to scope: readers litigate whether their situation is listed instead of applying the intent. Supply examples when they clarify; avoid making them an exhaustive boundary by accident. Unless a particular mechanism is itself required, state the result it should achieve.

For example, when an architect's decision changes a requirement, the request to update the specs can state the decision, the changed requirement, and that the specs need to be updated to match. Whoever does the work will find the affected files and locations. A request that also lists them makes the list the scope of the work, so a location its author missed stays out of date.

Obligations and procedures, such as "update X when Y changes" or "reviewers check Z", are rules too. They are easy to write without noticing, because they read as helpful reminders.

### Building for cases that don't exist: build for the cases you have

Fix the instance before inventing the class. General machinery needs several real cases, not one case plus imagined futures. Where handling every case would add little, handle the cases that matter and leave the rest to judgment.

### Binding harder than the need: prefer guidance or silence where judgment suffices

Decide how firmly to state something separately from whether to state it. A prohibition removes judgment where it applies and invites litigiousness beyond it, so use a hard line when crossing it is genuinely unacceptable, not to emphasize seriousness.

Absolutes bind hardest. A rule of the form "all X must Y", or one built on every, never, none, or always, claims to be right about cases its author never saw. Enforcing it takes machinery, and each case it fits badly needs an exception or an argument. Where the truth is "usually" or "by default", say that. Keep absolutes for what must genuinely hold in every case.

Silence is not a prohibition. Saying where something lives does not say it may live nowhere else; saying what a hook exposes does not request a list of everything callers may not read. Open space is not a defect for a reviewer to fill.

### Writing a rule without trying it: walk it through the cases it will govern

Agents follow precise rules literally but are poor at anticipating how rules they write will behave. A confident sentence becomes a wrong action when another agent applies it to a case the author did not foresee, and the author may be that reader a few turns later. Writing a rule feels like understanding one, although it is the riskier act. A rule that misfires then tends to be patched with more rules.

For example, an invented review-round cap can stop a review that needs another round. A stopping rule saying "stop if the next check could not change anything" can halt supervision of work that lasts longer than one check interval.

When a situation seems to need a rule the governing document lacks, ask its owner before supplying one. If writing one is warranted, walk it through the concrete cases it will govern, especially long, slow, iterative work and readers that will not second-guess its wording, before giving it authority.

### Serving a stand-in for the goal: serve the goal and correct the stand-in

A verification command, a planned method, a metric, or process evidence can take the place of the goal it was meant to serve. Work then pays for whatever the stand-in demands, even where the purpose never needed it, and can satisfy the stand-in while missing the purpose. When they disagree, correct or narrow the stand-in rather than serving it, and take it to its owner when it is not yours to change.

## Acting on it

Make small, reversible corrections that clearly restore the stated purpose and continue, especially during authorized autonomous work. Escalation costs the owner's attention and stalls the work, so keep it for simplifications that change a deliberate product decision, weaken a real safety or compatibility guarantee, incur meaningful irreversible cost, or choose between different owner intentions. Questioning a governing requirement means raising the concern with its owner, not silently overriding it or expanding the task.

## Calibration examples

- **Provenance created a data model.** A sentence requiring each generated entry's origin led to canonical registry URLs, exact versions, name/version schema coupling, validation, and tests. When provenance adds no needed value, narrowing the sentence can remove the whole chain.
- **Every skipped entry needed a reason.** A skip list's rule that every entry must carry a nonempty reason came with load-time validation and tests, although the reasons changed no behavior. A plain list or comment could serve the purpose.
- **An identity shortcut became a prohibition.** A file's name once identified its single component. Supporting several components then produced a rule against multiple unnamed components. Giving components their own identities could remove the restriction and its error cases.
- **A definition acquired a maintenance rule.** The definition of a derived explanatory document gained "updated in the same change as any spec it cites", which then spread toward a workflow step and a reviewer-checklist item. A competent contributor who changes a spec already updates the text that restates it, so the clause corrected nothing and would have been checked on every spec change. Deleting the clause removed the chain.
- **A verification command became the goal.** A broad planned command selected an unrelated unsupported experiment that leaked a process on the unchanged baseline. The feature's tests passed. Correcting test ownership or narrowing the prescribed evidence could preserve confidence without assigning unrelated repairs to the feature.

Other cases may involve an abstraction that burdens every use, a compatibility layer whose obligation has ended, or automation producing unused process evidence.

## Reading this document

This document applies to its own use: any use of it that adds cost without need commits the failure it describes. An audit or ledger-based review process, a checklist, a score against the forms of cost, an agent team, a scheduled loop, a report, or an approval gate built to apply it adds the procedure it exists to prevent. So does a new rule derived from it, such as requiring every sentence to cite its need. The forms of cost are for recognizing cost, not for rating text. The ways of incurring cost and the examples illustrate; they are neither exhaustive nor a list of defects to hunt.

Real needs justify real cost, and substantial problems can deserve substantial systems. This document does not authorize ignoring relevant failures, weakening acceptance criteria or real guarantees, or dismissing deliberate requirements as complexity. Success is proportionate work, not more procedure about simplicity.

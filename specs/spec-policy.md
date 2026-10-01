*How and why specs are written, what makes something a spec, and the rules for specs.*

# Spec policy

## Specs are authority

Specs are the source of truth. They are **authority documents**. Everything else defers to and should follow from specs.

Non-authoritative types of documents:
- `developer-skills/` is the editable source of developer guidance, installed into the developer's home under [developer skill distribution](arch/developer-skills.md). Workflow and setup skills explain how to apply the required workflow and setup procedures in specs; they do not establish or override it. Writing skills are incorporated as authoring guidance below.
- `docs/` holds the guides, working documents, and the archive under [spec-docs.md](spec-docs.md). Guides follow the applicable specs; a specific owning spec may explicitly grant a guide authority over its procedures. Working documents and the archive have no standing.

Runbooks and explainers are specs (see [Runbooks](#runbooks) and [Explainers](#explainers)); a guide’s narrower procedural exception must be stated by its owning spec.

## Slop-free zone

Specs are a slop-free zone — one of the most important reasons they exist.

Most content in a modern repository is written by AI, and AI-written content tends towards slop: plausible-looking statements, half-considered decisions, eager overcomplication. Once slop becomes authority, it becomes a downward spiral. Later work builds on it and generates more slop — confused complexity compounding on itself.

Maintaining a slop-free zone breaks the cycle. Every statement in a spec is reviewed and owned by a human. Agents may draft specs, and humans may edit them directly. Before a pull request carrying spec deltas merges into a [shared branch](spec-workflow.md#^shared-branch-workflow), a human reads every spec delta, understands it, and stands behind it as correct and intentional. That review may happen before implementation or on the pull request that first carries the deltas into a shared branch, but it must be complete before that pull request merges. A later pull request that promotes an integration branch to another shared branch does not defer the review: unapproved spec content never enters a shared branch. Human ownership does not require early approval. An agent reviews spec changes for consistency and correctness regardless of who authored them. The contribution owner may self-merge after human review; this policy does not require another person’s approval or a GitHub review object. ^shared-branch-spec-review

An exemption from human line review exists only by explicit architect decision for an individual spec. The exempt spec declares that decision in its own header and names the review model that applies. [The artifact bridge spec](arch/artifact-frame/artifact-bridge.md) carries such a declaration: the architect does not line-review it, and adversarial review between state-of-the-art models settles and maintains it.

## Human PR review

Human PR review is the final check that the contribution expresses the intended product and stays within its expected scope. At a minimum, the human confirms that every spec delta is fully acceptable: read, understood, correct, intentional, and something they stand behind under the ownership rules above. Specs are the product's core authority and its slop-free zone. Independent agent review supports this responsibility but cannot replace it; the exception clause above governs exemptions.

The human also scans the footprint of the code and test changes for disproportionate or unexpected impact. Red flags include scope expansion, new dependencies, substantial new machinery in production code or test harnesses, and changes to files or behaviors whose connection to the task is unclear. These warrant explanation and scrutiny before approval; their significance depends on the intended change.

This scan does not require line-by-line human review of all code and tests. It asks whether the implementation's scope and complexity are proportionate and explainable. Agents remain responsible for detailed correctness, coverage, and verification. Humans may inspect or test the result further as appropriate.

## Two kinds of spec: product and architecture

**Product specs** (`specs/product/`) define user-facing behavior — the what, how, why, where, and when of what a person or agent can do and observe. They are written in product language and are generally agnostic to implementation. The frameworks, tooling, precise boundaries of the modular decomposition of the system, and so on, are not important. A product spec's `## Testing` carries its human testing directives ([spec-proofs.md#^testing-directives](spec-proofs.md#^testing-directives)); its proof carries the acceptance assertions that establish its measures of acceptance.

**Architecture specs** (`specs/arch/`) define the modules and contracts that organize the implementation of the product. They typically define actual TypeScript types as their contracts. They also own the operational procedures (e.g. installation and setup steps) to stand up and run the part of the system they describe. An arch spec's proof carries the contract, seam, and acceptance assertions that validate its contracts, in whatever form fits — end-to-end, integration, or unit-level.

## Authority and ownership is stated up front, and is DRY

Every owning spec states what it is authoritative for. Ownership is exclusive. Outside the explainer exception below, specs are kept DRY with high discipline. References to owning specs are used liberally rather than restating.

This trickles down to the things specs define: **types** are defined once and live in the most relevant arch spec, **terms** are defined by the spec authoritative for the concept, **contracts** are defined in modular arch specs, etc.

## Specific specs may state exceptions

Authority is a hierarchical cascade. A general policy — this document, the testing policy, any cross-cutting spec — binds by default, but a more specific spec, owning a narrower area, may state an explicit exception or deviation, and within its area that statement is authoritative. The most specific spec that addresses a point wins.

A deviation must be **stated**, never assumed. Silence inherits the policy; only an explicit, owned exception departs from it. Such a deviation is a tactical decision the specific spec takes responsibility for: the general policy does not endorse it, but the authority model permits it, because the spec owns its area, stands behind the call, and a reviewer can see and weigh the tradeoff at the point it is made.

*Example.* The testing policy requires that every spine path be proven by an acceptance test. A spec for a system with many forked spines may judge that several of them carry diminishing return and explicitly choose to prioritize the principal spines and leave the rest unproven. That is allowed when the spec states it — it is the spec's tactical call, not a relaxation of the policy.

## Authority cascade

Authority flows down a chain and is maintained by pushing it back up during code review:

```
spec prose (and testing directives)  →  proofs  →  real tests  →  real code
```

The spec's prose, TypeScript types, and testing directives are the top authority. Its proof derives test assertions from them. Real tests derive from those assertions and ideally cite them by block ref. Real code derives from all of it.

The standing discipline, maintained by review, is to keep pushing authority and clarity *up* the chain: when something is learned or changed downstream, carry it back into the spec so the spec stays the source of truth. And just as crucially, when the downstream is unclear how to implement correctly, this is a critical review signal that upstream needs more clarity.

Test coverage is judged by reviewers — humans and agents reading the specs and the tests. How tests are organized depends on what is under test; acceptance-style behavior tests generally run as full, non-mocked end-to-end tests, but no spec type is bound to a particular test tier or suite that can be defined at the level of this policy document. How much coverage a spec's proof orders, at what price, and why not every statement of authority owes an assertion of its own is the testing policy's to govern ([arch/testing-policy.md#^assertion-cost](arch/testing-policy.md#^assertion-cost)).

## Iteration and back pressure as welcome procedure

Since it is often impossible to have a complete spec up front, and implementation typically surfaces unforeseen problems or decisions that should be pinned down, a best-effort spec that captures what we think or believe to start out can be used to create an initial experimental implementation, which then generates real learnings. The learnings that lead back up the chain to spec changes are *back pressure*, and they are **welcome.** The discipline is to ensure back pressure lands in the spec and is cleaned up, rather than specs having incorrect or incomplete authority while code or tests overreach to close the gap.

## Operational authority is included

Architecture specs don't just define behavior and contracts but can also define the operational procedures needed to stand up and run the part of the system they define (provisioning steps, environment requirements, key procedures, etc).

Operational content is authority, but is distinct from behavior+contracts, so it's called out separately in specs with `## Operations` or `## Setup` style sections to differentiate contract from procedure.

Onboarding and orientation guides derived from the specs are a separate downstream layer and are not part of `specs/`. Operational *procedures* that deserve their own document are runbooks, below.

## Proofs

Except for runbooks and explainers, each product, architecture, and UI spec has a *proof*: the document under `proofs/`, at the spec's own path, that says how the spec's promises are proven. A proof is derived authority, like a runbook — the spec wins on any conflict — and it is the agents' document: written and reviewed by agents, and merged without a human line review. Why proofs exist, what one is, where it lives, its shape, when it changes, and how proofs and specs cite each other are owned by [spec-proofs.md](spec-proofs.md).

## Runbooks

A *runbook* is a spec document type stating an operational procedure step by step — how a human or agent performs a process the system supports (deploying a channel notice, staging a UX state, standing up an environment). A runbook is **derived** authority: it is authoritative for the *process* — the steps, their order, the checks between them — but the process is implicit in the mechanism specs it exercises. Every step must be derivable from those specs and cite them. On any conflict, the mechanism specs win and the runbook has the bug. ^runbook-type

Runbooks carry **no test assertions of their own**: the mechanisms they exercise are already covered by their owning specs, and a procedure is validated by being executed, not by a test suite.

**Location and naming:** a runbook lives beside the arch specs of the area whose mechanisms it exercises, named with a `runbook-` prefix (e.g. `arch/updates/runbook-channel-deploy.md`); a runbook spanning multiple areas lives at `arch/` root. The prefix makes the document type visible in any listing, and colocation keeps the derivation local — the specs a runbook cites are its neighbors, and the area's reviewers see procedure and mechanism change together. ^runbook-location

## Explainers

An *explainer* is a derived spec document that explains one concern owned across several specs from start to finish for a person who wants to understand how it works. It may restate those specs so the reader can follow one coherent account. The owning specs win on any conflict, and an explainer has no proof. ^explainer-type

An explainer uses an `explainer-` filename prefix and lives beside the architecture specs for its concern, or at `arch/` root when it spans several areas.

## UI specs

Visual design has its own authority medium: markup and CSS, not prose. How that works — per-surface template files and CSS as the markup-and-styling truth, with frames under `staging/` as the derived frameset workshop — is owned by [spec-ui.md](spec-ui.md). `specs/ui/` is the **exclusive** authority for a surface's interaction, markup, and styling: product and arch specs must not own any of the three, and reference the owning UI spec instead. The copies under a frozen canonical version are not specs: they are what that version shipped, restating their sources by design ([arch/canonical.md](arch/canonical.md)). Product specs keep the feature's promises and acceptance criteria; arch specs keep everything code-shaped (properties, events, types, persistence, mechanisms — an element's API, public to artifacts or internal to the app, under [arch/ui/elements.md](arch/ui/elements.md)).

## Terminology handling

Any product and its architecture demands a great deal of invented terminology. Terms are defined authoritatively once, by the spec that owns the domain it belongs to. Terms are always italicized when being defined. Terms that could be confused with natural language are italicized for differentiation. Use references to the owner where a link helps.

`terms.md` is a glossary that points to each term's owning spec. It is maintained by review discipline, not generated — keeping it correct is part of reviewing any change that introduces or moves a term.

## Authoring guidance

Specs must conform to the repository’s [cold-reader](../developer-skills/cold-reader/SKILL.md) and [plain-English](../developer-skills/plain-english-full/SKILL.md) guidance. Apply [complexity-inoculation](../developer-skills/complexity-inoculation/SKILL.md) while authoring and reviewing: question unnecessary requirements without overriding the human's intent. These skills are the shared home for that guidance; this policy retains spec-specific requirements. On a conflict, the governing spec wins and the skill needs correction.

A spec's reader is a competent senior engineer familiar with web and desktop architecture but without this project's history. Useful rationale, non-goals, and negative behavioral boundaries remain welcome when they explain the present design. The cold-reader skill distinguishes those explanations from conversation history.

### Plain-english intros

Every spec opens with a **plain-english intro**: a couple of sentences, right after the one-line description and before any ownership or contract language, telling a cold reader — even a lay one — what the spec governs and why it exists. It uses no invented terms but the one it is defining, and no anchors or links; the rest of the jargon starts after it. It orients rather than binds: the authority content below always wins on detail.

## Rationale is useful guidance, not a completeness requirement

Rationale can make non-obvious authority easier to maintain. When an exact ordering, an unusual data choice, or a choice between near-identical mechanisms carries a load-bearing tradeoff, authors should consider recording enough context for a future reader to understand what would break or change if the rule moved.

This is guidance, not a requirement of spec authority. A rule is binding because the spec states it; it is not incomplete merely because its rationale is absent. Reviewers may suggest rationale where it would materially help future judgment, but absence of rationale alone is not drift and does not block a spec from being complete.

UI specs in particular are not expected to justify each measure constant. Pixel sizes, timings, offsets, and similar magic numbers are ordinary authored design values; their authoritative artifacts may state them without prose explaining why they feel right. Record rationale only when it conveys a genuine constraint or tradeoff that the rendered design and its values do not already communicate.

## Limitations with teeth are the exception

A spec describes what a thing has and does. It does not, by default, define everything it does not cover and does not allow, and it is not incomplete for leaving that space open — that space is where an implementer's judgment lives. A positive statement is not a negative rule: a sentence saying where something lives does not mean it may live nowhere else, and a policy that is positive about one thing says nothing about its neighbors.

A limitation with teeth — a rule that something must not be done; a description of what a thing does not do is not one — is a deliberate choice for the rare case where strict procedure or extreme emphasis is worth its cost. The cost is real: every hard line removes a case from judgment, and a hard line volunteered because a statement seemed to leave a gap turns every later small change into a request for permission. Write one when that cost is being paid on purpose; otherwise state what is true and stop. ^limitations-are-the-exception

## Spec-driven project status is transitional

The project has not been authored with spec-driven policy and is being migrated one step at a time, resulting in a mixed authority situation. Specs are authoritative where defined, otherwise code is the authority.

While specs are adopted incrementally, a spec (or a section within one) may indicate a status of `draft` or `incomplete` or similar, so areas can come under spec authority one at a time.

Overall transition state is tracked in [spec-migration.md](spec-migration.md).

While the implementation has not yet conformed to a spec, that spec may carry **implementation notes**: transitional annotations addressed to agents implementing against it — what happens to specific existing tests when the conforming work lands, known traps in the standing suites, coverage context an implementer could not discover alone. An implementation note is not authority and can state no rule; it rides directly next to what it annotates, as a blockquote beginning with the fixed phrase `**Implementation note (transitional):**`, and it is removed by the work that consumes it. When the system conforms, a search for that phrase finds nothing — leftover notes are unfinished work, exactly like leftover "(test to be written)" markers. ^implementation-notes

The goal state is to have no status: everything in `specs/` being current authority and all essential behavior is covered, and non-authoritative or incomplete material never enters the `specs/` tree.

## Layout

```
specs/
  index.md                generated index — one line per spec
  *.md                    root governance specs: this policy, the workflow,
                          the reviewer checklist, the glossary, the migration state, etc.
  product/                user-facing behavior specs
    *.md                  cross-cutting concerns owned by no single domain
    <domain>/             domain-specific specs
  arch/                   modules and contracts
    *.md                  cross-cutting concerns owned by no single module or domain
    <module-or-domain>/   module- or domain-specific specs
  ui/                     rendered UI authority, one directory per surface
proofs/
  index.md                generated index — one line per proof
  product/                proofs mirroring specs/product/
  arch/                   proofs mirroring specs/arch/
  ui/                     proofs mirroring specs/ui/
docs/                     non-spec documents, governed by spec-docs.md
  README.md               points at spec-docs.md
  guides/                 the administrator guide
  working/                documents for work in flight; empty on main
  archive/YYYY-MM/        working documents included with a merge
```

## File size and hierarchy

Spec hierarchy is flexible. Whatever keeps each spec coherent and readable. Aim to keep a spec under a few hundred lines. If it gets too long, consider how to decompose it cleanly along boundaries of authority.

## TypeScript in arch specs

Arch specs use real TypeScript types as their contract surface. The actual interfaces, unions, and signatures are precisely captured. This is not implementation detail: ambiguous prose contracts are where bugs and churn come from, and real types remove ambiguity. The code restates these spec-owned types in its own source; that duplication is expected, and drift between spec and code is caught in review and easy to spot.

Pin the contract surface, not the implementation details: the types and data shapes, and the function signatures that callers across a module or package boundary depend on. State behavior as rules in prose.

Avoid enumerating internal function signatures. Pinning them comes at a cost of over-constraining implementation and wasting authority on things that can be flexible. Include an internal signature only when it is the single clearest way to convey a behavior and you deliberately accept the tradeoff of promoting it to authority.

## References

References between spec files are relative markdown links: `[text](relative/path.md)`, with any anchor appended (`#^ref` for a block ref, `#` for a value).

A *block ref* is a stable anchor on a statement so that other specs, tests, or code can cite that exact statement without naming a file and line number (which move). It is a short opaque token appended to a paragraph or list item, written `^abcd1234` (letters, numbers, and dashes only). A citation elsewhere points at it as `[ref](spec-filename.md#^abcd1234)` (with the link text keeping the prose readable).

Block refs benefit from the fact that `grep` finds them anywhere.

Use block refs when it reduces friction in managing authority. There is no rule that every assertion must be anchored: anchor only what is worth citing to reduce maintenance friction.

Ideally a block ref exists only while something actually cites it — an anchor nothing references is clutter. This is intent, not a strictly enforced rule: prefer to add a ref together with (or just before) the citation that uses it, and to drop a ref once its last citation goes away.

An ID may be a short random token (e.g. `^a1b2c3d4`) or a short semantic slug (e.g. `^ac-install-once`) — letters, numbers, and dashes either way. Keep it short and stable, and never reuse or renumber one.

Anchors must be **unique across the specs and proofs trees together**, not just within their file — grep-ability and unqualified citations from test code depend on it. When a natural name would collide or is generic enough that another domain could plausibly want it, flavor it with its domain (e.g. `^updates-test-hooks`, not `^test-hooks`).

Refs are NOT the only way to maintain references between specs. Specs can mention each other by file name, e.g. you can say "filesystem handling follows policy from `[paths.md](paths.md)`".

This extends to a spec's code-like files — templates, stylesheets, YAML — and not only its markdown. One reference form throughout is worth more than a link that opens for some targets and not others.

A directory is not a reference target — there is nothing to open — so name it in code font (`shared/`) rather than linking it.

**Referencing a value.** A spec's prose often needs to name a value living in one of its code-like files — a YAML key, a custom property, a template parameter. Reference it as a link like any other reference: the file, `#`, and the value's own path within it. A bare `#` marks a value this way, where `#^` marks a block ref.

`[drag.yml#autoscroll.zone_px](drag.yml#autoscroll.zone_px)` · `[styles.css#--page-gap](styles.css#--page-gap)` · `[measures.yml#artifact.min_width_px](measures.yml#artifact.min_width_px)`

A nested YAML key is written as its dotted path from the file's root, and a custom property keeps its leading dashes. Non-unique basenames take a path, as everywhere else — `styles.css` and `measures.yml` always do. Where a value is set in more than one file, reference the one the prose means. The reference stands where the value would, so the sentence still reads as the statement it makes; prose that means the thing rather than its value names it in words and links the file instead.

## Review discipline, not procedural enforcement

Spec tree integrity comes from clear authority and from review — by humans and by agents doing spec reviews — not from CI gates, coverage counters, or vocabulary linters. The rules above are policy that intelligent reviewers apply, not dumb machinery. Two exceptions are procedural: `index.md` is generated, and reference integrity — link form, target existence, block-ref existence — is enforced by a repo test.

*How and why specs are written, what makes something a spec, and the rules for specs.*

# Spec policy

## Specs are authority

Specs are the source of truth. They are **authority documents**. Everything else defers to and should follow from specs. Where specs say nothing, the code governs.

**A spec holds what agent-owned derivation can't be trusted to get acceptably right, written so a human can understand it, review it and stand behind it.** Proofs, tests and code are derived from specs and owned by agents. Specs are owned by humans. The rest of this policy unpacks the two halves of that sentence: [What belongs in a spec](#what-belongs-in-a-spec) covers what derivation can't be trusted with, and [Writing a spec](#writing-a-spec) covers the form a human owner needs.

## Slop-free zone

Specs are a slop-free zone — one of the most important reasons they exist.

Most content in a modern repository is written by AI, and AI-written content tends towards slop: plausible-looking statements, half-considered decisions, eager overcomplication. Once slop becomes authority, it becomes a downward spiral. Later work builds on it and generates more slop — confused complexity compounding on itself.

Maintaining a slop-free zone breaks the cycle. Every statement in a spec is owned by a human, who has read it, understands it, and stands behind it as correct and intentional. Ownership comes from that review: the human accepted the statement, not necessarily chose or wrote it. When a spec is revised, each statement is judged under this policy; being in the spec already gives it no extra standing. Agents may draft specs and humans may edit them directly; either way, a human review backs every statement. The [spec workflow](spec-workflow.md) governs how and when that review happens.

## Authority cascade

Authority flows down a chain:

```
spec  →  proofs  →  real tests  →  real code
```

The spec is the top authority. Its proof derives test assertions from it. Real tests derive from those assertions and ideally cite them by block ref. Real code derives from all of it.

A complete spec is often impossible up front. A best-effort spec can drive an initial implementation, and implementation can surface things the spec should capture. That signal is *back pressure*, and it is welcome. The standing discipline is to iterate on specs when downstream derivations provide signal that should be captured in them. For example, if an implementation encounters something significantly unclear, a spec iteration is likely warranted. When the spec does need to change, the change lands in the spec, rather than code or tests overreaching to close the gap.

Do not mistake back pressure for permission to fall into the agent's bias for over-specification. Back pressure pertains only to the subset of learnings that genuinely belong in a spec under this policy.

Test coverage is judged by agent reviewers reading the specs, the proofs and the tests; proofs are agent-owned. How much coverage a spec's proof orders, and at what price, is the [testing policy](arch/testing-policy.md#^assertion-cost)'s to govern.

## Ownership is exclusive and DRY

Each requirement, type, term and contract has one owning spec. Outside the [explainer](#explainers) exception, specs are kept DRY with high discipline: a spec refers to the owner rather than restating what it owns.

This trickles down to the things specs define: **types** are defined once and live in the most relevant arch spec, **terms** are defined by the spec authoritative for the concept, **contracts** are defined in modular arch specs.

## Kinds of spec

**Product specs** (`specs/product/`) define user-facing behavior — the what, how, why, where, and when of what a person or agent can do and observe. They are written in product language and are generally agnostic to implementation: frameworks, tooling and the boundaries of the system's modules do not matter to them.

**Architecture specs** (`specs/arch/`) define the modules and contracts that organize the implementation of the product. They typically define actual TypeScript types as their contracts. They also own the operational procedures needed to stand up and run the part of the system they describe, such as provisioning steps, environment requirements and key procedures. Operational content is called out in `## Operations` or `## Setup` sections, to keep procedure apart from contract.

**UI specs** (`specs/ui/`) give visual design its own authority medium: markup and CSS, not prose. How that works is owned by [spec-ui.md](spec-ui.md). UI specs are the exclusive authority for a surface's interaction, markup and styling. Product and arch specs reference the owning UI spec rather than owning any of the three. Product specs keep a feature's promises and acceptance criteria; arch specs keep everything code-shaped, such as properties, events, types, persistence and mechanisms.

## Proofs

Each product, architecture and UI spec has a *proof*: the document under `proofs/`, at the spec's own path, that says how the spec's promises are proven. A proof is derived authority — the spec wins on any conflict — and it is the agents' document, written and reviewed by agents. [spec-proofs.md](spec-proofs.md) owns what a proof is and how it is shaped.

## What belongs in a spec

A spec holds what agent-owned derivation can't be trusted to get acceptably right. Every statement in a spec costs something: a human reviews it and stands behind it, a proof derives assertions from it, tests carry those assertions, and every later change has to respect it. A statement earns that cost when derivation without it could not be trusted. This section is guidance for that judgment.

### Specs guide derivation

What can be derived acceptably from what a spec already says does not need to be said. Where derivation could plausibly go wrong, more is likely needed. "Acceptably" carries the weight: a statement nobody could derive, such as the name of an internal constant, still does not belong if any reasonable choice would do. This one consideration decides whether to state something, how much detail to give it, whether to say what something does not do, and whether an example helps.

### Why a statement belongs

A spec holds at least the following. The list is not closed.

- **Design intent:** what the product is for, and how it should behave and feel for the people and agents who use it.
- **Architectural decisions:** choices that shape the implementation and that a human wants to own.
- **Contracts:** the points where the product meets something outside its own running code that depends on what the product does.
- **Knowledge that would otherwise be lost:** an accepted limitation, an answer to an objection an implementer can be expected to raise, or a regression case that keeps a known failure from returning.

Many different things can be on the other side of a contract:
- another version of the product, such as the version that wrote data a later version reads, or a server and a client running different releases;
- the browser and its storage;
- a separately running process;
- the people and agents who use a command-line interface, or who write files the product reads;
- an external service.

Changing a contract is allowed, but the change has consequences someone has to think through: a migration, compatibility with copies still running an older version, or what happens to data already written. That is why a contract is written down rather than rediscovered from code.

Some contracts are kept by people rather than by code. When a product promise depends on how an outside service is configured, such as an analytics service's privacy settings or a distribution service's release-signing setting, that configuration belongs in the spec. No product code carries it out; a person keeps it in place by administering the other service.

Derivation can go unacceptably wrong in two ways, and each gives a question:

- Would changing it have consequences outside the product's own running code? If so, it is a contract.
- Would derivation plausibly go wrong without it, or would getting it different be something the team should discuss? If so, it is a decision.

When neither applies, the statement is derived during implementation and the code governs it.

### What kind of thing it is does not decide

Whether a statement belongs depends on what it means where it stands, not on what kind of statement it is. A timeout on a public command can be a product promise; a timeout chosen to make an implementation work, and tuned when it does not, is not.

### How much to say

Say as much as derivation needs to come out right; the more obvious something is, the less it needs. A contract is described as far as the other side relies on it.

### What the product is now

A spec describes the product as it is and what it requires now. Mechanisms and capacity that nothing uses are generally left out; a designer or architect may still include one they judge important. History stays out of specs: retirement records, accounts of earlier designs, and how a choice came about belong in commit messages and the archive. A spec is not a backlog either: plans, proposals and future features are tracked elsewhere. A spec author may still give context about the future where it helps derivation. Marking a code path as transitional, for example, tells readers to be cautious about building on it. The [cold-reader](../developer-skills/cold-reader/SKILL.md) guidance distinguishes explanation of the present design, which belongs, from history.

### Work outside the product's specialisation

When a product builds something itself that lies outside its purpose, such as classifying browser user agents for an application that is not about browsers, the spec tends to inherit that work's detail. A well-chosen library keeps the spec on the outcome wanted. Where the product does the work itself, the spec states what is wanted, not every case of how.

## Writing a spec

A spec is written for the human who owns it: someone who has to understand it, review it and stand behind every statement. The guidance in this section is style for that reader. An agent deriving from a spec does not need an introduction or plain English; the human owner does.

### How a spec opens

A spec opens with its one-line description, which builds the spec index, followed by an introduction that orients the reader to what the spec is about. How the introduction is written is the author's judgment. Where ownership would not be obvious from the content, the introduction or a short section says so. A neighbouring spec is named only where a reader would reasonably expect that content here.

### Authoring guidance

Specs must conform to the repository’s [cold-reader](../developer-skills/cold-reader/SKILL.md) and [plain-English](../developer-skills/plain-english-full/SKILL.md) guidance. Apply [complexity-inoculation](../developer-skills/complexity-inoculation/SKILL.md) while authoring and reviewing: question unnecessary requirements without overriding the human's intent. These skills are the shared home for that guidance; this policy retains spec-specific requirements. On a conflict, the governing spec wins and the skill needs correction.

A spec's reader is a competent senior engineer familiar with the product's technical domain but without this project's history.

### Terminology

Any product and its architecture demands a great deal of invented terminology. Terms are defined authoritatively once, by the spec that owns the domain they belong to. Terms are italicized when being defined, and italicized elsewhere where they could be confused with natural language. Use references to the owner where a link helps.

`terms.md` is a glossary that points to each term's owning spec. It is maintained by review discipline, not generated — keeping it correct is part of reviewing any change that introduces or moves a term.

### Rationale

Rationale is optional, and is written where it helps a future reader understand what would break or change if a rule moved. It helps most when an exact ordering, an unusual data choice, or a choice between near-identical mechanisms carries a load-bearing tradeoff.

Two kinds of explanation are especially worth their place. One answers an objection an implementer can be expected to raise. For example, a service that polls a release feed with little jitter can explain that each user starts upgrades on their own installation, so the simultaneous restarts an implementer would worry about do not happen. The other states an accepted limitation, briefly, so that it reads as a decision rather than an oversight.

### Limitations with teeth are the exception

A spec describes what a thing has and does. It does not, by default, define everything it does not cover and does not allow; that space is where an implementer's judgment lives. A positive statement is not a negative rule.

A limitation with teeth is a prohibition: a rule that something must not be done. It removes judgment wherever it applies, so a spec states one only when that cost is being paid on purpose, after careful consideration. The [complexity-inoculation](../developer-skills/complexity-inoculation/SKILL.md) guidance covers why hard rules cost more than they appear to, and how to judge when one is warranted.

For example, a spec saying that an authentication token lives in browser storage does not forbid a cached copy elsewhere. A rule that the token must always be read directly from storage could be justified by a security concern, but only after careful consideration. ^limitations-are-the-exception

Documenting accepted limitations is normal, not rare. An accepted limitation describes something the product does not do today. It is not a prohibition, and changing it is an ordinary spec change.

## Testing guidance

A proof derives its test plan from the spec and the testing policy, and what follows from those is the proof's to work out. A spec may carry a `## Testing guidance` section only for what a proof writer could not reasonably derive from them: for example, a regression case that has come up, a fact about the product or its environment that a test author would likely miss, or coverage owned by another spec that bears on this one. The test for each item: if removing it would not change a correct proof derivation, it does not belong. Most specs need no such section, and a spec with nothing to say here omits it. ^testing-guidance-rule

A regression case says why it exists, because its purpose is to preserve knowledge that would otherwise be lost.

## Mechanics

### TypeScript in arch specs

Arch specs use real TypeScript types as their contract surface. The actual interfaces, unions, and signatures are precisely captured. Ambiguous prose contracts are where bugs and churn come from, and real types remove ambiguity. The code restates these spec-owned types in its own source; that duplication is expected, and drift between spec and code is caught in review.

Pin a type when something outside the product's own running code depends on its shape: stored data another version may read, a request or response between processes, command or API output, a file that people or agents write for the product to read, a message to an external service. A type exchanged only within the product's own running code is internal, even across a module or package boundary, because both sides change together. The return value of an internal file-watching helper is an example. An architect may still pin such a type where it is the clearest way to convey a decision, accepting the cost of promoting it to authority. State behavior as rules in prose.

### References

References between spec files are relative markdown links: `[text](relative/path.md)`, with any anchor appended (`#^ref` for a block ref, `#` for a value).

A *block ref* is a stable anchor on a statement so that other specs, tests, or code can cite that exact statement without naming a file and line number (which move). It is a short opaque token appended to a paragraph or list item, written `^abcd1234` (letters, numbers, and dashes only). A citation elsewhere points at it as `[ref](spec-filename.md#^abcd1234)` (with the link text keeping the prose readable). Block refs benefit from the fact that `grep` finds them anywhere.

Anchor only what is worth citing. Ideally a block ref exists only while something cites it: add a ref together with the citation that uses it, and drop it once its last citation goes away.

An ID may be a short random token (e.g. `^a1b2c3d4`) or a short semantic slug (e.g. `^ac-install-once`) — letters, numbers, and dashes either way. Keep it short and stable, and never reuse or renumber one.

Anchors must be **unique across the specs and proofs trees together**, not just within their file — grep-ability and unqualified citations from test code depend on it. When a natural name would collide or is generic enough that another domain could plausibly want it, flavor it with its domain (e.g. `^updates-test-hooks`, not `^test-hooks`).

Specs can also mention each other by file name, e.g. "filesystem handling follows policy from `[paths.md](paths.md)`".

This extends to a spec's code-like files — templates, stylesheets, YAML — and not only its markdown. One reference form throughout is worth more than a link that opens for some targets and not others.

A directory is not a reference target — there is nothing to open — so name it in code font (`shared/`) rather than linking it.

**Referencing a value.** A spec's prose often needs to name a value living in one of its code-like files — a YAML key, a custom property, a template parameter. Reference it as a link like any other reference: the file, `#`, and the value's own path within it. A bare `#` marks a value this way, where `#^` marks a block ref.

`[drag.yml#autoscroll.zone_px](drag.yml#autoscroll.zone_px)` · `[styles.css#--page-gap](styles.css#--page-gap)` · `[measures.yml#artifact.min_width_px](measures.yml#artifact.min_width_px)`

A nested YAML key is written as its dotted path from the file's root, and a custom property keeps its leading dashes. Non-unique basenames take a path, as everywhere else — `styles.css` and `measures.yml` always do. Where a value is set in more than one file, reference the one the prose means. The reference stands where the value would, so the sentence still reads as the statement it makes; prose that means the thing rather than its value names it in words and links the file instead.

### File size and hierarchy

Spec hierarchy is flexible: whatever keeps each spec coherent and readable. Aim to keep a spec under a few hundred lines. If it gets too long, consider how to decompose it cleanly along boundaries of authority.

### Layout

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
  guides/                 guides for users and administrators
  working/                documents for work in flight; empty on main
  archive/YYYY-MM/        working documents included with a merge
```

## Review discipline, not procedural enforcement

Spec tree integrity comes from clear authority and from review — by humans and by agents doing spec reviews — not from CI gates, coverage counters, or vocabulary linters. The rules above are policy that intelligent reviewers apply, not dumb machinery.

Reviewers apply this policy in both directions. A reviewer asks whether a spec change is missing something that belongs, and also whether it adds something that does not. A finding that a statement is over-specified, such as a value chosen only to make the implementation work, is as valid as a finding that a decision is missing. Most over-specification enters while a spec change is being written and reviewed, when each request for precision is easiest to answer with more text.

Two exceptions are procedural: `index.md` is generated, and reference integrity — link form, target existence, block-ref existence — is enforced by a repo test.

## Exceptions and other kinds of document

### Specific specs may state exceptions

Authority is a hierarchical cascade. A general policy — this document, the testing policy, any cross-cutting spec — binds by default, but a more specific spec, owning a narrower area, may state an explicit exception, and within its area that statement is authoritative. The most specific spec that addresses a point wins. A deviation must be stated; silence inherits the policy.

*Examples.*
- The testing policy requires that every principal user path be proven by an acceptance test. A spec for a system with many branching paths may judge that several carry diminishing return, and choose to prove the principal ones and leave the rest unproven. That choice goes in the spec's testing guidance.
- An exemption from human review exists only by explicit architect decision for an individual spec. An architect may decide that a particular spec is governed by agent review instead, for instance where its subject is dense enough that adversarial review between capable models maintains it better than a human line review. The exempt spec declares that decision in its own header and names the review model that applies.

### Documents without authority

- `developer-skills/` is the editable source of developer guidance, installed into the developer's home under [developer skill distribution](arch/developer-skills.md). Workflow and setup skills explain how to apply the required workflow and setup procedures in specs; they do not establish or override them. Writing skills are incorporated as authoring guidance above.
- `docs/` holds guides, working documents, and the archive under [spec-docs.md](spec-docs.md). Guides follow the applicable specs; a specific owning spec may explicitly grant a guide authority over its procedures. Working documents and the archive have no standing.
- Files kept verbatim because a shipped version of the product depends on them, such as a frozen copy of resources a released version served, are not specs. They are what that version shipped, restating their sources by design.

### Runbooks

A *runbook* is a spec document stating an operational procedure step by step — how a human or agent performs a process the system supports, such as publishing a release notice or standing up an environment. A runbook is **derived** authority: it is authoritative for the *process* — the steps, their order, the checks between them — but the process is implicit in the mechanism specs it exercises. Every step must be derivable from those specs and cite them. On any conflict, the mechanism specs win and the runbook has the bug. A runbook has no proof: a procedure is validated by being executed. ^runbook-type

A runbook lives beside the arch specs of the area whose mechanisms it exercises, named with a `runbook-` prefix; a runbook spanning multiple areas lives at `arch/` root. ^runbook-location

### Explainers

An *explainer* is a derived spec document that explains one concern owned across several specs from start to finish, for a person who wants to understand how it works. It may restate those specs so the reader can follow one coherent account. The owning specs win on any conflict, and an explainer has no proof. ^explainer-type

An explainer uses an `explainer-` filename prefix and lives beside the architecture specs for its concern, or at `arch/` root when it spans several areas.

### Transitional status

The project was not originally authored under this policy and is being migrated one step at a time, so authority is mixed. Specs are authoritative where defined; otherwise code is the authority. While specs are adopted incrementally, a spec or a section within one may indicate a status such as `draft` or `incomplete`. Overall transition state is tracked in [spec-migration.md](spec-migration.md).

While the implementation has not yet conformed to a spec, that spec may carry **implementation notes**: transitional annotations addressed to agents implementing against it — what happens to specific existing tests when the conforming work lands, known traps in the standing suites, coverage context an implementer could not discover alone. An implementation note is not authority and can state no rule; it rides directly next to what it annotates, as a blockquote beginning with the fixed phrase `**Implementation note (transitional):**`, and it is removed by the work that consumes it. When the system conforms, a search for that phrase finds nothing. ^implementation-notes

The goal state is to have no status: everything in `specs/` is current authority, and all essential behavior is covered.

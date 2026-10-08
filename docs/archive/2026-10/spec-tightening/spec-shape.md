> **Archived 2026-10 from PR #25.** This was the working record used to sharpen the spec policy: real passages from the specs that the draft standard did not settle, each with the ruling it received. `specs/spec-policy.md` followed it with deviations in wording, and states the outcome only as principles; the passages and the rulings on them are found here and nowhere else. The body below is unchanged from its working state and is a clue to the change, not a record of it.

# What belongs in a spec

Working document for the spec-tightening exploration on `thopter/spec-tightening`. It has no authority. It tries to state a tighter standard for what Television's specs should contain, compares the current specs against that standard, and collects real passages that test the standard and need a ruling.

What this document builds is called the **sharper spec policy**: a proposal for a clearer statement of what belongs in a spec. It changes no spec until the proposal is accepted.

The workflow stays as it is: specs are the human-owned authority, proofs derive the test plan from them, UI specs own markup and CSS, and tooling is spec-governed. This document is only about what each spec says and how deeply it says it.

## Working standard

### What a spec contains

A spec contains at least the following. The list is not closed.

- **Design intent:** what the product is for and how it should feel and behave for the person using it.
- **Architectural decisions:** the choices that shape the implementation and that a human wants to own.
- **Contracts:** the points where the product touches something outside the code of a single version. Changing one is allowed, but the change has consequences that must be thought through: a migration, compatibility with running copies of an older version, or what happens to data already written. Contracts include:
  - stored data: paths in the user's Television home, `localStorage` keys and value formats, state file shapes;
  - messages between processes and between versions, such as a desktop shell talking to a page served by a newer server;
  - external systems, such as the update channel URL, the npm package, and the telemetry events that analytics depends on;
  - people and agents, such as CLI commands and their output, and the elements that artifacts may use.

Paths in the source tree, private field names, internal function signatures and module layout are not contracts. They can be refactored between versions without consequences, so code governs them.

### Language for the core concept

The core concept is still being named, so this document keeps several terms in use. The intent behind all of them: a contract is the shape of whatever Television exchanges with something on the other side of a boundary, where the other side depends on that shape and a change has consequences it must absorb. The other side is broad. It includes the browser and its storage, the people and agents who write themes, manifests and artifacts, external services such as PostHog, and other versions of Television itself, including the version that wrote data a later version reads. "What other versions depend on" is the most common case.

Candidate terms, and what each emphasises:

- **Process boundary,** in a broad sense: any separately running thing, including the browser, a person or agent editing files, and an external service. Familiar, but easily read narrowly as operating-system processes.
- **Counterparty:** names who is on the other side, and pairs naturally with "contract".
- **Actor:** the requirements-engineering term for anything outside a system that interacts with it. Well known, but less tied to the idea of a contract.
- **System boundary:** names the line rather than who is beyond it. Harder to use in a sentence.
- **Contractual touchpoint:** names the place where Television meets the other side.
- **Outside the running build:** emphasises version skew. Judged not to capture the concept fully, because it frames the boundary around builds rather than around who depends on the shape.

### Tests for whether a statement belongs

These two tests are useful but probably not the only ones.

1. **Consequence beyond one version's code.** If changing it affects stored data, other versions, other processes, external systems, or the people and agents using the product, it is a contract and belongs in the spec.
2. **Plausible divergence.** If it is not a contract, ask whether a competent implementer, given the intent, might plausibly do something different in a way a human would care about. If so, it is a decision and belongs in the spec. If not, it is derived during implementation.

### What the rulings so far show

This section records the reasoning behind the rulings on the hard cases. It guides judgment; it is not a rule set. Each ruling was about a particular passage, and its examples show how the reasoning played out there. The examples are not categories to apply across specs: a timeout, a sort order, a failure path or an error message may or may not belong, depending on what it means in its context.

- **Why a statement belongs.** A statement earns its place when a human needs to own it. That happens because something depends on it (a contract), because it records a choice an implementer might not make (design intent or an architectural decision), or because it preserves knowledge that would otherwise be lost (a regression case, an accepted defect, an answer to an objection an implementer can be expected to raise).
- **How much to say.** Say as much as the thing needs in order to come out right. The more obvious a behaviour is to a competent implementer, the less it needs. A contract is described as far as the other side relies on it.
- **Present behaviour.** Specs describe the product as it is and what it requires now. Mechanisms and capacity nobody uses are generally left out, though a designer or architect may include one they judge important.
- **The kind of content is not the deciding factor.** What decides is what the statement means in its place. In the sidebar-width paragraph (hard case 3), the rounding, the timing of the write and the failed-write handling protected nothing anyone depends on, so they were over-specified there. A data migration's failure behaviour is different: never leaving a half-written record is a promise to the user about their data. The same reasoning reaches opposite answers.
- **Specialisation.** When Television builds something itself that lies outside its purpose, such as classifying user agents, the spec tends to inherit that work's detail. Using a library keeps the spec on the outcome wanted.
- **Settings in outside services.** When a product promise depends on how an outside service is configured, such as PostHog's privacy settings, that configuration is a contract of its own kind. No Television code carries it out; a person keeps it in place.
- **Reviewers enforce the policy in both directions.** Reviewing a spec change includes checking what is being added, not only what is missing. A finding that a statement is over-specified and does not meet the policy is a valid review finding. An example: a timeout written into a spec when it is an implementation detail. The cascade itself is unchanged: when implementation reveals a genuine product behaviour or architectural decision, it moves into the spec. Most over-specification enters while a spec change is being written and reviewed. The sidebar-width paragraph grew from "an integer pixel width" in its proposal to "rounded to the nearest pixel on commit (ties round up)" by merge (#375 in the pre-release archive).
- **Regression cases** go in a `### Regression cases` subsection of `## Testing`, and each says why it exists, because their purpose is to preserve knowledge.

### What does not belong

- **History:** retirement records, accounts of earlier designs, and narratives of how a choice came about. Commit messages and the archive carry these. Answering an objection a reader or implementer can be expected to raise is not history; it belongs, like an accepted defect.
- **Ownership preambles beyond orientation:** sections listing what a spec owns and does not own, and pointers to the specs that own neighbouring concerns, when they restate what the spec's own content already makes clear.
- **Testing sections that restate the spec's promises.** A proof derives its test plan from those promises without help.

### What a testing section is for

A testing section says only what a proof writer could not derive from the spec's promises:

- architect rulings on how something must be tested;
- coverage a tester would likely omit or miss;
- regression cases that must be preserved and would not otherwise come up, each saying why it exists. Implementation traps belong here, written as the behaviour that must keep working;
- where coverage that seems to belong to this spec is owned by another spec, so a proof author neither duplicates it nor goes looking for it.

### Opening of a spec

A spec opens with its one-line description, which builds the spec index, followed by an introduction that orients the reader: what this spec is about. How the introduction is written is left to the author's judgment; the policy prescribes no further structure for it, such as separate plain-English and central-model parts or a list of what the spec owns. The "Plain-english intros" rules in today's `spec-policy.md` are not part of this standard and would be replaced by this paragraph.

## How the current specs compare

Measured on `origin/main` at `e81bfc74`:

- **Size:** 213k words of spec prose in 132 Markdown files, plus about 138k words of proofs.
- **Testing sections:** 87 specs have a `## Testing` section, totalling about 17.8k words (8% of spec prose). A first reading suggests most of it restates promises or says which other spec proves something. A Linear ticket already covers cutting these sections back.
- **Ownership sections:** 43 specs have a `## What this owns` section. Headed ownership sections total about 6.5k words; inline "owned by" pointers add more that has not been counted.
- **History:** a rough search finds history-like wording in 29 files. Examples are the Blacksmith retirement record in `arch/test-runner/github-ci.md` and the retired-name list in `product/cli.md`. Some hits will be false positives.

Five agents read every area of the specs before this standard was written. They judged that, in most areas, 35–50% of the body text could be derived by a competent implementer. Their judgement treated storage keys and data paths as internal details, which this standard does not. So those figures overstate what the standard would remove, and the area-by-area comparison needs to be redone against it.

## Pinned TypeScript types

`spec-policy.md` tells arch specs to pin "the types and data shapes, and the function signatures that callers across a module or package boundary depend on." Hard case 1's ruling moves that line from the module boundary to the boundary described under "Language for the core concept": a type is pinned when something on the other side of it depends on its shape.

### Current inventory

The specs declare about 162 named types in TypeScript blocks across 29 arch specs; inline types in prose are not counted. Sorted roughly by whether anything outside Television's own running code depends on their shape:

| Something on the other side depends on it (about half)                                                                                                       | Nothing outside depends on it (about half)                               |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| Layout and channel records, the legacy layout shapes read by migration, onboarding state files, `TelevisionConfigFile`, navigation history in `localStorage` | `CLIEnvironment`, `CLIServer`, `CLIDaemon` and their options             |
| Bridge messages between the app and artifact documents                                                                                                       | `InstallBridgeOptions`, `ArtifactPollCadence`, `ArtifactFrameTrustState` |
| Update channel document, `DesktopConnectCheckResponse`, `ServerStatusMessage`                                                                                | Desktop runtime validation and e2e harness planning types                |
| Telemetry event names and properties sent to PostHog, client telemetry signals sent over the websocket                                                       | Telemetry sink, transport and capture-context types                      |
| Theme manifest, theme pointer messages, bundled-theme state                                                                                                  | `ItemEdgeFadeOptions`, most licensing-tool types                         |
| The test runner's stored timing baseline                                                                                                                     | Test runner plan, shard and report types used within one run             |

Some separately running parts always ship and start together from one build, such as the test runner's orchestrator and its shard workers, or Electron's main and preload processes. A shape exchanged only between them can change in lockstep, so nothing on the other side depends on it in the sense that matters.

### Proposed wording

Pin a type when something on the other side of it depends on its shape: stored data that another version may read, another running part that may be a different version, people and agents who write files Television reads, the browser, or an external service. A type exchanged only within Television's own running code is internal, even across a module or package boundary, unless the architect chooses to pin it.

Under this wording, roughly half of the currently pinned types would come out of the specs. The largest groups are the CLI's dependency-injection types, the test runner's planning types, the telemetry pipeline's internal types and the desktop harness types.

## Hard cases

Each case is a real passage that the standard does not settle cleanly. Each one needs a ruling, and the ruling may change the standard.

### 1. TypeScript types between modules of the same version

`arch/cli/index.md:17-22` pins `CLIEnvironment`, the dependency-injection type that tests pass to `runCLI`. `spec-policy.md` (section "TypeScript in arch specs") tells arch specs to pin "the function signatures that callers across a module or package boundary depend on."

**Why it is hard:** under test 1 this is not a contract, because modules of one version are built and shipped together and can change in lockstep. The spec policy treats boundaries inside one version as contracts anyway, because exact types prevent ambiguity between the people and agents working on each side.

**Question:** is a boundary inside one version a contract, or does a type belong in a spec only when it crosses a version, a process or a person?

**Ruling:** TypeScript types need judgment. Types for stored data, API and CLI responses, and client-server protocols are contracts. A type like a file watcher's return value is not, because the product makes no promise about a shape that exists only inside its own runtime. A type is pinned when something on the other side of a boundary depends on its shape, in the broad sense described under "Language for the core concept"; the term for that boundary is still open.

### 2. User-visible behaviour an implementer would probably get right

`product/tab-pages.md:42`: "When the selected page is removed, selection moves to the page now at its position, or to the preceding page when the removed page was the last; a channel emptied of pages has no selection."

**Why it is hard:** it is not a contract, and most implementers would make this choice. But it is behaviour the user sees, and specs are meant to hold the product's design intent.

**Question:** does every user-visible behaviour belong in a product spec, or only behaviour that passes test 2?

**Ruling:** user-visible behaviour belongs in the spec when an implementer might not choose it, which is a judgment call. The same judgment sets how much detail it gets: the more likely a behaviour is to be implemented correctly, the less explanation it needs.

### 3. A contract with a derivable detail inside it

`arch/channel-state/index.md:59`: the sidebar width persists under `tv-channel-sidebar-width` as "the committed width in whole pixels as its base-10 integer string, rounded to the nearest pixel on commit (ties round up)."

**Why it is hard:** the key and the value format are a contract, because older and newer clients read the same stored value. The rounding rule is not a contract, because a stored value is whole pixels however it was rounded.

**Question:** when a contract is written down, should the spec trim it to the part that persists, or is the surrounding behaviour part of the contract?

**Ruling:** in this paragraph, keep what other versions depend on: the key, the value format, and how any version reads a value it did not write. Here the rounding rule, the timing of the write and the handling of a failed write protect nothing that depends on them, so they are over-specified. The ruling is about this paragraph, not about rounding, write timing or failure handling in general.

### 4. Accepted defects

`arch/artifact-frame/artifact-bridge.md:265`: "One association gap is accepted at same-element document changes. A no-GUID side-effect message … posted by a departing document just before a swap can be delivered after the reset."

**Why it is hard:** accepting a known flaw can be a genuine human decision about risk. Written into the spec, it reads as a permanent property of the design and grows with each review that finds another edge.

**Question:** does an accepted defect belong in the spec, in a ticket, or in the testing section as a case the suite deliberately does not prove?

**Ruling:** accepted defects belong in the spec, generally in lightweight language.

### 5. Mechanisms and capacity nothing uses yet

- `arch/artifact-frame/artifact-bridge.md:275` tracks document readiness, "accepted because readiness gates nothing."
- `arch/layout/index.md:50` keeps stored pages able to hold several artifacts although only one is shown: "the container already holds multiple artifacts so that later milestones extend `PageGeometry` without touching stored membership."

**Why it is hard:** the layout shape is stored data, so test 1 makes it a contract even though no UI can produce the unused capacity. Readiness tracking is neither a contract nor a behaviour anyone can observe.

**Question:** should a spec describe capacity built for future work? If the stored shape must stay, can the spec state the shape without the reasoning about future milestones?

**Ruling:** avoid them by default. Specs represent current product behaviour and requirements, so unused behaviour is not specified. A designer or architect may still choose to include one they judge important.

### 6. Rules that stop something from coming back

- `arch/desktop/runtime.md:69`: "Electron 43's package tree and lockfile contain neither `yauzl` nor `fd-slicer`; this negative boundary prevents reintroducing the extraction path that can report a successful npm install over an incomplete runtime."
- `product/cli.md:558` lists thirteen retired command names that the CLI must not expose.

**Why it is hard:** both read like history. But the runtime rule protects against a real failure, an install that reports success over a broken runtime. The retired names might matter to agents whose installed skills still mention them.

**Question:** is a "must not return" rule a decision worth keeping, a regression case for the testing section, or history to delete?

**Ruling:** these are orders for regression tests and can be listed lightly. Each spec may need a section for regression cases that preserve knowledge which would otherwise be lost; the name and placement are still open.

### 7. Timing values, and where rationale turns into rebuttal

- `arch/updates/update-channel.md:59`: poll every 5 minutes with 0–1 minute of jitter. The same section says "There is no thundering herd to defend against… even the interval jitter is not actually needed. It is kept purely as belt-and-suspenders."
- `arch/desktop/e2e-harness.md:73`: "Each launch phase has an eight-second timeout."

**Why it is hard:** the poll interval decides how fast a release reaches users, which is product intent. The jitter explanation answers an objection nobody raised. The harness timeout is a tooling value that a competent implementer would pick and tune.

**Question:** which timing values are decisions? Where is the line between useful rationale, which the spec policy welcomes, and a rebuttal, which is history?

**Ruling:** the kind of value is not the axis. Some timing values are product promises or deliberate design choices whose revision would be a team decision; most timeouts are implementation detail, and a timeout can still be a contract for a public API or the CLI. The thundering-herd passage belongs: it records that upgrades are user-initiated per installation and answers an objection update-channel implementers would typically raise.

### 8. How deep a tooling spec should go

`arch/test-runner/sharded-execution.md:176`: "The model must be revised before any shard-count increase, or earlier when three consecutive successful broad runs on one timing provider show either (a) fixed surface phases above 10 seconds or 10% of the critical shard…"

**Why it is hard:** tooling stays spec-governed so its principles survive. This passage is not a principle, though. It is a maintenance trigger for an internal cost model, written at algorithm depth.

**Question:** for tooling, what is the equivalent of design intent and contracts? Is it the goals, the guardrails and the trust model, with algorithms and thresholds left to derivation?

**After rulings so far:** hard case 7's ruling largely settles this. The revision thresholds are values chosen to make a tool work and tuned when they do not, so they are implementation. The stored timing baseline is a contract, because later runs read what earlier runs wrote. What remains is to say what a lighter tooling spec keeps: probably its goals, its guardrails, its trust model and its stored or exchanged shapes.

**Ruling:** tooling needs no special case. A tooling spec follows the same standard as any other spec. Its other side is the developers, agents and CI that use the tool, plus anything it stores for later runs. Here the revision thresholds are values tuned to make the tool work, and nothing depends on them, so they read as implementation.

### 9. One paragraph mixing a privacy rule with ordering detail

`arch/themes/index.md:97`: "Valid themes sort by `name.localeCompare(other.name, "en")`, then by `id.localeCompare(other.id, "en")`. … Directory and package errors contain no absolute filesystem path."

**Why it is hard:** the last sentence is a privacy rule and clearly belongs. The sort order is visible in the UI and the CLI, so it could count as a contract with users, or it could count as derivable presentation.

**Question:** is the order of a list a contract?

**After rulings so far:** the privacy rule stays. The sort order is user-visible behaviour most implementers would get right, so under hard case 2's ruling it needs at most a short statement such as "themes are listed by name". Exact comparison functions and tie-breaks are over-specified unless something on the other side, such as an agent reading CLI output, depends on the order.

**Ruling:** results should be sorted, and the natural key is the name or folder. That is spec content, stated very briefly. Here the tie-breaks and exact comparison functions are over-specified: nothing on the other side depends on a particular item coming first, only on consistent output a person can scan.

### 10. An implementation trap written as a UI rule

`ui/app/stage/index.md:22`: "Lit's `keyed()` directive must not own this replacement boundary". The paragraph explains that `keyed()` makes nested views miss `disconnected()` and leak.

**Why it is hard:** under this standard the trap becomes a regression case in the testing section. A possible wording: "Changing channels disconnects every stateful view in the old filmstrip, including nested views." The open point is whether naming the library mechanism still helps the reader.

**Question:** should regression cases describe only the behaviour, or may they name the known cause?

**After rulings so far:** hard case 6's ruling settles the placement: this becomes an entry under `### Regression cases`, with the behaviour that must keep working and a short note on the failure it prevents. Proposed entry: "Changing channels disconnects every stateful view in the old filmstrip, including nested views. Replacing the filmstrip with Lit's `keyed()` directive breaks this and leaks subscriptions." What remains is to confirm that naming the known cause is wanted.

**Ruling:** this is a regression case. Regression cases say why they exist, because their purpose is to preserve knowledge.

### 11. Preambles that state scope four times

`product/channels.md` opens with:
1. a one-line description;
2. a status line naming a ticket;
3. an introduction that already says what the spec does not cover ("not how the channel sidebar draws them");
4. a `## What this owns` section listing the same exclusions;
5. a `## What a channel is` section defining the subject again.

**Why it is hard:** the spec policy requires a plain-English introduction, which is useful orientation. The other layers repeat it.

**Question:** what is the minimum opening? One candidate is the one-line description plus the plain-English introduction, with a `## What this owns` section only when ownership would not be obvious from the content.

**After rulings so far:** still open. Josh has said preambles are often bloated; the minimum opening still needs a ruling.

**Ruling:** a spec opens with its one-line description, for the index, then an introduction or orientation saying what the spec is about, written with judgment. Prescribing separate parts, such as a plain-English introduction followed by a central model, over-specifies the structure. "What this owns" sections appear only when ownership is not obvious.

### 12. A testing section that is partly right

`product/channels.md` (section "Testing") contains two kinds of material.

Directives a tester could plausibly miss:
- "Every shared-state acceptance case must use two connected clients, with the change reaching the second client without a reload."
- Deletion acceptance must "inspect the real server storage, a referenced filesystem path, and a referenced remote resource after cancellation and confirmation."

A closing paragraph that only says which other spec proves what.

**Why it is hard:** a blanket cut of testing sections would lose the first kind.

**Question:** confirm that the two directives above are the kind of content testing sections should keep.

**After rulings so far:** the ruling on what testing sections are for covers this: the two directives are coverage a tester would likely miss, and the closing paragraph is routing that can go. It only needs confirming.

**Ruling:** testing sections hold only what a proof author or test implementer would likely miss, and directives from the designer or architect about what to test or how. Restated promises do not belong, and neither do general statements of what other specs and their proofs contain. One further purpose: because specs are a network of overlapping concepts, a testing section says where coverage that seems to belong to this spec is owned by another spec. The closing paragraph of `channels.md` is that kind of statement (it says the channel-state spec proves the ordering of removals and the app shell owns the disconnected state), so it may stay.

### 13. Settings that live outside the code

`arch/desktop/distribution.md:72`: "The app's **Allow releases without a security token** setting in the ToDesktop dashboard stays off."

**Why it is hard:** none of the three named categories covers this well. It is a security decision about an external service's configuration, and no code in the repository shows it. It supports the view that the list of what a spec contains is open.

**Question:** should external configuration and operational decisions be named as their own category?

**After rulings so far:** under the broad view of the boundary, ToDesktop is on the other side, and the product's release security depends on that setting. So this may count as a contract with an external service, not a new category. Still to decide: is that framing enough, or should operational decisions be named in their own right?

**Ruling:** settings in outside services belong in specs when the product's promises depend on them, such as PostHog's privacy settings. They are contracts with external services, but a special kind: no Television code carries them out, and keeping them requires a person to administer the other service by hand.

### 14. When test 1 pulls in too much

`arch/telemetry/derivation.md:18` says how user agents are classified, including that "`HeadlessChrome` and `CriOS` classify as Chrome."

**Why it is hard:** analytics compares data across versions, so changing a classification rule changes the meaning of historical data. That passes test 1. But a spec holding every classifier rule is the kind of depth this exploration is trying to remove.

**Question:** does test 1 need a threshold, for example "a consequence a human would want to think through", or does analytics data deserve a lighter class of contract?

**After rulings so far:** the reasoning from hard case 3 applies. Analysts depend on the set of values and what each means, such as "the client's browser vendor", so that vocabulary is the contract. The parsing rules that produce a value correspond to the rounding rule in case 3, so they are over-specified. Some classifications change what a value means; whether "headless Chrome counts as Chrome" is one of those is a judgement for the spec author.

**Ruling:** confirmed, with a further point. Specifying every user agent and its classification would be over-specification, and the cause is writing our own classifier. Television's specialisation is being a window manager for agents, not identifying user agents, so a third-party classification library should collapse the values for us. The spec then states the categories wanted. Where Television does process user agents by hand, the spec has to say what is wanted; literal regular expressions are over-specified unless they capture a product decision.

### 15. Process instructions in the governance specs

`spec-workflow.md:158`: "Every compaction must preserve the exact letters X H I G H (`xhigh`), including compaction of an already compacted summary…"

**Why it is hard:** it guards against a real failure, agents silently lowering review effort after a context compaction. It is an instruction to agents rather than a statement about the product or its workflow.

**Question:** do the governance specs follow the same standard, and does agent-behaviour enforcement of this kind belong in a skill instead?

**After rulings so far:** still open. Hard case 2's ruling on detail suggests emphasis is justified where agents are known to get it wrong, and agents do change review effort during compaction. The rule probably stays, in fewer words. Whether instructions about agent behaviour belong in governance specs or in skills is still to decide.

**Ruling:** the question was misplaced. Extra-high reasoning effort for implementation and reviews is an architectural policy decision that Josh wants strongly enforced, and the workflow spec is explicitly about agent behaviour and governance, so the rule is spec content. The compaction wording exists to keep that value intact when an agent's context is summarised.

### 16. Temporary authority documents

`arch/telemetry/server-telemetry-buffer.md:3`: "temporary authoritative buffer for telemetry's impositions on unmigrated server modules."

**Why it is hard:** it holds real decisions while server specs do not exist. The document type exists only because migration to specs is incomplete.

**Question:** keep buffer documents as a transitional tool, or require decisions to sit in the closest existing spec?

**After rulings so far:** still open, and less about how much a spec says than about which kinds of document exist. That makes it closer to a workflow question.

**Ruling:** spec buffers are part of the workflow and stay. Out of scope for this exploration.

## Second pass: three areas against the revised standard

Three agents re-read the core artifact and channel model, the CLI, and the test runner with the testing policy, applying the standard as it stood after the sixteen rulings. Their estimates:

| Area                                                                                                                                                                                 | Spec words now | After (estimate) | Proof words that would go                                                  |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------- | ---------------- | -------------------------------------------------------------------------- |
| Core model: 12 specs (product artifacts, channels, tab pages, navigation, keyboard; arch channel-state, layout, migration, artifact frame, bridge, reload-navigation, proxy caching) | 22.2k          | 12.8k (−42%)     | 10–60% per spec; most in the artifact-frame specs                          |
| CLI: `product/cli.md`, `arch/cli/*`                                                                                                                                                  | 15.1k          | 7.9k (−48%)      | about 25–30% of the product proof; about 60–65% of the 11k-word arch proof |
| Test runner and testing policy                                                                                                                                                       | 33.9k          | 20.5k (−40%)     | 10–40% per spec                                                            |
| **Total**                                                                                                                                                                            | **71.2k**      | **41.2k (−42%)** |                                                                            |

Where the cuts fall:
- **Core model:** mostly internal detail in the artifact-frame specs: private names, internal types, pseudocode, and the history model restated at code depth. Also opening ceremony, and the readiness mechanism.
- **CLI:** mostly the arch spec: dependency-injection types, the Commander error-code table, the per-command client-call table, build steps and source paths. The agent-facing product contract stays almost whole.
- **Test runner:** tuned values, internal report types, history (retirement records, run-number narratives), and the same rules restated across several specs. Retry rules appear in four specs, and the rule never to enumerate `.test-runs` appears in three.

### What the standard would add

- **Contracts the specs do not name:**
  - `arch/channel-state/index.md:158` promises users stay signed in across the upgrade, but no spec names the `localStorage` key or format the auth token is stored in.
  - The installed service definition (`arch/cli/index.md:295-310`: the `--home <abs> serve` arguments and the names of the saved environment variables) is written as construction detail, though later versions run it after an upgrade.
- **Regression cases currently buried in body text:**
  - **Bridge:** injected functions use no closures or imports, because they are serialized with `Function#toString`; no `crypto.randomUUID()` in plain-HTTP producer pages; the preload handles a document that has already loaded.
  - **CI and test infrastructure:**
    - a job-level `if` hides matrix check names;
    - `continue-on-error` makes a failed job read as success to the jobs that depend on it;
    - the artifact transport strips the executable bit;
    - Vitest treats positional file filters as substrings;
    - the real-stack surface needs one worker.
  - **CLI:** the thirteen retired command names.

## Hard cases, second round

The leanings below show how the principles apply to each passage. They are not adopted decisions. Whether a passage can be removed is settled when its spec is trimmed, and some passages need a product decision that the policy cannot answer.

### 17. A contract whose break is accepted

`arch/artifact-frame/artifact-bridge.md:349` and `:128` call the bridge messages a "private wire shape" and make cross-version compatibility a non-goal. But a shared artifact's document runs its producer's bridge, which may be a different Television version.

**Readings:** (a) compatibility is disclaimed, so the shapes are internal; (b) the shapes are a contract, kept in full.

**Leaning:** keep the shapes as a contract, and state that breaking them is accepted. Changing one silently turns off chord forwarding and freshness polling for older or newer producers. That is the consequence test 1 asks someone to think through, even when the answer is to accept it. Drop the word "private".

**Ruling:** open.

### 18. A spec that calls its own mechanism unused when it is not

`artifact-bridge.md:275` says readiness tracking is "accepted because readiness gates nothing", which the ruling on unused mechanisms would cut. But `:299` says clearing the lifecycle window stops a stale `navigation-request` from writing "a bogus history entry", which a user would see.

**Leaning:** keep the outcome in one sentence: stale messages from a departed document never change trust or history. Keep the GUID in the wire messages. Drop the trust-state type, the pseudocode and the groundwork rationale. The standard may need a note that a spec's own "unused" label is itself something to check.

**Ruling:** open.

### 19. Failure handling that is itself the promise, and how long migration inputs stay contracts

`arch/layout/migration.md:23`, `:74-83` and `:98`. For a migration of user data, the guarantee *is* the failure behaviour: never leave a half-written record, never merge or guess, stop boot on conflict, and resume safely. Separately, `arch/layout/index.md:82` says "a new server must be able to migrate old versions of the state file" with no end date. The CLI has the same pattern in code that handles what earlier releases left behind: the warning about the old environment variables (`product/cli.md:140`), the transitional service path (`:163-177`), and removing `tv-theme` during skill install (`:527`). All of this is written as history but describes current behaviour.

**Leaning:**
- The failure behaviour is a promise to the user about their data, so it belongs. How it is achieved, such as where the temporary file goes and which rename commits, probably does not.
- Write compatibility code in the present tense ("an environment containing `TELEVISION_PORT` gets this warning"), with a ticket for its removal. It is not a regression case, because the aim is to remove it eventually.
- How long old formats and versions stay supported is a product requirement, decided in the product's own specs. It is not a question for spec policy.

**Ruling:** the failure behaviour belongs because it is a promise to the user about their data. The support lifetime is out of scope for this exploration, which establishes spec policy, not product requirements.

### 20. Plans for the future

`artifact-bridge.md:9` has a "Refactor earmark … Treat the refactor as planned work". Roadmap tickets appear in `product/artifacts.md:75` and `arch/artifact-frame/index.md:41` (TV-524, TV-525), and in `product/tab-pages.md:35`. These are neither history nor unused mechanisms.

**Leaning:** a ticket link stays only where it marks an accepted defect, such as TV-732 (a shared folder does not refresh sub-page changes). Roadmap items and proposed refactors move to tickets, because in an authority document they steer implementers before anyone has ruled on them.

**Ruling:** specs are not a backlog. Refactor plans, plans to split a spec, lists of future features and deferred design questions are dead weight and go; they are tracked in Linear. Accepted limitations stay. A spec author may use judgment to include future context that helps derivation, such as marking a path as transitional so nobody builds on it (the TV-871 path). For a constraint that a planned change will remove, the constraint stays and the plan to remove it can go (the TV-507 note).

### 21. Testing directives that limit coverage

Three examples:
- `product/keyboard-navigation.md:46` "does not require a separate test fleet against older Television installations";
- `arch/artifact-frame/index.md:48` "Tests do not need to prove that recreation occurs";
- `product/artifact-navigation.md:53` "does not require a Forward acceptance case in Electron".

Similar statements set the scope of what is pinned, for example `product/cli.md:95` on error wording that is "not yet normalized". None of the listed kinds of testing content covers these. They stop proof writers over-testing, which reviews do produce.

**Leaning:** name them explicitly as a kind of architect ruling: rulings that limit coverage, one line each. Write scope statements as scope ("only the error texts given here are pinned"), without the future-work framing.

**Ruling:** open.

### 22. Exact wording of error messages

`product/cli.md:146` pins a refusal message character by character: options "each once, in the order they first appear, separated by `, `". Lines 252, 260-261, 326 and 379 pin other error strings verbatim. CLI output is a contract, but agents read error prose rather than parsing it the way scripts parse JSON or exit codes.

**Readings:** (a) all output is contract and stays verbatim; (b) only output a machine might match on is contract: JSON, exit codes, success lines, perhaps `Unknown tv command:`. For prose errors the spec states what the message must convey: name the file, the problem and the fix.

**Leaning:** (b). Keep the recovery pointer verbatim, because its wording is a design decision for teaching agents.

**Ruling:** open.

### 23. Values that a failure or an outside system makes load-bearing

Two examples:
- `arch/cli/startup-bind-failure.md:70`: "`RestartSec` must remain at least approximately three seconds", so a bind-failure restart loop stays under systemd's default start limit. Otherwise the unit stops retrying permanently.
- `arch/test-runner/github-ci.md:115` sets `workers: 1` for the real-stack surface to stop a known failure from returning.

Both look like tuned values at first sight, but changing either breaks something, and the reason is visible in no Television code.

**Leaning:** record each as a regression case stating the behaviour that must hold and why ("a bind-failure loop never puts the unit into start-limit-hit"), and drop the exact number where it is not the point. The existing reasoning already covers this: something depends on each value, and the knowledge of why would otherwise be lost.

**Ruling:** open.

### 24. Tooling state on shared persistent infrastructure

This challenges the claim under "Pinned TypeScript types" that the test runner's orchestrator and shard workers always ship together. On Blaxel, three things cross versions:
- the coordinator can plan a commit other than its own checkout (`arch/test-runner/sharded-execution.md:138`), and the worker re-checks the plan digest (`:184`);
- lock files on the shared pool (`/tmp/tv-testshard.lock`, `owner.json`, `expiresAt`; `blaxel-testshards.md:27`) are read by other coordinators on other commits;
- owner tokens left on persistent workers are decoded by a later run's stale-owner scan (`test-runner.md:198`, `:214`).

**Leaning:** anything left on, or exchanged through, shared persistent infrastructure is stored data and a contract. Pin the plan shape the worker checks, the lock path and expiry field, and what the token encodes. Correct the table and sentence in this document once ruled.

**Ruling:** open.

### 25. Machine-readable output with unnamed readers

`arch/test-runner/reporting.md:108-369` pins `ReportSummary` and `events.ndjson` in full. Their readers are agents, `baseline update` (which reads run directories written by older commits), and "dashboards" (`:375`) that no spec names. "Only as far as the other side depends on it" needs a known other side.

**Leaning:** pin only what named readers use. Treat speculative readers like unused mechanisms: a reader added later brings its fields into the spec when it arrives.

**Ruling:** open.

### 26. Required manual checks against a ban on manual checklists

`arch/testing-policy.md:184` bans manual QA run-books "in any form". But `arch/test-runner/attestation.md:131` has the operator check behaviour on the first production runs, and `github-ci.md:128` requires the first production run on main to show the required check names. Both concern settings in outside services and credentials that no test can reach. This also bears on hard case 13: a contract kept by human administration needs some way to be verified.

**Leaning:** the ban is about checking how a UI looks. Live checks of external-service settings are coverage a tester would otherwise miss, and they are how administered contracts get verified. Reword the ban to say so.

**Ruling:** the ban is removed, with nothing in its place. Manual QA is legitimate where it is the only way to validate something, and there is precedent for it. The ban was meant to stop agents from pushing testable behaviour into manual checklists, but it overstated that as a hard prohibition. A rule that everything testable must be tested would not fix it either; it would demand endless tests. Proposed change: remove the paragraph ending `^ui-no-manual-checklists` from `specs/arch/testing-policy.md`.

### 27. Options of an entry point that is not supported

`arch/test-runner/blaxel-testshards.md:62-87` lists the Blaxel coordinator's options with "code-true defaults". But `test-runner.md:53` makes the canonical `npm test` surface the only supported entry point.

**Leaning:** only options reachable through the supported surface are a contract with people, and they belong in `test-runner.md`. The coordinator's own option table is internal.

**Ruling:** open.

### Flag for the architect: the bridge's review exemption

`artifact-bridge.md:7` exempts the bridge spec from human line review because it is "too dense for a human reader to audit". The second pass estimates the bridge would shrink from about 7.1k words to about 3.5k. Whether the exemption should then stand is the architect's call.

## Rulings

None yet. Rulings on the cases above are recorded here with the reasoning, and the working standard is revised to match.

## Notes from the first trial

A Codex agent (GPT-6 Astra) applied the draft policy to `specs/product/telemetry.md`; its report is `astra-telemetry-review.md`. Josh's responses:
- Examples in the policy need careful review, because an example can work against the principle it illustrates. Whether each one is needed at all is open.
- Telemetry straddles product and architecture, because the team and its dashboards are the users of telemetry. Whether an event's name sits in a product or an architecture spec is not important.
- Trimming needs careful human review, as noted under "Next steps".

## Out of scope

- **Proofs.** The sharper spec policy does not change proof policy. Proof weight is expected to fall as specs do. Some proof weight comes from the testing policy's per-assertion declarations, such as the stated test type and what each mock gives up, rather than from the specs. Whether that needs attention can be judged after trimming shows how far proofs shrink.
- **Support lifetimes and other product requirements,** such as how long old versions stay supported (hard case 19).

## Next steps

1. Define the core spec policy from the principles in this document, as a proposed revision of `spec-policy.md` and, where testing sections and administered contracts are concerned, the testing policy.
2. Use that policy to trim specs one at a time. An agent trimming a spec cannot always tell decisions a human made from detail an agent filled in, so every trim needs careful human review of what it removes. Each trim applies the policy with judgment and checks the spec's claims against the code. Where removing or keeping a passage depends on a product decision, the trim raises it with a human rather than deciding it.

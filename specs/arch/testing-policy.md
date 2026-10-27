*How Television is tested: coverage requirements, the fixture/mock distinction, the three test shapes and their declaration schema, and mock vs integration discipline.*

# Testing policy

This spec is authoritative for the project's testing authoring discipline. How tests are *executed* at runtime is governed by the test-runner specs under [test-runner.md](./test-runner/test-runner.md) and its companions.

## Scope during the spec migration

Television is mid-transition to a spec-driven workflow (see [spec-migration.md](../spec-migration.md)). Its test-authoring requirements govern only tests for code under spec authority. The test execution discipline below applies to all repository contributions; it does not adopt unspecified behavior or its tests into spec authority.

### Inherited tests

The suites predate this policy. When an area comes under spec authority, its specs document behavior that is already implemented and already covered by pre-policy tests — coverage judged good on its merits even though it was not authored to this policy's discipline. Such tests are **inherited**: the owning proof states the assertion and cites the standing tests by name as its evidence, marked *(covered by inherited tests: …)*. That citation form is distinct from the proof citation that replaces a *(test to be written)* marker, so inherited evidence is never mistaken for policy-grade proof; an assertion carrying it still counts as covered for the 100%-of-specified-tests rule. ^inherited-tests

Inherited is a terminal state, not a debt. The migration's goal is good coverage everywhere spec authority reaches — not retroactive compliance — so no upgrade is owed. Two rules govern the class over time:

- **Modification keeps the grade; replacement raises it.** An inherited test may be bent minimally when the behavior it covers changes, and it stays inherited. Coverage that is ripped out and rewritten is written to this policy in full. New coverage is never authored to the pre-policy bar. ^inherited-ratchet
- **Assertion identity is anchored.** Every assertion — policy-grade or inherited — carries a block anchor (the existing `^…-ac-…` style), so citations, dispositions, and task briefs can name it stably. The assertion text itself remains natural language. ^assertion-anchors

## Tests are the validation mechanism

This project is TDD via spec-driven development in which each spec's proof specifies its test assertions. Implementation work should be done via red/green TDD.

Tests are the fundamental validation mechanism for ensuring AI coding agents have produced the target behavior. Anything not covered by tests must be assumed to be broken.

Test assertions (language, not code) live in each spec's proof under `proofs/` ([spec-proofs.md](../spec-proofs.md)).

Implemented test suites always include 100% of the tests the proofs specify. They can and are encouraged to exceed that, but never undershoot it.

Test coverage is a network that can't always be represented per-proof. When one proof's assertions depend on coverage carried by other proofs — including coverage composed across clean module seams (see the *Compositional coverage across clean seams* section below) — its coverage model describes that relationship and names what it depends on.

Implemented tests never hollow out the intent of a test. Implementers must make a best-effort interpretation of the specified assertion's intent and be faithful to it, informed by the surrounding spec context. Interpretation should be pessimistic in terms of labor: assume the more inclusive test when in doubt. (If the spec is high-level product language, test assertions are likely to imply full unmocked e2e *acceptance tests* that walk the deliverable's spine (see the *Acceptance tests prove the spine; composition covers the breadth* section below). If the spec focuses on a specific contract-oriented module, tests typically focus on the logic of that module and warrant injected mock dependencies, but with detailed coverage of the module logic. Mock policy is described below — but if a module mocks dependencies, there must also be integration tests that cross those seams.)

Coverage and test honesty are judged by agent reviewers who read the production code path for an assertion, find the interactions with boundary seams, and confirm that at least one test runs over any given real path. There is no coverage threshold or automated coverage gates. The discipline lives in review, like the rest of the spec system.

If full test coverage would require extremely complex or numerous tests, that is a code smell that warrants refactoring toward the clean, minimal seams that make coverage composable rather than combinatorial (see *Compositional coverage across clean seams* below).

## Test iteration discipline

Test the narrowest thing that proves the change, then widen — never the other way around.

While implementing, run only the tests directly exercising the behavior under change (a file, a `--grep`, a surface). They are fast, focused, and tell you whether the thing you are working on is working. As that signal turns green and the behavior matures, widen the surface: the owning suite, then the full broad verification (`npm run verify`).

Broad runs are a **discovery tool, not your inner loop.** Use them to find what is failing somewhere else as a result of the change. The moment a broad run surfaces a failure, scope back down to a narrow test that reproduces it, get it green there, and only then re-run the broad verification. Don't iterate against the broad gate to chase a single failing test — each cycle is many minutes long, you stop seeing cause from effect, and you waste time the narrow test would have saved.

The work is not done until **broad verification passes fully green** on its own. A clean narrow run is necessary but not sufficient; an "almost-green" broad run is not done. See the test runner ([test-runner.md](./test-runner/test-runner.md)) for the selectors and providers that make this loop fast.

### Verification provider and completion

Run full verification with `npm run verify`. Without `~/.tvdev-use-blaxel`, verification runs locally without Blaxel checks or warnings, a bypass flag, or a separate permission requirement. The [runner’s provider selection](test-runner/test-runner.md#Verify orchestration) owns provider resolution.

On hosts with `~/.tvdev-use-blaxel`, Blaxel is the default and local full verification requires `--allow-extreme-inefficiency`. Agents must obtain explicit human permission before using that bypass on a marked host; the flag is a mechanism, not permission. Reluctance to commit or convenience does not justify a local run. Fix a reported remote preflight problem unless local verification is authorized. GitHub CI retains its specified execution path.

The `tvdev-setup`, `tvdev-contribute`, and `tvdev-review` skills apply the repository’s development workflow for all contributors, including forks. Normal setup and contribution work must not create the Blaxel marker or require Blaxel access. [Blaxel access setup](test-runner/blaxel-testshards.md#Local setup) is needed only for contributors choosing Blaxel, whether through an existing host marker or an explicit command.

The [contribution workflow](../spec-workflow.md#^shared-branch-workflow) owns full-verification timing for pull requests and merges.

Report the revision actually tested, the result, recovered flakes, and relevant limits; do not describe targeted checks as a full gate or claim unperformed validation. Run verification synchronously and wait for its result. Required specialized checks still apply where the full gate excludes them.

The [canonical runner](test-runner/test-runner.md) owns commands and selectors. Its [remote preflight](test-runner/preflight.md#Contributor branches and remote revisions) owns the committed, pushed revision requirement. Local targeted checks remain available for iteration.

## Mocking policy

This policy is designed to counteract irresponsible agent mocking bias.

In this policy, fixtures and mocks are different things under different rules. A *fixture* is **authored data** — inputs, seeded state, documents the system will consume (user artifacts, database rows, config, a served JSON document). A *mock* is a **replaced mechanism** — a production behavior substituted with a fake (a stubbed HTTP client, a faked dependency, a hand-built response standing in for code that would compute one). The asymmetry that drives the different rules: a fixture can be *wrong* — it encodes assumptions that drift from reality — but it cannot *skip production code*; every mechanism still runs, against the fixture. A mock removes production code from the path. That is why acceptance tests (below) can and must consume fixtures — they cannot exist without authored input — while minimizing mocks: the default answer on an acceptance path is none.

Fixtures keep the honesty rules: they are declared in the proof's test assertion, reviewed for realism and drift, and real over invented — fixtures saved from real interactions or real production state are stronger than invented data (though they too age), and generating fixtures at test runtime from simpler inputs, reusing real current behaviors, is better still. Mocks keep the coverage rules in the rest of this section: greenlit per assertion, exceptional on acceptance paths rather than banned outright ([#^shape-acceptance](#^shape-acceptance)), per-seam credit only.

A mocked DOM is a mock and follows this policy like any other replaced mechanism. If real browser mechanics form part of a test's spine, the test must not run in a mocked DOM. A test that depends on those mechanics should name them while articulating its spine, so the harness follows from the claim rather than standing in for it.

### The good

Mocks are an important efficiency tool for testing and typically aid with speed, determinism, failure-mode injection, and tests whose assertions genuinely do not benefit from the integration of additional composed modules.

Mocks are useful when behavior crosses *boundary seams* with complex peer systems:

- other module dependencies
- HTTP and other network protocols
- subprocesses
- IPC
- CLI behavior with outer shell interaction
- browsers
- filesystems
- iframes and webviews to their parent windows

Mocks enable testing logic on one side of such a boundary, and avoid the overhead of spinning up a harness that really launches both sides of the boundary, which is often not necessary for a large number of assertions.

### The bad

AI agents have a strong completion bias. They want to work fast, do the least work, and will often flat out lie about what has been tested. They are happy to liberally use mocks, then report the mocked test passes as full verification that the feature is shippable, when key production code paths are untouched.

A common scenario: an agent implements a feature (even given TDD directives and test assertions up front), and then the user manually testing it finds it does not work at all at the outer user-facing boundaries. Pressing such an agent on the issue results in it apologizing for its sloppy work, explaining how this or that code path was totally faked in its test suite and thus never actually tested. The bias is built-in and must be handled proactively, not reactively.

Tests that mock dependencies, failure modes, or one side of a boundary seam are fundamentally incomplete in terms of coverage, and often skirt honest assessment.

The common worst-case scenario is that a mock produces *negative* signal (anti-coverage) because the mock makes false, agent-hallucinated assumptions about the other side of a boundary. These tests are worse than no test at all, and are unfortunately very common with AI agents who are happy to hallucinate liberally.

### Policy

Always be honest about what a test with mocks actually covers. Such a test exercises the behavior *around* the mock region, not the behavior of that region. In some cases, it becomes an anti-test, proving the wrong thing (as in a hallucinated API mock, or inaccurate fixture).

Carefully review mocks for hallucinated assumptions. Never attempt to replicate complex behavior on the other side of a boundary.

Replacing a production mechanism is a mock **regardless of which phase of the test it happens in**. State injected during setup by bypassing the mechanism that produces it — say, inserting a parsed update-state object directly into a client store instead of letting the server fetch and relay it — is a mock wearing setup clothing, and it earns and forfeits coverage exactly like any other mock. On acceptance tests, setup reaches the starting state through production mechanisms and the sanctioned test hooks the owning proofs declare — the same default of none, with the same exceptional path, as the rest of the acceptance shape ([#^shape-acceptance](#^shape-acceptance)). A hook never reclassifies anything: hooks are proof-declared test affordances, and if setup reaches its state by replacing a production mechanism, the assertion must declare that mock — hook or no hook.

Any mocks in a test implementation must be greenlit by the written test-assertion language in the proof as up-front design decisions. This can be per-assertion, or in a preamble before a list of assertions. The boundaries of tests and the inclusivity of what they validate are part of the assertion, not an implementation decision. Proof authorship carries that work.

Any test or set of related logical tests that uses mocks must be paired with other integration or e2e tests that honestly and fully exercise real interaction across the boundary seams. This rule is per-seam: coverage that exercises one boundary seam but mocks others only gains credit for the real seam. Seams are also typically complex, and crossing one in one way does not stand in for all other ways.

A spec and its proof are not complete unless the proof's assertions ensure full coverage by a combination of mock-enabled and real cross-seam boundary tests.

When planning for injected dependencies or mocked components, always consider whether the dependency is cleanly cleavable to prove the assertion. If not, the design might warrant a refactor for better boundaries, or the test should not be mocked.

### Example

Consider tests for a CLI that is launched from a shell. It accepts complex input arguments that require validation and also interacts with a remote HTTP server.

A set of unit tests might be designed to test the argument-parsing logic of the CLI in isolation — ensuring that unrecognized arguments are rejected, that synonymous arguments are handled identically, etc. These might take string inputs and return a simple validation result structure.

Another test is necessary to assert that when argument parsing fails, the process itself exits correctly with the expected exit code and a message. Without this test, having validated argument parsing is incomplete because it may not be wired correctly to the actual process boundary at run time. This is a *boundary seam* test between the validation code and the process shell — and, because that validation-failure exit is a distinct wired-in outcome a user actually reaches, it is one of the deliverable's *spine* paths, covered in full under *Acceptance tests prove the spine; composition covers the breadth* below. If there are multiple places in the code where the seam is exercised, coverage must cover those multiple places. The seam test does not need to re-validate every argument permutation: those permutations are proven once by the unit tests and composed in across the single handoff between validator and process runtime — the *compositional coverage* named below. This holds only given that single clean handoff; without it, more integrated seam assertions, or code refactoring, are required.

Since the CLI interacts with an HTTP server, many of the tests will use a mock of that server. For example, a test might assert reachability and unreachability behavior — if the server is unreachable, the CLI produces a specific error message or has certain retry behaviors. For this, a mocked HTTP client might be injected into the CLI.

However, if no code actually exercises the boundary seam between the CLI and a real server, we cannot be sure that it is actually capable of making external network requests. A defect in the request-initialization code might never be caught. All servers may end up looking unreachable, or perhaps an exception is thrown before even attempting to initiate the connection and the reachability code never even fires. It would be dishonest to say that the server-reachability tests (using the mocked HTTP client) assert that this client actually handles "reachability" correctly when that word is used at the level of end user observed behavior.

## Compositional coverage across clean seams

End-to-end proof of a behavior does not require an end-to-end test of every input permutation. When a behavior crosses a clean, minimal seam — a single handoff between two modules — its correctness is *composed* (this is *compositional coverage*) from:

1. a **contract test** on each side of the seam (the producer always emits the right thing; the consumer does the right thing with what it receives), and
2. a **seam test** proving the handoff is actually wired on the real code path (the producer's output really reaches the consumer there).

Given a single clean handoff, the seam test need not re-validate the permutations the contract tests already cover. The permutations are proven once at the contract, the wiring once at the seam, and the composition proves the whole — without a combinatorial number of end-to-end tests.

*Example.* To know that every telemetry event carries the correct current server version, we do not need an e2e test per event type. One contract test proves the metadata payload generator always includes the current server version; one seam test proves that payload is attached to the events that should carry it. The two compose into confidence across all those events without enumerating them.

**This holds only across a clean, minimal seam.** Composition is valid when there is a *single* handoff and the data crosses it untransformed (or via one tested function). If the producer's output is re-derived, branched, or re-assembled at multiple call sites, those are multiple seams — each real path needs its own seam coverage, or the code should be refactored back to a single clean handoff. A spec that leans on composition must therefore name the single handoff it depends on. Minimal seams are not just good design: clean code minimizes its testing footprint by isolating logic into modular boundaries with clean, minimal contracts, and that isolation is what makes coverage provable without combinatorial test counts.

**Composition is never license to skip the seam test.** Contract tests alone, however thorough, never prove the wiring. At least one real boundary test must exercise the actual handoff on the production path (per the mocking policy); composition means that test need not re-run every permutation — not that it can be omitted. Coverage that mocks the seam earns credit only for the side it really exercises.

## Acceptance tests prove the spine; composition covers the breadth

Compositional coverage governs **breadth** — the permutations, property values, and variant branches across a path. It must never be used to avoid proving the **spine**: the principal paths through a product deliverable, walked end to end, for real.

- The *spine* of a deliverable is its set of **principal paths** from the outermost boundary to an observable outcome — not only the main success path but each **principal alternative exit** (a validation failure, a refusal, a recoverable error) that represents a distinct wired-in outcome. The spine is the deliverable's skeleton of outcomes, not a single success route. It need not include every error, but it includes each principal exit a user or agent can actually reach.
- The *breadth* is the variation that routes into those paths: input permutations, enumerated property values, edge cases, which specific inputs succeed or fail.

An *acceptance test* exercises one of a deliverable's principal paths at the **outermost boundary**, with **mocks minimized to a default of none on the path under test** — an exceptional mock is justified, greenlit, and forfeit-named, with CSS-motion disablement the standing carve-out ([#^motion-rule](#^motion-rule)) — asserting the outcome a real user or agent would observe. The outermost boundary is concrete per surface: a CLI invoked as a spawned process with real argv, exit codes, and stdout; a server driven by a real HTTP/websocket client against a really-running instance; a UI driven in a real browser or the real Electron app.

*Why error exits are spine, not breadth.* Take the CLI from the mocking-policy example above, which validates its arguments and rejects unrecognized ones. The success path is one spine path; **the validation-failure exit is another** — a spine test must spawn the real process, pass a bad argument, and assert it exits with the correct code and message. Without it, argument validation can be fully unit-tested and still never be *installed*: if the validator's rejection is not wired into the process exit, that failure outcome silently never happens. Proving the failure exit is wired end to end is spine. *Which* specific arguments are rejected is breadth — unit-tested at the validator and composed in, not re-run end to end per argument.

The rule:

- **Every principal path on a deliverable's spine — success and principal alternative exits alike — must be proven by at least one acceptance test.** This is independent of, and not satisfied by, any amount of composed contract-and-seam coverage. A logically valid chain of unit and seam tests that never walks a real spine path proves the parts connect *in theory* — not that the product actually delivers that outcome.
- **Composition determines breadth, not whether a spine path is walked.** With clean seams, an acceptance test walks each principal path once; the breadth routing into it is covered off to the side by composed contract-and-seam tests. Composition drives the number of acceptance tests toward roughly one per principal path — never to zero.
- Product specs, in product language, own the spine acceptance tests (their measures of acceptance, proven in their proofs). Arch specs own the breadth via contract-and-seam composition. The two layers together make coverage both honest and economical.

## Test shapes and the declaration schema

The sections above imply three shapes a test can take. Naming them makes assertions declarable and reviewable; every test claims exactly one:

- **Acceptance** — enters at the outermost boundary, which the assertion names concretely (a spawned process with real argv and exit codes; a real HTTP/websocket client against a really-running server; a real browser; the real Electron app), and observes the outcome a real user or agent sees. Mocks are minimized to the point that the default answer is none anywhere on the path under test, including setup; a mock genuinely important enough to carry is exceptional, and is justified, greenlit by the assertion, and its forfeited coverage named and placed, per the mocking policy — with CSS-motion disablement the one standing carve-out that needs no per-spec justification ([#^motion-rule](#^motion-rule)). Fixtures are allowed and declared. Roughly one per principal spine path, including the principal failure exits. ^shape-acceptance
- **Contract** — proves **one side** of a named seam in isolation: the producer always emits the right thing, or the consumer does the right thing with what it receives. The seam is the test's *edge*, not something it crosses; the other side is absent or mocked (greenlit by the assertion). This is where permutation breadth lives. ^shape-contract
- **Seam** — proves **one named handoff** is wired on the real production path, crossed once for real. It does not re-run the permutations the contract tests cover. When the same producer output is re-derived, branched, or re-assembled at multiple call sites, those are multiple seams, each needing its own crossing (see *Compositional coverage across clean seams*). ^shape-seam

Classification keys on the assertion's **claim**, not the harness it uses: an assertion claiming a product spine outcome at the outermost boundary is acceptance; one claiming a single handoff is wired is a seam — even when reaching that handoff means driving a real server or a real browser. ^shape-by-claim

The declaration schema: every test assertion in a proof — or a preamble covering a block of assertions that share the answers — declares its shape. An acceptance assertion names its boundary and its fixtures and test hooks. A seam assertion names the handoff's two sides and the real transport it crosses. Any mock, in any shape, declares what coverage it forfeits (and where that coverage lives instead). An assertion that cannot claim a single shape is a composite: split it into assertions that can. ^declaration-schema

Platform-dependent behavior is covered by a contract test on the platform-dependent logic plus a seam test proving real platform detection feeds it, because acceptance tests run only on the CI host platform (Linux, sometimes macOS — no Windows environments); an assertion must not imply an acceptance run on a platform the infrastructure cannot provide. ^platform-breadth

## What a UI surface's suite is responsible for

**The test assertions in UI proofs have not all been maintained.** They are pending review and cleanup, surface by surface, as implementation reaches each one. Until a surface's assertions have been reconciled, implementors and reviewers treat them as stale derived authority: the spec's prose, markup, and styles win, and where an assertion conflicts with them the assertion is wrong. A stale assertion is still read because it records what the surface once set out to prove, but it is not implemented as written: reconciling it with the spec is part of implementing that surface, and only a reconciled assertion counts under [#^assertion-cost](#^assertion-cost)'s 100%-of-specified-tests rule. A UI proof may state that its spec orders no tests. ^ui-assertions-unmaintained

UI components carry tests that enumerate assertions against the component's salient facts, content, and markup where that proof makes sense. Authors make that judgment under the same assertion-cost and shape-price guidance as elsewhere ([#^assertion-cost](#^assertion-cost), [#^shape-price](#^shape-price)), and reviewers assess it; a stylesheet-only surface such as the foundation has no component to assert against. Suitable proof may be a markup smoke check over meaningful states, a functional test in a real browser or mocked DOM as fits the claim, or a contract test against a component's state machine. ^ui-suite-scope

The suite does not assert styling adherence; conformance does ([arch/ui/conformance.md](./ui/conformance.md)). What remains a matter of judgment is judged in staging and review under [spec-ui.md](../spec-ui.md)'s process. ^ui-styling-out


The DOM is the instrument, not the subject. Reading the DOM is how a browser test observes anything at all, so it can be neither ruled in nor ruled out: whether a test touches the DOM says nothing about what the test is for. Sometimes the DOM is part of a test; sometimes it is not. A spec never states blanket coverage of it. ^ui-dom-instrument

## Assertions are cheap to write and expensive to carry

A test assertion in a proof costs a line of prose to author and orders a permanent obligation: someone implements the test, and it then runs on every commit for the life of the product across an already broad harness; every refactor must preserve it; it can flake, and when it does it taxes everyone; and removing it later needs its own justification. Assertions are authored with that asymmetry in view — with skepticism, not completeness for its own sake. This governs how much proof a spec orders and at what price, never whether: specs under authority still receive proofs that validate them, and the 100%-of-specified-tests rule stands. ^assertion-cost

The suite's first job is catching incorrectly authored code. Authored mistakes land on the happy paths and the common failure modes, not in the exotic tail, so a domain whose main paths and likely failures are genuinely proven has already bought most of the protection testing can buy — past that point, returns fall off sharply. Order further coverage only for a scenario that is both plausible and consequential: that it could theoretically happen is not a reason, and neither is symmetry with a case that earned its test. ^coverage-returns

The shape of the proof is part of its price. A headless-browser test costs far more, forever, than a Node unit or contract test — slower on every commit, heavier to maintain, likelier to flake — so the same edge case can be worth proving at the contract tier and not worth proving at acceptance price. Prove each promise at the cheapest shape that does not misrepresent what is covered; where a promise genuinely lives in the browser or in Electron, pay for the seam or acceptance shape — the mocking policy's honesty rules forbid making proof look cheaper by mocking away the mechanism whose behavior matters. An expensive test that proves its promise is a better bargain than a cheap one that quietly does not. ^shape-price

An assertion's price never argues against the prose it would prove. A spec serves several purposes at once: it gives the humans and agents who write and judge the code the context their engineering judgment needs — structure, mechanism, and reasons — and it defines the corpus of behavior tests should cover. These purposes do not overlap one-to-one. A statement can be worth making because a reader is better off knowing it, while the behavior that matters is already proven by a higher-level assertion, or while it is not the kind of claim a test could meaningfully prove; such a statement owes no proof of its own. Coverage is judged across a spec's promises as a whole — reviewer judgment, like the rest of this policy, never a mechanical mapping from sentences to tests in either direction — though what a spec chooses to state is a real signal of importance, not noise to ignore. And the absence of a warranted test is never a reason to delete true authority: a statement is removed because it is false, redundant, or outside the spec's boundary, never because it would be expensive to prove. ^spec-purposes

## Integration against paid services or complex host dependencies is important

Integration tests that cross the seam to real third-party APIs or services that cost money to run — for example AI inference — are a necessary part of the operational overhead of maintaining the software. Depending on the cost and environmental dependencies of these boundary tests, they may not be included in all verification runs (e.g. CI on GitHub), but they should still be available in the test suite for developers to run when code has any reasonable chance of impacting covered behavior.

Likewise, if product behavior depends on complex host setup, like the installation and configuration of complex local software, that is not something we skip over in testing.

We always "bite the bullet" and ensure that automated testing really proves things really work — the same discipline that requires each spine path be walked for real (see *Acceptance tests prove the spine; composition covers the breadth* above).

For example, we have complex integration tests with agent harnesses like OpenClaw or Hermes, which use real AI inference services and also require local installation and configuration. These are critical tests for that integration behavior in the product, but do not run in full automated CI yet, as the feature is still experimental; developers set up and run these tests ad-hoc for now. They exist, and passing them is required for any change to that experimental subsystem. If we want to promote this to a production feature, we would consider implementing sophisticated middleware that acts like a VCR: recording accurate, replayable interactive fixtures for use in CI which are regenerated frequently on dev hosts.

## The test harness, helpers, and fixtures are a first-class subsystem of the software

In order to liberally cover boundary seams across the codebase, complex harness setup is typically required. The effort is mitigated by aggressively moving shared setup logic into well-designed and flexible harness helpers that can bootstrap integrations and fixtures. Our test suites are our final QA, so we invest in them heavily. They are an entire subsystem of the software and warrant modularity and architectural complexity in their own right.

Prefer real, committed fixtures over invented data. Better yet, generate fixtures dynamically from current code paths, driven by simpler inputs with fewer assumptions, whenever possible.

## Timing, observable status, cleanup, and flakiness

Prefer real readiness and state observation over sleeps. Take the time to make complex tasks reliably observable for testing purposes. ^flake-avoidance

### Motion: the default CSS-motion override and real-motion tests

The shared browser and e2e motion helper disables CSS transitions and animations by default. The helper injects a test-only stylesheet that applies `transition: none !important` and `animation: none !important`; a test whose assertion requires real CSS motion opts out explicitly through the same helper. The override leaves `scroll-behavior: smooth`, programmatic scrolling with a behavior option, Web Animations API animations started in script, and animation-frame loops untouched. The mocking policy's motion carve-out and forfeit apply only to CSS motion. The CSS-motion override keeps tests fast and deterministic and keeps geometry or hit-target assertions from observing in-progress CSS motion.

The rule in one line: a test whose outcome CSS motion can affect must not use the mock, whether or not the motion is what the test is about; every other test may — which is exactly why the mock is the default. CSS-motion disablement is a named, standing carve-out from the acceptance shape's mock minimization — no spec argues it case by case — because it is broadly useful: it speeds the suite up and makes tests more reliable across the board. An acceptance test that uses it still declares it with the forfeit named, and the honesty rule below bounds that forfeit: the behavior around the disabled CSS motion is covered, never that motion itself. A browser acceptance declaration that says nothing about CSS motion is read as using the carve-out — a standing default needs no restating — while an assertion whose promise involves CSS motion must say so and opt out (real-motion, below). ^motion-rule

**Disabling CSS motion is a mock.** It replaces a production CSS transition or animation with a substitute in which the change snaps instantly, and it is governed by the mocking policy above like any other mock: fine for the great majority of tests, because CSS motion is not part of their claim's contract, seam, or spine; and always subject to the honesty rule — a test running with CSS motion disabled covers the behavior around it, never the disabled motion itself, and cannot claim otherwise. ^motion-mock

**A real-motion test** is one whose outcome CSS motion can affect — because its promise involves the motion itself (timing, sequencing, what happens while something is moving), or because the state it asserts is reached through motion that could land differently when it runs for real — so that motion runs real. Any CSS motion on its path runs with the default override removed; smooth or programmatic scrolling, Web Animations API animations started in script, and animation-frame loops are already real because the override does not touch them. The requirement rides the proof assertion like any other mock declaration (the declaration schema above): an assertion about motion says so, and its implementing test may not disable CSS motion on the path under test. For synchronization, real-motion tests wait on applicable browser signals — transition and animation lifecycle events, the Web Animations API, scroll and `scrollend` events, and animation frames — never wall-clock sleeps. ^real-motion

Real-motion tests assert mechanics, not aesthetics: that the motion runs and completes, that interrupting it mid-flight does what the spec says, that input during motion lands where the spec says, and that the settled end state is correct. When a UI spec designates an [executable motion reference](../spec-ui.md#motion-and-interactivity), tests may compare rendered production output against its numeric pose and timing outputs using a controlled animation clock. Production still calculates the animation and the browser renders it; sampled comparisons do not establish perceived smoothness or real-time performance. Feel and polish remain matters for staging and human review.

Current instances of the pattern (illustrative, not a registry — they change as suites do): `packages/web/test/e2e/motion.test.ts` proves both the shared CSS-motion default and its explicit opt-out, and `packages/web/test/e2e/stage.test.ts` observes the stage's real CSS transitions and Web Animations API-driven scroll crossing.

Treat cleanup behaviors of long-running modules (with servers, listeners, network requests, etc.) as core to correct implementation and validation. Dirty state leads to hidden bugs, flaky tests, and inscrutible race conditions.

The test development proxy installs `error` handlers on both inbound streams and their outbound peers before piping begins. For an HTTP proxy this includes the inbound request; for an upgraded connection it includes the accepted socket. A peer reset closes both sides idempotently and is never allowed to escape as an uncaught process error. Its seam tests drive abrupt HTTP and upgraded-socket resets through the real bridge and assert that neither side remains tracked. The separate stable-front proxy has no equivalent reset seam test.

Flakiness is sometimes inevitable in browser and Electron e2e tests, so the test runner provides a two-layer flaky-test retry mechanism — see [flaky-tests.md](./test-runner/flaky-tests.md) for the mechanism and annotation patterns.

However, the existence of a mechanism for handling flakes does not make it acceptable to write them. When writing a test, if it turns out to be flaky, stop and apply aggressive, disciplined refactoring to the code or test or both. It is worth it: a one-time effort up front beats permanent pain over the long run.

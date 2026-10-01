*Proofs — the agent-owned document under `proofs/` that says how one spec's promises are proven: why it exists, where it lives, its shape, when it changes, how it cites, and who owns and reviews it.*

# Proofs

A proof says how a spec's promises are shown to hold. Specs are written and read by people. Proofs are written and reviewed by agents, and always answer to the spec they prove.

## Why proofs exist

Spec ownership and review follow [spec policy](spec-policy.md#Slop-free zone). The assertions that prove a spec are written and reviewed by agents, and no person reads them line by line. Keeping them in a separate tree distinguishes what is promised in `specs/` from how each promise is proven in `proofs/`, and keeps assertion detail from burying the spec's testing directives. A spec's `## Testing` section remains its lever over proof design. Each proof opens with a coverage model written for a person to read when they choose to; no proof review is asked of them, though they may read or reproduce a proof out of interest or while debugging.

## What a proof is and where it lives

A *proof* is the document that says how one spec's promises are proven: which tests exist, what shape each takes, what each mocks and what that mock forfeits — the coverage it gives up, and where that coverage lives instead — and where the evidence is. It is **derived** authority, on the model of a runbook ([spec-policy.md#^runbook-type](spec-policy.md#^runbook-type)): authoritative for the design of the spec's test suite, derivable from the spec it names, and wrong wherever it conflicts with that spec. The spec wins. Tests derive from the proof and cite it. ^proof-type

The mapping is a root swap and nothing else: `specs/product/channels.md` is proven by `proofs/product/channels.md`. Every spec under `product/`, `arch/`, and `ui/` has a proof, runbooks and explainers excepted; a UI spec's proof is the `index.md` of the mirrored directory; the root governance specs, the glossary, and the generated index have none. Non-markdown files beside a spec, such as a UI surface's `content.yml` or the update channel's master copy, `update-channel.json`, are material that spec owns, not specs: they have no proof of their own, and the owning spec's proof covers them. A spec that orders no tests — a stylesheet-only surface, a theme — has a proof of one paragraph saying so and why. ^proof-location

## The shape of a proof

```markdown
*One italic sentence: what this proof covers, and at what boundary.*

# Channels — proof

Proves [specs/product/channels.md](../../specs/product/channels.md).

## Coverage model

…

## Test hooks

…

## <the assertions, under whatever headings suit the spec>
```

The first line is a single italic sentence, as in a spec, and becomes the proof's index entry. The `Proves` line names the spec by relative link. The assertions are grouped however reads best for the spec.

The *coverage model* is the part written for a person: a plain-English description, for a cold reader, of where the tests' boundaries lie. It includes, but is not limited to: what is proven by contract, what by seam, what by acceptance; the mocks in play and what each forfeits; important limitations and known deferrals; which of the spec's testing directives it honors, and where; and what relevant coverage lives in other proofs. Ten to twenty lines, written so that someone who reads nothing else in the proof can tell what the suite stands behind and what it leaves open. ^coverage-model

Under `## Test hooks` the proof declares the production affordances its tests substitute or observe — an optional parameter, an environment variable, an exported helper — one sentence each: what a test may supply or read, and what production does instead. The proof is where these declarations live and where agents keep them current as the tests change. ^test-hooks

## Assertions

What makes an assertion good — shape, mocks and forfeits, cost, which promises owe a test — is the testing policy's ([arch/testing-policy.md](arch/testing-policy.md)). The proof format adds two things. Each assertion carries a block anchor ([arch/testing-policy.md#^assertion-anchors](arch/testing-policy.md#^assertion-anchors)), so that tests and other proofs can cite it. And each assertion points at what it proves — the spec's promise, by block ref where one exists or by section where none does. An assertion that can point at nothing in the spec is either a promise living only in the proof, which goes back to the spec, or a test nobody ordered.

Its citation names the test that proves it and shows the grade of that evidence: ^citation-grades

- **Policy-grade** — `(policy-grade test: …)`, or plainly `(covered by …)`: a test written to the testing policy.
- **Inherited** — `(covered by inherited tests: …)`: coverage that predates the policy, judged good on its merits and kept under [arch/testing-policy.md#^inherited-ratchet](arch/testing-policy.md#^inherited-ratchet).
- **To be written** — `(test to be written)`: an obligation not yet discharged.

## When a proof changes

When the spec's promise changes, the proof is re-derived, spec first. When only the proving changes — a cheaper shape that is still honest, assertions consolidated, a more honest seam crossed, a test retired because another already covers it — the proof changes alone. When a test is renamed, split, or moved, only the citation changes. Learnings flow up: what is promised lands in the spec, how it is proven lands in the proof, and when the two are entangled the spec moves first. ^proof-change

Under [spec-workflow.md](spec-workflow.md#feature-workflow), proof derivation follows the *spec gate* and receives independent agent review in every form of the contribution workflow. Proof approval has no human gate.

The one thing a proof never does is decide what an ambiguous spec means. When the prose admits two readings that would order different tests, the proof does not pick one: it records the ambiguity as a finding against the spec, resolution follows [spec policy](spec-policy.md#Slop-free zone), and the proof follows. A proof that has quietly chosen is a defect even when the choice was right, because it has moved a decision out of the owning spec. ^proof-hard-limit

## How proofs cite

Coverage of a feature usually spans several specs, and so several proofs: a product proof proves the spine end to end, and the architecture proofs behind it carry the breadth and forfeit the real crossing to that walk. Proofs cite each other, and specs, with the ordinary reference conventions ([spec-policy.md](spec-policy.md), References). A proof that forfeits a crossing names the proof that carries it.

## Testing directives

A spec may use a `## Testing` section for human-owned guidance about how its promises should be tested, at whatever level of detail the author finds useful. These *testing directives* add decisions or context that the proof would not reliably derive from the promises alone. Restating conclusions already derivable from the spec's promises in the Testing section is an anti-pattern: it creates duplicate content that must be maintained alongside the spec and proof. Converting promises into assertions remains the proof's job; the Testing section contributes the author's additional guidance, keeping each promise in its single authoritative statement. The proof honors every directive and says where in its coverage model; one it cannot honor goes back to the spec as a finding. ^testing-directives

A testing directive is guidance for proof derivation. It is not itself a spec promise, and it is not subject to the coverage discipline that applies to the promises in the body of the spec. A directive is honored by the design of the tests, and the proof’s coverage model says where; it orders no assertion of its own. If a Testing section says the tests use Playwright, the proof designs its tests to run in Playwright. It does not order an additional test proving that the tests use Playwright. The Testing section is a rider on the spec that shapes how the promises above it are proven; the authority the proof and its reviewers derive assertions from is the rest of the spec. ^testing-directive-standing

## Ownership and review

A proof is written by agents, settled through the adversarial review the workflow defines ([spec-workflow.md](spec-workflow.md)), and merges without a human line review. Review of hunks under `specs/` follows [spec policy](spec-policy.md#Slop-free zone); hunks under `proofs/` and the test directories go through the agent loop with no human line review. A person who wants to know what the tests stand behind reads the coverage model. Whose a change is follows from what it changes: what is promised — the spec; only how it is proven — the proof; both — the spec first. ^proof-ownership

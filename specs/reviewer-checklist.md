*Review questions that restate the spec policies, for use when reviewing any spec or change.*

# Reviewer Checklist

Ask these when reviewing a spec or a change that touches specs.

- **Slop-free.** Does this change satisfy the review required by [spec policy](spec-policy.md#Slop-free zone)?
- **Authority.** Does each spec state what it owns? Is authority exclusive, with others referencing it rather than restating it?
- **Altitude.** Do product specs describe user-facing behavior without naming modules or types? Do arch specs own the modules and contracts, with real, precise TypeScript types?
- **Contract vs. implementation.** Does the spec pin types + cross-boundary signatures + behavioral rules, without enumerating internal function signatures?
- **Writing.** Does the spec follow the [authoring guidance](spec-policy.md#Authoring guidance), preserving useful context and precision without private shorthand or unnecessary requirements?
- **Terminology.** Are new terms defined by their owning spec and italicized there? Is `terms.md` still correct? Do terms use italics to differentiate from natural language interpretation where needed, and reference the source authority when helpful?
- **Testing directives.** Does the spec anchor what its proof needs to cite? Does `## Testing` add human-owned guidance that the proof would not reliably derive from the spec's promises alone, at the level of detail the author intends? Is each directive honored by the design of the tests, rather than by an assertion about the tests ([spec-proofs.md](spec-proofs.md#^testing-directive-standing))?
- **Proof coverage.** Does the proof cover every promise at an honest shape, honor every directive, declare every mock and its forfeit, and name coverage carried by other proofs? Is every proof assertion covered by real test code that exercises its intent? Did the proof avoid deciding anything the spec leaves ambiguous?
- **Mocking & boundaries.** Does the mocking altitude fit the assertion — product-level claims run real paths, module-level claims may mock around the unit? Are mocks only inside a section whose outer edges are held down by boundary tests, and never inside the code chain the assertion is about? Are real boundaries (browser, HTTP/WS, filesystem, subprocess, sandbox) proven with real unmocked I/O? See `testing-policy.md`.
- **Authority flow and back pressure.** Has anything learned downstream been pushed back up into the spec? Do code and spec agree? Is the spec pinned clearly enough to lead to predictable behavior across reasonable implementation interpretations?
- **References.** Is anything worth citing anchored with a block ref — and only what's worth citing? Do references between specs use relative markdown links (`[spec.md](spec.md)` or `[ref](spec.md#^id)`)? Are existing block refs still valid?
- **Size.** Is the spec still coherent and reasonably short, or is it a candidate for decomposition?
- **Placement.** Does ownership of material under `specs/` follow [spec policy](spec-policy.md#Slop-free zone), with no test-shaped assertion content left there? Is anything spec-shaped hiding in `proofs/`? Has other non-spec material — rationale, proposals, finished work — moved out?
- **Status.** If a transitional status is present, is it still accurate, and is the spec ready to drop it?

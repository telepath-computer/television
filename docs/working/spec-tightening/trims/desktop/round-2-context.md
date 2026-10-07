# Desktop trim, round 2 context

**Area:** desktop.

**Specs in the area:**
- specs/product/desktop-app.md
- specs/arch/desktop/index.md
- specs/arch/desktop/appearance.md
- specs/arch/desktop/connect-flow.md
- specs/arch/desktop/distribution.md
- specs/arch/desktop/e2e-harness.md
- specs/arch/desktop/runtime.md
- specs/arch/desktop/updates.md
- specs/arch/explainer-desktop-app.md
- specs/arch/explainer-connection-states.md

**Base commit:** f6cdd91e417e1f94c8617baebb016e921c21d6e5 (see the trim with `git diff f6cdd91e..HEAD -- specs`).

**Previous round:** the review is docs/working/spec-tightening/trims/desktop/round-1-review.md, and the trimmer's notes on the first trim are in round-1-context.md.

## Responses to round 1 findings

1. **Blocking, `TV_DESKTOP_E2E_URL` shape (e2e-harness.md, Launch contract).** Addressed. The launch contract again states that fixture helpers require the value to be an HTTP URL on `127.0.0.1`. The helpers also derive a second, `localhost` origin from it (`desktopE2EOrigin` in `packages/desktop/test/e2e/helpers.ts`), so the host is not an arbitrary loopback choice.
2. **Non-blocking, migration history in distribution.md (Releases, `^desktop-dist-first-release`).** Partly addressed. The pull-request narrative is gone; the paragraph now states, in the present tense, that Television's ToDesktop app holds two test releases, 1.4.0 and 1.4.1, and that the first release for users carries a higher version. It is kept, not removed, because the trimmer cannot confirm from the repository that a release for users has already been made (the ToDesktop dashboard is outside the repository), and because desktop-upgrade-recommendation.md cites it to explain why `1.4.0` is still the boundary between npm-installed and downloaded apps. Whether to remove it once a release for users exists is listed as a decision for the architect.
3. **Non-blocking, proof attribution for the workspace manifest (distribution.md, The desktop workspace).** Accepted. Proofs are not edited in this run (they are re-derived after the architect accepts the trim). The stale assertion in proofs/arch/desktop/distribution.md (the "no `bin`, `files` or `engines`" clause) is recorded in the area's review document under effects on proofs.

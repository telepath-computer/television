*How worker-owned test builds are proven, and how testing discipline is reviewed.*

# Testing policy — proof

Proves [specs/arch/testing-policy.md](../../specs/arch/testing-policy.md).

## Coverage model

Authoring and execution discipline is checked by review of the contribution and its recorded validation. It orders no tests of its wording or of an agent's compliance. Runner enforcement belongs to the test-runner proofs.

Reusable helper builds are runtime behavior owned here. A small contract covers cache publication and failed preparation; real Playwright and Vitest worker lifecycles prove build reuse and final disposal. These are helper tests, not additional product browser walks. Real builder output must be exercised at least once; injected builders earn only lifecycle coverage.

The built-application default is honored by the setup of the product tests that need it. [Themes](../product/themes-and-appearance.md) and [demo mode](../product/artifacts.md#^af-ac-demo-mode) retain their product assertions while changing their asset-loading boundary. No source-text test asserts that every acceptance uses a particular helper.

Killed workers cannot promise teardown. The [Blaxel scratch/recovery assertions](test-runner/blaxel-testshards.md#Lease, recovery, and scratch) carry the backstop rather than duplicating a crash experiment here. The new helper assertions below are not yet discharged.

## Test hooks

The shared build-lifetime helper accepts a temporary parent and preparation callback; contract tests may supply a builder that writes fixture files, waits on a rendezvous, or rejects, while real callers run the source-CLI or versioned-web preparation. Its teardown entry point is the same one the runner-worker adapters call; exposing it for a contract does not stand in for testing those adapters.

## Worker-owned builds

- **Contract — publish successful builds and dispose owned work.** With a real temporary filesystem and recording preparation callbacks, concurrent requests in one worker reuse a pending/successful build for the same key, while distinct version keys remain distinct. A failed preparation removes its partial output and is not published; a later request may prepare it again. Teardown waits for in-flight preparation to settle and removes all owned outputs, including one that failed after creating files. Per-case server disposal cannot invalidate the worker's reusable build. These callbacks mock build/asset preparation and forfeit actual executable output to the worker seam below. This proves [worker build lifetime](../../specs/arch/testing-policy.md#^worker-build-lifetime). (test to be written) ^testing-t-build-lifetime

- **Seam — real runner workers own their builds.** The installed Playwright and Vitest runners each execute a small authored fixture through the actual shared helper/adaptor path, using a private temporary root. Two cases assigned to the same worker reuse the source-CLI preparation and a same-version web bundle; a later worker owns a separate lifetime. Source CLI output starts a real product server, and the real web output is served/read, establishing that published results are usable. Within this same fixture, a bundle path naming an absent child makes the real copy fail after allocation of a per-launch runtime/home; those private outputs are removed, and a subsequent valid launch still uses the worker build. The missing path is fixture data. After per-case server cleanup the shared outputs still exist; after normal worker teardown they do not. No runner, builder, filesystem or server mechanism is mocked. This crosses each framework's teardown boundary under [worker build lifetime](../../specs/arch/testing-policy.md#^worker-build-lifetime), without a browser or an extra product assertion. [The real version-stamp seam](updates/version-advertisement.md#^t-web-stamp) supplies version breadth; this seam need not rebuild a matrix of versions. (test to be written) ^testing-t-build-worker-seam

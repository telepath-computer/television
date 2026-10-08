> **Archived 2026-10 from PR #29.** This plan guided the implementation in six slices and the rounds that followed for decisions made during review, and the work followed it, with later decisions recorded in the specs. It preserves the allocation of proofs across slices and the expected baselines between them as one account of how the work was divided, which the final implementation and PR description do not reconstruct. The body below is the working plan with commit IDs, references to the unarchived task record and host-specific setup removed, and is a clue to the change, not a record of it.

# Resource API: implementation plan

The result is version 1 of the resource API. Every HTML artifact has its own JSON store, which its page uses through `/sdk/v1/resources.js` and agents through `tv resource json`, and an artifact can have a share link at `read` or `read-write`. Resources are identified by ID only, and created stores and bindings exist behind a flag that is off as shipped. The JSON store's API is inspired by Firebase's. Onboarding installs with generated artifact IDs, and Company To-dos keeps its list in its own store.

The sections up to [Company To-dos as the JSON store's showcase](#Company To-dos as the JSON store's showcase) record the earlier rounds, which built named resources and bindings. [The complete proposal](#The complete proposal: an artifact's own store, share links, and bindings behind a flag) reworks them and is the current work.

This plan builds on the specs that passed the spec gate, the JSON store settlement, and the proofs that passed independent review in round 2, with that review's refinement. The [proposal](proposal.md) records intent. The specs and proofs govern. This plan only allocates their work to slices and records the baselines between them.

## Approach and slice boundaries

Six slices build the feature from the bottom up. Each slice ends at a boundary that its own tests can prove.

1. **The resource layer and JSON store on the server, through the administrative routes.** This covers the shared rules, storage, startup recovery, bindings, events, artifact deletion, and the JSON store's server-side write model.
2. **The page connection.** This is the server half of the page protocol: sessions and session records, ordering and resend, checks at application time, page events, and the JSON store's page operations.
3. **The resource SDK.** This covers its build and serving and its whole behavior in a real browser: handles, the connection, reconnection, the local-write model and transactions.
4. **The client, the `tv resource` commands and packaging.** This covers the shared client, the CLI command family, the SDK's path through the CLI build and `tv serve`, and the command-level product walks.
5. **Browser acceptance through the built product, and the resource guidance.** This covers the product page and sharing walks in Chromium and Firefox, and the `television` skill's `resources.md` with its runnable example.
6. **Onboarding.** This covers generated artifact IDs, declared resources in the content schema, bake and installer, and Company To-dos remembering done tasks. It resolves the starting baseline below.

Slices 2 and 3 are the two halves of one protocol. They are split because each half is large, and each can be proven against the spec at its own boundary. Slice 2 tests the server with a client that plays the SDK through the shared framing. Slice 3 tests the SDK in a browser against the real server from slice 2. Reviewing slice 3 against slice 2's settled server keeps each review focused.

The CLI comes after the SDK so that its packaging work (the copy into `dist/sdk`, `resolveSdkDir`, and `tv serve` passing `sdkDir`) has a built SDK to carry. Browser acceptance follows the CLI because its walks need the built product. Onboarding comes last because it needs the layer (slice 1) for creating and binding, the SDK (slice 3) for the to-do module, and the CLI (slice 4) for its product walks. It also changes the most existing tests.

The converged proofs determine the tests, their boundaries, mocks and forfeits. The allocations below say where the work happens; they do not re-derive the assertions. Where one assertion spans two slices, the table says which part each slice proves. As each test lands, its proof citation changes from *(test to be written)* to the policy-grade citation, in the same slice.

An earlier experimental JSON storage prototype is background, not a source of behavior. Its code may help with mechanics such as atomic file writes or the esbuild SDK build. The specs govern every difference, and many are deliberate.

## Observed starting baseline

These targeted results come from the branch before slice 1. They are not a full-suite baseline.

| File | Result | Assigned to |
| --- | --- | --- |
| `test/repo/spec-links.test.ts` | Fails "test-code citations resolve to spec or proof anchors": `packages/server/src/onboarding-installer.ts:259` cites the removed `installer.md#^artifact-idempotent`. | Slice 6 |
| `test/node/bake-onboarding.test.ts` | Fails "bakes every design channel into a shipped-tree copy and the result passes build validation" and "produces byte-identical trees across roots and re-bakes". The Productivity design manifest now declares `resources`, and the current bake refuses it (`unknown field 'resources' on a card in productivity/layout.yml`, confirmed by running the bake). | Slice 6 |
| `packages/web/test/e2e/onboarding-artifact-skill-assets.test.ts` | Fails "authored task and calendar documents show their story dates relative to the viewer's local day", which bakes Productivity, for the same reason. | Slice 6 |
| `packages/server/test/onboarding-installer.test.ts`, `onboarding-installer-state-write.test.ts`, `onboarding-content.test.ts`, `packages/cli/test/cli.test.ts`, `contract-types.test.ts`, `test/repo/skills-build.test.ts` | Pass. | — |

Slices 1 to 5 do not touch onboarding, so these three failures persist through them unchanged. Each slice records any further failure it observes, by test identity and assigned slice.

## Conventions for every slice

- **Red/green TDD.** Write the proof-derived tests first, see each fail for the intended reason, then implement until they pass. Follow [test iteration discipline](../../../specs/arch/testing-policy.md#Test iteration discipline): use `npm test -- local --file <path>` and `--grep` while iterating, widen to the owning surface, and keep broad runs for discovery.
- **Where tests live.** These locations follow the current registry:
  - shared-module contracts go in `packages/shared/test/` (`unit:shared`);
  - server contracts go in `packages/server/test/` (`unit:server`);
  - real-browser tests against an in-process server go in `packages/server/test/e2e/*.spec.ts` (`e2e:server`). They must use the `.spec.ts` suffix, because `unit:server` collects `test/**/*.test.ts`;
  - CLI contracts go in `packages/cli/test/` (`unit:cli`);
  - built-CLI walks, CLI-to-server seams and built-product browser walks go in `test/node/` (`e2e:node`). That surface's build step produces the full CLI, and it already launches Playwright browsers from Vitest.
- **Test hooks.** Add each hook a proof declares in the slice whose tests first need it, with production defaults unchanged. The hooks are:
  - the storage-operations adapter (slice 1);
  - the session-record clock and the opening-state interruption option (slice 2);
  - the stop-after-saving option (slice 3);
  - the browser host-name mapping and the network proxy, which are harness rather than product code (slice 3).
- **The SDK stays first-party.** The shared resource modules the SDK imports must not import `zod`, `ulid` or any other package. [The build contract](../../../proofs/arch/resources/sdk.md#^sdk-t-build) fails on any input outside `packages/shared/src/`.
- **Back pressure.** A spec ambiguity found while implementing is raised as a finding for the owning spec. A better way to prove something changes the proof, and that change is reviewed with the slice.

## Slice 1 — The resource layer and JSON store on the server

**Deliverable.** The server stores resources and bindings on disk, recovers them at startup, and serves the administrative routes and connection. It emits resource events to administrative clients and on `/events`, and removes an artifact's bindings when the artifact is deleted. The JSON store applies writes on the server with its limits, server values and durability rules, and serves `watch` subscriptions. Artifact pages cannot use resources yet.

**Shared module.** Start a browser-compatible, dependency-free `packages/shared/src/resources/` holding:
- the records, events and error codes of [the resource architecture](../../../specs/arch/resources/index.md#Records);
- name and description validation;
- the JSON store's [paths, values, write application, equality and child order](../../../specs/arch/resources/json-store.md#^js-arch-apply), [limits](../../../specs/arch/resources/json-store.md#^js-arch-limits) and [push keys](../../../specs/arch/resources/json-store.md#^js-arch-push-keys);
- the placeholder encoding that keeps server values and deletes apart from plain JSON;
- the administrative routes' sub-paths and the administrative connection's framing.

**Server.** Add `packages/server/src/resources/` holding:
- the layer;
- a file writer that takes its filesystem operations from an injected adapter (temporary file, flush, rename, directory flush);
- startup recovery and the destroy order;
- bindings and events;
- the server-side interface each type implements;
- the JSON store type: stored content, one queue per store, server values, the uncertain-write rule, duplication, and `watch` subscriptions with their `changed` events.

**Server integration.**
- `ServerStore` constructs the layer from `storagePath` and loads it at [bootstrap step 2](../../../specs/arch/resources/index.md#^rs-bootstrap). Deleting an artifact, whether directly or through its channel, removes its bindings and emits `unbound` for each.
- `Server` mounts `/api/resources/v1/` with bearer authentication and the origin check, and routes the administrative connection's upgrade. It also forwards resource events onto `/events` as `{ type: "resource-event", event }`, typed as a `ResourceEventMessage` in `packages/shared/src/types.ts` that stays out of the `ServerEvent` union, so the web client drops it under the unknown-message rule.

Three constraints from the existing code:
- **Bootstrap runs synchronously.** The `ServerStore` constructor is synchronous, and slice 6's installer creates and binds resources inside it. Give the layer synchronous load, create and bind paths for bootstrap, so that slice 6 does not have to change the bootstrap's shape.
- **No CORS headers.** Resource routes must not use `routes.ts`'s CORS middleware. Mount them where no CORS header applies, and before the static fallback.
- **Request bodies above 1 MiB.** `express.json()` defaults to a 100 KB body limit. Give the administrative JSON routes the JSON store's [message limit](../../../specs/arch/resources/json-store.md#^js-arch-write-limit) as their body limit, so that a write's result is refused by the store's rule, and a larger body with `too-large`. (Slice 2 review set this limit; slice 1 had used 4 MB.)

**Proof-derived verification.**

| Evidence | Work in this slice |
| --- | --- |
| [Paths](../../../proofs/arch/resources/json-store.md#^js-arch-t-paths), [values](../../../proofs/arch/resources/json-store.md#^js-arch-t-values), [applying a write](../../../proofs/arch/resources/json-store.md#^js-arch-t-apply), [limits](../../../proofs/arch/resources/json-store.md#^js-arch-t-limits), [push keys](../../../proofs/arch/resources/json-store.md#^js-arch-t-push-keys), [validation](../../../proofs/arch/resources/index.md#^rs-arch-t-validation) | Shared-module contracts in `packages/shared/test/`. Push keys use Vitest's fake system time, as declared. |
| [Files](../../../proofs/arch/resources/index.md#^rs-arch-t-files), [write order](../../../proofs/arch/resources/index.md#^rs-arch-t-write-order), [startup](../../../proofs/arch/resources/index.md#^rs-arch-t-startup), [stored content](../../../proofs/arch/resources/json-store.md#^js-arch-t-stored-content), [durability failures](../../../proofs/arch/resources/json-store.md#^js-arch-t-uncertain) | Layer and JSON store contracts over temporary storage, with the recording and failing storage-operations adapter where named. Startup's refusal of artifact-route requests while the bindings file is unreadable is completed in slice 2. |
| [Artifact deletion](../../../proofs/arch/resources/index.md#^rs-arch-t-artifact-delete), [administrative routes](../../../proofs/arch/resources/index.md#^rs-arch-t-admin-routes), [events](../../../proofs/arch/resources/index.md#^rs-arch-t-events), [refusals](../../../proofs/arch/resources/index.md#^rs-arch-t-refusals), [write application](../../../proofs/arch/resources/json-store.md#^js-arch-t-apply-writes) | Contracts against a really-running in-process server through HTTP, the administrative connection and `/events`. |
| [Origin check](../../../proofs/arch/resources/index.md#^rs-arch-t-origin), [subscriptions](../../../proofs/arch/resources/json-store.md#^js-arch-t-subscriptions) | The administrative half: the route family and `watch`. Slice 2 adds the artifact routes and page subscriptions. |

**Expected baseline after this slice.** The assertions above are green for the parts allocated here, and existing server, shared and web suites stay green apart from the starting baseline. No artifact-route or SDK behavior exists yet. Any new failure is recorded with its assigned slice.

## Slice 2 — The page connection

**Deliverable.** An artifact's page can open `/artifact-resources/<id>/v1/connection` and use exactly the resources its artifact is bound to, with no token. The connection provides:
- the opening state;
- session records kept in memory under random IDs for at least two minutes;
- ordered writes with resend that never applies a write twice;
- checks when each operation is applied;
- subscription updates before acknowledgements;
- the page's subset of events;
- the JSON store's `get`, subscriptions, writes and compare-and-set.

**Implementation.**
- **Shared code.** Add the page connection's framing to the shared module.
- **Connection handler.** In the server, add the handler, routed from `Server.handleUpgrade`, and the session-record store with its injectable clock. Add the opening-state interruption test option.
- **Origin check on the artifact routes.** Apply the same check as on the administrative routes.
- **Startup.** While the bindings file is unreadable, artifact-route requests are refused with `unavailable`.
- **JSON store.** Implement its page operations, including [read order](../../../specs/arch/resources/json-store.md#^js-arch-read-order), with values carrying the highest sequence number of the session's writes they include.
- **Message limit.** The page connection, the administrative connection and the administrative request bodies take messages up to the JSON store's [message limit](../../../specs/arch/resources/json-store.md#^js-arch-write-limit), from one shared constant. The shared module provides the sender's measure, `checkWriteMessage`, for slices 3 and 4.

Tests drive connections with a Node client that speaks the shared framing over the `ws` package the server already depends on. `increment` writes make any double application visible.

**Proof-derived verification.**

| Evidence | Work in this slice |
| --- | --- |
| [Artifact routes](../../../proofs/arch/resources/index.md#^rs-arch-t-artifact-routes), [origin check](../../../proofs/arch/resources/index.md#^rs-arch-t-origin), [startup](../../../proofs/arch/resources/index.md#^rs-arch-t-startup) | The artifact-route halves, completing all three assertions. |
| [Session records](../../../proofs/arch/resources/index.md#^rs-arch-t-session-records), [write order and resend](../../../proofs/arch/resources/index.md#^rs-arch-t-sequence) | Contracts with the session-record clock (retention one millisecond inside two minutes), restarts over the same storage, and the opening-state interruption hook in both its held-record and after-restart cases. |
| [Checks](../../../proofs/arch/resources/index.md#^rs-arch-t-checks), [notifications before acknowledgement](../../../proofs/arch/resources/index.md#^rs-arch-t-notify-before-ack), [a page's events](../../../proofs/arch/resources/index.md#^rs-arch-t-page-events) | Contracts with bindings changed through the administrative routes. |
| [Read order](../../../proofs/arch/resources/json-store.md#^js-arch-t-read-order), [compare-and-set](../../../proofs/arch/resources/json-store.md#^js-arch-t-cas), [subscriptions](../../../proofs/arch/resources/json-store.md#^js-arch-t-subscriptions), [access classification](../../../proofs/arch/resources/json-store.md#^js-arch-t-access) | JSON store page operations; completes the subscriptions assertion. |
| [Message limit](../../../proofs/arch/resources/json-store.md#^js-arch-t-write-limit), and the measure in [limits](../../../proofs/arch/resources/json-store.md#^js-arch-t-limits) | Boundary contracts with writes made almost entirely of `increment` placeholders, at the limit and one byte over, on both route families; the shared measure at the limit and one byte over. |

**Expected baseline after this slice.** Every server-side resource and JSON store assertion is green. The SDK does not exist yet. The starting baseline is unchanged.

## Slice 3 — The resource SDK

**Deliverable.** A running server serves `/sdk/v1/resources.js`, built from first-party code only. In a real browser on a plain-HTTP origin that is not `localhost`, an artifact's page:
- lists and inspects its resources;
- gets handles by name;
- reads, writes and subscribes, seeing its own writes at once;
- recovers from lost connections and restarts under the resend-or-roll-back rule;
- runs transactions.

**Build and serving.**
- **Source.** The SDK's entry is `packages/shared/src/resources/sdk.ts`. It imports only first-party resource modules.
- **Server build.** The server package build bundles it with esbuild into `packages/server/dist/sdk/v1/resources.js`. [The build contract](../../../proofs/arch/resources/sdk.md#^sdk-t-build) reads esbuild's metafile, so the build must expose the metafile without writing it under `dist/sdk/`, because the CLI copies that tree byte-for-byte.
- **Serving.** `Server` gains the optional `sdkDir` and serves the module without authorization, with an `ETag` and `Cache-Control: no-cache`.

**SDK behavior.** Implement every SDK spec section:
- [finding the artifact](../../../specs/arch/resources/sdk.md#^sdk-artifact-id), [the layer's functions](../../../specs/arch/resources/sdk.md#The layer's functions), [handles](../../../specs/arch/resources/sdk.md#^sdk-handles), [the connection client](../../../specs/arch/resources/sdk.md#^sdk-connection) and [reconnection](../../../specs/arch/resources/sdk.md#^sdk-reconnect);
- no write on a connection before its opening state, resend only to the same record ID, and roll back with `disconnected` otherwise or after 30 seconds;
- [plain HTTP](../../../specs/arch/resources/sdk.md#^sdk-plain-http) and [callback isolation](../../../specs/arch/resources/sdk.md#^sdk-callback-isolation);
- the JSON store's [SDK functions](../../../specs/arch/resources/json-store.md#^js-arch-sdk), [local-write model](../../../specs/arch/resources/json-store.md#^js-arch-local-writes) (including the `onValue`-only `hasPendingWrites` notification and child events computed from successive values) and [transactions](../../../specs/arch/resources/json-store.md#^js-arch-transactions);
- the [message limit](../../../specs/arch/resources/json-store.md#^js-arch-write-limit): each write's serialized message passes the shared `checkWriteMessage` before it is queued, and one that does not is rejected with `too-large` and sent nowhere.

**Harness.** In `e2e:server`, using the hooks the [SDK proof](../../../proofs/arch/resources/sdk.md#Test hooks) declares:
- **Host-name mapping.** Launch Chromium with `--host-resolver-rules`, and have every test page check that `isSecureContext` is false.
- **Network proxy.** A test-controlled TCP proxy that can hold, sever and refuse connections.
- **Stop-after-saving.** Add the server option for the restart assertions.
- **Build.** The surface already builds the server package first, which now builds the SDK.

**Proof-derived verification.**

| Evidence | Work in this slice |
| --- | --- |
| [Build](../../../proofs/arch/resources/sdk.md#^sdk-t-build), [serving](../../../proofs/arch/resources/sdk.md#^sdk-t-serving) | Real server build and metafile; in-process server with and without `sdkDir`. This also discharges the [licensing proof](../../../proofs/product/licensing.md)'s SDK paragraph. |
| [Finding the artifact](../../../proofs/arch/resources/sdk.md#^sdk-t-artifact-id), [layer](../../../proofs/arch/resources/sdk.md#^sdk-t-layer), [handles](../../../proofs/arch/resources/sdk.md#^sdk-t-handles), [connection](../../../proofs/arch/resources/sdk.md#^sdk-t-connection), [reconnection](../../../proofs/arch/resources/sdk.md#^sdk-t-reconnect), [callback isolation](../../../proofs/arch/resources/sdk.md#^sdk-t-callback-isolation) | Browser contracts in `packages/server/test/e2e/`. |
| [SDK functions](../../../proofs/arch/resources/json-store.md#^js-arch-t-sdk), [local view](../../../proofs/arch/resources/json-store.md#^js-arch-t-local-view), [refused after shown](../../../proofs/arch/resources/json-store.md#^js-arch-t-refused-after-shown), [transactions](../../../proofs/arch/resources/json-store.md#^js-arch-t-transactions) | Browser contracts, with the network proxy where named. |
| [Within 30 seconds](../../../proofs/arch/resources/json-store.md#^js-arch-t-reconnect-within), [after 30 seconds](../../../proofs/arch/resources/json-store.md#^js-arch-t-reconnect-timeout), [restart before acknowledgement](../../../proofs/arch/resources/json-store.md#^js-arch-t-restart-resend) | The JSON store spec's testing directive: proxy, Playwright page clock, stop-after-saving, and both reconnection cases after a restart. |

**Expected baseline after this slice.** All SDK and JSON store browser assertions are green. The CLI cannot yet serve the SDK, because packaging lands in slice 4. The starting baseline is unchanged.

## Slice 4 — The client, the `tv resource` commands and packaging

**Deliverable.** Agents manage and use resources with `tv resource` and `tv resource json`, with the outputs, refusals and warnings the product specs give. The packaged CLI ships the SDK, and `tv serve` serves it.

**Implementation.**
- **Shared client.** Add `TelevisionClient.resources` with `json` to the shared client. One-shot operations go over HTTP. `events` and `watch` use the administrative connection through Node's global `WebSocket`, carrying the token as the `token` query parameter. The JSON store's write methods pass each request body through the shared `checkWriteMessage` before sending it, refusing a larger one with `too-large` ([message limit](../../../specs/arch/resources/json-store.md#^js-arch-write-limit)).
- **CLI commands.** In `packages/cli/src/index.ts`:
  - register the `resource` family and its `json` verbs, with directive errors;
  - apply the client-port rules and refuse `--server`;
  - list `resource` in top-level help;
  - write the bind warning on tokenless servers;
  - add the resource-binding sentence to the tokenless startup warning.
- **Packaging.**
  - The contract types gain `sdkDir` and `resolveSdkDir`.
  - The default environment's `createServer` passes `sdkDir`, and foreground `tv serve` passes the resolved SDK directory.
  - `build.mjs` copies `packages/server/dist/sdk/` to `dist/sdk/` and defines `__TV_SDK_DIR__`.

**Proof-derived verification.**

| Evidence | Work in this slice |
| --- | --- |
| [Resource CLI contract](../../../proofs/arch/resources/index.md#^rs-arch-t-cli-contract), [JSON store CLI contract](../../../proofs/arch/resources/json-store.md#^js-arch-t-cli-contract) | In-process `runCLI` contracts with the fake client. |
| [Resource CLI seam](../../../proofs/arch/resources/index.md#^rs-arch-t-cli-seam), [JSON store CLI seam](../../../proofs/arch/resources/json-store.md#^js-arch-t-cli-seam) | Command actions against a really-running server, beside the existing CLI seams in `test/node/`. |
| [Help](../../../proofs/arch/cli/index.md#^723f3673), [client port](../../../proofs/arch/cli/index.md#^cli-client-port-contract), [contract types](../../../proofs/arch/cli/index.md#^cli-contract-type-drift), [serve options](../../../proofs/arch/cli/index.md#^be9f1ee3), [tokenless warnings](../../../proofs/arch/cli/index.md#^cli-tokenless-warnings) | The extensions and updates each citation names as tests to be written. |
| [SDK copy](../../../proofs/arch/cli/index.md#^cli-build-sdk-copy), [SDK resolver](../../../proofs/arch/cli/index.md#^cli-resolve-sdk-success), [SDK served by the built CLI](../../../proofs/arch/cli/index.md#^cli-sdk-served) | `resource SDK` rows in `test/node/cli-assets.test.ts`, and a built-CLI serve check. |
| [Lifecycle](../../../proofs/product/resources/resources.md#^rs-ac-cli-lifecycle), [refusals](../../../proofs/product/resources/resources.md#^rs-ac-cli-refusals), [tokenless bind](../../../proofs/product/resources/resources.md#^rs-ac-tokenless-bind), [JSON store commands](../../../proofs/product/resources/json-store.md#^js-ac-cli), [unreadable stored data](../../../proofs/product/resources/json-store.md#^js-ac-unavailable) | Built-CLI walks in `test/node/` over temporary homes with port `0`. |

**Expected baseline after this slice.** Every CLI and command-level product assertion is green, and the packaged CLI serves the SDK. The starting baseline is unchanged.

## Slice 5 — Browser acceptance through the built product, and the resource guidance

**Deliverable.** The feature is proven end to end in Chromium and Firefox: pages using resources by name from a plain-HTTP host name, sharing across two built servers with server-enforced access, and a page seeing its own writes. The `television` skill teaches resources with an example that runs as written, and `tv-tasks` points task lists at a store.

**Browser harness.** Build a harness in `test/node/` that:
- launches built-CLI servers on mapped host names;
- launches Chromium with `--host-resolver-rules` and Firefox with `network.dns.localDomains`;
- loads the app each server serves.

Add the `playwright-firefox` preflight to `e2e:node` in `test.config.mjs`, and update any registry test that pins that surface's declaration. The sharing walk adds the raw-WebSocket page that bypasses the SDK and the viewer-origin page that knows the producer's artifact ID. If these walks expose a defect in slices 1 to 4, fix it here with a narrow regression test at its owning boundary.

**Guidance.**
- Write `packages/skills/skills/television/src/resources.md`, covering every item in [what it teaches](../../../specs/arch/resources/guidance.md#^rg-teaches). Its one complete artifact example imports `/sdk/v1/resources.js`.
- Add the one-line pointer to the `television` `SKILL.md`, and make the build emit the third file.
- Add the `tv-tasks` rule ([the task-list skill](../../../specs/arch/resources/guidance.md#^rg-tv-tasks)).

**Proof-derived verification.**

| Evidence | Work in this slice |
| --- | --- |
| [Page uses resources by name](../../../proofs/product/resources/resources.md#^rs-ac-page-spine), [sharing across two servers](../../../proofs/product/resources/resources.md#^rs-ac-sharing) | Built-CLI browser walks in Chromium and Firefox. |
| [Page and agent share a store](../../../proofs/product/resources/json-store.md#^js-ac-page-spine), [a page sees its own writes](../../../proofs/product/resources/json-store.md#^js-ac-local-writes) | Built-CLI browser walks in Chromium. |
| [Bundle shape](../../../proofs/arch/making-skills.md#^making-skills-t-theming-bundle), [document role](../../../proofs/arch/resources/guidance.md#^rg-t-document), [what it teaches](../../../proofs/arch/resources/guidance.md#^rg-t-teaches), [task-list rule](../../../proofs/arch/resources/guidance.md#^rg-t-tv-tasks) | Skills-build tests over the real build. The second and third also need independent guidance review, which the slice review carries. |
| [The example runs](../../../proofs/arch/resources/guidance.md#^rg-t-example) | The example extracted from the freshly built `resources.md`, run through the built CLI in the slice's browser harness. |

**Expected baseline after this slice.** All resource product assertions and guidance assertions are green, in both browsers where the proofs require it. The starting baseline is unchanged.

## Slice 6 — Onboarding

**Deliverable.**
- Onboarding installs artifacts with ordinary generated IDs, keeps their copied files at slug-derived copy names, and never reuses an artifact.
- It creates and binds the resources each artifact declares. It leaves a taken name alone and warns, and it never fails a channel over a resource.
- Company To-dos remembers which tasks are done in `company-todos`, and still works, without saving, when it cannot use the store. (Round 2, below, replaces this fallback.)
- The starting baseline is resolved.

**Content and bake.**
- **Schema.** Add `resources` declarations to the onboarding config schema and its validation in `packages/server/src/onboarding-content.ts` and the build validator. This covers exact keys, the resource name rules, one-line descriptions, starting values under the shared JSON rules and limits, and names unique across the config.
- **Bake.** The bake (`scripts/bake-onboarding.mjs`) accepts `resources` on cards, validates it, carries it into the config in schema key order, and copies and links `onboarding-company-todos.js` into `company-todos` only.
- **To-do store module.** Author `packages/server/assets/onboarding-company-todos.js` under [the Company To-dos design](../../../specs/ui/onboarding-artifacts/index.md#^productivity-todo-store). It should load the SDK with a dynamic `import()` and treat any failure or refusal as "cannot use the store". That covers the Frameset workshop, where `/sdk/v1/resources.js` does not exist.
- **Re-bake.** Run the bake for Productivity, an author-run step, so the shipped tree carries the frame's task `id`s, the declaration and the module. Commit the regenerated assets.

**Installer.**
- Create every configured artifact with a generated ID, copying content to its copy name. Drop the reuse branch and the `^artifact-idempotent` citation, which clears the `spec-links` failure.
- After creating the artifacts, create and bind declared resources per [declared resources](../../../specs/arch/onboarding/installer.md#^onboarding-resource-install), using slice 1's synchronous bootstrap paths, then write pages over the new artifacts, as the spec's step order requires.

**Existing tests that pin what changed.** Update the tests the proofs mark for change:
- the installer tests that find artifacts by predictable IDs (`^t-exactly-once`, `^t-layout-install`, `^t-overwrite-unmarked`, `^t-fire-forget`, `^t-storage-path-absolute`) and the state-write ordering test;
- the crash-retry cases, which are rewritten from reuse to recreation;
- the fresh-install walks (`^ac-fresh-install` and `^ac-config-only-home`, `^ac-markdown-artifact`, `^ac-artifact-page-order`, `^ac-upgrade-only-new`, `^ac-deletion-respected`);
- the CLI relative-home seam (`^cli-relative-home-seam`).

Each is updated minimally, keeping its grade.

**Proof-derived verification.**

| Evidence | Work in this slice |
| --- | --- |
| [Validation matrix](../../../proofs/arch/onboarding/content.md#^t-validation-matrix), [production tree](../../../proofs/arch/onboarding/content.md#^t-production-tree) | Resource-declaration rows; the production `company-todos` declaration. |
| [Baked content](../../../proofs/arch/onboarding/bake.md#^t-baked-content), [to-do store module](../../../proofs/arch/onboarding/bake.md#^t-todo-store-module), [configuration update](../../../proofs/arch/onboarding/bake.md#^t-config-update), [input contract](../../../proofs/arch/onboarding/bake.md#^t-input-contract), [determinism](../../../proofs/arch/onboarding/bake.md#^t-bake-deterministic) | Bake extensions and rejections; clears the two failing bake tests. |
| [Generated IDs](../../../proofs/arch/onboarding/installer.md#^t-generated-ids), [declared resources](../../../proofs/arch/onboarding/installer.md#^t-onboarding-resources), [crash retry](../../../proofs/arch/onboarding/installer.md#^t-crash-retry), [fire-and-forget](../../../proofs/arch/onboarding/installer.md#^t-fire-forget), and the updated installer assertions above | Installer contracts over real storage, including a pre-existing store, an unreadable bindings file, and an earlier release's predictable-ID artifact. |
| [Artifact ID](../../../proofs/product/artifacts.md#^af-ac-artifact-id) | The generator and update-route contract. |
| [Fresh install](../../../proofs/product/onboarding/onboarding-channels.md#^ac-fresh-install), [deletion respected](../../../proofs/product/onboarding/onboarding-channels.md#^ac-deletion-respected), [a taken name](../../../proofs/product/onboarding/onboarding-channels.md#^ac-resource-taken), and the updated walks above | Built-CLI walks in `test/node/fresh-install-onboarding.test.ts`. |
| [Done state saved](../../../proofs/ui/onboarding-artifacts/index.md#^oa-ac-todo-store), [done state without a binding](../../../proofs/ui/onboarding-artifacts/index.md#^oa-ac-todo-store-unbound) | The proof's second seam: a really-running in-process server installing the real bake output, with slice 3's host mapping. Place it on whichever browser surface can build the skills, the server package and its SDK before the test, extending that surface's build step if needed. The existing skill-assets seam's failure clears with the bake change. |

**Expected baseline after this slice.** Every assertion in the plan is green, and no temporary failing-test baseline remains. `spec-links` passes, every *(test to be written)* marker this contribution added is replaced by evidence, and the integrated result is ready for its final review.

## Slice 6 round 2 — No offline mode

Slice 6 review round 1 found two defects in Company To-dos' fallback, and Josh decided to remove it and to give the SDK no offline mode of any kind. The specs and proofs change first and go to independent review; this work follows that review, against the design as it passes.

**Deliverable.**
- The page connection carries no sessions: no session IDs, session records or record IDs, no memory of handled writes, and no resend. Sequence numbers count each connection's writes.
- The SDK reports its connection status through `getConnectionStatus` and `onConnectionStatusChanged`. While disconnected, requests and writes fail at once with `disconnected`. A loss rolls back every unconfirmed write and rejects every outstanding request at once. Subscriptions stay registered and resubscribe on reconnection. The 30-second wait is gone.
- The guidance teaches the absence of an offline mode and how to show the connection status.
- Company To-dos has no local-only mode. Its checkboxes are disabled until the first value, while disconnected, and once the page cannot use the store. While the page can use the store, a refused save reverts its box and shows the error without disabling any checkbox; once the page loses the store, the checkboxes keep the state they last showed. The module's tag moves ahead of the task skill's JavaScript.

**Server.** Remove `session-records.ts`, the session and acknowledgement fields of the connection's greeting, the record ID in the opening state, and resend detection from `packages/server/src/resources/page-connection.ts`. Values carry the highest sequence number of their connection's writes. Remove the test options that existed for sessions: the session-record clock, the opening-state interruption and stop-after-saving.

**SDK.** In `packages/shared/src/resources/sdk-connection.ts`, add the status and its callbacks. Make requests and writes fail at once while disconnected, and roll back and reject everything outstanding at a loss, or when a connection closes before its opening state. Remove the session ID, record IDs, resend, the loss timers and the `acked` report. In `sdk-json-store.ts`, reject writes made while disconnected before showing them, and `runTransaction` before calling its function. Export the two status functions from `sdk.ts`.

**Guidance and module.**
- **Guidance.** Replace the guidance's 30-second paragraph in `packages/skills/skills/television/src/resources.md` with the connection rules, including that a write rolled back at a loss may still be applied, and a short status example. The runnable example stays as it is.
- **Module.** Rewrite `packages/server/assets/onboarding-company-todos.js` to [the rule](../../../specs/ui/onboarding-artifacts/index.md#^productivity-todo-store-problems). It disables every checkbox at once, by attribute so the order of upgrade does not matter. It enables them when the first value arrives and while connected, and it shows the house `.tv-error` message above the list. While the page can use the store, a refused save reverts its box, whether the SDK refuses it before or after showing it, and its error goes when a later toggle is saved. Once the page has lost the store, a late refusal changes no box. A failed SDK import shows that the SDK could not be loaded.
- **Bake.** Move the module's tag in `scripts/bake-onboarding.mjs` and re-bake Productivity.

**Proof-derived verification.**

| Evidence | Work in this round |
| --- | --- |
| [Opening state](../../../proofs/arch/resources/index.md#^rs-arch-t-opening-state), [write order](../../../proofs/arch/resources/index.md#^rs-arch-t-sequence), [read order](../../../proofs/arch/resources/json-store.md#^js-arch-t-read-order) | Replace the session-records contract; drop the resend cases; replace the restart case with a new connection. |
| [Connection status](../../../proofs/arch/resources/sdk.md#^sdk-t-connection-status), [connection lifecycle](../../../proofs/arch/resources/sdk.md#^sdk-t-connection), [reconnection](../../../proofs/arch/resources/sdk.md#^sdk-t-reconnect) | New status contract; drop the session-ID check; the layer's functions while connecting and disconnected. |
| [Lost connection](../../../proofs/arch/resources/json-store.md#^js-arch-t-lost-connection), [while disconnected](../../../proofs/arch/resources/json-store.md#^js-arch-t-disconnected), [first connection](../../../proofs/arch/resources/json-store.md#^js-arch-t-first-connection) | New browser contracts, replacing the within-30-seconds, beyond-30-seconds and restart contracts. |
| [Guidance](../../../proofs/arch/resources/guidance.md#^rg-t-teaches) | The connection item's check. |
| [To-do store module](../../../proofs/arch/onboarding/bake.md#^t-todo-store-module), [skill assets](../../../proofs/ui/onboarding-artifacts/index.md#^oa-ac-skill-assets) | The link's new place; Company To-dos' error outside artifact content. |
| [Done state](../../../proofs/ui/onboarding-artifacts/index.md#^oa-ac-todo-store), [without a binding](../../../proofs/ui/onboarding-artifacts/index.md#^oa-ac-todo-store-unbound), [without the SDK](../../../proofs/ui/onboarding-artifacts/index.md#^oa-ac-todo-store-no-sdk), [a refused save](../../../proofs/ui/onboarding-artifacts/index.md#^oa-ac-todo-store-refused), [disconnected](../../../proofs/ui/onboarding-artifacts/index.md#^oa-ac-todo-store-disconnected) | The held and the failed SDK download; the error and disabled checkboxes, at load and after the binding is removed; the refused save without a lockout and the disconnected state through the network proxy. |

**Temporary baseline until this round's code lands.** `spec-links.test.ts` fails its code-citation check on five citations of anchors the design removed:
- `packages/shared/src/resources/sdk-connection.ts` cites `^rs-session-lost`;
- `packages/server/test/resources/page-connection.test.ts` cites `^rs-arch-t-session-records`;
- `packages/server/test/e2e/resource-json-store-sdk.spec.ts` cites `^js-arch-t-reconnect-within`, `^js-arch-t-reconnect-timeout` and `^js-arch-t-restart-resend`.

The tests that prove the removed behavior still pass against the unchanged code until this round replaces them. The round's code cleared this baseline: `spec-links` passes.

**Expected baseline after this round.** Every assertion is green, `spec-links` passes, and no *(test to be written)* marker this contribution added remains.

## Event stream and retryable saves

Josh's decisions after the integrated review. The spec and proof changes come first and go to independent review; the code follows, test first. The spec and proof changes passed review, the last with that review's refinement. The code below, with the framing for the guidance's opening, passed independent review with no findings, and a fresh full verification passed on Blaxel.

**Deliverable.**

- Agents read resource events from `/events`; the administrative connection is gone.
- `watch` converges through `/events` and `get`, and `changed` lists the paths each write touched.
- An uncertain save of any resource file or the bindings file is read back and refused with an unknown outcome, and nothing becomes unavailable for it.

**Code, after review.**

- **Server.**
  - Delete `admin-connection.ts`, its route and construction in `server.ts`, and the connection's wire types and parser.
  - The JSON store's `write` passes its touched paths to `emitChanged`.
  - The layer replaces its three unavailable-until-restart branches and the stale-bindings flag with the read-back rule, reading files with the startup reader.
- **Shared client.**
  - An `/events` reader replaces `runOnAdminConnection` and the refused-upgrade probe. It reports a 4401 close as a `401` and passes on only `resource-event` messages.
  - `events` uses it, and `watch` follows `^js-arch-watch`.
- **Tests.** Every assertion the proofs mark as a test to be written, plus `packages/server/test/resources/harness.ts` without its administrative-connection client. These include the guidance check's case for the naming and description advice in `test/repo/resource-guidance.test.ts`.
- **Guidance.** `resources.md` says `watch` prints the current value and then the latest whenever it changes, and stops promising every change. Its naming and description advice is already in place from the spec round.
- **Onboarding's store.** `onboarding-company-todos.js` uses `productivity-onboarding-company-todos`; rebuild the skills and re-bake Productivity so the baked module and `onboarding-channels.json` carry the new name and description; change the tests that pin the name: `packages/server/test/onboarding-content.test.ts`, `packages/server/test/e2e/onboarding-company-todos.spec.ts` and `packages/web/test/e2e/onboarding-artifact-skill-assets.test.ts`. The artifact's slug, folder and file names keep `company-todos`.
- **Afterwards.** The PR description is revised.

**Verification.** The owning surfaces' affected files, `spec-links`, lint and type-check, then the full gate on Blaxel.

## Company To-dos as the JSON store's showcase

Josh's decisions after the integrated review's second round. The specs and proofs come first and go to independent review; the code follows, test first. The specs passed review, with two rulings and the lenient-reader decision. The code is in, with the header spacing ruled on after the implementer's visual check. It passed the code review with its visual check, and the full gate; the PR description describes it.

**Deliverable.**

- Every resource has a usage, set at creation, changed with `tv resource describe --usage`, and shown wherever a resource is inspected.
- Company To-dos renders its to-do list live from its store, which installation creates with the starting tasks due around the installation day and a real usage, and which the agent changes through `tv resource json`.
- `tv-tasks` is presentational, and the resource guidance teaches usage and shows the agent's commands beside its example.

**Code, after review.**

- **Usage.** Shared validation and types, the layer's records, storage and read-back, the administrative routes, the shared client and the CLI's `create --usage` and `describe [--usage]`.
- **Onboarding.** The content validator and the bake's declaration checks for `usage` and `shiftDatesFrom`; the installer's date shift; the relative-dates module without its Company To-dos branch; the to-do module rewritten to render the list from the store into the frame's shell; re-bake Productivity.
- **Skills.** `tv-tasks`' interactivity paragraph and the removal of its JSON store section; `resources.md`'s usage advice, `create --usage` and the agent commands beside the example; rebuild the skills.
- **Tests.** Every assertion the proofs mark as a test to be written.

**Verification.** The owning surfaces' affected files, `spec-links`, lint and type-check; a code review that includes a visual check of the running Company To-dos page; then the full gate on Blaxel and the PR description.

## The complete proposal: an artifact's own store, share links, and bindings behind a flag

Josh unblocked [the complete proposal](proposal.md). Its first specs and proofs passed review, and so did the first version of this plan. Josh then revised the design while slice 1 was under way, after its checkpoint: resources are identified by ID only, an artifact's own store is an ordinary store, and the flag hides only explicit creation and bindings. The revised specs and proofs passed review, and this section allocates them to slices. The specs and proofs govern.

### What changes

The code built by the earlier rounds keeps named resources and bindings as the only kind of resource. The complete proposal changes that:

- **Resources by ID only.** No resource has a name. Every resource has a resource ID, a required one-line description and a usage, which is empty unless given. The name rules, `name-taken`, `invalid-name` and `tv resource duplicate` go.
- **Storage.** A resource moves from one file per name (`<home>/resources/json/<name>.json`, holding its metadata and content together) to a directory per resource ID, holding `manifest.json`, in one format with `ownerArtifactID` for an own store, and the type's content files, here `content.json`. Stores are loaded when first used, not at startup, and startup reads only the bindings file, with the flag on.
- **An artifact's own store.** Every HTML path artifact with a generated ID has a store, which its record points to from the store's first write. It is an ordinary store with a fixed description, whose owner is bound to it at `read-write` implicitly. It can be destroyed, which clears the pointer first, and a destroy takes effect with its first step. Artifact records are saved under the resource layer's storage rule, with the uncertain-save rule.
- **Share links.** An artifact's record can carry one share link at `read` or `read-write`. The page connection and the artifact proxy accept a share ID wherever they accept an artifact ID, and nothing they send reveals the artifact's ID.
- **The bindings flag.** `RESOURCE_BINDINGS_ENABLED`, `false`, hides creating stores explicitly, binding and unbinding, and a page's use of stores by resource ID. Tests turn it on through the `Server` option `resourceBindings` and `CLIEnvironment.resourceBindings`. With it on, any store can be bound to any artifact by resource ID, another artifact's own store included.
- **Pages.** A page's access to its artifact's own store is the level of the ID in its address. The SDK adds `getStore()` for the own store, `getStore(resourceId)` behind the flag, `getAccess()` and `onAccessChanged()`. Pages receive no artifact ID or share ID, and no description or usage: a page's information about a store is its resource ID, type and the page's level on it.
- **Agents.** `tv resource json` addresses a store with exactly one of `--artifact` and `--resource`. `tv resource list`, `info`, `describe`, `destroy` and `events` work whatever the flag, with `info`, `describe` and `destroy` taking a resource ID; `json create`, `bind` and `unbind` exist only with the flag on. `tv share-artifact` and `tv unshare-artifact` are new.
- **Guidance and onboarding.** The guidance teaches the flag-off surface, keeps IDs out of artifact source and store data, and speaks of Firebase as an inspiration, not an equivalent. Onboarding declares a starting value for an artifact's own store, and Company To-dos uses `getStore()`.

### Approach and slice boundaries

Six slices build the change from the bottom up, in the same order as the first plan, so each can be proven at its own boundary:

1. **Storage, artifacts' own stores and bindings behind the flag, on the server.** Resource IDs and descriptions, the new layout, loading on first use, startup and listing, durable artifact records with the store pointer, the first write, own stores as ordinary stores, destroying, bindings by resource ID, events, artifact deletion, and the administrative routes. The shared client's administrative methods follow the routes.
2. **Share links and the page connection, on the server.** Share IDs and share changes, serving under a share ID, and the page connection: access by the ID's level, stores by resource ID with the flag on, the opening state, checks, changes of access, page events and what pages see when their own store is destroyed.
3. **The SDK.** `getStore()` and `getStore(resourceId)`, the access functions, `listResources` and `getResourceInfo` in the page's shapes, page events, and the browser contracts moved to artifacts' stores and share links.
4. **The CLI.** Store addressing, the common commands by resource ID, the share commands, the commands the flag leaves out, the tokenless warning, and the built-CLI walks.
5. **Browser acceptance through the built product, and the guidance.** The page, sharing and exposure walks, and the rewritten `resources.md` with its runnable example.
6. **Onboarding.** The `store` declaration, the installer's starting values, the Company To-dos module, and the onboarding walks.

Then come the integrated review, the full gate and the PR description, as in [Integrated verification and delivery](#Integrated verification and delivery).

Share links come after storage because they rewrite the record that storage makes durable. The page connection goes with share links because its level comes from the ID in its address. The SDK follows its server side directly, so that its review checks it against a settled server, as before. The CLI needs only slices 1 and 2, and comes next. Onboarding comes last because its module needs the SDK's `getStore()` and its walks need the CLI's `--artifact`.

**Design choices within the specs**, for the plan's reviewer:

- **How the flag reaches the layer.** `ServerStore` constructs the layer and loads it at [bootstrap step 2](../../../specs/arch/resources/index.md#^rs-bootstrap) with the flag off, which reads no resource file, so the onboarding installer, which writes only artifacts' own stores, runs the same either way. `Server` passes its `resourceBindings` option to the layer when it is constructed, before it accepts connections. With the flag on, the layer then reads the bindings file, as [startup](../../../specs/arch/resources/index.md#^rs-startup) requires. The CLI's serve adapter passes `CLIServerOptions.resourceBindings` to `Server`.
- **The ID generator** is a `ServerStore` option defaulting to `ulid`. It generates artifact IDs, share IDs and resource IDs, and the store draws again when a new artifact ID or share ID equals an existing one of either kind ([share IDs](../../../specs/arch/resources/index.md#^rs-share-ids)).
- **Durable artifact records.** `ServerStore` writes and deletes record files through the resource layer's file writer (`rewriteFile` and `deleteFile` in `packages/server/src/resources/storage.ts`), with the same injected storage operations, so the storage-operations hook also reaches the record writer. After an uncertain save, the store reads the record back, takes what it holds as current, and fails the change with an unknown-outcome error. The artifact routes answer that error with `503` and its message, which the CLI prints as it prints other HTTP status errors ([saving a record](../../../specs/product/artifacts.md#^af-record-saved)).
- **The storage adapter** gains an operation for creating a directory, so that a store directory's creation and its parent's flush are recorded and can fail ([storage](../../../specs/arch/resources/index.md#^rs-storage)).
- **One model of an artifact's bindings.** The layer derives an artifact's bindings from the explicit ones it read and, while the record's pointer stands, the owner's implicit `read-write` binding to its own store. `info`, `list --artifact`, the destroy refusal and, in slice 2, a page's `listResources`, `getResourceInfo` and level on a store by resource ID use the derived set; the bindings file, a page's opening state and `bound` and `unbound` use the explicit ones only ([the owner's binding](../../../specs/arch/resources/index.md#^rs-own-store-binding)).
- **A destroy that has taken effect** is kept in memory: once its first step is saved, the layer marks the resource ID destroyed, so that `list` leaves it out and every operation on it but a destroy is refused with `not-found`, until a retried destroy deletes what remains. A restart forgets the mark and finds any remaining files as a store, as [the destroy order](../../../specs/arch/resources/index.md#^rs-destroy-order) states.
- **Route sub-paths** stay the shared code's choice ([the wire boundary](../../../specs/arch/resources/index.md#^rs-wire-boundary)). The JSON store's administrative routes take the store's address in the request instead of a name in the path, the common routes a resource ID, and the share routes act on an artifact by its ID.

### Observed starting baseline

These targeted results come from the branch at slice 1's checkpoint. They are not a full-suite baseline.

| Check | Result | Assigned to |
| --- | --- | --- |
| `test/repo/spec-links.test.ts` | Fails "test-code citations resolve to spec or proof anchors" on 9 citations of anchors the spec rounds removed: `^rs-names` in `packages/shared/src/resources/types.ts`. | Slice 1 |
| | `^onboarding-resource-config` in `packages/server/src/onboarding-content.ts`, `packages/server/test/onboarding-content.test.ts` and `scripts/bake-onboarding.mjs`; `^onboarding-resource-dates` and `^onboarding-resource-install` in `packages/server/src/onboarding-installer.ts`; `^t-onboarding-resources` in `packages/server/test/onboarding-installer.test.ts`; `^ac-resource-taken` in `test/node/fresh-install-onboarding.test.ts`; `^oa-ac-todo-store-unbound` in `packages/server/test/e2e/onboarding-company-todos.spec.ts`. | Slice 6 |
| | `test/node/resource-acceptance.test.ts` still marks its named walks with `^rs-ac-cli-lifecycle`, `^rs-ac-cli-refusals` and `^rs-ac-tokenless-bind`, in a form the check does not read; they go with those walks. | Slice 4 |
| `tsc --noEmit` | Fails in 14 files: the checkpoint moved the shared types and wire ahead of the server's layer, its routes, the shared client and their tests. | Slice 1 |
| `packages/server/test/resources/storage.test.ts`, `startup.test.ts` | The checkpoint's failing tests: 11 and 7 cases, ahead of the layer. Their manifest expectations predate the revision and change with it. | Slice 1 |
| `test/node/bake-onboarding.test.ts`, `packages/web/test/e2e/onboarding-artifact-skill-assets.test.ts` | Observed before the revision and not re-run, since nothing has touched onboarding: the bake refuses the Productivity manifest's `store` (`unknown field 'store' on a card in productivity/layout.yml`), failing two bake cases and the skill-assets case. | Slice 6 |

### Conventions for these slices

The [conventions for every slice](#Conventions for every slice) above hold, apart from their list of test hooks, which belonged to the removed resend design. These slices use the hooks the current proofs declare, each added in the slice whose tests first need it:

- the storage-operations adapter, which now also reaches the artifact record writer and directory creation, the bindings hook and the ID generator ([the resource architecture proof](../../../proofs/arch/resources/index.md#Test hooks)), in slice 1;
- the browser host-name mapping and the network proxy ([the SDK proof](../../../proofs/arch/resources/sdk.md#Test hooks)), which exist already and are harness rather than product code, in slice 3.

These additions hold too:

- **Every slice type-checks and lints.** A slice that changes a shared type or the layer's interface adapts every caller enough to compile, even where the caller's behavior is a later slice's work: for example, slice 1 passes `{ store: { resourceID } }` where the CLI passed a name, and the CLI's options are slice 4's.
- **Temporary failures are assigned.** Between slices, tests of behavior a later slice changes can fail. Each slice records those failures by test identity and the slice that clears them, and clears its own. No failure is left unassigned, and after slice 6 none remains.
- **Existing tests move with their surface.** Tests whose assertions the proofs keep unchanged, such as the JSON store's read order, transactions and connection status, move from named stores to artifacts' own stores, or turn the flag on where their proof names the hook, in the slice that owns their surface. Their assertions do not change.
- **The flag in tests.** Flag-on tests construct `Server` with `resourceBindings: true` and the CLI environment with `resourceBindings: true`. Nothing else changes the flag, and production passes neither.
- **Citations.** As each test lands, its proof marker changes from *(test to be written)* to the policy-grade citation in the same slice. Code that cites a removed anchor is fixed in the slice that rewrites that code.

### Slice 1 — Storage, artifacts' own stores and bindings behind the flag

**Deliverable.** The server keeps each resource in a directory under its resource ID, with a manifest carrying its description and usage, and loads it when first used. An HTML artifact's own store is reached through its record's pointer, which the store's first write saves first, and every artifact record is saved durably. An own store is an ordinary store: listed with its owner, described and destroyed like any other, its owner bound to it implicitly. Destroying works whatever the flag. With the flag on, stores are created explicitly and bound to artifacts by resource ID; with it off, those operations are refused with `not-enabled`. Events carry resource IDs, and deleting an artifact leaves its store. The administrative routes and the `/events` stream carry all of this. Share links and the page connection's new rules are slice 2's.

**Shared module** (`packages/shared/src/resources/`):
- `RESOURCE_BINDINGS_ENABLED`, `false`, replacing the checkpoint's `NAMED_RESOURCES_ENABLED`.
- `ResourceID` with its validation, `StoreAddress` as `{ artifactID } | { resourceID }`, and `OWN_STORE_DESCRIPTION`; the name rules and their validation go, and a description must not be empty.
- `ResourceSummary` with `resourceID`, `description`, `usage`, an optional `createdAt` and `ownerArtifactID`, and without `name` or `updatedAt`; `ResourceBinding` by resource ID; `ResourceEvent`, `PageEvent` and the page's `ResourceInfo` as [the records](../../../specs/arch/resources/index.md#^rs-records), [events](../../../specs/arch/resources/index.md#^rs-arch-events) and [the SDK](../../../specs/arch/resources/sdk.md#The layer's functions) give them.
- The error codes `no-store`, `not-enabled`, `not-shareable`, `not-shared`, `tokenless` and `owner-binding`, with their HTTP statuses; `name-taken` and `invalid-name` go.
- The administrative routes' sub-paths and bodies: the JSON store's by store address, and the common ones by resource ID.

**Server.**
- **Storage.** `storage.ts` gains directory creation followed by a flush of its parent.
- **The layer.** `layer.ts` is rewritten around resource IDs:
  - the one manifest format, validated field by field ([file formats](../../../specs/arch/resources/index.md#^rs-file-formats));
  - loading on first use, with its three incomplete states and the removal of leftover temporary files ([loading](../../../specs/arch/resources/index.md#^rs-load));
  - startup reading no manifest, and with the flag on the bindings file, discarding bindings whose artifact or store directory is gone ([startup](../../../specs/arch/resources/index.md#^rs-startup)), and [listing](../../../specs/arch/resources/index.md#^rs-list) loading every store;
  - [the first write](../../../specs/arch/resources/index.md#^rs-first-write) to an artifact's own store: the record's pointer, then the directory and the manifest with the own-store description and the owner, then the content, with one queue per store;
  - the uncertain-save rule for manifests, content, the bindings file and records ([uncertain saves](../../../specs/arch/resources/index.md#^rs-arch-uncertain-save));
  - description and usage changes for any store, own stores included;
  - [the owner's implicit binding](../../../specs/arch/resources/index.md#^rs-own-store-binding), and `owner-binding` for binding or unbinding it;
  - [the destroy order](../../../specs/arch/resources/index.md#^rs-destroy-order): the owner's pointer, then the bindings, then the files, taking effect with the first step, with `still-bound` unless forced;
  - the flag: `not-enabled` for creating, binding and unbinding with it off, while every other operation by resource ID works ([the flag](../../../specs/arch/resources/index.md#The bindings flag));
  - with it on, creating a store and binding any store, an own store included, to any artifact by resource ID;
  - events by resource ID, with an own store's owner in `changed` and `destroyed`.
- **The type contract** (`type.ts`) keys stores by resource ID, adds the content of a store with no value, and lets the type own its content files. The JSON store reads and writes `content.json`, compact, and deletes it when the store has no value ([the content file](../../../specs/arch/resources/json-store.md#^js-arch-content-file)).
- **`ServerStore`:**
  - the ID generator option;
  - durable record writes and deletions with the read-back rule;
  - the record's `store` field in `ArtifactSchema` and the artifact API's shapes;
  - [which artifacts have a store](../../../specs/arch/resources/index.md#^rs-has-store);
  - artifact deletion that keeps the store and, with the flag on, removes the artifact's bindings ([artifact deletion](../../../specs/arch/resources/index.md#^rs-artifact-delete)).
- **`Server`** takes `resourceBindings` and passes it to the layer. The administrative routes address stores by `StoreAddress` and resources by resource ID, and refuse what the flag hides with it off.
- **The shared client.** `JsonStoreClient` takes `store: StoreAddress`, and `create` takes a description, a usage and a value. `ResourcesClient`'s `list`, `info`, `describe`, `destroy`, `bind` and `unbind` take resource IDs, and `duplicate` goes. `watch` recognizes its store by the address it was given, its destruction included ([`watch`](../../../specs/arch/resources/json-store.md#^js-arch-watch)).
- **Callers.** The page connection, the onboarding installer's hooks and the CLI's resource commands are adapted only to compile. The page connection keeps serving the artifact's own store as far as the new layer allows; its rules are slice 2's. Onboarding still declares named stores, which no longer exist: until slice 6 the installer's hooks only compile, and installing such a declaration fails, which the installer already logs, leaving the channel installed.

**Proof-derived verification.**

| Evidence | Work in this slice |
| --- | --- |
| [Validation](../../../proofs/arch/resources/index.md#^rs-arch-t-validation) | `packages/shared/test/resources/names.test.ts`: the resource-ID case, the description case changed for the empty description, and the usage case; the name cases go. |
| [Files](../../../proofs/arch/resources/index.md#^rs-arch-t-files), [write order](../../../proofs/arch/resources/index.md#^rs-arch-t-write-order), [first writes](../../../proofs/arch/resources/index.md#^rs-arch-t-first-write) | `packages/server/test/resources/storage.test.ts`, with the recording and failing storage operations, and the bindings hook, where named. |
| [Uncertain saves](../../../proofs/arch/resources/index.md#^rs-arch-t-uncertain-save) | The record pointer, the description, destroying a store and an own store whose pointer save is uncertain, and, with the flag on, creating, binding and unbinding. The share-link, artifact-deletion and page-connection parts are slice 2's. |
| [Loading](../../../proofs/arch/resources/index.md#^rs-arch-t-load), [startup](../../../proofs/arch/resources/index.md#^rs-arch-t-startup), [listing](../../../proofs/arch/resources/index.md#^rs-arch-t-list), [file formats](../../../proofs/arch/resources/index.md#^rs-arch-t-file-formats), [data the flag leaves behind](../../../proofs/arch/resources/index.md#^rs-arch-t-flag-off-stored), [the content file](../../../proofs/arch/resources/json-store.md#^js-arch-t-content-file) | `packages/server/test/resources/startup.test.ts`. The page-connection parts of startup and of the flag-off contract wait for slice 2. |
| [Which artifacts have a store](../../../proofs/arch/resources/index.md#^rs-arch-t-has-store), [an own store is an ordinary store](../../../proofs/arch/resources/index.md#^rs-arch-t-own-store), [the record's fields](../../../proofs/arch/resources/index.md#^rs-arch-t-artifact-record) | New `packages/server/test/resources/artifact-stores.test.ts`, through the administrative routes and the `/events` stream. The page-connection parts of these contracts, and the record's `share`, are slice 2's. |
| [Artifact deletion](../../../proofs/arch/resources/index.md#^rs-arch-t-artifact-delete), [events](../../../proofs/arch/resources/index.md#^rs-arch-t-events) | `packages/server/test/resources/events.test.ts`, without the share link and page connections, which slice 2 adds. |
| [Administrative routes](../../../proofs/arch/resources/index.md#^rs-arch-t-admin-routes), [refusals](../../../proofs/arch/resources/index.md#^rs-arch-t-refusals) | `packages/server/test/resources/admin-routes.test.ts`, for JSON store operations, the common operations and, with the flag on, creation and bindings. The share changes are slice 2's. |
| [Write application](../../../proofs/arch/resources/json-store.md#^js-arch-t-apply-writes), [durability failures](../../../proofs/arch/resources/json-store.md#^js-arch-t-uncertain), [changed paths](../../../proofs/arch/resources/json-store.md#^js-arch-t-changed-paths) | `packages/server/test/resources/json-store-server.test.ts`, on artifacts' own stores. |
| [`watch`](../../../proofs/arch/resources/json-store.md#^js-arch-t-watch) | `packages/server/test/resources/json-watch.test.ts`, by each address, with `destroyed` ending a watch by resource ID and making a watch by artifact read again. |

**Expected baseline after this slice.** The assertions above are green for the parts allocated here, the tree type-checks, and `spec-links` no longer reports `^rs-names`. Until their slices, these are expected to fail: the page-connection and JSON store page contracts (`page-connection.test.ts`, `json-store-page.test.ts`; slice 2), the SDK's browser contracts (slice 3), the CLI's resource contracts (`packages/cli/test/resource-commands.test.ts`; slice 4), the built-product resource walks in `test/node/` (slices 4 and 5), and the onboarding tests that install or read its store (slice 6). The slice records each by test identity.

### Slice 2 — Share links and the page connection, on the server

**Deliverable.** An artifact can have one share link, created, changed and revoked through the administrative routes, saved in its record, and refused where the spec refuses it. The artifact proxy serves the artifact under the share ID without revealing the artifact's ID. A page connection under an artifact ID or a share ID reaches the artifact's own store at the ID's level, hears changes of that level, is closed by a revocation or the artifact's deletion, and receives no artifact ID, share ID, description or usage. When the own store is destroyed, the page's subscriptions to it hear no value as the destroy takes effect. With the flag on, it reaches every store its artifact is bound to by resource ID, its own included, at the lower of the two levels.

**Shared module.**
- The page connection's framing: operations address the artifact's own store when they carry no resource ID, and another store by its resource ID; the opening state carries the ID's level, the explicit bindings with the flag on, and the server's time; a message carries a new level; `listResources` and `getResourceInfo` requests are answered with `ResourceInfo`; page events are `PageEvent`. The connection path yields the ID it names, artifact ID or share ID.
- The share routes' sub-paths and bodies.

**Server.**
- **Share IDs.** The layer builds its map of share IDs from the loaded records and draws a new ID again on a collision ([share IDs](../../../specs/arch/resources/index.md#^rs-share-ids)). It resolves a request's ID to an artifact and a level ([resolving an ID](../../../specs/arch/resources/index.md#^rs-resolve-id)).
- **Share changes.** Creating, changing and revoking a link rewrite the record durably. Only then does the layer update its map, answer, and send the new level to, or close, the connections opened under that share ID. The refusals are `tokenless`, `not-shareable`, `no-artifact` and `not-shared` ([changing a share link](../../../specs/arch/resources/index.md#^rs-share-change)).
- **Artifact deletion** also removes the share ID and closes the connections opened under either ID.
- **The artifact proxy** (`packages/server/src/artifact-proxy.ts`) resolves a share ID like an artifact ID and builds every redirect, error document and header from the ID in the request ([serving under a share ID](../../../specs/arch/resources/index.md#^rs-share-serving)). A revoked share ID is served as an ID that names no artifact.
- **The page connection** (`page-connection.ts`) resolves its ID again for every operation. It refuses with `no-store`, `read-only`, `not-enabled` or `not-bound` as [the checks](../../../specs/arch/resources/index.md#The page connection) give them, answers `listResources` and `getResourceInfo` from the artifact's derived bindings, sends page events without an artifact ID, description or usage, and never sends `updated` or `created`. When the own store is destroyed, subscriptions made without a resource ID stay and hear no value, and those made by its resource ID end with `not-bound` ([own-store destruction](../../../specs/arch/resources/index.md#^rs-own-store-destroyed)). The origin check applies under share IDs as under artifact IDs.
- **The artifact API** carries the record's `share`.
- **The shared client** gains `share` and `unshare`.

**Proof-derived verification.**

| Evidence | Work in this slice |
| --- | --- |
| [Share IDs](../../../proofs/arch/resources/index.md#^rs-arch-t-share-ids), [changing a share link](../../../proofs/arch/resources/index.md#^rs-arch-t-share-change), [serving under a share ID](../../../proofs/arch/resources/index.md#^rs-arch-t-share-serving), and the share and page-connection parts of [the record's fields](../../../proofs/arch/resources/index.md#^rs-arch-t-artifact-record), [which artifacts have a store](../../../proofs/arch/resources/index.md#^rs-arch-t-has-store) and [an own store is an ordinary store](../../../proofs/arch/resources/index.md#^rs-arch-t-own-store) | `packages/server/test/resources/artifact-stores.test.ts`, with the ID-generator hook, the recording storage operations and the bindings hook where named. The own-store contract's page parts include the owner using its own store by resource ID and the page's subscriptions after a destroy that stops after its first step. |
| [Uncertain saves](../../../proofs/arch/resources/index.md#^rs-arch-t-uncertain-save), [artifact deletion](../../../proofs/arch/resources/index.md#^rs-arch-t-artifact-delete), [startup](../../../proofs/arch/resources/index.md#^rs-arch-t-startup), [data the flag leaves behind](../../../proofs/arch/resources/index.md#^rs-arch-t-flag-off-stored) | Their share-link, page-connection and deleted-artifact parts, completing all four. |
| [Artifact routes](../../../proofs/arch/resources/index.md#^rs-arch-t-artifact-routes), [opening state](../../../proofs/arch/resources/index.md#^rs-arch-t-opening-state), [write order](../../../proofs/arch/resources/index.md#^rs-arch-t-sequence), [checks](../../../proofs/arch/resources/index.md#^rs-arch-t-checks), [notifications before acknowledgement](../../../proofs/arch/resources/index.md#^rs-arch-t-notify-before-ack), [a page's events](../../../proofs/arch/resources/index.md#^rs-arch-t-page-events) | `packages/server/test/resources/page-connection.test.ts`, under artifact IDs and share IDs, and with the bindings hook where named, including descriptions and usages that contain the artifact's ID reaching no page. |
| [Administrative routes](../../../proofs/arch/resources/index.md#^rs-arch-t-admin-routes), [refusals](../../../proofs/arch/resources/index.md#^rs-arch-t-refusals), [origin check](../../../proofs/arch/resources/index.md#^rs-arch-t-origin) | Their share-change and share-ID cases, completing all three. |
| [Access classification](../../../proofs/arch/resources/json-store.md#^js-arch-t-access), and [read order](../../../proofs/arch/resources/json-store.md#^js-arch-t-read-order), [compare-and-set](../../../proofs/arch/resources/json-store.md#^js-arch-t-cas), [subscriptions](../../../proofs/arch/resources/json-store.md#^js-arch-t-subscriptions) and [the message limit](../../../proofs/arch/resources/json-store.md#^js-arch-t-write-limit) moved to artifacts' stores | `packages/server/test/resources/json-store-page.test.ts` and the page-connection tests, with `read` access coming from a share link. |

**Expected baseline after this slice.** Every server-side resource and JSON store assertion is green. The SDK, CLI, product-walk and onboarding failures listed after slice 1 remain, assigned as there.

### Slice 3 — The SDK

**Deliverable.** In a real browser, a page served under its artifact ID or a share ID finds its artifact and uses its own store with `getStore()`. It reads its level with `getAccess()` and hears changes with `onAccessChanged()`. A write at `read` is refused before any listener hears it. Page events and store information carry no artifact ID, description or usage, and a handle from `getStore(resourceId)` fails with `not-enabled` while the flag is off.

**First, the spec: losing access is an access change.** From slice 2's review: a page that listens only for access changes and the connection status sees a revocation as `disconnected`, then `connected`, and is never told that its access ended, because [the SDK contract](../../../specs/arch/resources/sdk.md#^sdk-access) calls no access listener while no store is reachable. The ruling: a page whose address stops reaching a store hears its loss of access through `onAccessChanged`, for example as no access. The slice starts by changing that contract in `sdk.md` and its proof, as a derived decision for Josh to check, before the SDK is written to it.

**Shared module.**
- `sdk-page.ts` takes the ID from the page's address as it stands, an artifact ID or a share ID ([finding the artifact](../../../specs/arch/resources/sdk.md#^sdk-artifact-id)).
- `sdk.ts` exports `getAccess` and `onAccessChanged` ([the page's access level](../../../specs/arch/resources/sdk.md#^sdk-access)), and `listResources`, `getResourceInfo` and `onResourcesChanged` with the page's shapes, `ResourceInfo` being `{ resourceID, type, access }`.
- `sdk-connection.ts` keeps the level from the opening state and level messages. It opens the connection for `onAccessChanged` listeners, as for other listeners. After a revocation closes the connection, it reconnects as after any loss, and the next operation on the artifact's own store fails with `no-store`.
- `sdk-json-store.ts`:
  - `getStore()` returns the artifact's own store, whose `resourceID` is `null`, and `getStore(resourceId)` a handle for that store, the artifact's own included ([handles](../../../specs/arch/resources/sdk.md#^sdk-handles), [handles for bound stores](../../../specs/arch/resources/sdk.md#^sdk-bound-handles));
  - local writes check the page's level before showing a write ([local writes](../../../specs/arch/resources/json-store.md#^js-arch-local-writes));
  - its two comments that say `push`'s promise behaves "as Firebase's" lose that claim, matching [the SDK's functions](../../../specs/arch/resources/json-store.md#^js-arch-sdk) as the spec now words them.

**Harness.** `packages/server/test/e2e/resource-sdk-harness.ts` registers HTML artifacts, opens them under their IDs or share links, and constructs the server with the bindings hook where a test names it.

**Proof-derived verification.**

| Evidence | Work in this slice |
| --- | --- |
| [Finding the artifact](../../../proofs/arch/resources/sdk.md#^sdk-t-artifact-id), [the layer's functions](../../../proofs/arch/resources/sdk.md#^sdk-t-layer), [handles](../../../proofs/arch/resources/sdk.md#^sdk-t-handles), [connection lifecycle](../../../proofs/arch/resources/sdk.md#^sdk-t-connection), [reconnection](../../../proofs/arch/resources/sdk.md#^sdk-t-reconnect) | `packages/server/test/e2e/resource-sdk.spec.ts`, including the artifact's own store through `getStore(resourceId)` and listed by `listResources`. [Connection status](../../../proofs/arch/resources/sdk.md#^sdk-t-connection-status) and [callback isolation](../../../proofs/arch/resources/sdk.md#^sdk-t-callback-isolation) move to artifacts' stores unchanged. |
| [The SDK's functions](../../../proofs/arch/resources/json-store.md#^js-arch-t-sdk), [the local view](../../../proofs/arch/resources/json-store.md#^js-arch-t-local-view), [a write refused after the page showed it](../../../proofs/arch/resources/json-store.md#^js-arch-t-refused-after-shown) | `packages/server/test/e2e/resource-json-store-sdk.spec.ts`. The local view's generated programs use the artifact's own store and, with the bindings hook, a created store bound at `read-write`. |
| [Lost connection](../../../proofs/arch/resources/json-store.md#^js-arch-t-lost-connection), [while disconnected](../../../proofs/arch/resources/json-store.md#^js-arch-t-disconnected), [first connection](../../../proofs/arch/resources/json-store.md#^js-arch-t-first-connection), [transactions](../../../proofs/arch/resources/json-store.md#^js-arch-t-transactions) | Moved to artifacts' stores, their assertions unchanged. |
| [Build](../../../proofs/arch/resources/sdk.md#^sdk-t-build), [serving](../../../proofs/arch/resources/sdk.md#^sdk-t-serving) | Re-run unchanged. Every input the SDK bundles is still the project's own source under `packages/shared/src/`, including the push-key generator adapted from the Firebase JavaScript SDK, which keeps its attribution comment and the Apache License 2.0 notice in the SDK's notices file ([the licensing proof](../../../proofs/product/licensing.md#^licensing-ac-adapted-code)). |

**Expected baseline after this slice.** Every SDK and JSON store browser contract is green. The CLI, product-walk and onboarding failures remain, assigned as before.

### Slice 4 — The CLI

**Deliverable.** An agent reads, writes and watches any store with `--artifact` or `--resource`, lists, inspects, describes and destroys stores by resource ID, follows resource events, and shares or unshares an artifact. The shipped CLI offers no command for creating stores or bindings. With the flag on, `json create`, `bind` and `unbind` work by resource ID.

**CLI** (`packages/cli/src/index.ts`):
- `CLIEnvironment.resourceBindings` and `CLIServerOptions.resourceBindings`, defaulting to the flag constant; the serve adapter passes the latter to `Server` ([contract surface](../../../specs/arch/cli/index.md#Contract surface)).
- The json verbs take exactly one of `--artifact` and `--resource`; neither or both is a directive error. Their confirmation lines and refusals follow [the commands](../../../specs/product/resources/json-store.md#^js-cli-store).
- `list [--artifact <id>]`, `info <resource-id>`, `describe <resource-id> [<description>] [--usage <text>]`, `destroy <resource-id> [--force]` and `events` are registered whatever the flag; `duplicate` and `--name` go. `json create --description <text> [--usage <text>]` prints `{"resourceID":"<resource-id>"}`, and it, `bind` and `unbind` are registered only with the flag on ([the common commands](../../../specs/product/resources/resources.md#^rs-cli), [CLI integration](../../../specs/arch/resources/index.md#^rs-cli-integration)).
- `tv share-artifact --id <id> --access <level>` prints one link per listening address through the formatter `tv links` uses, and `tv unshare-artifact --id <id>` prints its line ([the share commands](../../../specs/arch/resources/index.md#^rs-share-cli-integration)). The help table gains both rows, and `tv resource`'s purpose changes ([CLI help](../../../specs/product/cli.md)).
- The tokenless startup warning leaves out its sentence about bindings unless the flag is on ([the warning](../../../specs/product/cli.md#^cli-tokenless-bindings-sentence)).

**Proof-derived verification.**

| Evidence | Work in this slice |
| --- | --- |
| [The share and resource commands' contract](../../../proofs/arch/resources/index.md#^rs-arch-t-cli-contract), [the JSON store commands' contract](../../../proofs/arch/resources/json-store.md#^js-arch-t-cli-contract) | `packages/cli/test/resource-commands.test.ts`: "the share commands", "the common commands", "the commands the flag leaves out" and, with the flag on, "binding"; the JSON commands by each address. |
| [The CLI seam](../../../proofs/arch/resources/index.md#^rs-arch-t-cli-seam), [the JSON store seam](../../../proofs/arch/resources/json-store.md#^js-arch-t-cli-seam) | `test/node/resource-cli-integration.test.ts`: "the share commands against a running server" and, with the flag on, "created stores and bindings against a running server", replacing the named lifecycle. |
| [Tokenless warnings](../../../proofs/arch/cli/index.md#^cli-tokenless-warnings), [contract types](../../../proofs/arch/cli/index.md#^cli-contract-type-drift), the serve contract's `resourceBindings` | `packages/cli/test/cli.test.ts` and `packages/cli/test/contract-types.test.ts`. |
| [Share commands](../../../proofs/product/resources/resources.md#^rs-ac-share-cli), [the common commands](../../../proofs/product/resources/resources.md#^rs-ac-common-commands), [recovery](../../../proofs/product/resources/resources.md#^rs-ac-recovery), [the flag off](../../../proofs/product/resources/resources.md#^rs-ac-flag-off), [the json commands](../../../proofs/product/resources/json-store.md#^js-ac-cli), [unreadable stored data](../../../proofs/product/resources/json-store.md#^js-ac-unavailable) | Built-CLI walks in `test/node/resource-acceptance.test.ts`, replacing the named lifecycle walks and their `^rs-ac-cli-lifecycle`, `^rs-ac-cli-refusals` and `^rs-ac-tokenless-bind` markers. |

**Expected baseline after this slice.** The CLI's contracts, seams and built-CLI walks are green, and no test marks a removed acceptance anchor. The browser product walks (slice 5) and onboarding (slice 6) remain.

### Slice 5 — Browser acceptance through the built product, and the guidance

**Deliverable.** The built product's pages use their own stores in Chromium and Firefox, a share link's level is enforced across two servers as it changes and is revoked, and a share viewer receives nothing that carries the artifact's ID, even when an agent writes it into the store's description and usage. The `television` skill teaches the flag-off surface, presents the store's API as inspired by Firebase's, and its example runs as written on its own store.

**Walks.**
- `test/node/resource-page-acceptance.test.ts` follows [the page walk](../../../proofs/product/resources/resources.md#^rs-ac-page-spine) on an artifact's own store, with `getStore(resourceId)` refused while the flag is off. Its test that "uses the Firebase-shaped functions" is renamed for the store's own functions ([the JSON store page walk](../../../proofs/product/resources/json-store.md#^js-ac-page-spine)), and the local-writes walk refuses a write through a share link at `read`.
- `test/node/resource-sharing-acceptance.test.ts` becomes [the share-link walk](../../../proofs/product/resources/resources.md#^rs-ac-sharing), in Chromium and Firefox.
- New `test/node/resource-share-exposure.test.ts` is [the exposure walk](../../../proofs/product/resources/resources.md#^rs-ac-share-hides-id), including `tv resource describe` with the artifact's ID. Its artifacts are stored under names containing their IDs, a folder and a single HTML file, so that anything built from a file's name would carry the ID (slice 2's review).
- `test/node/resource-product-harness.ts` shares artifacts through the built CLI.

**Guidance.**
- `packages/skills/skills/television/src/skill-intro.md` and `resources.md` are rewritten to [what the guidance teaches](../../../specs/arch/resources/guidance.md#^rg-teaches): `getStore()` with the comment that documents the data, the example on its own store, the commands by `--artifact`, the access level, share links and relative links, and no secrets in source or in the store's data. Nothing the bindings flag hides ships.
- "Firebase-like database" becomes "inspired by Firebase's Realtime Database" ([purpose](../../../specs/arch/resources/guidance.md#^rg-purpose)). "The functions behave as Firebase's modular API does" goes, under [the wording rule](../../../specs/arch/resources/guidance.md#^rg-firebase). The section on where the store differs from Firebase stays.
- **Spec first:** Josh's decision that the guidance tells agents not to edit a store's files directly, and why, is added to [what the guidance teaches](../../../specs/arch/resources/guidance.md#^rg-teaches) with its proof before the guidance changes.
- The skills are rebuilt.

**Proof-derived verification.**

| Evidence | Work in this slice |
| --- | --- |
| [Page walk](../../../proofs/product/resources/resources.md#^rs-ac-page-spine), [the JSON store page walk](../../../proofs/product/resources/json-store.md#^js-ac-page-spine), [local writes](../../../proofs/product/resources/json-store.md#^js-ac-local-writes) | `test/node/resource-page-acceptance.test.ts`, in Chromium and Firefox. |
| [Sharing](../../../proofs/product/resources/resources.md#^rs-ac-sharing) | `test/node/resource-sharing-acceptance.test.ts`, in Chromium and Firefox. |
| [Exposure](../../../proofs/product/resources/resources.md#^rs-ac-share-hides-id) | `test/node/resource-share-exposure.test.ts`. |
| [Purpose](../../../proofs/arch/resources/guidance.md#^rg-t-purpose), [Firebase wording](../../../proofs/arch/resources/guidance.md#^rg-t-firebase), [what it teaches](../../../proofs/arch/resources/guidance.md#^rg-t-teaches) | `test/repo/resource-guidance.test.ts`, replacing its `/Firebase-like database/` expectation, and the guidance review, which judges the example's comment complete. |
| [The example](../../../proofs/arch/resources/guidance.md#^rg-t-example) | `test/node/resource-guidance-example.test.ts`, registering the example as an artifact on its own store. |

**Expected baseline after this slice.** Every resource walk and guidance check is green. Only the onboarding failures remain, all assigned to slice 6.

### Slice 6 — Onboarding

**Deliverable.** An onboarding HTML artifact can declare a starting value for its own store, which installing its channel writes as the store's first write, with dates shifted to the installation day. A failed write is logged and leaves the channel installed. Company To-dos renders its list from its own store through `getStore()`, with the data documented in a comment beside that call.

**Implementation.**
- **Content.** `packages/server/src/onboarding-content.ts` replaces `resources` with `store: { value, shiftDatesFrom? }` ([the declaration](../../../specs/arch/onboarding/content.md#^onboarding-store-config)).
- **Bake.** `scripts/bake-onboarding.mjs` does the same and refuses a declaration on a source that is not HTML ([build validation](../../../specs/arch/onboarding/content.md#^build-validation)).
- **Installer.** `packages/server/src/onboarding-installer.ts` writes each declared value as a `set` of the whole value through the layer, after shifting its dates as before ([starting values](../../../specs/arch/onboarding/installer.md#^onboarding-store-dates)). A failure is logged and the channel still installs and is marked ([a failed write](../../../specs/arch/onboarding/installer.md#^onboarding-store-install)). `ServerStore`'s installer hooks shrink to that one write.
- **Module.** `packages/server/assets/onboarding-company-todos.js` uses `getStore()`, with the declaration's former usage text as the comment beside it, and its error no longer names a store ([the to-do store](../../../specs/ui/onboarding-artifacts/index.md#^productivity-todo-store)).
- **Re-bake.** Productivity is re-baked, so the shipped `onboarding-channels.json` declares `store`.

**Proof-derived verification.**

| Evidence | Work in this slice |
| --- | --- |
| [Validation matrix](../../../proofs/arch/onboarding/content.md#^t-validation-matrix), [production tree](../../../proofs/arch/onboarding/content.md#^t-production-tree) | `packages/server/test/onboarding-content.test.ts`, replacing the resource-declaration cases. |
| The bake's store-declaration cases ([bake proof](../../../proofs/arch/onboarding/bake.md)) | `test/node/bake-onboarding.test.ts`, which clears the two baseline failures. |
| [Declared stores](../../../proofs/arch/onboarding/installer.md#^t-onboarding-stores), [crash retry](../../../proofs/arch/onboarding/installer.md#^t-crash-retry), [fire-and-forget](../../../proofs/arch/onboarding/installer.md#^t-fire-forget) | `packages/server/test/onboarding-installer.test.ts`, with the occupied `<home>/resources/json` as the failure case. |
| [Fresh install](../../../proofs/product/onboarding/onboarding-channels.md#^ac-fresh-install), [deletion respected](../../../proofs/product/onboarding/onboarding-channels.md#^ac-deletion-respected) | `test/node/fresh-install-onboarding.test.ts`, reading the store with `tv resource json get --artifact`, and without the taken-name walk. |
| [Rendering](../../../proofs/ui/onboarding-artifacts/index.md#^oa-ac-todo-render), [saving](../../../proofs/ui/onboarding-artifacts/index.md#^oa-ac-todo-store), [live changes](../../../proofs/ui/onboarding-artifacts/index.md#^oa-ac-todo-live), [a lost store](../../../proofs/ui/onboarding-artifacts/index.md#^oa-ac-todo-store-lost), [no SDK](../../../proofs/ui/onboarding-artifacts/index.md#^oa-ac-todo-store-no-sdk), [a refused save](../../../proofs/ui/onboarding-artifacts/index.md#^oa-ac-todo-store-refused), [disconnected](../../../proofs/ui/onboarding-artifacts/index.md#^oa-ac-todo-store-disconnected) | `packages/server/test/e2e/onboarding-company-todos.spec.ts`, on the artifact's own store. The refused save and the revoked store come from a share link. |
| [Skill assets](../../../proofs/ui/onboarding-artifacts/index.md#^oa-ac-skill-assets) | `packages/web/test/e2e/onboarding-artifact-skill-assets.test.ts`, whose bake failure clears, and its message check. |

**Expected baseline after this slice.** Every assertion is green, `spec-links` passes, and no *(test to be written)* marker this round added remains. The integrated result is ready for its review.

### After the slices

The [integrated review](#Integrated verification and delivery) checks that the specs, proofs, tests, code, shipped assets and bundled guidance agree. The full gate then runs on Blaxel at a pushed revision. If Blaxel skips the Firefox cases, because Playwright's Firefox is not installed there, the page and sharing walks run locally in Firefox and are reported separately. The PR description is rewritten last, describing the net change against `main` and softening its own Firebase claims ("shaped like", "behave as Firebase's do", "Firebase-like", "push matches Firebase").

## Integrated verification and delivery

After slice 6 round 2, the integrated review checks that the specs, proofs, tests, production code, shipped assets and bundled guidance agree. It also checks that every open obligation is discharged or carried to its owner.

**Full verification gate.** `npm run verify` runs on Blaxel and needs a committed, pushed revision. A local full run needs Josh's explicit permission under [the provider rules](../../../specs/arch/testing-policy.md#Verification provider and completion). Before each slice's review, run the slice's own targeted files and owning surfaces, and report them as targeted checks, not as the gate.

**Merge.** Before merge, follow [the shared-branch workflow](../../../specs/spec-workflow.md#^shared-branch-workflow): update the branch with its target's current commits, validate that tree, and get Josh's review of the spec deltas. Then prepare the PR description, and run [pre-merge docs prep](../../../specs/spec-docs.md#^pre-pr-docs-prep) for this folder before the contribution is treated as ready to merge.

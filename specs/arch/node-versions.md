*The Node and npm versions used for repository work, automation, publishing, and published-package support.*

# Node versions

Television uses one Node/npm toolchain to develop, test, build, and publish the repository. The published CLI package supports a separate, older Node baseline so the build environment does not silently become a consumer requirement.

## Authority

This spec is authoritative for the three version contracts, their current values, their declarations, the developer checks, and the procedure for changing them.

It does not own build mechanics, TypeScript configuration, test-runner mechanics, CI job mechanics, Blaxel provisioning, or release mechanics; those remain with their existing authorities. [preflight.md](./test-runner/preflight.md), [github-ci.md](./test-runner/github-ci.md), [blaxel-testshards.md](./test-runner/blaxel-testshards.md), [arch/cli/index.md](./cli/index.md), [arch/onboarding/bake.md](./onboarding/bake.md), and [the ToDesktop build](./desktop/distribution.md) consume this policy and link here for values instead of restating them.

## Version contracts

| Contract | Current value | Declaration and application |
| --- | --- | --- |
| Development/build toolchain | Node 24, npm `>=11.5 <12` | `.nvmrc` and the private root engines match this value |
| CI/publish toolchain | Same as the development/build toolchain | GitHub, Blaxel, and the ToDesktop build consume `.nvmrc`; publishing uses the selected Node's bundled npm |
| Published consumer floor | Node `>=22.12.0` | The public CLI package manifest matches this value through an advisory `engines.node` declaration |

Related compile-time declarations are defined once here:

| Declaration | Current value | Application |
| --- | --- | --- |
| Node-side emitted-syntax target | `node18` | CLI and desktop esbuild outputs |
| Node API type major | `@types/node` 22 | Root development dependency |


The three runtime contracts are independent. Changing the development or automation toolchain does not change the published consumer floor, and changing the consumer floor does not choose the repository's npm version. The published consumer floor is a maintenance-support boundary, not the bundle's technical minimum.

`.nvmrc` is the single Node selector for developer setup and repository-controlled automation. Workflows and provisioning consume it instead of carrying independent Node-version values.

The selected Node's bundled npm is the only npm selector; repository automation does not bootstrap a second npm. The declared npm lower bound is required for npm Trusted Publishing, while its upper bound keeps lockfile creation and consumption on one npm generation. Different npm majors can materialize incompatible dependency records even at the same `lockfileVersion`, so every repository process that creates, rewrites, or consumes `package-lock.json` uses that selected npm generation.

The Node-side emitted-syntax target deliberately differs from the published consumer floor: the floor states which runtimes Television supports, while the lower build target lets a below-floor consumer receive npm's advisory warning and attempt startup without a syntax parse failure. Compatibility below the floor remains unsupported, and an esbuild target constrains emitted syntax without polyfilling Node APIs. Browser output is outside this Node contract. The Node API type major follows the supported consumer line rather than the lower syntax target or development runtime. The type pin is a guardrail, not runtime proof: the TypeScript configurations also include DOM libraries that can admit globals absent from a given Node runtime.

## Developer checks

`scripts/check-toolchain.mjs` reads `.nvmrc` and the private-root engine ranges and compares them with the running Node and npm versions. Failure uses one message that reports the expected Node and npm ranges, the actual versions, and `.nvmrc` as the selector; this also covers a selected Node patch whose bundled npm is below the declared lower bound. If `.nvmrc` and `engines.node` disagree, that message identifies the declaration mismatch and directs the developer to align them instead of recommending a runtime switch.

The check runs at two developer entry points:

- the root `preinstall` hook, so `npm install` and `npm ci` fail loudly on an unsupported toolchain;
- the canonical test preflight named `node`, so `npm test` and `npm run verify` stop before selected tests.

The promise is a clear nonzero failure, not that npm leaves the working tree or installed dependencies untouched before `preinstall` runs. GitHub setup and Blaxel provisioning select the declared runtime and require no additional path-specific checker.

## Accepted gaps

The public `engines.node` field is advisory. npm may warn rather than block a consumer below the published consumer floor, and Television adds no public-package install hook or CLI startup refusal solely to enforce it. Runtime compatibility below the floor is unsupported. The Node-side emitted-syntax target preserves that advisory behavior at the syntax boundary; it does not extend the support promise to its own runtime line.

Direct `npm run build`, `npm run lint`, `npm run type-check`, `scripts/dev-server.sh`, and `scripts/dev-electron.sh` pass through neither developer check. This is accepted: the supported development path starts with repository installation or canonical test/verify execution.

## Operations: changing versions

For an ordinary development-toolchain bump, the version edits are this spec, `.nvmrc`, and the private-root engines; GitHub and Blaxel follow the selector.

1. Decide which contract is changing; do not derive one contract from another.
2. Update this spec and the declarations for that contract in one reviewed change. A consumer-floor change reviews the public engines field, every Node-side syntax target, and the `@types/node` major together while preserving their distinct roles; they do not need the same major.
3. For a development-toolchain change, confirm the selected Node release supplies the accepted npm range. Confirm GitHub can resolve it and provision Blaxel through [blaxel-testshards.md](./test-runner/blaxel-testshards.md) before enabling the updated check, so CI and remote verification already run the new runtime.
4. If the npm generation changes, regenerate `package-lock.json` and change every CI and publish lockfile consumer in the same repository change; `.github/PAUSE_PUBLISH` remains available in `.github/workflows/publish.yml` when an operational release brake is useful.
5. Update the derived runtime guidance in README, then regenerate `specs/index.md` with `npm run specs:index`.
6. Run the declaration and checker tests and full repository verification before merging the version change.

## Testing

The published consumer floor is verified in the tarball that `npm pack` produces for the CLI package. No mocks are used.


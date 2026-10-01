*How the promises in Test Registry are proven.*

# Test Registry — proof

Proves [specs/arch/test-runner/test-registry.md](../../../specs/arch/test-runner/test-registry.md).

## Coverage model

Coverage declarations are carried inside the migrated assertion blocks below.

## Assertions

### Test assertions

These run in-process as pure functions over the loaded registry, plus real filesystem reads (discovery walks the real repository tree, and validation cases write throwaway configs into real temp directories). There is no subprocess, network, or remote boundary in the registry, so no boundary is left unproven by mocking — the gap class that `testing-policy.md` warns about does not arise here. Current coverage lives in `test/repo/test-runner-config.test.ts`.

- `validateRegistry` returns no errors for the repository's own registry.
- `selectSurfaces` with `suite: "e2e"` returns only `kind === "e2e"` surfaces.
- `selectSurfaces` with `package: "@telepath-computer/television-web"` returns exactly `unit:browser-app` and `e2e:browser-app`.
- `selectSurfaces` with `package: "@telepath-computer/canonical"` returns exactly `unit:canonical`.
- `owningSurfaces` maps `packages/canonical/test/build-canonical.test.ts` to `unit:canonical`.
- `selectSurfaces` with `surface: "e2e:browser-app"` returns exactly that surface.
- Every `.test.ts` / `.spec.ts` file discovered under the canonical include roots has at least one owning surface; none is unowned.
- No discovered test file is owned by more than one surface.
- `owningSurfaces` respects `excludeRoots`: a file under an excluded sub-tree resolves to the sibling surface that owns that sub-tree, not the surface that excluded it.
- `selectSurfaces` throws when `--file` is combined with a selector whose surfaces do not own the file, and the error names the owning surface(s).
- `validateRegistry` reports an unregistered runner config placed under a canonical include root.
- **Contract:** `validateRegistry` accepts a surface with two valid Vite service declarations and reports each invalid service declaration listed under [#Discovery and validation](../../../specs/arch/test-runner/test-registry.md#Discovery and validation). The test uses temporary config-file fixtures and no mocked mechanism.
- **Contract:** loading the repository registry preserves the dynamic-service fixture's ordered declarations unchanged.
- The artifact e2e surface declares two independently published services for its view and host origins, with no deterministic port-window helper.
- The desktop e2e surface declares its fixture Vite service through `TV_DESKTOP_E2E_URL`, and the desktop config and tests contain no fixed fixture port.
- `validateRegistry` ignores a runner config placed outside the canonical include roots (e.g. under `prototypes/` or `experiments/`).
- The `all` suite resolves to the unit and non-agent e2e execution groups, in `order`, includes `unit:build-config`, and the `unit:workspaces` group contains the package unit surfaces in declared order.
- Every lifecycle fault surface retains `kind: "experiment"` and `tag:isolated-github-only`; none is selected by `all`.
- The `unit:build-config` surface owns `test/repo/build-config-integrity.test.ts`; `unit:root` excludes that file.
- The `telemetry-posthog-roundtrip` suite resolves to the `telemetry-posthog-roundtrip:integration` surface, and that surface owns `packages/server/test/telemetry-posthog.integration.test.ts`; `unit:server` excludes that file.
- The `daemon-acceptance` suite resolves to `daemon-acceptance:cli`, and that surface exclusively owns `test/node/daemon-acceptance.test.ts`; `e2e:node` excludes that file. The surface declares the `daemon-test-host` preflight and is absent from `all`.


*The test registry: how `test.config.mjs` declares the surfaces, suites, and execution groups the test runner selects, owns files against, and validates.*

# Test Registry

This spec is authoritative for the test registry: `test.config.mjs` as the single source of truth for which test areas exist, the services they require, how they group into suites and execution groups, how a selection resolves to a set of them, how a file maps to the one that owns it, and how the registry is validated against the repository. The command surface that consumes the registry is owned by [test-runner.md](./test-runner.md).

A *test surface* is one independently runnable test area — usually one runner config and the tests it covers. A workspace package may be associated with zero, one, or many surfaces; for example a package containing both `vitest.config.ts` and `vitest.e2e.config.ts` is associated with a unit surface and an e2e surface. "Surface" is the registry's word for a runnable area; it has no relation to the Television *artifact* domain concept.

## Source of truth

`test.config.mjs` is the registry. Nothing infers test classification — unit vs. e2e, agent-dependent vs. not, electron-specific, browser — from file names or package names; every such fact is declared in the registry. The runner loads and normalizes the registry before any selection or validation.

A registry uses either grouped declarations or top-level surfaces. When `executionGroups` is an array, the loader flattens those groups into `surfaces`, attaches each group as metadata, and ignores any separately declared top-level `surfaces`; without `executionGroups`, it loads the top-level array. Loading also normalizes paths and fills derived fields. An explicit declared `cwd` wins. Otherwise, a surface that names a package runs from that package directory; a non-package surface using root `vitest.config.ts` or any config under `test/` runs from the repository root; other non-package surfaces run from their config directory. `roots` and `excludeRoots` are normalized to forward-slash repo-relative paths, and `absoluteConfig` is the config path resolved against the repository root.

## Surface

```ts
interface TestSurface {
  id: string;
  runner: "vitest" | "playwright";
  config: string;
  kind: string;
  package: string | null;
  roots: string[];
  excludeRoots: string[];
  supports: ("file" | "grep" | "shard")[];
  preflight: string[];
  tags: string[];
  agent: boolean;
  command: string[] | null;
  preCommand: string[] | null;
  services: TestService[];
  executionGroup: { id: string; name?: string; order?: number } | null;
  cwd: string;
  absoluteConfig: string;
}
```

`TestSurface` is the normalized surface that selection and ownership operate on. A surface is *declared* in `test.config.mjs` as a `DeclaredSurface`: it omits the derived `executionGroup` and `absoluteConfig` fields and makes `cwd` an optional override; loading resolves that override or derives the required normalized `cwd`.

- `id` — stable surface identity, e.g. `unit:root`, `e2e:desktop`.
- `runner` — `vitest` or `playwright`. The runner builds a Vitest or Playwright invocation from this; any other value is unsupported.
- `config` — repo-relative path to the runner config file for this surface.
- `kind` — classification label. The kinds in use are `unit`, `e2e`, `agent`, `experiment`, `telemetry-posthog-roundtrip`, and `daemon-acceptance`; suites select on it.
- `package` — associated workspace package name, or `null` for root-level surfaces.
- `roots` — repo-relative directories (or files) this surface owns for file-ownership resolution.
- `excludeRoots` — sub-paths carved out of `roots`, so a sibling surface can own them (e.g. a package's `test/e2e` tree excluded from its unit surface).
- `supports` — which targeted selectors apply to this surface, drawn from `file`, `grep`, `shard`. Default `["file", "grep", "shard"]`. The local command-building path rejects a `--file` or `--grep` selection against a surface that does not list it; the targeted Blaxel path does not currently apply this check.
- `preflight` — names of the capability checks this surface requires before it can run locally. The checks themselves are owned by [preflight.md](./preflight.md). Default `["node"]`.
- `tags` — selection tags such as `browser`, `electron`, `node`, `skill`, and `agent`. The reserved `isolated-github-only` tag marks destructive lifecycle fault fixtures. Such a surface has `kind: "experiment"`, is excluded from `all`, and is refused before preflight or dispatch on developer-host local and every Blaxel path. It runs only from an operator-authorized, branch-only GitHub workflow named `Process Lifecycle Fault Injection` with the explicit `TV_TEST_ISOLATED_GITHUB=1` opt-in. That workflow is not committed to the repository. The environment-based identity check prevents accidental execution in trusted automation; it is not a security boundary because callers can set those environment values.
- `agent` — whether the surface depends on a live agent/inference backend.
- `command` — an explicit invocation that overrides the default runner command (e.g. an Electron e2e wrapper script). `null` means use the default runner command.
- `preCommand` — a command run before the surface (typically a workspace build). `null` means none.
- `services` — Vite services the canonical runner starts for the surface. Default `[]`. Their declaration and URL-publication contract are below; allocation and lifecycle are owned by [test-runner.md](./test-runner.md).
- `executionGroup` — the ordered group this surface belongs to, or `null`.
- `cwd`, `absoluteConfig` — derived during loading, as described above.

## Surface services

```ts
interface TestService {
  id: string;
  kind: "vite";
  config: string;
  publishUrlEnv: string;
}
```

A surface service is test infrastructure whose lifetime belongs to the surface runner, outside the Vitest or Playwright worker process. `id` is unique within the surface. `config` is a repository-relative Vite config path. `publishUrlEnv` matches `^[A-Z_][A-Z0-9_]*$` and names the environment variable through which the runner gives the bound service URL to later services and the test command.

Services start in declaration order and stop in reverse order. A later service may read the URLs published by earlier services, which supports a host harness that must embed another service's independently allocated URL. Each service publishes a full URL, including scheme, host, and kernel-selected port; consumers do not derive one service's address from another. Published variables are scoped to service startup and the test child environment; teardown restores any parent value so one surface cannot supply another surface's URL. The declarations are preserved unchanged across local execution, planned shard tasks, and targeted Blaxel execution. The allocation and teardown rules are in [test-runner.md](./test-runner.md).

## Suites

A *suite* is a named selection of surfaces, defined in the registry:

```ts
// TestConfig.suites — the full TestConfig is defined under "Execution groups".
suites: Record<string, { include?: string[]; exclude?: string[] }>;
```

`include` and `exclude` are lists of `key:value` rules where `key` is one of `kind`, `runner`, `tag`, or `agent`. A surface matches a rule when its corresponding field equals the value (for `tag`, when the tag is present; for `agent`, when `String(Boolean(surface.agent))` equals the value). A surface is in the suite when it matches at least one `include` rule (an empty `include` matches all surfaces) and no `exclude` rule (an empty `exclude` excludes nothing).

The registered suites:

- `unit` → `kind:unit`
- `e2e` → `kind:e2e`
- `e2e-ci` → `kind:e2e`, excluding `tag:electron`; regular GitHub CI plans this suite while the dedicated `e2e:desktop` job retains Electron coverage ([github-ci.md#duration-aware-matrix-execution](./github-ci.md#duration-aware-matrix-execution))
- `agent` → `kind:agent`
- `experiment` → `kind:experiment`
- `telemetry-posthog-roundtrip` → `kind:telemetry-posthog-roundtrip`
- `daemon-acceptance` → `kind:daemon-acceptance`
- `all` → `kind:unit`, `kind:e2e`

`all` is the broad suite and is deliberately unit + non-agent e2e: agent, experiment, live PostHog roundtrip, and production-identity daemon acceptance surfaces are not part of `all`. Agent, telemetry, and daemon acceptance surfaces must be selected explicitly with their named suites. The experiment suite contains two placement classes. Lifecycle-fault experiments carry `isolated-github-only`, so selection alone cannot bypass their execution-placement guard. `experiment:dynamic-services` is a normal runnable service fixture without that tag; its protection is exclusion from `all`, so it runs only when selected explicitly. `telemetry-posthog-roundtrip` owns the live telemetry ↔ PostHog integration surface that requires secrets. `daemon-acceptance` owns the host-mutating packed-CLI and production-service lifecycle surface. Both are excluded from CI and broad verification. Build-config-integrity coverage is a normal unit surface, `unit:build-config`, so it runs in `all` and CI without secrets.

## Execution groups

An *execution group* is an ordered band of surfaces declared in `test.config.mjs`:

```ts
interface DeclaredExecutionGroup {
  id: string;
  name: string;
  order: number;
  surfaces: DeclaredSurface[]; // raw declarations, not yet normalized
}
```

`loadTestConfig` flattens every group's declared surfaces into the top-level `surfaces` array, normalizing each and attaching its group as `executionGroup` metadata (`{ id; name?; order? }`). It does not re-normalize the groups themselves: the loaded config's `executionGroups` field is left as the raw declarations, so it does not hold normalized `TestSurface` objects. A surface's group is read through the `executionGroup` metadata on each normalized surface, not through `TestConfig.executionGroups`. Surfaces sort by group `order` ascending, then group `name`; the runner's use of this ordering for local execution is owned by [test-runner.md](./test-runner.md). `unit:build-config` is a separate unit surface that owns `test/repo/build-config-integrity.test.ts`; it runs the real CLI build script and inspects the bundled output, so it is kept out of the general `unit:root` surface while still belonging to `all`.

The loaded registry returned by `loadTestConfig`:

```ts
interface TestConfig {
  suites: Record<string, { include?: string[]; exclude?: string[] }>;
  executionGroups?: DeclaredExecutionGroup[]; // raw declarations, as authored
  surfaces: TestSurface[];                     // declared surfaces, flattened and normalized
}
```

The `.d.mts` sidecar types both the raw group surfaces and the loaded surfaces as `TestSurface` (and declares `executionGroups?: TestExecutionGroup[]` whose `surfaces` are `TestSurface[]`), conflating the authored declaration with the normalized result. The split above — `DeclaredSurface` / `DeclaredExecutionGroup` as authored, `TestSurface` / `TestConfig` as loaded — is the intended contract.

## Selection

```ts
interface SelectionOptions {
  all?: unknown;
  suite?: string;
  surface?: string;
  package?: string;
  file?: string;
  grep?: string;
  runner?: string;
  tag?: string;
  [key: string]: unknown;
}

function selectSurfaces(config: TestConfig, options: SelectionOptions): TestSurface[];
```

`SelectionOptions` is the selection contract. `all` is treated as a boolean flag (alias for the `all` suite); the index signature carries the other parsed command options through without affecting selection. `selectSurfaces` applies the present filters in turn:

- `all` / `suite` — restrict to the named suite.
- `surface`, `package`, `tag` — comma-separated lists; `surface` matches by id, `package` by associated package, `tag` requires every listed tag to be present (AND-composed).
- `runner` — restrict to one runner.
- `file` — intersect with the surfaces that own the file (see below). When the file has owners but the intersection with the other selectors is empty, `selectSurfaces` throws, naming the owning surface(s); this catches a `--file` that contradicts a co-selector.

The mapping from command flags to these fields, and the runner-side rules for an unselectable or ambiguous file, are owned by [test-runner.md](./test-runner.md).

## File ownership

```ts
function owningSurfaces(surfaces: TestSurface[], file: string): TestSurface[];
```

A surface owns a file when the file is inside one of the surface's `roots` and not inside any of its `excludeRoots`. Ownership is path containment, not glob matching.

The registry is maintained so that **every committed test file under the canonical include roots has exactly one owning surface** — no file is unowned, and no file is owned by two surfaces. `excludeRoots` is the mechanism that keeps overlapping root trees disjoint.

## Discovery and validation

```ts
const CANONICAL_TEST_INCLUDE_ROOTS: readonly string[]; // ["packages", "test"]

function loadTestConfig(options?: { root?: string }): TestConfig;
function validateRegistry(config: TestConfig, options?: { root?: string }): string[];
```

`loadTestConfig` uses `root` as the repository for package discovery and path resolution. `validateRegistry` uses `root` as the repository for checking declared paths and discovering runner configs. Each function defaults `root` to the current working directory.

Registry discovery and validation scan only the *canonical include roots* `packages/` and `test/`. The repository root itself is not scanned, so an ad hoc top-level folder such as `prototypes/` or `experiments/` is out of scope by being outside the include roots — not by an ignore list. A test config under such a folder is not part of the registry's concern until it is moved under a canonical include root.

`validateRegistry` returns a list of human-readable error strings; an empty list means the registry is valid. It reports:

- a duplicate surface `id`,
- a surface whose `config` file does not exist,
- a surface whose `roots` or `excludeRoots` entry does not exist,
- a service with a duplicate `id`, a missing Vite config, an unsupported `kind`, an invalid `publishUrlEnv` name, or a `publishUrlEnv` duplicated within its surface,
- an unregistered runner config file found under the include roots — any file matching `vitest.config.ts`, `vitest.e2e.config.ts`, or `playwright.config.ts` that no surface declares.


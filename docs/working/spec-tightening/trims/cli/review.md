# CLI area trim: review

Branch `thopter/trim-cli`, based on `f6cdd91e` (the merge base with `origin/thopter/spec-tightening`). Each trimmed spec is its own commit; the proof link repoints and these review files are separate commits.

| Spec | Words before | Words after |
|---|---|---|
| `specs/product/cli.md` | 7,669 | 7,320 |
| `specs/arch/cli/index.md` | 5,957 | 4,392 |
| `specs/arch/cli/startup-bind-failure.md` | 1,806 | 1,586 |
| `specs/arch/cli/admin-guide.md` | 190 | 190 (unchanged) |

**Convergence:** converged in two rounds. Round 1 raised two blocking and four non-blocking findings; round 2 accepted every fix and reported no blocking findings. The raw reviews are `round-1-review.md` and `round-2-review.md` in this folder.

The product spec shrank little because almost all of it is the CLI's contract with the people and agents who run `tv`: the command surface, exact output text and JSON, exit statuses, the home and config file that people write, and compatibility with data and services from earlier releases. The architecture spec carried most of the restatement and internal detail.

## Decisions for Josh

1. **Should the arch spec keep pinning the CLI's internal test interfaces?** In `specs/arch/cli/index.md`, "Module boundary and published surface" and "Contract surface" pin the source module's full export list and the exact `CLIEnvironment`, `CLIServer`, `CLIServerOptions`, `CLIDaemonOptions` and `Writable` types. Under the policy these are internal: tests and code change together, and the published package is executable-only. The reviewer raised this in both rounds as non-blocking.
   - **Option A:** keep them as they are, as a deliberate architectural decision about the test seam.
   - **Option B:** reduce them to the decision that tests run `runCLI` with an injectable environment (with the daemon always injectable, so normal verification never touches the host's service), plus the surface that has a consumer outside the CLI. That consumer is `scripts/check-release-telemetry.mjs`, run by the publish workflow: it loads the built `dist/cli.cjs` as a module with `VITEST=true`, so that the `isVitestRuntime()` guard keeps the CLI from running, and calls `inspectTelemetryBuildConfig`.
   - **The branch currently** keeps everything (option A), because the spec's ownership paragraph names "the source-module surface used by tests" and "the dependency-injection boundary used by tests" as owned, which reads as your decision.

2. **Should the build's esbuild define values stay pinned?** "Build and packaged asset layout" keeps the block of `__TV_*` define values, which it calls "part of the contract for the packaged runtime". Only `__TV_TELEMETRY_BUILD__` has an outside party (the publish workflow sets `TV_NPM_RELEASE=1`), and that rule is owned by [telemetry sink](../../../../../specs/arch/telemetry/sink.md). The directory constants and version values are shared only between the build script and the CLI source. The branch keeps the block, because the onboarding paragraph says this spec owns "the build-time path constant".

## Judgment calls

Cuts where a reasonable person could disagree. None was disputed by the reviewer.

- **Arch, "Client boundary": the per-command table of exact `TelevisionClient` calls was cut.** The shared client is code inside the product (the `shared` package), so under "TypeScript in arch specs" the calls between the CLI and it are internal; most rows (`get-artifact` calls `client.artifacts.get`) were mechanical. What remains: the client is built for `http://localhost:<port>` under the product's client-port rule, after the config is read; plus the two orderings the product leaves open. `tv links` learns whether a token is required by asking the server with and without the token; `tv set-theme` refreshes the theme registry before patching, except for `none`. Everything else a reader derives from the product behavior of each command (for example "creates the artifact and sends a transient artifact-focus nudge for it").
- **Arch, build list condensed.** The 16 numbered build steps became a list of what the package ships and where, the onboarding-tree check, and a pointer to licensing for notices and `LICENSE`. Step order (for example removing `dist/` first, marking the bundle executable) is left to the build script; the layout the resolvers depend on is kept.
- **Arch, "Commands that do not contact the server" removed.** It restated the product's list of commands that read no config file, `tv themes-path`'s path, `tv config show`'s `null` rendering, and the absence of `--port` on these commands. All of these remain in the product spec ("The config file", `^cli-themes-path`, `^cli-config-show`, `^cli-client-port`). Its block ref `^cli-home-only-commands` had no citation.
- **Arch, persisted environment list reduced to a pointer.** The product spec's "Server lifecycle commands" lists the captured variables. The arch keeps what it adds: `TELEVISION_DEVELOPER_HOME` comes from `resolveHomeDir()`, the exact ACP selector-and-prefix rule (restored in round 1), and log redaction. The block ref `^ac-persist-telemetry-env`, cited by the update-channel spec, stays on that paragraph.
- **Product, "Artifact commands": the paragraph saying the CLI has no reorder command, and that showing the same file on another channel means creating a second artifact, was cut.** It describes an absent feature and a usage tip. An artifact belongs to exactly one channel under [artifacts.md](../../../../../specs/product/artifacts.md) (`^af-artifact-reference`), so the second artifact follows.
- **Product, "Non-goals": "`tv` does not run repository tests" was cut.** No derivation would add a test command to the product CLI; the test runner is owned by its own spec.
- **Product, "Non-goals": the option-name restatements were cut** (`--channel` not `--id` for focus, update and remove; `focus-artifact` takes `--id` and not `--channel`; no `--server`). The synopses give each command's options, unknown options are directive errors, and `--server` is still refused under "Connecting to the server". `list-artifacts` refusing `--unplaced` was kept as a regression case.
- **Product, `tv update-channel`: "Command-local help describes the rename and identifies both required options" was cut.** Commander generates that help from the required options. The arch "Testing" section still says help is proven for the `update-channel` page.
- **Product, home selection: three sentences explaining that later commands reach the same home only if they resolve to the same directory were cut.** They follow from the selection rule. The non-obvious part was kept: a persisted service keeps its recorded home when `~/.tv-home` changes.
- **Startup bind failure: the plan to split the spec into a server spec tree, and the non-goals list of future work (`tv status` showing the fatal record, Tailscale-aware listeners), were cut** as plans. Kept: why the server behaviour lives in `specs/arch/cli/` for now, and that it is the authority until a server spec tree exists.

## Kept but doubtful

- **Arch, `CLIEnvironment` and export shapes:** see decision 1.
- **Arch, esbuild define block:** see decision 2.
- **Arch, `build.mjs --outfile` paragraph.** It is a test-only build mode, but [telemetry sink](../../../../../specs/arch/telemetry/sink.md) relies on it for release-configured test builds, so it was kept.
- **Arch, resolver table's development fallbacks.** The built-CLI column is the packaged-layout contract (resolving against the real path of the executable, which matters for `npm link`); the development column is internal convenience.
- **Arch, daemon description string** (`Television server — virtual display for agents`). The daemon name is a contract with installed services; the description probably is not.
- **Arch, "Operations".** Kept whole as owned operational procedure; some entries (`npm install`, two ways to run the built file) are generic.
- **Product, focus-directive errors "do not point to `tv help` as a separate recovery path".** A negative rule; it may record a past regression, so it was kept.
- **Product, "The refusal is not recorded in any log"** for retired options. A negative rule with no stated reason.
- **Product, the list of historical command names that must fail as unknown commands.** Kept as regression cases; it is the kind of list the policy's "Regression cases" subsection is for.
- **Product, the `tv config set` examples block.** Illustrative only, but they show the `listen ""` form that clears the list.
- **Startup bind failure, Linear TV-507 reference.** Reduced to one line naming the ticket; kept because the `RestartSec` constraint depends on that work not having landed.

## Routine cuts

Restatements of rules owned elsewhere in the same spec or by another spec:

- Product, terms: artifact focus behaviour (select tab page, switch channel, no scroll or glow), now a pointer to `tab-pages.md#^tp-focus-selects`, which says it.
- Product, terms: `dist/skills/<name>/` as the location of the bundled skill collection; the arch resolver table and build list carry it.
- Product, output conventions: per-command restatement of which commands print human-readable text; each command's section gives its text.
- Product, `tv links`: the two error messages, now a pointer to the general unauthorized and connection-failure rules, which give the same text.
- Product, listener resolution: "The config file's `listen` values are IPv4 addresses", stated by the config-file table.
- Product, foreground startup and `--persist` output: token and plain-origin rules for startup URLs and the `127.0.0.1` and `0.0.0.0` output cases, now references to the connect-link definition and the resolution rule just above.
- Product, `tv status`: "A CLI and server from the same release therefore report the same release version", a consequence of copying the version unchanged.
- Product, `tv focus-status`: its field list, now a pointer to the JSON envelope table.
- Product, `tv set-theme`: "The opening read failure itself produces no error", which repeats "A failed opening selection read is nonfatal".
- Product, bundled skills: the manifest file path; [making-skills.md](../../../../../specs/arch/making-skills.md) owns bundle membership. "Always includes `television`" was kept.
- Product, packaged startup: how the onboarding tree reaches the serving store; the arch build and resolver sections own it.
- Arch, home and config resolution: restated pointer-file rules, config validity rules, `tv config set` value parsing, and "the server package reads no port or storage-path environment variable" (the product's `^cli-legacy-selectors`). Kept: function signatures, symbolic links not resolved, `net.isIPv4`, the writer reading without validating (which is what lets `tv config set` repair a bad value), temporary file and rename, and the directive-error list.
- Arch, writer formatting: "two-space indentation and a trailing newline"; any formatting would do.
- Arch, parser: version-flag registration and version format (product `^cli-developer-version`), the `0`/`1`/`69` exit-code restatement, the entered-argv quoting rule (now a pointer to the product's directive-error rule), the retired-option ordering, the transitional-path conditions and steps, and the legacy-variable warning placement (all product rules).
- Arch, link formatter, `tv status` version pass-through, and the set-theme output strings: product `^cli-link-output`, `tv status` and `tv set-theme` own them.
- Arch, server process boundary: how startup URLs are collected from `getBaseURLs()`, the port-0 reuse rule (owned by `startup-bind-failure.md#^port-zero`), and the token-printing rule (product).
- Arch, daemon boundary: the ACP command check before install (product), "A resolved `health()` is the whole test… any server satisfies it" (product `^cli-persist-health-wait`), the `127.0.0.1` and `0.0.0.0` output cases, and `createDaemon()` called with no options for stop.
- Arch, bundled skills: resolver location (in the resolver table), `rmSync` options, the reason for removing `tv-theme` (product), the unknown-option rule (general parser rule), the one-second best-effort bound and agent-type derivation (owned by [telemetry emitters](../../../../../specs/arch/telemetry/emitters.md) and [derivation](../../../../../specs/arch/telemetry/derivation.md)), and the skills build's manifest processing (making-skills).
- Arch, ACP: "Keep ACP behavior changes in those boundary sections so this unsupported-feature note does not become a separate source of truth", an instruction to editors.
- Arch, build: the developer-commit display rule (product `^cli-developer-version`) and the duplicated `main`/`exports` rationale.

Plans and history:

- Product, error wording: "making the remaining paths consistent is known future work"; the limitation itself is kept and labelled as accepted.
- Startup bind failure: "is unchanged" (twice) and "the existing `log()` mechanism", which compare with versions the reader cannot see.

Wording only: the startup bind-failure introduction (formerly a "Plain english" paragraph above the title), the all-or-nothing rationale, and the foreground rationale were rewritten more plainly without changing what they require.

## Findings that are not edits

Mismatches between spec and code:

- **Bind-failure hints.** `startup-bind-failure.md#^record-hint` says the Tailscale-aware hint applies to `EADDRNOTAVAIL` on a CGNAT address in daemon mode and that "every other case records a plain one-line cause". The code gives every failed address both a `cause` and a `hint`, with error-specific hints such as "Stop the process using …, or choose another port, then retry" (`packages/server/src/startup-bind-failure.ts`, `bindFailureHint`). The behaviour is harmless; the spec understates the record.
- **Skills resolver order.** The arch resolver table says the built CLI resolves `./skills` beside the executable and development resolves `packages/skills/dist`. Unlike the other resolvers, `resolveBundledSkillsRoot` is not gated on a build-time constant: it tries `./skills` beside `process.argv[1]` in every mode, then falls back (`packages/cli/src/index.ts`, `resolveBundledSkillsRoot`).

Contracts the specs do not name:

- **Loading the built CLI as a module.** `scripts/check-release-telemetry.mjs`, run by `.github/workflows/publish.yml`, requires `dist/cli.cjs` with `VITEST=true` so that the bundle does not run as a program, and reads `inspectTelemetryBuildConfig`. The arch spec states that published consumers should not import the package and describes the `isVitestRuntime()` guard as a test convenience; neither says the release check depends on both. See decision 1.

Process notes:

- The brief's borrowed `node_modules` path (`~/workspace/wt/television/serve-persist-fix-tv-856`) does not exist on this host. The link test was run with `~/workspace/television-prerelease-archive/node_modules` (Vitest 2.1.9), linked and removed the same way.
- The reviewer changed no files in either round.

## Effects

**Stale proof sections** (to re-derive after acceptance):

- `proofs/arch/cli/index.md`: "client boundary" and "command behavior breadth" (per-command client-call assertions such as `update-channel`'s single `client.channels.update` call and URL creation's request shape); "commands that do not contact the server" (`^cli-home-only-commands-contract` now derives from the product spec alone); "daemon boundary" (persisted environment list); "bundled skills boundary" (manifest processing, telemetry bound); "build stamp, copies, and asset resolution" (the numbered build steps); "module boundary" (`update-channel` help assertion, line 67, whose product sentence was cut).
- `proofs/product/cli.md`: any assertion derived from the cut product sentences (non-goals restatements, update-channel help).
- `proofs/arch/cli/startup-bind-failure.md`: nothing derived from the cut plan and non-goals is expected, but it should be checked.

**Citations repointed** (link target only):

- `proofs/arch/cli/index.md`, `^cli-legacy-variables-warning`: "placement in `runCLI`" from `specs/arch/cli/index.md#Command parser and error normalization` to `specs/product/cli.md#^cli-legacy-selectors`.
- `proofs/arch/cli/index.md`, stream-dependent link-formatting assertion: "the shared formatter rule" from `specs/arch/cli/index.md#client-boundary` to `specs/product/cli.md#^cli-link-output`.

**Citations left dangling:** none. The one removed block ref, `^cli-home-only-commands`, had no citation.

**Spec-link test:** `test/repo/spec-links.test.ts` passes, 8 of 8 tests. No failures are expected.

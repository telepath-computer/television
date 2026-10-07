# Ledger: CLI architecture spec, distilled

Working document with no authority. It records why each statement in the rewritten `specs/arch/cli/index.md` is there. The spec was rebuilt from empty. The old spec, the code in `packages/cli/` and `packages/server/`, and the neighbouring specs were read for understanding. A statement was added only when derivation could not be trusted to get it acceptably right without being told.

The main finding behind the size of the cut: `specs/product/cli.md` already owns nearly every behaviour the old arch spec restated. That includes home selection, the `~/.tv-home` rules, config validation and atomic writes, `tv config set` parsing, retired options and the transitional service path, the legacy-variable warning, the client-port rule, token reading, link output, `tv links`, `tv status`, `set-theme`, the persisted environment's contents, the health wait and its timeout, and stop/uninstall. Restating them here only added a second place to keep in step.

## Statements kept

### Build and packaged asset layout

1. **The package publishes only the `tv` executable, with no `main` or `exports`; people install by the package name.** The package name is a contract with users, the administrator guide and the update notice. "Nothing importable" is a decision: it is what makes everything inside the package free to change, and it would be easy to add an `exports` entry without noticing that it creates outside callers.
2. **One bundled `dist/cli.cjs`, with the asset trees as named sibling directories.** Neighbouring specs (onboarding, bundled themes, licensing, the product spec's `dist/skills/`) and the test runner's packaging checks refer to these locations. This sentence also orients a reader before the statements that depend on it.
3. **Assets are found relative to the script's real path, after following symbolic links.** This is a trap. Global npm installs and `npm run link` both put `tv` on `PATH` as a symbolic link, and a lookup relative to `dirname(process.argv[1])` without resolving the link finds nothing. Ordinary tests run from inside the repository and would not catch it. The source-run fallback is mentioned in a clause only so the rule does not read as built-only.
4. **Missing directories are tolerated at run time, so the full build fails on a missing tree; lookup tests don't cover damaged layouts.** This records where the completeness guarantee lives. Without it, an implementer could reasonably make the runtime strict, which would break source runs and `--outfile` builds, or drop the build checks, which would silently ship a package that installs no onboarding channels (the code comment calls this a known packaging regression). The test scope clause stops a proof from asking for missing-directory cases.
5. **The external `skills` installer stays a runtime dependency, not bundled.** Bundling it with esbuild is the natural default and would break `tv skills install -i`. That path is never run by tests under the product's installer exception, so only users would find the break.
6. **Two build modes, including `--outfile` with no assets.** Tests and the telemetry sink spec depend on the `--outfile` mode existing and on it not touching the shared `dist/`. That is a dependency from outside this module's code.
7. **Three baked values: release version and telemetry marker by pointer, the developer commit stamp in full.** A reader expects build constants here, so the first two are named with their owners. The commit stamp's rules are owned here and cited by the proof. Failing the build when Git cannot supply a commit, rather than quietly omitting the stamp, is a decision that could reasonably go the other way. The "does not claim a clean tree" clause answers an objection a reader is likely to raise.

### Layering

8. **`Server` and `ServerStore` take storage and settings as options; the CLI alone chooses the home and reads config.** The product's promise that the server and every command agree on the home and settings rests on one place deciding them. An implementer could plausibly teach the server to read `config.json` itself, which would create a second decision point and break embedders and package tests that construct servers without a home.
9. **`runCLI` returns a status, and everything outside the process is injectable, so ordinary tests never touch the real service or the user's home.** The product's testing section requires tests never to read the user's home or `~/.tv-home`. The consequence of getting this wrong is high: a test could replace a developer's real service. The concrete TypeScript shape is deliberately not pinned, because it is internal: both sides change together.

### Daemon boundary

10. **The service definition outlives the release that wrote it.** This one framing sentence explains why the next three statements are contracts rather than implementation detail.
11. **The service name `com.television.server` is the same in every release.** It is a contract with the OS service manager and with services installed by older releases, which a newer CLI must find, replace and remove. The test-runner spec and the admin guide name it.
12. **The service runs the installing Node with the entry script, `--home <absolute>`, `serve`; Node is pinned because services don't start through the user's shell.** The definition is persisted outside the product and read at every boot. The reason the Node path is fixed answers the obvious objection ("why not `/usr/bin/env node`?"), and the consequence (switching Node needs a reinstall) is something users and the admin guide rely on. The product spec owns the `tv --home … serve` shape; this adds the parts that aren't user-facing.
13. **Environment variable names written into the service are a contract across releases.** A later server boots with variables an earlier CLI wrote, and the transitional service path keys on `TELEVISION_LAUNCH_MODE`. Nothing else in the specs says these names are frozen, and a rename looks like a harmless refactor from inside one release. It keeps `^ac-persist-telemetry-env`, which `arch/updates/update-channel.md` cites.
14. **Secret values are redacted in the install log.** This is a security decision that derivation could get wrong, for example by logging the whole environment for debugging. The ACP variables carry API keys. The name patterns are given because they define what counts as a secret.
15. **No health request runs past the deadline, and 15 seconds is sized to cover one service-manager restart.** `startup-bind-failure.md` cites this statement for the link between its restart cadences and the deadline. The sizing explanation answers the objection that 15 seconds is arbitrary, and records that changing either number means checking the other. The 15 seconds itself is the product spec's.

### ACP agents

16. **ACP is experimental and governed by code, apart from the home context.** This is design intent. Without it, a proof writer or implementer would treat ACP as part of the supported product and expand coverage and spec around it.
17. **The ACP home context buffer (`^cli-acp-home-context`).** It is a contract with the agents Television launches: their `tv` commands must reach the server that launched them. It binds code in two other packages that cite this anchor. It is rewritten in fresh words, with no change in meaning.

### Operations

18. **Build, run and link commands.** The policy gives arch specs the procedures for standing up their part of the system.
19. **Use a temporary `--home`; persisted-service commands act on your one real service whatever home is given.** This is knowledge a developer would otherwise learn by clobbering their own service. The product spec says there is one service per user, but not what that means for someone trying commands by hand.

### Inputs to proof derivation

20. **Directive: ACP proof stops at the missing-command refusal and the home context.** Without it, the testing policy's default would push a proof writer towards ACP success tests for a feature that is deliberately unsupported.
21. **Fact: `Server` defaults to no authentication when `auth` is omitted.** This is a security trap noted in the code. A test that always writes `auth` into the config would never catch a regression where `tv serve` stops passing it.
22. **Coverage owned elsewhere: real-service paths go to the hand-run production service suite; the bind-failure exit goes to the product proof.** Without this, a proof writer would look for or duplicate these tests here, or try to put real-service tests into `verify`.

## Considered and left out

These were in the old spec or plain in the code, and were weighed against the policy.

- **The `CLIEnvironment`, `CLIServerOptions`, `CLIDaemon` and related TypeScript types, and the exported function list.** They are internal: tests and code change together. The decision they carry is kept as statement 9.
- **The `TelevisionConfigFile`, `TelevisionSettings` and `TelevisionConfig` types, and the resolver, reader and writer signatures.** They are internal between two packages of the same release. The config file's on-disk shape, its validation and its atomic replacement are owned by the product spec.
- **The Commander error-code wording table, exact-argv preservation and error formatting by shape.** The product spec owns the wording it pins, and says the remaining wording is deliberately not normalised yet.
- **The per-command client call table.** `TelevisionClient` is internal. The observable results (`set-theme` sequencing, `tv status` tolerance, `tv links` following the running server) are product-owned.
- **The esbuild define list and the development-fallback paths of each resolver.** These are internal between the build and the runtime of one release. The two defines with outside owners are pointed to.
- **The numbered full-build step list and `build-views.mjs` behaviour.** They can be derived from the code. Statement 4 keeps the one property that matters.
- **The persisted environment's contents, ACP command checks, the non-atomic refresh, the timeout error and log record, connect-URL derivation for `--persist`, and stop/uninstall.** The product spec covers these.
- **Help-page coverage limits and the wildcard-listen compositional note.** A proof can derive both under the testing policy.
- **That `scripts/check-release-telemetry.mjs` loads `cli.cjs` as a module with `VITEST` set, relying on the executable's run guard, to read `inspectTelemetryBuildConfig`.** This is a real coupling between the release workflow and the executable. It is owned by the telemetry sink spec's publication check and caught in CI by `test/repo/build-config-integrity.test.ts`, which runs that guard against built bundles.
- **Daemon description string, signal handling details, port-zero warning constant.** Derivable, or owned by the product spec.

## Citations the rewrite leaves dangling

Kept anchors and headings: `^cli-developer-build-stamp`, `^ac-persist-telemetry-env`, `^cli-persist-health-check`, `^cli-acp-home-context`, `#Build and packaged asset layout` (cited by onboarding specs and `product/cli.md`), and `#Daemon boundary` (cited by `product/telemetry.md`).

Now dangling (not edited, per the task's two-file limit). `test/repo/spec-links.test.ts` still passes with these in place, so it does not catch them:

- `specs/arch/telemetry/emitters.md` → `#Bundled skills boundary`. Skill-install telemetry wiring is product-owned. The citation should point at the product spec's bundled skill commands.
- `packages/server/test/home-config.test.ts` → `^cli-config-reader`, `^cli-config-writer`. Better targets: `product/cli.md#^cli-config-invalid` and `#^cli-config-set`.
- `packages/cli/test/cli.test.ts` → `^cli-home-only-commands`. Better target: `product/cli.md#The config file`.
- `proofs/arch/cli/index.md` and other proofs cite many removed refs and headings. The proof needs re-deriving against the new spec.

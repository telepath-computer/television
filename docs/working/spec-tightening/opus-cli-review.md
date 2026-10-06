# Trial review: `specs/arch/cli/*` against the sharper spec policy

An Opus agent applied the draft policy in `sharper-spec-policy.md` to the three CLI architecture specs and checked their claims against the code. It worked read-only on a copy of this branch that held the policy draft but not `spec-shape.md`. The report below is its findings, condensed lightly; section references such as "§Contracts" are to the draft policy as it stood at the time. The draft has since changed: plans for future work are now settled, which affects decision 9.

## Overall assessment

- **`startup-bind-failure.md` is mostly sound.** Its core rule is an architectural decision with a strong reason: start on every address or not at all, write one log record, exit with status 69, and let the service manager retry. It is too long mainly because of:
  - its explanation of that reason;
  - plans for future work;
  - a list of things it does not cover;
  - repeats of what other documents already say.

  Two places describe the code slightly wrongly.
- **`admin-guide.md` already fits the policy.** It only needs its last two sections relabelled.
- **`index.md` is the main problem.** About two-thirds of it is one of three things:
  - user-facing behaviour that `product/cli.md` already owns, often word for word;
  - content other specs own: telemetry build configuration, the skills build manifest, licensing;
  - implementation detail that code shows and nothing outside the product depends on: the test-injection types, the client-call table, the 16 build steps, the asset-resolver table, the config file's formatting.

  What should stay is short: the contracts with service managers, earlier installed versions, npm users, the release pipeline and launched agent processes, plus a handful of decisions and traps.

## Findings from checking the code

1. **The hint wording is under-described.** `startup-bind-failure.md` says every case other than the Tailscale one "records a plain one-line cause". In the code, every failed address gets both a `cause` and a `hint` chosen by error class (`packages/server/src/startup-bind-failure.ts`).
2. **The release pipeline depends on something the spec calls test plumbing.**
   - `scripts/check-release-telemetry.mjs` sets `VITEST=true` so it can load the built `dist/cli.cjs` without running the CLI, then calls `inspectTelemetryBuildConfig`.
   - `.github/workflows/publish.yml` runs that script.
   - So publishing depends on both the load guard and the export, and no spec says so.
3. **Eleven block refs are cited by nothing:**
   - `^cli-serve-adapter`, `^cli-daemon-home-args`, `^cli-persist-suite-note`;
   - `^all-or-nothing`, `^attempt-all`, `^one-record`, `^socket-cleanup`, `^no-wait`, `^record-outcomes`, `^no-backoff`, `^unit-start-limit`.

Everything else it checked matched the code:
- the bind transaction;
- exit-status propagation;
- the daemon package's generated unit and plist;
- the daemon name and arguments;
- the redaction rules for logged environment values;
- the build defines and steps;
- the ACP home context.

## `index.md`: about 5,660 words now, about 1,700–2,000 after

- **Opening:** condense.
  - The ownership statement belongs, because this spec covers the CLI package, part of the server package's config module, and an ACP buffer.
  - The "does not own" list goes beyond naming neighbours a reader would expect here.
- **Published surface:** keep that the npm package is executable-only (`bin.tv`, no `main` or `exports`). Add that the publish workflow relies on the `VITEST` guard and on the `inspectTelemetryBuildConfig` export.
- **`CLIEnvironment` types:** condense to one sentence about the design choice. Every side effect goes through one injectable environment. The full field list is internal.
- **Home and config resolution:** cut the internal types and the restated product rules. Keep:
  - symbolic links are not resolved;
  - IPv4 means what Node's `net.isIPv4` accepts;
  - the temporary-file-and-rename write.
- **Command parser:** keep "a fresh Commander program per `runCLI` call", which is a trap for tests run in-process. Keep the structural exit-status rule. Move or cut the error-wording table, which is product wording. Condense the retired-option check to how tokens are matched.
- **Client boundary:** cut the table of client calls. Optionally keep that `tv links` decides whether to include the token by making an unauthenticated request to the running server.
- **Server boundary:** keep three things:
  - a config error is logged as a refused startup before it is reported;
  - `launchMode` comes from `TELEVISION_LAUNCH_MODE`, which is a contract with service definitions installed by earlier releases;
  - `auth` is passed explicitly because the server defaults to tokenless, which is a trap.

  Keep the ACP home-context buffer, which an external agent process depends on.
- **Daemon boundary:** keep the daemon name and the daemon arguments, adding that installed services outlive upgrades. Keep the redaction rule and that `HOME` is not captured. Cut what the product spec owns.
- **Home-only commands:** cut, because they restate the product spec. Re-point the test citation.
- **Bundled skills:** condense to about two sentences and point to `making-skills.md` and the telemetry specs.
- **Build:** replace the 16 steps with what a build produces. Keep:
  - the developer build-stamp decision;
  - the runtime dependency on the external `skills` package;
  - `--outfile` mode;
  - that built-package paths resolve against the real path of `process.argv[1]`, because npm's `bin` entry is a symbolic link.
- **Operations:** condense to the build and link commands plus the advice about using a temporary home.
- **Testing:** rename to the proof-inputs section.
  - Coverage owned elsewhere: `daemon-acceptance`, wildcard listen, the installer exception.
  - Directives: which help pages are proven, ACP scope, and resolvers deliberately left untested against corrupt input.

**Missing from `index.md`:**
- the publish workflow's dependency;
- why the daemon arguments must stay stable;
- any statement on a CLI talking to a server from a different release.

## `startup-bind-failure.md`: about 1,800 words now, about 900–1,000 after

- **Introduction:** remove the "Plain english" label and move the paragraph under the H1.
- **Status:** keep "provisional holding spec" and point to `spec-migration.md` for the split plan.
- **Non-goals:** cut. They are tracker items.
- **All-or-nothing rule and steps:** keep. Shorten the "Why" paragraph from about 300 words to about 100. It answers the objection "why not serve what bound and retry the rest?".
- **No in-process retry; every bind-error class is fatal:** keep.
- **Fatal record:** keep its contents, because agents read it to diagnose failures. Correct the cause-and-hint description.
- **Exit 69:** keep.
- **Service definitions:** state the outcome wanted, which is to relaunch forever at a fixed cadence, with the current package settings as the means. Keep the systemd start-limit trap. Remove the TV-507 future-work note.
- **Foreground semantics:** keep.
- **Testing:** rename to the proof-inputs section.
  - Coverage owned elsewhere: the product CLI proof and `daemon-acceptance`.
  - Directive: retry cadence and recovery are deliberately left to manual verification.

## `admin-guide.md`: about 190 words, unchanged

The authority grant to the guide and the self-containment rule stay. The copy procedure moves under `## Operations`. The testing text becomes a directive under the proof-inputs section.

## Decisions it named but did not make

1. **The `config.json` format:** product or arch owner. Both specs currently pin it.
2. **The Commander error-wording table:** move it to the product spec, or let code govern it. A related question: is the absence of "did you mean" suggestions a product promise?
3. **`CLIEnvironment` and module types:** keep them pinned, or reduce them to prose.
4. **The publish workflow's dependency:** declare it as a contract, or replace the mechanism.
5. **Experimental ACP wiring:** keep it under spec authority, or keep only the home-context buffer.
6. **The bind-failure log record:** a machine-readable contract with a pinned type, or a human-readable diagnostic.
7. **Cause and hint:** the spec adopts what the code does, or the code changes.
8. **A CLI and a server from different releases:** what the CLI expects.
9. **Future-work content:** since settled. Specs are not a backlog. Accepted limitations stay, and marking a path as transitional is the author's judgment.

## Where it found the policy unclear

- **Tests as dependents.** Do tests count as outside the product's own running code?
- **Build and release tooling.** Is a CI publish job on the other side of a contract?
- **Holding specs and buffers.** The policy does not mention them.
- **Restatement versus mechanism.** Where is the line between restating a product rule and stating its mechanism?
- **Operations sections.** What bar applies to them, and where do they end and runbooks begin?
- **Third-party output.** State the outcome, or the literal fields an operator sees?
- **Source file paths.** The policy is silent on them.
- **Rationale length.** The policy gives no guide.

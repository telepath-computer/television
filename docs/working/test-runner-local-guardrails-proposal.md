# Local test-runner guardrails

Proposal for independent review. Josh has chosen the three behavior changes below and will review their authoritative spec deltas on the pull request. Two details await his decision, listed under "Open decisions". This document records intent; the [runner spec](../../specs/arch/test-runner/test-runner.md) will own the command behavior.

## Purpose and decisions

Several agents can run tests on one development host. Independent local runs compete for CPU and memory and can cause the operating system to kill processes. Josh's first priority is keeping test runs from overwhelming that shared host. Every Blaxel test run moves its test workload off the host, including a surface run on a single remote worker.

Faster iteration is the second priority. Blaxel's planned execution distributes files across workers; it cannot split the work inside one file. Adding fan-out to targeted surface runs is a secondary speed improvement. Its absence is never a reason to run broad work locally.

Josh's decisions are:

1. Every canonical local test run, including local verify, takes one host-wide mutex outside every checkout and holds it until its test processes exit. A second run is refused immediately with exit `2`, identifying the holder and explaining the available next steps. A separate, conspicuously named flag allows the caller to bypass this protection.
2. On a host where the invoking user's `~/.tvdev-use-blaxel` exists, ordinary local iteration selects one test file, optionally narrowed with `--grep`. Broader selections are refused with exit `2` and redirection toward Blaxel: an equivalent command where supported, an explanation where the selection is unsupported, and instructions to commit and push first. `--allow-extreme-inefficiency` overrides this restriction, as it does for local verify.
3. Without that marker, local selection and verification retain their behavior apart from the mutex. Public contributors and forks need no Blaxel credentials or access.

## Local concurrency

The lock coordinates canonical local runs across worktrees and separate clones on the same host. Its scope across operating-system users awaits Josh's decision. The production lock location is outside checkouts and is not selected by ordinary home-directory or temporary-directory overrides. Acquisition is atomic and nonblocking. An active holder is identified by enough information to find its run: process identity, command, and checkout.

A local verify acquires the lock before executing its phases and retains it through completion and cleanup. Its test-phase child participates in that same ownership; it must neither contend with its parent nor grant an exemption to unrelated or arbitrarily nested runs. Verify passes the applicable override options to that child. Direct local execution takes the same lock before starting preflight or test work. Informational commands such as `list`, `help`, and `verify --plan` do not acquire it. The existing self-test dry run checks selection guardrails but acquires no lock because it starts no test work. Blaxel dispatch does not acquire the submitting host's local-run lock.

The runner's own reporting, toolchain, and lifecycle tests launch real nested canonical runs. They and the mutex tests will supply private lock locations through a hook accepted only with `TV_TEST_RUNNER_SELFTEST=1`; supplying that hook without the gate is a usage error. This is the explicit test-only exception to the production location rule. Each independent test scenario uses its own location, while processes intentionally testing contention share one. The real acquisition and release logic still runs, including under local verify, GitHub CI, and Blaxel workers. This isolates fixture runs from the outer run's lock and from parallel tests without making ancestry a general ownership exemption. The existing self-test warning identifies the substitution, and proofs declare its coverage limits. This hook does not relax destructive-fixture placement or process-cleanup rules.

Release follows test-process exit and the runner's existing lifecycle cleanup, including failure and handled interruption. If verify's parent exits while its test-phase supervisor remains alive, that child still keeps the run protected; parent death alone cannot make the lock available. An abruptly killed owner cannot run cleanup; recovery must establish that its test processes have exited or complete the existing stale-owner cleanup before admitting another run. Finding stale test processes retains the existing outcome: cleanup followed by a failed invocation, with a later clean invocation able to proceed. Elapsed time alone is not evidence that a holder is safe to replace. Reuse the existing process identity and cleanup facilities where they apply; cross-user recovery awaits the scope decision below.

The proposed bypass spelling is `--allow-major-host-contention-and-oom-killed-processes`. A caller passing it still takes and holds the mutex when it is free; when occupied, the flag permits concurrent local execution without displacing the holder. The refusal tells callers to wait for the named run to finish or use Blaxel when available, and documents the bypass's consequence under the permission rule Josh settles below. Unmarked hosts receive a usable local next step without needing Blaxel.

## Open decisions

- **Review blocker 2 — operating-system user scope:** does "host-wide" coordinate all runs by the same operating-system account, or also runs by other accounts? If it covers other accounts, recovery needs a stated outcome when the caller cannot inspect, clean up, or replace another user's abandoned ownership. Cross-user coordination is not assumed in this proposal while Josh decides.
- **Review blocker 3 — contention-bypass permission:** may an agent use the contention bypass on its own judgment, or must it have explicit human permission? The flag's existence does not settle permission. The testing policy, refusal message, and agent guidance will carry Josh's decision consistently; the existing inefficiency-bypass permission rule remains in force.

## One local file on marked hosts

An allowed selection supplies `--file` and resolves to exactly one test file in the current working tree. An additional `--grep` restricts cases within that file. Other selectors may disambiguate or restrict the file's owning surface; selecting a surface, suite, package, runner, or tag alone does not satisfy the file restriction, even if that selection happens to contain one file.

Counting owning surfaces is insufficient: one surface can contain many files. The runner must establish the file boundary before running tests, including for native substring or regular-expression filters that could match several paths. It must account for uncommitted and newly created test files; remote planning's committed-file inventory cannot alone prove a local selection is narrow. A directory or filter that would run multiple files is refused before those tests start. Invalid or empty selections retain their ordinary selection errors.

The marker's lookup remains the invoking user's home-directory file, with contents ignored. Local verify is inherently broader than one file and retains its existing refusal and explicit local override. These decisions occur before expensive execution so a refused command is quick.

When Blaxel accepts the same selection, a refusal prints a shell-usable command with the provider changed and the selection and grep preserved, plus the requirement to commit the intended changes and push the revision to `origin`. Otherwise it explains which selection or placement Blaxel cannot run and directs the caller to supported remote selections. For example, the current target path cannot take multiple surfaces together with grep. The diagnostic need not translate every unsupported combination into equivalent commands or broaden the remote runner's capabilities. Full verification points to `npm run verify -- blaxel`. The runner does not automatically commit, push, or dispatch a refused local request.

Existing placement restrictions remain authoritative. In particular, the live PostHog suite needs a local secret and daemon acceptance mutates the designated local host. For a selection containing either surface, however selected, the diagnostic explains the local requirement and gives a one-file local invocation where supported, or the explicit inefficiency override. Their invocation guidance will show the one-file forms usable on marked hosts. The mutex still applies.

## Independent overrides

| Option | What it permits |
| --- | --- |
| `--allow-extreme-inefficiency` | A broader local selection on a marked host, including local verify. The host mutex still applies. |
| `--allow-major-host-contention-and-oom-killed-processes` | Local execution despite another local run. The marked-host file restriction still applies. |
| `--force` | A raw full-suite provider shortcut under the existing broad-run guardrail. It bypasses neither local protection. |

A caller needing both local exceptions must request both. The existing testing-policy requirement for explicit human permission before an agent uses the inefficiency bypass remains in force. During this contribution, the narrower task instruction applies: locally execute only the one test file just edited; send broader validation to Blaxel on a pushed revision.

## Guidance agents reach from AGENTS.md

The contribution includes written guidance as well as enforcement. The repository's [AGENTS.md](../../AGENTS.md) is the entry point every agent receives, so its Testing section will state the practical rules directly and link to their authoritative owners. The intended summary is:

> Use local tests for fast, narrow feedback on the behavior you are changing. Concurrent runs can drive a shared host into swap or cause OOM kills. Every local test run and local verify takes a mutex across checkouts; wait for its holder or use Blaxel when available. The runner documents the independent contention and inefficiency bypasses; the testing policy governs agent permission to use them.
>
> On hosts with `~/.tvdev-use-blaxel`, select one local file with optional grep; commit and push before using Blaxel for anything broader. Follow the runner's guidance for local-only suites. Unmarked hosts need no Blaxel access.

The [testing policy's iteration guidance](../../specs/arch/testing-policy.md#Test iteration discipline) will explain how to widen validation without widening local work on a marked host: start with the file under change, optionally use grep, then commit and push for broader Blaxel checks. It will state the shared-host safety priority and link to the runner's mutex and independent bypasses. Its provider guidance will preserve ordinary local development for unmarked public-contributor and fork hosts. The [remote preflight spec](../../specs/arch/test-runner/preflight.md#Contributor branches and remote revisions) remains the owner of the committed, pushed revision requirement.

The runner spec owns exact command behavior, file eligibility, lock lifetime, refusal messages, and bypass semantics. CLI help will expose the same practical choices at invocation time. This uses the existing instruction path from AGENTS.md to policy and command authority. The existing contribution and review skills will reinforce the development-branch practice below.

## Regular development-branch commits and pushes

Josh's standard way of working is for contributors and agents to work on their own development branch and commit and push regularly, in safe, coherent commits. A commit should capture a meaningful unit of the assigned work and be safe to publish; it need not make unfinished work ready to merge. Development branches may carry incomplete work or failing tests while the contribution follows its review and validation stages. Shared-branch merge requirements remain in force.

Pushing makes the current work available to Blaxel. Withholding pushes prevents remote workers from testing that revision and pressures agents into broad local runs, which can drive a shared host into swap and make it unusable for every agent. The normal response is to prepare and push a coherent development-branch checkpoint, then run the broader checks on Blaxel. Withheld or blocked pushes never themselves justify broad local execution.

A supervisor or coordinator must not casually instruct a worker not to commit or push on its development branch. Routine review coordination is not a reason to suspend this practice. A concrete safety or conflicting-edit issue can justify a temporary hold; required validation must still respect the local-run restrictions during that hold.

The [workflow](../../specs/spec-workflow.md#Pull requests and human revisions) will own this regular development-branch practice and its coordination guidance. The contribution will carry it into the instructions each role reads:

- **AGENTS.md:** the shared-branch section will directly tell contributors and agents to work on a development branch, commit and push safe, coherent changes regularly, and preserve workers' ability to do so during coordination. Its testing section will connect pushed checkpoints to Blaxel and shared-host protection.
- **[tvdev-contribute](../../developer-skills/tvdev-contribute/SKILL.md):** contribution and delegation guidance will make regular development-branch commits and pushes part of ordinary progress, including before broader Blaxel validation. It will explain the shared-host consequence of withholding pushes and the restriction on casual coordinator instructions to do so.
- **[tvdev-review](../../developer-skills/tvdev-review/SKILL.md):** one sentence will distinguish routine pushed development checkpoints, which enable remote validation while review proceeds, from readiness to merge. This clarifies how the existing stage-specific review guidance applies without adding a reviewer procedure or giving reviewers a commit/push role.

These instructions describe normal practice without a fixed commit interval or a separate approval step for each push. They distinguish publishing a development checkpoint from merging into a shared branch, so review gates do not prevent the remote validation needed to satisfy them. Repository guidance reaches a coordinator working outside the checkout when it reads AGENTS.md or uses the contribution skill; this change does not update external supervisor skills. Copied skill installations need the existing reinstall procedure to receive source edits.

## Scope and derivation

The contribution includes the AGENTS.md guidance above, authoritative runner, testing-policy, and workflow changes, and the corresponding contribution and review skill updates. Proof derivation will establish that local protections enforce the stated selection and lifetime guarantees and that the runner's own tests remain isolated. Test shape and fixtures follow the testing policy's cheapest honest coverage and the existing placement restrictions on destructive lifecycle tests.

Implementation should reuse the existing CLI, registry, marker, and process lifecycle. This contribution does not require a queue, configurable concurrency levels, a background lock service, or changes to public-contributor provider selection. Help and affected invocation guidance will show the one-file local path and the committed-revision remote path.

The current Blaxel CLI dispatches `--surface`, `--file`, and `--grep` through a single-worker target path. Suite, package, runner, and tag selections use planned file distribution. This proposal preserves those remote execution paths: redirecting a broad local selection to even one remote worker meets the primary goal of taking that test load off the shared host. Fan-out for targeted surface runs remains a separate speed improvement and is neither a prerequisite for these guardrails nor grounds for a broad local exception.

After proposal review, spec deltas and proofs receive their own independent review before implementation. The change appears to fit one implementation slice; a separate plan is useful only if proof derivation reveals a reason to split it. Completion requires broad validation on the pushed revision, integrated implementation review, documentation cleanup, and a pull request describing the final change for Josh's spec review under the repository workflow.

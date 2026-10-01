# Local test-runner guardrails

Proposal for independent review. Josh has chosen the three behavior changes below and will review their authoritative spec deltas on the pull request. This document records intent; the [runner spec](../../specs/arch/test-runner/test-runner.md) will own the command behavior.

## Purpose and decisions

Several agents can run tests on one development host. Independent local runs compete for CPU and memory and can cause the operating system to kill processes. Josh's first priority is keeping test runs from overwhelming that shared host. Every Blaxel test run moves its test workload off the host, including a surface run on a single remote worker.

Faster iteration is the second priority. Blaxel's planned execution distributes files across workers; it cannot split the work inside one file. Adding fan-out to targeted surface runs is a secondary speed improvement. Its absence is never a reason to run broad work locally.

Josh's decisions are:

1. Every canonical local test run, including local verify, takes one host-wide mutex outside every checkout and holds it until its test processes exit. A second run is refused immediately with exit `2`, identifying the holder and explaining the available next steps. A separate, conspicuously named flag allows the caller to bypass this protection.
2. On a host where the invoking user's `~/.tvdev-use-blaxel` exists, ordinary local iteration selects one test file, optionally narrowed with `--grep`. Broader selections are refused with exit `2`, an equivalent Blaxel command, and instructions to commit and push first. `--allow-extreme-inefficiency` overrides this restriction, as it does for local verify.
3. Without that marker, local selection and verification retain their behavior apart from the mutex. Public contributors and forks need no Blaxel credentials or access.

## Local concurrency

The lock coordinates canonical local runs across worktrees, separate clones, and invoking users on the same host. Its identity must not depend on the checkout, home directory, or caller-controlled temporary-directory setting. Acquisition is atomic and nonblocking. An active holder is identified by enough information to find its run: process identity, command, and checkout.

A local verify acquires the lock before executing its phases and retains it through completion and cleanup. Its test-phase child participates in that same ownership; it must neither contend with its parent nor grant an exemption to unrelated or arbitrarily nested runs. Direct local execution takes the same lock before starting preflight or test work. Informational commands such as `list`, `help`, and `verify --plan` do not acquire it. Blaxel dispatch does not acquire the submitting host's local-run lock.

Release follows test-process exit and the runner's existing lifecycle cleanup, including failure and handled interruption. An abruptly killed owner cannot run cleanup; recovery must establish that its test processes have exited or complete the existing stale-owner cleanup before admitting another run. Elapsed time alone is not evidence that a holder is safe to replace. Reuse the existing process identity and cleanup facilities rather than introduce a separate test-process supervisor.

The proposed bypass spelling is `--allow-major-host-contention-and-oom-killed-processes`. It permits concurrent local execution without displacing an existing holder. The refusal tells callers to wait for the named run to finish, use Blaxel when available, or deliberately use this bypass with its stated consequence. Unmarked hosts receive a usable local next step without needing Blaxel.

## One local file on marked hosts

An allowed selection supplies `--file` and resolves to exactly one test file in the current working tree. An additional `--grep` restricts cases within that file. Other selectors may disambiguate or restrict the file's owning surface; selecting a surface, suite, package, runner, or tag alone does not satisfy the file restriction, even if that selection happens to contain one file.

Counting owning surfaces is insufficient: one surface can contain many files. The runner must establish the file boundary before running tests, including for native substring or regular-expression filters that could match several paths. It must account for uncommitted and newly created test files; remote planning's committed-file inventory cannot alone prove a local selection is narrow. A directory or filter that would run multiple files is refused before those tests start. Invalid or empty selections retain their ordinary selection errors.

The marker's lookup remains the invoking user's home-directory file, with contents ignored. Local verify is inherently broader than one file and retains its existing refusal and explicit local override. These decisions occur before expensive execution so a refused command is quick.

For remotely supported selections, a refusal prints a shell-usable command preserving the intended selection and grep, plus the requirement to commit the intended changes and push the revision to `origin`. Full verification points to `npm run verify -- blaxel`. The runner does not automatically commit, push, or dispatch a refused local request.

Existing placement restrictions remain authoritative. In particular, the live PostHog suite needs a local secret and daemon acceptance mutates the designated local host. A diagnostic must not advertise a remote equivalent that cannot run: for local-only work it explains that limitation and gives a one-file local invocation where supported, or the explicit inefficiency override. The mutex still applies.

## Independent overrides

| Option | What it permits |
| --- | --- |
| `--allow-extreme-inefficiency` | A broader local selection on a marked host, including local verify. The host mutex still applies. |
| `--allow-major-host-contention-and-oom-killed-processes` | Local execution despite another local run. The marked-host file restriction still applies. |
| `--force` | A raw full-suite provider shortcut under the existing broad-run guardrail. It bypasses neither local protection. |

A caller needing both local exceptions must request both. The existing testing-policy requirement for explicit human permission before an agent uses the inefficiency bypass remains in force. During this contribution, the narrower task instruction applies: locally execute only the one test file just edited; send broader validation to Blaxel on a pushed revision.

## Guidance agents reach from AGENTS.md

The contribution includes written guidance as well as enforcement. The repository's [AGENTS.md](../../AGENTS.md) is the entry point every agent receives, so its Testing section will state the practical rules directly and link to their authoritative owners. The intended summary is:

> Use local tests for fast, narrow feedback on the behavior you are changing. Several agents may share this host; concurrent test runs can overwhelm it and cause processes to be OOM-killed. Every local test run and local verify takes a host-wide mutex across checkouts. If another run holds it, wait for that run to finish or use Blaxel when available. The explicit `--allow-major-host-contention-and-oom-killed-processes` bypass accepts that host risk and is independent of `--allow-extreme-inefficiency`.
>
> On team hosts with `~/.tvdev-use-blaxel`, select one local test file with `--file`, optionally narrowed with `--grep`; use Blaxel for anything broader. Commit the intended changes and push the revision to `origin` before a Blaxel run, because remote workers cannot test uncommitted local edits. Even a single-worker Blaxel run takes the test load off the shared host. Local-only suites follow the runner's placement rules and explicit override guidance.
>
> Without the marker, broader local tests and local verify remain available and require no Blaxel access. The mutex still applies. Follow the testing policy for iteration and bypass permissions, and the runner spec for commands and guardrail behavior.

The [testing policy's iteration guidance](../../specs/arch/testing-policy.md#Test iteration discipline) will explain how to widen validation without widening local work on a marked host: start with the file under change, optionally use grep, then commit and push for broader Blaxel checks. It will state the shared-host safety priority and link to the runner's mutex and independent bypasses. Its provider guidance will preserve ordinary local development for unmarked public-contributor and fork hosts. The [remote preflight spec](../../specs/arch/test-runner/preflight.md#Contributor branches and remote revisions) remains the owner of the committed, pushed revision requirement.

The runner spec owns exact command behavior, file eligibility, lock lifetime, refusal messages, and bypass semantics. CLI help will expose the same practical choices at invocation time. This uses the existing instruction path from AGENTS.md to policy and command authority. The existing contribution and review skills will reinforce the development-branch practice below.

## Regular development-branch commits and pushes

Josh's standard way of working is for contributors and agents to work on their own development branch and commit and push regularly, in safe, coherent commits. A commit should capture a meaningful unit of the assigned work and be safe to publish; it need not make unfinished work ready to merge. Development branches may carry incomplete work or failing tests while the contribution follows its review and validation stages. Shared-branch merge requirements remain in force.

Pushing makes the current work available to Blaxel. Withholding pushes prevents remote workers from testing that revision and pressures agents into broad local runs, which can drive a shared host into swap and make it unusable for every agent. The normal response is to prepare and push a coherent development-branch checkpoint, then run the broader checks on Blaxel. Withheld or blocked pushes never themselves justify broad local execution.

A supervisor or coordinator must not casually instruct a worker not to commit or push on its development branch. Routine review coordination is not a reason to suspend this practice. A concrete safety or conflicting-edit issue can justify a temporary hold; required validation must still respect the local-run restrictions during that hold.

The [workflow](../../specs/spec-workflow.md#Pull requests and human revisions) will own this regular development-branch practice and its coordination guidance. The contribution will carry it into the instructions each role reads:

- **AGENTS.md:** the shared-branch section will directly tell contributors and agents to work on a development branch, commit and push safe, coherent changes regularly, and preserve workers' ability to do so during coordination. Its testing section will connect pushed checkpoints to Blaxel and shared-host protection.
- **[tvdev-contribute](../../developer-skills/tvdev-contribute/SKILL.md):** contribution and delegation guidance will make regular development-branch commits and pushes part of ordinary progress, including before broader Blaxel validation. It will explain the shared-host consequence of withholding pushes and the restriction on casual coordinator instructions to do so.
- **[tvdev-review](../../developer-skills/tvdev-review/SKILL.md):** reviewer guidance will recognize development-branch checkpoints as ordinary work in progress, assess them against the assigned review stage, and avoid demanding that the owner withhold commits or pushes until review or full validation completes. Reviewers retain their assigned read-only role; the contribution owner makes and pushes changes.

These instructions describe normal practice without a fixed commit interval or a separate approval step for each push. They distinguish publishing a development checkpoint from merging into a shared branch, so review gates do not prevent the remote validation needed to satisfy them.

## Scope and derivation

The contribution includes the AGENTS.md guidance above, authoritative runner, testing-policy, and workflow changes, and the corresponding contribution and review skill updates. Proofs will cover real canonical CLI decisions, mutex contention across independent processes and checkouts, lock lifetime through child cleanup, the verify handoff, and actual single-file execution. Selector and override permutations should use the cheapest honest coverage. Test isolation must prevent the runner's own subprocess tests from interfering with unrelated host runs.

Implementation should reuse the existing CLI, registry, marker, and process lifecycle. This contribution does not require a queue, configurable concurrency levels, a background lock service, or changes to public-contributor provider selection. Help and affected invocation guidance will show the one-file local path and the committed-revision remote path.

The current Blaxel CLI dispatches `--surface`, `--file`, and `--grep` through a single-worker target path. Suite, package, runner, and tag selections use planned file distribution. This proposal preserves those remote execution paths: redirecting a broad local selection to even one remote worker meets the primary goal of taking that test load off the shared host. Fan-out for targeted surface runs remains a separate speed improvement and is neither a prerequisite for these guardrails nor grounds for a broad local exception.

After proposal review, spec deltas and proofs receive their own independent review before implementation. The change appears to fit one implementation slice; a separate plan is useful only if proof derivation reveals a reason to split it. Completion requires broad validation on the pushed revision, integrated implementation review, documentation cleanup, and a pull request describing the final change for Josh's spec review under the repository workflow.

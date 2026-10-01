import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, test } from "vitest";
import { loadTestConfig, selectSurfaces } from "../../scripts/test/config.mjs";

const cli = ["scripts/test/cli.mjs"];
// Real child-process homes isolate host configuration without mocking marker lookup.
const unmarkedHome = mkdtempSync(path.join(os.tmpdir(), "tv-runner-home-"));
const markedHome = mkdtempSync(path.join(os.tmpdir(), "tv-runner-blaxel-home-"));
writeFileSync(path.join(markedHome, ".tvdev-use-blaxel"), "");
afterAll(() => {
  rmSync(unmarkedHome, { recursive: true, force: true });
  rmSync(markedHome, { recursive: true, force: true });
});

function runCli(args: string[], env: Record<string, string | undefined> = {}) {
  return spawnSync(process.execPath, [...cli, ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      ...process.env,
      HOME: unmarkedHome,
      FORCE_COLOR: "0",
      NO_COLOR: "1",
      ...env,
    },
    timeout: 10_000,
  });
}

function selftestEnv(env: Record<string, string | undefined> = {}) {
  return {
    TV_TEST_RUNNER_SELFTEST: "1",
    AGENT_BLAXEL_GUARDRAILS: undefined,
    GITHUB_ACTIONS: undefined,
    GITHUB_WORKFLOW: undefined,
    TV_TEST_ISOLATED_GITHUB: undefined,
    ...env,
  };
}

const broadShortcutMessage = "Do not use this command for broad verification. Use npm run verify which also includes other critical verifications.";
const blaxelGuardrailPrefix = "The default broad verification strategy should be blaxel, which requires a clean working tree and all code pushed to origin.";
const localVerifyGuardrailMessage = "~/.tvdev-use-blaxel is present. Use Blaxel for full verification: npm run verify -- blaxel. With explicit human permission under testing policy, allow local verification using npm run verify -- local --allow-extreme-inefficiency.";
const ciWorkflowPath = ".github/workflows/ci.yml";

function ciEndToEndShardRunCommand(workflowText: string): string {
  const match = workflowText.match(/- name: Run e2e shard \$\{\{ matrix\.shard \}\}\/16\r?\n([\s\S]*?)(?=\n\s*- name: Resolve finalized shard run)/);
  if (!match) throw new Error("Could not find the pull request end-to-end shard step in .github/workflows/ci.yml");
  return match[1];
}

function ciEndToEndShardUploadStep(workflowText: string): string {
  const match = workflowText.match(/- name: Upload complete shard run\r?\n([\s\S]*?)(?=\n  # Single required status check)/);
  if (!match) throw new Error("Could not find the pull request end-to-end shard upload step in .github/workflows/ci.yml");
  return match[1];
}

const setupWorkspacePath = ".github/actions/setup-workspace/action.yml";
const setupShardReadinessPath = ".github/actions/setup-shard-readiness/action.yml";

function ciWorkflowJobs(workflow: string): Map<string, string> {
  const jobsStart = workflow.indexOf("\njobs:\n");
  if (jobsStart < 0) throw new Error("CI workflow has no jobs mapping");
  const jobsSource = workflow.slice(jobsStart + 1);
  const headers = [...jobsSource.matchAll(/^  ([a-zA-Z0-9_-]+):\r?$/gm)];
  return new Map(headers.map((header, index) => [
    header[1],
    jobsSource.slice(header.index, headers[index + 1]?.index ?? jobsSource.length),
  ]));
}

function nodeSelectorViolations(workflow: string): Array<{ job: string; selectors: number }> {
  const violations = [];
  for (const [job, source] of ciWorkflowJobs(workflow)) {
    if (!source.includes("uses: actions/checkout@v4")) continue;
    const selectors = [
      ...(source.match(/uses: actions\/setup-node@v4/g) ?? []),
      ...(source.match(/uses: \.\/\.github\/actions\/setup-workspace/g) ?? []),
      ...(source.match(/uses: \.\/\.github\/actions\/setup-shard-readiness/g) ?? []),
    ].length;
    if (selectors !== 1) violations.push({ job, selectors });
  }
  return violations;
}

describe("test runner guardrails", () => {
  // proofs/arch/test-runner/github-ci.md#^gha-ci-branch-targets
  test("CI validates pushes and pull requests for main and nested integration branches", () => {
    const workflow = readFileSync(ciWorkflowPath, "utf8");
    const triggers = workflow.slice(0, workflow.indexOf("\npermissions:"));

    expect(triggers).toContain("push:\n    branches: [main, 'integration/**']");
    expect(triggers).toContain("pull_request:\n    branches: [main, 'integration/**']");
  });

  // specs/arch/test-runner/github-ci.md#dependency-install — the
  // committed workflow encodes the exact-key cache contract.
  test("setup-workspace composite encodes the exact-key cache contract", () => {
    const action = readFileSync(setupWorkspacePath, "utf8");
    expect(action).not.toContain("restore-keys:");
    for (const input of ["package-lock.json", "packages/skills/package.json", "packages/skillbench/**"]) {
      expect(action).toContain(input);
    }
    for (const cached of ["node_modules", "packages/skillbench/dist"]) {
      expect(action).toContain(cached);
    }
    expect(action).toContain("cache-hit != 'true'");
    expect(action).toContain("value: ${{ steps.workspace-cache.outputs.cache-hit }}");
    expect(action.match(/uses: actions\/setup-node@v4/g)).toHaveLength(1);
    expect(action).toContain("node-version-file: .nvmrc");
    expect(action).not.toMatch(/^\s+node-version:/m);
    expect(action).toContain("process.versions.node");
    expect(action).toMatch(/key: \$\{\{ inputs\.cache-namespace \}\}-\$\{\{ runner\.os \}\}-\$\{\{ runner\.arch \}\}-node\$\{\{ steps\.node-runtime\.outputs\.major \}\}-\$\{\{ inputs\.image-identity \}\}/);
  });

  // specs/arch/test-runner/github-ci.md#test-assertions — the shard
  // readiness action binds one exact workspace+browser archive to the actual
  // Node and hosted-runner image selected for the job.
  test("setup-shard-readiness encodes the image-bound composite-cache contract", () => {
    const action = readFileSync(setupShardReadinessPath, "utf8");
    expect(action).not.toContain("restore-keys:");
    expect(action.match(/uses: actions\/setup-node@v4/g)).toHaveLength(1);
    expect(action).toContain("node-version-file: .nvmrc");
    expect(action).not.toMatch(/^\s+node-version:/m);
    expect(action).toContain("process.versions.node");
    expect(action).toContain('node_major="${node_version%%.*}"');
    expect(action).toContain("ImageOS");
    expect(action).toContain("ImageVersion");
    expect(action).toContain("node${node_major}");
    expect(action).not.toContain("fail-on-cache-miss");
    expect(action).toContain("default: shard-readiness-v2");
    expect(action).toContain("cache-key-suffix");
    expect(action).toContain('if [ -n "$CACHE_KEY_SUFFIX" ]');
    for (const input of ["package-lock.json", "packages/skills/package.json", "packages/skillbench/**"]) {
      expect(action).toContain(input);
    }
    for (const cached of ["node_modules", "packages/skillbench/dist", "~/.cache/ms-playwright"]) {
      expect(action).toContain(cached);
    }
  });

  test("every checked-out CI job selects .nvmrc exactly once", () => {
    const workflow = readFileSync(ciWorkflowPath, "utf8");
    const jobs = ciWorkflowJobs(workflow);
    expect(nodeSelectorViolations(workflow)).toEqual([]);

    const futureJob = `${workflow}\n  future-repository-job:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n      - run: node scripts/future-command.mjs\n`;
    expect(nodeSelectorViolations(futureJob)).toEqual([{ job: "future-repository-job", selectors: 0 }]);

    for (const id of ["attest-check", "e2e-required", "attest-write"]) {
      expect(jobs.get(id)).toContain("node-version-file: .nvmrc");
    }
    expect(jobs.get("attest-check")!.indexOf("actions/setup-node@v4"))
      .toBeLessThan(jobs.get("attest-check")!.indexOf("scripts/test/attestation.mjs decide"));
    expect(jobs.get("e2e-required")!.indexOf("actions/setup-node@v4"))
      .toBeLessThan(jobs.get("e2e-required")!.indexOf("scripts/test/gha-plan-agreement.mjs"));
    expect(jobs.get("attest-write")!.indexOf("actions/setup-node@v4"))
      .toBeLessThan(jobs.get("attest-write")!.indexOf("scripts/test/attestation.mjs write"));
  });

  test("setup-playwright inherits the Node selected by its owning CI job", () => {
    const workflow = readFileSync(ciWorkflowPath, "utf8");
    const action = readFileSync(".github/actions/setup-playwright/action.yml", "utf8");
    const testJob = workflow.slice(workflow.indexOf("\n  test:"), workflow.indexOf("\n  build:"));
    const buildJob = workflow.slice(workflow.indexOf("\n  build:"), workflow.indexOf("\n  e2e:"));
    const e2eJob = workflow.slice(workflow.indexOf("\n  e2e:"), workflow.indexOf("\n  e2e-required:"));

    expect(action).not.toContain("actions/setup-node");
    expect(action).not.toContain("node-version");
    expect(action).toContain("npx playwright install --with-deps chromium firefox");
    expect(action).toContain("npx playwright install-deps chromium firefox");
    expect(testJob.indexOf("setup-workspace")).toBeLessThan(testJob.indexOf("setup-playwright"));
    expect(buildJob.indexOf("setup-shard-readiness")).toBeLessThan(buildJob.indexOf("setup-playwright"));
    expect(e2eJob.indexOf("setup-shard-readiness")).toBeLessThan(e2eJob.indexOf("setup-playwright"));
  });

  // specs/arch/test-runner/github-ci.md#test-assertions — the committed
  // workflow encodes the browser-environment, fan-out, tool, and join contracts.
  test("ci.yml encodes the browser-environment, fan-out, tool-prerequisite, and join contracts", () => {
    const workflow = readFileSync(ciWorkflowPath, "utf8");
    const buildJob = workflow.slice(workflow.indexOf("\n  build:"), workflow.indexOf("\n  e2e:"));
    const e2eJob = workflow.slice(workflow.indexOf("\n  e2e:"), workflow.indexOf("\n  e2e-required:"));
    const joinJob = workflow.slice(workflow.indexOf("\n  e2e-required:"), workflow.indexOf("\n  attest-write:"));
    // Containerization remains deferred. Desktop uses setup-playwright; the
    // build seeds both Playwright browsers on a miss; shards restore only the
    // combined exact cache and prove both browsers launch on their own runner image.
    expect(workflow).not.toContain("container:");
    expect(workflow.match(/uses: \.\/\.github\/actions\/setup-playwright/g)).toHaveLength(3);
    expect(workflow).toMatch(/- if: \$\{\{ \(needs\.attest-check\.outputs\.skip != 'true' \|\| needs\.attest-check\.outputs\.authorized != 'true'\) && matrix\.suite\.playwright \}\}\s*\n\s*id: playwright\s*\n\s*uses: \.\/\.github\/actions\/setup-playwright/);
    expect(buildJob).toContain("uses: ./.github/actions/setup-playwright");
    expect(e2eJob).toContain("uses: ./.github/actions/setup-playwright");
    expect(buildJob).toContain("uses: ./.github/actions/setup-shard-readiness");
    expect(e2eJob).toContain("uses: ./.github/actions/setup-shard-readiness");
    expect(e2eJob).not.toContain("fail-on-cache-miss");
    expect(e2eJob).toContain("name: Warn and start shard-readiness self-seed fallback");
    expect(e2eJob).toContain("::warning::Shard readiness cache missed");
    expect(e2eJob).toContain("name: npm ci (shard-readiness fallback)");
    expect(e2eJob).toMatch(/name: Install Playwright browsers and system dependencies \(shard-readiness fallback\)[\s\S]*steps\.shard-readiness\.outputs\.cache-hit != 'true'[\s\S]*uses: \.\/\.github\/actions\/setup-playwright/);
    expect(e2eJob).toContain("--name shard-readiness-fallback --category readiness");
    expect(e2eJob).toContain("--cache-status miss");
    expect(e2eJob).not.toContain("uses: actions/cache/save@v4");
    expect(e2eJob).toContain("name: e2e shard ${{ matrix.shard }}/16");
    expect(e2eJob).toContain("shard: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]");
    expect(e2eJob).toContain("--shards 16");
    expect(e2eJob).toContain("--total 16");
    expect(e2eJob).toContain('--github-job-name "e2e shard ${{ matrix.shard }}/16" --needs-job-name "build prebuilt dists"');
    expect(workflow.match(/name: Prove Chromium and Firefox launch on this runner image/g)).toHaveLength(2);
    expect(workflow.match(/import \{ chromium, firefox \} from "@playwright\/test";/g)).toHaveLength(2);
    expect(workflow.match(/for \(const browserType of \[chromium, firefox\]\)/g)).toHaveLength(2);
    expect(buildJob).toContain("uses: actions/cache/save@v4");
    expect(buildJob).toContain("steps.shard-readiness.outputs.cache-hit != 'true'");
    // Build job + untracked-file fan-out: the manifest declares only the
    // recipe and artifact name; no output path list or capture record exists.
    expect(workflow).toContain("node scripts/test/prebuilt.mjs check");
    expect(workflow).toContain("node scripts/test/prebuilt.mjs run");
    expect(workflow).toContain("node scripts/test/prebuilt.mjs artifact-name");
    expect(workflow).toContain('node scripts/test/prebuilt.mjs pack --archive "$RUNNER_TEMP/prebuilt-dists.tgz"');
    expect(workflow).not.toContain("node scripts/test/prebuilt.mjs validate");
    expect(workflow).not.toContain("pack-join-validator");
    expect(workflow).not.toContain("join-validator.tgz");
    expect(workflow).not.toContain("name: prebuilt-dists");
    // Production prebuilt artifact keeps retention-days: 1 (manifest-named upload).
    expect(workflow).toMatch(/name: \$\{\{ steps\.prebuilt\.outputs\.name \}\}\s*\n\s*retention-days: 1/);
    expect(workflow).toContain('TEST_SHARD_SKIP_PRECOMMANDS: "1"');
    expect(e2eJob).toContain('tar --extract --gzip --file "$archive" --same-permissions --no-same-owner');
    // Tool prerequisites on every job that reaches cleanup paths: the shard
    // job unconditionally, unit and e2e:desktop via the matrix cleanup flag.
    expect(workflow.match(/name: Assert or install cleanup tools/g)).toHaveLength(2);
    expect(workflow).toContain("test -r /proc/net/tcp");
    expect(workflow).toMatch(/name: unit,\s+cmd:[^}]*cleanup: true/);
    expect(workflow).toMatch(/name: e2e:desktop,\s+cmd:[^}]*cleanup: true/);
    // The join is neutral/skipped on drafts and strict whenever it runs. It
    // checks out the repository and runs the validator from that checkout.
    expect(workflow).toContain("needs: [attest-check, build, e2e, vibe-mode]");
    expect(joinJob).toContain("if: ${{ always() && (github.event_name != 'pull_request' || github.event.pull_request.draft == false) }}");
    expect(joinJob).toContain('[ "$build_result" = "success" ] && [ "$e2e_result" = "success" ]');
    expect(joinJob).not.toContain('[ "$build_result" = "skipped" ] && [ "$e2e_result" = "skipped" ]');
    expect(workflow).toContain("TV_TEST_PHASE_METRICS_FILE");
    expect(workflow.match(/scripts\/record-test-phase\.mjs/g)?.length).toBeGreaterThanOrEqual(10);
    expect(workflow).toContain("--github-job-name");
    expect(workflow).toContain("--name shard-plan --category plan");
    expect(workflow).toContain("--name shard-agreement-join --category join");
    expect(workflow).toContain("name: test-phase-metrics-${{ github.run_id }}-join");
    expect(workflow.match(/name: Record (?:VM schedule and checkout phases|dependency phase|browser readiness phase|prebuilt artifact phase)\n(?:\s+if: \$\{\{ \(needs\.attest-check\.outputs\.skip != 'true' \|\| needs\.attest-check\.outputs\.authorized != 'true'\) \}\}\n)?\s+continue-on-error: true/g)).toHaveLength(7);
    expect(workflow.match(/phase metric recorder crashed/g)?.length).toBeGreaterThanOrEqual(5);
    expect(workflow).toContain("if-no-files-found: warn");
    expect(workflow).toMatch(/name: Upload join phase metrics\n\s+if: \$\{\{ always\(\) && \(needs\.attest-check\.outputs\.skip != 'true' \|\| needs\.attest-check\.outputs\.authorized != 'true'\) && needs\.e2e\.result == 'success' \}\}\n\s+continue-on-error: true/);
    expect(joinJob).toContain("uses: actions/checkout@v4");
    expect(joinJob).not.toContain("join-validator.tgz");
    expect(joinJob).toContain("node scripts/test/gha-plan-agreement.mjs");
    expect(joinJob).toContain("node scripts/record-test-phase.mjs");
  });

  // [[arch/test-runner/github-ci.md#^gha-prebuilt-consumer|prebuilt consumer]]
  test("e2e shards fail loudly when the prebuilt archive is missing or extraction fails", () => {
    const workflow = readFileSync(ciWorkflowPath, "utf8");
    const e2eJob = workflow.slice(workflow.indexOf("\n  e2e:"), workflow.indexOf("\n  e2e-required:"));
    const downloadStep = e2eJob.match(/- uses: actions\/download-artifact@v4([\s\S]*?)(?=\n\s*- name: Unpack prebuilt outputs)/)?.[0] ?? "";
    const unpackStep = e2eJob.match(/- name: Unpack prebuilt outputs \(restores file modes\)([\s\S]*?)(?=\n\s*- name: Record prebuilt artifact phase)/)?.[0] ?? "";

    expect(downloadStep).toContain("name: ${{ needs.build.outputs.artifact_name }}");
    expect(downloadStep).not.toContain("continue-on-error");
    expect(unpackStep).not.toContain("continue-on-error");
    expect(unpackStep).toContain("::error::missing prebuilt artifact archive");
    expect(unpackStep).toContain("::error::failed to extract prebuilt artifact archive");
    expect(unpackStep).toContain("exit 1");
  });

  test("e2e:desktop neither downloads nor extracts the prebuilt artifact", () => {
    const workflow = readFileSync(ciWorkflowPath, "utf8");
    const testJob = workflow.slice(workflow.indexOf("\n  test:"), workflow.indexOf("\n  build:"));

    expect(testJob).toContain("name: e2e:desktop");
    expect(testJob).not.toContain("actions/download-artifact");
    expect(testJob).not.toContain("prebuilt-dists.tgz");
    expect(testJob).not.toContain("Unpack prebuilt outputs");
    expect(testJob).not.toContain("tar --extract");
    expect(testJob).not.toContain("TEST_SHARD_SKIP_PRECOMMANDS");
  });

  // specs/arch/test-runner/attestation.md#test-assertions — the committed
  // workflow encodes the attestation wiring: a no-install decision job,
  // draft cost guards, heavy jobs that skip only on the literal 'true'
  // attestation output, a strict non-draft join, and a completion-bracketed
  // writer.
  test("ci.yml encodes the attestation decision, skip, join, and writer wiring", () => {
    const workflow = readFileSync(ciWorkflowPath, "utf8");
    const job = (id: string, next: string) => workflow.slice(workflow.indexOf(`\n  ${id}:`), next ? workflow.indexOf(`\n  ${next}:`) : workflow.length);
    const attestCheck = job("attest-check", "ci");
    const cheap = job("ci", "test");
    const join = job("e2e-required", "attest-write");
    const attestWrite = job("attest-write", "");

    // attest-check: continue-on-error, no install, the real decision CLI,
    // and the full output set the writer's bracket depends on.
    expect(attestCheck).toContain("continue-on-error: true");
    expect(attestCheck).toContain("node scripts/test/attestation.mjs decide");
    expect(attestCheck).not.toContain("setup-workspace");
    for (const output of ["skip", "tree", "version"]) {
      expect(attestCheck).toContain(`${output}: \${{ steps.decide.outputs.${output} }}`);
    }
    // The authorized output comes from a dedicated FINAL step: under
    // job-level continue-on-error, needs.attest-check.result reads 'success'
    // downstream even when the job failed (measured: run 29558875144), so a
    // last-step output — skipped by any earlier failure — is the only
    // decision-job-success signal dependents can trust. Nothing may follow it.
    expect(attestCheck).toContain("authorized: ${{ steps.authorize.outputs.authorized }}");
    const authorize = attestCheck.match(/- name: Authorize skip\s*\n\s*id: authorize\s*\n\s*run: echo "authorized=true" >> "\$GITHUB_OUTPUT"/);
    expect(authorize).not.toBeNull();
    expect(attestCheck.slice(attestCheck.indexOf(authorize![0]) + authorize![0].length)).not.toMatch(/^\s*- /m);

    // The decision and cheap jobs retain the draft cost guard. Cheap jobs do
    // not depend on attestation and run when the pull request becomes ready.
    const draftGuard = "github.event_name != 'pull_request' || github.event.pull_request.draft == false";
    expect(attestCheck).toContain(draftGuard);
    expect(cheap).not.toContain("attest-check");
    expect(cheap).toContain(draftGuard);

    // Heavy jobs: the skip guard sits on STEPS, never on the job — a
    // job-level skip on a matrix job suppresses expansion and the concrete
    // required check contexts (unit, e2e:desktop, e2e shard n/16) would never
    // emit, leaving a required-context ruleset blocked forever. Each heavy
    // job must depend on attest-check, keep its job-level if free of the
    // skip output, carry !cancelled() (the implicit success() gate would
    // silently skip the heavy tier when attest-check CRASHES — never-skip-
    // on-doubt applies to the job graph too), no-op explicitly, and guard
    // every real step.
    for (const [heavy, realSteps] of [[job("test", "build"), 14], [job("build", "e2e"), 10], [job("e2e", "e2e-required"), 22]] as const) {
      expect(heavy).toContain("attest-check");
      const jobIf = heavy.match(/^    if: (.*)$/m);
      expect(jobIf).not.toBeNull();
      expect(jobIf![1]).not.toContain("attest-check");
      expect(jobIf![1]).toContain("!cancelled()");
      expect(jobIf![1]).toContain(draftGuard);
      expect(heavy).toContain("- name: Attested skip no-op");
      // Skip authorization is BOUND to decision-job success: a decide step's
      // outputs survive a later step failing the job, so skip == 'true'
      // alone would let a failed attest-check no-op the heavy tier.
      expect(heavy).toContain("needs.attest-check.outputs.skip == 'true' && needs.attest-check.outputs.authorized == 'true'");
      expect(heavy).not.toMatch(/outputs\.skip == 'true' \}\}/);
      expect(heavy.match(/\(needs\.attest-check\.outputs\.skip != 'true' \|\| needs\.attest-check\.outputs\.authorized != 'true'\)/g)).toHaveLength(realSteps);
    }
    // e2e still skips on a failed build (join reads build=failure,
    // e2e=skipped as failure) — !cancelled() must not erase that edge.
    expect(job("e2e", "e2e-required").match(/^    if: (.*)$/m)![1]).toContain("needs.build.result == 'success'");

    // Join: drafts skip the whole job and therefore report neutral. On every
    // non-draft event, always() runs the strict status check. Authorized
    // attestation no-ops remain green because build and e2e report success.
    const joinIf = join.match(/^    if: (.*)$/m);
    expect(joinIf).not.toBeNull();
    expect(joinIf![1]).toContain("always()");
    expect(joinIf![1]).toContain(draftGuard);
    expect(join).toContain('[ "${{ needs.attest-check.outputs.skip }}" = "true" ] && [ "${{ needs.attest-check.outputs.authorized }}" = "true" ]');
    expect(join).not.toContain("is_draft=");
    expect(join).not.toContain('[ "$build_result" = "skipped" ] && [ "$e2e_result" = "skipped" ]');
    expect(join).not.toContain("whole-run draft skip");
    // vibe-mode: the join depends on the cheap vibe check and fails when it
    // did not succeed, so a vibe branch cannot pass the required check.
    const vibeJob = job("vibe-mode", "test");
    expect(vibeJob).toContain(draftGuard);
    expect(vibeJob).toContain("node scripts/test/vibe-mode-check.mjs");
    expect(join).toContain("needs: [attest-check, build, e2e, vibe-mode]");
    expect(join).toContain('[ "$vibe_result" != "success" ]');
    expect(join.indexOf('[ "$vibe_result" != "success" ]')).toBeLessThan(join.indexOf("attested skip: heavy jobs no-op-succeeded"));
    expect(vibeJob).not.toContain("attest-check");
    expect(join.match(/\(needs\.attest-check\.outputs\.skip != 'true' \|\| needs\.attest-check\.outputs\.authorized != 'true'\) && needs\.e2e\.result == 'success'/g)).toHaveLength(5);

    // attest-write: gated on every gate job's success plus the authorized
    // output (needs.attest-check.result is useless under continue-on-error),
    // completion re-read fed by the captured outputs, loud-but-non-gating.
    for (const gate of ["ci", "test", "build", "e2e", "e2e-required"]) {
      expect(attestWrite).toContain(`needs.${gate}.result == 'success'`);
    }
    expect(attestWrite).toContain("needs.attest-check.outputs.authorized == 'true'");
    expect(attestWrite).toContain("continue-on-error: true");
    expect(attestWrite).toContain("TV_TEST_REF_PUBLICATION: ${{ github.event_name == 'pull_request' && github.event.pull_request.head.repo.fork && 'not-authorized' || 'required' }}");
    expect(attestWrite).not.toContain("setup-workspace");
    expect(attestWrite).toContain('--captured-tree "${{ needs.attest-check.outputs.tree }}"');
    expect(attestWrite).toContain('--captured-version "${{ needs.attest-check.outputs.version }}"');
  });

  // specs/arch/test-runner/github-ci.md#ci-worker-counts — e2e:browser-app
  // keeps its conservative CI worker pin at 2 (TV_PW_WORKERS is the
  // measurement knob for the deferred continuous A/B).
  test("e2e:browser-app pins CI Playwright workers to 2 by default", () => {
    const config = readFileSync("packages/web/playwright.config.ts", "utf8");
    expect(config).toContain('Number(process.env.TV_PW_WORKERS ?? "2")');
  });

  test("ci.yml keeps ordinary jobs on setup-workspace and seeds shard readiness only on a composite miss", () => {
    const workflow = readFileSync(ciWorkflowPath, "utf8");
    expect(workflow).toContain("./.github/actions/setup-workspace");
    expect(workflow).toContain("./.github/actions/setup-shard-readiness");
    expect(workflow).not.toContain("cache-namespace:");
    expect(workflow).toMatch(/name: npm ci \(combined-cache miss only\)[\s\S]*steps\.shard-readiness\.outputs\.cache-hit != 'true'[\s\S]*run: npm ci/);
  });

  test("grants write permission only to the attestation-writer job", () => {
    const workflow = readFileSync(ciWorkflowPath, "utf8");
    const checkJob = workflow.slice(workflow.indexOf("  ci:"), workflow.indexOf("  test:"));
    const testJob = workflow.slice(workflow.indexOf("  test:"), workflow.indexOf("  build:"));
    const e2eJob = workflow.slice(workflow.indexOf("  e2e:\n"), workflow.indexOf("  e2e-required:"));
    const attestWriteJob = workflow.slice(workflow.indexOf("  attest-write:"));
    const attestCheckJob = workflow.slice(workflow.indexOf("  attest-check:"), workflow.indexOf("  ci:"));
    expect(workflow).not.toMatch(/contents:\s*\$\{\{[^\n]*matrix/);
    expect(checkJob).not.toMatch(/^\s+contents: write$/m);
    expect(attestCheckJob).not.toMatch(/^\s+contents: write$/m);
    expect(checkJob).toContain("name: lint");
    expect(checkJob).toContain("name: type-check");
    expect(checkJob).toContain("name: package-manifests");
    expect(testJob).not.toMatch(/^\s+contents: write$/m);
    expect(e2eJob).toContain("name: e2e shard");
    expect(e2eJob).not.toMatch(/^\s+contents: write$/m);
    expect(workflow.match(/^\s+contents: write$/gm)).toHaveLength(1);
    expect(attestWriteJob).toMatch(/^\s+contents: write$/m);
    expect(testJob).toContain("name: unit");
    expect(testJob).toContain("name: e2e:desktop");
    expect(testJob).toContain("Upload complete test run");
  });

  test("pins the current attestation policy and an activated timing baseline", () => {
    expect(JSON.parse(readFileSync("test/testpass-policy.json", "utf8"))).toEqual({ schemaVersion: 1, testpassRefsEnabled: true, testpassVersion: 1 });
    const baseline = JSON.parse(readFileSync("test/timing-baseline.json", "utf8"));
    expect(baseline.sourceThrough).not.toBeNull();
    expect(Object.keys(baseline.files).length).toBeGreaterThan(0);
  });

  // specs/arch/test-runner/attestation.md#prune-and-retention — argument
  // errors are rejected before any remote operation.
  test("rejects malformed testpass prune arguments before any remote operation", () => {
    const badAge = runCli(["testpass", "prune", "--older-than", "soon"]);
    expect(badAge.status, badAge.stderr).toBe(2);
    expect(badAge.stderr).toContain("--older-than must use positive whole days");
    const conflict = runCli(["testpass", "prune", "--older-than", "30d", "--dead-version", "2"]);
    expect(conflict.status, conflict.stderr).toBe(2);
    expect(conflict.stderr).toContain("choose one prune mode");
    const badVersion = runCli(["testpass", "prune", "--dead-version", "x"]);
    expect(badVersion.status, badVersion.stderr).toBe(2);
    expect(badVersion.stderr).toContain("--dead-version must be a positive integer");
    const usage = runCli(["testpass"]);
    expect(usage.status, usage.stderr).toBe(2);
    expect(usage.stderr).toContain("Usage: npm test -- testpass prune");
  });

  test("keeps CI-planned e2e surfaces registry-owned while desktop stays in its own job", () => {
    const config = loadTestConfig();
    const registrySpec = readFileSync("specs/arch/test-runner/test-registry.md", "utf8");
    const allE2e = selectSurfaces(config, { suite: "e2e" });
    const planned = selectSurfaces(config, { suite: "e2e-ci" });
    expect(planned.map((surface) => surface.id)).toEqual(allE2e.filter((surface) => !surface.tags.includes("electron")).map((surface) => surface.id));
    expect(registrySpec).toContain("`e2e-ci` → `kind:e2e`, excluding `tag:electron`");
    expect(registrySpec).toContain("dedicated `e2e:desktop` job");
    expect(planned.some((surface) => surface.id === "e2e:desktop" || surface.tags.includes("electron"))).toBe(false);
    const workflow = readFileSync(ciWorkflowPath, "utf8");
    expect(workflow).toContain('npm test -- local --surface e2e:desktop --run-dir-output');
    expect(workflow).toContain("--suite e2e-ci");
  });

  test("pull request end-to-end shard passes retries to the shard worker", () => {
    const command = ciEndToEndShardRunCommand(readFileSync(ciWorkflowPath, "utf8"));

    expect(command).toContain("scripts/run-test-shard.mjs");
    expect(command).toMatch(/(?:^|\s)--test-retries\s+2(?:\s|$)/);
  });

  test("GitHub test jobs publish substrate-correct complete run artifacts and join exact plans", () => {
    const workflow = readFileSync(ciWorkflowPath, "utf8");
    const uploadStep = ciEndToEndShardUploadStep(workflow);

    expect(workflow).toContain("TV_TEST_TIMING_PROVIDER: github-ubuntu-24.04-x64-2vcpu-vm");
    expect(uploadStep).toContain("path: ${{ env.test_run_dir }}/");
    expect(uploadStep).toContain("include-hidden-files: true");
    expect(uploadStep).toContain("if-no-files-found: error");
    expect(uploadStep).toContain("retention-days: 30");
    expect(workflow).toContain("uses: actions/checkout@v4");
    expect(workflow).toContain("node scripts/test/gha-plan-agreement.mjs --root test-runs --shards 16");
    expect(workflow.match(/--run-dir-output \"\$RUNNER_TEMP\/test-run-dir\"/g)).toHaveLength(2);
    expect(workflow).toContain('run_dir="$(cat "$identity")"');
    expect(workflow).toContain('test "$(dirname "$run_dir")" = "$GITHUB_WORKSPACE/.test-runs"');
    expect(workflow).not.toContain("find .test-runs");
  });

  // specs/arch/test-runner/test-runner.md#^verify-vibe-mode — the check
  // fails only when the waiver exists, and verify runs it last.
  test("vibe-mode check fails only when specs/vibe-waiver.md exists", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "tv-vibe-mode-"));
    try {
      const script = path.resolve("scripts/test/vibe-mode-check.mjs");
      const run = () => spawnSync(process.execPath, [script], { cwd: root, encoding: "utf8", timeout: 10_000 });
      const clean = run();
      expect(clean.status, clean.stderr).toBe(0);
      mkdirSync(path.join(root, "specs"));
      writeFileSync(path.join(root, "specs", "vibe-waiver.md"), "# Vibe waiver\n");
      const vibe = run();
      expect(vibe.status).toBe(1);
      expect(vibe.stderr).toContain("Vibe mode is active");
      expect(vibe.stderr).toContain("never merged into main");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("verify plans the vibe-mode check as its last phase for both providers", () => {
    for (const args of [["verify", "local", "--allow-extreme-inefficiency", "--plan"], ["verify", "blaxel", "--plan"]]) {
      const result = runCli(args);
      expect(result.status, result.stderr).toBe(0);
      const phases = result.stdout.split("\n").filter((line) => line.startsWith("[verify:"));
      expect(phases.at(-1)).toContain("[verify:vibe-mode] ");
      expect(phases.at(-1)).toContain("scripts/test/vibe-mode-check.mjs");
    }
  });

  // proofs/arch/test-runner/test-runner.md#^t-marked-verify-refusal
  test.each([{ args: [] }, { args: ["--allow-extreme-inefficiency"] }])("refuses failed marked-host verify preflight with extra args $args", ({ args: extraArgs }) => {
    const result = runCli(["verify", "--plan", ...extraArgs], selftestEnv({
      HOME: markedHome,
      TV_TEST_RUNNER_FAKE_REMOTE_PREFLIGHT: "blaxel:working-tree:Working tree has uncommitted local changes. Commit or stash changes.",
    }));

    expect(result.status, result.stderr).toBe(2);
    expect(result.stderr).toContain(blaxelGuardrailPrefix);
    expect(result.stderr).toContain("working-tree");
    expect(result.stderr).toContain("Commit or stash changes.");
    expect(result.stderr).toContain("npm run verify -- local --allow-extreme-inefficiency");
    expect(result.stdout).not.toContain("verify passed");
  });

  // proofs/arch/test-runner/test-runner.md#^t-local-verify-default
  test.each([{ args: [] }, { args: ["--provider", "auto"] }])("unmarked verify selects local without remote preflight with args $args", ({ args: providerArgs }) => {
    const result = runCli(["verify", ...providerArgs, "--plan"], {
      TV_TEST_RUNNER_SELFTEST: undefined,
      TV_TEST_RUNNER_FAKE_REMOTE_PREFLIGHT: "blaxel:must-not-run:remote preflight was reached",
    });

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("[verify] provider=local (auto)");
    expect(result.stdout).toContain("verify plan (local)");
    expect(result.stdout).toContain("scripts/test/cli.mjs local --suite all --force");
    expect(result.stdout).not.toContain("Blaxel preflight");
    expect(result.stderr).toBe("");
    expect(result.stdout).not.toContain("verify passed");
  });

  test("marked verify rejects the unauthorized remote preflight input", () => {
    const result = runCli(["verify", "--plan"], {
      HOME: markedHome,
      TV_TEST_RUNNER_SELFTEST: undefined,
      TV_TEST_RUNNER_FAKE_REMOTE_PREFLIGHT: "blaxel:must-not-run:remote preflight was reached",
    });
    expect(result.status, result.stderr).toBe(2);
    expect(result.stderr).toContain("TV_TEST_RUNNER_FAKE_REMOTE_PREFLIGHT is a test-runner self-test seam");
  });

  // proofs/arch/test-runner/test-runner.md#^t-marked-verify-default
  test("marked verify selects Blaxel when remote preflight passes", () => {
    const result = runCli(["verify", "--plan"], selftestEnv({
      HOME: markedHome,
      TV_TEST_RUNNER_FAKE_REMOTE_PREFLIGHT: "blaxel:passed",
    }));
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("[verify] provider=blaxel (auto: Blaxel preflight passed)");
    expect(result.stdout).toContain("verify plan (blaxel)");
    expect(result.stdout).toContain("scripts/test/cli.mjs blaxel --commit HEAD");
    expect(result.stdout).toContain("--suite all --force");
    expect(result.stdout).not.toContain("verify plan (local)");
    expect(result.stdout).not.toContain("verify passed");
  });

  test.each([
    ["verify"],
    ["preflight", "--provider", "blaxel", "--suite", "unit"],
    ["blaxel", "--file", "test/repo/test-runner-config.test.ts"],
  ])("refuses passing remote self-test results outside verify planning: %j", (...args) => {
    const result = runCli(args, selftestEnv({
      HOME: markedHome,
      TV_TEST_RUNNER_FAKE_REMOTE_PREFLIGHT: "blaxel:passed",
    }));
    expect(result.status, result.stderr).toBe(2);
    expect(result.stderr).toContain("Passing remote preflight self-test results require verify --plan");
    expect(result.stdout).not.toContain("[blaxel]");
  });

  test("refuses positional local verify provider when Blaxel guardrails are enabled", () => {
    const result = runCli(["verify", "local", "--plan"], selftestEnv({
      HOME: markedHome,
      TV_TEST_RUNNER_FAKE_REMOTE_PREFLIGHT: "blaxel:working-tree:Working tree has uncommitted local changes. Commit or stash changes.",
    }));

    expect(result.status, result.stderr).toBe(2);
    expect(result.stderr.trim()).toBe(localVerifyGuardrailMessage);
    expect(result.stdout).not.toContain("verify plan (local)");
    expect(result.stdout).not.toContain("verify passed");
  });

  test("allows positional local verify provider with explicit extreme inefficiency acknowledgement", () => {
    const result = runCli(["verify", "local", "--allow-extreme-inefficiency", "--plan"], selftestEnv({
      HOME: markedHome,
      TV_TEST_RUNNER_FAKE_REMOTE_PREFLIGHT: "blaxel:working-tree:Working tree has uncommitted local changes. Commit or stash changes.",
    }));

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("[verify] provider=local (explicit positional provider local)");
    expect(result.stdout).toContain("verify plan (local)");
    expect(result.stdout).not.toContain("verify passed");
    expect(result.stderr).not.toContain(blaxelGuardrailPrefix);
  });

  test("refuses --provider local when Blaxel guardrails are enabled", () => {
    const result = runCli(["verify", "--provider", "local", "--plan"], selftestEnv({
      HOME: markedHome,
    }));

    expect(result.status, result.stderr).toBe(2);
    expect(result.stderr.trim()).toBe(localVerifyGuardrailMessage);
    expect(result.stdout).not.toContain("verify plan (local)");
  });

  test("marker absence allows explicit local verification despite AGENT_BLAXEL_GUARDRAILS", () => {
    const result = runCli(["verify", "local", "--plan"], selftestEnv({ AGENT_BLAXEL_GUARDRAILS: "1" }));
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("verify plan (local)");
  });

  test.each(["", "contents do not matter"])("AGENT_BLAXEL_GUARDRAILS cannot disable the home marker with contents %j", (contents) => {
    writeFileSync(path.join(markedHome, ".tvdev-use-blaxel"), contents);
    const result = runCli(["verify", "local", "--plan"], selftestEnv({ HOME: markedHome, AGENT_BLAXEL_GUARDRAILS: "0" }));
    expect(result.status, result.stderr).toBe(2);
    expect(result.stderr.trim()).toBe(localVerifyGuardrailMessage);
  });

  test("the home marker leaves targeted local commands available", () => {
    const result = runCli(["local", "--file", "test/repo/test-runner-config.test.ts"], selftestEnv({ HOME: markedHome, TV_TEST_RUNNER_DRY_RUN: "1" }));
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("provider=local");
  });

  test("rejects conflicting positional and flag verify providers", () => {
    const result = runCli(["verify", "local", "--provider", "blaxel", "--plan"]);

    expect(result.status, result.stderr).toBe(2);
    expect(result.stderr).toContain("Pass verify provider either positionally or with --provider, not both.");
  });

  test("rejects invalid positional verify providers", () => {
    const result = runCli(["verify", "banana", "--plan"]);

    expect(result.status, result.stderr).toBe(2);
    expect(result.stderr).toContain("verify positional provider must be one of: local, blaxel");
  });

  test("verify plan includes --force for each provider's internal broad shortcut child", () => {
    for (const provider of ["local", "blaxel"] as const) {
      const args = provider === "local"
        ? ["verify", provider, "--allow-extreme-inefficiency", "--plan"]
        : ["verify", provider, "--plan"];
      const result = runCli(args);

      expect(result.status, `${provider}: ${result.stderr}`).toBe(0);
      expect(result.stdout).toContain(`verify plan (${provider})`);
      expect(result.stdout).toContain(`scripts/test/cli.mjs ${provider}`);
      expect(result.stdout).toContain("--suite all --force");
      expect(result.stdout).not.toContain("verify passed");
    }
  });

  test("documents --no-publish and rejects the publication opt-in flag", () => {
    const help = runCli(["help"]);
    expect(help.status, help.stderr).toBe(0);
    expect(help.stdout).toContain("--no-publish");
    expect(help.stdout).toContain("qualifying Blaxel");
    expect(help.stdout).not.toMatch(/(^|\s)--publish(?:\s|$)/m);

    const removed = runCli(["verify", "blaxel", "--publish", "--plan"]);
    expect(removed.status, removed.stderr).toBe(2);
    expect(removed.stderr).toContain("--publish is not a supported option");
    expect(removed.stderr).toContain("--no-publish");
  });

  test("rejects the local preflight self-test seam outside self-tests", () => {
    const result = runCli(["local", "--file", "test/repo/test-runner-config.test.ts"], {
      TV_TEST_RUNNER_FAKE_LOCAL_PREFLIGHT: "fixture:must stay gated",
    });
    expect(result.status, result.stderr).toBe(2);
    expect(result.stderr).toContain("TV_TEST_RUNNER_FAKE_LOCAL_PREFLIGHT is a test-runner self-test seam");
  });

  test("verify never honors the removed fake-passed phase seam", () => {
    const result = runCli(["verify", "local", "--plan"], {
      TV_TEST_RUNNER_FAKE_VERIFY_PHASES: "1",
    });

    expect(result.status, result.stderr).toBe(2);
    expect(result.stderr).toContain("TV_TEST_RUNNER_FAKE_VERIFY_PHASES is no longer supported");
    expect(result.stdout).not.toContain("verify passed");
  });

  test("verify refuses the provider dry-run self-test seam before running phases", () => {
    const result = runCli(["verify", "local"], selftestEnv({
      TV_TEST_RUNNER_DRY_RUN: "1",
    }));

    expect(result.status, result.stderr).toBe(2);
    expect(result.stderr).toContain("TV_TEST_RUNNER_DRY_RUN cannot be used with verify");
    expect(result.stdout).not.toContain("[verify:preflight]");
    expect(result.stdout).not.toContain("verify passed");
  });

  // specs/arch/test-runner/github-ci.md#retirement-record — the retired
  // gha dispatch provider is rejected everywhere a provider is named.
  // Acceptance-shaped: the real scripts/test/cli.mjs process, real argv,
  // asserted exit codes and stderr.
  test("rejects the retired gha provider shortcut", () => {
    const result = runCli(["gha", "--suite", "e2e"]);
    expect(result.status, result.stderr).toBe(2);
    expect(result.stderr).toContain("Unknown command");
  });

  test("rejects the retired gha provider as a verify positional", () => {
    const result = runCli(["verify", "gha", "--plan"]);
    expect(result.status, result.stderr).toBe(2);
    expect(result.stderr).toContain("verify positional provider must be one of: local, blaxel");
  });

  test("rejects the retired gha provider via --provider", () => {
    const result = runCli(["verify", "--provider", "gha", "--plan"]);
    expect(result.status, result.stderr).toBe(2);
    expect(result.stderr).toContain("verify provider must be one of: auto, local, blaxel");
  });

  test("rejects the retired gha provider for preflight", () => {
    const result = runCli(["preflight", "--provider", "gha"]);
    expect(result.status, result.stderr).toBe(2);
    expect(result.stderr).toContain("--provider must be one of: local, blaxel");
  });

  test("rejects isolated lifecycle fixtures on developer-host local execution before preflight", () => {
    const result = runCli(["local", "--surface", "experiment:lifecycle-leak"], selftestEnv({
      TV_TEST_RUNNER_DRY_RUN: "1",
      TV_TEST_RUNNER_FAKE_LOCAL_PREFLIGHT: "must-not-run",
    }));

    expect(result.status, result.stderr).toBe(2);
    expect(result.stderr).toContain("isolated-github-only");
    expect(result.stderr).toContain("branch-only Process Lifecycle Fault Injection workflow");
    expect(result.stdout).not.toContain("process-lifecycle");
  });

  test("rejects isolated lifecycle fixtures on every Blaxel path before remote preflight", () => {
    const result = runCli(["blaxel", "--surface", "experiment:lifecycle-leak"], selftestEnv({
      TV_TEST_RUNNER_DRY_RUN: "1",
      TV_TEST_RUNNER_FAKE_REMOTE_PREFLIGHT: "blaxel:must-not-run:placement guard failed",
      GITHUB_ACTIONS: "true",
      GITHUB_WORKFLOW: "Process Lifecycle Fault Injection",
      TV_TEST_ISOLATED_GITHUB: "1",
    }));

    expect(result.status, result.stderr).toBe(2);
    expect(result.stderr).toContain("isolated-github-only");
    expect(result.stderr).toContain("never eligible for Blaxel");
    expect(result.stderr).not.toContain("placement guard failed");
  });

  // The architect accepted this deviation as closed pending TV-597's cause investigation and restoration.
  test.skip("allows isolated lifecycle fixtures only under the authorized GitHub workflow identity and opt-in", () => {
    const result = runCli(["local", "--surface", "experiment:lifecycle-leak"], selftestEnv({
      TV_TEST_RUNNER_DRY_RUN: "1",
      GITHUB_ACTIONS: "true",
      GITHUB_WORKFLOW: "Process Lifecycle Fault Injection",
      TV_TEST_ISOLATED_GITHUB: "1",
    }));

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("surfaces=experiment:lifecycle-leak");
  });

  test("rejects isolated lifecycle fixture preflight outside the authorized workflow", () => {
    const result = runCli(["preflight", "--provider", "local", "--surface", "experiment:lifecycle-leak"], selftestEnv({
      TV_TEST_RUNNER_FAKE_LOCAL_PREFLIGHT: "must-not-run",
    }));

    expect(result.status, result.stderr).toBe(2);
    expect(result.stderr).toContain("isolated-github-only");
    expect(result.stdout).not.toContain("process-lifecycle");
  });

  for (const provider of ["local", "blaxel"] as const) {
    test(`refuses broad ${provider} shortcut runs`, () => {
      const result = runCli([provider]);

      expect(result.status, `${provider}: ${result.stderr}`).toBe(2);
      expect(result.stderr.trim()).toBe(broadShortcutMessage);
    });

    test(`refuses explicit broad ${provider} shortcut suite`, () => {
      const result = runCli([provider, "--suite", "all"]);

      expect(result.status, `${provider}: ${result.stderr}`).toBe(2);
      expect(result.stderr.trim()).toBe(broadShortcutMessage);
    });

    test(`refuses bare --grep ${provider} shortcut as broad`, () => {
      const result = runCli([provider, "--grep", "."]);

      expect(result.status, `${provider}: ${result.stderr}`).toBe(2);
      expect(result.stderr.trim()).toBe(broadShortcutMessage);
    });

    test(`allows broad ${provider} shortcuts with --force`, () => {
      const result = runCli([provider, "--suite", "all", "--force"], selftestEnv({
        TV_TEST_RUNNER_DRY_RUN: "1",
      }));

      expect(result.status, `${provider}: ${result.stderr}`).toBe(0);
      expect(result.stdout).toContain(`[dry-run] provider=${provider} suite=all`);
    });

    test(`allows ${provider} grep with file as targeted`, () => {
      const result = runCli([provider, "--file", "test/repo/test-runner-config.test.ts", "--grep", "registry"], selftestEnv({
        TV_TEST_RUNNER_DRY_RUN: "1",
      }));

      expect(result.status, `${provider}: ${result.stderr}`).toBe(0);
      expect(result.stdout).toContain(`[dry-run] provider=${provider}`);
      expect(result.stdout).toContain("files=test/repo/test-runner-config.test.ts");
    });

    test(`allows ${provider} grep with surface as targeted`, () => {
      const result = runCli([provider, "--surface", "unit:root", "--grep", "registry"], selftestEnv({
        TV_TEST_RUNNER_DRY_RUN: "1",
      }));

      expect(result.status, `${provider}: ${result.stderr}`).toBe(0);
      expect(result.stdout).toContain(`[dry-run] provider=${provider}`);
      expect(result.stdout).toContain("surfaces=unit:root");
    });
  }

  test("allows non-all shortcut suites", () => {
    const unit = runCli(["local", "--suite", "unit"], selftestEnv({ TV_TEST_RUNNER_DRY_RUN: "1" }));
    const e2e = runCli(["local", "--suite", "e2e"], selftestEnv({ TV_TEST_RUNNER_DRY_RUN: "1" }));
    const telemetryPostHog = runCli(["local", "--suite", "telemetry-posthog-roundtrip"], selftestEnv({ TV_TEST_RUNNER_DRY_RUN: "1" }));
    const daemonAcceptance = runCli(["local", "--suite", "daemon-acceptance"], selftestEnv({ TV_TEST_RUNNER_DRY_RUN: "1" }));

    expect(unit.status, unit.stderr).toBe(0);
    expect(unit.stdout).toContain("[dry-run] provider=local suite=unit");
    expect(e2e.status, e2e.stderr).toBe(0);
    expect(e2e.stdout).toContain("[dry-run] provider=local suite=e2e");
    expect(telemetryPostHog.status, telemetryPostHog.stderr).toBe(0);
    expect(telemetryPostHog.stdout).toContain("[dry-run] provider=local suite=telemetry-posthog-roundtrip surfaces=telemetry-posthog-roundtrip:integration");
    expect(daemonAcceptance.status, daemonAcceptance.stderr).toBe(0);
    expect(daemonAcceptance.stdout).toContain("[dry-run] provider=local suite=daemon-acceptance surfaces=daemon-acceptance:cli");
  });

  test("allows targeted shortcut selectors", () => {
    const selectors = [
      ["--file", "test/repo/test-runner-config.test.ts", "files=test/repo/test-runner-config.test.ts"],
      ["--surface", "unit:root", "surfaces=unit:root"],
      ["--package", "@telepath-computer/television-web", "unit:browser-app"],
      ["--runner", "playwright", "e2e:browser-app"],
      ["--tag", "browser", "e2e:browser-app"],
    ];

    for (const [flag, value, expected] of selectors) {
      const result = runCli(["local", flag, value], selftestEnv({ TV_TEST_RUNNER_DRY_RUN: "1" }));

      expect(result.status, `${flag} ${value}: ${result.stderr}`).toBe(0);
      expect(result.stdout).toContain("[dry-run] provider=local");
      expect(result.stdout).toContain(expected);
    }
  });
});

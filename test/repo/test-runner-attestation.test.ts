import { describe, expect, test } from "vitest";
import {
  ageWithinWindow,
  attestationRef,
  computeAgeSeconds,
  decideSkip,
  ELIGIBILITY_CLAUSES,
  evaluateEligibility,
  MAX_ATTESTATION_AGE_SECONDS,
  readTestpassPolicy,
  type TestpassPolicy,
} from "../../scripts/test/attestation.mjs";

// specs/arch/test-runner/attestation.md#test-assertions — decision logic.

const TREE = "6ffb98fb8f5a062c6975441131ceddaaedfebd0a";
const NOW = 1_800_000_000;

function enabledPolicy(version = 1): TestpassPolicy {
  return { status: "enabled", version, objectId: "0".repeat(40) };
}

function affirmingFacts() {
  return {
    policy: enabledPolicy(),
    tree: TREE,
    refFound: true,
    refVersion: 1,
    refObjectType: "commit",
    refTree: TREE,
    committerTime: NOW - 60,
    now: NOW,
  };
}

describe("skip decision", () => {
  test("affirms only when every check affirms", () => {
    const decision = decideSkip(affirmingFacts());
    expect(decision).toMatchObject({ skip: true, version: 1, tree: TREE, ageSeconds: 60 });
  });

  test("every single negation yields no-skip with a named reason", () => {
    const negations: Array<[string, Partial<ReturnType<typeof affirmingFacts>>, string]> = [
      ["policy unavailable", { policy: { status: "unavailable", message: "origin is unavailable" } }, "policy unavailable"],
      ["policy disabled", { policy: { status: "disabled", version: 1 } }, "policy disabled"],
      ["tree unreadable", { tree: undefined }, "tree hash unreadable"],
      ["ref absent", { refFound: false }, "no attestation for tree"],
      ["enabled policy with invalid version", { policy: { status: "enabled", version: 0 } }, "policy version invalid"],
      ["enabled policy with missing version", { policy: { status: "enabled" } }, "policy version invalid"],
      ["ref version mismatch", { refVersion: 2 }, "does not match policy version"],
      ["ref version missing", { refVersion: undefined }, "does not match policy version"],
      ["object not a commit", { refObjectType: "tag" }, "object not a commit"],
      ["name/tree invariant", { refTree: TREE.replace("6", "7") }, "name/tree invariant failed"],
      ["future timestamp", { committerTime: NOW + 1 }, "outside [0"],
      ["over-age", { committerTime: NOW - MAX_ATTESTATION_AGE_SECONDS - 3600 }, "outside [0"],
      ["unreadable committer time", { committerTime: undefined }, "committer time unreadable"],
    ];
    for (const [label, override, reason] of negations) {
      const decision = decideSkip({ ...affirmingFacts(), ...override });
      expect(decision.skip, label).toBe(false);
      expect(decision.reason, label).toContain(reason);
    }
  });

  test("both window endpoints are inclusive and asserted exactly", () => {
    // age exactly 0 skips
    expect(decideSkip({ ...affirmingFacts(), committerTime: NOW }).skip).toBe(true);
    // age exactly 7d skips
    expect(decideSkip({ ...affirmingFacts(), committerTime: NOW - MAX_ATTESTATION_AGE_SECONDS }).skip).toBe(true);
    // surrounding values on both sides
    expect(decideSkip({ ...affirmingFacts(), committerTime: NOW - (MAX_ATTESTATION_AGE_SECONDS - 3600) }).skip).toBe(true); // 6d23h
    expect(decideSkip({ ...affirmingFacts(), committerTime: NOW - (MAX_ATTESTATION_AGE_SECONDS + 3600) }).skip).toBe(false); // 7d1h
    expect(decideSkip({ ...affirmingFacts(), committerTime: NOW + 1 }).skip).toBe(false); // -1s
  });

  test("age helpers reject unreadable inputs", () => {
    expect(computeAgeSeconds({ committerTime: undefined, now: NOW })).toBeNull();
    expect(computeAgeSeconds({ committerTime: Number.NaN, now: NOW })).toBeNull();
    expect(ageWithinWindow(null)).toBe(false);
  });
});

describe("policy and version domain", () => {
  function readerReturning(policy: Record<string, unknown> | null) {
    return () => (policy === null
      ? { status: "unavailable", message: "policy is missing from the default branch" }
      : { status: "available", objectId: "0".repeat(40), policy });
  }

  test("unavailable shared reads stay unavailable", () => {
    expect(readTestpassPolicy({ policyReader: readerReturning(null) }).status).toBe("unavailable");
    expect(readTestpassPolicy({ policyReader: () => { throw new Error("boom"); } }).status).toBe("unavailable");
  });

  test("version domain permutations disable both reading and writing", () => {
    for (const version of [0, -3, 1_000_000_001, 1.5, "1", undefined]) {
      const result = readTestpassPolicy({ policyReader: readerReturning({ testpassRefsEnabled: true, testpassVersion: version }) });
      expect(result.status, JSON.stringify(version)).toBe("unavailable");
    }
  });

  test("only explicit true with a valid version enables", () => {
    expect(readTestpassPolicy({ policyReader: readerReturning({ testpassRefsEnabled: true, testpassVersion: 2 }) })).toMatchObject({ status: "enabled", version: 2 });
    expect(readTestpassPolicy({ policyReader: readerReturning({ testpassRefsEnabled: false, testpassVersion: 1 }) })).toMatchObject({ status: "disabled", version: 1 });
    expect(readTestpassPolicy({ policyReader: readerReturning({ testpassRefsEnabled: "true", testpassVersion: 1 }) }).status).toBe("disabled");
  });
});

// specs/arch/test-runner/attestation.md#activation-policy — the trusted read
// crosses real Git against a temporary bare origin.
describe("trusted policy read", async () => {
  const { execFileSync } = await import("node:child_process");
  const { mkdtempSync, mkdirSync, rmSync, writeFileSync } = await import("node:fs");
  const os = await import("node:os");
  const path = await import("node:path");
  const { readTrustedPolicy, TESTPASS_POLICY_PATH } = await import("../../scripts/test/attestation.mjs");

  const policy = (fields: Record<string, unknown>) => `${JSON.stringify({ schemaVersion: 1, testpassRefsEnabled: false, testpassVersion: 1, ...fields })}\n`;

  function policyFixture(content: string | null) {
    const dir = mkdtempSync(path.join(os.tmpdir(), "tv-attest-policy-"));
    const bare = path.join(dir, "origin.git");
    execFileSync("git", ["init", "-q", "--bare", "-b", "main", bare]);
    const clone = (name: string) => {
      const work = path.join(dir, name);
      mkdirSync(work);
      const git = (...args: string[]) => execFileSync("git", args, { cwd: work, encoding: "utf8" }).trim();
      git("init", "-q", "-b", "main");
      git("config", "user.email", "t@example.invalid");
      git("config", "user.name", "t");
      git("remote", "add", "origin", bare);
      const publish = (policyContent: string | null, message: string) => {
        const file = path.join(work, TESTPASS_POLICY_PATH);
        mkdirSync(path.dirname(file), { recursive: true });
        if (policyContent === null) rmSync(file, { force: true });
        else writeFileSync(file, policyContent);
        writeFileSync(path.join(work, "f.txt"), message);
        git("add", "-A");
        git("commit", "-qm", message);
        git("push", "-q", "origin", "HEAD:main");
      };
      return { work, git, publish };
    };
    const reader = clone("reader");
    reader.publish(content, "seed");
    return { dir, reader, clone, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
  }

  test("reads the exact object at origin's main, never the tested checkout", () => {
    const fixture = policyFixture(policy({}));
    try {
      const { reader } = fixture;
      expect(readTrustedPolicy({ repoRoot: reader.work })).toMatchObject({ status: "available", policy: { testpassRefsEnabled: false, testpassVersion: 1 } });
      reader.git("checkout", "-q", "-b", "work-branch");
      writeFileSync(path.join(reader.work, TESTPASS_POLICY_PATH), policy({ testpassRefsEnabled: true }));
      reader.git("commit", "-qam", "enable on a work branch");
      expect(readTrustedPolicy({ repoRoot: reader.work })).toMatchObject({ status: "available", policy: { testpassRefsEnabled: false } });

      // Another clone moves origin's main to an object the reader has never
      // fetched; the reader fetches that exact object and honors it.
      const operator = fixture.clone("operator");
      operator.git("pull", "-q", "origin", "main");
      operator.publish(policy({ testpassRefsEnabled: true, testpassVersion: 4 }), "operator enables");
      expect(readTrustedPolicy({ repoRoot: reader.work })).toMatchObject({ status: "available", objectId: operator.git("rev-parse", "HEAD"), policy: { testpassRefsEnabled: true, testpassVersion: 4 } });
    } finally {
      fixture.cleanup();
    }
  });

  test("reads a missing, malformed, or unreachable policy as unavailable", () => {
    const fixture = policyFixture(null);
    try {
      const { reader } = fixture;
      expect(readTrustedPolicy({ repoRoot: reader.work })).toMatchObject({ status: "unavailable" });
      for (const [name, content] of [
        ["malformed", "{ nope\n"],
        ["unsupported schema", policy({ schemaVersion: 2 })],
        ["extra key", policy({ productionRefsEnabled: true })],
        ["missing flag", `${JSON.stringify({ schemaVersion: 1, testpassVersion: 1 })}\n`],
        ["missing version", `${JSON.stringify({ schemaVersion: 1, testpassRefsEnabled: true })}\n`],
        ["non-boolean flag", policy({ testpassRefsEnabled: "true" })],
        ["non-integer version", policy({ testpassVersion: 1.5 })],
      ] as const) {
        reader.publish(content, name);
        expect(readTrustedPolicy({ repoRoot: reader.work }), name).toMatchObject({ status: "unavailable" });
      }
      reader.publish(policy({}), "valid");
      expect(readTrustedPolicy({ repoRoot: reader.work })).toMatchObject({ status: "available" });
      expect(readTrustedPolicy({ repoRoot: reader.work, remote: path.join(fixture.dir, "missing.git") })).toMatchObject({ status: "unavailable" });
    } finally {
      fixture.cleanup();
    }
  });
});

describe("ref encoding", () => {
  test("canonical shapes for both modes", () => {
    expect(attestationRef("production", 2, TREE)).toBe(`refs/testpass/2/${TREE}`);
    expect(attestationRef("lab", 1, TREE)).toBe(`refs/testpass-lab/1/${TREE}`);
  });

  test("closed mode enum and input validation", () => {
    expect(() => attestationRef("refs/testpass" as never, 1, TREE)).toThrow(/mode must be one of/);
    expect(() => attestationRef("production", 0, TREE)).toThrow(/version outside domain/);
    expect(() => attestationRef("production", 1, "not-a-tree")).toThrow(/lowercase hex/);
  });
});

describe("eligibility predicate", () => {
  function eligibleFacts() {
    return {
      treeAtStart: TREE,
      treeAtEnd: TREE,
      testedTree: TREE,
      cleanAtStart: true,
      cleanAtEnd: true,
      ignoreUncommitted: false,
      qualifyingRun: true,
      surfaces: [
        { id: "unit:root", status: "passed" },
        { id: "e2e:desktop", status: "passed" },
      ],
      expectedSurfaceIds: ["unit:root", "e2e:desktop"],
      shardSubset: false,
      targetedSelection: false,
      canonicalRetries: true,
      attestedSkipRun: false,
      policyAtStart: enabledPolicy(3),
      policyAtEnd: enabledPolicy(3),
    };
  }

  test("all clauses green is eligible", () => {
    expect(evaluateEligibility(eligibleFacts())).toEqual({ eligible: true, failures: [] });
  });

  test("each clause rejects independently and names itself", () => {
    const cases: Array<[Partial<ReturnType<typeof eligibleFacts>>, string]> = [
      [{ qualifyingRun: false }, "qualifying-blaxel-run"],
      [{ testedTree: TREE.replace("6", "7") }, "one-tree-everywhere"],
      [{ cleanAtStart: false }, "clean-and-unchanged-bracketed"],
      [{ cleanAtEnd: false }, "clean-and-unchanged-bracketed"],
      [{ treeAtEnd: TREE.replace("6", "7") }, "clean-and-unchanged-bracketed"],
      [{ ignoreUncommitted: true }, "clean-and-unchanged-bracketed"],
      [{ surfaces: [{ id: "unit:root", status: "passed" }, { id: "e2e:desktop", status: "skipped" }] }, "complete-scope"],
      [{ surfaces: [{ id: "unit:root", status: "passed" }] }, "complete-scope"],
      [{ shardSubset: true }, "complete-scope"],
      [{ targetedSelection: true }, "complete-scope"],
      [{ canonicalRetries: false }, "canonical-retries"],
      [{ attestedSkipRun: true }, "not-attested-skipped"],
      [{ policyAtEnd: enabledPolicy(4) }, "policy-version-bracket"],
      [{ policyAtEnd: { status: "disabled", version: 3 } }, "policy-version-bracket"],
      [{ policyAtStart: { status: "unavailable" } }, "policy-version-bracket"],
    ];
    for (const [override, clause] of cases) {
      const verdict = evaluateEligibility({ ...eligibleFacts(), ...override });
      expect(verdict.eligible, clause + " " + JSON.stringify(override)).toBe(false);
      expect(verdict.failures, clause).toContain(clause);
    }
  });

  test("clause names are the spec's stable identifiers", () => {
    expect(ELIGIBILITY_CLAUSES).toEqual([
      "qualifying-blaxel-run",
      "one-tree-everywhere",
      "clean-and-unchanged-bracketed",
      "complete-scope",
      "canonical-retries",
      "not-attested-skipped",
      "policy-version-bracket",
    ]);
  });
});

describe("writer", async () => {
  const { execFileSync } = await import("node:child_process");
  const { mkdtempSync, writeFileSync, mkdirSync } = await import("node:fs");
  const os = await import("node:os");
  const path = await import("node:path");
  const { publishAttestation, maybePublishAttestation } = await import("../../scripts/test/attestation.mjs");

  function bareRemoteFixture() {
    const dir = mkdtempSync(path.join(os.tmpdir(), "tv-attest-writer-"));
    const work = path.join(dir, "work");
    mkdirSync(work);
    const git = (args: string[], cwd = work) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
    git(["init", "-q", "-b", "main"]);
    git(["config", "user.email", "t@example.invalid"]);
    git(["config", "user.name", "t"]);
    writeFileSync(path.join(work, "f.txt"), "one");
    git(["add", "-A"]); git(["commit", "-qm", "one"]);
    const bare = path.join(dir, "bare.git");
    execFileSync("git", ["clone", "-q", "--bare", work, bare], { encoding: "utf8" });
    const commit = git(["rev-parse", "HEAD"]);
    const tree = git(["rev-parse", "HEAD^{tree}"]);
    return { work, bare, git, commit, tree };
  }

  test("create, transport no-op, descendant rejection to idempotent success, malformed collision", () => {
    const { work, bare, git, commit, tree } = bareRemoteFixture();
    const base = { tree, mode: "lab" as const, version: 1, remote: bare, repoRoot: work };

    expect(publishAttestation({ ...base, commit })).toMatchObject({ status: "published", ref: `refs/testpass-lab/1/${tree}` });
    expect(publishAttestation({ ...base, commit })).toMatchObject({ status: "already-attested" });

    // descendant with identical tree: lease rejects the change; validation
    // finds a valid existing attestation -> idempotent success, ref unmoved.
    const child = git(["commit-tree", `${commit}^{tree}`, "-p", commit, "-m", "descendant"]);
    expect(publishAttestation({ ...base, commit: child })).toMatchObject({ status: "already-attested" });

    // malformed collision: a ref whose commit tree does not match its name.
    writeFileSync(path.join(work, "f.txt"), "two");
    git(["add", "-A"]); git(["commit", "-qm", "two"]);
    const otherCommit = git(["rev-parse", "HEAD"]);
    const otherTree = git(["rev-parse", "HEAD^{tree}"]);
    execFileSync("git", ["push", "-q", bare, `${otherCommit}:refs/testpass-lab/1/${tree.replace(/^./, "f")}`], { cwd: work });
    const collided = publishAttestation({ ...base, tree: tree.replace(/^./, "f"), commit: otherCommit === commit ? child : commit });
    expect(collided.status).toBe("malformed-collision");
    expect(otherTree).not.toBe(tree);
  });

  test("pre-network refusal when the commit does not carry the named tree (absent ref)", () => {
    const { work, bare, git, commit } = bareRemoteFixture();
    const wrongTree = "a".repeat(40);
    const outcome = publishAttestation({ commit, tree: wrongTree, mode: "lab", version: 1, remote: bare, repoRoot: work });
    expect(outcome.status).toBe("refused-invalid");
    expect(git(["ls-remote", bare, `refs/testpass-lab/1/${wrongTree}`])).toBe("");
  });

  test("production mode enforces an eligible source and the trusted policy at the writer boundary", () => {
    const { work, bare, git, commit, tree } = bareRemoteFixture();
    const unclassified = { commit, tree, version: 1, remote: bare, repoRoot: work, mode: "production" as const };
    // Source rejection precedes policy and network work: an otherwise valid
    // local caller cannot directly invoke the production writer.
    expect(publishAttestation(unclassified).status).toBe("refused-source");
    expect(git(["ls-remote", bare, `refs/testpass/1/${tree}`])).toBe("");
    const base = { ...unclassified, source: "github-ci" as const };
    // policyReader injection only works under the self-test seam; without it
    // the trusted reader is always used (asserted below).
    process.env.TV_TEST_RUNNER_SELFTEST = "1";
    expect(publishAttestation({ ...base, policyReader: () => ({ status: "disabled", version: 1 }) }).status).toBe("refused-policy");
    expect(publishAttestation({ ...base, policyReader: () => ({ status: "unavailable" }) }).status).toBe("refused-policy");
    expect(publishAttestation({ ...base, policyReader: () => ({ status: "enabled", version: 2 }) }).status).toBe("refused-policy");
    const allowed = publishAttestation({ ...base, policyReader: () => ({ status: "enabled", version: 1 }) });
    expect(allowed).toMatchObject({ status: "published", ref: `refs/testpass/1/${tree}` });
    const blaxelSource = publishAttestation({ ...base, source: "blaxel-verify", policyReader: () => ({ status: "enabled", version: 1 }) });
    expect(blaxelSource).toMatchObject({ status: "already-attested", ref: `refs/testpass/1/${tree}` });
    // outside the seam, injected readers are ignored: the real trusted read
    // runs against the fixture remote (no policy on its main) -> refused.
    delete process.env.TV_TEST_RUNNER_SELFTEST;
    const bypassAttempt = publishAttestation({ ...base, tree, commit, policyReader: () => ({ status: "enabled", version: 1 }) });
    expect(bypassAttempt.status).toBe("refused-policy");
  });

  test("tag and tree objects are refused pre-network", () => {
    const { work, bare, git, commit, tree } = bareRemoteFixture();
    git(["tag", "-a", "-m", "annotated", "probe-tag", commit]);
    const tagObject = git(["rev-parse", "probe-tag"]);
    expect(tagObject).not.toBe(commit);
    expect(publishAttestation({ commit: tagObject, tree, mode: "lab", version: 1, remote: bare, repoRoot: work }).status).toBe("refused-invalid");
    expect(publishAttestation({ commit: tree, tree, mode: "lab", version: 1, remote: bare, repoRoot: work }).status).toBe("refused-invalid");
    expect(git(["ls-remote", bare, `refs/testpass-lab/1/${tree}`])).toBe("");
  });

  test("second writer from another clone: sequential-conflict semantics", () => {
    const { work, bare, git, commit, tree } = bareRemoteFixture();
    expect(publishAttestation({ commit, tree, mode: "lab", version: 1, remote: bare, repoRoot: work }).status).toBe("published");
    // an independent clone with its own equivalent commit (same tree)
    const os2 = require("node:os");
    const clone = mkdtempSync(path.join(os2.tmpdir(), "tv-attest-clone-"));
    execFileSync("git", ["clone", "-q", bare, clone]);
    execFileSync("git", ["config", "user.email", "b@example.invalid"], { cwd: clone });
    execFileSync("git", ["config", "user.name", "b"], { cwd: clone });
    const other = execFileSync("git", ["commit-tree", `${commit}^{tree}`, "-p", commit, "-m", "other validator"], { cwd: clone, encoding: "utf8" }).trim();
    const outcome = publishAttestation({ commit: other, tree, mode: "lab", version: 1, remote: bare, repoRoot: clone });
    expect(outcome.status).toBe("already-attested");
    expect(git(["ls-remote", bare, `refs/testpass-lab/1/${tree}`])).toContain(commit);
  });

  test("unreachable remote is a non-throwing failure", () => {
    const { work, commit, tree } = bareRemoteFixture();
    const outcome = publishAttestation({ commit, tree, mode: "lab", version: 1, remote: "/nonexistent/nowhere.git", repoRoot: work });
    expect(outcome.status).toBe("failed");
  });

  test("maybePublishAttestation: ineligible never publishes; eligible publishes; failure is non-fatal", () => {
    const calls: unknown[] = [];
    const lines: string[] = [];
    const log = (message: string) => lines.push(message);
    const eligibleFacts = {
      treeAtStart: TREE, treeAtEnd: TREE, testedTree: TREE,
      cleanAtStart: true, cleanAtEnd: true, ignoreUncommitted: false,
      qualifyingRun: true,
      surfaces: [{ id: "unit:root", status: "passed" }],
      expectedSurfaceIds: ["unit:root"],
      shardSubset: false, targetedSelection: false,
      canonicalRetries: true, attestedSkipRun: false,
      policyAtStart: enabledPolicy(5), policyAtEnd: enabledPolicy(5),
    };

    const refused = maybePublishAttestation({
      facts: { ...eligibleFacts, cleanAtEnd: false }, commit: "c".repeat(40), mode: "lab",
      log, logError: log, publish: (args) => { calls.push(args); return { status: "published", ref: "x" }; },
    });
    expect(refused).toMatchObject({ published: false, reason: "ineligible" });
    expect(calls).toHaveLength(0);

    const localFullPass = maybePublishAttestation({
      facts: { ...eligibleFacts, qualifyingRun: false }, commit: "c".repeat(40), mode: "production",
      log, logError: log, publish: (args) => { calls.push(args); return { status: "published", ref: "x" }; },
    });
    expect(localFullPass).toMatchObject({ published: false, reason: "ineligible", failures: expect.arrayContaining(["qualifying-blaxel-run"]) });
    expect(calls).toHaveLength(0);

    const published = maybePublishAttestation({
      facts: eligibleFacts, commit: "c".repeat(40), mode: "lab",
      log, logError: log, publish: (args) => { calls.push(args); return { status: "published", ref: "refs/testpass-lab/5/x" }; },
    });
    expect(published).toMatchObject({ published: true, reason: "published" });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ version: 5, source: "blaxel-verify" });

    const failed = maybePublishAttestation({
      facts: eligibleFacts, commit: "c".repeat(40), mode: "lab",
      log, logError: log, publish: () => { throw new Error("network down"); },
    });
    expect(failed).toMatchObject({ published: false, reason: "failed" });
    expect(lines.some((line) => line.includes("non-fatal"))).toBe(true);
  });
});

describe("verify handoff facts", async () => {
  const { mkdtempSync, writeFileSync } = await import("node:fs");
  const os = await import("node:os");
  const path = await import("node:path");
  const { collectRunSurfaces, canonicalRetryFacts } = await import("../../scripts/test/attestation.mjs");

  test("surfaces come from results.json (the real reporting shape), not summary.json", () => {
    const runDir = mkdtempSync(path.join(os.tmpdir(), "tv-attest-rundir-"));
    // real results.json shape (trimmed from an actual run artifact)
    writeFileSync(path.join(runDir, "results.json"), JSON.stringify({
      schemaVersion: 1,
      run: { id: "x", status: "passed" },
      surfaces: [
        { id: "unit:root", runner: "vitest", status: "passed", counts: {} },
        { id: "e2e:desktop", runner: "playwright", status: "passed", counts: {} },
      ],
    }));
    // summary.json deliberately has NO surfaces key, as in real runs
    writeFileSync(path.join(runDir, "summary.json"), JSON.stringify({ schemaVersion: 1, run: { id: "x" }, failedSurfaces: [] }));
    expect(collectRunSurfaces(runDir)).toEqual([
      { id: "unit:root", status: "passed" },
      { id: "e2e:desktop", status: "passed" },
    ]);
  });

  test("canonical retries require the runner default AND the default flaky budget", () => {
    expect(canonicalRetryFacts({ retriesOption: undefined, env: {} })).toBe(true);
    expect(canonicalRetryFacts({ retriesOption: "2", env: { FLAKY_TEST_RETRIES: "5" } })).toBe(true);
    expect(canonicalRetryFacts({ retriesOption: "3", env: {} })).toBe(false);
    expect(canonicalRetryFacts({ retriesOption: "2", env: { FLAKY_TEST_RETRIES: "9" } })).toBe(false);
  });
});

// specs/arch/test-runner/attestation.md#prune-and-retention — the full safety
// matrix against local bare remotes with the trusted policy on the fixture
// remote's main. Every refusal is asserted with --apply set, and every
// deletion assertion re-reads the remote namespace.
describe("testpass prune", async () => {
  const { execFileSync, spawnSync } = await import("node:child_process");
  const { mkdtempSync, writeFileSync, mkdirSync } = await import("node:fs");
  const os = await import("node:os");
  const path = await import("node:path");
  const { pruneTestpassRefs } = await import("../../scripts/test/attestation.mjs");

  const NOW = 1_800_000_000;
  const CUTOFF = 30 * 24 * 60 * 60;

  function pruneFixture({ withPolicy = true, testpassVersion = 5 }: { withPolicy?: boolean; testpassVersion?: number } = {}) {
    const dir = mkdtempSync(path.join(os.tmpdir(), "tv-attest-prune-"));
    const work = path.join(dir, "work");
    mkdirSync(work);
    const git = (args: string[], env: Record<string, string> = {}) => execFileSync("git", args, { cwd: work, encoding: "utf8", env: { ...process.env, ...env } }).trim();
    git(["init", "-q", "-b", "main"]);
    git(["config", "user.email", "t@example.invalid"]);
    git(["config", "user.name", "t"]);
    if (withPolicy) {
      mkdirSync(path.join(work, "test"));
      writeFileSync(path.join(work, "test/testpass-policy.json"), JSON.stringify({ schemaVersion: 1, testpassRefsEnabled: true, testpassVersion }));
    }
    writeFileSync(path.join(work, "f.txt"), "base");
    git(["add", "-A"]); git(["commit", "-qm", "base"]);
    const bare = path.join(dir, "bare.git");
    execFileSync("git", ["clone", "-q", "--bare", work, bare], { encoding: "utf8" });
    git(["remote", "add", "origin", bare]);
    let seedCount = 0;
    // Seed a ref with a unique tree and a controlled committer time; a
    // malformed seed points the well-shaped name at a commit whose tree
    // differs from the name.
    const seed = ({ version, ageSeconds, namespace = "refs/testpass", malformed = false }: { version: number; ageSeconds: number; namespace?: string; malformed?: boolean }) => {
      seedCount += 1;
      writeFileSync(path.join(work, "f.txt"), `seed-${seedCount}`);
      const date = `${NOW - ageSeconds} +0000`;
      git(["add", "-A"]);
      git(["commit", "-qm", `seed-${seedCount}`], { GIT_COMMITTER_DATE: date, GIT_AUTHOR_DATE: date });
      const commit = git(["rev-parse", "HEAD"]);
      const tree = malformed ? "f".repeat(40) : git(["rev-parse", "HEAD^{tree}"]);
      const ref = `${namespace}/${version}/${tree}`;
      git(["push", "-q", bare, `${commit}:${ref}`]);
      return { ref, commit, tree };
    };
    const remoteRefs = () => git(["ls-remote", bare, "refs/testpass/*", "refs/testpass-lab/*"]).split("\n").filter(Boolean).map((line) => line.split(/\s+/)[1]).sort();
    const prune = (overrides: Record<string, unknown> = {}) => pruneTestpassRefs({ mode: "production", repoRoot: work, remote: bare, now: NOW, env: {}, ...overrides });
    return { dir, work, bare, git, seed, remoteRefs, prune };
  }

  test("unavailable or malformed trusted policy means zero deletions in every mode, even with apply", () => {
    for (const fixture of [pruneFixture({ withPolicy: false }), pruneFixture({ testpassVersion: 0 })]) {
      const seeded = fixture.seed({ version: 5, ageSeconds: CUTOFF * 4 });
      const before = fixture.remoteRefs();
      for (const request of [{ olderThanDays: 30 }, { deadVersion: 4 }, { deleteRef: seeded.ref }]) {
        const result = fixture.prune({ ...request, apply: true });
        expect(result.status).toBe("refused-policy");
        expect(result.deleted).toEqual([]);
      }
      expect(fixture.remoteRefs()).toEqual(before);
    }
  });

  test("age cutoff is exact: at-cutoff retained, strictly older deleted, dry-run default", () => {
    const fixture = pruneFixture();
    const atCutoff = fixture.seed({ version: 5, ageSeconds: CUTOFF });
    const older = fixture.seed({ version: 5, ageSeconds: CUTOFF + 1 });
    const younger = fixture.seed({ version: 5, ageSeconds: CUTOFF - 1 });
    const dryRun = fixture.prune({ olderThanDays: 30 });
    expect(dryRun.status).toBe("ok");
    expect(dryRun.apply).toBe(false);
    expect(dryRun.candidates.map((entry) => entry.ref)).toEqual([older.ref]);
    expect(dryRun.deleted).toEqual([]);
    expect(fixture.remoteRefs()).toHaveLength(3);
    const applied = fixture.prune({ olderThanDays: 30, apply: true });
    expect(applied.deleted).toEqual([older.ref]);
    expect(fixture.remoteRefs().sort()).toEqual([atCutoff.ref, younger.ref].sort());
  });

  test("age mode stays within the current trusted version and never touches malformed refs", () => {
    const fixture = pruneFixture();
    const oldOtherVersion = fixture.seed({ version: 4, ageSeconds: CUTOFF * 4 });
    const oldCurrent = fixture.seed({ version: 5, ageSeconds: CUTOFF * 4 });
    const oldMalformed = fixture.seed({ version: 5, ageSeconds: CUTOFF * 4, malformed: true });
    const applied = fixture.prune({ olderThanDays: 30, apply: true });
    expect(applied.deleted).toEqual([oldCurrent.ref]);
    expect(fixture.remoteRefs().sort()).toEqual([oldOtherVersion.ref, oldMalformed.ref].sort());
  });

  test("dead-version refuses the current version and anything above, sweeps a strictly lower one whole", () => {
    const fixture = pruneFixture();
    const deadValid = fixture.seed({ version: 4, ageSeconds: 60 });
    const deadMalformed = fixture.seed({ version: 4, ageSeconds: 60, malformed: true });
    const live = fixture.seed({ version: 5, ageSeconds: 60 });
    for (const deadVersion of [5, 6]) {
      const refused = fixture.prune({ deadVersion, apply: true });
      expect(refused.status).toBe("refused");
      expect(refused.message).toContain("mass revocation");
      expect(refused.deleted).toEqual([]);
    }
    const dry = fixture.prune({ deadVersion: 4 });
    expect(dry.candidates).toHaveLength(2);
    expect(dry.deleted).toEqual([]);
    expect(fixture.remoteRefs()).toHaveLength(3);
    const swept = fixture.prune({ deadVersion: 4, apply: true });
    expect(swept.status).toBe("ok");
    expect(swept.deleted.sort()).toEqual([deadValid.ref, deadMalformed.ref].sort());
    expect(fixture.remoteRefs()).toEqual([live.ref]);
  });

  test("delete-ref rejects globs, non-version-qualified names, and refs outside the namespace; deletes exactly the named ref", () => {
    const fixture = pruneFixture();
    const keep = fixture.seed({ version: 5, ageSeconds: 60 });
    const target = fixture.seed({ version: 5, ageSeconds: 60, malformed: true });
    for (const bad of [
      "refs/testpass/5/*",
      `refs/testpass/${"a".repeat(40)}`,
      "refs/heads/main",
      `refs/testpass-lab/1/${"a".repeat(40)}`,
      `refs/testpass/0/${"a".repeat(40)}`,
    ]) {
      const refused = fixture.prune({ deleteRef: bad, apply: true });
      expect(refused.status, bad).toBe("refused");
      expect(refused.deleted).toEqual([]);
    }
    const missing = fixture.prune({ deleteRef: `refs/testpass/5/${"b".repeat(40)}`, apply: true });
    expect(missing.status).toBe("refused");
    expect(missing.message).toContain("not found");
    const dry = fixture.prune({ deleteRef: target.ref });
    expect(dry.candidates.map((entry) => entry.ref)).toEqual([target.ref]);
    expect(dry.deleted).toEqual([]);
    const applied = fixture.prune({ deleteRef: target.ref, apply: true });
    expect(applied.status).toBe("ok");
    expect(applied.deleted).toEqual([target.ref]);
    expect(fixture.remoteRefs()).toEqual([keep.ref]);
  });

  test("mid-batch deletion failure reports the ref, never reports success, and lists the rest as not deleted", () => {
    const fixture = pruneFixture();
    const seeds = [1, 2, 3].map(() => fixture.seed({ version: 5, ageSeconds: CUTOFF * 4 }));
    const ordered = seeds.map((entry) => entry.ref).sort();
    const failRef = ordered[1];
    const realGit = (args: string[], { cwd, allowFailure = false }: { cwd?: string; allowFailure?: boolean } = {}) => {
      const result = spawnSync("git", args, { cwd, encoding: "utf8" });
      if (!allowFailure && result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
      return result;
    };
    const failingGit = (args: string[], opts: { cwd?: string; allowFailure?: boolean } = {}) =>
      args.includes("--delete") && args.includes(failRef)
        ? { status: 1, stdout: "", stderr: "simulated transport failure" }
        : realGit(args, opts);
    const result = fixture.prune({ olderThanDays: 30, apply: true, git: failingGit });
    expect(result.status).toBe("failed");
    expect(result.deleted).toEqual([ordered[0]]);
    expect(result.failed).toEqual([{ ref: failRef, message: "simulated transport failure" }]);
    expect(result.notDeleted).toEqual([ordered[2]]);
    expect(fixture.remoteRefs().sort()).toEqual([ordered[1], ordered[2]].sort());
  });

  test("refs deleted on the remote never linger as phantom candidates: the fetch reconciles local with remote", () => {
    const fixture = pruneFixture();
    const phantom = fixture.seed({ version: 5, ageSeconds: CUTOFF * 4 });
    const survivor = fixture.seed({ version: 5, ageSeconds: CUTOFF * 4 });
    // Mirror both into the local namespace (a dry run fetches), then delete
    // one directly on the remote — the stale local copy must not resurface.
    const dryRun = fixture.prune({ olderThanDays: 30 });
    expect(dryRun.candidates.map((entry) => entry.ref).sort()).toEqual([phantom.ref, survivor.ref].sort());
    execFileSync("git", ["update-ref", "-d", phantom.ref], { cwd: fixture.bare, encoding: "utf8" });
    const applied = fixture.prune({ olderThanDays: 30, apply: true });
    expect(applied.status).toBe("ok");
    expect(applied.candidates.map((entry) => entry.ref)).toEqual([survivor.ref]);
    expect(applied.deleted).toEqual([survivor.ref]);
    expect(applied.failed).toEqual([]);
    expect(fixture.remoteRefs()).toEqual([]);
  });

  test("a failed local deletion after a successful remote deletion is a reported failure, never a silent success", () => {
    const fixture = pruneFixture();
    const seeds = [1, 2].map(() => fixture.seed({ version: 5, ageSeconds: CUTOFF * 4 }));
    const ordered = seeds.map((entry) => entry.ref).sort();
    const failRef = ordered[0];
    const realGit = (args: string[], { cwd, allowFailure = false }: { cwd?: string; allowFailure?: boolean } = {}) => {
      const result = spawnSync("git", args, { cwd, encoding: "utf8" });
      if (!allowFailure && result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
      return result;
    };
    const failingGit = (args: string[], opts: { cwd?: string; allowFailure?: boolean } = {}) =>
      args[0] === "update-ref" && args.includes(failRef)
        ? { status: 1, stdout: "", stderr: "simulated local ref lock" }
        : realGit(args, opts);
    const result = fixture.prune({ olderThanDays: 30, apply: true, git: failingGit });
    expect(result.status).toBe("failed");
    expect(result.deleted).toEqual([]);
    expect(result.failed).toEqual([{ ref: failRef, message: "remote ref deleted but local deletion failed: simulated local ref lock" }]);
    expect(result.notDeleted).toEqual([ordered[1]]);
    // The remote deletion had already happened; only the untouched ref remains.
    expect(fixture.remoteRefs()).toEqual([ordered[1]]);
  });

  test("lab mode prunes only the lab namespace under the synthetic version; a malformed lab version refuses", () => {
    const fixture = pruneFixture();
    const production = fixture.seed({ version: 2, ageSeconds: 60 });
    const lab = fixture.seed({ version: 2, ageSeconds: 60, namespace: "refs/testpass-lab" });
    const swept = fixture.prune({ mode: "lab", env: { TV_TESTPASS_LAB: "1", TV_TESTPASS_LAB_VERSION: "3" }, deadVersion: 2, apply: true });
    expect(swept.status).toBe("ok");
    expect(swept.deleted).toEqual([lab.ref]);
    expect(fixture.remoteRefs()).toContain(production.ref);
    // Strict canonical encoding: parseInt-tolerated shapes refuse too.
    for (const bad of ["banana", "1junk", "1.5", "01", "0"]) {
      const refused = fixture.prune({ mode: "lab", env: { TV_TESTPASS_LAB: "1", TV_TESTPASS_LAB_VERSION: bad }, olderThanDays: 30, apply: true });
      expect(refused.status).toBe("refused-policy");
      expect(refused.deleted).toEqual([]);
    }
  });

  test("rejects combined prune modes", () => {
    const fixture = pruneFixture();
    expect(() => fixture.prune({ deadVersion: 4, deleteRef: `refs/testpass/5/${"a".repeat(40)}` })).toThrow("choose one prune mode");
  });
});

// specs/arch/test-runner/attestation.md#skip-semantics-in-ci — the CI face:
// `decide` (attest-check) and `write` (attest-write) as real processes against
// a local bare remote whose main carries a trusted policy fixture. Production
// mode here crosses the actual boundary — no self-test seam involved.
describe("decision and writer CLI", async () => {
  const { execFileSync, spawnSync } = await import("node:child_process");
  const { mkdtempSync, writeFileSync, mkdirSync, readFileSync } = await import("node:fs");
  const os = await import("node:os");
  const path = await import("node:path");

  const cliPath = path.resolve("scripts/test/attestation.mjs");

  function cliFixture({ testpassRefsEnabled = true, testpassVersion = 5 } = {}) {
    const dir = mkdtempSync(path.join(os.tmpdir(), "tv-attest-cli-"));
    const work = path.join(dir, "work");
    mkdirSync(work);
    const git = (args: string[], cwd = work) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
    git(["init", "-q", "-b", "main"]);
    git(["config", "user.email", "t@example.invalid"]);
    git(["config", "user.name", "t"]);
    mkdirSync(path.join(work, "test"));
    writeFileSync(path.join(work, "test/testpass-policy.json"), JSON.stringify({ schemaVersion: 1, testpassRefsEnabled, testpassVersion }));
    writeFileSync(path.join(work, "f.txt"), "one");
    git(["add", "-A"]); git(["commit", "-qm", "one"]);
    const bare = path.join(dir, "bare.git");
    execFileSync("git", ["clone", "-q", "--bare", work, bare], { encoding: "utf8" });
    git(["remote", "add", "origin", bare]);
    const commit = git(["rev-parse", "HEAD"]);
    const tree = git(["rev-parse", "HEAD^{tree}"]);
    const outFile = path.join(dir, "github-output");
    writeFileSync(outFile, "");
    const run = (args: string[], env: Record<string, string | undefined> = {}) => spawnSync(process.execPath, [cliPath, ...args], {
      cwd: work,
      encoding: "utf8",
      timeout: 30_000,
      env: {
        ...process.env,
        TV_TESTPASS_LAB: undefined,
        TV_TESTPASS_LAB_VERSION: undefined,
        GITHUB_OUTPUT: outFile,
        ...(args[0] === "write" ? {
          GITHUB_ACTIONS: "true",
          GITHUB_WORKFLOW: "CI",
          GITHUB_JOB: "attest-write",
          TV_TEST_REF_PUBLICATION: "required",
        } : {}),
        ...env,
      },
    });
    const outputs = () => Object.fromEntries(readFileSync(outFile, "utf8").split("\n").filter(Boolean).map((line) => line.split(/=(.*)/s).slice(0, 2)));
    return { dir, work, bare, git, commit, tree, run, outputs };
  }

  test("decide: no attestation emits skip=false with tree and version outputs, exit 0", () => {
    const { run, outputs, tree } = cliFixture();
    const result = run(["decide"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("decision: skip=false (no attestation for tree)");
    expect(outputs()).toEqual({ skip: "false", tree, version: "5" });
  });

  test("decide: attested tree under the trusted version emits skip=true", () => {
    const { run, outputs, git, bare, commit, tree } = cliFixture();
    git(["push", "-q", bare, `${commit}:refs/testpass/5/${tree}`]);
    const result = run(["decide"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("age-window=[0,604800s] (committer-timestamp proxy)");
    expect(result.stdout).toContain("decision: skip=true");
    expect(outputs()).toEqual({ skip: "true", tree, version: "5" });
  });

  test("decide: unreachable lookup remote completes successfully with skip=false", () => {
    const { run, outputs } = cliFixture();
    const result = run(["decide", "--remote", "/nonexistent/attest-remote.git"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("decision: skip=false (lookup failed or origin unreachable)");
    expect(outputs().skip).toBe("false");
  });

  test("decide: disabled policy emits skip=false without a version output", () => {
    const { run, outputs } = cliFixture({ testpassRefsEnabled: false });
    const result = run(["decide"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("decision: skip=false (policy disabled)");
    expect(outputs().skip).toBe("false");
    expect(outputs().version).toBeUndefined();
  });

  test("decide: malformed ref (name/tree mismatch) and stale attestation both run tests", () => {
    const malformed = cliFixture();
    malformed.git(["commit", "-qm", "two", "--allow-empty"]);
    writeFileSync(path.join(malformed.work, "f.txt"), "two");
    malformed.git(["add", "-A"]); malformed.git(["commit", "-qm", "three"]);
    const otherCommit = malformed.git(["rev-parse", "HEAD"]);
    malformed.git(["push", "-q", malformed.bare, `${otherCommit}:refs/testpass/5/${malformed.tree}`]);
    malformed.git(["reset", "-q", "--hard", malformed.commit]);
    const collided = malformed.run(["decide"]);
    expect(collided.status).toBe(0);
    expect(collided.stdout).toContain("decision: skip=false (name/tree invariant failed)");

    const stale = cliFixture();
    const oldCommit = execFileSync("git", ["commit-tree", stale.tree, "-m", "old"], {
      cwd: stale.work,
      encoding: "utf8",
      env: { ...process.env, GIT_COMMITTER_DATE: "2020-01-01T00:00:00 +0000", GIT_AUTHOR_DATE: "2020-01-01T00:00:00 +0000" },
    }).trim();
    stale.git(["push", "-q", stale.bare, `${oldCommit}:refs/testpass/5/${stale.tree}`]);
    const staleResult = stale.run(["decide"]);
    expect(staleResult.status).toBe(0);
    expect(staleResult.stdout).toMatch(/decision: skip=false \(age \d+s outside/);
  });

  test("decide: lab mode looks up only the lab namespace under the lab version", () => {
    const { run, outputs, git, bare, commit, tree } = cliFixture();
    git(["push", "-q", bare, `${commit}:refs/testpass-lab/1/${tree}`]);
    const hit = run(["decide"], { TV_TESTPASS_LAB: "1", TV_TESTPASS_LAB_VERSION: "1" });
    expect(hit.status).toBe(0);
    expect(hit.stdout).toContain("mode=lab");
    expect(hit.stdout).toContain("decision: skip=true");
    expect(outputs()).toEqual({ skip: "true", tree, version: "1" });
    // a lab ref under another version is never honored: the lookup is by name.
    const miss = run(["decide"], { TV_TESTPASS_LAB: "1", TV_TESTPASS_LAB_VERSION: "2" });
    expect(miss.status).toBe(0);
    expect(miss.stdout).toContain("decision: skip=false (no attestation for tree)");
  });

  test("lab version encoding is strict: parseInt-tolerated shapes ('1junk', '1.5', '01', '0') deny decide and write", () => {
    const { run, git, bare, commit, tree } = cliFixture();
    // An attestation exists under the canonical version 1 — a lax parse of any
    // of these values to 1 would wrongly skip (decide) or publish (write).
    git(["push", "-q", bare, `${commit}:refs/testpass-lab/1/${tree}`]);
    for (const bad of ["1junk", "1.5", "01", "0"]) {
      const env = { TV_TESTPASS_LAB: "1", TV_TESTPASS_LAB_VERSION: bad };
      const decide = run(["decide"], env);
      expect(decide.status).toBe(0);
      expect(decide.stdout).toContain("decision: skip=false");
      expect(decide.stdout).toContain("lab version outside domain");
      const write = run(["write", "--captured-tree", tree, "--captured-version", "1"], env);
      expect(write.status).toBe(0);
      expect(write.stdout).toContain("not published (policy unavailable at completion");
    }
    // Only the seeded ref remains: nothing was published under a lax parse.
    const refs = git(["ls-remote", bare, "refs/testpass-lab/*"]).split("\n").filter(Boolean);
    expect(refs).toHaveLength(1);
  });

  test("write: the four refusal conditions are logged no-ops that publish nothing", () => {
    const enabled = cliFixture();
    // 1. missing attest-check outputs
    const missing = enabled.run(["write"]);
    expect(missing.status).toBe(0);
    expect(missing.stdout).toContain("not published (missing or malformed attest-check outputs)");
    // 2. disabled policy at completion
    const disabled = cliFixture({ testpassRefsEnabled: false });
    const disabledResult = disabled.run(["write", "--captured-tree", disabled.tree, "--captured-version", "5"]);
    expect(disabledResult.status).toBe(0);
    expect(disabledResult.stdout).toContain("not published (policy disabled at completion");
    // 3. version changed during the run
    const bumped = enabled.run(["write", "--captured-tree", enabled.tree, "--captured-version", "4"]);
    expect(bumped.status).toBe(0);
    expect(bumped.stdout).toContain("not published (version changed during the run (captured 4, trusted 5)");
    // 4. tree changed during the run
    const moved = enabled.run(["write", "--captured-tree", "b".repeat(40), "--captured-version", "5"]);
    expect(moved.status).toBe(0);
    expect(moved.stdout).toContain("not published (tree changed during the run");
    for (const fixture of [enabled, disabled]) {
      expect(fixture.git(["ls-remote", fixture.bare, "refs/testpass/*", "refs/testpass-lab/*"])).toBe("");
    }
  });

  test("write: local, non-CI, and read-only invocations cannot publish an attestation", () => {
    const { run, git, bare, tree } = cliFixture();
    const cases: Array<Record<string, string | undefined>> = [
      { GITHUB_ACTIONS: undefined, GITHUB_WORKFLOW: undefined, GITHUB_JOB: undefined, TV_TEST_REF_PUBLICATION: undefined },
      { GITHUB_ACTIONS: undefined },
      { GITHUB_WORKFLOW: "Another workflow" },
      { GITHUB_JOB: "test" },
      { TV_TEST_REF_PUBLICATION: "not-authorized" },
    ];
    for (const env of cases) {
      const refused = run(["write", "--captured-tree", tree, "--captured-version", "5"], env);
      expect(refused.status).toBe(0);
      expect(refused.stdout).toContain("not published (ineligible source: GitHub CI writer authorization missing)");
      expect(git(["ls-remote", bare, `refs/testpass/5/${tree}`])).toBe("");
    }
  });

  test("write: affirm path crosses the real GitHub CI production boundary and publishes", () => {
    const { run, git, bare, commit, tree } = cliFixture();
    const result = run(["write", "--captured-tree", tree, "--captured-version", "5"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('"status":"published"');
    expect(git(["ls-remote", bare, `refs/testpass/5/${tree}`])).toContain(commit);
    // idempotent completion: a re-run is already-attested, still exit 0.
    const again = run(["write", "--captured-tree", tree, "--captured-version", "5"]);
    expect(again.status).toBe(0);
    expect(again.stdout).toContain('"status":"already-attested"');
  });

  test("write: transport failure and malformed collision are loud non-zero exits", () => {
    const { run, git, bare, commit, tree, work } = cliFixture();
    const labEnv = { TV_TESTPASS_LAB: "1", TV_TESTPASS_LAB_VERSION: "1" };
    const failed = run(["write", "--captured-tree", tree, "--captured-version", "1", "--remote", "/nonexistent/attest-remote.git"], labEnv);
    expect(failed.status).toBe(1);
    expect(failed.stderr).toContain("[attest-write] failed");
    writeFileSync(path.join(work, "f.txt"), "two");
    git(["add", "-A"]); git(["commit", "-qm", "two"]);
    const otherCommit = git(["rev-parse", "HEAD"]);
    git(["push", "-q", bare, `${otherCommit}:refs/testpass-lab/1/${tree}`]);
    git(["reset", "-q", "--hard", commit]);
    const collided = run(["write", "--captured-tree", tree, "--captured-version", "1"], labEnv);
    expect(collided.status).toBe(1);
    expect(collided.stderr).toContain("[attest-write] malformed-collision");
  });
});

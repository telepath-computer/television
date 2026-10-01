// Tree-hash test attestation: decision logic, eligibility predicate, and
// policy/version reading (specs/arch/test-runner/attestation.md). Pure logic,
// ref transport, and pruning live together so they share one ref contract.
import { spawnSync } from "node:child_process";
import fsDefault from "node:fs";

export const PRODUCTION_TESTPASS_NAMESPACE = "refs/testpass";
export const LAB_TESTPASS_NAMESPACE = "refs/testpass-lab";
export const TESTPASS_MODES = ["production", "lab"];
export const MAX_ATTESTATION_AGE_SECONDS = 7 * 24 * 60 * 60;
export const MIN_TESTPASS_VERSION = 1;
export const MAX_TESTPASS_VERSION = 999_999_999;
export const TESTPASS_POLICY_PATH = "test/testpass-policy.json";
const POLICY_REF = "refs/heads/main";
const POLICY_KEYS = "schemaVersion,testpassRefsEnabled,testpassVersion";

/** Domain check layered above the trusted reader's schema validation. */
export function versionIsValid(version) {
  return Number.isInteger(version) && version >= MIN_TESTPASS_VERSION && version <= MAX_TESTPASS_VERSION;
}

/**
 * The trusted policy blob (spec: Activation policy): read from the exact
 * object origin's default branch names, never from the tested checkout, so a
 * work branch cannot activate itself. Any failure to resolve, fetch, read, or
 * validate the complete schema is "unavailable" — default-deny.
 */
export function readTrustedPolicy({ repoRoot = process.cwd(), remote = "origin" } = {}) {
  const unavailable = (message) => ({ status: "unavailable", message });
  const lookup = runGit(["ls-remote", remote, POLICY_REF], { cwd: repoRoot, allowFailure: true });
  if (lookup.status !== 0) return unavailable("origin is unavailable");
  const rows = lookup.stdout.trim().split("\n").filter(Boolean);
  if (rows.length !== 1) return unavailable("default branch could not be resolved");
  const objectId = rows[0].split(/\s+/)[0];
  if (!/^[a-f0-9]{40,64}$/.test(objectId)) return unavailable("default branch returned an invalid object ID");
  if (runGit(["cat-file", "-e", `${objectId}^{commit}`], { cwd: repoRoot, allowFailure: true }).status !== 0
    && runGit(["fetch", "--no-tags", remote, objectId], { cwd: repoRoot, allowFailure: true }).status !== 0) {
    return unavailable("default-branch object fetch failed");
  }
  const shown = runGit(["show", `${objectId}:${TESTPASS_POLICY_PATH}`], { cwd: repoRoot, allowFailure: true });
  if (shown.status !== 0) return unavailable("policy is missing from the default branch");
  let policy;
  try { policy = JSON.parse(shown.stdout); } catch { return unavailable("policy is malformed JSON"); }
  if (!policy || typeof policy !== "object" || Array.isArray(policy) || policy.schemaVersion !== 1 || typeof policy.testpassRefsEnabled !== "boolean" || !Number.isSafeInteger(policy.testpassVersion) || Object.keys(policy).sort().join(",") !== POLICY_KEYS) {
    return unavailable("policy has an unsupported shape");
  }
  return { status: "available", objectId, policy };
}

/**
 * Testpass view of the trusted origin/main policy blob. The trusted reader
 * validates the full schema; this derives testpass status and applies the
 * version domain. Every non-affirmative shape is "unavailable" or "disabled" —
 * default-deny.
 */
export function readTestpassPolicy({ repoRoot = process.cwd(), remote = "origin", policyReader = readTrustedPolicy } = {}) {
  let shared;
  try {
    shared = policyReader({ repoRoot, remote });
  } catch (error) {
    return { status: "unavailable", message: `policy reader threw: ${error.message}` };
  }
  if (!shared || shared.status === "unavailable") {
    return { status: "unavailable", message: shared?.message ?? "policy reader returned nothing" };
  }
  const { testpassRefsEnabled, testpassVersion } = shared.policy;
  if (!versionIsValid(testpassVersion)) {
    return { status: "unavailable", message: `testpassVersion outside domain [${MIN_TESTPASS_VERSION}, ${MAX_TESTPASS_VERSION}]: ${JSON.stringify(testpassVersion)}` };
  }
  return { status: testpassRefsEnabled === true ? "enabled" : "disabled", version: testpassVersion, objectId: shared.objectId };
}

const TREE_HASH_PATTERN = /^[0-9a-f]{40,64}$/;

/** TV_TESTPASS_LAB=1 explicitly selects lab mode; all other values select production. */
export function attestationModeFromEnv(env = process.env) {
  return env.TV_TESTPASS_LAB === "1" ? "lab" : "production";
}

/**
 * Policy for a mode: production reads the trusted origin/main blob; lab
 * replaces it with the synthetic lab version (never consulted by production
 * CI). Both apply the version domain — default-deny on any malformed shape.
 */
export function readAttestationPolicyForMode(mode, { env = process.env, repoRoot, remote } = {}) {
  if (mode === "lab") {
    // Strict canonical encoding: digits only, no leading zeros — parseInt
    // would accept "1junk"/"1.5"/"01" as version 1, breaking default-deny.
    const raw = env.TV_TESTPASS_LAB_VERSION ?? "1";
    const version = /^[1-9][0-9]*$/.test(raw) ? Number.parseInt(raw, 10) : Number.NaN;
    if (!versionIsValid(version)) return { status: "unavailable", message: `lab version outside domain: ${JSON.stringify(env.TV_TESTPASS_LAB_VERSION)}` };
    return { status: "enabled", version };
  }
  try {
    return readTestpassPolicy({ ...(repoRoot ? { repoRoot } : {}), ...(remote ? { remote } : {}) });
  } catch (error) {
    return { status: "unavailable", message: error.message };
  }
}

/** Canonical ref encoding; the mode is a closed enum — no namespace strings. */
export function attestationRef(mode, version, tree) {
  if (!TESTPASS_MODES.includes(mode)) throw new Error(`mode must be one of ${TESTPASS_MODES.join("|")}; received ${JSON.stringify(mode)}`);
  if (!versionIsValid(version)) throw new Error(`version outside domain: ${JSON.stringify(version)}`);
  if (typeof tree !== "string" || !TREE_HASH_PATTERN.test(tree)) throw new Error(`tree must be a lowercase hex object id; received ${JSON.stringify(tree)}`);
  const namespace = mode === "production" ? PRODUCTION_TESTPASS_NAMESPACE : LAB_TESTPASS_NAMESPACE;
  return `${namespace}/${version}/${tree}`;
}

/** Age from the committer-timestamp proxy; null means unreadable (no-skip). */
export function computeAgeSeconds({ committerTime, now }) {
  if (!Number.isInteger(committerTime) || !Number.isInteger(now)) return null;
  return now - committerTime;
}

/** Inclusive two-sided window: 0 <= age <= 7d; null rejects. */
export function ageWithinWindow(ageSeconds) {
  return ageSeconds !== null && ageSeconds >= 0 && ageSeconds <= MAX_ATTESTATION_AGE_SECONDS;
}

/**
 * The skip decision over gathered facts. Pure: transport happens elsewhere
 * and feeds facts in. Affirms only when every check affirms; every negation
 * names its reason (the auditable decision log line).
 */
export function decideSkip(facts) {
  const {
    policy,          // result of readTestpassPolicy
    tree,            // the tree under decision
    refFound,        // boolean: ls-remote found the ref for (policy.version, tree)
    refVersion,      // version segment of the found ref's name
    refObjectType,   // "commit" | anything else | undefined
    refTree,         // tree of the fetched ref object
    committerTime,   // unix seconds | undefined
    now,             // unix seconds
  } = facts;
  const noSkip = (reason) => ({ skip: false, reason });
  if (!policy || policy.status === "unavailable") return noSkip(`policy unavailable: ${policy?.message ?? "no policy"}`);
  if (policy.status !== "enabled") return noSkip("policy disabled");
  if (!versionIsValid(policy.version)) return noSkip(`policy version invalid: ${JSON.stringify(policy.version)}`);
  if (typeof tree !== "string" || !TREE_HASH_PATTERN.test(tree)) return noSkip("tree hash unreadable");
  if (refFound !== true) return noSkip("no attestation for tree");
  if (refVersion !== policy.version) return noSkip(`ref version ${JSON.stringify(refVersion)} does not match policy version ${policy.version}`);
  if (refObjectType !== "commit") return noSkip("object not a commit");
  if (refTree !== tree) return noSkip("name/tree invariant failed");
  const age = computeAgeSeconds({ committerTime, now });
  if (!ageWithinWindow(age)) return noSkip(age === null ? "committer time unreadable" : `age ${age}s outside [0, ${MAX_ATTESTATION_AGE_SECONDS}s]`);
  return { skip: true, version: policy.version, tree, ageSeconds: age };
}

export const ELIGIBILITY_CLAUSES = [
  "qualifying-blaxel-run",
  "one-tree-everywhere",
  "clean-and-unchanged-bracketed",
  "complete-scope",
  "canonical-retries",
  "not-attested-skipped",
  "policy-version-bracket",
];

/**
 * The writer's eligibility predicate (spec: Who writes, and when). Facts in,
 * verdict out; every clause independent; failures name their clause.
 */
export function evaluateEligibility(facts) {
  const failures = [];
  const {
    treeAtStart, treeAtEnd, testedTree,
    cleanAtStart, cleanAtEnd, ignoreUncommitted,
    qualifyingRun,
    surfaces,                  // [{id, status: "passed"|"failed"|"skipped"|...}]
    expectedSurfaceIds,        // gate scope
    shardSubset, targetedSelection,
    canonicalRetries,
    attestedSkipRun,
    policyAtStart, policyAtEnd, // readTestpassPolicy results
  } = facts;

  if (qualifyingRun !== true) failures.push("qualifying-blaxel-run");

  if (typeof treeAtStart !== "string" || treeAtStart !== testedTree) failures.push("one-tree-everywhere");

  if (cleanAtStart !== true || cleanAtEnd !== true || treeAtEnd !== treeAtStart || ignoreUncommitted === true) {
    failures.push("clean-and-unchanged-bracketed");
  }

  const byId = new Map((surfaces ?? []).map((surface) => [surface.id, surface.status]));
  const scopeComplete = Array.isArray(expectedSurfaceIds) && expectedSurfaceIds.length > 0
    && expectedSurfaceIds.every((id) => byId.get(id) === "passed");
  if (!scopeComplete || shardSubset === true || targetedSelection === true) failures.push("complete-scope");

  if (canonicalRetries !== true) failures.push("canonical-retries");

  if (attestedSkipRun === true) failures.push("not-attested-skipped");

  const bracketOk = policyAtStart?.status === "enabled" && policyAtEnd?.status === "enabled"
    && versionIsValid(policyAtStart.version) && policyAtStart.version === policyAtEnd.version;
  if (!bracketOk) failures.push("policy-version-bracket");

  return { eligible: failures.length === 0, failures };
}

// ---------------------------------------------------------------------------
// Writer (spec: Who writes, and when — create-only lease CAS). Creation and
// an identical re-push are the two benign successes. A lease rejection means
// the ref exists and points elsewhere, so the existing ref is validated before
// it can be treated as idempotent success.

function runGit(args, { cwd, allowFailure = false, timeoutMs } = {}) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", ...(timeoutMs ? { timeout: timeoutMs } : {}) });
  if (!allowFailure && result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr || result.stdout}`);
  }
  return result;
}

/**
 * Publish an attestation with create-only semantics. Returns a status object;
 * never throws for expected outcomes. "malformed-collision" is a loud
 * non-success the caller must log as an error (but publication failure never
 * fails the run that tried to publish).
 */
export function publishAttestation({ commit, tree, mode, version, source = null, remote = "origin", repoRoot = process.cwd(), git = runGit, policy = null, policyReader = null }) {
  // Production source and activation are enforced at this exported boundary,
  // not only by callers. Lab refs are experimental and never honored by CI.
  if (mode === "production") {
    if (source !== "blaxel-verify" && source !== "github-ci") {
      return { status: "refused-source", message: "production publication requires source blaxel-verify or github-ci" };
    }
    // Production mode requires the trusted policy to be enabled with the exact
    // version being written.

    // Policy injection is available only to self-tests. Without
    // TV_TEST_RUNNER_SELFTEST=1 the trusted origin/main reader is always used,
    // so no caller can hand
    // the boundary an arbitrary enabled policy.
    const selftest = process.env.TV_TEST_RUNNER_SELFTEST === "1";
    const effectiveReader = selftest && policyReader ? policyReader : readTestpassPolicy;
    const effective = (selftest && policy) ? policy : effectiveReader({ repoRoot, remote });
    if (!effective || effective.status !== "enabled") {
      return { status: "refused-policy", message: `production publication requires an enabled trusted policy (got ${effective?.status ?? "none"})` };
    }
    if (effective.version !== version) {
      return { status: "refused-policy", message: `production publication version ${version} does not match trusted version ${effective.version}` };
    }
  }
  const ref = attestationRef(mode, version, tree);
  // Never push a malformed attestation: the object must BE a commit (a tag
  // or tree can still resolve ^{tree}) and its tree must equal the named
  // tree — both verified locally before any network traffic.
  const objectType = git(["cat-file", "-t", commit], { cwd: repoRoot, allowFailure: true });
  if (objectType.status !== 0 || objectType.stdout.trim() !== "commit") {
    return { status: "refused-invalid", ref, message: `object ${commit} is not a commit (${objectType.stdout.trim() || "unreadable"})` };
  }
  const localTree = git(["rev-parse", `${commit}^{tree}`], { cwd: repoRoot, allowFailure: true });
  if (localTree.status !== 0 || localTree.stdout.trim() !== tree) {
    return { status: "refused-invalid", ref, message: `commit ${commit} does not carry tree ${tree}` };
  }
  const push = git(["push", `--force-with-lease=${ref}:`, remote, `${commit}:${ref}`], { cwd: repoRoot, allowFailure: true });
  const pushText = `${push.stdout}\n${push.stderr}`;
  if (push.status === 0) {
    const status = /up.to.date/i.test(pushText) ? "already-attested" : "published";
    return { status, ref };
  }
  const fetched = git(["fetch", remote, ref], { cwd: repoRoot, allowFailure: true });
  if (fetched.status !== 0) return { status: "failed", ref, message: `lease rejected and ref fetch failed: ${push.stderr}` };
  const type = git(["cat-file", "-t", "FETCH_HEAD"], { cwd: repoRoot, allowFailure: true });
  const existingTree = git(["rev-parse", "FETCH_HEAD^{tree}"], { cwd: repoRoot, allowFailure: true });
  if (type.status === 0 && type.stdout.trim() === "commit" && existingTree.status === 0 && existingTree.stdout.trim() === tree) {
    return { status: "already-attested", ref };
  }
  return { status: "malformed-collision", ref, message: `existing ref is not a valid attestation for ${tree}` };
}

/** Per-surface statuses from a run directory's results.json ([[reporting.md]]). */
export function collectRunSurfaces(runDir, { fs: fsModule } = {}) {
  const fsx = fsModule ?? fsDefault;
  const results = JSON.parse(fsx.readFileSync(`${runDir}/results.json`, "utf8"));
  return (results.surfaces ?? []).map((surface) => ({ id: surface.id, status: surface.status }));
}

/** Canonical retry facts: runner-level 2 and the default flaky budget. */
export function canonicalRetryFacts({ retriesOption, env = process.env } = {}) {
  return (retriesOption ?? "2") === "2" && (env.FLAKY_TEST_RETRIES ?? "5") === "5";
}

/**
 * The verify handoff: facts in (assembled by the orchestration), one logged
 * decision out. Eligibility gates publication; ineligibility and publish
 * failure are logged no-ops — never run failures. Lab mode can only construct
 * lab refs and replaces the trusted policy bracket with a synthetic lab
 * version.
 */
export function maybePublishAttestation({ facts, commit, mode, remote, repoRoot, log = console.log, logError = console.error, publish = publishAttestation }) {
  const verdict = evaluateEligibility(facts);
  if (!verdict.eligible) {
    log(`[attestation] not published (ineligible: ${verdict.failures.join(", ")})`);
    return { published: false, reason: "ineligible", failures: verdict.failures };
  }
  const version = facts.policyAtEnd.version;
  let outcome;
  try {
    outcome = publish({ commit, tree: facts.testedTree, mode, version, source: "blaxel-verify", remote, repoRoot });
  } catch (error) {
    outcome = { status: "failed", message: error.message };
  }
  if (outcome.status === "published" || outcome.status === "already-attested") {
    log(`[attestation] ${outcome.status}: ${outcome.ref}`);
    return { published: outcome.status === "published", reason: outcome.status, ref: outcome.ref };
  }
  if (outcome.status === "malformed-collision") logError(`[attestation] ERROR ${outcome.message} (${outcome.ref}) — left for exact-ref prune`);
  else if (outcome.status === "refused-source" || outcome.status === "refused-policy" || outcome.status === "refused-invalid") log(`[attestation] not published (${outcome.status}: ${outcome.message})`);
  else logError(`[attestation] publish failed (non-fatal): ${outcome.message ?? outcome.status}`);
  return { published: false, reason: outcome.status, ref: outcome.ref };
}

// ---------------------------------------------------------------------------
// Prune (spec: Prune and retention): explicit namespace fetch (custom
// namespaces are not fetched by branch refspecs), dry-run by default, apply
// deletes on origin and locally.
// Safety semantics, all modes: an unavailable or malformed trusted policy
// read means ZERO deletions; the age cutoff is exact (at-cutoff retained);
// dead-version refuses the current version and anything above it; delete-ref is
// exact, version-qualified, and inside the mode's namespace only; a partial
// deletion failure is reported per-ref with the remaining candidates listed
// as not deleted — never silently reported as success.

function testpassNamespace(mode) {
  if (!TESTPASS_MODES.includes(mode)) throw new Error(`mode must be one of ${TESTPASS_MODES.join("|")}; received ${JSON.stringify(mode)}`);
  return mode === "production" ? PRODUCTION_TESTPASS_NAMESPACE : LAB_TESTPASS_NAMESPACE;
}

/**
 * Fetch and describe every ref in the mode's namespace. Each entry carries
 * the parsed name (version, tree) and the validated object facts; `valid` means
 * the full name↔object invariant holds (name well-shaped, object a commit,
 * commit tree equal to the named tree).
 */
export function listTestpassRefs({ mode, repoRoot = process.cwd(), remote = "origin", git = runGit, fetch = true } = {}) {
  const namespace = testpassNamespace(mode);
  if (fetch) {
    // --prune reconciles the local namespace with the remote: refs deleted
    // remotely must not linger locally as phantom prune candidates (a
    // push --delete on one aborts the batch before real candidates run).
    const fetched = git(["fetch", "--no-tags", "--prune", remote, `+${namespace}/*:${namespace}/*`], { cwd: repoRoot, allowFailure: true });
    if (fetched.status !== 0 && !/couldn.t find remote ref|no such ref/i.test(`${fetched.stderr}\n${fetched.stdout}`)) {
      throw new Error("testpass ref fetch failed");
    }
  }
  const listed = git(["for-each-ref", "--format=%(refname) %(objectname)", namespace], { cwd: repoRoot }).stdout.trim().split("\n").filter(Boolean);
  return listed.map((line) => {
    const [ref, objectId] = line.split(" ");
    const segments = ref.slice(namespace.length + 1).split("/");
    const version = segments.length === 2 && /^[1-9][0-9]*$/.test(segments[0]) ? Number.parseInt(segments[0], 10) : null;
    const treeName = segments.length === 2 && TREE_HASH_PATTERN.test(segments[1]) ? segments[1] : null;
    const objectType = git(["cat-file", "-t", objectId], { cwd: repoRoot, allowFailure: true }).stdout?.trim() ?? null;
    const actualTree = git(["rev-parse", `${objectId}^{tree}`], { cwd: repoRoot, allowFailure: true }).stdout?.trim() || null;
    const committerRaw = git(["show", "-s", "--format=%ct", objectId], { cwd: repoRoot, allowFailure: true }).stdout?.trim() ?? "";
    const committerTime = /^\d+$/.test(committerRaw) ? Number.parseInt(committerRaw, 10) : null;
    const nameOk = version !== null && versionIsValid(version) && treeName !== null;
    const valid = nameOk && objectType === "commit" && actualTree === treeName;
    return { ref, objectId, version, treeName, objectType, actualTree, committerTime, valid };
  }).sort((left, right) => left.ref.localeCompare(right.ref));
}

function deleteTestpassRefs({ repoRoot, remote, git, candidates }) {
  const deleted = [];
  const failed = [];
  const notDeleted = [];
  for (const candidate of candidates) {
    if (failed.length > 0) {
      notDeleted.push(candidate.ref);
      continue;
    }
    const push = git(["push", remote, "--delete", candidate.ref], { cwd: repoRoot, allowFailure: true });
    if (push.status !== 0) {
      failed.push({ ref: candidate.ref, message: (push.stderr || push.stdout || "delete failed").trim() });
      continue;
    }
    const local = git(["update-ref", "-d", candidate.ref], { cwd: repoRoot, allowFailure: true });
    if (local.status !== 0) {
      // The remote deletion above succeeded, so this is a partial failure:
      // report it (non-zero at the caller) rather than recording "deleted".
      failed.push({ ref: candidate.ref, message: `remote ref deleted but local deletion failed: ${(local.stderr || local.stdout || "update-ref failed").trim()}` });
      continue;
    }
    deleted.push(candidate.ref);
  }
  return { deleted, failed, notDeleted };
}

/**
 * The prune command. Exactly one mode per call: age-based (default,
 * `olderThanDays`), `deadVersion`, or `deleteRef`. Returns a status object;
 * "refused-*" statuses and any `failed` entry mean the caller must exit
 * non-zero without reporting success.
 */
export function pruneTestpassRefs({ mode = "production", repoRoot = process.cwd(), remote = "origin", olderThanDays = 30, deadVersion = null, deleteRef = null, apply = false, now = Math.floor(Date.now() / 1000), git = runGit, env = process.env, fetch = true } = {}) {
  const namespace = testpassNamespace(mode);
  if (deadVersion !== null && deleteRef !== null) throw new Error("choose one prune mode: --older-than, --dead-version, or --delete-ref");
  // Trusted policy first — unavailable or malformed means zero deletions in
  // every mode, dry-run or apply. A disabled-but-well-formed policy still
  // carries the current version and prune remains available (the bump
  // procedure prunes a dead version around the disable window).
  const policy = readAttestationPolicyForMode(mode, { env, repoRoot, remote });
  if (policy.status === "unavailable" || !versionIsValid(policy.version)) {
    return { status: "refused-policy", mode: pruneMode(deadVersion, deleteRef), apply, message: `trusted policy unavailable: ${policy.message ?? "unreadable"}`, candidates: [], deleted: [], failed: [], notDeleted: [] };
  }

  if (deleteRef !== null) {
    if (/[*?\[\]]/.test(deleteRef)) return refuse("delete-ref rejects globs: one exact ref required");
    const match = new RegExp(`^${namespace.replaceAll("/", "\\/")}\\/([1-9][0-9]*)\\/([0-9a-f]{40,64})$`).exec(deleteRef);
    if (!match || !versionIsValid(Number.parseInt(match[1], 10))) {
      return refuse(`delete-ref requires an exact version-qualified ref under ${namespace}/ (refs outside the namespace and non-version-qualified names are rejected)`);
    }
    const refs = listTestpassRefs({ mode, repoRoot, remote, git, fetch });
    const candidate = refs.find((entry) => entry.ref === deleteRef);
    if (!candidate) return refuse(`ref not found: ${deleteRef}`);
    return finish("delete-ref", [candidate]);
  }

  if (deadVersion !== null) {
    if (!Number.isInteger(deadVersion) || deadVersion < MIN_TESTPASS_VERSION) return refuse(`dead-version must be an integer >= ${MIN_TESTPASS_VERSION}`);
    if (deadVersion >= policy.version) {
      return refuse(`dead-version ${deadVersion} is not below the current trusted version ${policy.version}; sweeping the live (or a future) version is mass revocation — use the policy disable or exact-ref deletion`);
    }
    const refs = listTestpassRefs({ mode, repoRoot, remote, git, fetch });
    return finish("dead-version", refs.filter((entry) => entry.ref.startsWith(`${namespace}/${deadVersion}/`)));
  }

  if (!Number.isSafeInteger(olderThanDays) || olderThanDays < 1) throw new Error("older-than days must be a positive integer");
  const cutoffSeconds = olderThanDays * 24 * 60 * 60;
  const refs = listTestpassRefs({ mode, repoRoot, remote, git, fetch });
  // Age mode operates within the current trusted version, deletes only refs
  // strictly older than the cutoff (at-cutoff retained), and never touches
  // malformed refs or refs whose age cannot be computed — those are for the
  // exact-ref path.
  const candidates = refs.filter((entry) => entry.valid && entry.version === policy.version && entry.committerTime !== null && (now - entry.committerTime) > cutoffSeconds);
  return finish("age", candidates);

  function pruneMode(dead, exact) { return exact !== null ? "delete-ref" : dead !== null ? "dead-version" : "age"; }
  function refuse(message) {
    return { status: "refused", mode: pruneMode(deadVersion, deleteRef), apply, message, candidates: [], deleted: [], failed: [], notDeleted: [] };
  }
  function finish(selectedMode, candidates) {
    if (!apply || candidates.length === 0) {
      return { status: "ok", mode: selectedMode, apply, version: policy.version, candidates, deleted: [], failed: [], notDeleted: [] };
    }
    const outcome = deleteTestpassRefs({ repoRoot, remote, git, candidates });
    return { status: outcome.failed.length > 0 ? "failed" : "ok", mode: selectedMode, apply, version: policy.version, candidates, ...outcome };
  }
}

// ---------------------------------------------------------------------------
// CLI. `decide` is the CI decision job (attest-check): every expected error
// completes successfully with skip=false — never skip on doubt; only a truly
// unexpected crash exits non-zero (the job is continue-on-error, so even that
// is non-gating). `write` is the CI writer (attest-write): the completion
// re-read with the spec's four refusal conditions, each a logged no-op.
// Publication mode comes from the explicit TV_TESTPASS_LAB=1 opt-in. The
// production workflow does not set it, and production publication still
// crosses the policy-gated library boundary. `write-lab` exercises the writer
// against the lab namespace; callers cannot supply a namespace directly.

import { fileURLToPath } from "node:url";
import path from "node:path";

function cliDecide(arg) {
  const remote = arg("remote", "origin");
  const mode = attestationModeFromEnv();
  const outputs = {};
  const finish = (decision) => {
    outputs.skip = String(decision.skip === true);
    const detail = decision.skip === true
      ? `version=${decision.version} age=${decision.ageSeconds}s`
      : decision.reason;
    console.log(`[attest-check] decision: skip=${outputs.skip} (${detail})`);
    if (process.env.GITHUB_OUTPUT) {
      fsDefault.appendFileSync(process.env.GITHUB_OUTPUT, Object.entries(outputs).map(([key, value]) => `${key}=${value}\n`).join(""));
    }
  };
  const tree = runGit(["rev-parse", "HEAD^{tree}"], { allowFailure: true }).stdout?.trim();
  if (!tree || !TREE_HASH_PATTERN.test(tree)) return finish({ skip: false, reason: "tree hash unreadable" });
  outputs.tree = tree;
  const policy = readAttestationPolicyForMode(mode);
  if (policy.status !== "enabled" || !versionIsValid(policy.version)) {
    return finish({ skip: false, reason: `policy ${policy.status}${policy.message ? `: ${policy.message}` : ""}` });
  }
  outputs.version = String(policy.version);
  const ref = attestationRef(mode, policy.version, tree);
  console.log(`[attest-check] mode=${mode} tree=${tree} version=${policy.version} ref=${ref} remote=${remote} age-window=[0,${MAX_ATTESTATION_AGE_SECONDS}s] (committer-timestamp proxy)`);
  const lookup = runGit(["ls-remote", remote, ref], { allowFailure: true, timeoutMs: 15_000 });
  if (lookup.status !== 0) return finish({ skip: false, reason: "lookup failed or origin unreachable" });
  if (!lookup.stdout.trim()) return finish({ skip: false, reason: "no attestation for tree" });
  console.log(`[attest-check] found: ${lookup.stdout.trim()}`);
  const fetched = runGit(["fetch", remote, ref], { allowFailure: true, timeoutMs: 60_000 });
  if (fetched.status !== 0) return finish({ skip: false, reason: "ref fetch failed" });
  const committerTimeRaw = runGit(["show", "-s", "--format=%ct", "FETCH_HEAD"], { allowFailure: true }).stdout?.trim();
  finish(decideSkip({
    policy,
    tree,
    refFound: true,
    refVersion: policy.version,
    refObjectType: runGit(["cat-file", "-t", "FETCH_HEAD"], { allowFailure: true }).stdout?.trim(),
    refTree: runGit(["rev-parse", "FETCH_HEAD^{tree}"], { allowFailure: true }).stdout?.trim(),
    committerTime: /^\d+$/.test(committerTimeRaw ?? "") ? Number.parseInt(committerTimeRaw, 10) : undefined,
    now: Math.floor(Date.now() / 1000),
  }));
}

function cliWrite(arg) {
  const remote = arg("remote", "origin");
  const mode = attestationModeFromEnv();
  const refuse = (reason) => {
    console.log(`[attest-write] not published (${reason})`);
    process.exit(0);
  };
  const githubCiWriter = process.env.GITHUB_ACTIONS === "true"
    && process.env.GITHUB_WORKFLOW === "CI"
    && process.env.GITHUB_JOB === "attest-write"
    && process.env.TV_TEST_REF_PUBLICATION === "required";
  if (!githubCiWriter) refuse("ineligible source: GitHub CI writer authorization missing");
  // The spec's four completion refusal conditions, in order: missing attest-check
  // outputs, disabled policy at completion, version changed mid-run, tree
  // changed mid-run. A run started under version N never publishes under N+1.
  const capturedTree = arg("captured-tree", "");
  const capturedVersionRaw = arg("captured-version", "");
  if (!TREE_HASH_PATTERN.test(capturedTree) || !/^\d+$/.test(capturedVersionRaw)) refuse("missing or malformed attest-check outputs");
  const capturedVersion = Number.parseInt(capturedVersionRaw, 10);
  const policy = readAttestationPolicyForMode(mode);
  if (policy.status !== "enabled" || !versionIsValid(policy.version)) refuse(`policy ${policy.status} at completion${policy.message ? `: ${policy.message}` : ""}`);
  if (policy.version !== capturedVersion) refuse(`version changed during the run (captured ${capturedVersion}, trusted ${policy.version})`);
  const headTree = runGit(["rev-parse", "HEAD^{tree}"], { allowFailure: true }).stdout?.trim();
  if (headTree !== capturedTree) refuse(`tree changed during the run (captured ${capturedTree}, HEAD ${headTree ?? "unreadable"})`);
  const commit = runGit(["rev-parse", "HEAD^{commit}"]).stdout.trim();
  const outcome = publishAttestation({ commit, tree: capturedTree, mode, version: policy.version, source: "github-ci", remote });
  console.log(JSON.stringify(outcome));
  if (outcome.status === "published" || outcome.status === "already-attested") return;
  if (outcome.status === "refused-source" || outcome.status === "refused-policy" || outcome.status === "refused-invalid") {
    console.log(`[attest-write] not published (${outcome.status}: ${outcome.message})`);
    return;
  }
  // Loud non-successes (transport failure, malformed collision): non-zero so
  // the job shows red, while the job's continue-on-error keeps the run green
  // — attestation is an optimization, never a gate.
  console.error(`[attest-write] ${outcome.status}: ${outcome.message ?? ""} (${outcome.ref ?? ""})`);
  process.exit(1);
}

function cliMain() {
  const [command, ...rest] = process.argv.slice(2);
  const arg = (name, fallback = null) => {
    const index = rest.indexOf(`--${name}`);
    return index >= 0 ? rest[index + 1] : fallback;
  };
  if (command === "decide") return cliDecide(arg);
  if (command === "write") return cliWrite(arg);
  if (command === "write-lab") {
    const commit = runGit(["rev-parse", `${arg("commit", "HEAD")}^{commit}`]).stdout.trim();
    const tree = runGit(["rev-parse", `${commit}^{tree}`]).stdout.trim();
    const version = Number.parseInt(arg("version", "1"), 10);
    const outcome = publishAttestation({ commit, tree, mode: "lab", version, remote: arg("remote", "origin") });
    console.log(JSON.stringify(outcome));
    if (outcome.status === "published" || outcome.status === "already-attested") return;
    process.exit(1);
  }
  console.error([
    "Usage: node scripts/test/attestation.mjs <command>",
    "  decide [--remote origin]                                # CI attest-check: emits skip/tree/version outputs; expected errors => skip=false",
    "  write --captured-tree <tree> --captured-version <n> [--remote origin]   # CI attest-write: completion re-read + policy-gated publish",
    "  write-lab [--commit HEAD] [--version 1] [--remote origin] # exercise writer against lab namespace",
  ].join("\n"));
  process.exit(2);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) cliMain();

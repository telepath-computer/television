import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { checkToolchain } from "../check-toolchain.mjs";
import { BLAXEL_GITHUB_TOKEN_ENV, BLAXEL_GITHUB_TOKEN_FILE, readBlaxelGithubToken } from "./blaxel-github-token.mjs";
import { runProcessLifecycleProbe } from "./process-lifecycle.mjs";
import { getElectronE2EPlan } from "../electron-e2e-env.mjs";

export const DAEMON_TEST_HOST_ENV = "TV_DAEMON_TEST_HOST";
export const POSTHOG_TEST_READ_KEY_ENV = "TV_POSTHOG_TEST_READ_KEY";
export const POSTHOG_TEST_READ_KEY_DOTENV_FILE = ".env";

export function requiredPreflights(surfaces, provider) {
  const checks = new Set(["node"]);
  if (provider === "local") {
    checks.add("process-lifecycle");
    for (const surface of surfaces) for (const check of surface.preflight ?? []) checks.add(check);
  }
  if (provider === "blaxel") {
    checks.add("blaxel-github-token");
    checks.add("blaxel-auth");
  }
  return [...checks];
}

export function runPreflights(checks, options) {
  const { provider } = options;
  const fake = fakeLocalPreflight(provider);
  if (fake) return fake;
  const results = [];
  for (const check of checks) {
    const result = runPreflight(check, options);
    results.push(result);
    if (result.status !== "passed") return results;
  }
  return results;
}

export function runProviderCapabilityPreflight(provider) {
  return runPreflights(requiredPreflights([], provider), { provider });
}

export function runRemotePreflight(provider, options = {}, { allowPassingSelftest = false } = {}) {
  const fake = fakeRemotePreflight(provider, allowPassingSelftest);
  if (fake) return fake;

  const results = runProviderCapabilityPreflight(provider);
  if (results.some((result) => result.status !== "passed")) return { provider, results, git: null };

  const gitResult = runRemoteGitPreflight(options, provider);
  results.push(...gitResult.results);
  return { provider, results, git: gitResult.git };
}

function fakeLocalPreflight(provider) {
  const value = process.env.TV_TEST_RUNNER_FAKE_LOCAL_PREFLIGHT;
  if (!value || provider !== "local") return null;
  if (process.env.TV_TEST_RUNNER_SELFTEST !== "1") throw new Error("TV_TEST_RUNNER_FAKE_LOCAL_PREFLIGHT is a test-runner self-test seam and requires TV_TEST_RUNNER_SELFTEST=1.");
  console.error("WARNING: TV_TEST_RUNNER_FAKE_LOCAL_PREFLIGHT self-test seam is active; this invocation is not a real local preflight.");
  const [name, ...messageParts] = value.split(":");
  return [failedCheck(name || "fake", provider, messageParts.join(":") || "fake local preflight failed")];
}

function fakeRemotePreflight(provider, allowPassingSelftest) {
  const value = process.env.TV_TEST_RUNNER_FAKE_REMOTE_PREFLIGHT;
  if (!value) return null;
  if (process.env.TV_TEST_RUNNER_SELFTEST !== "1") throw new Error("TV_TEST_RUNNER_FAKE_REMOTE_PREFLIGHT is a test-runner self-test seam and requires TV_TEST_RUNNER_SELFTEST=1.");
  console.error("WARNING: TV_TEST_RUNNER_FAKE_REMOTE_PREFLIGHT self-test seam is active; this invocation is not a real remote preflight.");
  const [wantedProvider, name, ...messageParts] = value.split(":");
  if (wantedProvider !== provider) return null;
  if (name === "passed") {
    if (!allowPassingSelftest) throw new Error("Passing remote preflight self-test results require verify --plan.");
    return { provider, results: [passedCheck("fake", provider)], git: null };
  }
  const message = messageParts.join(":") || "fake remote preflight failed";
  return { provider, results: [failedCheck(name || "fake", provider, message)], git: null };
}

function runPreflight(check, { provider, electron }) {
  const startedAt = new Date().toISOString();
  const started = Date.now();
  const ok = (details = {}) => ({ name: check, provider, status: "passed", startedAt, completedAt: new Date().toISOString(), durationMs: Date.now() - started, ...details });
  const failed = (message, details = {}) => ({ name: check, provider, status: "failed", message, startedAt, completedAt: new Date().toISOString(), durationMs: Date.now() - started, ...details });

  if (check === "node") {
    const toolchain = checkToolchain();
    const details = { version: toolchain.nodeVersion, npmVersion: toolchain.npmVersion };
    return toolchain.ok ? ok(details) : failed(toolchain.message, details);
  }
  if (check === "process-lifecycle") {
    try {
      return ok(runProcessLifecycleProbe());
    } catch (error) {
      return failed(error.message);
    }
  }
  if (check === "playwright-chromium") return nodeScript("scripts/check-playwright-chromium.mjs", ok, failed);
  if (check === "playwright-firefox") return nodeScript("scripts/check-playwright-firefox.mjs", ok, failed);
  if (check === "electron") {
    if (process.env.SKIP_ELECTRON_E2E === "1") return ok({ skipped: true, reason: "SKIP_ELECTRON_E2E=1" });
    const root = electron?.root ?? process.cwd();
    try {
      createRequire(path.join(root, "package.json")).resolve("electron/package.json");
    } catch (error) {
      return failed(`The Electron npm package is not installed: ${error.message}`);
    }
    const plan = electron?.plan ?? getElectronE2EPlan(process.env, { root });
    const details = {
      runtimeState: plan.runtime.state,
      platform: plan.platform,
      notes: plan.notes,
      failures: plan.failures,
    };
    if (plan.failures.length > 0 || plan.runtime.state === "invalid") {
      return failed("Electron e2e environment planning failed", details);
    }
    return ok(details);
  }
  if (check === "daemon-test-host") {
    if (process.env[DAEMON_TEST_HOST_ENV] !== "1") {
      return failed(
        `${DAEMON_TEST_HOST_ENV}=1 is required for the daemon acceptance suite. ` +
        "This suite installs or replaces the real tv binary and com.television.server user service. " +
        "Run it only on a designated developer host that is not intended to run a normal Television server.",
      );
    }
    return ok({ envVar: DAEMON_TEST_HOST_ENV });
  }
  if (check === "posthog-test-key") {
    try {
      const found = readPostHogTestReadKey();
      if (!found) return failed(`${POSTHOG_TEST_READ_KEY_ENV} is required for the telemetry PostHog roundtrip suite. Export it or add it to the gitignored repository-root ${POSTHOG_TEST_READ_KEY_DOTENV_FILE} file.`);
      if (!found.value.startsWith("phx_")) return failed(`${POSTHOG_TEST_READ_KEY_ENV} was found in ${found.source}, but it does not look like a PostHog read key (expected phx_ prefix).`);
      return ok({ source: found.source, envVar: POSTHOG_TEST_READ_KEY_ENV });
    } catch (error) {
      return failed(`Could not read ${POSTHOG_TEST_READ_KEY_DOTENV_FILE}: ${error.message}`);
    }
  }
  if (check === "blaxel-github-token") {
    try {
      return readBlaxelGithubToken() ? ok({ sources: [BLAXEL_GITHUB_TOKEN_FILE, BLAXEL_GITHUB_TOKEN_ENV] }) : failed(`${BLAXEL_GITHUB_TOKEN_FILE} or ${BLAXEL_GITHUB_TOKEN_ENV} is required so Blaxel sandboxes can fetch the repository`);
    } catch (error) {
      return failed(`Could not read ${BLAXEL_GITHUB_TOKEN_FILE}: ${error.message}`);
    }
  }
  if (check === "blaxel-auth") return nodeScript("scripts/check-blaxel-auth.mjs", ok, failed);
  return failed(`unknown preflight check ${check}`);
}

export function readPostHogTestReadKey({ env = process.env, root = process.cwd() } = {}) {
  const envValue = normalizeSecret(env[POSTHOG_TEST_READ_KEY_ENV]);
  if (envValue) return { value: envValue, source: POSTHOG_TEST_READ_KEY_ENV };

  const dotenvPath = path.join(root, POSTHOG_TEST_READ_KEY_DOTENV_FILE);
  let content;
  try {
    content = fs.readFileSync(dotenvPath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = /^(?<key>[A-Za-z_][A-Za-z0-9_]*)=(?<value>.*)$/.exec(trimmed);
    if (!match?.groups || match.groups.key !== POSTHOG_TEST_READ_KEY_ENV) continue;
    const dotenvValue = normalizeSecret(match.groups.value);
    if (dotenvValue) return { value: dotenvValue, source: POSTHOG_TEST_READ_KEY_DOTENV_FILE };
  }

  return null;
}

function normalizeSecret(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1).trim() || null;
  }
  return trimmed;
}

function runRemoteGitPreflight(options, provider) {
  const results = [];
  const status = spawnText("git", ["status", "--short"]).trim();
  if (status && !allowsUncommitted(options)) {
    results.push(failedCheck("working-tree", provider, "Working tree has uncommitted local changes. Remote tests run a committed revision from origin and will not include local edits. Commit or stash changes, or pass --ignore-uncommitted to acknowledge that local changes will be ignored.", { status }));
    return { results, git: null };
  }
  results.push(passedCheck("working-tree", provider, status ? { workingTreeDirty: true, message: "dirty tree allowed; remote tests will ignore local edits" } : { workingTreeDirty: false }));

  const target = options.commit ?? "HEAD";
  const revParse = spawnSync("git", ["rev-parse", "--verify", `${target}^{commit}`], { encoding: "utf8" });
  const commit = revParse.stdout.trim();
  if (revParse.status !== 0 || !commit) {
    results.push(failedCheck("commit-resolves", provider, `Could not resolve commit target ${target}.`, { stderr: revParse.stderr }));
    return { results, git: null };
  }
  results.push(passedCheck("commit-resolves", provider, { commit, target }));

  const fetch = spawnSync("git", ["fetch", "origin", "--prune"], { encoding: "utf8" });
  if (fetch.status !== 0) {
    results.push(failedCheck("origin-fetch", provider, "git fetch origin --prune failed", { stdout: fetch.stdout, stderr: fetch.stderr, exitCode: fetch.status }));
    return { results, git: null };
  }
  results.push(passedCheck("origin-fetch", provider));

  const branch = spawnSync("git", ["branch", "-r", "--contains", commit], { encoding: "utf8" });
  const containing = (branch.stdout ?? "").split("\n").map((line) => line.trim()).filter((line) => line.startsWith("origin/"));
  if (branch.status !== 0 || containing.length === 0) {
    results.push(failedCheck("origin-reachable", provider, `Commit ${commit} is not reachable from any origin/* ref. Push it before running remote tests.`, { stdout: branch.stdout, stderr: branch.stderr, commit }));
    return { results, git: null };
  }
  results.push(passedCheck("origin-reachable", provider, { containingRemotes: containing }));

  return { results, git: { commit, reachableFromOrigin: true, workingTreeDirty: Boolean(status), containingRemotes: containing } };
}

function allowsUncommitted(options) {
  return Boolean(options["ignore-uncommitted"]);
}

function passedCheck(name, provider, details = {}) {
  const now = new Date().toISOString();
  return { name, provider, status: "passed", startedAt: now, completedAt: now, durationMs: 0, ...details };
}

function failedCheck(name, provider, message, details = {}) {
  const now = new Date().toISOString();
  return { name, provider, status: "failed", message, startedAt: now, completedAt: now, durationMs: 0, ...details };
}

function nodeScript(script, ok, failed) {
  const result = spawnSync(process.execPath, [script], { encoding: "utf8", env: process.env });
  const skipReason = result.stdout.trim().match(/^SKIP: (?<reason>.+)$/)?.groups?.reason;
  return result.status === 0
    ? ok(skipReason ? { skipped: true, reason: skipReason } : {})
    : failed(`${script} failed`, { stdout: result.stdout, stderr: result.stderr, exitCode: result.status });
}

function command(cmd, args, ok, failed, { allowMissing = false } = {}) {
  const result = spawnSync(cmd, args, { encoding: "utf8", env: process.env });
  if (result.error && allowMissing) return ok({ skipped: true, reason: `${cmd} not found locally; provider-specific code may validate later` });
  if (result.error) return failed(result.error.message);
  return result.status === 0 ? ok() : failed(`${cmd} ${args.join(" ")} failed`, { stdout: result.stdout, stderr: result.stderr, exitCode: result.status });
}

function spawnText(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8" });
  return result.stdout ?? "";
}

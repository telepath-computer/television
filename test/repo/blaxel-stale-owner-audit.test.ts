import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { buildLinuxStaleOwnerAuditInvocation } from "../../scripts/test/blaxel-stale-owner-audit.mjs";

describe("Blaxel stale-owner audit", () => {
  test("constructs a strictly read-only Linux diagnostic", () => {
    const invocation = buildLinuxStaleOwnerAuditInvocation();
    expect(invocation.command).toBe("node");
    expect(invocation.args).toHaveLength(2);
    expect(invocation.args[0]).toBe("-e");

    const source = invocation.args[1];
    for (const forbidden of [
      "process.kill", "kill(", "writeFile", "appendFile", "unlink", "rmSync", "rmdir",
      "mkdir", "chmod", "chown", "rename", "truncate", "fuser", "pkill", "apt-get",
      "git ", "checkout", "reset --hard", "npm ci",
    ]) {
      expect(source, `diagnostic must not contain ${forbidden}`).not.toContain(forbidden);
    }

  });

  test("reconciles the shared system dependencies before auditing and before git, planning, checkout, cleanup, or shard execution", () => {
    const coordinator = path.join(process.cwd(), "scripts/run-blaxel-testshards.mjs");
    const rejected = spawnSync(process.execPath, [coordinator, "--audit-stale-owners", "--suite", "all"], { encoding: "utf8", timeout: 10_000 });
    expect(rejected.status).toBe(2);
    expect(rejected.stderr).toContain("--audit-stale-owners cannot be combined with: --suite");

    const source = readFileSync(coordinator, "utf8");
    const auditBranch = source.indexOf("if (auditStaleOwners)");
    expect(auditBranch).toBeGreaterThan(0);
    for (const later of [
      "readBlaxelGithubToken()",
      "git([\"status\", \"--short\"])",
      "git([\"fetch\", \"origin\", \"--prune\"]",
      "scripts/plan-test-shards.mjs",
      "runInfrastructureAttempts(",
    ]) {
      expect(source.indexOf(later), `${later} must follow the audit branch`).toBeGreaterThan(auditBranch);
    }
    expect(source).toContain("acquireAny(sandboxes, { shardIndex: 1, slot: 0, requestedWorkers: 1, verifyArchitecture: false })");
    const auditScript = source.slice(source.indexOf("const remoteScript = `${lease.input.scratch}/audit.sh`"), source.indexOf("const rawLogs =", source.indexOf("async function runStaleOwnerAudit")));
    expect(auditScript.indexOf("systemDependenciesCommand()")).toBeLessThan(auditScript.indexOf("[command, ...args]"));
    expect(auditScript).toContain('workerEntryCommand({ ...lease.input, processName }, remoteScript)');
    expect(source).toContain("run_step system-deps bash -lc ${shellQuote(systemDependenciesCommand())}");
    expect(source).toContain("apt-get install -y --no-install-recommends python3 xauth libgtk-3-0 libxtst6 iproute2");
    expect(source).not.toContain("psmisc");
    expect(source).not.toContain("fuser");
    expect(source).toContain("buildLinuxStaleOwnerAuditInvocation()");
    expect(source).toContain("stopAndReleaseLease(lease, { killProcess: false })");
  });
});

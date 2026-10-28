import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import {
  buildLinuxStaleOwnerAuditInvocation,
  parseLinuxStaleOwnerAuditOutput,
} from "../../scripts/test/blaxel-stale-owner-audit.mjs";

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

  test.runIf(process.platform === "linux")("executes a strictly read-only Linux diagnostic", () => {
    const invocation = buildLinuxStaleOwnerAuditInvocation();
    const executed = spawnSync(invocation.command, invocation.args, { encoding: "utf8", timeout: 10_000 });
    expect(executed.error).toBeUndefined();
    expect(executed.status, executed.stderr).toBe(0);
    const report = parseLinuxStaleOwnerAuditOutput(executed.stdout);
    expect(report).toMatchObject({ schemaVersion: 1, mode: "read-only", platform: "linux" });
    expect(report.capabilities.procfs.readable).toBe(true);
    expect(report.capabilities.ss.command).toEqual(["ss", "-H", "-ltnp"]);
    expect(report.processScan.visibleProcessCount).toBeGreaterThan(0);
    expect(report.owners.every((entry) => entry.supervisorStatus === "live" || entry.supervisorStatus === "stale")).toBe(true);
  });

  test.runIf(process.platform === "linux")("keeps procfs readable when a process vanishes during audit enumeration", () => {
    const invocation = buildLinuxStaleOwnerAuditInvocation();
    const source = `
      const fs = require("node:fs");
      const originalReaddirSync = fs.readdirSync;
      fs.readdirSync = (target, options) => {
        const entries = originalReaddirSync(target);
        if (target !== "/proc") return entries;
        if (options?.withFileTypes === true) {
          throw Object.assign(new Error("ENOENT: no such file or directory, lstat '/proc/999999999'"), { code: "ENOENT" });
        }
        return [...entries, "999999999"];
      };
      ${invocation.args[1]}
    `;

    const executed = spawnSync(invocation.command, ["-e", source], { encoding: "utf8", timeout: 10_000 });
    expect(executed.error).toBeUndefined();
    expect(executed.status, executed.stderr).toBe(0);
    const report = parseLinuxStaleOwnerAuditOutput(executed.stdout);
    expect(report.capabilities.procfs).toEqual({ readable: true, error: null });
    expect(report.processScan.status).toBe("ok");
    expect(report.processScan.visibleProcessCount).toBeGreaterThan(0);
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
    expect(source).toContain("const setup = await runSystemDependencySetup(lease)");
    expect(source).toContain("run_step system-deps bash -lc ${shellQuote(systemDependenciesCommand())}");
    expect(source).toContain("apt-get install -y --no-install-recommends python3 xauth libgtk-3-0 libxtst6 iproute2");
    expect(source).not.toContain("psmisc");
    expect(source).not.toContain("fuser");
    expect(source).toContain("buildLinuxStaleOwnerAuditInvocation()");
    expect(source).toContain("stopAndReleaseLease(lease, { killProcess: false })");
  });
});

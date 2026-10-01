/**
 * Build the only command permitted inside a stale-owner audit lease.
 * The embedded program reads procfs and invokes `ss -H -ltnp`; it does not
 * signal processes or mutate the sandbox filesystem.
 */
export function buildLinuxStaleOwnerAuditInvocation({ nodeCommand = "node" } = {}) {
  return {
    command: nodeCommand,
    args: ["-e", `(${linuxStaleOwnerAuditProgram.toString()})()`],
  };
}

export function parseLinuxStaleOwnerAuditOutput(output) {
  const lines = String(output).split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  let report;
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      report = JSON.parse(lines[index]);
      break;
    } catch {}
  }
  if (!report || report.schemaVersion !== 1 || report.mode !== "read-only" || report.platform !== "linux") {
    throw new Error(`stale-owner audit returned invalid output: ${String(output).trim()}`);
  }
  if (!report.capabilities?.procfs || !report.capabilities?.ss || !report.processScan || !Array.isArray(report.owners)) {
    throw new Error("stale-owner audit report is missing required capability or owner fields");
  }
  return report;
}

function linuxStaleOwnerAuditProgram() {
  const fs = require("node:fs");
  const path = require("node:path");
  const { spawnSync } = require("node:child_process");
  const ownerEnvironmentName = "TV_TEST_SURFACE_OWNER";

  function validText(value, maximum = 512) {
    return typeof value === "string" && value.length > 0 && value.length <= maximum && !value.includes("\0");
  }

  // Intentionally duplicated: this function is serialized into a standalone audit payload,
  // so it cannot import process-lifecycle.mjs. Keep both decoders aligned to avoid validation drift.
  function decodeOwnerToken(token) {
    if (typeof token !== "string" || token.length > 4096) return null;
    const match = /^tv1\.([A-Za-z0-9_-]+)$/.exec(token);
    if (!match) return null;
    try {
      const owner = JSON.parse(Buffer.from(match[1], "base64url").toString("utf8"));
      const valid = owner !== null && typeof owner === "object" &&
        validText(owner.runId) && validText(owner.surfaceId) &&
        Number.isSafeInteger(owner.supervisorPid) && owner.supervisorPid > 0 &&
        validText(owner.supervisorStartTime, 256) &&
        Object.keys(owner).sort().join(",") === "runId,supervisorPid,supervisorStartTime,surfaceId";
      return valid ? owner : null;
    } catch {
      return null;
    }
  }

  function parseIdentity(stat) {
    const open = stat.indexOf("(");
    const close = stat.lastIndexOf(")");
    if (open <= 0 || close <= open) throw new Error("malformed process stat");
    const pid = Number(stat.slice(0, open).trim());
    const fields = stat.slice(close + 1).trim().split(/\s+/);
    if (!Number.isSafeInteger(pid) || pid <= 0 || fields.length < 20) throw new Error("malformed process identity");
    return { pid, ppid: Number(fields[1]), pgid: Number(fields[2]), state: fields[0], startTime: fields[19] };
  }

  function readEnvironment(file) {
    const environment = {};
    for (const entry of fs.readFileSync(file).toString("utf8").split("\0")) {
      const separator = entry.indexOf("=");
      if (separator > 0) environment[entry.slice(0, separator)] = entry.slice(separator + 1);
    }
    return environment;
  }

  function readProcess(pid) {
    const root = path.join("/proc", String(pid));
    const identity = parseIdentity(fs.readFileSync(path.join(root, "stat"), "utf8"));
    const environment = readEnvironment(path.join(root, "environ"));
    const command = fs.readFileSync(path.join(root, "cmdline")).toString("utf8").split("\0").filter(Boolean).join(" ");
    let executable = command.split(/\s+/, 1)[0] || `[pid ${pid}]`;
    try { executable = fs.readlinkSync(path.join(root, "exe")); } catch {}
    return { ...identity, executable, command: command || executable, ownerToken: environment[ownerEnvironmentName] };
  }

  const report = {
    schemaVersion: 1,
    mode: "read-only",
    platform: process.platform,
    arch: process.arch,
    capabilities: {
      procfs: { readable: false, error: null },
      ss: { command: ["ss", "-H", "-ltnp"], available: false, usable: false, exitCode: null, error: null },
    },
    processScan: { status: "unreadable", visibleProcessCount: 0, inaccessibleProcessCount: 0, validOwnerProcessCount: 0 },
    owners: [],
  };

  const processes = [];
  try {
    fs.readFileSync(`/proc/${process.pid}/stat`, "utf8");
    fs.readFileSync(`/proc/${process.pid}/environ`);
    const entries = fs.readdirSync("/proc");
    report.capabilities.procfs.readable = true;
    for (const entry of entries) {
      if (!/^\d+$/.test(entry)) continue;
      try {
        processes.push(readProcess(Number(entry)));
      } catch (error) {
        if (["ENOENT", "ESRCH"].includes(error?.code)) continue;
        if (["EACCES", "EPERM"].includes(error?.code)) {
          report.processScan.inaccessibleProcessCount += 1;
          continue;
        }
        throw error;
      }
    }
    report.processScan.status = "ok";
    report.processScan.visibleProcessCount = processes.length;
  } catch (error) {
    report.capabilities.procfs.error = error?.message || String(error);
  }

  const byPid = new Map(processes.map((entry) => [entry.pid, entry]));
  for (const processEntry of processes) {
    const owner = decodeOwnerToken(processEntry.ownerToken);
    if (!owner) continue;
    const supervisor = byPid.get(owner.supervisorPid);
    report.owners.push({
      token: processEntry.ownerToken,
      owner,
      process: {
        pid: processEntry.pid,
        ppid: processEntry.ppid,
        pgid: processEntry.pgid,
        state: processEntry.state,
        startTime: processEntry.startTime,
        executable: processEntry.executable,
        command: processEntry.command,
      },
      supervisorStatus: supervisor && String(supervisor.startTime) === owner.supervisorStartTime ? "live" : "stale",
      supervisor: supervisor ? { pid: supervisor.pid, startTime: supervisor.startTime } : null,
    });
  }
  report.owners.sort((left, right) => left.process.pid - right.process.pid);
  report.processScan.validOwnerProcessCount = report.owners.length;

  const ss = spawnSync("ss", ["-H", "-ltnp"], { encoding: "utf8", timeout: 10_000 });
  report.capabilities.ss.available = !ss.error || ss.error.code !== "ENOENT";
  report.capabilities.ss.exitCode = ss.status;
  report.capabilities.ss.usable = !ss.error && ss.status === 0;
  if (ss.error) report.capabilities.ss.error = ss.error.message;
  else if (ss.status !== 0) report.capabilities.ss.error = String(ss.stderr || `exit ${ss.status}`).trim();

  process.stdout.write(`${JSON.stringify(report)}\n`);
}

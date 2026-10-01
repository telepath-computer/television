import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const OWNER_TOKEN_ENV = "TV_TEST_SURFACE_OWNER";
export const OWNER_TOKEN_PREFIX = "tv1.";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_PROBE_SCRIPT = path.join(HERE, "process-lifecycle-probe.mjs");
let cachedLinuxClockTicks = null;

export function encodeOwnerToken(owner) {
  if (!validOwner(owner)) throw new TypeError("owner token fields are invalid");
  return `${OWNER_TOKEN_PREFIX}${Buffer.from(JSON.stringify(owner), "utf8").toString("base64url")}`;
}

export function decodeOwnerToken(token) {
  if (typeof token !== "string" || token.length > 4096) return null;
  const match = /^tv1\.([A-Za-z0-9_-]+)$/.exec(token);
  if (!match) return null;
  try {
    const owner = JSON.parse(Buffer.from(match[1], "base64url").toString("utf8"));
    if (!validOwner(owner)) return null;
    const keys = Object.keys(owner).toSorted();
    if (keys.join(",") !== "runId,supervisorPid,supervisorStartTime,surfaceId") return null;
    return owner;
  } catch {
    return null;
  }
}

function validOwner(owner) {
  return owner !== null && typeof owner === "object" &&
    validTokenText(owner.runId) && validTokenText(owner.surfaceId) &&
    Number.isSafeInteger(owner.supervisorPid) && owner.supervisorPid > 0 &&
    validTokenText(owner.supervisorStartTime, 256);
}

function validTokenText(value, maxLength = 512) {
  return typeof value === "string" && value.length > 0 && value.length <= maxLength && !value.includes("\0");
}

export function parseLinuxProcessStat(stat) {
  if (typeof stat !== "string") throw new TypeError("Linux process stat must be text");
  const open = stat.indexOf("(");
  const close = stat.lastIndexOf(")");
  if (open <= 0 || close <= open) throw new Error("Malformed Linux process stat: missing command field");
  const pid = parsePositiveInteger(stat.slice(0, open).trim(), "PID");
  const fields = stat.slice(close + 1).trim().split(/\s+/);
  if (fields.length < 20) throw new Error("Malformed Linux process stat: missing identity fields");
  return {
    pid,
    ppid: parseNonNegativeInteger(fields[1], "parent PID"),
    pgid: parseNonNegativeInteger(fields[2], "process group"),
    startTime: fields[19],
    state: fields[0],
  };
}

export function readLinuxProcess(pid, { procRoot = "/proc", bootTimeMs, clockTicksPerSecond } = {}) {
  const processDir = path.join(procRoot, String(pid));
  const identity = parseLinuxProcessStat(fs.readFileSync(path.join(processDir, "stat"), "utf8"));
  const commandParts = splitNullFields(fs.readFileSync(path.join(processDir, "cmdline")));
  const environment = parseNullEnvironment(fs.readFileSync(path.join(processDir, "environ")));
  const token = environment[OWNER_TOKEN_ENV];
  let executable = commandParts[0] || `[pid ${identity.pid}]`;
  try {
    executable = fs.readlinkSync(path.join(processDir, "exe"));
  } catch (error) {
    if (!["ENOENT", "ESRCH", "EACCES", "EPERM"].includes(error?.code)) throw error;
  }
  const resolvedBootTimeMs = bootTimeMs ?? readLinuxBootTimeMs(procRoot);
  const resolvedClockTicks = clockTicksPerSecond ?? readLinuxClockTicksPerSecond();
  return {
    ...identity,
    processStartedAt: new Date(resolvedBootTimeMs + (Number(identity.startTime) * 1_000 / resolvedClockTicks)).toISOString(),
    executable,
    command: commandParts.join(" ") || executable,
    ...(decodeOwnerToken(token) ? { ownerToken: token } : {}),
  };
}

export function scanLinuxProcesses({ procRoot = "/proc" } = {}) {
  let entries;
  try {
    entries = fs.readdirSync(procRoot);
  } catch (error) {
    const wrapped = new Error(`Cannot read Linux process table at ${procRoot}: ${error.message}`, { cause: error });
    if (typeof error?.code === "string") wrapped.code = error.code;
    throw wrapped;
  }
  const bootTimeMs = readLinuxBootTimeMs(procRoot);
  const clockTicksPerSecond = readLinuxClockTicksPerSecond();
  const processes = [];
  for (const entry of entries) {
    if (!/^\d+$/.test(entry)) continue;
    try {
      processes.push(readLinuxProcess(Number(entry), { procRoot, bootTimeMs, clockTicksPerSecond }));
    } catch (error) {
      if (["ENOENT", "ENOTDIR", "ESRCH", "EACCES", "EPERM"].includes(error?.code)) continue;
      throw error;
    }
  }
  return processes;
}

export function readLinuxBootTimeMs(procRoot = "/proc") {
  const match = /^btime\s+(\d+)$/m.exec(fs.readFileSync(path.join(procRoot, "stat"), "utf8"));
  if (!match) throw new Error(`Cannot read Linux boot time from ${path.join(procRoot, "stat")}`);
  return Number(match[1]) * 1_000;
}

export function readLinuxClockTicksPerSecond({ runCommand = spawnSync } = {}) {
  if (runCommand === spawnSync && cachedLinuxClockTicks !== null) return cachedLinuxClockTicks;
  const result = runCommand("getconf", ["CLK_TCK"], { encoding: "utf8" });
  const ticks = Number.parseInt(result?.stdout ?? "", 10);
  if (result?.error || result?.status !== 0 || !Number.isSafeInteger(ticks) || ticks < 1) {
    throw new Error(`Cannot read Linux CLK_TCK: ${result?.error?.message ?? result?.stderr ?? result?.status}`);
  }
  if (runCommand === spawnSync) cachedLinuxClockTicks = ticks;
  return ticks;
}

export function parseSSListeners(output) {
  const listeners = [];
  for (const line of String(output).split(/\r?\n/)) {
    if (!line.trim()) continue;
    const columns = /^\S+\s+\d+\s+\d+\s+(\S+)\s+\S+\s*(.*)$/.exec(line.trim());
    if (!columns) continue;
    const endpoint = parseEndpoint(columns[1]);
    if (!endpoint) continue;
    const processPattern = /"([^"]+)",pid=(\d+),fd=\d+/g;
    for (const match of columns[2].matchAll(processPattern)) {
      listeners.push({ pid: Number(match[2]), ...endpoint, command: match[1] });
    }
  }
  return listeners;
}

export function readLinuxListeners({ runCommand = spawnSync } = {}) {
  const result = runCommand("ss", ["-H", "-ltnp"], { encoding: "utf8" });
  if (result?.error) throw missingCommandError("ss", "Install iproute2 so the runner can attribute TCP listeners", result.error);
  if (result?.status !== 0) throw new Error(`ss -H -ltnp failed: ${(result?.stderr ?? "").trim() || `exit ${result?.status}`}`);
  return parseSSListeners(result.stdout ?? "");
}

export function macOSProcessCommand() {
  return { command: "ps", args: ["eww", "-axo", "pid=,ppid=,pgid=,lstart=,command="] };
}

export function macOSListenerCommand() {
  return { command: "lsof", args: ["-nP", "-iTCP", "-sTCP:LISTEN", "-Fpcn"] };
}

export function parseMacOSProcesses(output) {
  const processes = [];
  const pattern = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\w{3}\s+\w{3}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2}\s+\d{4})\s+(.+)$/;
  for (const line of String(output).split(/\r?\n/)) {
    const match = pattern.exec(line);
    if (!match) continue;
    const tail = match[5].trim();
    const tokenMatch = new RegExp(`(?:^|\\s)${OWNER_TOKEN_ENV}=([^\\s]+)`).exec(tail);
    const token = tokenMatch?.[1];
    let command = tail;
    if (tokenMatch && decodeOwnerToken(token)) {
      const beforeToken = tail.slice(0, tokenMatch.index).trim();
      command = beforeToken.replace(/(?:\s+[A-Za-z_][A-Za-z0-9_]*=\S+)+$/, "").trim();
    }
    const startTime = match[4].replace(/\s+/g, " ");
    processes.push({
      pid: Number(match[1]),
      ppid: Number(match[2]),
      pgid: Number(match[3]),
      startTime,
      processStartedAt: new Date(startTime).toISOString(),
      executable: command.split(/\s+/, 1)[0],
      command,
      ...(decodeOwnerToken(token) ? { ownerToken: token } : {}),
    });
  }
  return processes;
}

export function readMacOSProcesses({ runCommand = spawnSync } = {}) {
  const invocation = macOSProcessCommand();
  const result = runCommand(invocation.command, invocation.args, { encoding: "utf8" });
  if (result?.error) throw missingCommandError("ps", "macOS ps is required for process ownership inspection", result.error);
  if (result?.status !== 0) throw new Error(`macOS ps inspection failed: ${(result?.stderr ?? "").trim() || `exit ${result?.status}`}`);
  return parseMacOSProcesses(result.stdout ?? "");
}

export function parseLsofListeners(output) {
  const listeners = [];
  let pid = null;
  let command = "";
  for (const line of String(output).split(/\r?\n/)) {
    const field = line[0];
    const value = line.slice(1);
    if (field === "p") {
      pid = /^\d+$/.test(value) ? Number(value) : null;
      command = "";
    } else if (field === "c") {
      command = value;
    } else if (field === "n" && pid !== null) {
      const endpoint = parseEndpoint(value.replace(/\s+\(LISTEN\)$/, ""));
      if (endpoint) listeners.push({ pid, ...endpoint, command });
    }
  }
  return listeners;
}

export function readMacOSListeners({ runCommand = spawnSync } = {}) {
  const invocation = macOSListenerCommand();
  const result = runCommand(invocation.command, invocation.args, { encoding: "utf8" });
  if (result?.error) throw missingCommandError("lsof", "Install lsof so the runner can attribute TCP listeners", result.error);
  if (result?.status !== 0) throw new Error(`macOS lsof inspection failed: ${(result?.stderr ?? "").trim() || `exit ${result?.status}`}`);
  return parseLsofListeners(result.stdout ?? "");
}

export function classifyOwnedProcesses(processes) {
  const byPid = new Map(processes.map((process) => [process.pid, process]));
  const classified = [];
  for (const process of processes) {
    const owner = decodeOwnerToken(process.ownerToken);
    if (!owner) continue;
    const supervisor = byPid.get(owner.supervisorPid);
    const supervisorStatus = supervisor && supervisor.startTime === owner.supervisorStartTime ? "live" : "stale";
    classified.push({ process, owner, token: process.ownerToken, supervisorStatus });
  }
  return classified;
}

export function processIdentityMatches(process, expected) {
  return Boolean(process) && process.pid === expected.pid && String(process.startTime) === String(expected.startTime);
}

export function revalidateOwnedProcess(expected, current, token) {
  return processIdentityMatches(current, expected) && current.ownerToken === token && decodeOwnerToken(current.ownerToken) !== null;
}

export function validateProcessLifecycleHost({ platform = process.platform, procfsReadable, commandAvailable }) {
  if (platform === "linux") {
    if (!procfsReadable) throw new Error("Linux process-lifecycle preflight cannot read /proc process identity and environment data");
    if (!commandAvailable("ss")) throw new Error("Linux process-lifecycle preflight requires iproute2 (ss)");
    return { backend: "linux-procfs-ss" };
  }
  if (platform === "darwin") {
    if (!commandAvailable("ps")) throw new Error("macOS process-lifecycle preflight requires ps");
    if (!commandAvailable("lsof")) throw new Error("macOS process-lifecycle preflight requires lsof");
    return { backend: "macos-ps-lsof" };
  }
  throw new Error(`Unsupported platform ${platform}; process ownership requires Linux /proc+ss or macOS ps+lsof`);
}

export function runProcessLifecycleProbe({
  platform = process.platform,
  procRoot = "/proc",
  runCommand = spawnSync,
  probeScript = DEFAULT_PROBE_SCRIPT,
} = {}) {
  const host = validateProcessLifecycleHost({
    platform,
    procfsReadable: platform === "linux" ? linuxProcfsReadable(procRoot) : false,
    commandAvailable: (command) => actualCommandAvailable(command, runCommand),
  });
  const result = runCommand(process.execPath, [probeScript], {
    encoding: "utf8",
    env: process.env,
    // The probe's bounded publication, attribution, TERM/KILL, and final-scan
    // phases can total 19 seconds on their individual worst paths.
    timeout: 25_000,
  });
  if (result?.error) throw new Error(`process-lifecycle probe could not run: ${result.error.message}`);
  if (result?.status !== 0) {
    throw new Error(`process-lifecycle probe failed: ${(result?.stderr ?? "").trim() || (result?.stdout ?? "").trim() || `exit ${result?.status}`}`);
  }
  const lines = String(result.stdout ?? "").trim().split(/\r?\n/).filter(Boolean);
  let details;
  try {
    details = JSON.parse(lines.at(-1) ?? "");
  } catch {
    throw new Error(`process-lifecycle probe returned invalid output: ${String(result.stdout ?? "").trim()}`);
  }
  if (details.backend !== host.backend) throw new Error(`process-lifecycle probe used ${details.backend}, expected ${host.backend}`);
  return details;
}

function linuxProcfsReadable(procRoot) {
  try {
    fs.readFileSync(path.join(procRoot, String(process.pid), "stat"));
    fs.readFileSync(path.join(procRoot, String(process.pid), "environ"));
    return true;
  } catch {
    return false;
  }
}

function actualCommandAvailable(command, runCommand) {
  const args = command === "ss" ? ["-V"] : command === "lsof" ? ["-v"] : ["-p", String(process.pid), "-o", "pid="];
  const result = runCommand(command, args, { encoding: "utf8" });
  return !result?.error && result?.status === 0;
}

function splitNullFields(value) {
  return Buffer.from(value).toString("utf8").split("\0").filter(Boolean);
}

function parseNullEnvironment(value) {
  const env = {};
  for (const entry of splitNullFields(value)) {
    const separator = entry.indexOf("=");
    if (separator > 0) env[entry.slice(0, separator)] = entry.slice(separator + 1);
  }
  return env;
}

function parseEndpoint(value) {
  let address;
  let portText;
  const bracketed = /^\[([^\]]+)\]:(\d+)$/.exec(value);
  if (bracketed) {
    address = bracketed[1];
    portText = bracketed[2];
  } else {
    const separator = value.lastIndexOf(":");
    if (separator < 0) return null;
    address = value.slice(0, separator);
    portText = value.slice(separator + 1);
  }
  if (!/^\d+$/.test(portText)) return null;
  const port = Number(portText);
  if (port < 1 || port > 65535) return null;
  return { address, port };
}

function parsePositiveInteger(value, name) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`Malformed Linux process stat: invalid ${name}`);
  return parsed;
}

function parseNonNegativeInteger(value, name) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error(`Malformed Linux process stat: invalid ${name}`);
  return parsed;
}

function missingCommandError(command, remediation, cause) {
  const error = new Error(`${remediation}; ${command} is unavailable: ${cause.message}`);
  error.cause = cause;
  return error;
}

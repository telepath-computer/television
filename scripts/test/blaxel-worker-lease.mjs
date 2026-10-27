import { createHash } from "node:crypto";

export const DEFAULT_RECOVERY_SECONDS = 1200;
export const SHARD_OWNER_ENV = "TV_TEST_SHARD_OWNER";

export function shardScratchPath({ tmpRoot = "/tmp", lockId, shardIndex, attempt = 1 }) {
  const digest = createHash("sha256").update(lockId).digest("hex").slice(0, 20);
  return `${tmpRoot}/tv-testshards/r-${digest}-s${shardIndex}-a${attempt}`;
}

// This code runs before checkout, including after another revision ran here.
// Serialize the actual implementation; never read a helper from the worker clone.
export function workerLeaseCommand(input) {
  const tmpRoot = input.tmpRoot ?? "/tmp";
  const source = `${cleanWorkerTemporaryDirectories.toString()}\n${workerLeaseOperation.toString()}\ntry { const result = await workerLeaseOperation(JSON.parse(Buffer.from(process.argv[1], 'base64url'))); console.log(JSON.stringify(result)); if (!result.ok) process.exitCode = 42; } catch (error) { console.error(error.message); process.exitCode = 2; }`;
  return `flock -w 20 -o ${quote(`${tmpRoot}/tv-testshard.guard`)} node --input-type=module -e ${quote(source)} ${quote(Buffer.from(JSON.stringify({ ...input, scratch: input.scratch ?? shardScratchPath(input) })).toString("base64url"))}`;
}

export function workerEntryCommand(input, script) {
  // exec keeps the registered shell PID/start identity. The token exists at
  // process creation, so procfs can observe it even before entry registration.
  const register = workerLeaseCommand({ ...input, operation: "enter", pidFromEnv: true });
  return `env TV_TEST_SHARD_OWNER=${quote(input.lockId)} bash -c ${quote(`export TV_SHARD_ENTRY_PID=$$; ${register} && exec bash ${quote(script)}`)}`;
}

function quote(value) { return `'${String(value).replaceAll("'", `'"'"'`)}'`; }

/** Must run under the short flock guard. Hooks substitute only declared seams. */
export async function workerLeaseOperation(input, hooks = {}) {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const now = hooks.now ?? Date.now;
  const tmpRoot = input.tmpRoot ?? "/tmp";
  const resultsRoot = input.resultsRoot ?? "/workspace/television/.testshards/results";
  const lock = path.join(tmpRoot, "tv-testshard.lock");
  const ownerFile = path.join(lock, "owner.json");
  const operation = input.operation ?? "acquire";
  const ttlMs = (input.ttlSeconds ?? 1200) * 1000;
  if (!Number.isSafeInteger(ttlMs) || ttlMs <= 0) throw new Error("invalid recovery interval");
  if (!/^[A-Za-z0-9_.:-]+$/.test(input.lockId ?? "")) throw new Error("invalid lock identity");
  if (fs.lstatSync(tmpRoot).isSymbolicLink()) throw new Error("temporary root is a symlink");
  if (fs.existsSync(lock) && (!fs.lstatSync(lock).isDirectory() || fs.lstatSync(lock).isSymbolicLink())) throw new Error("unsafe lock root");
  let record = null;
  const exists = fs.existsSync(lock);
  try { record = JSON.parse(fs.readFileSync(ownerFile, "utf8")); } catch (error) { if (!exists && error.code !== "ENOENT") throw error; }
  const valid = record && typeof record.lockId === "string" && typeof record.runId === "string" && typeof record.attemptId === "string" && Number.isFinite(record.lastRenewal) && Number.isFinite(record.recoverAfter);
  const expired = valid && record.recoverAfter <= now();
  const held = valid ? !expired : Number.isFinite(record?.expiresAt) && record.expiresAt > now() / 1000;
  const write = (value) => {
    fs.mkdirSync(lock, { recursive: true });
    fs.writeFileSync(`${ownerFile}.next`, JSON.stringify(value));
    fs.renameSync(`${ownerFile}.next`, ownerFile);
  };
  const denied = (reason) => ({ ok: false, reason });

  // Inspect all tokens, including malformed tokens, conservatively. No arguments
  // or environments enter the evidence. Kernel threads and zombies own no work.
  function readProcess(pid) {
    const base = `/proc/${pid}`;
    const stat = fs.readFileSync(`${base}/stat`, "utf8");
    const fields = stat.slice(stat.lastIndexOf(")") + 1).trim().split(/\s+/);
    if (fields.length < 20) throw new Error("unreadable process identity");
    if (["Z", "X"].includes(fields[0])) return null;
    const environment = fs.readFileSync(`${base}/environ`, "utf8").split("\0");
    const value = (key) => environment.find((entry) => entry.startsWith(`${key}=`))?.slice(key.length + 1);
    const shardToken = value("TV_TEST_SHARD_OWNER");
    const surfaceToken = value("TV_TEST_SURFACE_OWNER");
    if (!shardToken && !surfaceToken) return null;
    if (input.auditTokens && !input.auditTokens.includes(shardToken) && !input.auditTokens.includes(surfaceToken)) return null;
    let command = "unavailable";
    try { command = path.basename(fs.readlinkSync(`${base}/exe`)); } catch (error) { if (!["ENOENT", "ESRCH"].includes(error.code)) throw error; }
    return { pid, startTime: fields[19], shardToken, surfaceToken, command };
  }
  async function scan() {
    const owners = [];
    for (const name of fs.readdirSync("/proc")) {
      if (!/^\d+$/.test(name)) continue;
      try { const entry = readProcess(Number(name)); if (entry) owners.push(entry); }
      catch (error) { if (!["ENOENT", "ESRCH"].includes(error.code)) throw error; }
    }
    return owners;
  }
  const scanOwners = hooks.scanOwners ?? scan;
  const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  async function stop(token) {
    const actions = new Map();
    const signal = async (name) => {
      for (const candidate of (await scanOwners()).filter((entry) => entry.shardToken === token)) {
        let current;
        try { current = readProcess(candidate.pid); } catch (error) { if (["ENOENT", "ESRCH"].includes(error.code)) continue; throw error; }
        if (!current || current.startTime !== candidate.startTime || current.shardToken !== token) continue;
        try { process.kill(current.pid, name); }
        catch (error) { if (error.code === "ESRCH") continue; throw error; }
        actions.set(`${current.pid}:${current.startTime}`, { pid: current.pid, startTime: current.startTime, command: current.command, outcome: name });
      }
    };
    await signal("SIGTERM");
    const deadline = Date.now() + 2000;
    while ((await scanOwners()).some((entry) => entry.shardToken === token) && Date.now() < deadline) await pause(50);
    await signal("SIGKILL");
    const killDeadline = Date.now() + 2000;
    while ((await scanOwners()).some((entry) => entry.shardToken === token) && Date.now() < killDeadline) await pause(50);
    if ((await scanOwners()).some((entry) => entry.shardToken === token)) throw new Error("owned processes survived cleanup");
    return [...actions.values()];
  }
  const stopOwners = hooks.stopOwners ?? stop;
  const cleanTemporary = hooks.cleanTemporary ?? cleanWorkerTemporaryDirectories;
  const clean = async (current, onlyCurrent = false) => {
    const result = await cleanTemporary({ tmpRoot, current, onlyCurrent });
    if (!result.ok) throw new Error(`temporary cleanup incomplete: ${JSON.stringify(result)}`);
    return result;
  };
  const auditClean = async () => (await scanOwners()).length === 0;

  if (["acquire", "delete"].includes(operation)) {
    if (record?.deleting) return operation === "delete" ? { ok: true, deleting: true } : denied("worker reserved for deletion");
    if (exists && (held || input.audit)) return denied("worker lease held");
    let recovery = null;
    if (operation === "delete" && valid && expired) {
      // Deleting the sandbox is itself cleanup; do not require successful signals.
    } else if (valid && expired) {
      const processes = await stopOwners(record.lockId);
      if (!await auditClean()) return denied("other live or stale owners remain");
      await clean(null);
      recovery = { kind: "recovery", previous: { runId: record.runId, lockId: record.lockId, worker: input.worker ?? "unknown", lastRenewal: record.lastRenewal, recoverAfter: record.recoverAfter }, cleanup: "confirmed", discardedReports: true, processes: processes.slice(0, 128) };
    } else if (!input.audit && !await auditClean()) return denied("live or stale owners remain");
    if (operation === "delete") {
      write({ lockId: input.lockId, deleting: true });
      return { ok: true, deleting: true };
    }
    if (recovery) fs.rmSync(resultsRoot, { recursive: true, force: true });
    const acquiredAt = now();
    const scratch = input.scratch;
    if (!scratch || path.dirname(scratch) !== path.join(tmpRoot, "tv-testshards")) throw new Error("invalid scratch path");
    const parent = path.dirname(scratch);
    if (fs.existsSync(parent) && fs.lstatSync(parent).isSymbolicLink()) throw new Error("scratch root is a symlink");
    fs.mkdirSync(path.join(scratch, "tmp"), { recursive: true, mode: 0o700 });
    record = { lockId: input.lockId, runId: input.runId, shardIndex: input.shardIndex, attemptId: input.attemptId, owner: input.owner, acquiredAt, lastRenewal: acquiredAt, recoverAfter: acquiredAt + ttlMs, expiresAt: 0, scratch, audit: Boolean(input.audit), dispatch: null, recovery };
    write(record);
    return { ok: true, record };
  }

  if (!valid || record.lockId !== input.lockId || expired || record.deleting) return denied("lease lost or expired");
  if (operation === "check") {
    return { ok: true, record };
  } else if (operation === "renew") {
    record.lastRenewal = now(); record.recoverAfter = record.lastRenewal + ttlMs; write(record);
  } else if (operation === "prepare") {
    if (record.dispatch || record.prepared) return denied("attempt already prepared or dispatched");
    if (!record.audit && !await auditClean()) return denied("worker audit not clean");
    const cleanup = record.audit ? null : await clean(record.scratch);
    fs.rmSync(resultsRoot, { recursive: true, force: true });
    fs.mkdirSync(resultsRoot, { recursive: true });
    fs.writeFileSync(path.join(resultsRoot, "attempt.json"), JSON.stringify({ runId: record.runId, shardIndex: record.shardIndex, attemptId: record.attemptId, lockId: record.lockId }));
    fs.writeFileSync(path.join(resultsRoot, "temporary-cleanup.json"), JSON.stringify(cleanup));
    if (record.recovery) {
      // First evidence in a freshly reset tree. The bounded receipt is also
      // accounted for by the surface writer's shared attempt budget.
      const receipt = { schemaVersion: 1, ...record.recovery, identity: { runId: record.runId, shardIndex: record.shardIndex, attemptId: record.attemptId, surfaceId: "worker-recovery" } };
      const raw = JSON.stringify(receipt);
      if (Buffer.byteLength(raw) > 128 * 1024) throw new Error("recovery receipt exceeds sidecar budget");
      fs.mkdirSync(path.join(resultsRoot, "resources"));
      fs.writeFileSync(path.join(resultsRoot, "resources/recovery.json"), raw);
    }
    record.prepared = true; write(record);
  } else if (operation === "dispatch") {
    if (!record.prepared || record.dispatch) return denied("invalid dispatch state");
    record.dispatch = { processName: input.processName, requestedAt: now() }; write(record);
  } else if (operation === "enter") {
    if (!record.dispatch || record.dispatch.processName !== input.processName || record.dispatch.pid) return denied("dispatch not current");
    const pid = input.pidFromEnv ? Number(process.env.TV_SHARD_ENTRY_PID) : input.pid;
    const entry = readProcess(pid);
    if (!entry || entry.shardToken !== record.lockId) return denied("entry attribution missing");
    record.dispatch.pid = entry.pid; record.dispatch.startTime = entry.startTime; write(record);
  } else if (operation === "teardown") {
    // A request that never registered may still arrive. Keep it excluded until
    // recovery, whose entry check will reject that old identity.
    if (record.dispatch && !record.dispatch.pid) return denied("dispatch outcome unknown");
    const processes = await stopOwners(record.lockId);
    if (!record.audit && !await auditClean()) return denied("worker audit not clean");
    if (record.prepared) {
      const setupFile = path.join(resultsRoot, `setup-shard-${record.shardIndex}.json`);
      if (!fs.existsSync(setupFile)) {
        const inputFile = path.join(record.scratch, "setup.jsonl");
        const rows = fs.existsSync(inputFile) ? fs.readFileSync(inputFile, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line)) : [];
        fs.writeFileSync(setupFile, JSON.stringify(rows));
      }
      const summaryFile = path.join(resultsRoot, `shard-${record.shardIndex}.json`);
      if (!fs.existsSync(summaryFile)) fs.writeFileSync(summaryFile, JSON.stringify({ status: "infra-failed", failureKind: "worker-execution", failureStep: "interrupted-before-summary", failureMessage: "The owned process ended without a finalized shard summary.", shardIndex: record.shardIndex, tasks: [], neverProduced: ["final shard summary"] }));
    }
    const cleanup = await clean(record.scratch, true);
    record.teardown = { confirmed: true, processes, cleanup }; write(record);
    if (record.prepared) {
      fs.writeFileSync(path.join(resultsRoot, "teardown.json"), JSON.stringify(record.teardown));
      const files = [];
      const inventory = (dir) => { for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const file = path.join(dir, entry.name);
        if (entry.isSymbolicLink()) throw new Error("symlink in retained evidence");
        if (entry.isDirectory()) inventory(file);
        else if (entry.name !== "evidence.json") files.push(path.relative(resultsRoot, file));
      } };
      inventory(resultsRoot);
      fs.writeFileSync(path.join(resultsRoot, "evidence.json"), JSON.stringify({ runId: record.runId, attemptId: record.attemptId, files }));
    }
  } else if (operation === "release") {
    if (!record.teardown?.confirmed || !input.retrieved) return denied("teardown and retained evidence required");
    fs.rmSync(lock, { recursive: true });
  } else throw new Error(`unknown lease operation ${operation}`);
  return { ok: true, record };
}

/** Direct allowed directories only; lstat traversal never follows symlinks. */
export async function cleanWorkerTemporaryDirectories({ tmpRoot = "/tmp", current, onlyCurrent = false }, probes = {}) {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const lstat = probes.lstat ?? fs.lstatSync;
  const remove = probes.remove ?? ((file) => fs.rmSync(file, { recursive: true, force: false }));
  const scratchRoot = path.join(tmpRoot, "tv-testshards");
  const free = () => { const value = fs.statfsSync(tmpRoot); return { availableBytes: value.bavail * value.bsize, freeBytes: value.bfree * value.bsize }; };
  const report = { ok: true, before: free(), after: null, removed: {}, skips: [], errors: [] };
  for (const root of [tmpRoot, scratchRoot]) {
    if (!fs.existsSync(root)) continue;
    if (lstat(root).isSymbolicLink() || !lstat(root).isDirectory()) throw new Error(`unsafe cleanup root ${root}`);
    if (root !== tmpRoot && lstat(root).dev !== lstat(tmpRoot).dev) throw new Error("scratch root crosses a mount boundary");
  }
  function allocated(file, device) {
    const stat = lstat(file);
    if (stat.dev !== device) throw new Error("unexpected mount boundary");
    let bytes = stat.blocks * 512;
    if (stat.isDirectory()) for (const name of fs.readdirSync(file)) bytes += allocated(path.join(file, name), device);
    return bytes;
  }
  const candidates = [];
  if (onlyCurrent) {
    if (!current || path.dirname(current) !== scratchRoot) throw new Error("current scratch escapes allowed root");
    candidates.push([current, "current"]);
  } else {
    for (const name of fs.readdirSync(tmpRoot)) {
      const prefix = ["television-source-cli-e2e-", "television-web-bundle-"].find((value) => name.startsWith(value));
      if (prefix) candidates.push([path.join(tmpRoot, name), prefix]);
    }
    if (fs.existsSync(scratchRoot)) for (const name of fs.readdirSync(scratchRoot)) {
      const file = path.join(scratchRoot, name); if (file !== current) candidates.push([file, "stale-scratch"]);
    }
  }
  for (const [file, prefix] of candidates) {
    try {
      if (!fs.existsSync(file)) continue;
      const stat = lstat(file);
      if (!stat.isDirectory() || stat.isSymbolicLink()) { report.skips.push({ prefix, reason: "not a real directory" }); continue; }
      const bytes = allocated(file, lstat(tmpRoot).dev);
      remove(file);
      const counts = report.removed[prefix] ??= { directories: 0, allocatedBytes: 0 };
      counts.directories++; counts.allocatedBytes += bytes;
    } catch (error) { report.ok = false; report.errors.push({ prefix, reason: error.code ?? error.message }); }
  }
  report.after = free();
  return report;
}

import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, symlinkSync, lstatSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, test as platformTest, vi } from "vitest";
import { workerLeaseOperation, cleanWorkerTemporaryDirectories } from "../../scripts/test/blaxel-worker-lease.mjs";
import { finishLease, renewLease, retainAttemptEvidence } from "../../scripts/test/blaxel-lease-lifecycle.mjs";
import { publishWorker, deleteWorker } from "../../scripts/test/blaxel-pool-lifecycle.mjs";

// Contract clocks, owner audits/signals and SDK operations are substitutions.
// Filesystem assertions cross the real cleaner; the live driver proves transport.
const test = platformTest.skipIf(process.platform !== "linux");
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function fixture(record?: unknown) {
  const tmpRoot = mkdtempSync(path.join(os.tmpdir(), "lease-contract-")); roots.push(tmpRoot);
  const ownerFile = path.join(tmpRoot, "tv-testshard.lock/owner.json");
  if (record !== undefined) { mkdirSync(path.dirname(ownerFile)); writeFileSync(ownerFile, typeof record === "string" ? record : JSON.stringify(record)); }
  const input = { lockId: "incoming", runId: "incoming-run", shardIndex: 1, attemptId: "incoming-attempt", tmpRoot, scratch: path.join(tmpRoot, "tv-testshards/current"), resultsRoot: path.join(tmpRoot, "results") };
  return { tmpRoot, input, ownerFile };
}
const expired = { lockId: "old", runId: "old-run", attemptId: "old-attempt", lastRenewal: 1, recoverAfter: 2, expiresAt: 0 };

test("expired active and quiet leases use the same cleanup; uncertain owners hold", async () => {
  for (const active of [false, true]) {
    const f = fixture(expired); const calls: string[] = [];
    let owners = active ? [{ shardToken: "old" }] : [];
    const result = await workerLeaseOperation(f.input, { now: () => 3000, scanOwners: async () => owners, stopOwners: async (token: string) => { calls.push(token); owners = []; return []; } });
    expect(result.ok).toBe(true); expect(calls).toEqual(["old"]);
    expect(result.record.recovery?.discardedReports).toBe(true);
  }
  const f = fixture(expired);
  const result = await workerLeaseOperation(f.input, { now: () => 3000, stopOwners: async () => [], scanOwners: async () => [{ shardToken: "unrelated" }] });
  expect(result).toMatchObject({ ok: false });
  expect(JSON.parse(readFileSync(f.ownerFile, "utf8")).lockId).toBe("old");
});

test("legacy, incomplete, unreadable and audit leases fail closed without clean ownership", async () => {
  for (const record of [{ lockId: "legacy", expiresAt: 1 }, {}, "unreadable"]) {
    for (const operation of ["acquire", "delete"]) {
      const f = fixture(record);
      expect(await workerLeaseOperation({ ...f.input, operation }, { now: () => 3000, scanOwners: async () => [{}] })).toMatchObject({ ok: false });
      expect((await workerLeaseOperation({ ...f.input, operation }, { now: () => 3000, scanOwners: async () => [] })).ok).toBe(true);
    }
  }
  for (const record of [expired, { lockId: "legacy", expiresAt: 100 }]) {
    const f = fixture(record);
    expect(await workerLeaseOperation({ ...f.input, audit: true }, { now: () => 3000, scanOwners: async () => { throw Error("must not inspect held worker"); } })).toMatchObject({ ok: false });
  }
  const f = fixture({ lockId: "legacy", expiresAt: 100 });
  expect(await workerLeaseOperation(f.input, { now: () => 3000, scanOwners: async () => [] })).toMatchObject({ ok: false });
  const audit = fixture();
  const residue = path.join(audit.tmpRoot, "television-web-bundle-preserve"); mkdirSync(residue);
  const staleScratch = path.join(audit.tmpRoot, "tv-testshards/stale"); mkdirSync(staleScratch, { recursive: true });
  const auditInput = { ...audit.input, audit: true };
  const auditHooks = { scanOwners: async () => { throw Error("audit must observe existing owners before cleanup"); }, stopOwners: async () => [] };
  expect((await workerLeaseOperation(auditInput, auditHooks)).ok).toBe(true);
  expect((await workerLeaseOperation({ ...auditInput, operation: "prepare" }, auditHooks)).ok).toBe(true);
  expect((await workerLeaseOperation({ ...auditInput, operation: "teardown" }, auditHooks)).ok).toBe(true);
  expect(existsSync(residue)).toBe(true); expect(existsSync(staleScratch)).toBe(true);
});

test("cleanup failures keep the old identity, while explicit deletion reserves an expired worker", async () => {
  const f = fixture(expired);
  await expect(workerLeaseOperation(f.input, { now: () => 3000, scanOwners: async () => [], stopOwners: async () => { throw Error("cannot signal"); } })).rejects.toThrow("cannot signal");
  expect(JSON.parse(readFileSync(f.ownerFile, "utf8")).lockId).toBe("old");
  expect(await workerLeaseOperation({ ...f.input, operation: "delete" }, { now: () => 3000, scanOwners: async () => { throw Error("unavailable"); } })).toMatchObject({ ok: true, deleting: true });
  expect(await workerLeaseOperation(f.input)).toMatchObject({ ok: false });
});

test("only known real directories are removed, with allocated-byte evidence and outside links preserved", async () => {
  const f = fixture(); const outside = path.join(f.tmpRoot, "unrelated"); mkdirSync(outside); writeFileSync(path.join(outside, "keep"), "keep");
  for (const name of ["television-source-cli-e2e-old", "television-web-bundle-old", "tv-testshards/stale", "tv-testshards/no-metadata", "tv-testshards/current"]) { mkdirSync(path.join(f.tmpRoot, name), { recursive: true }); writeFileSync(path.join(f.tmpRoot, name, "data"), "payload"); }
  symlinkSync(outside, path.join(f.tmpRoot, "television-web-bundle-link"));
  symlinkSync(outside, path.join(f.tmpRoot, "television-source-cli-e2e-old/link"));
  const result = await cleanWorkerTemporaryDirectories({ tmpRoot: f.tmpRoot, current: f.input.scratch });
  expect(result.ok).toBe(true);
  expect(result.removed["stale-scratch"].directories).toBe(2);
  expect(result.removed["television-source-cli-e2e-"].allocatedBytes).toBeGreaterThanOrEqual(0);
  expect(result.before.availableBytes).toBeGreaterThan(0); expect(result.after.availableBytes).toBeGreaterThan(0);
  expect(existsSync(path.join(outside, "keep"))).toBe(true); expect(existsSync(f.input.scratch)).toBe(true);
  expect(lstatSync(path.join(f.tmpRoot, "television-web-bundle-link")).isSymbolicLink()).toBe(true);
  await cleanWorkerTemporaryDirectories({ tmpRoot: f.tmpRoot, current: f.input.scratch, onlyCurrent: true });
  expect(existsSync(f.input.scratch)).toBe(false);
  const linked = path.join(f.tmpRoot, "link"); symlinkSync(outside, linked);
  await expect(cleanWorkerTemporaryDirectories({ tmpRoot: linked, current: null })).rejects.toThrow("unsafe cleanup root");
});

test("mount boundaries and incomplete removal remain reported failures without reclaimed counts", async () => {
  for (const failure of ["mount", "identity", "remove"]) {
    const f = fixture(); const dir = path.join(f.tmpRoot, "television-web-bundle-old"); mkdirSync(dir);
    let directoryReads = 0;
    const probes = failure !== "remove" ? { lstat: (file: string) => {
      const stat = lstatSync(file);
      if (file === dir) {
        directoryReads++;
        if (failure === "mount") Object.defineProperty(stat, "dev", { value: stat.dev + 1 });
        if (failure === "identity" && directoryReads === 3) Object.defineProperty(stat, "ino", { value: stat.ino + 1 });
      }
      return stat;
    } } : { remove: () => { throw Object.assign(Error("incomplete"), { code: "EIO" }); } };
    const result = await cleanWorkerTemporaryDirectories({ tmpRoot: f.tmpRoot, current: null }, probes);
    expect(result.ok).toBe(false); expect(result.removed).toEqual({}); expect(result.errors).toHaveLength(1); expect(existsSync(dir)).toBe(true);
  }
});

test("retrieval retries after teardown without rerunning work; uncertainty never releases", async () => {
  const calls: string[] = []; let attempts = 0;
  const operations = { settleWrites: async () => { calls.push("writes"); }, assertOwned: () => {}, teardown: async () => { calls.push("teardown"); }, download: async () => { calls.push("download"); if (++attempts === 1) throw Error("transport"); }, release: async () => { calls.push("release"); } };
  await finishLease(operations);
  expect(calls).toEqual(["writes", "teardown", "download", "download", "release"]);
  for (const broken of ["teardown", "download", "ownership"] as const) {
    calls.length = 0;
    await expect(finishLease({ ...operations, ...(broken === "teardown" ? { teardown: async () => { throw Error("unknown dispatch"); } } : broken === "download" ? { download: async () => { throw Error("transport"); } } : { assertOwned: () => { throw Error("lost lease"); } }) })).rejects.toThrow();
    expect(calls).not.toContain("release");
  }
});

test("pool eligibility follows verification, and deletion reserves then unpublishes", async () => {
  const calls: string[] = [];
  const sandbox = { metadata: { name: "fixture", labels: { purpose: "testshards-provisioning", pool: "private" } }, wait: async () => { calls.push("wait"); } };
  const update = async (_name: string, metadata: { labels: Record<string, string> }) => { calls.push(metadata.labels.purpose); };
  await publishWorker(sandbox, { provision: async () => { calls.push("provision"); }, verify: async () => { calls.push("verify"); }, update });
  expect(calls).toEqual(["wait", "provision", "verify", "testshards"]);
  calls.length = 0;
  await expect(publishWorker(sandbox, { provision: async () => {}, verify: async () => { throw Error("wrong architecture"); }, update })).rejects.toThrow();
  expect(calls).not.toContain("testshards");
  sandbox.metadata.labels.purpose = "testshards";
  calls.length = 0;
  const ops = { reserve: async () => { calls.push("reserve"); }, update, remove: async () => { calls.push("delete"); throw Error("provider unavailable"); } };
  await expect(deleteWorker(sandbox, ops)).rejects.toThrow();
  expect(calls).toEqual(["reserve", "testshards-unavailable", "delete"]);
  calls.length = 0;
  await expect(deleteWorker(sandbox, { ...ops, reserve: async () => { throw Error("valid lease"); } })).rejects.toThrow();
  expect(calls).toEqual([]);
});


test("renewal continues while retrieval waits and stops on ownership loss", async () => {
  vi.useFakeTimers();
  try {
    let lost: unknown = null;
    const renew = vi.fn().mockResolvedValue(undefined);
    const stop = renewLease({ renew, intervalMs: 10, onLost: (error: unknown) => { lost = error; } });
    let continueDownload!: () => void;
    const waiting = new Promise<void>(resolve => { continueDownload = resolve; });
    const release = vi.fn();
    const finishing = finishLease({ settleWrites: async () => {}, teardown: async () => {}, download: () => waiting, release, assertOwned: () => { if (lost) throw lost; } });
    await vi.advanceTimersByTimeAsync(35);
    expect(renew).toHaveBeenCalledTimes(3); expect(release).not.toHaveBeenCalled();
    continueDownload(); await finishing; await stop();
    await vi.advanceTimersByTimeAsync(30);
    expect(renew).toHaveBeenCalledTimes(3); expect(release).toHaveBeenCalledOnce();
    renew.mockRejectedValueOnce(Error("ownership lost"));
    const stopLost = renewLease({ renew, intervalMs: 10, onLost: (error: unknown) => { lost = error; } });
    await vi.advanceTimersByTimeAsync(100);
    expect(renew).toHaveBeenCalledTimes(4); expect(lost).toBeInstanceOf(Error);
    await stopLost();
  } finally { vi.useRealTimers(); }
});

test("failed deletion of never-published workers remains retryable without their runtime", async () => {
  const sandbox = { metadata: { name: "partial", labels: { purpose: "testshards-provisioning" } } };
  const ops = { reserve: vi.fn().mockRejectedValue(Error("no runtime")), update: vi.fn(), remove: vi.fn().mockRejectedValueOnce(Error("provider unavailable")).mockResolvedValueOnce(undefined) };
  await expect(deleteWorker(sandbox, ops)).rejects.toThrow("provider unavailable");
  await deleteWorker(sandbox, ops);
  expect(ops.reserve).not.toHaveBeenCalled(); expect(ops.update).not.toHaveBeenCalled(); expect(ops.remove).toHaveBeenCalledTimes(2);
});

test("preparation evidence is downloaded before an undispatched attempt releases", async () => {
  const f = fixture();
  const hooks = { scanOwners: async () => [], stopOwners: async () => [] };
  await workerLeaseOperation(f.input, hooks);
  await workerLeaseOperation({ ...f.input, operation: "prepare" }, hooks);
  writeFileSync(path.join(f.input.resultsRoot, "preparation.txt"), "produced before dispatch");
  const directory = path.join(f.tmpRoot, "download");
  const lease = { preparationRequested: true, executionRequested: false, teardownConfirmed: true,
    shardIndex: 1, input: f.input, sandbox: { fs: {
      read: async (file: string) => readFileSync(file.replace("/workspace/television/.testshards/results", f.input.resultsRoot), "utf8"),
      ls: async () => { throw Error("confirmed teardown must supply its inventory"); },
    } },
  };
  await finishLease({
    settleWrites: async () => {}, assertOwned: () => {},
    teardown: async () => { expect((await workerLeaseOperation({ ...f.input, operation: "teardown" }, hooks)).ok).toBe(true); },
    download: () => retainAttemptEvidence(lease, directory),
    release: async () => {
      expect(existsSync(path.join(directory, "artifacts/shard-1/preparation.txt"))).toBe(true);
      expect(readFileSync(path.join(directory, "artifacts/shard-1/preparation.txt"), "utf8")).toBe("produced before dispatch");
      expect((await workerLeaseOperation({ ...f.input, operation: "release", retrieved: true }, hooks)).ok).toBe(true);
    },
  });
});

// Authored procfs: each thread-list read advances the scripted process state,
// so exit timing is deterministic. Forfeits real procfs to the worker-lease seam.
type FakeProcess = { threads: Record<string, string>; environ: string | Error; exe?: string | Error; onEnviron?: () => void };
const EXITING = 0x4;
const procError = (code: string) => Object.assign(new Error(code), { code });
function fakeProcfs(processes: Map<number, FakeProcess>, onList: (pid: number, count: number) => void = () => {}) {
  const lists = new Map<number, number>();
  const statLine = (state: string, flags: number) => `1 (fake) ${state} 1 1 1 0 -1 ${flags} 0 0 0 0 0 0 0 0 20 0 1 0 5000 0 0`;
  // A thread entry is "<state>", "<state>+exiting", "<state>+killed" (SIGKILL
  // pending, not yet scheduled to exit) or "<state>+kernel".
  const thread = (entry: string) => statLine(entry[0], entry.endsWith("+kernel") ? 0x200000 : entry.endsWith("+exiting") || entry[0] === "Z" ? EXITING : 0);
  const lookup = (file: string) => { const [, pid, rest] = file.match(/^\/proc\/(\d+)\/(.+)$/)!; const proc = processes.get(Number(pid)); if (!proc) throw procError("ENOENT"); return { pid: Number(pid), rest, proc }; };
  return {
    readFile(file: string) {
      const { pid, rest, proc } = lookup(file);
      if (rest === "stat") return thread(proc.threads[String(pid)] ?? "Z");
      const task = rest.match(/^task\/(\d+)\/stat$/);
      if (task) { if (!(task[1] in proc.threads)) throw procError("ENOENT"); return thread(proc.threads[task[1]]); }
      const status = rest.match(/^(?:task\/(\d+)\/)?status$/);
      if (status) {
        const entry = proc.threads[status[1] ?? String(pid)];
        if (entry === undefined) throw procError("ENOENT");
        return `SigPnd:\t${entry.endsWith("+killed") ? "0000000000000100" : "0000000000000000"}\nShdPnd:\t0000000000000000\n`;
      }
      if (rest === "environ") { proc.onEnviron?.(); if (proc.environ instanceof Error) throw proc.environ; return proc.environ; }
      throw procError("ENOENT");
    },
    readdir(dir: string) {
      const { pid, proc } = lookup(`${dir}`);
      const count = (lists.get(pid) ?? 0) + 1; lists.set(pid, count);
      // The callback changes state after this list is taken, before the next read.
      const tids = Object.keys(proc.threads); onList(pid, count);
      return tids;
    },
    readlink(file: string) { const { proc } = lookup(file); if (proc.exe instanceof Error) throw proc.exe; return proc.exe ?? "/usr/bin/node"; },
  };
}

test("the owner audit waits for exiting processes and refuses unknown live ownership", async () => {
  const audit = (processes: Map<number, FakeProcess>, onList?: (pid: number, count: number) => void) =>
    workerLeaseOperation({ ...fixture().input, auditPids: [...processes.keys()] }, { now: () => 3000, procfs: fakeProcfs(processes, onList) });
  const token = "TV_TEST_SHARD_OWNER=old\0";

  // Exiting with its environment denied: waited for until it becomes a zombie.
  const finishing = new Map([[101, { threads: { 101: "R+exiting" }, environ: procError("EACCES") }]]);
  expect(await audit(finishing, (_pid, count) => { if (count === 6) finishing.get(101)!.threads[101] = "Z"; })).toMatchObject({ ok: true });

  // Live at the first check, exiting by the environment read: the original race.
  const racing = new Map<number, FakeProcess>([[102, { threads: { 102: "S" }, environ: procError("EACCES") }]]);
  racing.get(102)!.onEnviron = () => { racing.get(102)!.threads[102] = "R+exiting"; };
  expect(await audit(racing, (_pid, count) => { if (count === 8) racing.get(102)!.threads[102] = "Z"; })).toMatchObject({ ok: true });

  // Killed sibling threads not yet scheduled to exit still count as exiting.
  const killed = new Map([[111, { threads: { 111: "Z", 112: "R+killed" } as Record<string, string>, environ: procError("EACCES") }]]);
  expect(await audit(killed, (_pid, count) => { if (count === 4) delete killed.get(111)!.threads[112]; })).toMatchObject({ ok: true });

  // An exiting process that never finishes still holds the worker.
  await expect(audit(new Map([[103, { threads: { 103: "D+exiting" }, environ: procError("EACCES") }]]))).rejects.toThrow(/PID 103 \(ETIMEDOUT\)/);

  // A live process whose environment is denied has unknown ownership.
  await expect(audit(new Map([[104, { threads: { 104: "S" }, environ: procError("EACCES") }]]))).rejects.toThrow(/PID 104 \(EACCES\)/);

  // Main thread exited while another runs on; root reads an empty environment.
  await expect(audit(new Map([[105, { threads: { 105: "Z", 106: "S" }, environ: "", exe: procError("ENOENT") }]]))).rejects.toThrow(/PID 105 \(ENODATA\)/);

  // The main thread creates a thread and then exits between the thread list
  // and its state read; the new thread is not missed.
  const spawning = new Map<number, FakeProcess>([[107, { threads: { 107: "S" }, environ: "", exe: procError("ENOENT") }]]);
  await expect(audit(spawning, (_pid, count) => { if (count === 1) Object.assign(spawning.get(107)!.threads, { 107: "Z", 108: "S" }); })).rejects.toThrow(/PID 107 \(ENODATA\)/);

  // A live process with readable tokens is an owner; one without is not.
  expect(await audit(new Map([[109, { threads: { 109: "S" }, environ: token }]]))).toMatchObject({ ok: false });
  expect(await audit(new Map([[110, { threads: { 110: "S" }, environ: "PATH=/bin\0" }]]))).toMatchObject({ ok: true });

  // Kernel threads own no work, although a non-root reader is denied their environment.
  expect(await audit(new Map([[2, { threads: { 2: "S+kernel" }, environ: procError("EACCES") }]]))).toMatchObject({ ok: true });
});

import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import { finishLease, renewLease, retainAttemptEvidence } from "../../scripts/test/blaxel-lease-lifecycle.mjs";
import { publishWorker, deleteWorker } from "../../scripts/test/blaxel-pool-lifecycle.mjs";

// Coordinator contracts. Clocks, worker lease operations and SDK operations are
// substitutions; the live harness carries the worker side and the transport.
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

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
  const directory = mkdtempSync(path.join(os.tmpdir(), "lease-contract-")); roots.push(directory);
  const input = { lockId: "incoming", runId: "incoming-run", shardIndex: 1, attemptId: "incoming-attempt" };
  // Authored worker results tree after preparation and a confirmed teardown.
  const results: Record<string, string> = {
    "attempt.json": JSON.stringify(input),
    "evidence.json": JSON.stringify({ runId: input.runId, attemptId: input.attemptId, files: ["attempt.json", "preparation.txt"] }),
    "preparation.txt": "produced before dispatch",
  };
  const root = "/workspace/television/.testshards/results/";
  const lease = { preparationRequested: true, executionRequested: false, teardownConfirmed: true, shardIndex: 1, input, sandbox: { fs: {
    read: async (file: string) => { const name = file.slice(root.length); if (!file.startsWith(root) || !(name in results)) throw Object.assign(Error("absent"), { status: 404 }); return results[name]; },
    ls: async () => { throw Error("confirmed teardown must supply its inventory"); },
  } } };
  const release = vi.fn(async () => {
    expect(readFileSync(path.join(directory, "artifacts/shard-1/preparation.txt"), "utf8")).toBe("produced before dispatch");
  });
  await finishLease({ settleWrites: async () => {}, assertOwned: () => {}, teardown: async () => {}, download: () => retainAttemptEvidence(lease, directory), release });
  expect(release).toHaveBeenCalledOnce();
  expect(existsSync(path.join(directory, "artifacts/shard-1/attempt.json"))).toBe(true);
});

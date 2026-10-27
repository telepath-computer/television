import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { SandboxInstance } from "@blaxel/core";
import { expect, test } from "vitest";
import { listBlaxelPoolSandboxes } from "../../../../scripts/test/blaxel-pool.mjs";

// Acceptance: real canonical subprocesses, SDK, fresh private workers and native
// fixtures. The sole scheduling hook pauses immediately before report download.
const pool = "rose-cleanup";
const coordinatorName = "tv-cleanup-coordinator-rose";
const planned = ["--tag", "blaxel-harness-fixture", "--shards", "2", "--allow-shard-count-override", "1"];
const targeted = ["--surface", "experiment:blaxel-harness-fixtures"];
const resultsRoot = "/workspace/television/.testshards/results";
const modePath = "/tmp/rose-blaxel-harness-mode.json";
const repositoryRoot = path.resolve(import.meta.dirname, "../../../..");
const cli = path.join(repositoryRoot, "scripts/test/cli.mjs");
const children = new Set<ChildProcess>();
const quote = (value: string) => `'${value.replaceAll("'", `'"'"'`)}'`;
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
async function until<T>(probe: () => Promise<T | null | false>, timeout = 120_000): Promise<T> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { const result = await probe(); if (result) return result; await pause(250); }
  throw Error("live harness rendezvous timed out");
}
function readJson(file: string) { return JSON.parse(readFileSync(file, "utf8")); }
async function remoteJson(worker: SandboxInstance, file: string) { try { return JSON.parse(await worker.fs.read(file)); } catch (error: any) { if (error?.status === 404) return null; throw error; } }

function command(root: string, name: string, args: string[], env: NodeJS.ProcessEnv = {}) {
  const log = path.join(root, `${name}.log`);
  const child = spawn(process.execPath, [cli, ...args], { cwd: repositoryRoot, detached: true, env: {...process.env, ...env}, stdio: ["ignore", "pipe", "pipe"] });
  children.add(child);
  const chunks: Buffer[] = [];
  child.stdout!.on("data", data => chunks.push(data)); child.stderr!.on("data", data => chunks.push(data));
  const done = new Promise<number | null>((resolve, reject) => {
    child.on("error", reject);
    child.on("close", code => { children.delete(child); writeFileSync(log, Buffer.concat(chunks)); resolve(code); });
  });
  return {child, done, log};
}
function run(root: string, name: string, selection: string[], gate?: string) {
  const pointer = path.join(root, `${name}.run`);
  const task = command(root, name, ["blaxel", "--pool", pool, ...selection, "--lock-ttl-seconds", "60", "--run-dir-output", pointer], gate ? {TV_TEST_RUNNER_SELFTEST: "1", TV_BLAXEL_DOWNLOAD_GATE: gate} : {});
  return {...task, directory: async () => until(async () => existsSync(pointer) ? readFileSync(pointer, "utf8").trim() : null)};
}
async function poolCommand(root: string, name: string, operation: string) {
  return command(root, name, ["pool", "blaxel", operation, "--pool", pool, ...(operation === "ensure" ? ["--size", "2"] : [])]).done;
}
async function gates(gate: string) {
  return until(async () => [1,2].every(index => existsSync(path.join(gate, `shard-${index}.json`))) ? [1,2].map(index => readJson(path.join(gate, `shard-${index}.json`))) : null);
}
function retained(runDir: string) {
  const summary = readJson(path.join(runDir, "summary.json"));
  const provider = readJson(path.join(runDir, "provider/blaxel/report.json"));
  const normalized = readJson(path.join(runDir, "results.json"));
  return { summary, provider, normalized };
}
function assertDiagnostics(runDir: string, expectedRecovery = false) {
  const {provider, normalized} = retained(runDir);
  const sidecars = [...new Set<string>(normalized.surfaces.flatMap((surface: any) => surface.resourceDiagnosticsPaths ?? []))];
  expect(sidecars.length).toBeGreaterThan(0);
  const records = sidecars.map(file => readJson(path.resolve(runDir, file)));
  for (const record of records) {
    expect(record.identity.runId).toBe(provider.runId);
    expect(record.identity.attemptId).toContain(provider.runId);
    if (record.kind === "surface") {
      expect(record.start).toBeTruthy(); expect(record.end).toBeTruthy();
      expect(["available", "unavailable"]).toContain(record.kernel?.status ?? "unavailable");
    }
  }
  if (expectedRecovery) {
    const receipts = records.filter(record => record.kind === "recovery");
    expect(receipts.length).toBe(2);
    for (const receipt of receipts) { expect(receipt.discardedReports).toBe(true); expect(receipt.cleanup).toBe("confirmed"); expect(receipt.previous.runId).not.toBe(provider.runId); }
  }
  return records;
}

test("qualifies exclusive retrieval, active and quiet recovery, temporary placement, and pool lifecycle", async () => {
  if (process.env.TV_BLAXEL_HARNESS_COORDINATOR !== coordinatorName || process.env.TV_TEST_SHARD_OWNER) throw Error("Run only on the dedicated Blaxel coordinator, outside every leased worker");
  const coordinator = await SandboxInstance.get(coordinatorName);
  expect(coordinator.metadata.labels?.purpose).not.toBe("testshards");
  const root = mkdtempSync(path.join(repositoryRoot, ".test-runs/blaxel-live-"));
  writeFileSync(path.join(root, "identity.json"), JSON.stringify({coordinatorName, pool, revision: readFileSync(path.join(repositoryRoot, ".git/HEAD"), "utf8").trim()}));
  let workers: SandboxInstance[] = [];
  try {
    // The caller retained earlier development reports before this fresh-pool run.
    expect(await poolCommand(root, "initial-delete", "delete")).toBe(0);
    expect(await poolCommand(root, "ensure", "ensure")).toBe(0);
    workers = await listBlaxelPoolSandboxes({pool, arch: "x64", deployedOnly: true});
    expect(workers).toHaveLength(2);
    for (const worker of workers) {
      const setup = "mkdir -p /tmp/television-source-cli-e2e-harness /tmp/television-web-bundle-harness /tmp/tv-testshards/stale-harness /tmp/rose-harness-unrelated /cache/rose-harness; printf fixture > /tmp/television-source-cli-e2e-harness/data; printf fixture > /tmp/television-web-bundle-harness/data; printf keep > /tmp/rose-harness-unrelated/keep; printf keep > /cache/rose-harness/keep";
      const seeded = await worker.process.exec({name: "rose-seed-owned-fixtures", command: `bash -c ${quote(setup)}`, waitForCompletion: true, timeout: 10});
      expect(seeded.exitCode).toBe(0);
      await worker.fs.write(modePath, JSON.stringify({mode: "normal"}));
    }
    const gate = path.join(root, "normal-download"); mkdirSync(gate);
    const first = run(root, "planned", planned, gate);
    const waiting = await gates(gate);
    const before = await Promise.all(workers.map(worker => remoteJson(worker, "/tmp/tv-testshard.lock/owner.json")));
    await until(async () => {
      const after = await Promise.all(workers.map(worker => remoteJson(worker, "/tmp/tv-testshard.lock/owner.json")));
      return after.every((record, index) => record.lastRenewal > before[index].lastRenewal) ? after : null;
    });
    const competed = run(root, "competing", planned);
    expect(await competed.done).not.toBe(0);
    expect(retained(await competed.directory()).summary.run.infraStatus).toBe("incomplete");
    expect(await poolCommand(root, "held-delete", "delete")).toBe(1);
    for (const worker of workers) expect((await remoteJson(worker, "/tmp/tv-testshard.lock/owner.json")).runId).toBe(before[0].runId);
    writeFileSync(path.join(gate, "continue"), "continue");
    expect(await first.done).toBe(1); // intentional native fixture failure
    const firstDir = await first.directory(); const firstResult = retained(firstDir);
    expect(firstResult.summary.run.infraStatus).toBe("completed");
    expect(firstResult.summary.counts.testsFailed).toBe(1); expect(firstResult.summary.counts.testsFlakyRecovered).toBe(1);
    assertDiagnostics(firstDir);
    for (const shard of firstResult.provider.shards) {
      expect(shard.remoteScript).toBe(`${shard.scratch}/worker.sh`);
      expect(shard.setupTimings.some((phase: any) => phase.name === "temporary-cleanup")).toBe(true);
      const artifact = path.join(firstDir, "provider/blaxel/artifacts", `shard-${shard.shardIndex}`);
      const cleanup = readJson(path.join(artifact, "temporary-cleanup.json"));
      expect(cleanup.removed["television-source-cli-e2e-"].directories).toBe(1);
      expect(cleanup.removed["television-web-bundle-"].directories).toBe(1);
      expect(cleanup.removed["stale-scratch"].directories).toBe(1);
      const placement = path.join(artifact, "temporary-placement.json");
      if (existsSync(placement)) expect(readJson(placement).descriptors.some((entry: any) => entry.path.endsWith(" (deleted)"))).toBe(true);
    }
    for (const worker of workers) {
      const ownGate = waiting.find(entry => entry.sandbox === worker.metadata.name)!;
      expect(await remoteJson(worker, "/tmp/tv-testshard.lock/owner.json")).toBeNull();
      await expect(worker.fs.ls(ownGate.scratch)).rejects.toMatchObject({status: 404});
      expect(await worker.fs.read("/tmp/rose-harness-unrelated/keep")).toBe("keep");
      expect(await worker.fs.read("/cache/rose-harness/keep")).toBe("keep");
    }
    const target = run(root, "targeted", targeted);
    expect(await target.done).toBe(1);
    expect(retained(await target.directory()).summary.run.infraStatus).toBe("completed");
    assertDiagnostics(await target.directory());

    for (const scenario of ["active", "quiet"]) {
      for (const worker of workers) await worker.fs.write(modePath, JSON.stringify({mode: scenario === "active" ? "active" : "normal"}));
      const crashGate = path.join(root, `${scenario}-download`); mkdirSync(crashGate);
      const abandoned = run(root, `${scenario}-abandoned`, planned, crashGate);
      let owners: any[];
      if (scenario === "quiet") { await gates(crashGate); owners = await Promise.all(workers.map(worker => remoteJson(worker, "/tmp/tv-testshard.lock/owner.json"))); }
      else owners = await until(async () => {
        const active = await Promise.all(workers.map(worker => remoteJson(worker, `${resultsRoot}/active-fixture.json`)));
        return active.every(Boolean) ? Promise.all(workers.map(worker => remoteJson(worker, "/tmp/tv-testshard.lock/owner.json"))) : null;
      });
      const coordinatorPid = Number(owners[0].owner.split(":").at(-1));
      expect(coordinatorPid).toBeGreaterThan(1); expect(coordinatorPid).not.toBe(process.pid);
      process.kill(coordinatorPid, "SIGKILL"); // actual renewer, not just its shard
      expect(await abandoned.done).not.toBe(0);
      for (const worker of workers) await worker.fs.write(modePath, JSON.stringify({mode: "normal"}));
      await until(async () => Date.now() > Math.max(...owners.map(record => record.recoverAfter)) + 500, 90_000);
      const recovered = run(root, `${scenario}-recovered`, planned);
      expect(await recovered.done).toBe(1);
      const directory = await recovered.directory();
      expect(retained(directory).summary.run.infraStatus).toBe("completed");
      const records = assertDiagnostics(directory, true);
      if (scenario === "active") expect(records.filter(record => record.kind === "recovery").every(record => record.processes.length > 0)).toBe(true);
      writeFileSync(path.join(root, `${scenario}-recovery-evidence.json`), JSON.stringify({owners, recoveredRun: directory}));
    }
    expect(await poolCommand(root, "final-delete", "delete")).toBe(0);
    expect(await listBlaxelPoolSandboxes({pool, arch: "x64"})).toHaveLength(0);
    const absent = run(root, "absent-pool", targeted); expect(await absent.done).not.toBe(0);
    writeFileSync(path.join(root, "completed.json"), JSON.stringify({status: "passed", runs: readdirSync(root).filter(file => file.endsWith(".run"))}));
  } finally {
    const pending = [...children];
    const stopped = Promise.all(pending.map(child => new Promise<void>(resolve => child.once("close", () => resolve()))));
    for (const child of pending) { try { process.kill(-child.pid!, "SIGTERM"); } catch {} }
    await Promise.race([stopped, pause(10_000)]);
    for (const child of children) { try { process.kill(-child.pid!, "SIGKILL"); } catch {} }
    // A valid lease is never bypassed. With our coordinators stopped, the same
    // manager may delete an expired private worker, which is itself cleanup.
    let cleanup = await poolCommand(root, "finally-delete", "delete");
    if (cleanup !== 0) { await pause(65_000); cleanup = await poolCommand(root, "finally-delete-expired", "delete"); }
    writeFileSync(path.join(root, "cleanup.json"), JSON.stringify({exitCode: cleanup}));
  }
});

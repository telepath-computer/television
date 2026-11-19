import { spawn, spawnSync, execFile } from "node:child_process";
import { chownSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, expect, test } from "vitest";
import { workerLeaseCommand, workerEntryCommand, shardScratchPath } from "../../scripts/test/blaxel-worker-lease.mjs";

// Real generated lock command, Linux flock/procfs and disposable files. The
// supplied process IDs substitute only the whole-worker audit's enumeration.
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function fixture(unprivileged = false) {
  // A root Blaxel worker must reproduce the unprivileged CI runner too. Use
  // /tmp directly because the outer shard's private TMPDIR is not traversable.
  const credentials = unprivileged && process.getuid?.() === 0 ? { uid: 65534, gid: 65534 } : {};
  const tmpRoot = mkdtempSync(path.join(unprivileged ? "/tmp" : os.tmpdir(), "lease-seam-")); roots.push(tmpRoot);
  if (credentials.uid !== undefined) chownSync(tmpRoot, credentials.uid, credentials.gid!);
  const input = { lockId: "fixture-lock", runId: "fixture-run", shardIndex: 1, shardTotal: 1, attemptId: "fixture-attempt", owner: "fixture", expiresAt: Math.floor(Date.now() / 1000) + 1200, tmpRoot, resultsRoot: path.join(tmpRoot, "results"), auditPids: [] as number[] };
  const recordPath = path.join(tmpRoot, "tv-testshard.lock", "owner.json");
  const run = (extra = {}) => spawnSync("bash", ["-c", workerLeaseCommand({ ...input, ...extra })], { encoding: "utf8", env: process.env, timeout: 15_000, ...credentials });
  return { input, recordPath, run, record: () => JSON.parse(readFileSync(recordPath, "utf8")) };
}

test.skipIf(process.platform !== "linux")("acquisition writes a renewable deadline and protects the lease from timestamp-only runners", () => {
  const f = fixture();
  const before = Date.now();
  const acquired = f.run();
  expect(acquired.status, acquired.stderr).toBe(0);
  expect(f.record()).toMatchObject({ lockId: f.input.lockId, expiresAt: 0, attemptId: f.input.attemptId });
  expect(f.record().lastRenewal).toBeGreaterThanOrEqual(before);
  expect(f.record().recoverAfter - f.record().lastRenewal).toBe(1_200_000);
});

test.skipIf(process.platform !== "linux")("fixture audit runs without root access to unrelated process environments", async () => {
  const f = fixture(true);
  const ready = path.join(f.input.tmpRoot, "unrelated-ready");
  // A same-user service can be nondumpable too. It belongs outside this
  // fixture's process set even though a user filter would include it.
  const child = process.getuid?.() === 0 ? spawn(process.execPath, ["-e", `process.setgid(65534);process.setuid(65534);require('fs').writeFileSync(${JSON.stringify(ready)},'ready');setInterval(()=>{},1000)`], { stdio: "ignore", env: process.env }) : null;
  try {
    if (child) await until(() => existsSync(ready));
    const acquired = f.run();
    expect(acquired.status, acquired.stderr).toBe(0);
    expect(f.record().lockId).toBe(f.input.lockId);
  } finally { if (child) { child.kill("SIGKILL"); await until(() => child.signalCode !== null); } }
});

test.skipIf(process.platform !== "linux")("an unreadable whole-worker audit preserves the lease and its evidence", () => {
  const f = fixture(true);
  expect(f.run().status).toBe(0);
  const before = readFileSync(f.recordPath, "utf8");
  const sentinel = path.join(f.input.tmpRoot, "television-web-bundle-preserve");
  mkdirSync(sentinel);
  // No fixture scope: production must refuse reuse when ownership is unknown.
  const prepared = f.run({ operation: "prepare", auditPids: undefined });
  expect(prepared.status).toBe(2);
  expect(prepared.stderr).toMatch(/worker owner audit unreadable at PID \d+ \(EACCES\); worker reuse refused/);
  expect(readFileSync(f.recordPath, "utf8")).toBe(before);
  expect(existsSync(sentinel)).toBe(true);
});

test.skipIf(process.platform !== "linux" || process.getuid?.() !== 0)("fixture scope still refuses an unreadable process in its process set", async () => {
  const f = fixture(true);
  const ready = path.join(f.input.tmpRoot, "unreadable-ready");
  // Changing credentials after exec disables dumpability. procfs files become
  // root-owned even though /proc/PID/status still identifies UID 65534.
  const source = `process.setgid(65534);process.setuid(65534);require('fs').writeFileSync(${JSON.stringify(ready)},'ready');setInterval(()=>{},1000)`;
  const child = spawn(process.execPath, ["-e", source], { stdio: "ignore", env: { ...process.env, TV_TEST_SHARD_OWNER: "fixture-lock" } });
  try {
    await until(() => existsSync(ready));
    const acquired = f.run({ auditPids: [child.pid!] });
    expect(acquired.status).toBe(2);
    expect(acquired.stderr).toContain(`worker owner audit unreadable at PID ${child.pid} (EACCES); worker reuse refused`);
    expect(existsSync(f.recordPath)).toBe(false);
  } finally { child.kill("SIGKILL"); await until(() => child.signalCode !== null); }
});

test.skipIf(process.platform !== "linux")("a quiet expired renewable lease recovers through cleanup before replacement", () => {
  const f = fixture();
  mkdirSync(path.dirname(f.recordPath));
  writeFileSync(f.recordPath, JSON.stringify({ lockId: "abandoned", runId: "old-run", shardIndex: 1, attemptId: "old-attempt", expiresAt: 0, lastRenewal: 1, recoverAfter: 2, dispatch: null }));
  const acquired = f.run();
  expect(acquired.status, acquired.stderr).toBe(0);
  expect(f.record().lockId).toBe(f.input.lockId);
  expect(f.record().recovery).toMatchObject({ previous: { lockId: "abandoned", runId: "old-run" }, cleanup: "confirmed", discardedReports: true });
});

test.skipIf(process.platform !== "linux")("renewal and release reject old identities, expiry, and missing retrieval", () => {
  const f = fixture();
  expect(f.run({ ttlSeconds: 60 }).status).toBe(0);
  expect(f.run({ operation: "renew", lockId: "other" }).status).toBe(42);
  expect(f.run({ operation: "release", retrieved: true }).status).toBe(42);
  expect(f.run({ operation: "teardown" }).status).toBe(0);
  expect(f.run({ operation: "release" }).status).toBe(42);
  expect(f.run({ operation: "renew", ttlSeconds: 90 }).status).toBe(0);
  expect(f.record().recoverAfter - f.record().lastRenewal).toBe(90_000);
  writeFileSync(f.recordPath, JSON.stringify({ ...f.record(), recoverAfter: 1 }));
  expect(f.run({ operation: "renew" }).status).toBe(42);
  expect(f.run({ operation: "release", retrieved: true }).status).toBe(42);
});

const exec = promisify(execFile);
async function until(predicate: () => boolean, timeout = 5000) {
  const deadline = Date.now() + timeout;
  while (!predicate()) { if (Date.now() > deadline) throw Error("fixture rendezvous timeout"); await new Promise(resolve => setTimeout(resolve, 25)); }
}
function shell(value: string) { return `'${value.replaceAll("'", `'"'"'`)}'`; }

test.skipIf(process.platform !== "linux")("competing acquisitions serialize, and killing a guard holder releases the OS guard", async () => {
  const f = fixture();
  const command = (lockId: string) => exec("bash", ["-c", workerLeaseCommand({ ...f.input, lockId })], { env: process.env, timeout: 10_000 });
  const outcomes = await Promise.allSettled([command("fixture-lock"), command("new-lock")]);
  expect(outcomes.filter(result => result.status === "fulfilled")).toHaveLength(1);
  const owner = f.record().lockId;
  rmSync(path.dirname(f.recordPath), { recursive: true });
  const ready = path.join(f.input.tmpRoot, "guard-ready");
  const child = spawn("flock", ["-F", path.join(f.input.tmpRoot, "tv-testshard.guard"), process.execPath, "-e", `require('fs').writeFileSync(${JSON.stringify(ready)}, String(process.pid));setInterval(()=>{},1000)`], { detached: true, stdio: "ignore", env: process.env });
  try {
    await until(() => existsSync(ready));
    expect(Number(readFileSync(ready, "utf8"))).toBe(child.pid);
    child.kill("SIGKILL");
    await command(owner);
    expect(f.record().lockId).toBe(owner);
  } finally { try { process.kill(-child.pid!, "SIGKILL"); } catch {} }
});

test.skipIf(process.platform !== "linux")("an obsolete delayed entry cannot touch checkout after recovery", async () => {
  const f = fixture(); const processName = "delayed";
  expect(f.run().status).toBe(0); expect(f.run({ operation: "prepare" }).status).toBe(0);
  const script = path.join(shardScratchPath(f.input), "worker.sh");
  const sentinel = path.join(f.input.tmpRoot, "checkout-touched");
  writeFileSync(script, `touch ${shell(sentinel)}\n`);
  expect(f.run({ operation: "dispatch", processName }).status).toBe(0);
  const entry = workerEntryCommand({ ...f.input, processName }, script);
  expect(f.run({ operation: "teardown" }).status).toBe(42);
  expect(f.run({ operation: "release", retrieved: true }).status).toBe(42);
  // The real entry command is delayed until after the old identity is replaced.
  writeFileSync(f.recordPath, JSON.stringify({ ...f.record(), recoverAfter: 1 }));
  expect(f.run({ lockId: "new-lock", attemptId: "new-attempt" }).status).toBe(0);
  const delayed = spawnSync("bash", ["-c", entry], { encoding: "utf8", timeout: 10_000 });
  expect(delayed.status).not.toBe(0); expect(existsSync(sentinel)).toBe(false);
  expect(f.record().lockId).toBe("new-lock");
});

test.skipIf(process.platform !== "linux")("recovery kills registered descendants by token, including TERM-resistant children, and holds for another owner", async () => {
  const f = fixture(); const processName = "live-fixture";
  expect(f.run().status).toBe(0); expect(f.run({ operation: "prepare" }).status).toBe(0);
  const script = path.join(shardScratchPath(f.input), "worker.sh");
  const ready = path.join(f.input.tmpRoot, "child-ready.json");
  const childSource = `process.on('SIGTERM',()=>{});require('fs').writeFileSync(${JSON.stringify(ready)},JSON.stringify({pid:process.pid,outer:process.env.TV_TEST_SHARD_OWNER,surface:process.env.TV_TEST_SURFACE_OWNER}));setInterval(()=>{},1000)`;
  // A real nested SurfaceSupervisor replaces the surface token but preserves the
  // outer attempt, even with a restricted requested child environment.
  const supervisor = path.join(process.cwd(), "scripts/test/surface-supervisor.mjs");
  const parentSource = `import {SurfaceSupervisor} from ${JSON.stringify(supervisor)};const s=new SurfaceSupervisor({runId:'nested-fixture',surfaceIds:['nested']});await s.run(process.execPath,['-e',${JSON.stringify(childSource)}],{env:{PATH:process.env.PATH}});`;
  writeFileSync(script, `exec ${shell(process.execPath)} --input-type=module -e ${shell(parentSource)}\n`);
  expect(f.run({ operation: "dispatch", processName }).status).toBe(0);
  const child = spawn("bash", ["-c", workerEntryCommand({ ...f.input, processName }, script)], { detached: true, stdio: "ignore", env: process.env });
  const unrelated = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"], { detached: true, stdio: "ignore", env: { ...process.env, TV_TEST_SHARD_OWNER: "unrelated-lock" } });
  try {
    await until(() => existsSync(ready));
    const observed = JSON.parse(readFileSync(ready, "utf8"));
    f.input.auditPids.push(child.pid!, observed.pid, unrelated.pid!);
    expect(observed.outer).toBe(f.input.lockId); expect(observed.surface).toMatch(/^tv1\./);
    expect(f.record().dispatch.pid).toBeGreaterThan(0);
    writeFileSync(f.recordPath, JSON.stringify({ ...f.record(), recoverAfter: 1 }));
    const held = f.run({ lockId: "new-lock", attemptId: "new-attempt" });
    expect(held.status, held.stderr).toBe(42);
    expect(() => process.kill(unrelated.pid!, 0)).not.toThrow();
    const stat = existsSync(`/proc/${observed.pid}/stat`) ? readFileSync(`/proc/${observed.pid}/stat`, "utf8") : "";
    expect(stat === "" || stat.slice(stat.lastIndexOf(")") + 2).startsWith("Z")).toBe(true);
    unrelated.kill("SIGKILL"); await until(() => unrelated.signalCode !== null);
    const acquired = f.run({ lockId: "new-lock", attemptId: "new-attempt" });
    expect(acquired.status, acquired.stderr).toBe(0);
  } finally {
    try { process.kill(-child.pid!, "SIGKILL"); } catch {}
    try { process.kill(-unrelated.pid!, "SIGKILL"); } catch {}
  }
}, 20_000);


test.skipIf(process.platform !== "linux")("attempt identity and recovery evidence survive checkout resetting the result tree", () => {
  const f = fixture();
  mkdirSync(path.dirname(f.recordPath));
  writeFileSync(f.recordPath, JSON.stringify({ lockId: "abandoned", runId: "old-run", attemptId: "old-attempt", expiresAt: 0, lastRenewal: 1, recoverAfter: 2 }));
  expect(f.run().status).toBe(0);
  expect(f.run({ operation: "prepare" }).status).toBe(0);
  rmSync(f.input.resultsRoot, { recursive: true }); // checkout's real reset boundary
  expect(f.run({ operation: "teardown" }).status).toBe(0);
  expect(JSON.parse(readFileSync(path.join(f.input.resultsRoot, "attempt.json"), "utf8"))).toMatchObject({lockId: f.input.lockId, runId: f.input.runId});
  expect(JSON.parse(readFileSync(path.join(f.input.resultsRoot, "resources/recovery.json"), "utf8"))).toMatchObject({previous: {lockId: "abandoned"}, discardedReports: true});
  expect(JSON.parse(readFileSync(path.join(f.input.resultsRoot, "evidence.json"), "utf8")).files).toContain("temporary-cleanup.json");
  expect(existsSync(shardScratchPath(f.input))).toBe(false);
});

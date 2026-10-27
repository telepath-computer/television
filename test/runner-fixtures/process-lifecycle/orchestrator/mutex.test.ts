import { existsSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, test } from "vitest";
import { decodeOwnerToken, processIdentityMatches, readLinuxProcess, scanLinuxProcesses } from "../../../../scripts/test/process-lifecycle.mjs";
import { mutexCheckout, ready, waitFor } from "../../../repo/fixtures/test-runner/mutex-checkout.ts";
import { verifyMutexCheckout } from "../../../repo/fixtures/test-runner/verify-mutex-checkout.ts";

// proofs/arch/test-runner/test-runner.md#^t-runner-lock-faults
// This file belongs only to the isolated-github-only orchestrator surface.
// Never invoke these forced-death fixtures on a developer host or Blaxel.
const waitFlag = "--wait-for-local-test-mutex";
type Identity = { pid: number; startTime: string };

function fixture(verify = false) {
  const f = verify ? verifyMutexCheckout() : mutexCheckout();
  const owners = new Map<number, Identity>();
  const remember = (p: Identity) => owners.set(p.pid, { pid: p.pid, startTime: p.startTime });
  const record = () => {
    const db = new DatabaseSync(f.env.TV_TEST_RUNNER_LOCK_PATH!);
    try {
      const row = db.prepare("SELECT record FROM local_test_mutex WHERE slot=1").get();
      const participants: (Identity & { role: string })[] = row ? JSON.parse(row.record as string).participants : [];
      participants.forEach(remember);
      return participants;
    } finally { db.close(); }
  };
  const originalStart = f.start;
  f.start = (args = f.args, env = {}) => {
    const child = originalStart(args, env);
    remember(readLinuxProcess(child.child.pid!));
    return child;
  };
  const listenerReady = path.join(f.root, "listener.json");
  const termCheck = path.join(f.root, "term-check.json");
  f.write("owned-listener.mjs", `
import { createServer } from 'node:http'; import fs from 'node:fs'; import { spawnSync } from 'node:child_process';
const server = createServer((_req,res)=>res.end('mutex fixture'));
process.on('SIGTERM',()=>{
  const r=spawnSync(process.execPath,${JSON.stringify(["scripts/test/cli.mjs", ...f.args])},{env:{...process.env,TV_TEST_RUNNER_FAKE_LOCAL_PREFLIGHT:'fixture:cleanup contention probe'},encoding:'utf8',timeout:5000});
  fs.writeFileSync(${JSON.stringify(termCheck)},JSON.stringify({status:r.status,output:r.stdout+r.stderr}));
  if(process.env.TV_MUTEX_RESIST_TERM!=='1') server.close(()=>process.exit(0));
});
setTimeout(()=>process.exit(1),60000).unref();
server.listen(0,'127.0.0.1',()=>fs.writeFileSync(${JSON.stringify(listenerReady)},JSON.stringify({pid:process.pid,ownerToken:process.env.TV_TEST_SURFACE_OWNER,port:server.address().port})));
`);
  f.write(f.file, `
import fs from 'node:fs'; import {spawn} from 'node:child_process'; import {test} from 'vitest';
test('owned listener until released',async()=>{
  fs.rmSync(${JSON.stringify(listenerReady)},{force:true});
  const child=spawn(process.execPath,['owned-listener.mjs'],{detached:true,stdio:'ignore',env:process.env});
  const exited=new Promise(resolve=>child.once('exit',resolve)); child.unref();
  const deadline=Date.now()+60000;
  while(!fs.existsSync(${JSON.stringify(listenerReady)})){
    if(Date.now()>deadline) throw new Error('listener readiness timeout');
    await new Promise(resolve=>setTimeout(resolve,20));
  }
  fs.writeFileSync(process.env.TV_MUTEX_READY,String(process.pid));
  while(!fs.existsSync(process.env.TV_MUTEX_RELEASE)){
    if(Date.now()>deadline) throw new Error('native release timeout');
    await new Promise(resolve=>setTimeout(resolve,20));
  }
  child.kill('SIGTERM'); await exited;
},65000);
`);
  async function cleanup() {
    // Independent of the mechanism under test. Capture only this fixture's
    // record, then revalidate exact PID/start identities and owner tokens.
    if (existsSync(f.env.TV_TEST_RUNNER_LOCK_PATH!)) record();
    for (const p of owners.values()) signal(p, "SIGKILL");
    const remaining = () => scanLinuxProcesses().filter(p => {
      const owner = decodeOwnerToken(p.ownerToken);
      const expected = owner && owners.get(owner.supervisorPid);
      return expected && expected.startTime === owner.supervisorStartTime;
    });
    await waitFor(() => {
      const children = remaining();
      for (const child of children) signal(child, "SIGKILL");
      return children.length === 0;
    });
    await f.cleanup();
  }
  return { ...f, record, cleanup, listenerReady, termCheck };
}

function signal(p: Identity, name: NodeJS.Signals) {
  try {
    const current = readLinuxProcess(p.pid);
    if (processIdentityMatches(current, p) && current.state !== "Z") process.kill(p.pid, name);
  } catch (error) { if (!["ESRCH", "ENOENT"].includes((error as NodeJS.ErrnoException).code!)) throw error; }
}
function live(p: Identity) {
  try { const current = readLinuxProcess(p.pid); return current.state !== "Z" && processIdentityMatches(current, p); }
  catch (error) { if (["ESRCH", "ENOENT"].includes((error as NodeJS.ErrnoException).code!)) return false; throw error; }
}
function listener(f: ReturnType<typeof fixture>) {
  return JSON.parse(readFileSync(f.listenerReady, "utf8")) as { pid: number; ownerToken: string; port: number };
}

// Linux evidence only: the isolated workflow uses an ephemeral Ubuntu runner.
describe("local mutex crash recovery", () => {
  test("holds ownership while interrupted descendants shut down", async () => {
    const f = fixture();
    try {
      const holder = f.start(); await ready(holder); f.record();
      const owned = listener(f);
      holder.child.kill("SIGTERM");
      expect(await holder.exited, holder.output()).toBe(143);
      const check = JSON.parse(readFileSync(f.termCheck, "utf8"));
      expect(check.status, check.output).toBe(2);
      expect(check.output).toContain("Local-test mutex held");
      expect(scanLinuxProcesses().filter(p => p.ownerToken === owned.ownerToken)).toEqual([]);
      expect(f.run(f.args, { TV_TEST_RUNNER_FAKE_LOCAL_PREFLIGHT: "fixture:released" }).status).toBe(1);
    } finally { await f.cleanup(); }
  });

  test("keeps a surviving verify test child protected, regardless of record age", async () => {
    const f = fixture(true);
    try {
      const verify = f.start(["verify", "local"]); await ready(verify);
      const child = f.record().find(p => p.role === "run")!;
      expect(child).toBeDefined();
      utimesSync(f.env.TV_TEST_RUNNER_LOCK_PATH!, new Date(0), new Date(0));
      verify.child.kill("SIGKILL"); await verify.exited;
      expect(live(child)).toBe(true);
      expect(f.run(f.args).status).toBe(2);
      const waiter = f.start([...f.args, waitFlag]);
      await waitFor(() => waiter.output().includes("Waiting for local-test mutex"), waiter.output);
      expect(existsSync(waiter.ready)).toBe(false);
      writeFileSync(verify.release, "done");
      await waitFor(() => !live(child));
      await ready(waiter); writeFileSync(waiter.release, "done");
      expect(await waiter.exited, waiter.output()).toBe(0);
    } finally { await f.cleanup(); }
  });

  test.each([false, true])("reaps abandoned owned processes and fails before new work (waiting=%s)", async waiting => {
    const f = fixture();
    try {
      const holder = f.start(f.args, { TV_MUTEX_RESIST_TERM: "1" }); await ready(holder); f.record();
      const owned = listener(f);
      const waiter = waiting ? f.start([...f.args, waitFlag]) : null;
      if (waiter) await waitFor(() => waiter.output().includes("Waiting for local-test mutex"), waiter.output);
      holder.child.kill("SIGKILL"); await holder.exited;
      const recovery = waiter ?? f.start();
      expect(await recovery.exited, recovery.output()).toBe(1);
      expect(recovery.output()).toContain("stale owner process");
      expect(existsSync(recovery.ready)).toBe(false);
      expect(scanLinuxProcesses().filter(p => p.ownerToken === owned.ownerToken)).toEqual([]);
      const later = f.run(f.args, { TV_TEST_RUNNER_FAKE_LOCAL_PREFLIGHT: "fixture:clean invocation admitted" });
      expect(later.status, later.stdout + later.stderr).toBe(1);
      expect(later.stderr).toContain("clean invocation admitted");
      expect(later.stdout + later.stderr).not.toContain("Detected and reaped");
    } finally { await f.cleanup(); }
  });
});

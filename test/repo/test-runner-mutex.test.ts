import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { mutexCheckout, ready, waitFor } from "./fixtures/test-runner/mutex-checkout.ts";

const bypass = "--against-test-guidance-major-host-contention-and-oom-killed-processes";
const wait = "--wait-for-local-test-mutex";
const broad = "--against-test-guidance-broad-local-run";

describe("local test mutex", () => {
  // proofs/arch/test-runner/test-runner.md#^t-runner-guidance-usage
  test("explains mutex choices and refuses valued flags", async () => {
    const f = mutexCheckout();
    try {
      const help = f.run(["help"]);
      for (const word of [wait, bypass, "same operating-system user", "caller", "SIGINT", "SIGTERM"])
        expect(help.stdout).toContain(word);
      for (const flag of [wait, bypass]) for (const value of ["=false", "=0"])
        expect(f.run([...f.args, flag + value]).status).toBe(2);
    } finally { await f.cleanup(); }
  });

  // proofs/arch/test-runner/test-runner.md#^t-runner-lock-location
  test("resolves one production path without acquiring it, across HOME and TMP overrides", async () => {
    const a = mutexCheckout(); const b = mutexCheckout();
    try {
      const expected = path.join(os.userInfo().homedir, ".cache/television/local-test-mutex.sqlite3");
      for (const f of [a, b]) {
        const result = f.run(f.args, { TV_TEST_RUNNER_LOCK_PATH: "", TV_TEST_RUNNER_DRY_RUN: "1", TMPDIR: f.home });
        expect(result.status, result.stderr).toBe(0);
        expect(result.stdout).toContain(`mutex=${expected}`);
      }
    } finally { await a.cleanup(); await b.cleanup(); }
  });

  // proofs/arch/test-runner/test-runner.md#^t-runner-lock-contention
  test("refuses a contender before preflight while naming the live holder", async () => {
    const f = mutexCheckout();
    try {
      const holder = f.start(); await ready(holder);
      const result = f.run(f.args, { TV_TEST_RUNNER_FAKE_LOCAL_PREFLIGHT: "fixture:must-not-run" });
      expect(result.status, result.stdout + result.stderr).toBe(2);
      for (const text of [String(holder.child.pid), f.root, "cli.mjs", wait, bypass, "OOM", "another agent"]) expect(result.stderr).toContain(text);
      expect(result.stderr).not.toContain("must-not-run");
      writeFileSync(holder.release, "done");
      expect(await holder.exited, holder.output()).toBe(0);
      expect(f.run(f.args).status).toBe(0);
    } finally { await f.cleanup(); }
  });

  // proofs/arch/test-runner/test-runner.md#^t-runner-lock-wait
  test("waits without starting native work, then acquires after release", async () => {
    const f = mutexCheckout();
    try {
      const holder = f.start(); await ready(holder);
      const waiter = f.start([...f.args, wait]);
      await waitFor(() => waiter.output().includes("Waiting for local-test mutex"), waiter.output);
      expect(existsSync(waiter.ready)).toBe(false);
      writeFileSync(holder.release, "done"); expect(await holder.exited).toBe(0);
      await ready(waiter); writeFileSync(waiter.release, "done");
      expect(await waiter.exited, waiter.output()).toBe(0);
    } finally { await f.cleanup(); }
  });

  // proofs/arch/test-runner/test-runner.md#^t-runner-wait-cancel
  test.each([["SIGINT", 130], ["SIGTERM", 143]] as const)("cancels only the waiter on %s", async (signal, code) => {
    const f = mutexCheckout();
    try {
      const holder = f.start(); await ready(holder);
      const waiter = f.start([...f.args, wait]);
      await waitFor(() => waiter.output().includes("Waiting for local-test mutex"), waiter.output);
      waiter.child.kill(signal);
      expect(await waiter.exited, waiter.output()).toBe(code);
      expect(existsSync(waiter.ready)).toBe(false);
      expect(f.run(f.args).status).toBe(2);
    } finally { await f.cleanup(); }
  });

  // proofs/arch/test-runner/test-runner.md#^t-runner-lock-bypass
  test("bypasses occupied ownership without replacing it, and claims a free mutex", async () => {
    const f = mutexCheckout();
    try {
      const holder = f.start([...f.args, bypass]); await ready(holder);
      expect(f.run(f.args).status).toBe(2);
      expect(f.run([...f.args, bypass]).status).toBe(0);
      expect(f.run(f.args).status).toBe(2);
      writeFileSync(path.join(f.home, ".tvdev-use-blaxel"), "");
      expect(f.run(["local", "--surface", f.surface.id, bypass]).stderr).toContain("one test file");
      expect(f.run(["local", "--surface", f.surface.id, broad]).stderr).toContain("mutex");
      expect(f.run([...f.args, bypass, wait]).status).toBe(2);
    } finally { await f.cleanup(); }
  });

  // proofs/arch/test-runner/test-runner.md#^t-runner-lock-record
  // proofs/arch/test-runner/test-runner.md#^t-runner-lock-dead-owner
  test.each([false, true])("reclaims a compatible record for an exited process (wait=%s)", async waiting => {
    const f = mutexCheckout();
    try {
      const exited = JSON.parse(execFileSync(process.execPath, ["--input-type=module", "-e", `
        import { readLinuxProcess, readMacOSProcesses } from './scripts/test/process-lifecycle.mjs';
        const p = process.platform === 'linux' ? readLinuxProcess(process.pid) : readMacOSProcesses().find(p => p.pid === process.pid);
        console.log(JSON.stringify({pid:p.pid,startTime:p.startTime}));
      `], { cwd: f.root, encoding: "utf8" }));
      const db = new DatabaseSync(f.env.TV_TEST_RUNNER_LOCK_PATH!);
      db.exec("CREATE TABLE local_test_mutex (slot INTEGER PRIMARY KEY CHECK(slot=1), record TEXT NOT NULL)");
      db.prepare("INSERT INTO local_test_mutex VALUES(1,?)").run(JSON.stringify({ version: 1, id: "exited-fixture", participants: [{ ...exited, role: "run", command: "fixture exited normally", checkout: f.root }] }));
      const holder = f.start([...f.args, ...(waiting ? [wait] : [])]); await ready(holder);
      const record = JSON.parse(db.prepare("SELECT record FROM local_test_mutex WHERE slot=1").get()!.record as string);
      expect(record).toEqual({ version: 1, id: expect.any(String), participants: [{ pid: holder.child.pid, startTime: expect.any(String), role: "run", command: expect.stringContaining("cli.mjs local --file"), checkout: f.root }] });
      expect(record.id).not.toBe("exited-fixture");
      writeFileSync(holder.release, "done"); expect(await holder.exited).toBe(0);
      expect(db.prepare("SELECT * FROM local_test_mutex").all()).toEqual([]);
      db.close();
    } finally { await f.cleanup(); }
  });

  // proofs/arch/test-runner/test-runner.md#^t-runner-lock-contention
  test("admits only one of simultaneous real acquisitions", async () => {
    const f = mutexCheckout();
    try {
      const a = f.start(); const b = f.start();
      await waitFor(() => [a,b].some(c => c.child.exitCode === 2) && [a,b].some(c => existsSync(c.ready)), () => a.output() + b.output());
      expect([a,b].filter(c => existsSync(c.ready))).toHaveLength(1);
      writeFileSync(a.release, "done"); writeFileSync(b.release, "done");
      expect((await Promise.all([a.exited,b.exited])).sort()).toEqual([0,2]);
    } finally { await f.cleanup(); }
  });

  // proofs/arch/test-runner/test-runner.md#^t-runner-lock-release
  test("holds through Vite service teardown and releases after native and preflight failures", async () => {
    const f = mutexCheckout();
    try {
      f.write("service.config.ts", `import { spawnSync } from 'node:child_process'; import fs from 'node:fs';
        export default { plugins: [{ name: 'observe-lock-at-close', closeBundle() {
          const r = spawnSync(process.execPath, ${JSON.stringify(["scripts/test/cli.mjs", ...f.args])}, {env:{...process.env,TV_TEST_RUNNER_FAKE_LOCAL_PREFLIGHT:'fixture:must-not-start'},encoding:'utf8'});
          fs.writeFileSync('service-close.json',JSON.stringify({status:r.status,stderr:r.stderr}));
        }}] };
      `);
      f.surface.services = [{ id: "teardown", kind: "vite", config: "service.config.ts", publishUrlEnv: "TV_MUTEX_SERVICE_URL" }];
      f.writeRegistry();
      for (const failed of [false, true]) {
        const result = f.run(f.args, { TV_MUTEX_FAIL: failed ? "1" : "0" });
        expect(result.status, result.stdout + result.stderr).toBe(failed ? 1 : 0);
        const close = JSON.parse(readFileSync(path.join(f.root, "service-close.json"), "utf8"));
        expect(close.status, close.stderr).toBe(2);
        expect(close.stderr).toContain("Local-test mutex held");
      }
      expect(f.run(f.args, { TV_TEST_RUNNER_FAKE_LOCAL_PREFLIGHT: "fixture:expected failure" }).status).toBe(1);
      expect(f.run(f.args).status).toBe(0);
    } finally { await f.cleanup(); }
  });

  // proofs/arch/test-runner/test-runner.md#^t-runner-lock-exemptions
  test("keeps informational and remote preflight paths exempt on a marked home", async () => {
    const f = mutexCheckout();
    try {
      writeFileSync(path.join(f.home, ".tvdev-use-blaxel"), "");
      const holder = f.start(); await ready(holder);
      for (const args of [["help"], ["list", "--surface", f.surface.id], ["verify", "local", broad, "--plan"]]) expect(f.run(args).status).toBe(0);
      expect(f.run(f.args, { TV_TEST_RUNNER_DRY_RUN: "1" }).status).toBe(0);
      const preflight = f.run(["preflight", "--provider", "local", "--surface", f.surface.id], { TV_TEST_RUNNER_FAKE_LOCAL_PREFLIGHT: "fixture:reached local check" });
      expect(preflight.status, preflight.stderr).toBe(1);
      expect(preflight.stdout + preflight.stderr).toContain("reached local check");
      const remote = f.run(["blaxel", "--surface", f.surface.id], { TV_TEST_RUNNER_FAKE_REMOTE_PREFLIGHT: "blaxel:fixture:reached remote check" });
      expect(remote.status, remote.stderr).toBe(2);
      expect(remote.stdout + remote.stderr).toContain("reached remote check");
      for (const args of [["local", "--surface", f.surface.id, wait], [...f.args, "--surface", "missing", wait], [...f.args, "--retries", "bad", wait], ["local", "--surface", f.surface.id, broad, "--retries", "0", wait]]) {
        const result = f.run(args);
        expect(result.status, result.stderr).toBe(2);
        expect(result.stderr).not.toContain("Waiting for local-test mutex");
      }
      f.surface.tags.push("isolated-github-only"); f.writeRegistry();
      const placement = f.run([...f.args, wait], { GITHUB_ACTIONS: "" });
      expect(placement.status, placement.stderr).toBe(2);
      expect(placement.stderr).toContain("isolated-github-only");
      expect(placement.stderr).not.toContain("Waiting for local-test mutex");

    } finally { await f.cleanup(); }
  });

  // proofs/arch/test-runner/test-runner.md#^t-runner-lock-selftest
  test("gates private locations and isolates independent scenarios", async () => {
    const a = mutexCheckout(); const b = mutexCheckout();
    try {
      for (const gate of ["", "0", "true"]) expect(a.run(a.args, { TV_TEST_RUNNER_SELFTEST: gate }).status).toBe(2);
      const first = a.start(); const second = b.start(); await ready(first); await ready(second);
      expect(first.output()).toContain("WARNING: TV_TEST_RUNNER_LOCK_PATH");
      expect(second.output()).toContain("WARNING: TV_TEST_RUNNER_LOCK_PATH");
      const marked = a.run(a.args, { HOME: b.home });
      expect(marked.status, marked.stderr).toBe(2);
    } finally { await a.cleanup(); await b.cleanup(); }
  });
});

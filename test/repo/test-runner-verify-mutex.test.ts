import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { ready, waitFor } from "./fixtures/test-runner/mutex-checkout.ts";
import { verifyMutexCheckout } from "./fixtures/test-runner/verify-mutex-checkout.ts";

const broad = "--against-test-guidance-broad-local-run";
const bypass = "--against-test-guidance-major-host-contention-and-oom-killed-processes";
const wait = "--wait-for-local-test-mutex";

describe("local verify mutex", () => {
  // proofs/arch/test-runner/test-runner.md#^t-runner-verify-lock
  test("protects phases and admits only the direct test child on a marked home", async () => {
    const f = verifyMutexCheckout();
    try {
      writeFileSync(path.join(f.home, ".tvdev-use-blaxel"), "");
      const verify = f.start(["verify", "local", broad]); await ready(verify);
      expect(f.run(f.args).status).toBe(2);
      writeFileSync(verify.release, "done");
      expect(await verify.exited, verify.output()).toBe(0);
      expect(verify.output()).toContain("verify passed (local)");
      for (const phase of ["lint", "type-check", "lint:package-manifests", "tests", "vibe-mode"]) {
        const result = JSON.parse(readFileSync(path.join(f.root, `phase-${phase}.json`), "utf8"));
        expect(result.status, `${phase}: ${result.output}`).toBe(2);
        expect(result.output).toContain("Local-test mutex held");
      }
      const failedPreflight = f.run(f.args, { TV_TEST_RUNNER_FAKE_LOCAL_PREFLIGHT: "fixture:released verify" });
      expect(failedPreflight.status, failedPreflight.stderr).toBe(1);
    } finally { await f.cleanup(); }
  });

  // proofs/arch/test-runner/test-runner.md#^t-runner-lock-wait
  test("waits before any verify phase, then shares ownership with its child", async () => {
    const f = verifyMutexCheckout();
    try {
      // This command holds only the small authored native fixture.
      const holder = f.start(); await ready(holder);
      const verify = f.start(["verify", "local", wait]);
      await waitFor(() => verify.output().includes("Waiting for local-test mutex"), verify.output);
      expect(verify.output()).not.toContain("[verify:preflight]");
      writeFileSync(holder.release, "done"); expect(await holder.exited, holder.output()).toBe(0);
      await ready(verify); writeFileSync(verify.release, "done");
      expect(await verify.exited, verify.output()).toBe(0);
    } finally { await f.cleanup(); }
  });

  // proofs/arch/test-runner/test-runner.md#^t-runner-wait-cancel
  test.each([["SIGINT",130],["SIGTERM",143]] as const)("cancels a verify wait with %s before phases", async(signal,status)=>{
    const f=verifyMutexCheckout();
    try {
      const holder=f.start(); await ready(holder);
      const verify=f.start(["verify","local",wait]);
      await waitFor(()=>verify.output().includes("Waiting for local-test mutex"),verify.output);
      verify.child.kill(signal); expect(await verify.exited).toBe(status);
      expect(verify.output()).not.toContain("[verify:preflight]");
      expect(f.run(f.args).status).toBe(2);
    } finally { await f.cleanup(); }
  });

  // proofs/arch/test-runner/test-runner.md#^t-runner-verify-lock
  test("forwards deliberate contention and breadth options to the real test child", async()=>{
    const f=verifyMutexCheckout();
    try {
      writeFileSync(path.join(f.home,".tvdev-use-blaxel"),"");
      const holder=f.start(); await ready(holder);
      const verify=f.start(["verify","local",broad,bypass]); await ready(verify);
      writeFileSync(verify.release,"done"); expect(await verify.exited,verify.output()).toBe(0);
      expect(verify.output()).toContain(bypass);
      expect(f.run(f.args).status).toBe(2);
    } finally { await f.cleanup(); }
  });

  // proofs/arch/test-runner/test-runner.md#^t-runner-lock-release
  test("holds during a non-test phase and releases after that phase fails", async()=>{
    const f=verifyMutexCheckout();
    try {
      const verify=f.start(["verify","local"],{TV_MUTEX_HOLD_PHASE:"lint",TV_MUTEX_FAIL_PHASE:"lint"}); await ready(verify);
      expect(f.run(f.args).status).toBe(2);
      expect(existsSync(path.join(f.root,"phase-tests.json"))).toBe(false);
      writeFileSync(verify.release,"done"); expect(await verify.exited,verify.output()).toBe(1);
      expect(f.run(f.args,{TV_TEST_RUNNER_FAKE_LOCAL_PREFLIGHT:"fixture:released"}).status).toBe(1);
    } finally { await f.cleanup(); }
  });
});

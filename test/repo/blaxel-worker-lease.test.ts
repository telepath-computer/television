import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, test } from "vitest";
import { workerLeaseCommand } from "../../scripts/test/blaxel-worker-lease.mjs";

// Real generated lock command, Linux flock/procfs and disposable files. The
// fixture-token filter substitutes only the whole-worker audit's scope.
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function fixture() {
  const tmpRoot = mkdtempSync(path.join(os.tmpdir(), "lease-seam-")); roots.push(tmpRoot);
  const input = { lockId: "fixture-lock", runId: "fixture-run", shardIndex: 1, shardTotal: 1, attemptId: "fixture-attempt", owner: "fixture", expiresAt: Math.floor(Date.now() / 1000) + 1200, tmpRoot, resultsRoot: path.join(tmpRoot, "results"), auditTokens: ["fixture-lock"] };
  const recordPath = path.join(tmpRoot, "tv-testshard.lock", "owner.json");
  const run = (extra = {}) => spawnSync("bash", ["-c", workerLeaseCommand({ ...input, ...extra })], { encoding: "utf8", env: process.env, timeout: 15_000 });
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

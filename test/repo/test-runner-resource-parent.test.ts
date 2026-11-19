import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "vitest";
import { createFixture, read, readDiagnostics } from "../fixtures/resource-diagnostics/parent-fixture.ts";

// The interrupted-parent case kills its supervisor, so it runs only in the
// isolated experiment:lifecycle-interrupted-parent surface.
for (const entry of ["planned", "targeted"] as const) {
  test(`${entry} parent retains real Linux observations around preparation, recovered native attempts and teardown`, { timeout: 30_000 }, () => {
    const fixture = createFixture(entry, "retry");
    try {
      const result = spawnSync(process.execPath, fixture.args, { encoding: "utf8", env: fixture.env, timeout: 25_000 });
      expect(result.status, result.stderr).toBe(0);
      const prepared = read(path.join(fixture.dir, "preparation.json"));
      expect(prepared.records).toHaveLength(1);
      expect(prepared.records[0].end.status).toBe("missing");
      const record = readDiagnostics(fixture.dir)[0];
      expect(record.identity).toMatchObject({ runId: "resource-parent-run", attemptId: "resource-parent-attempt", shardIndex: 1, surfaceId: "fixture:resources" });
      expect(Date.parse(record.start.observedAt)).toBeLessThanOrEqual(Date.parse(prepared.observedAt));
      expect(Date.parse(record.end.observedAt)).toBeGreaterThanOrEqual(Date.parse(read(path.join(fixture.dir, "teardown.json")).observedAt));
      expect(record.start.memoryAvailable).toMatchObject({ unit: "bytes", source: "/proc/meminfo:MemAvailable" });
      expect(record.start.sharedMemoryUsed).toMatchObject({ unit: "bytes", source: "/proc/meminfo:Shmem" });
      expect(record.start.temporaryFree).toMatchObject({ unit: "bytes", source: "statfs", path: fixture.dir });
      expect(record.start.oomKills).toMatchObject({ unit: "count", source: "/proc/vmstat:oom_kill" });
      for (const key of ["memoryAvailable", "sharedMemoryUsed", "temporaryFree", "oomKills"]) {
        const probe = record.start[key];
        if (probe.value === null) expect(probe.reason).toEqual(expect.any(String));
        else expect(probe.value).toBeGreaterThanOrEqual(0);
      }
      expect(record.nativeEvidence).toMatchObject({ status: "complete", failedAttempt: true, recovered: true });
      expect(["available", "unavailable"]).toContain(record.kernel.status);
      if (record.kernel.status === "unavailable") {
        // Expected host limitations stay unknown; malformed reader invocations
        // must not masquerade as a successful probe of this installed tool.
        expect(["EPERM", "EACCES", "ENOENT", "ENOTSUP", "ETIMEDOUT", "ENOBUFS"]).toContain(record.kernel.reason);
      }
      const resultRecord = entry === "planned" ? read(path.join(fixture.dir, "results/shard-1.json")).tasks[0] : read(path.join(fixture.dir, "results/lifecycle.json"));
      expect(resultRecord.resourceDiagnosticsPaths).toHaveLength(1);
      expect(existsSync(resultRecord.resourceDiagnosticsPaths[0])).toBe(true);
      expect(resultRecord.processLeaks).toEqual([]);
      const attemptPath = path.resolve(path.dirname(resultRecord.resourceDiagnosticsPaths[0]), record.nativeEvidence.attemptResultPath);
      const attempts = readFileSync(attemptPath, "utf8").trim().split("\n").map((line) => JSON.parse(line));
      expect(attempts.map((row: any) => row.status)).toEqual(["failed", "passed"]);
    } finally { fixture.cleanup(); }
  });
}

test("targeted parent preserves a baseline after the installed native runner exits before its report", { timeout: 20_000 }, () => {
  const fixture = createFixture("targeted", "exit");
  try {
    const result = spawnSync(process.execPath, fixture.args, { encoding: "utf8", env: fixture.env, timeout: 15_000 });
    expect(result.status, result.stderr).toBe(17);
    expect(read(path.join(fixture.dir, "preparation.json")).records).toHaveLength(1);
    const record = readDiagnostics(fixture.dir)[0];
    expect(record).toMatchObject({ end: { status: "observed" }, nativeEvidence: { status: "missing" } });
    expect(existsSync(path.join(fixture.dir, "results/native.json"))).toBe(false);
  } finally { fixture.cleanup(); }
});

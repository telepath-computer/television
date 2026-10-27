import { copyFileSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, test } from "vitest";
import { startResourceDiagnostics, writeResourceDiagnostic } from "../../scripts/test/resource-diagnostics.mjs";

const roots: string[] = [];
const identity = { runId: "run-one", shardIndex: 1, attemptId: "lock-one", surfaceId: "e2e:fixture" };
const startTime = "2026-10-27T00:00:00.000Z";
const endTime = "2026-10-27T00:00:01.000Z";
const secret = "credential-query-body-environment-argument-SENTINEL";
const temporary = () => { const dir = mkdtempSync(path.join(os.tmpdir(), "tv-resource-contract-")); roots.push(dir); return dir; };
const read = (file: string | null) => JSON.parse(readFileSync(file!, "utf8"));
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

test("retains a baseline, honest units and reset evidence, and kernel evidence for a recovered native attempt", () => {
  const root = temporary();
  const nativeResultPath = path.join(root, "native.json");
  copyFileSync("test/repo/fixtures/test-runner/playwright-retry.json", nativeResultPath);
  let ended = false;
  const probes: Array<[string, unknown]> = [];
  const collector = startResourceDiagnostics({
    root, identity: { ...identity, env: secret, args: [secret] }, now: () => new Date(ended ? endTime : startTime),
    readProbe: (name, interval) => {
      probes.push([name, interval]);
      if (name === "temporaryFree") throw Object.assign(new Error(secret), { code: "EACCES" });
      if (name === "oomKills") return ended ? 2 : 10;
      if (name === "kernelOOM") return { lines: [`2026-10-27T00:00:00,500000+00:00 Out of memory: Killed process 23 (node) total-vm:4096kB ${secret}`] };
      return 4096;
    },
    warn: () => {},
  });
  expect(read(collector.file)).toMatchObject({ identity, start: { observedAt: startTime, memoryAvailable: { value: 4096, unit: "bytes", source: "/proc/meminfo:MemAvailable" }, temporaryFree: { value: null, reason: "EACCES" } }, end: { status: "missing" } });
  ended = true;
  expect(collector.finish({ runner: "playwright", nativeResultPath, exitCode: 0 })).toEqual([collector.file]);
  const record = read(collector.file);
  expect(record).toMatchObject({ end: { observedAt: endTime }, oomDelta: { value: null, reason: "counter-reset" }, nativeEvidence: { status: "complete", failedAttempt: true, recovered: true }, kernel: { status: "available" } });
  expect(probes.find(([name]) => name === "kernelOOM")?.[1]).toMatchObject({ since: startTime, until: endTime });
  expect(record.kernel.lines.join("\n")).toContain("Killed process 23 (node)");
  expect(JSON.stringify(record)).not.toContain(secret);
});

test("requests kernel evidence for missing output and preserves unavailable probes without zeroes", () => {
  const root = temporary();
  const warnings: string[] = [];
  const collector = startResourceDiagnostics({ root, identity, warn: (message) => warnings.push(message), readProbe: () => { throw Object.assign(new Error(secret), { code: "EPERM" }); } });
  collector.finish({ runner: "vitest", nativeResultPath: path.join(root, "absent.json"), exitCode: 17 });
  const record = read(collector.file);
  expect(record).toMatchObject({ nativeEvidence: { status: "missing", failedAttempt: null }, start: { oomKills: { value: null, unit: "count", reason: "EPERM" } }, end: { memoryAvailable: { value: null } }, kernel: { status: "unavailable", reason: "EPERM" }, oomDelta: { value: null, reason: "unavailable" } });
  expect(warnings.length).toBeGreaterThan(0);
  expect(warnings.join("\n")).not.toContain(secret);
});

test("bounds sidecars and the attempt including receipts, reserving compact observations before excerpts", () => {
  const root = temporary();
  const warnings: string[] = [];
  const native = path.join(root, "native.json");
  copyFileSync("test/repo/fixtures/test-runner/playwright-retry.json", native);
  const collector = startResourceDiagnostics({ root, identity, warn: (message) => warnings.push(message), readProbe: (name) => name === "kernelOOM" ? { lines: Array.from({ length: 8000 }, () => "Out of memory: Killed process 23 (node) total-vm:4096kB")} : 1 });
  collector.finish({ runner: "playwright", nativeResultPath: native, exitCode: 0 });
  const record = read(collector.file);
  expect(record.start.memoryAvailable.value).toBe(1);
  expect(record.end.memoryAvailable.value).toBe(1);
  expect(record.kernel.truncated).toBe(true);
  expect(Buffer.byteLength(record.kernel.lines.join("\n"))).toBeLessThanOrEqual(64 * 1024);
  expect(statSync(collector.file!).size).toBeLessThanOrEqual(128 * 1024);
  const receipt = { kind: "recovery", identity, previous: { runId: "old", lockId: "old-lock", worker: "private-worker", lastRenewal: startTime, recoverAfter: endTime, args: secret }, discardedReports: true, cleanup: "confirmed", processes: Array.from({ length: 3000 }, (_, i) => ({ pid: i + 1, startTime: "123", command: "node", outcome: "terminated", args: secret })), env: secret };
  for (let i = 0; i < 80; i++) writeResourceDiagnostic(root, `receipt-${i}`, receipt, { warn: (message) => warnings.push(message) });
  const files = readdirSync(path.join(root, "resources")).map((name) => path.join(root, "resources", name));
  expect(files.reduce((sum, file) => sum + statSync(file).size, 0)).toBeLessThanOrEqual(8 * 1024 * 1024);
  expect(files.every((file) => statSync(file).size <= 128 * 1024)).toBe(true);
  expect(files.every((file) => !readFileSync(file, "utf8").includes(secret))).toBe(true);
  expect(read(collector.file).end.memoryAvailable.value).toBe(1);
  expect(warnings.length).toBeGreaterThan(0);
});

test("diagnostic write failure warns and returns no unretained link without throwing over a native outcome", () => {
  const root = temporary();
  const warnings: string[] = [];
  const collector = startResourceDiagnostics({ root, identity, readProbe: () => 1, write: () => { throw Object.assign(new Error(secret), { code: "ENOSPC" }); }, warn: (message) => warnings.push(message) });
  expect(collector.finish({ runner: "vitest", nativeResultPath: null, exitCode: 17 })).toEqual([]);
  expect(collector.file === null || !existsSync(collector.file)).toBe(true);
  expect(warnings.join("\n")).toContain("ENOSPC");
  expect(warnings.join("\n")).not.toContain(secret);
});

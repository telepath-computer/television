import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test } from "vitest";
import { combineAttemptReports, compactProviderSummary, summarizeInfrastructureAttempts } from "../../scripts/test/provider-outputs.mjs";
import { normalizeProviderShardSurfaces } from "../../scripts/test/provider-normalization.mjs";
import { buildReports } from "../../scripts/test/reporting.mjs";
import { buildTimingEvents, serializeTimingEvents } from "../../scripts/test/timing-events.mjs";

const surfaces = [{ id: "e2e:fixture", runner: "playwright", roots: ["probe.test.ts"], cwd: "." }] as any;
const start = "2026-10-27T00:00:00.000Z";
const end = "2026-10-27T00:00:01.000Z";

test("keeps only retained resource links across infrastructure replacement, normalization and final reporting", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "tv-resource-links-"));
  try {
    const attempts = [0, 1].map((index) => {
      const dir = path.join(root, `attempt-${index}`); mkdirSync(dir);
      const diagnostic = path.join(dir, "resources.json");
      writeFileSync(diagnostic, JSON.stringify({ identity: { attemptId: index }, start: { memoryAvailable: { value: 12345 } }, kernel: { lines: ["KERNEL-DETAIL-SENTINEL"] } }));
      const native = path.join(dir, "native.json"); copyFileSync("test/repo/fixtures/test-runner/playwright-retry.json", native);
      return { status: index === 0 ? "failed" : "passed", startedAt: start, completedAt: end, shardIndices: [1], outputDir: dir, shards: [{ shardIndex: 1, status: index === 0 ? "infra-failed" : "passed", resourceDiagnosticsPaths: [diagnostic], outputDir: dir, tasks: [{ surfaceId: "e2e:fixture", runner: "playwright", status: "passed", exitCode: 0, durationMs: 25, nativeResultPath: native, resourceDiagnosticsPaths: [diagnostic, path.join(dir, "missing.json")] }] }] } as any;
    });
    const combined = combineAttemptReports(attempts, [1], { shardTotal: 1, outputDir: root });
    expect(combined.status).toBe("passed");
    const history = summarizeInfrastructureAttempts(attempts) as any[];
    expect(history[0].shards[0].resourceDiagnosticsPaths).toEqual([path.join(root, "attempt-0/resources.json")]);
    const normalized = normalizeProviderShardSurfaces({ provider: "blaxel", providerSummary: combined, outputDir: root, surfaces, delegatedCommand: ["coordinator"], exitCode: 0, coordinatorLogPath: path.join(root, "coordinator.log") });
    expect(normalized).toHaveLength(1);
    expect(normalized[0].counts.testsFlakyRecovered).toBe(1);
    expect(normalized[0].failedTests).toEqual([]);
    const { results, summary } = buildReports({ runId: "resource-run", provider: "blaxel", runDir: root, selection: { surfaces: ["e2e:fixture"] }, surfaces: normalized, startedAt: start, completedAt: end });
    expect(results.surfaces[0].resourceDiagnosticsPaths).toEqual(["attempt-0/resources.json", "attempt-1/resources.json"]);
    for (const link of results.surfaces[0].resourceDiagnosticsPaths as string[]) expect(existsSync(path.join(root, link))).toBe(true);
    expect(summary.run.status).toBe("passed");
    const events = serializeTimingEvents(buildTimingEvents({ run: { id: "resource-run", commandProvider: "blaxel", timingProvider: "blaxel-playwright-x64-4vcpu", status: "passed", startedAt: start, completedAt: end, durationMs: 1000, selection: { surfaces: ["e2e:fixture"] }, git: { commit: null, tree: null, dirty: false }, environment: { ci: true, os: "linux", arch: "x64", node: process.version }, phases: [] }, shards: [{ index: 1, total: 1, status: "passed", phases: [], surfaces: normalized as any }] }));
    for (const compact of [JSON.stringify(summary), JSON.stringify(compactProviderSummary(combined)), events]) {
      expect(compact).not.toContain("KERNEL-DETAIL-SENTINEL");
      expect(compact).not.toContain("memoryAvailable");
    }
    expect(readFileSync(path.join(root, "attempt-0/resources.json"), "utf8")).toContain("KERNEL-DETAIL-SENTINEL");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("baseline-only provider evidence cannot manufacture a selected-surface outcome", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "tv-resource-missing-"));
  try {
    const diagnostic = path.join(root, "baseline.json"); writeFileSync(diagnostic, JSON.stringify({ end: { status: "missing" } }));
    const normalized = normalizeProviderShardSurfaces({ provider: "blaxel", providerSummary: { status: "failed", shards: [{ shardIndex: 1, status: "infra-failed", resourceDiagnosticsPaths: [diagnostic], tasks: [] }] }, outputDir: root, surfaces, delegatedCommand: ["coordinator"], exitCode: 1, coordinatorLogPath: path.join(root, "coordinator.log") });
    const { summary, results } = buildReports({ runId: "missing-native", provider: "blaxel", runDir: root, selection: { surfaces: ["e2e:fixture"] }, surfaces: normalized, startedAt: start, completedAt: end });
    expect(summary.run).toMatchObject({ status: "incomplete", testStatus: "unknown" });
    expect(summary.counts).toMatchObject({ surfacesRun: 0, testsFailed: 0 });
    expect(results.surfaces.map((surface) => surface.id)).toEqual(["provider:blaxel"]);
    expect(results.surfaces[0].resourceDiagnosticsPaths).toEqual(["baseline.json"]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

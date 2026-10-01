import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { EMPTY_TIMING_BASELINE, readTimingBaseline, serializeTimingBaseline, updateTimingBaseline, validateTimingBaseline } from "../../scripts/test/timing-baseline.mjs";
import { buildTimingEvents, serializeTimingEvents } from "../../scripts/test/timing-events.mjs";

const EMPTY_BYTES = '{\n  "schemaVersion": 1,\n  "sourceThrough": null,\n  "files": {}\n}\n';
const blaxelProvider = "blaxel-playwright-x64-4vcpu";
const localProvider = "local-linux-x64-4cpu";
const githubProvider = "github-ubuntu-24.04-x64-2vcpu-vm";
const fullSuite = { suite: "all", surfaces: ["unit:root", "unit:other"], files: [], grep: null };

describe("test timing baseline", () => {
  test("rolls up complete passing files from complete Blaxel runs with stable medians and counters", () => {
    const fixture = checkout();
    try {
      const file = "test/repo/alpha.test.ts";
      const removed = "test/repo/removed.test.ts";
      writeFileSync(path.join(fixture.root, file), "// fixture\n");
      writeRun(fixture, run({ run: 1, completedAt: "2026-01-01T00:00:01.000Z", files: [fileObservation(file, 10, { retryCount: 1, recoveredFlakeCount: 1 }), fileObservation(removed, 999)] }));
      writeRun(fixture, run({ run: 2, completedAt: "2026-01-02T00:00:01.000Z", files: [fileObservation(file, 20, { retryCount: 2 })] }));
      writeRun(fixture, run({ run: 3, completedAt: "2026-01-03T00:00:01.000Z", files: [fileObservation(file, 80, { complete: false, retryCount: 9 })] }));
      writeRun(fixture, run({ run: 4, completedAt: "2026-01-04T00:00:01.000Z", files: [fileObservation(file, 80, { status: "failed", retryCount: 3 })] }));
      // Runs the baseline never reads: other substrates, narrowed selections,
      // and later completion times that must not advance sourceThrough.
      writeRun(fixture, run({ run: 5, completedAt: "2026-02-01T00:00:01.000Z", commandProvider: "local", timingProvider: localProvider, files: [fileObservation(file, 5_000)] }));
      writeRun(fixture, run({ run: 6, completedAt: "2026-02-02T00:00:01.000Z", commandProvider: null, timingProvider: githubProvider, files: [fileObservation(file, 5_000)] }));
      writeRun(fixture, run({ run: 7, completedAt: "2026-02-03T00:00:01.000Z", selection: { ...fullSuite, suite: "unit" }, files: [fileObservation(file, 5_000)] }));
      writeRun(fixture, run({ run: 8, completedAt: "2026-02-04T00:00:01.000Z", selection: { ...fullSuite, suite: null, files: [file] }, files: [fileObservation(file, 5_000)] }));
      writeRun(fixture, run({ run: 9, completedAt: "2026-02-05T00:00:01.000Z", selection: { ...fullSuite, grep: "alpha" }, files: [fileObservation(file, 5_000)] }));
      mkdirSync(path.join(fixture.root, ".test-runs", "sibling-without-events"));

      const result = updateTimingBaseline({ repoRoot: fixture.root, config: registry(fixture.root) });
      expect(result.runs).toHaveLength(4);
      expect(result.baseline.sourceThrough).toBe("2026-01-04T00:00:01.000Z");
      expect(result.baseline.files).toEqual({
        [file]: {
          surfaceId: "unit:root",
          providers: {
            [blaxelProvider]: { medianDurationMs: 15, sampleCount: 2, retryCount: 6, recoveredFlakeCount: 1, lastUpdated: "2026-01-04T00:00:01.000Z" },
          },
        },
      });
      expect(result.baseline.files[removed]).toBeUndefined();
      const firstBytes = readFileSync(path.join(fixture.root, "test/timing-baseline.json"));
      expect(firstBytes).toEqual(serializeTimingBaseline(result.baseline));
      expect(updateTimingBaseline({ repoRoot: fixture.root, config: registry(fixture.root), dryRun: true }).bytes).toEqual(firstBytes);
      expect(readFileSync(path.join(fixture.root, "test/timing-baseline.json"))).toEqual(firstBytes);
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  });

  test("dry-run leaves the committed baseline unchanged", () => {
    const fixture = checkout();
    try {
      const file = "test/repo/alpha.test.ts";
      writeFileSync(path.join(fixture.root, file), "// fixture\n");
      writeRun(fixture, run({ run: 1, completedAt: "2026-01-01T00:00:01.000Z", files: [fileObservation(file, 10)] }));
      const result = updateTimingBaseline({ repoRoot: fixture.root, config: registry(fixture.root), dryRun: true });
      expect(result.changed).toBe(true);
      expect(readFileSync(path.join(fixture.root, "test/timing-baseline.json"), "utf8")).toBe(EMPTY_BYTES);
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  });

  test("ignores runs labeled all whose surfaces, shards, or execution were narrowed", () => {
    const fixture = checkout();
    try {
      const file = "test/repo/alpha.test.ts";
      const other = "test/repo/beta.test.ts";
      writeFileSync(path.join(fixture.root, file), "// fixture\n");
      writeFileSync(path.join(fixture.root, other), "// fixture\n");
      const timing = (medianDurationMs: number) => ({ medianDurationMs, sampleCount: 1, retryCount: 0, recoveredFlakeCount: 0, lastUpdated: "2025-12-01T00:00:01.000Z" });
      const committed = serializeTimingBaseline({
        schemaVersion: 1, sourceThrough: "2025-12-01T00:00:01.000Z",
        files: { [file]: { surfaceId: "unit:root", providers: { [blaxelProvider]: timing(10) } }, [other]: { surfaceId: "unit:root", providers: { [blaxelProvider]: timing(20) } } },
      });
      writeFileSync(path.join(fixture.root, "test/timing-baseline.json"), committed);
      // Each keeps the `all` label and measures only one file. A surface,
      // package, runner, or tag filter narrows the recorded surfaces alike.
      writeRun(fixture, run({ run: 2, completedAt: "2026-02-01T00:00:01.000Z", selection: { ...fullSuite, surfaces: ["unit:root"] }, files: [fileObservation(file, 5_000)] }));
      writeRun(fixture, run({ run: 3, completedAt: "2026-02-02T00:00:01.000Z", shards: [{ index: 1, total: 3 }, { index: 3, total: 3 }], files: [fileObservation(file, 5_000)] }));
      writeRun(fixture, run({ run: 4, completedAt: "2026-02-03T00:00:01.000Z", status: "incomplete", shards: [{ index: 1, total: 2 }, { index: 2, total: 2 }], files: [fileObservation(file, 5_000)] }));
      writeRun(fixture, run({ run: 5, completedAt: "2026-02-04T00:00:01.000Z", status: "failed", otherSurfaceStatus: "skipped", files: [fileObservation(file, 5_000)] }));

      expect(() => updateTimingBaseline({ repoRoot: fixture.root, config: registry(fixture.root) })).toThrow("no complete Blaxel runs");
      expect(readFileSync(path.join(fixture.root, "test/timing-baseline.json"))).toEqual(committed);

      // Complete runs still contribute, including one whose tests failed.
      writeRun(fixture, run({ run: 1, completedAt: "2026-01-01T00:00:01.000Z", shards: [{ index: 1, total: 2 }, { index: 2, total: 2 }], files: [fileObservation(file, 10), fileObservation(other, 20)] }));
      writeRun(fixture, run({ run: 6, completedAt: "2026-01-06T00:00:01.000Z", status: "failed", otherSurfaceStatus: "failed", files: [fileObservation(file, 30)] }));
      const result = updateTimingBaseline({ repoRoot: fixture.root, config: registry(fixture.root), dryRun: true });
      expect(result.runs.map((input) => path.basename(input.dir))).toEqual([runId(1), runId(6)]);
      expect(result.baseline.sourceThrough).toBe("2026-01-06T00:00:01.000Z");
      expect(result.baseline.files[file].providers[blaxelProvider]).toMatchObject({ medianDurationMs: 20, sampleCount: 2 });
      expect(result.baseline.files[other].providers[blaxelProvider]).toMatchObject({ medianDurationMs: 20, sampleCount: 1 });
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  });

  test("keeps the canonical empty baseline valid and refuses an update with no Blaxel runs", () => {
    const fixture = checkout();
    try {
      expect(readTimingBaseline({ repoRoot: fixture.root }).baseline).toEqual(EMPTY_TIMING_BASELINE);
      expect(serializeTimingBaseline(EMPTY_TIMING_BASELINE).toString("utf8")).toBe(EMPTY_BYTES);
      expect(() => updateTimingBaseline({ repoRoot: fixture.root, config: registry(fixture.root) })).toThrow("no complete Blaxel runs");
      writeRun(fixture, run({ run: 1, completedAt: "2026-01-01T00:00:01.000Z", commandProvider: "local", timingProvider: localProvider, files: [] }));
      expect(() => updateTimingBaseline({ repoRoot: fixture.root, config: registry(fixture.root) })).toThrow("no complete Blaxel runs");
      expect(readFileSync(path.join(fixture.root, "test/timing-baseline.json"), "utf8")).toBe(EMPTY_BYTES);
      rmSync(path.join(fixture.root, "test/timing-baseline.json"));
      expect(() => readTimingBaseline({ repoRoot: fixture.root })).toThrow("timing baseline is missing");
      writeFileSync(path.join(fixture.root, "test/timing-baseline.json"), "{ nope\n");
      expect(() => readTimingBaseline({ repoRoot: fixture.root })).toThrow("malformed");
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  });

  test("rejects a baseline entry measured under any timing provider but Blaxel", () => {
    const timing = { medianDurationMs: 7, sampleCount: 1, retryCount: 0, recoveredFlakeCount: 0, lastUpdated: "2026-01-01T00:00:01.000Z" };
    expect(() => validateTimingBaseline({ schemaVersion: 1, sourceThrough: null, files: { "test/a.test.ts": { surfaceId: "unit:root", providers: { [blaxelProvider]: timing } } } })).not.toThrow();
    expect(() => validateTimingBaseline({ schemaVersion: 1, sourceThrough: null, files: { "test/a.test.ts": { surfaceId: "unit:root", providers: { [githubProvider]: timing } } } })).toThrow(`only ${blaxelProvider}`);
    expect(() => validateTimingBaseline({ schemaVersion: 1, sourceThrough: null, files: { "test/a.test.ts": { surfaceId: "unit:root", providers: { [blaxelProvider]: timing, [githubProvider]: timing } } } })).toThrow(`only ${blaxelProvider}`);
  });

  test("aborts without a partial write for unreadable runs, invalid Blaxel events, and owner disagreement", () => {
    const fixture = checkout();
    try {
      const file = "test/repo/alpha.test.ts";
      writeFileSync(path.join(fixture.root, file), "// fixture\n");
      writeRun(fixture, run({ run: 1, completedAt: "2026-01-01T00:00:01.000Z", files: [fileObservation(file, 10)] }));
      const before = readFileSync(path.join(fixture.root, "test/timing-baseline.json"));
      expect(() => updateTimingBaseline({ repoRoot: fixture.root, config: { root: fixture.root, suites: { all: {} }, surfaces: [{ id: "unit:other", roots: ["test/repo"], excludeRoots: [] }] } })).toThrow("current registry owner disagrees");
      expect(readFileSync(path.join(fixture.root, "test/timing-baseline.json"))).toEqual(before);

      const invalid = writeRun(fixture, run({ run: 2, completedAt: "2026-01-02T00:00:01.000Z", files: [fileObservation(file, 20)] }));
      const lines = readFileSync(path.join(invalid, "events.ndjson"), "utf8").split("\n").filter(Boolean);
      writeFileSync(path.join(invalid, "events.ndjson"), `${[lines[0], ...lines.slice(2)].join("\n")}\n`);
      expect(() => updateTimingBaseline({ repoRoot: fixture.root, config: registry(fixture.root) })).toThrow(`invalid timing events in ${invalid}`);
      expect(readFileSync(path.join(fixture.root, "test/timing-baseline.json"))).toEqual(before);
      rmSync(invalid, { recursive: true, force: true });

      const unreadable = path.join(fixture.root, ".test-runs", "unreadable-run");
      mkdirSync(unreadable);
      writeFileSync(path.join(unreadable, "events.ndjson"), "{ nope\n");
      expect(() => updateTimingBaseline({ repoRoot: fixture.root, config: registry(fixture.root) })).toThrow(`unreadable run event in ${unreadable}`);
      expect(readFileSync(path.join(fixture.root, "test/timing-baseline.json"))).toEqual(before);
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  });
});

function checkout() {
  const root = mkdtempSync(path.join(os.tmpdir(), "tv-baseline-"));
  mkdirSync(path.join(root, "test/repo"), { recursive: true });
  mkdirSync(path.join(root, ".test-runs"), { recursive: true });
  writeFileSync(path.join(root, "test/timing-baseline.json"), EMPTY_BYTES);
  return { root };
}

function registry(root: string) {
  return { root, suites: { all: {} }, surfaces: [{ id: "unit:root", roots: ["test/repo"], excludeRoots: [] }, { id: "unit:other", roots: ["test/other"], excludeRoots: [] }] };
}

function runId(run: number) {
  return `2026-01-${String(run).padStart(2, "0")}T00-00-00-000Z-p${run}-r${String(run).padStart(16, "0")}`;
}

// Files land in the first listed shard under unit:root; every other surface
// slot is unassigned unless otherSurfaceStatus says how unit:other ended there.
function run({ run, completedAt, files, commandProvider = "blaxel", timingProvider = blaxelProvider, selection = fullSuite, status = "passed", shards = [{ index: 1, total: 1 }], otherSurfaceStatus = "not-assigned" }: { run: number; completedAt: string; files: any[]; commandProvider?: string | null; timingProvider?: string; selection?: Record<string, unknown>; status?: string; shards?: Array<{ index: number; total: number }>; otherSurfaceStatus?: string }) {
  const id = runId(run);
  const unassigned = (surfaceId: string) => ({ id: surfaceId, runner: "vitest", status: "not-assigned", durationMs: 0, durationSource: "unknown", retryBudget: 0, phases: [], files: [], processLeaks: [] });
  const events = buildTimingEvents({
    run: {
      runId: id, commandProvider, timingProvider, status,
      startedAt: completedAt.replace("01.000Z", "00.000Z"), completedAt, durationMs: 1000,
      selection, git: { commit: null, tree: null, dirty: false }, environment: { ci: false, os: "linux", arch: "x64", node: "22.0.0" },
    },
    shards: shards.map(({ index, total }, position) => ({
      index, total, status: position === 0 ? status : "passed", durationMs: 1000, phases: [],
      surfaces: position === 0
        ? [{ id: "unit:root", runner: "vitest", status: "passed", durationMs: 100, durationSource: "surface-wall", retryBudget: 0, phases: [], files, processLeaks: [] }, { ...unassigned("unit:other"), status: otherSurfaceStatus }]
        : [unassigned("unit:root"), unassigned("unit:other")],
    })),
  });
  return { runId: id, bytes: serializeTimingEvents(events) };
}

function fileObservation(file: string, duration: number, overrides: Record<string, unknown> = {}) {
  return {
    path: file, status: "passed", complete: true, durationMs: duration, planningDurationMs: duration,
    durationSource: "file-wall", testsTotal: 1, retryCount: 0, recoveredFlakeCount: 0, attempts: [], ...overrides,
  };
}

function writeRun(fixture: ReturnType<typeof checkout>, observed: ReturnType<typeof run>) {
  const dir = path.join(fixture.root, ".test-runs", observed.runId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "events.ndjson"), observed.bytes);
  return dir;
}

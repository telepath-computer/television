import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { encodeOwnerToken, OWNER_TOKEN_ENV, readLinuxProcess, scanLinuxProcesses } from "../../../../scripts/test/process-lifecycle.mjs";
import { reapStaleOwnerProcesses } from "../../../../scripts/test/stale-owner-reaper.mjs";
import { createSurfaceSupervisor } from "../../../../scripts/test/surface-supervisor.mjs";
import { disposeAllOwnedProcesses, spawnOwnedProcess } from "../../../helpers/owned-process.ts";

const repoRoot = path.resolve(import.meta.dirname, "../../../..");
const knownFixturePids = new Set<number>();

afterEach(async () => {
  await disposeAllOwnedProcesses();
  for (const pid of knownFixturePids) {
    try { process.kill(pid, "SIGKILL"); } catch (error: any) { if (error?.code !== "ESRCH") throw error; }
  }
  knownFixturePids.clear();
});

describe("lifecycle fault orchestrator", () => {
  test("keeps a clean fixture clean", () => {
    const run = runSurface("experiment:lifecycle-clean");
    expect(run.result.status).toBe(0);
    expect(run.summary.run.status).toBe("passed");
    expect(run.summary.counts.processLeaks).toBe(0);
  });

  test("supervises a generic target command with the selected surface owner", () => {
    const fixtureDir = mkdtempSync(path.join(os.tmpdir(), "tv-supervised-target-"));
    const resultFile = path.join(fixtureDir, "result.json");
    const ownerFile = path.join(fixtureDir, "owner.txt");
    const result = spawnSync(process.execPath, [
      "scripts/test/supervised-command.mjs",
      "--run-id", "supervised-target-fixture",
      "--surface", "e2e:node",
      "--result", resultFile,
      "--",
      process.execPath,
      "-e",
      `require("node:fs").writeFileSync(${JSON.stringify(ownerFile)}, process.env.TV_TEST_SURFACE_OWNER || "")`,
    ], { cwd: repoRoot, encoding: "utf8", timeout: 10_000 });
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(readFileSync(ownerFile, "utf8")).toMatch(/^tv1\./);
    expect(JSON.parse(readFileSync(resultFile, "utf8"))).toMatchObject({
      surfaceIds: ["e2e:node"],
      exitCode: 0,
      processLeaks: [],
      failureKind: null,
    });
  });

  test("normalizes and consumes an ordinary listener leak end to end", () => {
    const run = runSurface("experiment:lifecycle-leak");
    const leak = onlyLeak(run);
    expect(run.result.status).toBe(1);
    expect(leak.cleanup).toEqual({ termSent: true, killSent: false, outcome: "terminated" });
    expect(leak.listeningSockets).toEqual([expect.objectContaining({ protocol: "tcp", family: "ipv4", host: "127.0.0.1" })]);
    expect(run.events.some((event: any) => event.kind === "process-leak" && event.leak.leakId === leak.leakId)).toBe(true);
    expect(run.results.surfaces[0]).toEqual(expect.objectContaining({ infraStatus: "incomplete", failureKind: "process-leak", processLeaks: [leak] }));
    expectProcessGone(leak.pid);
  });

  test("escalates a TERM-resistant detached listener to KILL", () => {
    const run = runSurface("experiment:lifecycle-term-resistant");
    const leak = onlyLeak(run);
    expect(run.result.status).toBe(1);
    expect(leak.cleanup).toEqual({ termSent: true, killSent: true, outcome: "killed" });
    expectProcessGone(leak.pid);
  });

  test("escalates a TERM-resistant child registered by the shared helper", async () => {
    const fixtureDir = mkdtempSync(path.join(os.tmpdir(), "tv-owned-process-kill-"));
    const readyFile = path.join(fixtureDir, "ready.json");
    const owned = spawnOwnedProcess(process.execPath, [path.join(repoRoot, "test/runner-fixtures/process-lifecycle/listener-child.mjs"), "--ignore-term"], {
      cwd: repoRoot,
      env: { ...process.env, TV_LIFECYCLE_READY_FILE: readyFile },
      stdio: ["ignore", "pipe", "pipe"],
      termGraceMs: 250,
    });
    const info = await waitForReady(readyFile);
    knownFixturePids.add(info.pid);
    const cleanup = await owned.dispose();
    expect(cleanup).toEqual({ termSent: true, killSent: true, outcome: "killed" });
    await waitFor(() => !processExists(info.pid), 5_000);
    knownFixturePids.delete(info.pid);
  });

  test("prevents test startup when a pre-command leaves a descendant", () => {
    const run = runSurface("experiment:lifecycle-precommand-leak");
    const leak = onlyLeak(run);
    expect(run.result.status).toBe(1);
    expect(existsSync(path.join(run.fixtureDir, "test-started"))).toBe(false);
    expect(leak.cleanup.outcome).toBe("terminated");
  });

  test("preserves a recovered native flake beside the lifecycle failure", () => {
    const run = runSurface("experiment:lifecycle-recovered-leak");
    expect(run.result.status).toBe(1);
    expect(run.summary.counts.processLeaks).toBe(1);
    expect(run.summary.counts.testsFlakyRecovered).toBeGreaterThanOrEqual(1);
    expect(run.summary.run.status).toBe("incomplete");
  });

  test("fails closed when a dying descendant first exposes another owner after the reap bound", { timeout: 15_000 }, async () => {
    const supervisor = createSurfaceSupervisor({ runId: "late-spawn-final-scan", surfaceIds: ["experiment:lifecycle-orchestrator"], termGraceMs: 250 });
    let cleanupError: any = null;
    try {
      await supervisor.run(process.execPath, [path.join(repoRoot, "test/runner-fixtures/process-lifecycle/late-spawn-child.mjs"), "0"]);
      await waitFor(() => scanLinuxProcesses().some((entry) => entry.ownerToken === supervisor.ownerToken), 5_000);
      try {
        await supervisor.finish();
      } catch (error) {
        cleanupError = error;
      }
      expect(cleanupError).toEqual(expect.objectContaining({
        name: "UnconfirmedSurfaceCleanupError",
        processLeaks: expect.arrayContaining([
          expect.objectContaining({ ownerToken: supervisor.ownerToken, cleanup: expect.objectContaining({ outcome: "survived" }) }),
        ]),
      }));
    } finally {
      for (const entry of scanLinuxProcesses().filter((processEntry) => processEntry.ownerToken === supervisor.ownerToken)) {
        try { process.kill(entry.pid, "SIGKILL"); } catch (error: any) { if (error?.code !== "ESRCH") throw error; }
      }
    }
  });

  test("reaps a stale owner before another surface can start", async () => {
    const token = encodeOwnerToken({ runId: "stale-startup-fixture", surfaceId: "experiment:lifecycle-leak", supervisorPid: 2_000_000_000, supervisorStartTime: "missing" });
    const listener = await spawnListenerWithToken(token);
    const cleanup = await reapStaleOwnerProcesses({ termGraceMs: 250 });
    expect(cleanup).toMatchObject({ staleDetected: true, cleanupConfirmed: true });
    expect(cleanup.processLeaks).toEqual(expect.arrayContaining([
      expect.objectContaining({ ownerToken: token, pid: listener.pid, cleanup: expect.objectContaining({ outcome: "terminated" }) }),
    ]));
    await waitFor(() => !processExists(listener.pid), 5_000);
    knownFixturePids.delete(listener.pid);
  });

  test("reaps stale startup ownership and refuses to start the selected CLI surface", async () => {
    const token = encodeOwnerToken({ runId: "stale-cli-startup", surfaceId: "experiment:lifecycle-leak", supervisorPid: 2_000_000_000, supervisorStartTime: "missing" });
    const listener = await spawnListenerWithToken(token);
    const fixtureDir = mkdtempSync(path.join(os.tmpdir(), "tv-lifecycle-stale-cli-"));
    const runDirOutput = path.join(fixtureDir, "run-dir.txt");
    const result = spawnSync(process.execPath, [
      "scripts/test/cli.mjs", "local", "--surface", "experiment:lifecycle-clean", "--run-dir-output", runDirOutput,
    ], {
      cwd: repoRoot,
      env: innerEnv(fixtureDir, path.join(fixtureDir, "ready.json")),
      encoding: "utf8",
      timeout: 15_000,
    });
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(1);
    const runDir = readRunDirIdentity(runDirOutput);
    const summary = JSON.parse(readFileSync(path.join(runDir, "summary.json"), "utf8"));
    expect(summary).toMatchObject({
      run: { status: "incomplete" },
      counts: { testsFailed: 0, processLeaks: 1 },
      processLeaks: [expect.objectContaining({ ownerToken: token, pid: listener.pid })],
    });
    expect(existsSync(path.join(runDir, "native", "experiment-lifecycle-clean.json"))).toBe(false);
    await waitFor(() => !processExists(listener.pid), 5_000);
    knownFixturePids.delete(listener.pid);
  });

  test("reports a live owner and never signals it", async () => {
    const supervisor = readLinuxProcess(process.pid);
    const token = encodeOwnerToken({ runId: "live-startup-fixture", surfaceId: "experiment:lifecycle-clean", supervisorPid: supervisor.pid, supervisorStartTime: supervisor.startTime });
    const listener = await spawnListenerWithToken(token);
    const cleanup = await reapStaleOwnerProcesses({ termGraceMs: 100 });
    expect(cleanup.staleDetected).toBe(false);
    expect(cleanup.processLeaks).toEqual([]);
    expect(cleanup.liveOwners).toEqual(expect.arrayContaining([
      expect.objectContaining({ token, supervisorStatus: "live", process: expect.objectContaining({ pid: listener.pid }) }),
    ]));
    expect(() => process.kill(listener.pid, 0)).not.toThrow();
  });

  test("translates unconfirmed final cleanup into a finalized CLI run failure", () => {
    const fixtureDir = mkdtempSync(path.join(os.tmpdir(), "tv-lifecycle-cli-final-scan-"));
    const runDirOutput = path.join(fixtureDir, "run-dir.txt");
    const result = spawnSync(process.execPath, [
      "scripts/test/cli.mjs", "local", "--surface", "experiment:lifecycle-late-spawn", "--run-dir-output", runDirOutput,
    ], {
      cwd: repoRoot,
      env: innerEnv(fixtureDir, path.join(fixtureDir, "ready.json")),
      encoding: "utf8",
      timeout: 20_000,
    });
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(1);
    const runDir = readRunDirIdentity(runDirOutput);
    for (const file of ["summary.json", "results.json", "events.ndjson"]) {
      expect(readFileSync(path.join(runDir, file), "utf8").length).toBeGreaterThan(0);
    }
    const summary = JSON.parse(readFileSync(path.join(runDir, "summary.json"), "utf8"));
    const results = JSON.parse(readFileSync(path.join(runDir, "results.json"), "utf8"));
    expect(summary).toMatchObject({
      run: { status: "incomplete", infraStatus: "incomplete", testStatus: "unknown" },
      counts: { infraFailures: 1 },
      failedSurfaces: [expect.objectContaining({ id: "experiment:lifecycle-late-spawn", failureKind: "process-leak", failureStep: "surface-cleanup" })],
    });
    expect(summary.counts.processLeaks).toBeGreaterThan(0);
    expect(summary.processLeaks).toEqual(expect.arrayContaining([
      expect.objectContaining({ cleanup: expect.objectContaining({ outcome: "survived" }) }),
    ]));
    expect(results.surfaces).toEqual([
      expect.objectContaining({ status: "failed", infraStatus: "incomplete", failureKind: "process-leak", failureStep: "surface-cleanup" }),
    ]);
    expect(`${result.stdout}\n${result.stderr}`).toContain("Surface cleanup could not confirm an empty owner scan");
  });

  test("SIGTERM of an active runner leaves no token-bearing process", async () => {
    const fixtureDir = mkdtempSync(path.join(os.tmpdir(), "tv-lifecycle-active-"));
    const readyFile = path.join(fixtureDir, "ready.json");
    const child = spawn(process.execPath, ["scripts/test/cli.mjs", "local", "--surface", "experiment:lifecycle-active"], {
      cwd: repoRoot,
      env: innerEnv(fixtureDir, readyFile),
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.stderr.on("data", (chunk) => { output += chunk; });
    const info = await waitForReady(readyFile);
    knownFixturePids.add(info.pid);
    process.kill(child.pid!, "SIGTERM");
    const exit = await waitForExit(child, 12_000);
    expect(exit.code, output).toBe(143);
    await waitFor(() => scanLinuxProcesses().filter((entry) => entry.ownerToken === info.ownerToken).length === 0, 8_000);
    knownFixturePids.delete(info.pid);
  });
});

async function spawnListenerWithToken(ownerToken: string) {
  const fixtureDir = mkdtempSync(path.join(os.tmpdir(), "tv-lifecycle-owner-listener-"));
  const readyFile = path.join(fixtureDir, "ready.json");
  const child = spawn(process.execPath, [path.join(repoRoot, "test/runner-fixtures/process-lifecycle/listener-child.mjs")], {
    cwd: repoRoot,
    detached: true,
    env: { ...process.env, [OWNER_TOKEN_ENV]: ownerToken, TV_LIFECYCLE_READY_FILE: readyFile },
    stdio: "ignore",
  });
  child.unref();
  const listener = await waitForReady(readyFile);
  knownFixturePids.add(listener.pid);
  return listener;
}

function runSurface(surface: string) {
  const fixtureDir = mkdtempSync(path.join(os.tmpdir(), `tv-lifecycle-${surface.split(":").at(-1)}-`));
  const readyFile = path.join(fixtureDir, "ready.json");
  const runDirOutput = path.join(fixtureDir, "run-dir.txt");
  const result = spawnSync(process.execPath, [
    "scripts/test/cli.mjs", "local", "--surface", surface, "--run-dir-output", runDirOutput,
  ], {
    cwd: repoRoot,
    env: innerEnv(fixtureDir, readyFile),
    encoding: "utf8",
    timeout: 45_000,
  });
  if (existsSync(readyFile)) knownFixturePids.add(JSON.parse(readFileSync(readyFile, "utf8")).pid);
  expect(existsSync(runDirOutput), `${result.stdout}\n${result.stderr}`).toBe(true);
  const runDir = readRunDirIdentity(runDirOutput);
  return {
    fixtureDir,
    result,
    summary: JSON.parse(readFileSync(path.join(runDir, "summary.json"), "utf8")),
    results: JSON.parse(readFileSync(path.join(runDir, "results.json"), "utf8")),
    events: readFileSync(path.join(runDir, "events.ndjson"), "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line)),
  };
}

function onlyLeak(run: ReturnType<typeof runSurface>) {
  expect(run.summary.counts.processLeaks).toBe(1);
  const leak = run.summary.processLeaks[0];
  knownFixturePids.delete(leak.pid);
  expect(leak).toEqual(expect.objectContaining({
    leakId: expect.stringMatching(/^[a-f0-9]{64}$/),
    ownerToken: expect.stringMatching(/^tv1\./),
    owningSurfaceIds: [expect.stringMatching(/^experiment:lifecycle-/)],
    pid: expect.any(Number),
    processStartedAt: expect.stringMatching(/Z$/),
    detectedAt: expect.stringMatching(/Z$/),
    command: expect.not.stringContaining(" "),
  }));
  return leak;
}

function innerEnv(fixtureDir: string, readyFile: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    GITHUB_ACTIONS: "true",
    GITHUB_WORKFLOW: "Process Lifecycle Fault Injection",
    TV_TEST_ISOLATED_GITHUB: "1",
    TV_TEST_TIMING_PROVIDER: "github-ubuntu-24.04-x64-2vcpu-vm",
    TV_LIFECYCLE_FIXTURE_DIR: fixtureDir,
    TV_LIFECYCLE_READY_FILE: readyFile,
  };
  delete env.TV_TEST_SURFACE_OWNER;
  return env;
}

function readRunDirIdentity(outputFile: string): string {
  const runDir = readFileSync(outputFile, "utf8").trim();
  expect(path.dirname(runDir)).toBe(path.join(repoRoot, ".test-runs"));
  return runDir;
}

async function waitForReady(file: string) {
  await waitFor(() => existsSync(file), 8_000);
  return JSON.parse(readFileSync(file, "utf8"));
}

function waitForExit(child: ReturnType<typeof spawn>, timeoutMs: number): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`child ${child.pid} did not exit`)), timeoutMs);
    child.once("exit", (code, signal) => { clearTimeout(timeout); resolve({ code, signal }); });
    child.once("error", reject);
  });
}

async function waitFor(predicate: () => boolean, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("timed out waiting for lifecycle state");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error: any) {
    if (error?.code === "ESRCH") return false;
    throw error;
  }
}

function expectProcessGone(pid: number) {
  if (processExists(pid)) throw new Error(`PID ${pid} is still alive`);
  knownFixturePids.delete(pid);
}

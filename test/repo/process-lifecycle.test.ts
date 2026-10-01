import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, test, vi } from "vitest";
import { isReportableProcessLeakCleanup } from "../../scripts/test/surface-supervisor.mjs";
import {
  classifyOwnedProcesses,
  decodeOwnerToken,
  encodeOwnerToken,
  macOSListenerCommand,
  macOSProcessCommand,
  parseLinuxProcessStat,
  parseLsofListeners,
  parseMacOSProcesses,
  parseSSListeners,
  processIdentityMatches,
  revalidateOwnedProcess,
  runProcessLifecycleProbe,
  scanLinuxProcesses,
  validateProcessLifecycleHost,
} from "../../scripts/test/process-lifecycle.mjs";

const owner = {
  runId: "run-42",
  surfaceId: "e2e:browser-app",
  supervisorPid: 101,
  supervisorStartTime: "98765",
};

describe("process lifecycle ownership", () => {
  test("round-trips only versioned, valid owner tokens", () => {
    const token = encodeOwnerToken(owner);

    expect(token).toMatch(/^tv1\./);
    expect(decodeOwnerToken(token)).toEqual(owner);
    expect(decodeOwnerToken("tv2.e30")).toBeNull();
    expect(decodeOwnerToken("tv1.not-base64!")).toBeNull();
    expect(decodeOwnerToken(`tv1.${Buffer.from(JSON.stringify({ ...owner, supervisorPid: 0 })).toString("base64url")}`)).toBeNull();
  });

  test("parses Linux stat identity even when the command contains spaces and parentheses", () => {
    const stat = "2036 (node worker (probe)) S 101 2036 2036 0 -1 4194304 1 2 3 4 5 6 7 8 20 0 1 0 98765 1000";

    expect(parseLinuxProcessStat(stat)).toEqual({
      pid: 2036,
      ppid: 101,
      pgid: 2036,
      startTime: "98765",
      state: "S",
    });
  });

  test("survives a process disappearing while Linux process entries are enumerated", () => {
    const procRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tv-proc-scan-"));
    const processDir = path.join(procRoot, "20329");
    fs.mkdirSync(processDir);
    fs.writeFileSync(path.join(procRoot, "stat"), "btime 1000\n");

    const originalReaddirSync = fs.readdirSync;
    // Model procfs returning an unknown entry type: a typed read lstats the
    // vanished process, while a plain read leaves that race to the guarded loop.
    const simulatedProcRead = ((target: unknown, options?: unknown) => {
      const args = options === undefined ? [target] : [target, options];
      const entries = Reflect.apply(originalReaddirSync, fs, args);
      if (String(target) !== procRoot) return entries;

      fs.rmSync(processDir, { recursive: true, force: true });
      if (typeof options === "object" && options !== null && "withFileTypes" in options && options.withFileTypes === true) {
        throw Object.assign(new Error(`ENOENT: no such file or directory, lstat '${processDir}'`), { code: "ENOENT" });
      }
      return entries;
    }) as unknown as typeof fs.readdirSync;
    const readdirSpy = vi.spyOn(fs, "readdirSync").mockImplementation(simulatedProcRead);

    try {
      expect(scanLinuxProcesses({ procRoot })).toEqual([]);
    } finally {
      readdirSpy.mockRestore();
      fs.rmSync(procRoot, { recursive: true, force: true });
    }
  });

  test("ignores numeric non-directory entries in an injected process root", () => {
    const procRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tv-proc-file-"));
    fs.writeFileSync(path.join(procRoot, "stat"), "btime 1000\n");
    fs.writeFileSync(path.join(procRoot, "20329"), "not a process directory\n");

    try {
      expect(scanLinuxProcesses({ procRoot })).toEqual([]);
    } finally {
      fs.rmSync(procRoot, { recursive: true, force: true });
    }
  });

  test("preserves the filesystem error code when the Linux process table cannot be read", () => {
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), "tv-missing-proc-"));
    const procRoot = path.join(parent, "missing");
    let thrown: unknown;

    try {
      scanLinuxProcesses({ procRoot });
    } catch (error) {
      thrown = error;
    } finally {
      fs.rmSync(parent, { recursive: true, force: true });
    }

    expect(thrown).toMatchObject({
      code: "ENOENT",
      cause: expect.objectContaining({ code: "ENOENT" }),
    });
  });

  test("attributes IPv4 and IPv6 listening sockets from ss output", () => {
    const listeners = parseSSListeners([
      'LISTEN 0 511 127.0.0.1:39755 0.0.0.0:* users:(("node",pid=2036,fd=18))',
      'LISTEN 0 128 [::1]:41888 [::]:* users:(("node",pid=2040,fd=20),("node",pid=2041,fd=21))',
    ].join("\n"));

    expect(listeners).toEqual([
      { pid: 2036, address: "127.0.0.1", port: 39755, command: "node" },
      { pid: 2040, address: "::1", port: 41888, command: "node" },
      { pid: 2041, address: "::1", port: 41888, command: "node" },
    ]);
  });

  test("parses macOS ps identity, inherited tokens, and lsof listeners", () => {
    expect(macOSProcessCommand()).toEqual({ command: "ps", args: ["eww", "-axo", "pid=,ppid=,pgid=,lstart=,command="] });
    expect(macOSListenerCommand()).toEqual({ command: "lsof", args: ["-nP", "-iTCP", "-sTCP:LISTEN", "-Fpcn"] });

    const token = encodeOwnerToken(owner);
    const processes = parseMacOSProcesses(`  405   101   405 Thu Jul 16 20:01:02 2026 node probe.js PATH=/usr/bin TV_TEST_SURFACE_OWNER=${token}\n`);
    const listeners = parseLsofListeners("p405\ncnode\nf18\nPTCP\nn127.0.0.1:43123\np406\ncnode\nf19\nPTCP\nn[::1]:43124\n");

    expect(processes).toEqual([{
      pid: 405,
      ppid: 101,
      pgid: 405,
      startTime: "Thu Jul 16 20:01:02 2026",
      processStartedAt: new Date("Thu Jul 16 20:01:02 2026").toISOString(),
      executable: "node",
      command: "node probe.js",
      ownerToken: token,
    }]);
    expect(listeners).toEqual([
      { pid: 405, address: "127.0.0.1", port: 43123, command: "node" },
      { pid: 406, address: "::1", port: 43124, command: "node" },
    ]);
  });

  test("classifies owners by supervisor PID and start time and rejects PID reuse", () => {
    const token = encodeOwnerToken(owner);
    const child = { pid: 405, ppid: 1, pgid: 405, startTime: "222", processStartedAt: "2026-01-01T00:00:02.000Z", executable: "node", command: "node child", ownerToken: token };
    const liveSupervisor = { pid: 101, ppid: 1, pgid: 101, startTime: "98765", processStartedAt: "2026-01-01T00:00:00.000Z", executable: "node", command: "node supervisor" };

    expect(classifyOwnedProcesses([liveSupervisor, child])).toEqual([expect.objectContaining({ process: child, owner, supervisorStatus: "live" })]);
    expect(classifyOwnedProcesses([{ ...liveSupervisor, startTime: "reused" }, child])).toEqual([expect.objectContaining({ supervisorStatus: "stale" })]);
    expect(processIdentityMatches(child, { pid: 405, startTime: "222" })).toBe(true);
    expect(processIdentityMatches(child, { pid: 405, startTime: "reused" })).toBe(false);
    expect(revalidateOwnedProcess(child, child, token)).toBe(true);
    expect(revalidateOwnedProcess(child, { ...child, ownerToken: encodeOwnerToken({ ...owner, runId: "other" }) }, token)).toBe(false);
  });

  test("omits naturally exited cleanup candidates but retains processes that required a signal", () => {
    expect(isReportableProcessLeakCleanup({ termSent: false, killSent: false, outcome: "already-exited" })).toBe(false);
    expect(isReportableProcessLeakCleanup({ termSent: true, killSent: false, outcome: "already-exited" })).toBe(true);
    expect(isReportableProcessLeakCleanup({ termSent: true, killSent: false, outcome: "terminated" })).toBe(true);
    expect(isReportableProcessLeakCleanup({ termSent: true, killSent: true, outcome: "killed" })).toBe(true);
    expect(isReportableProcessLeakCleanup({ termSent: true, killSent: true, outcome: "survived" })).toBe(true);
  });

  test("keeps the outer probe timeout above every bounded inner cleanup phase", () => {
    let probeTimeout = 0;
    const result = runProcessLifecycleProbe({
      platform: "darwin",
      runCommand(command, _args, options = {}) {
        if (command === process.execPath) {
          probeTimeout = Number(options.timeout);
          return {
            status: 0,
            stdout: `${JSON.stringify({
              backend: "macos-ps-lsof",
              attributedProcessCount: 1,
              attributedListenerCount: 1,
              finalOwnerCount: 0,
              childPid: 405,
              childPgid: 405,
              listenerURL: "http://127.0.0.1:43123",
            })}\n`,
            stderr: "",
          };
        }
        return { status: 0, stdout: "", stderr: "" };
      },
    });

    expect(result.finalOwnerCount).toBe(0);
    expect(probeTimeout).toBeGreaterThan(19_000);
  });

  test("fails unsupported and incomplete inspection hosts without fallback", () => {
    expect(() => validateProcessLifecycleHost({ platform: "win32", procfsReadable: true, commandAvailable: () => true })).toThrow(/unsupported platform/i);
    expect(() => validateProcessLifecycleHost({ platform: "linux", procfsReadable: false, commandAvailable: () => true })).toThrow(/proc/i);
    expect(() => validateProcessLifecycleHost({ platform: "linux", procfsReadable: true, commandAvailable: (command) => command !== "ss" })).toThrow(/iproute2.*ss/i);
    expect(() => validateProcessLifecycleHost({ platform: "darwin", procfsReadable: false, commandAvailable: (command) => command !== "lsof" })).toThrow(/lsof/i);
    expect(validateProcessLifecycleHost({ platform: "linux", procfsReadable: true, commandAvailable: () => true })).toEqual({ backend: "linux-procfs-ss" });
    expect(validateProcessLifecycleHost({ platform: "darwin", procfsReadable: false, commandAvailable: () => true })).toEqual({ backend: "macos-ps-lsof" });
  });
});

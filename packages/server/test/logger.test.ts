import { afterEach, describe, expect, it, vi } from "vitest";
import { spawn } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { log } from "../src/logger.ts";

function tempDir(): string {
  return mkdtempSync(path.join(os.tmpdir(), "television-logger-"));
}

function isRoot(): boolean {
  return typeof process.getuid === "function" && process.getuid() === 0;
}

function readLogRecords(storagePath: string): Array<Record<string, unknown>> {
  return readFileSync(path.join(storagePath, "logs", "tv.log"), "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

function localDateString(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function retainedStaleDate(): Date {
  const date = new Date();
  date.setDate(date.getDate() - 1);
  date.setHours(12, 0, 0, 0);
  return date;
}

interface LogWriterInput {
  msg: string;
  writer: string;
}

interface LogWriterResult {
  pid: number;
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
}

const require = createRequire(import.meta.url);
const tsxCliPath = path.join(path.dirname(require.resolve("tsx/package.json")), "dist/cli.mjs");
const logWriterPath = fileURLToPath(new URL("fixtures/log-writer.ts", import.meta.url));

async function runLogWriters(
  storagePath: string,
  writers: LogWriterInput[],
  startFile = path.join(storagePath, "start-writers"),
): Promise<LogWriterResult[]> {
  const running = writers.map(({ msg, writer }) => {
    const child = spawn(process.execPath, [tsxCliPath, logWriterPath], {
      env: {
        ...process.env,
        TV_LOG_STORAGE_PATH: storagePath,
        TV_LOG_MESSAGE: msg,
        TV_LOG_WRITER: writer,
        TV_LOG_START_FILE: startFile,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (child.pid === undefined) throw new Error("log writer child did not receive a pid");
    const pid = child.pid;
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    const result = new Promise<LogWriterResult>((resolve, reject) => {
      child.on("error", reject);
      child.on("close", (code, signal) => resolve({ pid, code, signal, stdout, stderr }));
    });
    return { pid, result };
  });

  writeFileSync(startFile, "go");
  const results = await Promise.all(running.map((child) => child.result));
  for (const result of results) {
    expect(result).toEqual(expect.objectContaining({ code: 0, signal: null, stderr: "" }));
  }
  return results;
}

describe("Television logger", () => {
  const dirs: string[] = [];

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    for (const dir of dirs.splice(0)) {
      try {
        chmodSync(dir, 0o700);
      } catch {
        // Best-effort cleanup permission reset.
      }
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("writes JSONL records to the active log", () => {
    const storagePath = tempDir();
    dirs.push(storagePath);

    log(storagePath, "new record", { detail: "value" });

    expect(readLogRecords(storagePath)).toEqual([
      expect.objectContaining({ msg: "new record", detail: "value", pid: process.pid }),
    ]);
  });

  it("serializes Error values in record data", () => {
    const storagePath = tempDir();
    dirs.push(storagePath);
    const error = new Error("boom");

    log(storagePath, "failed", { error, nested: { cause: error } });

    const [record] = readLogRecords(storagePath) as Array<{ error?: { name?: string; message?: string }; nested?: { cause?: { message?: string } } }>;
    expect(record?.error).toEqual(expect.objectContaining({ name: "Error", message: "boom" }));
    expect(record?.nested?.cause).toEqual(expect.objectContaining({ message: "boom" }));
  });

  it("concurrent writer processes produce intact JSON lines", async () => {
    const storagePath = tempDir();
    dirs.push(storagePath);

    await runLogWriters(storagePath, [
      { msg: "first", writer: "a" },
      { msg: "second", writer: "b" },
    ]);

    const lines = readFileSync(path.join(storagePath, "logs", "tv.log"), "utf8").trim().split("\n");
    expect(lines).toHaveLength(2);
    const records = lines.map((line) => JSON.parse(line) as { msg: string; writer: string; pid: number });
    expect(records.map((record) => record.msg).sort()).toEqual(["first", "second"]);
    expect(records.map((record) => record.writer).sort()).toEqual(["a", "b"]);
    expect(new Set(records.map((record) => record.pid)).size).toBe(2);
    expect(records.every((record) => record.pid !== process.pid)).toBe(true);
  });

  it("rotates a stale active log using the active file mtime date", () => {
    const storagePath = tempDir();
    dirs.push(storagePath);
    const logsDir = path.join(storagePath, "logs");
    mkdirSync(logsDir, { recursive: true });
    const activeLog = path.join(logsDir, "tv.log");
    writeFileSync(activeLog, "old log line\n");
    const staleDate = retainedStaleDate();
    utimesSync(activeLog, staleDate, staleDate);

    log(storagePath, "new record");

    const archivePath = path.join(logsDir, `tv.log.${localDateString(staleDate)}`);
    expect(readFileSync(archivePath, "utf8")).toBe("old log line\n");
    expect(readLogRecords(storagePath)).toEqual([expect.objectContaining({ msg: "new record" })]);
  });

  it("handles concurrent writer processes racing stale-log rotation", async () => {
    const storagePath = tempDir();
    dirs.push(storagePath);
    const logsDir = path.join(storagePath, "logs");
    mkdirSync(logsDir, { recursive: true });
    const activeLog = path.join(logsDir, "tv.log");
    writeFileSync(activeLog, "old log line\n");
    const staleDate = retainedStaleDate();
    utimesSync(activeLog, staleDate, staleDate);

    await runLogWriters(storagePath, [
      { msg: "first after rotation", writer: "a" },
      { msg: "second after rotation", writer: "b" },
    ]);

    const archivePath = path.join(logsDir, `tv.log.${localDateString(staleDate)}`);
    expect(readFileSync(archivePath, "utf8")).toBe("old log line\n");
    const records = readLogRecords(storagePath) as Array<{ msg: string; writer: string; pid: number }>;
    expect(records.map((record) => record.msg).sort()).toEqual(["first after rotation", "second after rotation"]);
    expect(records.map((record) => record.writer).sort()).toEqual(["a", "b"]);
    expect(new Set(records.map((record) => record.pid)).size).toBe(2);
    expect(records.every((record) => record.pid !== process.pid)).toBe(true);
  });

  it("adds a numeric suffix when the dated archive already exists", () => {
    const storagePath = tempDir();
    dirs.push(storagePath);
    const logsDir = path.join(storagePath, "logs");
    mkdirSync(logsDir, { recursive: true });
    const activeLog = path.join(logsDir, "tv.log");
    const staleDate = retainedStaleDate();
    writeFileSync(path.join(logsDir, `tv.log.${localDateString(staleDate)}`), "existing\n");
    writeFileSync(activeLog, "old\n");
    utimesSync(activeLog, staleDate, staleDate);

    log(storagePath, "new");

    expect(readFileSync(path.join(logsDir, `tv.log.${localDateString(staleDate)}-1`), "utf8")).toBe("old\n");
  });

  it("removes archives older than fourteen days when rotation runs", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 4, 16, 12, 0, 0, 0));
    const storagePath = tempDir();
    dirs.push(storagePath);
    const logsDir = path.join(storagePath, "logs");
    mkdirSync(logsDir, { recursive: true });
    const expiredArchive = path.join(logsDir, "tv.log.2026-04-30");
    const retainedArchive = path.join(logsDir, "tv.log.2026-05-10");
    const activeLog = path.join(logsDir, "tv.log");
    writeFileSync(expiredArchive, "expired\n");
    writeFileSync(retainedArchive, "retained\n");
    writeFileSync(activeLog, "old\n");
    const expiredDate = new Date(2026, 3, 30, 12, 0, 0, 0);
    const retainedDate = new Date(2026, 4, 10, 12, 0, 0, 0);
    const staleDate = new Date(2026, 4, 15, 12, 0, 0, 0);
    utimesSync(expiredArchive, expiredDate, expiredDate);
    utimesSync(retainedArchive, retainedDate, retainedDate);
    utimesSync(activeLog, staleDate, staleDate);

    log(storagePath, "new");

    expect(existsSync(expiredArchive)).toBe(false);
    expect(existsSync(retainedArchive)).toBe(true);
  });

  it("reports write failures to stderr without throwing", () => {
    if (isRoot()) return;

    const storagePath = tempDir();
    dirs.push(storagePath);
    chmodSync(storagePath, 0o500);
    const stderrWrite = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    expect(() => log(storagePath, "cannot write")).not.toThrow();

    const stderrText = stderrWrite.mock.calls.map((call) => String(call[0])).join("");
    expect(stderrText).toContain("tv: log write failed:");
  });
});

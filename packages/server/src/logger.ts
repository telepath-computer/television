import { appendFileSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync, rmdirSync, statSync } from "node:fs";
import path from "node:path";

const LOG_DIR_NAME = "logs";
const ACTIVE_LOG_FILE = "tv.log";
const LOG_RETENTION_DAYS = 14;
const HOURS_PER_DAY = 24;
const MINUTES_PER_HOUR = 60;
const SECONDS_PER_MINUTE = 60;
const MS_PER_SECOND = 1000;
const MS_PER_DAY = HOURS_PER_DAY * MINUTES_PER_HOUR * SECONDS_PER_MINUTE * MS_PER_SECOND;
const MILLISECOND_DIGITS = 3;
const ROTATION_LOCK_DIR = `${ACTIVE_LOG_FILE}.rotate.lock`;
const ROTATION_LOCK_WAIT_MS = 10;
const ROTATION_LOCK_TIMEOUT_MS = 5_000;
const INT32_BYTES = 4;

export function log(storagePath: string, msg: string, data?: object): void {
  try {
    const logsDir = path.join(storagePath, LOG_DIR_NAME);
    mkdirSync(logsDir, { recursive: true });
    const logPath = path.join(logsDir, ACTIVE_LOG_FILE);
    rotateIfStale(logsDir, logPath);
    const record = {
      ts: localTimestamp(new Date()),
      pid: process.pid,
      msg,
      ...serializeData(data),
    };
    appendFileSync(logPath, `${JSON.stringify(record)}\n`, { encoding: "utf8" });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`tv: log write failed: ${message}\n`);
  }
}

export function serializeError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    const serialized: Record<string, unknown> = { name: error.name, message: error.message };
    if (error.stack) serialized.stack = error.stack;
    const maybeNodeError = error as NodeJS.ErrnoException;
    if (maybeNodeError.code) serialized.code = maybeNodeError.code;
    if (maybeNodeError.syscall) serialized.syscall = maybeNodeError.syscall;
    if ("cause" in error && error.cause !== undefined) {
      serialized.cause = serializeValue(error.cause);
    }
    return serialized;
  }
  return { name: "NonError", message: String(error) };
}

function rotateIfStale(logsDir: string, logPath: string): void {
  const lockPath = path.join(logsDir, ROTATION_LOCK_DIR);
  if (!acquireRotationLock(lockPath)) return;
  try {
    let stats;
    try {
      stats = statSync(logPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }

    if (!isPreviousLocalCalendarDay(stats.mtime, new Date())) return;

    const archiveDate = localDateString(stats.mtime);
    const archivePath = uniqueArchivePath(path.join(logsDir, `${ACTIVE_LOG_FILE}.${archiveDate}`));
    try {
      renameSync(logPath, archivePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    removeExpiredArchives(logsDir, archivePath);
  } finally {
    releaseRotationLock(lockPath);
  }
}

function acquireRotationLock(lockPath: string): boolean {
  const deadline = Date.now() + ROTATION_LOCK_TIMEOUT_MS;
  while (true) {
    try {
      mkdirSync(lockPath);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      if (Date.now() >= deadline) return false;
      sleepSync(ROTATION_LOCK_WAIT_MS);
    }
  }
}

function releaseRotationLock(lockPath: string): void {
  try {
    rmdirSync(lockPath);
  } catch {
    // Lock cleanup is best-effort; logging should not fail because cleanup did.
  }
}

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(INT32_BYTES)), 0, 0, ms);
}

function uniqueArchivePath(basePath: string): string {
  if (!existsSync(basePath)) return basePath;
  for (let index = 1; ; index += 1) {
    const candidate = `${basePath}-${index}`;
    if (!existsSync(candidate)) return candidate;
  }
}

function removeExpiredArchives(logsDir: string, retainedArchivePath: string): void {
  const cutoff = Date.now() - LOG_RETENTION_DAYS * MS_PER_DAY;
  for (const entry of readdirSync(logsDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.startsWith(`${ACTIVE_LOG_FILE}.`)) continue;
    const fullPath = path.join(logsDir, entry.name);
    if (fullPath === retainedArchivePath) continue;
    try {
      if (statSync(fullPath).mtime.getTime() < cutoff) {
        rmSync(fullPath, { force: true });
      }
    } catch {
      // Retention cleanup is best-effort; logging should not fail because cleanup did.
    }
  }
}

function isPreviousLocalCalendarDay(date: Date, now: Date): boolean {
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return date.getTime() < todayStart;
}

function serializeData(data: object | undefined): Record<string, unknown> {
  if (data === undefined) return {};
  return serializeValue(data) as Record<string, unknown>;
}

function serializeValue(value: unknown, seen = new WeakSet<object>()): unknown {
  if (value instanceof Error) return serializeError(value);
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value)) return "[Circular]";
  seen.add(value);
  if (Array.isArray(value)) return value.map((item) => serializeValue(item, seen));
  const output: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    output[key] = serializeValue(child, seen);
  }
  return output;
}

function localTimestamp(date: Date): string {
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const absoluteOffsetMinutes = Math.abs(offsetMinutes);
  const offsetHours = Math.floor(absoluteOffsetMinutes / MINUTES_PER_HOUR);
  const offsetRemainderMinutes = absoluteOffsetMinutes % MINUTES_PER_HOUR;
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}` +
    `T${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}` +
    `.${String(date.getMilliseconds()).padStart(MILLISECOND_DIGITS, "0")}${sign}${pad2(offsetHours)}:${pad2(offsetRemainderMinutes)}`;
}

function localDateString(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

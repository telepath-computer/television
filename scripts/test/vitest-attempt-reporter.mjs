import fs from "node:fs";
import path from "node:path";
import { VitestTestRunner } from "vitest/runners";

// Vitest JSON and reporter callbacks do not retain every retry duration.
// This runner adapter records attempt boundaries in the worker where they occur.
// The built-in JSON reporter
// remains the source for file totals and file wall times.
export default class VitestAttemptReporter extends VitestTestRunner {
  #active = new Map();

  onBeforeTryTask(test, context) {
    this.#finishPreviousAttempt(test, "failed");
    super.onBeforeTryTask(test, context);
    this.#active.set(test.id, {
      attemptIndex: context?.retry ?? test.result?.retryCount ?? 0,
      startedAtMs: Date.now(),
      identity: taskIdentity(test),
    });
  }

  onAfterRunTask(test) {
    super.onAfterRunTask(test);
    this.#finishAttempt(test, normalizeStatus(test.result?.state));
  }

  #finishPreviousAttempt(test, status) {
    if (this.#active.has(test.id)) this.#finishAttempt(test, status);
  }

  #finishAttempt(test, status) {
    const active = this.#active.get(test.id);
    if (!active) return;
    this.#active.delete(test.id);
    const completedAtMs = Date.now();
    appendAttempt({
      schemaVersion: 1,
      ...active.identity,
      attemptIndex: active.attemptIndex,
      status,
      startedAt: new Date(active.startedAtMs).toISOString(),
      completedAt: new Date(completedAtMs).toISOString(),
      durationMs: Math.max(0, completedAtMs - active.startedAtMs),
    });
  }
}

function appendAttempt(attempt) {
  const output = process.env.TV_VITEST_ATTEMPT_FILE;
  if (!output) throw new Error("TV_VITEST_ATTEMPT_FILE is required when the Vitest attempt recorder is active");
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.appendFileSync(output, `${JSON.stringify(attempt)}\n`, { encoding: "utf8", flag: "a" });
}

function taskIdentity(test) {
  const titlePath = [];
  let current = test;
  while (current && current.type !== "file") {
    if (current.name) titlePath.unshift(current.name);
    current = current.suite;
  }
  return {
    file: test.file?.filepath,
    project: test.file?.projectName || undefined,
    titlePath,
    ...(test.location?.line == null ? {} : { line: test.location.line }),
    ...(test.location?.column == null ? {} : { column: test.location.column }),
  };
}

function normalizeStatus(state) {
  if (state === "pass") return "passed";
  if (state === "fail") return "failed";
  if (state === "skip" || state === "todo") return "skipped";
  return "unknown";
}

import { spawn } from "node:child_process";
import { stat } from "node:fs/promises";

import type { JobSpec } from "./config.ts";

// Runs one job to settlement. A job fails when its before_command exits
// nonzero, its cwd is missing when the agent is due to spawn, or the agent
// process exits nonzero. Agent stdout/stderr is discarded (no log capture
// in v1); the prompt is piped to the agent's stdin, which is then closed.

export interface JobResult {
  ok: boolean;
  /** Present when ok is false: why the job failed. */
  reason?: string;
}

export async function runJob(job: JobSpec, { command, configDir }: { command: string; configDir: string }): Promise<JobResult> {
  if (job.beforeCommand !== null) {
    const reason = failureReason("before_command", await runShell(job.beforeCommand, { cwd: configDir }));
    if (reason !== null) return { ok: false, reason };
  }
  if (!(await isDirectory(job.cwd))) return { ok: false, reason: `cwd does not exist: ${job.cwd}` };
  const reason = failureReason("agent", await runShell(command, { cwd: job.cwd, stdin: job.prompt }));
  if (reason !== null) return { ok: false, reason };
  return { ok: true };
}

type ShellOutcome =
  | { kind: "exit"; code: number }
  | { kind: "signal"; signal: NodeJS.Signals }
  | { kind: "spawn-error"; message: string };

function failureReason(what: "before_command" | "agent", outcome: ShellOutcome): string | null {
  if (outcome.kind === "spawn-error") return `failed to spawn sh: ${outcome.message}`;
  if (outcome.kind === "signal") return `${what} killed by signal ${outcome.signal}`;
  return outcome.code === 0 ? null : `${what} exited ${outcome.code}`;
}

function runShell(command: string, { cwd, stdin = null }: { cwd: string; stdin?: string | null }): Promise<ShellOutcome> {
  return new Promise((resolve) => {
    const child = spawn("sh", ["-c", command], {
      cwd,
      stdio: [stdin === null ? "ignore" : "pipe", "ignore", "ignore"],
    });
    // On spawn failure "error" fires first; the first resolve wins.
    child.on("error", (error) => resolve({ kind: "spawn-error", message: error.message }));
    child.on("close", (code, signal) =>
      resolve(signal !== null ? { kind: "signal", signal } : { kind: "exit", code: code ?? 1 }),
    );
    if (stdin !== null && child.stdin !== null) {
      // The agent may exit without reading its stdin; swallow the EPIPE.
      child.stdin.on("error", () => {});
      child.stdin.end(stdin);
    }
  });
}

async function isDirectory(dir: string): Promise<boolean> {
  try {
    return (await stat(dir)).isDirectory();
  } catch {
    return false;
  }
}

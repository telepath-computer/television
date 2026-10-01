import { existsSync, mkdtempSync, readFileSync, realpathSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { JobSpec } from "../src/config.ts";
import { runJob } from "../src/run.ts";

function tmpDir(): string {
  return mkdtempSync(path.join(os.tmpdir(), "runner-run-"));
}

function job(cwd: string, overrides: Partial<JobSpec> = {}): JobSpec {
  return { name: "job", prompt: "hello prompt", cwd, beforeCommand: null, ...overrides };
}

describe("runJob", () => {
  it("completes when the agent exits zero", async () => {
    const dir = tmpDir();
    const result = await runJob(job(dir), { command: "cat >/dev/null", configDir: dir });
    expect(result).toEqual({ ok: true });
  });

  it("pipes the prompt to the agent's stdin and closes it", async () => {
    const dir = tmpDir();
    const result = await runJob(job(dir, { prompt: "the exact prompt" }), {
      command: "cat > got.txt",
      configDir: dir,
    });
    expect(result.ok).toBe(true);
    expect(readFileSync(path.join(dir, "got.txt"), "utf8")).toBe("the exact prompt");
  });

  it("runs the agent in the job's cwd", async () => {
    const configDir = tmpDir();
    const jobDir = tmpDir();
    const result = await runJob(job(jobDir), { command: "pwd > where.txt", configDir });
    expect(result.ok).toBe(true);
    expect(readFileSync(path.join(jobDir, "where.txt"), "utf8").trim()).toBe(realpathSync(jobDir));
  });

  it("fails when the agent exits nonzero", async () => {
    const dir = tmpDir();
    const result = await runJob(job(dir), { command: "exit 3", configDir: dir });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/agent exited 3/);
  });

  it("fails when before_command exits nonzero and never spawns the agent", async () => {
    const dir = tmpDir();
    const result = await runJob(job(dir, { beforeCommand: "exit 1" }), {
      command: "touch agent-ran.txt",
      configDir: dir,
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/before_command exited 1/);
    expect(existsSync(path.join(dir, "agent-ran.txt"))).toBe(false);
  });

  it("runs before_command in the config file's directory", async () => {
    const configDir = tmpDir();
    const jobDir = tmpDir();
    const result = await runJob(job(jobDir, { beforeCommand: "pwd > before-where.txt" }), {
      command: "true",
      configDir,
    });
    expect(result.ok).toBe(true);
    expect(readFileSync(path.join(configDir, "before-where.txt"), "utf8").trim()).toBe(realpathSync(configDir));
  });

  it("fails when the cwd is missing once the agent is due to spawn", async () => {
    const dir = tmpDir();
    const missing = path.join(dir, "missing");
    const result = await runJob(job(missing), { command: "true", configDir: dir });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/cwd/);
  });

  it("lets before_command stage the cwd before the existence check", async () => {
    const configDir = tmpDir();
    const staged = path.join(configDir, "runs/today");
    const result = await runJob(job(staged, { beforeCommand: "mkdir -p runs/today" }), {
      command: "true",
      configDir,
    });
    expect(result).toEqual({ ok: true });
  });

  it("reports the signal when the agent is killed by one", async () => {
    const dir = tmpDir();
    const result = await runJob(job(dir), { command: "kill -TERM $$", configDir: dir });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("agent killed by signal SIGTERM");
  });

  it("reports the signal when before_command is killed by one", async () => {
    const dir = tmpDir();
    const result = await runJob(job(dir, { beforeCommand: "kill -TERM $$" }), {
      command: "true",
      configDir: dir,
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("before_command killed by signal SIGTERM");
  });

  it("reports a spawn failure as such, not as an exit code", async () => {
    const missingDir = path.join(tmpDir(), "missing");
    const result = await runJob(job(tmpDir(), { beforeCommand: "true" }), {
      command: "true",
      configDir: missingDir,
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/^failed to spawn sh: .+/);
    expect(result.reason).not.toMatch(/exited/);
  });

  it("tolerates an agent that exits without reading stdin", async () => {
    const dir = tmpDir();
    const bigPrompt = "x".repeat(1 << 20);
    const result = await runJob(job(dir, { prompt: bigPrompt }), { command: "exit 0", configDir: dir });
    expect(result).toEqual({ ok: true });
  });
});

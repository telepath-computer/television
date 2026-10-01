#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import process from "node:process";

import type { JobSpec } from "./config.ts";
import { parseCliArgs, parseConfig } from "./config.ts";
import type { JobRun } from "./render.ts";
import { runJob } from "./run.ts";
import { createUi } from "./ui.ts";

// skillbench CLI: run an eval config's prompts through an agent command,
// one fresh process per job, in parallel. See specs/arch/skillbench.md. Exits 0 once all jobs settle,
// regardless of job failures; its own errors exit nonzero.

await main();

async function main(): Promise<void> {
  try {
    const args = parseCliArgs(process.argv.slice(2));
    let text: string;
    try {
      text = await readFile(args.configPath, "utf8");
    } catch (error) {
      throw new Error(`cannot read config ${args.configPath}: ${errorMessage(error)}`);
    }
    const { configDir, jobs } = parseConfig(text, {
      configPath: args.configPath,
      invocationDir: process.cwd(),
    });
    await runAll(jobs, { command: args.command, configDir });
    process.exitCode = 0;
  } catch (error) {
    process.stderr.write(`skillbench: ${errorMessage(error)}\n`);
    process.exitCode = 1;
  }
}

async function runAll(jobs: JobSpec[], { command, configDir }: { command: string; configDir: string }): Promise<void> {
  const runs: JobRun[] = jobs.map((job) => ({ ...job, state: "running", startedAt: Date.now(), settledAt: null }));
  const ui = createUi(process.stdout, runs);
  ui.start();
  try {
    await Promise.all(
      runs.map(async (run) => {
        const result = await runJob(run, { command, configDir });
        run.state = result.ok ? "completed" : "failed";
        run.reason = result.ok ? null : (result.reason ?? null);
        run.settledAt = Date.now();
        ui.settle(run);
      }),
    );
    // Ctrl-C reaches the runner and its jobs together. Give the runner's
    // queued signal callback a turn before normal job settlement removes the
    // UI signal handlers; otherwise a fast child exit can turn Ctrl-C into a
    // successful CLI exit.
    await new Promise<void>((resolve) => setImmediate(resolve));
  } finally {
    ui.finish();
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

import path from "node:path";

// Pure parsing/validation for the runner CLI arguments and config file.
// No I/O here — the caller reads the config file and passes its text in.

const USAGE = 'usage: npm run skillbench -- path/to/config.json [--command "<agent command>"]';

/** The agent command evals run with unless --command overrides it. */
export const DEFAULT_COMMAND = "claude -p --permission-mode acceptEdits";

export interface CliArgs {
  configPath: string;
  command: string;
}

export interface JobSpec {
  name: string;
  prompt: string;
  /** Absolute path the agent process runs in. */
  cwd: string;
  /** `before_command` from the config, or null when absent. */
  beforeCommand: string | null;
}

export interface ParsedConfig {
  /** Absolute directory of the config file (where before_command runs). */
  configDir: string;
  jobs: JobSpec[];
}

interface JobContext {
  configDir: string;
  invocationDir: string;
}

export function parseCliArgs(argv: string[]): CliArgs {
  let configPath: string | null = null;
  let command: string | null = null;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--command") {
      i += 1;
      if (i >= argv.length) throw usageError("--command requires a value");
      command = argv[i];
    } else if (arg.startsWith("--command=")) {
      command = arg.slice("--command=".length);
    } else if (arg.startsWith("-")) {
      throw usageError(`unknown flag: ${arg}`);
    } else if (configPath !== null) {
      throw usageError(`unexpected argument: ${arg}`);
    } else {
      configPath = arg;
    }
  }
  if (configPath === null) throw usageError("missing config path");
  return { configPath, command: command ?? DEFAULT_COMMAND };
}

export function parseConfig(
  text: string,
  { configPath, invocationDir }: { configPath: string; invocationDir: string },
): ParsedConfig {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (error) {
    throw new Error(`invalid JSON in ${configPath}: ${errorMessage(error)}`);
  }
  if (!isPlainObject(data)) throw new Error(`${configPath}: config must be a JSON object`);
  if (!Array.isArray(data.jobs)) throw new Error(`${configPath}: config must have a "jobs" array`);
  const configDir = path.dirname(path.resolve(configPath));
  const jobs = (data.jobs as unknown[]).map((job, index) => parseJob(job, index, { configDir, invocationDir }));
  return { configDir, jobs };
}

function parseJob(job: unknown, index: number, { configDir, invocationDir }: JobContext): JobSpec {
  const label = `jobs[${index}]`;
  if (!isPlainObject(job)) throw new Error(`${label} must be an object`);
  const { name, prompt, cwd, before_command: beforeCommand } = job;
  if (typeof name !== "string" || name === "") throw new Error(`${label} requires a non-empty "name"`);
  if (typeof prompt !== "string" || prompt === "") throw new Error(`${label} requires a non-empty "prompt"`);
  if (cwd !== undefined && typeof cwd !== "string") throw new Error(`${label}: "cwd" must be a string`);
  if (cwd !== undefined && path.isAbsolute(cwd)) {
    // Configs are tracked and run on many machines; an absolute cwd can
    // never be portable (and the review page resolves config-relative).
    throw new Error(`${label}: "cwd" must be relative to the config file, got absolute path`);
  }
  if (beforeCommand !== undefined && typeof beforeCommand !== "string") {
    throw new Error(`${label}: "before_command" must be a string`);
  }
  return {
    name,
    prompt,
    cwd: cwd === undefined ? path.resolve(invocationDir) : path.resolve(configDir, cwd),
    beforeCommand: beforeCommand ?? null,
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function usageError(message: string): Error {
  return new Error(`${message}\n${USAGE}`);
}

import type { NormalizedProcessLeak } from "./timing-events.mjs";

export const TEST_PROCESS_TERM_GRACE_MS: 2_000;

export interface OwnedProcessResult {
  pid: number | null;
  exitCode: number;
  signal: NodeJS.Signals | null;
  error: Error | null;
}

export interface SurfaceSupervisorOptions {
  runId: string;
  surfaceIds: string[];
  termGraceMs?: number;
}

export interface OwnedProcessOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  stdio?: "pipe" | "inherit";
  onStdout?(chunk: Buffer): void;
  onStderr?(chunk: Buffer): void;
}

export class UnconfirmedSurfaceCleanupError extends Error {
  readonly processLeaks: NormalizedProcessLeak[];
  constructor(processLeaks: NormalizedProcessLeak[], remainingCount: number);
}

export class SurfaceSupervisor {
  readonly runId: string;
  readonly surfaceIds: string[];
  readonly termGraceMs: number;
  readonly ownerToken: string;
  readonly processLeaks: NormalizedProcessLeak[];
  readonly closed: boolean;
  constructor(options: SurfaceSupervisorOptions);
  childEnv(env?: NodeJS.ProcessEnv): NodeJS.ProcessEnv;
  run(command: string, args?: string[], options?: OwnedProcessOptions): Promise<OwnedProcessResult>;
  checkForLeaks(): Promise<NormalizedProcessLeak[]>;
  finish(): Promise<NormalizedProcessLeak[]>;
}

export function createSurfaceSupervisor(options: SurfaceSupervisorOptions): SurfaceSupervisor;
export function isReportableProcessLeakCleanup(cleanup: NormalizedProcessLeak["cleanup"]): boolean;

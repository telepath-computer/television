export interface InterruptedAttemptState<Lease = Record<string, unknown>> {
  signal: string;
  attempt: number;
  runId: string;
  suite: string;
  target: Record<string, unknown>;
  shardTotal: number;
  shardIndices: number[];
  pool: string;
  arch: string;
  commit: string;
  timeoutProfile: string;
  plan?: Record<string, any> | null;
  outputDir: string;
  startedAt: string;
  completedAt?: string;
  completedResults?: Map<number, Record<string, any>>;
  partialResults?: Map<number, Record<string, any>>;
  leases?: Map<number, Lease>;
  executionRequested?: Set<number>;
  executionStarted?: Set<number>;
  shardStartedAt?: Map<number, number>;
}

export function buildInterruptedAttemptReport<Lease extends { sandbox?: { metadata?: { name?: string } } }>(state: InterruptedAttemptState<Lease>): Record<string, any>;
export function finishInterruptedRun(options: {
  preserveReport: () => void | Promise<void>;
  releaseLeases: () => void | Promise<void>;
  finalizeReport?: () => void | Promise<void>;
}): Promise<{ reportError: unknown | null; releaseError: unknown | null; finalizeError: unknown | null }>;

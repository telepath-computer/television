export interface ProviderTask {
  surfaceId?: string;
  runner?: string;
  command?: string;
  args?: string[];
  status: "passed" | "failed" | "skipped" | "not-assigned";
  infraStatus?: "completed" | "incomplete";
  suite?: string;
  name?: string;
  exitCode?: number | null;
  durationMs?: number;
  nativeResultPath?: string | null;
  [key: string]: unknown;
}

export interface ProviderShard {
  shardIndex: number;
  shardTotal?: number | null;
  status: "passed" | "failed" | "infra-failed";
  durationMs?: number;
  planId?: string;
  timingProvider?: string;
  testedTree?: string;
  predictedDurationMs?: number;
  tasks?: ProviderTask[];
  logPath?: string | null;
  outputDir?: string;
  leaseAcquired?: boolean;
  executionStarted?: boolean;
  nativeResultPath?: string | null;
  [key: string]: unknown;
}

export interface AttemptReport {
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  interruptedBy?: string;
  plan?: { planId: string; [key: string]: unknown };
  run?: { createdAt?: string; updatedAt?: string; [key: string]: unknown };
  shardIndices?: number[];
  outputDir?: string;
  shards?: ProviderShard[];
  [key: string]: unknown;
}

export interface CombinedReport extends AttemptReport {
  status: "passed" | "failed";
  startedAt: string;
  completedAt: string;
  durationMs: number;
  plan?: { planId: string; [key: string]: unknown };
  shards: ProviderShard[];
  failedTasks: Array<Record<string, unknown>>;
  infraFailedShards: number[];
}

export function providerCommandExitCode(options: { delegatedExitCode: number | null; reportStatus: string }): number;
export function writeProviderReports(outputDir: string, report: Record<string, unknown>): void;
export function compactProviderSummary(report: Record<string, unknown>, options?: { outputDir?: string | null }): Record<string, unknown>;
export function infrastructureRetryShardIndices(report: AttemptReport & { status?: string }, options: { attempt: number; retryInfra: number }): number[];
export function runInfrastructureAttempts(options: {
  initialShardIndices: number[];
  retryInfra: number;
  runAttempt: (request: { attempt: number; shardIndices: number[]; excludedSandboxes: string[] }) => AttemptReport | Promise<AttemptReport>;
  onAttempt?: (report: AttemptReport) => void;
  onRetry?: (retry: { shardIndices: number[]; completedAttempts: number; retryInfra: number; excludedSandboxes: string[] }) => void;
}): Promise<AttemptReport[]>;
export function summarizeInfrastructureAttempts(reports: AttemptReport[]): Array<Record<string, unknown>>;
export function combineAttemptReports(attempts: AttemptReport[], expectedShardIndices: number[], options: { shardTotal: number; outputDir: string }): CombinedReport;
export function formatShardLogs(shards: ProviderShard[]): string;
export function failedTasksFromShards(shards: ProviderShard[], options?: { shardTotal?: number; outputDir?: string | null }): Array<Record<string, unknown>>;
export function annotateShardOutputs(shard: ProviderShard, outputDir: string): ProviderShard;
export function resolveDownloadedOutput(outputDir: string, nativeResultPath?: string | null): string | null;
export function readShardSummaries(outputDir: string): ProviderShard[];
export function findShardLog(outputDir: string, shard: ProviderShard): string | null;
export function findFiles(root: string, pattern: RegExp): string[];

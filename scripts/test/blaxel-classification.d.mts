export function classifyDownloadedShardStatus(args: {
  identityError?: string | null;
  shardSummary?: { status?: string; failureKind?: string; [key: string]: unknown } | null;
  exitCode?: number | null;
  hasSummaryFile?: boolean;
  setupTimings?: Array<{ name?: string; [key: string]: unknown }>;
}): "passed" | "failed" | "infra-failed";

export function classifyBlaxelCoordinatorFailure(args: {
  failureStep: "worker-execution" | "report-download";
  message: string;
}): {
  failureKind: "timeout" | "transport";
  failureStep: "worker-execution" | "report-download";
};

export function classifyBlaxelShardStatus(args: {
  shardSummary?: { status?: string; failureKind?: string; [key: string]: unknown } | null;
  exitCode?: number | null;
  hasSummaryFile?: boolean;
  setupTimings?: Array<{ name?: string; [key: string]: unknown }>;
}): "passed" | "failed" | "infra-failed";

export function validateDownloadedShardSummary(
  summary: Record<string, any>,
  plan: { planId: string; timingProvider: string; testedCommit: string; testedTree: string; shardTotal: number; shards: Array<{ surfaces: Array<{ files: Array<{ path: string }> }> }> },
  shardIndex: number,
): string | null;

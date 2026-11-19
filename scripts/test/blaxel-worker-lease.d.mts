export interface LeaseInput { lockId: string; runId?: string; shardIndex?: number; attempt?: number; attemptId?: string; owner?: string; ttlSeconds?: number; scratch?: string; audit?: boolean; operation?: string; processName?: string; retrieved?: boolean; worker?: string; summaryIdentity?: Record<string, unknown> }
export function shardScratchPath(input: LeaseInput): string;
export function workerLeaseCommand(input: LeaseInput): string;
export function workerEntryCommand(input: LeaseInput, script: string): string;

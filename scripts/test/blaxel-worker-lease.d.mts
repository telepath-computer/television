import type { Stats } from "node:fs";
export const DEFAULT_RECOVERY_SECONDS: number;
export const SHARD_OWNER_ENV: string;
export interface LeaseInput { lockId: string; runId?: string; shardIndex?: number; shardTotal?: number; attempt?: number; attemptId?: string; owner?: string; ttlSeconds?: number; expiresAt?: number; tmpRoot?: string; resultsRoot?: string; scratch?: string; auditTokens?: string[]; audit?: boolean; operation?: string; processName?: string; pid?: number; pidFromEnv?: boolean; retrieved?: boolean; worker?: string; summaryIdentity?: Record<string, unknown> }
export interface CleanupReport { ok: boolean; before: {availableBytes: number; freeBytes: number}; after: {availableBytes: number; freeBytes: number}; removed: Record<string, {directories: number; allocatedBytes: number}>; skips: unknown[]; errors: unknown[] }
export interface LeaseRecord { lockId: string; runId: string; attemptId: string; recoverAfter: number; lastRenewal: number; expiresAt: number; recovery: {discardedReports: boolean} | null }
export function shardScratchPath(input: LeaseInput): string;
export function workerLeaseCommand(input: LeaseInput): string;
export function workerEntryCommand(input: LeaseInput, script: string): string;
export function workerLeaseOperation(input: LeaseInput, hooks?: {now?: () => number; scanOwners?: () => Promise<Array<Record<string, unknown>>>; stopOwners?: (token: string) => Promise<unknown[]>; cleanTemporary?: (input: {tmpRoot: string; current: string | null; onlyCurrent: boolean}) => Promise<CleanupReport>}): Promise<{ok: boolean; reason?: string; deleting?: boolean; record: LeaseRecord}>;
export function cleanWorkerTemporaryDirectories(input: {tmpRoot: string; current: string | null; onlyCurrent?: boolean}, probes?: {lstat?: (file: string) => Stats; remove?: (file: string) => void}): Promise<CleanupReport>;

import type { TimingProvider } from "./timing-events.mjs";
import type { TimingBaseline } from "./timing-baseline.mjs";
import type { InventoryFile } from "./file-inventory.mjs";
import type { TestSurface } from "./config.mjs";
export interface PlannedFile { path: string; weightMs: number; weightSource: "baseline" | "unknown-surface" | "unknown-timing-provider"; baselineSampleCount?: number }
export interface PlannedSurface { surfaceId: string; runner: "vitest" | "playwright"; files: PlannedFile[] }
export interface PlannedShard { index: number; total: number; predictedDurationMs: number; surfaces: PlannedSurface[] }
export interface ShardPlan { schemaVersion: 1; planId: string; timingProvider: TimingProvider; testedCommit: string; testedTree: string; shardTotal: number; selectedSurfaceIds: string[]; timingBaselinePath: "test/timing-baseline.json"; timingBaselineDigest: string; shards: PlannedShard[] }
export function createShardPlan(args: { inventory: InventoryFile[]; surfaces: TestSurface[]; baseline: TimingBaseline; baselineBytes: string | Buffer; timingProvider: TimingProvider; testedCommit: string; testedTree: string; shardTotal: number }): ShardPlan;
export function validateShardPlan(plan: ShardPlan, expected?: { inventory?: InventoryFile[] | null; timingProvider?: TimingProvider | null; testedCommit?: string | null; testedTree?: string | null; shardIndex?: number | null; shardTotal?: number | null }): ShardPlan;
export function recommendShardCount(args: Parameters<typeof createShardPlan>[0] & { capacity: number; targetMs?: number; currentCount?: number | null }): Record<string, unknown>;
export function assignedFilesForShard(plan: ShardPlan, shardIndex: number): Array<PlannedFile & { surfaceId: string; runner: "vitest" | "playwright" }>;
export function nearestRankP90(values: number[]): number | null;

import type { TestSurface } from "./config.mjs";
import type { NormalizedSurfaceResult } from "./reporting.mjs";
import type { AttemptReport } from "./provider-outputs.mjs";

export function normalizeProviderShardSurfaces(args: {
  provider: string;
  providerSummary?: AttemptReport | null;
  outputDir: string;
  surfaces: TestSurface[];
  delegatedCommand: string[];
  exitCode: number | null;
  coordinatorLogPath: string;
}): NormalizedSurfaceResult[];

export function normalizeBlaxelSurfaces(args: {
  providerSummary?: AttemptReport | null;
  outputDir: string;
  surfaces: TestSurface[];
  delegatedCommand: string[];
  exitCode: number | null;
  coordinatorLogPath: string;
}): NormalizedSurfaceResult[];

export function resolveProviderRunGit(args: {
  providerSummary?: AttemptReport | null;
  fallbackGit?: Record<string, unknown>;
}): Record<string, unknown>;

export function normalizeProviderTimingShards(args: {
  providerSummary?: AttemptReport | null;
  outputDir: string;
  surfaces: TestSurface[];
  coordinatorLogPath: string;
}): Array<Record<string, unknown>>;

export function mergeSurfaceParts(parts: NormalizedSurfaceResult[]): NormalizedSurfaceResult[];
export function resolveNativeResultPath(outputDir: string, nativeResultPath?: string | null): string | null;

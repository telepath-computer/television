import type { TimingEvent, TimingPhase, TimingPhaseCategory } from "./timing-events.mjs";

export interface PhaseMetricsSummary {
  schemaVersion: 1;
  run: {
    durationMs?: number;
    observedStartedAt?: string;
    observedCompletedAt?: string;
    observedWallDurationMs?: number;
    phases: TimingPhase[];
  };
  shards: Array<{
    index: number;
    total: number;
    status: string;
    durationMs?: number;
    phases: TimingPhase[];
    surfaces: Array<{ surfaceId: string; status: string; durationMs?: number; durationSource?: string; phases: TimingPhase[] }>;
  }>;
}

export function normalizeTimingPhase(phase: Partial<TimingPhase> & Pick<TimingPhase, "name">): TimingPhase;
export function normalizeSetupTimingStatus(status: number | TimingPhase["status"] | null | undefined): TimingPhase["status"];
export function inferPhaseCategory(name: string): TimingPhaseCategory;
export function readPhaseMetricsFile(file?: string | null): TimingPhase[];
export function appendPhaseMetricFile(file: string, phase: Partial<TimingPhase> & Pick<TimingPhase, "name">): TimingPhase;
export function recordPhaseMetricBestEffort<T>(context: string, operation: () => T): T | null;
export function phaseFromEpoch(args: { name: string; category?: TimingPhaseCategory; status?: TimingPhase["status"]; startedMs: number; completedMs?: number; cacheStatus?: TimingPhase["cacheStatus"] }): TimingPhase;
export function summarizePhaseMetrics(events: TimingEvent[], options?: { additionalRunPhases?: TimingPhase[] }): PhaseMetricsSummary;
export function attachPhaseMetricsToSummary(args: { runDir: string; summary: Record<string, any>; events: TimingEvent[]; additionalRunPhases?: TimingPhase[] }): PhaseMetricsSummary;
export function appendRunSummaryPhase(args: { runDir: string; phase: Partial<TimingPhase> & Pick<TimingPhase, "name"> }): TimingPhase;

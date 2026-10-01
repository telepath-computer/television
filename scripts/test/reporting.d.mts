import type { TestSurface } from "./config.mjs";

export interface Counts {
  testsTotal: number;
  testsPassed: number;
  testsFailed: number;
  testsSkipped: number;
  testsFlakyRecovered: number;
}

export interface NormalizedSurfaceResult {
  id: string;
  runner: string;
  status: string;
  infraStatus?: string;
  command: string[];
  exitCode?: number | null;
  durationMs: number;
  durationSource: "surface-wall" | "owned-file-sum" | "task-wall" | "unknown";
  logPath: string | null;
  nativeResultPath?: string | null;
  nativeResultPaths?: string[];
  counts: Counts;
  failedTests: Array<Record<string, unknown>>;
  flakyRecoveredTests: Array<Record<string, unknown>>;
  processLeaks: import("./timing-events.mjs").NormalizedProcessLeak[];
  files: import("./timing-events.mjs").NormalizedFileObservation[];
  skipReason?: string | null;
  assignedFiles?: string[];
  collectedFiles?: string[];
  [key: string]: unknown;
}

export function safeSurfaceName(id: string): string;
export interface ReportSummary {
  run: { id: string; commandProvider: "local" | "blaxel" | null; timingProvider: import("./timing-events.mjs").TimingProvider; status: string; infraStatus: string; testStatus: string; [key: string]: unknown };
  counts: { surfacesSelected: number; surfacesRun: number; surfacesSkipped: number; testsFailed: number; [key: string]: number };
  failedSurfaces: Array<Record<string, unknown>>;
  skippedSurfaces: Array<Record<string, unknown>>;
  failedTests: Array<Record<string, unknown>>;
  flakyRecoveredTests: Array<Record<string, unknown>>;
  [key: string]: unknown;
}

export interface ReportResults {
  counts: { surfacesSelected: number; surfacesRun: number; surfacesSkipped: number; [key: string]: number };
  infraFailures: Array<Record<string, unknown>>;
  surfaces: NormalizedSurfaceResult[];
  [key: string]: unknown;
}

export function buildReports(args: {
  runId: string;
  provider?: string | null;
  commandProvider?: "local" | "blaxel" | null;
  timingProvider?: import("./timing-events.mjs").TimingProvider;
  runDir: string;
  selection: Record<string, unknown>;
  git?: Record<string, unknown> | null;
  preflights?: Array<Record<string, unknown>>;
  surfaces: NormalizedSurfaceResult[];
  startedAt: string;
  completedAt: string;
}): { summary: ReportSummary; results: ReportResults };
export function normalizeSurfaceResult(args: { surface: Pick<TestSurface, "id" | "runner"> & Partial<TestSurface> & { durationSource?: NormalizedSurfaceResult["durationSource"] }; command: string[]; exitCode: number | null; durationMs: number; logPath: string; nativeResultPath: string | null; attemptResultPath?: string | null; processLeaks?: Array<Record<string, unknown>> }): NormalizedSurfaceResult;

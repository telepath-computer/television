import type { TimingProvider, TimingEvent } from "./timing-events.mjs";
import type { NormalizedSurfaceResult, ReportResults, ReportSummary } from "./reporting.mjs";
export interface RunContext {
  runId: string;
  runDir: string;
  absoluteRunDir: string;
  commandProvider: "local" | "blaxel" | null;
  timingProvider: TimingProvider;
}
export function createRunContext(commandProvider: RunContext["commandProvider"], options?: { root?: string; now?: Date; pid?: number; randomBytes?: (size: number) => Buffer; timingProvider?: TimingProvider | null; env?: NodeJS.ProcessEnv }): RunContext;
export function readRunDirectoryIdentity(identityFile: string, options?: { root?: string }): string;
export function createRunId(options?: { now?: Date; pid?: number; randomBytes?: (size: number) => Buffer }): string;
export function resolveTimingProvider(options?: { env?: NodeJS.ProcessEnv; platform?: string; arch?: string; logicalCpuCount?: number; supplied?: TimingProvider }): TimingProvider;
export function atomicWriteFile(file: string, contents: string | Buffer): void;
export function atomicWriteJson(file: string, value: unknown): void;
export function finalizeRun(args: { runContext: RunContext; selection: Record<string, unknown>; git?: Record<string, unknown> | null; preflights?: Array<Record<string, unknown>>; surfaces?: NormalizedSurfaceResult[]; startedAt: string; completedAt: string; shard?: Record<string, any>; shards?: Array<Record<string, unknown>> | null }): { summary: ReportSummary; results: ReportResults; events: TimingEvent[] };

import type { TimingEvent } from "./timing-events.mjs";
export const TIMING_BASELINE_PATH: "test/timing-baseline.json";
export const BASELINE_TIMING_PROVIDER: "blaxel-playwright-x64-4vcpu";
export interface ProviderFileTiming { medianDurationMs: number; sampleCount: number; retryCount: number; recoveredFlakeCount: number; lastUpdated: string }
export interface TimingBaseline { schemaVersion: 1; sourceThrough: string | null; files: Record<string, { surfaceId: string; providers: { "blaxel-playwright-x64-4vcpu": ProviderFileTiming } }> }
export interface BaselineInputRun { dir: string; run: Record<string, any>; events: TimingEvent[] }
export const EMPTY_TIMING_BASELINE: TimingBaseline;
export function readTimingBaseline(options?: { repoRoot?: string; baselinePath?: string }): { baseline: TimingBaseline; bytes: Buffer; file: string };
export function validateTimingBaseline(baseline: unknown): TimingBaseline;
export function updateTimingBaseline(options: { repoRoot?: string; config: { surfaces: Array<Record<string, any>>; suites: Record<string, { include?: string[]; exclude?: string[] }>; root?: string }; dryRun?: boolean }): { baseline: TimingBaseline; bytes: Buffer; runs: BaselineInputRun[]; changes: Array<Record<string, any>>; changed: boolean; dryRun: boolean };
export function rollupTimingEvents(args: { runs: BaselineInputRun[]; config: { surfaces: Array<Record<string, any>>; root?: string } }): TimingBaseline;
export function serializeTimingBaseline(baseline: TimingBaseline): Buffer;
export function diffBaseline(before: TimingBaseline, after: TimingBaseline): Array<Record<string, any>>;

export type TimingProvider =
  | `local-${"linux" | "darwin"}-${"x64" | "arm64"}-${number}cpu`
  | "blaxel-playwright-x64-4vcpu"
  | "github-ubuntu-24.04-x64-2vcpu-vm"
  | "github-playwright-noble-x64-2vcpu";
export type EventStatus = "passed" | "failed" | "skipped" | "timed-out" | "interrupted" | "not-assigned" | "incomplete" | "unknown";
export type TimingPhaseCategory = "schedule" | "checkout" | "dependencies" | "readiness" | "plan" | "join" | "test" | "report" | "publication" | "verification" | "other";
export interface TimingPhase { name: string; category: TimingPhaseCategory; status: "passed" | "failed" | "skipped" | "unknown"; startedAt?: string; completedAt?: string; durationMs?: number; cacheStatus?: "hit" | "miss" | "not-applicable" | "unknown" }
export interface ProcessLeakSocket { protocol: "tcp"; family: "ipv4" | "ipv6" | "unknown"; host: string; port: number }
export interface NormalizedProcessLeak {
  leakId: string;
  ownerToken: string;
  owningSurfaceIds: string[];
  pid: number;
  parentPid: number | null;
  processGroupId: number | null;
  processStartedAt: string;
  detectedAt: string;
  command: string;
  listeningSockets: ProcessLeakSocket[];
  cleanup: { termSent: boolean; killSent: boolean; outcome: "terminated" | "killed" | "already-exited" | "survived" | "unknown" };
}
export interface NormalizedAttempt {
  attemptIndex: number;
  project?: string;
  titlePath: string[];
  line?: number;
  column?: number;
  status: EventStatus;
  startedAt?: string;
  completedAt?: string;
  durationMs: number;
  recoveredFlake?: boolean;
  flakyAnnotated?: boolean;
}
export interface NormalizedFileObservation {
  path: string;
  status: EventStatus;
  complete: boolean;
  startedAt?: string;
  completedAt?: string;
  durationMs: number;
  planningDurationMs: number;
  durationSource: "file-wall" | "attempt-sum" | "runner-total" | "unknown";
  testsTotal: number;
  retryCount: number;
  recoveredFlakeCount: number;
  attempts: NormalizedAttempt[];
}
export interface TimingEvent { schemaVersion: 1; sequence: number; kind: "run" | "shard" | "surface" | "file" | "test-attempt" | "process-leak"; runId: string; [key: string]: unknown }
export function canonicalize(value: unknown): string;
export function sha256(value: string | Buffer): string;
export function testIdentity(input: { surfaceId: string; path: string; project?: string | null; titlePath: string[]; line?: number | null; column?: number | null }): string;
export function processLeakIdentity(input: { ownerToken: string; pid: number; processStartedAt: string }): string;
export function normalizeProcessLeak(leak: Partial<NormalizedProcessLeak> & Pick<NormalizedProcessLeak, "ownerToken" | "owningSurfaceIds" | "pid" | "processStartedAt" | "detectedAt" | "command" | "listeningSockets" | "cleanup">): NormalizedProcessLeak;
export function validateTimingProvider(value: string): TimingProvider;
export function buildTimingEvents(args: { run: Record<string, any>; shards: Array<Record<string, any>> }): TimingEvent[];
export function serializeTimingEvents(events: TimingEvent[]): string;
export function validateTimingEvents(events: TimingEvent[]): TimingEvent[];

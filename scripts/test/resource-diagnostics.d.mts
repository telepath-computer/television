export function startResourceDiagnostics(options: { root: string; identity: Record<string, unknown>; readProbe?: (name: string, interval?: Record<string, unknown>) => unknown; now?: () => Date; write?: (file: string, contents: string) => void; warn?: (message: string) => void }): { file: string | null; finish: (outcome: { runner: string; nativeResultPath: string | null; attemptResultPath?: string | null; exitCode: number; incomplete?: boolean }) => string[] };
export function writeResourceDiagnostic(root: string, name: string, record: Record<string, unknown>, options?: { write?: (file: string, contents: string) => void; warn?: (message: string) => void }): string | null;
export const RESOURCE_SIDECAR_BYTES: number;
export const RESOURCE_ATTEMPT_BYTES: number;
export function surfaceResourceDiagnostics(options: { resultsDir: string; surfaceId: string; env?: NodeJS.ProcessEnv; runId: string }): ReturnType<typeof startResourceDiagnostics>;
export function readLinuxResourceProbe(name: string, options?: Record<string, string>): unknown;

import type { ElectronE2EPlan } from "../electron-e2e-env.mjs";
import type { TestSurface } from "./config.mjs";

export interface PreflightResult {
  name: string;
  provider: string;
  status: "passed" | "failed";
  message?: string;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  [key: string]: unknown;
}

export interface RemoteGitPreflight {
  commit: string;
  reachableFromOrigin: true;
  workingTreeDirty: boolean;
  containingRemotes: string[];
}

export interface RemotePreflightResult {
  provider: string;
  results: PreflightResult[];
  git: RemoteGitPreflight | null;
}

export const DAEMON_TEST_HOST_ENV: "TV_DAEMON_TEST_HOST";
export const POSTHOG_TEST_READ_KEY_ENV: "TV_POSTHOG_TEST_READ_KEY";
export const POSTHOG_TEST_READ_KEY_DOTENV_FILE: ".env";
export function readPostHogTestReadKey(options?: { env?: Record<string, string | undefined>; root?: string }): { value: string; source: string } | null;
export function requiredPreflights(surfaces: Array<Pick<TestSurface, "preflight">>, provider: string): string[];
export function runPreflights(checks: string[], options: {
  provider: string;
  electron?: { root?: string; plan?: ElectronE2EPlan };
}): PreflightResult[];
export function runProviderCapabilityPreflight(provider: string): PreflightResult[];
export function runRemotePreflight(provider: string, options?: Record<string, string>, selftest?: { allowPassingSelftest?: boolean }): RemotePreflightResult;

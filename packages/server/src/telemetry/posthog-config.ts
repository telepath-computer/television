import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { telemetryDestination, type TelemetryEnv } from "./identity.ts";

export const POSTHOG_US_INGESTION_HOST = "https://us.i.posthog.com";
export const POSTHOG_US_API_HOST = "https://us.posthog.com";

export const POSTHOG_PRODUCTION_PROJECT_ID = 482022;
export const POSTHOG_TEST_PROJECT_ID = 484904;

export const POSTHOG_PRODUCTION_PROJECT_TOKEN = "phc_qASjRhbnr7AA9ak5YeQtWtHdGY5P9TM9Q2k86G34LoYP";
export const POSTHOG_TEST_PROJECT_TOKEN = "phc_roRM2of2chrstmcQAokxucoYa4KBUatW9bTjLKeBcgi4";

export interface PostHogProjectConfig {
  projectId: number;
  projectToken: string;
  ingestionHost: string;
  apiHost: string;
}

export interface PostHogProjectResolutionOptions {
  developerHost?: boolean;
  optedOut?: boolean;
}

export const POSTHOG_PRODUCTION_PROJECT: PostHogProjectConfig = {
  projectId: POSTHOG_PRODUCTION_PROJECT_ID,
  projectToken: POSTHOG_PRODUCTION_PROJECT_TOKEN,
  ingestionHost: POSTHOG_US_INGESTION_HOST,
  apiHost: POSTHOG_US_API_HOST,
};

export const POSTHOG_TEST_PROJECT: PostHogProjectConfig = {
  projectId: POSTHOG_TEST_PROJECT_ID,
  projectToken: POSTHOG_TEST_PROJECT_TOKEN,
  ingestionHost: POSTHOG_US_INGESTION_HOST,
  apiHost: POSTHOG_US_API_HOST,
};

export function resolvePostHogProject(env: TelemetryEnv, options: PostHogProjectResolutionOptions = {}): PostHogProjectConfig | null {
  const destination = telemetryDestination(env, { optedOut: options.optedOut ?? false }, options.developerHost ?? false);
  return destination === "test" ? POSTHOG_TEST_PROJECT : destination === "production" ? POSTHOG_PRODUCTION_PROJECT : null;
}

export function resolveTelemetryDeveloperHome(env: Pick<TelemetryEnv, "TELEVISION_DEVELOPER_HOME"> = process.env): string {
  const capturedHome = env.TELEVISION_DEVELOPER_HOME;
  return capturedHome && capturedHome.length > 0 ? capturedHome : os.homedir();
}

export function detectTelemetryDeveloperHost(homeDir = os.homedir()): boolean {
  try {
    return existsSync(path.join(homeDir, ".tv-developer"));
  } catch {
    return false;
  }
}

export function assertPostHogIntegrationProjectIsSafe(projectId: number): void {
  if (projectId === POSTHOG_PRODUCTION_PROJECT_ID) {
    throw new Error("Refusing to run telemetry integration tests against the production PostHog project.");
  }
}

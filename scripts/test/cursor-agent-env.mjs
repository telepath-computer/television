/**
 * When CURSOR_AGENT=1, unset env vars Cursor injects that break local tests.
 * See specs/arch/test-runner/test-runner.md "Cursor-agent environment workaround".
 */

/** Set by Cursor on agent shell invocations (observed value: "1"). */
export const CURSOR_AGENT_ENV_FLAG = "CURSOR_AGENT";

/** Removed from env when isCursorAgentRuntime(env) is true. */
export const CURSOR_AGENT_ENV_VARS = ["ELECTRON_RUN_AS_NODE", "PLAYWRIGHT_BROWSERS_PATH"];

/** True when the process env indicates a Cursor agent invocation. */
export function isCursorAgentRuntime(env = process.env) {
  return env[CURSOR_AGENT_ENV_FLAG] === "1";
}

/** Return a copy of `env` with Cursor agent overrides removed, or unchanged. */
export function stripCursorAgentEnv(env = process.env) {
  if (!isCursorAgentRuntime(env)) {
    return { ...env };
  }
  const next = { ...env };
  for (const key of CURSOR_AGENT_ENV_VARS) {
    delete next[key];
  }
  return next;
}

/** Mutate `env` in place when running under Cursor agent; no-op otherwise. */
export function applyCursorAgentEnvWorkaround(env = process.env) {
  if (!isCursorAgentRuntime(env)) {
    return env;
  }
  for (const key of CURSOR_AGENT_ENV_VARS) {
    delete env[key];
  }
  return env;
}

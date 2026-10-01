export const CURSOR_AGENT_ENV_FLAG: string;
export const CURSOR_AGENT_ENV_VARS: readonly string[];

export function isCursorAgentRuntime(env?: NodeJS.ProcessEnv): boolean;
export function stripCursorAgentEnv(env?: NodeJS.ProcessEnv): NodeJS.ProcessEnv;
export function applyCursorAgentEnvWorkaround(env?: NodeJS.ProcessEnv): NodeJS.ProcessEnv;

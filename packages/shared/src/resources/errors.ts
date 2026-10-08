import type { ResourceRefusalCode } from "./types.ts";

/** A refusal: an ordinary `Error` carrying a stable string `code`. */
export interface ResourceError extends Error {
  code: ResourceRefusalCode;
}

export function resourceError(code: ResourceRefusalCode, message: string): ResourceError {
  return Object.assign(new Error(message), { code });
}

export function isResourceError(error: unknown): error is ResourceError {
  return error instanceof Error && typeof (error as { code?: unknown }).code === "string";
}

const REFUSAL_CODES: Record<ResourceRefusalCode, true> = {
  "not-artifact-page": true,
  "no-store": true,
  "not-enabled": true,
  "not-bound": true,
  "wrong-type": true,
  "read-only": true,
  "not-found": true,
  "no-artifact": true,
  "not-shareable": true,
  "not-shared": true,
  "tokenless": true,
  "access-required": true,
  "read-write-unsupported": true,
  "owner-binding": true,
  "invalid-description": true,
  "invalid-usage": true,
  "still-bound": true,
  unavailable: true,
  disconnected: true,
  "invalid-path": true,
  "invalid-value": true,
  "too-large": true,
  "max-retries": true,
};

/** Whether an error is a resource refusal, whose code is one the specs define, unlike a system error's. */
export function isResourceRefusal(error: unknown): error is ResourceError {
  return isResourceError(error) && Object.hasOwn(REFUSAL_CODES, error.code);
}

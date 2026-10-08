import { isResourceError, type ResourceRefusalCode } from "@telepath-computer/television-shared/resources";

export const HTTP_CREATED = 201;
export const HTTP_BAD_REQUEST = 400;
export const HTTP_UNAUTHORIZED = 401;
export const HTTP_NOT_FOUND = 404;
export const HTTP_UPGRADE_REQUIRED = 426;
const HTTP_SERVER_ERROR = 500;

/** Whether a status is a client error, as body-parser reports malformed or oversized bodies. */
export function isClientErrorStatus(status: unknown): status is number {
  return typeof status === "number" && status >= HTTP_BAD_REQUEST && status < HTTP_SERVER_ERROR;
}

const REFUSAL_STATUS: Record<ResourceRefusalCode, number> = {
  "not-artifact-page": 400,
  "no-store": 404,
  "not-enabled": 404,
  "not-bound": 409,
  "wrong-type": 409,
  "read-only": 403,
  "not-found": 404,
  "no-artifact": 404,
  "not-shareable": 409,
  "not-shared": 409,
  tokenless: 403,
  "access-required": 409,
  "read-write-unsupported": 409,
  "owner-binding": 409,
  "invalid-description": 400,
  "invalid-usage": 400,
  "still-bound": 409,
  unavailable: 503,
  disconnected: 503,
  "invalid-path": 400,
  "invalid-value": 400,
  "too-large": 413,
  "max-retries": 409,
};

/** The HTTP status and body for a refusal: `{ error, code }`, with `bindings` for `still-bound`. */
export function refusalResponse(error: unknown): { status: number; body: Record<string, unknown> } | null {
  if (!isResourceError(error) || !(error.code in REFUSAL_STATUS)) return null;
  const bindings = (error as { bindings?: unknown }).bindings;
  return {
    status: REFUSAL_STATUS[error.code],
    body: { error: error.message, code: error.code, ...(bindings === undefined ? {} : { bindings }) },
  };
}

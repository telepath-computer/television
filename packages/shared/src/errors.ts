/**
 * Typed-error helper. Models `defineEvent` from `@rupertsworld/event-target`:
 * one interface plus one const declaration gives both `throw new FooError(...)`
 * and `err instanceof FooError` narrowing.
 *
 *   export interface MyError extends Error {
 *     name: "MyError";
 *     // extra fields
 *   }
 *   export const MyError = defineError<MyError>("MyError");
 *
 *   throw new MyError("boom", { extraField: 42 });
 */

type ErrorFields<T extends Error> = Omit<T, keyof Error>;

type HasRequiredFields<T extends Error> = keyof ErrorFields<T> extends never ? false : true;

type DefineErrorConstructor<T extends Error> = HasRequiredFields<T> extends true
  ? { new (message: string, fields: ErrorFields<T>): T }
  : { new (message: string, fields?: ErrorFields<T>): T };

export function defineError<T extends Error>(name: string): DefineErrorConstructor<T> {
  class DefinedError extends Error {
    constructor(message: string, fields?: Record<string, unknown>) {
      super(message);
      this.name = name;
      if (fields) Object.assign(this, fields);
    }
  }
  return DefinedError as unknown as DefineErrorConstructor<T>;
}

/** Thrown by `TelevisionClient` on transport or HTTP failure. */
export interface RequestError extends Error {
  name: "RequestError";
  serverURL: string;
  status?: number;
}
export const RequestError = defineError<RequestError>("RequestError");

/** Thrown on local validation of artifact-model inputs. */
export interface ValidationError extends Error {
  name: "ValidationError";
}
export const ValidationError = defineError<ValidationError>("ValidationError");

/**
 * Boundary error: the referenced entity (artifact, channel, content file,
 * etc.) does not exist. Route layer maps this to HTTP 404.
 *
 * Domain-agnostic by design: use `entityType` to describe what was missing
 * (e.g. "artifact", "channel") rather than defining per-domain subclasses.
 */
export interface NotFoundError extends Error {
  name: "NotFoundError";
  entityType: string;
  entityID: string;
}
export const NotFoundError = defineError<NotFoundError>("NotFoundError");

/**
 * Boundary error: the request is malformed, violates a domain invariant, or
 * conflicts with current state. Route layer maps this to HTTP 400.
 *
 * Used for validation failures, state conflicts (wrong kind, wrong status),
 * and any other "caller asked for something we won't do" condition. Plain
 * `throw new Error(...)` is reserved for unexpected/programming errors
 * (→ 500).
 */
export interface InvalidRequestError extends Error {
  name: "InvalidRequestError";
}
export const InvalidRequestError = defineError<InvalidRequestError>("InvalidRequestError");

/**
 * Boundary error: the request is well-formed and the referenced entities
 * exist, but current state cannot satisfy it (e.g. focusing an artifact
 * that is attached to no channel). Route layer maps this to HTTP 409.
 */
export interface ConflictError extends Error {
  name: "ConflictError";
}
export const ConflictError = defineError<ConflictError>("ConflictError");

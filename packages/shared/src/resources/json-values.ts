import { resourceError } from "./errors.ts";
import { JSON_STORE_MAX_DEPTH, isArrayIndexIn, isJsonObject, isValidKey, tooDeepError } from "./json-paths.ts";
import type { JSONValue } from "./types.ts";

export type ServerValueSpec = { kind: "timestamp" } | { kind: "increment"; by: number };

/** A value the server fills in when it applies the write. */
export class ServerValuePlaceholder {
  readonly serverValue: ServerValueSpec;
  constructor(serverValue: ServerValueSpec) {
    this.serverValue = serverValue;
    Object.freeze(this);
  }
}

/** Deletes its path; accepted only as an entry of an update. */
export class DeleteValuePlaceholder {
  constructor() {
    Object.freeze(this);
  }
}

export function serverTimestamp(): ServerValuePlaceholder {
  return new ServerValuePlaceholder({ kind: "timestamp" });
}

export function increment(n: number): ServerValuePlaceholder {
  return new ServerValuePlaceholder({ kind: "increment", by: n });
}

export function deleteValue(): DeleteValuePlaceholder {
  return new DeleteValuePlaceholder();
}

/** A JSON value in which a server-value placeholder may stand in for any value. */
export type WriteValue = JSONValue | ServerValuePlaceholder | WriteValue[] | { [key: string]: WriteValue };
export type UpdateEntryValue = WriteValue | DeleteValuePlaceholder;

function invalidValue(message: string): Error {
  return resourceError("invalid-value", message);
}

function isPlainObject(value: object): boolean {
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function checkServerValueSpec(spec: unknown): asserts spec is ServerValueSpec {
  if (typeof spec !== "object" || spec === null) throw invalidValue("A server value is malformed.");
  const record = spec as Record<string, unknown>;
  if (record.kind === "timestamp" && Object.keys(record).length === 1) return;
  if (
    record.kind === "increment" &&
    Object.keys(record).length === 2 &&
    typeof record.by === "number" &&
    Number.isFinite(record.by)
  ) {
    return;
  }
  throw invalidValue("increment() takes a finite number.");
}

/**
 * Checks a value whose top lies `depth` keys below where it is checked from.
 * A member deeper than the store's depth limit is refused before it is
 * visited, so the recursion never runs deeper than the limit.
 */
function checkValue(value: unknown, allowServerValues: boolean, ancestors: Set<object>, depth: number): void {
  if (value === null || typeof value === "boolean" || typeof value === "string") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw invalidValue("A stored number must be finite.");
    return;
  }
  if (allowServerValues && value instanceof ServerValuePlaceholder) {
    checkServerValueSpec(value.serverValue);
    return;
  }
  if (typeof value !== "object") {
    throw invalidValue(`A ${typeof value} is not a JSON value.`);
  }
  if (ancestors.has(value)) throw invalidValue("A value cannot contain itself.");
  ancestors.add(value);
  if (Array.isArray(value)) {
    if (value.length > 0 && depth >= JSON_STORE_MAX_DEPTH) throw tooDeepError();
    for (let index = 0; index < value.length; index++) {
      if (!(index in value)) throw invalidValue("An array cannot have holes.");
      checkValue(value[index], allowServerValues, ancestors, depth + 1);
    }
  } else {
    if (!isPlainObject(value)) {
      throw invalidValue("Only plain objects, arrays, strings, finite numbers, booleans and null are JSON values.");
    }
    const keys = Object.keys(value);
    if (keys.length > 0 && depth >= JSON_STORE_MAX_DEPTH) throw tooDeepError();
    for (const key of keys) {
      if (!isValidKey(key)) {
        throw invalidValue("An object key must be non-empty, contain no /, and be at most 768 bytes.");
      }
      checkValue((value as Record<string, unknown>)[key], allowServerValues, ancestors, depth + 1);
    }
  }
  ancestors.delete(value);
}

/**
 * Throws `invalid-value` unless `value` is JSON (specs/arch/resources/json-store.md#^js-arch-values),
 * and `invalid-path` when it nests more than 32 keys below its top, which no
 * store can hold (specs/arch/resources/json-store.md#^js-arch-limits).
 */
export function validateJsonValue(value: unknown): asserts value is JSONValue {
  checkValue(value, false, new Set(), 0);
}

/** As `validateJsonValue`, for JSON in which server-value placeholders may stand. */
export function validateWriteValue(value: unknown): asserts value is WriteValue {
  checkValue(value, true, new Set(), 0);
}

/** Throws `invalid-value` unless every entry is a written value or a delete placeholder. */
export function validateUpdateValues(values: unknown): asserts values is Record<string, UpdateEntryValue> {
  if (typeof values !== "object" || values === null || Array.isArray(values) || !isPlainObject(values)) {
    throw invalidValue("update() takes an object of paths and values.");
  }
  for (const key of Object.keys(values)) {
    const entry = (values as Record<string, unknown>)[key];
    if (!(entry instanceof DeleteValuePlaceholder)) validateWriteValue(entry);
  }
}

/** Sets an own enumerable member, so a key such as `__proto__` stays an ordinary member. */
export function setMember(target: Record<string, unknown>, key: string, value: unknown): void {
  Object.defineProperty(target, key, { value, enumerable: true, writable: true, configurable: true });
}

// --- Wire encoding: placeholders travel apart from the plain JSON, so any
// plain value, including an object with a key such as `.sv`, is stored
// exactly as written (specs/arch/resources/json-store.md#^js-arch-values).

export interface EncodedServerValue {
  /** Keys from the written value's top to the placeholder's position. */
  at: string[];
  serverValue: ServerValueSpec;
}

export interface EncodedWriteValue {
  /** The written value with `null` at each placeholder's position. */
  value: JSONValue;
  serverValues?: EncodedServerValue[];
}

export type EncodedUpdateEntry = { key: string; value: EncodedWriteValue } | { key: string; delete: true };

/** Encodes a value that has passed `validateWriteValue`. */
export function encodeWriteValue(value: WriteValue): EncodedWriteValue {
  const serverValues: EncodedServerValue[] = [];
  const encode = (node: WriteValue, at: string[]): JSONValue => {
    if (node instanceof ServerValuePlaceholder) {
      serverValues.push({ at, serverValue: { ...node.serverValue } });
      return null;
    }
    if (Array.isArray(node)) return node.map((element, index) => encode(element, [...at, String(index)]));
    if (node !== null && typeof node === "object") {
      const encoded: Record<string, JSONValue> = {};
      for (const key of Object.keys(node)) setMember(encoded, key, encode(node[key]!, [...at, key]));
      return encoded;
    }
    return node;
  };
  const encodedValue = encode(value, []);
  return serverValues.length > 0 ? { value: encodedValue, serverValues } : { value: encodedValue };
}

export function encodeUpdateEntries(values: Record<string, UpdateEntryValue>): EncodedUpdateEntry[] {
  return Object.keys(values).map((key) => {
    const entry = values[key]!;
    return entry instanceof DeleteValuePlaceholder ? { key, delete: true } : { key, value: encodeWriteValue(entry) };
  });
}

/**
 * Replaces the value at `at` with `leaf`. A container is copied the first
 * time a placement passes through it and changed in place after that, so a
 * value with many placeholders costs one copy of each container.
 */
function placeAt(node: WriteValue, at: readonly string[], depth: number, leaf: WriteValue, copies: Set<object>): WriteValue {
  if (depth === at.length) {
    if (node instanceof ServerValuePlaceholder) throw invalidValue("Two server values share one position.");
    return leaf;
  }
  const key = at[depth]!;
  if (Array.isArray(node) && isArrayIndexIn(node, key)) {
    const copy = copies.has(node) ? node : node.slice();
    copies.add(copy);
    copy[Number(key)] = placeAt(node[Number(key)]!, at, depth + 1, leaf, copies);
    return copy;
  }
  if (isJsonObject(node) && !(node instanceof ServerValuePlaceholder) && Object.hasOwn(node, key)) {
    const copy: Record<string, WriteValue> = copies.has(node) ? node : { ...node };
    copies.add(copy);
    setMember(copy, key, placeAt(node[key]!, at, depth + 1, leaf, copies));
    return copy;
  }
  throw invalidValue("A server value does not stand at a position in the written value.");
}

/** Decodes and validates a written value received over the wire. */
export function decodeWriteValue(encoded: unknown): WriteValue {
  if (typeof encoded !== "object" || encoded === null || !Object.hasOwn(encoded, "value")) {
    throw invalidValue("A written value is missing.");
  }
  const record = encoded as Record<string, unknown>;
  validateJsonValue(record.value);
  let decoded: WriteValue = record.value;
  const serverValues = record.serverValues ?? [];
  if (!Array.isArray(serverValues)) throw invalidValue("Server values are malformed.");
  const copies = new Set<object>();
  for (const serverValue of serverValues) {
    if (typeof serverValue !== "object" || serverValue === null) throw invalidValue("A server value is malformed.");
    const { at, serverValue: spec } = serverValue as Record<string, unknown>;
    if (!Array.isArray(at) || !at.every((key) => typeof key === "string")) {
      throw invalidValue("A server value's position is malformed.");
    }
    checkServerValueSpec(spec);
    decoded = placeAt(decoded, at, 0, new ServerValuePlaceholder({ ...spec }), copies);
  }
  return decoded;
}

/** Decodes an update's entries received over the wire, in order. */
export function decodeUpdateEntries(encoded: unknown): Array<readonly [string, UpdateEntryValue]> {
  if (!Array.isArray(encoded)) throw invalidValue("An update's entries are malformed.");
  return encoded.map((entry): readonly [string, UpdateEntryValue] => {
    if (typeof entry !== "object" || entry === null || typeof (entry as { key?: unknown }).key !== "string") {
      throw invalidValue("An update entry is malformed.");
    }
    const { key, delete: isDelete, value } = entry as { key: string; delete?: unknown; value?: unknown };
    if (isDelete === true) return [key, new DeleteValuePlaceholder()];
    return [key, decodeWriteValue(value)];
  });
}

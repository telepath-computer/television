import { resourceError } from "./errors.ts";
import { utf8ByteLength } from "./names.ts";
import type { JSONValue } from "./types.ts";

// specs/arch/resources/json-store.md#^js-arch-limits
export const JSON_STORE_MAX_KEY_BYTES = 768;
export const JSON_STORE_MAX_DEPTH = 32;

const INDEX_PATTERN = /^(?:0|[1-9][0-9]*)$/;

/**
 * Splits a path on `/` and drops empty segments; the empty list addresses the
 * whole value (specs/arch/resources/json-store.md#^js-arch-paths). Throws
 * `invalid-path` for a segment over the key limit or more than 32 segments.
 */
export function parseJsonPath(path: string): string[] {
  const segments = path.split("/").filter((segment) => segment.length > 0);
  checkPathSegments(segments);
  return segments;
}

export function checkPathSegments(segments: readonly string[]): void {
  if (segments.length > JSON_STORE_MAX_DEPTH) {
    throw resourceError("invalid-path", `A path has at most ${JSON_STORE_MAX_DEPTH} segments.`);
  }
  for (const segment of segments) {
    if (!isValidKey(segment)) {
      throw resourceError("invalid-path", `A path key is at most ${JSON_STORE_MAX_KEY_BYTES} bytes.`);
    }
  }
}

/** The refusal for a write that would put a value more than 32 keys below the store's root. */
export function tooDeepError(): Error {
  return resourceError("invalid-path", `A value can be at most ${JSON_STORE_MAX_DEPTH} keys below the store's root.`);
}

/** A key every member can be addressed by: non-empty, without `/`, within the key limit. */
export function isValidKey(key: string): boolean {
  return key.length > 0 && !key.includes("/") && utf8ByteLength(key) <= JSON_STORE_MAX_KEY_BYTES;
}

export function isIndexKey(key: string): boolean {
  return INDEX_PATTERN.test(key);
}

/** Whether `key` addresses an existing element of `array`. */
export function isArrayIndexIn(array: readonly unknown[], key: string): boolean {
  return isIndexKey(key) && Number(key) < array.length;
}

export function isJsonObject(value: unknown): value is { [key: string]: JSONValue } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Whether a write at one path can change the value at the other: the paths
 * are equal, or one lies within the other
 * (specs/arch/resources/json-store.md#^js-arch-changed-paths).
 */
export function pathsMeet(left: readonly string[], right: readonly string[]): boolean {
  const shorter = left.length <= right.length ? left : right;
  const longer = shorter === left ? right : left;
  return shorter.every((segment, index) => longer[index] === segment);
}

/** The value at `segments`, or undefined when the path has no value. */
export function readJsonValue(value: JSONValue | undefined, segments: readonly string[]): JSONValue | undefined {
  let current: JSONValue | undefined = value;
  for (const segment of segments) {
    if (Array.isArray(current)) {
      current = isArrayIndexIn(current, segment) ? current[Number(segment)] : undefined;
    } else if (isJsonObject(current)) {
      current = Object.hasOwn(current, segment) ? current[segment] : undefined;
    } else {
      return undefined;
    }
    if (current === undefined) return undefined;
  }
  return current;
}

/** Deep equality as JSON, ignoring object key order (specs/arch/resources/json-store.md#^js-arch-apply). */
export function jsonEqual(left: JSONValue | undefined, right: JSONValue | undefined): boolean {
  if (left === right) return true;
  if (left === undefined || right === undefined || left === null || right === null) return false;
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
    return left.every((element, index) => jsonEqual(element, right[index]));
  }
  if (typeof left !== "object" || typeof right !== "object") return false;
  const leftKeys = Object.keys(left);
  if (leftKeys.length !== Object.keys(right).length) return false;
  return leftKeys.every((key) => Object.hasOwn(right, key) && jsonEqual(left[key], right[key]));
}

/** Child order: index keys first in numeric order, then other keys by UTF-16 code units. */
export function compareChildKeys(left: string, right: string): number {
  const leftIndex = isIndexKey(left);
  const rightIndex = isIndexKey(right);
  if (leftIndex !== rightIndex) return leftIndex ? -1 : 1;
  if (leftIndex && left.length !== right.length) return left.length - right.length;
  return left < right ? -1 : left > right ? 1 : 0;
}

/** A value's children in child order: an array's indices or an object's keys; none otherwise. */
export function childKeys(value: JSONValue | undefined): string[] {
  if (Array.isArray(value)) return value.map((_, index) => String(index));
  if (isJsonObject(value)) return Object.keys(value).sort(compareChildKeys);
  return [];
}

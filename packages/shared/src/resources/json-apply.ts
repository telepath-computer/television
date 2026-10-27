import { resourceError, type ResourceError } from "./errors.ts";
import {
  JSON_STORE_MAX_DEPTH,
  checkPathSegments,
  isArrayIndexIn,
  isJsonObject,
  parseJsonPath,
  readJsonValue,
  tooDeepError,
} from "./json-paths.ts";
import {
  DeleteValuePlaceholder,
  ServerValuePlaceholder,
  setMember,
  validateWriteValue,
  type UpdateEntryValue,
  type WriteValue,
} from "./json-values.ts";
import { utf8ByteLength } from "./names.ts";
import type { JSONValue } from "./types.ts";

// specs/arch/resources/json-store.md#^js-arch-limits
export const JSON_STORE_MAX_BYTES = 1_048_576;

/**
 * The most UTF-8 bytes a write's message may take as sent, the page connection
 * message or administrative request body that carries it
 * (specs/arch/resources/json-store.md#^js-arch-write-limit).
 */
export const JSON_STORE_MAX_WRITE_MESSAGE_BYTES = 16_777_216;

export type JsonWrite =
  | { kind: "set"; path: string; value: WriteValue }
  | { kind: "update"; path: string; entries: ReadonlyArray<readonly [string, UpdateEntryValue]> }
  | { kind: "remove"; path: string };

/**
 * The paths a write touches, as `changed` lists them: each one's segments
 * joined with `/`, the whole value being the empty string
 * (specs/arch/resources/json-store.md#^js-arch-changed-paths).
 */
export function jsonWritePaths(write: JsonWrite): string[] {
  const base = parseJsonPath(write.path);
  if (write.kind !== "update") return [base.join("/")];
  return write.entries.map(([key]) => [...base, ...key.split("/").filter((segment) => segment.length > 0)].join("/"));
}

/** What server values are filled from: the clock in milliseconds since the Unix epoch. */
export interface ServerValueContext {
  now: number;
}

export interface ApplyOptions {
  /**
   * Whether the result is checked against the size limit; true unless set
   * false. The SDK leaves size to the server: it holds only the parts of a
   * store its page reads, so it cannot know whether the rest is arrays or
   * objects, which encode at different sizes.
   */
  checkSize?: boolean;
}

type Mutation = { segments: string[]; value: WriteValue } | { segments: string[]; remove: true };

function invalidPath(message: string): Error {
  return resourceError("invalid-path", message);
}

/**
 * Applies one write to a store's value and returns the new value, leaving
 * `current` untouched (specs/arch/resources/json-store.md#^js-arch-apply).
 * Server values are filled from `context` and from `current`; the result is
 * checked against the limits. Throws `invalid-path`, `invalid-value` or
 * `too-large`, and a refused write changes nothing.
 */
export function applyJsonWrite(
  current: JSONValue | undefined,
  write: JsonWrite,
  context: ServerValueContext,
  options: ApplyOptions = {},
): JSONValue | undefined {
  let result = current;
  // Containers this write has copied: each is copied once, then changed in
  // place, so an update's cost grows with its size rather than its square.
  const copies = new Set<object>();
  for (const mutation of toMutations(write)) {
    if ("remove" in mutation) {
      result = removeAt(result, mutation.segments, 0, copies);
    } else {
      const leaf = materialize(mutation.value, mutation.segments, current, context);
      if (mutation.segments.length + depthBelow(leaf) > JSON_STORE_MAX_DEPTH) throw tooDeepError();
      result = setAt(result, mutation.segments, 0, leaf, copies);
    }
  }
  if (options.checkSize !== false) checkJsonSize(result);
  return result;
}

function toMutations(write: JsonWrite): Mutation[] {
  const base = parseJsonPath(write.path);
  switch (write.kind) {
    case "set":
      validateWriteValue(write.value);
      return [{ segments: base, value: write.value }];
    case "remove":
      return [{ segments: base, remove: true }];
    case "update": {
      const mutations = write.entries.map(([key, value]): Mutation => {
        const relative = key.split("/").filter((segment) => segment.length > 0);
        const segments = [...base, ...relative];
        checkPathSegments(segments);
        if (value instanceof DeleteValuePlaceholder) return { segments, remove: true };
        validateWriteValue(value);
        return { segments, value };
      });
      refuseOverlappingPaths(mutations.map((mutation) => mutation.segments));
      return mutations;
    }
  }
}

interface PathNode {
  /** Whether a path ends at this node. */
  end: boolean;
  children: Map<string, PathNode>;
}

/** Refuses paths of which one equals or lies within another, in one pass over their segments. */
function refuseOverlappingPaths(paths: ReadonlyArray<readonly string[]>): void {
  const root: PathNode = { end: false, children: new Map() };
  for (const segments of paths) {
    let node = root;
    for (const segment of segments) {
      if (node.end) break;
      let child = node.children.get(segment);
      if (!child) {
        child = { end: false, children: new Map() };
        node.children.set(segment, child);
      }
      node = child;
    }
    if (node.end || node.children.size > 0) {
      throw invalidPath("An update's keys must not address the same path or lie within one another.");
    }
    node.end = true;
  }
}

/** A container to change: the one this write already copied, or a new copy of it. */
function writable<T extends JSONValue[] | { [key: string]: JSONValue }>(node: T, copies: Set<object>): T {
  if (copies.has(node)) return node;
  const copy = (Array.isArray(node) ? node.slice() : { ...node }) as T;
  copies.add(copy);
  return copy;
}

/** Copies a written value into plain JSON, filling its server values. */
function materialize(
  node: WriteValue,
  at: readonly string[],
  original: JSONValue | undefined,
  context: ServerValueContext,
): JSONValue {
  if (node instanceof ServerValuePlaceholder) {
    const spec = node.serverValue;
    if (spec.kind === "timestamp") return context.now;
    const before = readJsonValue(original, at);
    const filled = typeof before === "number" ? before + spec.by : spec.by;
    if (!Number.isFinite(filled)) throw resourceError("invalid-value", "An increment would leave a number that is not finite.");
    return filled;
  }
  if (Array.isArray(node)) return node.map((element, index) => materialize(element, [...at, String(index)], original, context));
  if (node !== null && typeof node === "object") {
    const copy: Record<string, JSONValue> = {};
    for (const key of Object.keys(node)) setMember(copy, key, materialize(node[key]!, [...at, key], original, context));
    return copy;
  }
  return node;
}

function setAt(node: JSONValue | undefined, segments: readonly string[], depth: number, leaf: JSONValue, copies: Set<object>): JSONValue {
  if (depth === segments.length) return leaf;
  const key = segments[depth]!;
  if (Array.isArray(node)) {
    if (!isArrayIndexIn(node, key)) {
      throw invalidPath("Below an array, a path key must be the index of an existing element.");
    }
    const copy = writable(node, copies);
    copy[Number(key)] = setAt(node[Number(key)], segments, depth + 1, leaf, copies);
    return copy;
  }
  // A missing parent, or a string, number, boolean or null, becomes an object.
  const copy = isJsonObject(node) ? writable(node, copies) : writable({}, copies);
  const child = isJsonObject(node) && Object.hasOwn(node, key) ? node[key] : undefined;
  setMember(copy, key, setAt(child, segments, depth + 1, leaf, copies));
  return copy;
}

/** Removes the value at `segments`; returns `node` itself when there is nothing there to remove. */
function removeAt(node: JSONValue | undefined, segments: readonly string[], depth: number, copies: Set<object>): JSONValue | undefined {
  if (depth === segments.length) return undefined;
  const key = segments[depth]!;
  if (Array.isArray(node)) {
    if (!isArrayIndexIn(node, key)) {
      throw invalidPath("Below an array, a path key must be the index of an existing element.");
    }
    if (depth === segments.length - 1) throw invalidPath("An array element cannot be deleted; write the whole array.");
    const element = node[Number(key)]!;
    const child = removeAt(element, segments, depth + 1, copies) as JSONValue;
    // Unchanged, or a copy already in place that was changed where it stands.
    if (child === element) return node;
    const copy = writable(node, copies);
    copy[Number(key)] = child;
    return copy;
  }
  if (!isJsonObject(node) || !Object.hasOwn(node, key)) return node;
  const child = removeAt(node[key], segments, depth + 1, copies);
  if (child === node[key]) return node;
  const copy = writable(node, copies);
  if (child === undefined) delete copy[key];
  else setMember(copy, key, child);
  return copy;
}

/** How many keys below a value its deepest member lies. */
function depthBelow(value: JSONValue): number {
  let deepest = 0;
  const visit = (node: JSONValue, depth: number): void => {
    if (depth > deepest) deepest = depth;
    if (deepest > JSON_STORE_MAX_DEPTH) return;
    if (Array.isArray(node)) for (const element of node) visit(element, depth + 1);
    else if (isJsonObject(node)) for (const key of Object.keys(node)) visit(node[key]!, depth + 1);
  };
  visit(value, 0);
  return deepest;
}

export function jsonByteLength(value: JSONValue | undefined): number {
  return value === undefined ? 0 : utf8ByteLength(JSON.stringify(value));
}

function checkJsonSize(value: JSONValue | undefined): void {
  if (jsonByteLength(value) > JSON_STORE_MAX_BYTES) {
    throw resourceError("too-large", `A store's value is at most ${JSON_STORE_MAX_BYTES} bytes of compact JSON.`);
  }
}

/** Throws `too-large` when a write's serialized message is over the message limit; the sender checks before sending. */
export function checkWriteMessage(message: string): void {
  if (utf8ByteLength(message) > JSON_STORE_MAX_WRITE_MESSAGE_BYTES) throw writeMessageTooLarge();
}

/** The refusal of a write whose message is over the message limit. */
export function writeMessageTooLarge(): ResourceError {
  return resourceError("too-large", `A write is at most ${JSON_STORE_MAX_WRITE_MESSAGE_BYTES} bytes as sent.`);
}

/** Throws unless a whole stored value is within the limits, as when a store is read from disk. */
export function checkJsonLimits(value: JSONValue | undefined): void {
  if (value !== undefined && depthBelow(value) > JSON_STORE_MAX_DEPTH) throw tooDeepError();
  checkJsonSize(value);
}

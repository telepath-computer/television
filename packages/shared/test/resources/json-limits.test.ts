import { describe, expect, it } from "vitest";
import {
  JSON_STORE_MAX_BYTES,
  JSON_STORE_MAX_WRITE_MESSAGE_BYTES,
  applyJsonWrite,
  checkJsonLimits,
  checkWriteMessage,
  decodeWriteValue,
  validateJsonValue,
  type JSONValue,
} from "@telepath-computer/television-shared/resources";
import { refusalCode } from "./helpers.ts";

const NOW = { now: 0 };

function bytes(value: JSONValue): number {
  return new TextEncoder().encode(JSON.stringify(value)).length;
}

/** A value nested `depth` keys below its top, ending in a scalar. */
function nested(depth: number): JSONValue {
  let value: JSONValue = true;
  for (let level = 0; level < depth; level++) value = { k: value };
  return value;
}

function path(segments: number): string {
  return Array.from({ length: segments }, (_, index) => `p${index}`).join("/");
}

// spec: proofs/arch/resources/json-store.md#^js-arch-t-limits
describe("the size limit", () => {
  it("accepts a value of exactly 1,048,576 bytes of compact JSON and refuses one byte more with too-large", () => {
    expect(JSON_STORE_MAX_BYTES).toBe(1_048_576);
    const envelope = bytes({ s: "" });
    const exact = { s: "x".repeat(JSON_STORE_MAX_BYTES - envelope) };
    expect(bytes(exact)).toBe(JSON_STORE_MAX_BYTES);
    expect(applyJsonWrite(undefined, { kind: "set", path: "", value: exact }, NOW)).toEqual(exact);
    const over = { s: "x".repeat(JSON_STORE_MAX_BYTES - envelope + 1) };
    expect(refusalCode(() => applyJsonWrite(undefined, { kind: "set", path: "", value: over }, NOW))).toBe("too-large");
  });

  it("counts UTF-8 bytes", () => {
    const envelope = bytes({ s: "" });
    const multibyte = { s: `${"é".repeat((JSON_STORE_MAX_BYTES - envelope) / 2)}` };
    expect(bytes(multibyte)).toBe(JSON_STORE_MAX_BYTES);
    expect(refusalCode(() => applyJsonWrite(undefined, { kind: "set", path: "", value: multibyte }, NOW))).toBeUndefined();
    expect(refusalCode(() => applyJsonWrite(multibyte, { kind: "set", path: "s", value: `${multibyte.s}é` }, NOW))).toBe("too-large");
  });

  it("refuses a small write whose excess comes from the rest of the store", () => {
    // {"a":"…","b":1} — the write adds exactly the bytes of `,"b":1`.
    const added = bytes({ a: "", b: 1 }) - bytes({ a: "" });
    const current = { a: "x".repeat(JSON_STORE_MAX_BYTES - bytes({ a: "" }) - added + 1) };
    const before = structuredClone(current);
    expect(refusalCode(() => applyJsonWrite(current, { kind: "set", path: "b", value: 1 }, NOW))).toBe("too-large");
    expect(current).toEqual(before);
    const fits = { a: "x".repeat(JSON_STORE_MAX_BYTES - bytes({ a: "" }) - added) };
    expect(bytes(applyJsonWrite(fits, { kind: "set", path: "b", value: 1 }, NOW)!)).toBe(JSON_STORE_MAX_BYTES);
  });
});

// spec: proofs/arch/resources/json-store.md#^js-arch-t-limits
describe("the depth limit", () => {
  it("accepts a value at depth 32", () => {
    expect(refusalCode(() => applyJsonWrite(undefined, { kind: "set", path: path(32), value: 1 }, NOW))).toBeUndefined();
    expect(refusalCode(() => applyJsonWrite(undefined, { kind: "set", path: "", value: nested(32) }, NOW))).toBeUndefined();
    expect(refusalCode(() => applyJsonWrite(undefined, { kind: "set", path: path(30), value: nested(2) }, NOW))).toBeUndefined();
    expect(refusalCode(() => applyJsonWrite(undefined, { kind: "set", path: path(32), value: {} }, NOW))).toBeUndefined();
  });

  it("refuses a write that would put a value at depth 33 with invalid-path, changing nothing", () => {
    const current = { p0: { kept: true } };
    const before = structuredClone(current);
    const cases = [
      { kind: "set", path: path(33), value: 1 },
      { kind: "set", path: "", value: nested(33) },
      { kind: "set", path: path(30), value: nested(3) },
    ] as const;
    for (const write of cases) {
      expect(refusalCode(() => applyJsonWrite(current, write, NOW)), write.path).toBe("invalid-path");
      expect(current).toEqual(before);
    }
    expect(refusalCode(() => applyJsonWrite(current, { kind: "update", path: path(30), entries: [["a/b/c", 1]] }, NOW))).toBe("invalid-path");
  });

  it("refuses a value nested far past the limit with invalid-path rather than exhausting the stack", () => {
    const deep = nested(100_000);
    expect(refusalCode(() => applyJsonWrite(undefined, { kind: "set", path: "", value: deep }, NOW))).toBe("invalid-path");
    expect(refusalCode(() => applyJsonWrite(undefined, { kind: "update", path: "", entries: [["a", deep]] }, NOW))).toBe("invalid-path");
    expect(refusalCode(() => decodeWriteValue({ value: deep }))).toBe("invalid-path");
    expect(refusalCode(() => validateJsonValue(deep))).toBe("invalid-path");
    expect(refusalCode(() => checkJsonLimits(deep))).toBe("invalid-path");
  });
});

// spec: proofs/arch/resources/json-store.md#^js-arch-t-limits
describe("the message limit", () => {
  it("passes a write's message of exactly 16,777,216 UTF-8 bytes and refuses one byte more with too-large", () => {
    expect(JSON_STORE_MAX_WRITE_MESSAGE_BYTES).toBe(16_777_216);
    expect(refusalCode(() => checkWriteMessage("x".repeat(JSON_STORE_MAX_WRITE_MESSAGE_BYTES)))).toBeUndefined();
    expect(refusalCode(() => checkWriteMessage("x".repeat(JSON_STORE_MAX_WRITE_MESSAGE_BYTES + 1)))).toBe("too-large");
  });

  it("counts UTF-8 bytes", () => {
    const multibyte = "é".repeat(JSON_STORE_MAX_WRITE_MESSAGE_BYTES / 2);
    expect(refusalCode(() => checkWriteMessage(multibyte))).toBeUndefined();
    expect(refusalCode(() => checkWriteMessage(`${multibyte}x`))).toBe("too-large");
  });
});

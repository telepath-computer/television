import { describe, expect, it } from "vitest";
import {
  applyJsonWrite,
  decodeUpdateEntries,
  decodeWriteValue,
  deleteValue,
  encodeUpdateEntries,
  encodeWriteValue,
  increment,
  serverTimestamp,
  validateUpdateValues,
  validateWriteValue,
} from "@telepath-computer/television-shared/resources";
import { refusalCode } from "./helpers.ts";

class Point {
  readonly x: number;
  constructor(x: number) {
    this.x = x;
  }
}

// spec: proofs/arch/resources/json-store.md#^js-arch-t-values
describe("JSON store written values", () => {
  it("accepts null, booleans, finite numbers, strings, arrays and plain objects", () => {
    for (const value of [null, true, false, 0, -1.5, 1e300, "", "text", [], {}, [1, "a", null, { b: [true] }], Object.create(null)]) {
      expect(refusalCode(() => validateWriteValue(value)), JSON.stringify(value)).toBeUndefined();
    }
  });

  it("refuses undefined, NaN, Infinity, functions, Dates, Maps and class instances with invalid-value", () => {
    const refused: unknown[] = [
      undefined,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      () => 1,
      new Date(0),
      new Map(),
      new Point(1),
      Symbol("s"),
      10n,
    ];
    for (const value of refused) {
      expect(refusalCode(() => validateWriteValue(value)), String(value)).toBe("invalid-value");
      expect(refusalCode(() => validateWriteValue({ nested: [value] })), `nested ${String(value)}`).toBe("invalid-value");
    }
    // An array hole reads as undefined.
    expect(refusalCode(() => validateWriteValue([1, , 3]))).toBe("invalid-value");
  });

  it("refuses an object key that is empty, contains / or exceeds 768 bytes", () => {
    expect(refusalCode(() => validateWriteValue({ "": 1 }))).toBe("invalid-value");
    expect(refusalCode(() => validateWriteValue({ a: { "b/c": 1 } }))).toBe("invalid-value");
    expect(refusalCode(() => validateWriteValue({ ["x".repeat(769)]: 1 }))).toBe("invalid-value");
    expect(refusalCode(() => validateWriteValue({ ["x".repeat(768)]: 1 }))).toBeUndefined();
  });

  it("refuses a value that contains itself", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(refusalCode(() => validateWriteValue(cyclic))).toBe("invalid-value");
  });

  it("accepts a server-value placeholder anywhere in a written value", () => {
    expect(refusalCode(() => validateWriteValue(serverTimestamp()))).toBeUndefined();
    expect(refusalCode(() => validateWriteValue({ at: serverTimestamp(), count: increment(2) }))).toBeUndefined();
    expect(refusalCode(() => validateWriteValue([{ deep: [increment(-1)] }]))).toBeUndefined();
    expect(refusalCode(() => validateWriteValue(increment(Number.NaN)))).toBe("invalid-value");
  });

  it("accepts a delete placeholder only as an update entry", () => {
    expect(refusalCode(() => validateUpdateValues({ a: deleteValue(), b: 1, c: serverTimestamp() }))).toBeUndefined();
    expect(refusalCode(() => validateUpdateValues({ a: { b: deleteValue() } }))).toBe("invalid-value");
    expect(refusalCode(() => validateWriteValue(deleteValue()))).toBe("invalid-value");
    expect(refusalCode(() => validateWriteValue({ a: deleteValue() }))).toBe("invalid-value");
    expect(refusalCode(() => validateUpdateValues({ a: undefined }))).toBe("invalid-value");
  });

  it("stores a plain object with the key .sv exactly as written", () => {
    const plain = { ".sv": "timestamp", nested: { ".sv": { increment: 1 } } };
    const decoded = decodeWriteValue(JSON.parse(JSON.stringify(encodeWriteValue(plain))));
    expect(decoded).toEqual(plain);
    expect(applyJsonWrite({}, { kind: "set", path: "x", value: decoded }, { now: 5 })).toEqual({ x: plain });
  });

  it("carries placeholders apart from the plain JSON, so they survive encoding and fill on application", () => {
    const encoded = JSON.parse(JSON.stringify(encodeWriteValue({ at: serverTimestamp(), list: [increment(3)], ".sv": "plain" })));
    const decoded = decodeWriteValue(encoded);
    expect(applyJsonWrite({ x: { list: [4] } }, { kind: "set", path: "x", value: decoded }, { now: 1234 })).toEqual({
      x: { at: 1234, list: [7], ".sv": "plain" },
    });
    const entries = decodeUpdateEntries(JSON.parse(JSON.stringify(encodeUpdateEntries({ gone: deleteValue(), when: serverTimestamp() }))));
    expect(applyJsonWrite({ gone: 1, kept: 2 }, { kind: "update", path: "", entries }, { now: 9 })).toEqual({ kept: 2, when: 9 });
  });

  it("refuses encodings whose placeholders do not stand at a position in the value", () => {
    expect(refusalCode(() => decodeWriteValue({ value: { a: null }, serverValues: [{ at: ["b"], serverValue: { kind: "timestamp" } }] }))).toBe("invalid-value");
    expect(refusalCode(() => decodeWriteValue({ value: [null], serverValues: [{ at: ["1"], serverValue: { kind: "timestamp" } }] }))).toBe("invalid-value");
    expect(refusalCode(() => decodeWriteValue({ value: null, serverValues: [{ at: [], serverValue: { kind: "increment", by: "1" } }] }))).toBe("invalid-value");
    expect(refusalCode(() => decodeWriteValue({ serverValues: [] }))).toBe("invalid-value");
    const timestamp = { kind: "timestamp" };
    expect(refusalCode(() => decodeWriteValue({ value: null, serverValues: [{ at: [], serverValue: timestamp }, { at: ["serverValue"], serverValue: timestamp }] }))).toBe("invalid-value");
  });

  it("decodes a value carrying many placeholders in time that grows with its size, not its square", () => {
    const count = 10_000;
    const value = Object.fromEntries(Array.from({ length: count }, (_, index) => [`k${index}`, increment(index)]));
    const encoded = JSON.parse(JSON.stringify(encodeWriteValue(value)));
    const started = performance.now();
    const decoded = decodeWriteValue(encoded);
    expect(performance.now() - started).toBeLessThan(1_000);
    const applied = applyJsonWrite(undefined, { kind: "set", path: "", value: decoded }, { now: 0 }) as Record<string, number>;
    expect(Object.keys(applied)).toHaveLength(count);
    expect(applied.k9999).toBe(9999);
  });
});

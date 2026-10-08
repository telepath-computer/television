import { describe, expect, it } from "vitest";
import {
  compareChildKeys,
  isIndexKey,
  jsonEqual,
  parseJsonPath,
  readJsonValue,
} from "@telepath-computer/television-shared/resources";
import { refusalCode } from "./helpers.ts";

// spec: proofs/arch/resources/json-store.md#^js-arch-t-paths
describe("JSON store paths", () => {
  it("splits on / and drops empty segments", () => {
    expect(parseJsonPath("")).toEqual([]);
    expect(parseJsonPath("/")).toEqual([]);
    expect(parseJsonPath("a//b/")).toEqual(["a", "b"]);
    expect(parseJsonPath("/items/abc/done")).toEqual(["items", "abc", "done"]);
  });

  it("refuses a segment over 768 UTF-8 bytes and a path of 33 segments with invalid-path", () => {
    expect(refusalCode(() => parseJsonPath("x".repeat(768)))).toBeUndefined();
    expect(refusalCode(() => parseJsonPath("x".repeat(769)))).toBe("invalid-path");
    expect(refusalCode(() => parseJsonPath(`a/${"é".repeat(385)}`))).toBe("invalid-path");
    const segments = (count: number) => Array.from({ length: count }, (_, index) => `k${index}`).join("/");
    expect(refusalCode(() => parseJsonPath(segments(32)))).toBeUndefined();
    expect(refusalCode(() => parseJsonPath(segments(33)))).toBe("invalid-path");
  });

  it("treats digits without a leading zero, and 0 itself, as indices", () => {
    expect(isIndexKey("0")).toBe(true);
    expect(isIndexKey("12")).toBe(true);
    expect(isIndexKey("01")).toBe(false);
    expect(isIndexKey("-1")).toBe(false);
    expect(isIndexKey("1.5")).toBe(false);
    expect(isIndexKey("")).toBe(false);
  });

  it("addresses an array element through an index and an object member otherwise", () => {
    const value = { items: ["a", "b"], byNumber: { "1": "one", "01": "zero-one" } };
    expect(readJsonValue(value, parseJsonPath("items/1"))).toBe("b");
    expect(readJsonValue(value, parseJsonPath("byNumber/1"))).toBe("one");
    expect(readJsonValue(value, parseJsonPath("byNumber/01"))).toBe("zero-one");
    expect(readJsonValue(value, [])).toEqual(value);
  });

  it("finds no value reading through an array with a non-index or an index past its end", () => {
    const value = { items: [{ title: "a" }] };
    expect(readJsonValue(value, parseJsonPath("items/title"))).toBeUndefined();
    expect(readJsonValue(value, parseJsonPath("items/01"))).toBeUndefined();
    expect(readJsonValue(value, parseJsonPath("items/1"))).toBeUndefined();
    expect(readJsonValue(value, parseJsonPath("items/1/title"))).toBeUndefined();
    expect(readJsonValue(value, parseJsonPath("items/0/title"))).toBe("a");
    expect(readJsonValue(undefined, [])).toBeUndefined();
    expect(readJsonValue({ a: "text" }, parseJsonPath("a/length"))).toBeUndefined();
  });
});

// spec: proofs/arch/resources/json-store.md#^js-arch-t-paths
describe("JSON store equality and child order", () => {
  it("compares values deeply, ignoring object key order", () => {
    expect(jsonEqual({ a: 1, b: [1, { c: 2, d: 3 }] }, { b: [1, { d: 3, c: 2 }], a: 1 })).toBe(true);
    expect(jsonEqual([1, 2], [2, 1])).toBe(false);
    expect(jsonEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
    expect(jsonEqual(null, {})).toBe(false);
    expect(jsonEqual([], {})).toBe(false);
    expect(jsonEqual(undefined, undefined)).toBe(true);
    expect(jsonEqual(undefined, null)).toBe(false);
  });

  it("orders index keys first numerically, then other keys by UTF-16 code units", () => {
    const keys = ["b", "10", "a", "2", "0", "B", "01", "_", "12345678901234567890", "9", "！", "\u{1f600}"];
    expect([...keys].sort(compareChildKeys)).toEqual([
      "0",
      "2",
      "9",
      "10",
      "12345678901234567890",
      "01",
      "B",
      "_",
      "a",
      "b",
      "\u{1f600}",
      "！",
    ]);
  });
});

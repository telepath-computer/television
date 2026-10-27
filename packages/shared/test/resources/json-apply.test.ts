import { describe, expect, it } from "vitest";
import {
  applyJsonWrite,
  deleteValue,
  increment,
  serverTimestamp,
  type JSONValue,
  type JsonWrite,
} from "@telepath-computer/television-shared/resources";
import { refusalCode } from "./helpers.ts";

const NOW = { now: 1_700_000_000_000 };

/** Applies a write and checks that the input value was left untouched. */
function apply(current: JSONValue | undefined, write: JsonWrite): JSONValue | undefined {
  const before = structuredClone(current);
  try {
    return applyJsonWrite(current, write, NOW);
  } finally {
    expect(current).toEqual(before);
  }
}

// spec: proofs/arch/resources/json-store.md#^js-arch-t-apply
describe("applying a set", () => {
  it("creates objects along the path below a missing parent or a scalar", () => {
    expect(apply(undefined, { kind: "set", path: "a/b/c", value: 1 })).toEqual({ a: { b: { c: 1 } } });
    for (const scalar of ["text", 3, false, null]) {
      expect(apply({ a: scalar, keep: 1 }, { kind: "set", path: "a/b", value: 2 })).toEqual({ a: { b: 2 }, keep: 1 });
    }
    expect(apply("root scalar", { kind: "set", path: "x", value: true })).toEqual({ x: true });
  });

  it("replaces the whole value at the root", () => {
    expect(apply({ a: 1 }, { kind: "set", path: "/", value: [1, 2] })).toEqual([1, 2]);
    expect(apply({ a: 1 }, { kind: "set", path: "", value: null })).toBeNull();
  });

  it("sets an existing array element", () => {
    expect(apply({ items: [1, 2] }, { kind: "set", path: "items/1", value: 9 })).toEqual({ items: [1, 9] });
    expect(apply({ items: [{ done: false }] }, { kind: "set", path: "items/0/done", value: true })).toEqual({ items: [{ done: true }] });
  });

  it("refuses with invalid-path an index at or past the array's length, a non-index below an array, and a path below a missing element", () => {
    const value = { items: [1, 2] };
    for (const path of ["items/2", "items/7", "items/x", "items/01", "items/5/title", "items/-AbCdEfGhIjKlMnOpQr"]) {
      expect(refusalCode(() => apply(value, { kind: "set", path, value: 0 })), path).toBe("invalid-path");
    }
  });

  it("keeps a key named __proto__ as an ordinary member", () => {
    const result = apply({}, { kind: "set", path: "__proto__/x", value: 1 }) as Record<string, unknown>;
    expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
    expect(Object.keys(result)).toEqual(["__proto__"]);
    expect(JSON.stringify(result)).toBe('{"__proto__":{"x":1}}');
  });
});

// spec: proofs/arch/resources/json-store.md#^js-arch-t-apply
describe("applying a delete", () => {
  it("removes a member, and the whole value at the root", () => {
    expect(apply({ a: { b: 1, c: 2 } }, { kind: "remove", path: "a/b" })).toEqual({ a: { c: 2 } });
    expect(apply({ a: 1 }, { kind: "remove", path: "" })).toBeUndefined();
  });

  it("refuses deleting an array element with invalid-path", () => {
    expect(refusalCode(() => apply({ items: [1, 2] }, { kind: "remove", path: "items/1" }))).toBe("invalid-path");
    expect(refusalCode(() => apply({ items: [1, 2] }, { kind: "remove", path: "items/x/y" }))).toBe("invalid-path");
  });

  it("changes nothing and creates no parents when the path has no value", () => {
    expect(apply({ a: 1 }, { kind: "remove", path: "x/y/z" })).toEqual({ a: 1 });
    expect(apply({ a: 1 }, { kind: "remove", path: "a/b" })).toEqual({ a: 1 });
    expect(apply(undefined, { kind: "remove", path: "a" })).toBeUndefined();
  });
});

// spec: proofs/arch/resources/json-store.md#^js-arch-t-apply
describe("applying an update", () => {
  it("applies every entry relative to the reference as one write", () => {
    const entries = [
      ["items/a/done", true],
      ["count", 2],
      ["old", deleteValue()],
    ] as const;
    expect(apply({ list: { items: { a: { done: false } }, old: 1 } }, { kind: "update", path: "list", entries })).toEqual({
      list: { items: { a: { done: true } }, count: 2 },
    });
  });

  it("applies all of its entries or none", () => {
    const entries = [["a", 1], ["items/x", 2]] as const;
    expect(refusalCode(() => apply({ items: [] }, { kind: "update", path: "", entries }))).toBe("invalid-path");
  });

  it("refuses keys that address the same path once parsed, or one within another, with invalid-path", () => {
    for (const keys of [["a", "a/"], ["a", "a/b"], ["/a/b", "a"], ["", "x"], ["a//b", "a/b"]]) {
      const entries = keys.map((key, index) => [key, index] as const);
      expect(refusalCode(() => apply({}, { kind: "update", path: "", entries })), keys.join(" ")).toBe("invalid-path");
    }
    expect(apply({}, { kind: "update", path: "", entries: [["a/b", 1], ["a/c", 2], ["ab", 3]] })).toEqual({ a: { b: 1, c: 2 }, ab: 3 });
  });

  it("applies an update of many entries in time that grows with its size, not its square", () => {
    // The server applies writes synchronously, so a slow one stalls every
    // request. Quadratic work takes seconds here; linear work, milliseconds.
    const count = 10_000;
    const entries = Array.from({ length: count }, (_, index) => [`items/k${index}`, true] as const);
    const started = performance.now();
    const result = applyJsonWrite({ items: { k0: false }, other: 1 }, { kind: "update", path: "", entries }, NOW) as { items: Record<string, boolean>; other: number };
    expect(performance.now() - started).toBeLessThan(1_000);
    expect(Object.keys(result.items)).toHaveLength(count);
    expect(result.items.k0).toBe(true);
    expect(result.other).toBe(1);
  });
});

describe("filling server values", () => {
  it("fills timestamps with the server's clock and increments with the number before the write plus n", () => {
    expect(apply({ n: 4, s: "x" }, {
      kind: "update",
      path: "",
      entries: [["n", increment(3)], ["s", increment(2)], ["new", { at: serverTimestamp(), count: increment(-1) }]],
    })).toEqual({ n: 7, s: 2, new: { at: NOW.now, count: -1 } });
    expect(apply({ counter: { count: 5 } }, { kind: "set", path: "counter", value: { count: increment(1) } })).toEqual({ counter: { count: 6 } });
  });
});

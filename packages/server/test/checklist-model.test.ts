import { describe, expect, it } from "vitest";
import {
  compareItemKeys,
  createRenumberUpdate,
  insertionOrder,
  isChecklistData,
  isCompletionShortcut,
  isItemMap,
  orderedItems,
  type ChecklistItem,
} from "../assets/templates/checklist/model.js";

const item = (order: number, text = "Item", done = false): ChecklistItem => ({ order, text, done });

// Contract: proofs/arch/templates/checklist.md#^templates-checklist-t-validity.
// Authored values call the shipped model directly; transport and DOM are absent.
describe("Checklist whole-value validation", () => {
  it("accepts empty and extra fields, arbitrary keys, finite orders, and empty text without mutation", () => {
    const items = Object.fromEntries([
      ["__proto__", { ...item(-1.25, ""), note: { nested: true } }],
      ["constructor", item(Number.MAX_VALUE)],
      ["2", item(-Number.MAX_VALUE)],
      ["é", item(0.5)],
    ]);
    const value = { title: "", items, extra: ["ignored"] };
    const former = structuredClone(value);
    expect(isChecklistData({ title: "Checklist", items: {} })).toBe(true);
    expect(isChecklistData(value)).toBe(true);
    expect(isItemMap(items)).toBe(true);
    expect(value).toEqual(former);
  });

  it.each([
    undefined, null, [], "text", 1, false, {}, { items: {} },
    { title: 1, items: {} }, { title: null, items: {} }, { title: "Checklist" },
    { title: "Checklist", items: null }, { title: "Checklist", items: [] },
    { title: "Checklist", items: "items" },
  ].map((value) => ({ value })))("rejects malformed root $value", ({ value }) => {
    expect(isChecklistData(value)).toBe(false);
  });

  it.each([
    undefined, null, [], "item", {}, { text: "Item", done: false },
    { order: 0, done: false }, { order: 0, text: "Item" },
    { order: "0", text: "Item", done: false },
    { order: 0, text: 1, done: false }, { order: 0, text: "Item", done: 0 },
    item(NaN), item(Infinity), item(-Infinity),
  ].map((invalid) => ({ invalid })))("rejects the whole value when one item is invalid: $invalid", ({ invalid }) => {
    const value = { title: "Checklist", items: { good: item(0), bad: invalid } };
    const former = structuredClone(value);
    expect(isChecklistData(value)).toBe(false);
    expect(isItemMap(value.items)).toBe(false);
    expect(value).toEqual(former);
  });
});

// Contract: proofs/arch/templates/checklist.md#^templates-checklist-t-order.
describe("Checklist ordering and insertion", () => {
  it("orders by number then store numeric-index and UTF-16 key order, regardless of done state", () => {
    const keys = ["b", "10", "a", "2", "0", "B", "01", "_", "12345678901234567890", "9", "！", "😀"];
    const expected = ["0", "2", "9", "10", "12345678901234567890", "01", "B", "_", "a", "b", "😀", "！"];
    expect([...keys].sort(compareItemKeys)).toEqual(expected);
    expect(compareItemKeys("same", "same")).toBe(0);
    const items = Object.fromEntries(keys.map((key, index) => [key, item(0, key, index % 2 === 0)]));
    items.earlier = item(-2, "first", true);
    items.later = item(2, "last");
    expect(orderedItems(items).map(([key]) => key)).toEqual(["earlier", ...expected, "later"]);
    expect(orderedItems(items).map(([, value]) => value)).toEqual(["earlier", ...expected, "later"].map((key) => items[key]));
  });

  it("uses zero, minimum minus one, maximum plus one, or the midpoint for every insertion position", () => {
    const items = { a: item(-4), b: item(2), c: item(8) };
    expect(insertionOrder({}, undefined)).toBe(0);
    expect(insertionOrder({}, null)).toBe(0);
    expect(insertionOrder(items, null)).toBe(-5);
    expect(insertionOrder(items, undefined)).toBe(9);
    expect(insertionOrder(items, "a")).toBe(-1);
    expect(insertionOrder(items, "b")).toBe(5);
    expect(insertionOrder(items, "c")).toBe(9);
    expect(insertionOrder(items, "removed")).toBe(9);
    expect(insertionOrder({ a: item(-Number.MAX_VALUE), b: item(Number.MAX_VALUE) }, "a")).toBe(0);
    expect(insertionOrder({ a: item(Number.MAX_VALUE / 2), b: item(Number.MAX_VALUE) }, "a"))
      .toBe(Number.MAX_VALUE * 0.75);
  });

  it("requests renumbering when equal, adjacent, or extreme orders leave no strict gap", () => {
    expect(insertionOrder({ a: item(1), b: item(1) }, "a")).toBeNull();
    expect(insertionOrder({ a: item(1), b: item(1 + Number.EPSILON) }, "a")).toBeNull();
    expect(insertionOrder({ a: item(Number.MAX_VALUE) }, undefined)).toBeNull();
    expect(insertionOrder({ a: item(-Number.MAX_VALUE) }, null)).toBeNull();
    expect(insertionOrder({ a: item(Number.MAX_SAFE_INTEGER + 1) }, "a")).toBeNull();
  });

  it("keeps an exactly representable midpoint between subnormal orders", () => {
    expect(insertionOrder({ a: item(Number.MIN_VALUE), b: item(5 * Number.MIN_VALUE) }, "a"))
      .toBe(3 * Number.MIN_VALUE);
  });
});

// Contract: proofs/arch/templates/checklist.md#^templates-checklist-t-renumber.
describe("Checklist renumbering callback", () => {
  it.each([
    [null, ["new", "a", "b"]],
    ["a", ["a", "new", "b"]],
    [undefined, ["a", "b", "new"]],
    ["removed", ["a", "b", "new"]],
  ] as const)("inserts after %s with consecutive orders and preserves every existing field", (after, keys) => {
    const current = { b: { ...item(8), note: "kept" }, a: { ...item(-1), extra: { x: 1 } } };
    const former = structuredClone(current);
    const result = createRenumberUpdate("new", { text: "New", done: false }, after)(current)!;
    expect(orderedItems(result).map(([key]) => key)).toEqual(keys);
    expect(keys.map((key) => result[key]!.order)).toEqual([0, 1, 2]);
    expect(result.a).toEqual({ ...current.a, order: keys.indexOf("a") });
    expect(result.b).toEqual({ ...current.b, order: keys.indexOf("b") });
    expect(result.new).toEqual(item(keys.indexOf("new"), "New"));
    expect(current).toEqual(former);
  });

  it("derives every attempt from concurrent text, done, order, extra fields, and membership changes", () => {
    const update = createRenumberUpdate("new", { text: "Draft", done: false }, "a");
    const original = { a: item(0), b: item(0), removed: item(1) };
    expect(orderedItems(update(original)!).map(([key]) => key)).toEqual(["a", "new", "b", "removed"]);
    const changed = { a: { ...item(8, "Other writer", true), extra: "new extra" }, b: item(-1), added: item(12) };
    const former = structuredClone(changed);
    const result = update(changed)!;
    expect(orderedItems(result).map(([key]) => key)).toEqual(["b", "a", "new", "added"]);
    expect(result.a).toEqual({ order: 1, text: "Other writer", done: true, extra: "new extra" });
    expect(result.removed).toBeUndefined();
    expect(changed).toEqual(former);
    expect(orderedItems(update({ b: item(4), added: item(6) })!).map(([key]) => key)).toEqual(["b", "added", "new"]);
  });

  it("handles prototype-like keys without losing or mutating items", () => {
    const current = Object.fromEntries([["__proto__", { ...item(1), extra: true }], ["constructor", item(1)]]);
    const result = createRenumberUpdate("toString", { text: "New", done: true }, "__proto__")(current)!;
    expect(orderedItems(result).map(([key]) => key)).toEqual(["__proto__", "toString", "constructor"]);
    expect(Object.hasOwn(result, "__proto__")).toBe(true);
    expect(result.__proto__).toEqual({ ...item(0), extra: true });
  });

  it.each([
    { position: "before its predecessor", order: -10, predecessorPresent: true, keys: ["a", "new", "b"] },
    { position: "after its predecessor", order: 10, predecessorPresent: true, keys: ["a", "new", "b"] },
    { position: "after predecessor removal", order: -10, predecessorPresent: false, keys: ["b", "new"] },
  ])("keeps current fields when the reserved item already exists $position and inserts it only once",
    ({ order, predecessorPresent, keys }) => {
      const current: Record<string, ChecklistItem> = {
        b: { ...item(0, "Concurrent text", true), extra: { source: "other writer" } },
        new: { ...item(order, "Already typed", true), note: "retained" },
      };
      if (predecessorPresent) current.a = { ...item(0), other: "retained" };
      const former = structuredClone(current);
      const result = createRenumberUpdate("new", { text: "", done: false }, "a")(current)!;
      expect(Object.keys(result).sort()).toEqual(Object.keys(current).sort());
      expect(Object.keys(result)).toHaveLength(keys.length);
      expect(orderedItems(result).map(([key]) => key)).toEqual(keys);
      expect(keys.map((key) => result[key]!.order)).toEqual(keys.map((_, index) => index));
      for (const [index, key] of keys.entries()) expect(result[key]).toEqual({ ...current[key], order: index });
      expect(current).toEqual(former);
    },
  );

  it.each([undefined, null, [], "items", { bad: item(Infinity) }, { bad: { order: 0, text: "Missing done" } }]
    .map((current) => ({ current })))(
    "aborts an attempt with invalid or missing items $current", ({ current }) => {
      expect(createRenumberUpdate("new", { text: "New", done: false }, "a")(current)).toBeUndefined();
    },
  );
});

// Contract: proofs/ui/templates/checklist/index.md#^checklist-ui-t-shortcut.
// Supplied platform values forfeit native detection and delivery to the browser seam.
describe("Checklist completion shortcut", () => {
  it.each(["MacIntel", "Macintosh", "Win32", "Linux x86_64"])("selects the native modifier for %s", (platform) => {
    const mac = platform.startsWith("Mac");
    expect(isCompletionShortcut({ key: "Enter", metaKey: mac, ctrlKey: !mac }, platform)).toBe(true);
    expect(isCompletionShortcut({ key: "Enter", metaKey: !mac, ctrlKey: mac }, platform)).toBe(false);
    expect(isCompletionShortcut({ key: "Enter", metaKey: false, ctrlKey: false }, platform)).toBe(false);
    expect(isCompletionShortcut({ key: "a", metaKey: true, ctrlKey: true }, platform)).toBe(false);
  });
});

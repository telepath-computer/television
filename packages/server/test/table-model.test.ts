import { describe, expect, it } from "vitest";
import {
  compareStoreKeys,
  createAxisRenumberUpdate,
  displayAxis,
  insertionOrder,
  isCurrentDrawnPosition,
  ordersAtEnd,
  planAdd,
  planCellCommit,
  planClear,
  planDelete,
  planHeaderCommit,
  planInsert,
  planSetHeader,
  readTable,
  type TableAxisEntry,
  type TableWriteOperation,
} from "../assets/templates/table/model.js";

const table = {
  showHeader: true,
  columns: {
    c2: { order: 2, name: "State", extra: "kept" },
    c1: { order: 1, name: "Park" },
  },
  rows: {
    r2: { order: 2, cells: { c1: "Acadia", c2: "ME" }, extra: true },
    r1: { order: 1, cells: { c1: "Yosemite", c2: "CA" } },
  },
};

const set = (path: string[], value: unknown): TableWriteOperation => ({ kind: "set", path, value });
const remove = (path: string[]): TableWriteOperation => ({ kind: "remove", path });

// Contract: proofs/arch/templates/table.md#^templates-table-t-model.
describe("Table tolerant reading and stored order", () => {
  it("reads missing and partial roots, but rejects explicit non-object roots and axes", () => {
    expect(readTable(undefined)).toMatchObject({ columns: [], rows: [], showHeader: false });
    expect(readTable({})).toMatchObject({ columns: [], rows: [], showHeader: false });
    expect(readTable({ columns: { c1: { order: 1 } } })).toMatchObject({ columns: [{ key: "c1", order: 1 }], rows: [] });
    expect(readTable({ rows: { r1: { order: 1, cells: {} } } })).toMatchObject({ columns: [], rows: [{ key: "r1", order: 1, cells: {} }] });
    for (const value of [null, [], "table", 4, false, { columns: null }, { rows: [] }]) expect(readTable(value)).toBeNull();
  });

  it("drops malformed entries, orders finite entries by order and JSON-store key order, and does not mutate", () => {
    const value = {
      columns: Object.fromEntries([
        ["z", { order: 1, name: 4 }], ["2", { order: 1, name: "Two" }],
        ["10", { order: 1 }], ["a", { order: 1, name: "A", extra: true }],
        ["bad", { order: Infinity }], ["missing", { name: "Missing" }], ["null", null],
      ]),
      rows: Object.fromEntries([
        ["b", { order: 1, cells: null }], ["1", { order: 1 }],
        ["a", { order: -1, cells: [], extra: "kept" }], ["bad", { order: "2", cells: {} }],
      ]),
      showHeader: "yes",
      extra: { retained: true },
    };
    const former = structuredClone(value);
    const result = readTable(value)!;
    expect(result.columns).toEqual([
      { key: "2", order: 1, name: "Two" }, { key: "10", order: 1 },
      { key: "a", order: 1, name: "A" }, { key: "z", order: 1 },
    ]);
    expect(result.rows).toEqual([
      { key: "a", order: -1, cells: {} }, { key: "1", order: 1, cells: {} }, { key: "b", order: 1, cells: {} },
    ]);
    expect(result.showHeader).toBe(false);
    expect(value).toEqual(former);
  });

  it("shows supported cell text, leaves empty values blank, and ignores cells without a displayed column", () => {
    const result = readTable({
      showHeader: true,
      columns: { c1: { order: 1 }, c2: { order: 2 }, c3: { order: 3 }, c4: { order: 4 }, c5: { order: 5 }, c6: { order: 6 } },
      rows: {
        r1: { order: 1, cells: { c1: "text", c2: 12, c3: true, c4: false, c5: "", c6: null, deleted: "ignored" } },
        r2: { order: 2 },
        r3: { order: 3, cells: "not cells" },
      },
    })!;
    expect(result.showHeader).toBe(true);
    expect(result.rows.map(row => row.cells)).toEqual([{ c1: "text", c2: "12", c3: "true", c4: "false" }, {}, {}]);
  });

  it("keeps both writers' valid key sets after a blank-axis race", () => {
    const result = readTable({
      columns: { firstA: { order: 0 }, firstB: { order: 1 }, secondA: { order: 0 }, secondB: { order: 1 } },
      rows: {
        first: { order: 0, cells: { firstB: "first" } },
        second: { order: 0, cells: { secondB: "second" } },
      },
    })!;
    expect(result.columns.map(column => column.key)).toEqual(["firstA", "secondA", "firstB", "secondB"]);
    expect(result.rows.map(row => row.key)).toEqual(["first", "second"]);
    expect(result.rows.map(row => row.cells)).toEqual([{ firstB: "first" }, { secondB: "second" }]);
  });

  it("implements numeric-index then UTF-16 key order", () => {
    const keys = ["b", "10", "a", "2", "0", "B", "01", "_", "12345678901234567890", "9", "！", "😀"];
    expect([...keys].sort(compareStoreKeys)).toEqual(["0", "2", "9", "10", "12345678901234567890", "01", "B", "_", "a", "b", "😀", "！"]);
  });
});

// Contract: proofs/arch/templates/table.md#^templates-table-t-drawn.
describe("Table drawn axes", () => {
  it("draws stored entries first and enough blank positions to reach four", () => {
    expect(displayAxis([])).toEqual([
      { kind: "drawn", id: "drawn:0:0", index: 0 }, { kind: "drawn", id: "drawn:0:1", index: 1 },
      { kind: "drawn", id: "drawn:0:2", index: 2 }, { kind: "drawn", id: "drawn:0:3", index: 3 },
    ]);
    const entries = Array.from({ length: 5 }, (_, index) => ({ key: `c${index}`, order: index }));
    expect(displayAxis(entries)).toHaveLength(5);
    expect(displayAxis(entries).every(item => item.kind === "stored")).toBe(true);
  });

  it("keeps drawn identity while displayed stored count is fixed and invalidates it when that count changes", () => {
    const before = displayAxis([{ key: "c1", order: 1 }])[2]!;
    const renamed = displayAxis([{ key: "c1", order: 9, name: "Changed" }])[2]!;
    expect(isCurrentDrawnPosition(before, renamed)).toBe(true);
    expect(isCurrentDrawnPosition(before, displayAxis([{ key: "c2", order: 1 }])[2]!)).toBe(true);
    expect(isCurrentDrawnPosition(before, displayAxis([{ key: "c1", order: 1 }, { key: "c2", order: 2 }])[2]!)).toBe(false);
  });
});

// Contract: proofs/arch/templates/table.md#^templates-table-t-order.
describe("Table ordering and renumbering", () => {
  const entries: TableAxisEntry[] = [{ key: "a", order: -4 }, { key: "b", order: 2 }, { key: "c", order: 8 }];

  it("chooses a strict order before, between and after selected neighbours", () => {
    expect(insertionOrder([], [], "after")).toBe(0);
    expect(insertionOrder(entries, ["a"], "before")).toBe(-5);
    expect(insertionOrder(entries, ["a"], "after")).toBe(-1);
    expect(insertionOrder(entries, ["b", "c"], "before")).toBe(-1);
    expect(insertionOrder(entries, ["b", "c"], "after")).toBe(9);
    expect(ordersAtEnd(entries, 3)).toEqual([9, 10, 11]);
  });

  it("requests renumbering when no representable strict order remains", () => {
    expect(insertionOrder([{ key: "a", order: 1 }, { key: "b", order: 1 + Number.EPSILON }], ["a"], "after")).toBeNull();
    expect(insertionOrder([{ key: "a", order: Number.MAX_VALUE }], ["a"], "after")).toBeNull();
    expect(ordersAtEnd([{ key: "a", order: Number.MAX_VALUE }], 1)).toBeNull();
  });

  it("renumbers an insert from each current axis and preserves fields and ignored entries", () => {
    const update = createAxisRenumberUpdate({
      mode: "insert", selectedKeys: ["a", "b"], side: "after",
      entries: [{ key: "new", value: { cells: {}, local: true } }],
    });
    const current = {
      b: { order: 1, cells: { c1: "B" }, other: true }, ignored: { name: "no order" },
      a: { order: 1, cells: {}, extra: "kept" }, later: { order: 3, cells: {} },
    };
    const former = structuredClone(current);
    expect(update(current)).toEqual({
      b: { ...current.b, order: 1 }, ignored: current.ignored, a: { ...current.a, order: 0 },
      later: { ...current.later, order: 3 }, new: { cells: {}, local: true, order: 2 },
    });
    expect(current).toEqual(former);

    const changed = {
      b: { order: -2, cells: { c1: "Changed" }, concurrent: true },
      a: { order: -3, cells: {}, extra: "still kept" }, added: { order: 10, cells: {} },
    };
    expect(update(changed)).toEqual({
      b: { ...changed.b, order: 1 }, a: { ...changed.a, order: 0 },
      added: { ...changed.added, order: 3 }, new: { cells: {}, local: true, order: 2 },
    });
  });

  it("aborts an invalid insert axis, missing selection or split selected range", () => {
    const update = createAxisRenumberUpdate({
      mode: "insert", selectedKeys: ["a", "c"], side: "after", entries: [{ key: "new", value: {} }],
    });
    expect(update(null)).toBeUndefined();
    expect(update({ a: { order: 0 }, b: { order: 1 }, c: { order: 2 } })).toBeUndefined();
    expect(update({ a: { order: 0 }, c: { name: "ignored" } })).toBeUndefined();
  });

  it.each(["add at end", "store through a drawn position"])("renumbers the max-order end for %s", () => {
    const update = createAxisRenumberUpdate({
      mode: "append",
      entries: [{ key: "new-1", value: {} }, { key: "new-2", value: { cells: {}, extra: true } }],
    });
    expect(update({ last: { order: Number.MAX_VALUE, name: "Last" }, ignored: { order: "bad", keep: true } })).toEqual({
      last: { order: 0, name: "Last" }, ignored: { order: "bad", keep: true },
      "new-1": { order: 1 }, "new-2": { order: 2, cells: {}, extra: true },
    });
  });
});

// Contract: proofs/arch/templates/table.md#^templates-table-t-write-plan.
describe("Table write planning", () => {
  it("plans body commits across stored and drawn axes without overlapping paths", () => {
    expect(planCellCommit(table, { rowIndex: 0, columnIndex: 1 }, "CA", "California", {})).toEqual([
      set(["rows", "r1", "cells", "c2"], "California"),
    ]);
    expect(planCellCommit({ columns: table.columns, rows: {} }, { rowIndex: 2, columnIndex: 1 }, "", "Yosemite", {
      rows: ["r1", "r2", "r3"],
    })).toEqual([
      set(["rows", "r1"], { order: 0, cells: {} }), set(["rows", "r2"], { order: 1, cells: {} }),
      set(["rows", "r3"], { order: 2, cells: { c2: "Yosemite" } }),
    ]);
    expect(planCellCommit({ columns: {}, rows: table.rows }, { rowIndex: 0, columnIndex: 1 }, "", "CA", {
      columns: ["c1", "c2"],
    })).toEqual([
      set(["columns", "c1"], { order: 0 }), set(["columns", "c2"], { order: 1 }),
      set(["rows", "r1", "cells", "c2"], "CA"),
    ]);
    expect(planCellCommit({ columns: {}, rows: {} }, { rowIndex: 2, columnIndex: 1 }, "", "Yosemite", {
      columns: ["c1", "c2"], rows: ["r1", "r2", "r3"],
    })).toEqual([
      set(["columns", "c1"], { order: 0 }), set(["columns", "c2"], { order: 1 }),
      set(["rows", "r1"], { order: 0, cells: {} }), set(["rows", "r2"], { order: 1, cells: {} }),
      set(["rows", "r3"], { order: 2, cells: { c2: "Yosemite" } }),
    ]);
  });

  it("writes names, header visibility and edited primitive text at only their own paths", () => {
    expect(planHeaderCommit(table, 0, "Park", "National park", {})).toEqual([
      set(["columns", "c1", "name"], "National park"),
    ]);
    expect(planHeaderCommit({ columns: {}, rows: {} }, 1, "", "State", { columns: ["c1", "c2"] })).toEqual([
      set(["columns", "c1"], { order: 0 }), set(["columns", "c2"], { order: 1, name: "State" }),
    ]);
    expect(planSetHeader(true)).toEqual([set(["showHeader"], true)]);
    expect(planCellCommit({ columns: { c1: { order: 0 } }, rows: { r1: { order: 0, cells: { c1: 12 } } } },
      { rowIndex: 0, columnIndex: 0 }, "12", "13", {})).toEqual([
      set(["rows", "r1", "cells", "c1"], "13"),
    ]);
  });

  it("removes empty stored text and plans no write for empty drawn, unchanged or cancelled edits", () => {
    expect(planCellCommit(table, { rowIndex: 0, columnIndex: 0 }, "Yosemite", " \n ", {})).toEqual([
      remove(["rows", "r1", "cells", "c1"]),
    ]);
    expect(planHeaderCommit(table, 0, "Park", "", {})).toEqual([remove(["columns", "c1", "name"])]);
    expect(planCellCommit({ columns: {}, rows: {} }, { rowIndex: 0, columnIndex: 0 }, "", " ", {})).toEqual([]);
    expect(planCellCommit(table, { rowIndex: 0, columnIndex: 0 }, "Yosemite", "Yosemite", {})).toEqual([]);
    expect(planCellCommit(table, { rowIndex: 0, columnIndex: 0 }, "Yosemite", null, {})).toEqual([]);
    expect(planHeaderCommit(table, 0, "Park", null, {})).toEqual([]);
  });

  it("preserves surrounding whitespace and line breaks in changed text", () => {
    expect(planCellCommit(table, { rowIndex: 0, columnIndex: 0 }, "Yosemite", " Yosemite\nValley ", {})).toEqual([
      set(["rows", "r1", "cells", "c1"], " Yosemite\nValley "),
    ]);
  });

  it("adds through all drawn positions, inserts only through positions before the new entry, and adds one entry", () => {
    expect(planAdd({ columns: {}, rows: {} }, "rows", ["r1", "r2", "r3", "r4", "r5"])).toEqual([
      set(["rows", "r1"], { order: 0, cells: {} }), set(["rows", "r2"], { order: 1, cells: {} }),
      set(["rows", "r3"], { order: 2, cells: {} }), set(["rows", "r4"], { order: 3, cells: {} }),
      set(["rows", "r5"], { order: 4, cells: {} }),
    ]);
    expect(planInsert({ columns: {}, rows: {} }, "columns", { start: 2, end: 3 }, "before", ["c1", "c2", "new"])).toEqual([
      set(["columns", "c1"], { order: 0 }), set(["columns", "c2"], { order: 1 }),
      set(["columns", "new"], { order: 2 }),
    ]);
    expect(planInsert(table, "rows", { start: 0, end: 1 }, "after", ["new"])).toEqual([
      set(["rows", "new"], { order: 3, cells: {} }),
    ]);
  });

  it("deletes only stored entries and clears only non-empty body-cell paths", () => {
    expect(planDelete(table, "columns", { start: 1, end: 3 })).toEqual([remove(["columns", "c2"])]);
    expect(planDelete({ columns: {}, rows: {} }, "rows", { start: 1, end: 3 })).toEqual([]);
    expect(planClear({
      columns: { c1: { order: 0, name: "Kept" }, c2: { order: 1 } },
      rows: {
        r1: { order: 0, cells: { c1: "one", c2: "" } },
        r2: { order: 1, cells: { c1: true, c2: null } },
      },
    }, { kind: "columns", start: 0, end: 1 })).toEqual([
      remove(["rows", "r1", "cells", "c1"]), remove(["rows", "r2", "cells", "c1"]),
    ]);
  });
});

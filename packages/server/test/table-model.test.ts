import { describe, expect, it } from "vitest";
import {
  compareStoreKeys,
  createAxisRenumberUpdate,
  displayAxis,
  insertionOrder,
  ordersAtEnd,
  planAdd,
  planCellCommit,
  planClear,
  planDelete,
  planInsert,
  planResize,
  planSetHeader,
  readTable,
  type TableAxisEntry,
  type TablePlanResult,
  type TableRenumberRequest,
  type TableWriteOperation,
} from "../assets/templates/table/model.js";

const table = {
  headerRow: true,
  columns: {
    c2: { order: 2, width: 180, extra: "kept" },
    c1: { order: 1, width: 140 },
  },
  rows: {
    r2: { order: 2, height: 38, cells: { c1: "Yosemite", c2: "CA" }, extra: true },
    r1: { order: 1, height: 52, cells: { c1: "Park", c2: "State" } },
  },
};

const set = (path: string[], value: unknown): TableWriteOperation => ({ kind: "set", path, value });
const remove = (path: string[]): TableWriteOperation => ({ kind: "remove", path });
const operations = (...writes: TableWriteOperation[]): TablePlanResult => ({ kind: "operations", operations: writes });
const noWrite = (reason: Extract<TablePlanResult, { kind: "no-write" }>["reason"]): TablePlanResult => ({
  kind: "no-write",
  reason,
});
const renumber = (
  axis: "columns" | "rows",
  request: TableRenumberRequest,
  writes: TableWriteOperation[] = [],
): TablePlanResult => ({ kind: "renumber", axis, request, operations: writes });

// Contract: proofs/arch/templates/table.md#^templates-table-t-model.
describe("Table tolerant reading, stored sizes and order", () => {
  it("reads missing and partial roots, but rejects explicit non-object roots and axes", () => {
    expect(readTable(undefined)).toEqual({ columns: [], rows: [], headerRow: false });
    expect(readTable({})).toEqual({ columns: [], rows: [], headerRow: false });
    expect(readTable({ columns: { c1: { order: 1 } } })).toEqual({
      columns: [{ key: "c1", order: 1, width: 160 }], rows: [], headerRow: false,
    });
    expect(readTable({ rows: { r1: { order: 1, cells: {} } } })).toEqual({
      columns: [], rows: [{ key: "r1", order: 1, height: 38, cells: {} }], headerRow: false,
    });
    for (const value of [null, [], "table", 4, false, { columns: null }, { rows: [] }]) expect(readTable(value)).toBeNull();
  });

  it("drops malformed entries, orders finite entries by order and key, and does not mutate", () => {
    const value = {
      columns: Object.fromEntries([
        ["z", { order: 1, width: 200, name: "ignored" }], ["2", { order: 1, width: 0 }],
        ["10", { order: 1 }], ["a", { order: 1, width: 300, extra: true }],
        ["bad", { order: Infinity }], ["missing", { width: 120 }], ["null", null],
      ]),
      rows: Object.fromEntries([
        ["b", { order: 1, height: 60, cells: null }], ["1", { order: 1 }],
        ["a", { order: -1, height: 0, cells: [], extra: "kept" }], ["bad", { order: "2", cells: {} }],
      ]),
      headerRow: "yes",
      showHeader: true,
      extra: { retained: true },
    };
    const former = structuredClone(value);
    expect(readTable(value)).toEqual({
      columns: [
        { key: "2", order: 1, width: 160 }, { key: "10", order: 1, width: 160 },
        { key: "a", order: 1, width: 300 }, { key: "z", order: 1, width: 200 },
      ],
      rows: [
        { key: "a", order: -1, height: 38, cells: {} },
        { key: "1", order: 1, height: 38, cells: {} },
        { key: "b", order: 1, height: 60, cells: {} },
      ],
      headerRow: false,
    });
    expect(value).toEqual(former);
  });

  it("defaults and clamps positive finite stored widths and heights", () => {
    const value = {
      columns: Object.fromEntries([
        ["low", { order: 0, width: 63 }], ["minimum", { order: 1, width: 64 }],
        ["missing", { order: 2 }], ["wrong", { order: 3, width: "200" }],
        ["maximum", { order: 4, width: 640 }], ["high", { order: 5, width: 641 }],
        ["nan", { order: 6, width: Number.NaN }], ["infinite", { order: 7, width: Infinity }],
      ]),
      rows: Object.fromEntries([
        ["low", { order: 0, height: 27, cells: {} }], ["minimum", { order: 1, height: 28, cells: {} }],
        ["missing", { order: 2, cells: {} }], ["wrong", { order: 3, height: -2, cells: {} }],
        ["maximum", { order: 4, height: 240, cells: {} }], ["high", { order: 5, height: 241, cells: {} }],
        ["nan", { order: 6, height: Number.NaN, cells: {} }], ["infinite", { order: 7, height: Infinity, cells: {} }],
      ]),
    };
    const former = structuredClone(value);
    const result = readTable(value)!;
    expect(result.columns.map(column => column.width)).toEqual([64, 64, 160, 160, 640, 640, 160, 160]);
    expect(result.rows.map(row => row.height)).toEqual([28, 28, 38, 38, 240, 240, 38, 38]);
    expect(value).toEqual(former);
  });

  it("marks the first displayed row as the header, including when the first position is drawn", () => {
    expect(readTable({ headerRow: true, columns: {}, rows: {} })).toEqual({ columns: [], rows: [], headerRow: true });
    const result = readTable({
      headerRow: true,
      columns: { c1: { order: 0 } },
      rows: { ignored: { cells: {} }, later: { order: 2, cells: { c1: "Data" } }, first: { order: 1, cells: { c1: "Title" } } },
    })!;
    expect(result.headerRow).toBe(true);
    expect(result.rows.map(row => row.key)).toEqual(["first", "later"]);
  });

  it("shows supported cell text, leaves empty values blank, and ignores cells without a displayed column", () => {
    const result = readTable({
      columns: { c1: { order: 1 }, c2: { order: 2 }, c3: { order: 3 }, c4: { order: 4 }, c5: { order: 5 }, c6: { order: 6 } },
      rows: {
        r1: { order: 1, cells: { c1: "text", c2: 12, c3: true, c4: false, c5: "", c6: null, deleted: "ignored" } },
        r2: { order: 2 },
        r3: { order: 3, cells: "not cells" },
      },
    })!;
    expect(result.rows.map(row => row.cells)).toEqual([{ c1: "text", c2: "12", c3: "true", c4: "false" }, {}, {}]);
  });

  it("treats __proto__ as an ordinary column and cell key", () => {
    const result = readTable({
      columns: Object.fromEntries([["__proto__", { order: 0 }]]),
      rows: { r1: { order: 0, cells: Object.fromEntries([["__proto__", "kept"]]) } },
    })!;
    expect(result.columns).toEqual([{ key: "__proto__", order: 0, width: 160 }]);
    expect(result.rows[0].cells).toEqual(Object.fromEntries([["__proto__", "kept"]]));
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
    const entries = Array.from({ length: 5 }, (_, index) => ({ key: `c${index}`, order: index, width: 100 + index }));
    expect(displayAxis(entries)).toHaveLength(5);
    expect(displayAxis(entries).every(item => item.kind === "stored")).toBe(true);
  });

  it("keeps drawn identity through value changes and invalidates it when stored count changes", () => {
    const before = readTable({
      columns: { c1: { order: 1, width: 160 } },
      rows: { r1: { order: 1, height: 38, cells: { c1: "before" } } },
    })!;
    const changed = readTable({
      columns: { c1: { order: 9, width: 220 } },
      rows: { r1: { order: 9, height: 80, cells: { c1: "changed" } } },
    })!;
    expect(displayAxis(changed.columns)[2]!.id).toBe(displayAxis(before.columns)[2]!.id);
    expect(displayAxis(changed.rows)[2]!.id).toBe(displayAxis(before.rows)[2]!.id);

    const added = readTable({
      columns: { c1: { order: 1 }, c2: { order: 2 } },
      rows: { r1: { order: 1, cells: {} }, r2: { order: 2, cells: {} } },
    })!;
    expect(displayAxis(added.columns)[2]!.id).not.toBe(displayAxis(before.columns)[2]!.id);
    expect(displayAxis(added.rows)[2]!.id).not.toBe(displayAxis(before.rows)[2]!.id);
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

  it("uses farther representable orders before requesting renumbering", () => {
    const positive = 2 ** 53;
    const negative = -(2 ** 53);
    expect(insertionOrder([{ key: "a", order: positive }], ["a"], "after")).toSatisfy(
      order => Number.isFinite(order) && order > positive,
    );
    expect(insertionOrder([{ key: "a", order: negative }], ["a"], "before")).toSatisfy(
      order => Number.isFinite(order) && order < negative,
    );
    expect(ordersAtEnd([{ key: "a", order: positive }], 2)).toSatisfy(
      orders => orders !== null && orders[0]! > positive && orders[1]! > orders[0]!,
    );
    expect(insertionOrder([{ key: "a", order: Number.MAX_VALUE }], ["a"], "after")).toBeNull();
    expect(ordersAtEnd([{ key: "a", order: Number.MAX_VALUE }], 1)).toBeNull();
  });

  it("renumbers an insert from each current axis and preserves fields and ignored entries", () => {
    const update = createAxisRenumberUpdate({
      mode: "insert", selectedKeys: ["a", "b"], side: "after",
      entries: [{ key: "new", value: { cells: {}, height: 44, local: true } }],
    });
    const current = {
      b: { order: 1, height: 40, cells: { c1: "B" }, other: true }, ignored: { name: "no order" },
      a: { order: 1, height: 38, cells: {}, extra: "kept" }, later: { order: 3, height: 39, cells: {} },
    };
    const former = structuredClone(current);
    expect(update(current)).toEqual({
      b: { ...current.b, order: 1 }, ignored: current.ignored, a: { ...current.a, order: 0 },
      later: { ...current.later, order: 3 }, new: { cells: {}, height: 44, local: true, order: 2 },
    });
    expect(current).toEqual(former);

    const changed = {
      b: { order: -2, height: 90, cells: { c1: "Changed" }, concurrent: true },
      a: { order: -3, height: 38, cells: {}, extra: "still kept" }, added: { order: 10, height: 55, cells: {} },
    };
    expect(update(changed)).toEqual({
      b: { ...changed.b, order: 1 }, a: { ...changed.a, order: 0 },
      added: { ...changed.added, order: 3 }, new: { cells: {}, height: 44, local: true, order: 2 },
    });
  });

  it("treats an absent axis as empty and aborts every mode for a present non-object axis", () => {
    const append = createAxisRenumberUpdate({ mode: "append", entries: [{ key: "new", value: { width: 200 } }] });
    expect(append(undefined)).toEqual({ new: { order: 0, width: 200 } });
    for (const value of [null, [], "axis", 4, false]) expect(append(value)).toBeUndefined();

    const insert = createAxisRenumberUpdate({
      mode: "insert", selectedKeys: ["a", "c"], side: "after", entries: [{ key: "new", value: {} }],
    });
    for (const value of [undefined, null, [], "axis", 4, false]) expect(insert(value)).toBeUndefined();
    expect(insert({ a: { order: 0 }, b: { order: 1 }, c: { order: 2 } })).toBeUndefined();
    expect(insert({ a: { order: 0 }, c: { name: "ignored" } })).toBeUndefined();
  });

  it("plans and applies add and insert renumbering with their pending fields", () => {
    const addRequest: TableRenumberRequest = {
      mode: "append",
      entries: ["r1", "r2", "r3", "r4"].map(key => ({ key, value: { cells: {} } })),
    };
    expect(planAdd({ rows: { last: { order: Number.MAX_VALUE } }, columns: {} }, "rows", ["r1", "r2", "r3", "r4"]))
      .toEqual(renumber("rows", addRequest));
    expect(createAxisRenumberUpdate(addRequest)({ last: { order: Number.MAX_VALUE, height: 80, cells: {}, extra: true } })).toEqual({
      last: { order: 0, height: 80, cells: {}, extra: true },
      r1: { order: 1, cells: {} }, r2: { order: 2, cells: {} }, r3: { order: 3, cells: {} },
      r4: { order: 4, cells: {} },
    });

    const next = 1 + Number.EPSILON;
    expect(planInsert({ columns: {}, rows: { a: { order: 1, cells: {} }, b: { order: next, cells: {} } } },
      "rows", { start: 0, end: 0 }, "after", ["new"])).toEqual(renumber("rows", {
      mode: "insert", selectedKeys: ["a"], side: "after", entries: [{ key: "new", value: { cells: {} } }],
    }));
  });

  it("keeps an end insertion tied to its selected stored key when renumbering", () => {
    expect(planInsert({
      columns: {},
      rows: { a: { order: 0, cells: {} }, b: { order: Number.MAX_VALUE, cells: {} } },
    }, "rows", { start: 1, end: 1 }, "after", ["new"])).toEqual(renumber("rows", {
      mode: "insert",
      selectedKeys: ["b"],
      side: "after",
      entries: [{ key: "new", value: { cells: {} } }],
    }));
  });
});

// Contract: proofs/arch/templates/table.md#^templates-table-t-write-plan.
describe("Table write planning", () => {
  it("plans cell commits across stored and drawn axes without overlapping paths", () => {
    expect(planCellCommit(table, { rowIndex: 1, columnIndex: 1 }, "CA", "California", {})).toEqual(operations(
      set(["rows", "r2", "cells", "c2"], "California"),
    ));
    expect(planCellCommit({ columns: table.columns, rows: {} }, { rowIndex: 2, columnIndex: 1 }, "", "Yosemite", {
      rows: ["r1", "r2", "r3"],
    })).toEqual(operations(
      set(["rows", "r1"], { order: 0, cells: {} }), set(["rows", "r2"], { order: 1, cells: {} }),
      set(["rows", "r3"], { order: 2, cells: { c2: "Yosemite" } }),
    ));
    expect(planCellCommit({ columns: {}, rows: table.rows }, { rowIndex: 0, columnIndex: 1 }, "", "State", {
      columns: ["c1", "c2"],
    })).toEqual(operations(
      set(["columns", "c1"], { order: 0 }), set(["columns", "c2"], { order: 1 }),
      set(["rows", "r1", "cells", "c2"], "State"),
    ));
    expect(planCellCommit({ columns: {}, rows: {} }, { rowIndex: 2, columnIndex: 1 }, "", "Yosemite", {
      columns: ["c1", "c2"], rows: ["r1", "r2", "r3"],
    })).toEqual(operations(
      set(["columns", "c1"], { order: 0 }), set(["columns", "c2"], { order: 1 }),
      set(["rows", "r1"], { order: 0, cells: {} }), set(["rows", "r2"], { order: 1, cells: {} }),
      set(["rows", "r3"], { order: 2, cells: { c2: "Yosemite" } }),
    ));
  });

  it("writes first-row titles, header treatment and edited primitive text at only their own paths", () => {
    expect(planCellCommit(table, { rowIndex: 0, columnIndex: 0 }, "Park", "National park", {})).toEqual(operations(
      set(["rows", "r1", "cells", "c1"], "National park"),
    ));
    // The toggle takes no table value, so it cannot store a drawn first row.
    expect(planSetHeader(true)).toEqual(operations(set(["headerRow"], true)));
    expect(planSetHeader(false)).toEqual(operations(set(["headerRow"], false)));
    expect(planCellCommit({ columns: { c1: { order: 0 } }, rows: { r1: { order: 0, cells: { c1: 12 } } } },
      { rowIndex: 0, columnIndex: 0 }, "12", "13", {})).toEqual(operations(
      set(["rows", "r1", "cells", "c1"], "13"),
    ));
    expect(planCellCommit({ columns: { c1: { order: 0 } }, rows: { r1: { order: 0, cells: { c1: true } } } },
      { rowIndex: 0, columnIndex: 0 }, "true", "false", {})).toEqual(operations(
      set(["rows", "r1", "cells", "c1"], "false"),
    ));
  });

  it("removes whitespace-only stored text and writes nothing for blank or unchanged text", () => {
    expect(planCellCommit(table, { rowIndex: 1, columnIndex: 0 }, "Yosemite", " \n ", {})).toEqual(operations(
      remove(["rows", "r2", "cells", "c1"]),
    ));
    const emptyStored = { columns: { c1: { order: 0 } }, rows: { r1: { order: 0, cells: {} } } };
    expect(planCellCommit(emptyStored, { rowIndex: 0, columnIndex: 0 }, "", " \n ", {})).toEqual(noWrite("unchanged"));
    expect(planCellCommit(table, { rowIndex: 0, columnIndex: 0 }, "Park", "Park", {})).toEqual(noWrite("unchanged"));
    expect(planCellCommit({ columns: {}, rows: {} }, { rowIndex: 0, columnIndex: 0 }, "", " ", {}))
      .toEqual(noWrite("empty-drawn"));
  });

  it("distinguishes cancelled, unreadable, invalid and missing-key no-write outcomes", () => {
    expect(planCellCommit(table, { rowIndex: 0, columnIndex: 0 }, "Park", null, {})).toEqual(noWrite("cancelled"));
    expect(planCellCommit(null, { rowIndex: 0, columnIndex: 0 }, "", "text", {})).toEqual(noWrite("unreadable"));
    expect(planCellCommit(table, { rowIndex: 8, columnIndex: 0 }, "", "text", {})).toEqual(noWrite("invalid-target"));
    expect(planCellCommit({ columns: {}, rows: {} }, { rowIndex: 0, columnIndex: 0 }, "", "text", {}))
      .toEqual(noWrite("missing-keys"));
    expect(planInsert(table, "rows", { start: 2, end: 1 }, "after", ["new"]))
      .toEqual(noWrite("invalid-selection"));
    expect(planAdd({ columns: {}, rows: {} }, "columns", ["same", "same", "c3", "c4", "c5"]))
      .toEqual(noWrite("invalid-keys"));
  });

  it("preserves surrounding whitespace and line breaks in changed text", () => {
    expect(planCellCommit(table, { rowIndex: 1, columnIndex: 0 }, "Yosemite", " Yosemite\nValley ", {})).toEqual(operations(
      set(["rows", "r2", "cells", "c1"], " Yosemite\nValley "),
    ));
  });

  it("plans stored, drawn, clamped and unchanged resizes", () => {
    expect(planResize(table, "columns", 0, 140, 200, {})).toEqual(operations(
      set(["columns", "c1", "width"], 200),
    ));
    expect(planResize(table, "rows", 0, 52, 80, {})).toEqual(operations(
      set(["rows", "r1", "height"], 80),
    ));
    expect(planResize(table, "columns", 0, 140, 2, {})).toEqual(operations(
      set(["columns", "c1", "width"], 64),
    ));
    expect(planResize(table, "rows", 0, 52, 999, {})).toEqual(operations(
      set(["rows", "r1", "height"], 240),
    ));
    expect(planResize({ columns: { c1: { order: 0, width: 640 } }, rows: {} }, "columns", 0, 640, 900, {}))
      .toEqual(noWrite("unchanged"));
    expect(planResize({ columns: { c1: { order: 0, width: 300 } }, rows: {} }, "columns", 0, 160, 160, {}))
      .toEqual(noWrite("unchanged"));
    expect(planResize({ columns: { c1: { order: 0, width: 300 } }, rows: {} }, "columns", 0, 160, 200, {}))
      .toEqual(operations(set(["columns", "c1", "width"], 200)));
    expect(planResize({ columns: { c1: { order: 0, width: 300 } }, rows: {} }, "columns", 0, 300, 0, {}))
      .toEqual(operations(set(["columns", "c1", "width"], 64)));
    expect(planResize({ columns: {}, rows: { r1: { order: 0, height: 80, cells: {} } } }, "rows", 0, 80, -10, {}))
      .toEqual(operations(set(["rows", "r1", "height"], 28)));
    expect(planResize({ columns: { c1: { order: 0, width: 200 } }, rows: {} }, "columns", 0, 200, Number.NaN, {}))
      .toEqual(noWrite("unchanged"));
    expect(planResize({ columns: { c1: { order: 0, width: 64 } }, rows: {} }, "columns", 0, 64, 54, {}))
      .toEqual(noWrite("unchanged"));

    expect(planResize({ columns: {}, rows: {} }, "columns", 1, 160, 210, { columns: ["c1", "c2"] })).toEqual(operations(
      set(["columns", "c1"], { order: 0 }), set(["columns", "c2"], { order: 1, width: 210 }),
    ));
    expect(planResize({ columns: {}, rows: {} }, "rows", 2, 38, 60, { rows: ["r1", "r2", "r3"] })).toEqual(operations(
      set(["rows", "r1"], { order: 0, cells: {} }), set(["rows", "r2"], { order: 1, cells: {} }),
      set(["rows", "r3"], { order: 2, cells: {}, height: 60 }),
    ));
  });

  it("carries a drawn size through renumbering and rejects missing resize keys", () => {
    expect(planResize({ columns: { last: { order: Number.MAX_VALUE } }, rows: {} },
      "columns", 1, 160, 220, { columns: ["new-column"] })).toEqual(renumber("columns", {
      mode: "append", entries: [{ key: "new-column", value: { width: 220 } }],
    }));
    expect(planResize({ columns: {}, rows: { last: { order: Number.MAX_VALUE, cells: {} } } },
      "rows", 1, 38, 60, { rows: ["new-row"] })).toEqual(renumber("rows", {
      mode: "append", entries: [{ key: "new-row", value: { cells: {}, height: 60 } }],
    }));
    expect(planResize({ columns: {}, rows: {} }, "columns", 1, 160, 220, {})).toEqual(noWrite("missing-keys"));
    expect(planResize(null, "columns", 0, 160, 220, {})).toEqual(noWrite("unreadable"));
  });

  it("adds through drawn positions and inserts at the end, through drawn positions or between entries", () => {
    expect(planAdd({ columns: {}, rows: {} }, "rows", ["r1", "r2", "r3", "r4", "r5"])).toEqual(operations(
      set(["rows", "r1"], { order: 0, cells: {} }), set(["rows", "r2"], { order: 1, cells: {} }),
      set(["rows", "r3"], { order: 2, cells: {} }), set(["rows", "r4"], { order: 3, cells: {} }),
      set(["rows", "r5"], { order: 4, cells: {} }),
    ));
    expect(planInsert({ columns: {}, rows: {} }, "columns", { start: 2, end: 3 }, "before", ["c1", "c2", "new"])).toEqual(operations(
      set(["columns", "c1"], { order: 0 }), set(["columns", "c2"], { order: 1 }),
      set(["columns", "new"], { order: 2 }),
    ));
    expect(planInsert(table, "rows", { start: 0, end: 1 }, "after", ["new"])).toEqual(operations(
      set(["rows", "new"], { order: 3, cells: {} }),
    ));
    expect(planInsert(table, "rows", { start: 1, end: 1 }, "before", ["between"])).toEqual(operations(
      set(["rows", "between"], { order: 1.5, cells: {} }),
    ));
  });

  it("carries edits through one-axis renumbering and fails when both axes need it", () => {
    const rowRequest: TableRenumberRequest = {
      mode: "append", entries: [{ key: "new-row", value: { cells: { c1: "Yosemite" } } }],
    };
    expect(planCellCommit({
      columns: { c1: { order: 0 } }, rows: { last: { order: Number.MAX_VALUE, cells: {} } },
    }, { rowIndex: 1, columnIndex: 0 }, "", "Yosemite", { rows: ["new-row"] })).toEqual(renumber("rows", rowRequest));
    expect(createAxisRenumberUpdate(rowRequest)({
      last: { order: Number.MAX_VALUE, height: 52, cells: {}, extra: true },
    })).toEqual({
      last: { order: 0, height: 52, cells: {}, extra: true },
      "new-row": { order: 1, cells: { c1: "Yosemite" } },
    });

    expect(planCellCommit({
      columns: { c1: { order: 0 } }, rows: { r1: { order: Number.MAX_VALUE, cells: {} } },
    }, { rowIndex: 1, columnIndex: 1 }, "", "CA", {
      columns: ["new-column"], rows: ["new-row"],
    })).toEqual(renumber("rows", {
      mode: "append", entries: [{ key: "new-row", value: { cells: { "new-column": "CA" } } }],
    }, [set(["columns", "new-column"], { order: 1 })]));

    expect(planCellCommit({
      columns: { c1: { order: Number.MAX_VALUE } }, rows: { r1: { order: Number.MAX_VALUE, cells: {} } },
    }, { rowIndex: 1, columnIndex: 1 }, "", "CA", {
      columns: ["new-column"], rows: ["new-row"],
    })).toEqual(noWrite("multiple-renumbering-required"));

    expect(planCellCommit({
      columns: { last: { order: Number.MAX_VALUE } }, rows: { r1: { order: 0, cells: {} } },
    }, { rowIndex: 0, columnIndex: 1 }, "", "CA", { columns: ["new-column"] })).toEqual(renumber(
      "columns",
      { mode: "append", entries: [{ key: "new-column", value: {} }] },
      [set(["rows", "r1", "cells", "new-column"], "CA")],
    ));
  });

  it("deletes only stored entries and distinguishes an entirely drawn selection", () => {
    expect(planDelete(table, "columns", { start: 1, end: 3 })).toEqual(operations(remove(["columns", "c2"])));
    expect(planDelete({ columns: {}, rows: {} }, "rows", { start: 1, end: 3 })).toEqual(noWrite("nothing-to-delete"));
  });

  it("clears ordinary cells and row cells, including first-row titles", () => {
    expect(planClear(table, { kind: "cell", rowIndex: 0, columnIndex: 1 })).toEqual(operations(
      remove(["rows", "r1", "cells", "c2"]),
    ));
    expect(planClear(table, { kind: "rows", start: 0, end: 0 })).toEqual(operations(
      remove(["rows", "r1", "cells", "c1"]), remove(["rows", "r1", "cells", "c2"]),
    ));
    expect(planClear({ columns: {}, rows: {} }, { kind: "cell", rowIndex: 0, columnIndex: 0 }))
      .toEqual(noWrite("nothing-to-clear"));
    expect(planClear(table, { kind: "cell", rowIndex: 8, columnIndex: 0 })).toEqual(noWrite("invalid-target"));
  });

  it("clears only non-empty cell paths for a whole column", () => {
    expect(planClear({
      columns: { c1: { order: 0 }, c2: { order: 1 } },
      rows: {
        r1: { order: 0, cells: { c1: "Title", c2: "" } },
        r2: { order: 1, cells: { c1: true, c2: null } },
      },
    }, { kind: "columns", start: 0, end: 1 })).toEqual(operations(
      remove(["rows", "r1", "cells", "c1"]), remove(["rows", "r2", "cells", "c1"]),
    ));
  });
});

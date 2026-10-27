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
  planHeaderCommit,
  planInsert,
  planSetHeader,
  readTable,
  type TableAxisEntry,
  type TablePlanResult,
  type TableRenumberRequest,
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
    expect(renamed.id).toBe(before.id);
    expect(displayAxis([{ key: "c2", order: 1 }])[2]!.id).toBe(before.id);
    expect(displayAxis([{ key: "c1", order: 1 }, { key: "c2", order: 2 }])[2]!.id).not.toBe(before.id);
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

  it("uses a farther representable order before requesting renumbering", () => {
    const positive = 2 ** 53;
    const negative = -(2 ** 53);
    expect(insertionOrder([{ key: "a", order: positive }], ["a"], "after")).toSatisfy(
      order => Number.isFinite(order) && order > positive,
    );
    expect(insertionOrder([{ key: "a", order: negative }], ["a"], "before")).toSatisfy(
      order => Number.isFinite(order) && order < negative,
    );
    const appended = ordersAtEnd([{ key: "a", order: positive }], 2)!;
    expect(appended).toHaveLength(2);
    expect(appended[0]).toBeGreaterThan(positive);
    expect(appended[1]).toBeGreaterThan(appended[0]);
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

  it("plans and applies an add-at-end renumbering", () => {
    const request: TableRenumberRequest = {
      mode: "append",
      entries: ["r1", "r2", "r3", "r4"].map(key => ({ key, value: { cells: {} } })),
    };
    expect(planAdd({ rows: { last: { order: Number.MAX_VALUE } }, columns: {} }, "rows", ["r1", "r2", "r3", "r4"]))
      .toEqual(renumber("rows", request));
    const update = createAxisRenumberUpdate(request);
    expect(update({ last: { order: Number.MAX_VALUE, name: "Last" }, ignored: { order: "bad", keep: true } })).toEqual({
      last: { order: 0, name: "Last" }, ignored: { order: "bad", keep: true },
      r1: { order: 1, cells: {} }, r2: { order: 2, cells: {} },
      r3: { order: 3, cells: {} }, r4: { order: 4, cells: {} },
    });
  });

  it("plans an insertion renumbering from the selected stored keys", () => {
    const next = 1 + Number.EPSILON;
    expect(planInsert({
      columns: {},
      rows: { a: { order: 1, cells: {} }, b: { order: next, cells: {} } },
    }, "rows", { start: 0, end: 0 }, "after", ["new"])).toEqual(renumber("rows", {
      mode: "insert",
      selectedKeys: ["a"],
      side: "after",
      entries: [{ key: "new", value: { cells: {} } }],
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
  it("plans body commits across stored and drawn axes without overlapping paths", () => {
    expect(planCellCommit(table, { rowIndex: 0, columnIndex: 1 }, "CA", "California", {})).toEqual(operations(
      set(["rows", "r1", "cells", "c2"], "California"),
    ));
    expect(planCellCommit({ columns: table.columns, rows: {} }, { rowIndex: 2, columnIndex: 1 }, "", "Yosemite", {
      rows: ["r1", "r2", "r3"],
    })).toEqual(operations(
      set(["rows", "r1"], { order: 0, cells: {} }), set(["rows", "r2"], { order: 1, cells: {} }),
      set(["rows", "r3"], { order: 2, cells: { c2: "Yosemite" } }),
    ));
    expect(planCellCommit({ columns: {}, rows: table.rows }, { rowIndex: 0, columnIndex: 1 }, "", "CA", {
      columns: ["c1", "c2"],
    })).toEqual(operations(
      set(["columns", "c1"], { order: 0 }), set(["columns", "c2"], { order: 1 }),
      set(["rows", "r1", "cells", "c2"], "CA"),
    ));
    expect(planCellCommit({ columns: {}, rows: {} }, { rowIndex: 2, columnIndex: 1 }, "", "Yosemite", {
      columns: ["c1", "c2"], rows: ["r1", "r2", "r3"],
    })).toEqual(operations(
      set(["columns", "c1"], { order: 0 }), set(["columns", "c2"], { order: 1 }),
      set(["rows", "r1"], { order: 0, cells: {} }), set(["rows", "r2"], { order: 1, cells: {} }),
      set(["rows", "r3"], { order: 2, cells: { c2: "Yosemite" } }),
    ));
  });

  it("writes names, header visibility and edited primitive text at only their own paths", () => {
    expect(planHeaderCommit(table, 0, "Park", "National park", {})).toEqual(operations(
      set(["columns", "c1", "name"], "National park"),
    ));
    expect(planHeaderCommit({ columns: {}, rows: {} }, 1, "", "State", { columns: ["c1", "c2"] })).toEqual(operations(
      set(["columns", "c1"], { order: 0 }), set(["columns", "c2"], { order: 1, name: "State" }),
    ));
    expect(planSetHeader(true)).toEqual(operations(set(["showHeader"], true)));
    expect(planCellCommit({ columns: { c1: { order: 0 } }, rows: { r1: { order: 0, cells: { c1: 12 } } } },
      { rowIndex: 0, columnIndex: 0 }, "12", "13", {})).toEqual(operations(
      set(["rows", "r1", "cells", "c1"], "13"),
    ));
  });

  it("removes empty stored text and treats blank stored text as unchanged", () => {
    expect(planCellCommit(table, { rowIndex: 0, columnIndex: 0 }, "Yosemite", " \n ", {})).toEqual(operations(
      remove(["rows", "r1", "cells", "c1"]),
    ));
    expect(planHeaderCommit(table, 0, "Park", "", {})).toEqual(operations(remove(["columns", "c1", "name"])));
    const emptyStored = { columns: { c1: { order: 0 } }, rows: { r1: { order: 0, cells: {} } } };
    expect(planCellCommit(emptyStored, { rowIndex: 0, columnIndex: 0 }, "", " \n ", {})).toEqual(noWrite("unchanged"));
    expect(planHeaderCommit(emptyStored, 0, "", "  ", {})).toEqual(noWrite("unchanged"));
  });

  it("distinguishes cancelled, unchanged, empty-drawn and invalid no-write outcomes", () => {
    expect(planCellCommit(table, { rowIndex: 0, columnIndex: 0 }, "Yosemite", null, {})).toEqual(noWrite("cancelled"));
    expect(planCellCommit(table, { rowIndex: 0, columnIndex: 0 }, "Yosemite", "Yosemite", {})).toEqual(noWrite("unchanged"));
    expect(planCellCommit({ columns: {}, rows: {} }, { rowIndex: 0, columnIndex: 0 }, "", " ", {}))
      .toEqual(noWrite("empty-drawn"));
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
    expect(planCellCommit(table, { rowIndex: 0, columnIndex: 0 }, "Yosemite", " Yosemite\nValley ", {})).toEqual(operations(
      set(["rows", "r1", "cells", "c1"], " Yosemite\nValley "),
    ));
  });

  it("adds through drawn positions and inserts at the end, through drawn positions or between stored entries", () => {
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

  it("carries the edit in the target row when storing a drawn row through renumbering", () => {
    const request: TableRenumberRequest = {
      mode: "append",
      entries: [{ key: "new-row", value: { cells: { c1: "Yosemite" } } }],
    };
    const result = planCellCommit({
      columns: { c1: { order: 0 } },
      rows: { last: { order: Number.MAX_VALUE, cells: {} } },
    }, { rowIndex: 1, columnIndex: 0 }, "", "Yosemite", { rows: ["new-row"] });
    expect(result).toEqual(renumber("rows", request));
    expect(createAxisRenumberUpdate(request)({ last: { order: Number.MAX_VALUE, cells: {} } })).toEqual({
      last: { order: 0, cells: {} },
      "new-row": { order: 1, cells: { c1: "Yosemite" } },
    });
  });

  it("renumbers a drawn row carrying its cell before writing the drawn column", () => {
    expect(planCellCommit({
      columns: { c1: { order: 0 } },
      rows: { r1: { order: Number.MAX_VALUE, cells: {} } },
    }, { rowIndex: 1, columnIndex: 1 }, "", "CA", {
      columns: ["new-column"],
      rows: ["new-row"],
    })).toEqual(renumber("rows", {
      mode: "append",
      entries: [{ key: "new-row", value: { cells: { "new-column": "CA" } } }],
    }, [set(["columns", "new-column"], { order: 1 })]));
  });

  it("fails a drawn-cell save that would need both axes renumbered", () => {
    expect(planCellCommit({
      columns: { c1: { order: Number.MAX_VALUE } },
      rows: { r1: { order: Number.MAX_VALUE, cells: {} } },
    }, { rowIndex: 1, columnIndex: 1 }, "", "CA", {
      columns: ["new-column"],
      rows: ["new-row"],
    })).toEqual(noWrite("multiple-renumbering-required"));
  });

  it("carries a drawn header name, and keeps a stored-row cell write separate when only columns renumber", () => {
    const headerRequest: TableRenumberRequest = {
      mode: "append",
      entries: [{ key: "new-column", value: { name: "State" } }],
    };
    const atMaximum = { columns: { last: { order: Number.MAX_VALUE } }, rows: {} };
    expect(planHeaderCommit(atMaximum, 1, "", "State", { columns: ["new-column"] }))
      .toEqual(renumber("columns", headerRequest));

    const cellRequest: TableRenumberRequest = {
      mode: "append",
      entries: [{ key: "new-column", value: {} }],
    };
    expect(planCellCommit({
      columns: atMaximum.columns,
      rows: { r1: { order: 0, cells: {} } },
    }, { rowIndex: 0, columnIndex: 1 }, "", "CA", { columns: ["new-column"] })).toEqual(renumber(
      "columns",
      cellRequest,
      [set(["rows", "r1", "cells", "new-column"], "CA")],
    ));
  });

  it("deletes only stored entries and distinguishes an entirely drawn selection", () => {
    expect(planDelete(table, "columns", { start: 1, end: 3 })).toEqual(operations(remove(["columns", "c2"])));
    expect(planDelete({ columns: {}, rows: {} }, "rows", { start: 1, end: 3 })).toEqual(noWrite("nothing-to-delete"));
  });

  it("clears header names, cells and row cells, while a drawn position makes no write", () => {
    expect(planClear(table, { kind: "header", columnIndex: 0 })).toEqual(operations(
      remove(["columns", "c1", "name"]),
    ));
    expect(planClear(table, { kind: "cell", rowIndex: 0, columnIndex: 1 })).toEqual(operations(
      remove(["rows", "r1", "cells", "c2"]),
    ));
    expect(planClear(table, { kind: "rows", start: 0, end: 0 })).toEqual(operations(
      remove(["rows", "r1", "cells", "c1"]),
      remove(["rows", "r1", "cells", "c2"]),
    ));
    expect(planClear({ columns: {}, rows: {} }, { kind: "cell", rowIndex: 0, columnIndex: 0 }))
      .toEqual(noWrite("nothing-to-clear"));
    expect(planClear(table, { kind: "cell", rowIndex: 8, columnIndex: 0 }))
      .toEqual(noWrite("invalid-target"));
  });

  it("clears only non-empty body-cell paths for a whole column", () => {
    expect(planClear({
      columns: { c1: { order: 0, name: "Kept" }, c2: { order: 1 } },
      rows: {
        r1: { order: 0, cells: { c1: "one", c2: "" } },
        r2: { order: 1, cells: { c1: true, c2: null } },
      },
    }, { kind: "columns", start: 0, end: 1 })).toEqual(operations(
      remove(["rows", "r1", "cells", "c1"]), remove(["rows", "r2", "cells", "c1"]),
    ));
  });
});

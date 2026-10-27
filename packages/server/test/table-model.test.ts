import { describe, expect, it } from "vitest";
import {
  cellValue,
  columnsOf,
  compareValues,
  isTableData,
  orderedRows,
  textOf,
  visibleRows,
} from "../assets/templates/table/model.js";

describe("Table whole-value validation and stored order", () => {
  it("accepts an empty table, arbitrary JSON cells and extra root fields without changing them", () => {
    const values = [
      { rows: {} },
      {
        rows: {
          later: { order: 2, Name: "Oak", Open: true, Detail: { acres: 12 }, Empty: null },
          first: { order: -1.5, Name: "Elm", Tags: ["city", "quiet"] },
        },
        retained: { owner: "agent" },
      },
    ];
    for (const value of values) {
      const original = structuredClone(value);
      expect(isTableData(value)).toBe(true);
      expect(value).toEqual(original);
    }
  });

  it.each([
    undefined, null, [], "rows", 4, false, {}, { rows: null }, { rows: [] },
    { rows: { one: null } }, { rows: { one: [] } }, { rows: { one: {} } },
    { rows: { one: { order: "1" } } }, { rows: { one: { order: Number.NaN } } },
    { rows: { one: { order: Number.POSITIVE_INFINITY } } },
  ])("rejects malformed data %j", value => {
    expect(isTableData(value)).toBe(false);
    expect(orderedRows(value)).toBeUndefined();
  });

  it("orders rows by numeric order and then key, hiding order from the cells", () => {
    expect(orderedRows({
      rows: {
        zed: { order: 3, Name: "Last" },
        beta: { order: 1, Name: "Second" },
        alpha: { order: 1, Name: "First" },
      },
    })).toEqual([
      { key: "alpha", order: 1, cells: { Name: "First" } },
      { key: "beta", order: 1, cells: { Name: "Second" } },
      { key: "zed", order: 3, cells: { Name: "Last" } },
    ]);
  });
});

describe("Table columns, filtering and page sorting", () => {
  const rows = orderedRows({
    rows: {
      c: { order: 30, Name: "Trail 10", Score: 2, Note: "A long description that runs well beyond forty characters.", Empty: "" },
      a: { order: 10, Name: "Trail 2", Open: true, Score: 12 },
      b: { order: 20, Name: "Forest", Open: false, Score: null, Detail: { kind: "park" } },
    },
  })!;

  it("derives columns from all base rows in first-seen order and marks numeric and long columns", () => {
    expect(columnsOf(rows)).toEqual([
      { key: "Name", numeric: false, long: false },
      { key: "Open", numeric: false, long: false },
      { key: "Score", numeric: true, long: false },
      { key: "Detail", numeric: false, long: false },
      { key: "Note", numeric: false, long: true },
      { key: "Empty", numeric: false, long: false },
    ]);
  });

  it("treats inherited object names as missing unless the row stores that cell", () => {
    const unusual = orderedRows({
      rows: {
        first: { order: 1, constructor: "stored" },
        second: { order: 2, Name: "Ordinary" },
      },
    })!;
    expect(cellValue(unusual[0]!.cells, "constructor")).toBe("stored");
    expect(cellValue(unusual[1]!.cells, "constructor")).toBeUndefined();
    expect(columnsOf(unusual)[0]).toEqual({ key: "constructor", numeric: false, long: false });
    expect(visibleRows(unusual, { filter: "", sort: { column: "constructor", direction: "ascending" } }).map(row => row.key)).toEqual(["first", "second"]);
  });

  it("filters case-insensitively through stringified cell values but not keys or order", () => {
    expect(visibleRows(rows, { filter: "  PARK  ", sort: null }).map(row => row.key)).toEqual(["b"]);
    expect(visibleRows(rows, { filter: "TRUE", sort: null }).map(row => row.key)).toEqual(["a"]);
    expect(visibleRows(rows, { filter: "20", sort: null })).toEqual([]);
    expect(visibleRows(rows, { filter: "b", sort: null }).map(row => row.key)).not.toContain("b");
  });

  it("sorts numeric pairs numerically, text naturally and empty values last in both directions", () => {
    expect(visibleRows(rows, { filter: "", sort: { column: "Score", direction: "ascending" } }).map(row => row.key)).toEqual(["c", "a", "b"]);
    expect(visibleRows(rows, { filter: "", sort: { column: "Score", direction: "descending" } }).map(row => row.key)).toEqual(["a", "c", "b"]);
    expect(visibleRows(rows, { filter: "", sort: { column: "Name", direction: "ascending" } }).map(row => row.key)).toEqual(["b", "a", "c"]);
    expect(visibleRows(rows, { filter: "", sort: { column: "Name", direction: "descending" } }).map(row => row.key)).toEqual(["c", "a", "b"]);
  });

  it("returns stored order when no page sort is active and does not change the input", () => {
    const original = structuredClone(rows);
    expect(visibleRows(rows, { filter: "", sort: null }).map(row => row.key)).toEqual(["a", "b", "c"]);
    expect(rows).toEqual(original);
  });

  it("uses numeric comparison only for two numbers and natural, case-insensitive text otherwise", () => {
    expect(compareValues(2, 12)).toBeLessThan(0);
    expect(compareValues("Trail 2", "trail 10")).toBeLessThan(0);
    expect(compareValues(12, "2")).toBeGreaterThan(0);
    expect(compareValues(null, "anything")).toBeGreaterThan(0);
    expect(compareValues(undefined, "")).toBe(0);
  });

  it("uses compact JSON for objects and ordinary text for primitive values", () => {
    expect(textOf({ park: ["Oak", 2] })).toBe('{"park":["Oak",2]}');
    expect(textOf(true)).toBe("true");
    expect(textOf(2026)).toBe("2026");
  });
});

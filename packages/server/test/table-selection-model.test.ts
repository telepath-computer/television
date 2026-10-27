import { describe, expect, it } from "vitest";
import { displayAxis } from "../assets/templates/table/model.js";
import {
  cellSelectionAt,
  enterTable,
  headerSelectionAt,
  moveSelection,
  reconcileSelection,
  selectAxis,
  selectionAfterAdd,
  selectionAfterDelete,
  selectionAfterInsert,
  selectionForMenu,
} from "../assets/templates/table/selection-model.js";

const axes = (rowKeys = ["r1", "r2", "r3", "r4"], columnKeys = ["c1", "c2", "c3", "c4"]) => ({
  rows: displayAxis(rowKeys.map((key, order) => ({ key, order }))),
  columns: displayAxis(columnKeys.map((key, order) => ({ key, order }))),
});

// Contract: proofs/ui/templates/table.md#^table-t-selection-model.
describe("Table selection model", () => {
  it("selects body and header cells, switches axes, and extends a contiguous range from its anchor", () => {
    const grid = axes();
    const cell = cellSelectionAt(grid, 2, 1);
    expect(cell).toMatchObject({ kind: "cell", rowId: "stored:r3", columnId: "stored:c2" });
    expect(headerSelectionAt(grid, 2)).toEqual({ kind: "header", columnId: "stored:c3" });
    const rows = selectAxis(cell, "rows", 2, false, grid);
    expect(rows).toEqual({ kind: "rows", ids: ["stored:r3"], anchorId: "stored:r3", activeId: "stored:r3" });
    expect(selectAxis(rows, "rows", 0, true, grid)).toEqual({
      kind: "rows", ids: ["stored:r1", "stored:r2", "stored:r3"], anchorId: "stored:r3", activeId: "stored:r1",
    });
    expect(selectAxis(rows, "columns", 1, true, grid)).toEqual({
      kind: "columns", ids: ["stored:c2"], anchorId: "stored:c2", activeId: "stored:c2",
    });
  });

  it("moves cells and headers, crosses the header boundary, and reports Tab exits at horizontal edges", () => {
    const grid = axes();
    const start = cellSelectionAt(grid, 0, 1);
    expect(moveSelection(start, "up", grid, { showHeader: true }).selection).toEqual(headerSelectionAt(grid, 1));
    expect(moveSelection(headerSelectionAt(grid, 1), "down", grid, { showHeader: true }).selection).toEqual(start);
    expect(moveSelection(start, "left", grid, { showHeader: true }).selection).toEqual(cellSelectionAt(grid, 0, 0));
    expect(moveSelection(start, "tab-forward", grid, { showHeader: true }).selection).toEqual(cellSelectionAt(grid, 0, 2));
    expect(moveSelection(start, "tab-backward", grid, { showHeader: true }).selection).toEqual(cellSelectionAt(grid, 0, 0));
    expect(moveSelection(null, "right", grid, { showHeader: false }).selection).toEqual(cellSelectionAt(grid, 0, 0));
    expect(moveSelection(cellSelectionAt(grid, 0, 1), "up", grid, { showHeader: false }).selection)
      .toEqual(cellSelectionAt(grid, 0, 1));
    expect(moveSelection(cellSelectionAt(grid, 0, 3), "tab-forward", grid, { showHeader: false })).toEqual({
      selection: cellSelectionAt(grid, 0, 3), exit: "after",
    });
    expect(moveSelection(headerSelectionAt(grid, 0), "tab-backward", grid, { showHeader: true })).toEqual({
      selection: headerSelectionAt(grid, 0), exit: "before",
    });
  });

  it("selects whole axes from cells and applies spreadsheet movement and no-op keys", () => {
    const grid = axes();
    const cell = cellSelectionAt(grid, 1, 2);
    const row = moveSelection(cell, "select-row", grid, { showHeader: true }).selection;
    const column = moveSelection(cell, "select-column", grid, { showHeader: true }).selection;
    expect(row).toEqual(selectAxis(null, "rows", 1, false, grid));
    expect(column).toEqual(selectAxis(null, "columns", 2, false, grid));
    expect(moveSelection(row, "left", grid, { showHeader: true }).selection).toEqual(row);
    expect(moveSelection(column, "left", grid, { showHeader: true }).selection)
      .toEqual(selectAxis(null, "columns", 1, false, grid));
    expect(moveSelection(column, "right", grid, { showHeader: true }).selection)
      .toEqual(selectAxis(null, "columns", 3, false, grid));
    expect(moveSelection(column, "up", grid, { showHeader: true }).selection).toEqual(column);
    expect(moveSelection(column, "down", grid, { showHeader: true }).selection).toEqual(column);
    expect(moveSelection(headerSelectionAt(grid, 2), "select-column", grid, { showHeader: true }).selection)
      .toEqual(column);
    expect(moveSelection(row, "tab-forward", grid, { showHeader: true }).exit).toBe("after");
    expect(moveSelection(column, "tab-backward", grid, { showHeader: true }).exit).toBe("before");
  });

  it("collapses a range to its anchor before moving, and Shift extends or shrinks its active end", () => {
    const grid = axes();
    const range = selectAxis(selectAxis(null, "rows", 1, false, grid), "rows", 3, true, grid);
    expect(moveSelection(range, "up", grid, { showHeader: false }).selection).toEqual(selectAxis(null, "rows", 0, false, grid));
    const extended = moveSelection(range, "up", grid, { showHeader: false, extend: true }).selection;
    expect(extended).toEqual(selectAxis(selectAxis(null, "rows", 1, false, grid), "rows", 2, true, grid));
    expect(moveSelection(extended, "down", grid, { showHeader: false, extend: true }).selection).toEqual(range);
  });

  it("starts a one-item axis selection when Shift-click switches from a cell", () => {
    const grid = axes();
    const cell = cellSelectionAt(grid, 1, 1);
    expect(selectAxis(cell, "rows", 3, true, grid)).toEqual(selectAxis(null, "rows", 3, false, grid));
    expect(selectAxis(cell, "columns", 0, true, grid)).toEqual(selectAxis(null, "columns", 0, false, grid));
  });

  it("enters at the retained selection or first body cell and leaves irrelevant axis movement unchanged", () => {
    const grid = axes();
    const retained = cellSelectionAt(grid, 2, 2);
    expect(enterTable(null, grid)).toEqual(cellSelectionAt(grid, 0, 0));
    expect(enterTable(retained, grid)).toEqual(retained);
    const rows = selectAxis(null, "rows", 1, false, grid);
    for (const command of ["left", "right"] as const) {
      expect(moveSelection(rows, command, grid, { showHeader: false }).selection).toEqual(rows);
    }
  });

  it("opens a body-cell menu on its row, a header menu on its column, and retains an existing axis selection", () => {
    const grid = axes();
    const cell = cellSelectionAt(grid, 2, 1);
    const header = headerSelectionAt(grid, 2);
    expect(selectionForMenu(cell, grid)).toEqual(selectAxis(null, "rows", 2, false, grid));
    expect(selectionForMenu(header, grid)).toEqual(selectAxis(null, "columns", 2, false, grid));
    const rows = selectAxis(selectAxis(null, "rows", 0, false, grid), "rows", 2, true, grid);
    expect(selectionForMenu(rows, grid)).toEqual(rows);
  });

  it("returns null when a referenced stored ID is absent", () => {
    const grid = axes(["r1"], ["c1"]);
    expect(selectionAfterAdd({ kind: "cell", rowId: "stored:missing", columnId: "stored:c1" }, "rows", "r2", grid))
      .toBeNull();
    expect(selectionAfterAdd(null, "columns", "missing", grid)).toBeNull();
    expect(selectionAfterInsert("rows", "missing", grid)).toBeNull();
    expect(selectionForMenu({ kind: "cell", rowId: "stored:missing", columnId: "stored:c1" }, grid)).toBeNull();
    expect(selectionForMenu({ kind: "header", columnId: "stored:missing" }, grid)).toBeNull();
  });

  it("follows stored keys through reorder and clears removed, hidden, split or changed drawn selections", () => {
    const before = axes(["r1", "r2", "r3"], ["c1", "c2", "c3"]);
    const cell = cellSelectionAt(before, 0, 0);
    const reordered = axes(["r3", "r2", "r1"], ["c3", "c2", "c1"]);
    expect(reconcileSelection(cell, reordered, true)).toEqual(cellSelectionAt(reordered, 2, 2));
    expect(reconcileSelection(cell, axes(["r2", "r3"], ["c1", "c2", "c3"]), true)).toBeNull();
    expect(reconcileSelection(headerSelectionAt(before, 1), before, false)).toBeNull();

    const range = selectAxis(selectAxis(null, "rows", 0, false, before), "rows", 1, true, before);
    expect(reconcileSelection(range, axes(["r2", "r1", "r3"], ["c1", "c2", "c3"]), true)).toEqual({
      kind: "rows", ids: ["stored:r2", "stored:r1"], anchorId: "stored:r1", activeId: "stored:r2",
    });
    expect(reconcileSelection(range, axes(["r1", "r3", "r2"], ["c1", "c2", "c3"]), true)).toBeNull();

    const blank = axes([], []);
    const drawn = cellSelectionAt(blank, 2, 2);
    expect(reconcileSelection(drawn, axes([], []), false)).toEqual(drawn);
    expect(reconcileSelection(drawn, axes(["r1"], []), false)).toBeNull();
  });

  it("selects the specified cell after add, the new whole axis after insert, and the former position after delete", () => {
    const before = axes(["r1", "r2"], ["c1", "c2"]);
    const afterRow = axes(["r1", "r2", "r3"], ["c1", "c2"]);
    const afterColumn = axes(["r1", "r2"], ["c1", "c2", "c3"]);
    const cell = cellSelectionAt(before, 1, 1);
    expect(selectionAfterAdd(cell, "rows", "r3", afterRow)).toEqual(cellSelectionAt(afterRow, 2, 1));
    expect(selectionAfterAdd(null, "columns", "c3", afterColumn)).toEqual(cellSelectionAt(afterColumn, 0, 2));
    expect(selectionAfterInsert("rows", "r3", afterRow)).toEqual(selectAxis(null, "rows", 2, false, afterRow));
    expect(selectionAfterInsert("columns", "c3", afterColumn)).toEqual(selectAxis(null, "columns", 2, false, afterColumn));

    const fewerRows = axes(["r1", "r3"], ["c1", "c2"]);
    expect(selectionAfterDelete("rows", 1, fewerRows)).toEqual(selectAxis(null, "rows", 1, false, fewerRows));
    expect(selectionAfterDelete("rows", 3, fewerRows)).toEqual(selectAxis(null, "rows", 3, false, fewerRows));
    const shortenedLongAxis = axes(["r1", "r2", "r3", "r4"], ["c1", "c2"]);
    expect(selectionAfterDelete("rows", 4, shortenedLongAxis)).toEqual(selectAxis(null, "rows", 3, false, shortenedLongAxis));
  });
});

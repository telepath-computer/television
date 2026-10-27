/* Pure selection, navigation and reconciliation rules for the Table page. */

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(value, maximum));
}

function itemAt(items, index) {
  return Number.isInteger(index) && index >= 0 && index < items.length ? items[index] : undefined;
}

function indexOfId(items, id) {
  return items.findIndex(item => item.id === id);
}

/** Selects one body cell at a displayed position. */
export function cellSelectionAt(axes, rowIndex, columnIndex) {
  const row = itemAt(axes.rows, rowIndex);
  const column = itemAt(axes.columns, columnIndex);
  if (row === undefined || column === undefined) return null;
  return { kind: "cell", rowId: row.id, columnId: column.id };
}

/** Selects one header cell at a displayed column position. */
export function headerSelectionAt(axes, columnIndex) {
  const column = itemAt(axes.columns, columnIndex);
  return column === undefined ? null : { kind: "header", columnId: column.id };
}

function axisItems(axes, kind) {
  return kind === "rows" ? axes.rows : axes.columns;
}

function axisSelection(kind, items, anchorIndex, activeIndex) {
  const start = Math.min(anchorIndex, activeIndex);
  const end = Math.max(anchorIndex, activeIndex);
  return {
    kind,
    ids: items.slice(start, end + 1).map(item => item.id),
    anchorId: items[anchorIndex].id,
    activeId: items[activeIndex].id,
  };
}

/** Selects one axis item or extends an existing same-axis range from its anchor. */
export function selectAxis(selection, kind, index, extend, axes) {
  const items = axisItems(axes, kind);
  const targetIndex = clamp(index, 0, items.length - 1);
  if (items[targetIndex] === undefined) return null;
  const anchorIndex = extend && selection?.kind === kind ? indexOfId(items, selection.anchorId) : targetIndex;
  return axisSelection(kind, items, anchorIndex < 0 ? targetIndex : anchorIndex, targetIndex);
}

function unchanged(selection, exit = null) {
  return { selection, exit };
}

function moveAxisSelection(selection, command, axes, extend) {
  const items = axisItems(axes, selection.kind);
  if (command === "tab-forward") return unchanged(selection, "after");
  if (command === "tab-backward") return unchanged(selection, "before");
  const delta = selection.kind === "rows"
    ? command === "up" ? -1 : command === "down" ? 1 : 0
    : command === "left" ? -1 : command === "right" ? 1 : 0;
  if (delta === 0) return unchanged(selection);
  const baseId = extend ? selection.activeId : selection.anchorId;
  const baseIndex = indexOfId(items, baseId);
  if (baseIndex < 0) return unchanged(selection);
  const targetIndex = clamp(baseIndex + delta, 0, items.length - 1);
  return unchanged(selectAxis(extend ? selection : null, selection.kind, targetIndex, extend, axes));
}

function moveCellSelection(selection, command, axes, showHeader) {
  const rowIndex = selection.kind === "cell" ? indexOfId(axes.rows, selection.rowId) : -1;
  const columnIndex = indexOfId(axes.columns, selection.columnId);
  if (columnIndex < 0 || (selection.kind === "cell" && rowIndex < 0)) return unchanged(selection);
  if (command === "select-column") return unchanged(selectAxis(null, "columns", columnIndex, false, axes));
  if (command === "select-row") {
    return selection.kind === "cell" ? unchanged(selectAxis(null, "rows", rowIndex, false, axes)) : unchanged(selection);
  }

  if (command === "tab-forward" || command === "tab-backward") {
    const delta = command === "tab-forward" ? 1 : -1;
    const nextColumn = columnIndex + delta;
    if (nextColumn < 0) return unchanged(selection, "before");
    if (nextColumn >= axes.columns.length) return unchanged(selection, "after");
    return unchanged(selection.kind === "header"
      ? headerSelectionAt(axes, nextColumn) : cellSelectionAt(axes, rowIndex, nextColumn));
  }

  if (command === "left" || command === "right") {
    const nextColumn = clamp(columnIndex + (command === "left" ? -1 : 1), 0, axes.columns.length - 1);
    return unchanged(selection.kind === "header"
      ? headerSelectionAt(axes, nextColumn) : cellSelectionAt(axes, rowIndex, nextColumn));
  }
  if (command === "up") {
    if (selection.kind === "header") return unchanged(selection);
    if (rowIndex === 0 && showHeader) return unchanged(headerSelectionAt(axes, columnIndex));
    return unchanged(cellSelectionAt(axes, Math.max(0, rowIndex - 1), columnIndex));
  }
  if (command === "down") {
    if (selection.kind === "header") return unchanged(cellSelectionAt(axes, 0, columnIndex));
    return unchanged(cellSelectionAt(axes, Math.min(axes.rows.length - 1, rowIndex + 1), columnIndex));
  }
  return unchanged(selection);
}

/** Applies one keyboard selection command and reports when Tab should leave the table. */
export function moveSelection(selection, command, axes, options) {
  if (selection === null) {
    return ["left", "right", "up", "down"].includes(command)
      ? unchanged(cellSelectionAt(axes, 0, 0)) : unchanged(null);
  }
  if (selection.kind === "rows" || selection.kind === "columns") {
    return moveAxisSelection(selection, command, axes, options.extend === true);
  }
  return moveCellSelection(selection, command, axes, options.showHeader);
}

/** Returns the retained selection when entering the table, or selects its first body cell. */
export function enterTable(selection, axes) {
  return selection ?? cellSelectionAt(axes, 0, 0);
}

/** Resolves the row or column selection whose action menu should open. */
export function selectionForMenu(selection, axes) {
  if (selection?.kind === "rows" || selection?.kind === "columns") return selection;
  if (selection?.kind === "cell") {
    const index = indexOfId(axes.rows, selection.rowId);
    return index < 0 ? null : selectAxis(null, "rows", index, false, axes);
  }
  if (selection?.kind === "header") {
    const index = indexOfId(axes.columns, selection.columnId);
    return index < 0 ? null : selectAxis(null, "columns", index, false, axes);
  }
  return null;
}

function reconcileAxisSelection(selection, items) {
  const positions = selection.ids.map(id => indexOfId(items, id));
  if (positions.some(position => position < 0) || new Set(positions).size !== positions.length) return null;
  const sorted = [...positions].sort((left, right) => left - right);
  if (sorted.at(-1) - sorted[0] + 1 !== sorted.length) return null;
  if (indexOfId(items, selection.anchorId) < 0 || indexOfId(items, selection.activeId) < 0) return null;
  return { ...selection, ids: items.slice(sorted[0], sorted.at(-1) + 1).map(item => item.id) };
}

/** Follows selected identities through a new display snapshot, clearing any invalid selection. */
export function reconcileSelection(selection, axes, showHeader) {
  if (selection === null) return null;
  if (selection.kind === "cell") {
    return indexOfId(axes.rows, selection.rowId) < 0 || indexOfId(axes.columns, selection.columnId) < 0 ? null : selection;
  }
  if (selection.kind === "header") {
    return !showHeader || indexOfId(axes.columns, selection.columnId) < 0 ? null : selection;
  }
  return reconcileAxisSelection(selection, axisItems(axes, selection.kind));
}

/** Selects the new entry's body cell after an add-at-end action. */
export function selectionAfterAdd(previous, axis, newKey, axes) {
  const newId = `stored:${newKey}`;
  if (axis === "rows") {
    const rowIndex = indexOfId(axes.rows, newId);
    const columnIndex = previous?.kind === "cell" ? indexOfId(axes.columns, previous.columnId) : 0;
    return rowIndex < 0 || columnIndex < 0 ? null : cellSelectionAt(axes, rowIndex, columnIndex);
  }
  const columnIndex = indexOfId(axes.columns, newId);
  const rowIndex = previous?.kind === "cell" ? indexOfId(axes.rows, previous.rowId) : 0;
  return rowIndex < 0 || columnIndex < 0 ? null : cellSelectionAt(axes, rowIndex, columnIndex);
}

/** Selects the one new whole row or column after insertion. */
export function selectionAfterInsert(axis, newKey, axes) {
  const kind = axis;
  const index = indexOfId(axisItems(axes, kind), `stored:${newKey}`);
  return index < 0 ? null : selectAxis(null, kind, index, false, axes);
}

/** Selects the former position, or the new last position, after deletion. */
export function selectionAfterDelete(axis, formerIndex, axes) {
  const items = axisItems(axes, axis);
  return selectAxis(null, axis, Math.min(formerIndex, items.length - 1), false, axes);
}

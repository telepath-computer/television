/* Pure store, display, ordering and write-planning rules for the Table page. */

const MINIMUM_AXIS_SIZE = 4;
const AXIS_SIZES = {
  columns: { field: "width", defaultValue: 160, minimum: 64, maximum: 640 },
  rows: { field: "height", defaultValue: 38, minimum: 28, maximum: 240 },
};

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isDisplayedEntry(value) {
  return isObject(value) && Number.isFinite(value.order);
}

/** Orders keys the same way JSON store child events do. */
export function compareStoreKeys(left, right) {
  const leftIndex = /^(?:0|[1-9][0-9]*)$/.test(left);
  const rightIndex = /^(?:0|[1-9][0-9]*)$/.test(right);
  if (leftIndex !== rightIndex) return leftIndex ? -1 : 1;
  if (leftIndex && left.length !== right.length) return left.length - right.length;
  return left < right ? -1 : left > right ? 1 : 0;
}

function orderedEntries(axis) {
  return Object.entries(axis)
    .filter(([, entry]) => isDisplayedEntry(entry))
    .sort(([leftKey, left], [rightKey, right]) => left.order - right.order || compareStoreKeys(leftKey, rightKey));
}

function cellText(value) {
  if (typeof value === "string") return value === "" ? null : value;
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (typeof value === "boolean") return JSON.stringify(value);
  return null;
}

function clampSize(value, rules) {
  return Math.max(rules.minimum, Math.min(value, rules.maximum));
}

function clampedSize(value, rules) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return rules.defaultValue;
  return clampSize(value, rules);
}

/** Reads a store value into the tolerant display model, or returns null when the root is unreadable. */
export function readTable(value) {
  const root = value === undefined ? {} : value;
  if (!isObject(root)) return null;
  if (Object.hasOwn(root, "columns") && !isObject(root.columns)) return null;
  if (Object.hasOwn(root, "rows") && !isObject(root.rows)) return null;

  const columnAxis = root.columns ?? {};
  const rowAxis = root.rows ?? {};
  const columns = orderedEntries(columnAxis).map(([key, column]) => ({
    key,
    order: column.order,
    width: clampedSize(column.width, AXIS_SIZES.columns),
  }));
  const displayedColumnKeys = new Set(columns.map(column => column.key));
  const rows = orderedEntries(rowAxis).map(([key, row]) => {
    const sourceCells = isObject(row.cells) ? row.cells : {};
    const cells = Object.fromEntries(Object.entries(sourceCells).flatMap(([columnKey, value]) => {
      const text = cellText(value);
      return displayedColumnKeys.has(columnKey) && text !== null ? [[columnKey, text]] : [];
    }));
    return { key, order: row.order, height: clampedSize(row.height, AXIS_SIZES.rows), cells };
  });
  return { columns, rows, headerRow: root.headerRow === true };
}

/** Adds stable stored identities and enough count-based drawn identities to reach four positions. */
export function displayAxis(entries) {
  const stored = entries.map(entry => ({ ...entry, kind: "stored", id: `stored:${entry.key}` }));
  const count = stored.length;
  const drawn = Array.from({ length: Math.max(0, MINIMUM_AXIS_SIZE - count) }, (_, offset) => {
    const index = count + offset;
    return { kind: "drawn", id: `drawn:${count}:${index}`, index };
  });
  return [...stored, ...drawn];
}

function selectedBounds(entries, selectedKeys) {
  if (selectedKeys.length === 0) return entries.length === 0 ? { start: 0, end: -1 } : null;
  const positions = selectedKeys.map(key => entries.findIndex(([entryKey]) => entryKey === key));
  if (positions.some(position => position < 0) || new Set(positions).size !== positions.length) return null;
  positions.sort((left, right) => left - right);
  if (positions.at(-1) - positions[0] + 1 !== positions.length) return null;
  return { start: positions[0], end: positions.at(-1) };
}

function strictOrder(before, after) {
  if (before === undefined && after === undefined) return 0;
  const sum = before + after;
  let candidate = before === undefined ? after - 1
    : after === undefined ? before + 1
      : Number.isFinite(sum) ? sum / 2 : before / 2 + after / 2;
  if (before === undefined && !(candidate < after)) {
    candidate = after > 0 ? after / 2 : after / 2 - Number.MAX_VALUE / 2;
  } else if (after === undefined && !(candidate > before)) {
    candidate = before < 0 ? before / 2 : before / 2 + Number.MAX_VALUE / 2;
  }
  return Number.isFinite(candidate)
    && (before === undefined || candidate > before)
    && (after === undefined || candidate < after) ? candidate : null;
}

/** Chooses a strict order beside a contiguous stored selection, or null when the axis needs renumbering. */
export function insertionOrder(entries, selectedKeys, side) {
  const ordered = [...entries].sort((left, right) => left.order - right.order || compareStoreKeys(left.key, right.key));
  const pairs = ordered.map(entry => [entry.key, entry]);
  const bounds = selectedBounds(pairs, selectedKeys);
  if (bounds === null) return undefined;
  const index = side === "before" ? bounds.start : bounds.end + 1;
  return strictOrder(ordered[index - 1]?.order, ordered[index]?.order);
}

/** Chooses consecutive strict orders after an axis, or null when its end must be renumbered. */
export function ordersAtEnd(entries, count) {
  if (count === 0) return [];
  const ordered = [...entries].sort((left, right) => left.order - right.order || compareStoreKeys(left.key, right.key));
  const result = [];
  let previous = ordered.at(-1)?.order;
  for (let index = 0; index < count; index += 1) {
    const next = strictOrder(previous, undefined);
    if (next === null) return null;
    result.push(next);
    previous = next;
  }
  return result;
}

/** Creates a retry-safe callback that inserts or appends entries while renumbering one current axis. */
export function createAxisRenumberUpdate(request) {
  return (current) => {
    const axis = current === undefined ? {} : current;
    if (!isObject(axis)) return undefined;
    if (request.entries.some(entry => Object.hasOwn(axis, entry.key))) return undefined;
    const displayed = orderedEntries(axis);
    let insertionIndex = displayed.length;
    if (request.mode === "insert") {
      const bounds = selectedBounds(displayed, request.selectedKeys);
      if (bounds === null) return undefined;
      insertionIndex = request.side === "before" ? bounds.start : bounds.end + 1;
    }

    const sequence = [...displayed];
    sequence.splice(insertionIndex, 0, ...request.entries.map(entry => [entry.key, entry.value]));
    const result = { ...axis };
    for (const [order, [key, entry]] of sequence.entries()) result[key] = { ...entry, order };
    return result;
  };
}

function planningState(value) {
  const model = readTable(value);
  if (model === null) return null;
  const root = value === undefined ? {} : value;
  return {
    model,
    rows: isObject(root.rows) ? root.rows : {},
  };
}

function set(path, value) {
  return { kind: "set", path, value };
}

function remove(path) {
  return { kind: "remove", path };
}

function operations(operations) {
  return { kind: "operations", operations };
}

function noWrite(reason) {
  return { kind: "no-write", reason };
}

function renumber(axis, request, extraOperations = []) {
  return { kind: "renumber", axis, request, operations: extraOperations };
}

function newAxisEntries(axis, entries, keys, additions = {}) {
  const values = keys.map(key => ({
    key,
    value: axis === "rows" ? { cells: {}, ...additions[key] } : { ...additions[key] },
  }));
  const orders = ordersAtEnd(entries, keys.length);
  if (orders === null) return { kind: "renumber", request: { mode: "append", entries: values } };
  return {
    kind: "ordered",
    entries: values.map((entry, index) => ({
      key: entry.key,
      value: { order: orders[index], ...entry.value },
    })),
  };
}

function neededKeys(supplied, count) {
  if (count === 0) return [];
  return Array.isArray(supplied) && supplied.length >= count ? supplied.slice(0, count) : null;
}

/** Plans a cell commit; null text means that editing was cancelled. */
export function planCellCommit(value, target, openedText, text, keys) {
  if (text === null) return noWrite("cancelled");
  if (text === openedText) return noWrite("unchanged");
  const state = planningState(value);
  if (state === null) return noWrite("unreadable");
  const columns = displayAxis(state.model.columns);
  const rows = displayAxis(state.model.rows);
  const column = columns[target.columnIndex];
  const row = rows[target.rowIndex];
  if (column === undefined || row === undefined) return noWrite("invalid-target");
  const empty = text.trim() === "";
  if (empty) {
    if (column.kind === "drawn" || row.kind === "drawn") return noWrite("empty-drawn");
    if (openedText === "") return noWrite("unchanged");
    return operations([remove(["rows", row.key, "cells", column.key])]);
  }

  const columnCount = column.kind === "drawn" ? target.columnIndex - state.model.columns.length + 1 : 0;
  const rowCount = row.kind === "drawn" ? target.rowIndex - state.model.rows.length + 1 : 0;
  const columnKeys = neededKeys(keys.columns, columnCount);
  const rowKeys = neededKeys(keys.rows, rowCount);
  if (columnKeys === null || rowKeys === null) return noWrite("missing-keys");
  if (new Set(columnKeys).size !== columnKeys.length || new Set(rowKeys).size !== rowKeys.length) {
    return noWrite("invalid-keys");
  }
  const columnKey = column.kind === "stored" ? column.key : columnKeys.at(-1);
  const rowKey = row.kind === "stored" ? row.key : rowKeys.at(-1);
  const addedColumns = newAxisEntries("columns", state.model.columns, columnKeys);
  const addedRows = newAxisEntries("rows", state.model.rows, rowKeys, row.kind === "drawn"
    ? { [rowKey]: { cells: { [columnKey]: text } } } : {});
  const writes = [];
  if (addedColumns.kind === "ordered") {
    writes.push(...addedColumns.entries.map(entry => set(["columns", entry.key], entry.value)));
  }
  if (addedRows.kind === "ordered") {
    writes.push(...addedRows.entries.map(entry => set(["rows", entry.key], entry.value)));
  }
  if (row.kind === "stored") writes.push(set(["rows", rowKey, "cells", columnKey], text));

  if (addedRows.kind === "renumber") {
    if (addedColumns.kind === "renumber") return noWrite("multiple-renumbering-required");
    return renumber("rows", addedRows.request, writes);
  }
  if (addedColumns.kind === "renumber") return renumber("columns", addedColumns.request, writes);
  return operations(writes);
}

/** Plans showing or hiding the header row. */
export function planSetHeader(headerRow) {
  return operations([set(["headerRow"], headerRow)]);
}

/** Plans one stored or drawn row-height or column-width change. */
export function planResize(value, axis, targetIndex, openedSize, committedSize, keys) {
  const rules = AXIS_SIZES[axis];
  if (!Number.isFinite(committedSize)) return noWrite("invalid-size");
  const size = clampSize(committedSize, rules);
  if (size === openedSize) return noWrite("unchanged");
  const state = planningState(value);
  if (state === null) return noWrite("unreadable");
  const entries = state.model[axis];
  const target = displayAxis(entries)[targetIndex];
  if (target === undefined) return noWrite("invalid-target");
  if (target.kind === "stored") return operations([set([axis, target.key, rules.field], size)]);

  const count = targetIndex - entries.length + 1;
  const suppliedKeys = neededKeys(keys[axis], count);
  if (suppliedKeys === null) return noWrite("missing-keys");
  if (new Set(suppliedKeys).size !== suppliedKeys.length) return noWrite("invalid-keys");
  const targetKey = suppliedKeys.at(-1);
  const added = newAxisEntries(axis, entries, suppliedKeys, { [targetKey]: { [rules.field]: size } });
  if (added.kind === "renumber") return renumber(axis, added.request);
  return operations(added.entries.map(entry => set([axis, entry.key], entry.value)));
}

/** Plans adding one row or column after storing every drawn position on that axis. */
export function planAdd(value, axis, keys) {
  const state = planningState(value);
  if (state === null) return noWrite("unreadable");
  const entries = state.model[axis];
  const count = Math.max(0, MINIMUM_AXIS_SIZE - entries.length) + 1;
  const selectedKeys = neededKeys(keys, count);
  if (selectedKeys === null) return noWrite("missing-keys");
  if (new Set(selectedKeys).size !== selectedKeys.length) return noWrite("invalid-keys");
  const added = newAxisEntries(axis, entries, selectedKeys);
  if (added.kind === "renumber") return renumber(axis, added.request);
  return operations(added.entries.map(entry => set([axis, entry.key], entry.value)));
}

/** Plans inserting one row or column and only the drawn positions before it. */
export function planInsert(value, axis, selection, side, keys) {
  const state = planningState(value);
  if (state === null) return noWrite("unreadable");
  const entries = state.model[axis];
  const displayed = displayAxis(entries);
  if (selection.start < 0 || selection.end < selection.start || selection.end >= displayed.length) {
    return noWrite("invalid-selection");
  }
  const insertionIndex = side === "before" ? selection.start : selection.end + 1;
  const drawnBefore = Math.max(0, insertionIndex - entries.length);
  const selectedKeys = neededKeys(keys, drawnBefore + 1);
  if (selectedKeys === null) return noWrite("missing-keys");
  if (new Set(selectedKeys).size !== selectedKeys.length) return noWrite("invalid-keys");
  const drawnKeys = selectedKeys.slice(0, drawnBefore);
  const newKey = selectedKeys.at(-1);
  const storedSelectionKeys = displayed.slice(selection.start, selection.end + 1)
    .filter(item => item.kind === "stored").map(item => item.key);

  if (insertionIndex >= entries.length) {
    const added = newAxisEntries(axis, entries, [...drawnKeys, newKey]);
    if (added.kind === "renumber") {
      return renumber(axis, storedSelectionKeys.length === 0 ? added.request : {
        mode: "insert",
        selectedKeys: storedSelectionKeys,
        side,
        entries: added.request.entries,
      });
    }
    return operations(added.entries.map(entry => set([axis, entry.key], entry.value)));
  }

  const order = insertionOrder(entries, storedSelectionKeys, side);
  if (order === undefined) return noWrite("invalid-selection");
  if (order === null) {
    const valueForEntry = axis === "rows" ? { cells: {} } : {};
    return renumber(axis, {
      mode: "insert",
      selectedKeys: storedSelectionKeys,
      side,
      entries: [{ key: newKey, value: valueForEntry }],
    });
  }
  const valueForEntry = axis === "rows" ? { order, cells: {} } : { order };
  return operations([set([axis, newKey], valueForEntry)]);
}

/** Plans removing the stored entries in a displayed row or column range. */
export function planDelete(value, axis, selection) {
  const state = planningState(value);
  if (state === null) return noWrite("unreadable");
  const displayed = displayAxis(state.model[axis]);
  if (selection.start < 0 || selection.end < selection.start || selection.end >= displayed.length) {
    return noWrite("invalid-selection");
  }
  const writes = displayed.slice(selection.start, selection.end + 1)
    .filter(item => item.kind === "stored")
    .map(item => remove([axis, item.key]));
  return writes.length === 0 ? noWrite("nothing-to-delete") : operations(writes);
}

function nonEmptyCell(state, rowKey, columnKey) {
  const cells = state.rows[rowKey]?.cells;
  return isObject(cells) && Object.hasOwn(cells, columnKey) && cellText(cells[columnKey]) !== null;
}

/** Plans clearing selected non-empty cells without removing structure. */
export function planClear(value, selection) {
  const state = planningState(value);
  if (state === null) return noWrite("unreadable");
  const rows = displayAxis(state.model.rows);
  const columns = displayAxis(state.model.columns);
  if (selection.kind === "cell"
    && (rows[selection.rowIndex] === undefined || columns[selection.columnIndex] === undefined)) {
    return noWrite("invalid-target");
  }
  if (selection.kind === "rows" || selection.kind === "columns") {
    const axis = selection.kind === "rows" ? rows : columns;
    if (selection.start < 0 || selection.end < selection.start || selection.end >= axis.length) {
      return noWrite("invalid-selection");
    }
  }

  const selectedRows = selection.kind === "cell" ? rows.slice(selection.rowIndex, selection.rowIndex + 1)
    : selection.kind === "rows" ? rows.slice(selection.start, selection.end + 1) : rows;
  const selectedColumns = selection.kind === "cell" ? columns.slice(selection.columnIndex, selection.columnIndex + 1)
    : selection.kind === "columns" ? columns.slice(selection.start, selection.end + 1) : columns;
  const writes = [];
  for (const row of selectedRows) {
    if (row.kind !== "stored") continue;
    for (const column of selectedColumns) {
      if (column.kind === "stored" && nonEmptyCell(state, row.key, column.key)) {
        writes.push(remove(["rows", row.key, "cells", column.key]));
      }
    }
  }
  return writes.length === 0 ? noWrite("nothing-to-clear") : operations(writes);
}

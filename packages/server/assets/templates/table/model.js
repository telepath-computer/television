/** Whether a value is an ordinary object rather than a list or null. */
function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Validates the complete root without changing it. */
export function isTableData(value) {
  return isObject(value) && isObject(value.rows)
    && Object.values(value.rows).every(row => isObject(row) && Number.isFinite(row.order));
}

/** Rows in stored order, each with its stable key and visible cells. */
export function orderedRows(value) {
  if (!isTableData(value)) return undefined;
  return Object.entries(value.rows)
    .map(([key, { order, ...cells }]) => ({ key, order, cells }))
    .sort((left, right) => left.order - right.order || left.key.localeCompare(right.key));
}

/** Reads only stored cells, never similarly named properties from Object.prototype. */
export function cellValue(cells, key) {
  return Object.hasOwn(cells, key) ? cells[key] : undefined;
}

/** Every cell key in first-seen order, with the presentation facts the page needs. */
export function columnsOf(rows) {
  const keys = [];
  for (const row of rows) {
    for (const key of Object.keys(row.cells)) if (!keys.includes(key)) keys.push(key);
  }
  return keys.map(key => {
    const values = rows.map(row => cellValue(row.cells, key)).filter(value => value !== undefined && value !== null && value !== "");
    return {
      key,
      numeric: values.length > 0 && values.every(value => typeof value === "number"),
      long: values.some(value => typeof value === "string" && value.length > 40),
    };
  });
}

export function textOf(value) {
  return typeof value === "object" && value !== null ? JSON.stringify(value) : String(value);
}

function empty(value) {
  return value === undefined || value === null || value === "";
}

/** The current Table comparison: numeric pairs as numbers, everything else as natural text. */
export function compareValues(left, right) {
  if (empty(left) || empty(right)) return Number(empty(left)) - Number(empty(right));
  if (typeof left === "number" && typeof right === "number") return left - right;
  return textOf(left).localeCompare(textOf(right), undefined, { numeric: true, sensitivity: "base" });
}

/** Applies page-only search and column sorting without changing the stored rows. */
export function visibleRows(rows, state) {
  let visible = rows.map(({ key, cells }) => ({ key, row: cells }));
  const query = state.filter.trim().toLowerCase();
  if (query) {
    visible = visible.filter(({ row }) => Object.values(row)
      .some(value => value != null && textOf(value).toLowerCase().includes(query)));
  }
  if (state.sort) {
    const { column, direction } = state.sort;
    const sign = direction === "descending" ? -1 : 1;
    visible = [...visible].sort((left, right) => {
      const leftValue = cellValue(left.row, column);
      const rightValue = cellValue(right.row, column);
      const compared = compareValues(leftValue, rightValue);
      return empty(leftValue) || empty(rightValue) ? compared : sign * compared;
    });
  }
  return visible;
}

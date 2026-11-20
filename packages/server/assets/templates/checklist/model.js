function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function isItemMap(value) {
  return isObject(value) && Object.values(value).every((item) =>
    isObject(item) && typeof item.text === "string" && typeof item.done === "boolean"
    && typeof item.order === "number" && Number.isFinite(item.order));
}

export function isChecklistData(value) {
  return isObject(value) && typeof value.title === "string" && isItemMap(value.items);
}

export function compareItemKeys(left, right) {
  const leftIndex = /^(?:0|[1-9][0-9]*)$/.test(left);
  const rightIndex = /^(?:0|[1-9][0-9]*)$/.test(right);
  if (leftIndex !== rightIndex) return leftIndex ? -1 : 1;
  if (leftIndex && left.length !== right.length) return left.length - right.length;
  return left < right ? -1 : left > right ? 1 : 0;
}

export function orderedItems(items) {
  return Object.entries(items).sort(([leftKey, left], [rightKey, right]) =>
    left.order - right.order || compareItemKeys(leftKey, rightKey));
}

function insertionIndex(entries, afterKey) {
  if (afterKey === null) return 0;
  const predecessor = entries.findIndex(([key]) => key === afterKey);
  return predecessor < 0 ? entries.length : predecessor + 1;
}

export function insertionOrder(items, afterKey) {
  const entries = orderedItems(items);
  if (entries.length === 0) return 0;
  const index = insertionIndex(entries, afterKey);
  const before = entries[index - 1]?.[1].order;
  const after = entries[index]?.[1].order;
  const sum = before + after;
  // Preserve subnormal midpoints; split only when adding the neighbours overflows.
  const order = before === undefined ? after - 1
    : after === undefined ? before + 1 : Number.isFinite(sum) ? sum / 2 : before / 2 + after / 2;
  return Number.isFinite(order) && (before === undefined || order > before)
    && (after === undefined || order < after) ? order : null;
}

export function createRenumberUpdate(newKey, newItem, afterKey) {
  return (current) => {
    if (!isItemMap(current)) return undefined;
    const entries = orderedItems(current).filter(([key]) => key !== newKey);
    const inserted = Object.hasOwn(current, newKey) ? current[newKey] : newItem;
    entries.splice(insertionIndex(entries, afterKey), 0, [newKey, inserted]);
    return Object.fromEntries(entries.map(([key, item], order) => [key, { ...item, order }]));
  };
}

export function isCompletionShortcut(event, platform) {
  return event.key === "Enter" && (platform.startsWith("Mac") ? event.metaKey : event.ctrlKey);
}

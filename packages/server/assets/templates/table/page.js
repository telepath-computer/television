/** Editable Table page: renders tolerant store state and scopes interactive writes. */
import {
  deleteValue, getAccess, getConnectionStatus, getStore, onAccessChanged,
  onConnectionStatusChanged, onValue, push, ref, remove, runTransaction, set, update,
} from "/sdk/v1/resources.js";
import {
  AXIS_SIZES, MINIMUM_AXIS_SIZE, createAxisRenumberUpdate, displayAxis, planAdd,
  planCellCommit, planClear, planDelete, planInsert, planResize, planSetHeader, readTable,
} from "./model.js";
import {
  cellSelectionAt, enterTable, moveSelection, reconcileSelection,
  selectAxis, selectionAfterAdd, selectionAfterDelete, selectionAfterInsert, selectionForMenu,
} from "./selection-model.js";

const main = document.querySelector(".table-page");
const statusRegion = main.querySelector(".table-status");
const resizeAnnouncement = main.querySelector(".table-resize-announcement");
const store = getStore();
const root = ref(store);
const KEYBOARD_RESIZE_STEP = 8;

let value;
let model;
let received = false;
let unavailable = false;
let access = null;
let accessKnown = false;
let connection = getConnectionStatus();
let unsubscribe = null;
let selection = null;
let editing = null;
let menu = null;
let resizing = null;
let failure = false;
let failureAfterReconnect = false;
let failureTimer;
let suppressGridEntry = false;
// A pointer press outside the editor lets the click handler choose what follows
// the commit instead of the editor focusout handler choosing first.
let pointerMovedFocus = false;
let rendering = false;
let interactionVersion = 0;
let menuObserver = null;
let renderedAxes = { columns: displayAxis([]), rows: displayAxis([]) };
let pageActionSelection = null;
let gridEntryScrollPosition = { left: 0, top: 0 };

const rejectedNoWriteReasons = new Set([
  "unreadable", "invalid-target", "invalid-selection", "missing-keys", "invalid-keys",
  "multiple-renumbering-required",
]);

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);
}

function shownText(text) {
  return text.replace(/\r\n|[\r\n]/g, " ");
}

function columnLetter(index) {
  let label = "";
  let value = index + 1;
  while (value > 0) {
    value -= 1;
    label = String.fromCharCode(65 + value % 26) + label;
    value = Math.floor(value / 26);
  }
  return label;
}

function canWrite() {
  return received && !unavailable && model !== null && access === "read-write" && connection === "connected";
}

function buildAxes() {
  return {
    columns: displayAxis(model?.columns ?? []),
    rows: displayAxis(model?.rows ?? []),
  };
}

function axes() {
  return renderedAxes;
}

function indexOf(items, id) {
  return items.findIndex(item => item.id === id);
}

function axisRange(kind, selected = selection) {
  if (selected?.kind !== kind) return null;
  const items = axes()[kind];
  const positions = selected.ids.map(id => indexOf(items, id)).sort((left, right) => left - right);
  return positions.some(position => position < 0) ? null : { start: positions[0], end: positions.at(-1) };
}

function selectedCellPosition(selected = selection) {
  if (selected?.kind !== "cell") return null;
  const displayed = axes();
  const rowIndex = indexOf(displayed.rows, selected.rowId);
  const columnIndex = indexOf(displayed.columns, selected.columnId);
  return rowIndex < 0 || columnIndex < 0 ? null : { rowIndex, columnIndex };
}

function rowSelected(rowIndex) {
  return selection?.kind === "rows" && selection.ids.includes(axes().rows[rowIndex]?.id);
}

function columnSelected(columnIndex) {
  return selection?.kind === "columns" && selection.ids.includes(axes().columns[columnIndex]?.id);
}

function cellSelectionKind(rowIndex, columnIndex) {
  const position = selectedCellPosition();
  if (position?.rowIndex === rowIndex && position.columnIndex === columnIndex) return "cell";
  if (rowSelected(rowIndex) || columnSelected(columnIndex)) return "range";
  return "none";
}

function referenceEmphasis(axis, index) {
  if (axis === "rows" && rowSelected(index) || axis === "columns" && columnSelected(index)) return "selected";
  const cell = selectedCellPosition();
  if (axis === "rows" && cell?.rowIndex === index || axis === "columns" && cell?.columnIndex === index) return "related";
  return "none";
}

function menuTrigger(kind, index) {
  return menu?.kind === kind && menu.triggerId === axes()[kind][index]?.id;
}

function referenceButton(kind, index) {
  const isRows = kind === "rows";
  const selected = isRows ? rowSelected(index) : columnSelected(index);
  const label = isRows ? `Select row ${index + 1}` : `Select column ${columnLetter(index)}`;
  const anchorId = selection?.kind === kind ? selection.anchorId : null;
  const item = axes()[kind][index];
  const size = displayedSize(kind, index);
  const axisName = isRows ? "row" : "column";
  const dimension = isRows ? "tall" : "wide";
  const description = `${size} pixels ${dimension}.${canWrite() ? " Select this " + axisName + ", then use plus or minus to resize." : ""}`;
  const style = isRows ? `--table-current-row-height: ${size}px` : `width: ${size}px`;
  return `<div class="table-${axisName}-reference-item" style="${style}">
    <button type="button" class="table-reference-item" id="table-${axisName}-reference-${index + 1}"
      data-${isRows ? "row" : "column"}-select data-${isRows ? "row" : "column"}-index="${index}"
      data-emphasis="${referenceEmphasis(kind, index)}"
      aria-label="${label}" aria-haspopup="${canWrite() ? "menu" : "false"}" aria-pressed="${selected}"
      aria-description="${description}" ${canWrite() ? `aria-expanded="${menuTrigger(kind, index)}"` : ""}
      tabindex="${anchorId === item?.id ? 0 : -1}">${isRows ? index + 1 : columnLetter(index)}</button>
    ${canWrite() ? `<span class="table-${axisName}-resize-handle" aria-hidden="true"></span>` : ""}
  </div>`;
}

function displayedSize(kind, index) {
  const item = axes()[kind][index];
  if (resizing?.axis === kind && resizing.targetId === item?.id) return resizing.previewSize;
  const rules = AXIS_SIZES[kind];
  return item?.[rules.field] ?? rules.defaultValue;
}

function bodyCellText(rowIndex, columnKey) {
  const cells = model.rows[rowIndex]?.cells;
  return cells && Object.hasOwn(cells, columnKey) ? cells[columnKey] : "";
}

function bodyCell(row, column, rowIndex, columnIndex) {
  const selected = cellSelectionKind(rowIndex, columnIndex);
  const text = row.kind === "stored" && column.kind === "stored"
    ? bodyCellText(rowIndex, column.key) : "";
  const isEditing = editing?.kind === "cell" && editing.rowIndex === rowIndex && editing.columnIndex === columnIndex
    && editing.rowId === row.id && editing.columnId === column.id;
  const content = isEditing
    ? `<textarea class="table-input table-cell-input" rows="1" aria-label="Row ${rowIndex + 1}, column ${columnLetter(columnIndex)}" spellcheck="false">${escapeHtml(editing.text)}</textarea>`
    : `<span>${escapeHtml(shownText(text))}</span>`;
  const isHeader = model.headerRow && rowIndex === 0;
  return `<td class="table-cell" role="${isHeader ? "columnheader" : "gridcell"}" data-header="${isHeader}" data-cell data-row-index="${rowIndex}" data-column-index="${columnIndex}"
    ${row.kind === "stored" ? `data-row-key="${escapeHtml(row.key)}"` : ""}
    ${column.kind === "stored" ? `data-column-key="${escapeHtml(column.key)}"` : ""}
    data-selection="${selected}" aria-selected="${selected !== "none"}" aria-colindex="${columnIndex + 1}"
    tabindex="${selected === "cell" && !isEditing ? 0 : -1}">${content}</td>`;
}

function contextMenu() {
  if (!menu || (selection?.kind !== "rows" && selection?.kind !== "columns") || !canWrite()) return "";
  const isRows = selection.kind === "rows";
  const range = axisRange(selection.kind);
  const items = axes()[selection.kind].slice(range?.start ?? 0, (range?.end ?? -1) + 1);
  const storedCount = items.filter(item => item.kind === "stored").length;
  const noun = isRows ? "row" : "column";
  const before = isRows ? "above" : "left";
  const after = isRows ? "below" : "right";
  const trigger = `table-${noun}-reference-${menu.index + 1}`;
  const headerAction = isRows && menu.index === 0
    ? `<hr><tv-menu-item role="menuitem" data-menu-action="toggle-header"><span>${model.headerRow ? "Remove" : "Make"} header row</span></tv-menu-item>` : "";
  return `<tv-menu class="table-context-menu table-${noun}-context-menu" trigger="${trigger}" open role="menu" aria-label="${isRows ? "Row" : "Column"} actions">
    <tv-menu-item role="menuitem" data-menu-action="insert-before"><span>Insert ${noun} ${before}</span></tv-menu-item>
    <tv-menu-item role="menuitem" data-menu-action="insert-after"><span>Insert ${noun} ${after}</span></tv-menu-item>
    ${storedCount ? `<tv-menu-item role="menuitem" data-menu-action="delete" intent="danger"><span>Delete ${noun}${storedCount === 1 ? "" : "s"}</span></tv-menu-item>` : ""}
    ${headerAction}
  </tv-menu>`;
}

function selectionTarget() {
  if (selection?.kind === "cell") {
    const position = selectedCellPosition();
    return position && main.querySelector(`[data-cell][data-row-index="${position.rowIndex}"][data-column-index="${position.columnIndex}"]`);
  }
  if (selection?.kind === "rows" || selection?.kind === "columns") {
    const index = indexOf(axes()[selection.kind], selection.anchorId);
    return main.querySelector(`[data-${selection.kind === "rows" ? "row" : "column"}-index="${index}"]`);
  }
  return null;
}

function selectionAtSamePosition(selected, sourceAxes, targetAxes) {
  if (selected?.kind === "cell") {
    return cellSelectionAt(targetAxes, indexOf(sourceAxes.rows, selected.rowId), indexOf(sourceAxes.columns, selected.columnId));
  }
  if (selected?.kind === "rows" || selected?.kind === "columns") {
    const sourceItems = sourceAxes[selected.kind];
    const anchorIndex = indexOf(sourceItems, selected.anchorId);
    const activeIndex = indexOf(sourceItems, selected.activeId);
    if (anchorIndex < 0 || activeIndex < 0) return null;
    const anchor = selectAxis(null, selected.kind, anchorIndex, false, targetAxes);
    return anchor && selectAxis(anchor, selected.kind, activeIndex, true, targetAxes);
  }
  return null;
}

function replaceContents(markup) {
  menuObserver?.disconnect();
  menuObserver = null;
  rendering = true;
  for (const child of [...main.children]) {
    if (child !== statusRegion && child !== resizeAnnouncement) child.remove();
  }
  statusRegion.insertAdjacentHTML("beforebegin", markup);
  rendering = false;
  const menuElement = main.querySelector("tv-menu");
  if (!menuElement) return;
  menuObserver = new MutationObserver(() => {
    if (!menuElement.isConnected || menuElement.hasAttribute("open")) return;
    menuObserver?.disconnect();
    menuObserver = null;
    if (menu === null) return;
    menu = null;
    render("selection");
  });
  menuObserver.observe(menuElement, { attributes: true, attributeFilter: ["open"] });
}

function keepClearOfFrozenAreas(target) {
  const scroll = main.querySelector(".table-scroll");
  if (!(scroll instanceof HTMLElement) || !(target instanceof HTMLElement)) return;
  const scrollBox = scroll.getBoundingClientRect();
  const targetBox = target.getBoundingClientRect();
  const columnStripBox = main.querySelector(".table-column-strip")?.getBoundingClientRect();
  const rowStripBox = main.querySelector(".table-row-strip")?.getBoundingClientRect();
  const sheet = main.querySelector(".table-sheet");
  const sheetStyle = sheet instanceof HTMLElement ? getComputedStyle(sheet) : null;
  const columnGap = Number.parseFloat(sheetStyle?.columnGap ?? "0");
  const rowGap = Number.parseFloat(sheetStyle?.rowGap ?? "0");
  const headerBox = model?.headerRow && !target.closest('[data-row-index="0"]')
    ? main.querySelector('[data-cell][data-row-index="0"]')?.getBoundingClientRect() : null;
  const minimumX = (rowStripBox?.right ?? scrollBox.left) + columnGap;
  const minimumY = Math.max(
    (columnStripBox?.bottom ?? scrollBox.top) + rowGap,
    headerBox?.bottom ?? scrollBox.top,
  );
  let left = 0;
  let top = 0;
  if (!target.closest(".table-row-strip") && targetBox.left < minimumX) left = targetBox.left - minimumX;
  else if (targetBox.right > scrollBox.right) left = targetBox.right - scrollBox.right;
  if (!target.closest(".table-column-strip") && targetBox.top < minimumY) top = targetBox.top - minimumY;
  else if (targetBox.bottom > scrollBox.bottom) top = targetBox.bottom - scrollBox.bottom;
  if (left !== 0 || top !== 0) scroll.scrollBy({ left, top });
}

// "none" preserves existing focus, "leave" preserves none, and the other
// modes focus the named control after render replaces the page contents.
function render(focus = "none", nextAxes = buildAxes()) {
  const previousSelectionTarget = selectionTarget();
  const selectionFocused = previousSelectionTarget !== null && document.activeElement === previousSelectionTarget;
  const gridFocused = document.activeElement === main.querySelector(".table-grid");
  const focusedMenuItem = document.activeElement?.closest?.("tv-menu-item");
  const focusedMenuIndex = focusedMenuItem ? [...main.querySelectorAll("tv-menu-item")].indexOf(focusedMenuItem) : -1;
  const tableControlFocused = document.activeElement instanceof Element
    && Boolean(document.activeElement.closest(".table-grid, .table-reference-strip, tv-menu"));
  renderedAxes = nextAxes;
  const scroll = main.querySelector(".table-scroll");
  const scrollPosition = scroll ? { left: scroll.scrollLeft, top: scroll.scrollTop } : null;
  const previousEditor = main.querySelector(".table-input");
  const editorState = previousEditor instanceof HTMLTextAreaElement ? {
    focused: document.activeElement === previousEditor,
    start: previousEditor.selectionStart,
    end: previousEditor.selectionEnd,
    direction: previousEditor.selectionDirection,
  } : null;
  if (unavailable || received && model === null) {
    main.dataset.editable = "false";
    replaceContents(`<section class="table-unreadable" role="alert">
      <span class="table-unreadable-icon"><tv-icon name="warning" size="xl"></tv-icon></span>
      <h1 class="table-unreadable-title">This table can't be shown</h1>
      <p class="table-unreadable-text">Television can't read the saved table data. Ask your agent to check the data and access.</p>
    </section>`);
    renderStatus();
    return;
  }
  if (!received) {
    main.dataset.editable = "false";
    replaceContents(`<div class="table-loading" role="status" aria-label="Loading table"><tv-icon name="spinner" size="md" spinning></tv-icon></div>`);
    renderStatus();
    return;
  }

  const displayed = nextAxes;
  const editable = canWrite();
  main.dataset.editable = String(editable);
  main.dataset.headerRow = String(model.headerRow);
  const columnWidths = displayed.columns.map((_, index) => displayedSize("columns", index));
  const gridWidth = columnWidths.reduce((sum, width) => sum + width, 0);
  const rowNumberDigits = String(displayed.rows.length).length;
  const body = displayed.rows.map((row, rowIndex) => `<tr aria-rowindex="${rowIndex + 1}" style="--table-current-row-height: ${displayedSize("rows", rowIndex)}px">
    ${displayed.columns.map((column, columnIndex) => bodyCell(row, column, rowIndex, columnIndex)).join("")}</tr>`).join("");
  replaceContents(`<div class="table-frame">
    <div class="table-scroll"><div class="table-sheet" style="--table-grid-width: ${gridWidth}px; --table-row-reference-digits: ${rowNumberDigits}">
      <div class="table-reference-corner" aria-hidden="true"></div>
      <div class="table-column-strip table-reference-strip" role="group" aria-label="Column references">
        ${displayed.columns.map((_, index) => referenceButton("columns", index)).join("")}
        ${editable ? `<div class="table-column-add-item"><button type="button" class="table-reference-item table-add-item" data-action="add-column" aria-label="Add column at end" title="Add column at end" tabindex="-1">+</button></div>` : ""}
      </div>
      <div class="table-row-strip table-reference-strip" role="group" aria-label="Row references">
        ${displayed.rows.map((_, index) => referenceButton("rows", index)).join("")}
        ${editable ? `<div class="table-row-add-item"><button type="button" class="table-reference-item table-add-item" data-action="add-row" aria-label="Add row at end" title="Add row at end" tabindex="-1">+</button></div>` : ""}
      </div>
      <table class="table-grid" role="grid" aria-label="Table" aria-rowcount="${displayed.rows.length}"
        aria-colcount="${displayed.columns.length}" tabindex="${selection ? -1 : 0}">
        <colgroup>${columnWidths.map(width => `<col style="width: ${width}px">`).join("")}</colgroup><tbody>${body}</tbody>
      </table>
    </div></div>
  </div>${contextMenu()}`);
  renderStatus();

  const nextScroll = main.querySelector(".table-scroll");
  if (nextScroll && scrollPosition) nextScroll.scrollTo(scrollPosition.left, scrollPosition.top);
  const nextEditor = main.querySelector(".table-input");
  if (nextEditor instanceof HTMLTextAreaElement && editing) nextEditor.value = editing.text;
  if (focus === "leave" || focus === "none" && !tableControlFocused) return;
  queueMicrotask(() => {
    if (!document.hasFocus()) return;
    const preservingEditor = focus === "none" && editorState?.focused;
    const preservingSelection = focus === "none" && selectionFocused;
    const preservingMenu = focus === "none" && focusedMenuIndex >= 0;
    const preservingGrid = focus === "none" && gridFocused;
    const intendedTarget = preservingEditor || focus === "editor" ? main.querySelector(".table-input")
      : focus === "grid" ? main.querySelector(".table-grid")
        : focus === "menu" ? main.querySelector("tv-menu-item")
          : preservingMenu ? main.querySelectorAll("tv-menu-item")[focusedMenuIndex]
            : preservingGrid ? main.querySelector(".table-grid")
              : preservingSelection || focus === "selection" ? selectionTarget() : null;
    const target = intendedTarget ?? selectionTarget() ?? main.querySelector(".table-grid");
    suppressGridEntry = target === main.querySelector(".table-grid");
    target?.focus({ preventScroll: true });
    suppressGridEntry = false;
    if (target instanceof HTMLTextAreaElement) {
      if (preservingEditor && editorState) {
        target.setSelectionRange(editorState.start, editorState.end, editorState.direction);
      } else {
        target.setSelectionRange(target.value.length, target.value.length);
      }
    }
    if ((preservingEditor || preservingSelection || focus === "editor" || focus === "selection") && target) {
      target.scrollIntoView({ block: "nearest", inline: "nearest" });
      keepClearOfFrozenAreas(target);
    }
  });
}

function reserveKeys(axis, count = 5) {
  // Four keys can materialize the minimum drawn axis; one more is the entry
  // added beyond it.
  const parent = ref(store, axis);
  return Array.from({ length: count }, () => push(parent).key);
}

function applyOperations(operations) {
  if (operations.length === 0) return;
  if (operations.length === 1) {
    const operation = operations[0];
    const target = ref(store, operation.path.join("/"));
    return operation.kind === "set" ? set(target, operation.value) : remove(target);
  }
  const entries = Object.fromEntries(operations.map(operation => [
    operation.path.join("/"), operation.kind === "set" ? operation.value : deleteValue(),
  ]));
  return update(root, entries);
}

function showFailure() {
  failure = true;
  clearTimeout(failureTimer);
  // Six seconds keeps the short status visible long enough to notice and for
  // the conformance capture to settle, without making it persistent.
  failureTimer = setTimeout(() => { failure = false; renderStatus(); }, 6000);
  renderStatus();
}

function reportUnsentFollowUp() {
  if (connection === "disconnected") failureAfterReconnect = true;
  else showFailure();
}

function renderStatus() {
  const message = connection === "disconnected" ? "Reconnecting…" : failure ? "Couldn't save that change." : "";
  if (statusRegion.textContent !== message) statusRegion.textContent = message;
}

function announceResize(axis, index, size) {
  if (!(resizeAnnouncement instanceof HTMLElement)) return;
  const label = axis === "rows" ? `Row ${index + 1}` : `Column ${columnLetter(index)}`;
  const dimension = axis === "rows" ? "tall" : "wide";
  resizeAnnouncement.textContent = `${label}, ${size} pixels ${dimension}`;
}

function startWithActionEcho(start, actionEcho) {
  pageActionSelection = actionEcho;
  try {
    return start();
  } finally {
    pageActionSelection = null;
  }
}

async function applyPlan(plan, echoSelection = null, focusEcho = true, onLocalApply = null) {
  if (!canWrite()) return false;
  let followUpStarted = false;
  const actionVersion = interactionVersion;
  const currentPageActionSelection = echoSelection
    ? nextAxes => {
      const selected = interactionVersion === actionVersion ? echoSelection(nextAxes) : null;
      return selected ? { selection: selected, focus: focusEcho } : null;
    }
    : null;
  if (plan.kind === "no-write") {
    if (plan.reason === "multiple-renumbering-required") showFailure();
    const accepted = !rejectedNoWriteReasons.has(plan.reason);
    if (accepted) onLocalApply?.();
    return accepted;
  }
  try {
    if (plan.kind === "renumber") {
      // A whole-store subscription gives runTransaction a held view, so its
      // first optimistic value is delivered synchronously inside this call.
      const pending = startWithActionEcho(
        () => runTransaction(ref(store, plan.axis), createAxisRenumberUpdate(plan.request)),
        currentPageActionSelection,
      );
      onLocalApply?.();
      const outcome = await pending;
      if (!outcome.committed) { showFailure(); return false; }
      if (plan.operations.length > 0) {
        if (!canWrite()) {
          reportUnsentFollowUp();
          return false;
        }
        // Let access, connection and value notifications queued with the
        // transaction acknowledgement reach the write guard first.
        await new Promise(resolve => setTimeout(resolve, 0));
        if (!canWrite()) {
          reportUnsentFollowUp();
          return false;
        }
      }
    }
    if (plan.operations.length > 0) {
      followUpStarted = plan.kind === "renumber";
      const pending = startWithActionEcho(() => applyOperations(plan.operations), currentPageActionSelection);
      if (plan.kind !== "renumber") onLocalApply?.();
      await pending;
    }
    return true;
  } catch (error) {
    if (error?.code === "disconnected") {
      if (plan.kind === "renumber" && plan.operations.length > 0 && !followUpStarted) {
        reportUnsentFollowUp();
      }
    } else showFailure();
    return false;
  }
}

function beginResize(axis, index, pointerPosition, pointerId) {
  if (!canWrite()) return;
  const item = axes()[axis][index];
  if (!item) return;
  const openedSize = displayedSize(axis, index);
  resizing = {
    axis, targetId: item.id, openedSize, previewSize: openedSize,
    pointerPosition, pointerId,
  };
}

function reconcileResizing(displayed) {
  if (!resizing) return;
  const index = indexOf(displayed[resizing.axis], resizing.targetId);
  if (index < 0) resizing = null;
}

async function finishResize() {
  if (!resizing) return;
  const active = resizing;
  resizing = null;
  const currentIndex = indexOf(axes()[active.axis], active.targetId);
  if (!canWrite() || currentIndex < 0) { render(); return; }
  const beforeSave = axes();
  const selected = selection;
  const plan = planResize(value, active.axis, currentIndex, active.openedSize, active.previewSize, reserveKeys(active.axis));
  const saved = await applyPlan(plan, nextAxes => selectionAtSamePosition(selected, beforeSave, nextAxes));
  render();
  if (!saved) return;
  const currentSize = displayedSize(active.axis, Math.min(currentIndex, axes()[active.axis].length - 1));
  announceResize(active.axis, currentIndex, currentSize);
}

async function resizeSelection(direction) {
  if (!canWrite() || (selection?.kind !== "rows" && selection?.kind !== "columns") || selection.ids.length !== 1) return;
  const index = indexOf(axes()[selection.kind], selection.anchorId);
  if (index < 0) return;
  const openedSize = displayedSize(selection.kind, index);
  const selected = selection;
  const beforeSave = axes();
  const plan = planResize(
    value,
    selection.kind,
    index,
    openedSize,
    openedSize + direction * KEYBOARD_RESIZE_STEP,
    reserveKeys(selection.kind),
  );
  const saved = await applyPlan(plan, nextAxes => selectionAtSamePosition(selected, beforeSave, nextAxes));
  if (!saved) return;
  announceResize(selected.kind, index, displayedSize(selected.kind, index));
}

function beginEditing(rowIndex, columnIndex, replacement) {
  if (!canWrite()) return;
  interactionVersion += 1;
  const displayed = axes();
  const selected = cellSelectionAt(displayed, rowIndex, columnIndex);
  if (!selected) return;
  selection = selected;
  const row = displayed.rows[rowIndex];
  const column = displayed.columns[columnIndex];
  const openedText = row.kind === "stored" && column.kind === "stored"
    ? bodyCellText(rowIndex, column.key) : "";
  editing = { kind: "cell", rowId: row.id, columnId: column.id, rowIndex, columnIndex, openedText, text: replacement ?? openedText };
  menu = null;
  render("editor");
}

function reconcileEditing(active, displayed) {
  if (!active) return null;
  const columnIndex = indexOf(displayed.columns, active.columnId);
  if (columnIndex < 0) return null;
  const rowIndex = indexOf(displayed.rows, active.rowId);
  return rowIndex < 0 ? null : { ...active, rowIndex, columnIndex };
}

async function commitEditing(command = null, restoreFocus = true, onLocalApply = null, options = {}) {
  if (!editing) return false;
  if (!canWrite()) {
    render(options.refocusWhenDisconnected === false ? "leave" : "editor");
    return false;
  }
  const active = editing;
  const completionVersion = interactionVersion;
  const plan = planCellCommit(value, { rowIndex: active.rowIndex, columnIndex: active.columnIndex }, active.openedText, active.text, {
    columns: reserveKeys("columns"), rows: reserveKeys("rows"),
  });
  editing = null;
  const beforeSave = axes();
  selection = cellSelectionAt(beforeSave, Math.min(active.rowIndex, beforeSave.rows.length - 1), Math.min(active.columnIndex, beforeSave.columns.length - 1));
  const provisionalMove = command
    ? moveSelection(selection, command, beforeSave) : null;
  if (provisionalMove) selection = provisionalMove.selection;
  const targetSelection = selection;
  const echoSelection = nextAxes => selectionAtSamePosition(targetSelection, beforeSave, nextAxes);
  const focusTarget = !provisionalMove?.exit && restoreFocus;
  render(focusTarget ? "selection" : "leave");
  const saved = await applyPlan(plan, echoSelection, focusTarget, onLocalApply);
  if (!saved) {
    if (interactionVersion === completionVersion) render(focusTarget ? "selection" : "leave");
    return false;
  }
  return true;
}

function clearSelection(focus = "grid") {
  interactionVersion += 1;
  selection = null;
  menu = null;
  render(focus);
}

async function clearContents() {
  if (!selection || !canWrite()) return;
  let logical;
  if (selection.kind === "cell") logical = { kind: "cell", ...selectedCellPosition() };
  else logical = { kind: selection.kind, ...axisRange(selection.kind) };
  await applyPlan(planClear(value, logical), nextAxes => reconcileSelection(selection, nextAxes));
}

async function addAtEnd(axis) {
  if (!canWrite()) return;
  const previous = selection;
  const count = Math.max(0, MINIMUM_AXIS_SIZE - model[axis].length) + 1;
  const keys = reserveKeys(axis);
  const newKey = keys[count - 1];
  await applyPlan(planAdd(value, axis, keys), nextAxes => selectionAfterAdd(previous, axis, newKey, nextAxes));
}

async function performMenuAction(action) {
  if (!menu || (selection?.kind !== "rows" && selection?.kind !== "columns") || !canWrite()) return;
  const axis = selection.kind;
  const range = axisRange(axis);
  if (!range) return;
  menu = null;
  if (action === "toggle-header") {
    await applyPlan(planSetHeader(!model.headerRow), nextAxes => reconcileSelection(selection, nextAxes));
    return;
  }
  if (action === "delete") {
    const formerIndex = range.start;
    await applyPlan(planDelete(value, axis, range), nextAxes => selectionAfterDelete(axis, formerIndex, nextAxes));
    return;
  }
  const side = action === "insert-before" ? "before" : "after";
  const insertionIndex = side === "before" ? range.start : range.end + 1;
  const drawnBefore = Math.max(0, insertionIndex - model[axis].length);
  const keys = reserveKeys(axis);
  const newKey = keys[drawnBefore];
  await applyPlan(planInsert(value, axis, range, side, keys), nextAxes => selectionAfterInsert(axis, newKey, nextAxes));
}

function openMenu(kind, index, extend = false) {
  if (!canWrite()) return;
  const displayed = axes();
  if (!(selection?.kind === kind && selection.ids.includes(displayed[kind][index]?.id))) {
    selection = selectAxis(selection, kind, index, extend, displayed);
  }
  menu = { kind, index, triggerId: displayed[kind][index].id };
  render("selection");
}

function openSelectionMenu() {
  if (!selection || !canWrite()) return;
  selection = selectionForMenu(selection, axes());
  if (selection?.kind !== "rows" && selection?.kind !== "columns") return;
  const index = indexOf(axes()[selection.kind], selection.anchorId);
  menu = { kind: selection.kind, index, triggerId: axes()[selection.kind][index].id };
  render("menu");
}

main.addEventListener("input", event => {
  if (!(event.target instanceof HTMLTextAreaElement) || !editing) return;
  editing.text = event.target.value;
});

main.addEventListener("click", event => { void handleClick(event); });

main.addEventListener("pointerdown", event => {
  if (!(event.target instanceof Element) || event.button !== 0) return;
  const columnHandle = event.target.closest(".table-column-resize-handle");
  const rowHandle = event.target.closest(".table-row-resize-handle");
  const handle = columnHandle ?? rowHandle;
  if (!handle) return;
  event.preventDefault();
  const axis = columnHandle ? "columns" : "rows";
  const item = handle.parentElement;
  const index = item ? [...item.parentElement.children].indexOf(item) : -1;
  if (index < 0) return;
  const pointerPosition = axis === "columns" ? event.clientX : event.clientY;
  const start = () => beginResize(axis, index, pointerPosition, event.pointerId);
  if (editing) void commitEditing(null, false, start);
  else start();
});

async function handleClick(event) {
  if (!(event.target instanceof Element) || event.target instanceof HTMLTextAreaElement) return;
  if (event.target.matches(".table-reference-corner, .table-reference-strip")) return;
  interactionVersion += 1;
  let actionApplied = false;
  const applyClick = () => {
    if (actionApplied) return;
    actionApplied = true;
    applyClickTarget(event.target, event.detail, event.shiftKey);
  };
  if (editing) {
    if (!await commitEditing(null, false, applyClick) || actionApplied) return;
  }
  applyClick();
}

function applyClickTarget(target, detail, extend) {
  const menuAction = target.closest("[data-menu-action]");
  if (menuAction) { void performMenuAction(menuAction.dataset.menuAction); return; }
  const action = target.closest("[data-action]");
  if (action) { void addAtEnd(action.dataset.action === "add-row" ? "rows" : "columns"); return; }

  const rowButton = target.closest("[data-row-select]");
  if (rowButton) {
    menu = null;
    selection = selectAxis(selection, "rows", Number(rowButton.dataset.rowIndex), extend, axes());
    render("selection");
    return;
  }
  const columnButton = target.closest("[data-column-select]");
  if (columnButton) {
    menu = null;
    selection = selectAxis(selection, "columns", Number(columnButton.dataset.columnIndex), extend, axes());
    render("selection");
    return;
  }
  const cell = target.closest("[data-cell]");
  if (cell) {
    const rowIndex = Number(cell.dataset.rowIndex);
    const columnIndex = Number(cell.dataset.columnIndex);
    if (detail > 1) beginEditing(rowIndex, columnIndex);
    else { selection = cellSelectionAt(axes(), rowIndex, columnIndex); menu = null; render("selection"); }
  }
}

main.addEventListener("contextmenu", event => {
  if (!(event.target instanceof Element) || event.target.closest(".table-input")) return;
  interactionVersion += 1;
  const rowButton = event.target.closest("[data-row-select]");
  const columnButton = event.target.closest("[data-column-select]");
  if (!rowButton && !columnButton) return;
  event.preventDefault();
  if (editing) {
    void commitEditing(null, false, () => {
      openMenu(rowButton ? "rows" : "columns", Number((rowButton ?? columnButton).dataset[rowButton ? "rowIndex" : "columnIndex"]));
    });
    return;
  }
  openMenu(rowButton ? "rows" : "columns", Number((rowButton ?? columnButton).dataset[rowButton ? "rowIndex" : "columnIndex"]));
});

// Record the scroll position before an in-frame Tab can make Chromium scroll
// the grid natively; focusin restores it before choosing the entry cell.
document.addEventListener("keydown", event => {
  const grid = main.querySelector(".table-grid");
  if (event.defaultPrevented || event.key !== "Tab" || selection !== null || document.activeElement === grid) return;
  const scroll = main.querySelector(".table-scroll");
  if (scroll instanceof HTMLElement) {
    gridEntryScrollPosition = { left: scroll.scrollLeft, top: scroll.scrollTop };
  }
}, { capture: true });

main.addEventListener("scroll", event => {
  if (!(event.target instanceof HTMLElement) || !event.target.matches(".table-scroll")) return;
  gridEntryScrollPosition = { left: event.target.scrollLeft, top: event.target.scrollTop };
}, { capture: true });

main.addEventListener("focusin", event => {
  if (!suppressGridEntry && event.target === main.querySelector(".table-grid") && selection === null) {
    const entryScrollPosition = gridEntryScrollPosition;
    main.querySelector(".table-scroll")?.scrollTo(entryScrollPosition.left, entryScrollPosition.top);
    selection = enterTable(selection, axes());
    render("selection");
  }
});

main.addEventListener("focusout", event => {
  if (rendering || !(event.target instanceof HTMLTextAreaElement) || !editing) return;
  queueMicrotask(() => {
    if (!rendering && !pointerMovedFocus && editing && document.activeElement !== event.target) {
      void commitEditing(null, false, null, { refocusWhenDisconnected: false });
    }
  });
});

main.addEventListener("keydown", event => {
  if (event.defaultPrevented) return;
  interactionVersion += 1;
  if (event.target instanceof HTMLTextAreaElement) {
    if (event.isComposing) return;
    if (event.key === "Escape") {
      event.preventDefault();
      editing = null;
      render("selection");
    } else if (event.key === "Enter" || event.key === "Tab") {
      if (!canWrite()) {
        event.preventDefault();
        return;
      }
      const command = event.key === "Tab" ? event.shiftKey ? "tab-backward" : "tab-forward"
        : event.shiftKey ? "up" : "down";
      const exits = event.key === "Tab" && moveSelection(selection, command, axes()).exit;
      if (exits) {
        // Native Tab moves beyond the artifact; the resulting focusout commits
        // without replacing the editor before the browser chooses its target.
        return;
      }
      event.preventDefault();
      void commitEditing(command);
    }
    return;
  }
  if (editing) {
    event.preventDefault();
    main.querySelector(".table-input")?.focus();
    return;
  }
  if (!selection) {
    if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) {
      event.preventDefault();
      const command = event.key.replace("Arrow", "").toLowerCase();
      selection = moveSelection(null, command, axes()).selection;
      render("selection");
    }
    return;
  }

  if (event.key === "Delete" || event.key === "Backspace") {
    event.preventDefault();
    if (menu) return;
    void clearContents();
    return;
  }
  if ((event.key === "ContextMenu" || event.key === "F10" && event.shiftKey) && !editing) {
    event.preventDefault();
    openSelectionMenu();
    return;
  }
  if (event.key === " " && event.shiftKey && event.ctrlKey && selection.kind === "cell") {
    event.preventDefault();
    const columnIndex = selectedCellPosition().columnIndex;
    selection = selectAxis(null, "columns", columnIndex, false, axes());
    render("selection");
    return;
  }
  if (event.key === " " && event.shiftKey && selection.kind === "cell") {
    event.preventDefault();
    const position = selectedCellPosition();
    selection = selectAxis(null, "rows", position.rowIndex, false, axes());
    render("selection");
    return;
  }
  if (selection.kind === "rows" || selection.kind === "columns") {
    const commandModified = event.ctrlKey || event.metaKey || event.altKey;
    if ((event.key === "+" || event.key === "Add" || event.key === "-" || event.key === "Subtract")
        && selection.ids.length === 1 && !menu && !commandModified) {
      event.preventDefault();
      void resizeSelection(event.key === "+" || event.key === "Add" ? 1 : -1);
      return;
    }
    if (!commandModified && (["Enter", "F2", " "].includes(event.key) || event.key.length === 1)) {
      event.preventDefault();
    }
  } else if (event.key === "Process" || event.isComposing) {
    const position = selectedCellPosition();
    beginEditing(position.rowIndex, position.columnIndex, "");
    // Give the browser's still-pending composition a text input target.
    main.querySelector(".table-input")?.focus();
    return;
  } else if (event.key === "Enter" || event.key === "F2") {
    event.preventDefault();
    const position = selectedCellPosition();
    beginEditing(position.rowIndex, position.columnIndex);
    return;
  } else if (event.key.length === 1 && !event.metaKey && (!event.ctrlKey || event.altKey)) {
    event.preventDefault();
    const position = selectedCellPosition();
    beginEditing(position.rowIndex, position.columnIndex, event.key);
    return;
  }

  const command = ({ ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right" })[event.key]
    ?? (event.key === "Tab" ? event.shiftKey ? "tab-backward" : "tab-forward" : null);
  if (!command) return;
  const moved = moveSelection(selection, command, axes(), { extend: event.shiftKey });
  if (moved.exit) return;
  event.preventDefault();
  if (menu && moved.selection !== selection) menu = null;
  selection = moved.selection;
  render("selection");
});

document.addEventListener("keydown", event => {
  if (event.key !== "Escape") return;
  if (editing) return;
  if (menu) {
    event.preventDefault();
    event.stopImmediatePropagation();
    menu = null;
    render("selection");
  } else if (selection) {
    event.preventDefault();
    event.stopImmediatePropagation();
    clearSelection();
  }
}, { capture: true });

document.addEventListener("pointerdown", event => {
  if (event.target instanceof Element
      && event.target.matches(".table-reference-corner, .table-reference-strip")) {
    event.preventDefault();
    pointerMovedFocus = false;
    return;
  }
  if (editing && event.button === 2 && event.target instanceof Element
      && event.target.closest("[data-cell]")
      && !event.target.closest(".table-input")) {
    event.preventDefault();
    pointerMovedFocus = false;
    return;
  }
  pointerMovedFocus = editing !== null && event.target instanceof Element && !event.target.closest(".table-input");
}, { capture: true });

document.addEventListener("pointermove", event => {
  if (!resizing || event.pointerId !== resizing.pointerId) return;
  const rules = AXIS_SIZES[resizing.axis];
  const position = resizing.axis === "columns" ? event.clientX : event.clientY;
  resizing.previewSize = Math.max(rules.minimum, Math.min(rules.maximum,
    resizing.openedSize + position - resizing.pointerPosition));
  // Pointer previews rerender the grid. This favors one consistent rendering
  // path; very large tables may therefore resize less smoothly.
  render();
}, { capture: true });
document.addEventListener("pointerup", event => {
  pointerMovedFocus = false;
  if (resizing && event.pointerId === resizing.pointerId) void finishResize();
}, { capture: true });
document.addEventListener("pointercancel", event => {
  pointerMovedFocus = false;
  if (resizing && event.pointerId === resizing.pointerId) {
    resizing = null;
    render();
  }
}, { capture: true });

document.addEventListener("click", event => {
  if (!(event.target instanceof Element)
      || event.target.closest(".table-grid, .table-reference-strip, .table-reference-corner, tv-menu")) return;
  if (editing) void commitEditing(null, false, () => clearSelection("none"));
  else if (selection) clearSelection("none");
});

function commitWhenDocumentLosesFocus() {
  if (editing && canWrite()) void commitEditing(null, false);
}

window.addEventListener("blur", commitWhenDocumentLosesFocus);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") commitWhenDocumentLosesFocus();
});

function acceptValue(next) {
  value = next;
  received = true;
  unavailable = false;
  model = readTable(value);
  const nextAxes = buildAxes();
  reconcileResizing(nextAxes);
  let focus = "none";
  if (model !== null) {
    editing = reconcileEditing(editing, nextAxes);
    const actionEcho = pageActionSelection?.(nextAxes);
    if (actionEcho) {
      selection = actionEcho.selection;
      focus = editing ? "none" : actionEcho.focus ? "selection" : "leave";
    } else {
      const reconciled = reconcileSelection(selection, nextAxes);
      if (selection && !reconciled) { selection = null; editing = null; menu = null; }
      else {
        selection = reconciled;
        if (menu && selection?.kind === menu.kind) {
          const index = indexOf(nextAxes[menu.kind], menu.triggerId);
          if (index < 0) menu = null;
          else menu = { ...menu, index };
        }
      }
    }
  } else {
    selection = null;
    editing = null;
    menu = null;
    resizing = null;
  }
  render(focus, nextAxes);
}

function subscribe() {
  if (unsubscribe) return;
  unsubscribe = onValue(root, snapshot => acceptValue(snapshot.val()), error => {
    unsubscribe = null;
    if (error.code === "unavailable") unavailable = true;
    selection = null;
    editing = null;
    menu = null;
    resizing = null;
    render();
  });
}

function updateAccess(level) {
  accessKnown = true;
  access = level;
  if (level === null && !received) unavailable = true;
  if (level !== "read-write") {
    editing = null;
    menu = null;
    resizing = null;
  }
  if (level !== null && connection === "connected") subscribe();
  render();
}

onAccessChanged(updateAccess);
getAccess().then(updateAccess, () => {});
onConnectionStatusChanged(status => {
  connection = status;
  if (status !== "connected") {
    access = null;
    menu = null;
    resizing = null;
  } else {
    if (failureAfterReconnect) {
      failureAfterReconnect = false;
      showFailure();
    }
    if (accessKnown) getAccess().then(updateAccess, () => {});
    subscribe();
  }
  render();
});

subscribe();
render();

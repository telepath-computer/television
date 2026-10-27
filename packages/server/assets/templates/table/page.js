import {
  deleteValue, getAccess, getConnectionStatus, getStore, onAccessChanged,
  onConnectionStatusChanged, onValue, push, ref, remove, runTransaction, set, update,
} from "/sdk/v1/resources.js";
import {
  createAxisRenumberUpdate, displayAxis, planAdd, planCellCommit, planClear,
  planDelete, planHeaderCommit, planInsert, planSetHeader, readTable,
} from "./model.js";
import {
  cellSelectionAt, enterTable, headerSelectionAt, moveSelection, reconcileSelection,
  selectAxis, selectionAfterAdd, selectionAfterDelete, selectionAfterInsert, selectionForMenu,
} from "./selection-model.js";

const main = document.querySelector(".table-page");
const store = getStore();
const root = ref(store);

let value;
let model;
let received = false;
let unavailable = false;
let access = null;
let connection = getConnectionStatus();
let selection = null;
let editing = null;
let menu = null;
let failure = false;
let failureTimer;
let suppressGridEntry = false;
let pointerMovedFocus = false;
let discardCommitSelection = false;

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

function axes() {
  return {
    columns: displayAxis(model?.columns ?? []),
    rows: displayAxis(model?.rows ?? []),
  };
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

function selectedHeaderPosition(selected = selection) {
  if (selected?.kind !== "header") return null;
  const columnIndex = indexOf(axes().columns, selected.columnId);
  return columnIndex < 0 ? null : { columnIndex };
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
  const header = selectedHeaderPosition();
  return axis === "columns" && header?.columnIndex === index ? "related" : "none";
}

function menuTrigger(kind, index) {
  return menu?.kind === kind && menu.index === index;
}

function referenceButton(kind, index) {
  const isRows = kind === "rows";
  const selected = isRows ? rowSelected(index) : columnSelected(index);
  const label = isRows ? `Select row ${index + 1}` : `Select column ${columnLetter(index)}`;
  const anchorId = selection?.kind === kind ? selection.anchorId : null;
  const item = axes()[kind][index];
  return `<div class="table-${isRows ? "row" : "column"}-reference-item">
    <button type="button" class="table-reference-item" id="table-${kind}-reference-${index + 1}"
      data-${isRows ? "row" : "column"}-select data-${isRows ? "row" : "column"}-index="${index}"
      data-emphasis="${referenceEmphasis(kind, index)}" data-menu-trigger="${menuTrigger(kind, index)}"
      aria-label="${label}" aria-haspopup="${canWrite() ? "menu" : "false"}" aria-pressed="${selected}"
      tabindex="${anchorId === item?.id ? 0 : -1}">${isRows ? index + 1 : columnLetter(index)}</button>
  </div>`;
}

function headerCell(column, columnIndex) {
  const selectedPosition = selectedHeaderPosition();
  const selected = selectedPosition?.columnIndex === columnIndex;
  const name = column.kind === "stored" ? model.columns[columnIndex]?.name ?? "" : "";
  const isEditing = editing?.kind === "header" && editing.columnIndex === columnIndex && editing.columnId === column.id;
  const content = isEditing
    ? `<textarea class="table-input table-header-input" rows="1" aria-label="Column ${columnLetter(columnIndex)} name" spellcheck="false">${escapeHtml(editing.text)}</textarea>`
    : `<button type="button" class="table-header-button" data-header-text data-column-index="${columnIndex}"
        data-selection="${selected ? "header" : "none"}" aria-label="${escapeHtml(name || `Column ${columnLetter(columnIndex)}`)}"
        tabindex="${selected ? 0 : -1}"><span>${escapeHtml(shownText(name))}</span></button>`;
  return `<th class="table-header" scope="col" data-column-header data-column-index="${columnIndex}"
    data-axis-selected="${columnSelected(columnIndex)}" aria-selected="${columnSelected(columnIndex) || selected}"
    aria-colindex="${columnIndex + 1}"><div class="table-header-content">${content}</div></th>`;
}

function bodyCell(row, column, rowIndex, columnIndex) {
  const selected = cellSelectionKind(rowIndex, columnIndex);
  const text = row.kind === "stored" && column.kind === "stored"
    ? model.rows[rowIndex]?.cells[column.key] ?? "" : "";
  const isEditing = editing?.kind === "cell" && editing.rowIndex === rowIndex && editing.columnIndex === columnIndex
    && editing.rowId === row.id && editing.columnId === column.id;
  const content = isEditing
    ? `<textarea class="table-input table-cell-input" rows="1" aria-label="Row ${rowIndex + 1}, column ${columnLetter(columnIndex)}" spellcheck="false">${escapeHtml(editing.text)}</textarea>`
    : `<span>${escapeHtml(shownText(text))}</span>`;
  return `<td class="table-cell" role="gridcell" data-cell data-row-index="${rowIndex}" data-column-index="${columnIndex}"
    ${row.kind === "stored" ? `data-row-key="${escapeHtml(row.key)}"` : ""}
    ${column.kind === "stored" ? `data-column-key="${escapeHtml(column.key)}"` : ""}
    data-selection="${selected}" aria-selected="${selected !== "none"}" aria-colindex="${columnIndex + 1}"
    tabindex="${selected === "cell" ? 0 : -1}">${content}</td>`;
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
  const trigger = `table-${selection.kind}-reference-${menu.index + 1}`;
  return `<tv-menu class="table-context-menu table-${noun}-context-menu" trigger="${trigger}" open role="menu" aria-label="${isRows ? "Row" : "Column"} actions">
    <tv-menu-item role="menuitem" data-menu-action="insert-before"><span>Insert ${noun} ${before}</span></tv-menu-item>
    <tv-menu-item role="menuitem" data-menu-action="insert-after"><span>Insert ${noun} ${after}</span></tv-menu-item>
    ${storedCount ? `<tv-menu-item role="menuitem" data-menu-action="delete" intent="danger"><span>Delete ${noun}${storedCount === 1 ? "" : "s"}</span></tv-menu-item>` : ""}
    <hr>
    <tv-menu-item role="menuitem" data-menu-action="toggle-header"><span>${model.showHeader ? "Hide" : "Show"} header row</span></tv-menu-item>
  </tv-menu>`;
}

function selectionTarget() {
  if (selection?.kind === "cell") {
    const position = selectedCellPosition();
    return position && main.querySelector(`[data-cell][data-row-index="${position.rowIndex}"][data-column-index="${position.columnIndex}"]`);
  }
  if (selection?.kind === "header") {
    const position = selectedHeaderPosition();
    return position && main.querySelector(`[data-header-text][data-column-index="${position.columnIndex}"]`);
  }
  if (selection?.kind === "rows" || selection?.kind === "columns") {
    const index = indexOf(axes()[selection.kind], selection.anchorId);
    return main.querySelector(`[data-${selection.kind === "rows" ? "row" : "column"}-index="${index}"]`);
  }
  return null;
}

function render(focus = "none") {
  const scroll = main.querySelector(".table-scroll");
  const scrollPosition = scroll ? { left: scroll.scrollLeft, top: scroll.scrollTop } : null;
  if (!received) {
    main.dataset.editable = "false";
    main.innerHTML = `<div class="table-loading" role="status" aria-label="Loading table"><tv-icon name="spinner" size="md" spinning></tv-icon></div>
      <div class="table-status" role="status"></div>`;
    return;
  }
  if (unavailable || model === null) {
    main.dataset.editable = "false";
    main.innerHTML = `<section class="table-unreadable" role="alert">
      <span class="table-unreadable-icon"><tv-icon name="warning" size="xl"></tv-icon></span>
      <h1 class="table-unreadable-title">This table can't be shown</h1>
      <p class="table-unreadable-text">Television can't read the saved table data. Ask your agent to check the data and access.</p>
    </section><div class="table-status" role="status"></div>`;
    return;
  }

  const displayed = axes();
  const editable = canWrite();
  main.dataset.editable = String(editable);
  const header = model.showHeader ? `<thead><tr aria-rowindex="1">${displayed.columns.map(headerCell).join("")}</tr></thead>` : "";
  const body = displayed.rows.map((row, rowIndex) => `<tr aria-rowindex="${rowIndex + (model.showHeader ? 2 : 1)}">
    ${displayed.columns.map((column, columnIndex) => bodyCell(row, column, rowIndex, columnIndex)).join("")}</tr>`).join("");
  main.innerHTML = `<div class="table-frame" data-reference-visible="${selection ? "shown" : "hidden"}">
    <div class="table-scroll"><div class="table-sheet" style="--table-column-count: ${displayed.columns.length}">
      <div class="table-reference-corner" aria-hidden="true"></div>
      <div class="table-column-strip table-reference-strip" aria-label="Column references">
        ${displayed.columns.map((_, index) => referenceButton("columns", index)).join("")}
        ${editable ? `<div class="table-column-add-item"><button type="button" class="table-reference-item table-add-item" data-action="add-column" aria-label="Add column at end" title="Add column at end" tabindex="-1">+</button></div>` : ""}
      </div>
      <div class="table-row-strip table-reference-strip${model.showHeader ? " table-row-strip-with-header" : ""}" aria-label="Row references">
        ${displayed.rows.map((_, index) => referenceButton("rows", index)).join("")}
        ${editable ? `<div class="table-row-add-item"><button type="button" class="table-reference-item table-add-item" data-action="add-row" aria-label="Add row at end" title="Add row at end" tabindex="-1">+</button></div>` : ""}
      </div>
      <table class="table-grid" role="grid" aria-label="Table" aria-rowcount="${displayed.rows.length + (model.showHeader ? 1 : 0)}"
        aria-colcount="${displayed.columns.length}" tabindex="${selection ? -1 : 0}">
        <colgroup>${displayed.columns.map(() => '<col class="table-data-column">').join("")}</colgroup>${header}<tbody>${body}</tbody>
      </table>
    </div></div>
  </div>${contextMenu()}<div class="table-status" role="status">${failure ? "Couldn't save that change." : ""}</div>`;

  const nextScroll = main.querySelector(".table-scroll");
  if (nextScroll && scrollPosition) nextScroll.scrollTo(scrollPosition.left, scrollPosition.top);
  if (focus === "none") return;
  queueMicrotask(() => {
    const target = focus === "editor" ? main.querySelector(".table-input")
      : focus === "grid" ? main.querySelector(".table-grid") : selectionTarget();
    suppressGridEntry = focus === "grid";
    target?.focus({ preventScroll: true });
    suppressGridEntry = false;
    if (focus === "editor" && target instanceof HTMLTextAreaElement) {
      target.setSelectionRange(target.value.length, target.value.length);
    }
  });
}

function reserveKeys(axis, count = 8) {
  const parent = ref(store, axis);
  return Array.from({ length: count }, () => push(parent).key);
}

async function applyOperations(operations) {
  if (operations.length === 0) return;
  if (operations.length === 1) {
    const operation = operations[0];
    const target = ref(store, operation.path.join("/"));
    await (operation.kind === "set" ? set(target, operation.value) : remove(target));
    return;
  }
  const entries = Object.fromEntries(operations.map(operation => [
    operation.path.join("/"), operation.kind === "set" ? operation.value : deleteValue(),
  ]));
  await update(root, entries);
}

function showFailure() {
  failure = true;
  clearTimeout(failureTimer);
  failureTimer = setTimeout(() => { failure = false; render(); }, 4000);
  render();
}

async function applyPlan(plan) {
  if (!canWrite()) return false;
  if (plan.kind === "no-write") {
    if (plan.reason === "multiple-renumbering-required") showFailure();
    return !["unreadable", "invalid-target", "invalid-selection", "missing-keys", "invalid-keys", "multiple-renumbering-required"].includes(plan.reason);
  }
  try {
    if (plan.kind === "renumber") {
      const outcome = await runTransaction(ref(store, plan.axis), createAxisRenumberUpdate(plan.request));
      if (!outcome.committed) { showFailure(); return false; }
    }
    await applyOperations(plan.operations);
    return true;
  } catch {
    showFailure();
    return false;
  }
}

function beginEditing(kind, rowIndex, columnIndex, replacement) {
  if (!canWrite()) return;
  discardCommitSelection = false;
  const displayed = axes();
  if (kind === "cell") {
    const selected = cellSelectionAt(displayed, rowIndex, columnIndex);
    if (!selected) return;
    selection = selected;
    const row = displayed.rows[rowIndex];
    const column = displayed.columns[columnIndex];
    const openedText = row.kind === "stored" && column.kind === "stored"
      ? model.rows[rowIndex]?.cells[column.key] ?? "" : "";
    editing = { kind, rowId: row.id, columnId: column.id, rowIndex, columnIndex, openedText, text: replacement ?? openedText };
  } else {
    const selected = headerSelectionAt(displayed, columnIndex);
    if (!selected) return;
    selection = selected;
    const column = displayed.columns[columnIndex];
    const openedText = column.kind === "stored" ? model.columns[columnIndex]?.name ?? "" : "";
    editing = { kind, columnId: column.id, columnIndex, openedText, text: replacement ?? openedText };
  }
  menu = null;
  render("editor");
}

async function commitEditing(command = null, restoreFocus = true) {
  if (!editing || !canWrite()) return false;
  const active = editing;
  const plan = active.kind === "cell"
    ? planCellCommit(value, { rowIndex: active.rowIndex, columnIndex: active.columnIndex }, active.openedText, active.text, {
      columns: reserveKeys("columns"), rows: reserveKeys("rows"),
    })
    : planHeaderCommit(value, active.columnIndex, active.openedText, active.text, { columns: reserveKeys("columns") });
  editing = null;
  const saved = await applyPlan(plan);
  if (!saved) { render(restoreFocus ? "selection" : "none"); return false; }
  if (discardCommitSelection) {
    discardCommitSelection = false;
    render("none");
    return true;
  }

  const displayed = axes();
  selection = active.kind === "cell"
    ? cellSelectionAt(displayed, Math.min(active.rowIndex, displayed.rows.length - 1), Math.min(active.columnIndex, displayed.columns.length - 1))
    : headerSelectionAt(displayed, Math.min(active.columnIndex, displayed.columns.length - 1));
  if (command) {
    const moved = moveSelection(selection, command, displayed, { showHeader: model.showHeader });
    selection = moved.selection;
    render(moved.exit || !restoreFocus ? "none" : "selection");
  } else render(restoreFocus ? "selection" : "none");
  return true;
}

function clearSelection() {
  discardCommitSelection = true;
  selection = null;
  menu = null;
  render("grid");
}

async function clearContents() {
  if (!selection || !canWrite()) return;
  let logical;
  if (selection.kind === "cell") logical = { kind: "cell", ...selectedCellPosition() };
  else if (selection.kind === "header") logical = { kind: "header", ...selectedHeaderPosition() };
  else logical = { kind: selection.kind, ...axisRange(selection.kind) };
  if (await applyPlan(planClear(value, logical))) render("selection");
}

async function addAtEnd(axis) {
  if (!canWrite()) return;
  const previous = selection;
  const count = Math.max(0, 4 - model[axis].length) + 1;
  const keys = reserveKeys(axis);
  const newKey = keys[count - 1];
  if (!await applyPlan(planAdd(value, axis, keys))) return;
  selection = selectionAfterAdd(previous, axis, newKey, axes());
  menu = null;
  render("selection");
}

async function performMenuAction(action) {
  if (!menu || (selection?.kind !== "rows" && selection?.kind !== "columns") || !canWrite()) return;
  const axis = selection.kind;
  const range = axisRange(axis);
  if (!range) return;
  menu = null;
  if (action === "toggle-header") {
    if (await applyPlan(planSetHeader(!model.showHeader))) render("selection");
    return;
  }
  if (action === "delete") {
    const formerIndex = range.start;
    if (await applyPlan(planDelete(value, axis, range))) {
      selection = selectionAfterDelete(axis, formerIndex, axes());
      render("selection");
    }
    return;
  }
  const side = action === "insert-before" ? "before" : "after";
  const insertionIndex = side === "before" ? range.start : range.end + 1;
  const drawnBefore = Math.max(0, insertionIndex - model[axis].length);
  const keys = reserveKeys(axis);
  const newKey = keys[drawnBefore];
  if (await applyPlan(planInsert(value, axis, range, side, keys))) {
    selection = selectionAfterInsert(axis, newKey, axes());
    render("selection");
  }
}

function openMenu(kind, index, extend = false) {
  if (!canWrite()) return;
  const displayed = axes();
  if (!(selection?.kind === kind && selection.ids.includes(displayed[kind][index]?.id))) {
    selection = selectAxis(selection, kind, index, extend, displayed);
  }
  menu = { kind, index };
  render("selection");
}

function openSelectionMenu() {
  if (!selection || !canWrite()) return;
  selection = selectionForMenu(selection, axes());
  if (selection?.kind !== "rows" && selection?.kind !== "columns") return;
  const index = indexOf(axes()[selection.kind], selection.anchorId);
  menu = { kind: selection.kind, index };
  render("selection");
}

main.addEventListener("input", event => {
  if (!(event.target instanceof HTMLTextAreaElement) || !editing) return;
  editing.text = event.target.value;
});

main.addEventListener("click", event => { void handleClick(event); });

async function handleClick(event) {
  if (!(event.target instanceof Element) || event.target instanceof HTMLTextAreaElement) return;
  if (editing && !await commitEditing(null, false)) return;
  const menuAction = event.target.closest("[data-menu-action]");
  if (menuAction) { void performMenuAction(menuAction.dataset.menuAction); return; }
  const action = event.target.closest("[data-action]");
  if (action) { void addAtEnd(action.dataset.action === "add-row" ? "rows" : "columns"); return; }

  const rowButton = event.target.closest("[data-row-select]");
  if (rowButton) {
    menu = null;
    selection = selectAxis(selection, "rows", Number(rowButton.dataset.rowIndex), event.shiftKey, axes());
    render("selection");
    return;
  }
  const columnButton = event.target.closest("[data-column-select]");
  if (columnButton) {
    menu = null;
    selection = selectAxis(selection, "columns", Number(columnButton.dataset.columnIndex), event.shiftKey, axes());
    render("selection");
    return;
  }
  const header = event.target.closest("[data-header-text]");
  if (header) {
    const columnIndex = Number(header.dataset.columnIndex);
    if (event.detail > 1) beginEditing("header", null, columnIndex);
    else { selection = headerSelectionAt(axes(), columnIndex); menu = null; render("selection"); }
    return;
  }
  const cell = event.target.closest("[data-cell]");
  if (cell) {
    const rowIndex = Number(cell.dataset.rowIndex);
    const columnIndex = Number(cell.dataset.columnIndex);
    if (event.detail > 1) beginEditing("cell", rowIndex, columnIndex);
    else { selection = cellSelectionAt(axes(), rowIndex, columnIndex); menu = null; render("selection"); }
  }
}

main.addEventListener("contextmenu", event => {
  if (!(event.target instanceof Element) || event.target.closest(".table-input")) return;
  const rowButton = event.target.closest("[data-row-select]");
  const columnButton = event.target.closest("[data-column-select]");
  if (!rowButton && !columnButton) return;
  event.preventDefault();
  if (editing) {
    void commitEditing(null, false).then(saved => {
      if (saved) openMenu(rowButton ? "rows" : "columns", Number((rowButton ?? columnButton).dataset[rowButton ? "rowIndex" : "columnIndex"]));
    });
    return;
  }
  openMenu(rowButton ? "rows" : "columns", Number((rowButton ?? columnButton).dataset[rowButton ? "rowIndex" : "columnIndex"]));
});

main.addEventListener("focusin", event => {
  if (!suppressGridEntry && event.target === main.querySelector(".table-grid") && selection === null) {
    selection = enterTable(selection, axes());
    render("selection");
  }
});

main.addEventListener("focusout", event => {
  if (!(event.target instanceof HTMLTextAreaElement) || !editing) return;
  queueMicrotask(() => {
    if (!pointerMovedFocus && editing && document.activeElement !== event.target) void commitEditing(null, false);
  });
});

main.addEventListener("keydown", event => {
  if (event.target instanceof HTMLTextAreaElement) {
    if (event.key === "Escape") {
      event.preventDefault();
      editing = null;
      render("selection");
    } else if (event.key === "Enter" || event.key === "Tab") {
      const command = event.key === "Tab" ? event.shiftKey ? "tab-backward" : "tab-forward"
        : event.shiftKey ? "up" : "down";
      const exits = event.key === "Tab" && moveSelection(selection, command, axes(), { showHeader: model.showHeader }).exit;
      if (!exits) event.preventDefault();
      void commitEditing(command);
    }
    return;
  }
  if (!selection) {
    if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) {
      event.preventDefault();
      const command = event.key.replace("Arrow", "").toLowerCase();
      selection = moveSelection(null, command, axes(), { showHeader: model.showHeader }).selection;
      render("selection");
    }
    return;
  }

  if (event.key === "Delete" || event.key === "Backspace") {
    event.preventDefault();
    void clearContents();
    return;
  }
  if ((event.key === "ContextMenu" || event.key === "F10" && event.shiftKey) && !editing) {
    event.preventDefault();
    openSelectionMenu();
    return;
  }
  if (event.key === " " && event.shiftKey && event.ctrlKey && (selection.kind === "cell" || selection.kind === "header")) {
    event.preventDefault();
    const columnIndex = selection.kind === "cell" ? selectedCellPosition().columnIndex : selectedHeaderPosition().columnIndex;
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
    if (["Enter", "F2", " "].includes(event.key) || event.key.length === 1) event.preventDefault();
  } else if (event.key === "Enter" || event.key === "F2") {
    event.preventDefault();
    const position = selection.kind === "cell" ? selectedCellPosition() : selectedHeaderPosition();
    beginEditing(selection.kind, position.rowIndex, position.columnIndex);
    return;
  } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
    event.preventDefault();
    const position = selection.kind === "cell" ? selectedCellPosition() : selectedHeaderPosition();
    beginEditing(selection.kind, position.rowIndex, position.columnIndex, event.key);
    return;
  }

  const command = ({ ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right" })[event.key]
    ?? (event.key === "Tab" ? event.shiftKey ? "tab-backward" : "tab-forward" : null);
  if (!command) return;
  const moved = moveSelection(selection, command, axes(), { showHeader: model.showHeader, extend: event.shiftKey });
  if (moved.exit) return;
  event.preventDefault();
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
  pointerMovedFocus = editing !== null && event.target instanceof Element
    && event.target.closest(".table-input") === null;
}, { capture: true });

document.addEventListener("pointerup", () => { pointerMovedFocus = false; }, { capture: true });
document.addEventListener("pointercancel", () => { pointerMovedFocus = false; }, { capture: true });

document.addEventListener("click", event => {
  if (!(event.target instanceof Element) || event.target.closest(".table-frame, tv-menu")) return;
  if (editing) void commitEditing(null, false).then(saved => { if (saved) clearSelection(); });
  else if (selection) clearSelection();
});

function acceptValue(next) {
  value = next;
  received = true;
  unavailable = false;
  model = readTable(value);
  if (model !== null) {
    const reconciled = reconcileSelection(selection, axes(), model.showHeader);
    if (selection && !reconciled) { selection = null; editing = null; menu = null; }
    else selection = reconciled;
  } else {
    selection = null;
    editing = null;
    menu = null;
  }
  render();
}

onValue(root, snapshot => acceptValue(snapshot.val()), error => {
  if (error.code === "unavailable") unavailable = true;
  render();
});

function updateAccess(level) {
  access = level;
  render();
}

onAccessChanged(updateAccess);
getAccess().then(updateAccess, () => {});
onConnectionStatusChanged(status => {
  connection = status;
  render();
});

render();

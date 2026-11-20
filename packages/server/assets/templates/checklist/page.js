import {
  getStore, ref, onValue, set, push, remove, runTransaction,
  getAccess, onAccessChanged, getConnectionStatus, onConnectionStatusChanged,
} from "/sdk/v1/resources.js";
import { isChecklistData, orderedItems, insertionOrder, createRenumberUpdate, isCompletionShortcut } from "./model.js";

const main = document.querySelector(".checklist-page");
const store = getStore();
const root = ref(store);
const itemsRef = ref(store, "items");
const iconStyles = new CSSStyleSheet();
iconStyles.replaceSync(await (await fetch("./icons.css")).text());
const rows = new Map();
let value;
let received = false;
let unavailable = false;
let access = null;
let connection = getConnectionStatus();
let unsubscribe = null;
let draft = null;
let retainedDraft = false;
let pendingFocus = null;
let title;
let list;
let addField;
let firstView = true;
let failureTimer;
let failure = false;
let status;
let statusMessage = "";
let statusReady = false;

function canWrite() {
  return !unavailable && isChecklistData(value) && access === "read-write" && connection === "connected";
}

function singleLine(text) {
  return text.replace(/\r\n|[\r\n]/g, " ");
}

function clone(name) {
  const fragment = document.importNode(document.querySelector(`#checklist-${name}`).content, true);
  for (const icon of fragment.querySelectorAll("tv-icon")) {
    const template = icon.querySelector("template");
    const shadow = icon.shadowRoot ?? icon.attachShadow({ mode: "open", clonable: true });
    if (template) {
      shadow.append(template.content);
      template.remove();
    }
    shadow.adoptedStyleSheets = [iconStyles];
  }
  return fragment;
}

function editable(element, enabled, name) {
  for (const [attribute, content] of Object.entries({ contenteditable: "plaintext-only", role: "textbox", "aria-label": name })) {
    if (enabled) element.setAttribute(attribute, content);
    else element.removeAttribute(attribute);
  }
}

function currentItem(key) {
  return isChecklistData(value) && Object.hasOwn(value.items, key) ? value.items[key] : draft?.key === key ? draft : null;
}

function focusText(element) {
  if (!element || !canWrite()) return;
  element.focus();
  if (element instanceof HTMLInputElement) element.setSelectionRange(element.value.length, element.value.length);
  else {
    const range = document.createRange();
    range.selectNodeContents(element);
    range.collapse(false);
    const selection = getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  }
}

// The SDK owns optimistic values and rollback. Only the active text draft is
// separate: ordinary remote updates cannot replace it, but a refused save must.
async function save(operation, key) {
  try {
    await operation;
    return true;
  } catch {
    if (draft && draft.key === key) {
      const item = isChecklistData(value) && Object.hasOwn(value.items, key) ? value.items[key] : null;
      draft = item ? { key, order: item.order, done: item.done, text: singleLine(item.text) } : null;
      const field = rows.get(key)?.text;
      if (field && item) field.textContent = singleLine(item.text);
    }
    failure = true;
    clearTimeout(failureTimer);
    failureTimer = setTimeout(() => { failure = false; renderStatus(); }, 4000);
    render();
    return false;
  }
}

function saveItem(key, text, done) {
  if (!canWrite()) return;
  const item = currentItem(key);
  if (!item) return;
  const saved = { order: item.order, text, done };
  if (draft?.key === key) Object.assign(draft, saved);
  return save(set(ref(store, `items/${key}`), saved), key);
}

function focusInserted() {
  const field = rows.get(pendingFocus)?.text;
  if (!field) return;
  pendingFocus = null;
  focusText(field);
}

async function insert(text, afterKey, focus = false) {
  if (!canWrite()) return null;
  const order = insertionOrder(value.items, afterKey);
  if (order !== null) {
    const added = push(itemsRef, { order, text, done: false });
    if (focus) { pendingFocus = added.key; focusInserted(); }
    return await save(added, added.key) ? added.key : null;
  }
  const key = push(itemsRef).key;
  if (focus) pendingFocus = key;
  const update = createRenumberUpdate(key, { text, done: false }, afterKey);
  let result;
  const success = await save(runTransaction(itemsRef, current => canWrite() ? update(current) : undefined).then(outcome => { result = outcome; }), key);
  return success && result.committed ? key : null;
}

function insertAndFocus(afterKey) {
  insert("", afterKey, true);
}

function removeItem(key, backwards = false) {
  if (!canWrite()) return;
  const keys = [...list.children].map(element => [...rows].find(([, row]) => row.element === element)?.[0]);
  const index = keys.indexOf(key);
  const target = backwards ? keys[index - 1] : keys[index + 1] ?? keys[index - 1];
  if (draft?.key === key) draft = null;
  save(remove(ref(store, `items/${key}`)), key);
  focusText(rows.get(target)?.text ?? addField);
}

function createRow(key) {
  const fragment = clone("row");
  const element = fragment.firstElementChild;
  const text = element.querySelector(".checklist-text");
  const checkbox = element.querySelector(".checklist-check");
  const row = { element, text, checkbox };
  text.addEventListener("focus", () => {
    if (!canWrite()) return;
    const item = currentItem(key);
    if (item) draft = { key, order: item.order, done: item.done, text: text.textContent };
    retainedDraft = false;
    element.setAttribute("data-editing", "");
  });
  text.addEventListener("blur", () => {
    element.removeAttribute("data-editing");
    if (draft?.key !== key) return;
    if (!canWrite()) { retainedDraft = true; return; }
    const leaving = draft;
    draft = null;
    if (canWrite()) {
      if (leaving.text.trim() === "") save(remove(ref(store, `items/${key}`)), key);
      else if (!Object.hasOwn(value.items, key)) save(set(ref(store, `items/${key}`), { order: leaving.order, text: leaving.text, done: leaving.done }), key);
    }
    render();
  });
  text.addEventListener("input", () => {
    if (canWrite()) saveItem(key, text.textContent, currentItem(key).done);
  });
  text.addEventListener("keydown", event => itemKey(event, key));
  text.addEventListener("paste", event => paste(event, key));
  checkbox.addEventListener("change", () => {
    if (canWrite()) saveItem(key, draft?.key === key ? draft.text : currentItem(key).text, checkbox.checked);
  });
  return row;
}

function createContent() {
  main.prepend(clone("content"));
  title = main.querySelector(".checklist-title-text");
  list = main.querySelector(".checklist-items");
  title.addEventListener("input", () => {
    if (!canWrite()) return;
    if (title.textContent === "") title.replaceChildren();
    save(set(ref(store, "title"), title.textContent));
  });
  title.addEventListener("keydown", event => {
    if (event.key !== "Enter" || !canWrite()) return;
    event.preventDefault();
    insertAndFocus(null);
  });
  title.addEventListener("paste", event => {
    if (!canWrite()) return;
    event.preventDefault();
    document.execCommand("insertText", false, singleLine(event.clipboardData.getData("text/plain")));
  });
}

function render() {
  const valid = received && !unavailable && isChecklistData(value);
  if (!valid) {
    draft = null;
    retainedDraft = false;
    pendingFocus = null;
    rows.clear();
    title = list = addField = null;
    main.removeAttribute("data-read-only");
    for (const child of [...main.children]) if (child !== status) child.remove();
    if (received || unavailable) main.prepend(clone("unreadable"));
    renderStatus();
    return;
  }
  if (!title) {
    main.querySelector(".checklist-unreadable")?.remove();
    createContent();
  }
  const enabled = canWrite();
  main.toggleAttribute("data-read-only", !enabled);
  editable(title, enabled, "Title");
  const shownTitle = singleLine(value.title);
  if (title.textContent !== shownTitle) title.textContent = shownTitle;
  const items = { ...value.items };
  if (draft && !Object.hasOwn(items, draft.key)) Object.defineProperty(items, draft.key, { value: draft, enumerable: true });
  const entries = orderedItems(items);
  for (const [key, row] of rows) {
    if (!Object.hasOwn(items, key)) { row.element.remove(); rows.delete(key); }
  }
  let cursor = list.firstElementChild;
  entries.forEach(([key, item], index) => {
    let row = rows.get(key);
    if (!row) { row = createRow(key); rows.set(key, row); }
    // Leave nodes already in their place alone, preserving native editing and undo.
    if (row.element !== cursor) {
      if (row.element.isConnected) list.moveBefore(row.element, cursor);
      else list.insertBefore(row.element, cursor);
    }
    cursor = row.element.nextElementSibling;
    row.element.toggleAttribute("data-done", item.done);
    row.element.toggleAttribute("data-editing", enabled && draft?.key === key);
    row.checkbox.checked = item.done;
    row.checkbox.disabled = !enabled;
    const shown = draft?.key === key ? draft.text : singleLine(item.text);
    if (draft?.key === key) { draft.order = item.order; draft.done = item.done; }
    if (row.text.textContent !== shown) row.text.textContent = shown;
    const name = shown.trim() === "" ? "Empty item" : shown;
    row.checkbox.setAttribute("aria-label", name);
    editable(row.text, enabled, `Item ${index + 1}`);
    let button = row.element.querySelector(".checklist-remove");
    if (enabled && !button) {
      row.element.append(clone("remove"));
      button = row.element.querySelector(".checklist-remove");
      button.addEventListener("pointerdown", event => event.preventDefault());
      button.addEventListener("click", () => removeItem(key));
    }
    if (enabled) button.setAttribute("aria-label", `Remove ${name}`);
    else button?.remove();
  });
  main.querySelector(".checklist-empty")?.remove();
  if (enabled && !addField) {
    list.after(clone("add"));
    addField = main.querySelector(".checklist-add-input");
    addField.addEventListener("keydown", event => {
      if (event.key !== "Enter" || !canWrite() || addField.value.trim() === "") return;
      event.preventDefault();
      const text = addField.value;
      addField.value = "";
      insert(text);
    });
    addField.addEventListener("paste", event => paste(event));
  } else if (!enabled) {
    main.querySelector(".checklist-add")?.remove();
    addField = null;
    if (entries.length === 0) {
      const empty = document.createElement("p");
      empty.className = "checklist-empty";
      empty.textContent = "No items";
      list.after(empty);
    }
  }
  if (firstView && enabled) {
    firstView = false;
    if (entries.length === 0) addField.focus();
  }
  focusInserted();
  renderStatus();
}

function renderStatus() {
  statusMessage = connection === "disconnected" ? "Reconnecting…" : failure ? "Couldn't save that change." : "";
  if (!statusMessage) { status?.remove(); status = null; statusReady = false; return; }
  if (status) {
    if (statusReady) status.textContent = statusMessage;
    return;
  }
  status = document.createElement("p");
  status.className = "checklist-status";
  status.setAttribute("role", "status");
  main.append(status);
  const mounted = status;
  // Mount the empty live region before a later render task supplies its message.
  requestAnimationFrame(() => {
    if (status !== mounted) return;
    statusReady = true;
    status.textContent = statusMessage;
  });
}

function onBoundaryLine(field, direction) {
  const selection = getSelection();
  if (!selection?.isCollapsed || !selection.rangeCount) return false;
  if (!field.textContent) return true;
  const carets = [...selection.getRangeAt(0).getClientRects()];
  const range = document.createRange();
  range.selectNodeContents(field);
  const rects = [...range.getClientRects()];
  const edge = direction === "ArrowUp" ? rects[0] : rects.at(-1);
  if (!edge) return false;
  // A range collapsed at the element boundary has no caret rectangle.
  if (!carets.length && selection.anchorNode === field) {
    if (selection.anchorOffset === 0) carets.push(rects[0]);
    else if (selection.anchorOffset === field.childNodes.length) carets.push(rects.at(-1));
  }
  if (!carets.length) return false;
  const onEdge = caret => Math.abs(caret.top - edge.top) < edge.height / 2;
  if (carets.every(onEdge)) return true;
  if (!carets.some(onEdge)) return false;
  // At a soft wrap, one DOM offset has two rectangles. Native line movement
  // distinguishes which visual line owns the caret without discarding affinity.
  const node = selection.anchorNode;
  const offset = selection.anchorOffset;
  selection.modify("move", direction === "ArrowUp" ? "backward" : "forward", "lineboundary");
  return selection.anchorNode !== node || selection.anchorOffset !== offset;
}

function itemKey(event, key) {
  if (!canWrite()) return;
  const row = rows.get(key);
  if (isCompletionShortcut(event, navigator.platform)) {
    event.preventDefault();
    saveItem(key, row.text.textContent, !currentItem(key).done);
  } else if (event.key === "Enter") {
    event.preventDefault();
    insertAndFocus(key);
  } else if (event.key === "Backspace" && row.text.textContent.trim() === "") {
    event.preventDefault();
    if (row.element.previousElementSibling) removeItem(key, true);
  } else if (["ArrowUp", "ArrowDown"].includes(event.key) && onBoundaryLine(row.text, event.key)) {
    event.preventDefault();
    const previous = event.key === "ArrowUp";
    const neighbour = previous ? row.element.previousElementSibling : row.element.nextElementSibling;
    focusText(neighbour?.querySelector(".checklist-text") ?? (previous ? title : addField));
  }
}

async function paste(event, key) {
  if (!canWrite()) return;
  const text = event.clipboardData.getData("text/plain");
  if (!/[\r\n]/.test(text)) return;
  event.preventDefault();
  const lines = text.split(/\r\n|[\r\n]/).filter(line => line.trim() !== "");
  if (lines.length === 0) return;
  if (key !== undefined) document.execCommand("insertText", false, lines.shift());
  else addField.value = "";
  let last = key;
  for (const line of lines) {
    if (!canWrite()) return;
    last = await insert(line, last);
    if (last === null) return;
  }
  if (key !== undefined) focusText(rows.get(last)?.text);
}

function subscribe() {
  if (unsubscribe) return;
  unsubscribe = onValue(root, snapshot => {
    if (retainedDraft && connection === "connected" && access !== null) {
      draft = null;
      retainedDraft = false;
    }
    value = snapshot.val();
    received = true;
    unavailable = false;
    render();
  }, error => {
    unsubscribe = null;
    if (error.code === "unavailable") unavailable = true;
    render();
  });
}

function updateAccess(level) {
  access = level;
  if (!canWrite() && draft) retainedDraft = true;
  else if (canWrite() && retainedDraft) {
    draft = null;
    retainedDraft = false;
  }
  if (level !== null && connection === "connected") subscribe();
  render();
}

onAccessChanged(updateAccess);
getAccess().then(updateAccess, () => {});
onConnectionStatusChanged(next => {
  connection = next;
  if (next !== "connected") {
    access = null;
    if (draft) retainedDraft = true;
  } else {
    subscribe();
    getAccess().then(updateAccess, () => {});
  }
  render();
});
subscribe();

// A native textarea supplies editing, selection, scrolling and undo. The model
// decides which SDK value or retained draft it should display.
import {
  getStore, ref, onValue, get, set, getAccess, onAccessChanged,
  getConnectionStatus, onConnectionStatusChanged,
} from "/sdk/v1/resources.js";
import { createStickyNoteModel } from "./model.js";

const paper = document.querySelector(".sticky-note");
const status = paper.querySelector(".sticky-note-status");
const root = ref(getStore());
const text = ref(getStore(), "text");
const iconStyles = new CSSStyleSheet();
iconStyles.replaceSync(await (await fetch("./icons.css")).text());
let field;
let unsubscribe;

const model = createStickyNoteModel({
  readAccess: getAccess,
  readRoot: async () => (await get(root)).val(),
  writeText: value => set(text, value),
  changed: render,
});

function clone(name) {
  const fragment = document.importNode(document.querySelector(`#sticky-note-${name}`).content, true);
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

function render(view) {
  if (view.mode === "note") {
    paper.querySelector(".sticky-note-unreadable")?.remove();
    if (!field) {
      paper.prepend(clone("content"));
      field = paper.querySelector(".sticky-note-text");
      field.addEventListener("input", () => model.input(field.value));
      field.addEventListener("blur", () => model.blur());
    }
    if (field.readOnly === view.editable) field.readOnly = !view.editable;
    // Resetting even the same placeholder splits Chromium's native undo group.
    if (view.editable && !field.hasAttribute("placeholder")) field.setAttribute("placeholder", "Click here and start typing.");
    else if (!view.editable && field.hasAttribute("placeholder")) field.removeAttribute("placeholder");
    // Assigning even an unchanged textarea value can reset native selection,
    // scrolling and undo. Leave the browser's own edit untouched when it agrees.
    if (field.value !== view.text) field.value = view.text;
  } else {
    field?.remove();
    field = null;
    if (view.mode === "unreadable") {
      if (!paper.querySelector(".sticky-note-unreadable")) paper.prepend(clone("unreadable"));
    } else paper.querySelector(".sticky-note-unreadable")?.remove();
  }
  // The empty status region is already present in the document before the SDK
  // connects, so each message is an update to an established live region.
  if (status.textContent !== view.status) status.textContent = view.status;
}

function subscribe() {
  if (unsubscribe) return;
  unsubscribe = onValue(root, snapshot => model.receive(snapshot.val()), error => {
    unsubscribe = null;
    if (error.code === "unavailable") model.unavailable();
  });
}

onAccessChanged(level => {
  model.accessChanged(level);
  if (level !== null) subscribe();
});
onConnectionStatusChanged(connection => {
  if (connection === "connected") subscribe();
  model.connectionChanged(connection);
});
subscribe();
model.connectionChanged(getConnectionStatus());

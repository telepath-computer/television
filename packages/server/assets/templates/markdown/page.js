import {
  getStore,
  ref,
  onValue,
  set,
  onAccessChanged,
  getConnectionStatus,
  onConnectionStatusChanged,
} from "/sdk/v1/resources.js";

// The store holds: { markdown: string, required }.
// The page and agents replace markdown with the complete document string.
// Other root fields are ignored and preserved by the page.
const store = getStore();
const root = ref(store);
const markdown = ref(store, "markdown");

const page = document.querySelector(".markdown-page");
const mount = document.querySelector("#editor");
const loading = document.querySelector(".markdown-loading");
const unreadable = document.querySelector(".markdown-unreadable");
const status = document.querySelector(".markdown-status");
const shared = window.TelevisionMarkdownEditor;
if (!shared?.mount) throw new Error("The shared Markdown editor did not load");

let access = null;
let connection = getConnectionStatus();
let received = false;
let valid = false;
let latestStored = "";
let editor = null;
let unsubscribe;
let receivedValid = false;
let focusFirstBlank = false;
let failure = false;
let failureTimer;

function isMarkdownData(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && typeof value.markdown === "string";
}

function canEdit() {
  return received && valid && connection === "connected" && access === "read-write";
}

async function saveDocument(value) {
  if (!canEdit()) throw Object.assign(new Error("The document is read-only"), { code: "read-only" });
  try {
    await set(markdown, value);
  } catch (error) {
    saveFailed(error);
    throw error;
  }
}

function ensureEditor(value) {
  if (editor) return;
  editor = shared.mount({
    parent: mount,
    value,
    editable: canEdit(),
    onSave: saveDocument,
  });
}

function restoreStored() {
  if (!editor || !received || !valid) return;
  editor.setEditable(false);
  editor.setValue(latestStored);
}

function render() {
  const mode = !received ? "loading" : valid ? "editor" : "unreadable";
  page.dataset.state = mode;
  mount.hidden = mode !== "editor";
  loading.hidden = mode !== "loading";
  unreadable.hidden = mode !== "unreadable";
  editor?.setEditable(canEdit());
  status.textContent = connection === "disconnected"
    ? "Reconnecting…"
    : failure ? "Couldn't save that change." : "";
  if (canEdit() && focusFirstBlank) {
    focusFirstBlank = false;
    requestAnimationFrame(() => editor?.focus());
  }
}

function receive(snapshot) {
  received = true;
  const value = snapshot.val();
  if (!isMarkdownData(value)) {
    valid = false;
    render();
    return;
  }
  valid = true;
  if (!receivedValid) {
    receivedValid = true;
    focusFirstBlank = value.markdown === "";
  }
  if (!snapshot.metadata.hasPendingWrites) {
    latestStored = value.markdown;
    ensureEditor(value.markdown);
    editor.setValue(value.markdown);
  }
  render();
}

function subscribe() {
  if (unsubscribe) return;
  unsubscribe = onValue(root, receive, error => {
    unsubscribe = null;
    if (error.code === "no-store") {
      access = null;
      restoreStored();
      render();
    } else if (error.code !== "disconnected") {
      received = true;
      valid = false;
      render();
    }
  });
}

function saveFailed(error) {
  if (error?.code === "disconnected") return;
  failure = true;
  clearTimeout(failureTimer);
  failureTimer = setTimeout(() => {
    failure = false;
    render();
  }, 4000);
  render();
}

onAccessChanged(level => {
  access = level;
  if (level !== "read-write") restoreStored();
  if (level !== null) subscribe();
  render();
});

onConnectionStatusChanged(next => {
  connection = next;
  if (next !== "connected") {
    restoreStored();
  } else {
    subscribe();
  }
  render();
});

subscribe();
render();

addEventListener("pagehide", () => editor?.dispose(), { once: true });

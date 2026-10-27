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
let hasPendingWrites = false;
let lastPassed;

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
  if (editor) return false;
  editor = shared.mount({
    parent: mount,
    value,
    editable: canEdit(),
    onSave: saveDocument,
  });
  lastPassed = value;
  return true;
}

function restoreStored() {
  if (!editor || !received || !valid) return;
  editor.setEditable(false);
  editor.setValue(latestStored);
  lastPassed = latestStored;
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
    : hasPendingWrites ? "Saving…"
      : failure ? "Couldn't save that change." : "";
  if (canEdit() && focusFirstBlank) {
    focusFirstBlank = false;
    requestAnimationFrame(() => editor?.focus());
  }
}

function receive(snapshot) {
  received = true;
  hasPendingWrites = snapshot.metadata.hasPendingWrites;
  const value = snapshot.val();
  if (!isMarkdownData(value)) {
    restoreStored();
    valid = false;
    render();
    return;
  }
  valid = true;
  if (!receivedValid) {
    receivedValid = true;
    focusFirstBlank = value.markdown === "";
  }
  if (!hasPendingWrites) {
    latestStored = value.markdown;
    const mounted = ensureEditor(value.markdown);
    if (!mounted && value.markdown !== lastPassed) {
      editor.setValue(value.markdown);
      lastPassed = value.markdown;
    }
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
      restoreStored();
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

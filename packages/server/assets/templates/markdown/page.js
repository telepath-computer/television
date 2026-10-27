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

const listeners = new Set();
const context = {
  addEventListener(type, listener) {
    if (type === "content-updated") listeners.add(listener);
  },
  removeEventListener(type, listener) {
    if (type === "content-updated") listeners.delete(listener);
  },
  async updateContent(content) {
    if (!canEdit()) throw Object.assign(new Error("The document is read-only"), { code: "read-only" });
    await set(markdown, content);
  },
  publish(content) {
    for (const listener of listeners) listener({ content });
  },
};

const editor = shared.mount({
  parent: mount,
  ctx: context,
  editable: false,
  onSaveError: saveFailed,
});

let access = null;
let connection = getConnectionStatus();
let received = false;
let valid = false;
let synced = false;
let latestStored = "";
let unsubscribe;
let receivedValid = false;
let focusFirstBlank = false;
let focusedFirstBlank = false;
let failure = false;
let failureTimer;

function isMarkdownData(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && typeof value.markdown === "string";
}

function canEdit() {
  return received && valid && synced && connection === "connected" && access === "read-write";
}

function publishStored() {
  if (received && valid) context.publish(latestStored);
}

function render() {
  const mode = !received ? "loading" : valid ? "editor" : "unreadable";
  page.dataset.state = mode;
  mount.hidden = mode !== "editor";
  loading.hidden = mode !== "loading";
  unreadable.hidden = mode !== "unreadable";
  editor.setEditable(canEdit());
  status.textContent = connection === "disconnected"
    ? "Reconnecting…"
    : failure ? "Couldn't save that change." : "";
  if (canEdit() && focusFirstBlank && !focusedFirstBlank) {
    focusedFirstBlank = true;
    requestAnimationFrame(() => editor.view.focus());
  }
}

function receive(snapshot) {
  received = true;
  const value = snapshot.val();
  if (!isMarkdownData(value)) {
    valid = false;
    synced = connection === "connected";
    render();
    return;
  }
  valid = true;
  if (!receivedValid) {
    receivedValid = true;
    focusFirstBlank = value.markdown === "";
  }
  synced = connection === "connected";
  if (!snapshot.metadata.hasPendingWrites) latestStored = value.markdown;
  context.publish(value.markdown);
  render();
}

function savedDataUnavailable() {
  received = true;
  valid = false;
  synced = false;
  render();
}

function subscribe() {
  if (unsubscribe) return;
  unsubscribe = onValue(root, receive, error => {
    unsubscribe = null;
    if (error.code === "no-store") {
      access = null;
      publishStored();
      render();
    } else if (error.code !== "disconnected") {
      savedDataUnavailable();
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
  if (level !== "read-write") publishStored();
  if (level !== null) subscribe();
  render();
});

onConnectionStatusChanged(next => {
  connection = next;
  if (next !== "connected") {
    synced = false;
    publishStored();
  } else {
    subscribe();
  }
  render();
});

subscribe();
render();

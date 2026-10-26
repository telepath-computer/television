// The SDK owns stored values, optimistic writes and rollback. A separate draft
// keeps the latest typing until its particular save has been confirmed.

/** Validates the complete root without changing it. */
export function isStickyNoteData(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && typeof value.text === "string";
}

/** Coordinates text replacement, the input delay and reconnect checks. */
export function createStickyNoteModel({ readAccess, readRoot, writeText, changed }) {
  let value;
  let received = false;
  let unreadable = false;
  let access = null;
  let connection = "idle";
  let checked = false;
  let generation = 0;
  let draft = null;
  let inputTimer;
  let failureTimer;
  let failure = false;
  let disposed = false;
  let previousView;

  function view() {
    const valid = received && !unreadable && isStickyNoteData(value);
    const retain = draft && (!draft.sent || connection !== "connected" || !checked);
    return {
      mode: valid ? "note" : received || unreadable ? "unreadable" : "loading",
      text: valid ? retain ? draft.text : value.text : "",
      editable: valid && access === "read-write",
      status: connection === "disconnected" ? "Reconnecting…" : failure ? "Couldn't save that change." : "",
    };
  }

  function render() {
    if (disposed) return;
    const next = view();
    if (previousView && Object.keys(next).every(key => next[key] === previousView[key])) return;
    previousView = next;
    changed(next);
  }

  function discard() {
    clearTimeout(inputTimer);
    draft = null;
  }

  function receive(next) {
    value = next;
    received = true;
    unreadable = false;
    if (!isStickyNoteData(value)) discard();
    render();
  }

  function unavailable() {
    unreadable = true;
    discard();
    render();
  }

  function accessChanged(next) {
    access = next;
    if (access !== "read-write") discard();
    render();
  }

  function save() {
    if (disposed || !draft || draft.sent || !draft.due || !checked
      || connection !== "connected" || !view().editable) return;
    const saving = draft;
    saving.sent = true;
    // Mark the draft before set publishes its optimistic value. That value,
    // and subsequent SDK values, can then replace the field until more input.
    writeText(saving.text).then(() => {
      if (disposed) return;
      if (draft === saving) draft = null;
      render();
    }, error => {
      if (disposed) return;
      if (error.code === "disconnected") {
        if (draft === saving) saving.sent = false;
      } else {
        discard();
        failure = true;
        clearTimeout(failureTimer);
        failureTimer = setTimeout(() => { failure = false; render(); }, 4000);
      }
      render();
    });
  }

  async function refresh(currentGeneration) {
    try {
      const level = await readAccess();
      if (disposed || generation !== currentGeneration) return;
      accessChanged(level);
      const current = await readRoot();
      if (disposed || generation !== currentGeneration) return;
      receive(current);
      checked = true;
      save();
      render();
    } catch (error) {
      if (disposed || generation !== currentGeneration) return;
      if (error.code === "no-store") accessChanged(null);
      else if (error.code !== "disconnected") {
        checked = true;
        unavailable();
      }
    }
  }

  return {
    get view() { return view(); },
    receive,
    unavailable,
    accessChanged,
    input(text) {
      if (!view().editable) return;
      draft = { text, due: false, sent: false };
      clearTimeout(inputTimer);
      inputTimer = setTimeout(() => {
        if (draft) { draft.due = true; save(); }
      }, 400);
      render();
    },
    blur() {
      if (!draft || draft.sent) return;
      clearTimeout(inputTimer);
      draft.due = true;
      save();
    },
    connectionChanged(next) {
      if (connection === next) return;
      connection = next;
      checked = false;
      generation++;
      if (next === "disconnected" && draft) draft.sent = false;
      render();
      if (next === "connected") void refresh(generation);
    },
    dispose() {
      disposed = true;
      generation++;
      clearTimeout(inputTimer);
      clearTimeout(failureTimer);
    },
  };
}

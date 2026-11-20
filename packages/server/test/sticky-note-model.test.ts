import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createStickyNoteModel, isStickyNoteData } from "../assets/templates/sticky-note/model.js";

// Contracts: proofs/arch/templates/sticky-note.md, validity, saving and offline.
// Time and SDK delivery are controlled here; the browser tests cross both seams.
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function harness() {
  const reads = { access: deferred<"read" | "read-write">(), root: deferred<unknown>() };
  const writes: Array<ReturnType<typeof deferred<void>> & { text: string }> = [];
  const changed = vi.fn();
  const readAccess = vi.fn(() => reads.access.promise);
  const readRoot = vi.fn(() => reads.root.promise);
  const model = createStickyNoteModel({
    readAccess, readRoot, changed,
    writeText: (text: string) => {
      const write = { ...deferred<void>(), text };
      writes.push(write);
      model.receive({ text }); // The SDK publishes its optimistic value.
      return write.promise;
    },
  });
  async function connect(text = "Stored", access: "read" | "read-write" = "read-write") {
    model.connectionChanged("connected");
    reads.access.resolve(access);
    reads.root.resolve({ text });
    await vi.advanceTimersByTimeAsync(0);
  }
  function nextConnection() {
    reads.access = deferred<"read" | "read-write">();
    reads.root = deferred<unknown>();
    model.connectionChanged("connected");
  }
  return { model, reads, writes, changed, readAccess, readRoot, connect, nextConnection };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("Sticky note whole-value validation", () => {
  it.each(["", "   \t", "One\n\nTwo", "Note"])("accepts text %j and preserves extra fields", text => {
    const value = { text, extra: { retained: [1, 2] } };
    const original = structuredClone(value);
    expect(isStickyNoteData(value)).toBe(true);
    expect(value).toEqual(original);
  });
  it.each([undefined, null, [], "text", 2, false, {}, { text: null }, { text: 1 }, { text: [] }])(
    "rejects malformed root %j", value => expect(isStickyNoteData(value)).toBe(false),
  );
});

describe("Sticky note save timing and confirmation ownership", () => {
  it("restarts the 400 ms pause on every input and sends only the complete latest string", async () => {
    const h = harness();
    await h.connect();
    expect(h.writes).toHaveLength(0);
    h.model.input("First");
    await vi.advanceTimersByTimeAsync(399);
    expect(h.writes).toHaveLength(0);
    h.model.input("  Latest\ncomplete text  ");
    await vi.advanceTimersByTimeAsync(399);
    expect(h.writes).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(h.writes.map(write => write.text)).toEqual(["  Latest\ncomplete text  "]);
    expect(h.model.view.status).toBe("");
  });

  it("saves immediately on blur, including an empty string, without a duplicate timer save", async () => {
    const h = harness();
    await h.connect();
    h.model.input("");
    h.model.blur();
    expect(h.writes.map(write => write.text)).toEqual([""]);
    await vi.advanceTimersByTimeAsync(400);
    expect(h.writes).toHaveLength(1);
  });

  it("suppresses incoming text only while unsent and never replays a suppressed value", async () => {
    const h = harness();
    await h.connect();
    h.model.input("Typing");
    h.model.receive({ text: "Suppressed remote" });
    expect(h.model.view.text).toBe("Typing");
    h.model.blur();
    h.model.receive({ text: "Later remote" });
    expect(h.model.view.text).toBe("Later remote");
    h.writes[0]!.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(h.model.view.text).toBe("Later remote");
    h.changed.mockClear();
    h.model.receive({ text: "Later remote" });
    expect(h.changed).not.toHaveBeenCalled();
  });

  it("an older confirmation clears only its draft and leaves newer typing pending", async () => {
    const h = harness();
    await h.connect();
    h.model.input("Sent");
    h.model.blur();
    h.model.input("Newer unsent");
    h.writes[0]!.resolve();
    await vi.advanceTimersByTimeAsync(399);
    expect(h.model.view.text).toBe("Newer unsent");
    expect(h.writes).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(h.writes.map(write => write.text)).toEqual(["Sent", "Newer unsent"]);
  });

  it.each(["Stored", "Possibly durable sent value"])("refusal discards all typing and shows SDK rollback %j", async rollback => {
    const h = harness();
    await h.connect();
    h.model.input("Sent");
    h.model.blur();
    h.model.input("Newer unsent");
    h.model.receive({ text: rollback });
    h.writes[0]!.reject({ code: "unavailable" });
    await vi.advanceTimersByTimeAsync(0);
    expect(h.model.view.text).toBe(rollback);
    expect(h.model.view.status).toBe("Couldn't save that change.");
    await vi.advanceTimersByTimeAsync(400);
    expect(h.writes).toHaveLength(1);
    h.model.connectionChanged("disconnected");
    expect(h.model.view.status).toBe("Reconnecting…");
    await vi.advanceTimersByTimeAsync(5000);
    await h.connect(rollback);
    expect(h.model.view.status).toBe("");
  });
});

describe("Sticky note offline draft and reconnect decisions", () => {
  it("requires previously established access and readable data before offline editing", async () => {
    const h = harness();
    h.model.connectionChanged("disconnected");
    h.model.input("Cannot edit loading");
    expect(h.model.view).toMatchObject({ mode: "loading", editable: false });
    expect(h.writes).toHaveLength(0);
    await h.connect("Stored", "read");
    h.model.connectionChanged("disconnected");
    h.model.input("Cannot edit read-only");
    expect(h.model.view).toMatchObject({ text: "Stored", editable: false });
  });

  it.each(["pause", "blur"])("keeps the latest offline draft and waits for access and root before saving after %s", async trigger => {
    const h = harness();
    await h.connect();
    h.model.input("In flight");
    h.model.blur();
    h.model.connectionChanged("disconnected");
    h.model.receive({ text: "Stored" });
    h.writes[0]!.reject({ code: "disconnected" });
    await vi.advanceTimersByTimeAsync(0);
    expect(h.model.view.text).toBe("In flight");
    expect(h.model.view.editable).toBe(true);
    h.model.input("Offline one");
    h.model.input("Offline latest");
    if (trigger === "pause") await vi.advanceTimersByTimeAsync(400);
    else h.model.blur();
    expect(h.writes).toHaveLength(1);
    h.nextConnection();
    h.model.receive({ text: "Remote edit" });
    expect(h.model.view.text).toBe("Offline latest");
    h.reads.access.resolve("read-write");
    await vi.advanceTimersByTimeAsync(0);
    expect(h.readAccess).toHaveBeenCalledTimes(2);
    expect(h.readRoot).toHaveBeenCalledTimes(2);
    expect(h.writes).toHaveLength(1);
    h.reads.root.resolve({ text: "Remote edit", extra: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(h.writes.map(write => write.text)).toEqual(["In flight", "Offline latest"]);
    expect(h.model.view.text).toBe("Offline latest");
    await vi.advanceTimersByTimeAsync(800);
    expect(h.writes).toHaveLength(2);
  });

  it("finishes the normal pause after reconnect if it was not reached offline", async () => {
    const h = harness();
    await h.connect();
    h.model.connectionChanged("disconnected");
    h.model.input("Offline");
    await vi.advanceTimersByTimeAsync(100);
    await h.connect("Remote");
    expect(h.model.view.text).toBe("Offline");
    await vi.advanceTimersByTimeAsync(299);
    expect(h.writes).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(h.writes.map(write => write.text)).toEqual(["Offline"]);
  });

  it("shows current stored text when reconnecting without a draft", async () => {
    const h = harness();
    await h.connect();
    h.model.connectionChanged("disconnected");
    h.nextConnection();
    h.reads.access.resolve("read-write");
    h.reads.root.resolve({ text: "Latest remote" });
    await vi.advanceTimersByTimeAsync(0);
    expect(h.model.view.text).toBe("Latest remote");
    expect(h.writes).toHaveLength(0);
  });

  it.each(["read", "invalid", "unavailable"])("discards a draft on %s and never replays it after repair", async reason => {
    const h = harness();
    await h.connect();
    h.model.connectionChanged("disconnected");
    h.model.input("Discarded");
    await vi.advanceTimersByTimeAsync(400);
    h.nextConnection();
    h.reads.access.resolve(reason === "read" ? "read" : "read-write");
    if (reason === "unavailable") h.reads.root.reject({ code: "unavailable" });
    else h.reads.root.resolve(reason === "invalid" ? {} : { text: "Remote" });
    await vi.advanceTimersByTimeAsync(0);
    expect(h.model.view.editable).toBe(false);
    expect(h.model.view.text).not.toBe("Discarded");
    h.model.input("Also forbidden");
    h.model.blur();
    h.model.accessChanged("read-write");
    h.model.receive({ text: "Repaired" });
    await vi.advanceTimersByTimeAsync(500);
    expect(h.model.view.text).toBe("Repaired");
    expect(h.writes).toHaveLength(0);
    h.model.input("Fresh edit");
    h.model.blur();
    expect(h.writes.map(write => write.text)).toEqual(["Fresh edit"]);
  });

  it("invalid subscription cancels unsent typing but does not cancel an already-sent save", async () => {
    const h = harness();
    await h.connect();
    h.model.input("Sent");
    h.model.blur();
    h.model.input("Unsent");
    h.model.receive(null);
    h.model.input("Forbidden");
    h.model.blur();
    await vi.advanceTimersByTimeAsync(400);
    expect(h.model.view.mode).toBe("unreadable");
    expect(h.writes).toHaveLength(1);
    h.model.receive({ text: "Sent" });
    h.writes[0]!.resolve();
    await vi.advanceTimersByTimeAsync(400);
    expect(h.model.view.text).toBe("Sent");
    expect(h.writes).toHaveLength(1);
  });
});

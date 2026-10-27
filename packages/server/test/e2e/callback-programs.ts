// Generated callback programs for the JSON store's delivery rules
// (proofs/arch/resources/json-store.md#^js-arch-t-local-view). A seeded
// program registers listeners of every kind at overlapping paths in two
// stores; their callbacks write with set, update, remove, increment, push
// and transactions, add listeners and remove them, and sometimes throw. The
// page records every write it made and every call each listener heard, and
// the check replays the writes with the shared write rules to find the
// states the page showed, which each listener must have heard in order.
import {
  applyJsonWrite,
  compareChildKeys,
  deleteValue,
  increment,
  isJsonObject,
  jsonEqual,
  parseJsonPath,
  readJsonValue,
  type JSONValue,
  type JsonWrite,
  type UpdateEntryValue,
} from "@telepath-computer/television-shared/resources";

/** A written value as the program records it: plain JSON, an increment, or a delete in an update. */
export type ProgramEntry = { value: JSONValue } | { increment: number } | { remove: true };

/** A write as the program records it; a push and a transaction's attempt are recorded as the set each makes. */
export type ProgramOp =
  | { store: string; kind: "set"; path: string; entry: ProgramEntry }
  | { store: string; kind: "update"; path: string; entries: Array<[string, ProgramEntry]> }
  | { store: string; kind: "remove"; path: string };

/** A write the program makes. */
type ProgramAction =
  | ProgramOp
  | { store: string; kind: "push"; path: string; value: JSONValue }
  | { store: string; kind: "transaction"; path: string; add: number };

export type ListenerKind = "value" | "child-added" | "child-changed" | "child-removed";

export type HeardValue = { exists: boolean; value: JSONValue | null; pending: boolean };
export type HeardChild = { key: string; value: JSONValue | null };

export interface ProgramListener {
  id: number;
  store: string;
  path: string;
  kind: ListenerKind;
  /** How many writes the page had made to the listener's store when it was added. */
  registeredAt: number;
  /** Added where no listener was, so it starts from the first value the server sends, after any writes made meanwhile. */
  startsLater: boolean;
  anchor: boolean;
  unsubscribed: boolean;
  heard: Array<HeardValue | HeardChild>;
}

export interface ProgramResult {
  ops: ProgramOp[];
  listeners: ProgramListener[];
  failures: string[];
}

/** Each program's subtree of each store holds this at the start. */
export const PROGRAM_START: Record<string, JSONValue> = {
  todos: { a: 1, b: { x: 1, y: 2 }, c: 3 },
  other: { k: 0 },
};

/**
 * Runs one program in the page. It is passed to `page.evaluate`, so it uses
 * nothing from this module.
 */
export async function runCallbackProgram({ seed, budget, other }: { seed: number; budget: number; other: string }): Promise<ProgramResult> {
  const sdk = window.sdk;
  let state = seed >>> 0;
  // mulberry32
  const random = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)]!;
  const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
  const root = `p${seed}`;
  // "todos" is the artifact's own store, and "other" a store bound to it by its resource ID.
  const stores: Record<string, ReturnType<typeof sdk.getStore>> = { todos: sdk.getStore(), other: sdk.getStore(other) };
  const at = (store: string, path: string) => sdk.ref(stores[store]!, path);
  const ops: ProgramOp[] = [];
  const counts: Record<string, number> = { todos: 0, other: 0 };
  const writes: Array<Promise<unknown>> = [];
  const failures: string[] = [];
  const listeners: ProgramListener[] = [];
  const unsubscribes = new Map<number, () => void>();
  // Callbacks act only once every watched path is known, so each listener starts from the state it was added in.
  let started = false;

  const encode = (entry: ProgramEntry) => ("remove" in entry ? sdk.deleteValue() : "increment" in entry ? sdk.increment(entry.increment) : entry.value);
  /** Records a write before making it, so that writes its listeners make while it is shown are recorded after it. */
  const record = (op: ProgramOp): void => {
    ops.push(op);
    counts[op.store]! += 1;
  };
  const perform = (action: ProgramAction): void => {
    if (ops.length >= budget) return;
    const ref = at(action.store, action.path);
    let done: Promise<unknown>;
    if (action.kind === "push") {
      const op: ProgramOp = { store: action.store, kind: "set", path: "", entry: { value: action.value } };
      record(op);
      const pushed = sdk.push(ref, action.value);
      op.path = `${action.path}/${pushed.key!}`;
      done = Promise.resolve(pushed);
    } else if (action.kind === "transaction") {
      let calls = 0;
      // The transaction reads a watched path, so its function runs at once and its attempt is recorded in order.
      done = sdk.runTransaction(ref, (current) => {
        calls += 1;
        if (calls > 1) failures.push(`the transaction ${JSON.stringify(action)} was retried, though the page is the only writer`);
        const next = (typeof current === "number" ? current : 0) + action.add;
        record({ store: action.store, kind: "set", path: action.path, entry: { value: next } });
        return next;
      });
    } else {
      record(action);
      done =
        action.kind === "set"
          ? sdk.set(ref, encode(action.entry) as never)
          : action.kind === "remove"
            ? sdk.remove(ref)
            : sdk.update(ref, Object.fromEntries(action.entries.map(([key, entry]) => [key, encode(entry)])) as never);
    }
    writes.push(done.catch((error: { code?: string }) => failures.push(`${JSON.stringify(action)} was refused: ${error.code}`)));
  };
  const small = () => Math.floor(random() * 4);
  const templates: Array<() => ProgramAction> = [
    () => ({ store: "todos", kind: "set", path: `${root}/a`, entry: { value: small() } }),
    () => ({ store: "todos", kind: "set", path: `${root}/c`, entry: { value: small() } }),
    () => ({ store: "todos", kind: "set", path: `${root}/b/x`, entry: { value: small() } }),
    () => ({ store: "todos", kind: "set", path: `${root}/b/y`, entry: { value: small() } }),
    () => ({ store: "todos", kind: "set", path: `${root}/b`, entry: { value: random() < 0.5 ? ({ x: small() } as JSONValue) : { x: small(), y: small() } } }),
    () => ({ store: "todos", kind: "set", path: `${root}/a`, entry: { increment: 1 + small() } }),
    () => ({ store: "todos", kind: "remove", path: `${root}/a` }),
    () => ({ store: "todos", kind: "remove", path: `${root}/b/y` }),
    () => ({ store: "todos", kind: "remove", path: `${root}/b` }),
    () => ({ store: "todos", kind: "update", path: root, entries: [["a", { value: small() }], ["b/x", { value: small() }]] }),
    () => ({ store: "todos", kind: "update", path: `${root}/b`, entries: [["x", { value: small() }], ["y", { remove: true }]] }),
    () => ({ store: "other", kind: "set", path: `${root}/k`, entry: { value: small() } }),
    () => ({ store: "todos", kind: "push", path: `${root}/b`, value: small() }),
    () => ({ store: "todos", kind: "transaction", path: `${root}/a`, add: 1 + small() }),
  ];
  const valuePaths: Record<string, string[]> = { todos: [root, `${root}/a`, `${root}/b`, `${root}/b/x`], other: [root] };
  const childPaths: Record<string, string[]> = { todos: [root, `${root}/b`], other: [root] };
  /** Paths no anchor watches: a listener added at one may start only when the server's first value arrives. */
  const unwatchedPaths = [`${root}/c`, `${root}/b/y`];

  const register = (store: string, path: string, kind: ListenerKind, anchor: boolean, startsLater = false): ProgramListener => {
    const listener: ProgramListener = { id: listeners.length, store, path, kind, registeredAt: counts[store]!, startsLater, anchor, unsubscribed: false, heard: [] };
    listeners.push(listener);
    let reactions = random() < 0.6 ? 1 + Math.floor(random() * 2) : 0;
    const react = (): void => {
      if (!started || reactions === 0 || random() < 0.4) return;
      reactions -= 1;
      const count = 1 + Math.floor(random() * 3);
      for (let index = 0; index < count; index++) perform(pick(templates)());
      if (random() < 0.3) registerRandom();
      if (random() < 0.2) unsubscribeRandom();
      // Reported as uncaught; nothing else may notice.
      if (random() < 0.1) throw new Error("a callback program's callback throws");
    };
    const ref = at(store, path);
    const unsubscribe =
      kind === "value"
        ? sdk.onValue(ref, (snapshot) => {
            listener.heard.push({ exists: snapshot.exists(), value: snapshot.exists() ? snapshot.val()! : null, pending: snapshot.metadata.hasPendingWrites });
            react();
          })
        : (kind === "child-added" ? sdk.onChildAdded : kind === "child-changed" ? sdk.onChildChanged : sdk.onChildRemoved)(ref, (snapshot) => {
            listener.heard.push({ key: snapshot.key!, value: snapshot.exists() ? snapshot.val()! : null });
            react();
          });
    unsubscribes.set(listener.id, unsubscribe);
    return listener;
  };
  const registerRandom = (): void => {
    if (random() < 0.2) {
      register("todos", pick(unwatchedPaths), "value", false, true);
      return;
    }
    const store = random() < 0.85 ? "todos" : "other";
    const kind = pick<ListenerKind>(["value", "child-added", "child-changed", "child-removed"]);
    register(store, pick(kind === "value" ? valuePaths[store]! : childPaths[store]!), kind, false);
  };
  const unsubscribeRandom = (): void => {
    const candidates = listeners.filter((listener) => !listener.anchor && !listener.unsubscribed);
    if (candidates.length === 0) return;
    const victim = pick(candidates);
    victim.unsubscribed = true;
    unsubscribes.get(victim.id)!();
  };

  // Every watched path is known before the program writes: an onValue anchor at each holds it.
  const anchors = Object.keys(valuePaths).flatMap((store) => valuePaths[store]!.map((path) => register(store, path, "value", true)));
  for (let index = Math.floor(random() * 5); index > 0; index--) registerRandom();
  while (anchors.some((anchor) => anchor.heard.length === 0)) await tick();
  await tick();
  started = true;

  for (let index = 2 + Math.floor(random() * 3); index > 0; index--) {
    perform(pick(templates)());
    if (random() < 0.5) await tick();
  }
  for (let seen = -1; seen !== writes.length; ) {
    seen = writes.length;
    await Promise.all(writes);
    await tick();
  }
  const settled = () =>
    listeners.every(
      (listener) =>
        listener.kind !== "value" ||
        listener.unsubscribed ||
        (listener.heard.length > 0 && (listener.heard.at(-1) as HeardValue).pending === false),
    );
  for (let waited = 0; !settled() && waited < 5_000; waited += 10) await new Promise((resolve) => setTimeout(resolve, 10));
  for (const unsubscribe of unsubscribes.values()) unsubscribe();
  return { ops, listeners, failures };
}

function decodeEntry(entry: ProgramEntry): UpdateEntryValue {
  if ("remove" in entry) return deleteValue();
  if ("increment" in entry) return increment(entry.increment);
  return entry.value;
}

function toWrite(op: ProgramOp): JsonWrite {
  if (op.kind === "set") return { kind: "set", path: op.path, value: decodeEntry(op.entry) as JSONValue };
  if (op.kind === "remove") return { kind: "remove", path: op.path };
  return { kind: "update", path: op.path, entries: op.entries.map(([key, entry]) => [key, decodeEntry(entry)] as const) };
}

function same(left: JSONValue | undefined, right: JSONValue | undefined): boolean {
  return left === undefined || right === undefined ? left === right : jsonEqual(left, right);
}

function withoutRepeats(values: Array<JSONValue | undefined>): Array<JSONValue | undefined> {
  return values.filter((value, index) => index === 0 || !same(values[index - 1], value));
}

/** The child events of one kind between two values, in child order. */
function childEventsOf(kind: ListenerKind, before: JSONValue | undefined, after: JSONValue | undefined): HeardChild[] {
  const old = isJsonObject(before) ? before : {};
  const next = isJsonObject(after) ? after : {};
  const keys = [...new Set([...Object.keys(old), ...Object.keys(next)])].sort(compareChildKeys);
  const events: HeardChild[] = [];
  for (const key of keys) {
    const inOld = Object.hasOwn(old, key);
    const inNext = Object.hasOwn(next, key);
    if (kind === "child-added" && inNext && !inOld) events.push({ key, value: next[key]! });
    if (kind === "child-removed" && inOld && !inNext) events.push({ key, value: old[key]! });
    if (kind === "child-changed" && inOld && inNext && !jsonEqual(old[key]!, next[key]!)) events.push({ key, value: next[key]! });
  }
  return events;
}

function matches<T>(heard: T[], expected: T[], prefixOnly: boolean, equal: (left: T, right: T) => boolean): boolean {
  if (prefixOnly ? heard.length > expected.length : heard.length !== expected.length) return false;
  return heard.every((item, index) => equal(item, expected[index]!));
}

/** Whether a listener heard what it should have, given the states the page showed from its first one. */
function heardAsExpected(listener: ProgramListener, shown: Array<JSONValue | undefined>): { ok: boolean; expected: unknown } {
  if (listener.kind === "value") {
    const heard = listener.heard as HeardValue[];
    const expected = withoutRepeats(shown);
    const values = withoutRepeats(heard.map((entry) => (entry.exists ? entry.value! : undefined)));
    // A value is heard again only as the confirmation that clears hasPendingWrites.
    const repeatsOnlyConfirm = heard.every(
      (entry, index) => index === 0 || !same(heard[index - 1]!.exists ? heard[index - 1]!.value! : undefined, entry.exists ? entry.value! : undefined) || !entry.pending,
    );
    const confirmed = listener.unsubscribed || heard.at(-1)?.pending === false;
    return { ok: matches(values, expected, listener.unsubscribed, same) && repeatsOnlyConfirm && confirmed, expected };
  }
  const expected: HeardChild[] = listener.kind === "child-added" ? childEventsOf("child-added", undefined, shown[0]) : [];
  for (let index = 1; index < shown.length; index++) expected.push(...childEventsOf(listener.kind, shown[index - 1], shown[index]));
  const equal = (left: HeardChild, right: HeardChild) => left.key === right.key && same(left.value ?? undefined, right.value ?? undefined);
  return { ok: matches(listener.heard as HeardChild[], expected, listener.unsubscribed, equal), expected };
}

/**
 * Checks what each listener heard against the states the page showed: the
 * value when it was added, then every change after it, in order. A listener
 * the program removed must have heard the start of that. Also checks that
 * the server stored the last state.
 */
export function checkProgram(seed: number, result: ProgramResult, stored: Record<string, JSONValue | undefined>): string[] {
  const root = `p${seed}`;
  const states: Record<string, Array<JSONValue | undefined>> = {};
  for (const store of Object.keys(PROGRAM_START)) states[store] = [{ [root]: PROGRAM_START[store]! }];
  for (const op of result.ops) {
    const list = states[op.store]!;
    list.push(applyJsonWrite(list.at(-1), toWrite(op), { now: 0 }));
  }
  const problems = result.failures.map((failure) => `seed ${seed}: ${failure}`);
  for (const store of Object.keys(states)) {
    const last = readJsonValue(states[store]!.at(-1), [root]);
    if (!same(stored[store], last)) problems.push(`seed ${seed}: ${store} stores ${JSON.stringify(stored[store])}, expected ${JSON.stringify(last)}`);
  }
  for (const listener of result.listeners) {
    const segments = parseJsonPath(listener.path).slice(1);
    const shown = states[listener.store]!.map((value) => readJsonValue(readJsonValue(value, [root]), segments));
    // A listener added where no value was known yet starts from whichever state the first value showed.
    const starts = listener.startsLater ? shown.map((_, index) => index).slice(listener.registeredAt) : [listener.registeredAt];
    const results = starts.map((start) => heardAsExpected(listener, shown.slice(start)));
    if (results.some((result) => result.ok)) continue;
    problems.push(
      `seed ${seed}: ${listener.kind} listener ${listener.id} at ${listener.store}/${listener.path}, added after write ${listener.registeredAt}` +
        `${listener.startsLater ? " where no value was known" : ""}${listener.unsubscribed ? ", removed later" : ""}: ` +
        `heard ${JSON.stringify(listener.heard)}, expected ${JSON.stringify(results[0]!.expected)}`,
    );
  }
  return problems;
}
